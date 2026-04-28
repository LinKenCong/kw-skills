import { z } from 'zod';

export const warningSchema = z.object({
  code: z.string(),
  message: z.string(),
  hint: z.string().optional(),
});
export type Warning = z.infer<typeof warningSchema>;

export const errorPayloadSchema = z.object({
  code: z.string(),
  message: z.string(),
  recoverable: z.boolean().optional(),
  hint: z.string().optional(),
});
export type ErrorPayload = z.infer<typeof errorPayloadSchema>;

export const artifactKindSchema = z.enum([
  'raw-extraction',
  'screenshot',
  'asset',
  'design-ir',
  'text-manifest',
  'fidelity-spec',
  'verify-report',
  'repair-plan',
  'agent-brief',
  'trace',
  'diff',
]);
export type ArtifactKind = z.infer<typeof artifactKindSchema>;

export const artifactRefSchema = z.object({
  artifactId: z.string(),
  kind: artifactKindSchema,
  path: z.string(),
  contentHash: z.string().optional(),
  mediaType: z.string().optional(),
  sourceNodeId: z.string().optional(),
  sourcePageId: z.string().optional(),
});
export type ArtifactRef = z.infer<typeof artifactRefSchema>;

export const runSchema = z.object({
  runId: z.string(),
  kind: z.enum(['extract', 'build-ir', 'verify', 'restore']),
  createdAt: z.string(),
  status: z.enum(['running', 'completed', 'failed', 'blocked']),
  workspaceRoot: z.string(),
  artifactRoot: z.string(),
  inputs: z.record(z.unknown()),
  artifactRefs: z.array(artifactRefSchema),
  warnings: z.array(warningSchema),
});
export type Run = z.infer<typeof runSchema>;

export const boxSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number().nonnegative(),
  h: z.number().nonnegative(),
});
export type Box = z.infer<typeof boxSchema>;

export const viewportSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  dpr: z.number().positive(),
});
export type Viewport = z.infer<typeof viewportSchema>;

export const regionSchema = z.object({
  regionId: z.string(),
  nodeId: z.string().optional(),
  name: z.string().optional(),
  kind: z.enum(['page', 'section', 'component', 'text', 'image', 'unknown']),
  box: boxSchema,
  strictness: z.enum(['layout', 'strict', 'perceptual', 'ignored']),
});
export type Region = z.infer<typeof regionSchema>;

export const textEvidenceSchema = z.object({
  nodeId: z.string().optional(),
  name: z.string().optional(),
  text: z.string(),
  box: boxSchema.optional(),
  fontFamily: z.string().optional(),
  fontSize: z.number().optional(),
  fontWeight: z.union([z.string(), z.number()]).optional(),
  lineHeight: z.union([z.string(), z.number()]).optional(),
  letterSpacing: z.union([z.string(), z.number()]).optional(),
  textCase: z.string().optional(),
  textAlignHorizontal: z.string().optional(),
  textAlignVertical: z.string().optional(),
  textAutoResize: z.string().optional(),
  color: z.string().optional(),
});
export type TextEvidence = z.infer<typeof textEvidenceSchema>;

export const textManifestSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('text-manifest'),
  runId: z.string(),
  source: z.enum(['figma-text-nodes', 'screenshot-ocr', 'manual']),
  textCount: z.number().int().nonnegative(),
  items: z.array(textEvidenceSchema),
  warnings: z.array(warningSchema),
});
export type TextManifest = z.infer<typeof textManifestSchema>;

export const assetEvidenceSchema = z.object({
  artifactId: z.string().optional(),
  fallbackArtifactId: z.string().optional(),
  nodeId: z.string().optional(),
  path: z.string().optional(),
  fallbackPath: z.string().optional(),
  kind: z.enum(['image', 'svg', 'screenshot', 'unknown']).default('unknown'),
  preferredFormat: z.enum(['svg', 'png', 'jpg', 'gif', 'unknown']).default('unknown'),
  allowedUse: z.enum(['implementation', 'reference-only']).default('implementation'),
  sourceKind: z.enum(['image-fill', 'vector', 'node-export', 'unknown']).default('unknown'),
  mediaType: z.string().optional(),
  fallbackMediaType: z.string().optional(),
});
export type AssetEvidence = z.infer<typeof assetEvidenceSchema>;

export const colorEvidenceSchema = z.object({
  value: z.string(),
  nodeId: z.string().optional(),
  count: z.number().int().positive().optional(),
});
export type ColorEvidence = z.infer<typeof colorEvidenceSchema>;

