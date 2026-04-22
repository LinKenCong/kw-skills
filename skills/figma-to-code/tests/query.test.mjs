import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { handleQuery } from '../scripts/query.mjs';

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function createLegacyCacheFixture() {
  const dir = makeTempDir('figma-to-code-legacy-');
  writeJson(path.join(dir, 'extraction.json'), {
    version: 2,
    meta: {
      fileKey: 'demo-file',
      nodeId: '1:2',
      nodeName: 'Homepage',
      nodeType: 'FRAME',
    },
    variables: {
      flat: {
        colors: {
          '--color-primary': '#ff0000',
        },
        numbers: {
          '--spacing-lg': 24,
        },
        strings: {
          '--font-family-body': 'Inter',
        },
        booleans: {
          '--feature-enabled': true,
        },
      },
    },
    css: {
      available: false,
      reason: 'No css hints captured in legacy fixture',
    },
    root: {
      id: '1:2',
      name: 'Homepage',
      type: 'FRAME',
      visible: true,
      box: {
        x: 0,
        y: 0,
        width: 1440,
        height: 900,
      },
      children: [
        {
          id: '10:1',
          name: 'Hero',
          type: 'FRAME',
          visible: true,
          box: { x: 0, y: 0, width: 1440, height: 560 },
          children: [
            {
              id: '10:2',
              name: 'Hero title',
              type: 'TEXT',
              visible: true,
              box: { x: 80, y: 72, width: 480, height: 80 },
              text: {
                characters: 'Build AI products faster',
                fontName: { family: 'Inter', style: 'Bold', weight: 700 },
                fontSize: 48,
                fills: [{ type: 'SOLID', visible: true, color: { hex: '#111111' } }],
                segments: [
                  {
                    characters: 'Build AI products faster',
                    fontName: { family: 'Inter', style: 'Bold', weight: 700 },
                    fontSize: 48,
                    fills: [{ type: 'SOLID', visible: true, color: { hex: '#111111' } }],
                  },
                ],
              },
            },
            {
              id: '10:3',
              name: 'Primary CTA',
              type: 'INSTANCE',
              visible: true,
              box: { x: 80, y: 220, width: 180, height: 48 },
              component: {
                mainComponent: { id: '300:1', name: 'Button/Primary', key: 'button-primary' },
                properties: {
                  label: { type: 'TEXT', value: 'Get started' },
                },
                variantProperties: {
                  Size: 'Large',
                },
              },
            },
          ],
        },
      ],
    },
  });
  return dir;
}

function createBundleCacheFixture() {
  const dir = makeTempDir('figma-to-code-bundle-');
  writeJson(path.join(dir, 'bundle.json'), {
    schemaVersion: 1,
    kind: 'figma-bundle',
    bundleId: 'bundle-demo',
    bundleName: 'Selected pages bundle',
    createdAt: '2026-04-22T10:00:00.000Z',
    pages: ['pg-home', 'pg-pricing'],
  });

  writeJson(path.join(dir, 'indexes', 'pages.json'), {
    pages: [
      {
        pageId: 'pg-home',
        pageName: 'Home',
        path: 'pages/pg-home/page.json',
        nodeCount: 12,
        selectionCount: 2,
        screenshotCount: 3,
      },
      {
        pageId: 'pg-pricing',
        pageName: 'Pricing',
        path: 'pages/pg-pricing/page.json',
        nodeCount: 9,
        selectionCount: 1,
        screenshotCount: 1,
      },
    ],
  });

  writeJson(path.join(dir, 'indexes', 'screenshots.json'), {
    screenshots: [
      {
        screenshotId: 'shot-home-page',
        pageId: 'pg-home',
        pageName: 'Home',
        kind: 'page',
        nodeId: 'pg-home',
        filePath: 'pages/pg-home/screenshots/page.png',
      },
      {
        screenshotId: 'shot-home-node-hero',
        pageId: 'pg-home',
        pageName: 'Home',
        kind: 'node',
        nodeId: '10:1',
        filePath: 'pages/pg-home/nodes/10-1/screenshot.png',
      },
      {
        screenshotId: 'shot-home-node',
        pageId: 'pg-home',
        pageName: 'Home',
        kind: 'node',
        nodeId: '10:3',
        filePath: 'pages/pg-home/nodes/10-3/screenshot.png',
      },
      {
        screenshotId: 'shot-pricing-page',
        pageId: 'pg-pricing',
        pageName: 'Pricing',
        kind: 'page',
        nodeId: 'pg-pricing',
        filePath: 'pages/pg-pricing/screenshots/page.png',
      },
    ],
  });

  writeJson(path.join(dir, 'indexes', 'regions.json'), {
    regions: [
      {
        regionId: 'region-home-hero',
        pageId: 'pg-home',
        pageName: 'Home',
        level: 1,
        name: 'Hero',
        nodeId: '10:1',
        x: 0,
        y: 0,
        w: 1440,
        h: 560,
      },
      {
        regionId: 'region-home-hero-copy',
        pageId: 'pg-home',
        pageName: 'Home',
        level: 2,
        name: 'Hero Copy',
        nodeId: '10:2',
        x: 80,
        y: 72,
        w: 480,
        h: 80,
      },
      {
        regionId: 'region-pricing-table',
        pageId: 'pg-pricing',
        pageName: 'Pricing',
        level: 1,
        name: 'Pricing Table',
        nodeId: '20:1',
        x: 40,
        y: 120,
        w: 1360,
        h: 640,
      },
    ],
  });

  writeJson(path.join(dir, 'pages', 'pg-home', 'page.json'), {
    pageId: 'pg-home',
    pageName: 'Home',
    nodeCount: 12,
    selectionCount: 2,
  });

  writeJson(path.join(dir, 'pages', 'pg-home', 'regions.level1.json'), {
    regions: [
      {
        regionId: 'region-home-hero',
        pageId: 'pg-home',
        level: 1,
        name: 'Hero',
      },
    ],
  });

  writeJson(path.join(dir, 'pages', 'pg-home', 'regions.level2.json'), {
    regions: [
      {
        regionId: 'region-home-hero-copy',
        pageId: 'pg-home',
        level: 2,
        name: 'Hero Copy',
      },
    ],
  });

  writeJson(path.join(dir, 'pages', 'pg-pricing', 'page.json'), {
    pageId: 'pg-pricing',
    pageName: 'Pricing',
    nodeCount: 9,
    selectionCount: 1,
  });

  return dir;
}

