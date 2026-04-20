figma.showUI(__html__, { width: 340, height: 300 });

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

function sanitizeFileName(name) {
  return String(name || 'untitled')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 60);
}

function countKeys(obj) { return Object.keys(obj || {}).length; }

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

function serializeTextSegments(node) {
  if (!node || typeof node.getStyledTextSegments !== 'function') return [];

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

function mapTextNode(node) {
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
    segments: serializeTextSegments(node),
  };
}

// ══════════════════════════════════════════════
// Serialization: Vector
// ══════════════════════════════════════════════

function mapVector(node) {
  var vector = {};
  if (hasProperty(node, 'fillGeometry') && Array.isArray(node.fillGeometry)) {
    vector.fillGeometryCount = node.fillGeometry.length;
    if (node.fillGeometry.length > 0 && node.fillGeometry.length <= 8) vector.fillGeometry = node.fillGeometry;
  }
  if (hasProperty(node, 'strokeGeometry') && Array.isArray(node.strokeGeometry)) {
    vector.strokeGeometryCount = node.strokeGeometry.length;
    if (node.strokeGeometry.length > 0 && node.strokeGeometry.length <= 8) vector.strokeGeometry = node.strokeGeometry;
  }
  if (hasProperty(node, 'vectorPaths') && Array.isArray(node.vectorPaths)) {
    vector.vectorPathCount = node.vectorPaths.length;
    if (node.vectorPaths.length > 0 && node.vectorPaths.length <= 8) vector.vectorPaths = node.vectorPaths;
  }
  return countKeys(vector) > 0 ? vector : null;
}

// ══════════════════════════════════════════════
// Serialization: Component
// ══════════════════════════════════════════════

async function mapComponent(node) {
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

  if (node.type === 'INSTANCE' && typeof node.getMainComponentAsync === 'function') {
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
        collector.images[node.fills[i].imageHash] = (collector.images[node.fills[i].imageHash] || 0) + 1;
      }
    }
  }
}

// ══════════════════════════════════════════════
// Node tree serialization
// ══════════════════════════════════════════════