export const typographyEvidenceSchema = z.object({
  fontFamily: z.string().optional(),
  fontSize: z.number().optional(),
  fontWeight: z.union([z.string(), z.number()]).optional(),
  lineHeight: z.union([z.string(), z.number()]).optional(),
  letterSpacing: z.union([z.string(), z.number()]).optional(),
  nodeId: z.string().optional(),
});
export type TypographyEvidence = z.infer<typeof typographyEvidenceSchema>;

export const layoutHintSchema = z.object({
  nodeId: z.string().optional(),
  name: z.string().optional(),
  display: z.string().optional(),
  direction: z.string().optional(),
  gap: z.number().optional(),
  padding: z.union([z.number(), z.array(z.number())]).optional(),
  box: boxSchema.optional(),
});
export type LayoutHint = z.infer<typeof layoutHintSchema>;

export const minimalDesignIrSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string(),
  evidenceLevel: z.enum(['L3-structured', 'L2-partial', 'L1-visual-only', 'L0-blocked']),
  page: z.object({
    pageId: z.string().optional(),
    pageName: z.string().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
  }),
  regions: z.array(regionSchema),
  texts: z.array(textEvidenceSchema),
  assets: z.array(assetEvidenceSchema),
  colors: z.array(colorEvidenceSchema),
  typography: z.array(typographyEvidenceSchema),
  layoutHints: z.array(layoutHintSchema),
  warnings: z.array(warningSchema),
});
export type MinimalDesignIR = z.infer<typeof minimalDesignIrSchema>;

export const fidelitySpecSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string(),
  evidenceLevel: z.enum(['L3-structured', 'L2-partial', 'L1-visual-only', 'L0-blocked']).optional(),
  route: z.string(),
  viewport: viewportSchema,
  baselineScreenshot: z.string(),
  regions: z.array(regionSchema),
  texts: z.array(textEvidenceSchema).default([]),
  assets: z.array(assetEvidenceSchema).default([]),
  colors: z.array(colorEvidenceSchema).default([]),
  typography: z.array(typographyEvidenceSchema).default([]),
  thresholds: z.object({
    fullPageMaxDiffRatio: z.number().min(0).max(1),
    regionMaxDiffRatio: z.number().min(0).max(1),
    boxTolerancePx: z.number().nonnegative(),
  }),
});
export type FidelitySpec = z.infer<typeof fidelitySpecSchema>;

export const failureCategorySchema = z.enum([
  'text-content',
  'layout-spacing',
  'typography',
  'color',
  'asset-missing',
  'asset-crop',
  'screenshot-overlay',
  'overflow-clipping',
  'wrong-state',
  'scale-mismatch',
  'insufficient-design-data',
  'blocked-environment',
]);
export type FailureCategory = z.infer<typeof failureCategorySchema>;

export const failureSchema = z.object({
  failureId: z.string(),
  category: failureCategorySchema,
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  message: z.string(),
  regionId: z.string().optional(),
  nodeId: z.string().optional(),
  selector: z.string().optional(),
  evidencePath: z.string().optional(),
  expected: z.record(z.unknown()).optional(),
  actual: z.record(z.unknown()).optional(),
});
export type Failure = z.infer<typeof failureSchema>;

export const regionResultSchema = z.object({
  regionId: z.string(),
  nodeId: z.string().optional(),
  diffRatio: z.number().min(0),
  diffPixels: z.number().int().nonnegative(),
  totalPixels: z.number().int().nonnegative(),
  expectedPath: z.string().optional(),
  actualPath: z.string().optional(),
  diffPath: z.string().optional(),
  status: z.enum(['passed', 'failed', 'skipped']),
});
export type RegionResult = z.infer<typeof regionResultSchema>;

export const domResultSchema = z.object({
  nodeId: z.string().optional(),
  selector: z.string(),
  status: z.enum(['passed', 'failed', 'missing', 'skipped']),
  box: boxSchema.optional(),
  computed: z.record(z.string()).optional(),
  message: z.string().optional(),
});
export type DomResult = z.infer<typeof domResultSchema>;

export const textResultSchema = z.object({
  nodeId: z.string().optional(),
  selector: z.string().optional(),
  status: z.enum(['passed', 'failed', 'missing', 'mapping-missing', 'skipped']),
  expectedText: z.string(),
  actualText: z.string().optional(),
  normalizedExpected: z.string(),
  normalizedActual: z.string().optional(),
  message: z.string().optional(),
});
export type TextResult = z.infer<typeof textResultSchema>;

