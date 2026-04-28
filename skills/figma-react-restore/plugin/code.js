figma.showUI(__html__, { width: 380, height: 560, themeColors: true });

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
  const root = serializeNode(rootNode, 0);
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
  if (typeof rootNode.exportAsync === 'function') {
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
  figma.ui.postMessage({ type: 'progress', jobId, progress: { stage: 'assets', message: 'Exporting image and vector assets', progress: 0.72 } });
  const assetResult = await exportAssets(rootNode);
  artifacts.push(...assetResult.artifacts);
  assets.push(...assetResult.assets);
  warnings.push(...assetResult.warnings);
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

function serializeNode(node, depth) {
  const result = {
    id: node.id,
    name: node.name,
    type: node.type,
    visible: node.visible,
  };
  const box = toBox(node.absoluteBoundingBox);
  if (box) result.absoluteBoundingBox = box;
  for (const key of ['fills', 'strokes', 'effects', 'cornerRadius', 'layoutMode', 'itemSpacing', 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom']) {
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
    result.children = node.children.slice(0, 240).map((child) => serializeNode(child, depth + 1));
  }
  return stripUndefined(result);
}

function collectRegions(root) {
  const regions = [];
  walk(root, (node, index) => {
    if (!node.absoluteBoundingBox) return;
    const kind = index === 0 ? 'page' : node.type === 'TEXT' ? 'text' : node.type === 'FRAME' || node.type === 'SECTION' || node.type === 'GROUP' ? 'section' : node.type === 'COMPONENT' || node.type === 'INSTANCE' ? 'component' : hasImageFill(node) ? 'image' : 'unknown';
    regions.push({
      regionId: node.id,
      nodeId: node.id,
      name: node.name,
      kind,
      box: node.absoluteBoundingBox,
      strictness: kind === 'page' || kind === 'section' ? 'layout' : kind === 'unknown' ? 'perceptual' : 'strict',
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
    if (!node.layoutMode && node.itemSpacing == null && node.paddingLeft == null) return;
    hints.push(stripUndefined({
      nodeId: node.id,
      name: node.name,
      display: node.layoutMode ? 'flex' : undefined,
      direction: node.layoutMode === 'HORIZONTAL' ? 'row' : node.layoutMode === 'VERTICAL' ? 'column' : undefined,
      gap: node.itemSpacing,
      padding: [node.paddingTop || 0, node.paddingRight || 0, node.paddingBottom || 0, node.paddingLeft || 0],
      box: node.absoluteBoundingBox,
    }));
  });
  return hints;
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
  const imageFillResult = await exportImageFillAssets(rootNode);
  artifacts.push(...imageFillResult.artifacts);
  assets.push(...imageFillResult.assets);
  warnings.push(...imageFillResult.warnings);
  const collected = collectAssetNodes(rootNode);
  const candidateItems = prioritizeAssetCandidates(collected.candidates, rootNode).slice(0, 64);
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
    try {
      const baseId = `asset_${Date.now().toString(36)}_${index}`;
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
        message: `Failed to export asset ${node.name || node.id}: ${error && error.message ? error.message : String(error)}`,
      });
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
  });
  for (const item of fills.slice(0, 128)) {
    const hash = item.paint.imageHash;
    if (!hash) continue;
    try {
      if (!byHash[hash]) {
        const image = figma.getImageByHash(hash);
        if (!image) {
          warnings.push({ code: 'IMAGE_FILL_NOT_FOUND', message: `Image fill bytes not found for ${item.node.name || item.node.id}.` });
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
      if (hasTextDescendant(item.node)) {
        warnings.push({
          code: 'IMAGE_FILL_EXTRACTED_WITH_LIVE_TEXT_OVERLAY',
          message: `Extracted image fill for ${item.node.name || item.node.id}; implement descendant text as live DOM, not as part of a raster export.`,
        });
      }
    } catch (error) {
      warnings.push({
        code: 'IMAGE_FILL_EXPORT_FAILED',
        message: `Failed to export image fill for ${item.node.name || item.node.id}: ${error && error.message ? error.message : String(error)}`,
        hint: 'Retry extraction. If the image fill still cannot be extracted, finish non-image layout/text work and report the missing asset to the user.',
      });
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
  });
  return { candidates, warnings };
}

function walkFigma(rootNode, fn) {
  const stack = [{ node: rootNode, depth: 0 }];
  while (stack.length) {
    const current = stack.shift();
    if (!current || !current.node) continue;
    fn(current.node, current.depth);
    if ('children' in current.node && current.depth < 6) {
      for (const child of current.node.children.slice(0, 240)) stack.push({ node: child, depth: current.depth + 1 });
    }
  }
}

function walkFigmaDeep(rootNode, fn) {
  const stack = [{ node: rootNode, depth: 0 }];
  while (stack.length) {
    const current = stack.shift();
    if (!current || !current.node) continue;
    const result = fn(current.node, current.depth);
    if (result === false) break;
    if (result === 'skip-children') continue;
    if ('children' in current.node && current.depth < 32) {
      for (const child of current.node.children) stack.push({ node: child, depth: current.depth + 1 });
    }
  }
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
  return /\b(icon|logo|avatar|photo|image|img|illustration|asset|decorative|decoration|divider|border|separator|ornament|pattern)\b/i.test(node.name || '');
}

function assetCandidateReason(node) {
  if (node.isAsset === true) return 'figma-asset';
  if (isVectorLike(node)) return 'vector';
  if (isNamedAsset(node)) return 'named-asset';
  return '';
}

function prioritizeAssetCandidates(candidates, rootNode) {
  return candidates
    .map((node, index) => {
      const policy = assetUsePolicy(node, rootNode);
      return { node, policy, priority: assetCandidatePriority(node, policy, rootNode), index };
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

function assetUsePolicy(node, rootNode) {
  const box = toBox(node.absoluteBoundingBox);
  if (!box) return { allowedUse: 'implementation', reason: '' };
  const rootBox = toBox(rootNode.absoluteBoundingBox);
  const hasText = hasTextDescendant(node);
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

function isThinDecorativeAsset(node, box, rootBox) {
  if (!rootBox) return false;
  if (!/\b(decorative|decoration|divider|border|separator|ornament|pattern)\b/i.test(node.name || '')) return false;
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
  if (!node) return false;
  if (node.type === 'TEXT' || typeof node.characters === 'string') return true;
  if (!('children' in node)) return false;
  return node.children.some((child) => hasTextDescendant(child));
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

function stripUndefined(value) {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) output[key] = stripUndefined(item);
  }
  return output;
}
