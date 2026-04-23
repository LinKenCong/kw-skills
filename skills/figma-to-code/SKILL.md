---
name: figma-to-code
description: Extract live Figma design data through a local plugin + bridge, discover stable plugin capabilities from the registry, produce node/selection/page/bundle artifacts, and translate Figma designs into production frontend code. Use this skill whenever the user mentions Figma URLs, node IDs, page extraction, pixel-perfect restoration, screenshot baselines, bundle extraction, visual diffing, or translating Figma designs into frontend components.
---

# Figma Design-to-Code

Use a local Figma Desktop plugin + Bridge-first workflow.
Do not assume raw Figma Plugin API execution is available. Use stable capabilities only.

## Locate Skill Directory

Before use, locate `**/figma-to-code/scripts/bridge_client.mjs`. Use that directory for all subsequent commands.

## First rule: discover capabilities, don't guess

Start by inspecting the machine-readable registry when you need to know whether a capability is supported:

```bash
node <skill>/scripts/bridge_client.mjs capabilities
```

Human-readable companion:
- `<skill>/plugin/API_CAPABILITIES.md`

Stable capability families currently matter most:
- `extract.node`
- `extract.selection`
- `extract.pages`
- `extract-selected-pages-bundle`
- `query.pages`
- `query.screenshots`
- `query.regions`
- `query.variables`
- `query.components`
- `query.css`

Do not invent raw plugin calls or assume mutation APIs exist.

## Workflow overview

```text
1. Connect bridge/plugin
2. Discover capabilities if needed
3. Choose extraction scope
4. Extract
5. Query pages/screenshots/regions/components/variables/css
6. Build/repair HTML or app code
7. Validate against screenshot baselines and regions
```

## 1. Connect

```bash
node <skill>/scripts/bridge_client.mjs ensure
node <skill>/scripts/bridge_client.mjs health
```

Proceed only when:
- bridge is reachable
- plugin is connected in Figma Desktop

When asking the user to confirm plugin connection or current selection, also include first-run install guidance:
- Figma Desktop → Plugins → Development → Import plugin from manifest...
- manifest path: `<skill>/plugin/manifest.json`

If not connected, instruct the user to import that manifest if needed, then run the plugin inside the correct Figma file.

The `ensure` / `health` output also includes:
- `pluginManifestPath`
- `workspaceCacheRoot`

## 2. Choose extraction scope

### Use `extract` when:
- user gives a Figma URL or nodeId
- target is a single frame/component/section

```bash
node <skill>/scripts/bridge_client.mjs extract "<figma-url-or-nodeId>" --assets --screenshot
```

### Use `extract-selection` when:
- user already selected one or more nodes on the current page
- target is local and selection-driven

```bash
node <skill>/scripts/bridge_client.mjs extract-selection --assets --screenshot --node-screenshots
```

### Use `extract-pages` when:
- user explicitly requests full-page extraction by name
- selection-based extraction is not sufficient
- you deliberately opt in to a heavier page-oriented run

```bash
node <skill>/scripts/bridge_client.mjs extract-pages --pages "Home,Pricing" --allow-full-page --page-screenshots --node-screenshots
```

Default extraction policy:
- do not use `extract-pages` just because the plugin is connected
- prefer `extract-selection` for current-page work
- prefer `extract-selected-pages-bundle` only when the user intentionally preserved selections on multiple pages
- if the user has no selection and did not provide a node ID / Figma URL, stop and ask for selection or an explicit target instead of extracting a full page

### Use `extract-selected-pages-bundle` when:
- user preserved selections on multiple pages
- you need a single evidence-rich bundle for restoration work

```bash
node <skill>/scripts/bridge_client.mjs extract-selected-pages-bundle --page-screenshots --node-screenshots
```

Recommendation:
- for restoration across multiple pages, prefer bundle extraction over repeated single-node extraction
- for quick local iteration on one area, `extract-selection` is still fine

## 3. Query the cache, not the raw files

Never default to opening `extraction.json` directly.
Use query commands.

Default runtime cache root:
- `<workspace>/.figma-to-code/`

### Structure

