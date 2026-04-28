import path from 'node:path';
import { ArtifactStore } from '../artifact/store.js';
import { readJsonFile } from '../json.js';
import {
  type Box,
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
  if (!rootBox) return regions;
  return regions.map((region) => ({ ...region, box: normalizeBox(region.box, rootBox) }));
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
    regions.push({
      regionId: node.id,
      nodeId: node.id,
      ...(node.name ? { name: node.name } : {}),
      kind,
      box: node.absoluteBoundingBox,
      strictness: kind === 'page' || kind === 'section' ? 'layout' : kind === 'unknown' ? 'perceptual' : 'strict',
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
    if (!node.layoutMode && node.itemSpacing === undefined && node.paddingLeft === undefined) return;
    hints.push({
      nodeId: node.id,
      ...(node.name ? { name: node.name } : {}),
      ...(node.layoutMode ? { display: 'flex' } : {}),
      ...(node.layoutMode ? { direction: node.layoutMode === 'HORIZONTAL' ? 'row' : 'column' } : {}),
      ...(typeof node.itemSpacing === 'number' ? { gap: node.itemSpacing } : {}),
      padding: [node.paddingTop || 0, node.paddingRight || 0, node.paddingBottom || 0, node.paddingLeft || 0],
      ...(node.absoluteBoundingBox ? { box: node.absoluteBoundingBox } : {}),
    });
  });
  return hints;
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
