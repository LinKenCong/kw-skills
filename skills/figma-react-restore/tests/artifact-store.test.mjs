import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ArtifactStore } from '../dist/artifact/store.js';
import { resolveSafePath } from '../dist/paths.js';

test('artifact store writes runs and artifact refs under artifact root', () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'frr-store-'));
  const store = new ArtifactStore({ workspaceRoot });
  const run = store.createRun('extract', { source: 'test' });
  const ref = store.writeRunBuffer(run.runId, 'screenshots/base.png', Buffer.from('png'), { kind: 'screenshot', mediaType: 'image/png' });
  const saved = store.readRun(run.runId);
  assert.equal(saved.artifactRefs.length, 1);
  assert.equal(saved.artifactRefs[0].artifactId, ref.artifactId);
  assert.ok(fs.existsSync(store.resolveArtifactPath(ref.path)));
});

test('safe path rejects traversal and absolute paths', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'frr-safe-'));
  assert.throws(() => resolveSafePath(base, '../x'));
  assert.throws(() => resolveSafePath(base, '/tmp/x'));
  assert.equal(resolveSafePath(base, 'a/b.json'), path.join(base, 'a/b.json'));
});
