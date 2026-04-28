import fs from 'node:fs';
import path from 'node:path';
import { ArtifactStore } from '../artifact/store.js';
import { createId } from '../ids.js';
import { readJsonFile, writeJsonFile } from '../json.js';
import { inferArtifactRootFromPath, relativeArtifactPath, resolveReferencePath } from '../paths.js';
import {
  fidelitySpecSchema,
  verifyReportSchema,
  type Box,
  type DomResult,
  type Failure,
  type FidelitySpec,
  type Region,
  type RegionResult,
  type VerifyReport,
} from '../schema.js';
import { captureRoute } from './capture.js';
import { compareImages, cropImage } from './pixel.js';

export type VerifyOptions = {
  projectRoot: string;
  route: string;
  specPath: string;
  outputDir?: string;
  attemptId?: string;
  waitMs?: number;
};

export async function runVerification(options: VerifyOptions): Promise<{ report: VerifyReport; reportPath: string }> {
  const spec = fidelitySpecSchema.parse(readJsonFile(options.specPath));
  const attemptId = options.attemptId || createId('attempt');
  const artifactRoot = inferArtifactRootFromPath(options.specPath) || path.join(options.projectRoot, '.figma-react-restore');
  const specDir = path.dirname(path.resolve(options.specPath));
  const outputDir = path.resolve(options.outputDir || path.join(artifactRoot, 'verify', attemptId));
  fs.mkdirSync(outputDir, { recursive: true });

  const expectedPath = resolveReferencePath(spec.baselineScreenshot, { artifactRoot, baseDir: specDir, cwd: options.projectRoot });
  const actualPath = path.join(outputDir, 'actual.png');
  const diffPath = path.join(outputDir, 'diff.png');
  const capture = await captureRoute({
    route: options.route || spec.route,
    viewport: spec.viewport,
    outputPath: actualPath,
    ...(options.waitMs !== undefined ? { waitMs: options.waitMs } : {}),
  });
  const fullPageCompare = await compareImages(expectedPath, capture.screenshotPath, diffPath);

  const regionResults: RegionResult[] = [];
  const failures: Failure[] = [];
  for (const region of spec.regions.filter((item) => item.strictness !== 'ignored')) {
    const result = await compareRegion(region, expectedPath, actualPath, outputDir, spec.thresholds.regionMaxDiffRatio);
    regionResults.push(result);
    if (result.status === 'failed') {
      failures.push(buildRegionFailure(region, result));
    }
  }

  const domResults = buildDomResults(spec, capture.domNodes, spec.thresholds.boxTolerancePx);
  for (const result of domResults) {
    if (result.status === 'failed' || result.status === 'missing') {
      failures.push({
        failureId: createId('failure'),
        category: 'layout-spacing',
        severity: result.status === 'missing' ? 'high' : 'medium',
        message: result.message || 'DOM node does not match Figma region',
        ...(result.nodeId ? { nodeId: result.nodeId } : {}),
        selector: result.selector,
        ...(result.box ? { actual: { box: result.box } } : {}),
      });
    }
  }

  for (const issue of capture.overflowIssues) {
    failures.push({
      failureId: createId('failure'),
      category: 'overflow-clipping',
      severity: 'medium',
      message: 'Element clips overflowing content',
      selector: issue.selector,
      actual: issue,
    });
  }

  for (const issue of capture.missingAssets) {
    failures.push({
      failureId: createId('failure'),
      category: 'asset-missing',
      severity: 'high',
      message: issue.message,
      selector: issue.selector,
      actual: { src: issue.src },
    });
  }

  for (const request of capture.failedRequests.slice(0, 20)) {
    failures.push({
      failureId: createId('failure'),
      category: 'blocked-environment',
      severity: 'medium',
      message: `Request failed while rendering route: ${request.url}`,
      actual: request,
    });
  }

  if (fullPageCompare.diffRatio > spec.thresholds.fullPageMaxDiffRatio) {
    failures.push({
      failureId: createId('failure'),
      category: fullPageCompare.width !== spec.viewport.width ? 'scale-mismatch' : 'layout-spacing',
      severity: fullPageCompare.diffRatio > 0.2 ? 'critical' : 'high',
      message: `Full-page diff ratio ${formatRatio(fullPageCompare.diffRatio)} exceeds threshold ${formatRatio(spec.thresholds.fullPageMaxDiffRatio)}`,
      evidencePath: relativeArtifactPath(artifactRoot, diffPath),
      expected: { path: relativeArtifactPath(artifactRoot, expectedPath) },
      actual: { path: relativeArtifactPath(artifactRoot, actualPath) },
    });
  }

  const blocked = failures.some((failure) => failure.category === 'blocked-environment' && failure.severity === 'critical');
  const report = verifyReportSchema.parse({
    schemaVersion: 1,
    status: blocked ? 'blocked' : failures.length === 0 ? 'passed' : 'failed',
    attemptId,
    route: options.route || spec.route,
    viewport: spec.viewport,
    fullPage: {
      diffRatio: fullPageCompare.diffRatio,
      diffPixels: fullPageCompare.diffPixels,
      expectedPath: relativeArtifactPath(artifactRoot, expectedPath),
      actualPath: relativeArtifactPath(artifactRoot, actualPath),
      diffPath: relativeArtifactPath(artifactRoot, diffPath),
    },
    regionResults,
    domResults,
    failures,
    warnings: [],
  });
  const reportPath = path.join(outputDir, 'report.json');
  writeJsonFile(reportPath, report);
  return { report, reportPath };
}

