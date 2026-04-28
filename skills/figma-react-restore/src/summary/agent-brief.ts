import fs from 'node:fs';
import path from 'node:path';
import { readJsonFile, writeJsonFile } from '../json.js';
import { inferArtifactRootFromPath } from '../paths.js';
import {
  agentBriefSchema,
  repairPlanSchema,
  verifyReportSchema,
  type AgentBrief,
  type AgentBriefFailure,
  type Failure,
  type RepairFailure,
  type RepairPlan,
  type VerifyReport,
} from '../schema.js';

export type AgentBriefOptions = {
  report: VerifyReport;
  plan?: RepairPlan;
  reportPath?: string;
  repairPlanPath?: string;
  textManifestPath?: string;
  tracePath?: string;
  maxFailures?: number;
  maxRegions?: number;
  maxWarnings?: number;
};

const DEFAULT_MAX_FAILURES = 10;
const DEFAULT_MAX_REGIONS = 8;
const DEFAULT_MAX_WARNINGS = 5;

const CATEGORY_RANK: Record<Failure['category'], number> = {
  'wrong-state': 0,
  'scale-mismatch': 1,
  'text-content': 2,
  'layout-spacing': 3,
  typography: 4,
  'asset-missing': 5,
  'asset-crop': 6,
  'screenshot-overlay': -2,
  color: 7,
  'overflow-clipping': 8,
  'insufficient-design-data': 9,
  'blocked-environment': -1,
};

const SEVERITY_RANK: Record<Failure['severity'], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function createAgentBrief(options: AgentBriefOptions): AgentBrief {
  const maxFailures = Math.max(1, options.maxFailures || DEFAULT_MAX_FAILURES);
  const maxRegions = Math.max(1, options.maxRegions || DEFAULT_MAX_REGIONS);
  const maxWarnings = Math.max(1, options.maxWarnings || DEFAULT_MAX_WARNINGS);
  const planFailures = options.plan?.worstFailures || [];
  const fallbackFailures = [...options.report.failures].sort(compareFailurePriority);
  const sourceFailures = planFailures.length > 0 ? planFailures : fallbackFailures;
  const failedRegions = options.report.regionResults
    .filter((region) => region.status === 'failed')
    .sort((a, b) => b.diffRatio - a.diffRatio)
    .slice(0, maxRegions)
    .map((region) => ({
      regionId: region.regionId,
      ...(region.nodeId ? { nodeId: region.nodeId } : {}),
      diffRatio: round(region.diffRatio),
      status: region.status,
      ...(region.diffPath ? { diffPath: region.diffPath } : {}),
    }));

  return agentBriefSchema.parse({
    schemaVersion: 1,
    kind: 'agent-brief',
    attemptId: options.report.attemptId,
    route: options.report.route,
    reportStatus: options.report.status,
    ...(options.plan ? { repairStatus: options.plan.status } : {}),
    tokenPolicy: {
      readFirst: [
        'agent-brief.json',
        'text-manifest.json for exact Figma copy before editing visible text',
        'repair-plan.json only when a listed action needs more context',
        'report.json only for a listed failure or evidence path',
      ],
      avoidByDefault: [
        'extraction.raw.json',
        'design-ir.json',
        'trace.zip',
        'all region crops',
        'full DOM/style dumps',
      ],
      maxFailures,
    },
    metrics: {
      viewport: options.report.viewport,
      fullPageDiffRatio: round(options.report.fullPage.diffRatio),
      fullPageDiffPixels: options.report.fullPage.diffPixels,
      failureCount: options.report.failures.length,
      failedRegionCount: options.report.regionResults.filter((region) => region.status === 'failed').length,
      failedDomCount: options.report.domResults.filter((result) => result.status === 'failed' || result.status === 'missing').length,
      failedTextCount: (options.report.textResults || []).filter((result) => result.status === 'failed' || result.status === 'missing' || result.status === 'mapping-missing').length,
      warningCount: options.report.warnings.length,
    },
    artifactPaths: {
      ...(options.reportPath ? { reportPath: options.reportPath } : {}),
      ...(options.repairPlanPath ? { repairPlanPath: options.repairPlanPath } : {}),
      ...(options.textManifestPath ? { textManifestPath: options.textManifestPath } : {}),
      expectedPath: options.report.fullPage.expectedPath,
      actualPath: options.report.fullPage.actualPath,
      diffPath: options.report.fullPage.diffPath,
      ...(options.tracePath ? { tracePath: options.tracePath } : {}),
    },
    failureCounts: countFailures(options.report.failures),
    nextActions: compactStrings(options.plan?.nextActions || fallbackActions(options.report), 5, 260),
    topFailures: sourceFailures.slice(0, maxFailures).map(toBriefFailure),
    topRegions: failedRegions,
    warnings: options.report.warnings.slice(0, maxWarnings),
  });
}

export function createAgentBriefFromFiles(options: {
  reportPath: string;
  planPath?: string;
  outputPath?: string;
  maxFailures?: number;
  maxRegions?: number;
  maxWarnings?: number;
}): { brief: AgentBrief; briefPath: string } {
  const report = verifyReportSchema.parse(readJsonFile(options.reportPath));
  const resolvedPlanPath = resolvePlanPath(options.reportPath, options.planPath);
  const plan = resolvedPlanPath ? repairPlanSchema.parse(readJsonFile(resolvedPlanPath)) : undefined;
  const outputPath = options.outputPath || path.join(path.dirname(options.reportPath), 'agent-brief.json');
  const tracePath = resolveTracePath(options.reportPath);
  const textManifestPath = resolveTextManifestPath(options.reportPath, report.runId);
  const brief = createAgentBrief({
    report,
    ...(plan ? { plan } : {}),
    reportPath: options.reportPath,
    ...(resolvedPlanPath ? { repairPlanPath: resolvedPlanPath } : {}),
    ...(textManifestPath ? { textManifestPath } : {}),
    ...(tracePath ? { tracePath } : {}),
    ...(options.maxFailures !== undefined ? { maxFailures: options.maxFailures } : {}),
    ...(options.maxRegions !== undefined ? { maxRegions: options.maxRegions } : {}),
    ...(options.maxWarnings !== undefined ? { maxWarnings: options.maxWarnings } : {}),
  });
  writeJsonFile(outputPath, brief);
  return { brief, briefPath: outputPath };
}