export const verifyReportSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().optional(),
  status: z.enum(['passed', 'failed', 'blocked']),
  attemptId: z.string(),
  route: z.string(),
  viewport: viewportSchema,
  fullPage: z.object({
    diffRatio: z.number().min(0),
    diffPixels: z.number().int().nonnegative(),
    expectedPath: z.string(),
    actualPath: z.string(),
    diffPath: z.string(),
  }),
  regionResults: z.array(regionResultSchema),
  domResults: z.array(domResultSchema),
  textResults: z.array(textResultSchema).default([]),
  failures: z.array(failureSchema),
  warnings: z.array(warningSchema),
});
export type VerifyReport = z.infer<typeof verifyReportSchema>;

export const repairFailureSchema = failureSchema.extend({
  recommendedAction: z.string(),
  confidence: z.number().min(0).max(1),
});
export type RepairFailure = z.infer<typeof repairFailureSchema>;

export const repairPlanSchema = z.object({
  schemaVersion: z.literal(1),
  status: z.enum(['needs-repair', 'passed', 'blocked']),
  attemptId: z.string(),
  summary: z.string(),
  worstFailures: z.array(repairFailureSchema),
  nextActions: z.array(z.string()),
  blockedReason: z.string().optional(),
});
export type RepairPlan = z.infer<typeof repairPlanSchema>;

export const agentBriefFailureSchema = z.object({
  category: failureCategorySchema,
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  message: z.string(),
  regionId: z.string().optional(),
  nodeId: z.string().optional(),
  selector: z.string().optional(),
  evidencePath: z.string().optional(),
  expected: z.record(z.unknown()).optional(),
  actual: z.record(z.unknown()).optional(),
  recommendedAction: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});
export type AgentBriefFailure = z.infer<typeof agentBriefFailureSchema>;

export const agentBriefSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('agent-brief'),
  attemptId: z.string(),
  route: z.string(),
  reportStatus: z.enum(['passed', 'failed', 'blocked']),
  repairStatus: z.enum(['needs-repair', 'passed', 'blocked']).optional(),
  tokenPolicy: z.object({
    readFirst: z.array(z.string()),
    avoidByDefault: z.array(z.string()),
    maxFailures: z.number().int().positive(),
  }),
  metrics: z.object({
    viewport: viewportSchema,
    fullPageDiffRatio: z.number().min(0),
    fullPageDiffPixels: z.number().int().nonnegative(),
    failureCount: z.number().int().nonnegative(),
    failedRegionCount: z.number().int().nonnegative(),
    failedDomCount: z.number().int().nonnegative(),
    failedTextCount: z.number().int().nonnegative().optional(),
    warningCount: z.number().int().nonnegative(),
  }),
  artifactPaths: z.object({
    reportPath: z.string().optional(),
    repairPlanPath: z.string().optional(),
    textManifestPath: z.string().optional(),
    expectedPath: z.string().optional(),
    actualPath: z.string().optional(),
    diffPath: z.string().optional(),
    tracePath: z.string().optional(),
  }),
  failureCounts: z.record(z.number().int().nonnegative()),
  nextActions: z.array(z.string()),
  topFailures: z.array(agentBriefFailureSchema),
  topRegions: z.array(z.object({
    regionId: z.string(),
    nodeId: z.string().optional(),
    diffRatio: z.number().min(0),
    status: z.enum(['passed', 'failed', 'skipped']),
    diffPath: z.string().optional(),
  })),
  warnings: z.array(warningSchema),
});
export type AgentBrief = z.infer<typeof agentBriefSchema>;

export const restoreAttemptSchema = z.object({
  attemptId: z.string(),
  index: z.number().int().positive(),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  status: z.enum(['running', 'passed', 'failed', 'blocked']),
  reportPath: z.string().optional(),
  repairPlanPath: z.string().optional(),
  agentBriefPath: z.string().optional(),
  patchSummaryPath: z.string().optional(),
});
export type RestoreAttempt = z.infer<typeof restoreAttemptSchema>;

