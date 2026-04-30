import assert from 'node:assert/strict';
import test from 'node:test';
import { fidelitySpecSchema, minimalDesignIrSchema, repairPlanSchema, serviceLockSchema, verifyReportSchema } from '../dist/schema.js';

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

  const lock = serviceLockSchema.parse({
    service: 'figma-react-restore',
    version: '0.1.0',
    pid: process.pid,
    port: 49327,
    url: 'http://127.0.0.1:49327',
    adminToken: 'test_admin_token_123456789012345678901234',
    startedAt: new Date().toISOString(),
    hostname: 'localhost',
    createdByCommand: 'figma-react-restore service start',
    lastHeartbeatAt: new Date().toISOString(),
    ownerPid: process.pid,
    workspaceRoot: '/tmp/project',
    artifactRoot: '/tmp/project/.figma-react-restore',
  });
  assert.equal(lock.url, 'http://127.0.0.1:49327');
});

test('schema rejects invalid evidence level', () => {
  assert.throws(() => minimalDesignIrSchema.parse({ schemaVersion: 1, runId: 'x', evidenceLevel: 'bad', page: {}, regions: [], texts: [], assets: [], colors: [], typography: [], layoutHints: [], warnings: [] }));
});

test('schemas accept layout hints, DOM mapping tiers, and route state contract', () => {
  const ir = minimalDesignIrSchema.parse({
    schemaVersion: 1,
    runId: 'run_1',
    evidenceLevel: 'L3-structured',
    page: { width: 320, height: 200 },
    regions: [
      { regionId: '1:1', nodeId: '1:1', kind: 'section', box: { x: 0, y: 0, w: 320, h: 200 }, strictness: 'layout', mapping: 'optional' },
      { regionId: '1:2', nodeId: '1:2', kind: 'text', box: { x: 20, y: 20, w: 80, h: 24 }, strictness: 'strict', mapping: 'required' },
      { regionId: '1:3', nodeId: '1:3', kind: 'unknown', box: { x: 0, y: 0, w: 1, h: 1 }, strictness: 'ignored', mapping: 'ignored' },
    ],
    texts: [],
    assets: [],
    colors: [],
    typography: [],
    layoutHints: [{
      nodeId: '1:1',
      parentNodeId: '0:1',
      display: 'flex',
      direction: 'row',
      alignment: { primaryAxis: 'CENTER', counterAxis: 'MIN' },
      sizing: { horizontal: 'FIXED', vertical: 'HUG', layoutGrow: 1 },
      constraints: { horizontal: 'SCALE', vertical: 'TOP' },
      wrap: 'WRAP',
      clipsContent: true,
      gap: 12,
      padding: [8, 10, 8, 10],
      paddingEdges: { top: 8, right: 10, bottom: 8, left: 10 },
      zIndex: 2,
      layerIndex: 2,
      radius: { topLeft: 8, topRight: 8, bottomRight: 4, bottomLeft: 4 },
      effects: [{ type: 'DROP_SHADOW', visible: true }],
      opacity: 0.72,
      box: { x: 0, y: 0, w: 320, h: 200 },
    }],
    warnings: [],
  });
  assert.equal(ir.regions[0].mapping, 'optional');
  assert.equal(ir.layoutHints[0].alignment.primaryAxis, 'CENTER');

  const spec = fidelitySpecSchema.parse({
    schemaVersion: 1,
    runId: 'run_1',
    route: 'http://localhost:3000',
    viewport: { width: 320, height: 200, dpr: 1 },
    routeState: {
      waitForSelector: '[data-ready="checkout"]',
      expectedVisibleText: ['Checkout'],
      localStorage: { mode: 'checkout' },
      cookies: [{ name: 'variant', value: 'b' }],
      setupScript: 'window.__ready = true',
      assertions: [{ type: 'selector-visible', selector: '[data-ready="checkout"]' }],
    },
    baselineScreenshot: 'expected.png',
    regions: ir.regions,
    thresholds: { fullPageMaxDiffRatio: 0.03, regionMaxDiffRatio: 0.01, boxTolerancePx: 3 },
  });
  assert.equal(spec.routeState.waitForSelector, '[data-ready="checkout"]');

  const report = verifyReportSchema.parse({
    schemaVersion: 1,
    status: 'failed',
    attemptId: 'attempt_1',
    route: spec.route,
    viewport: spec.viewport,
    fullPage: { diffRatio: 0.2, diffPixels: 100, expectedPath: 'expected.png', actualPath: 'actual.png', diffPath: 'diff.png' },
    regionResults: [],
    domResults: [{ nodeId: '1:1', selector: '[data-figma-node="1:1"]', mapping: 'optional', status: 'skipped' }],
    stateResults: [{ type: 'visible-text', status: 'failed', expected: { text: 'Checkout' }, actual: { visibleText: 'Cart' } }],
    failures: [{ failureId: 'f1', category: 'wrong-state', severity: 'high', message: 'state mismatch' }],
    warnings: [],
  });
  assert.equal(report.stateResults[0].type, 'visible-text');
});
