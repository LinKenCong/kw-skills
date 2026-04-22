#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

// ── Pruning helpers ──

function pruneColor(paintArray) {
  if (!Array.isArray(paintArray)) return undefined;
  const visible = paintArray.find(
    (p) => p.visible !== false && p.type === 'SOLID' && p.color
  );
  if (!visible) return undefined;
  return visible.color.hex;
}

function pruneGradient(paintArray) {
  if (!Array.isArray(paintArray)) return undefined;
  const grad = paintArray.find(
    (p) => p.visible !== false && p.type && p.type.includes('GRADIENT')
  );
  if (!grad) return undefined;
  return {
    type: grad.type,
    stops: (grad.gradientStops || []).map((s) => ({
      color: s.color?.hex,
      position: s.position,
    })),
  };
}

function prunePadding(padding) {
  if (!padding) return undefined;
  const { top, right, bottom, left } = padding;
  if (top === 0 && right === 0 && bottom === 0 && left === 0) return undefined;
  if (top === right && right === bottom && bottom === left) return top;
  return [top, right, bottom, left];
}

function pruneBorderRadius(node) {
  const style = node.style || {};
  const radius = style.borderRadius;
  if (!radius || radius === 0) return undefined;
  const perCorner = style.borderRadiusPerCorner;
  if (perCorner) {
    const { topLeft, topRight, bottomRight, bottomLeft } = perCorner;
    if (topLeft === topRight && topRight === bottomRight && bottomRight === bottomLeft) {
      return topLeft || undefined;
    }
    return [topLeft, topRight, bottomRight, bottomLeft];
  }
  return radius;
}

function pruneBorderWidth(node) {
  const style = node.style || {};
  const bw = style.borderWidth;
  if (!bw || bw === 0) return {};
  const perSide = style.borderWidthPerSide;
  if (perSide) {
    const { top, right, bottom, left } = perSide;
    if (top === right && right === bottom && bottom === left) {
      return top > 0 ? { borderWidth: top } : {};
    }
    const result = {};
    if (top > 0) result.borderTop = top;
    if (right > 0) result.borderRight = right;
    if (bottom > 0) result.borderBottom = bottom;
    if (left > 0) result.borderLeft = left;
    return result;
  }
  return { borderWidth: bw };
}

function pruneBox(box) {
  if (!box) return {};
  const result = {};

  result.w = box.width;
  result.h = box.height;

  if (box.display === 'flex') {
    result.display = 'flex';
    if (box.direction) result.dir = box.direction;
    if (box.justify && box.justify !== 'flex-start') result.justify = box.justify;
    if (box.align && box.align !== 'stretch') result.align = box.align;
    if (box.gap && box.gap > 0) result.gap = box.gap;
    if (box.wrap) result.wrap = true;
    if (box.columnGap && box.columnGap > 0 && box.wrap) result.columnGap = box.columnGap;
  }

  const pad = prunePadding(box.padding);
  if (pad !== undefined) result.pad = pad;

  if (box.widthSizing && box.widthSizing !== 'fixed') result.wSizing = box.widthSizing;
  if (box.heightSizing && box.heightSizing !== 'fixed') result.hSizing = box.heightSizing;
  if (box.overflow === 'hidden') result.overflow = 'hidden';
  if (box.positioning === 'ABSOLUTE') {
    result.position = 'absolute';
    result.x = box.x;
    result.y = box.y;
  }
  if (box.layoutAlign === 'STRETCH') result.layoutAlign = 'STRETCH';
  if (box.layoutGrow && box.layoutGrow > 0) result.layoutGrow = box.layoutGrow;
  if (box.maxWidth) result.maxW = box.maxWidth;
  if (box.maxHeight) result.maxH = box.maxHeight;
  if (box.minWidth) result.minW = box.minWidth;

  return result;
}

