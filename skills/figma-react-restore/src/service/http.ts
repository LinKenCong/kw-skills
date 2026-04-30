import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { createId } from '../ids.js';
import {
  artifactUploadSchema,
  jobCreateSchema,
  jobProgressSchema,
  jobResultSchema,
  rawExtractionSchema,
  sessionRegisterSchema,
  type ArtifactRef,
  type RawExtraction,
} from '../schema.js';
import { inferExtension, sanitizeFileName } from '../artifact/store.js';
import { RuntimeStateError, type RuntimeEvent, type RuntimeJob, type RuntimeState } from './state.js';
import { SERVICE_VERSION } from './lockfile.js';

const MAX_JSON_BODY_BYTES = 35 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 24 * 1024 * 1024;
const ALLOWED_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/svg+xml', 'application/json', 'text/plain']);
const ADMIN_TOKEN_HEADER = 'x-frr-admin-token';
const JOB_SECRET_HEADER = 'x-frr-job-secret';
const PLUGIN_SESSION_HEADER = 'x-frr-plugin-session-id';
const ALLOWED_BROWSER_ORIGINS = new Set(['null', 'https://www.figma.com', 'https://figma.com']);
const CORS_ALLOW_HEADERS = [
  'content-type',
  ADMIN_TOKEN_HEADER,
  JOB_SECRET_HEADER,
  PLUGIN_SESSION_HEADER,
].join(', ');

