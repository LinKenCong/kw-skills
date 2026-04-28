import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAssetUsageFailures, buildRegionFailures, buildTextResults, typographyMismatches } from '../dist/verify/report.js';

const baseSpec = {
  schemaVersion: 1,
  runId: 'run_1',
  route: 'http://localhost:3000',
  viewport: { width: 100, height: 80, dpr: 1 },
  baselineScreenshot: 'expected.png',
  regions: [],
  texts: [
    { nodeId: 't1', text: 'Train Hard. Live Better' },
    { nodeId: 't2', text: 'hello@example.com' },
    { nodeId: 't3', text: 'reserve your spot' },
  ],
  colors: [],
  typography: [],
  thresholds: { fullPageMaxDiffRatio: 0.03, regionMaxDiffRatio: 0.01, boxTolerancePx: 3 },
};

test('text verifier requires exact normalized Figma copy', () => {
  const results = buildTextResults(baseSpec, [
    {
      nodeId: 't1',
      selector: '[data-figma-node="t1"]',
      box: { x: 0, y: 0, w: 10, h: 10 },
      computed: {},
      textContent: 'Train Hard. Live Best',
      innerText: 'Train Hard. Live Best',
      ariaLabel: '',
      alt: '',
      value: '',
    },
    {
      nodeId: 't3',
      selector: '[data-figma-node="t3"]',
      box: { x: 0, y: 0, w: 10, h: 10 },
      computed: {},
      textContent: '  reserve\n your   spot ',
      innerText: '  reserve\n your   spot ',
      ariaLabel: '',
      alt: '',
      value: '',
    },
  ], 'Train Hard. Live Best hello@example.com reserve your spot');

  assert.equal(results.find((result) => result.nodeId === 't1').status, 'failed');
  assert.equal(results.find((result) => result.nodeId === 't2').status, 'mapping-missing');
  assert.equal(results.find((result) => result.nodeId === 't3').status, 'passed');
});

test('text region pixel diff is tolerated when exact text and computed styles pass', () => {
  const warnings = [];
  const failures = buildRegionFailures({
    spec: {
      ...baseSpec,
      regions: [{ regionId: 't1', nodeId: 't1', name: 'Hero title', kind: 'text', box: { x: 0, y: 0, w: 100, h: 30 }, strictness: 'strict' }],
    },
    regionResults: [{ regionId: 't1', nodeId: 't1', diffRatio: 0.25, diffPixels: 750, totalPixels: 3000, status: 'failed', diffPath: 'regions/t1.diff.png' }],
    domResults: [{ nodeId: 't1', selector: '[data-figma-node="t1"]', status: 'passed', box: { x: 0, y: 0, w: 100, h: 30 }, computed: { fontFamily: 'Anek Tamil', fontSize: '116px' } }],
    textResults: [{ nodeId: 't1', selector: '[data-figma-node="t1"]', status: 'passed', expectedText: 'Train Hard. Live Better', actualText: 'Train Hard. Live Better', normalizedExpected: 'Train Hard. Live Better', normalizedActual: 'Train Hard. Live Better' }],
    styleFailures: [],
    warnings,
  });
  assert.equal(failures.length, 0);
  assert.equal(warnings[0].code, 'TEXT_PIXEL_DIFF_TOLERATED_FONT_RENDERING');
});

test('text region pixel diff remains actionable when exact text is wrong', () => {
  const warnings = [];
  const failures = buildRegionFailures({
    spec: {
      ...baseSpec,
      regions: [{ regionId: 't1', nodeId: 't1', name: 'Hero title', kind: 'text', box: { x: 0, y: 0, w: 100, h: 30 }, strictness: 'strict' }],
    },
    regionResults: [{ regionId: 't1', nodeId: 't1', diffRatio: 0.25, diffPixels: 750, totalPixels: 3000, status: 'failed', diffPath: 'regions/t1.diff.png' }],
    domResults: [{ nodeId: 't1', selector: '[data-figma-node="t1"]', status: 'passed', box: { x: 0, y: 0, w: 100, h: 30 }, computed: { fontFamily: 'Anek Tamil', fontSize: '116px' } }],
    textResults: [{ nodeId: 't1', selector: '[data-figma-node="t1"]', status: 'failed', expectedText: 'Train Hard. Live Better', actualText: 'Train Hard. Live Best', normalizedExpected: 'Train Hard. Live Better', normalizedActual: 'Train Hard. Live Best' }],
    styleFailures: [],
    warnings,
  });
  assert.equal(failures.length, 1);
  assert.equal(failures[0].category, 'typography');
  assert.equal(warnings.length, 0);
});


test('typography verifier treats extracted CSS text styles as hard evidence', () => {
  const mismatches = typographyMismatches(
    { fontFamily: 'Staatliches', fontSize: 42, fontWeight: 700, lineHeight: '110%', letterSpacing: '1%' },
    { fontFamily: 'Staatliches, sans-serif', fontSize: '40px', fontWeight: '400', lineHeight: '46.2px', letterSpacing: '0px' }
  );
  assert.deepEqual(mismatches.map((item) => item.key), ['fontSize', 'fontWeight', 'letterSpacing']);
});

test('asset verifier requires extracted Figma assets instead of drawn replacements', () => {
  const failures = buildAssetUsageFailures([
    { artifactId: 'asset_1', nodeId: '43:1067', path: 'runs/run_1/assets/product.png', kind: 'image', preferredFormat: 'png', mediaType: 'image/png' },
  ], [
    { selector: '[data-figma-node="43:1067"]', nodeId: '43:1067', tagName: 'div', box: { x: 0, y: 0, w: 100, h: 100 }, backgroundImage: 'linear-gradient(red, blue)' },
  ]);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].category, 'asset-missing');
  assert.match(failures[0].message, /Do not draw or recreate/);
});

test('asset verifier does not require reference-only exports to be used', () => {
  const failures = buildAssetUsageFailures([
    {
      artifactId: 'asset_ref',
      nodeId: '43:section',
      path: 'runs/run_1/assets/section-slice.png',
      kind: 'image',
      preferredFormat: 'png',
      mediaType: 'image/png',
      allowedUse: 'reference-only',
      sourceKind: 'node-export',
    },
  ], []);
  assert.equal(failures.length, 0);
});

test('asset verifier rejects reference-only exports when used as implementation content', () => {
  const failures = buildAssetUsageFailures([
    {
      artifactId: 'asset_ref',
      nodeId: '43:section',
      path: 'runs/run_1/assets/section-slice.png',
      kind: 'image',
      preferredFormat: 'png',
      mediaType: 'image/png',
      allowedUse: 'reference-only',
      sourceKind: 'node-export',
    },
  ], [
    {
      selector: '[data-figma-node="43:section"]',
      nodeId: '43:section',
      tagName: 'div',
      box: { x: 0, y: 0, w: 1280, h: 720 },
      backgroundImage: 'url("/.figma-react-restore/runs/run_1/assets/section-slice.png")',
    },
  ]);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].category, 'screenshot-overlay');
  assert.match(failures[0].message, /Reference-only Figma node export/);
});