export function addVerifyReportArtifact(store: ArtifactStore, runId: string, reportPath: string): void {
  const relative = relativeArtifactPath(store.artifactRoot, reportPath);
  store.addArtifact(runId, {
    artifactId: createId('art'),
    kind: 'verify-report',
    path: relative,
    mediaType: 'application/json',
  });
}

async function compareRegion(region: Region, expectedPath: string, actualPath: string, outputDir: string, threshold: number): Promise<RegionResult> {
  const safeId = region.regionId.replace(/[^a-zA-Z0-9._-]+/g, '-');
  const expectedCrop = path.join(outputDir, 'regions', `${safeId}.expected.png`);
  const actualCrop = path.join(outputDir, 'regions', `${safeId}.actual.png`);
  const diffCrop = path.join(outputDir, 'regions', `${safeId}.diff.png`);
  const expectedOk = await cropImage(expectedPath, region.box, expectedCrop);
  const actualOk = await cropImage(actualPath, region.box, actualCrop);
  if (!expectedOk || !actualOk) {
    return {
      regionId: region.regionId,
      ...(region.nodeId ? { nodeId: region.nodeId } : {}),
      diffRatio: 1,
      diffPixels: 0,
      totalPixels: 0,
      status: 'skipped',
    };
  }
  const compare = await compareImages(expectedCrop, actualCrop, diffCrop);
  return {
    regionId: region.regionId,
    ...(region.nodeId ? { nodeId: region.nodeId } : {}),
    diffRatio: compare.diffRatio,
    diffPixels: compare.diffPixels,
    totalPixels: compare.totalPixels,
    expectedPath: expectedCrop,
    actualPath: actualCrop,
    diffPath: diffCrop,
    status: compare.diffRatio <= threshold ? 'passed' : 'failed',
  };
}

function buildRegionFailure(region: Region, result: RegionResult): Failure {
  return {
    failureId: createId('failure'),
    category: region.kind === 'text' ? 'typography' : region.kind === 'image' ? 'asset-crop' : 'layout-spacing',
    severity: result.diffRatio > 0.2 ? 'high' : 'medium',
    message: `Region ${region.name || region.regionId} diff ratio ${formatRatio(result.diffRatio)} exceeds threshold`,
    regionId: region.regionId,
    ...(region.nodeId ? { nodeId: region.nodeId } : {}),
    ...(result.diffPath ? { evidencePath: result.diffPath } : {}),
    expected: { box: region.box },
    actual: { diffRatio: result.diffRatio, diffPixels: result.diffPixels },
  };
}

function buildDomResults(spec: FidelitySpec, nodes: { nodeId: string; selector: string; box: Box; computed: Record<string, string> }[], tolerance: number): DomResult[] {
  const byNode = new Map(nodes.map((node) => [node.nodeId, node]));
  const results: DomResult[] = [];
  for (const region of spec.regions) {
    if (!region.nodeId || region.strictness === 'ignored') continue;
    const node = byNode.get(region.nodeId);
    const selector = `[data-figma-node="${region.nodeId}"]`;
    if (!node) {
      results.push({ nodeId: region.nodeId, selector, status: 'missing', message: 'Missing DOM element with data-figma-node' });
      continue;
    }
    const mismatch = boxMismatch(region.box, node.box, tolerance);
    results.push({
      nodeId: region.nodeId,
      selector: node.selector,
      status: mismatch ? 'failed' : 'passed',
      box: node.box,
      computed: node.computed,
      ...(mismatch ? { message: mismatch } : {}),
    });
  }
  return results;
}

function boxMismatch(expected: Box, actual: Box, tolerance: number): string | null {
  const deltas = {
    x: Math.abs(expected.x - actual.x),
    y: Math.abs(expected.y - actual.y),
    w: Math.abs(expected.w - actual.w),
    h: Math.abs(expected.h - actual.h),
  };
  const failed = Object.entries(deltas).filter(([, delta]) => delta > tolerance);
  if (failed.length === 0) return null;
  return `DOM box differs from Figma box beyond ${tolerance}px: ${failed.map(([key, delta]) => `${key}+${delta.toFixed(1)}`).join(', ')}`;
}

function formatRatio(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}
