import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createId } from '../ids.js';
import {
  ARTIFACT_UPLOAD_BASE64_MAX_LENGTH,
  artifactUploadSchema,
  jobCreateSchema,
  jobProgressSchema,
  jobResultSchema,
  rawExtractionSchema,
  sessionRegisterSchema,
  type ArtifactRef,
  type RawExtraction,
} from '../schema.js';
import { inferExtension, sanitizeFileName, sanitizeSegment } from '../artifact/store.js';
import { type RuntimeEvent, type RuntimeJob, type RuntimeState } from './state.js';
import { SERVICE_VERSION } from './lockfile.js';
import { ServiceHttpError, httpStatusForError, serializeServiceError } from './errors.js';

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
    const status = toResponseStatus(httpStatusForError(error));
    return c.json({ ok: false, error: serializeServiceError(error) }, status);
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
    const payload = sessionRegisterSchema.parse(await parseJson(c));
    const session = state.registerSession(payload);
    return c.json({ ok: true, session });
  });

  app.get('/events', (c) => {
    const sessionId = c.req.query('sessionId');
    if (!sessionId) {
      throw new ServiceHttpError('SESSION_REQUIRED', 'sessionId query param is required', {
        httpStatus: 400,
        recoverable: true,
        hint: 'Pass the plugin session id returned by /sessions/register.',
      });
    }
    if (!state.sessions.has(sessionId)) {
      throw new ServiceHttpError('SESSION_NOT_FOUND', `Unknown session: ${sessionId}`, {
        httpStatus: 404,
        recoverable: true,
        hint: 'Register the plugin session before opening the event stream.',
      });
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
    const payload = jobCreateSchema.parse(await parseJson(c));
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
        throw new ServiceHttpError('ADMIN_AUTH_REQUIRED', 'Admin token is required for job queries without sessionId', {
          httpStatus: 401,
          recoverable: true,
          hint: 'Provide x-frr-admin-token or include sessionId for plugin polling.',
        });
      }
      state.touchSession(sessionId);
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
    const progress = jobProgressSchema.parse(await parseJson(c));
    const job = state.addProgress(c.req.param('jobId'), progress);
    return c.json({ ok: true, job: serializeJob(job) });
  });

  app.post('/jobs/:jobId/artifacts', async (c) => {
    const jobId = c.req.param('jobId');
    const job = requireJobAccess(c, state, jobId);
    state.assertActiveJob(jobId, 'add artifacts');
    if (!job.runId) {
      throw new ServiceHttpError('JOB_RUN_MISSING', `Job has no run: ${jobId}`, {
        httpStatus: 500,
        recoverable: false,
      });
    }
    const rawPayload = await parseJson(c);
    if (rawPayload && typeof rawPayload === 'object' && 'dataBase64' in rawPayload) {
      const dataBase64 = (rawPayload as Record<string, unknown>).dataBase64;
      if (typeof dataBase64 === 'string' && dataBase64.length > ARTIFACT_UPLOAD_BASE64_MAX_LENGTH) {
        throw new ServiceHttpError(
          'UPLOAD_BASE64_TOO_LARGE',
          `Artifact base64 payload exceeds ${ARTIFACT_UPLOAD_BASE64_MAX_LENGTH} characters`,
          {
            httpStatus: 413,
            recoverable: false,
            hint: 'Reduce artifact size or selection scope before retrying extraction.',
            details: { maxBase64Length: ARTIFACT_UPLOAD_BASE64_MAX_LENGTH },
          }
        );
      }
    }
    const payload = artifactUploadSchema.parse(rawPayload);
    if (!payload.mediaType) {
      throw new ServiceHttpError('MEDIA_TYPE_REQUIRED', 'Artifact mediaType is required', {
        httpStatus: 400,
        recoverable: true,
        hint: `Use one of: ${[...ALLOWED_MEDIA_TYPES].sort().join(', ')}`,
      });
    }
    if (!ALLOWED_MEDIA_TYPES.has(payload.mediaType)) {
      throw new ServiceHttpError('UNSUPPORTED_MEDIA_TYPE', `Unsupported media type: ${payload.mediaType}`, {
        httpStatus: 415,
        recoverable: true,
        hint: `Use one of: ${[...ALLOWED_MEDIA_TYPES].sort().join(', ')}`,
      });
    }
    const buffer = Buffer.from(payload.dataBase64, 'base64');
    if (buffer.length > MAX_ARTIFACT_BYTES) {
      throw new ServiceHttpError('ARTIFACT_TOO_LARGE', `Artifact exceeds ${MAX_ARTIFACT_BYTES} bytes`, {
        httpStatus: 413,
        recoverable: false,
        hint: 'Reduce artifact size or selection scope before retrying extraction.',
        details: { maxArtifactBytes: MAX_ARTIFACT_BYTES },
      });
    }
    assertMediaTypeMatches(payload.mediaType, buffer);
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
    if (!job.runId) {
      throw new ServiceHttpError('JOB_RUN_MISSING', `Job has no run: ${jobId}`, {
        httpStatus: 500,
        recoverable: false,
      });
    }
    const payload = jobResultSchema.parse(await parseJson(c));
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
        state.touchSession(sessionId);
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

function requireAdmin(c: Context, state: RuntimeState): void {
  const token = c.req.header(ADMIN_TOKEN_HEADER);
  if (!token) {
    throw new ServiceHttpError('ADMIN_AUTH_REQUIRED', 'Admin token is required', {
      httpStatus: 401,
      recoverable: true,
      hint: 'Read the runtime service lockfile and send x-frr-admin-token.',
    });
  }
  if (!constantTimeEqual(token, state.adminToken)) {
    throw new ServiceHttpError('ADMIN_AUTH_INVALID', 'Admin token is invalid', {
      httpStatus: 403,
      recoverable: false,
      hint: 'Use the token from the current service lockfile.',
    });
  }
}

function hasAdmin(c: Context, state: RuntimeState): boolean {
  const token = c.req.header(ADMIN_TOKEN_HEADER);
  if (!token) return false;
  if (!constantTimeEqual(token, state.adminToken)) {
    throw new ServiceHttpError('ADMIN_AUTH_INVALID', 'Admin token is invalid', {
      httpStatus: 403,
      recoverable: false,
      hint: 'Use the token from the current service lockfile.',
    });
  }
  return true;
}

function requireJobAccess(c: Context, state: RuntimeState, jobId: string): RuntimeJob {
  const sessionId = c.req.header(PLUGIN_SESSION_HEADER);
  const jobSecret = c.req.header(JOB_SECRET_HEADER);
  if (!sessionId || !jobSecret) {
    throw new ServiceHttpError('JOB_SECRET_REQUIRED', 'Plugin session id and job secret are required', {
      httpStatus: 401,
      recoverable: true,
      hint: 'Send x-frr-plugin-session-id and x-frr-job-secret from the job polling response.',
    });
  }
  const job = state.getJob(jobId);
  if (job.sessionId !== sessionId || !constantTimeEqual(jobSecret, job.jobSecret)) {
    throw new ServiceHttpError('JOB_SECRET_INVALID', 'Job owner or secret is invalid', {
      httpStatus: 403,
      recoverable: false,
      hint: 'Only the plugin session that owns the job can mutate it.',
    });
  }
  state.touchSession(sessionId);
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

function chooseArtifactPath(inputPath: string | undefined, fileName: string | undefined, mediaType: string | undefined, artifactId: string, kind: string): string {
  if (inputPath) return inputPath.replace(/^\/+/, '');
  const extension = inferExtension(mediaType, path.extname(fileName || '').replace(/^\./, '') || 'bin');
  const safeName = sanitizeFileName(fileName || `${artifactId}.${extension}`);
  const safeArtifactId = sanitizeSegment(artifactId);
  const directory = kind === 'screenshot' ? 'screenshots' : kind === 'asset' ? 'assets' : 'uploads';
  return `${directory}/${safeArtifactId}-${safeName}`;
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

async function parseJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch (error) {
    throw new ServiceHttpError('INVALID_JSON', 'Request body must be valid JSON', {
      httpStatus: 400,
      recoverable: true,
      hint: 'Send a valid application/json request body.',
      cause: error,
    });
  }
}

function assertMediaTypeMatches(mediaType: string, buffer: Buffer): void {
  const sniffed = sniffMediaType(buffer);
  if (isCompatibleMediaType(mediaType, sniffed)) return;
  throw new ServiceHttpError('MEDIA_TYPE_MISMATCH', `Artifact bytes do not match declared media type: ${mediaType}`, {
    httpStatus: 422,
    recoverable: true,
    hint: sniffed ? `Detected ${sniffed}; declare the detected type or upload matching bytes.` : 'Upload PNG, JPEG, GIF, SVG, JSON, or UTF-8 text bytes.',
    details: { declared: mediaType, detected: sniffed },
  });
}

function sniffMediaType(buffer: Buffer): string | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 6 && (buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a')) {
    return 'image/gif';
  }
  const text = buffer.toString('utf8').trimStart();
  if (text.startsWith('<svg') || (text.startsWith('<?xml') && text.includes('<svg'))) return 'image/svg+xml';
  if (looksLikeJson(text)) return 'application/json';
  if (looksLikeText(buffer)) return 'text/plain';
  return null;
}

function isCompatibleMediaType(declared: string, sniffed: string | null): boolean {
  if (!sniffed) return false;
  if (declared === sniffed) return true;
  if (declared === 'text/plain' && (sniffed === 'application/json' || sniffed === 'image/svg+xml')) return true;
  return false;
}

function looksLikeJson(text: string): boolean {
  if (!text || !['{', '['].includes(text[0] || '')) return false;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function looksLikeText(buffer: Buffer): boolean {
  if (buffer.includes(0)) return false;
  const text = buffer.toString('utf8');
  return !text.includes('\uFFFD');
}

function toResponseStatus(status: number): 400 | 401 | 403 | 404 | 409 | 413 | 415 | 422 | 424 | 500 {
  if (status === 400 || status === 401 || status === 403 || status === 404 || status === 409 || status === 413 || status === 415 || status === 422 || status === 424) {
    return status;
  }
  return 500;
}
