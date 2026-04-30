figma.showUI(__html__, { width: 380, height: 560, themeColors: true });

const SERIALIZE_NODE_KEYS = [
  'fills',
  'strokes',
  'strokeWeight',
  'strokeAlign',
  'effects',
  'cornerRadius',
  'topLeftRadius',
  'topRightRadius',
  'bottomRightRadius',
  'bottomLeftRadius',
  'opacity',
  'blendMode',
  'constraints',
  'clipsContent',
  'rotation',
  'relativeTransform',
  'layoutMode',
  'layoutWrap',
  'itemSpacing',
  'counterAxisSpacing',
  'primaryAxisSizingMode',
  'counterAxisSizingMode',
  'primaryAxisAlignItems',
  'counterAxisAlignItems',
  'layoutSizingHorizontal',
  'layoutSizingVertical',
  'layoutAlign',
  'layoutGrow',
  'layoutPositioning',
  'paddingLeft',
  'paddingRight',
  'paddingTop',
  'paddingBottom',
];
const ASSET_NAME_PATTERN = /\b(icon|logo|avatar|photo|image|img|illustration|asset|decorative|decoration|divider|border|separator|ornament|pattern)\b/i;
const DECORATIVE_NAME_PATTERN = /\b(decorative|decoration|divider|border|separator|ornament|pattern)\b/i;
const FIGMA_TRAVERSAL_MAX_NODES = 20000;
const FIGMA_DEEP_TRAVERSAL_MAX_DEPTH = 32;
const TEXT_DESCENDANT_SCAN_MAX_NODES = 10000;
const TEXT_DESCENDANT_SCAN_MAX_DEPTH = 64;

figma.ui.onmessage = async (message) => {
  try {
    if (message.type === 'get-session') {
      postSessionInfo();
      return;
    }
    if (message.type === 'extract-selection') {
      await extractSelection(message.job);
      return;
    }
  } catch (error) {
    figma.ui.postMessage({
      type: 'extract-error',
      jobId: message.job && message.job.jobId,
      error: {
        code: 'PLUGIN_EXCEPTION',
        message: error && error.message ? error.message : String(error),
        recoverable: true,
        hint: pluginErrorHint(error),
      },
    });
  }
};

figma.on('selectionchange', () => postSessionInfo());
postSessionInfo();

function postSessionInfo() {
  figma.ui.postMessage({
    type: 'session-info',
    session: {
      fileName: figma.root.name,
      currentPageId: figma.currentPage.id,
      currentPageName: figma.currentPage.name,
      selectionCount: figma.currentPage.selection.length,
      capabilities: ['extract.selection'],
    },
  });
}

async function extractSelection(job) {
  const jobId = job.jobId;
  const selection = figma.currentPage.selection;
  if (!selection.length) {
    figma.ui.postMessage({
      type: 'extract-error',
      jobId,
      error: {
        code: 'NO_SELECTION',
        message: 'No Figma selection found',
        recoverable: true,
        hint: 'Select one frame, component, or region and retry',
      },
    });
    return;
  }
  const parent = commonParent(selection);
  const rootNode = selection.length === 1 || !parent || parent.type === 'PAGE' ? selection[0] : parent;
  figma.ui.postMessage({ type: 'progress', jobId, progress: { stage: 'serialize', message: 'Serializing selected node tree', progress: 0.2 } });
  const root = serializeNode(rootNode, 0, 0, undefined);
  const warnings = [];
  const regions = collectRegions(root);
  const textResult = collectTextsFromFigma(rootNode);
  const texts = textResult.texts;
  warnings.push(...textResult.warnings);
  const colors = collectColors(root);
  const typography = collectTypographyFromTexts(texts);
  const layoutHints = collectLayoutHints(root);

  const artifactId = `shot_${Date.now().toString(36)}`;
  const artifacts = [];
  const screenshots = [];
  const assets = [];
  const jobOptions = job && job.options ? job.options : {};
  if (jobOptions.screenshots !== false && typeof rootNode.exportAsync === 'function') {
    figma.ui.postMessage({ type: 'progress', jobId, progress: { stage: 'screenshot', message: 'Exporting PNG baseline', progress: 0.55 } });
    const bytes = await rootNode.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 1 } });
    artifacts.push({
      artifactId,
      kind: 'screenshot',
      fileName: `${safeName(rootNode.name)}.png`,
      mediaType: 'image/png',
      sourceNodeId: rootNode.id,
      bytes,
    });
    const box = toBox(rootNode.absoluteBoundingBox);
    screenshots.push({ artifactId, nodeId: rootNode.id, width: box ? box.w : undefined, height: box ? box.h : undefined, mediaType: 'image/png' });
  }
  if (jobOptions.assets === false) {
    warnings.push({
      code: 'ASSET_EXPORT_DISABLED',
      message: 'Asset export was disabled for this extraction run.',
      hint: 'Use this run for layout/text restoration only, or rerun extraction without --no-assets before final asset verification.',
    });
  } else {
    figma.ui.postMessage({ type: 'progress', jobId, progress: { stage: 'assets', message: 'Exporting image and vector assets', progress: 0.72 } });
    try {
      const assetResult = await exportAssets(rootNode);
      artifacts.push(...assetResult.artifacts);
      assets.push(...assetResult.assets);
      warnings.push(...assetResult.warnings);
    } catch (error) {
      warnings.push({
        code: 'ASSET_EXPORT_FAILED',
        message: `Asset export failed and extraction continued without asset files: ${errorMessage(error)}`,
        hint: pluginErrorHint(error) || 'Rerun extraction with --no-assets to force a layout/text-only run, or select a smaller Figma frame.',
      });
    }
  }
  if (selection.length > 1) warnings.push({ code: 'MULTI_SELECTION', message: 'Multiple selected nodes were extracted under a common parent when available' });

  const extraction = stripUndefined({
    schemaVersion: 1,
    meta: {
      pageId: figma.currentPage.id,
      pageName: figma.currentPage.name,
      fileName: figma.root.name,
      selectedNodeCount: selection.length,
      extractedAt: new Date().toISOString(),
    },
    root,
    regions,
    texts,
    colors,
    typography,
    layoutHints,
    screenshots,
    assets,
    warnings,
  });

  figma.ui.postMessage({ type: 'extraction-ready', jobId, artifacts, extraction });
}

