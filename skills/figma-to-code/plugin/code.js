figma.showUI(__html__, { width: 340, height: 300 });
var JOB_HEARTBEAT_INTERVAL_MS = 15000;
var TRAVERSAL_YIELD_INTERVAL_MS = 250;
var TRAVERSAL_STATUS_INTERVAL_MS = 1500;
var SAFE_MODE_TOTAL_NODE_LIMIT = 2500;
var SAFE_MODE_TEXT_NODE_LIMIT = 120;
var SAFE_MODE_INSTANCE_NODE_LIMIT = 150;
var SAFE_MODE_MAX_SERIALIZED_NODES = 3000;
var SAFE_MODE_MAX_DEPTH = 16;

// ══════════════════════════════════════════════
// Utility
// ══════════════════════════════════════════════

function roundNum(value) {
  if (typeof value !== 'number' || !isFinite(value)) return value;
  return Number(value.toFixed(3));
}

function rgbToHex(color) {
  const alpha = color.a == null ? 1 : color.a;
  function toHex(v) { return Math.round(v * 255).toString(16).padStart(2, '0'); }
  if (alpha < 1) return '#' + toHex(color.r) + toHex(color.g) + toHex(color.b) + toHex(alpha);
  return '#' + toHex(color.r) + toHex(color.g) + toHex(color.b);
}

function formatRgba(raw) {
  const a = raw.a == null ? 1 : raw.a;
  return 'rgba(' + Math.round(raw.r * 255) + ',' + Math.round(raw.g * 255) + ',' + Math.round(raw.b * 255) + ',' + (+a.toFixed(2)) + ')';
}

function isColorObject(v) {
  return v && typeof v === 'object' && typeof v.r === 'number' && typeof v.g === 'number' && typeof v.b === 'number';
}

function isPlainObject(v) { return v && typeof v === 'object' && !Array.isArray(v); }
function isMixed(v) { return v === figma.mixed; }
function hasProperty(node, key) { return !!node && key in node; }
function safeStringProp(value) { return isMixed(value) ? null : (typeof value === 'string' ? value : null); }

function safeRead(node, key) {
  if (!hasProperty(node, key)) return { value: null, error: null };
  try { return { value: node[key], error: null }; }
  catch (e) { return { value: null, error: e }; }
}

function safeArrayRead(node, key) {
  var result = safeRead(node, key);
  return Array.isArray(result.value) ? result.value : null;
}

function nextTick() {
  return new Promise(function (resolve) {
    setTimeout(resolve, 0);
  });
}

function createTraversalProgress(jobId, label) {
  return {
    jobId: jobId || null,
    label: label || '正在序列化节点树',
    visited: 0,
    lastYieldAt: Date.now(),
    lastStatusAt: 0,
  };
}

async function maybeYieldTraversal(progress) {
  if (!progress) return;
  progress.visited += 1;
  var now = Date.now();
  if (progress.jobId && now - progress.lastStatusAt >= TRAVERSAL_STATUS_INTERVAL_MS) {
    progress.lastStatusAt = now;
    postStatus(progress.jobId, progress.label + ' (' + progress.visited + ' nodes)...', 'working', {
      bridge: false,
      log: false,
    });
  }
  if (now - progress.lastYieldAt < TRAVERSAL_YIELD_INTERVAL_MS) return;
  progress.lastYieldAt = now;
  await nextTick();
}

function sanitizeFileName(name) {
  var sanitized = String(name || 'untitled')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 60);
  return sanitized || 'untitled';
}

function countKeys(obj) { return Object.keys(obj || {}).length; }

function sumNodeTypeCounts(nodeTypes) {
  var total = 0;
  for (var key in (nodeTypes || {})) {
    total += nodeTypes[key] || 0;
  }
  return total;
}

function postToUi(type, data) {
  var msg = { type: type };
  if (data) {
    var keys = Object.keys(data);
    for (var i = 0; i < keys.length; i++) {
      msg[keys[i]] = data[keys[i]];
    }
  }
  figma.ui.postMessage(msg);
}

function postStatus(jobId, text, state, options) {
  var shouldBridge = !(options && options.bridge === false);
  var shouldLog = options && Object.prototype.hasOwnProperty.call(options, 'log')
    ? options.log
    : state !== 'working';
  postToUi('status', {
    jobId: jobId || null,
    text: text,
    state: state,
    bridge: shouldBridge,
    log: shouldLog,
  });
}

// ══════════════════════════════════════════════
// Serialization: Color
// ══════════════════════════════════════════════

function serializeColor(raw) {
  if (!isColorObject(raw)) return null;
  const a = raw.a == null ? 1 : raw.a;
  return { hex: rgbToHex(raw), rgba: formatRgba(raw), r: roundNum(raw.r), g: roundNum(raw.g), b: roundNum(raw.b), a: roundNum(a) };
}

// ══════════════════════════════════════════════
// Serialization: Geometry helpers
// ══════════════════════════════════════════════

function serializePoint(p) {
  if (!p || typeof p !== 'object') return null;
  return { x: roundNum(p.x), y: roundNum(p.y) };
}

function serializeRect(r) {
  if (!r || typeof r !== 'object') return null;
  return { x: roundNum(r.x), y: roundNum(r.y), width: roundNum(r.width), height: roundNum(r.height) };
}

function serializeMatrix(matrix) {
  if (!Array.isArray(matrix)) return null;
  return matrix.map(function (row) {
    if (!Array.isArray(row)) return null;
    return row.map(roundNum);
  });
}

// ══════════════════════════════════════════════
// Serialization: Paint
// ══════════════════════════════════════════════

function serializePaint(paint) {
  if (!paint || typeof paint !== 'object') return null;
  var out = { type: paint.type || null, visible: paint.visible !== false };

  if (typeof paint.opacity === 'number') out.opacity = roundNum(paint.opacity);
  if (typeof paint.blendMode === 'string') out.blendMode = paint.blendMode;
  if (isColorObject(paint.color)) out.color = serializeColor(paint.color);

  if (isPlainObject(paint.boundVariables)) out.boundVariables = paint.boundVariables;

  if (Array.isArray(paint.gradientStops)) {
    out.gradientStops = [];
    for (var i = 0; i < paint.gradientStops.length; i++) {
      var stop = paint.gradientStops[i];
      if (!stop) continue;
      out.gradientStops.push({ position: roundNum(stop.position), color: serializeColor(stop.color) });
    }
  }
  if (paint.gradientTransform) out.gradientTransform = serializeMatrix(paint.gradientTransform);
  if (typeof paint.scaleMode === 'string') out.scaleMode = paint.scaleMode;
  if (typeof paint.imageHash === 'string') out.imageHash = paint.imageHash;
  if (paint.imageTransform) out.imageTransform = serializeMatrix(paint.imageTransform);
  if (typeof paint.rotation === 'number') out.rotation = roundNum(paint.rotation);

  return out;
}

function serializePaintList(paints) {
  if (!Array.isArray(paints)) return [];
  var result = [];
  for (var i = 0; i < paints.length; i++) {
    var s = serializePaint(paints[i]);
    if (s) result.push(s);
  }
  return result;
}

// ══════════════════════════════════════════════
// Serialization: Effect
// ══════════════════════════════════════════════

function serializeEffect(effect) {
  if (!effect || typeof effect !== 'object') return null;
  var out = { type: effect.type || null, visible: effect.visible !== false };
  if (typeof effect.radius === 'number') out.radius = roundNum(effect.radius);
  if (typeof effect.spread === 'number') out.spread = roundNum(effect.spread);
  if (typeof effect.blendMode === 'string') out.blendMode = effect.blendMode;
  if (effect.offset) out.offset = serializePoint(effect.offset);
  if (isColorObject(effect.color)) out.color = serializeColor(effect.color);
  if (typeof effect.showShadowBehindNode === 'boolean') out.showShadowBehindNode = effect.showShadowBehindNode;
  return out;
}

function serializeEffectList(effects) {
  if (!Array.isArray(effects)) return [];
  var result = [];
  for (var i = 0; i < effects.length; i++) {
    var s = serializeEffect(effects[i]);
    if (s) result.push(s);
  }
  return result;
}

// ══════════════════════════════════════════════
// Serialization: Font & Text
// ══════════════════════════════════════════════

function serializeFontName(v) {
  if (v == null) return null;
  if (isMixed(v)) return { mixed: true };
  if (!isPlainObject(v)) return v;
  return { family: v.family || null, style: v.style || null };
}

function serializeSpacingValue(v) {
  if (v == null) return null;
  if (isMixed(v)) return { mixed: true };
  if (!isPlainObject(v)) return v;
  return { unit: v.unit || null, value: roundNum(v.value) };
}

