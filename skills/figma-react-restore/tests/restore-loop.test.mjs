import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { ArtifactStore } from '../dist/artifact/store.js';
import { runRestoreAttempt } from '../dist/restore/loop.js';
import test from 'node:test';
import {
  countRepairAttemptsForHistory,
  detectPlateauForAttemptHistory,
  detectPlateauForRatios,
  detectTextPlateau,
  nextRestoreAttemptPhaseForHistory,
  shouldRequestInitialImplementationForReport,
} from '../dist/restore/loop.js';

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

test('repair attempt helpers ignore baseline attempts and treat old unphased state as repair', () => {
  const attempts = [
    { phase: 'baseline', fullPageDiffRatio: 0.5, failedTextCount: 2 },
    { fullPageDiffRatio: 0.2, failedTextCount: 2 },
    { phase: 'repair', fullPageDiffRatio: 0.199, failedTextCount: 2 },
    { phase: 'repair', fullPageDiffRatio: 0.1985, failedTextCount: 2 },
  ];

  assert.equal(countRepairAttemptsForHistory(attempts), 3);
  assert.equal(detectPlateauForAttemptHistory(attempts), 'full-page diff did not improve across the latest repair attempts');
  assert.equal(detectPlateauForAttemptHistory([
    { phase: 'baseline', fullPageDiffRatio: 0.2, failedTextCount: 2 },
    { phase: 'baseline', fullPageDiffRatio: 0.199, failedTextCount: 2 },
    { phase: 'repair', fullPageDiffRatio: 0.1, failedTextCount: 1 },
  ]), null);
  assert.equal(nextRestoreAttemptPhaseForHistory([]), 'baseline');
  assert.equal(nextRestoreAttemptPhaseForHistory([{ phase: 'baseline', resultStatus: 'needs-initial-implementation' }]), 'repair');
  assert.equal(nextRestoreAttemptPhaseForHistory([{ phase: 'baseline', status: 'blocked' }]), 'baseline');
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
  assert.ok(result.implementationBriefPath);
  assert.ok(fs.existsSync(path.join(store.getRunDir(run.runId), 'final-report.json')));
  const attempt = JSON.parse(fs.readFileSync(path.join(store.getRunDir(run.runId), 'restore', 'attempts', '001', 'attempt.json'), 'utf8'));
  assert.equal(attempt.phase, 'baseline');
  assert.equal(attempt.repairIndex, undefined);
  assert.equal(attempt.implementationBriefPath, result.implementationBriefPath);
  const state = JSON.parse(fs.readFileSync(path.join(store.getRunDir(run.runId), 'restore', 'state.json'), 'utf8'));
  assert.equal(countRepairAttemptsForHistory(state.attempts), 0);
  assert.ok(fs.existsSync(path.join(store.getRunDir(run.runId), 'restore', 'archive', 'latest.manifest.json')));
});

test('blank baseline classification requests initial implementation without consuming repair iterations', async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'frr-restore-initial-'));
  const actualPath = path.join(projectRoot, 'actual.png');
  await sharp({
    create: {
      width: 128,
      height: 96,
      channels: 4,
      background: '#ffffff',
    },
  }).png().toFile(actualPath);
  const report = {
    schemaVersion: 1,
    runId: 'run_initial',
    status: 'failed',
    attemptId: 'attempt_001',
    route: 'http://example.invalid',
    viewport: { width: 128, height: 96, dpr: 1 },
    fullPage: {
      diffRatio: 0.92,
      diffPixels: 1000,
      expectedPath: 'expected.png',
      actualPath: 'actual.png',
      diffPath: 'diff.png',
    },
    regionResults: [{
      regionId: 'hero-title',
      nodeId: '1:2',
      threshold: 0.01,
      diffRatio: 0.95,
      diffPixels: 900,
      totalPixels: 1200,
      status: 'failed',
    }],
    domResults: [{
      nodeId: '1:2',
      selector: '[data-figma-node="1:2"]',
      mapping: 'required',
      status: 'missing',
      message: 'Missing required DOM element with data-figma-node',
    }],
    textResults: [{
      nodeId: '1:2',
      selector: '[data-figma-node="1:2"]',
      status: 'missing',
      expectedText: 'Welcome home',
      normalizedExpected: 'Welcome home',
      message: 'Expected Figma text is missing from the rendered page',
    }],
    stateResults: [],
    failures: [{
      failureId: 'failure_001',
      category: 'text-content',
      severity: 'high',
      message: 'Expected Figma text is missing from the rendered page',
    }],
    warnings: [],
  };

  assert.equal(await shouldRequestInitialImplementationForReport(report, actualPath), true);
  assert.equal(countRepairAttemptsForHistory([{ phase: 'baseline', resultStatus: 'needs-initial-implementation' }]), 0);
});
