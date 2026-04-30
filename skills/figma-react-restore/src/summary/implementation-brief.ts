import fs from 'node:fs';
import path from 'node:path';
import { readJsonFile, readJsonIfExists, writeJsonFile } from '../json.js';
import { inferArtifactRootFromPath } from '../paths.js';
import { inspectReactProject, type SourceFileCandidate, type SourceOwnershipInfo } from '../react/project.js';
import {
  minimalDesignIrSchema,
  textManifestSchema,
  verifyReportSchema,
  type AssetEvidence,
  type Box,
  type ColorEvidence,
  type LayoutHint,
  type MinimalDesignIR,
  type Region,
  type TextEvidence,
  type TextManifest,
  type TypographyEvidence,
  type VerifyReport,
  type Viewport,
  type Warning,
} from '../schema.js';
import { assetDisplayName, assetImplementationPolicy } from '../verify/assets.js';

export type ImplementationBrief = {
  schemaVersion: 1;
  kind: 'implementation-brief';
  runId?: string;
  attemptId: string;
  route: string;
  viewport: Viewport;
  evidenceLevel?: MinimalDesignIR['evidenceLevel'];
  artifactPaths: {
    reportPath?: string;
    designIrPath?: string;
    textManifestPath?: string;
    agentBriefPath?: string;
    responsiveSmokePath?: string;
  };
  project?: {
    root: string;
    packageManager: string;
    likelyFramework: string;
    scripts: Record<string, string>;
    warnings: string[];
    sourceOwnership: SourceOwnershipInfo;
  };
  designSummary: {
    page?: { pageId?: string; pageName?: string; width?: number; height?: number };
    counts: {
      regions: number;
      texts: number;
      assets: number;
      colors: number;
      typography: number;
      layoutHints: number;
    };
  };
  structureTree: StructureNode[];
  keySections: KeySection[];
  assetManifest: AssetManifest;
  tokens: TokenSummary;
  layoutConstraints: LayoutConstraint[];
  componentBoundaries: ComponentBoundary[];
  likelySourceFiles: SourceFileCandidate[];
  responsive: ResponsiveBrief;
  warnings: Warning[];
};

export type StructureNode = {
  nodeId?: string;
  name?: string;
  kind?: Region['kind'];
  box?: Box;
  layout?: CompactLayout;
  counts?: { texts?: number; assets?: number };
  children?: StructureNode[];
};

export type KeySection = {
  regionId: string;
  nodeId?: string;
  name?: string;
  kind: Region['kind'];
  mapping?: string;
  box: Box;
  layout?: CompactLayout;
  textPreview: string[];
  assetCount: number;
};

export type AssetManifest = {
  summary: {
    mustUseExtractedAsset: number;
    semanticEquivalentAllowed: number;
    referenceOnly: number;
  };
  items: Array<{
    nodeId?: string;
    name: string;
    kind: AssetEvidence['kind'];
    sourceKind: AssetEvidence['sourceKind'];
    preferredFormat: AssetEvidence['preferredFormat'];
    allowedUse: AssetEvidence['allowedUse'];
    policy: ReturnType<typeof assetImplementationPolicy>;
    path?: string;
    fallbackPath?: string;
    equivalenceConditions?: string[];
  }>;
};

export type TokenSummary = {
  colors: Array<ColorEvidence & { usage?: string }>;
  typography: Array<TypographyEvidence & { count: number; sampleNodeIds: string[] }>;
  spacing: number[];
  radii: Array<NonNullable<LayoutHint['radius']>>;
  effects: Array<{ value: unknown; count: number }>;
};

export type LayoutConstraint = {
  nodeId?: string;
  name?: string;
  box?: Box;
  display?: string;
  direction?: string;
  gap?: number;
  padding?: LayoutHint['padding'];
  alignment?: LayoutHint['alignment'];
  sizing?: LayoutHint['sizing'];
  constraints?: Record<string, unknown>;
  wrap?: string;
  clipsContent?: boolean;
  zIndex?: number;
};

export type ComponentBoundary = {
  nodeId?: string;
  name: string;
  suggestedComponentName: string;
  kind: Region['kind'];
  box?: Box;
  reason: string;
  likelyFiles: SourceFileCandidate[];
};