function serializeTextSegments(node, extractionProfile) {
  if (!node || typeof node.getStyledTextSegments !== 'function') return [];
  if (extractionProfile && extractionProfile.captureTextSegments === false) return [];

  var preferredFields = ['fontName', 'fontSize', 'fills', 'textStyleId', 'fillStyleId', 'lineHeight', 'letterSpacing', 'textDecoration', 'textCase', 'hyperlink'];
  var fallbackFields = ['fontName', 'fontSize', 'fills', 'lineHeight', 'letterSpacing'];
  var segments = [];

  try { segments = node.getStyledTextSegments(preferredFields); }
  catch (_) {
    try { segments = node.getStyledTextSegments(fallbackFields); }
    catch (__) { return []; }
  }

  if (!Array.isArray(segments)) return [];

  var output = [];
  for (var i = 0; i < segments.length; i++) {
    var seg = segments[i];
    if (!seg) continue;
    output.push({
      characters: typeof seg.characters === 'string' ? seg.characters : '',
      start: typeof seg.start === 'number' ? seg.start : null,
      end: typeof seg.end === 'number' ? seg.end : null,
      fontName: serializeFontName(seg.fontName),
      fontSize: typeof seg.fontSize === 'number' ? roundNum(seg.fontSize) : null,
      fills: serializePaintList(seg.fills),
      lineHeight: serializeSpacingValue(seg.lineHeight),
      letterSpacing: serializeSpacingValue(seg.letterSpacing),
      textDecoration: seg.textDecoration || null,
      textCase: seg.textCase || null,
    });
  }
  return output;
}

// ══════════════════════════════════════════════
// Serialization: Variable bindings
// ══════════════════════════════════════════════

function serializeVariableBinding(value, variableCache) {
  if (value == null) return null;
  if (Array.isArray(value)) return value.map(function (v) { return serializeVariableBinding(v, variableCache); });
  if (!isPlainObject(value)) return value;

  if (value.type === 'VARIABLE_ALIAS' && typeof value.id === 'string') {
    var cached = variableCache[value.id];
    return {
      id: value.id,
      name: cached && typeof cached.name === 'string' ? cached.name : null,
      type: cached ? cached.resolvedType : null,
    };
  }

  var out = {};
  for (var key in value) out[key] = serializeVariableBinding(value[key], variableCache);
  return out;
}

// ══════════════════════════════════════════════
// Figma → CSS Layout mapping
// ══════════════════════════════════════════════

var AXIS_ALIGN_MAP = {
  MIN: 'flex-start',
  CENTER: 'center',
  MAX: 'flex-end',
  SPACE_BETWEEN: 'space-between',
  BASELINE: 'baseline',
};

function mapLayout(node) {
  var layout = {};

  if (typeof node.x === 'number') layout.x = roundNum(node.x);
  if (typeof node.y === 'number') layout.y = roundNum(node.y);
  if (typeof node.width === 'number') layout.width = roundNum(node.width);
  if (typeof node.height === 'number') layout.height = roundNum(node.height);

  if (hasProperty(node, 'absoluteBoundingBox') && node.absoluteBoundingBox) {
    layout.absoluteBox = serializeRect(node.absoluteBoundingBox);
  }
  if (hasProperty(node, 'absoluteRenderBounds') && node.absoluteRenderBounds) {
    layout.renderBounds = serializeRect(node.absoluteRenderBounds);
  }

  if (hasProperty(node, 'layoutMode') && typeof node.layoutMode === 'string' && node.layoutMode !== 'NONE') {
    layout.display = 'flex';
    layout.direction = node.layoutMode === 'VERTICAL' ? 'column' : 'row';
  }

  if (hasProperty(node, 'layoutWrap') && node.layoutWrap === 'WRAP') {
    layout.wrap = 'wrap';
  }

  if (hasProperty(node, 'primaryAxisAlignItems')) {
    layout.justify = AXIS_ALIGN_MAP[node.primaryAxisAlignItems] || node.primaryAxisAlignItems;
  }
  if (hasProperty(node, 'counterAxisAlignItems')) {
    layout.align = AXIS_ALIGN_MAP[node.counterAxisAlignItems] || node.counterAxisAlignItems;
  }

  if (hasProperty(node, 'itemSpacing') && typeof node.itemSpacing === 'number') {
    layout.gap = roundNum(node.itemSpacing);
  }
  if (hasProperty(node, 'counterAxisSpacing') && typeof node.counterAxisSpacing === 'number') {
    layout.columnGap = roundNum(node.counterAxisSpacing);
  }

  var hasPadding = false;
  var padding = {};
  if (hasProperty(node, 'paddingTop') && typeof node.paddingTop === 'number') { padding.top = roundNum(node.paddingTop); hasPadding = true; }
  if (hasProperty(node, 'paddingRight') && typeof node.paddingRight === 'number') { padding.right = roundNum(node.paddingRight); hasPadding = true; }
  if (hasProperty(node, 'paddingBottom') && typeof node.paddingBottom === 'number') { padding.bottom = roundNum(node.paddingBottom); hasPadding = true; }
  if (hasProperty(node, 'paddingLeft') && typeof node.paddingLeft === 'number') { padding.left = roundNum(node.paddingLeft); hasPadding = true; }
  if (hasPadding) layout.padding = padding;

  if (hasProperty(node, 'primaryAxisSizingMode') && typeof node.primaryAxisSizingMode === 'string') {
    var sizingPrimary = node.primaryAxisSizingMode === 'AUTO' ? 'hug' : 'fixed';
    if (layout.direction === 'column') layout.heightSizing = sizingPrimary;
    else layout.widthSizing = sizingPrimary;
  }
  if (hasProperty(node, 'counterAxisSizingMode') && typeof node.counterAxisSizingMode === 'string') {
    var sizingCounter = node.counterAxisSizingMode === 'AUTO' ? 'hug' : 'fixed';
    if (layout.direction === 'column') layout.widthSizing = sizingCounter;
    else layout.heightSizing = sizingCounter;
  }

  if (hasProperty(node, 'layoutSizingHorizontal') && typeof node.layoutSizingHorizontal === 'string') {
    layout.widthSizing = node.layoutSizingHorizontal.toLowerCase();
  }
  if (hasProperty(node, 'layoutSizingVertical') && typeof node.layoutSizingVertical === 'string') {
    layout.heightSizing = node.layoutSizingVertical.toLowerCase();
  }

  if (hasProperty(node, 'layoutAlign') && typeof node.layoutAlign === 'string') layout.layoutAlign = node.layoutAlign;
  if (hasProperty(node, 'layoutGrow') && typeof node.layoutGrow === 'number') layout.layoutGrow = roundNum(node.layoutGrow);
  if (hasProperty(node, 'layoutPositioning') && typeof node.layoutPositioning === 'string') layout.positioning = node.layoutPositioning;
  if (hasProperty(node, 'clipsContent') && typeof node.clipsContent === 'boolean') layout.overflow = node.clipsContent ? 'hidden' : 'visible';

  if (hasProperty(node, 'constraints') && node.constraints) {
    layout.constraints = { horizontal: node.constraints.horizontal || null, vertical: node.constraints.vertical || null };
  }

  if (hasProperty(node, 'minWidth') && typeof node.minWidth === 'number') layout.minWidth = roundNum(node.minWidth);
  if (hasProperty(node, 'maxWidth') && typeof node.maxWidth === 'number') layout.maxWidth = roundNum(node.maxWidth);
  if (hasProperty(node, 'minHeight') && typeof node.minHeight === 'number') layout.minHeight = roundNum(node.minHeight);
  if (hasProperty(node, 'maxHeight') && typeof node.maxHeight === 'number') layout.maxHeight = roundNum(node.maxHeight);

  return layout;
}

// ══════════════════════════════════════════════
// Serialization: Style (fills → background, strokes → border, effects → shadow)
// ══════════════════════════════════════════════

function mapStyle(node) {
  var style = {};

  if (hasProperty(node, 'fills')) style.background = isMixed(node.fills) ? [{ mixed: true }] : serializePaintList(node.fills);
  if (hasProperty(node, 'strokes')) style.borderColor = isMixed(node.strokes) ? [{ mixed: true }] : serializePaintList(node.strokes);
  if (hasProperty(node, 'effects')) style.effects = isMixed(node.effects) ? [{ mixed: true }] : serializeEffectList(node.effects);

  if (hasProperty(node, 'opacity') && typeof node.opacity === 'number') style.opacity = roundNum(node.opacity);
  if (hasProperty(node, 'blendMode') && typeof node.blendMode === 'string') style.blendMode = node.blendMode;

  // Border
  if (hasProperty(node, 'strokeWeight') && typeof node.strokeWeight === 'number') {
    style.borderWidth = roundNum(node.strokeWeight);
  }
  if (hasProperty(node, 'strokeTopWeight') && typeof node.strokeTopWeight === 'number') {
    style.borderWidthPerSide = {
      top: roundNum(node.strokeTopWeight),
      right: roundNum(node.strokeRightWeight),
      bottom: roundNum(node.strokeBottomWeight),
      left: roundNum(node.strokeLeftWeight),
    };
  }
  if (hasProperty(node, 'strokeAlign') && typeof node.strokeAlign === 'string') style.borderAlign = node.strokeAlign;
  if (hasProperty(node, 'dashPattern') && Array.isArray(node.dashPattern) && node.dashPattern.length > 0) style.borderStyle = 'dashed';

  // Border radius
  if (hasProperty(node, 'cornerRadius') && typeof node.cornerRadius === 'number') {
    style.borderRadius = roundNum(node.cornerRadius);
  }
  if (hasProperty(node, 'topLeftRadius') && typeof node.topLeftRadius === 'number') {
    style.borderRadiusPerCorner = {
      topLeft: roundNum(node.topLeftRadius),
      topRight: roundNum(node.topRightRadius),
      bottomRight: roundNum(node.bottomRightRadius),
      bottomLeft: roundNum(node.bottomLeftRadius),
    };
  }
  if (hasProperty(node, 'cornerSmoothing') && typeof node.cornerSmoothing === 'number' && node.cornerSmoothing > 0) {
    style.cornerSmoothing = roundNum(node.cornerSmoothing);
  }

  // Style references
  if (hasProperty(node, 'fillStyleId') && typeof node.fillStyleId === 'string' && node.fillStyleId) style.fillStyleId = node.fillStyleId;
  if (hasProperty(node, 'strokeStyleId') && typeof node.strokeStyleId === 'string' && node.strokeStyleId) style.strokeStyleId = node.strokeStyleId;
  if (hasProperty(node, 'effectStyleId') && typeof node.effectStyleId === 'string' && node.effectStyleId) style.effectStyleId = node.effectStyleId;

  return style;
}