function serializeNode(node, depth, childIndex, parentNodeId) {
  const result = {
    id: node.id,
    name: node.name,
    parentNodeId,
    type: node.type,
    visible: node.visible,
    childIndex,
    zIndex: childIndex,
  };
  const box = toBox(node.absoluteBoundingBox);
  if (box) result.absoluteBoundingBox = box;
  for (const key of SERIALIZE_NODE_KEYS) {
    if (key in node) result[key] = safeClone(node[key]);
  }
  if ('characters' in node) result.characters = node.characters;
  if ('fontName' in node) result.fontName = safeClone(node.fontName);
  if ('fontSize' in node) result.fontSize = typeof node.fontSize === 'number' ? node.fontSize : undefined;
  if ('fontWeight' in node || 'fontName' in node) result.fontWeight = fontWeightValue(node.fontWeight, node.fontName);
  if ('lineHeight' in node) result.lineHeight = safeClone(node.lineHeight);
  if ('letterSpacing' in node) result.letterSpacing = safeClone(node.letterSpacing);
  if ('textCase' in node) result.textCase = simpleValue(node.textCase);
  if ('textAlignHorizontal' in node) result.textAlignHorizontal = simpleValue(node.textAlignHorizontal);
  if ('textAlignVertical' in node) result.textAlignVertical = simpleValue(node.textAlignVertical);
  if ('textAutoResize' in node) result.textAutoResize = simpleValue(node.textAutoResize);
  if ('children' in node && depth < 6) {
    result.children = node.children.slice(0, 240).map((child, index) => serializeNode(child, depth + 1, index, node.id));
  }
  return stripUndefined(result);
}

function collectRegions(root) {
  const regions = [];
  walk(root, (node, index) => {
    if (!node.absoluteBoundingBox) return;
    const kind = index === 0 ? 'page' : node.type === 'TEXT' ? 'text' : node.type === 'FRAME' || node.type === 'SECTION' || node.type === 'GROUP' ? 'section' : node.type === 'COMPONENT' || node.type === 'INSTANCE' ? 'component' : hasImageFill(node) ? 'image' : 'unknown';
    const strictness = kind === 'page' || kind === 'section' ? 'layout' : kind === 'unknown' ? 'perceptual' : 'strict';
    regions.push({
      regionId: node.id,
      nodeId: node.id,
      name: node.name,
      kind,
      box: node.absoluteBoundingBox,
      strictness,
      mapping: mappingForRegion(kind, strictness),
    });
  });
  return regions.map(stripUndefined);
}

