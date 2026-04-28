import assert from 'node:assert/strict';
import test from 'node:test';
import { createRepairPlan } from '../dist/restore/repair-plan.js';

const baseReport = {
  schemaVersion: 1,
  attemptId: 'attempt_1',
  route: 'http://localhost:3000',
  viewport: { width: 100, height: 80, dpr: 1 },
  fullPage: { diffRatio: 0.2, diffPixels: 1600, expectedPath: 'expected.png', actualPath: 'actual.png', diffPath: 'diff.png' },
  regionResults: [],
  domResults: [],
  warnings: [],
};

test('repair planner prioritizes layout before typography and assets', () => {
  const plan = createRepairPlan({
    ...baseReport,
    status: 'failed',
    failures: [
      { failureId: 'f3', category: 'asset-crop', severity: 'high', message: 'asset' },
      { failureId: 'f2', category: 'typography', severity: 'high', message: 'type' },
      { failureId: 'f1', category: 'layout-spacing', severity: 'medium', message: 'layout' },
    ],
  });
  assert.equal(plan.status, 'needs-repair');
  assert.equal(plan.worstFailures[0].category, 'layout-spacing');
  assert.match(plan.nextActions.join('\n'), /Repair layout/);
});

test('repair planner blocks on critical environment failure', () => {
  const plan = createRepairPlan({
    ...baseReport,
    status: 'blocked',
    failures: [{ failureId: 'f1', category: 'blocked-environment', severity: 'critical', message: 'browser missing' }],
  });
  assert.equal(plan.status, 'blocked');
  assert.match(plan.blockedReason, /browser missing/);
});