// ══════════════════════════════════════════════
// Serialization: Text node
// ══════════════════════════════════════════════

function mapTextNode(node, extractionProfile) {
  if (!node || node.type !== 'TEXT') return null;
  return {
    characters: typeof node.characters === 'string' ? node.characters : '',
    fontName: serializeFontName(node.fontName),
    fontSize: isMixed(node.fontSize) ? { mixed: true } : (typeof node.fontSize === 'number' ? roundNum(node.fontSize) : null),
    lineHeight: serializeSpacingValue(node.lineHeight),
    letterSpacing: serializeSpacingValue(node.letterSpacing),
    textAlignHorizontal: safeStringProp(node.textAlignHorizontal),
    textAlignVertical: safeStringProp(node.textAlignVertical),
    textAutoResize: safeStringProp(node.textAutoResize),
    textCase: safeStringProp(node.textCase),
    textDecoration: safeStringProp(node.textDecoration),
    segments: serializeTextSegments(node, extractionProfile),
  };
}

// ══════════════════════════════════════════════
// Serialization: Vector
// ══════════════════════════════════════════════

function mapVector(node, extractionProfile) {
  if (extractionProfile && extractionProfile.captureVectorDetails === false) return null;
  var vector = {};
  var fillGeometry = safeArrayRead(node, 'fillGeometry');
  if (fillGeometry) {
    vector.fillGeometryCount = fillGeometry.length;
    if (fillGeometry.length > 0 && fillGeometry.length <= 8) vector.fillGeometry = fillGeometry;
  }
  var strokeGeometry = safeArrayRead(node, 'strokeGeometry');
  if (strokeGeometry) {
    vector.strokeGeometryCount = strokeGeometry.length;
    if (strokeGeometry.length > 0 && strokeGeometry.length <= 8) vector.strokeGeometry = strokeGeometry;
  }
  var vectorPaths = safeArrayRead(node, 'vectorPaths');
  if (vectorPaths) {
    vector.vectorPathCount = vectorPaths.length;
    if (vectorPaths.length > 0 && vectorPaths.length <= 8) vector.vectorPaths = vectorPaths;
  }
  return countKeys(vector) > 0 ? vector : null;
}

// ══════════════════════════════════════════════
// Serialization: Component
// ══════════════════════════════════════════════

async function mapComponent(node, extractionProfile) {
  var comp = {};

  var propsResult = safeRead(node, 'componentProperties');
  if (propsResult.value && typeof propsResult.value === 'object') {
    comp.properties = {};
    for (var key in propsResult.value) {
      var prop = propsResult.value[key];
      comp.properties[key] = {
        type: prop.type || null,
        value: Object.prototype.hasOwnProperty.call(prop, 'value') ? prop.value : null,
      };
    }
  }

  var variantResult = safeRead(node, 'variantProperties');
  if (variantResult.value) comp.variantProperties = variantResult.value;

  if (
    extractionProfile &&
    extractionProfile.resolveMainComponents === false &&
    (!comp.properties || countKeys(comp.properties) === 0) &&
    !comp.variantProperties
  ) {
    return null;
  }

  if (node.type === 'INSTANCE' && typeof node.getMainComponentAsync === 'function' && (!extractionProfile || extractionProfile.resolveMainComponents !== false)) {
    try {
      var main = await node.getMainComponentAsync();
      if (main) {
        comp.mainComponent = { id: main.id, name: main.name, key: main.key || null };
      }
    } catch (_) { /* skip */ }
  }

  return countKeys(comp) > 0 ? comp : null;
}

// ══════════════════════════════════════════════
// Variable collection
// ══════════════════════════════════════════════

function collectAliasIds(value, ids) {
  if (value == null) return;
  if (Array.isArray(value)) { for (var i = 0; i < value.length; i++) collectAliasIds(value[i], ids); return; }
  if (typeof value !== 'object') return;
  if (value.type === 'VARIABLE_ALIAS' && typeof value.id === 'string') { ids.add(value.id); return; }
  for (var k in value) collectAliasIds(value[k], ids);
}

async function resolveVariableCache(nodes) {
  var aliasIds = new Set();
  for (var i = 0; i < nodes.length; i++) {
    var n = nodes[i];
    collectAliasIds(n.boundVariables, aliasIds);
    collectAliasIds(n.inferredVariables, aliasIds);
    collectAliasIds(n.fills, aliasIds);
    collectAliasIds(n.strokes, aliasIds);
    collectAliasIds(n.effects, aliasIds);
  }

  var variableCache = {};
  var idArray = Array.from(aliasIds);
  var results = await Promise.all(idArray.map(function (id) {
    return figma.variables.getVariableByIdAsync(id).catch(function () { return null; });
  }));
  for (var j = 0; j < idArray.length; j++) {
    if (results[j]) variableCache[idArray[j]] = results[j];
  }
  return variableCache;
}

function analyzeExtractionComplexity(nodes) {
  var stats = {
    totalNodes: Array.isArray(nodes) ? nodes.length : 0,
    textNodes: 0,
    instanceNodes: 0,
    vectorNodes: 0,
  };

  if (!Array.isArray(nodes)) return stats;

  for (var i = 0; i < nodes.length; i++) {
    var node = nodes[i];
    if (!node || typeof node.type !== 'string') continue;
    if (node.type === 'TEXT') stats.textNodes += 1;
    if (node.type === 'INSTANCE') stats.instanceNodes += 1;
    if (node.type === 'VECTOR' || node.type === 'BOOLEAN_OPERATION' || node.type === 'STAR' || node.type === 'LINE' || node.type === 'ELLIPSE' || node.type === 'POLYGON') {
      stats.vectorNodes += 1;
    }
  }

  return stats;
}

function buildExtractionProfile(stats) {
  var safeMode = !!(
    stats.totalNodes > SAFE_MODE_TOTAL_NODE_LIMIT ||
    stats.textNodes > SAFE_MODE_TEXT_NODE_LIMIT ||
    stats.instanceNodes > SAFE_MODE_INSTANCE_NODE_LIMIT
  );

  return {
    mode: safeMode ? 'safe' : 'standard',
    stats: stats,
    resolveVariables: !safeMode,
    captureTextSegments: !safeMode,
    resolveMainComponents: !safeMode,
    captureVectorDetails: !safeMode,
    maxSerializedNodes: safeMode ? SAFE_MODE_MAX_SERIALIZED_NODES : Number.POSITIVE_INFINITY,
    maxDepth: safeMode ? SAFE_MODE_MAX_DEPTH : 50,
    serializedNodes: 0,
    truncatedNodes: 0,
  };
}

function scanSubtreeStatsFromRoots(roots) {
  var stats = {
    totalNodes: 0,
    textNodes: 0,
    instanceNodes: 0,
    vectorNodes: 0,
  };
  var stack = (roots || []).slice();

  while (stack.length > 0) {
    var node = stack.pop();
    if (!node || typeof node.type !== 'string') continue;
    stats.totalNodes += 1;
    if (node.type === 'TEXT') stats.textNodes += 1;
    if (node.type === 'INSTANCE') stats.instanceNodes += 1;
    if (node.type === 'VECTOR' || node.type === 'BOOLEAN_OPERATION' || node.type === 'STAR' || node.type === 'LINE' || node.type === 'ELLIPSE' || node.type === 'POLYGON') {
      stats.vectorNodes += 1;
    }
    if (node.children && Array.isArray(node.children)) {
      for (var i = node.children.length - 1; i >= 0; i--) {
        stack.push(node.children[i]);
      }
    }
  }

  return stats;
}