function collectTextsFromFigma(rootNode) {
  const texts = [];
  const warnings = [];
  let visited = 0;
  let truncated = false;
  walkFigmaDeep(rootNode, (node, depth) => {
    visited += 1;
    if (visited > 5000) {
      truncated = true;
      return false;
    }
    if (node.visible === false) return 'skip-children';
    if (node.type !== 'TEXT' || typeof node.characters !== 'string' || node.characters.length === 0) return true;
    texts.push(stripUndefined({
      nodeId: node.id,
      name: node.name,
      text: node.characters,
      box: toBox(node.absoluteBoundingBox),
      fontFamily: fontFamily(node.fontName),
      fontSize: node.fontSize,
      fontWeight: fontWeightValue(node.fontWeight, node.fontName),
      lineHeight: lineHeightValue(node.lineHeight),
      letterSpacing: lineHeightValue(node.letterSpacing),
      textCase: simpleValue(node.textCase),
      textAlignHorizontal: simpleValue(node.textAlignHorizontal),
      textAlignVertical: simpleValue(node.textAlignVertical),
      textAutoResize: simpleValue(node.textAutoResize),
      color: firstSolidFillColor(node),
    }));
    if (texts.length >= 1000) {
      truncated = true;
      return false;
    }
    return true;
  });
  if (truncated) {
    warnings.push({
      code: 'TEXT_EXTRACTION_TRUNCATED',
      message: `Text extraction was truncated after ${texts.length} text nodes and ${visited} visited nodes.`,
      hint: 'Select a smaller frame or increase text extraction limits before high-confidence restoration.',
    });
  }
  return { texts, warnings };
}

function collectColors(root) {
  const colors = [];
  walk(root, (node) => {
    for (const paint of Array.isArray(node.fills) ? node.fills : []) {
      if (!paint || paint.visible === false || paint.type !== 'SOLID' || !paint.color) continue;
      colors.push({ nodeId: node.id, value: rgba(paint.color, paint.opacity == null ? 1 : paint.opacity), count: 1 });
    }
  });
  return colors;
}

function collectTypographyFromTexts(texts) {
  return texts.map((text) => stripUndefined({
    nodeId: text.nodeId,
    fontFamily: text.fontFamily,
    fontSize: text.fontSize,
    fontWeight: text.fontWeight,
    lineHeight: text.lineHeight,
  }));
}

function collectLayoutHints(root) {
  const hints = [];
  walk(root, (node) => {
    if (!hasLayoutHintEvidence(node)) return;
    const paddingEdges = paddingEdgesForNode(node);
    const alignment = alignmentForNode(node);
    const sizing = sizingForNode(node);
    const radius = radiusForNode(node);
    hints.push(stripUndefined({
      nodeId: node.id,
      parentNodeId: node.parentNodeId,
      name: node.name,
      display: node.layoutMode ? 'flex' : undefined,
      direction: node.layoutMode === 'HORIZONTAL' ? 'row' : node.layoutMode === 'VERTICAL' ? 'column' : undefined,
      alignment,
      sizing,
      constraints: objectValue(node.constraints),
      wrap: simpleValue(node.layoutWrap),
      clipsContent: typeof node.clipsContent === 'boolean' ? node.clipsContent : undefined,
      gap: node.itemSpacing,
      padding: paddingEdges ? [paddingEdges.top, paddingEdges.right, paddingEdges.bottom, paddingEdges.left] : undefined,
      paddingEdges,
      zIndex: typeof node.zIndex === 'number' ? node.zIndex : node.childIndex,
      layerIndex: typeof node.childIndex === 'number' ? node.childIndex : undefined,
      radius,
      effects: Array.isArray(node.effects) ? node.effects : undefined,
      opacity: typeof node.opacity === 'number' ? node.opacity : undefined,
      box: node.absoluteBoundingBox,
    }));
  });
  return hints;
}

function mappingForRegion(kind, strictness) {
  if (strictness === 'ignored') return 'ignored';
  if (kind === 'text' || kind === 'image') return 'required';
  return 'optional';
}

function hasLayoutHintEvidence(node) {
  return Boolean(
    node.layoutMode ||
    node.itemSpacing != null ||
    node.paddingLeft != null ||
    node.paddingRight != null ||
    node.paddingTop != null ||
    node.paddingBottom != null ||
    node.primaryAxisAlignItems ||
    node.counterAxisAlignItems ||
    node.primaryAxisSizingMode ||
    node.counterAxisSizingMode ||
    node.layoutSizingHorizontal ||
    node.layoutSizingVertical ||
    node.layoutAlign ||
    node.layoutGrow != null ||
    node.layoutPositioning ||
    node.layoutWrap ||
    node.constraints != null ||
    node.clipsContent != null ||
    node.childIndex != null ||
    node.zIndex != null ||
    node.cornerRadius != null ||
    node.topLeftRadius != null ||
    node.topRightRadius != null ||
    node.bottomRightRadius != null ||
    node.bottomLeftRadius != null ||
    node.effects != null ||
    node.opacity != null
  );
}

