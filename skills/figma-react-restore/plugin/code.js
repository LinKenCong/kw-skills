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
      jobId: message.job?.jobId,
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
  const rootNode = selection.length === 1 ? selection[0] : commonParent(selection) || selection[0];
  figma.ui.postMessage({ type: 'progress', jobId, progress: { stage: 'serialize', message: 'Serializing selected node tree', progress: 0.2 } });
  const root = serializeNode(rootNode, 0);
  const regions = collectRegions(root);
  const texts = collectTexts(root);
  const colors = collectColors(root);
  const typography = collectTypography(root);
  const layoutHints = collectLayoutHints(root);

  const artifactId = `shot_${Date.now().toString(36)}`;
  const artifacts = [];
  const screenshots = [];
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
    assets: [],
    warnings: selection.length > 1 ? [{ code: 'MULTI_SELECTION', message: 'Multiple selected nodes were extracted under a common parent when available' }] : [],
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
  if ('fontWeight' in node) result.fontWeight = node.fontWeight;
  if ('lineHeight' in node) result.lineHeight = safeClone(node.lineHeight);
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

function collectTexts(root) {
  const texts = [];
  walk(root, (node) => {
    if (!node.characters) return;
    texts.push(stripUndefined({
      nodeId: node.id,
      text: node.characters,
      box: node.absoluteBoundingBox,
      fontFamily: fontFamily(node.fontName),
      fontSize: node.fontSize,
      fontWeight: node.fontWeight,
      lineHeight: lineHeightValue(node.lineHeight),
    }));
  });
  return texts;
}

function collectColors(root) {
  const counts = new Map();
  walk(root, (node) => {
    for (const paint of Array.isArray(node.fills) ? node.fills : []) {
      if (!paint || paint.visible === false || paint.type !== 'SOLID' || !paint.color) continue;
      const color = rgba(paint.color, paint.opacity == null ? 1 : paint.opacity);
      counts.set(color, (counts.get(color) || 0) + 1);
    }
  });
  return Array.from(counts.entries()).map(([value, count]) => ({ value, count }));
}

function collectTypography(root) {
  const typography = [];
  walk(root, (node) => {
    if (!node.characters && !node.fontName && !node.fontSize) return;
    typography.push(stripUndefined({
      nodeId: node.id,
      fontFamily: fontFamily(node.fontName),
      fontSize: node.fontSize,
      fontWeight: node.fontWeight,
      lineHeight: lineHeightValue(node.lineHeight),
    }));
  });
  return typography;
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

function fontFamily(fontName) {
  return fontName && typeof fontName === 'object' && typeof fontName.family === 'string' ? fontName.family : undefined;
}

function lineHeightValue(lineHeight) {
  if (!lineHeight) return undefined;
  if (typeof lineHeight === 'number' || typeof lineHeight === 'string') return lineHeight;
  if (typeof lineHeight.value === 'number') return lineHeight.unit === 'PERCENT' ? `${lineHeight.value}%` : lineHeight.value;
  return undefined;
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