async function buildVariablesDefs(variableCache) {
  var flat = { colors: {}, numbers: {}, strings: {}, booleans: {} };
  var collectionCache = {};

  for (var id in variableCache) {
    var v = variableCache[id];
    if (!v) continue;

    var cssKey = '--' + String(v.name).replace(/\//g, '-').replace(/\s+/g, '-').toLowerCase();

    if (v.variableCollectionId && !collectionCache[v.variableCollectionId]) {
      try {
        collectionCache[v.variableCollectionId] = await figma.variables.getVariableCollectionByIdAsync(v.variableCollectionId);
      } catch (_) { /* skip */ }
    }

    var collection = collectionCache[v.variableCollectionId];
    var defaultModeId = collection ? collection.defaultModeId : null;
    var rawValue = defaultModeId && v.valuesByMode ? v.valuesByMode[defaultModeId] : null;

    if (v.resolvedType === 'COLOR' && rawValue && isColorObject(rawValue)) {
      flat.colors[cssKey] = rgbToHex(rawValue);
    } else if (v.resolvedType === 'FLOAT') {
      flat.numbers[cssKey] = rawValue;
    } else if (v.resolvedType === 'STRING') {
      flat.strings[cssKey] = rawValue;
    } else if (v.resolvedType === 'BOOLEAN') {
      flat.booleans[cssKey] = rawValue;
    }
  }

  return { flat: flat };
}

// ══════════════════════════════════════════════
// Resource aggregation
// ══════════════════════════════════════════════

function createResourceCollector() {
  return { nodeTypes: {}, fonts: {}, images: {}, effects: {}, components: {} };
}

function registerImageUsage(collector, hash, node) {
  if (!collector.images[hash]) {
    collector.images[hash] = {
      hash: hash,
      count: 0,
      sources: [],
    };
  }

  var entry = collector.images[hash];
  entry.count += 1;
  if (!node || !node.id) return;

  for (var i = 0; i < entry.sources.length; i++) {
    if (entry.sources[i].nodeId === node.id) return;
  }

  if (entry.sources.length < 5) {
    entry.sources.push({
      nodeId: node.id,
      nodeName: node.name || null,
    });
  }
}

function registerResources(collector, node) {
  collector.nodeTypes[node.type] = (collector.nodeTypes[node.type] || 0) + 1;

  if (node.type === 'TEXT') {
    var fn = serializeFontName(node.fontName);
    if (fn && !fn.mixed) {
      var fontKey = (fn.family || 'Unknown') + '|' + (fn.style || 'Regular');
      if (!collector.fonts[fontKey]) collector.fonts[fontKey] = { family: fn.family, style: fn.style, count: 0 };
      collector.fonts[fontKey].count += 1;
    }
  }

  if (Array.isArray(node.fills)) {
    for (var i = 0; i < node.fills.length; i++) {
      if (node.fills[i] && typeof node.fills[i].imageHash === 'string') {
        registerImageUsage(collector, node.fills[i].imageHash, node);
      }
    }
  }
}

function buildImageRefs(images) {
  var refs = {};
  for (var hash in images) {
    var entry = images[hash];
    var primary = entry && entry.sources && entry.sources.length > 0 ? entry.sources[0] : null;
    refs[hash] = {
      count: entry && typeof entry.count === 'number' ? entry.count : 0,
      primaryNodeId: primary ? primary.nodeId : null,
      primaryNodeName: primary ? primary.nodeName : null,
      sources: entry && entry.sources ? entry.sources.slice() : [],
    };
  }
  return refs;
}

function finalizeResourceCollector(collector) {
  return {
    nodeTypes: collector.nodeTypes,
    fonts: Object.values(collector.fonts),
    images: Object.keys(collector.images),
    imageRefs: buildImageRefs(collector.images),
  };
}

function collectResourcesFromNodes(nodes) {
  var collector = createResourceCollector();
  var roots = makeUniqueNodes(nodes || []);
  var stack = roots.slice();

  while (stack.length > 0) {
    var current = stack.pop();
    if (!current) continue;
    registerResources(collector, current);
    if (current.children && Array.isArray(current.children)) {
      for (var i = current.children.length - 1; i >= 0; i--) {
        stack.push(current.children[i]);
      }
    }
  }

  return finalizeResourceCollector(collector);
}

// ══════════════════════════════════════════════
// Node tree serialization
// ══════════════════════════════════════════════

async function serializeNode(node, variableCache, resourceCollector, depth, traversalProgress, extractionProfile) {
  if (!node) return null;

  await maybeYieldTraversal(traversalProgress);
  if (extractionProfile) {
    if (depth > extractionProfile.maxDepth || extractionProfile.serializedNodes >= extractionProfile.maxSerializedNodes) {
      extractionProfile.truncatedNodes += 1;
      return {
        id: node.id,
        name: typeof node.name === 'string' ? node.name : '',
        type: node.type,
        visible: node.visible !== false,
        truncated: true,
        childCount: node.children && Array.isArray(node.children) ? node.children.length : 0,
      };
    }
    extractionProfile.serializedNodes += 1;
  }

  registerResources(resourceCollector, node);

  var result = {
    id: node.id,
    name: typeof node.name === 'string' ? node.name : '',
    type: node.type,
    visible: node.visible !== false,
  };

  result.box = mapLayout(node);
  result.style = mapStyle(node);

  if (node.type === 'TEXT') {
    result.text = mapTextNode(node, extractionProfile);
  }

  var vectorInfo = mapVector(node, extractionProfile);
  if (vectorInfo) result.vector = vectorInfo;

  var componentInfo = await mapComponent(node, extractionProfile);
  if (componentInfo) result.component = componentInfo;

  // Variable bindings
  if (!extractionProfile || extractionProfile.resolveVariables !== false) {
    var boundResult = safeRead(node, 'boundVariables');
    if (boundResult.value) result.boundVariables = serializeVariableBinding(boundResult.value, variableCache);
    var inferredResult = safeRead(node, 'inferredVariables');
    if (inferredResult.value) result.inferredVariables = serializeVariableBinding(inferredResult.value, variableCache);
  }

  // Children
  var maxDepth = extractionProfile ? extractionProfile.maxDepth : 50;
  if (node.children && Array.isArray(node.children) && depth < maxDepth) {
    result.children = [];
    for (var i = 0; i < node.children.length; i++) {
      var child = await serializeNode(node.children[i], variableCache, resourceCollector, depth + 1, traversalProgress, extractionProfile);
      if (child) result.children.push(child);
    }
  }

  return result;
}

// ══════════════════════════════════════════════
// Asset export
// ══════════════════════════════════════════════

async function exportNodeAssets(node, formats, rootNodeId) {
  var assets = [];
  for (var i = 0; i < formats.length; i++) {
    var format = formats[i];
    var settings = format === 'SVG'
      ? { format: 'SVG' }
      : { format: 'PNG', constraint: { type: 'SCALE', value: 2 } };

    try {
      var bytes = await node.exportAsync(settings);
      var base64Data = figma.base64Encode(bytes);
      assets.push({
        rootNodeId: rootNodeId,
        nodeId: node.id,
        nodeName: node.name,
        format: format,
        base64: base64Data,
        fileName: sanitizeFileName(node.name) + (format === 'SVG' ? '.svg' : '@2x.png'),
      });
    } catch (_) { /* export may fail for some node types */ }
  }
  return assets;
}

async function exportFrameScreenshot(node) {
  var frameNode = node;
  while (frameNode && frameNode.type !== 'FRAME' && frameNode.type !== 'COMPONENT' && frameNode.parent) {
    frameNode = frameNode.parent;
  }
  if (!frameNode || frameNode.type === 'PAGE' || frameNode.type === 'DOCUMENT') return null;

  try {
    var bytes = await frameNode.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 2 } });
    return {
      nodeId: frameNode.id,
      nodeName: frameNode.name,
      format: 'PNG',
      base64: figma.base64Encode(bytes),
      fileName: 'screenshot.png',
      isScreenshot: true,
    };
  } catch (_) { return null; }
}

// ══════════════════════════════════════════════
// Extraction pipeline
// ══════════════════════════════════════════════

function findPage(node) {
  var current = node;
  while (current && current.type !== 'PAGE') current = current.parent;
  return current && current.type === 'PAGE' ? current : null;
}

function collectSubtreeNodes(root) {
  var stack = [root];
  var nodes = [];
  while (stack.length > 0) {
    var n = stack.pop();
    if (!n) continue;
    nodes.push(n);
    if (n.children && Array.isArray(n.children)) {
      for (var i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i]);
    }
  }
  return nodes;
}

function computeUnionBoundingBox(nodes) {
  var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  var hasValidBox = false;
  for (var i = 0; i < nodes.length; i++) {
    var box = nodes[i].absoluteBoundingBox;
    if (!box) continue;
    hasValidBox = true;
    if (box.x < minX) minX = box.x;
    if (box.y < minY) minY = box.y;
    if (box.x + box.width > maxX) maxX = box.x + box.width;
    if (box.y + box.height > maxY) maxY = box.y + box.height;
  }
  if (!hasValidBox) return { x: 0, y: 0, width: 0, height: 0 };
  return {
    x: roundNum(minX),
    y: roundNum(minY),
    width: roundNum(maxX - minX),
    height: roundNum(maxY - minY)
  };
}

async function extractNode(node, fileKey, jobId) {
  postStatus(jobId, '正在提取 ' + node.name + '...', 'working');

  var extractionProfile = buildExtractionProfile(scanSubtreeStatsFromRoots([node]));
  postStatus(jobId, '正在解析变量绑定...', 'working');
  var allNodes = extractionProfile.resolveVariables !== false ? collectSubtreeNodes(node) : [];
  var variableCache = extractionProfile.resolveVariables !== false ? await resolveVariableCache(allNodes) : {};
  var resourceCollector = createResourceCollector();
  var resources;
  var traversalProgress = createTraversalProgress(jobId, '正在序列化节点树');

  postStatus(jobId, '正在序列化节点树...', 'working');
  var root = await serializeNode(node, variableCache, resourceCollector, 0, traversalProgress, extractionProfile);
  postStatus(jobId, '正在整理变量定义...', 'working');
  var variables = await buildVariablesDefs(variableCache);
  var page = findPage(node);
  resources = finalizeResourceCollector(resourceCollector);
  var serializedNodeCount = sumNodeTypeCounts(resources.nodeTypes);

  return {
    version: 2,
    meta: {
      fileKey: fileKey || null,
      nodeId: node.id,
      nodeName: node.name,
      nodeType: node.type,
      pageId: page ? page.id : null,
      pageName: page ? page.name : null,
      extractionProfile: {
        mode: extractionProfile.mode,
        stats: extractionProfile.stats,
        serializedNodes: extractionProfile.serializedNodes,
        truncatedNodes: extractionProfile.truncatedNodes,
      },
      serializedNodeCount: serializedNodeCount,
      extractedAt: new Date().toISOString(),
    },
    root: root,
    variables: variables,
    resources: resources,
    assets: { exports: [], screenshot: null },
    css: await captureCssHints(node),
  };
}