export function createCliSummary(brief: AgentBrief): Record<string, unknown> {
  return {
    status: brief.repairStatus || brief.reportStatus,
    attemptId: brief.attemptId,
    route: brief.route,
    fullPageDiffRatio: brief.metrics.fullPageDiffRatio,
    failureCount: brief.metrics.failureCount,
    failedRegionCount: brief.metrics.failedRegionCount,
    failedDomCount: brief.metrics.failedDomCount,
    failedTextCount: brief.metrics.failedTextCount || 0,
    topFailures: brief.topFailures.slice(0, 5).map((failure) => ({
      category: failure.category,
      severity: failure.severity,
      message: failure.message,
      ...(failure.nodeId ? { nodeId: failure.nodeId } : {}),
      ...(failure.regionId ? { regionId: failure.regionId } : {}),
      ...(failure.selector ? { selector: failure.selector } : {}),
    })),
    nextActions: brief.nextActions.slice(0, 3),
  };
}

function resolvePlanPath(reportPath: string, planPath?: string): string | undefined {
  if (planPath) return planPath;
  const sibling = path.join(path.dirname(reportPath), 'repair-plan.json');
  return fs.existsSync(sibling) ? sibling : undefined;
}

function resolveTracePath(reportPath: string): string | undefined {
  const sibling = path.join(path.dirname(reportPath), 'trace.zip');
  return fs.existsSync(sibling) ? sibling : undefined;
}

function resolveTextManifestPath(reportPath: string, runId?: string): string | undefined {
  if (runId) {
    const artifactRoot = inferArtifactRootFromPath(reportPath);
    if (artifactRoot) {
      const runCandidate = path.join(artifactRoot, 'runs', runId, 'text-manifest.json');
      if (fs.existsSync(runCandidate)) return runCandidate;
    }
  }
  let current = path.dirname(reportPath);
  for (let index = 0; index < 6; index += 1) {
    const candidate = path.join(current, 'text-manifest.json');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}

function compareFailurePriority(a: Failure, b: Failure): number {
  const categoryDelta = CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category];
  if (categoryDelta !== 0) return categoryDelta;
  const severityDelta = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (severityDelta !== 0) return severityDelta;
  return a.failureId.localeCompare(b.failureId);
}

function toBriefFailure(failure: Failure | RepairFailure): AgentBriefFailure {
  return {
    category: failure.category,
    severity: failure.severity,
    message: truncate(failure.message, 240),
    ...(failure.regionId ? { regionId: failure.regionId } : {}),
    ...(failure.nodeId ? { nodeId: failure.nodeId } : {}),
    ...(failure.selector ? { selector: truncate(failure.selector, 160) } : {}),
    ...(failure.evidencePath ? { evidencePath: failure.evidencePath } : {}),
    ...(failure.expected ? { expected: compactRecord(failure.expected) } : {}),
    ...(failure.actual ? { actual: compactRecord(failure.actual) } : {}),
    ...('recommendedAction' in failure ? { recommendedAction: truncate(failure.recommendedAction, 260) } : {}),
    ...('confidence' in failure ? { confidence: round(failure.confidence) } : {}),
  };
}

function countFailures(failures: Failure[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const failure of failures) counts[failure.category] = (counts[failure.category] || 0) + 1;
  return counts;
}

function fallbackActions(report: VerifyReport): string[] {
  if (report.status === 'passed') return [`Route passed fidelity gates. Full-page diff ${(report.fullPage.diffRatio * 100).toFixed(2)}%.`];
  const categories = Object.entries(countFailures(report.failures)).map(([category, count]) => `${category}:${count}`).join(', ');
  const textFailureCount = (report.textResults || []).filter((result) => result.status === 'failed' || result.status === 'missing' || result.status === 'mapping-missing').length;
  return [
    `Open agent-brief topFailures first; full report has ${report.failures.length} failures (${categories || 'none'}).`,
    textFailureCount > 0
      ? `Fix ${textFailureCount} exact text-content failures from text-manifest.json before layout or typography tuning.`
      : 'Patch layout/state failures before typography, assets, colors, and overflow.',
  ];
}

function compactStrings(values: string[], limit: number, maxLength: number): string[] {
  return values.slice(0, limit).map((value) => truncate(value, maxLength));
}

function compactRecord(record: Record<string, unknown>): Record<string, unknown> {
  return compactValue(record, 0) as Record<string, unknown>;
}

function compactValue(value: unknown, depth: number): unknown {
  if (typeof value === 'string') return truncate(value, 180);
  if (typeof value === 'number') return Number.isFinite(value) ? round(value) : value;
  if (typeof value === 'boolean' || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 4).map((item) => compactValue(item, depth + 1));
  if (typeof value !== 'object') return String(value);
  if (depth >= 2) return '[omitted]';
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 10)) {
    output[key] = compactValue(item, depth + 1);
  }
  return output;
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}...`;
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
