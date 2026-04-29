import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { serviceLockPath } from '../dist/paths.js';
import { stopRuntimeService } from '../dist/service/control.js';
import { writeServiceLock } from '../dist/service/lockfile.js';

function makeTempProject(prefix = 'frr-control-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeLock(projectRoot, patch = {}) {
  return {
    service: 'figma-react-restore',
    version: '0.1.0',
    pid: 2147483647,
    port: 9,
    url: 'http://127.0.0.1:9',
    startedAt: new Date().toISOString(),
    workspaceRoot: projectRoot,
    artifactRoot: path.join(projectRoot, '.figma-react-restore'),
    ...patch,
  };
}

test('stopRuntimeService is a no-op when no service lock exists', async () => {
  const projectRoot = makeTempProject();
  const result = await stopRuntimeService({ projectRoot, timeoutMs: 25 });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'not-running');
});

test('stopRuntimeService removes stale lock for a dead service pid', async () => {
  const projectRoot = makeTempProject();
  writeServiceLock(makeLock(projectRoot));

  const result = await stopRuntimeService({ projectRoot, timeoutMs: 25 });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'stale-lock-removed');
  assert.equal(fs.existsSync(serviceLockPath(projectRoot)), false);
});

test('stopRuntimeService refuses to kill an alive pid without service health proof', async () => {
  const projectRoot = makeTempProject();
  writeServiceLock(makeLock(projectRoot, { pid: process.pid }));

  const result = await stopRuntimeService({ projectRoot, timeoutMs: 25 });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'refused-unverified');
  assert.equal(fs.existsSync(serviceLockPath(projectRoot)), true);
});