export type ResponsiveBrief = {
  baselineViewport: Viewport;
  smokeStatus: 'not-run' | 'passed' | 'failed';
  smokeReportPath?: string;
  suggestedViewports: Array<{ name: string; viewport: Viewport; purpose: string }>;
  notes: string[];
};

type CompactLayout = Pick<LayoutConstraint, 'display' | 'direction' | 'gap' | 'padding' | 'alignment' | 'sizing' | 'constraints' | 'wrap' | 'clipsContent' | 'zIndex'>;

export type ImplementationBriefOptions = {
  report: VerifyReport;
  designIr?: MinimalDesignIR;
  textManifest?: TextManifest;
  reportPath?: string;
  designIrPath?: string;
  textManifestPath?: string;
  agentBriefPath?: string;
  responsiveSmokePath?: string;
  projectRoot?: string;
  maxTreeDepth?: number;
  maxTreeChildren?: number;
  maxSections?: number;
  maxAssets?: number;
  maxLayoutConstraints?: number;
};

const DEFAULT_MAX_TREE_DEPTH = 4;
const DEFAULT_MAX_TREE_CHILDREN = 8;
const DEFAULT_MAX_SECTIONS = 10;
const DEFAULT_MAX_ASSETS = 24;
const DEFAULT_MAX_LAYOUT_CONSTRAINTS = 16;

export function createImplementationBrief(options: ImplementationBriefOptions): ImplementationBrief {
  const project = options.projectRoot ? inspectReactProject(options.projectRoot, { route: options.report.route }) : undefined;
  const warnings = [
    ...(options.designIr?.warnings || []),
    ...(options.textManifest?.warnings || []),
    ...(!options.designIr ? [{
      code: 'IMPLEMENTATION_BRIEF_NO_DESIGN_IR',
      message: 'DesignIR was not found; implementation brief is limited to verify report and project discovery.',
    }] : []),
  ];
  const responsiveSmoke = options.responsiveSmokePath ? readJsonIfExists<{ status?: string }>(options.responsiveSmokePath) : null;
  const brief: ImplementationBrief = {
    schemaVersion: 1,
    kind: 'implementation-brief',
    ...(options.report.runId ? { runId: options.report.runId } : {}),
    attemptId: options.report.attemptId,
    route: options.report.route,
    viewport: options.report.viewport,
    ...(options.designIr?.evidenceLevel ? { evidenceLevel: options.designIr.evidenceLevel } : {}),
    artifactPaths: {
      ...(options.reportPath ? { reportPath: options.reportPath } : {}),
      ...(options.designIrPath ? { designIrPath: options.designIrPath } : {}),
      ...(options.textManifestPath ? { textManifestPath: options.textManifestPath } : {}),
      ...(options.agentBriefPath ? { agentBriefPath: options.agentBriefPath } : {}),
      ...(options.responsiveSmokePath ? { responsiveSmokePath: options.responsiveSmokePath } : {}),
    },
    ...(project ? {
      project: {
        root: project.root,
        packageManager: project.packageManager,
        likelyFramework: project.likelyFramework,
        scripts: project.scripts,
        warnings: project.warnings,
        sourceOwnership: project.sourceOwnership,
      },
    } : {}),
    designSummary: designSummary(options.designIr),
    structureTree: buildStructureTree(options.designIr, {
      maxDepth: options.maxTreeDepth || DEFAULT_MAX_TREE_DEPTH,
      maxChildren: options.maxTreeChildren || DEFAULT_MAX_TREE_CHILDREN,
    }),
    keySections: buildKeySections(options.designIr, options.maxSections || DEFAULT_MAX_SECTIONS),
    assetManifest: buildAssetManifest(options.designIr, options.maxAssets || DEFAULT_MAX_ASSETS),
    tokens: buildTokenSummary(options.designIr),
    layoutConstraints: buildLayoutConstraints(options.designIr, options.maxLayoutConstraints || DEFAULT_MAX_LAYOUT_CONSTRAINTS),
    componentBoundaries: buildComponentBoundaries(options.designIr, project?.sourceOwnership.likelyFiles || []),
    likelySourceFiles: project?.sourceOwnership.likelyFiles || [],
    responsive: buildResponsiveBrief(options.report.viewport, responsiveSmoke, options.responsiveSmokePath),
    warnings,
  };
  return brief;
}

