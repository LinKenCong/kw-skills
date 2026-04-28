import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ArtifactStore } from '../dist/artifact/store.js';
import { buildMinimalDesignIr } from '../dist/ir/build.js';

function makeStore() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'frr-ir-'));
  return new ArtifactStore({ workspaceRoot });
}

test('IR builder normalizes Figma absolute boxes to screenshot origin', () => {
  const store = makeStore();
  const run = store.createRun('extract', {});
  store.writeRunJson(run.runId, 'extraction.raw.json', {
    schemaVersion: 1,
    meta: { selectedNodeCount: 1, extractedAt: new Date().toISOString() },
    root: {
      id: '1:1',
      name: 'Frame',
      type: 'FRAME',
      absoluteBoundingBox: { x: 100, y: 200, w: 300, h: 200 },
      children: [{ id: '1:2', name: 'Title', type: 'TEXT', characters: 'Hello', absoluteBoundingBox: { x: 120, y: 230, w: 80, h: 24 } }],
    },
    regions: [],
    screenshots: [{ artifactId: 'shot_1' }],
    assets: [],
    warnings: [],
  }, { kind: 'raw-extraction', mediaType: 'application/json' });
  const ir = buildMinimalDesignIr(run.runId, store);
  assert.deepEqual(ir.regions.find((region) => region.nodeId === '1:1').box, { x: 0, y: 0, w: 300, h: 200 });
  assert.deepEqual(ir.regions.find((region) => region.nodeId === '1:2').box, { x: 20, y: 30, w: 80, h: 24 });
  assert.ok(fs.existsSync(path.join(store.getRunDir(run.runId), 'text-manifest.json')));
});

test('IR builder preserves raw text evidence even when serialized tree is shallow', () => {
  const store = makeStore();
  const run = store.createRun('extract', {});
  store.writeRunJson(run.runId, 'extraction.raw.json', {
    schemaVersion: 1,
    meta: { selectedNodeCount: 1, extractedAt: new Date().toISOString() },
    root: {
      id: '1:1',
      name: 'Frame',
      type: 'FRAME',
      absoluteBoundingBox: { x: 100, y: 200, w: 300, h: 200 },
    },
    texts: [
      { nodeId: '1:deep', name: 'Email', text: 'hello@example.com', box: { x: 120, y: 230, w: 120, h: 18 }, fontSize: 14 },
    ],
    regions: [],
    screenshots: [{ artifactId: 'shot_1' }],
    assets: [],
    warnings: [],
  }, { kind: 'raw-extraction', mediaType: 'application/json' });
  const ir = buildMinimalDesignIr(run.runId, store);
  assert.equal(ir.texts.length, 1);
  assert.equal(ir.texts[0].text, 'hello@example.com');
  assert.deepEqual(ir.texts[0].box, { x: 20, y: 30, w: 120, h: 18 });
  const manifest = JSON.parse(fs.readFileSync(path.join(store.getRunDir(run.runId), 'text-manifest.json'), 'utf8'));
  assert.equal(manifest.textCount, 1);
  assert.equal(manifest.items[0].text, 'hello@example.com');
});

test('IR builder marks screenshot-only evidence as visual-only risk', () => {
  const store = makeStore();
  const run = store.createRun('extract', {});
  store.writeRunJson(run.runId, 'extraction.raw.json', {
    schemaVersion: 1,
    meta: { selectedNodeCount: 1, extractedAt: new Date().toISOString() },
    screenshots: [{ artifactId: 'shot_1' }],
    assets: [],
    warnings: [],
  }, { kind: 'raw-extraction', mediaType: 'application/json' });
  const ir = buildMinimalDesignIr(run.runId, store);
  assert.equal(ir.evidenceLevel, 'L1-visual-only');
  assert.ok(ir.warnings.some((warning) => warning.code === 'VISUAL_ONLY_EVIDENCE'));
});
