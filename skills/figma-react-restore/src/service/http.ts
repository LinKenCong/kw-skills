import path from 'node:path';
import { Hono } from 'hono';
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
import type { RuntimeEvent, RuntimeState } from './state.js';
import { SERVICE_VERSION } from './lockfile.js';

const MAX_JSON_BODY_BYTES = 35 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 24 * 1024 * 1024;
const ALLOWED_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/svg+xml', 'application/json', 'text/plain']);

export function createRuntimeApp(state: RuntimeState): Hono {
  const app = new Hono();

  app.use('*', async (c, next) => {
    c.header('access-control-allow-origin', '*');
    c.header('access-control-allow-methods', 'GET,POST,OPTIONS');
    c.header('access-control-allow-headers', 'content-type');
    c.header('access-control-max-age', '600');
    if (c.req.method === 'OPTIONS') return c.body(null, 204);
    return next();
  });

  app.use('*', bodyLimit({ maxSize: MAX_JSON_BODY_BYTES }));

  app.onError((error, c) => {
    const status = error instanceof z.ZodError ? 400 : 500;
    return c.json({ ok: false, error: normalizeError(error) }, status);
  });

  app.get('/health', (c) => c.json({
    ok: true,
    service: 'figma-react-restore',
    version: SERVICE_VERSION,
    pid: process.pid,
    workspaceRoot: state.store.workspaceRoot,
    artifactRoot: state.store.artifactRoot,
    pluginConnected: state.listSessions().some((session) => session.connected),
    activeJobs: state.activeJobCount(),
  }));

  app.get('/sessions', (c) => c.json({ ok: true, sessions: state.listSessions() }));

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
    const payload = jobCreateSchema.parse(await c.req.json());
    const job = state.createJob({
      capability: payload.capability,
      options: payload.options,
      ...(payload.sessionId ? { sessionId: payload.sessionId } : {}),
    });
    return c.json({ ok: true, job });
  });

  app.get('/jobs', (c) => {
    const sessionId = c.req.query('sessionId');
    const status = c.req.query('status');
    let jobs = sessionId ? state.listJobsForSession(sessionId) : [...state.jobs.values()];
    if (status) jobs = jobs.filter((job) => job.status === status);
    return c.json({ ok: true, jobs });
  });

  app.get('/jobs/:jobId', (c) => {
    const job = state.getJob(c.req.param('jobId'));
    return c.json({ ok: true, job });
  });

  app.post('/jobs/:jobId/progress', async (c) => {
    const progress = jobProgressSchema.parse(await c.req.json());
    const job = state.addProgress(c.req.param('jobId'), progress);
    return c.json({ ok: true, job });
  });

  app.post('/jobs/:jobId/artifacts', async (c) => {
    const jobId = c.req.param('jobId');
    const job = state.getJob(jobId);
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
    const job = state.getJob(jobId);
    if (!job.runId) throw new Error(`Job has no run: ${jobId}`);
    const payload = jobResultSchema.parse(await c.req.json());
    if (!payload.ok) {
      state.store.updateRun(job.runId, { status: payload.error.recoverable ? 'blocked' : 'failed' });
      const failed = state.failJob(jobId, payload.error);
      return c.json({ ok: true, job: failed, runId: job.runId });
    }
    const extraction = attachArtifactPaths(payload.result, job.artifactRefs);
    const parsed = rawExtractionSchema.parse(extraction);
    state.store.writeRunJson(job.runId, 'extraction.raw.json', parsed, {
      kind: 'raw-extraction',
      mediaType: 'application/json',
    });
    state.store.updateRun(job.runId, { status: 'completed' });
    const completed = state.completeJob(jobId, { runId: job.runId, extraction: parsed });
    return c.json({ ok: true, job: completed, runId: job.runId });
  });

  app.post('/jobs/:jobId/cancel', (c) => {
    const job = state.cancelJob(c.req.param('jobId'));
    if (job.runId) state.store.updateRun(job.runId, { status: 'blocked' });
    return c.json({ ok: true, job });
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

function normalizeError(error: unknown): { code: string; message: string; details?: unknown } {
  if (error instanceof z.ZodError) {
    return { code: 'VALIDATION_ERROR', message: 'Invalid request payload', details: error.issues };
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