function paddingEdgesForNode(node) {
  const hasPadding = node.layoutMode || node.paddingLeft != null || node.paddingRight != null || node.paddingTop != null || node.paddingBottom != null;
  if (!hasPadding) return undefined;
  return {
    top: node.paddingTop || 0,
    right: node.paddingRight || 0,
    bottom: node.paddingBottom || 0,
    left: node.paddingLeft || 0,
  };
}

function alignmentForNode(node) {
  const alignment = stripUndefined({
    primaryAxis: simpleValue(node.primaryAxisAlignItems),
    counterAxis: simpleValue(node.counterAxisAlignItems),
    textHorizontal: simpleValue(node.textAlignHorizontal),
    textVertical: simpleValue(node.textAlignVertical),
  });
  return Object.keys(alignment).length ? alignment : undefined;
}

function sizingForNode(node) {
  const sizing = stripUndefined({
    horizontal: simpleValue(node.layoutSizingHorizontal),
    vertical: simpleValue(node.layoutSizingVertical),
    primaryAxis: simpleValue(node.primaryAxisSizingMode),
    counterAxis: simpleValue(node.counterAxisSizingMode),
    layoutGrow: typeof node.layoutGrow === 'number' ? node.layoutGrow : undefined,
    layoutAlign: simpleValue(node.layoutAlign),
    layoutPositioning: simpleValue(node.layoutPositioning),
  });
  return Object.keys(sizing).length ? sizing : undefined;
}

function radiusForNode(node) {
  const topLeft = numberValue(node.topLeftRadius);
  const topRight = numberValue(node.topRightRadius);
  const bottomRight = numberValue(node.bottomRightRadius);
  const bottomLeft = numberValue(node.bottomLeftRadius);
  const corners = stripUndefined({ topLeft, topRight, bottomRight, bottomLeft });
  if (Object.keys(corners).length) return corners;
  return numberValue(node.cornerRadius);
}

function walk(root, fn) {
  if (!root) return;
  let index = 0;
  const stack = [root];
  while (stack.length) {
    const node = stack.shift();
    fn(node, index++);
    if (node.children) stack.push(...node.children);
  }
}

async function exportAssets(rootNode) {
  const artifacts = [];
  const assets = [];
  const warnings = [];
  try {
    const imageFillResult = await exportImageFillAssets(rootNode);
    artifacts.push(...imageFillResult.artifacts);
    assets.push(...imageFillResult.assets);
    warnings.push(...imageFillResult.warnings);
  } catch (error) {
    warnings.push({
      code: 'IMAGE_FILL_ASSET_STAGE_FAILED',
      message: `Image fill asset scan failed and extraction continued: ${errorMessage(error)}`,
      hint: pluginErrorHint(error),
    });
  }
  let collected = { candidates: [], warnings: [] };
  try {
    collected = collectAssetNodes(rootNode);
  } catch (error) {
    warnings.push({
      code: 'ASSET_SCAN_FAILED',
      message: `Asset candidate scan failed and extraction continued without node exports: ${errorMessage(error)}`,
      hint: pluginErrorHint(error),
    });
  }
  const candidateItems = prioritizeAssetCandidates(collected.candidates, rootNode, warnings).slice(0, 64);
  warnings.push(...collected.warnings);
  for (let index = 0; index < candidateItems.length; index += 1) {
    const item = candidateItems[index];
    const node = item.node;
    if (typeof node.exportAsync !== 'function') continue;
    const vector = isVectorLike(node) && !hasImageFill(node);
    const policy = item.policy;
    if (policy.allowedUse === 'reference-only') {
      warnings.push({
        code: 'REFERENCE_ONLY_ASSET_EXPORTED',
        message: `Exported ${node.name || node.id} for visual reference only; do not use it as implementation content.`,
        hint: policy.reason,
      });
    }
    const baseId = `asset_${Date.now().toString(36)}_${index}`;
    try {
      if (vector) {
        const svgArtifactId = `${baseId}_svg`;
        const pngArtifactId = `${baseId}_png`;
        const svgBytes = await node.exportAsync({ format: 'SVG' });
        const pngBytes = await node.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 1 } });
        artifacts.push({
          artifactId: svgArtifactId,
          kind: 'asset',
          fileName: `${safeName(node.name || node.id)}.svg`,
          mediaType: 'image/svg+xml',
          sourceNodeId: node.id,
          bytes: svgBytes,
        });
        artifacts.push({
          artifactId: pngArtifactId,
          kind: 'asset',
          fileName: `${safeName(node.name || node.id)}.png`,
          mediaType: 'image/png',
          sourceNodeId: node.id,
          bytes: pngBytes,
        });
        assets.push({
          artifactId: svgArtifactId,
          fallbackArtifactId: pngArtifactId,
          nodeId: node.id,
          kind: 'svg',
          preferredFormat: 'svg',
          allowedUse: policy.allowedUse,
          sourceKind: 'vector',
          mediaType: 'image/svg+xml',
          fallbackMediaType: 'image/png',
        });
        continue;
      }
      const artifactId = `${baseId}_png`;
      const bytes = await node.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 1 } });
      artifacts.push({
        artifactId,
        kind: 'asset',
        fileName: `${safeName(node.name || node.id)}.png`,
        mediaType: 'image/png',
        sourceNodeId: node.id,
        bytes,
      });
      assets.push({
        artifactId,
        nodeId: node.id,
        kind: 'image',
        preferredFormat: 'png',
        allowedUse: policy.allowedUse,
        sourceKind: 'node-export',
        mediaType: 'image/png',
      });
    } catch (error) {
      warnings.push({
        code: 'ASSET_EXPORT_FAILED',
        message: `Failed to export asset ${node.name || node.id}: ${errorMessage(error)}`,
        hint: pluginErrorHint(error),
      });
      assets.push(missingNodeAssetEvidence(node, vector, policy, baseId));
    }
  }
  if (collected.candidates.length > candidateItems.length) {
    warnings.push({ code: 'ASSET_EXPORT_LIMIT', message: `Exported first ${candidateItems.length} prioritized asset candidates only` });
  }
  return { artifacts, assets, warnings };
}

