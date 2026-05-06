import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PNG } from 'pngjs';
import { buildDomMappingWarnings, buildDomResults, buildStateFailures, defaultResponsiveSmokeViewports, resolveRegionThreshold, runVerification } from '../dist/verify/report.js';

function makeSpecRoot() {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'frr-verify-project-'));
  const artifactRoot = path.join(projectRoot, '.figma-react-restore');
  const runDir = path.join(artifactRoot, 'runs', 'run_1');
  fs.mkdirSync(runDir, { recursive: true });
  const specPath = path.join(runDir, 'fidelity-spec.json');
  fs.writeFileSync(specPath, JSON.stringify({
    schemaVersion: 1,
    runId: 'run_1',
    evidenceLevel: 'L3-structured',
    route: 'http://127.0.0.1:9',
    viewport: { width: 32, height: 24, dpr: 1 },
    baselineScreenshot: 'runs/run_1/missing-baseline.png',
    regions: [],
    texts: [],
    colors: [],
    typography: [],
    thresholds: { fullPageMaxDiffRatio: 0.03, regionMaxDiffRatio: 0.01, boxTolerancePx: 3 },
  }));
  return { projectRoot, artifactRoot, specPath };
}

const visualEvidenceRegions = [
  { regionId: 'region/one', box: { x: 0, y: 0, w: 10, h: 10 }, actualMatchWidth: 0 },
  { regionId: 'r2', nodeId: 'node:two', box: { x: 10, y: 0, w: 10, h: 10 }, actualMatchWidth: 1 },
  { regionId: 'r3', nodeId: '3:node', box: { x: 20, y: 0, w: 10, h: 10 }, actualMatchWidth: 2 },
  { regionId: 'r4', nodeId: 'node/four', box: { x: 30, y: 0, w: 10, h: 10 }, actualMatchWidth: 3 },
  { regionId: 'r5', nodeId: 'node five', box: { x: 40, y: 0, w: 10, h: 10 }, actualMatchWidth: 4 },
  { regionId: 'r6', nodeId: 'node:six', box: { x: 50, y: 0, w: 10, h: 10 }, actualMatchWidth: 5 },
  { regionId: 'r7', nodeId: 'node:seven', box: { x: 60, y: 0, w: 10, h: 10 }, actualMatchWidth: 6 },
  { regionId: 'passed-region', nodeId: 'node:passed', box: { x: 70, y: 0, w: 10, h: 10 }, passed: true },
];

function makeVisualEvidenceSpecRoot() {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'frr-verify-visual-evidence-'));
  const artifactRoot = path.join(projectRoot, '.figma-react-restore');
  const runDir = path.join(artifactRoot, 'runs', 'run_top5');
  fs.mkdirSync(runDir, { recursive: true });
  const expectedPath = path.join(runDir, 'baseline.png');
  writeTop5Baseline(expectedPath);
  const route = `data:text/html;charset=utf-8,${encodeURIComponent(buildTop5ActualHtml())}`;
  const specPath = path.join(runDir, 'fidelity-spec.json');
  fs.writeFileSync(specPath, JSON.stringify({
    schemaVersion: 1,
    runId: 'run_top5',
    evidenceLevel: 'L3-structured',
    route,
    viewport: { width: 80, height: 10, dpr: 1 },
    baselineScreenshot: 'runs/run_top5/baseline.png',
    regions: visualEvidenceRegions.map(({ regionId, nodeId, box }) => ({
      regionId,
      ...(nodeId ? { nodeId } : {}),
      kind: 'section',
      box,
      strictness: 'strict',
      mapping: 'optional',
    })),
    texts: [],
    colors: [],
    typography: [],
    thresholds: { fullPageMaxDiffRatio: 0, regionMaxDiffRatio: 0.01, boxTolerancePx: 3 },
  }));
  return { projectRoot, artifactRoot, specPath };
}

