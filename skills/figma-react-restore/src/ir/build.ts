import path from 'node:path';
import { ArtifactStore } from '../artifact/store.js';
import { readJsonFile } from '../json.js';
import {
  minimalDesignIrSchema,
  rawExtractionSchema,
  type LayoutHint,
  type MinimalDesignIR,
  type RawExtraction,
  type RawFigmaNode,
  type Region,
  type TextEvidence,
  type TypographyEvidence,
} from '../schema.js';

export function buildMinimalDesignIr(runId: string, store = new ArtifactStore()): MinimalDesignIR {
  const rawRef = store.findArtifact(runId, 'raw-extraction');
  const rawPath = rawRef ? store.resolveArtifactPath(rawRef.path) : store.getRunFile(runId, 'extraction.raw.json');
  const raw = rawExtractionSchema.parse(readJsonFile(rawPath));
  const regions = raw.regions.length > 0 ? raw.regions : collectRegions(raw.root);
  const texts = raw.texts.length > 0 ? raw.texts : collectTexts(raw.root);
  const typography = raw.typography.length > 0 ? raw.typography : collectTypography(raw.root);
  const layoutHints = raw.layoutHints.length > 0 ? raw.layoutHints : collectLayoutHints(raw.root);
  const pageBox = raw.root?.absoluteBoundingBox || regions.find((region) => region.kind === 'page')?.box;
  const evidenceLevel = chooseEvidenceLevel(raw, regions);
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
    warnings: raw.warnings,
  });
  store.writeRunJson(runId, 'design-ir.json', ir, { kind: 'design-ir', mediaType: 'application/json' });
  store.updateRun(runId, { status: ir.evidenceLevel === 'L0-blocked' ? 'blocked' : 'completed' });
  return ir;
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
      text: node.characters,
      ...(node.absoluteBoundingBox ? { box: node.absoluteBoundingBox } : {}),
      ...(typeof node.fontSize === 'number' ? { fontSize: node.fontSize } : {}),
      ...(node.fontWeight !== undefined ? { fontWeight: node.fontWeight } : {}),
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