async function exportImageFillAssets(rootNode) {
  const artifacts = [];
  const assets = [];
  const warnings = [];
  const byHash = {};
  let fillCount = 0;
  const fills = [];
  walkFigmaDeep(rootNode, (node) => {
    const imagePaints = directImagePaints(node);
    if (!imagePaints.length) return true;
    for (const item of imagePaints) fills.push({ node, paint: item.paint, index: item.index });
    return true;
  }, {
    onLimit: (summary) => warnings.push({
      code: 'IMAGE_FILL_SCAN_TRUNCATED',
      message: `Image fill scan was truncated after ${summary.visitedCount} visited nodes (${summary.reason || 'limit'}).`,
      hint: 'Some image fills may be missing. Select a smaller frame or rerun extraction on the affected section.',
    }),
  });
  for (const item of fills.slice(0, 128)) {
    const hash = item.paint.imageHash;
    if (!hash) continue;
    try {
      if (!byHash[hash]) {
        const image = figma.getImageByHash(hash);
        if (!image) {
          warnings.push({ code: 'IMAGE_FILL_NOT_FOUND', message: `Image fill bytes not found for ${item.node.name || item.node.id}.` });
          assets.push(missingImageFillAssetEvidence(item.node));
          continue;
        }
        const bytes = await image.getBytesAsync();
        const mediaType = mediaTypeFromBytes(bytes);
        const extension = extensionFromMediaType(mediaType);
        const artifactId = `asset_${Date.now().toString(36)}_fill_${fillCount}_${extension}`;
        fillCount += 1;
        byHash[hash] = { artifactId, mediaType, preferredFormat: extension };
        artifacts.push({
          artifactId,
          kind: 'asset',
          fileName: `${safeName(item.node.name || item.node.id)}.${extension}`,
          mediaType,
          sourceNodeId: item.node.id,
          bytes,
        });
      }
      const ref = byHash[hash];
      assets.push({
        artifactId: ref.artifactId,
        nodeId: item.node.id,
        kind: 'image',
        preferredFormat: ref.preferredFormat,
        allowedUse: 'implementation',
        sourceKind: 'image-fill',
        mediaType: ref.mediaType,
      });
      const textScan = scanTextDescendant(item.node);
      if (textScan.truncated) {
        warnings.push({
          code: 'TEXT_DESCENDANT_SCAN_TRUNCATED',
          message: `Text descendant scan was truncated for ${item.node.name || item.node.id}; treating the asset as if it may contain live text.`,
          hint: 'Implement descendant text as live DOM/CSS and use the image fill only for the bitmap background.',
        });
      }
      if (textScan.hasText || textScan.truncated) {
        warnings.push({
          code: 'IMAGE_FILL_EXTRACTED_WITH_LIVE_TEXT_OVERLAY',
          message: `Extracted image fill for ${item.node.name || item.node.id}; implement descendant text as live DOM, not as part of a raster export.`,
        });
      }
    } catch (error) {
      warnings.push({
        code: 'IMAGE_FILL_EXPORT_FAILED',
        message: `Failed to export image fill for ${item.node.name || item.node.id}: ${errorMessage(error)}`,
        hint: 'Retry extraction. If the image fill still cannot be extracted, finish non-image layout/text work and report the missing asset to the user.',
      });
      assets.push(missingImageFillAssetEvidence(item.node));
    }
  }
  if (fills.length > 128) warnings.push({ code: 'IMAGE_FILL_EXPORT_LIMIT', message: `Exported first 128 image fills out of ${fills.length}.` });
  return { artifacts, assets, warnings };
}

