# Figma Bridge Extractor API Capabilities

This document is the human-readable companion to `capabilities.json`.

Goal:
- tell the agent which plugin/bridge capabilities are stable
- show how to call them
- map each capability to official Figma Plugin APIs
- make limitations explicit so the agent does not guess

Principles:
1. Call stable capabilities, not arbitrary raw Plugin APIs.
2. Prefer `query` over directly reading large cache files.
3. Treat screenshots, regions, and bundle indexes as first-class outputs.
4. `getCSSAsync()` is best-effort: if the current mode/node does not support it, the capability returns `available: false` with a reason.
5. Mutation APIs are intentionally not exposed.

## Capability discovery

Machine-readable registry:
- `plugin/capabilities.json`

CLI:
- `node figma-to-code/scripts/bridge_client.mjs capabilities`

Bridge:
- `GET /capabilities`

## Stable capabilities

### 1. `bridge.health`
Purpose:
- check whether the bridge is running and whether the plugin is connected

CLI:
- `node figma-to-code/scripts/bridge_client.mjs health`

Bridge:
- `GET /health`

Outputs:
- `ok`
- `pluginConnected`
- `uptime`

### 2. `extract.node`
Purpose:
- extract one node by URL or nodeId into legacy-compatible extraction cache

CLI:
- `node figma-to-code/scripts/bridge_client.mjs extract "<figma-url-or-nodeId>" [--assets] [--screenshot] [--node-screenshots]`

Bridge:
- `POST /extract`
- SSE event: `extract`

Official APIs used:
- `figma.getNodeByIdAsync`
- `exportAsync`
- `getStyledTextSegments`
- `boundVariables`
- `inferredVariables`

Notes:
- still writes `extraction.json`
- when extra screenshot flags are enabled, also writes screenshot manifests under `screenshots/`

### 3. `extract.selection`
Purpose:
- extract current-page selection
- supports multi-select virtual root
- supports direct per-node screenshots and node-scoped resource packages

CLI:
- `node figma-to-code/scripts/bridge_client.mjs extract-selection [--assets] [--screenshot] [--node-screenshots]`

Bridge:
- `POST /extract-selection`
- SSE event: `extract-selection`

Official APIs used:
- `figma.currentPage.selection`
- `exportAsync`
- `getStyledTextSegments`
- `figma.root`

Notes:
- `--screenshot` preserves legacy `screenshot.png` compatibility
- `--node-screenshots` writes direct exports to node-scoped directories instead of crop-derived screenshots

### 4. `extract.pages`
Purpose:
- extract one or more explicit pages as a bundle cache

CLI:
- `node figma-to-code/scripts/bridge_client.mjs extract-pages --pages "Home,Pricing" [--assets] [--page-screenshots] [--node-screenshots]`

Bridge:
- `POST /extract-pages`
- SSE event: `extract-pages`

Official APIs used:
- `figma.root`
- `PageNode.selection`
- `exportAsync`
- `findAllWithCriteria`
- `figma.skipInvisibleInstanceChildren`

Outputs:
- bundle cache under `cache/bundles/<bundleId>/`
- `bundle.json`
- `indexes/pages.json`
- `indexes/screenshots.json`
- `indexes/regions.json`
- `pages/<pageId>/page.json`
- `pages/<pageId>/extraction.json`
- `pages/<pageId>/regions.level1.json`
- `pages/<pageId>/regions.level2.json`
- `pages/<pageId>/screenshots/...`

### 5. `extract-selected-pages-bundle`
Purpose:
- find all pages that currently have persisted `PageNode.selection`
- extract them into a single bundle

CLI:
- `node figma-to-code/scripts/bridge_client.mjs extract-selected-pages-bundle [--assets] [--page-screenshots] [--node-screenshots]`

Bridge:
- `POST /extract-selected-pages-bundle`
- SSE event: `extract-selected-pages-bundle`

Official APIs used:
- `figma.root`
- `PageNode.selection`
- `exportAsync`
- `findAllWithCriteria`
- `figma.skipInvisibleInstanceChildren`

Notes:
- this is the preferred path when the user keeps selections on multiple pages and wants a bundle for restoration work

### 6. `query.capabilities`
CLI:
- `node figma-to-code/scripts/bridge_client.mjs capabilities`

Purpose:
- return the capability registry itself

### 7. `query.pages`
CLI:
- `node figma-to-code/scripts/bridge_client.mjs query pages --cache <cacheDir>`

Purpose:
- list page summaries from bundle cache
- synthesize a single-page summary from legacy extraction cache

### 8. `query.screenshots`
CLI:
- `node figma-to-code/scripts/bridge_client.mjs query screenshots --cache <cacheDir> [--page <pageId-or-name>]`

Purpose:
- list available screenshots
- supports page filtering

### 9. `query.regions`
CLI:
- `node figma-to-code/scripts/bridge_client.mjs query regions --cache <cacheDir> [--page <pageId-or-name>] [--level 1|2]`

Purpose:
- inspect hierarchical regions
- supports page and level filtering

### 10. `query.variables`
CLI:
- `node figma-to-code/scripts/bridge_client.mjs query variables --cache <cacheDir>`

Purpose:
- return extracted variable catalog / flat token maps

### 11. `query.components`
CLI:
- `node figma-to-code/scripts/bridge_client.mjs query components --cache <cacheDir>`

Purpose:
- return nodes that carry component semantics
- includes `mainComponent`, current properties, and variant properties when available

### 12. `query.css`
CLI:
- `node figma-to-code/scripts/bridge_client.mjs query css --cache <cacheDir>`

Purpose:
- return CSS hints if captured
- otherwise report why unavailable

Official API used:
- `getCSSAsync`

Notes:
- this is not guaranteed in every mode/node type
- callers must handle `available: false`

## Recommended usage patterns

### Restoration workflow: multiple pages
1. `bridge_client.mjs capabilities`
2. `bridge_client.mjs extract-selected-pages-bundle --page-screenshots --node-screenshots`
3. `bridge_client.mjs query pages --cache <bundleDir>`
4. `bridge_client.mjs query regions --cache <bundleDir> --page <page>`
5. `bridge_client.mjs query screenshots --cache <bundleDir> --page <page>`

### Restoration workflow: current selection
1. `bridge_client.mjs extract-selection --screenshot --node-screenshots`
2. `bridge_client.mjs query components --cache <cacheDir>`
3. `bridge_client.mjs query variables --cache <cacheDir>`
4. `bridge_client.mjs query css --cache <cacheDir>`

## Non-goals / intentionally unsupported
- arbitrary raw Plugin API execution
- mutation APIs for creating/updating/deleting nodes
- hidden automatic team-library enabling
- codegen-only workflow replacing the bridge extractor

## If you add new capabilities
Update both files together:
- `plugin/capabilities.json`
- `plugin/API_CAPABILITIES.md`

Do not document a capability as stable unless:
- bridge/CLI command exists
- cache/query outputs are defined
- failure modes are understandable
