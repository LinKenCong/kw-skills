import path from 'node:path';
import type { AssetEvidence, DomResult, Region, RegionResult } from '../schema.js';

export type AssetEquivalenceContext = {
  regions?: Region[];
  regionResults?: RegionResult[];
  domResults?: DomResult[];
};

export type AssetImplementationPolicy = 'must-use-extracted-asset' | 'semantic-equivalent-allowed' | 'reference-only-forbidden';

export function assetImplementationPolicy(asset: AssetEvidence, context: AssetEquivalenceContext = {}): AssetImplementationPolicy {
  if (asset.allowedUse === 'reference-only') return 'reference-only-forbidden';
  const assetName = assetDisplayName(asset, context.regions);
  if (assetRequiresExtractedSource(asset, assetName)) return 'must-use-extracted-asset';
  if (assetAllowsSemanticEquivalent(asset, assetName)) return 'semantic-equivalent-allowed';
  return 'must-use-extracted-asset';
}

export function assetRequiresExtractedSource(asset: AssetEvidence, assetName = ''): boolean {
  if (asset.allowedUse === 'reference-only') return false;
  if (asset.sourceKind === 'image-fill') return true;
  const searchable = assetSearchText(asset, assetName);
  if (/\b(logo|logotype|wordmark|brand\s*mark|brandmark)\b/i.test(searchable)) return true;
  if (/\b(photo|picture|avatar|portrait|product|hero\s*image|cover|thumbnail)\b/i.test(searchable)) return true;
  if (/\b(icon|glyph|symbol|decorative|decoration|decor|divider|chevron|arrow|caret|vector|ornament|shape)\b/i.test(searchable)) return false;
  if (asset.kind === 'image' && /(jpe?g|png|webp|gif)$/i.test(asset.preferredFormat || '')) return true;
  return false;
}

export function assetAllowsSemanticEquivalent(asset: AssetEvidence, assetName = ''): boolean {
  if (asset.allowedUse === 'reference-only') return false;
  if (assetRequiresExtractedSource(asset, assetName)) return false;
  const searchable = assetSearchText(asset, assetName);
  return asset.sourceKind === 'vector'
    || asset.kind === 'svg'
    || asset.preferredFormat === 'svg'
    || /\b(icon|glyph|symbol|decorative|decoration|decor|divider|chevron|arrow|caret|vector|ornament|shape)\b/i.test(searchable);
}

export function hasSemanticAssetEquivalence(asset: AssetEvidence, context: AssetEquivalenceContext = {}): boolean {
  if (!asset.nodeId) return false;
  if (assetImplementationPolicy(asset, context) !== 'semantic-equivalent-allowed') return false;
  const mappedDom = context.domResults?.find((result) => result.nodeId === asset.nodeId);
  const regionResult = context.regionResults?.find((result) => result.nodeId === asset.nodeId || result.regionId === asset.nodeId);
  const hasNodeMapping = Boolean(mappedDom && mappedDom.status !== 'missing' && mappedDom.status !== 'skipped');
  return hasNodeMapping && regionResult?.status === 'passed';
}

export function assetDisplayName(asset: AssetEvidence, regions: Region[] = []): string {
  const byNode = asset.nodeId ? regions.find((region) => region.nodeId === asset.nodeId || region.regionId === asset.nodeId) : undefined;
  return byNode?.name || path.basename(asset.path || asset.fallbackPath || '') || asset.nodeId || asset.artifactId || 'asset';
}

function assetSearchText(asset: AssetEvidence, assetName: string): string {
  return [
    assetName,
    asset.path ? path.basename(asset.path) : '',
    asset.fallbackPath ? path.basename(asset.fallbackPath) : '',
    asset.mediaType || '',
    asset.fallbackMediaType || '',
    asset.sourceKind,
    asset.kind,
    asset.preferredFormat,
  ].filter(Boolean).join(' ').replace(/[_./-]+/g, ' ');
}
