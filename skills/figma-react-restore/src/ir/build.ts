import path from 'node:path';
import { ArtifactStore } from '../artifact/store.js';
import { readJsonFile } from '../json.js';
import {
  type Box,
  type DomMapping,
  minimalDesignIrSchema,
  rawExtractionSchema,
  textManifestSchema,
  type LayoutHint,
  type MinimalDesignIR,
  type RawExtraction,
  type RawFigmaNode,
  type Region,
  type TextEvidence,
  type TypographyEvidence,
  type Warning,
} from '../schema.js';

export function buildMinimalDesignIr(runId: string, store = new ArtifactStore()): MinimalDesignIR {
  const rawRef = store.findArtifact(runId, 'raw-extraction');
  const rawPath = rawRef ? store.resolveArtifactPath(rawRef.path) : store.getRunFile(runId, 'extraction.raw.json');
  const raw = rawExtractionSchema.parse(readJsonFile(rawPath));
  const rootBox = raw.root?.absoluteBoundingBox;
  const regions = normalizeRegions(raw.regions.length > 0 ? raw.regions : collectRegions(raw.root), rootBox);
  const texts = normalizeTexts(raw.texts.length > 0 ? raw.texts : collectTexts(raw.root), rootBox);
  const typography = raw.typography.length > 0 ? raw.typography : collectTypography(raw.root);
  const layoutHints = normalizeLayoutHints(raw.layoutHints.length > 0 ? raw.layoutHints : collectLayoutHints(raw.root), rootBox);
  const pageBox = rootBox ? { ...rootBox, x: 0, y: 0 } : regions.find((region) => region.kind === 'page')?.box;
  const evidenceLevel = chooseEvidenceLevel(raw, regions);
  const warnings = [...raw.warnings];
  if (evidenceLevel === 'L1-visual-only') {
    warnings.push({
      code: 'VISUAL_ONLY_EVIDENCE',
      message: 'Only screenshot evidence is available; V1 verification will block high-confidence restoration unless structured node evidence is re-extracted.',
    });
  }
  if (evidenceLevel === 'L0-blocked') {
    warnings.push({
      code: 'NO_USABLE_DESIGN_EVIDENCE',
      message: 'No usable Figma node tree or screenshot evidence was extracted.',
    });
  }
  const ir = minimalDesignIrSchema.parse({
    schemaVersion: 1,
    runId,
    evidenceLevel,
    page: {
      ...(raw.meta.pageId ? { pageId: raw.meta.pageId } : {}),
      ...(raw.meta.pageName ? { pageName: raw.meta.pageName } : {}),
      ...(pageBox?.w ? { width: pageBox.w } : {}),
      ...(pageBox?.h ? { height: pageBox.h } : {}),
    },
    regions,
    texts,
    assets: raw.assets,
    colors: raw.colors,
    typography,
    layoutHints,
    warnings,
  });
  store.writeRunJson(runId, 'design-ir.json', ir, { kind: 'design-ir', mediaType: 'application/json' });
  writeTextManifest(runId, ir.texts, warnings, store);
  store.updateRun(runId, { status: ir.evidenceLevel === 'L0-blocked' ? 'blocked' : 'completed' });
  return ir;
}

function writeTextManifest(runId: string, texts: TextEvidence[], warnings: Warning[], store: ArtifactStore): void {
  const manifest = textManifestSchema.parse({
    schemaVersion: 1,
    kind: 'text-manifest',
    runId,
    source: 'figma-text-nodes',
    textCount: texts.length,
    items: texts,
    warnings: warnings.filter((warning) => warning.code.startsWith('TEXT_') || warning.code.includes('TEXT')),
  });
  store.writeRunJson(runId, 'text-manifest.json', manifest, { kind: 'text-manifest', mediaType: 'application/json' });
}

function normalizeRegions(regions: Region[], rootBox?: Box): Region[] {
  return regions.map((region) => ({
    ...region,
    mapping: region.mapping || defaultMappingForRegion(region.kind, region.strictness),
    ...(rootBox ? { box: normalizeBox(region.box, rootBox) } : {}),
  }));
}

