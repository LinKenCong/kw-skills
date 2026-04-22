# Figma Plugins API Research Findings

**Scope:** Layout, text, vectors, images, export, components, variants, instances, multi-selection, and traversal APIs for figma-to-code skill

**Documentation Base:** `https://www.figma.com/plugin-docs/`

---

## 1. Layout & Positioning

### Auto Layout
- **Status:** Properties documented but specific auto-layout URL returned 404
- **Key Properties (on FrameNode/ComponentNode/InstanceNode):**
  - Layout mode, direction, spacing, padding
  - Accessed via frame properties, not dedicated mixin in current docs
- **Doc URL:** https://www.figma.com/plugin-docs/api/FrameNode

### Constraints
- **Confirmed:** `constraints` property available on most scene nodes
- **Type:** `Constraints` object with horizontal and vertical constraint settings
- **Behavior:** Not available on Group and BooleanOperation nodes (constraints apply to their children instead)
- **Doc URL:** https://www.figma.com/plugin-docs/api/properties/nodes-constraints

### Absolute Positioning APIs
- **`absoluteBoundingBox`** ✓ Confirmed
  - Type: `Rect | null` (readonly)
  - Definition: Bounds excluding rendered effects (shadows, strokes)
  - Contains absolute `x, y` position on page
  - **Doc URL:** https://www.figma.com/plugin-docs/api/node-properties (see absoluteBoundingBox section)

- **`absoluteRenderBounds`** ✓ Confirmed  
  - Type: `Rect | null` (readonly)
  - Definition: Actual rendered bounds INCLUDING effects (shadows, strokes, etc.)
  - Returns `null` if node is invisible
  - **Doc URL:** https://www.figma.com/plugin-docs/api/node-properties (see absoluteRenderBounds section)

- **`absoluteTransform`** ✓ Confirmed
  - Type: `Transform` matrix (readonly)
  - Definition: Position relative to containing page as 2D transform matrix
  - **Doc URL:** https://www.figma.com/plugin-docs/api/node-properties (see absoluteTransform section)

---

## 2. Text APIs

### Core Text Node Properties
- **`characters`**: Raw text string (requires font loaded to set)
- **`fontSize`, `fontName`, `fontWeight`**: Can return `figma.mixed` for mixed styles
- **Text alignment:** `textAlignHorizontal`, `textAlignVertical`
- **Text sizing:** `textAutoResize` modes: `'NONE' | 'WIDTH_AND_HEIGHT' | 'HEIGHT' | 'TRUNCATE'`
- **Text truncation:** `textTruncation`, `maxLines`
- **Doc URL:** https://www.figma.com/plugin-docs/api/TextNode

### Mixed Styles & Styled Text Segments ✓ HIGH-VALUE
- **`getStyledTextSegments(fields, start?, end?)`** — Primary API for handling mixed text styles
  - **Parameters:** Array of field names (fontSize, fontName, fills, letterSpacing, lineHeight, etc.)
  - **Returns:** Array of `StyledTextSegment` objects with `characters`, `start`, `end`, and requested properties
  - **Use case:** Efficiently retrieve which styles apply to which character ranges
  - **Example:** Text "**hello** world" returns 2 segments (bold vs regular)
  - **Doc URL:** https://www.figma.com/plugin-docs/api/properties/TextNode-getstyledtextsegments

### Font Loading Requirements ✓ CRITICAL
- **`figma.loadFontAsync(fontName)`** — MUST be called before modifying text properties that affect layout
- **Required for:** Setting `characters`, `fontSize`, `fontName`, `textCase`, `textDecoration`, `letterSpacing`, `lineHeight`, and all `setRange*` methods
- **NOT required for:** Color/fill changes (`fills`, `fillStyleId`, `strokes`)
- **Missing fonts:** Check `textNode.hasMissingFont` before loading (common in real-world usage)
- **Font availability:** Only loads fonts accessible in Figma editor (local fonts, org fonts, Figma defaults) — NOT web fonts or external URLs
- **Performance note:** Result is cached; safe to call multiple times, but avoid in tight loops due to Promise event loop overhead
- **Doc URLs:**
  - https://www.figma.com/plugin-docs/api/properties/figma-loadfontasync
  - https://www.figma.com/plugin-docs/working-with-text

### Range-Based Text Manipulation
- **Get/Set by range:** `getRangeFontSize(start, end)`, `setRangeFontSize(start, end, value)`
- **Available for:** fontSize, fontName, textCase, textDecoration, letterSpacing, lineHeight, fills, hyperlink, textStyleId, listOptions
- **Font loading:** Required for all `setRange*` methods that affect layout
- **Doc URL:** https://www.figma.com/plugin-docs/api/TextNode

---

## 3. Vector APIs

### Vector Representation
- **`vectorNetwork`** — Complete graph-based representation (vertices + edges)
  - Type: `VectorNetwork` object
  - Read-only in dynamic-page mode; use `setVectorNetworkAsync()` to update
