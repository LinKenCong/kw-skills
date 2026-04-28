import { ArtifactStore } from '../artifact/store.js';
import { fidelitySpecSchema, type FidelitySpec, type MinimalDesignIR, type RawExtraction } from '../schema.js';
import { readJsonFile } from '../json.js';

export const DEFAULT_THRESHOLDS = {
  fullPageMaxDiffRatio: 0.03,
  regionMaxDiffRatio: 0.01,
  boxTolerancePx: 3,
};

export function buildFidelitySpec(options: {
  runId: string;
  ir: MinimalDesignIR;
  route?: string;
  viewport?: { width?: number; height?: number; dpr?: number };
  store?: ArtifactStore;
}): FidelitySpec {
  const store = options.store || new ArtifactStore();
  const rawRef = store.findArtifact(options.runId, 'raw-extraction');
  const raw = rawRef ? (readJsonFile(store.resolveArtifactPath(rawRef.path)) as RawExtraction) : null;
  const screenshotRef = store.findArtifact(options.runId, 'screenshot');
  const baselineScreenshot = screenshotRef?.path || raw?.screenshots?.[0]?.path;
  if (!baselineScreenshot) {
    throw new Error('Cannot build fidelity spec without a baseline screenshot artifact');
  }
  const width = options.viewport?.width || Math.round(options.ir.page.width || raw?.screenshots?.[0]?.width || 1440);
  const height = options.viewport?.height || Math.round(options.ir.page.height || raw?.screenshots?.[0]?.height || 900);
  const spec = fidelitySpecSchema.parse({
    schemaVersion: 1,
    runId: options.runId,
    route: options.route || '',
    viewport: { width, height, dpr: options.viewport?.dpr || 1 },
    baselineScreenshot,
    regions: options.ir.regions,
    thresholds: DEFAULT_THRESHOLDS,
  });
  store.writeRunJson(options.runId, 'fidelity-spec.json', spec, { kind: 'fidelity-spec', mediaType: 'application/json' });
  return spec;
}
