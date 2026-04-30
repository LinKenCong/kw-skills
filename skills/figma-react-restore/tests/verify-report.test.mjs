import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildDomMappingWarnings, buildDomResults, buildStateFailures, runVerification } from '../dist/verify/report.js';

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