function normalizeTexts(texts: TextEvidence[], rootBox?: Box): TextEvidence[] {
  if (!rootBox) return texts;
  return texts.map((text) => ({ ...text, ...(text.box ? { box: normalizeBox(text.box, rootBox) } : {}) }));
}

function normalizeLayoutHints(hints: LayoutHint[], rootBox?: Box): LayoutHint[] {
  if (!rootBox) return hints;
  return hints.map((hint) => ({ ...hint, ...(hint.box ? { box: normalizeBox(hint.box, rootBox) } : {}) }));
}

function normalizeBox(box: Box, rootBox: Box): Box {
  return { ...box, x: box.x - rootBox.x, y: box.y - rootBox.y };
}

export function collectRegions(root?: RawFigmaNode): Region[] {
  if (!root) return [];
  const regions: Region[] = [];
  visit(root, (node, index) => {
    if (!node.absoluteBoundingBox) return;
    const kind = mapNodeKind(node, index === 0);
    const strictness = kind === 'page' || kind === 'section' ? 'layout' : kind === 'unknown' ? 'perceptual' : 'strict';
    regions.push({
      regionId: node.id,
      nodeId: node.id,
      ...(node.name ? { name: node.name } : {}),
      kind,
      box: node.absoluteBoundingBox,
      strictness,
      mapping: defaultMappingForRegion(kind, strictness),
    });
  });
  return regions;
}

export function collectTexts(root?: RawFigmaNode): TextEvidence[] {
  if (!root) return [];
  const texts: TextEvidence[] = [];
  visit(root, (node) => {
    if (!node.characters) return;
    texts.push({
      nodeId: node.id,
      ...(node.name ? { name: node.name } : {}),
      text: node.characters,
      ...(node.absoluteBoundingBox ? { box: node.absoluteBoundingBox } : {}),
      ...(typeof node.fontSize === 'number' ? { fontSize: node.fontSize } : {}),
      ...(node.fontWeight !== undefined ? { fontWeight: node.fontWeight } : {}),
      ...(typeof node.lineHeight === 'string' || typeof node.lineHeight === 'number' ? { lineHeight: node.lineHeight } : {}),
      ...(typeof node.letterSpacing === 'string' || typeof node.letterSpacing === 'number' ? { letterSpacing: node.letterSpacing } : {}),
      ...(node.textCase ? { textCase: node.textCase } : {}),
      ...(node.textAlignHorizontal ? { textAlignHorizontal: node.textAlignHorizontal } : {}),
      ...(node.textAlignVertical ? { textAlignVertical: node.textAlignVertical } : {}),
      ...(node.textAutoResize ? { textAutoResize: node.textAutoResize } : {}),
      ...fontFamilyFromFontName(node.fontName),
    });
  });
  return texts;
}

export function collectTypography(root?: RawFigmaNode): TypographyEvidence[] {
  if (!root) return [];
  const typography: TypographyEvidence[] = [];
  visit(root, (node) => {
    if (!node.characters && node.fontSize === undefined && node.fontName === undefined) return;
    typography.push({
      nodeId: node.id,
      ...(typeof node.fontSize === 'number' ? { fontSize: node.fontSize } : {}),
      ...(node.fontWeight !== undefined ? { fontWeight: node.fontWeight } : {}),
      ...fontFamilyFromFontName(node.fontName),
      ...(typeof node.lineHeight === 'string' || typeof node.lineHeight === 'number' ? { lineHeight: node.lineHeight } : {}),
      ...(typeof node.letterSpacing === 'string' || typeof node.letterSpacing === 'number' ? { letterSpacing: node.letterSpacing } : {}),
    });
  });
  return typography;
}