async function extractMultipleNodes(nodes, jobId) {
  postStatus(jobId, '正在提取 ' + nodes.length + ' 个选中节点...', 'working');

  var extractionProfile = buildExtractionProfile(scanSubtreeStatsFromRoots(nodes));
  postStatus(jobId, '正在解析变量绑定...', 'working');
  var allSubtreeNodes = [];
  if (extractionProfile.resolveVariables !== false) {
    for (var i = 0; i < nodes.length; i++) {
      var subtree = collectSubtreeNodes(nodes[i]);
      for (var j = 0; j < subtree.length; j++) allSubtreeNodes.push(subtree[j]);
    }
  }
  var variableCache = extractionProfile.resolveVariables !== false ? await resolveVariableCache(allSubtreeNodes) : {};
  var resourceCollector = createResourceCollector();
  var resources;
  var traversalProgress = createTraversalProgress(jobId, '正在序列化选区节点');

  var serializedChildren = [];
  for (var k = 0; k < nodes.length; k++) {
    postStatus(jobId, '正在序列化选区节点 (' + (k + 1) + '/' + nodes.length + ')...', 'working');
    var child = await serializeNode(nodes[k], variableCache, resourceCollector, 0, traversalProgress, extractionProfile);
    if (child) serializedChildren.push(child);
  }

  var unionBox = computeUnionBoundingBox(nodes);
  for (var m = 0; m < serializedChildren.length; m++) {
    var childBox = serializedChildren[m].box;
    if (childBox && childBox.absoluteBox) {
      childBox.x = roundNum(childBox.absoluteBox.x - unionBox.x);
      childBox.y = roundNum(childBox.absoluteBox.y - unionBox.y);
    }
  }

  var virtualRoot = {
    id: 'VIRTUAL_GROUP',
    name: 'Multi-selection (' + nodes.length + ' nodes)',
    type: 'VIRTUAL_GROUP',
    visible: true,
    box: {
      x: 0,
      y: 0,
      width: unionBox.width,
      height: unionBox.height,
      absoluteBox: unionBox,
      renderBounds: unionBox,
      widthSizing: 'fixed',
      heightSizing: 'fixed'
    },
    style: { effects: [], opacity: 1, blendMode: 'PASS_THROUGH' },
    boundVariables: {},
    inferredVariables: {},
    children: serializedChildren
  };

  postStatus(jobId, '正在整理变量定义...', 'working');
  var variables = await buildVariablesDefs(variableCache);
  var page = findPage(nodes[0]);
  var selectedNodeIds = [];
  for (var n = 0; n < nodes.length; n++) selectedNodeIds.push(nodes[n].id);
  resources = finalizeResourceCollector(resourceCollector);
  var serializedNodeCount = sumNodeTypeCounts(resources.nodeTypes) + 1;

  return {
    version: 2,
    meta: {
      fileKey: null,
      nodeId: nodes[0].id,
      nodeName: virtualRoot.name,
      nodeType: 'VIRTUAL_GROUP',
      isMultiSelect: true,
      selectedNodeIds: selectedNodeIds,
      selectedNodeCount: nodes.length,
      pageId: page ? page.id : null,
      pageName: page ? page.name : null,
      extractionProfile: {
        mode: extractionProfile.mode,
        stats: extractionProfile.stats,
        serializedNodes: extractionProfile.serializedNodes,
        truncatedNodes: extractionProfile.truncatedNodes,
      },
      serializedNodeCount: serializedNodeCount,
      extractedAt: new Date().toISOString(),
    },
    root: virtualRoot,
    variables: variables,
    resources: resources,
    assets: { exports: [], screenshot: null },
    css: {
      available: false,
      reason: 'getCSSAsync is not available for virtual multi-selection roots',
    },
  };
}

function countSerializedNodes(node) {
  if (!node) return 0;
  var count = 1;
  if (node.children && Array.isArray(node.children)) {
    for (var i = 0; i < node.children.length; i++) count += countSerializedNodes(node.children[i]);
  }
  return count;
}

