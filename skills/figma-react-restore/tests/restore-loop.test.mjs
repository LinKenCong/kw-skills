import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ArtifactStore } from '../dist/artifact/store.js';
import { runRestoreAttempt } from '../dist/restore/loop.js';
import test from 'node:test';
import { detectPlateauForRatios, detectTextPlateau } from '../dist/restore/loop.js';

test('plateau policy detects no improvement across latest attempts', () => {
  assert.equal(detectPlateauForRatios([0.2, 0.199, 0.1985]), true);
  assert.equal(detectPlateauForRatios([0.2, 0.15, 0.1]), false);
  assert.equal(detectPlateauForRatios([0.2, 0.2]), false);
});

test('plateau policy detects unchanged exact text failures', () => {
  assert.equal(detectTextPlateau([2, 2, 2]), true);
  assert.equal(detectTextPlateau([2, 1, 1]), false);
  assert.equal(detectTextPlateau([0, 0, 0]), false);
});


test('restore writes blocked final artifacts when verification environment is blocked', async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'frr-restore-blocked-'));
  const store = new ArtifactStore({ workspaceRoot: projectRoot });
  const run = store.createRun('extract', {});
  store.writeRunJson(run.runId, 'fidelity-spec.json', {
    schemaVersion: 1,
    runId: run.runId,
    evidenceLevel: 'L3-structured',
    route: 'http://127.0.0.1:9',
    viewport: { width: 32, height: 24, dpr: 1 },
    baselineScreenshot: `runs/${run.runId}/missing-baseline.png`,
    regions: [],
    texts: [],
    colors: [],
    typography: [],
    thresholds: { fullPageMaxDiffRatio: 0.03, regionMaxDiffRatio: 0.01, boxTolerancePx: 3 },
  }, { kind: 'fidelity-spec', mediaType: 'application/json' });

  const result = await runRestoreAttempt({
    projectRoot,
    route: 'http://127.0.0.1:9',
    runId: run.runId,
    maxIterations: 1,
  }, store);

  assert.equal(result.status, 'blocked');
  assert.ok(result.reportPath);
  assert.ok(result.repairPlanPath);
  assert.ok(result.agentBriefPath);
  assert.ok(fs.existsSync(path.join(store.getRunDir(run.runId), 'final-report.json')));
});