function createBundleCacheFixtureWithSanitizedPageId() {
  const dir = makeTempDir('figma-to-code-bundle-sanitized-');
  writeJson(path.join(dir, 'bundle.json'), {
    schemaVersion: 1,
    kind: 'figma-bundle',
    bundleId: 'bundle-sanitized-page-id',
    bundleName: 'Sanitized page id bundle',
    createdAt: '2026-04-22T10:00:00.000Z',
    pages: ['12:34'],
  });

  writeJson(path.join(dir, 'indexes', 'pages.json'), {
    pages: [
      {
        pageId: '12:34',
        pageName: 'Marketing',
        path: 'pages/12-34/page.json',
        nodeCount: 4,
        selectionCount: 1,
        screenshotCount: 1,
      },
    ],
  });

  writeJson(path.join(dir, 'pages', '12-34', 'page.json'), {
    pageId: '12:34',
    pageName: 'Marketing',
    nodeCount: 4,
    selectionCount: 1,
  });

  writeJson(path.join(dir, 'pages', '12-34', 'extraction.json'), {
    version: 2,
    meta: {
      fileKey: 'demo-file',
      nodeId: '12:34',
      pageId: '12:34',
      pageName: 'Marketing',
      nodeName: 'Marketing root',
      nodeType: 'FRAME',
    },
    root: {
      id: '12:34',
      name: 'Marketing root',
      type: 'FRAME',
      visible: true,
      box: { x: 0, y: 0, width: 1440, height: 900 },
      children: [
        {
          id: '88:1',
          name: 'Promo Card',
          type: 'INSTANCE',
          visible: true,
          box: { x: 120, y: 160, width: 320, height: 180 },
          component: {
            mainComponent: { id: '500:1', name: 'Card/Promo', key: 'card-promo' },
            properties: {
              title: { type: 'TEXT', value: 'Launch faster' },
            },
            variantProperties: {
              Tone: 'Default',
            },
          },
        },
      ],
    },
  });

  return dir;
}

function createBundleIndexOnlyFixture() {
  const dir = makeTempDir('figma-to-code-bundle-index-only-');
  writeJson(path.join(dir, 'bundle.json'), {
    schemaVersion: 1,
    kind: 'figma-bundle',
    bundleId: 'bundle-index-only',
    bundleName: 'Index only bundle',
    createdAt: '2026-04-22T10:00:00.000Z',
    pages: ['pg-home'],
  });

  writeJson(path.join(dir, 'indexes', 'pages.json'), {
    pages: [
      {
        pageId: 'pg-home',
        pageName: 'Home',
        path: 'pages/pg-home/page.json',
        nodeCount: 3,
        selectionCount: 1,
        screenshotCount: 1,
      },
    ],
  });

  writeJson(path.join(dir, 'indexes', 'variables.json'), {
    variables: {
      flat: {
        colors: {
          '--color-brand': '#0055ff',
        },
        numbers: {
          '--space-6': 24,
        },
        strings: {},
        booleans: {},
      },
    },
  });

  writeJson(path.join(dir, 'indexes', 'components.json'), {
    components: [
      {
        pageId: 'pg-home',
        pageName: 'Home',
        nodeId: '88:1',
        nodeName: 'Promo Card',
        type: 'INSTANCE',
        mainComponent: { id: '500:1', name: 'Card/Promo', key: 'card-promo' },
      },
    ],
  });

  writeJson(path.join(dir, 'indexes', 'css.json'), {
    available: false,
    reason: 'No css hints recorded in this bundle cache',
    pages: [
      {
        pageId: 'pg-home',
        pageName: 'Home',
        available: false,
        reason: 'No css hints recorded for this page',
        css: null,
      },
    ],
  });

  return dir;
}