function makeContextualTextEvidenceSpecRoot() {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'frr-verify-context-evidence-'));
  const artifactRoot = path.join(projectRoot, '.figma-react-restore');
  const runDir = path.join(artifactRoot, 'runs', 'run_context');
  fs.mkdirSync(runDir, { recursive: true });
  const expectedPath = path.join(runDir, 'baseline.png');
  const png = new PNG({ width: 320, height: 200 });
  fillRect(png, 0, 0, 320, 200, [255, 255, 255, 255]);
  fillRect(png, 0, 0, 220, 120, [235, 235, 235, 255]);
  fillRect(png, 12, 24, 42, 12, [0, 0, 0, 255]);
  fs.writeFileSync(expectedPath, PNG.sync.write(png));
  const route = `data:text/html;charset=utf-8,${encodeURIComponent('<!doctype html><style>html,body{margin:0;width:320px;height:200px;overflow:hidden;background:#fff}</style>')}`;
  const specPath = path.join(runDir, 'fidelity-spec.json');
  fs.writeFileSync(specPath, JSON.stringify({
    schemaVersion: 1,
    runId: 'run_context',
    evidenceLevel: 'L3-structured',
    route,
    viewport: { width: 320, height: 200, dpr: 1 },
    baselineScreenshot: 'runs/run_context/baseline.png',
    regions: [
      { regionId: 'hero-section', nodeId: 'section:1', kind: 'section', box: { x: 0, y: 0, w: 220, h: 120 }, strictness: 'strict', mapping: 'optional' },
      { regionId: 'headline-text', nodeId: 'text:1', kind: 'text', box: { x: 12, y: 24, w: 42, h: 12 }, strictness: 'strict', mapping: 'required' },
    ],
    texts: [{ nodeId: 'text:1', text: 'Headline' }],
    colors: [],
    typography: [],
    thresholds: { fullPageMaxDiffRatio: 0, regionMaxDiffRatio: 0.01, boxTolerancePx: 3 },
  }));
  return { projectRoot, artifactRoot, specPath };
}

function makeFontOnlyTextEvidenceSpecRoot() {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'frr-verify-font-evidence-'));
  const artifactRoot = path.join(projectRoot, '.figma-react-restore');
  const runDir = path.join(artifactRoot, 'runs', 'run_font_only');
  fs.mkdirSync(runDir, { recursive: true });
  const expectedPath = path.join(runDir, 'baseline.png');
  const png = new PNG({ width: 120, height: 20 });
  fillRect(png, 0, 0, 120, 20, [255, 255, 255, 255]);
  const regions = Array.from({ length: 6 }, (_, index) => ({
    regionId: `text-${index + 1}`,
    nodeId: `text:${index + 1}`,
    box: { x: index * 20, y: 0, w: 10, h: 10 },
  }));
  for (const region of regions) fillRect(png, region.box.x, region.box.y, region.box.w, region.box.h, [0, 0, 0, 255]);
  fs.writeFileSync(expectedPath, PNG.sync.write(png));
  const blocks = regions.map((region) =>
    `<div data-figma-node="${region.nodeId}" style="position:absolute;left:${region.box.x}px;top:${region.box.y}px;width:${region.box.w}px;height:${region.box.h}px;font-size:10px;line-height:10px;color:#000">A</div>`
  );
  const route = `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><style>html,body{margin:0;width:120px;height:20px;overflow:hidden;background:#fff}</style>${blocks.join('')}`)}`;
  const specPath = path.join(runDir, 'fidelity-spec.json');
  fs.writeFileSync(specPath, JSON.stringify({
    schemaVersion: 1,
    runId: 'run_font_only',
    evidenceLevel: 'L3-structured',
    route,
    viewport: { width: 120, height: 20, dpr: 1 },
    baselineScreenshot: 'runs/run_font_only/baseline.png',
    regions: regions.map((region) => ({ ...region, kind: 'text', strictness: 'strict', mapping: 'required' })),
    texts: regions.map((region) => ({ nodeId: region.nodeId, text: 'A' })),
    colors: [],
    typography: [],
    thresholds: { fullPageMaxDiffRatio: 0, regionMaxDiffRatio: 0.01, boxTolerancePx: 3 },
  }));
  return { projectRoot, artifactRoot, specPath };
}

function writeTop5Baseline(outputPath) {
  const png = new PNG({ width: 80, height: 10 });
  fillRect(png, 0, 0, 80, 10, [255, 255, 255, 255]);
  for (const region of visualEvidenceRegions) {
    fillRect(png, region.box.x, region.box.y, region.box.w, region.box.h, region.passed ? [0, 160, 0, 255] : [0, 0, 0, 255]);
  }
  fs.writeFileSync(outputPath, PNG.sync.write(png));
}

function fillRect(png, x, y, w, h, rgba) {
  for (let row = y; row < y + h; row += 1) {
    for (let column = x; column < x + w; column += 1) {
      const offset = (png.width * row + column) << 2;
      png.data[offset] = rgba[0];
      png.data[offset + 1] = rgba[1];
      png.data[offset + 2] = rgba[2];
      png.data[offset + 3] = rgba[3];
    }
  }
}

function buildTop5ActualHtml() {
  const blocks = visualEvidenceRegions.flatMap((region) => {
    const attrs = region.nodeId ? ` data-figma-node="${escapeHtml(region.nodeId)}"` : '';
    if (region.passed) {
      return [`<div${attrs} style="position:absolute;left:${region.box.x}px;top:0;width:10px;height:10px;background:#00a000"></div>`];
    }
    return region.actualMatchWidth > 0
      ? [`<div${attrs} style="position:absolute;left:${region.box.x}px;top:0;width:${region.actualMatchWidth}px;height:10px;background:#000"></div>`]
      : [];
  });
  return `<!doctype html><style>html,body{margin:0;width:80px;height:10px;overflow:hidden;background:#fff}</style>${blocks.join('')}`;
}

