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
    allowFullPage: false,
    pages: '',
  });

  assert.deepEqual(options.exportFormats, ['SVG', 'PNG']);
  assert.equal(options.screenshot, true);
  assert.equal(options.nodeScreenshots, true);
  assert.equal(options.allowFullPage, false);
  assert.equal('selectionUnionScreenshot' in options, false);
});

test('parseFlags requires explicit allow-full-page opt-in for extract-pages style calls', () => {
  const result = parseFlags(['--pages', 'Home,Pricing', '--allow-full-page']);

  assert.equal(result.errors.length, 0);
  assert.equal(result.flags.pages, 'Home,Pricing');
  assert.equal(result.flags.allowFullPage, true);
});

test('buildRequestContext resolves a project-local .figma-to-code cache root', () => {
  const cwd = path.join('/tmp', 'demo-project');
  const context = buildRequestContext(cwd);

  assert.equal(context.workspaceRoot, cwd);
  assert.equal(context.cacheRoot, resolveWorkspaceCacheRoot(cwd));
  assert.equal(context.cacheRoot, path.join(cwd, '.figma-to-code'));
});