export function createImplementationBriefFromFiles(options: {
  reportPath: string;
  designIrPath?: string;
  textManifestPath?: string;
  agentBriefPath?: string;
  responsiveSmokePath?: string;
  outputPath?: string;
  projectRoot?: string;
}): { brief: ImplementationBrief; briefPath: string } {
  const report = verifyReportSchema.parse(readJsonFile(options.reportPath));
  const designIrPath = resolveDesignIrPath(options.reportPath, report.runId, options.designIrPath);
  const textManifestPath = resolveTextManifestPath(options.reportPath, report.runId, options.textManifestPath);
  const responsiveSmokePath = options.responsiveSmokePath || resolveResponsiveSmokePath(options.reportPath);
  const designIr = designIrPath ? minimalDesignIrSchema.parse(readJsonFile(designIrPath)) : undefined;
  const textManifest = textManifestPath ? textManifestSchema.parse(readJsonFile(textManifestPath)) : undefined;
  const brief = createImplementationBrief({
    report,
    ...(designIr ? { designIr } : {}),
    ...(textManifest ? { textManifest } : {}),
    reportPath: options.reportPath,
    ...(designIrPath ? { designIrPath } : {}),
    ...(textManifestPath ? { textManifestPath } : {}),
    ...(options.agentBriefPath ? { agentBriefPath: options.agentBriefPath } : {}),
    ...(responsiveSmokePath ? { responsiveSmokePath } : {}),
    ...(options.projectRoot ? { projectRoot: options.projectRoot } : {}),
  });
  const briefPath = options.outputPath || path.join(path.dirname(options.reportPath), 'implementation-brief.json');
  writeJsonFile(briefPath, brief);
  return { brief, briefPath };
}

function resolveDesignIrPath(reportPath: string, runId?: string, explicitPath?: string): string | undefined {
  if (explicitPath) return explicitPath;
  const artifactRoot = inferArtifactRootFromPath(reportPath);
  if (artifactRoot && runId) {
    const candidate = path.join(artifactRoot, 'runs', runId, 'design-ir.json');
    if (fs.existsSync(candidate)) return candidate;
  }
  return findSiblingUpwards(reportPath, 'design-ir.json');
}

function resolveTextManifestPath(reportPath: string, runId?: string, explicitPath?: string): string | undefined {
  if (explicitPath) return explicitPath;
  const artifactRoot = inferArtifactRootFromPath(reportPath);
  if (artifactRoot && runId) {
    const candidate = path.join(artifactRoot, 'runs', runId, 'text-manifest.json');
    if (fs.existsSync(candidate)) return candidate;
  }
  return findSiblingUpwards(reportPath, 'text-manifest.json');
}

function resolveResponsiveSmokePath(reportPath: string): string | undefined {
  const candidate = path.join(path.dirname(reportPath), 'responsive-smoke.json');
  return fs.existsSync(candidate) ? candidate : undefined;
}

