import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  buildExtractOptions,
  buildRequestContext,
  parseFlags,
  resolveWorkspaceCacheRoot,
} from '../scripts/bridge_client.mjs';

test('parseFlags rejects removed selection-union flag', () => {
  const result = parseFlags(['--selection-union']);

  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /removed/i);
});

test('buildExtractOptions keeps node screenshot behavior without selection-union aliasing', () => {
  const options = buildExtractOptions({
    assets: true,
    screenshot: true,
    pageScreenshots: false,
    nodeScreenshots: true,
    pages: '',
  });

  assert.deepEqual(options.exportFormats, ['SVG', 'PNG']);
  assert.equal(options.screenshot, true);
  assert.equal(options.nodeScreenshots, true);
  assert.equal('selectionUnionScreenshot' in options, false);
});

test('buildRequestContext resolves a project-local .figma-to-code cache root', () => {
  const cwd = path.join('/tmp', 'demo-project');
  const context = buildRequestContext(cwd);

  assert.equal(context.workspaceRoot, cwd);
  assert.equal(context.cacheRoot, resolveWorkspaceCacheRoot(cwd));
  assert.equal(context.cacheRoot, path.join(cwd, '.figma-to-code'));
});