function collectAssetNodes(rootNode) {
  const candidates = [];
  const warnings = [];
  walkFigma(rootNode, (node, depth) => {
    if (depth === 0) return;
    const box = toBox(node.absoluteBoundingBox);
    if (!box || box.w < 2 || box.h < 2) return;
    const reason = assetCandidateReason(node);
    if (!reason) return;
    candidates.push(node);
  }, {
    onLimit: (summary) => warnings.push({
      code: 'ASSET_SCAN_TRUNCATED',
      message: `Asset candidate scan was truncated after ${summary.visitedCount} visited nodes (${summary.reason || 'limit'}).`,
      hint: 'Some assets may be missing. Select a smaller frame or rerun extraction on the affected section.',
    }),
  });
  return { candidates, warnings };
}

function walkFigma(rootNode, fn, options) {
  return walkFigmaTree(rootNode, fn, { maxDepth: 6, maxChildren: 240, ...(options || {}) });
}

function walkFigmaDeep(rootNode, fn, options) {
  return walkFigmaTree(rootNode, fn, { maxDepth: FIGMA_DEEP_TRAVERSAL_MAX_DEPTH, ...(options || {}) });
}

function walkFigmaTree(rootNode, fn, options) {
  const settings = options || {};
  const maxDepth = typeof settings.maxDepth === 'number' ? settings.maxDepth : FIGMA_DEEP_TRAVERSAL_MAX_DEPTH;
  const maxNodes = typeof settings.maxNodes === 'number' ? settings.maxNodes : FIGMA_TRAVERSAL_MAX_NODES;
  const maxChildren = typeof settings.maxChildren === 'number' ? settings.maxChildren : Infinity;
  const visited = typeof WeakSet === 'function' ? new WeakSet() : null;
  const stack = [{ node: rootNode, depth: 0 }];
  let cursor = 0;
  let visitedCount = 0;
  let truncated = false;
  let reason = '';
  while (cursor < stack.length) {
    if (visitedCount >= maxNodes) {
      truncated = true;
      reason = 'node-limit';
      break;
    }
    const current = stack[cursor];
    cursor += 1;
    if (!current || !current.node) continue;
    if (visited && typeof current.node === 'object') {
      if (visited.has(current.node)) continue;
      visited.add(current.node);
    }
    visitedCount += 1;
    const result = fn(current.node, current.depth);
    if (result === false) return { visitedCount, truncated: false, stopped: true };
    if (result === 'skip-children') continue;
    const children = 'children' in current.node && Array.isArray(current.node.children) ? current.node.children : [];
    if (!children.length) continue;
    if (current.depth >= maxDepth) {
      truncated = true;
      reason = reason || 'depth-limit';
      continue;
    }
    const childCount = Math.min(children.length, maxChildren);
    if (children.length > childCount) {
      truncated = true;
      reason = reason || 'children-limit';
    }
    for (let index = 0; index < childCount; index += 1) {
      stack.push({ node: children[index], depth: current.depth + 1 });
    }
  }
  const summary = { visitedCount, truncated, stopped: false, reason };
  if (truncated && typeof settings.onLimit === 'function') settings.onLimit(summary);
  return summary;
}

function toBox(box) {
  if (!box) return undefined;
  return { x: box.x, y: box.y, w: box.width, h: box.height };
}

function commonParent(nodes) {
  const parent = nodes[0] && nodes[0].parent;
  if (!parent) return null;
  return nodes.every((node) => node.parent && node.parent.id === parent.id) ? parent : null;
}

function hasImageFill(node) {
  return Array.isArray(node.fills) && node.fills.some((paint) => paint && paint.type === 'IMAGE');
}