function findSiblingUpwards(filePath: string, fileName: string): string | undefined {
  let current = path.dirname(filePath);
  for (let index = 0; index < 6; index += 1) {
    const candidate = path.join(current, fileName);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}

function designSummary(ir?: MinimalDesignIR): ImplementationBrief['designSummary'] {
  return {
    ...(ir?.page ? { page: compactPage(ir.page) } : {}),
    counts: {
      regions: ir?.regions.length || 0,
      texts: ir?.texts.length || 0,
      assets: ir?.assets.length || 0,
      colors: ir?.colors.length || 0,
      typography: ir?.typography.length || 0,
      layoutHints: ir?.layoutHints.length || 0,
    },
  };
}

function compactPage(page: MinimalDesignIR['page']): { pageId?: string; pageName?: string; width?: number; height?: number } {
  return {
    ...(page.pageId ? { pageId: page.pageId } : {}),
    ...(page.pageName ? { pageName: page.pageName } : {}),
    ...(page.width !== undefined ? { width: round(page.width) } : {}),
    ...(page.height !== undefined ? { height: round(page.height) } : {}),
  };
}

function buildStructureTree(ir: MinimalDesignIR | undefined, options: { maxDepth: number; maxChildren: number }): StructureNode[] {
  if (!ir) return [];
  const hintsByNode = new Map(ir.layoutHints.filter((hint) => hint.nodeId).map((hint) => [hint.nodeId!, hint]));
  const regionsByNode = new Map(ir.regions.filter((region) => region.nodeId).map((region) => [region.nodeId!, region]));
  const childrenByParent = new Map<string, LayoutHint[]>();
  for (const hint of ir.layoutHints) {
    if (!hint.nodeId || !hint.parentNodeId) continue;
    const children = childrenByParent.get(hint.parentNodeId) || [];
    children.push(hint);
    childrenByParent.set(hint.parentNodeId, children);
  }
  const roots = ir.layoutHints.filter((hint) => hint.nodeId && (!hint.parentNodeId || !hintsByNode.has(hint.parentNodeId)));
  if (roots.length === 0) {
    return ir.regions
      .filter((region) => region.kind === 'page' || region.kind === 'section' || region.kind === 'component')
      .sort(compareByPosition)
      .slice(0, options.maxChildren)
      .map((region) => structureFromRegion(region, ir));
  }
  return roots.sort(compareHintByPosition).slice(0, options.maxChildren).map((hint) =>
    structureFromHint(hint, ir, regionsByNode, childrenByParent, 1, options)
  );
}

function structureFromHint(
  hint: LayoutHint,
  ir: MinimalDesignIR,
  regionsByNode: Map<string, Region>,
  childrenByParent: Map<string, LayoutHint[]>,
  depth: number,
  options: { maxDepth: number; maxChildren: number }
): StructureNode {
  const region = hint.nodeId ? regionsByNode.get(hint.nodeId) : undefined;
  const children = hint.nodeId ? (childrenByParent.get(hint.nodeId) || []) : [];
  const name = hint.name || region?.name;
  const box = hint.box || region?.box;
  const node: StructureNode = {
    ...(hint.nodeId ? { nodeId: hint.nodeId } : {}),
    ...(name ? { name } : {}),
    ...(region?.kind ? { kind: region.kind } : {}),
    ...(box ? { box: compactBox(box) } : {}),
    ...compactLayoutProperty(hint),
    ...nodeCountsProperty(hint.nodeId, box, ir),
  };
  if (children.length > 0 && depth < options.maxDepth) {
    node.children = children.sort(compareHintByPosition).slice(0, options.maxChildren).map((child) =>
      structureFromHint(child, ir, regionsByNode, childrenByParent, depth + 1, options)
    );
  }
  return node;
}

function structureFromRegion(region: Region, ir: MinimalDesignIR): StructureNode {
  return {
    ...(region.nodeId ? { nodeId: region.nodeId } : {}),
    ...(region.name ? { name: region.name } : {}),
    kind: region.kind,
    box: compactBox(region.box),
    ...nodeCountsProperty(region.nodeId, region.box, ir),
  };
}

function buildKeySections(ir: MinimalDesignIR | undefined, limit: number): KeySection[] {
  if (!ir) return [];
  const hintByNode = new Map(ir.layoutHints.filter((hint) => hint.nodeId).map((hint) => [hint.nodeId!, hint]));
  return ir.regions
    .filter((region) => region.strictness !== 'ignored' && (region.kind === 'page' || region.kind === 'section' || region.kind === 'component'))
    .sort(compareBySectionImportance(ir.page.width || 0, ir.page.height || 0))
    .slice(0, limit)
    .map((region) => {
      const hint = region.nodeId ? hintByNode.get(region.nodeId) : undefined;
      return {
        regionId: region.regionId,
        ...(region.nodeId ? { nodeId: region.nodeId } : {}),
        ...(region.name ? { name: region.name } : {}),
        kind: region.kind,
        ...(region.mapping ? { mapping: region.mapping } : {}),
        box: compactBox(region.box),
        ...compactLayoutProperty(hint),
        textPreview: textsInBox(ir.texts, region.box).slice(0, 5).map((text) => truncate(normalizeText(text.text), 100)),
        assetCount: assetsForNodeOrBox(ir.assets, region.nodeId, region.box, ir.regions).length,
      };
    });
}

function buildAssetManifest(ir: MinimalDesignIR | undefined, limit: number): AssetManifest {
  if (!ir) return { summary: { mustUseExtractedAsset: 0, semanticEquivalentAllowed: 0, referenceOnly: 0 }, items: [] };
  const items = ir.assets.slice(0, limit).map((asset) => {
    const name = assetDisplayName(asset, ir.regions);
    const policy = assetImplementationPolicy(asset, { regions: ir.regions });
    return {
      ...(asset.nodeId ? { nodeId: asset.nodeId } : {}),
      name,
      kind: asset.kind,
      sourceKind: asset.sourceKind,
      preferredFormat: asset.preferredFormat,
      allowedUse: asset.allowedUse,
      policy,
      ...(asset.path ? { path: asset.path } : {}),
      ...(asset.fallbackPath ? { fallbackPath: asset.fallbackPath } : {}),
      ...(policy === 'semantic-equivalent-allowed' ? {
        equivalenceConditions: [
          'map the DOM element or stable wrapper with data-figma-node',
          'keep the corresponding region visual check passing',
          'do not render any reference-only Figma export',
          'use an existing icon component, inline SVG, CSS mask, or sprite symbol when it is semantically equivalent',
        ],
      } : {}),
    };
  });
  return {
    summary: {
      mustUseExtractedAsset: items.filter((item) => item.policy === 'must-use-extracted-asset').length,
      semanticEquivalentAllowed: items.filter((item) => item.policy === 'semantic-equivalent-allowed').length,
      referenceOnly: items.filter((item) => item.policy === 'reference-only-forbidden').length,
    },
    items,
  };
}

function buildTokenSummary(ir: MinimalDesignIR | undefined): TokenSummary {
  if (!ir) return { colors: [], typography: [], spacing: [], radii: [], effects: [] };
  return {
    colors: ir.colors.slice().sort((a, b) => (b.count || 0) - (a.count || 0)).slice(0, 20),
    typography: groupTypography(ir.typography, ir.texts).slice(0, 16),
    spacing: collectSpacing(ir.layoutHints).slice(0, 24),
    radii: collectRadii(ir.layoutHints).slice(0, 16),
    effects: collectEffects(ir.layoutHints).slice(0, 12),
  };
}

function buildLayoutConstraints(ir: MinimalDesignIR | undefined, limit: number): LayoutConstraint[] {
  if (!ir) return [];
  return ir.layoutHints
    .filter((hint) => hint.display || hint.direction || hint.gap !== undefined || hint.padding !== undefined || hint.constraints || hint.sizing || hint.wrap || hint.clipsContent !== undefined)
    .sort(compareHintByPosition)
    .slice(0, limit)
    .map((hint) => ({
      ...(hint.nodeId ? { nodeId: hint.nodeId } : {}),
      ...(hint.name ? { name: hint.name } : {}),
      ...(hint.box ? { box: compactBox(hint.box) } : {}),
      ...(hint.display ? { display: hint.display } : {}),
      ...(hint.direction ? { direction: hint.direction } : {}),
      ...(hint.gap !== undefined ? { gap: hint.gap } : {}),
      ...(hint.padding !== undefined ? { padding: hint.padding } : {}),
      ...(hint.alignment ? { alignment: hint.alignment } : {}),
      ...(hint.sizing ? { sizing: hint.sizing } : {}),
      ...(hint.constraints ? { constraints: hint.constraints } : {}),
      ...(hint.wrap ? { wrap: hint.wrap } : {}),
      ...(hint.clipsContent !== undefined ? { clipsContent: hint.clipsContent } : {}),
      ...(hint.zIndex !== undefined ? { zIndex: hint.zIndex } : {}),
    }));
}

function buildComponentBoundaries(ir: MinimalDesignIR | undefined, likelyFiles: SourceFileCandidate[]): ComponentBoundary[] {
  if (!ir) return [];
  const pageArea = Math.max(1, (ir.page.width || 0) * (ir.page.height || 0));
  return ir.regions
    .filter((region) => region.strictness !== 'ignored' && (region.kind === 'component' || region.kind === 'section' || area(region.box) / pageArea >= 0.08))
    .sort(compareByPosition)
    .slice(0, 12)
    .map((region, index) => ({
      ...(region.nodeId ? { nodeId: region.nodeId } : {}),
      name: region.name || `${region.kind}-${index + 1}`,
      suggestedComponentName: toComponentName(region.name || `${region.kind}-${index + 1}`),
      kind: region.kind,
      box: compactBox(region.box),
      reason: region.kind === 'component'
        ? 'Figma component/instance boundary'
        : region.kind === 'section'
          ? 'Large named section boundary suitable for a React component'
          : 'Large visual area that should not be implemented as a screenshot slice',
      likelyFiles: likelyFiles.filter((file) => file.kind === 'component' || /component|section|route/.test(file.kind)).slice(0, 5),
    }));
}

function buildResponsiveBrief(viewport: Viewport, smokeReport: { status?: string } | null, smokeReportPath?: string): ResponsiveBrief {
  const smokeStatus = smokeReport?.status === 'passed' ? 'passed' : smokeReport?.status === 'failed' ? 'failed' : 'not-run';
  return {
    baselineViewport: viewport,
    smokeStatus,
    ...(smokeReportPath ? { smokeReportPath } : {}),
    suggestedViewports: [
      { name: 'mobile', viewport: { width: 390, height: 844, dpr: 2 }, purpose: 'Final route smoke: no clipped content, missing assets, or wrong route state on mobile.' },
      { name: 'tablet', viewport: { width: 768, height: 1024, dpr: 1 }, purpose: 'Final route smoke: tablet layout still uses live DOM and scales sections sensibly.' },
    ],
    notes: smokeStatus === 'not-run'
      ? ['Run verify with --responsive-smoke for opt-in mobile/tablet smoke evidence; desktop visual fidelity remains the default gate.']
      : ['Responsive smoke is route-state/overflow/asset-health evidence, not a Figma visual diff unless mobile/tablet baselines are supplied later.'],
  };
}

function compactLayoutProperty(hint?: LayoutHint): { layout?: CompactLayout } {
  if (!hint) return {};
  const layout = {
    ...(hint.display ? { display: hint.display } : {}),
    ...(hint.direction ? { direction: hint.direction } : {}),
    ...(hint.gap !== undefined ? { gap: hint.gap } : {}),
    ...(hint.padding !== undefined ? { padding: hint.padding } : {}),
    ...(hint.alignment ? { alignment: hint.alignment } : {}),
    ...(hint.sizing ? { sizing: hint.sizing } : {}),
    ...(hint.constraints ? { constraints: hint.constraints } : {}),
    ...(hint.wrap ? { wrap: hint.wrap } : {}),
    ...(hint.clipsContent !== undefined ? { clipsContent: hint.clipsContent } : {}),
    ...(hint.zIndex !== undefined ? { zIndex: hint.zIndex } : {}),
  };
  return Object.keys(layout).length > 0 ? { layout } : {};
}

function nodeCountsProperty(nodeId: string | undefined, box: Box | undefined, ir: MinimalDesignIR): { counts?: { texts?: number; assets?: number } } {
  const texts = nodeId
    ? ir.texts.filter((text) => text.nodeId === nodeId).length
    : box ? textsInBox(ir.texts, box).length : 0;
  const assets = assetsForNodeOrBox(ir.assets, nodeId, box, ir.regions).length;
  const counts = {
    ...(texts > 0 ? { texts } : {}),
    ...(assets > 0 ? { assets } : {}),
  };
  return Object.keys(counts).length > 0 ? { counts } : {};
}

function textsInBox(texts: TextEvidence[], box: Box): TextEvidence[] {
  return texts.filter((text) => text.box && containsBox(box, text.box));
}

function assetsForNodeOrBox(assets: AssetEvidence[], nodeId: string | undefined, box: Box | undefined, regions: Region[]): AssetEvidence[] {
  return assets.filter((asset) => {
    if (nodeId && asset.nodeId === nodeId) return true;
    if (!box || !asset.nodeId) return false;
    const region = regions.find((item) => item.nodeId === asset.nodeId || item.regionId === asset.nodeId);
    return Boolean(region && containsBox(box, region.box));
  });
}

function containsBox(parent: Box, child: Box): boolean {
  return child.x >= parent.x - 1
    && child.y >= parent.y - 1
    && child.x + child.w <= parent.x + parent.w + 1
    && child.y + child.h <= parent.y + parent.h + 1;
}

function groupTypography(typography: TypographyEvidence[], texts: TextEvidence[]): Array<TypographyEvidence & { count: number; sampleNodeIds: string[] }> {
  const groups = new Map<string, TypographyEvidence & { count: number; sampleNodeIds: string[] }>();
  for (const item of typography.length > 0 ? typography : texts) {
    const key = [
      item.fontFamily || '',
      item.fontSize ?? '',
      item.fontWeight ?? '',
      item.lineHeight ?? '',
      item.letterSpacing ?? '',
    ].join('|');
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      if (item.nodeId && existing.sampleNodeIds.length < 4) existing.sampleNodeIds.push(item.nodeId);
    } else {
      groups.set(key, {
        ...(item.fontFamily ? { fontFamily: item.fontFamily } : {}),
        ...(item.fontSize !== undefined ? { fontSize: item.fontSize } : {}),
        ...(item.fontWeight !== undefined ? { fontWeight: item.fontWeight } : {}),
        ...(item.lineHeight !== undefined ? { lineHeight: item.lineHeight } : {}),
        ...(item.letterSpacing !== undefined ? { letterSpacing: item.letterSpacing } : {}),
        count: 1,
        sampleNodeIds: item.nodeId ? [item.nodeId] : [],
      });
    }
  }
  return Array.from(groups.values()).sort((a, b) => b.count - a.count);
}