- **`vectorPaths`** — Simpler path-based representation (incomplete but easier to use)
  - Type: `VectorPaths` (array of path strings)
- **`handleMirroring`** — Controls whether handles are mirrored or independent
- **Doc URL:** https://www.figma.com/plugin-docs/api/VectorNode

### Position Behavior
- **Note:** Vector position/size auto-adjusts to fit vertices
- **Implication:** Setting `vectorPaths` may result in different read-back values due to automatic repositioning
- **Doc URL:** https://www.figma.com/plugin-docs/api/VectorNode

---

## 4. Image & Export APIs

### Image Detection
- **`isAsset`** ✓ Confirmed heuristic property
  - Type: `boolean` (readonly)
  - Definition: Figma's heuristic detection — true if node is icon (small vector) or raster image
  - **Use case:** Code generation plugins to identify assets
  - **Doc URL:** https://www.figma.com/plugin-docs/api/FrameNode (in base properties section)

### Export APIs
- **Direct URL not found** — `figma-exportasync` and `ExportMixin` returned 404
- **Inference:** Export methods exist but not documented at expected URLs
- **Likely location:** Check node-properties or individual node type docs for `exportAsync()` or `exportSettings`
- **Doc URL:** https://www.figma.com/plugin-docs/api/properties/nodes-exportasync (404 — needs alternate path)

---

## 5. Components, Variants & Instances

### Component Node ✓ Confirmed
- **`createInstance()`** — Creates new instance of component
- **`getInstancesAsync()`** — Returns array of all instances in document (async; replaces deprecated `instances` property)
- **`key`** — Unique key for importing via `figma.importComponentByKeyAsync()`
- **`remote`** — Boolean indicating if component is from team library (read-only if true)
- **Component properties:** `componentPropertyDefinitions`, `addComponentProperty()`
- **Doc URL:** https://www.figma.com/plugin-docs/api/ComponentNode

### Instance Node ✓ Confirmed
- **`getMainComponentAsync()`** — Returns the source ComponentNode (async)
- **`mainComponent`** — Synchronous version (write-only in dynamic-page mode)
- **`swapComponent(componentNode)`** — Swaps main component while preserving overrides
- **`componentProperties`** — Read-only object of current property values (excludes SLOT type)
- **`setProperties({propertyName: value})`** — Batch update component properties
- **`detachInstance()`** — Converts instance to FrameNode
- **`scaleFactor`** — Scale applied to instance
- **`exposedInstances`** — Array of nested instances exposed to this level
- **`isExposedInstance`** — Whether instance is exposed to containing component
- **`overrides`** — Array of directly overridden fields (not inherited)
- **`removeOverrides()`** — Clears all direct overrides
- **Doc URL:** https://www.figma.com/plugin-docs/api/InstanceNode

### Component Properties
- **Types:** `'BOOLEAN'`, `'TEXT'`, `'INSTANCE_SWAP'`, `'VARIANT'`, `'SLOT'`
- **Setting:** `setProperties()` on instances (SLOT not supported, throws error)
- **Defining:** `addComponentProperty()` on components
- **Variable binding:** Can bind properties to variables via `boundVariables.componentProperties`
- **Doc URLs:**
  - https://www.figma.com/plugin-docs/api/ComponentNode
  - https://www.figma.com/plugin-docs/api/InstanceNode

### Variant Properties (Component Sets)
- **Need confirmation:** ComponentSetNode docs not yet fetched
- **Expected:** `variantProperties` for filtering variants, `componentPropertyDefinitions` for variant options
- **Status:** Requires additional fetch

---

## 6. Traversal & Multi-Selection

### Standard Traversal Methods
- **`findAll(callback?)`** — Searches entire subtree (depth-first)
- **`findOne(callback)`** — Finds first matching node in subtree
- **`findChildren(callback?)`** — Searches immediate children only
- **`findChild(callback)`** — Finds first matching immediate child
- **Order:** Back-to-front (parents before children, pre-order traversal)
- **Dynamic-page mode:** Must call `loadAsync()` on PageNode before using traversal
- **Doc URL:** https://www.figma.com/plugin-docs/api/FrameNode (children mixin section)

### High-Performance Traversal ✓ HIGH-VALUE
- **`findAllWithCriteria<T>(criteria)`** — Type-safe, optimized search
  - **Criteria options:**
    - `types`: Array of NodeType strings (e.g., `['TEXT', 'COMPONENT']`)
    - `pluginData.keys`: Search by plugin data keys
    - `sharedPluginData.namespace` + `keys`: Search by shared data
  - **Return type:** Narrowly typed to match `types` filter (e.g., returns `TextNode[]` for `{types: ['TEXT']}`)
  - **Performance:** "Hundreds of times faster" in large documents when combined with `skipInvisibleInstanceChildren`
  - **Order:** Pre-order traversal (back-to-front, parents before children)
  - **Doc URL:** https://www.figma.com/plugin-docs/api/properties/nodes-findallwithcriteria