function escapeHtml(value) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

test('verification writes blocked report when environment fails before capture', async () => {
  const { projectRoot, specPath } = makeSpecRoot();
  const result = await runVerification({ projectRoot, route: 'http://127.0.0.1:9', specPath });

  assert.equal(result.report.status, 'blocked');
  assert.equal(result.report.failures[0].category, 'blocked-environment');
  assert.ok(fs.existsSync(result.reportPath));
  assert.ok(fs.existsSync(path.join(path.dirname(result.reportPath), 'actual.png')));
  assert.ok(fs.existsSync(path.join(path.dirname(result.reportPath), 'diff.png')));
});

test('verification rejects output directories outside artifact root', async () => {
  const { projectRoot, specPath } = makeSpecRoot();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'frr-outside-'));
  await assert.rejects(
    () => runVerification({ projectRoot, route: 'http://127.0.0.1:9', specPath, outputDir: outside }),
    /Verify output directory must stay inside artifact root/
  );
});

test('DOM mapping tiers only fail required missing mappings', () => {
  const spec = {
    schemaVersion: 1,
    runId: 'run_1',
    route: 'http://localhost:3000',
    viewport: { width: 100, height: 80, dpr: 1 },
    baselineScreenshot: 'expected.png',
    regions: [
      { regionId: 'required-text', nodeId: 't1', kind: 'text', box: { x: 0, y: 0, w: 80, h: 20 }, strictness: 'strict', mapping: 'required' },
      { regionId: 'optional-section', nodeId: 's1', kind: 'section', box: { x: 0, y: 0, w: 100, h: 80 }, strictness: 'layout', mapping: 'optional' },
      { regionId: 'ignored-decor', nodeId: 'd1', kind: 'unknown', box: { x: 0, y: 0, w: 10, h: 10 }, strictness: 'ignored', mapping: 'ignored' },
    ],
    texts: [],
    assets: [],
    colors: [],
    typography: [],
    thresholds: { fullPageMaxDiffRatio: 0.03, regionMaxDiffRatio: 0.01, boxTolerancePx: 3 },
  };

  const results = buildDomResults(spec, [], 3);
  assert.equal(results.find((result) => result.nodeId === 't1').status, 'missing');
  assert.equal(results.find((result) => result.nodeId === 's1').status, 'skipped');
  assert.equal(results.find((result) => result.nodeId === 'd1').status, 'skipped');
  const warnings = buildDomMappingWarnings(results);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].code, 'DOM_MAPPING_OPTIONAL_SKIPPED');
});

