# Figma-to-Code Skill

Inspiration from: https://github.com/About-JayX

Extract design data from Figma Desktop via a local plugin + Bridge, then translate into production frontend code. No Figma MCP Server required.

## Architecture

```
Figma Desktop Plugin ←SSE→ Bridge (localhost:3333) ←HTTP→ CLI / Agent
```

- **Plugin** (`plugin/`): Runs inside Figma Desktop. Extracts node data, exports SVG/PNG assets, and generates screenshots. Supports both single and multi-node selection.
- **Bridge** (`bridge.mjs`): Local HTTP + SSE server. Relays communication between the Agent and the plugin. Persists extraction results to cache.
- **CLI** (`scripts/bridge_client.mjs`): Command-line client used by the Agent to interact with the Bridge and query cached extraction data.

## Prerequisites

- **Node.js** ≥ 18
- **Figma Desktop** (not the browser version)

## Installation

### 1. Import the Figma Plugin (one-time)

1. Open Figma Desktop
2. Go to Plugins → Development → Import plugin from manifest...
3. Select `figma-to-code/plugin/manifest.json`

### 2. Start the Bridge

```bash
node figma-to-code/bridge.mjs
# or auto-start via CLI
node figma-to-code/scripts/bridge_client.mjs ensure
```

### 3. Run the Plugin

1. Open the target design file in Figma Desktop
2. Go to Plugins → Development → Figma Bridge Extractor
3. Confirm the plugin UI shows "Bridge SSE Connected" (green)

## Usage

### CLI Commands

```bash
# Check Bridge status
node figma-to-code/scripts/bridge_client.mjs health

# Ensure Bridge is running
node figma-to-code/scripts/bridge_client.mjs ensure

# Extract by Figma URL (with assets and screenshot)
node figma-to-code/scripts/bridge_client.mjs extract "https://figma.com/design/abc123/MyFile?node-id=1-2" --assets --screenshot

# Extract current selection (supports multi-select)
node figma-to-code/scripts/bridge_client.mjs extract-selection --assets --screenshot
```

### Multi-Select Support

When multiple nodes are selected in Figma (Shift+click or drag-select), the plugin creates a **virtual group** (`VIRTUAL_GROUP`) as the root node:
- Bounding box = union of all selected nodes
- Each child's position is recalculated relative to the virtual root origin
- `meta.isMultiSelect: true` and `meta.selectedNodeCount` indicate a multi-selection

This allows extracting ungrouped elements that the designer did not organize into a parent frame.

### Output

Extraction results are saved to `cache/<fileKey>/<nodeId>/` (`:` in nodeId is replaced with `-`, e.g., `1:2` → `1-2`). When `fileKey` is unavailable (selection extractions), `unknown-file` is used as the directory name.

| File | Description |
|------|-------------|
| `extraction.json` | Full design spec (layout, styles, text, variables, components, vector paths) |
| `assets/*.svg` | Exported SVG vector graphics |
| `assets/*@2x.png` | Exported 2x PNG images |
| `screenshot.png` | Parent frame screenshot (when available) |

### Query Commands

Instead of reading `extraction.json` directly (which can be very large), use the CLI query commands to retrieve pruned, focused data on demand:

```bash
# List available frames
node figma-to-code/scripts/bridge_client.mjs query tree --cache <cacheDir>

# Get component tree for a specific frame
node figma-to-code/scripts/bridge_client.mjs query tree --cache <cacheDir> --frame Desktop --depth 3

# Get pruned data for a single component subtree
node figma-to-code/scripts/bridge_client.mjs query subtree <nodeId> --cache <cacheDir>

# Get deduplicated color/font/spacing palette
node figma-to-code/scripts/bridge_client.mjs query palette --cache <cacheDir> --frame Desktop

# Get all text content
node figma-to-code/scripts/bridge_client.mjs query text --cache <cacheDir> --frame Desktop
```

Query output is aggressively pruned: default values omitted, colors reduced to hex only, padding/border-radius shortened. A typical component subtree is 50–300 lines vs 30K+ for the full extraction.

### Design Fidelity Modes

The skill supports two implementation modes, chosen by the user after extraction:

| Mode | Goal | Data Source | Styling | Verification |
|------|------|-------------|---------|-------------|
| **High-fidelity** | Pixel-perfect match | query subtree + palette (all values) | Exact colors, fonts, spacing from design | Full regression checklist |
| **Prototype** | Elements complete + reasonable layout | query tree + text (structure only) | Project design system tokens | Element completeness only |

### Figma → CSS Property Mapping

| Figma | CSS |
|-------|-----|
| `layoutMode: VERTICAL` | `display: flex; flex-direction: column` |
| `layoutMode: HORIZONTAL` | `display: flex; flex-direction: row` |
| `primaryAxisAlignItems: CENTER` | `justify-content: center` |
| `counterAxisAlignItems: CENTER` | `align-items: center` |
| `itemSpacing: 12` | `gap: 12px` |
| `paddingTop/Right/Bottom/Left` | `padding: ...` |
| `clipsContent: true` | `overflow: hidden` |
| `fills` | `background` |
| `strokes + strokeWeight` | `border` |
| `cornerRadius` | `border-radius` |
| `effects (DROP_SHADOW)` | `box-shadow` |

## Troubleshooting

### NO_PLUGIN_CONNECTION

Bridge is running but no plugin is connected:
1. Confirm Figma Desktop is open (not the browser version)
2. Confirm the plugin has been imported via `plugin/manifest.json`
3. Manually run the plugin in the target file
4. Check the plugin UI for SSE connection status

### Extraction Timeout

Default timeout is 60 seconds. Large designs (100+ nodes) may take longer. Try selecting a smaller subtree to re-extract.

### Asset Export Failure

Some node types (e.g., SLICE) may not support `exportAsync`. The plugin skips these nodes and continues extraction.

### CSP / Network Errors in Plugin Console

If you see `Content Security Policy` errors when the plugin tries to connect to localhost, ensure `manifest.json` has:
```json
"networkAccess": {
  "allowedDomains": ["http://localhost:3333"]
}
```

## File Structure

```
figma-to-code/
├── SKILL.md                          # Agent workflow (5 phases)
├── bridge.mjs                        # Bridge server
├── plugin/
│   ├── code.js                       # Plugin logic (extraction + multi-select)
│   ├── ui.html                       # Plugin UI (SSE connection + controls)
│   └── manifest.json                 # Figma plugin manifest
├── scripts/
│   ├── bridge_client.mjs             # CLI client (extract + query commands)
│   ├── pattern-scan.mjs              # HTML/CSS pattern checks for design drift
│   ├── query.mjs                     # Query engine (pruning + filtering)
│   ├── validate.mjs                  # Visual/structural validation entrypoint
│   └── visual-diff.mjs               # Screenshot diffing utilities
├── references/
│   ├── coding-guide.md               # Layout/typography/component implementation guide
│   ├── plugin-install.md             # Plugin installation guide
│   └── regression-acceptance.md      # Visual acceptance checklist
└── cache/                            # Extraction cache (git-ignored)
    └── <fileKey>/<nodeId>/
        ├── extraction.json
        └── assets/
```

## License

Apache 2.0
