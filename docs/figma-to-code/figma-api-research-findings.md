# Figma Plugins API Research Findings
## Variables, Styles, Tokens, Team Libraries, and Code Extraction
*Research Date: 2024*  
*Target: Upgrade capabilities for `figma-to-code` skill*

---

## Executive Summary

This research examines official Figma Plugin API capabilities relevant to design-to-code workflows, focusing on Variables (design tokens), Styles, Team Libraries, and code extraction features. The local `figma-to-code` skill already extracts `boundVariables` and `inferredVariables` but is **not using** several high-value APIs that could significantly enhance its design token and CSS extraction capabilities.

**Key Findings:**
- ✅ **Variables API fully available** – Complete CRUD operations for variables and collections
- ✅ **`getCSSAsync()` available** – Native CSS extraction for any SceneNode (currently unused by local skill)
- ✅ **Team Library API available** – Can query published variables from enabled team libraries
- ✅ **`boundVariables` & `inferredVariables`** – Already partially extracted by local skill
- ⚠️ **Dev Mode required** for `getCSSAsync()` and `isAsset` property
- ⚠️ **Typography variables** are bindable but require font loading
- ❌ **No direct `codeSyntax` property** export in current local skill

---

## 1. Variables API (Design Tokens)

### 1.1 Core API: `figma.variables`

**Official Documentation:**  
https://developers.figma.com/docs/plugins/api/figma-variables  
https://developers.figma.com/docs/plugins/working-with-variables

**Confirmed Capabilities:**

| Method | Purpose | Async | Local Skill Usage |
|--------|---------|-------|-------------------|
| `getLocalVariablesAsync(type?)` | Get all local variables, optionally filtered by type | ✅ | ❌ Not used |
| `getLocalVariableCollectionsAsync()` | Get all local collections | ✅ | ❌ Not used |
| `getVariableByIdAsync(id)` | Fetch variable by ID | ✅ | ❌ Not used |
| `getVariableCollectionByIdAsync(id)` | Fetch collection by ID | ✅ | ❌ Not used |
| `createVariable(name, collection, type)` | Create new variable | ❌ | N/A (read-only) |
| `createVariableCollection(name)` | Create new collection | ❌ | N/A (read-only) |
| `importVariableByKeyAsync(key)` | Import variable from team library | ✅ | ❌ Not used |

**Variable Object Properties:**
- `id`, `name`, `description`, `key` – Basic metadata
- `variableCollectionId` – Parent collection reference
- `resolvedType` – `"BOOLEAN" | "FLOAT" | "STRING" | "COLOR"`
- `valuesByMode` – Values for each mode (read-only, does NOT resolve aliases)
- `scopes[]` – UI visibility scopes (e.g., `"ALL_SCOPES"`, `"TEXT_CONTENT"`, `"WIDTH_HEIGHT"`)
- `codeSyntax` – Platform-specific code syntax definitions:
  - `{ WEB?: string, ANDROID?: string, iOS?: string }`
  - Set via `setVariableCodeSyntax(platform, value)`
- `hiddenFromPublishing` – Whether hidden when publishing to library
- `resolveForConsumer(node)` – Resolves value accounting for aliases and modes

**Variable Collection Properties:**
- `id`, `name`, `key` – Identifiers
- `modes[]` – Array of `{ modeId: string, name: string }`
- `defaultModeId` – Default mode for the collection
- `variableIds[]` – List of variable IDs in this collection (order roughly matches UI)
- `remote` – Whether this is a remote (library) collection
- `isExtension` – Whether this collection extends another (Enterprise-only feature)
- `addMode(name)`, `removeMode(modeId)`, `renameMode(modeId, newName)` – Mode management
- `extend(name)` – Create extended collection (Enterprise plan only)

**URL:** https://developers.figma.com/docs/plugins/api/Variable  
**URL:** https://developers.figma.com/docs/plugins/api/VariableCollection

---

### 1.2 High-Value Unused Features

#### A. `codeSyntax` Property
**What it is:** Platform-specific token definitions for Web, Android, iOS.

