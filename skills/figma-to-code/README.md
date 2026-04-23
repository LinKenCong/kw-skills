# Figma-to-Code Skill

Inspiration from: https://github.com/About-JayX

Extract design data from Figma Desktop through a local plugin + bridge, then query bundle/selection artifacts for restoration-oriented frontend work. No Figma MCP Server required.

## Architecture

```text
Figma Desktop Plugin ←SSE→ Bridge (localhost:3333) ←HTTP→ CLI / Agent
```

- Plugin (`plugin/`): runs inside Figma Desktop, extracts nodes/pages/selections, emits bundle-aware metadata, exports assets/screenshots, and records capability boundaries.
- Bridge (`bridge.mjs`): local HTTP + SSE server. Dispatches jobs to the plugin, persists legacy extraction caches and bundle caches, and exposes `/health` + `/capabilities`.
- CLI (`scripts/bridge_client.mjs`): command-line entrypoint for health checks, extraction commands, capability inspection, and query commands.
- Query (`scripts/query.mjs`): reads legacy extraction caches and bundle caches and returns pruned task-facing outputs.

## What changed in this version

The plugin is no longer only a single-node extractor. It now exposes stable capabilities for:
- current selection extraction with richer screenshot artifacts
- explicit page extraction
- selected-pages bundle extraction (`PageNode.selection` across pages)
- page / screenshot / region / variable / component / CSS queries
- machine-readable capability discovery

Human-readable capability reference:
- `plugin/API_CAPABILITIES.md`

Machine-readable registry:
- `plugin/capabilities.json`

## Prerequisites

- Node.js ≥ 18
- Figma Desktop (not browser Figma)

## Installation

### 1. Import the Figma plugin

1. Open Figma Desktop
2. Go to Plugins → Development → Import plugin from manifest...
3. Select the plugin manifest:
   - repo-local example: `skills/figma-to-code/plugin/manifest.json`
   - resolved skill path: `<skill>/plugin/manifest.json`

### 2. Start or ensure the bridge

```bash
node figma-to-code/scripts/bridge_client.mjs ensure
```

The output now includes:
- `pluginManifestPath`
- `workspaceCacheRoot`

### 3. Run the plugin in the target file

1. Open the design file in Figma Desktop
2. Go to Plugins → Development → Figma Bridge Extractor
3. Confirm the plugin panel shows `Bridge SSE 已连接`

## Capability discovery

```bash
node figma-to-code/scripts/bridge_client.mjs capabilities
```

Use this before relying on a command you have not used recently. The registry is the authoritative list of stable capabilities.

## Extraction commands

### A. Single node by URL or nodeId

```bash
node figma-to-code/scripts/bridge_client.mjs extract "https://figma.com/design/abc123/MyFile?node-id=1-2" --assets --screenshot
```

Optional screenshot enrichments:

```bash
node figma-to-code/scripts/bridge_client.mjs extract "1:2" --node-screenshots
```

### B. Current selection

```bash
node figma-to-code/scripts/bridge_client.mjs extract-selection --assets --screenshot --node-screenshots
```

Notes:
- `--screenshot` keeps the legacy `screenshot.png` behavior for downstream compatibility.
- `--node-screenshots` adds direct per-node exports under `nodes/<nodeId>/screenshot.png`.

### C. Explicit pages → bundle cache

```bash
node figma-to-code/scripts/bridge_client.mjs extract-pages --pages "Home,Pricing" --allow-full-page --page-screenshots --node-screenshots
```

Guardrail:
- `extract-pages` is restricted full-page mode
- for most work, prefer `extract-selection`
- if the user has no current selection and did not provide a node target, do not fall back to full-page extraction

### D. All pages with persisted selection → bundle cache

```bash
node figma-to-code/scripts/bridge_client.mjs extract-selected-pages-bundle --page-screenshots --node-screenshots
```

This is the preferred restoration path when you keep selections on multiple pages and want a single evidence-rich bundle.

## Cache layouts

By default, extraction output is written under the caller workspace root:

```text
.figma-to-code/
```

This keeps runtime caches out of the installed skill directory.

### Legacy extraction cache

Used by `extract` and `extract-selection`.

```text
.figma-to-code/<fileKey>/<nodeId>/
  extraction.json
  page.json
  regions.level1.json
  regions.level2.json
  screenshot.png                # legacy compatibility screenshot
  screenshots/
    manifest.json
    page.png
  nodes/
    <nodeId>/
      screenshot.png
      exports/
      assets/
  assets/
    ...
```

### Bundle cache

Used by `extract-pages` and `extract-selected-pages-bundle`.

