# Figma-to-Code Implementation Audit

**Audit Date:** 2024  
**Implementation Version:** v2 (extraction schema)  
**Audit Scope:** SKILL.md → README.md → bridge.mjs → plugin/code.js → plugin/ui.html → scripts/bridge_client.mjs → scripts/query.mjs → scripts/validate.mjs → references/*

---

## Executive Summary

The figma-to-code skill implements a local plugin-bridge-CLI architecture for extracting Figma design data and translating it to production frontend code. The implementation supports **single and multi-node extraction**, **asset export** (SVG/PNG/images/vectors/screenshots), and **query-based data access** to manage payload size. The workflow is structured into 7 phases (connect → extract → HTML golden reference → validate → convert → acceptance → cleanup) with mandatory user confirmation gates.

**Key Strengths:**
- Clean separation of concerns (plugin ↔ bridge ↔ CLI)
- Pruned query system prevents full extraction.json reads (50-300 lines vs 30K+)
- Multi-select support via virtual group aggregation
- Layered validation (pattern scan + visual diff + style comparison)

**Key Limitations:**
- **No incremental extraction** — each extraction is full-tree from selected node
- **No change detection** — cache check is file-existence only, no timestamp/hash comparison
- **Partial variable support** — reads Figma variables but only exports flat definitions (no mode handling)
- **Component semantics limited** — tracks mainComponent reference but not slot/override structure
- **No subtree-level asset skipping** — assets exported for entire subtree, not per-node granularity

---

## 1. Capability Boundary (Confirmed Facts)

### 1.1 Extraction Scope
**Supported:**
- Single node extraction via Figma URL (`bridge.mjs:250-288`, `plugin/code.js:930-951`)
- Multi-node selection extraction (`plugin/code.js:729-805`, creates `VIRTUAL_GROUP` root with recalculated child positions relative to union bounding box)
- Recursive tree traversal with 50-level depth limit (`plugin/code.js:590`)
- Frame screenshot export (walks up to nearest FRAME/COMPONENT parent) (`plugin/code.js:629-647`)
- Asset export: SVG/PNG@2x for selected node (`plugin/code.js:605-627`)
- Image fill export (up to imageHash limit) (`plugin/code.js:820-849`)
- Vector node export (VECTOR/BOOLEAN_OPERATION/STAR/LINE/ELLIPSE/POLYGON, max 50 vectors) (`plugin/code.js:851-895`)

**Not Supported:**
- Incremental extraction (no diff from previous extraction)
- Subtree-only extraction without re-extracting siblings
- Page-level or file-level extraction (must select specific node)
- Style library extraction (reads styleId references but doesn't export style definitions)

### 1.2 Extraction Timeout
**Hard limit:** 60 seconds (`bridge.mjs:13`, job timer set at line 99-104)  
**Failure mode:** Large designs (100+ nodes mentioned in README.md:142) may timeout  
**Recommendation from docs:** Select smaller subtree (`SKILL.md:91`)

### 1.3 Multi-Select Behavior
**Confirmed:** Plugin supports multi-select (`plugin/code.js:953-981`)  
- Creates `VIRTUAL_GROUP` node with `meta.isMultiSelect: true` and `meta.selectedNodeCount: N` (`plugin/code.js:789-791`)
- Bounding box = union of all selected nodes (`plugin/code.js:673-692`)
- Child positions recalculated relative to virtual root origin (`plugin/code.js:748-754`)
- Limitation: No screenshot for multi-select (uses first selected node as screenshot source) (`plugin/code.js:974`)

### 1.4 Cache Strategy
**Cache location:** `<skill>/cache/<fileKey>/<nodeId>/` (`bridge.mjs:129-135`)  
- `:` in nodeId replaced with `-` for filesystem compatibility (`bridge.mjs:42`)
- When fileKey unavailable (selection mode), uses `unknown-file` (`bridge.mjs:138`)

**Cache persistence:** Files written but **never read by bridge** — cache check delegated to caller (`SKILL.md:72`)  
- No timestamp comparison
- No hash-based invalidation
- No TTL expiration
- Cache is write-only for bridge, read-only for query scripts

**Cache check logic:** Documented in `SKILL.md:72-73` as "check if extraction.json already exists" but **not implemented in bridge.mjs** — this is a manual caller responsibility.

---

## 2. Extraction Schema Coverage

### 2.1 Layout Properties (Full Support)
**Source:** `plugin/code.js:247-326` (`mapLayout` function)

| Figma Property | Extracted | Query Output | Notes |
|----------------|-----------|--------------|-------|
| `x, y, width, height` | ✅ | `box.w`, `box.h`, `box.x`, `box.y` | Rounded to 3 decimals |
| `absoluteBoundingBox` | ✅ | `box.absoluteBox` | Full |
| `absoluteRenderBounds` | ✅ | `box.renderBounds` | Full |
| `layoutMode` (HORIZONTAL/VERTICAL) | ✅ | `box.display: "flex"`, `box.dir: "column"/"row"` | Mapped to flexbox |
| `layoutWrap` | ✅ | `box.wrap: "wrap"` | Only if enabled |
| `primaryAxisAlignItems` | ✅ | `box.justify` | Mapped to CSS values (`flex-start`, `center`, `space-between`, etc.) |
| `counterAxisAlignItems` | ✅ | `box.align` | Mapped to CSS values |
| `itemSpacing` | ✅ | `box.gap` | Omitted if 0 |
| `counterAxisSpacing` | ✅ | `box.columnGap` | Only in wrap layouts |
| `paddingTop/Right/Bottom/Left` | ✅ | `box.pad: N` or `[t,r,b,l]` | Uniform if all sides equal |
| `primaryAxisSizingMode` | ✅ | `box.widthSizing` / `box.heightSizing` | `"hug"` or `"fixed"` |
| `counterAxisSizingMode` | ✅ | Same | Same |
| `layoutSizingHorizontal/Vertical` | ✅ | `box.widthSizing` / `box.heightSizing` | Overrides axis-based sizing |
| `layoutAlign` | ✅ | `box.layoutAlign` | e.g., `STRETCH` |
| `layoutGrow` | ✅ | `box.layoutGrow` | Only if > 0 |
| `layoutPositioning` | ✅ | `box.positioning` | `ABSOLUTE` supported |
| `clipsContent` | ✅ | `box.overflow: "hidden"` | Only if true |
| `constraints` | ✅ | `box.constraints: {horizontal, vertical}` | Full |
| `minWidth/maxWidth/minHeight/maxHeight` | ✅ | `box.minW/maxW/minH/maxH` | Only if set |

**Pruning logic:** `query.mjs:74-109` (`pruneBox`)  
- Omits `box` entirely if empty
- Omits default values (e.g., `justify: flex-start`, `align: stretch`, `gap: 0`)
- Collapses uniform padding to single value

### 2.2 Style Properties (Full Support for Basic Styles)
**Source:** `plugin/code.js:332-379` (`mapStyle` function)

| Figma Property | Extracted | Query Output | Notes |
|----------------|-----------|--------------|-------|
| `fills` (SOLID) | ✅ | `style.bg: "#hex"` | Only first visible solid fill |
| `fills` (GRADIENT) | ✅ | `style.gradient: {type, stops}` | Full gradient data |
| `fills` (IMAGE) | ✅ | `style.bgImage: "hash"`, `style.bgImageFile: "assets/hash.png"` | Hash + file reference |
| `strokes` | ✅ | `style.borderColor: "#hex"` | Only first visible solid stroke |
| `strokeWeight` | ✅ | `style.borderWidth: N` | Uniform |
| `strokeTopWeight` (individual) | ✅ | `style.borderWidthPerSide: {top, right, bottom, left}` | Per-side |
| `strokeAlign` | ✅ | `style.borderAlign` | `CENTER`, `INSIDE`, `OUTSIDE` |
| `dashPattern` | ✅ | `style.borderStyle: "dashed"` | Only if non-empty array |
| `cornerRadius` | ✅ | `style.radius: N` or `[tl, tr, br, bl]` | Uniform or per-corner |
| `cornerSmoothing` | ✅ | `style.cornerSmoothing: N` | iOS-style smoothing |
| `effects` (DROP_SHADOW) | ✅ | `style.shadow: {x, y, blur, spread, color}` | Single or array |
| `effects` (BACKGROUND_BLUR) | ✅ | `style.blur: N` | Radius |
| `opacity` | ✅ | `style.opacity: N` | Only if ≠ 1 |
| `blendMode` | ✅ | `style.blendMode` | String |
| `fillStyleId` | ✅ | `style.fillStyleId` | Reference only, not resolved |
| `strokeStyleId` | ✅ | `style.strokeStyleId` | Reference only |
| `effectStyleId` | ✅ | `style.effectStyleId` | Reference only |

**Limitation:** Style IDs are stored but **not resolved to style definitions**. The plugin does not fetch style objects via `figma.getStyleByIdAsync`.

**Pruning logic:** `query.mjs:111-171` (`pruneStyle`)  
- Omits empty objects
- Collapses single shadow to object (not array)
- Prefers hex color over full rgba object

### 2.3 Text Properties (Full Support)
**Source:** `plugin/code.js:386-400` (`mapTextNode`), `plugin/code.js:177-210` (`serializeTextSegments`)

| Figma Property | Extracted | Query Output | Notes |
|----------------|-----------|--------------|-------|
| `characters` | ✅ | `text.text` | Full string |
| `fontName` | ✅ | `text.font: "family"` | Family only (style → weight mapping) |
| `fontSize` | ✅ | `text.size: N` | Number |
| `fontWeight` | ✅ | `text.weight: N` | Inferred from `fontName.style` |
| `lineHeight` | ✅ | `text.lh: "N%" or "Npx"` | Unit-aware |
| `letterSpacing` | ✅ | `text.ls: "Nem" or "Npx"` | Unit-aware |
| `textAlignHorizontal` | ✅ | `text.align: "left"/"center"/"right"` | Lowercase, omitted if `LEFT` |
| `textAlignVertical` | ✅ | Stored but not in query output | |
| `textAutoResize` | ✅ | Stored but not in query output | |
| `textCase` | ✅ | `text.case: "uppercase"` | Omitted if `ORIGINAL` |
| `textDecoration` | ✅ | Stored but not in query output | |
| `segments` (styled) | ✅ | `text.segments: [{text, color, font, size, weight}]` | Only if style differs across segments |
| `fills` (text color) | ✅ | `text.color: "#hex"` | From first segment or node fills |

**Multi-segment handling:** `query.mjs:213-233` detects style differences across segments and outputs per-segment styling only if needed.

### 2.4 Vector Properties (Partial Support)
**Source:** `plugin/code.js:406-421` (`mapVector`)

| Figma Property | Extracted | Exported | Notes |
|----------------|-----------|----------|-------|
| `fillGeometry` | ✅ (if ≤ 8 paths) | No | Count stored, full data only if small |
| `strokeGeometry` | ✅ (if ≤ 8 paths) | No | Same |
| `vectorPaths` | ✅ (if ≤ 8 paths) | No | Same |
| Vector SVG export | ✅ | Yes | Up to 50 vectors exported as SVG (`plugin/code.js:851-895`) |

**Limitation:** Vector path data stored in extraction.json but **not exposed via query commands**. Only SVG file exports are practical output.

### 2.5 Component Properties (Partial Support)
**Source:** `plugin/code.js:427-455` (`mapComponent`)

| Figma Property | Extracted | Query Output | Resolved? |
|----------------|-----------|--------------|-----------|
| `componentProperties` | ✅ | `component.properties: {key: {type, value}}` | Type + current value only |
| `variantProperties` | ✅ | `component.variantProperties: {...}` | Key-value pairs |
| `mainComponent` (for INSTANCE) | ✅ | `component.mainComponent: {id, name, key}` | Async resolved |

**Limitations:**
- **No component set metadata** — doesn't track parent component set for variants
- **No slot/override structure** — doesn't serialize nested instance overrides
- **No exposed instances** — doesn't track where a component is used
- **Properties are current values only** — doesn't expose available options for boolean/instance-swap properties

**Gap:** Component semantics are shallow. Plugin extracts just enough to identify "this is an instance of X" but not enough to reconstruct component architecture or generate variant-aware code.

### 2.6 Variable Support (Partial)
**Source:** `plugin/code.js:459-523` (`resolveVariableCache`, `buildVariablesDefs`)

**Variable binding extraction:**
- Reads `boundVariables` from nodes (`plugin/code.js:584-586`)
- Reads `inferredVariables` (`plugin/code.js:587-588`)
- Resolves variable IDs to names via `figma.variables.getVariableByIdAsync` (`plugin/code.js:482-488`)
- Fetches variable collections via `figma.variables.getVariableCollectionByIdAsync` (`plugin/code.js:501-505`)

**Variable definition export:**
- Extracts default mode values only (`plugin/code.js:509`)
- Generates flat CSS custom property names (`--family-name-variable-name`) (`plugin/code.js:499`)
- Supports COLOR → hex, FLOAT → number, STRING, BOOLEAN (`plugin/code.js:511-520`)

**Stored structure:**
```json
{
  "variables": {
    "flat": {
      "colors": { "--color-primary": "#ff5733" },
      "numbers": { "--spacing-md": 16 },
      "strings": { "--font-family-body": "Inter" },
      "booleans": { "--feature-flag": true }
    }
  }
}
```

**Limitations:**
- **No mode handling** — only `defaultModeId` values exported, ignores dark mode / responsive modes
- **No semantic grouping** — flattens all variables to single namespace
- **No scoped variables** — doesn't track variable scope (file/local)
- **No alias resolution in output** — `VARIABLE_ALIAS` types recorded but not expanded in flat definitions
- **Not exposed via query commands** — variables stored in extraction.json but `query.mjs` has **no `variables` subcommand**

**Gap:** Variables are extracted but under-utilized. The golden HTML workflow (Phase 3) uses `query palette` to deduplicate colors/fonts from **computed styles**, not from Figma variables.

### 2.7 Resource Aggregation
**Source:** `plugin/code.js:529-552` (`registerResources`)

**Extracted:**
- `nodeTypes: {FRAME: 10, TEXT: 45, ...}` — node type histogram
- `fonts: [{family, style, count}]` — deduplicated font usage
- `images: [hash1, hash2, ...]` — unique imageHash list (drives image fill export)

**Purpose:** Summary statistics for extraction report (`SKILL.md:95-99`) and asset export triggers.

---

## 3. Query Granularity

### 3.1 Query Commands (Source: `query.mjs:515-573`)

| Command | Input | Output | Use Case |
|---------|-------|--------|----------|
| `tree` | `--frame <name> --depth <N>` | Hierarchical tree with `{name, type, size, layout, childCount}` | Section breakdown, skeleton navigation |
| `tree` (no frame) | `--depth <N>` | List of all top-level frames with `{name, type, size, nodes: count}` | Frame discovery |
| `node` | `<nodeId>` | Single node with `box`, `style`, `text`, `component` (shallow, no children) | Quick property lookup |
| `subtree` | `<nodeId>` | Full recursive subtree with all children | Component implementation |
| `text` | `--frame <name>` | Flattened list of all TEXT nodes with `{id, section, text, font, size, color}` | Copy extraction, typography audit |
| `palette` | `--frame <name>` | Deduplicated `{colors, fonts, spacings, borders}` with usage counts | Design token generation |

**Confirmed:** Query commands are the **only documented way** to read extraction data (`SKILL.md:28`, `SKILL.md:164`). Direct reading of `extraction.json` is explicitly discouraged.

### 3.2 Query Pruning Strategy (Source: `query.mjs:5-287`)

**Pruning reduces payload by:**
1. **Omitting default values** — `opacity: 1`, `gap: 0`, `justify: flex-start`, etc. (`query.mjs:81-96`)
2. **Collapsing uniform values** — `padding: [20,20,20,20]` → `pad: 20` (`query.mjs:31-37`)
3. **Color simplification** — `{r: 1, g: 0.2, b: 0.2, a: 1, rgba: "...", hex: "#ff3333"}` → `"#ff3333"` (`query.mjs:7-14`)
4. **Shallow children in tree mode** — only `{id, name, type}` for grandchildren (`query.mjs:282-285`)
5. **Visibility filtering** — invisible nodes excluded entirely (`query.mjs:246-247`)

**Result:** Typical subtree output is 50-300 lines vs 30K+ for full extraction.json (`README.md:103-104`)

### 3.3 Granularity Limitations

**No node-level filtering:**
- Can't query "all buttons" or "all images"
- Can't filter by nodeType in query command
- Must parse tree manually to find specific node types

**No property subsetting:**
- Can't request "only layout properties, skip styles"
- Always returns full pruned node (box + style + text + component)

**No pagination:**
- Large subtrees returned in single JSON blob
- No cursor-based or offset-based pagination

**No incremental updates:**
- Re-running extraction produces identical output if design unchanged
- No delta extraction for modified nodes

---

## 4. Error Model

### 4.1 Bridge-Level Errors (Source: `bridge.mjs:250-316`)

| Error Code | HTTP Status | Trigger | Client Impact |
|------------|-------------|---------|---------------|
| `NO_PLUGIN_CONNECTION` | 503 | No SSE clients connected | User must launch plugin in Figma Desktop |
| `missing input field` | 400 | POST body missing `input` | CLI argument validation failure |
| `body too large (max 50MB)` | — | Request body > 50MB | Request destroyed, error thrown |
| `extraction timeout after 60000ms` | 504 | Plugin doesn't respond within 60s | Large design, select smaller subtree |
| `extraction failed: <message>` | 504 | Plugin returns error in result | Varies (node not found, export failure, etc.) |
| `job not found or already resolved` | 404 | Duplicate result POST for same jobId | Plugin re-sent result (should be idempotent) |

**Bridge error handling:**
- Errors in job promise rejected → `safeSendJson` wraps in `{ok: false, error: "..."}` (`bridge.mjs:286`)
- Plugin errors forwarded verbatim in result payload (`plugin/code.js:812-814`)

### 4.2 Plugin-Level Errors (Source: `plugin/code.js:808-980`)

| Error Message | Cause | Recovery |
|---------------|-------|----------|
| `missing nodeId in extract target` | Bridge sent malformed job | Bridge bug |
| `node not found: <id>` | Invalid nodeId or file not open in Figma | User must open correct file |
| `Figma 中没有选中任何元素` | extract-selection called with empty selection | User must select node first |
| `export may fail for some node types` | `node.exportAsync()` throws (e.g., SLICE nodes) | Graceful skip, asset not exported |
| `image export may fail for some hashes` | `imageData.getBytesAsync()` fails | Graceful skip, image not exported |
| `vector export may fail` | SVG export fails for specific vector | Graceful skip, vector not exported |

**Plugin error handling:**
- All async errors caught and wrapped in `{error: message}` payload (`plugin/code.js:812-814`)
- Status posted to UI via `postToUi('status', {text, state: 'error'})` (`plugin/code.js:814`)
- Partial failures (asset export) logged but don't fail extraction

**No retry logic:** Bridge and plugin both fail-fast. CLI must implement retry if needed.

### 4.3 Query-Level Errors (Source: `query.mjs:481-504`)

| Error Message | Cause | Recovery |
|---------------|-------|----------|
| `Missing --cache <cacheDir> argument` | CLI invocation missing `--cache` flag | Add flag |
| `extraction.json not found in <dir>` | Invalid cache directory or extraction failed | Re-run extraction |
| `Failed to parse extraction.json: <error>` | Corrupted JSON file | Re-run extraction |
| `No root node in extraction data` | Malformed extraction (shouldn't happen) | Re-run extraction |
| `Frame "<name>" not found. Available: <list>` | User typo or frame name changed | Use correct name from list |
| `Node "<nodeId>" not found` | Invalid nodeId or node not in subtree | Check tree output for valid IDs |

**Query errors are fatal:** Return `{ok: false, error: "..."}` and exit with code 1 (`bridge_client.mjs:74`).

### 4.4 Validation Script Errors (Source: `validate.mjs:425-502`)

| Error | Cause | Recovery |
|-------|-------|----------|
| `Reference file not found` | Path invalid | Fix path |
| `Target file not found` | Path invalid | Fix path |
| `puppeteer is not installed` | Missing npm dependency | `npm install -g puppeteer` |
| `Failed to launch headless Chrome` | Chromium not downloaded | `npx puppeteer browsers install chrome` |
| `networkidle0` timeout (30s) | Page load stalled | Check if dev server is running, reduce page complexity |

**Partial failures:**
- Zero matched nodes → warns but outputs result (`validate.mjs:324-325`)
- Zero reference nodes → warns but outputs result (`validate.mjs:322-323`)

---

## 5. Performance Characteristics

### 5.1 Extraction Performance

**Bottlenecks:**
1. **Figma Plugin API** — recursive tree walk with async `serializeNode` (`plugin/code.js:558-599`)
   - Each node: read 50+ properties, resolve variables, serialize to JSON
   - 100 nodes ≈ 100 async function calls
2. **Asset Export** — `node.exportAsync()` is slow for large images/vectors
   - Image fills: up to `imageHashes.length` exports (`plugin/code.js:821-848`)
   - Vectors: up to 50 exports (`plugin/code.js:851-895`)
   - Screenshot: 1 full-frame PNG export (`plugin/code.js:629-647`)
3. **Variable Resolution** — fetches variable definitions via async API (`plugin/code.js:482-488`)

**Observed:** README.md:142 mentions "Large designs (100+ nodes) may take longer" and recommends selecting smaller subtrees. No profiling data in source.

**60s timeout justification:** Allows ~1s per 100 nodes + asset export time.

### 5.2 Query Performance

**File I/O:**
- Single `readFileSync` of extraction.json (`query.mjs:495`)
- JSON.parse of potentially large file (no streaming)
- All queries read full file, then filter in memory

**Pruning cost:**
- Recursive tree walk to prune nodes (`query.mjs:243-287`)
- O(N) where N = node count in subtree

**Palette aggregation:**
- Recursive walk to collect colors/fonts/spacings (`query.mjs:383-447`)
- Map-based deduplication (O(N))

**No caching:** Query scripts re-read extraction.json on every invocation. No in-memory cache or query result caching.

### 5.3 Validation Performance

**Visual diff (`visual-diff.mjs`):**
1. Launch Puppeteer (1-2s cold start)
2. Load HTML page, wait for `networkidle0` (0.5-5s depending on page)
3. Screenshot full page at 2x DPR (0.5-2s depending on dimensions)
4. Load design screenshot with Sharp (0.1s)
5. Resize/pad images to match (0.2-1s)
6. Pixelmatch full-image comparison (0.5-3s for 1280×1920@2x = 5M pixels)

**Estimated total:** 3-15 seconds per validation run

**Region-based diff:** Adds per-region crop + pixelmatch (marginal cost, already doing full diff)

**Style validation (`validate.mjs`):**
1. Launch Puppeteer (1-2s)
2. Load both pages in parallel (1-5s total)
3. Extract text nodes via page.evaluate (0.1-0.5s per page)
4. Match nodes via text similarity + position (O(N²) worst case, typically fast for <100 nodes)
5. Compare styles (O(N × 30 properties) ≈ 0.1-1s)

**Estimated total:** 2-10 seconds per validation run

**Pattern scan (`pattern-scan.mjs`):**
- `readFileSync` + regex scan over HTML lines
- O(lines × patterns) ≈ <100ms for typical HTML files

---

## 6. Protocol: Plugin ↔ UI ↔ Bridge

### 6.1 SSE Protocol (Bridge → Plugin UI)

**Connection:** `plugin/ui.html:69-112` connects to `http://localhost:3333/events`  
**Events sent by bridge:**

| Event Name | Payload | Handler |
|------------|---------|---------|
| `ready` | `{}` | UI displays "Bridge SSE 已连接" (green) |
| `extract` | `{jobId, target: {input, fileKey, nodeId}, options}` | Forwards to plugin via `postMessage` |
| `extract-selection` | `{jobId, options}` | Forwards to plugin via `postMessage` |

**Keepalive:** Bridge sends `: keepalive\n\n` every 30s (`bridge.mjs:57-59`)

**Error handling:**
- `eventSource.onerror` → UI displays "Bridge SSE 已断开" (red) (`plugin/ui.html:109-111`)
- No automatic reconnection (user must click "重连 SSE" button) (`plugin/ui.html:114-116`)

### 6.2 Plugin → UI Protocol (Figma Plugin → UI HTML)

**Message types (UI receives):**

| Type | Data | Purpose |
|------|------|---------|
| `status` | `{text, state: "working"/"ok"/"error"}` | Progress updates displayed in UI card |
| `post-result` | `{jobId, data: extraction}` | Triggers HTTP POST to `/jobs/{jobId}/result` |
| `post-asset` | `{jobId, data: {base64, format, fileName, ...}}` | Triggers HTTP POST to `/jobs/{jobId}/asset` |

**Implementation:** `plugin/code.js:49-58` (`postToUi` helper)

### 6.3 UI → Bridge Protocol (Plugin UI → Bridge HTTP)

**Endpoints:**

| Method | Path | Body | Response |
|--------|------|------|----------|
| POST | `/jobs/{jobId}/result` | `{...extraction, error?: string}` | `{ok: true}` or 404 |
| POST | `/jobs/{jobId}/asset` | `{base64, format, fileName, nodeId, ...}` | `{ok: true}` or 404 |

**Asset chunking:** Each asset (image/vector/screenshot) sent as separate POST to `/asset` endpoint. Bridge accumulates in `job.assets[]` array (`bridge.mjs:363`).

**Result finalization:** Plugin sends `post-result` after all assets posted. Bridge resolves job promise with `{...result, assetFiles: job.assets}` (`bridge.mjs:122`).

### 6.4 Bridge → CLI Protocol (HTTP)

**Endpoints:**

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/health` | — | `{ok: true, pluginConnected: bool, uptime: seconds}` |
| POST | `/extract` | `{input: string, options: {exportAssets, exportFormats, screenshot}}` | `{ok: true/false, cacheDir, result}` or error |
| POST | `/extract-selection` | `{options: {...}}` | Same |

**Timeout:** CLI sets 65s fetch timeout (`bridge_client.mjs:114`, `bridge_client.mjs:139`) to accommodate bridge's 60s extraction timeout.

---

## 7. Documentation vs Implementation Mismatches

### 7.1 Confirmed Matches ✅

1. **Cache directory structure** — docs (`README.md:73-80`) match implementation (`bridge.mjs:129-135`)
2. **Query command syntax** — docs (`README.md:87-101`) match implementation (`query.mjs:451-477`)
3. **Multi-select behavior** — docs (`README.md:63-69`) match implementation (`plugin/code.js:729-805`)
4. **Extraction timeout** — docs (`README.md:141-142`) match implementation (`bridge.mjs:13`)
5. **Asset export limits** — docs mention "up to 50 vectors" → code has `MAX_VECTOR_EXPORTS = 50` (`plugin/code.js:851`)

### 7.2 Documentation Gaps / Ambiguities ⚠️

1. **Variable mode handling** — docs don't mention that only defaultMode is exported (`plugin/code.js:509`)
2. **Style ID resolution** — docs don't clarify that styleId references are NOT resolved to style definitions
3. **Component properties detail** — docs don't specify that slot/override structure is not extracted
4. **Cache invalidation** — docs mention checking cache existence (`SKILL.md:72`) but don't specify invalidation rules (timestamp? hash?)
5. **Query command coverage** — README.md:87-101 documents 5 query commands but doesn't mention that `variables` subcommand is **not implemented**

### 7.3 Implementation Exceeds Docs ✨

1. **Pattern scan script** — `pattern-scan.mjs` exists but only mentioned in `SKILL.md:406` reference table, not in workflow section
2. **Visual diff regions** — `visual-diff.mjs` supports `--regions` for per-section analysis, not documented in Phase 4 workflow
3. **Asset file metadata** — Bridge returns `assetFiles[]` array with file paths (`bridge.mjs:122`), not shown in README examples

### 7.4 Implementation Under-Delivers Docs 🔻

1. **No variables query command** — Docs reference "design tokens" and "variables" (`README.md:5`, `SKILL.md:3`) but `query.mjs` has no `variables` subcommand to read extracted variable definitions
2. **Cache check is caller responsibility** — `SKILL.md:72-73` says "check if extraction.json already exists" but bridge doesn't implement this — caller must manually check filesystem

---

## 8. Unsupported / Partially Supported Areas

### 8.1 Variables ⚠️ (Partial Support)

**What's supported:**
- Extraction of `boundVariables` and `inferredVariables` from nodes
- Resolution of variable IDs to names
- Export of flat CSS custom property definitions (colors, numbers, strings, booleans)

**What's missing:**
- ❌ Mode handling (dark mode, responsive modes) — only defaultMode exported
- ❌ Semantic grouping (local vs semantic collections)
- ❌ Alias expansion in flat output (VARIABLE_ALIAS recorded but not resolved)
- ❌ Query command to read extracted variables (no `query variables` subcommand)
- ❌ Variable scoping (file-scoped vs document-scoped)
- ❌ Token file export (no Design Tokens JSON or CSS custom properties file generation)

**Impact:** Variables are extracted but under-utilized. Workflow in Phase 3 (`SKILL.md:132`) uses `query palette` to deduplicate **computed colors/fonts**, not Figma variables. If designer uses variables extensively, golden HTML won't reflect them.

**Workaround:** Manual mapping from `extraction.json → variables.flat` to CSS custom properties (not documented in workflow).

### 8.2 Styles (No Support) ❌

**Figma feature:** Styles library (Color Styles, Text Styles, Effect Styles, Layout Grid Styles)

**What's extracted:**
- Style ID references (`fillStyleId`, `strokeStyleId`, `effectStyleId`, `textStyleId`)

**What's missing:**
- ❌ Style definitions (name, description, properties)
- ❌ Style resolution via `figma.getStyleByIdAsync`
- ❌ Style usage tracking (which nodes use which styles)
- ❌ Query command to list styles

**Impact:** Can't reconstruct design system from extracted data. Style IDs are opaque strings.

**Workaround:** None. Use `query palette` to deduplicate computed values instead.

### 8.3 Design Tokens (No Support) ❌

**Figma feature:** Design Tokens plugin / Variables as tokens

**What's missing:**
- ❌ Token group hierarchy
- ❌ Token metadata (description, aliases, semantic naming)
- ❌ Token export in standard formats (Design Tokens JSON, Style Dictionary)
- ❌ Token scoping (core vs semantic)

**Impact:** Can't generate design system documentation or token files automatically.

**Workaround:** Manual token mapping using `query palette` output.

### 8.4 Component Semantics ⚠️ (Minimal Support)

**What's supported:**
- Component instance detection (`node.type === 'INSTANCE'`)
- Main component reference (`mainComponent: {id, name, key}`)
- Variant properties (current values)
- Component properties (current values)

**What's missing:**
- ❌ Component set structure (parent component for variants)
- ❌ Slot structure (nested instance overrides)
- ❌ Exposed instances (where component is used)
- ❌ Available property options (e.g., boolean property accepts true/false, instance-swap accepts components X/Y/Z)
- ❌ Default component state (what are default property values?)
- ❌ Nested override tracking (overridden text/fills in nested instances)

**Impact:** Can identify "this is an instance of Button" but can't generate variant-aware component code (e.g., `<Button variant="primary" size="large">`).

**Workaround:** Manual component mapping using `name` field pattern matching (e.g., "Button/Primary/Large" → parse variant).

### 8.5 Multi-Select Extraction ⚠️ (Partial Support)

**What's supported:**
- Virtual group aggregation of multiple selected nodes
- Bounding box union
- Position recalculation relative to virtual root
- Metadata (`meta.isMultiSelect`, `meta.selectedNodeCount`)

**What's missing:**
- ❌ Screenshot of multi-select (uses first node's parent frame) — README.md:69 says "each child's position is recalculated" but doesn't mention screenshot limitation
- ❌ Asset export for all selected nodes (exports only first node's assets) — `plugin/code.js:974` calls `exportAssetsAndPost(jobId, primaryNode, extraction, options)` with only `primaryNode`

**Impact:** Multi-select works for layout extraction but assets/screenshot may be incomplete.

### 8.6 Subtree Extraction (No Selective Support) ❌

**What's supported:**
- Recursive full-tree extraction from selected root node

**What's missing:**
- ❌ Skip specific subtrees during extraction (e.g., "extract this frame but skip the sidebar subtree")
- ❌ Include only specific node types (e.g., "extract only TEXT nodes")
- ❌ Depth limit during extraction (depth limit exists in `query tree` but not in extraction)

**Impact:** Large designs force full-tree extraction even if only small portion needed. Timeout risk.

**Workaround:** User must manually select smaller subtree in Figma before extracting.

### 8.7 Incremental Extraction (No Support) ❌

**What's supported:**
- Full extraction from selected node each time

**What's missing:**
- ❌ Delta extraction (only nodes changed since last extraction)
- ❌ Change detection (compare timestamp/hash to detect if re-extraction needed)
- ❌ Partial update (update only changed nodes in cached extraction)

**Impact:** Every extraction is full cost, even if design unchanged. No optimization for repeated extractions.

**Workaround:** Manual cache check by caller (check if `extraction.json` exists before running extraction) — `SKILL.md:72-73`.

### 8.8 Caching / Invalidation (Manual Only) ⚠️

**What's supported:**
- Write extraction to `cache/<fileKey>/<nodeId>/extraction.json`
- Query commands read from cache directory

**What's missing:**
- ❌ Bridge-level cache check (bridge always extracts, even if cache exists)
- ❌ Timestamp comparison (no "extract if design modified after cache timestamp")
- ❌ Hash-based invalidation (no content hash to detect design changes)
- ❌ TTL expiration (no "cache expires after 24 hours")
- ❌ Cache metadata (no `cache-info.json` with extraction timestamp, design version, etc.)

**Impact:** Caller must manually decide if re-extraction needed. No automatic invalidation logic.

**Workaround:** Manual check in `SKILL.md:72-73`:
```bash
if [ -f "cache/$fileKey/$nodeId/extraction.json" ]; then
  # Use cached data
else
  # Run extraction
fi
```

### 8.9 Validation Coverage ⚠️ (Style-Only)

**What's supported (`validate.mjs`):**
- Computed style comparison (30 CSS properties)
- Text content matching
- Color exact match (RGB channels)
- Dimension tolerance (±1px for most, ±2px for width/height)

**What's missing:**
- ❌ Layout structure validation (nesting hierarchy)
- ❌ Responsive behavior (viewport resizing)
- ❌ Interaction states (hover, focus, active)
- ❌ Animation/transition presence
- ❌ Accessibility properties (ARIA attributes, semantic HTML)
- ❌ Asset presence (image src, SVG content)

**Impact:** Validation catches style regressions but not structural/behavioral issues.

**Workaround:** Manual acceptance checklist in `references/regression-acceptance.md` (`SKILL.md:367-374`).

---

## 9. Inferred Risks / Gaps

### 9.1 Scale Risks 🔴

**Risk:** Extraction timeout on large designs  
**Evidence:** 60s timeout (`bridge.mjs:13`), README warning about 100+ nodes (`README.md:142`)  
**Impact:** Enterprise dashboards with 500+ nodes will fail  
**Mitigation:** User must select smaller subtrees (manual decomposition)

**Risk:** Memory pressure on query operations  
**Evidence:** Full extraction.json read into memory (`query.mjs:495`), no streaming  
**Impact:** 10MB+ extraction files (500+ nodes with assets) may exhaust Node.js heap on constrained systems  
**Mitigation:** None in code. Caller should ensure adequate memory.

### 9.2 Consistency Risks 🟡

**Risk:** Stale cache usage  
**Evidence:** No timestamp/hash invalidation, cache check is manual (`SKILL.md:72-73`)  
**Impact:** User may generate code from outdated extraction if design changed but cache not cleared  
**Mitigation:** Document that user must manually delete cache directory when design changes

**Risk:** Incomplete multi-select assets  
**Evidence:** `exportAssetsAndPost` called with only `primaryNode` (`plugin/code.js:974`)  
**Impact:** If user selects 3 icons for extraction, only first icon's SVG exported  
**Mitigation:** Document limitation or fix by looping over all selected nodes

### 9.3 Variable Utilization Gaps 🟡

**Risk:** Figma variables ignored in golden HTML workflow  
**Evidence:** Phase 3 uses `query palette` (computed colors) not `query variables` (which doesn't exist)  
**Impact:** Designer uses variables extensively → golden HTML hard-codes values → loses design system consistency  
**Mitigation:** Implement `query variables` command and update Phase 3 to use it

### 9.4 Component Code Generation Limits 🟡

**Risk:** Can't generate variant-aware component code  
**Evidence:** Component properties stored as flat key-value (`plugin/code.js:432-440`), no available options  
**Impact:** Instance extraction produces single hardcoded variant, not flexible component  
**Mitigation:** Phase 5 conversion step must manually infer variants from naming patterns (e.g., "Button/Primary" → `variant="primary"`)

### 9.5 Protocol Robustness 🟠

**Risk:** SSE disconnection requires manual reconnect  
**Evidence:** No auto-reconnect in `plugin/ui.html:109-111`  
**Impact:** If bridge restarts or network hiccup, user must click "重连 SSE" button  
**Mitigation:** Implement exponential backoff auto-reconnect

**Risk:** Job timeout leaves zombie jobs in bridge  
**Evidence:** Timed-out jobs removed from `pendingJobs` map but no cleanup of orphaned assets  
**Impact:** Memory leak if many timeouts  
**Mitigation:** Add periodic cleanup of old jobs (e.g., clear jobs older than 5 minutes)

### 9.6 Error Reporting Gaps 🟡

**Risk:** Asset export failures silent in extraction result  
**Evidence:** `catch (_) { /* skip */ }` in asset export loops (`plugin/code.js:624`, `plugin/code.js:847`, `plugin/code.js:893`)  
**Impact:** User expects 50 vectors, gets 30, no indication of which failed  
**Mitigation:** Track failed exports in `extraction.assets.failed = [{nodeId, error, type}]`

---

## 10. Recommended Improvements (Not Modifying Files)

### 10.1 High Priority 🔴

1. **Implement cache invalidation**
   - Add `cache-metadata.json` with `{extractedAt, designVersion, fileKey, nodeId}`
   - Bridge checks metadata timestamp before extracting (e.g., skip if < 1 hour old)
   - CLI flag `--force` to bypass cache

2. **Add `query variables` command**
   - Return `extraction.variables.flat` with optional filtering (e.g., `--type colors`)
   - Enable Phase 3 to use Figma variables instead of computed palette

3. **Fix multi-select asset export**
   - Loop over all selected nodes in `exportAssetsAndPost`, not just first node
   - Update screenshot to capture union bounding box (may require custom rendering)

4. **Improve error reporting for asset exports**
   - Track failed exports in result payload
   - Include error message and nodeId for debugging

### 10.2 Medium Priority 🟡

5. **Add variable mode support**
   - Export all modes for each variable (not just defaultMode)
   - Structure as `{variableId: {defaultMode: value, darkMode: value, ...}}`

6. **Resolve style definitions**
   - When styleId present, call `figma.getStyleByIdAsync` to get style name/description
   - Include in extraction as `styles: {styleId: {name, type, properties}}`

7. **Implement auto-reconnect for SSE**
   - Exponential backoff (1s, 2s, 4s, 8s, max 30s)
   - UI shows "Reconnecting..." state

8. **Add depth limit to extraction**
   - CLI flag `--max-depth N` to limit recursion (default 50)
   - Reduces timeout risk for very deep trees

### 10.3 Low Priority 🟢

9. **Add streaming JSON parser for query commands**
   - Use `stream-json` to parse large extraction.json without full memory load
   - Enables query on 50MB+ extractions

10. **Add component metadata extraction**
    - Fetch component set structure via `figma.getComponentSetByIdAsync` (if API available)
    - Track available property options (for variant-aware code generation)

11. **Add Design Tokens export**
    - Generate `.tokens.json` file in W3C Design Tokens format
    - Export CSS custom properties file from variables

12. **Implement incremental extraction**
    - Store per-node hash in cache metadata
    - On re-extraction, compare hashes and skip unchanged subtrees
    - Merge updated nodes into cached extraction

---

## 11. Summary of Key Findings

### Architecture Strengths ✅
- Clean plugin-bridge-CLI separation with SSE for real-time commands
- Pruned query system effectively reduces payload (50-300 lines vs 30K+)
- Multi-select support with virtual group aggregation
- Layered validation (pattern scan + visual diff + style comparison)

### Functional Gaps 🟡
- **Variables:** Extracted but under-utilized (no mode handling, no query command)
- **Styles:** Style IDs stored but not resolved to definitions
- **Components:** Shallow extraction (no slot/override structure, no variant options)
- **Caching:** Write-only for bridge, manual invalidation by caller
- **Incremental:** No delta extraction or change detection

### Scale Limitations 🔴
- 60s timeout limits large designs (100+ nodes flagged as risky)
- No streaming — full extraction.json read into memory
- No pagination for large query results

### Protocol Robustness 🟠
- No auto-reconnect for SSE disconnections
- No zombie job cleanup after timeouts
- Silent asset export failures

### Documentation Quality ⚠️
- Generally accurate but gaps around variable mode handling, style resolution, component semantics
- Some implementation details exceed docs (e.g., pattern scan, visual diff regions)
- Some promised features under-deliver (e.g., "design tokens" mentioned but no token export)

### Overall Assessment
The implementation provides a **solid foundation** for Figma-to-code workflows with strong extraction fidelity for layout/style/text. The **primary limitation is under-utilization of design system primitives** (variables, styles, components) — data is extracted but not exposed via query commands or workflow steps. **Scale and caching concerns** make it best suited for moderate-sized designs (< 100 nodes) with manual cache management.

**Recommended priority:** Implement `query variables` command and cache invalidation to unlock design system workflows and improve repeat-extraction performance.

---

## 12. File Citations Index

| File | Lines Referenced | Topics |
|------|------------------|--------|
| `SKILL.md` | 3, 28, 72-73, 83, 91, 95-99, 124, 132, 148, 156, 164, 179, 197, 210-212, 276, 288, 309, 347, 367-374, 406 | Workflow, cache, query commands, validation |
| `README.md` | 5, 63-69, 73-80, 87-101, 103-104, 142 | Architecture, multi-select, cache, query syntax, performance |
| `bridge.mjs` | 13, 42, 99-104, 122, 129-135, 138, 250-288, 286, 363 | Timeout, cache paths, SSE, job management, error handling |
| `plugin/code.js` | 177-210, 247-326, 332-379, 386-400, 406-421, 427-455, 459-523, 558-599, 605-627, 629-647, 729-805, 812-814, 820-849, 851-895, 930-951, 953-981 | Extraction logic, serialization, multi-select, assets, variables, components |
| `plugin/ui.html` | 69-112, 109-111, 114-116 | SSE connection, reconnect UI |
| `plugin/manifest.json` | 1-13 | Plugin metadata, network access |
| `bridge_client.mjs` | 74, 114, 139 | CLI error handling, timeouts |
| `query.mjs` | 5-287, 31-37, 74-109, 111-171, 213-233, 243-287, 383-447, 451-477, 481-504, 495, 515-573 | Query commands, pruning logic, palette extraction, error handling |
| `validate.mjs` | 1-503, 322-325, 425-502 | Style validation, Puppeteer usage, error handling |
| `pattern-scan.mjs` | 1-150 | Static HTML pattern detection |
| `visual-diff.mjs` | 1-150 | Screenshot diffing, pixelmatch |
| `references/coding-guide.md` | 1-100 | Layout mapping, responsive strategy |

---

**End of Audit Report**