test('DOM mapping uses union box for one Figma node split across inline DOM nodes', () => {
  const spec = {
    schemaVersion: 1,
    runId: 'run_1',
    route: 'http://localhost:3000',
    viewport: { width: 100, height: 80, dpr: 1 },
    baselineScreenshot: 'expected.png',
    regions: [
      { regionId: 'hero-title', nodeId: 'hero-title', kind: 'text', box: { x: 10, y: 20, w: 100, h: 20 }, strictness: 'strict', mapping: 'required' },
    ],
    texts: [],
    assets: [],
    colors: [],
    typography: [],
    thresholds: { fullPageMaxDiffRatio: 0.03, regionMaxDiffRatio: 0.01, boxTolerancePx: 2 },
  };

  const results = buildDomResults(spec, [
    { nodeId: 'hero-title', selector: '[data-figma-node="hero-title"] span:first-child', box: { x: 10, y: 20, w: 45, h: 20 }, computed: {} },
    { nodeId: 'hero-title', selector: '[data-figma-node="hero-title"] span:last-child', box: { x: 55, y: 20, w: 55, h: 20 }, computed: {} },
  ], 2);

  assert.equal(results[0].status, 'passed');
  assert.deepEqual(results[0].box, { x: 10, y: 20, w: 100, h: 20 });
});

test('route state assertion failures become wrong-state failures', () => {
  const failures = buildStateFailures([
    {
      type: 'visible-text',
      status: 'failed',
      message: 'Expected visible text is not present for route state: Checkout',
      expected: { text: 'Checkout' },
      actual: { visibleText: 'Cart' },
    },
    { type: 'local-storage', status: 'passed', expected: { key: 'mode' }, actual: { value: 'checkout' } },
  ]);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].category, 'wrong-state');
  assert.equal(failures[0].severity, 'high');
  assert.deepEqual(failures[0].expected, { text: 'Checkout' });
});

test('responsive smoke exposes opt-in mobile and tablet defaults', () => {
  const viewports = defaultResponsiveSmokeViewports();
  assert.deepEqual(viewports.map((item) => item.name), ['mobile', 'tablet']);
  assert.equal(viewports[0].viewport.width, 390);
  assert.equal(viewports[0].viewport.dpr, 2);
});

test('region strictness resolves per-region threshold with default as upper bound', () => {
  const textStrict = resolveRegionThreshold({ regionId: 'title', nodeId: 't1', kind: 'text', box: { x: 0, y: 0, w: 10, h: 10 }, strictness: 'strict' }, 0.03);
  const imagePerceptual = resolveRegionThreshold({ regionId: 'hero', nodeId: 'img1', kind: 'image', name: 'Hero Background', box: { x: 0, y: 0, w: 10, h: 10 }, strictness: 'perceptual' }, 0.03);
  const iconLayout = resolveRegionThreshold({ regionId: 'icon', nodeId: 'i1', kind: 'image', name: 'Search Icon', box: { x: 0, y: 0, w: 10, h: 10 }, strictness: 'layout' }, 0.5);
  assert.equal(textStrict < imagePerceptual, true);
  assert.equal(imagePerceptual, 0.03);
  assert.equal(iconLayout, 0.02);
});