function pruneStyle(node) {
  const style = node.style || {};
  const result = {};

  const bgHex = pruneColor(style.background);
  if (bgHex) result.bg = bgHex;

  const gradient = pruneGradient(style.background);
  if (gradient) result.gradient = gradient;

  if (Array.isArray(style.background)) {
    const imgBg = style.background.find((p) => p.visible !== false && p.type === 'IMAGE');
    if (imgBg) {
      const hash = imgBg.imageHash;
      result.bgImage = hash || true;
      if (hash) result.bgImageFile = `assets/${hash}.png`;
    }
  }

  const bgPaint = Array.isArray(style.background)
    ? style.background.find((p) => p.visible !== false && p.type === 'SOLID')
    : null;
  if (bgPaint && bgPaint.opacity !== undefined && bgPaint.opacity !== 1) {
    result.bgOpacity = bgPaint.opacity;
  }

  const borderHex = pruneColor(style.borderColor);
  if (borderHex) result.borderColor = borderHex;

  const borderWidths = pruneBorderWidth(node);
  Object.assign(result, borderWidths);

  const radius = pruneBorderRadius(node);
  if (radius !== undefined) result.radius = radius;

  if (Array.isArray(style.effects)) {
    const shadows = [];
    for (const fx of style.effects) {
      if (fx.visible === false) continue;
      if (fx.type === 'DROP_SHADOW') {
        shadows.push({
          x: fx.offset?.x,
          y: fx.offset?.y,
          blur: fx.radius,
          spread: fx.spread,
          color: fx.color?.hex,
        });
      } else if (fx.type === 'BACKGROUND_BLUR') {
        result.blur = fx.radius;
      }
    }
    if (shadows.length === 1) result.shadow = shadows[0];
    else if (shadows.length > 1) result.shadow = shadows;
  }

  if (style.opacity !== undefined && style.opacity !== 1) {
    result.opacity = style.opacity;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function pruneText(node) {
  if (!node.text) return undefined;
  const t = node.text;
  const result = { text: t.characters };

  const firstSegment = t.segments?.[0] || t;
  if (firstSegment.fontName?.family) result.font = firstSegment.fontName.family;
  if (firstSegment.fontSize) result.size = firstSegment.fontSize;
  const weight = firstSegment.fontName?.weight || firstSegment.fontWeight;
  if (weight && weight !== 400 && weight !== 'Regular') result.weight = weight;

  if (firstSegment.lineHeight) {
    const lh = firstSegment.lineHeight;
    if (lh.unit === 'PERCENT') result.lh = `${lh.value}%`;
    else if (lh.unit === 'PIXELS') result.lh = `${lh.value}px`;
  }

  if (firstSegment.letterSpacing) {
    const ls = firstSegment.letterSpacing;
    if (ls.unit === 'PERCENT' && ls.value !== 0) {
      result.ls = `${roundNum(ls.value / 100)}em`;
    } else if (ls.unit === 'PIXELS' && ls.value !== 0) {
      result.ls = `${ls.value}px`;
    }
  }

  if (firstSegment.textAlignHorizontal && firstSegment.textAlignHorizontal !== 'LEFT') {
    result.align = firstSegment.textAlignHorizontal.toLowerCase();
  }
  if (firstSegment.textCase && firstSegment.textCase !== 'ORIGINAL') {
    result.case = firstSegment.textCase.toLowerCase();
  }

  const textColor = t.fills
    ? pruneColor(t.fills)
    : firstSegment.fills
      ? pruneColor(firstSegment.fills)
      : undefined;
  if (textColor && textColor !== '#000000') result.color = textColor;

  if (t.segments && t.segments.length > 1) {
    const hasStyleDiff = t.segments.some((seg, i) => {
      if (i === 0) return false;
      const prev = t.segments[i - 1];
      return (
        seg.fills?.[0]?.color?.hex !== prev.fills?.[0]?.color?.hex ||
        seg.fontName?.family !== prev.fontName?.family ||
        seg.fontSize !== prev.fontSize
      );
    });
    if (hasStyleDiff) {
      result.segments = t.segments.map((seg) => {
        const s = { text: seg.characters };
        if (seg.fills?.[0]?.color?.hex) s.color = seg.fills[0].color.hex;
        if (seg.fontName?.family !== firstSegment.fontName?.family) s.font = seg.fontName?.family;
        if (seg.fontSize !== firstSegment.fontSize) s.size = seg.fontSize;
        if (seg.fontName?.weight !== weight) s.weight = seg.fontName?.weight;
        return s;
      });
    }
  }

  return result;
}

function roundNum(n) {
  return Math.round(n * 1000) / 1000;
}

// ── Node pruning ──

function pruneNode(node, includeChildren) {
  if (!node) return null;
  if (node.visible === false) return null;

  const result = { id: node.id, name: node.name, type: node.type };

  const box = pruneBox(node.box);
  if (Object.keys(box).length > 0) result.box = box;

  const style = pruneStyle(node);
  if (style) result.style = style;

  const text = pruneText(node);
  if (text) result.text = text;

  if (node.component) result.component = node.component;

  if (includeChildren && node.children && node.children.length > 0) {
    result.children = node.children
      .map((child) => pruneNode(child, true))
      .filter(Boolean);
  }

  return result;
}

function pruneNodeShallow(node) {
  if (!node) return null;
  if (node.visible === false) return null;
  const result = { id: node.id, name: node.name, type: node.type };
  const box = pruneBox(node.box);
  if (Object.keys(box).length > 0) result.box = box;
  const style = pruneStyle(node);
  if (style) result.style = style;
  const text = pruneText(node);
  if (text) result.text = text;
  if (node.component) result.component = node.component;
  if (node.children && node.children.length > 0) {
    result.children = node.children
      .filter((c) => c.visible !== false)
      .map((c) => ({ id: c.id, name: c.name, type: c.type }));
  }
  return result;
}

// ── Tree building ──

function buildTree(node, maxDepth, currentDepth) {
  if (!node || node.visible === false) return null;
  const entry = {
    id: node.id,
    name: node.name,
    type: node.type,
    size: [node.box?.width, node.box?.height],
  };

  if (currentDepth <= 1 && node.box && typeof node.box.x === 'number' && typeof node.box.y === 'number') {
    entry.offset = [node.box.x, node.box.y];
  }

  if (node.box?.display === 'flex') {
    let layout = node.box.direction || 'row';
    if (node.box.wrap) layout += ' wrap';
    entry.layout = layout;
  }

  if (node.children && node.children.length > 0) {
    if (currentDepth < maxDepth) {
      entry.children = node.children
        .filter((c) => c.visible !== false)
        .map((c) => buildTree(c, maxDepth, currentDepth + 1))
        .filter(Boolean);
    } else {
      entry.childCount = node.children.filter((c) => c.visible !== false).length;
    }
  }

  return entry;
}

// ── Find node by ID ──

function findNode(node, nodeId) {
  if (!node) return null;
  if (node.id === nodeId) return node;
  if (node.children) {
    for (const child of node.children) {
      const found = findNode(child, nodeId);
      if (found) return found;
    }
  }
  return null;
}

// ── Find frame by name ──

function findFrame(root, frameName) {
  if (!root.children) return null;
  const lower = frameName.toLowerCase();
  return root.children.find(
    (c) => c.name && c.name.toLowerCase() === lower
  ) || null;
}

function countNodes(node) {
  if (!node) return 0;
  let count = 1;
  if (node.children) {
    for (const c of node.children) count += countNodes(c);
  }
  return count;
}

// ── Text extraction ──

function collectTextNodes(node, parentName) {
  const results = [];
  if (!node || node.visible === false) return results;

  const sectionName = parentName || node.name;

  if (node.type === 'TEXT' && node.text) {
    const entry = pruneText(node);
    entry.id = node.id;
    entry.section = sectionName;
    results.push(entry);
  }

  if (node.children) {
    for (const child of node.children) {
      results.push(...collectTextNodes(child, node.name));
    }
  }

  return results;
}

// ── Palette extraction ──

function collectPalette(node) {
  const colors = new Map();
  const fonts = new Map();
  const spacings = new Set();
  const borders = new Map();

  function walk(n) {
    if (!n || n.visible === false) return;

    if (n.style) {
      const bgHex = pruneColor(n.style.background);
      if (bgHex) colors.set(bgHex, (colors.get(bgHex) || 0) + 1);

      const borderHex = pruneColor(n.style.borderColor);
      if (borderHex) colors.set(borderHex, (colors.get(borderHex) || 0) + 1);

      const bw = pruneBorderWidth(n);
      if (bw.borderWidth) {
        const key = `${bw.borderWidth}px ${borderHex || '#000'}`;
        borders.set(key, (borders.get(key) || 0) + 1);
      }
    }

    if (n.text) {
      const seg = n.text.segments?.[0] || n.text;
      if (seg.fontName?.family && seg.fontSize) {
        const weight = seg.fontName.weight || seg.fontWeight || 400;
        const key = `${seg.fontName.family}/${seg.fontSize}/${weight}`;
        fonts.set(key, (fonts.get(key) || 0) + 1);
      }
      if (n.text.fills) {
        const textColor = pruneColor(n.text.fills);
        if (textColor) colors.set(textColor, (colors.get(textColor) || 0) + 1);
      }
    }

    if (n.box) {
      if (n.box.gap && n.box.gap > 0) spacings.add(n.box.gap);
      if (n.box.padding) {
        const { top, right, bottom, left } = n.box.padding;
        [top, right, bottom, left].filter((v) => v > 0).forEach((v) => spacings.add(v));
      }
    }

    if (n.children) n.children.forEach(walk);
  }

  walk(node);

  return {
    colors: [...colors.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([hex, count]) => ({ hex, count })),
    fonts: [...fonts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => {
        const [family, size, weight] = key.split('/');
        return { family, size: Number(size), weight: Number(weight), count };
      }),
    spacings: [...spacings].sort((a, b) => a - b),
    borders: [...borders.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([desc, count]) => ({ desc, count })),
  };
}

// ── CLI argument parsing ──

function parseQueryArgs(args) {
  const result = { subcommand: null, nodeId: null, cache: null, frame: null, page: null, level: null, depth: 3 };
  let i = 0;

  if (args.length > 0 && !args[0].startsWith('--')) {
    result.subcommand = args[0];
    i = 1;
  }

  if (i < args.length && !args[i].startsWith('--')) {
    result.nodeId = args[i];
    i++;
  }

  while (i < args.length) {
    if (args[i] === '--cache' && i + 1 < args.length) {
      result.cache = args[++i];
    } else if (args[i] === '--frame' && i + 1 < args.length) {
      result.frame = args[++i];
    } else if (args[i] === '--depth' && i + 1 < args.length) {
      result.depth = parseInt(args[++i], 10);
    } else if (args[i] === '--page' && i + 1 < args.length) {
      result.page = args[++i];
    } else if (args[i] === '--level' && i + 1 < args.length) {
      result.level = parseInt(args[++i], 10);
    }
    i++;
  }

  return result;
}

function normalizeMatchValue(value) {
  return String(value || '').trim().toLowerCase();
}

function matchesPage(page, needle) {
  if (!needle) return true;
  const normalizedNeedle = normalizeMatchValue(needle);
  return normalizeMatchValue(page.pageId) === normalizedNeedle || normalizeMatchValue(page.pageName) === normalizedNeedle;
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return readJsonFile(filePath);
  } catch {
    return null;
  }
}

function sanitizePathSegment(value) {
  return String(value || 'unknown').replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function resolveCacheRelativePath(cacheDir, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) return null;

  const resolvedCacheDir = path.resolve(cacheDir);
  const resolvedPath = path.resolve(resolvedCacheDir, relativePath);
  const relativeToCache = path.relative(resolvedCacheDir, resolvedPath);
  if (!relativeToCache || relativeToCache === '.') return null;
  if (relativeToCache === '..' || relativeToCache.startsWith(`..${path.sep}`) || path.isAbsolute(relativeToCache)) return null;
  return resolvedPath;
}

function loadCapabilities() {
  const capabilitiesPath = path.resolve(new URL('../plugin/capabilities.json', import.meta.url).pathname);
  const registry = readJsonIfExists(capabilitiesPath);
  if (!registry || !Array.isArray(registry.capabilities)) {
    return { ok: false, error: `Capability registry missing or invalid: ${capabilitiesPath}` };
  }
  return {
    ok: true,
    schemaVersion: registry.schemaVersion || 1,
    generatedAt: registry.generatedAt || null,
    registryPath: capabilitiesPath,
    capabilities: registry.capabilities,
  };
}

function resolveCacheContext(cacheDir) {
  const bundlePath = path.join(cacheDir, 'bundle.json');
  if (fs.existsSync(bundlePath)) {
    const bundle = readJsonFile(bundlePath);
    return {
      ok: true,
      kind: 'bundle',
      cacheDir,
      bundle,
      pagesIndex: readJsonIfExists(path.join(cacheDir, 'indexes', 'pages.json')),
      screenshotsIndex: readJsonIfExists(path.join(cacheDir, 'indexes', 'screenshots.json')),
      regionsIndex: readJsonIfExists(path.join(cacheDir, 'indexes', 'regions.json')),
      variablesIndex: readJsonIfExists(path.join(cacheDir, 'indexes', 'variables.json')),
      componentsIndex: readJsonIfExists(path.join(cacheDir, 'indexes', 'components.json')),
      cssIndex: readJsonIfExists(path.join(cacheDir, 'indexes', 'css.json')),
    };
  }

  const extractionPath = path.join(cacheDir, 'extraction.json');
  if (fs.existsSync(extractionPath)) {
    return {
      ok: true,
      kind: 'legacy',
      cacheDir,
      extraction: readJsonFile(extractionPath),
    };
  }

  return { ok: false, error: `No bundle.json or extraction.json found in ${cacheDir}` };
}

function getBundlePages(context) {
  const indexedPages = context.pagesIndex && Array.isArray(context.pagesIndex.pages)
    ? context.pagesIndex.pages
    : null;
  if (indexedPages) return indexedPages;
  return [];
}

function getBundleScreenshots(context) {
  if (context.screenshotsIndex && Array.isArray(context.screenshotsIndex.screenshots)) {
    return context.screenshotsIndex.screenshots;
  }
  return [];
}

function getBundleRegions(context) {
  if (context.regionsIndex && Array.isArray(context.regionsIndex.regions)) {
    return context.regionsIndex.regions;
  }
  return [];
}

function getBundleVariablesIndex(context) {
  if (context.variablesIndex && context.variablesIndex.variables) {
    return context.variablesIndex.variables;
  }
  return null;
}

function getBundleComponentsIndex(context) {
  if (context.componentsIndex && Array.isArray(context.componentsIndex.components)) {
    return context.componentsIndex.components;
  }
  return null;
}

function getBundleCssIndex(context) {
  if (context.cssIndex && Array.isArray(context.cssIndex.pages)) {
    return context.cssIndex;
  }
  return null;
}

function getLegacyPageMeta(extraction) {
  return {
    pageId: extraction.meta?.pageId || 'legacy-page',
    pageName: extraction.meta?.pageName || extraction.meta?.nodeName || extraction.root?.name || 'Legacy extraction',
  };
}

function getBoxValue(box, key, fallbackKey) {
  if (!box) return 0;
  if (typeof box[key] === 'number') return box[key];
  if (fallbackKey && typeof box[fallbackKey] === 'number') return box[fallbackKey];
  return 0;
}

function makeRegionFromNode(node, pageMeta, level, parentRegionId) {
  if (!node || !node.box) return null;
  const box = node.box.absoluteBox || node.box;
  return {
    regionId: `${pageMeta.pageId}:${level}:${node.id}`,
    pageId: pageMeta.pageId,
    pageName: pageMeta.pageName,
    level,
    name: node.name,
    nodeId: node.id,
    parentRegionId: parentRegionId || null,
    x: getBoxValue(box, 'x'),
    y: getBoxValue(box, 'y'),
    w: getBoxValue(box, 'width', 'w'),
    h: getBoxValue(box, 'height', 'h'),
  };
}

function buildLegacyRegions(extraction) {
  const pageMeta = getLegacyPageMeta(extraction);
  const root = extraction.root;
  const regions = [];
  if (!root || !Array.isArray(root.children)) return regions;

  for (const child of root.children) {
    if (!child || child.visible === false) continue;
    const level1 = makeRegionFromNode(child, pageMeta, 1, null);
    if (level1) regions.push(level1);
    if (Array.isArray(child.children)) {
      for (const grandChild of child.children) {
        if (!grandChild || grandChild.visible === false) continue;
        const level2 = makeRegionFromNode(grandChild, pageMeta, 2, level1 ? level1.regionId : null);
        if (level2) regions.push(level2);
      }
    }
  }

  return regions;
}

function buildLegacyScreenshots(cacheDir, extraction) {
  const manifest = readJsonIfExists(path.join(cacheDir, 'screenshots', 'manifest.json'));
  if (manifest && Array.isArray(manifest.screenshots)) {
    return manifest.screenshots;
  }

  const pageMeta = getLegacyPageMeta(extraction);
  const screenshots = [];
  if (extraction.assets?.screenshot) {
    screenshots.push({
      screenshotId: `legacy:${extraction.assets.screenshot.nodeId || extraction.meta?.nodeId || 'root'}:frame`,
      pageId: pageMeta.pageId,
      pageName: pageMeta.pageName,
      kind: 'frame',
      nodeId: extraction.assets.screenshot.nodeId || extraction.meta?.nodeId || null,
      filePath: extraction.assets.screenshot.fileName || 'screenshot.png',
      absolutePath: path.join(cacheDir, extraction.assets.screenshot.fileName || 'screenshot.png'),
    });
  }
  return screenshots;
}

function collectComponents(node, output, pageMeta) {
  if (!node || node.visible === false) return;
  if (node.component) {
    output.push({
      pageId: pageMeta?.pageId || null,
      pageName: pageMeta?.pageName || null,
      nodeId: node.id,
      nodeName: node.name,
      type: node.type,
      ...node.component,
    });
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) collectComponents(child, output, pageMeta);
  }
}