function collectSpacing(hints: LayoutHint[]): number[] {
  const values = new Set<number>();
  for (const hint of hints) {
    if (typeof hint.gap === 'number') values.add(round(hint.gap));
    if (typeof hint.padding === 'number') values.add(round(hint.padding));
    if (Array.isArray(hint.padding)) for (const value of hint.padding) values.add(round(value));
    if (hint.paddingEdges) for (const value of Object.values(hint.paddingEdges)) if (typeof value === 'number') values.add(round(value));
  }
  return Array.from(values).sort((a, b) => a - b);
}

function collectRadii(hints: LayoutHint[]): Array<NonNullable<LayoutHint['radius']>> {
  const values: Array<NonNullable<LayoutHint['radius']>> = [];
  const seen = new Set<string>();
  for (const hint of hints) {
    if (hint.radius === undefined) continue;
    const key = JSON.stringify(hint.radius);
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(hint.radius);
  }
  return values;
}

function collectEffects(hints: LayoutHint[]): Array<{ value: unknown; count: number }> {
  const counts = new Map<string, { value: unknown; count: number }>();
  for (const hint of hints) {
    for (const effect of hint.effects || []) {
      const key = JSON.stringify(effect);
      const existing = counts.get(key);
      if (existing) existing.count += 1;
      else counts.set(key, { value: effect, count: 1 });
    }
  }
  return Array.from(counts.values()).sort((a, b) => b.count - a.count);
}