```bash
node <skill>/scripts/bridge_client.mjs query tree --cache <cacheDir>
node <skill>/scripts/bridge_client.mjs query subtree <nodeId> --cache <cacheDir>
node <skill>/scripts/bridge_client.mjs query text --cache <cacheDir>
node <skill>/scripts/bridge_client.mjs query palette --cache <cacheDir>
```

### Bundle-aware inspection

```bash
node <skill>/scripts/bridge_client.mjs query pages --cache <cacheDir>
node <skill>/scripts/bridge_client.mjs query screenshots --cache <cacheDir> --page <pageId-or-name>
node <skill>/scripts/bridge_client.mjs query regions --cache <cacheDir> --page <pageId-or-name> --level 1
node <skill>/scripts/bridge_client.mjs query variables --cache <cacheDir>
node <skill>/scripts/bridge_client.mjs query components --cache <cacheDir>
node <skill>/scripts/bridge_client.mjs query css --cache <cacheDir>
```

Interpretation:
- `pages` tells you what is available
- `screenshots` gives page-level and node-level baselines
- `regions` gives repair/validation targets
- `variables` and `components` reduce guesswork
- `css` is optional diagnostic data; handle `available: false`

## 4. Preferred restoration strategy

For serious fidelity work, do this order:

1. get page list
2. inspect regions for the target page
3. inspect screenshots for the target page
4. inspect subtree/components/variables for the region you are implementing
5. build the first pass
6. validate against page screenshot and worst regions
7. iterate

Do not jump straight from extraction to final polished framework code without baselines and region evidence.

## 5. Golden reference and validation

When the task is restoration-focused:
- start with a simple HTML golden reference if needed
- use screenshot baselines first
- then use `visual-diff.mjs` and `validate.mjs`

Pattern:

```bash
node <skill>/scripts/visual-diff.mjs --design <design-png> --html <html-file> --out-dir <out-dir> --regions '<json>' --json
node <skill>/scripts/validate.mjs --reference <golden-html> --target <app-url-or-file> --json
```

Use region-first diagnosis instead of whole-page eyeballing whenever possible.

## 6. Capability-specific caveats

### CSS hints
- `getCSSAsync()` is best-effort
- if unavailable, treat that as expected, not as extraction failure

### Page screenshots and node artifacts
- page screenshots are first-class bundle artifacts
- node screenshots are direct exports stored inside node-scoped directories
- node-scoped exports include SVG/PNG root exports plus image-fill assets when available
- descendant vector fragments are intentionally not exported by default; prefer node-level SVG/PNG exports and screenshots

### Multi-page selections
- official `PageNode.selection` persistence makes selected-pages bundle extraction possible
- this is a page-aware workflow, not just `figma.currentPage.selection`

### Mutation
- this skill does not expose arbitrary mutation APIs
- do not attempt to create/update/delete nodes through imagined plugin commands

## 7. Output expectations

A good run should leave you with one of these:

### Legacy cache
- `extraction.json`
- `page.json`
- `regions.level1.json`
- `regions.level2.json`
- `screenshot.png` when legacy screenshot is requested
- `screenshots/manifest.json`
- `screenshots/page.png` when page screenshots are enabled
- `nodes/<nodeId>/screenshot.png` and node-scoped `exports/` / `assets/` when node packages are enabled

### Bundle cache
- `bundle.json`
- `indexes/pages.json`
- `indexes/screenshots.json`
- `indexes/regions.json`
- `indexes/variables.json`
- `indexes/components.json`
- `indexes/css.json`
- per-page `page.json`, `extraction.json`, `regions.level1.json`, `regions.level2.json`
- per-page screenshot directories

## 8. Troubleshooting

### No plugin connection
- run `ensure`
- run `health`
- confirm the plugin is open in Figma Desktop
- if the plugin has not been imported yet, use `<skill>/plugin/manifest.json`

### No pages returned by bundle extraction
- for `extract-pages`, verify page names/IDs
- for `extract-selected-pages-bundle`, verify each page still has its own selection

### Query errors on bundle caches
- if the bundle has multiple pages and you need a page-specific tree/subtree-style query, pass `--page <pageId-or-name>` where supported or query `pages` first

### CSS unavailable
- continue with structural extraction + screenshots + regions
- CSS hints are supplemental, not required for success