function mergeFlatVariableMaps(target, source) {
  if (!source || typeof source !== 'object') return;
  for (const key of Object.keys(source)) {
    if (!target[key]) target[key] = {};
    Object.assign(target[key], source[key]);
  }
}

function resolveBundlePageDir(context, pageEntry) {
  const pageInfoPath = resolveCacheRelativePath(context.cacheDir, pageEntry.path);
  if (pageInfoPath) {
    return path.dirname(pageInfoPath);
  }
  return path.join(context.cacheDir, 'pages', sanitizePathSegment(pageEntry.pageId));
}

function getBundlePageExtractions(context) {
  const pages = getBundlePages(context);
  const entries = [];
  for (const pageEntry of pages) {
    const extractionPath = path.join(resolveBundlePageDir(context, pageEntry), 'extraction.json');
    const extraction = readJsonIfExists(extractionPath);
    if (extraction) {
      entries.push({ page: pageEntry, extraction, extractionPath });
    }
  }
  return entries;
}

function resolveExtractionForTreeQueries(context, opts) {
  if (context.kind === 'legacy') {
    return { ok: true, extraction: context.extraction };
  }

  const pageExtractions = getBundlePageExtractions(context);
  if (pageExtractions.length === 0) {
    return { ok: false, error: 'Bundle cache does not contain page extraction.json files yet' };
  }

  let selected = null;
  if (opts.page) {
    selected = pageExtractions.find((entry) => matchesPage(entry.page, opts.page));
    if (!selected) {
      return { ok: false, error: `Page "${opts.page}" not found in bundle cache` };
    }
  } else if (pageExtractions.length === 1) {
    selected = pageExtractions[0];
  } else {
    return {
      ok: false,
      error: 'Bundle cache contains multiple pages. Use --page <pageId-or-name> or query pages first.',
    };
  }

  return { ok: true, extraction: selected.extraction, page: selected.page };
}

