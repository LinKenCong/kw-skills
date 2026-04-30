import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ArtifactStore } from '../dist/artifact/store.js';
import { createRuntimeApp } from '../dist/service/http.js';
import { RuntimeState } from '../dist/service/state.js';

const ADMIN_TOKEN = 'test_admin_token_123456789012345678901234';
const PLUGIN_SESSION_ID = 'ps_1';
const ONE_PIXEL_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/W8kAAAAASUVORK5CYII=';

function makeApp() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'frr-service-'));
  const store = new ArtifactStore({ workspaceRoot });
  const state = new RuntimeState({ store, adminToken: ADMIN_TOKEN });
  return { app: createRuntimeApp(state), state, store };
}

async function json(response) {
  return response.json();
}

function headers(extra = {}) {
  return { 'content-type': 'application/json', ...extra };
}

function adminHeaders(extra = {}) {
  return headers({ 'x-frr-admin-token': ADMIN_TOKEN, ...extra });
}

function jobHeaders(job, extra = {}) {
  return headers({
    'x-frr-plugin-session-id': job.sessionId,
    'x-frr-job-secret': job.jobSecret,
    ...extra,
  });
}

async function register(app) {
  return json(await app.request('/sessions/register', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ pluginSessionId: PLUGIN_SESSION_ID, fileName: 'File', currentPageId: '1', currentPageName: 'Page', selectionCount: 1, capabilities: ['extract.selection'] }),
  }));
}

async function createJob(app) {
  return json(await app.request('/jobs', {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ capability: 'extract.selection', sessionId: PLUGIN_SESSION_ID, options: { screenshots: true } }),
  }));
}

async function pollPendingJob(app) {
  const data = await json(await app.request(`/jobs?sessionId=${PLUGIN_SESSION_ID}&status=pending`));
  assert.equal(data.ok, true);
  assert.equal(data.jobs.length, 1);
  return data.jobs[0];
}

function validExtraction(overrides = {}) {
  return {
    schemaVersion: 1,
    meta: { pageId: '1', pageName: 'Page', selectedNodeCount: 1, extractedAt: new Date().toISOString() },
    root: { id: '1:1', name: 'Frame', type: 'FRAME', absoluteBoundingBox: { x: 0, y: 0, w: 100, h: 100 } },
    regions: [],
    screenshots: [],
    assets: [],
    warnings: [],
    ...overrides,
  };
}

test('service health is minimal by default and detailed with admin token', async () => {
  const { app, store } = makeApp();
  const health = await json(await app.request('/health'));
  assert.equal(health.ok, true);
  assert.equal(health.service, 'figma-react-restore');
  assert.equal(health.pid, undefined);
  assert.equal(health.workspaceRoot, undefined);
  assert.equal(health.artifactRoot, undefined);

  const detailed = await json(await app.request('/health', { headers: { 'x-frr-admin-token': ADMIN_TOKEN } }));
  assert.equal(detailed.ok, true);
  assert.equal(detailed.pid, process.pid);
  assert.equal(detailed.workspaceRoot, store.workspaceRoot);
  assert.equal(detailed.artifactRoot, store.artifactRoot);
});

test('admin endpoints require the service lock token', async () => {
  const { app } = makeApp();
  await register(app);

  const missing = await app.request('/sessions');
  assert.equal(missing.status, 401);
  assert.equal((await json(missing)).error.code, 'ADMIN_AUTH_REQUIRED');

  const invalid = await app.request('/jobs', {
    method: 'POST',
    headers: headers({ 'x-frr-admin-token': 'wrong_admin_token_12345678901234567890123' }),
    body: JSON.stringify({ capability: 'extract.selection', sessionId: PLUGIN_SESSION_ID, options: {} }),
  });
  assert.equal(invalid.status, 403);
  assert.equal((await json(invalid)).error.code, 'ADMIN_AUTH_INVALID');

  const sessions = await json(await app.request('/sessions', { headers: { 'x-frr-admin-token': ADMIN_TOKEN } }));
  assert.equal(sessions.ok, true);
  assert.equal(sessions.sessions.length, 1);
});

test('service answers restricted CORS preflight for plugin requests', async () => {
  const { app } = makeApp();
  const response = await app.request('/sessions/register', {
    method: 'OPTIONS',
    headers: {
      origin: 'null',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type,x-frr-job-secret,x-frr-plugin-session-id',
    },
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), 'null');
  assert.notEqual(response.headers.get('access-control-allow-origin'), '*');
  assert.match(response.headers.get('access-control-allow-headers') || '', /x-frr-job-secret/);

  const denied = await app.request('/sessions/register', {
    method: 'OPTIONS',
    headers: { origin: 'https://example.com', 'access-control-request-method': 'POST' },
  });
  assert.equal(denied.status, 403);
});