async function serializeNode(node, variableCache, resourceCollector, depth) {
  if (!node) return null;

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
    result.text = mapTextNode(node);
  }

  var vectorInfo = mapVector(node);
  if (vectorInfo) result.vector = vectorInfo;

  var componentInfo = await mapComponent(node);
  if (componentInfo) result.component = componentInfo;

  // Variable bindings
  var boundResult = safeRead(node, 'boundVariables');
  if (boundResult.value) result.boundVariables = serializeVariableBinding(boundResult.value, variableCache);
  var inferredResult = safeRead(node, 'inferredVariables');
  if (inferredResult.value) result.inferredVariables = serializeVariableBinding(inferredResult.value, variableCache);

  // Children
  if (node.children && Array.isArray(node.children) && depth < 50) {
    result.children = [];
    for (var i = 0; i < node.children.length; i++) {
      var child = await serializeNode(node.children[i], variableCache, resourceCollector, depth + 1);
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

async function extractNode(node, fileKey) {
  postToUi('status', { text: '正在提取 ' + node.name + '...', state: 'working' });

  var allNodes = collectSubtreeNodes(node);
  var variableCache = await resolveVariableCache(allNodes);
  var resourceCollector = createResourceCollector();

  var root = await serializeNode(node, variableCache, resourceCollector, 0);
  var variables = await buildVariablesDefs(variableCache);
  var page = findPage(node);

  var extraction = {
    version: 2,
    meta: {
      fileKey: fileKey || null,
      nodeId: node.id,
      nodeName: node.name,
      nodeType: node.type,
      pageId: page ? page.id : null,
      pageName: page ? page.name : null,
      extractedAt: new Date().toISOString(),
    },
    root: root,
    variables: variables,
    resources: {
      nodeTypes: resourceCollector.nodeTypes,
      fonts: Object.values(resourceCollector.fonts),
      images: Object.keys(resourceCollector.images),
    },
    assets: { exports: [], screenshot: null },
  };

  return extraction;
}

async function extractMultipleNodes(nodes) {
  postToUi('status', { text: '正在提取 ' + nodes.length + ' 个选中节点...', state: 'working' });

  var allSubtreeNodes = [];
  for (var i = 0; i < nodes.length; i++) {
    var subtree = collectSubtreeNodes(nodes[i]);
    for (var j = 0; j < subtree.length; j++) allSubtreeNodes.push(subtree[j]);
  }

  var variableCache = await resolveVariableCache(allSubtreeNodes);
  var resourceCollector = createResourceCollector();

  var serializedChildren = [];
  for (var k = 0; k < nodes.length; k++) {
    var child = await serializeNode(nodes[k], variableCache, resourceCollector, 0);
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

  var variables = await buildVariablesDefs(variableCache);
  var page = findPage(nodes[0]);
  var selectedNodeIds = [];
  for (var n = 0; n < nodes.length; n++) selectedNodeIds.push(nodes[n].id);

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
      extractedAt: new Date().toISOString(),
    },
    root: virtualRoot,
    variables: variables,
    resources: {
      nodeTypes: resourceCollector.nodeTypes,
      fonts: Object.values(resourceCollector.fonts),
      images: Object.keys(resourceCollector.images),
    },
    assets: { exports: [], screenshot: null },
  };
}

// ══════════════════════════════════════════════
// Error reporting
// ══════════════════════════════════════════════

function handleError(jobId, error) {
  postToUi('post-result', { jobId: jobId, data: { error: error.message || String(error) } });
  postToUi('status', { text: '执行失败: ' + (error.message || String(error)), state: 'error' });
}

// ══════════════════════════════════════════════
// Asset export + result posting (shared logic)
// ══════════════════════════════════════════════

async function exportImageFills(jobId, rootNodeId, extraction) {
  var imageHashes = extraction.resources.images || [];
  if (imageHashes.length === 0) return;

  postToUi('status', { text: '正在导出图片填充 (' + imageHashes.length + ')...', state: 'working' });
  if (!extraction.assets.images) extraction.assets.images = [];

  for (var i = 0; i < imageHashes.length; i++) {
    var hash = imageHashes[i];
    try {
      var imageData = figma.getImageByHash(hash);
      if (!imageData) continue;
      var bytes = await imageData.getBytesAsync();
      var base64Data = figma.base64Encode(bytes);
      var fileName = hash + '.png';
      postToUi('post-asset', {
        jobId: jobId,
        data: {
          rootNodeId: rootNodeId,
          nodeId: 'image-fill',
          nodeName: hash,
          format: 'PNG',
          base64: base64Data,
          fileName: fileName,
        },
      });
      extraction.assets.images.push({ hash: hash, fileName: fileName });
    } catch (_) { /* image export may fail for some hashes */ }
  }
}

var MAX_VECTOR_EXPORTS = 50;

async function exportVectorNodes(jobId, rootNodeId, node, extraction) {
  var vectors = [];
  var vectorTypes = { VECTOR: 1, BOOLEAN_OPERATION: 1, STAR: 1, LINE: 1, ELLIPSE: 1, POLYGON: 1 };

  function collectVectors(n, isRoot) {
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

  postToUi('status', { text: '正在导出矢量图标 (' + vectors.length + (vectors.length >= MAX_VECTOR_EXPORTS ? '+' : '') + ')...', state: 'working' });
  if (!extraction.assets.vectors) extraction.assets.vectors = [];

  for (var i = 0; i < vectors.length; i++) {
    var vec = vectors[i];
    try {
      var bytes = await vec.exportAsync({ format: 'SVG' });
      var base64Data = figma.base64Encode(bytes);
      var fileName = sanitizeFileName(vec.name || vec.id) + '.svg';
      postToUi('post-asset', {
        jobId: jobId,
        data: {
          rootNodeId: rootNodeId,
          nodeId: vec.id,
          nodeName: vec.name,
          format: 'SVG',
          base64: base64Data,
          fileName: fileName,
        },
      });
      extraction.assets.vectors.push({ nodeId: vec.id, name: vec.name, fileName: fileName });
    } catch (_) { /* vector export may fail */ }
  }
}

async function exportAssetsAndPost(jobId, node, extraction, options) {
  var rootNodeId = node.id;

  var exportFormats = options.exportFormats || (options.exportAssets ? ['SVG', 'PNG'] : []);
  if (exportFormats.length > 0) {
    postToUi('status', { text: '正在导出资产...', state: 'working' });
    var assets = await exportNodeAssets(node, exportFormats, rootNodeId);
    for (var i = 0; i < assets.length; i++) {
      postToUi('post-asset', { jobId: jobId, data: assets[i] });
      extraction.assets.exports.push({ nodeId: assets[i].nodeId, format: assets[i].format, fileName: assets[i].fileName });
    }
  }

  if (options.exportAssets) {
    await exportImageFills(jobId, rootNodeId, extraction);
    await exportVectorNodes(jobId, rootNodeId, node, extraction);
  }

  if (options.screenshot !== false) {
    postToUi('status', { text: '正在导出截图...', state: 'working' });
    var screenshot = await exportFrameScreenshot(node);
    if (screenshot) {
      screenshot.rootNodeId = rootNodeId;
      postToUi('post-asset', { jobId: jobId, data: screenshot });
      extraction.assets.screenshot = { nodeId: screenshot.nodeId, fileName: screenshot.fileName };
    }
  }
}

// ══════════════════════════════════════════════
// Job execution (bridge-commanded)
// ══════════════════════════════════════════════

async function executeExtractJob(jobId, target, options) {
  try {
    var nodeId = target.nodeId;
    if (!nodeId) {
      throw new Error('missing nodeId in extract target');
    }

    var figmaNodeId = nodeId.replace(/-/g, ':');
    var node = await figma.getNodeByIdAsync(figmaNodeId);
    if (!node) {
      throw new Error('node not found: ' + figmaNodeId);
    }

    var extraction = await extractNode(node, target.fileKey);
    await exportAssetsAndPost(jobId, node, extraction, options);

    postToUi('post-result', { jobId: jobId, data: extraction });
    postToUi('status', { text: '提取完成 ✓ (' + countKeys(extraction.resources.nodeTypes) + ' 种节点)', state: 'ok' });
  } catch (error) {
    handleError(jobId, error);
  }
}

async function executeExtractSelectionJob(jobId, options) {
  try {
    var selection = figma.currentPage.selection;
    if (!selection || selection.length === 0) {
      throw new Error('Figma 中没有选中任何元素，请先选中目标节点');
    }

    var extraction;
    var primaryNode = selection[0];

    if (selection.length === 1) {
      extraction = await extractNode(primaryNode, null);
    } else {
      extraction = await extractMultipleNodes(selection);
    }

    try {
      var root = figma.root;
      if (root && root.name) extraction.meta.fileName = root.name;
    } catch (_) { /* skip */ }

    await exportAssetsAndPost(jobId, primaryNode, extraction, options);

    postToUi('post-result', { jobId: jobId, data: extraction });
    postToUi('status', { text: '选区提取完成 ✓ (' + selection.length + ' 个节点)', state: 'ok' });
  } catch (error) {
    handleError(jobId, error);
  }
}

// ══════════════════════════════════════════════
// Message handler
// ══════════════════════════════════════════════

figma.ui.onmessage = function (msg) {
  if (!msg || !msg.type) return;

  if (msg.type === 'extract') {
    var payload = msg.payload || msg;
    if (!payload.jobId || !payload.target) {
      postToUi('status', { text: '无效的 extract 指令：缺少 jobId 或 target', state: 'error' });
      return;
    }
    executeExtractJob(payload.jobId, payload.target, payload.options || {}).catch(function (err) { handleError(payload.jobId, err); });
  } else if (msg.type === 'extract-selection') {
    var selPayload = msg.payload || msg;
    if (!selPayload.jobId) {
      postToUi('status', { text: '无效的 extract-selection 指令：缺少 jobId', state: 'error' });
      return;
    }
    executeExtractSelectionJob(selPayload.jobId, selPayload.options || {}).catch(function (err) { handleError(selPayload.jobId, err); });
  }
};