function compareBySectionImportance(pageWidth: number, pageHeight: number): (a: Region, b: Region) => number {
  const pageArea = Math.max(1, pageWidth * pageHeight);
  return (a, b) => {
    const kindDelta = sectionKindRank(a.kind) - sectionKindRank(b.kind);
    if (kindDelta !== 0) return kindDelta;
    const areaDelta = Math.min(1, area(b.box) / pageArea) - Math.min(1, area(a.box) / pageArea);
    if (Math.abs(areaDelta) > 0.001) return areaDelta;
    return compareByPosition(a, b);
  };
}

function sectionKindRank(kind: Region['kind']): number {
  if (kind === 'page') return 0;
  if (kind === 'section') return 1;
  if (kind === 'component') return 2;
  return 3;
}

function compareByPosition(a: Region, b: Region): number {
  return a.box.y - b.box.y || a.box.x - b.box.x || b.box.w * b.box.h - a.box.w * a.box.h;
}

function compareHintByPosition(a: LayoutHint, b: LayoutHint): number {
  return (a.box?.y || 0) - (b.box?.y || 0) || (a.box?.x || 0) - (b.box?.x || 0);
}

function compactBox(box: Box): Box {
  return { x: round(box.x), y: round(box.y), w: round(box.w), h: round(box.h) };
}

function area(box: Box): number {
  return Math.max(0, box.w) * Math.max(0, box.h);
}

function normalizeText(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function toComponentName(value: string): string {
  const words = value.replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const name = words.map((word) => `${word[0]!.toUpperCase()}${word.slice(1)}`).join('');
  return name || 'FigmaSection';
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}...`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