**Example:**
```js
const variable = await figma.variables.getVariableByIdAsync('...');
console.log(variable.codeSyntax);
// { WEB: '$color-primary', ANDROID: '@color/primary', iOS: 'ColorPrimary' }
```

**Why it matters:** Enables platform-specific code generation without guessing naming conventions.

**Current local skill:** Does NOT extract `codeSyntax` property.

**URL:** https://developers.figma.com/docs/plugins/api/Variable#codesyntax

---

#### B. Variable `scopes`
**What it is:** Defines where variables can be applied in the UI (e.g., text content, sizing, fills).

**Scope types:**
- `ALL_SCOPES` | `ALL_FILLS` | `FRAME_FILL` | `SHAPE_FILL` | `TEXT_FILL`
- `ALL_STROKES` | `STROKE_COLOR` | `EFFECT_COLOR` | `WIDTH_HEIGHT`
- `GAP` | `CORNER_RADIUS` | `TEXT_CONTENT` | `FONT_FAMILY` | `FONT_STYLE`
- `FONT_WEIGHT` | `FONT_SIZE` | `LINE_HEIGHT` | `LETTER_SPACING`
- `PARAGRAPH_SPACING` | `PARAGRAPH_INDENT` | `OPACITY`

**Why it matters:** Helps categorize tokens by usage (e.g., spacing vs. color tokens).

**Current local skill:** Does NOT extract `scopes` property.

**URL:** https://developers.figma.com/docs/plugins/api/properties/Variable-scopes

---

#### C. Typography Variables
**What it is:** Variables can bind to text properties: `fontFamily`, `fontStyle`, `fontWeight`, `fontSize`, `lineHeight`, `letterSpacing`, `paragraphSpacing`, `paragraphIndent`.

**Usage:**
```js
const textNode = await figma.getNodeByIdAsync('1:4');
textNode.setBoundVariable('fontWeight', weightVariable);
// For substrings:
textNode.setRangeBoundVariable(0, 5, 'fontWeight', weightVariable);
```

**Why it matters:** Enables semantic type scales and design system typography tokens.

**Current local skill:** Extracts `boundVariables` but does NOT specifically highlight typography variable usage.

**URL:** https://developers.figma.com/docs/plugins/working-with-variables#typography-variables

---

### 1.3 `boundVariables` vs `inferredVariables`

**`boundVariables`** (read-only property on nodes):
- **What it is:** Variables explicitly bound to a node field via the UI or API.
- **Structure:** `{ [field]: VariableAlias | VariableAlias[] }`
- **Fields:** Includes `fills[]`, `strokes[]`, `effects[]`, `layoutGrids[]`, `width`, `height`, `opacity`, `cornerRadius`, `textRangeFills[]`, `componentProperties{}`, etc.
- **Local skill:** ✅ **Already extracted** (confirmed in `plugin/code.js`)

**`inferredVariables`** (read-only property on nodes):
- **What it is:** Variables that **match the raw value** of a field for the node's resolved mode, even if not explicitly bound.
- **Use case:** Suggests variables that could be applied based on matching values.
- **Local skill:** ✅ **Already extracted** (confirmed in `plugin/code.js`)

**URL:** https://developers.figma.com/docs/plugins/api/node-properties#boundvariables  
**URL:** https://developers.figma.com/docs/plugins/api/properties/nodes-inferredvariables

---

## 2. Styles API

### 2.1 Core Concepts

**Style Types:**
- `PaintStyle` – Fill/stroke colors
- `TextStyle` – Typography properties
- `EffectStyle` – Drop shadows, blurs, etc.
- `GridStyle` – Layout grids

**Base Style Properties (common to all):**
- `id` – Unique style ID (used with `setFillStyleIdAsync`, `setTextStyleIdAsync`, etc.)
- `name` – Style name (supports folder structure via `/` delimiter, e.g., `"Colors/Brand/Primary"`)
- `description`, `descriptionMarkdown` – Annotations
- `documentationLinks[]` – External references
- `remote` – Whether from team library (read-only if true)
- `key` – Key for importing from library
- `getPublishStatusAsync()` – Returns `PublishStatus` (current/published/unpublished)
- `getStyleConsumersAsync()` – Returns nodes using this style
- `remove()` – Delete local style