export function createRuntimeApp(state: RuntimeState): Hono {
  const app = new Hono();

  app.use('*', async (c, next) => {
    const origin = c.req.header('origin');
    if (origin) {
      if (!ALLOWED_BROWSER_ORIGINS.has(origin)) {
        if (c.req.method === 'OPTIONS') return c.body(null, 403);
        return c.json({ ok: false, error: { code: 'CORS_ORIGIN_DENIED', message: `Origin is not allowed: ${origin}` } }, 403);
      }
      c.header('access-control-allow-origin', origin);
      c.header('access-control-allow-methods', 'GET,POST,OPTIONS');
      c.header('access-control-allow-headers', CORS_ALLOW_HEADERS);
      c.header('access-control-max-age', '600');
      c.header('vary', 'origin');
    }
    if (c.req.method === 'OPTIONS') return c.body(null, 204);
    return next();
  });

  app.use('*', bodyLimit({ maxSize: MAX_JSON_BODY_BYTES }));

  app.onError((error, c) => {
    const status = errorStatus(error);
    return c.json({ ok: false, error: normalizeError(error) }, status);
  });

  app.get('/health', (c) => {
    const base = {
      ok: true,
      service: 'figma-react-restore',
      version: SERVICE_VERSION,
    };
    if (!c.req.header(ADMIN_TOKEN_HEADER)) return c.json(base);
    requireAdmin(c, state);
    return c.json({
      ...base,
      pid: process.pid,
      workspaceRoot: state.store.workspaceRoot,
      artifactRoot: state.store.artifactRoot,
      pluginConnected: state.listSessions().some((session) => session.connected),
      activeJobs: state.activeJobCount(),
    });
  });

  app.get('/sessions', (c) => {
    requireAdmin(c, state);
    return c.json({ ok: true, sessions: state.listSessions() });
  });

  app.post('/sessions/register', async (c) => {
    const payload = sessionRegisterSchema.parse(await c.req.json());
    const session = state.registerSession(payload);
    return c.json({ ok: true, session });
  });

  app.get('/events', (c) => {
    const sessionId = c.req.query('sessionId');
    if (!sessionId) return c.json({ ok: false, error: { code: 'SESSION_REQUIRED', message: 'sessionId query param is required' } }, 400);
    if (!state.sessions.has(sessionId)) {
      return c.json({ ok: false, error: { code: 'SESSION_NOT_FOUND', message: `Unknown session: ${sessionId}` } }, 404);
    }
    return new Response(createEventStream(state, sessionId), {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      },
    });
  });

  app.post('/jobs', async (c) => {
    requireAdmin(c, state);
    const payload = jobCreateSchema.parse(await c.req.json());
    const job = state.createJob({
      capability: payload.capability,
      options: payload.options,
      ...(payload.sessionId ? { sessionId: payload.sessionId } : {}),
    });
    return c.json({ ok: true, job: serializeJob(job) });
  });

  app.get('/jobs', (c) => {
    const sessionId = c.req.query('sessionId');
    const status = c.req.query('status');
    let includeSecret = false;
    let jobs: RuntimeJob[];
    if (hasAdmin(c, state)) {
      jobs = sessionId ? state.listJobsForSession(sessionId) : [...state.jobs.values()];
    } else {
      if (!sessionId) {
        throw new ServiceHttpError('ADMIN_AUTH_REQUIRED', 'Admin token is required for job queries without sessionId', 401);
      }
      includeSecret = true;
      jobs = state
        .listJobsForSession(sessionId)
        .filter((job) => job.status === 'pending' || job.status === 'running');
    }
    if (status) jobs = jobs.filter((job) => job.status === status);
    return c.json({ ok: true, jobs: jobs.map((job) => serializeJob(job, { includeSecret })) });
  });

  app.get('/jobs/:jobId', (c) => {
    requireAdmin(c, state);
    const job = state.getJob(c.req.param('jobId'));
    return c.json({ ok: true, job: serializeJob(job) });
  });

  app.post('/jobs/:jobId/progress', async (c) => {
    requireJobAccess(c, state, c.req.param('jobId'));
    const progress = jobProgressSchema.parse(await c.req.json());
    const job = state.addProgress(c.req.param('jobId'), progress);
    return c.json({ ok: true, job: serializeJob(job) });
  });

  app.post('/jobs/:jobId/artifacts', async (c) => {
    const jobId = c.req.param('jobId');
    const job = requireJobAccess(c, state, jobId);
    state.assertActiveJob(jobId, 'add artifacts');
    if (!job.runId) throw new Error(`Job has no run: ${jobId}`);
    const payload = artifactUploadSchema.parse(await c.req.json());
    if (!payload.mediaType) {
      return c.json({ ok: false, error: { code: 'MEDIA_TYPE_REQUIRED', message: 'Artifact mediaType is required' } }, 400);
    }
    if (!ALLOWED_MEDIA_TYPES.has(payload.mediaType)) {
      return c.json({ ok: false, error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: `Unsupported media type: ${payload.mediaType}` } }, 400);
    }
    const buffer = Buffer.from(payload.dataBase64, 'base64');
    if (buffer.length > MAX_ARTIFACT_BYTES) {
      return c.json({ ok: false, error: { code: 'ARTIFACT_TOO_LARGE', message: `Artifact exceeds ${MAX_ARTIFACT_BYTES} bytes` } }, 413);
    }
    const artifactId = payload.artifactId || createId('art');
    const relativePath = chooseArtifactPath(payload.path, payload.fileName, payload.mediaType, artifactId, payload.kind);
    const artifactInput = {
      artifactId,
      kind: payload.kind,
      ...(payload.mediaType ? { mediaType: payload.mediaType } : {}),
      ...(payload.sourceNodeId ? { sourceNodeId: payload.sourceNodeId } : {}),
      ...(payload.sourcePageId ? { sourcePageId: payload.sourcePageId } : {}),
    };
    const ref = state.store.writeRunBuffer(job.runId, relativePath, buffer, compactArtifact(artifactInput));
    state.addArtifact(jobId, ref);
    return c.json({ ok: true, artifact: ref });
  });

  app.post('/jobs/:jobId/result', async (c) => {
    const jobId = c.req.param('jobId');
    const job = requireJobAccess(c, state, jobId);
    state.assertActiveJob(jobId, 'finish');
    if (!job.runId) throw new Error(`Job has no run: ${jobId}`);
    const payload = jobResultSchema.parse(await c.req.json());
    if (!payload.ok) {
      state.store.updateRun(job.runId, { status: payload.error.recoverable ? 'blocked' : 'failed' });
      const failed = state.failJob(jobId, payload.error);
      return c.json({ ok: true, job: serializeJob(failed), runId: job.runId });
    }
    const extraction = attachArtifactPaths(payload.result, job.artifactRefs);
    const parsed = rawExtractionSchema.parse(extraction);
    state.store.writeRunJson(job.runId, 'extraction.raw.json', parsed, {
      kind: 'raw-extraction',
      mediaType: 'application/json',
    });
    state.store.updateRun(job.runId, { status: 'completed' });
    const completed = state.completeJob(jobId, { runId: job.runId, extraction: parsed });
    return c.json({ ok: true, job: serializeJob(completed), runId: job.runId });
  });

  app.post('/jobs/:jobId/cancel', (c) => {
    requireAdmin(c, state);
    const job = state.cancelJob(c.req.param('jobId'));
    if (job.runId) state.store.updateRun(job.runId, { status: 'blocked' });
    return c.json({ ok: true, job: serializeJob(job) });
  });

  return app;
}

function createEventStream(state: RuntimeState, sessionId: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let cleanup: (() => void) | undefined;
  let closed = false;
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined;

  const safeSend = (event: string, data: unknown) => {
    if (closed || !controllerRef) return;
    try {
      controllerRef.enqueue(encoder.encode(formatSse(event, data)));
    } catch (_error) {
      closed = true;
      cleanup?.();
    }
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      const subscriber = {
        id: createId('sse'),
        send(event: RuntimeEvent) {
          safeSend(event.type, event);
        },
      };
      const unsubscribe = state.subscribe(sessionId, subscriber);
      safeSend('ready', { ok: true, sessionId });
      const interval = setInterval(() => {
        safeSend('ping', { type: 'ping', time: new Date().toISOString() });
      }, 15000);
      cleanup = () => {
        clearInterval(interval);
        unsubscribe();
      };
    },
    cancel() {
      closed = true;
      cleanup?.();
    },
  });
}

function formatSse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

class ServiceHttpError extends Error {
  readonly code: string;
  readonly status: 401 | 403;

  constructor(code: string, message: string, status: 401 | 403) {
    super(message);
    this.name = 'ServiceHttpError';
    this.code = code;
    this.status = status;
  }
}

