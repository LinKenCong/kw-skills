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
  const state = new RuntimeState({ token: 'test-token', store });
  return { app: createRuntimeApp(state), state, store };
}

async function json(response) {
  return response.json();
}

test('service health is public and sessions require auth', async () => {
  const { app } = makeApp();
  assert.equal((await json(await app.request('/health'))).ok, true);
  assert.equal((await app.request('/sessions')).status, 401);
});

test('service registers session and creates extract job', async () => {
  const { app } = makeApp();
  const headers = { authorization: 'Bearer test-token', 'content-type': 'application/json' };
  const register = await json(await app.request('/sessions/register', {
    method: 'POST',
    headers,
    body: JSON.stringify({ pluginSessionId: 'ps_1', fileName: 'File', currentPageId: '1', currentPageName: 'Page', selectionCount: 1, capabilities: ['extract.selection'] }),
  }));
  assert.equal(register.ok, true);

  const create = await json(await app.request('/jobs', {
    method: 'POST',
    headers,
    body: JSON.stringify({ capability: 'extract.selection', sessionId: 'ps_1', options: { screenshots: true } }),
  }));
  assert.equal(create.ok, true);
  assert.match(create.job.jobId, /^job_/);
  assert.match(create.job.runId, /^run_/);
});