export const rawFigmaNodeSchema: z.ZodType<RawFigmaNode> = z.lazy(() =>
  z.object({
    id: z.string(),
    name: z.string().optional(),
    type: z.string().optional(),
    visible: z.boolean().optional(),
    absoluteBoundingBox: boxSchema.optional(),
    fills: z.unknown().optional(),
    strokes: z.unknown().optional(),
    effects: z.unknown().optional(),
    cornerRadius: z.unknown().optional(),
    characters: z.string().optional(),
    fontName: z.unknown().optional(),
    fontSize: z.number().optional(),
    fontWeight: z.union([z.string(), z.number()]).optional(),
    lineHeight: z.unknown().optional(),
    letterSpacing: z.unknown().optional(),
    textCase: z.string().optional(),
    textAlignHorizontal: z.string().optional(),
    textAlignVertical: z.string().optional(),
    textAutoResize: z.string().optional(),
    layoutMode: z.string().optional(),
    itemSpacing: z.number().optional(),
    paddingLeft: z.number().optional(),
    paddingRight: z.number().optional(),
    paddingTop: z.number().optional(),
    paddingBottom: z.number().optional(),
    children: z.array(rawFigmaNodeSchema).optional(),
  })
);
export type RawFigmaNode = {
  id: string;
  name?: string | undefined;
  type?: string | undefined;
  visible?: boolean | undefined;
  absoluteBoundingBox?: Box | undefined;
  fills?: unknown;
  strokes?: unknown;
  effects?: unknown;
  cornerRadius?: unknown;
  characters?: string | undefined;
  fontName?: unknown;
  fontSize?: number | undefined;
  fontWeight?: string | number | undefined;
  lineHeight?: unknown;
  letterSpacing?: unknown;
  textCase?: string | undefined;
  textAlignHorizontal?: string | undefined;
  textAlignVertical?: string | undefined;
  textAutoResize?: string | undefined;
  layoutMode?: string | undefined;
  itemSpacing?: number | undefined;
  paddingLeft?: number | undefined;
  paddingRight?: number | undefined;
  paddingTop?: number | undefined;
  paddingBottom?: number | undefined;
  children?: RawFigmaNode[] | undefined;
};

export const rawScreenshotSchema = z.object({
  artifactId: z.string(),
  nodeId: z.string().optional(),
  path: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  mediaType: z.string().optional(),
});
export type RawScreenshot = z.infer<typeof rawScreenshotSchema>;

export const rawExtractionSchema = z.object({
  schemaVersion: z.literal(1),
  meta: z.object({
    pageId: z.string().optional(),
    pageName: z.string().optional(),
    fileName: z.string().optional(),
    selectedNodeCount: z.number().int().nonnegative(),
    extractedAt: z.string(),
  }),
  root: rawFigmaNodeSchema.optional(),
  regions: z.array(regionSchema).default([]),
  texts: z.array(textEvidenceSchema).default([]),
  colors: z.array(colorEvidenceSchema).default([]),
  typography: z.array(typographyEvidenceSchema).default([]),
  layoutHints: z.array(layoutHintSchema).default([]),
  screenshots: z.array(rawScreenshotSchema).default([]),
  assets: z.array(assetEvidenceSchema).default([]),
  warnings: z.array(warningSchema).default([]),
});
export type RawExtraction = z.infer<typeof rawExtractionSchema>;

export const sessionRegisterSchema = z.object({
  pluginSessionId: z.string(),
  fileName: z.string().optional(),
  currentPageId: z.string().optional(),
  currentPageName: z.string().optional(),
  selectionCount: z.number().int().nonnegative(),
  capabilities: z.array(z.string()),
});
export type SessionRegister = z.infer<typeof sessionRegisterSchema>;

export const jobCreateSchema = z.object({
  capability: z.string(),
  sessionId: z.string().optional(),
  options: z.record(z.unknown()).default({}),
});
export type JobCreate = z.infer<typeof jobCreateSchema>;

export const artifactUploadSchema = z.object({
  artifactId: z.string().optional(),
  kind: artifactKindSchema,
  fileName: z.string().optional(),
  path: z.string().optional(),
  mediaType: z.string().optional(),
  sourceNodeId: z.string().optional(),
  sourcePageId: z.string().optional(),
  dataBase64: z.string(),
});
export type ArtifactUpload = z.infer<typeof artifactUploadSchema>;

export const jobProgressSchema = z.object({
  stage: z.string(),
  message: z.string().optional(),
  progress: z.number().min(0).max(1).optional(),
});
export type JobProgress = z.infer<typeof jobProgressSchema>;

export const jobResultSchema = z.union([
  z.object({ ok: z.literal(true), result: rawExtractionSchema }),
  z.object({ ok: z.literal(false), error: errorPayloadSchema }),
]);
export type JobResultPayload = z.infer<typeof jobResultSchema>;

export const serviceLockSchema = z.object({
  service: z.literal('figma-react-restore'),
  version: z.string(),
  pid: z.number().int().positive(),
  port: z.number().int().positive(),
  url: z.string(),
  startedAt: z.string(),
  workspaceRoot: z.string(),
  artifactRoot: z.string(),
});
export type ServiceLock = z.infer<typeof serviceLockSchema>;