function sanitizeIdForPath(value) {
  return String(value || 'unknown').replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function baseName(filePath) {
  var parts = String(filePath || '').split('/');
  return parts[parts.length - 1] || 'file';
}

function computePageContentBounds(page) {
  if (!page || !page.children || page.children.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  var nodes = [];
  for (var i = 0; i < page.children.length; i++) {
    if (page.children[i] && page.children[i].visible !== false && page.children[i].absoluteBoundingBox) {
      nodes.push(page.children[i]);
    }
  }
  if (nodes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  return computeUnionBoundingBox(nodes);
}

function buildRegionEntry(serializedNode, pageInfo, level, parentRegionId) {
  if (!serializedNode || !serializedNode.box) return null;
  var sourceBox = serializedNode.box.absoluteBox || serializedNode.box;
  return {
    regionId: pageInfo.pageId + ':' + level + ':' + serializedNode.id,
    pageId: pageInfo.pageId,
    pageName: pageInfo.pageName,
    level: level,
    name: serializedNode.name,
    nodeId: serializedNode.id,
    parentRegionId: parentRegionId || null,
    x: typeof sourceBox.x === 'number' ? sourceBox.x : 0,
    y: typeof sourceBox.y === 'number' ? sourceBox.y : 0,
    w: typeof sourceBox.width === 'number' ? sourceBox.width : 0,
    h: typeof sourceBox.height === 'number' ? sourceBox.height : 0,
  };
}

function buildRegionsForExtraction(extraction, pageInfo) {
  var level1 = [];
  var level2 = [];
  var root = extraction.root;
  if (!root || !root.children || !Array.isArray(root.children)) return { level1: level1, level2: level2 };

  for (var i = 0; i < root.children.length; i++) {
    var child = root.children[i];
    if (!child || child.visible === false) continue;
    var parentRegion = buildRegionEntry(child, pageInfo, 1, null);
    if (parentRegion) level1.push(parentRegion);

    if (child.children && Array.isArray(child.children)) {
      for (var j = 0; j < child.children.length; j++) {
        var grandChild = child.children[j];
        if (!grandChild || grandChild.visible === false) continue;
        var nested = buildRegionEntry(grandChild, pageInfo, 2, parentRegion ? parentRegion.regionId : null);
        if (nested) level2.push(nested);
      }
    }
  }

  return { level1: level1, level2: level2 };
}

function countPageNodesByTypes(page, types) {
  if (!page || typeof page.findAllWithCriteria !== 'function') return null;
  try {
    return page.findAllWithCriteria({ types: types }).length;
  } catch (_) {
    return null;
  }
}

async function captureCssHints(node) {
  if (!node || typeof node.getCSSAsync !== 'function') {
    return { available: false, reason: 'getCSSAsync not available for this node type or mode' };
  }
  try {
    return { available: true, css: await node.getCSSAsync() };
  } catch (error) {
    return {
      available: false,
      reason: error && error.message ? error.message : 'getCSSAsync unavailable in current mode',
    };
  }
}

function buildPageInfo(page, extraction, sourceMode, selectedNodes, pageBounds) {
  var selectedNodeIds = [];
  for (var i = 0; i < selectedNodes.length; i++) selectedNodeIds.push(selectedNodes[i].id);
  var nodeCount = extraction && extraction.meta && typeof extraction.meta.serializedNodeCount === 'number'
    ? extraction.meta.serializedNodeCount
    : countSerializedNodes(extraction.root);
  return {
    pageId: page ? page.id : null,
    pageName: page ? page.name : null,
    sourceMode: sourceMode,
    rootNodeId: extraction.meta.nodeId,
    rootNodeName: extraction.meta.nodeName,
    rootNodeType: extraction.meta.nodeType,
    selectionCount: selectedNodes.length,
    selectedNodeIds: selectedNodeIds,
    nodeCount: nodeCount,
    pageBounds: pageBounds,
    stats: {
      textNodeCount: countPageNodesByTypes(page, ['TEXT']),
      instanceNodeCount: countPageNodesByTypes(page, ['INSTANCE']),
      frameNodeCount: countPageNodesByTypes(page, ['FRAME']),
    },
  };
}

function buildNodeScopedRelativeDir(baseDir, nodeId) {
  var prefix = baseDir ? baseDir + '/' : '';
  return prefix + 'nodes/' + sanitizeIdForPath(nodeId);
}

function shouldIncludeDirectNodeScreenshots(options, selectedNodes) {
  if (!selectedNodes || selectedNodes.length === 0) return false;
  return !!(options.nodeScreenshots || (options.screenshot !== false && selectedNodes.length > 1));
}

function buildScreenshotEntries(page, pageInfo, selectedNodes, options, baseDir) {
  var entries = [];
  if (page && options.pageScreenshots) {
    var pageScreenshotPath = baseDir ? baseDir + '/screenshots/page.png' : 'screenshots/page.png';
    entries.push({
      screenshotId: page.id + ':page',
      pageId: pageInfo.pageId,
      pageName: pageInfo.pageName,
      kind: 'page',
      nodeId: page.id,
      filePath: pageScreenshotPath,
      source: 'direct-export',
    });
  }

  if (!shouldIncludeDirectNodeScreenshots(options, selectedNodes)) {
    return entries;
  }

  var directNodes = makeUniqueNodes(selectedNodes || []);
  for (var i = 0; i < directNodes.length; i++) {
    var relativeDir = buildNodeScopedRelativeDir(baseDir, directNodes[i].id);
    entries.push({
      screenshotId: pageInfo.pageId + ':node:' + directNodes[i].id,
      pageId: pageInfo.pageId,
      pageName: pageInfo.pageName,
      kind: 'node',
      nodeId: directNodes[i].id,
      nodeName: directNodes[i].name,
      filePath: relativeDir + '/screenshot.png',
      source: 'direct-export',
    });
  }

  return entries;
}

function attachLegacyMetadata(extraction, page, selectedNodes, options, sourceMode) {
  var pageBounds = computePageContentBounds(page);
  extraction.pageInfo = buildPageInfo(page, extraction, sourceMode, selectedNodes, pageBounds);
  extraction.regions = buildRegionsForExtraction(extraction, extraction.pageInfo);
  extraction.screenshots = buildScreenshotEntries(page, extraction.pageInfo, selectedNodes, options, null);
  return extraction;
}

function createBundleId(prefix) {
  return sanitizeFileName(prefix || 'bundle') + '-' + Date.now();
}

function makeUniqueNodes(nodes) {
  var seen = {};
  var unique = [];
  for (var i = 0; i < nodes.length; i++) {
    var node = nodes[i];
    if (!node || seen[node.id]) continue;
    seen[node.id] = true;
    unique.push(node);
  }
  return unique;
}

function postAsset(jobId, data) {
  postToUi('post-asset', { jobId: jobId, data: data });
}

function addExportRecord(collection, asset, relativePath) {
  collection.push({
    nodeId: asset.nodeId,
    nodeName: asset.nodeName,
    format: asset.format,
    fileName: asset.fileName,
    relativePath: relativePath || null,
  });
}

function addNodeArtifactRecord(collection, record) {
  collection.push({
    nodeId: record.nodeId,
    nodeName: record.nodeName,
    relativeDir: record.relativeDir,
    screenshot: record.screenshot || null,
    exports: record.exports || [],
    images: record.images || [],
    vectors: record.vectors || [],
  });
}

function buildImageFillFileName(hash, imageRefs) {
  var imageRef = imageRefs && imageRefs[hash] ? imageRefs[hash] : null;
  var sourceName = imageRef && imageRef.primaryNodeName ? imageRef.primaryNodeName : 'image-fill';
  var shortHash = sanitizeFileName(hash).slice(0, 16) || 'image';
  return sanitizeFileName(sourceName) + '--' + shortHash + '.png';
}

async function exportImageFills(jobId, rootNodeId, assetRecords, imageRefs, assetContext) {
  var imageHashes = imageRefs ? Object.keys(imageRefs) : [];
  if (imageHashes.length === 0) return;

  postStatus(jobId, '正在导出图片填充 (' + imageHashes.length + ')...', 'working');
  if (!assetRecords.images) assetRecords.images = [];
  var imageDir = assetContext.imageDir || assetContext.assetDir || null;

  for (var i = 0; i < imageHashes.length; i++) {
    var hash = imageHashes[i];
    var imageRef = imageRefs && imageRefs[hash] ? imageRefs[hash] : null;
    try {
      var imageData = figma.getImageByHash(hash);
      if (!imageData) continue;
      var bytes = await imageData.getBytesAsync();
      var fileName = buildImageFillFileName(hash, imageRefs);
      var relativePath = imageDir ? imageDir + '/' + fileName : null;
      var payload = {
        rootNodeId: rootNodeId,
        nodeId: imageRef && imageRef.primaryNodeId ? imageRef.primaryNodeId : 'image-fill',
        nodeName: imageRef && imageRef.primaryNodeName ? imageRef.primaryNodeName : hash,
        format: 'PNG',
        base64: figma.base64Encode(bytes),
        fileName: fileName,
      };
      if (relativePath) payload.relativePath = relativePath;
      if (assetContext.bundleId) payload.bundleId = assetContext.bundleId;
      if (assetContext.pageId) payload.pageId = assetContext.pageId;
      if (assetContext.pageName) payload.pageName = assetContext.pageName;
      postAsset(jobId, payload);
      assetRecords.images.push({
        hash: hash,
        fileName: fileName,
        relativePath: relativePath || null,
        sourceNodeId: imageRef && imageRef.primaryNodeId ? imageRef.primaryNodeId : null,
        sourceNodeName: imageRef && imageRef.primaryNodeName ? imageRef.primaryNodeName : null,
      });
    } catch (_) { /* image export may fail for some hashes */ }
  }
}

var MAX_VECTOR_EXPORTS = 50;

async function exportVectorNodes(jobId, rootNodeId, node, assetRecords, assetContext) {
  var vectors = [];
  var vectorTypes = { VECTOR: 1, BOOLEAN_OPERATION: 1, STAR: 1, LINE: 1, ELLIPSE: 1, POLYGON: 1 };

  function collectVectors(n, isRoot) {
    if (!n) return;
    if (!isRoot && vectorTypes[n.type]) {
      vectors.push(n);
    }
    if ('children' in n && vectors.length < MAX_VECTOR_EXPORTS) {
      for (var i = 0; i < n.children.length; i++) {
        collectVectors(n.children[i], false);
        if (vectors.length >= MAX_VECTOR_EXPORTS) break;
      }
    }
  }

  collectVectors(node, true);
  if (vectors.length === 0) return;

  postStatus(jobId, '正在导出矢量资源 (' + vectors.length + (vectors.length >= MAX_VECTOR_EXPORTS ? '+' : '') + ')...', 'working');
  if (!assetRecords.vectors) assetRecords.vectors = [];
  var vectorDir = assetContext.vectorDir || assetContext.assetDir || null;

  for (var i = 0; i < vectors.length; i++) {
    var vec = vectors[i];
    try {
      var vectorAssets = await exportNodeAssets(vec, ['SVG', 'PNG'], rootNodeId);
      var vectorBaseName = sanitizeFileName(vec.name || 'vector') + '--' + sanitizeIdForPath(vec.id);
      for (var j = 0; j < vectorAssets.length; j++) {
        vectorAssets[j].fileName = vectorBaseName + (vectorAssets[j].format === 'SVG' ? '.svg' : '@2x.png');
        var relativePath = vectorDir ? vectorDir + '/' + vectorAssets[j].fileName : null;
        if (relativePath) vectorAssets[j].relativePath = relativePath;
        if (assetContext.bundleId) vectorAssets[j].bundleId = assetContext.bundleId;
        if (assetContext.pageId) vectorAssets[j].pageId = assetContext.pageId;
        if (assetContext.pageName) vectorAssets[j].pageName = assetContext.pageName;
        postAsset(jobId, vectorAssets[j]);
        assetRecords.vectors.push({
          nodeId: vec.id,
          name: vec.name,
          format: vectorAssets[j].format,
          fileName: vectorAssets[j].fileName,
          relativePath: relativePath || null
        });
      }
    } catch (_) { /* vector export may fail */ }
  }
}

async function exportNodeAssetFiles(jobId, nodes, rootNodeId, assetRecords, options, assetContext) {
  var exportNodes = makeUniqueNodes(nodes || []);
  if (exportNodes.length === 0) return;
  if (!assetRecords.exports) assetRecords.exports = [];

  var exportFormats = options.exportFormats || (options.exportAssets ? ['SVG', 'PNG'] : []);
  var exportDir = assetContext.exportDir || assetContext.assetDir || null;
  if (exportFormats.length > 0) {
    postStatus(jobId, '正在导出资产...', 'working');
    for (var i = 0; i < exportNodes.length; i++) {
      var assets = await exportNodeAssets(exportNodes[i], exportFormats, rootNodeId);
      for (var j = 0; j < assets.length; j++) {
        var relativePath = exportDir ? exportDir + '/' + assets[j].fileName : null;
        if (relativePath) assets[j].relativePath = relativePath;
        if (assetContext.bundleId) assets[j].bundleId = assetContext.bundleId;
        if (assetContext.pageId) assets[j].pageId = assetContext.pageId;
        if (assetContext.pageName) assets[j].pageName = assetContext.pageName;
        postAsset(jobId, assets[j]);
        addExportRecord(assetRecords.exports, assets[j], relativePath);
      }
    }
  }

  if (options.exportAssets) {
    await exportImageFills(jobId, rootNodeId, assetRecords, assetContext.imageRefs || null, assetContext);
    for (var k = 0; k < exportNodes.length; k++) {
      await exportVectorNodes(jobId, rootNodeId, exportNodes[k], assetRecords, assetContext);
    }
  }
}

async function exportDirectNodeScreenshot(jobId, node, rootNodeId, assetContext, relativePath) {
  try {
    var bytes = await node.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 2 } });
    var payload = {
      rootNodeId: rootNodeId,
      nodeId: node.id,
      nodeName: node.name,
      format: 'PNG',
      base64: figma.base64Encode(bytes),
      fileName: baseName(relativePath || 'screenshot.png'),
      isScreenshot: true,
      screenshotKind: 'node',
    };
    if (relativePath) payload.relativePath = relativePath;
    if (assetContext.bundleId) payload.bundleId = assetContext.bundleId;
    if (assetContext.pageId) payload.pageId = assetContext.pageId;
    if (assetContext.pageName) payload.pageName = assetContext.pageName;
    postAsset(jobId, payload);
    return {
      nodeId: node.id,
      nodeName: node.name,
      fileName: payload.fileName,
      relativePath: payload.relativePath || null,
    };
  } catch (_) { return null; }
}