test('service rejects job create without a plugin session', async () => {
  const { app } = makeApp();
  const response = await app.request('/jobs', {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ capability: 'extract.selection', options: {} }),
  });
  assert.equal(response.status, 409);
  const data = await json(response);
  assert.equal(data.ok, false);
  assert.equal(data.error.code, 'NO_PLUGIN_SESSION');
});

test('service registers session and creates extract job without leaking job secret to admin response', async () => {
  const { app } = makeApp();
  const registered = await register(app);
  assert.equal(registered.ok, true);

  const create = await createJob(app);
  assert.equal(create.ok, true);
  assert.match(create.job.jobId, /^job_/);
  assert.match(create.job.runId, /^run_/);
  assert.equal(create.job.jobSecret, undefined);
});

test('service ignores stale plugin sessions when choosing a session', async () => {
  const { app, state } = makeApp();
  await register(app);
  const stale = state.sessions.get(PLUGIN_SESSION_ID);
  state.sessions.set(PLUGIN_SESSION_ID, { ...stale, lastSeenAt: new Date(Date.now() - 60_000).toISOString() });

  const response = await app.request('/jobs', {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ capability: 'extract.selection', options: {} }),
  });
  assert.equal(response.status, 409);
  const data = await json(response);
  assert.match(data.error.message, /No Figma plugin session/);
  assert.equal(state.sessions.get(PLUGIN_SESSION_ID).connected, false);
});

test('service opens event stream after session registration', async () => {
  const { app } = makeApp();
  await register(app);
  const response = await app.request(`/events?sessionId=${PLUGIN_SESSION_ID}`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /text\/event-stream/);
  const reader = response.body.getReader();
  const first = await reader.read();
  await reader.cancel();
  const text = new TextDecoder().decode(first.value);
  assert.match(text, /event: ready/);
});

test('service lists pending jobs with job secret for polling fallback', async () => {
  const { app } = makeApp();
  await register(app);
  const create = await createJob(app);
  const job = await pollPendingJob(app);
  assert.equal(job.jobId, create.job.jobId);
  assert.equal(job.sessionId, PLUGIN_SESSION_ID);
  assert.match(job.jobSecret, /^[A-Za-z0-9_-]{32,}$/);

  const adminList = await json(await app.request('/jobs', { headers: { 'x-frr-admin-token': ADMIN_TOKEN } }));
  assert.equal(adminList.jobs[0].jobSecret, undefined);
});

test('service validates job owner and secret for plugin mutations', async () => {
  const { app } = makeApp();
  await register(app);
  await createJob(app);
  const job = await pollPendingJob(app);

  const missing = await app.request(`/jobs/${job.jobId}/progress`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ stage: 'screenshot', progress: 0.5 }),
  });
  assert.equal(missing.status, 401);

  const wrongOwner = await app.request(`/jobs/${job.jobId}/progress`, {
    method: 'POST',
    headers: jobHeaders({ ...job, sessionId: 'ps_other' }),
    body: JSON.stringify({ stage: 'screenshot', progress: 0.5 }),
  });
  assert.equal(wrongOwner.status, 403);

  const wrongSecret = await app.request(`/jobs/${job.jobId}/progress`, {
    method: 'POST',
    headers: jobHeaders({ ...job, jobSecret: 'wrong_job_secret_123456789012345678901234' }),
    body: JSON.stringify({ stage: 'screenshot', progress: 0.5 }),
  });
  assert.equal(wrongSecret.status, 403);

  const progress = await json(await app.request(`/jobs/${job.jobId}/progress`, {
    method: 'POST',
    headers: jobHeaders(job),
    body: JSON.stringify({ stage: 'screenshot', progress: 0.5 }),
  }));
  assert.equal(progress.job.status, 'running');
  assert.equal(progress.job.jobSecret, undefined);
});

