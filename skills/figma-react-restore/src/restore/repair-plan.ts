import path from 'node:path';
import { createId } from '../ids.js';
import { readJsonFile, writeJsonFile } from '../json.js';
import {
  repairFailureSchema,
  repairPlanSchema,
  verifyReportSchema,
  type Failure,
  type RepairFailure,
  type RepairPlan,
  type VerifyReport,
} from '../schema.js';

const CATEGORY_RANK: Record<Failure['category'], number> = {
  'wrong-state': 0,
  'scale-mismatch': 1,
  'layout-spacing': 2,
  typography: 3,
  'asset-missing': 4,
  'asset-crop': 5,
  color: 6,
  'overflow-clipping': 7,
  'insufficient-design-data': 8,
  'blocked-environment': -1,
};

const SEVERITY_RANK: Record<Failure['severity'], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function createRepairPlan(report: VerifyReport): RepairPlan {
  if (report.status === 'passed') {
    return repairPlanSchema.parse({
      schemaVersion: 1,
      status: 'passed',
      attemptId: report.attemptId,
      summary: `Route passed fidelity gates. Full-page diff ${(report.fullPage.diffRatio * 100).toFixed(2)}%.`,
      worstFailures: [],
      nextActions: [],
    });
  }

  const environmentFailure = report.failures.find((failure) => failure.category === 'blocked-environment' && failure.severity === 'critical');
  const insufficient = report.failures.find((failure) => failure.category === 'insufficient-design-data');
  if (report.status === 'blocked' || environmentFailure || insufficient) {
    const reason = environmentFailure?.message || insufficient?.message || 'Verification is blocked';
    return repairPlanSchema.parse({
      schemaVersion: 1,
      status: 'blocked',
      attemptId: report.attemptId,
      summary: reason,
      worstFailures: report.failures.slice(0, 8).map(toRepairFailure),
      nextActions: [blockedAction(environmentFailure || insufficient)],
      blockedReason: reason,
    });
  }

  const ordered = [...report.failures].sort(compareFailurePriority).slice(0, 10).map(toRepairFailure);
  const nextActions = buildNextActions(ordered, report);
  return repairPlanSchema.parse({
    schemaVersion: 1,
    status: 'needs-repair',
    attemptId: report.attemptId,
    summary: `${ordered.length} prioritized failures. Repair large layout/state failures before visual polish. Full-page diff ${(report.fullPage.diffRatio * 100).toFixed(2)}%.`,
    worstFailures: ordered,
    nextActions,
  });
}

export function createRepairPlanFromFile(reportPath: string, outputPath?: string): { plan: RepairPlan; planPath: string } {
  const report = verifyReportSchema.parse(readJsonFile(reportPath));
  const plan = createRepairPlan(report);
  const planPath = outputPath || path.join(path.dirname(reportPath), 'repair-plan.json');
  writeJsonFile(planPath, plan);
  return { plan, planPath };
}

function compareFailurePriority(a: Failure, b: Failure): number {
  const categoryDelta = CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category];
  if (categoryDelta !== 0) return categoryDelta;
  const severityDelta = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (severityDelta !== 0) return severityDelta;
  return a.failureId.localeCompare(b.failureId);
}

function toRepairFailure(failure: Failure): RepairFailure {
  return repairFailureSchema.parse({
    ...failure,
    recommendedAction: recommendedAction(failure),
    confidence: confidenceFor(failure),
  });
}

function recommendedAction(failure: Failure): string {
  const target = [failure.regionId ? `region ${failure.regionId}` : '', failure.nodeId ? `node ${failure.nodeId}` : '', failure.selector ? `selector ${failure.selector}` : '']
    .filter(Boolean)
    .join(', ');
  const suffix = target ? ` (${target})` : '';
  switch (failure.category) {
    case 'wrong-state':
      return `Set the route to the same visual state as the Figma frame before editing layout${suffix}.`;
    case 'scale-mismatch':
      return `Align viewport, page width, root scale, and screenshot baseline dimensions before local fixes${suffix}.`;
    case 'layout-spacing':
      return `Fix macro layout first: container width, section position, padding, gap, alignment, and element box size${suffix}.`;
    case 'typography':
      return `Match text content, font family, font size, weight, line-height, max-width, and wrapping${suffix}.`;
    case 'asset-missing':
      return `Provide the missing image/icon asset or update the route state so the asset loads${suffix}.`;
    case 'asset-crop':
      return `Adjust image source, object-fit, object-position, crop, and rendered box size${suffix}.`;
    case 'color':
      return `After layout is stable, match fill, text color, border, gradient, shadow, and opacity${suffix}.`;
    case 'overflow-clipping':
      return `Remove unintended clipping or adjust container height/overflow after layout is fixed${suffix}.`;
    case 'insufficient-design-data':
      return 'Re-extract a Figma frame with node tree and screenshot evidence; visual-only evidence is not enough for high-confidence repair.';
    case 'blocked-environment':
      return 'Fix route, browser, font, request, or dependency failure before changing React code.';
  }
}

function confidenceFor(failure: Failure): number {
  if (failure.category === 'blocked-environment' || failure.category === 'insufficient-design-data') return 0.95;
  if (failure.nodeId || failure.selector) return 0.85;
  if (failure.regionId) return 0.75;
  return 0.6;
}

function buildNextActions(failures: RepairFailure[], report: VerifyReport): string[] {
  if (failures.length === 0) return ['Rerun verification; report failed but no concrete failure was produced.'];
  const first = failures[0]!;
  const actions: string[] = [];
  if (first.category === 'scale-mismatch' || first.category === 'wrong-state') actions.push(first.recommendedAction);
  const layout = failures.filter((failure) => failure.category === 'layout-spacing').slice(0, 3);
  if (layout.length > 0) actions.push(`Repair layout boxes in priority order: ${layout.map(labelFailure).join(' -> ')}.`);
  const typography = failures.filter((failure) => failure.category === 'typography').slice(0, 3);
  if (typography.length > 0) actions.push(`Then repair text metrics/content: ${typography.map(labelFailure).join(' -> ')}.`);
  const assets = failures.filter((failure) => failure.category === 'asset-missing' || failure.category === 'asset-crop').slice(0, 3);
  if (assets.length > 0) actions.push(`Then repair assets: ${assets.map(labelFailure).join(' -> ')}.`);
  const overflow = failures.filter((failure) => failure.category === 'overflow-clipping').slice(0, 2);
  if (overflow.length > 0) actions.push(`Check overflow only after layout fixes: ${overflow.map(labelFailure).join(' -> ')}.`);
  actions.push(`After patching, rerun restore/verify for attempt ${report.attemptId}; do not optimize colors until layout and typography failures decrease.`);
  return actions;
}

function blockedAction(failure?: Failure): string {
  if (!failure) return 'Inspect the verification report and rerun after unblocking the environment or design evidence.';
  return recommendedAction(failure);
}

function labelFailure(failure: RepairFailure): string {
  return failure.regionId || failure.nodeId || failure.selector || failure.failureId || createId('failure');
}