async function exportPageScreenshot(jobId, page, rootNodeId, pageId, pageName, relativePath, bundleId) {
  try {
    var bytes = await page.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 2 } });
    var payload = {
      rootNodeId: rootNodeId,
      nodeId: page.id,
      nodeName: page.name,
      pageId: pageId,
      pageName: pageName,
      format: 'PNG',
      base64: figma.base64Encode(bytes),
      fileName: baseName(relativePath),
      relativePath: relativePath,
      isScreenshot: true,
      screenshotKind: 'page',
    };
    if (bundleId) payload.bundleId = bundleId;
    postAsset(jobId, payload);
  } catch (_) { /* page screenshot export may fail */ }
}

function shouldExportNodePackages(nodes, options) {
  if (!nodes || nodes.length === 0) return false;
  if (!(options.exportAssets || options.nodeScreenshots || options.screenshot !== false)) return false;
  return nodes.length > 1 || !!options.nodeScreenshots;
}

async function exportNodePackages(jobId, nodes, rootNodeId, extraction, options, assetContext) {
  var packageNodes = makeUniqueNodes(nodes || []);
  if (packageNodes.length === 0) return [];
  if (!extraction.assets.nodeArtifacts) extraction.assets.nodeArtifacts = [];

  postStatus(jobId, '正在导出节点资源包 (' + packageNodes.length + ')...', 'working');

  for (var i = 0; i < packageNodes.length; i++) {
    var node = packageNodes[i];
    var relativeDir = buildNodeScopedRelativeDir(assetContext.baseDir, node.id);
    var nodeResources = collectResourcesFromNodes([node]);
    var nodeAssets = { exports: [], images: [], vectors: [] };
    var nodeRecord = {
      nodeId: node.id,
      nodeName: node.name,
      relativeDir: relativeDir,
      screenshot: null,
      exports: [],
      images: [],
      vectors: [],
    };

    if (options.nodeScreenshots || options.screenshot !== false) {
      nodeRecord.screenshot = await exportDirectNodeScreenshot(jobId, node, rootNodeId, assetContext, relativeDir + '/screenshot.png');
    }

    await exportNodeAssetFiles(jobId, [node], rootNodeId, nodeAssets, options, {
      bundleId: assetContext.bundleId || null,
      pageId: assetContext.pageId || null,
      pageName: assetContext.pageName || null,
      exportDir: relativeDir + '/exports',
      imageDir: relativeDir + '/assets/images',
      vectorDir: relativeDir + '/assets/vectors',
      imageRefs: nodeResources.imageRefs,
    });

    nodeRecord.exports = nodeAssets.exports || [];
    nodeRecord.images = nodeAssets.images || [];
    nodeRecord.vectors = nodeAssets.vectors || [];
    addNodeArtifactRecord(extraction.assets.nodeArtifacts, nodeRecord);
  }

  return extraction.assets.nodeArtifacts;
}

async function exportLegacyArtifacts(jobId, sourceNodes, page, extraction, options) {
  var rootNodes = makeUniqueNodes(sourceNodes && sourceNodes.length ? sourceNodes : [page]);
  var rootNodeId = extraction.meta.nodeId;
  var shouldUseNodePackages = shouldExportNodePackages(rootNodes, options);

  if (!shouldUseNodePackages || rootNodes.length === 1) {
    await exportNodeAssetFiles(jobId, rootNodes, rootNodeId, extraction.assets, options, {
      assetDir: 'assets',
      pageId: extraction.pageInfo ? extraction.pageInfo.pageId : null,
      pageName: extraction.pageInfo ? extraction.pageInfo.pageName : null,
      imageRefs: extraction.resources ? extraction.resources.imageRefs : null,
    });
  }

  if (options.screenshot !== false && rootNodes.length > 0 && (!shouldUseNodePackages || rootNodes.length === 1)) {
    postStatus(jobId, '正在导出截图...', 'working');
    var screenshot = await exportFrameScreenshot(rootNodes[0]);
    if (screenshot) {
      screenshot.rootNodeId = rootNodeId;
      postAsset(jobId, screenshot);
      extraction.assets.screenshot = { nodeId: screenshot.nodeId, fileName: screenshot.fileName };
    }
  }

  if (shouldUseNodePackages) {
    await exportNodePackages(jobId, rootNodes, rootNodeId, extraction, options, {
      baseDir: null,
      pageId: extraction.pageInfo ? extraction.pageInfo.pageId : null,
      pageName: extraction.pageInfo ? extraction.pageInfo.pageName : null,
    });
  }

  if (page && extraction.screenshots && extraction.screenshots.length > 0) {
    for (var i = 0; i < extraction.screenshots.length; i++) {
      if (extraction.screenshots[i].kind === 'page') {
        await exportPageScreenshot(
          jobId,
          page,
          rootNodeId,
          extraction.pageInfo.pageId,
          extraction.pageInfo.pageName,
          extraction.screenshots[i].filePath,
          null
        );
        break;
      }
    }
  }
}

async function buildBundlePageEntry(page, sourceMode, selectedNodes, options, jobId) {
  var extraction;
  if (sourceMode === 'page') {
    extraction = await extractNode(page, null, jobId);
  } else {
    extraction = selectedNodes.length === 1
      ? await extractNode(selectedNodes[0], null, jobId)
      : await extractMultipleNodes(selectedNodes, jobId);
  }

  try {
    if (figma.root && figma.root.name) extraction.meta.fileName = figma.root.name;
  } catch (_) { /* ignore */ }

  var pageBounds = computePageContentBounds(page);
  var pageInfo = buildPageInfo(page, extraction, sourceMode, selectedNodes, pageBounds);
  var screenshotBaseDir = 'pages/' + sanitizeIdForPath(page.id);
  var screenshots = buildScreenshotEntries(page, pageInfo, selectedNodes, options, screenshotBaseDir);
  var regions = buildRegionsForExtraction(extraction, pageInfo);

  return {
    pageId: page.id,
    pageName: page.name,
    pageInfo: pageInfo,
    extraction: extraction,
    screenshots: screenshots,
    regions: regions,
  };
}

async function exportBundlePageArtifacts(jobId, bundleId, page, pageEntry, sourceNodes, selectedNodes, options) {
  var rootNodes = makeUniqueNodes(sourceNodes && sourceNodes.length ? sourceNodes : [page]);
  var directNodes = makeUniqueNodes(selectedNodes && selectedNodes.length ? selectedNodes : []);
  var shouldUseNodePackages = shouldExportNodePackages(directNodes, options);

  if (!shouldUseNodePackages || (rootNodes.length === 1 && rootNodes[0] === page)) {
    await exportNodeAssetFiles(jobId, rootNodes, pageEntry.extraction.meta.nodeId, pageEntry.extraction.assets, options, {
      bundleId: bundleId,
      pageId: pageEntry.pageId,
      pageName: pageEntry.pageName,
      assetDir: 'pages/' + sanitizeIdForPath(pageEntry.pageId) + '/assets',
      imageRefs: pageEntry.extraction.resources ? pageEntry.extraction.resources.imageRefs : null,
    });
  }

  if (shouldUseNodePackages) {
    await exportNodePackages(jobId, directNodes, pageEntry.extraction.meta.nodeId, pageEntry.extraction, options, {
      baseDir: 'pages/' + sanitizeIdForPath(pageEntry.pageId),
      bundleId: bundleId,
      pageId: pageEntry.pageId,
      pageName: pageEntry.pageName,
    });
  }

  for (var i = 0; i < pageEntry.screenshots.length; i++) {
    if (pageEntry.screenshots[i].kind === 'page') {
      await exportPageScreenshot(
        jobId,
        page,
        pageEntry.extraction.meta.nodeId,
        pageEntry.pageId,
        pageEntry.pageName,
        pageEntry.screenshots[i].filePath,
        bundleId
      );
      break;
    }
  }
}

function listAllPages() {
  var pages = [];
  if (!figma.root || !figma.root.children) return pages;
  for (var i = 0; i < figma.root.children.length; i++) {
    if (figma.root.children[i] && figma.root.children[i].type === 'PAGE') {
      pages.push(resolvePageReference(figma.root.children[i]));
    }
  }
  return pages;
}

function resolvePageReference(page) {
  if (!page) return page;
  if (figma.currentPage && page.id === figma.currentPage.id) {
    return figma.currentPage;
  }
  return page;
}

function findPagesByIdentifiers(identifiers) {
  var pages = listAllPages();
  var wanted = {};
  for (var i = 0; i < identifiers.length; i++) wanted[String(identifiers[i]).toLowerCase()] = true;
  var matched = [];
  for (var j = 0; j < pages.length; j++) {
    var page = pages[j];
    if (wanted[String(page.id).toLowerCase()] || wanted[String(page.name).toLowerCase()]) {
      matched.push(page);
    }
  }
  return matched;
}

