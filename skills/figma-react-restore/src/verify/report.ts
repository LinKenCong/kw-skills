import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
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
  type AssetEvidence,
  type TextEvidence,
  type TextResult,
  type TypographyEvidence,
  type VerifyReport,
  type Warning,
} from '../schema.js';
import { captureRoute, type CapturedAssetUsage, type CapturedDomNode } from './capture.js';
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
  const outputDir = resolveVerifyOutputDir(artifactRoot, options.outputDir, attemptId);
  fs.mkdirSync(outputDir, { recursive: true });

  const expectedSourcePath = resolveReferencePath(spec.baselineScreenshot, { artifactRoot, baseDir: specDir, cwd: options.projectRoot });
  const expectedPath = path.join(outputDir, 'expected.png');
  const actualPath = path.join(outputDir, 'actual.png');
  const diffPath = path.join(outputDir, 'diff.png');
  const tracePath = path.join(outputDir, 'trace.zip');

  let capture: Awaited<ReturnType<typeof captureRoute>>;
  let fullPageCompare: Awaited<ReturnType<typeof compareImages>>;
  try {
    if (path.resolve(expectedSourcePath) !== path.resolve(expectedPath)) fs.copyFileSync(expectedSourcePath, expectedPath);
    capture = await captureRoute({
      route: options.route || spec.route,
      viewport: spec.viewport,
      outputPath: actualPath,
      tracePath,
      ...(options.waitMs !== undefined ? { waitMs: options.waitMs } : {}),
    });
    fullPageCompare = await compareImages(expectedPath, capture.screenshotPath, diffPath);
  } catch (error) {
    return writeBlockedEnvironmentReport({
      error,
      spec,
      route: options.route || spec.route,
      attemptId,
      outputDir,
      artifactRoot,
      expectedPath,
      actualPath,
      diffPath,
    });
  }

  const regionResults: RegionResult[] = [];
  const failures: Failure[] = [];
  const warnings: Warning[] = [];
  for (const region of spec.regions.filter((item) => item.strictness !== 'ignored')) {
    const result = await compareRegion(region, expectedPath, actualPath, outputDir, artifactRoot, spec.thresholds.regionMaxDiffRatio);
    regionResults.push(result);
  }

  const domResults = buildDomResults(spec, capture.domNodes, spec.thresholds.boxTolerancePx);
  const textResults = buildTextResults(spec, capture.domNodes, capture.visibleText);
  const textFailures = buildTextFailures(textResults);
  const styleFailures = buildStyleFailures(spec, domResults);
  failures.push(...textFailures);
  failures.push(...styleFailures);
  failures.push(...buildRegionFailures({
    spec,
    regionResults,
    domResults,
    textResults,
    styleFailures,
    warnings,
  }));
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

  failures.push(...buildAssetUsageFailures(spec.assets || [], capture.assetUsages));

  for (const issue of capture.rasterOverlayIssues) {
    failures.push({
      failureId: createId('failure'),
      category: 'screenshot-overlay',
      severity: issue.areaRatio >= 0.55 ? 'critical' : 'high',
      message: `Potential prohibited screenshot or large-raster overlay detected: ${issue.reason}`,
      selector: issue.selector,
      actual: issue,
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

  if (spec.evidenceLevel === 'L1-visual-only' || spec.evidenceLevel === 'L0-blocked' || spec.regions.length === 0) {
    warnings.push({
      code: 'INSUFFICIENT_DESIGN_DATA',
      message: 'Structured Figma node/region evidence is missing or incomplete; high-confidence restoration is blocked.',
      hint: 'Re-extract a selected frame with node tree and screenshot evidence.',
    });
    failures.push({
      failureId: createId('failure'),
      category: 'insufficient-design-data',
      severity: 'critical',
      message: 'Verification cannot produce a high-confidence repair plan from visual-only or missing region evidence.',
      expected: { evidenceLevel: 'L3-structured or L2-partial', regions: '>0' },
      actual: { evidenceLevel: spec.evidenceLevel || 'unknown', regions: spec.regions.length },
    });
  }

  const blocked = failures.some((failure) => (failure.category === 'blocked-environment' || failure.category === 'insufficient-design-data') && failure.severity === 'critical');
  const report = verifyReportSchema.parse({
    schemaVersion: 1,
    runId: spec.runId,
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
    textResults,
    failures,
    warnings,
  });
  const reportPath = path.join(outputDir, 'report.json');
  writeJsonFile(reportPath, report);
  return { report, reportPath };
}

function resolveVerifyOutputDir(artifactRoot: string, outputDir: string | undefined, attemptId: string): string {
  const resolved = path.resolve(outputDir || path.join(artifactRoot, 'verify', attemptId));
  if (!isWithinDirectory(artifactRoot, resolved)) {
    throw new Error(`Verify output directory must stay inside artifact root: ${artifactRoot}`);
  }
  return resolved;
}

async function writeBlockedEnvironmentReport(options: {
  error: unknown;
  spec: FidelitySpec;
  route: string;
  attemptId: string;
  outputDir: string;
  artifactRoot: string;
  expectedPath: string;
  actualPath: string;
  diffPath: string;
}): Promise<{ report: VerifyReport; reportPath: string }> {
  await ensurePng(options.expectedPath, options.spec.viewport.width, options.spec.viewport.height, '#ffffff');
  await ensurePng(options.actualPath, options.spec.viewport.width, options.spec.viewport.height, '#ffffff');
  await ensurePng(options.diffPath, options.spec.viewport.width, options.spec.viewport.height, '#ff00ff');
  const message = options.error instanceof Error ? options.error.message : String(options.error);
  const report = verifyReportSchema.parse({
    schemaVersion: 1,
    runId: options.spec.runId,
    status: 'blocked',
    attemptId: options.attemptId,
    route: options.route,
    viewport: options.spec.viewport,
    fullPage: {
      diffRatio: 1,
      diffPixels: 0,
      expectedPath: relativeArtifactPath(options.artifactRoot, options.expectedPath),
      actualPath: relativeArtifactPath(options.artifactRoot, options.actualPath),
      diffPath: relativeArtifactPath(options.artifactRoot, options.diffPath),
    },
    regionResults: [],
    domResults: [],
    textResults: [],
    failures: [{
      failureId: createId('failure'),
      category: 'blocked-environment',
      severity: 'critical',
      message: `Verification environment failed before capture/diff completed: ${message}`,
      actual: { error: message },
    }],
    warnings: [{
      code: 'VERIFY_ENVIRONMENT_BLOCKED',
      message: 'Verification could not complete browser capture or image comparison.',
      hint: 'Fix route/browser/baseline screenshot availability, then rerun verification.',
    }],
  });
  const reportPath = path.join(options.outputDir, 'report.json');
  writeJsonFile(reportPath, report);
  return { report, reportPath };
}

async function ensurePng(filePath: string, width: number, height: number, background: string): Promise<void> {
  if (fs.existsSync(filePath)) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  await sharp({
    create: {
      width: Math.max(1, Math.round(width || 1)),
      height: Math.max(1, Math.round(height || 1)),
      channels: 4,
      background,
    },
  }).png().toFile(filePath);
}

function isWithinDirectory(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
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

async function compareRegion(region: Region, expectedPath: string, actualPath: string, outputDir: string, artifactRoot: string, threshold: number): Promise<RegionResult> {
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
    expectedPath: relativeArtifactPath(artifactRoot, expectedCrop),
    actualPath: relativeArtifactPath(artifactRoot, actualCrop),
    diffPath: relativeArtifactPath(artifactRoot, diffCrop),
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

export function buildRegionFailures(options: {
  spec: FidelitySpec;
  regionResults: RegionResult[];
  domResults: DomResult[];
  textResults: TextResult[];
  styleFailures: Failure[];
  warnings: Warning[];
}): Failure[] {
  const regionById = new Map(options.spec.regions.map((region) => [region.regionId, region]));
  const domByNode = new Map(options.domResults.filter((result) => result.nodeId).map((result) => [result.nodeId!, result]));
  const textByNode = new Map(options.textResults.filter((result) => result.nodeId).map((result) => [result.nodeId!, result]));
  const styleFailureNodes = new Set(options.styleFailures.filter((failure) => failure.nodeId && (failure.category === 'typography' || failure.category === 'color')).map((failure) => failure.nodeId!));
  const failures: Failure[] = [];

  for (const result of options.regionResults) {
    if (result.status !== 'failed') continue;
    const region = regionById.get(result.regionId);
    if (!region) continue;
    if (isToleratedFontRenderingDiff(region, domByNode, textByNode, styleFailureNodes)) {
      options.warnings.push({
        code: 'TEXT_PIXEL_DIFF_TOLERATED_FONT_RENDERING',
        message: `Ignored text-region pixel diff for ${region.name || region.regionId} because exact text, DOM box, and computed text styles already match.`,
        hint: 'Install the design font locally to improve text raster fidelity; otherwise continue repairing non-font layout, assets, and colors.',
      });
      continue;
    }
    failures.push(buildRegionFailure(region, result));
  }
  return failures;
}

function isToleratedFontRenderingDiff(
  region: Region,
  domByNode: Map<string, DomResult>,
  textByNode: Map<string, TextResult>,
  styleFailureNodes: Set<string>
): boolean {
  if (region.kind !== 'text' || !region.nodeId) return false;
  const text = textByNode.get(region.nodeId);
  const dom = domByNode.get(region.nodeId);
  return text?.status === 'passed' && dom?.status === 'passed' && !styleFailureNodes.has(region.nodeId);
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

export function buildTextResults(spec: FidelitySpec, nodes: CapturedDomNode[], visibleText: string): TextResult[] {
  const byNode = new Map(nodes.map((node) => [node.nodeId, node]));
  const pageText = normalizeText(visibleText);
  const results: TextResult[] = [];
  for (const text of spec.texts) {
    const expected = normalizeText(text.text);
    if (!expected) continue;
    const selector = text.nodeId ? `[data-figma-node="${text.nodeId}"]` : undefined;
    const node = text.nodeId ? byNode.get(text.nodeId) : undefined;
    if (!node) {
      const existsElsewhere = pageText.includes(expected);
      results.push({
        ...(text.nodeId ? { nodeId: text.nodeId } : {}),
        ...(selector ? { selector } : {}),
        status: existsElsewhere ? 'mapping-missing' : 'missing',
        expectedText: text.text,
        normalizedExpected: expected,
        ...(existsElsewhere ? { normalizedActual: expected } : {}),
        message: existsElsewhere
          ? 'Expected text exists in page but is not mapped with the Figma text node id'
          : 'Expected Figma text is missing from the rendered page',
      });
      continue;
    }
    const actual = bestNodeText(node);
    const normalizedActual = normalizeText(actual);
    results.push({
      ...(text.nodeId ? { nodeId: text.nodeId } : {}),
      selector: node.selector,
      status: normalizedActual === expected ? 'passed' : 'failed',
      expectedText: text.text,
      actualText: actual,
      normalizedExpected: expected,
      normalizedActual,
      ...(normalizedActual === expected ? {} : { message: 'Rendered text content differs from Figma text' }),
    });
  }
  return results;
}

function buildTextFailures(results: TextResult[]): Failure[] {
  return results.flatMap((result) => {
    if (result.status === 'passed' || result.status === 'skipped') return [];
    const severity = result.status === 'mapping-missing' ? 'medium' : 'high';
    return [{
      failureId: createId('failure'),
      category: 'text-content' as const,
      severity,
      message: result.message || 'Rendered text content does not match Figma text',
      ...(result.nodeId ? { nodeId: result.nodeId } : {}),
      ...(result.selector ? { selector: result.selector } : {}),
      expected: { text: result.normalizedExpected },
      actual: { text: result.normalizedActual || '', status: result.status },
    }];
  });
}

export function buildAssetUsageFailures(assets: AssetEvidence[], usages: CapturedAssetUsage[]): Failure[] {
  const failures: Failure[] = [];
  for (const asset of assets) {
    if (asset.kind === 'screenshot' || asset.kind === 'unknown') continue;
    const expectedRefs = [asset.path, asset.fallbackPath].filter((item): item is string => Boolean(item));
    const expectedNames = expectedRefs.map((ref) => path.basename(ref)).filter(Boolean);
    const matchingBySource = usages.filter((usage) => expectedNames.some((name) => usageContains(usage, name)));
    const matchingByNode = asset.nodeId ? usages.filter((usage) => usage.nodeId === asset.nodeId) : [];
    if (asset.allowedUse === 'reference-only') {
      if (matchingBySource.length === 0 && matchingByNode.length === 0) continue;
      failures.push({
        failureId: createId('failure'),
        category: 'screenshot-overlay',
        severity: 'high',
        message: 'Reference-only Figma node export is used as implementation content. Use it only as visual evidence; rebuild layout/text with DOM/CSS and use real implementation assets only.',
        ...(asset.nodeId ? { nodeId: asset.nodeId, selector: `[data-figma-node="${asset.nodeId}"]` } : {}),
        expected: {
          allowedUse: 'reference-only',
          sourceKind: asset.sourceKind || 'unknown',
          paths: expectedRefs,
        },
        actual: {
          matchedAssetSources: [...matchingBySource, ...matchingByNode].map((usage) => compactUsageSource(usage)).filter(Boolean).slice(0, 5),
        },
      });
      continue;
    }
    if (expectedRefs.length === 0) {
      failures.push({
        failureId: createId('failure'),
        category: 'asset-missing',
        severity: 'high',
        message: 'Figma asset evidence is missing an extracted file path; re-extract instead of drawing or inventing this image.',
        ...(asset.nodeId ? { nodeId: asset.nodeId } : {}),
        expected: { artifactId: asset.artifactId || '', fallbackArtifactId: asset.fallbackArtifactId || '' },
      });
      continue;
    }
    if (matchingBySource.length > 0) continue;
    failures.push({
      failureId: createId('failure'),
      category: 'asset-missing',
      severity: 'high',
      message: 'Expected extracted Figma image/vector asset is not used in the rendered page. Do not draw or recreate missing images; use the extracted asset or re-extract from Figma.',
      ...(asset.nodeId ? { nodeId: asset.nodeId, selector: `[data-figma-node="${asset.nodeId}"]` } : {}),
      expected: { paths: expectedRefs },
      actual: {
        matchedNodeAssetSources: matchingByNode.map((usage) => compactUsageSource(usage)).filter(Boolean).slice(0, 5),
      },
    });
  }
  return failures;
}

function usageContains(usage: CapturedAssetUsage, expectedName: string): boolean {
  const sources = [usage.source, usage.backgroundImage].filter((item): item is string => Boolean(item));
  return sources.some((source) => decodeSource(source).includes(expectedName));
}

function decodeSource(source: string): string {
  try {
    return decodeURIComponent(source);
  } catch {
    return source;
  }
}

function compactUsageSource(usage: CapturedAssetUsage): string {
  return (usage.source || usage.backgroundImage || '').slice(0, 240);
}

function buildStyleFailures(spec: FidelitySpec, domResults: DomResult[]): Failure[] {
  const failures: Failure[] = [];
  const domByNode = new Map(domResults.filter((result) => result.nodeId && result.status !== 'missing').map((result) => [result.nodeId!, result]));
  const textByNode = new Map(spec.texts.filter((text) => text.nodeId).map((text) => [text.nodeId!, text]));
  const typographyByNode = new Map(spec.typography.filter((item) => item.nodeId).map((item) => [item.nodeId!, item]));
  const colorByNode = new Map(spec.colors.filter((item) => item.nodeId).map((item) => [item.nodeId!, item]));

  for (const [nodeId, text] of textByNode) {
    const dom = domByNode.get(nodeId);
    if (!dom?.computed) continue;
    const typography = typographyByNode.get(nodeId);
    const expected = mergeTypography(text, typography);
    const mismatches = typographyMismatches(expected, dom.computed);
    if (mismatches.length > 0) {
      failures.push({
        failureId: createId('failure'),
        category: 'typography',
        severity: mismatches.some((item) => item.key === 'fontSize' || item.key === 'lineHeight') ? 'medium' : 'low',
        message: `Typography differs for text node ${nodeId}: ${mismatches.map((item) => item.key).join(', ')}`,
        nodeId,
        selector: dom.selector,
        expected: Object.fromEntries(mismatches.map((item) => [item.key, item.expected])),
        actual: Object.fromEntries(mismatches.map((item) => [item.key, item.actual])),
      });
    }
    if (text.color && !sameColor(text.color, dom.computed.color || '')) {
      failures.push({
        failureId: createId('failure'),
        category: 'color',
        severity: 'low',
        message: `Text color differs for node ${nodeId}`,
        nodeId,
        selector: dom.selector,
        expected: { color: text.color },
        actual: { color: dom.computed.color || '' },
      });
    }
  }

  for (const [nodeId, color] of colorByNode) {
    if (textByNode.has(nodeId)) continue;
    const dom = domByNode.get(nodeId);
    if (!dom?.computed) continue;
    const actual = dom.computed.backgroundColor || dom.computed.color || '';
    if (color.value && !sameColor(color.value, actual)) {
      failures.push({
        failureId: createId('failure'),
        category: 'color',
        severity: 'low',
        message: `Fill color differs for node ${nodeId}`,
        nodeId,
        selector: dom.selector,
        expected: { color: color.value },
        actual: { backgroundColor: actual },
      });
    }
  }
  return failures;
}

function mergeTypography(text: TextEvidence, typography?: TypographyEvidence): TypographyEvidence {
  return {
    nodeId: text.nodeId || typography?.nodeId,
    fontFamily: text.fontFamily || typography?.fontFamily,
    fontSize: text.fontSize ?? typography?.fontSize,
    fontWeight: text.fontWeight ?? typography?.fontWeight,
    lineHeight: text.lineHeight ?? typography?.lineHeight,
    letterSpacing: text.letterSpacing ?? typography?.letterSpacing,
  };
}

export function typographyMismatches(expected: TypographyEvidence, computed: Record<string, string>): Array<{ key: string; expected: unknown; actual: unknown }> {
  const mismatches: Array<{ key: string; expected: unknown; actual: unknown }> = [];
  const fontFamily = computed.fontFamily || '';
  const fontSize = computed.fontSize || '';
  const fontWeight = computed.fontWeight || '';
  const lineHeight = computed.lineHeight || '';
  const letterSpacing = computed.letterSpacing || '';
  if (expected.fontFamily && !fontFamily.toLowerCase().includes(expected.fontFamily.toLowerCase())) {
    mismatches.push({ key: 'fontFamily', expected: expected.fontFamily, actual: fontFamily });
  }
  if (expected.fontSize !== undefined && differsPx(expected.fontSize, fontSize, Math.max(0.75, expected.fontSize * 0.01))) {
    mismatches.push({ key: 'fontSize', expected: expected.fontSize, actual: fontSize });
  }
  if (expected.fontWeight !== undefined && Math.abs(normalizeWeight(expected.fontWeight) - normalizeWeight(fontWeight)) > 50) {
    mismatches.push({ key: 'fontWeight', expected: expected.fontWeight, actual: fontWeight });
  }
  if (expected.lineHeight !== undefined && differsLineHeight(expected.lineHeight, lineHeight, expected.fontSize, fontSize)) {
    mismatches.push({ key: 'lineHeight', expected: expected.lineHeight, actual: lineHeight });
  }
  if (expected.letterSpacing !== undefined && differsLetterSpacing(expected.letterSpacing, letterSpacing, expected.fontSize, fontSize)) {
    mismatches.push({ key: 'letterSpacing', expected: expected.letterSpacing, actual: letterSpacing });
  }
  return mismatches;
}

function differsPx(expected: number, actualCss: string, tolerance: number): boolean {
  const actual = parseCssNumber(actualCss);
  return actual === null || Math.abs(expected - actual) > tolerance;
}

function differsLineHeight(expected: string | number, actualCss: string, expectedFontSize: number | undefined, actualFontSizeCss: string): boolean {
  const actual = parseCssNumber(actualCss);
  if (actual === null) return false;
  if (typeof expected === 'number') return Math.abs(expected - actual) > Math.max(1.5, expected * 0.02);
  if (expected.endsWith('%')) {
    const fontSize = expectedFontSize ?? parseCssNumber(actualFontSizeCss);
    if (fontSize === null) return false;
    const expectedPx = (Number.parseFloat(expected) / 100) * fontSize;
    return Math.abs(expectedPx - actual) > Math.max(1.5, expectedPx * 0.02);
  }
  const expectedPx = parseCssNumber(expected);
  return expectedPx !== null && Math.abs(expectedPx - actual) > Math.max(1.5, expectedPx * 0.02);
}

function differsLetterSpacing(expected: string | number, actualCss: string, expectedFontSize: number | undefined, actualFontSizeCss: string): boolean {
  const actual = parseCssNumber(actualCss);
  if (actual === null) return false;
  if (typeof expected === 'number') return Math.abs(expected - actual) > 0.75;
  if (expected.endsWith('%')) {
    const fontSize = expectedFontSize ?? parseCssNumber(actualFontSizeCss);
    if (fontSize === null) return false;
    const expectedPx = (Number.parseFloat(expected) / 100) * fontSize;
    return Math.abs(expectedPx - actual) > Math.max(0.25, Math.abs(expectedPx) * 0.05);
  }
  const expectedPx = parseCssNumber(expected);
  return expectedPx !== null && Math.abs(expectedPx - actual) > Math.max(0.25, Math.abs(expectedPx) * 0.05);
}

function bestNodeText(node: CapturedDomNode): string {
  return node.innerText || node.textContent || node.ariaLabel || node.alt || node.value || '';
}

function normalizeText(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseCssNumber(value: string): number | null {
  const match = /-?\d+(?:\.\d+)?/.exec(value || '');
  return match ? Number.parseFloat(match[0]) : null;
}

function normalizeWeight(value: string | number): number {
  if (typeof value === 'number') return value;
  const lower = value.toLowerCase();
  if (lower === 'normal') return 400;
  if (lower === 'bold') return 700;
  const parsed = Number.parseInt(lower, 10);
  return Number.isFinite(parsed) ? parsed : 400;
}

function sameColor(expected: string, actual: string): boolean {
  const a = parseColor(expected);
  const b = parseColor(actual);
  if (!a || !b) return expected.trim().toLowerCase() === actual.trim().toLowerCase();
  return Math.abs(a.r - b.r) <= 2 && Math.abs(a.g - b.g) <= 2 && Math.abs(a.b - b.b) <= 2 && Math.abs(a.a - b.a) <= 0.02;
}

function parseColor(value: string): { r: number; g: number; b: number; a: number } | null {
  const input = value.trim().toLowerCase();
  if (input === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  const rgb = /^rgba?\(([^)]+)\)$/.exec(input);
  if (rgb) {
    const parts = rgb[1]!.split(',').map((part) => Number.parseFloat(part.trim()));
    if (parts.length >= 3 && parts.every((part) => Number.isFinite(part))) {
      return { r: parts[0]!, g: parts[1]!, b: parts[2]!, a: parts[3] ?? 1 };
    }
  }
  const hex = /^#([0-9a-f]{6}|[0-9a-f]{3})$/.exec(input);
  if (!hex) return null;
  const valueHex = hex[1]!.length === 3 ? hex[1]!.split('').map((char) => char + char).join('') : hex[1]!;
  return {
    r: Number.parseInt(valueHex.slice(0, 2), 16),
    g: Number.parseInt(valueHex.slice(2, 4), 16),
    b: Number.parseInt(valueHex.slice(4, 6), 16),
    a: 1,
  };
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