function requireAdmin(c: Context, state: RuntimeState): void {
  const token = c.req.header(ADMIN_TOKEN_HEADER);
  if (!token) throw new ServiceHttpError('ADMIN_AUTH_REQUIRED', 'Admin token is required', 401);
  if (!constantTimeEqual(token, state.adminToken)) {
    throw new ServiceHttpError('ADMIN_AUTH_INVALID', 'Admin token is invalid', 403);
  }
}

function hasAdmin(c: Context, state: RuntimeState): boolean {
  const token = c.req.header(ADMIN_TOKEN_HEADER);
  if (!token) return false;
  if (!constantTimeEqual(token, state.adminToken)) {
    throw new ServiceHttpError('ADMIN_AUTH_INVALID', 'Admin token is invalid', 403);
  }
  return true;
}

function requireJobAccess(c: Context, state: RuntimeState, jobId: string): RuntimeJob {
  const sessionId = c.req.header(PLUGIN_SESSION_HEADER);
  const jobSecret = c.req.header(JOB_SECRET_HEADER);
  if (!sessionId || !jobSecret) {
    throw new ServiceHttpError('JOB_SECRET_REQUIRED', 'Plugin session id and job secret are required', 401);
  }
  const job = state.getJob(jobId);
  if (job.sessionId !== sessionId || !constantTimeEqual(jobSecret, job.jobSecret)) {
    throw new ServiceHttpError('JOB_SECRET_INVALID', 'Job owner or secret is invalid', 403);
  }
  return job;
}

function constantTimeEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

function serializeJob(job: RuntimeJob, options: { includeSecret?: boolean } = {}): Omit<RuntimeJob, 'jobSecret'> | RuntimeJob {
  if (options.includeSecret) return job;
  const { jobSecret: _jobSecret, ...safeJob } = job;
  return safeJob;
}

function errorStatus(error: unknown): 400 | 401 | 403 | 404 | 409 | 500 {
  if (error instanceof z.ZodError) return 400;
  if (error instanceof ServiceHttpError) return error.status;
  if (error instanceof RuntimeStateError) {
    if (error.status === 404) return 404;
    if (error.status === 409) return 409;
  }
  return 500;
}

function normalizeError(error: unknown): { code: string; message: string; details?: unknown } {
  if (error instanceof z.ZodError) {
    return { code: 'VALIDATION_ERROR', message: 'Invalid request payload', details: error.issues };
  }
  if (error instanceof ServiceHttpError || error instanceof RuntimeStateError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof Error) return { code: 'INTERNAL_ERROR', message: error.message };
  return { code: 'INTERNAL_ERROR', message: String(error) };
}

function chooseArtifactPath(inputPath: string | undefined, fileName: string | undefined, mediaType: string | undefined, artifactId: string, kind: string): string {
  if (inputPath) return inputPath.replace(/^\/+/, '');
  const extension = inferExtension(mediaType, path.extname(fileName || '').replace(/^\./, '') || 'bin');
  const safeName = sanitizeFileName(fileName || `${artifactId}.${extension}`);
  const directory = kind === 'screenshot' ? 'screenshots' : kind === 'asset' ? 'assets' : 'uploads';
  return `${directory}/${artifactId}-${safeName}`;
}

function compactArtifact(input: {
  artifactId: string;
  kind: ArtifactRef['kind'];
  mediaType?: string;
  sourceNodeId?: string;
  sourcePageId?: string;
}): Omit<ArtifactRef, 'path' | 'contentHash'> {
  const ref: Record<string, unknown> = { artifactId: input.artifactId, kind: input.kind };
  if (input.mediaType !== undefined) ref.mediaType = input.mediaType;
  if (input.sourceNodeId !== undefined) ref.sourceNodeId = input.sourceNodeId;
  if (input.sourcePageId !== undefined) ref.sourcePageId = input.sourcePageId;
  return ref as Omit<ArtifactRef, 'path' | 'contentHash'>;
}

function attachArtifactPaths(extraction: RawExtraction, refs: ArtifactRef[]): RawExtraction {
  const byId = new Map(refs.map((ref) => [ref.artifactId, ref]));
  const screenshots = extraction.screenshots.map((shot) => {
    const ref = byId.get(shot.artifactId);
    return {
      ...shot,
      ...(ref?.path ? { path: ref.path } : {}),
      ...(ref?.mediaType ? { mediaType: ref.mediaType } : {}),
    };
  });
  const assets = extraction.assets.map((asset) => {
    const artifactId = asset.artifactId;
    const fallbackArtifactId = asset.fallbackArtifactId;
    const ref = artifactId ? byId.get(artifactId) : undefined;
    const fallbackRef = fallbackArtifactId ? byId.get(fallbackArtifactId) : undefined;
    return {
      ...asset,
      ...(ref?.path ? { path: ref.path } : {}),
      ...(ref?.mediaType ? { mediaType: ref.mediaType } : {}),
      ...(fallbackRef?.path ? { fallbackPath: fallbackRef.path } : {}),
      ...(fallbackRef?.mediaType ? { fallbackMediaType: fallbackRef.mediaType } : {}),
    };
  });
  return { ...extraction, screenshots, assets };
}