export function collectLayoutHints(root?: RawFigmaNode): LayoutHint[] {
  if (!root) return [];
  const hints: LayoutHint[] = [];
  visit(root, (node) => {
    if (!hasLayoutHintEvidence(node)) return;
    const paddingEdges = paddingEdgesForNode(node);
    const alignment = alignmentForNode(node);
    const sizing = sizingForNode(node);
    const constraints = recordFromUnknown(node.constraints);
    const radius = radiusFromNode(node);
    const effects = Array.isArray(node.effects) ? node.effects : undefined;
    hints.push({
      nodeId: node.id,
      ...(node.parentNodeId ? { parentNodeId: node.parentNodeId } : {}),
      ...(node.name ? { name: node.name } : {}),
      ...(node.layoutMode ? { display: 'flex' } : {}),
      ...(node.layoutMode ? { direction: node.layoutMode === 'HORIZONTAL' ? 'row' : 'column' } : {}),
      ...(alignment ? { alignment } : {}),
      ...(sizing ? { sizing } : {}),
      ...(constraints ? { constraints } : {}),
      ...(node.layoutWrap ? { wrap: node.layoutWrap } : {}),
      ...(typeof node.clipsContent === 'boolean' ? { clipsContent: node.clipsContent } : {}),
      ...(typeof node.itemSpacing === 'number' ? { gap: node.itemSpacing } : {}),
      ...(paddingEdges ? {
        padding: [paddingEdges.top, paddingEdges.right, paddingEdges.bottom, paddingEdges.left],
        paddingEdges,
      } : {}),
      ...(typeof node.zIndex === 'number' || typeof node.childIndex === 'number' ? { zIndex: node.zIndex ?? node.childIndex } : {}),
      ...(typeof node.childIndex === 'number' ? { layerIndex: node.childIndex } : {}),
      ...(radius !== undefined ? { radius } : {}),
      ...(effects ? { effects } : {}),
      ...(typeof node.opacity === 'number' ? { opacity: node.opacity } : {}),
      ...(node.absoluteBoundingBox ? { box: node.absoluteBoundingBox } : {}),
    });
  });
  return hints;
}

function defaultMappingForRegion(kind: Region['kind'], strictness: Region['strictness']): DomMapping {
  if (strictness === 'ignored') return 'ignored';
  if (kind === 'text' || kind === 'image') return 'required';
  return 'optional';
}

function hasLayoutHintEvidence(node: RawFigmaNode): boolean {
  return Boolean(
    node.layoutMode ||
    node.itemSpacing !== undefined ||
    node.paddingLeft !== undefined ||
    node.paddingRight !== undefined ||
    node.paddingTop !== undefined ||
    node.paddingBottom !== undefined ||
    node.primaryAxisAlignItems ||
    node.counterAxisAlignItems ||
    node.primaryAxisSizingMode ||
    node.counterAxisSizingMode ||
    node.layoutSizingHorizontal ||
    node.layoutSizingVertical ||
    node.layoutAlign ||
    node.layoutGrow !== undefined ||
    node.layoutPositioning ||
    node.layoutWrap ||
    node.constraints !== undefined ||
    node.clipsContent !== undefined ||
    node.childIndex !== undefined ||
    node.zIndex !== undefined ||
    node.cornerRadius !== undefined ||
    node.topLeftRadius !== undefined ||
    node.topRightRadius !== undefined ||
    node.bottomRightRadius !== undefined ||
    node.bottomLeftRadius !== undefined ||
    node.effects !== undefined ||
    node.opacity !== undefined
  );
}

function paddingEdgesForNode(node: RawFigmaNode): { top: number; right: number; bottom: number; left: number } | undefined {
  const hasPadding = node.layoutMode || node.paddingLeft !== undefined || node.paddingRight !== undefined || node.paddingTop !== undefined || node.paddingBottom !== undefined;
  if (!hasPadding) return undefined;
  return {
    top: node.paddingTop || 0,
    right: node.paddingRight || 0,
    bottom: node.paddingBottom || 0,
    left: node.paddingLeft || 0,
  };
}

