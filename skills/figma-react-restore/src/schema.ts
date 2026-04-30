import { z } from 'zod';

export const ARTIFACT_PATH_MAX_LENGTH = 1024;
export const ARTIFACT_UPLOAD_BASE64_MAX_LENGTH = 32 * 1024 * 1024;
export const ARTIFACT_ID_MAX_LENGTH = 128;
export const ARTIFACT_FILE_NAME_MAX_LENGTH = 180;

export function isArtifactRelativePath(value: string): boolean {
  if (!value || value.length > ARTIFACT_PATH_MAX_LENGTH) return false;
  if (value.includes('\0') || value.includes('\\')) return false;
  if (value.startsWith('/') || value.startsWith('//') || /^[A-Za-z]:\//.test(value)) return false;
  const segments = value.split('/');
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

export function isBase64Payload(value: string): boolean {
  if (!value || value.length > ARTIFACT_UPLOAD_BASE64_MAX_LENGTH) return false;
  if (value.length % 4 !== 0) return false;
  return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);
}

export const artifactRelativePathSchema = z.string()
  .min(1)
  .max(ARTIFACT_PATH_MAX_LENGTH)
  .refine(isArtifactRelativePath, 'Artifact path must be a POSIX path relative to artifact root without "." or ".." segments');

export const artifactIdSchema = z.string().min(1).max(ARTIFACT_ID_MAX_LENGTH);
export const artifactFileNameSchema = z.string().min(1).max(ARTIFACT_FILE_NAME_MAX_LENGTH);
export const mediaTypeSchema = z.string().min(1).max(128);
export const base64DataSchema = z.string()
  .min(1)
  .max(ARTIFACT_UPLOAD_BASE64_MAX_LENGTH)
  .refine(isBase64Payload, 'dataBase64 must be standard padded base64');

export const warningSchema = z.object({
  code: z.string(),
  message: z.string(),
  hint: z.string().optional(),
});
export type Warning = z.infer<typeof warningSchema>;

export const errorPayloadSchema = z.object({
  code: z.string(),
  message: z.string(),
  httpStatus: z.number().int().min(100).max(599).optional(),
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
  artifactId: artifactIdSchema,
  kind: artifactKindSchema,
  path: artifactRelativePathSchema,
  contentHash: z.string().optional(),
  mediaType: mediaTypeSchema.optional(),
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

export const domMappingSchema = z.enum(['required', 'optional', 'ignored']);
export type DomMapping = z.infer<typeof domMappingSchema>;

export const regionSchema = z.object({
  regionId: z.string(),
  nodeId: z.string().optional(),
  name: z.string().optional(),
  kind: z.enum(['page', 'section', 'component', 'text', 'image', 'unknown']),
  box: boxSchema,
  strictness: z.enum(['layout', 'strict', 'perceptual', 'ignored']),
  mapping: domMappingSchema.optional(),
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

export const edgeValuesSchema = z.object({
  top: z.number().optional(),
  right: z.number().optional(),
  bottom: z.number().optional(),
  left: z.number().optional(),
});
export type EdgeValues = z.infer<typeof edgeValuesSchema>;

export const cornerRadiusSchema = z.union([
  z.number(),
  z.object({
    topLeft: z.number().optional(),
    topRight: z.number().optional(),
    bottomRight: z.number().optional(),
    bottomLeft: z.number().optional(),
  }),
]);
export type CornerRadius = z.infer<typeof cornerRadiusSchema>;

export const layoutAlignmentSchema = z.object({
  primaryAxis: z.string().optional(),
  counterAxis: z.string().optional(),
  textHorizontal: z.string().optional(),
  textVertical: z.string().optional(),
});
export type LayoutAlignment = z.infer<typeof layoutAlignmentSchema>;

export const layoutSizingSchema = z.object({
  horizontal: z.string().optional(),
  vertical: z.string().optional(),
  primaryAxis: z.string().optional(),
  counterAxis: z.string().optional(),
  layoutGrow: z.number().optional(),
  layoutAlign: z.string().optional(),
  layoutPositioning: z.string().optional(),
});
export type LayoutSizing = z.infer<typeof layoutSizingSchema>;

export const layoutHintSchema = z.object({
  nodeId: z.string().optional(),
  parentNodeId: z.string().optional(),
  name: z.string().optional(),
  display: z.string().optional(),
  direction: z.string().optional(),
  alignment: layoutAlignmentSchema.optional(),
  sizing: layoutSizingSchema.optional(),
  constraints: z.record(z.unknown()).optional(),
  wrap: z.string().optional(),
  clipsContent: z.boolean().optional(),
  gap: z.number().optional(),
  padding: z.union([z.number(), z.array(z.number())]).optional(),
  paddingEdges: edgeValuesSchema.optional(),
  zIndex: z.number().optional(),
  layerIndex: z.number().optional(),
  radius: cornerRadiusSchema.optional(),
  effects: z.array(z.unknown()).optional(),
  opacity: z.number().optional(),
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

export const routeStateAssertionSchema = z.object({
  type: z.enum(['visible-text', 'selector-visible', 'selector-text', 'url-contains', 'local-storage', 'cookie']),
  selector: z.string().optional(),
  text: z.string().optional(),
  key: z.string().optional(),
  value: z.string().optional(),
  name: z.string().optional(),
});
export type RouteStateAssertion = z.infer<typeof routeStateAssertionSchema>;

export const routeStateCookieSchema = z.object({
  name: z.string(),
  value: z.string(),
  url: z.string().optional(),
  domain: z.string().optional(),
  path: z.string().optional(),
  expires: z.number().optional(),
  httpOnly: z.boolean().optional(),
  secure: z.boolean().optional(),
  sameSite: z.enum(['Strict', 'Lax', 'None']).optional(),
});
export type RouteStateCookie = z.infer<typeof routeStateCookieSchema>;

export const routeStateContractSchema = z.object({
  waitForSelector: z.string().optional(),
  waitTimeoutMs: z.number().int().positive().optional(),
  expectedVisibleText: z.array(z.string()).default([]),
  assertions: z.array(routeStateAssertionSchema).default([]),
  localStorage: z.record(z.string()).optional(),
  cookies: z.array(routeStateCookieSchema).default([]),
  setupScript: z.string().optional(),
});
export type RouteStateContract = z.infer<typeof routeStateContractSchema>;

export const fidelitySpecSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string(),
  evidenceLevel: z.enum(['L3-structured', 'L2-partial', 'L1-visual-only', 'L0-blocked']).optional(),
  route: z.string(),
  viewport: viewportSchema,
  routeState: routeStateContractSchema.optional(),
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
  threshold: z.number().min(0).max(1).optional(),
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
  mapping: domMappingSchema.optional(),
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

export const stateResultSchema = z.object({
  type: z.enum(['wait-for-selector', 'visible-text', 'selector-visible', 'selector-text', 'url-contains', 'local-storage', 'cookie', 'setup-script']),
  status: z.enum(['passed', 'failed', 'skipped']),
  selector: z.string().optional(),
  message: z.string().optional(),
  expected: z.record(z.unknown()).optional(),
  actual: z.record(z.unknown()).optional(),
});
export type StateResult = z.infer<typeof stateResultSchema>;

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
  stateResults: z.array(stateResultSchema).default([]),
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
    failedStateCount: z.number().int().nonnegative().optional(),
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
  implementationBriefPath: z.string().optional(),
  patchSummaryPath: z.string().optional(),
  error: errorPayloadSchema.optional(),
});
export type RestoreAttempt = z.infer<typeof restoreAttemptSchema>;

export const rawFigmaNodeSchema: z.ZodType<RawFigmaNode> = z.lazy(() =>
  z.object({
    id: z.string(),
    name: z.string().optional(),
    parentNodeId: z.string().optional(),
    type: z.string().optional(),
    visible: z.boolean().optional(),
    absoluteBoundingBox: boxSchema.optional(),
    childIndex: z.number().optional(),
    zIndex: z.number().optional(),
    fills: z.unknown().optional(),
    strokes: z.unknown().optional(),
    strokeWeight: z.unknown().optional(),
    strokeAlign: z.string().optional(),
    effects: z.unknown().optional(),
    cornerRadius: z.unknown().optional(),
    topLeftRadius: z.unknown().optional(),
    topRightRadius: z.unknown().optional(),
    bottomRightRadius: z.unknown().optional(),
    bottomLeftRadius: z.unknown().optional(),
    opacity: z.number().optional(),
    blendMode: z.string().optional(),
    constraints: z.unknown().optional(),
    clipsContent: z.boolean().optional(),
    rotation: z.number().optional(),
    relativeTransform: z.unknown().optional(),
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
    layoutWrap: z.string().optional(),
    itemSpacing: z.number().optional(),
    counterAxisSpacing: z.number().optional(),
    primaryAxisSizingMode: z.string().optional(),
    counterAxisSizingMode: z.string().optional(),
    primaryAxisAlignItems: z.string().optional(),
    counterAxisAlignItems: z.string().optional(),
    layoutSizingHorizontal: z.string().optional(),
    layoutSizingVertical: z.string().optional(),
    layoutAlign: z.string().optional(),
    layoutGrow: z.number().optional(),
    layoutPositioning: z.string().optional(),
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
  parentNodeId?: string | undefined;
  type?: string | undefined;
  visible?: boolean | undefined;
  absoluteBoundingBox?: Box | undefined;
  childIndex?: number | undefined;
  zIndex?: number | undefined;
  fills?: unknown;
  strokes?: unknown;
  strokeWeight?: unknown;
  strokeAlign?: string | undefined;
  effects?: unknown;
  cornerRadius?: unknown;
  topLeftRadius?: unknown;
  topRightRadius?: unknown;
  bottomRightRadius?: unknown;
  bottomLeftRadius?: unknown;
  opacity?: number | undefined;
  blendMode?: string | undefined;
  constraints?: unknown;
  clipsContent?: boolean | undefined;
  rotation?: number | undefined;
  relativeTransform?: unknown;
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
  layoutWrap?: string | undefined;
  itemSpacing?: number | undefined;
  counterAxisSpacing?: number | undefined;
  primaryAxisSizingMode?: string | undefined;
  counterAxisSizingMode?: string | undefined;
  primaryAxisAlignItems?: string | undefined;
  counterAxisAlignItems?: string | undefined;
  layoutSizingHorizontal?: string | undefined;
  layoutSizingVertical?: string | undefined;
  layoutAlign?: string | undefined;
  layoutGrow?: number | undefined;
  layoutPositioning?: string | undefined;
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

export const jobCapabilitySchema = z.enum(['extract.selection']);
export type JobCapability = z.infer<typeof jobCapabilitySchema>;

export const jobCreateSchema = z.object({
  capability: jobCapabilitySchema,
  sessionId: z.string().optional(),
  options: z.record(z.unknown()).default({}),
});
export type JobCreate = z.infer<typeof jobCreateSchema>;

export const artifactUploadSchema = z.object({
  artifactId: artifactIdSchema.optional(),
  kind: artifactKindSchema,
  fileName: artifactFileNameSchema.optional(),
  path: artifactRelativePathSchema.optional(),
  mediaType: mediaTypeSchema.optional(),
  sourceNodeId: z.string().optional(),
  sourcePageId: z.string().optional(),
  dataBase64: base64DataSchema,
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
  adminToken: z.string().min(32),
  startedAt: z.string(),
  hostname: z.string().min(1),
  createdByCommand: z.string().min(1).max(512),
  lastHeartbeatAt: z.string(),
  ownerPid: z.number().int().positive().optional(),
  workspaceRoot: z.string(),
  artifactRoot: z.string(),
});
export type ServiceLock = z.infer<typeof serviceLockSchema>;