test('verification retains only Top 5 failed region expected and diff evidence', async (t) => {
  const { projectRoot, artifactRoot, specPath } = makeVisualEvidenceSpecRoot();
  const result = await runVerification({ projectRoot, specPath, attemptId: 'attempt_top5' });
  if (result.report.status === 'blocked' && result.report.failures.some((failure) => failure.category === 'blocked-environment')) {
    t.skip('Playwright browser is unavailable in this environment');
    return;
  }

  const { report } = result;
  assert.equal(report.status, 'failed');
  assert.equal(report.regionResults.length, visualEvidenceRegions.length);
  for (const region of report.regionResults) {
    assert.equal(Number.isFinite(region.diffRatio), true);
    assert.equal(Number.isInteger(region.diffPixels), true);
    assert.equal(Number.isInteger(region.totalPixels), true);
  }

  const topFailedRegionIds = report.regionResults
    .filter((region) => region.status === 'failed')
    .sort((a, b) => b.diffRatio - a.diffRatio)
    .slice(0, 5)
    .map((region) => region.regionId);
  assert.deepEqual(topFailedRegionIds, ['region/one', 'r2', 'r3', 'r4', 'r5']);

  const retained = report.regionResults.filter((region) => region.expectedPath || region.diffPath || region.actualPath);
  assert.deepEqual(retained.map((region) => region.regionId), topFailedRegionIds);
  for (const region of retained) {
    assert.equal(region.status, 'failed');
    assert.ok(region.expectedPath);
    assert.ok(region.diffPath);
    assert.equal(region.evidenceRank, retained.indexOf(region) + 1);
    assert.equal(region.evidenceScope, 'region');
    assert.equal(region.evidenceRegionId, region.regionId);
    assert.deepEqual(region.evidenceBox, visualEvidenceRegions.find((item) => item.regionId === region.regionId).box);
    assert.equal(region.actualPath, undefined);
    assert.ok(fs.existsSync(path.join(artifactRoot, region.expectedPath)));
    assert.ok(fs.existsSync(path.join(artifactRoot, region.diffPath)));
  }

  for (const region of report.regionResults.filter((item) => !topFailedRegionIds.includes(item.regionId))) {
    assert.equal(region.expectedPath, undefined);
    assert.equal(region.diffPath, undefined);
    assert.equal(region.actualPath, undefined);
  }

  const regionDir = path.join(path.dirname(result.reportPath), 'regions');
  const files = fs.readdirSync(regionDir).sort();
  assert.deepEqual(files, [
    'node-3-node.diff.png',
    'node-3-node.expected.png',
    'node-node-five.diff.png',
    'node-node-five.expected.png',
    'node-node-four.diff.png',
    'node-node-four.expected.png',
    'node-node-two.diff.png',
    'node-node-two.expected.png',
    'region-region-one.diff.png',
    'region-region-one.expected.png',
  ]);
  assert.equal(files.some((file) => file.endsWith('.actual.png')), false);
  assert.equal(files.some((file) => /^(?:rank-\d+|\d+)-/.test(file)), false);
});

test('verification uses section crop for small text evidence while keeping source locator filename', async (t) => {
  const { projectRoot, artifactRoot, specPath } = makeContextualTextEvidenceSpecRoot();
  const result = await runVerification({ projectRoot, specPath, attemptId: 'attempt_context' });
  if (result.report.status === 'blocked' && result.report.failures.some((failure) => failure.category === 'blocked-environment')) {
    t.skip('Playwright browser is unavailable in this environment');
    return;
  }

  const textRegion = result.report.regionResults.find((region) => region.regionId === 'headline-text');
  assert.equal(textRegion?.status, 'failed');
  assert.equal(textRegion.evidenceScope, 'section');
  assert.equal(textRegion.evidenceRegionId, 'hero-section');
  assert.deepEqual(textRegion.evidenceBox, { x: 0, y: 0, w: 220, h: 120 });
  assert.equal(path.basename(textRegion.expectedPath), 'node-text-1.expected.png');
  assert.equal(path.basename(textRegion.diffPath), 'node-text-1.diff.png');
  assert.equal(textRegion.actualPath, undefined);

  const expectedCrop = PNG.sync.read(fs.readFileSync(path.join(artifactRoot, textRegion.expectedPath)));
  assert.equal(expectedCrop.width, 220);
  assert.equal(expectedCrop.height, 120);
});

test('verification limits font-rendering-only text evidence so it cannot monopolize Top 5', async (t) => {
  const { projectRoot, specPath } = makeFontOnlyTextEvidenceSpecRoot();
  const result = await runVerification({ projectRoot, specPath, attemptId: 'attempt_font_only' });
  if (result.report.status === 'blocked' && result.report.failures.some((failure) => failure.category === 'blocked-environment')) {
    t.skip('Playwright browser is unavailable in this environment');
    return;
  }

  const retainedTextRegions = result.report.regionResults.filter((region) => region.expectedPath || region.diffPath);
  assert.ok(result.report.regionResults.filter((region) => region.status === 'failed').length > 1);
  assert.ok(retainedTextRegions.length <= 1);
  if (retainedTextRegions.length === 1) {
    assert.equal(retainedTextRegions[0].evidenceScope, 'expanded-region');
    assert.equal(retainedTextRegions[0].actualPath, undefined);
  }
});
