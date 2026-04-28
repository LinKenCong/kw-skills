import assert from 'node:assert/strict';
import test from 'node:test';
import { minimalDesignIrSchema, repairPlanSchema, verifyReportSchema } from '../dist/schema.js';

test('schemas accept minimal valid V1 payloads', () => {
  const ir = minimalDesignIrSchema.parse({
    schemaVersion: 1,
    runId: 'run_1',
    evidenceLevel: 'L3-structured',
    page: { width: 100, height: 80 },
    regions: [{ regionId: '1:1', nodeId: '1:1', kind: 'page', box: { x: 0, y: 0, w: 100, h: 80 }, strictness: 'layout' }],
    texts: [],
    assets: [],
    colors: [],
    typography: [],
    layoutHints: [],
    warnings: [],
  });
  assert.equal(ir.evidenceLevel, 'L3-structured');

  const report = verifyReportSchema.parse({
    schemaVersion: 1,
    status: 'passed',
    attemptId: 'attempt_1',
    route: 'http://localhost:3000',
    viewport: { width: 100, height: 80, dpr: 1 },
    fullPage: { diffRatio: 0, diffPixels: 0, expectedPath: 'expected.png', actualPath: 'actual.png', diffPath: 'diff.png' },
    regionResults: [],
    domResults: [],
    failures: [],
    warnings: [],
  });
  assert.equal(report.status, 'passed');

  const plan = repairPlanSchema.parse({
    schemaVersion: 1,
    status: 'passed',
    attemptId: 'attempt_1',
    summary: 'ok',
    worstFailures: [],
    nextActions: [],
  });
  assert.equal(plan.status, 'passed');
});

test('schema rejects invalid evidence level', () => {
  assert.throws(() => minimalDesignIrSchema.parse({ schemaVersion: 1, runId: 'x', evidenceLevel: 'bad', page: {}, regions: [], texts: [], assets: [], colors: [], typography: [], layoutHints: [], warnings: [] }));
});