**URL:** https://developers.figma.com/docs/plugins/api/BaseStyle

---

### 2.2 High-Value Features

#### A. Style Folders
Styles support hierarchical organization via `/` delimiters in names:

```js
paintStyle.name = "Colors/Brand/Primary" // Creates nested folders
```

**Why it matters:** Helps organize design tokens into semantic categories.

**URL:** https://developers.figma.com/docs/plugins/api/BaseStyle#folders

---

#### B. `getStyleConsumersAsync()`
Returns all nodes using a style, including which field (fill vs. stroke for PaintStyle).

**Example:**
```js
const style = await figma.getStyleByIdAsync('S:...');
const consumers = await style.getStyleConsumersAsync();
// Returns: [{ node: TextNode, fields: ['textStyle'] }, ...]
```

**Why it matters:** Enables usage analysis and impact assessment for design system changes.

**Current local skill:** Does NOT use this API.

**URL:** https://developers.figma.com/docs/plugins/api/BaseStyle#getstyleconsumersasync

---

## 3. Team Library API

**Official Documentation:**  
https://developers.figma.com/docs/plugins/api/figma-teamlibrary

**Permission Required:** Must add `"teamlibrary"` to `manifest.json` permissions.

### 3.1 Available Methods

| Method | Purpose | Returns |
|--------|---------|---------|
| `getAvailableLibraryVariableCollectionsAsync()` | Get all variable collections from enabled libraries | `LibraryVariableCollection[]` |
| `getVariablesInLibraryCollectionAsync(key)` | Get variables in a specific library collection | `LibraryVariable[]` |

**Limitations:**
- Users must **manually enable** libraries via UI – cannot be enabled programmatically.
- Only returns data from **enabled** libraries.

### 3.2 Library Descriptors

**`LibraryVariableCollection`:**
- `name`, `key`, `libraryName`, `description`

**`LibraryVariable`:**
- `name`, `key`, `resolvedType`, `scopes[]`, `variableCollectionId`
- `description`, `codeSyntax`, `hiddenFromPublishing`

**Why it matters:** Enables plugins to suggest or import tokens from team libraries.

**Current local skill:** Does NOT use Team Library API.

**URL:** https://developers.figma.com/docs/plugins/api/figma-teamlibrary

---

## 4. Code Extraction & Dev Mode

### 4.1 `getCSSAsync()`

**Method signature:**  
`node.getCSSAsync(): Promise<{ [key: string]: string }>`

**What it returns:** JSON object of CSS properties as shown in Figma's Inspect panel.

**Example output:**
```json
{
  "width": "120px",
  "height": "48px",
  "background": "#1E1E1E",
  "border-radius": "8px",
  "font-family": "Inter",
  "font-size": "16px",
  "font-weight": "600",
  "line-height": "24px"
}
```

**Availability:**
- Available on all `SceneNode` types (Frame, Rectangle, Text, etc.)
- Documented as useful for **codegen plugins**

**Current local skill:** ❌ **NOT USED** – Skill extracts raw properties (fills, fontSize, etc.) but does NOT call `getCSSAsync()`.

**URL:** https://developers.figma.com/docs/plugins/api/FrameNode#getcssasync

---

### 4.2 `isAsset` Property

**What it is:** Boolean flag indicating if Figma detects a node as an icon or raster image.

**Heuristics:**
- Icon = small vector graphic
- Image = node with image fill

**Why it matters:** Helps distinguish semantic assets from decorative shapes for code generation.

**Current local skill:** Does NOT use `isAsset` property.

**URL:** https://developers.figma.com/docs/plugins/api/FrameNode#isasset

---

### 4.3 Dev Mode & Codegen Plugins

**Dev Mode Features:**
- Plugins can register as **codegen plugins** to appear in the native language dropdown
- Use `figma.codegen.on("generate", callback)` to generate code on selection change
- Callback receives `CodegenEvent` with `node`, `language`, `settings`
- Must set `"capabilities": ["codegen", "vscode"]` in manifest