```text
.figma-to-code/bundles/<bundleId>/
  bundle.json
  indexes/
    pages.json
    screenshots.json
    regions.json
    variables.json
    components.json
    css.json
  pages/<pageId>/
    page.json
    extraction.json
    regions.level1.json
    regions.level2.json
    screenshots/
      manifest.json
      page.png
    nodes/
      <nodeId>/
        screenshot.png
        exports/
        assets/
    assets/
      ...
```

## Query commands

Prefer query commands over directly reading `extraction.json` or bundle files.

### Structure and legacy tree queries

```bash
node figma-to-code/scripts/bridge_client.mjs query tree --cache <cacheDir>
node figma-to-code/scripts/bridge_client.mjs query tree --cache <cacheDir> --frame Hero --depth 2
node figma-to-code/scripts/bridge_client.mjs query subtree <nodeId> --cache <cacheDir>
node figma-to-code/scripts/bridge_client.mjs query text --cache <cacheDir>
node figma-to-code/scripts/bridge_client.mjs query palette --cache <cacheDir>
```

### Bundle-aware queries

```bash
node figma-to-code/scripts/bridge_client.mjs query pages --cache <cacheDir>
node figma-to-code/scripts/bridge_client.mjs query screenshots --cache <cacheDir> --page Home
node figma-to-code/scripts/bridge_client.mjs query regions --cache <cacheDir> --page Home --level 1
node figma-to-code/scripts/bridge_client.mjs query variables --cache <cacheDir>
node figma-to-code/scripts/bridge_client.mjs query components --cache <cacheDir>
node figma-to-code/scripts/bridge_client.mjs query css --cache <cacheDir>
```

For bundle caches, `query variables`, `query components`, and `query css` prefer prebuilt indexes before falling back to per-page extraction files.

## Design fidelity artifacts

The most valuable outputs for restoration work are now:
- bundle page list
- page screenshots
- direct per-node screenshots
- node-scoped SVG/PNG exports and nested assets
- level 1 / level 2 regions
- component / variable / CSS hints

These exist to support baseline-first and evidence-first workflows, not just one-shot code generation.

## Notes on official Figma Plugin APIs

The plugin is aligned with the official APIs most relevant to restoration work, including:
- `PageNode.selection`
- `figma.root`
- `figma.currentPage.selection`
- `exportAsync`
- `getStyledTextSegments`
- `findAllWithCriteria`
- `figma.skipInvisibleInstanceChildren`
- `getCSSAsync` (best effort)

Important:
- this project does not expose arbitrary raw Plugin API execution
- mutation APIs are intentionally not surfaced as stable capabilities
- `getCSSAsync()` may return unavailable depending on current mode/node support

## Tests and checks

```bash
cd skills/figma-to-code
npm test
npm run check
```

## Troubleshooting

### `NO_PLUGIN_CONNECTION`

Bridge is running but no plugin is connected:
1. Confirm Figma Desktop is open
2. Confirm the plugin was imported from `skills/figma-to-code/plugin/manifest.json` or the resolved `<skill>/plugin/manifest.json`
3. Run the plugin inside the correct Figma file
4. Wait for `Bridge SSE 已连接` in the plugin UI

### No pages found for `extract-pages`

- Confirm the names or page IDs match the open file exactly
- `extract-pages` also requires explicit `--allow-full-page`
- Use the selected-pages bundle path if the workflow is selection-driven rather than full-page driven

### `extract-selected-pages-bundle` returns no pages

- Each target page must retain its own `PageNode.selection`
- Go page by page in Figma, keep the desired selection on each page, then rerun the command

### CSS query returns `available: false`

This is expected when `getCSSAsync()` is unavailable for the current node/mode. Treat CSS hints as optional diagnostics, not the primary extraction schema.

## File structure

```text
figma-to-code/
├── SKILL.md
├── bridge.mjs
├── plugin/
│   ├── code.js
│   ├── ui.html
│   ├── manifest.json
│   ├── capabilities.json
│   └── API_CAPABILITIES.md
├── scripts/
│   ├── bridge_client.mjs
│   ├── query.mjs
│   ├── pattern-scan.mjs
│   ├── validate.mjs
│   └── visual-diff.mjs
├── tests/
│   ├── bridge.test.mjs
│   ├── bridge_client.test.mjs
│   └── query.test.mjs
├── references/
│   ├── coding-guide.md
│   ├── plugin-install.md
│   └── regression-acceptance.md
└── cache/                      # legacy sample dir only; runtime cache defaults to ../.figma-to-code/
```

## License

Apache 2.0