function getPagesWithSelection() {
  var pages = listAllPages();
  var selectedPages = [];
  for (var i = 0; i < pages.length; i++) {
    if (pages[i].selection && pages[i].selection.length > 0) selectedPages.push(pages[i]);
  }
  return selectedPages;
}

async function ensurePageLoaded(page) {
  var resolvedPage = resolvePageReference(page);
  if (!resolvedPage || typeof resolvedPage.loadAsync !== 'function') return resolvedPage;
  if (figma.currentPage && resolvedPage.id === figma.currentPage.id) {
    return figma.currentPage;
  }
  await resolvedPage.loadAsync();
  return resolvedPage;
}

async function withOptimizedTraversal(fn) {
  var canToggle = typeof figma.skipInvisibleInstanceChildren === 'boolean';
  var previous = canToggle ? figma.skipInvisibleInstanceChildren : null;
  try {
    if (canToggle) figma.skipInvisibleInstanceChildren = true;
    return await fn();
  } finally {
    if (canToggle) figma.skipInvisibleInstanceChildren = previous;
  }
}

async function withJobHeartbeat(jobId, heartbeatText, fn) {
  var timer = setInterval(function () {
    postStatus(jobId, heartbeatText, 'working');
  }, JOB_HEARTBEAT_INTERVAL_MS);

  try {
    return await fn();
  } finally {
    clearInterval(timer);
  }
}

function handleError(jobId, error) {
  postStatus(jobId, '执行失败: ' + (error.message || String(error)), 'error');
  postToUi('post-result', { jobId: jobId, data: { error: error.message || String(error) } });
}

async function executeExtractJob(jobId, target, options) {
  try {
    await withJobHeartbeat(jobId, '单节点提取进行中...', async function () {
      await withOptimizedTraversal(async function () {
        var nodeId = target.nodeId;
        if (!nodeId) {
          throw new Error('missing nodeId in extract target');
        }

        var figmaNodeId = nodeId.replace(/-/g, ':');
        var node = await figma.getNodeByIdAsync(figmaNodeId);
        if (!node) {
          throw new Error('node not found: ' + figmaNodeId);
        }

        var page = findPage(node);
        var extraction = await extractNode(node, target.fileKey, jobId);
        try {
          if (figma.root && figma.root.name) extraction.meta.fileName = figma.root.name;
        } catch (_) { /* ignore */ }
        extraction = attachLegacyMetadata(extraction, page, [node], options, 'node');
        await exportLegacyArtifacts(jobId, [node], page, extraction, options);

        postStatus(jobId, '提取完成 ✓ (' + countKeys(extraction.resources.nodeTypes) + ' 种节点)', 'ok');
        postToUi('post-result', { jobId: jobId, data: extraction });
      });
    });
  } catch (error) {
    handleError(jobId, error);
  }
}

async function executeExtractSelectionJob(jobId, options) {
  try {
    await withJobHeartbeat(jobId, '选区提取进行中...', async function () {
      await withOptimizedTraversal(async function () {
        var selection = figma.currentPage.selection;
        if (!selection || selection.length === 0) {
          throw new Error('Figma 中没有选中任何元素，请先选中目标节点');
        }

        var extraction;
        var sourceMode = selection.length > 1 ? 'selection-multi' : 'selection';
        if (selection.length === 1) {
          extraction = await extractNode(selection[0], null, jobId);
        } else {
          extraction = await extractMultipleNodes(selection, jobId);
        }

        try {
          if (figma.root && figma.root.name) extraction.meta.fileName = figma.root.name;
        } catch (_) { /* ignore */ }
        extraction = attachLegacyMetadata(extraction, figma.currentPage, selection.slice(), options, sourceMode);
        await exportLegacyArtifacts(jobId, selection.slice(), figma.currentPage, extraction, options);

        postStatus(jobId, '选区提取完成 ✓ (' + selection.length + ' 个节点)', 'ok');
        postToUi('post-result', { jobId: jobId, data: extraction });
      });
    });
  } catch (error) {
    handleError(jobId, error);
  }
}

async function executeExtractPagesJob(jobId, target, options) {
  try {
    await withJobHeartbeat(jobId, '页面 bundle 提取进行中...', async function () {
      await withOptimizedTraversal(async function () {
        var identifiers = target && target.pages ? target.pages : [];
        var pages = findPagesByIdentifiers(identifiers);
        if (pages.length === 0) {
          throw new Error('未找到任何匹配页面，请检查 page 名称或 pageId');
        }

        var bundleId = createBundleId('pages-bundle');
        var entries = [];
        postStatus(jobId, '正在提取 ' + pages.length + ' 个页面...', 'working');
        for (var i = 0; i < pages.length; i++) {
          var page = await ensurePageLoaded(pages[i]);
          var pageSelection = page.selection ? page.selection.slice() : [];
          var entry = await buildBundlePageEntry(page, 'page', pageSelection, options, jobId);
          entries.push(entry);
          await exportBundlePageArtifacts(jobId, bundleId, page, entry, [page], pageSelection, options);
        }

        var bundle = {
          schemaVersion: 1,
          kind: 'figma-bundle',
          bundleId: bundleId,
          bundleName: 'Pages bundle (' + pages.length + ' pages)',
          createdAt: new Date().toISOString(),
          source: 'extract-pages',
          fileName: figma.root && figma.root.name ? figma.root.name : null,
          pages: entries,
        };

        postStatus(jobId, '页面 bundle 提取完成 ✓ (' + pages.length + ' 页)', 'ok');
        postToUi('post-result', { jobId: jobId, data: bundle });
      });
    });
  } catch (error) {
    handleError(jobId, error);
  }
}

async function executeExtractSelectedPagesBundleJob(jobId, options) {
  try {
    await withJobHeartbeat(jobId, '多页面 bundle 提取进行中...', async function () {
      await withOptimizedTraversal(async function () {
        var pages = [];
        var allPages = listAllPages();
        for (var pageIndex = 0; pageIndex < allPages.length; pageIndex++) {
          var candidatePage = await ensurePageLoaded(allPages[pageIndex]);
          if (candidatePage.selection && candidatePage.selection.length > 0) {
            pages.push(candidatePage);
          }
        }
        if (pages.length === 0) {
          throw new Error('没有页面保留 selection，请先在一个或多个页面中选中目标节点');
        }

        var bundleId = createBundleId('selected-pages-bundle');
        var entries = [];
        postStatus(jobId, '正在提取 ' + pages.length + ' 个带 selection 的页面...', 'working');
        for (var i = 0; i < pages.length; i++) {
          var page = await ensurePageLoaded(pages[i]);
          var pageSelection = page.selection.slice();
          var entry = await buildBundlePageEntry(page, 'page-selection', pageSelection, options, jobId);
          entries.push(entry);
          await exportBundlePageArtifacts(jobId, bundleId, page, entry, pageSelection, pageSelection, options);
        }

        var bundle = {
          schemaVersion: 1,
          kind: 'figma-bundle',
          bundleId: bundleId,
          bundleName: 'Selected pages bundle (' + pages.length + ' pages)',
          createdAt: new Date().toISOString(),
          source: 'extract-selected-pages-bundle',
          fileName: figma.root && figma.root.name ? figma.root.name : null,
          pages: entries,
        };

        postStatus(jobId, '多页面 selection bundle 提取完成 ✓ (' + pages.length + ' 页)', 'ok');
        postToUi('post-result', { jobId: jobId, data: bundle });
      });
    });
  } catch (error) {
    handleError(jobId, error);
  }
}

figma.ui.onmessage = function (msg) {
  if (!msg || !msg.type) return;

  if (msg.type === 'extract') {
    var payload = msg.payload || msg;
    if (!payload.jobId || !payload.target) {
      postStatus(null, '无效的 extract 指令：缺少 jobId 或 target', 'error');
      return;
    }
    executeExtractJob(payload.jobId, payload.target, payload.options || {}).catch(function (err) { handleError(payload.jobId, err); });
  } else if (msg.type === 'extract-selection') {
    var selPayload = msg.payload || msg;
    if (!selPayload.jobId) {
      postStatus(null, '无效的 extract-selection 指令：缺少 jobId', 'error');
      return;
    }
    executeExtractSelectionJob(selPayload.jobId, selPayload.options || {}).catch(function (err) { handleError(selPayload.jobId, err); });
  } else if (msg.type === 'extract-pages') {
    var pagesPayload = msg.payload || msg;
    if (!pagesPayload.jobId || !pagesPayload.target || !pagesPayload.target.pages) {
      postStatus(null, '无效的 extract-pages 指令：缺少 jobId 或 pages', 'error');
      return;
    }
    executeExtractPagesJob(pagesPayload.jobId, pagesPayload.target, pagesPayload.options || {}).catch(function (err) { handleError(pagesPayload.jobId, err); });
  } else if (msg.type === 'extract-selected-pages-bundle') {
    var bundlePayload = msg.payload || msg;
    if (!bundlePayload.jobId) {
      postStatus(null, '无效的 extract-selected-pages-bundle 指令：缺少 jobId', 'error');
      return;
    }
    executeExtractSelectedPagesBundleJob(bundlePayload.jobId, bundlePayload.options || {}).catch(function (err) { handleError(bundlePayload.jobId, err); });
  }
};