**Constraints:**
- Dev Mode plugins are **read-only** (cannot modify document)
- Pages are **always dynamically loaded** (even without `"documentAccess": "dynamic-page"`)
- `skipInvisibleInstanceChildren` defaults to `true`

**Current local skill:** Operates as a standard plugin, NOT a Dev Mode codegen plugin.

**URL:** https://developers.figma.com/docs/plugins/codegen-plugins  
**URL:** https://developers.figma.com/docs/plugins/working-in-dev-mode

---

## 5. Risks & Limitations

### 5.1 API Availability Constraints

| Feature | Gate | Workaround |
|---------|------|------------|
| Extended Variable Collections | Enterprise plan | N/A (feature disabled on lower tiers) |
| Team Library API | Manual library enablement via UI | Prompt user to enable libraries first |
| `getCSSAsync()` | None (available on all SceneNodes) | None needed |
| Multiple variable modes | Pricing tier limits | Check `collection.modes.length` |
| Typography variables | Requires font loading | Call `figma.loadFontAsync()` first |

**URL (Pricing limits):** https://help.figma.com/hc/en-us/articles/360040328273

---

### 5.2 Mode Resolution

**Challenge:** Variables resolve differently based on:
1. Node's explicit mode (`node.explicitVariableModes`)
2. Inherited mode from parent frame
3. File/workspace defaults

**API for resolution:**
- `node.resolvedVariableModes` – Returns resolved mode per collection
- `variable.resolveForConsumer(node)` – Returns resolved value for a specific node

**Why it matters:** Raw `valuesByMode` does NOT resolve aliases; must use `resolveForConsumer()` for accurate values.

**URL:** https://developers.figma.com/docs/plugins/api/properties/nodes-resolvedvariablemodes

---

### 5.3 Font Loading for Typography Variables

**Requirement:** Before reading/writing typography properties bound to variables, must call:

```js
await figma.loadFontAsync(node.fontName);
```

**Failure mode:** Throws error if font not loaded.

**URL:** https://developers.figma.com/docs/plugins/api/properties/figma-loadfontasync

---

## 6. Comparison: Local Skill vs. Available APIs

### 6.1 Already Implemented ✅

| Feature | Local Skill | Evidence |
|---------|-------------|----------|
| `boundVariables` extraction | ✅ Yes | `plugin/code.js:326` |
| `inferredVariables` extraction | ✅ Yes | `plugin/code.js:328` |
| Variable alias resolution | ✅ Yes | Custom `serializeVariableBinding()` |
| Node property extraction | ✅ Yes | Fills, strokes, effects, typography |

---

### 6.2 High-Value Unused APIs ⚠️

| Feature | Available in API | Current Usage | Upgrade Potential |
|---------|------------------|---------------|-------------------|
| `getCSSAsync()` | ✅ Yes | ❌ Not used | **HIGH** – Native CSS extraction for code generation |
| Variable `codeSyntax` | ✅ Yes | ❌ Not extracted | **HIGH** – Platform-specific token naming |
| Variable `scopes` | ✅ Yes | ❌ Not extracted | **MEDIUM** – Token categorization |
| Team Library API | ✅ Yes | ❌ Not used | **MEDIUM** – Access published design tokens |
| `isAsset` property | ✅ Yes | ❌ Not used | **LOW** – Asset detection for codegen |
| Style folder structure | ✅ Yes | ❌ Not parsed | **LOW** – Style organization metadata |
| `getStyleConsumersAsync()` | ✅ Yes | ❌ Not used | **LOW** – Style usage analysis |

---

## 7. Recommended Upgrades

### 7.1 Priority 1: Add `getCSSAsync()` Extraction

**Rationale:** Native CSS output from Figma eliminates need to manually compute CSS properties from raw node data.

**Implementation:**
```js
async function extractNodeCSS(node) {
  try {
    return await node.getCSSAsync();
  } catch (err) {
    return null; // Not all nodes support CSS extraction
  }
}
```

**Benefit:** Simpler, more accurate CSS generation for HTML/React/CSS output.

---

### 7.2 Priority 2: Extract `codeSyntax` for Variables