test('service accepts progress, artifact upload, and final extraction result with job secret', async () => {
  const { app, store } = makeApp();
  await register(app);
  await createJob(app);
  const job = await pollPendingJob(app);

  const progress = await json(await app.request(`/jobs/${job.jobId}/progress`, {
    method: 'POST',
    headers: jobHeaders(job),
    body: JSON.stringify({ stage: 'screenshot', progress: 0.5 }),
  }));
  assert.equal(progress.job.status, 'running');

  const artifact = await json(await app.request(`/jobs/${job.jobId}/artifacts`, {
    method: 'POST',
    headers: jobHeaders(job),
    body: JSON.stringify({ artifactId: 'shot_1', kind: 'screenshot', fileName: 'base.png', mediaType: 'image/png', dataBase64: ONE_PIXEL_PNG_BASE64 }),
  }));
  assert.equal(artifact.ok, true);
  assert.equal(artifact.artifact.kind, 'screenshot');

  const result = await json(await app.request(`/jobs/${job.jobId}/result`, {
    method: 'POST',
    headers: jobHeaders(job),
    body: JSON.stringify({
      ok: true,
      result: validExtraction({ screenshots: [{ artifactId: 'shot_1', nodeId: '1:1', mediaType: 'image/png' }] }),
    }),
  }));
  assert.equal(result.ok, true);
  assert.equal(result.job.status, 'completed');
  const run = store.readRun(result.runId);
  assert.equal(run.status, 'completed');
  assert.ok(run.artifactRefs.some((ref) => ref.kind === 'raw-extraction'));
});

test('terminal jobs reject later progress, artifacts, and results', async () => {
  const { app, store } = makeApp();
  await register(app);
  await createJob(app);
  const job = await pollPendingJob(app);

  const cancel = await json(await app.request(`/jobs/${job.jobId}/cancel`, {
    method: 'POST',
    headers: { 'x-frr-admin-token': ADMIN_TOKEN },
  }));
  assert.equal(cancel.job.status, 'canceled');
  assert.equal(store.readRun(job.runId).status, 'blocked');

  const result = await app.request(`/jobs/${job.jobId}/result`, {
    method: 'POST',
    headers: jobHeaders(job),
    body: JSON.stringify({ ok: true, result: validExtraction() }),
  });
  assert.equal(result.status, 409);
  assert.equal((await json(result)).error.code, 'INVALID_JOB_TRANSITION');

  const progress = await app.request(`/jobs/${job.jobId}/progress`, {
    method: 'POST',
    headers: jobHeaders(job),
    body: JSON.stringify({ stage: 'late' }),
  });
  assert.equal(progress.status, 409);

  const artifact = await app.request(`/jobs/${job.jobId}/artifacts`, {
    method: 'POST',
    headers: jobHeaders(job),
    body: JSON.stringify({ artifactId: 'late', kind: 'trace', fileName: 'late.txt', mediaType: 'text/plain', dataBase64: Buffer.from('late').toString('base64') }),
  });
  assert.equal(artifact.status, 409);

  const current = await json(await app.request(`/jobs/${job.jobId}`, { headers: { 'x-frr-admin-token': ADMIN_TOKEN } }));
  assert.equal(current.job.status, 'canceled');
  assert.equal(store.readRun(job.runId).status, 'blocked');
});

test('service attaches primary and fallback asset paths', async () => {
  const { app, store } = makeApp();
  await register(app);
  await createJob(app);
  const job = await pollPendingJob(app);

  await json(await app.request(`/jobs/${job.jobId}/artifacts`, {
    method: 'POST',
    headers: jobHeaders(job),
    body: JSON.stringify({ artifactId: 'asset_svg', kind: 'asset', fileName: 'icon.svg', mediaType: 'image/svg+xml', dataBase64: Buffer.from('<svg/>').toString('base64') }),
  }));
  await json(await app.request(`/jobs/${job.jobId}/artifacts`, {
    method: 'POST',
    headers: jobHeaders(job),
    body: JSON.stringify({ artifactId: 'asset_png', kind: 'asset', fileName: 'icon.png', mediaType: 'image/png', dataBase64: ONE_PIXEL_PNG_BASE64 }),
  }));

  const result = await json(await app.request(`/jobs/${job.jobId}/result`, {
    method: 'POST',
    headers: jobHeaders(job),
    body: JSON.stringify({
      ok: true,
      result: validExtraction({
        meta: { selectedNodeCount: 1, extractedAt: new Date().toISOString() },
        root: undefined,
        assets: [{ artifactId: 'asset_svg', fallbackArtifactId: 'asset_png', nodeId: '1:2', kind: 'svg', preferredFormat: 'svg' }],
      }),
    }),
  }));
  assert.equal(result.ok, true);
  const extraction = JSON.parse(fs.readFileSync(path.join(store.getRunDir(result.runId), 'extraction.raw.json'), 'utf8'));
  assert.match(extraction.assets[0].path, /icon\.svg$/);
  assert.match(extraction.assets[0].fallbackPath, /icon\.png$/);
});
