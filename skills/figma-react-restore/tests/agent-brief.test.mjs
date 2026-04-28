import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createAgentBrief, createAgentBriefFromFiles, createCliSummary } from '../dist/summary/agent-brief.js';

const baseReport = {
  schemaVersion: 1,
  status: 'failed',
  attemptId: 'attempt_1',
  route: 'http://localhost:3000',
  viewport: { width: 100, height: 80, dpr: 1 },
  fullPage: { diffRatio: 0.2, diffPixels: 1600, expectedPath: 'expected.png', actualPath: 'actual.png', diffPath: 'diff.png' },
  regionResults: [
    { regionId: 'r1', nodeId: 'n1', diffRatio: 0.12, diffPixels: 12, totalPixels: 100, diffPath: 'regions/r1.diff.png', status: 'failed' },
    { regionId: 'r2', nodeId: 'n2', diffRatio: 0.01, diffPixels: 1, totalPixels: 100, status: 'passed' },
  ],
  domResults: [{ nodeId: 'n1', selector: '[data-figma-node="n1"]', status: 'missing', message: 'Missing DOM element with data-figma-node' }],
  textResults: [],
  failures: [
    { failureId: 'f3', category: 'color', severity: 'low', message: 'color mismatch', nodeId: 'n3' },
    { failureId: 'f1', category: 'layout-spacing', severity: 'high', message: 'layout mismatch', nodeId: 'n1', regionId: 'r1', expected: { box: { x: 0, y: 0, w: 100, h: 80 } }, actual: { box: { x: 3, y: 4, w: 90, h: 80 } } },
    { failureId: 'f2', category: 'typography', severity: 'medium', message: 'font mismatch', nodeId: 'n2' },
  ],
  warnings: [{ code: 'WARN', message: 'warning text' }],
};

test('agent brief keeps prioritized compact failures and token policy', () => {
  const brief = createAgentBrief({
    report: baseReport,
    plan: {
      schemaVersion: 1,
      status: 'needs-repair',
      attemptId: 'attempt_1',
      summary: 'repair',
      worstFailures: [
        { ...baseReport.failures[1], recommendedAction: 'Fix layout first', confidence: 0.85 },
        { ...baseReport.failures[2], recommendedAction: 'Fix typography second', confidence: 0.85 },
      ],
      nextActions: ['Repair layout boxes first', 'Then repair typography'],
    },
    maxFailures: 1,
  });
  assert.equal(brief.kind, 'agent-brief');
  assert.equal(brief.metrics.failureCount, 3);
  assert.equal(brief.topFailures.length, 1);
  assert.equal(brief.topFailures[0].category, 'layout-spacing');
  assert.equal(brief.topFailures[0].recommendedAction, 'Fix layout first');
  assert.equal(brief.topRegions[0].regionId, 'r1');
  assert.ok(brief.tokenPolicy.avoidByDefault.includes('extraction.raw.json'));
});

test('agent brief reports text failures before visual tuning failures', () => {
  const brief = createAgentBrief({
    report: {
      ...baseReport,
      textResults: [{ nodeId: 't1', status: 'failed', expectedText: 'Exact Copy', actualText: 'Guessed Copy', normalizedExpected: 'Exact Copy', normalizedActual: 'Guessed Copy' }],
      failures: [
        { failureId: 'f1', category: 'layout-spacing', severity: 'high', message: 'layout mismatch', nodeId: 'n1' },
        { failureId: 'f2', category: 'text-content', severity: 'high', message: 'text mismatch', nodeId: 't1', expected: { text: 'Exact Copy' }, actual: { text: 'Guessed Copy' } },
      ],
    },
  });
  assert.equal(brief.metrics.failedTextCount, 1);
  assert.equal(brief.topFailures[0].category, 'text-content');
  assert.ok(brief.tokenPolicy.readFirst.some((item) => item.includes('text-manifest.json')));
});

test('agent brief file writer uses sibling repair plan and creates CLI summary', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frr-brief-'));
  const reportPath = path.join(dir, 'report.json');
  const planPath = path.join(dir, 'repair-plan.json');
  fs.writeFileSync(reportPath, JSON.stringify(baseReport));
  fs.writeFileSync(planPath, JSON.stringify({
    schemaVersion: 1,
    status: 'needs-repair',
    attemptId: 'attempt_1',
    summary: 'repair',
    worstFailures: [{ ...baseReport.failures[1], recommendedAction: 'Fix layout first', confidence: 0.85 }],
    nextActions: ['Repair layout boxes first'],
  }));
  const { brief, briefPath } = createAgentBriefFromFiles({ reportPath });
  assert.equal(brief.artifactPaths.repairPlanPath, planPath);
  assert.ok(fs.existsSync(briefPath));
  const summary = createCliSummary(brief);
  assert.equal(summary.status, 'needs-repair');
  assert.equal(summary.failureCount, 3);
});

test('agent brief file writer resolves text manifest from report run id', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'frr-brief-root-'));
  const root = path.join(workspace, '.figma-react-restore');
  const runDir = path.join(root, 'runs', 'run_1');
  const verifyDir = path.join(root, 'verify', 'attempt_1');
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(verifyDir, { recursive: true });
  const textManifestPath = path.join(runDir, 'text-manifest.json');
  fs.writeFileSync(textManifestPath, JSON.stringify({ schemaVersion: 1, kind: 'text-manifest', runId: 'run_1', source: 'figma-text-nodes', textCount: 0, items: [], warnings: [] }));
  const reportPath = path.join(verifyDir, 'report.json');
  fs.writeFileSync(reportPath, JSON.stringify({ ...baseReport, runId: 'run_1' }));
  const { brief } = createAgentBriefFromFiles({ reportPath });
  assert.equal(brief.artifactPaths.textManifestPath, textManifestPath);
});