function isVectorLike(node) {
  return ['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'POLYGON', 'LINE'].includes(node.type);
}

function isNamedAsset(node) {
  return ASSET_NAME_PATTERN.test(node.name || '');
}

function assetCandidateReason(node) {
  if (node.isAsset === true) return 'figma-asset';
  if (isVectorLike(node)) return 'vector';
  if (isNamedAsset(node)) return 'named-asset';
  return '';
}

function prioritizeAssetCandidates(candidates, rootNode, warnings) {
  return candidates
    .map((node, index) => {
      try {
        const policy = assetUsePolicy(node, rootNode, warnings);
        return { node, policy, priority: assetCandidatePriority(node, policy, rootNode), index };
      } catch (error) {
        warnings.push({
          code: 'ASSET_POLICY_FAILED',
          message: `Asset policy failed for ${node.name || node.id}; exported node will be treated as reference-only if available: ${errorMessage(error)}`,
          hint: pluginErrorHint(error),
        });
        const policy = {
          allowedUse: 'reference-only',
          reason: 'Asset policy failed during extraction; do not use this export as implementation content without manual review.',
        };
        return { node, policy, priority: 100, index };
      }
    })
    .sort((a, b) => a.priority - b.priority || a.index - b.index);
}

function assetCandidatePriority(node, policy, rootNode) {
  if (policy.allowedUse === 'reference-only') return 100;
  if (isVectorLike(node)) return 0;
  const box = toBox(node.absoluteBoundingBox);
  const rootBox = toBox(rootNode.absoluteBoundingBox);
  if (box && isThinDecorativeAsset(node, box, rootBox)) return 1;
  if (hasDirectImageFill(node)) return 2;
  if (node.isAsset === true) return 3;
  if (isNamedAsset(node)) return 4;
  return 10;
}

function assetUsePolicy(node, rootNode, warnings) {
  const box = toBox(node.absoluteBoundingBox);
  if (!box) return { allowedUse: 'implementation', reason: '' };
  const rootBox = toBox(rootNode.absoluteBoundingBox);
  const textScan = scanTextDescendant(node);
  if (textScan.truncated) {
    warnings.push({
      code: 'TEXT_DESCENDANT_SCAN_TRUNCATED',
      message: `Text descendant scan was truncated for ${node.name || node.id}; treating the asset as reference-only.`,
      hint: 'Select a smaller frame or rerun extraction on the affected component if this asset must be used directly.',
    });
  }
  const hasText = textScan.hasText || textScan.truncated;
  const layoutContainer = isLayoutContainer(node);
  const largeContainer = isLargeAssetCandidate(node, box, rootNode);
  if (hasText) {
    return {
      allowedUse: 'reference-only',
      reason: 'This exported node contains text descendants. Implement text as live DOM/CSS and use this asset only as visual reference.',
    };
  }
  if (layoutContainer && !hasDirectImageFill(node) && node.isAsset !== true && !isThinDecorativeAsset(node, box, rootBox)) {
    return {
      allowedUse: 'reference-only',
      reason: 'This exported node is a layout container. Implement structure with DOM/CSS unless it is a real extracted image/vector asset.',
    };
  }
  if (largeContainer && !isThinDecorativeAsset(node, box, rootBox)) {
    return {
      allowedUse: 'reference-only',
      reason: 'This exported node is large enough to behave like a section/page slice. Use only as reference evidence.',
    };
  }
  return { allowedUse: 'implementation', reason: '' };
}

function missingNodeAssetEvidence(node, vector, policy, baseId) {
  if (vector) {
    return {
      artifactId: `${baseId}_svg`,
      fallbackArtifactId: `${baseId}_png`,
      nodeId: node.id,
      kind: 'svg',
      preferredFormat: 'svg',
      allowedUse: policy.allowedUse,
      sourceKind: 'vector',
      mediaType: 'image/svg+xml',
      fallbackMediaType: 'image/png',
    };
  }
  return {
    artifactId: `${baseId}_png`,
    nodeId: node.id,
    kind: 'image',
    preferredFormat: 'png',
    allowedUse: policy.allowedUse,
    sourceKind: 'node-export',
    mediaType: 'image/png',
  };
}

function missingImageFillAssetEvidence(node) {
  return {
    nodeId: node.id,
    kind: 'image',
    preferredFormat: 'unknown',
    allowedUse: 'implementation',
    sourceKind: 'image-fill',
  };
}

function isThinDecorativeAsset(node, box, rootBox) {
  if (!rootBox) return false;
  if (!DECORATIVE_NAME_PATTERN.test(node.name || '')) return false;
  const areaRatio = (box.w * box.h) / Math.max(1, rootBox.w * rootBox.h);
  const thin = box.h <= Math.max(72, rootBox.h * 0.025) || box.w <= Math.max(72, rootBox.w * 0.025);
  return thin && areaRatio <= 0.06;
}

function isLargeAssetCandidate(node, box, rootNode) {
  const rootBox = toBox(rootNode.absoluteBoundingBox);
  if (!rootBox) return false;
  const areaRatio = (box.w * box.h) / Math.max(1, rootBox.w * rootBox.h);
  const nearlyFullWidth = box.w >= rootBox.w * 0.7;
  const substantialHeight = box.h >= Math.min(160, Math.max(72, rootBox.h * 0.06));
  return areaRatio > 0.18 || (nearlyFullWidth && substantialHeight);
}

function isLayoutContainer(node) {
  return ['FRAME', 'GROUP', 'SECTION', 'COMPONENT', 'INSTANCE'].includes(node.type);
}

function hasDirectImageFill(node) {
  return hasImageFill(node);
}

function directImagePaints(node) {
  const fills = Array.isArray(node.fills) ? node.fills : [];
  return fills
    .map((paint, index) => ({ paint, index }))
    .filter((item) => item.paint && item.paint.visible !== false && item.paint.type === 'IMAGE' && item.paint.imageHash);
}

function hasTextDescendant(node) {
  const result = scanTextDescendant(node);
  return result.hasText || result.truncated;
}

function scanTextDescendant(node) {
  let hasText = false;
  if (!node) return { hasText: false, truncated: false, visitedCount: 0, reason: '' };
  const summary = walkFigmaDeep(node, (current) => {
    if (current.type === 'TEXT' || typeof current.characters === 'string') {
      hasText = true;
      return false;
    }
    return true;
  }, {
    maxDepth: TEXT_DESCENDANT_SCAN_MAX_DEPTH,
    maxNodes: TEXT_DESCENDANT_SCAN_MAX_NODES,
  });
  return {
    hasText,
    truncated: Boolean(summary.truncated),
    visitedCount: summary.visitedCount,
    reason: summary.reason || '',
  };
}

function firstSolidFillColor(node) {
  const fill = Array.isArray(node.fills) ? node.fills.find((paint) => paint && paint.visible !== false && paint.type === 'SOLID' && paint.color) : null;
  return fill ? rgba(fill.color, fill.opacity == null ? 1 : fill.opacity) : undefined;
}

function fontFamily(fontName) {
  return fontName && typeof fontName === 'object' && typeof fontName.family === 'string' ? fontName.family : undefined;
}

function fontWeightValue(fontWeight, fontName) {
  const direct = simpleValue(fontWeight);
  if (direct !== undefined) return direct;
  const style = fontName && typeof fontName === 'object' && typeof fontName.style === 'string' ? fontName.style.toLowerCase() : '';
  if (!style) return undefined;
  if (style.includes('thin')) return 100;
  if (style.includes('extra light') || style.includes('ultra light')) return 200;
  if (style.includes('light')) return 300;
  if (style.includes('medium')) return 500;
  if (style.includes('semi bold') || style.includes('demi bold')) return 600;
  if (style.includes('extra bold') || style.includes('ultra bold')) return 800;
  if (style.includes('black') || style.includes('heavy')) return 900;
  if (style.includes('bold')) return 700;
  return 400;
}

function lineHeightValue(lineHeight) {
  if (!lineHeight) return undefined;
  if (typeof lineHeight === 'number' || typeof lineHeight === 'string') return lineHeight;
  if (typeof lineHeight.value === 'number') return lineHeight.unit === 'PERCENT' ? `${lineHeight.value}%` : lineHeight.value;
  return undefined;
}

function mediaTypeFromBytes(bytes) {
  if (bytes && bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes && bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes && bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
  return 'image/png';
}

function extensionFromMediaType(mediaType) {
  if (mediaType === 'image/jpeg') return 'jpg';
  if (mediaType === 'image/gif') return 'gif';
  return 'png';
}

function simpleValue(value) {
  return typeof value === 'number' || typeof value === 'string' ? value : undefined;
}

function numberValue(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

function rgba(color, opacity) {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  const a = Math.round(opacity * 1000) / 1000;
  return a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a})`;
}

function safeClone(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_error) {
    return undefined;
  }
}

function safeName(value) {
  return String(value || 'selection').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80) || 'selection';
}

function errorMessage(error) {
  return error && error.message ? error.message : String(error);
}

function pluginErrorHint(error) {
  if (!error || !error.stack) return undefined;
  return String(error.stack).slice(0, 1500);
}

function stripUndefined(value) {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) output[key] = stripUndefined(item);
  }
  return output;
}
