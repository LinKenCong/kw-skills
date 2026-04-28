import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runVerification } from '../dist/verify/report.js';

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