### Performance Optimization ✓ CRITICAL
- **`figma.skipInvisibleInstanceChildren`** — Boolean flag (default: true in Dev Mode, false elsewhere)
  - **Effect:** Skips invisible nodes inside instances during traversal
  - **Speedup:** Makes `findAll()` "several times faster", `findAllWithCriteria()` "hundreds of times faster"
  - **Trade-off:** Cannot access invisible instance children (returns null, throws on property access)
  - **Use case:** Plugins that don't need invisible nodes should always enable this
  - **Doc URL:** https://www.figma.com/plugin-docs/api/properties/figma-skipinvisibleinstancechildren

### Multi-Selection
- **Access via:** `figma.currentPage.selection` (array of selected SceneNodes)
- **Not explicitly documented in fetched pages** — needs confirmation from global objects docs

---

## 7. Code Generation Support

### CSS Export ✓ Confirmed
- **`getCSSAsync()`** — Returns computed CSS properties as JSON object
- **Definition:** Same CSS shown in Figma's Inspect panel
- **Use case:** Code generation plugins
- **Supported on:** All major node types (Frame, Component, Instance, Text, Vector, etc.)
- **Doc URL:** https://www.figma.com/plugin-docs/api/FrameNode (base node properties section)

---

## 8. Unused High-Value Capabilities

### Potentially Underutilized in figma-to-code Skill:

1. **`getStyledTextSegments()`** — Handles mixed text styles efficiently (bold, italic, colored segments)
   - Current extraction may not fully leverage this for per-segment styling

2. **`findAllWithCriteria()` + `skipInvisibleInstanceChildren`** — Performance optimization for large docs
   - Could significantly speed up traversal in complex Figma files with many instances

3. **`absoluteRenderBounds` vs `absoluteBoundingBox`** — Render bounds include effects
   - Important for accurate spacing calculation when shadows/strokes are present

4. **`getRangeAllFontNames(start, end)`** — Gets all fonts in a text range
   - Useful for preloading all fonts before batch text manipulation

5. **`isAsset` heuristic** — Automatic detection of icons vs layout elements
   - Could inform code generation decisions (e.g., treat as `<img>` vs layout div)

6. **`isExposedInstance` + `exposedInstances`** — Nested instance exposure
   - Relevant for component property propagation in design systems

7. **Instance override tracking** — `overrides` property lists modified fields
   - Could optimize extraction by only processing overridden properties

---

## 9. API Gaps & 404s

### URLs That Returned 404:
- `https://www.figma.com/plugin-docs/api/properties/nodes-autolayout`
- `https://www.figma.com/plugin-docs/api/properties/nodes-absoluteboundingbox`
- `https://www.figma.com/plugin-docs/api/properties/figma-exportasync`
- `https://www.figma.com/plugin-docs/api/ExportMixin`
- `https://www.figma.com/plugin-docs/api/LayoutMixin`
- `https://www.figma.com/plugin-docs/api/properties/nodes-absolutetransform`

### Confirmed Locations:
- Layout properties: Documented within node-specific pages (FrameNode, ComponentNode, etc.)
- Absolute positioning: Documented in aggregated node-properties page
- Export: Likely at `nodes-exportasync` or within individual node pages

---

## 10. Summary & Recommendations

### Confirmed Core APIs:
✓ Text APIs with mixed style support (`getStyledTextSegments`)  
✓ Font loading requirements (`loadFontAsync`, `hasMissingFont`)  
✓ Absolute positioning (`absoluteBoundingBox`, `absoluteRenderBounds`, `absoluteTransform`)  
✓ Constraints system  
✓ Component/Instance semantics (`getMainComponentAsync`, `componentProperties`, `swapComponent`)  
✓ High-performance traversal (`findAllWithCriteria`, `skipInvisibleInstanceChildren`)  
✓ Vector APIs (`vectorNetwork`, `vectorPaths`)  
✓ CSS export (`getCSSAsync`)  

### Recommended Enhancements for figma-to-code:
1. **Enable `figma.skipInvisibleInstanceChildren = true`** for faster extraction in large files
2. **Use `getStyledTextSegments()` instead of manual range queries** for text with mixed styles
3. **Use `absoluteRenderBounds` when effects are present** to capture true visual bounds
4. **Leverage `findAllWithCriteria({types: [...]})` for type-filtered searches** (faster + type-safe)
5. **Check `isAsset` heuristic** to classify icons vs layout elements in code generation
6. **Batch font loading** with `Promise.all(fonts.map(figma.loadFontAsync))` for multi-font text nodes

### Further Research Needed:
- ComponentSetNode variant properties (fetch ComponentSetNode docs)
- Export API methods (alternate doc path for `exportAsync`, `exportSettings`)
- Auto-layout detailed properties (may be embedded in FrameNode docs)
- Multi-selection explicit API (`figma.currentPage.selection`)

---

**Research Completed:** 2024  
**Official Docs Base:** https://www.figma.com/plugin-docs/  
**Primary API Entry Point:** `https://www.figma.com/plugin-docs/api/api-overview`
