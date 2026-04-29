import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ArtifactStore } from '../dist/artifact/store.js';
import { createRuntimeApp } from '../dist/service/http.js';
import { RuntimeState } from '../dist/service/state.js';

function makeApp() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'frr-service-'));
  const store = new ArtifactStore({ workspaceRoot });
  const state = new RuntimeState({ store });
  return { app: createRuntimeApp(state), state, store };
}

async function json(response) {
  return response.json();
}

function headers() {
  return { 'content-type': 'application/json' };
}

async function register(app) {
  return json(await app.request('/sessions/register', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ pluginSessionId: 'ps_1', fileName: 'File', currentPageId: '1', currentPageName: 'Page', selectionCount: 1, capabilities: ['extract.selection'] }),
  }));
}

async function createJob(app) {
  return json(await app.request('/jobs', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ capability: 'extract.selection', sessionId: 'ps_1', options: { screenshots: true } }),
  }));
}

test('service health and sessions are available for local plugin automation', async () => {
  const { app, store } = makeApp();
  const health = await json(await app.request('/health'));
  assert.equal(health.ok, true);
  assert.equal(health.service, 'figma-react-restore');
  assert.equal(health.pid, process.pid);
  assert.equal(health.workspaceRoot, store.workspaceRoot);
  assert.equal(health.artifactRoot, store.artifactRoot);
  const sessions = await json(await app.request('/sessions'));
  assert.equal(sessions.ok, true);
  assert.deepEqual(sessions.sessions, []);
});

test('service answers CORS preflight for plugin requests', async () => {
  const { app } = makeApp();
  const response = await app.request('/sessions/register', {
    method: 'OPTIONS',
    headers: {
      origin: 'null',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type',
    },
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.match(response.headers.get('access-control-allow-headers') || '', /content-type/);
});

test('service rejects job create without a plugin session', async () => {
  const { app } = makeApp();
  const response = await app.request('/jobs', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ capability: 'extract.selection', options: {} }),
  });
  assert.equal(response.status, 500);
  const data = await json(response);
  assert.equal(data.ok, false);
  assert.match(data.error.message, /No Figma plugin session/);
});

test('service registers session and creates extract job', async () => {
  const { app } = makeApp();
  const registered = await register(app);
  assert.equal(registered.ok, true);

  const create = await createJob(app);
  assert.equal(create.ok, true);
  assert.match(create.job.jobId, /^job_/);
  assert.match(create.job.runId, /^run_/);
});

test('service ignores stale plugin sessions when choosing a session', async () => {
  const { app, state } = makeApp();
  await register(app);
  const stale = state.sessions.get('ps_1');
  state.sessions.set('ps_1', { ...stale, lastSeenAt: new Date(Date.now() - 60_000).toISOString() });

  const response = await app.request('/jobs', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ capability: 'extract.selection', options: {} }),
  });
  assert.equal(response.status, 500);
  const data = await json(response);
  assert.match(data.error.message, /No Figma plugin session/);
  assert.equal(state.sessions.get('ps_1').connected, false);
});

test('service opens event stream after session registration', async () => {
  const { app } = makeApp();
  await register(app);
  const response = await app.request('/events?sessionId=ps_1');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /text\/event-stream/);
  const reader = response.body.getReader();
  const first = await reader.read();
  await reader.cancel();
  const text = new TextDecoder().decode(first.value);
  assert.match(text, /event: ready/);
});

test('service lists pending jobs for polling fallback', async () => {
  const { app } = makeApp();
  await register(app);
  const create = await createJob(app);
  const response = await app.request('/jobs?sessionId=ps_1&status=pending');
  const data = await json(response);
  assert.equal(data.ok, true);
  assert.equal(data.jobs.length, 1);
  assert.equal(data.jobs[0].jobId, create.job.jobId);
});

test('service accepts progress, artifact upload, and final extraction result', async () => {
  const { app, store } = makeApp();
  await register(app);
  const create = await createJob(app);
  const jobId = create.job.jobId;

  const progress = await json(await app.request(`/jobs/${jobId}/progress`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ stage: 'screenshot', progress: 0.5 }),
  }));
  assert.equal(progress.job.status, 'running');

  const artifact = await json(await app.request(`/jobs/${jobId}/artifacts`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ artifactId: 'shot_1', kind: 'screenshot', fileName: 'base.png', mediaType: 'image/png', dataBase64: Buffer.from('fake-png').toString('base64') }),
  }));
  assert.equal(artifact.ok, true);
  assert.equal(artifact.artifact.kind, 'screenshot');

  const result = await json(await app.request(`/jobs/${jobId}/result`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      ok: true,
      result: {
        schemaVersion: 1,
        meta: { pageId: '1', pageName: 'Page', selectedNodeCount: 1, extractedAt: new Date().toISOString() },
        root: { id: '1:1', name: 'Frame', type: 'FRAME', absoluteBoundingBox: { x: 0, y: 0, w: 100, h: 100 } },
        regions: [],
        screenshots: [{ artifactId: 'shot_1', nodeId: '1:1', mediaType: 'image/png' }],
        assets: [],
        warnings: [],
      },
    }),
  }));
  assert.equal(result.ok, true);
  assert.equal(result.job.status, 'completed');
  const run = store.readRun(result.runId);
  assert.equal(run.status, 'completed');
  assert.ok(run.artifactRefs.some((ref) => ref.kind === 'raw-extraction'));
});

test('service attaches primary and fallback asset paths', async () => {
  const { app, store } = makeApp();
  await register(app);
  const create = await createJob(app);
  const jobId = create.job.jobId;

  await json(await app.request(`/jobs/${jobId}/artifacts`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ artifactId: 'asset_svg', kind: 'asset', fileName: 'icon.svg', mediaType: 'image/svg+xml', dataBase64: Buffer.from('<svg/>').toString('base64') }),
  }));
  await json(await app.request(`/jobs/${jobId}/artifacts`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ artifactId: 'asset_png', kind: 'asset', fileName: 'icon.png', mediaType: 'image/png', dataBase64: Buffer.from('fake-png').toString('base64') }),
  }));

  const result = await json(await app.request(`/jobs/${jobId}/result`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      ok: true,
      result: {
        schemaVersion: 1,
        meta: { selectedNodeCount: 1, extractedAt: new Date().toISOString() },
        screenshots: [],
        assets: [{ artifactId: 'asset_svg', fallbackArtifactId: 'asset_png', nodeId: '1:2', kind: 'svg', preferredFormat: 'svg' }],
        warnings: [],
      },
    }),
  }));
  assert.equal(result.ok, true);
  const extraction = JSON.parse(fs.readFileSync(path.join(store.getRunDir(result.runId), 'extraction.raw.json'), 'utf8'));
  assert.match(extraction.assets[0].path, /icon\.svg$/);
  assert.match(extraction.assets[0].fallbackPath, /icon\.png$/);
});
