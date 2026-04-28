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
const ALLOWED_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/svg+xml', 'application/json', 'text/plain']);

export function createRuntimeApp(state: RuntimeState): Hono {
  const app = new Hono();

  app.use('*', bodyLimit({ maxSize: MAX_JSON_BODY_BYTES }));
  app.use('*', async (c, next) => {
    if (c.req.path === '/health') return next();
    const auth = c.req.header('authorization') || '';
    const bearer = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '';
    const queryToken = c.req.query('token') || '';
    if (bearer !== state.token && queryToken !== state.token) {
      return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Missing or invalid runtime token' } }, 401);
    }
    return next();
  });

  app.onError((error, c) => {
    const status = error instanceof z.ZodError ? 400 : 500;
    return c.json({ ok: false, error: normalizeError(error) }, status);
  });

  app.get('/health', (c) => c.json({
    ok: true,
    service: 'figma-react-restore',
    version: SERVICE_VERSION,
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
    const encoder = new TextEncoder();
    let cleanup: (() => void) | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const subscriber = {
          id: createId('sse'),
          send(event: RuntimeEvent) {
            controller.enqueue(encoder.encode(formatSse(event.type, event)));
          },
        };
        const unsubscribe = state.subscribe(sessionId, subscriber);
        controller.enqueue(encoder.encode(formatSse('ready', { ok: true, sessionId })));
        const interval = setInterval(() => {
          subscriber.send({ type: 'ping', time: new Date().toISOString() });
        }, 15000);
        cleanup = () => {
          clearInterval(interval);
          unsubscribe();
        };
      },
      cancel() {
        cleanup?.();
      },
    });
    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
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
    if (payload.mediaType && !ALLOWED_MEDIA_TYPES.has(payload.mediaType)) {
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
    const ref = artifactId ? byId.get(artifactId) : undefined;
    return {
      ...asset,
      ...(ref?.path ? { path: ref.path } : {}),
    };
  });
  return { ...extraction, screenshots, assets };
}