// ── Main query handler ──

export async function handleQuery(args) {
  const opts = parseQueryArgs(args);

  if (opts.subcommand === 'capabilities') {
    return loadCapabilities();
  }

  if (!opts.cache) {
    return { ok: false, error: 'Missing --cache <cacheDir> argument' };
  }

  const context = resolveCacheContext(opts.cache);
  if (!context.ok) {
    return context;
  }

  if (opts.subcommand === 'pages') {
    if (context.kind === 'bundle') {
      return {
        ok: true,
        cacheKind: 'bundle',
        bundleId: context.bundle.bundleId || null,
        pages: getBundlePages(context),
      };
    }
    const pageMeta = getLegacyPageMeta(context.extraction);
    return {
      ok: true,
      cacheKind: 'legacy',
      pages: [{
        ...pageMeta,
        nodeCount: countNodes(context.extraction.root),
        selectionCount: context.extraction.meta?.selectedNodeCount || 1,
        screenshotCount: buildLegacyScreenshots(context.cacheDir, context.extraction).length,
      }],
    };
  }

  if (opts.subcommand === 'screenshots') {
    const screenshots = context.kind === 'bundle'
      ? getBundleScreenshots(context)
      : buildLegacyScreenshots(context.cacheDir, context.extraction);
    const filtered = opts.page ? screenshots.filter((entry) => matchesPage(entry, opts.page)) : screenshots;
    return {
      ok: true,
      cacheKind: context.kind,
      screenshots: filtered,
    };
  }

  if (opts.subcommand === 'regions') {
    const regions = context.kind === 'bundle'
      ? getBundleRegions(context)
      : buildLegacyRegions(context.extraction);
    const filtered = regions.filter((entry) => {
      if (opts.page && !matchesPage(entry, opts.page)) return false;
      if (opts.level != null && entry.level !== opts.level) return false;
      return true;
    });
    return {
      ok: true,
      cacheKind: context.kind,
      regions: filtered,
    };
  }

  if (opts.subcommand === 'variables') {
    if (context.kind === 'legacy') {
      return { ok: true, cacheKind: 'legacy', variables: context.extraction.variables || {} };
    }
    const indexedVariables = getBundleVariablesIndex(context);
    if (indexedVariables) {
      return { ok: true, cacheKind: 'bundle', variables: indexedVariables };
    }
    const merged = { flat: { colors: {}, numbers: {}, strings: {}, booleans: {} } };
    for (const entry of getBundlePageExtractions(context)) {
      mergeFlatVariableMaps(merged.flat, entry.extraction.variables?.flat);
    }
    return { ok: true, cacheKind: 'bundle', variables: merged };
  }

  if (opts.subcommand === 'components') {
    const indexedComponents = context.kind === 'bundle' ? getBundleComponentsIndex(context) : null;
    if (indexedComponents) {
      return { ok: true, cacheKind: 'bundle', components: indexedComponents };
    }
    const components = [];
    if (context.kind === 'legacy') {
      collectComponents(context.extraction.root, components, getLegacyPageMeta(context.extraction));
    } else {
      for (const entry of getBundlePageExtractions(context)) {
        collectComponents(entry.extraction.root, components, entry.page);
      }
    }
    return { ok: true, cacheKind: context.kind, components };
  }

  if (opts.subcommand === 'css') {
    if (context.kind === 'legacy') {
      const cssData = context.extraction.css || context.extraction.cssHints || null;
      if (!cssData) {
        return { ok: true, cacheKind: 'legacy', available: false, reason: 'No css hints recorded in this extraction cache', css: null };
      }
      return {
        ok: true,
        cacheKind: 'legacy',
        available: cssData.available !== false,
        reason: cssData.reason || null,
        css: cssData.available === false ? null : cssData,
      };
    }

    const indexedCss = getBundleCssIndex(context);
    if (indexedCss) {
      return {
        ok: true,
        cacheKind: 'bundle',
        available: indexedCss.available,
        reason: indexedCss.reason || null,
        pages: indexedCss.pages,
      };
    }

    const pageExtractions = getBundlePageExtractions(context);
    const pages = pageExtractions.map((entry) => ({
      pageId: entry.page.pageId,
      pageName: entry.page.pageName,
      available: entry.extraction.css?.available !== false && !!entry.extraction.css,
      reason: entry.extraction.css?.reason || (entry.extraction.css ? null : 'No css hints recorded for this page'),
      css: entry.extraction.css?.available === false ? null : (entry.extraction.css || null),
    }));
    const available = pages.some((entry) => entry.available);
    return {
      ok: true,
      cacheKind: 'bundle',
      available,
      reason: available ? null : 'No css hints recorded in this bundle cache',
      pages,
    };
  }

  const resolved = resolveExtractionForTreeQueries(context, opts);
  if (!resolved.ok) return resolved;

  const extraction = resolved.extraction;

  const root = extraction.root;
  if (!root) {
    return { ok: false, error: 'No root node in extraction data' };
  }

  let targetNode = root;
  if (opts.frame) {
    const frame = findFrame(root, opts.frame);
    if (!frame) {
      const available = (root.children || []).map((c) => c.name).join(', ');
      return { ok: false, error: `Frame "${opts.frame}" not found. Available: ${available}` };
    }
    targetNode = frame;
  }

  switch (opts.subcommand) {
    case 'tree': {
      if (context.kind === 'bundle' && !opts.page && !opts.frame) {
        return {
          ok: true,
          cacheKind: 'bundle',
          bundleId: context.bundle.bundleId || null,
          pages: getBundlePages(context),
        };
      }
      if (!opts.frame) {
        const frames = (root.children || []).map((c) => ({
          name: c.name,
          type: c.type,
          size: [c.box?.width, c.box?.height],
          nodes: countNodes(c),
        }));
        return { ok: true, frames };
      }
      const tree = buildTree(targetNode, opts.depth, 0);
      return {
        ok: true,
        frame: targetNode.name,
        size: [targetNode.box?.width, targetNode.box?.height],
        totalNodes: countNodes(targetNode),
        tree: tree.children || [],
      };
    }

    case 'node': {
      if (!opts.nodeId) {
        return { ok: false, error: 'Usage: query node <nodeId> --cache <dir>' };
      }
      const node = findNode(root, opts.nodeId);
      if (!node) {
        return { ok: false, error: `Node "${opts.nodeId}" not found` };
      }
      return { ok: true, ...pruneNodeShallow(node) };
    }

    case 'subtree': {
      if (!opts.nodeId) {
        return { ok: false, error: 'Usage: query subtree <nodeId> --cache <dir>' };
      }
      const node = findNode(root, opts.nodeId);
      if (!node) {
        return { ok: false, error: `Node "${opts.nodeId}" not found` };
      }
      return { ok: true, ...pruneNode(node, true) };
    }

    case 'text': {
      const textNodes = collectTextNodes(targetNode, null);
      return { ok: true, frame: targetNode.name, texts: textNodes };
    }

    case 'palette': {
      const palette = collectPalette(targetNode);
      return { ok: true, frame: targetNode.name, ...palette };
    }

    default:
      return {
        ok: false,
        error: 'Usage: query <tree|node|subtree|text|palette|capabilities|pages|screenshots|regions|variables|components|css> [nodeId] --cache <dir> [--frame name] [--page name-or-id] [--level N] [--depth N]',
      };
  }
}