function alignmentForNode(node: RawFigmaNode): LayoutHint['alignment'] | undefined {
  const alignment = {
    ...(node.primaryAxisAlignItems ? { primaryAxis: node.primaryAxisAlignItems } : {}),
    ...(node.counterAxisAlignItems ? { counterAxis: node.counterAxisAlignItems } : {}),
    ...(node.textAlignHorizontal ? { textHorizontal: node.textAlignHorizontal } : {}),
    ...(node.textAlignVertical ? { textVertical: node.textAlignVertical } : {}),
  };
  return Object.keys(alignment).length > 0 ? alignment : undefined;
}

function sizingForNode(node: RawFigmaNode): LayoutHint['sizing'] | undefined {
  const sizing = {
    ...(node.layoutSizingHorizontal ? { horizontal: node.layoutSizingHorizontal } : {}),
    ...(node.layoutSizingVertical ? { vertical: node.layoutSizingVertical } : {}),
    ...(node.primaryAxisSizingMode ? { primaryAxis: node.primaryAxisSizingMode } : {}),
    ...(node.counterAxisSizingMode ? { counterAxis: node.counterAxisSizingMode } : {}),
    ...(typeof node.layoutGrow === 'number' ? { layoutGrow: node.layoutGrow } : {}),
    ...(node.layoutAlign ? { layoutAlign: node.layoutAlign } : {}),
    ...(node.layoutPositioning ? { layoutPositioning: node.layoutPositioning } : {}),
  };
  return Object.keys(sizing).length > 0 ? sizing : undefined;
}

function recordFromUnknown(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function radiusFromNode(node: RawFigmaNode): LayoutHint['radius'] | undefined {
  const cornerRadius = numberFromUnknown(node.cornerRadius);
  const topLeft = numberFromUnknown(node.topLeftRadius);
  const topRight = numberFromUnknown(node.topRightRadius);
  const bottomRight = numberFromUnknown(node.bottomRightRadius);
  const bottomLeft = numberFromUnknown(node.bottomLeftRadius);
  const corners = {
    ...(topLeft !== undefined ? { topLeft } : {}),
    ...(topRight !== undefined ? { topRight } : {}),
    ...(bottomRight !== undefined ? { bottomRight } : {}),
    ...(bottomLeft !== undefined ? { bottomLeft } : {}),
  };
  if (Object.keys(corners).length > 0) return corners;
  return cornerRadius;
}

function numberFromUnknown(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function visit(root: RawFigmaNode, fn: (node: RawFigmaNode, index: number) => void): void {
  let index = 0;
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.shift();
    if (!node) continue;
    fn(node, index);
    index += 1;
    for (const child of node.children || []) stack.push(child);
  }
}

function mapNodeKind(node: RawFigmaNode, isRoot: boolean): Region['kind'] {
  if (isRoot) return 'page';
  if (node.type === 'TEXT') return 'text';
  if (node.type === 'RECTANGLE' || node.type === 'IMAGE') return 'image';
  if (node.type === 'COMPONENT' || node.type === 'INSTANCE') return 'component';
  if (node.type === 'FRAME' || node.type === 'SECTION' || node.type === 'GROUP') return 'section';
  return 'unknown';
}

function chooseEvidenceLevel(raw: RawExtraction, regions: Region[]): MinimalDesignIR['evidenceLevel'] {
  if (raw.root && regions.length > 0 && raw.screenshots.length > 0) return 'L3-structured';
  if (raw.root || regions.length > 0) return 'L2-partial';
  if (raw.screenshots.length > 0) return 'L1-visual-only';
  return 'L0-blocked';
}

function fontFamilyFromFontName(fontName: unknown): { fontFamily?: string } {
  if (!fontName || typeof fontName !== 'object') return {};
  const family = (fontName as { family?: unknown }).family;
  return typeof family === 'string' ? { fontFamily: family } : {};
}

export function defaultSpecPath(runId: string, store = new ArtifactStore()): string {
  return path.join(store.getRunDir(runId), 'fidelity-spec.json');
}
