import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { prepareJobOutputDir, writeBase64ToRelativePath } from '../bridge.mjs';

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('writeBase64ToRelativePath rejects paths that escape the cache directory', () => {
  const cacheDir = makeTempDir('figma-to-code-bridge-');
  const escapedPath = path.resolve(cacheDir, '..', 'escaped.txt');

  if (fs.existsSync(escapedPath)) {
    fs.unlinkSync(escapedPath);
  }

  assert.throws(() => {
    writeBase64ToRelativePath(cacheDir, '../escaped.txt', Buffer.from('blocked').toString('base64'));
  }, /relativePath.*cache directory/i);

  assert.equal(fs.existsSync(escapedPath), false);
});

test('writeBase64ToRelativePath allows node-scoped nested relative paths inside cache directory', () => {
  const cacheDir = makeTempDir('figma-to-code-bridge-node-');
  const filePath = writeBase64ToRelativePath(
    cacheDir,
    'nodes/12-34/assets/vectors/icon.svg',
    Buffer.from('<svg></svg>').toString('base64')
  );

  assert.equal(filePath, path.join(cacheDir, 'nodes', '12-34', 'assets', 'vectors', 'icon.svg'));
  assert.equal(fs.existsSync(filePath), true);
  assert.equal(fs.readFileSync(filePath, 'utf8'), '<svg></svg>');
});

test('writeBase64ToRelativePath allows screenshot manifests to reference node screenshot directories', () => {
  const cacheDir = makeTempDir('figma-to-code-bridge-shot-');
  const filePath = writeBase64ToRelativePath(
    cacheDir,
    'pages/12-34/nodes/88-1/screenshot.png',
    Buffer.from('png-bytes').toString('base64')
  );

  assert.equal(filePath, path.join(cacheDir, 'pages', '12-34', 'nodes', '88-1', 'screenshot.png'));
  assert.equal(fs.existsSync(filePath), true);
});

test('prepareJobOutputDir clears stale files only once per job directory', () => {
  const cacheDir = makeTempDir('figma-to-code-bridge-prepare-');
  const staleFile = path.join(cacheDir, 'old.txt');
  const freshFile = path.join(cacheDir, 'new.txt');
  fs.writeFileSync(staleFile, 'stale');

  const job = { preparedBaseDirs: new Set() };
  prepareJobOutputDir(job, cacheDir);

  assert.equal(fs.existsSync(staleFile), false);
  assert.equal(fs.existsSync(cacheDir), true);

  fs.writeFileSync(freshFile, 'fresh');
  prepareJobOutputDir(job, cacheDir);

  assert.equal(fs.existsSync(freshFile), true);
});