**Rationale:** Enables platform-specific token naming (e.g., Web: `--color-primary`, iOS: `ColorPrimary`).

**Implementation:**
```js
function serializeVariable(variable) {
  return {
    id: variable.id,
    name: variable.name,
    resolvedType: variable.resolvedType,
    codeSyntax: variable.codeSyntax, // Add this
    scopes: variable.scopes,         // Add this
    valuesByMode: variable.valuesByMode
  };
}
```

**Benefit:** Generates platform-aware token references in output code.

---

### 7.3 Priority 3: Query Team Library Variables

**Rationale:** Access published design tokens from team libraries.

**Implementation:**
```js
async function getLibraryVariables() {
  const collections = await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync();
  const allVars = [];
  for (const coll of collections) {
    const vars = await figma.teamLibrary.getVariablesInLibraryCollectionAsync(coll.key);
    allVars.push(...vars);
  }
  return allVars;
}
```

**Benefit:** Suggest or import tokens from shared design systems.

---

## 8. Appendix: Official Documentation URLs

### Variables
- Variables API overview: https://developers.figma.com/docs/plugins/api/figma-variables
- Working with Variables guide: https://developers.figma.com/docs/plugins/working-with-variables
- Variable object: https://developers.figma.com/docs/plugins/api/Variable
- VariableCollection object: https://developers.figma.com/docs/plugins/api/VariableCollection
- `boundVariables` property: https://developers.figma.com/docs/plugins/api/node-properties#boundvariables
- `inferredVariables` property: https://developers.figma.com/docs/plugins/api/properties/nodes-inferredvariables
- Variable scopes: https://developers.figma.com/docs/plugins/api/properties/Variable-scopes
- Typography variables: https://developers.figma.com/docs/plugins/working-with-variables#typography-variables

### Styles
- BaseStyle object: https://developers.figma.com/docs/plugins/api/BaseStyle
- PaintStyle: https://developers.figma.com/docs/plugins/api/PaintStyle
- TextStyle: https://developers.figma.com/docs/plugins/api/TextStyle
- EffectStyle: https://developers.figma.com/docs/plugins/api/EffectStyle
- GridStyle: https://developers.figma.com/docs/plugins/api/GridStyle

### Team Library
- TeamLibrary API: https://developers.figma.com/docs/plugins/api/figma-teamlibrary
- `getAvailableLibraryVariableCollectionsAsync`: https://developers.figma.com/docs/plugins/api/properties/figma-teamlibrary-getavailablelibraryvariablecollectionsasync
- `getVariablesInLibraryCollectionAsync`: https://developers.figma.com/docs/plugins/api/properties/figma-teamlibrary-getvariablesinlibrarycollectionasync

### Code Extraction & Dev Mode
- `getCSSAsync()`: https://developers.figma.com/docs/plugins/api/FrameNode#getcssasync
- `isAsset` property: https://developers.figma.com/docs/plugins/api/FrameNode#isasset
- Codegen plugins guide: https://developers.figma.com/docs/plugins/codegen-plugins
- Working in Dev Mode: https://developers.figma.com/docs/plugins/working-in-dev-mode

### General
- Plugin API reference: https://developers.figma.com/docs/plugins/api/api-reference
- Plugin manifest: https://developers.figma.com/docs/plugins/manifest
- Node types: https://developers.figma.com/docs/plugins/api/nodes
- Node properties: https://developers.figma.com/docs/plugins/api/node-properties

---

## Conclusion

The Figma Plugin API provides comprehensive support for variables, styles, and code extraction. The local `figma-to-code` skill already extracts `boundVariables` and `inferredVariables`, but is missing **three high-value capabilities**:

1. **`getCSSAsync()`** – Native CSS extraction (available on all SceneNodes)
2. **Variable `codeSyntax`** – Platform-specific token naming (Web/Android/iOS)
3. **Team Library API** – Access to published design tokens from team libraries

These additions would significantly enhance the skill's design token and code generation capabilities without requiring architectural changes.

**No major risks identified** – All documented APIs are stable and officially supported. Primary constraint is that Team Library access requires manual library enablement by users via the Figma UI.