test('query capabilities exposes stable capability registry', async () => {
  const legacyDir = createLegacyCacheFixture();
  const result = await handleQuery(['capabilities', '--cache', legacyDir]);

  assert.equal(result.ok, true);
  assert.ok(Array.isArray(result.capabilities));
  assert.ok(result.capabilities.some((cap) => cap.id === 'extract-selected-pages-bundle'));
  assert.ok(result.capabilities.some((cap) => cap.id === 'query.regions'));
});

test('query pages reads bundle cache page index', async () => {
  const bundleDir = createBundleCacheFixture();
  const result = await handleQuery(['pages', '--cache', bundleDir]);

  assert.equal(result.ok, true);
  assert.equal(result.bundleId, 'bundle-demo');
  assert.equal(result.pages.length, 2);
  assert.deepEqual(result.pages.map((page) => page.pageName), ['Home', 'Pricing']);
});

test('query screenshots can filter by page', async () => {
  const bundleDir = createBundleCacheFixture();
  const result = await handleQuery(['screenshots', '--cache', bundleDir, '--page', 'Home']);

  assert.equal(result.ok, true);
  assert.equal(result.screenshots.length, 3);
  assert.ok(result.screenshots.every((shot) => shot.pageName === 'Home'));
  assert.ok(result.screenshots.some((shot) => shot.filePath === 'pages/pg-home/nodes/10-1/screenshot.png'));
  assert.ok(result.screenshots.some((shot) => shot.filePath === 'pages/pg-home/nodes/10-3/screenshot.png'));
});

test('query regions can filter by level and page', async () => {
  const bundleDir = createBundleCacheFixture();
  const result = await handleQuery(['regions', '--cache', bundleDir, '--page', 'pg-home', '--level', '2']);

  assert.equal(result.ok, true);
  assert.equal(result.regions.length, 1);
  assert.equal(result.regions[0].name, 'Hero Copy');
  assert.equal(result.regions[0].level, 2);
});

test('query variables and components work on legacy extraction cache', async () => {
  const legacyDir = createLegacyCacheFixture();
  const variables = await handleQuery(['variables', '--cache', legacyDir]);
  const components = await handleQuery(['components', '--cache', legacyDir]);
  const css = await handleQuery(['css', '--cache', legacyDir]);

  assert.equal(variables.ok, true);
  assert.equal(variables.variables.flat.colors['--color-primary'], '#ff0000');

  assert.equal(components.ok, true);
  assert.equal(components.components.length, 1);
  assert.equal(components.components[0].mainComponent.name, 'Button/Primary');

  assert.equal(css.ok, true);
  assert.equal(css.available, false);
  assert.match(css.reason, /No css hints/i);
});

test('bundle queries read extraction files from sanitized page directories', async () => {
  const bundleDir = createBundleCacheFixtureWithSanitizedPageId();
  const result = await handleQuery(['components', '--cache', bundleDir]);

  assert.equal(result.ok, true);
  assert.equal(result.components.length, 1);
  assert.equal(result.components[0].pageId, '12:34');
  assert.equal(result.components[0].mainComponent.name, 'Card/Promo');
});

test('bundle variable query prefers prebuilt index files when page extraction files are absent', async () => {
  const bundleDir = createBundleIndexOnlyFixture();
  const result = await handleQuery(['variables', '--cache', bundleDir]);

  assert.equal(result.ok, true);
  assert.equal(result.cacheKind, 'bundle');
  assert.equal(result.variables.flat.colors['--color-brand'], '#0055ff');
});

test('bundle components query prefers prebuilt index files when page extraction files are absent', async () => {
  const bundleDir = createBundleIndexOnlyFixture();
  const result = await handleQuery(['components', '--cache', bundleDir]);

  assert.equal(result.ok, true);
  assert.equal(result.cacheKind, 'bundle');
  assert.equal(result.components.length, 1);
  assert.equal(result.components[0].mainComponent.name, 'Card/Promo');
});

test('bundle css query prefers prebuilt index files when page extraction files are absent', async () => {
  const bundleDir = createBundleIndexOnlyFixture();
  const result = await handleQuery(['css', '--cache', bundleDir]);

  assert.equal(result.ok, true);
  assert.equal(result.cacheKind, 'bundle');
  assert.equal(result.available, false);
  assert.equal(result.pages.length, 1);
  assert.match(result.reason, /No css hints/i);
});

test('legacy tree query remains backward compatible', async () => {
  const legacyDir = createLegacyCacheFixture();
  const result = await handleQuery(['tree', '--cache', legacyDir]);

  assert.equal(result.ok, true);
  assert.equal(result.frames.length, 1);
  assert.equal(result.frames[0].name, 'Hero');
});
