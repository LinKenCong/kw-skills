import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createAgentBrief, createAgentBriefFromFiles, createCliSummary } from '../dist/summary/agent-brief.js';
import { createImplementationBriefFromFiles } from '../dist/summary/implementation-brief.js';

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
  stateResults: [],
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

test('agent brief surfaces wrong-state and optional mapping guidance', () => {
  const brief = createAgentBrief({
    report: {
      ...baseReport,
      stateResults: [{ type: 'visible-text', status: 'failed', expected: { text: 'Checkout' }, actual: { visibleText: 'Cart' } }],
      domResults: [{ nodeId: 's1', selector: '[data-figma-node="s1"]', mapping: 'optional', status: 'skipped', message: 'Optional DOM element with data-figma-node is not present; mapping check skipped' }],
      warnings: [{ code: 'DOM_MAPPING_OPTIONAL_SKIPPED', message: 'Optional DOM mapping was skipped.' }],
      failures: [
        { failureId: 'f2', category: 'layout-spacing', severity: 'high', message: 'layout mismatch' },
        { failureId: 'f1', category: 'wrong-state', severity: 'high', message: 'state mismatch', expected: { text: 'Checkout' }, actual: { visibleText: 'Cart' } },
      ],
    },
  });
  assert.equal(brief.metrics.failedStateCount, 1);
  assert.equal(brief.metrics.failedDomCount, 0);
  assert.equal(brief.topFailures[0].category, 'wrong-state');
  assert.ok(brief.tokenPolicy.readFirst.some((item) => item.includes('report.stateResults')));
  assert.match(brief.nextActions.join('\n'), /wrong-state/);
  const summary = createCliSummary(brief);
  assert.equal(summary.failedStateCount, 1);
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

test('implementation brief writes structure, asset policy, tokens, and likely files', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'frr-impl-brief-'));
  const projectRoot = path.join(workspace, 'project');
  const root = path.join(projectRoot, '.figma-react-restore');
  const runDir = path.join(root, 'runs', 'run_1');
  const verifyDir = path.join(root, 'verify', 'attempt_1');
  fs.mkdirSync(path.join(projectRoot, 'app', 'landing'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, 'src', 'styles'), { recursive: true });
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(verifyDir, { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'package.json'), JSON.stringify({
    scripts: { dev: 'next dev' },
    dependencies: { react: '^18.0.0', next: '^15.0.0' },
  }));
  fs.writeFileSync(path.join(projectRoot, 'app', 'landing', 'page.tsx'), 'export default function Page() { return null; }');
  fs.writeFileSync(path.join(projectRoot, 'tailwind.config.ts'), 'export default {};');
  fs.writeFileSync(path.join(projectRoot, 'src', 'styles', 'tokens.css'), ':root { --brand: #111; }');
  const designIr = {
    schemaVersion: 1,
    runId: 'run_1',
    evidenceLevel: 'L3-structured',
    page: { pageName: 'Landing', width: 1200, height: 900 },
    regions: [
      { regionId: 'page', nodeId: 'page', name: 'Landing Page', kind: 'page', box: { x: 0, y: 0, w: 1200, h: 900 }, strictness: 'layout', mapping: 'optional' },
      { regionId: 'hero', nodeId: 'hero', name: 'Hero Section', kind: 'section', box: { x: 0, y: 0, w: 1200, h: 520 }, strictness: 'layout', mapping: 'optional' },
      { regionId: 'icon', nodeId: 'icon', name: 'Search Icon', kind: 'image', box: { x: 80, y: 80, w: 24, h: 24 }, strictness: 'strict', mapping: 'required' },
      { regionId: 'photo', nodeId: 'photo', name: 'Product Photo', kind: 'image', box: { x: 720, y: 80, w: 360, h: 300 }, strictness: 'strict', mapping: 'required' },
    ],
    texts: [{ nodeId: 'title', name: 'Title', text: 'Launch faster', box: { x: 80, y: 120, w: 400, h: 80 }, fontFamily: 'Staatliches', fontSize: 48, fontWeight: 700 }],
    assets: [
      { artifactId: 'asset_icon', nodeId: 'icon', path: 'runs/run_1/assets/search.svg', kind: 'svg', preferredFormat: 'svg', allowedUse: 'implementation', sourceKind: 'vector' },
      { artifactId: 'asset_photo', nodeId: 'photo', path: 'runs/run_1/assets/product.png', kind: 'image', preferredFormat: 'png', allowedUse: 'implementation', sourceKind: 'image-fill' },
    ],
    colors: [{ value: '#111111', count: 4 }],
    typography: [{ nodeId: 'title', fontFamily: 'Staatliches', fontSize: 48, fontWeight: 700 }],
    layoutHints: [
      { nodeId: 'page', name: 'Landing Page', display: 'flex', direction: 'column', gap: 0, box: { x: 0, y: 0, w: 1200, h: 900 } },
      { nodeId: 'hero', parentNodeId: 'page', name: 'Hero Section', display: 'flex', direction: 'row', gap: 48, padding: [80, 80, 80, 80], box: { x: 0, y: 0, w: 1200, h: 520 } },
    ],
    warnings: [],
  };
  const reportPath = path.join(verifyDir, 'report.json');
  fs.writeFileSync(path.join(runDir, 'design-ir.json'), JSON.stringify(designIr));
  fs.writeFileSync(path.join(runDir, 'text-manifest.json'), JSON.stringify({ schemaVersion: 1, kind: 'text-manifest', runId: 'run_1', source: 'figma-text-nodes', textCount: 1, items: designIr.texts, warnings: [] }));
  fs.writeFileSync(reportPath, JSON.stringify({ ...baseReport, runId: 'run_1', route: 'http://localhost:3000/landing' }));

  const { brief, briefPath } = createImplementationBriefFromFiles({ reportPath, projectRoot });

  assert.ok(fs.existsSync(briefPath));
  assert.equal(brief.kind, 'implementation-brief');
  assert.equal(brief.structureTree[0].nodeId, 'page');
  assert.equal(brief.assetManifest.summary.semanticEquivalentAllowed, 1);
  assert.equal(brief.assetManifest.summary.mustUseExtractedAsset, 1);
  assert.ok(brief.tokens.spacing.includes(48));
  assert.ok(brief.likelySourceFiles.some((file) => file.path === 'app/landing/page.tsx'));
  assert.equal(brief.responsive.smokeStatus, 'not-run');
});
