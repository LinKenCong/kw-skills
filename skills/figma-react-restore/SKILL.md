---
name: figma-react-restore
description: Use this skill whenever the user asks to restore, implement, compare, verify, or repair a Figma design in an existing React, Next.js, Vite React, Remix, or similar React project. This skill runs a local Figma plugin/runtime workflow, extracts the selected Figma frame or region, builds minimal restoration evidence, verifies a React route with browser screenshots and DOM/style checks, and produces repair plans for Agent-driven high-fidelity React page restoration.
---

# Figma React Restore

Use this skill to restore a Figma selection/frame into an existing React project. This is a new workflow and does not use the old `figma-to-code` command surface.

## Core Rule

Prefer the deterministic CLI/runtime over manual judgment. The Agent edits React code, but the runtime produces extraction artifacts, screenshots, visual diffs, DOM/style checks, verification reports, and repair plans.

Read `agent-brief.json` first. Read `text-manifest.json` before editing visible copy; it is the authoritative Figma text source. Do not read `extraction.raw.json`, `design-ir.json`, `trace.zip`, all region crops, or full DOM/style evidence unless the brief names a specific failure that needs that artifact.

## Exact Text Rule

Visible text must come from Figma text nodes, not from screenshot guessing. Preserve exact spelling, casing, punctuation, numbers, and brand words from `text-manifest.json`, even if they look unusual. Do not "fix" design copy such as casing or typos unless the user explicitly requests editorial correction.

The verifier treats text content as a hard gate and typography as a tolerant visual gate:

- fix `text-content` failures before layout, font metrics, assets, and color tuning
- use `text-manifest.json` for expected strings; use screenshots only to locate placement or detect missing evidence
- if exact text, DOM box, and computed typography already match but text pixel diff remains because the design font is not installed or renders differently, do not keep chasing that text diff; note the font limitation to the user and continue repairing non-font layout/assets/colors
- if a Figma text node is missing from the manifest, report `blocked-insufficient-data` or ask for re-extraction instead of inventing copy
- add `data-figma-node` to important text elements so exact text checks can map DOM back to Figma TextNode ids

## No Screenshot Overlay

Never pass verification by placing the Figma-exported screenshot, full-page raster image, or large cropped bitmap as the page background or foreground overlay.

Forbidden shortcuts:

- using the baseline screenshot as `<img>`, CSS `background-image`, canvas, SVG image, or absolutely positioned overlay to mimic the full page
- slicing the design into large raster blocks to bypass layout, typography, color, and asset implementation
- hiding real DOM content under a screenshot while keeping only invisible or minimal fake DOM nodes for verification
- tuning opacity, blend modes, z-index, clipping, or transforms to make a screenshot cover the rendered page

Allowed asset use:

- export and use real image/icon/photo assets that exist as assets in the design
- prefer SVG for real vector/icon/logo assets; use PNG fallback only when SVG rendering is inaccurate or unsupported by the target component stack
- use small decorative raster assets when they correspond to actual design elements
- use extracted thin decorative strips/patterns/dividers/borders when they are explicit design assets, even if they span the viewport width; this is not the same as slicing whole sections
- use extracted Figma image-fill assets for frames that have image fills, while keeping descendant text as live DOM/CSS
- use the full Figma screenshot only as verification evidence, never as implementation content
- treat extracted assets with `allowedUse: "reference-only"` as visual evidence only; do not import them, render them, or set them as CSS backgrounds in the React page

If a required image/icon/photo is missing from artifacts, do not draw, hallucinate, gradient-fill, CSS-paint, or source a lookalike image to pass visual diff. Re-run extraction first. If the plugin still cannot extract that image, finish the non-image layout/text/style work and report the missing asset to the user as blocked input.

The implemented React page must be real, maintainable UI: semantic DOM, reusable components where appropriate, responsive layout, live text, CSS styles, and actual assets.

## Command Resolution

Use `figma-react-restore` when the bin is on `PATH`. If it is unavailable, run the CLI through this skill directory:

```bash
node <skill-dir>/dist/cli/index.js <command>
```

If dependencies are missing, run `npm install` inside the skill directory. If `dist/` is missing or source changed, run `npm run build` inside the skill directory.

## Project Root Rule

The artifact root belongs to the target React project root: `<react-project>/.figma-react-restore`.

- run commands from the React project root, or pass the same `--project <react-project>` to `doctor`, `service start/dev`, `sessions`, `extract`, `build-ir`, `verify`, and `restore`
- do not run `service start` from a parent folder that only contains the app as a child; use `--project ./app` or `cd app` first
- `doctor` is a non-mutating preflight and must not create `.figma-react-restore`; the runtime creates it only when the service/run actually needs artifacts
- if two `.figma-react-restore` folders appear, the one containing `service.json` or `runs/<runId>/run.json` is the active root; an empty sibling/parent folder is stale and should not be used

## Runtime Service Lifecycle

The runtime service is only needed for Figma Desktop plugin connection and extraction. After `extract` finishes, `build-ir`, `verify`, `repair-plan`, `brief`, and `restore` read project artifacts directly and do not require the service.

- start `figma-react-restore service start` only when a plugin session or extraction is needed; do not keep it running during React implementation or verification loops
- keep a handle to the service process you start; avoid orphaning it with unmanaged `nohup`, detached shells, or background processes without cleanup
- after `figma-react-restore extract --selection` returns a terminal job state, stop the service before running `build-ir`; keep `.figma-react-restore/runs/<runId>/` intact
- if multiple immediate extractions are needed, keep the service only across those extraction commands, then stop it before code repair begins
- if a service was already running before this task, do not terminate it unless the lockfile proves it is this project's `figma-react-restore` service and it is safe to close; otherwise report the existing service and leave it running

## Default Workflow

1. Run `figma-react-restore doctor` from the React project root.
2. Start the runtime service only for plugin connection and extraction:
   ```bash
   figma-react-restore service start
   ```
   During skill development, use `figma-react-restore service dev` instead. It rebuilds TypeScript and restarts the runtime service when `dist/**/*.js` changes.
3. In Figma Desktop, run the `Figma React Restore` development plugin. It connects automatically to `http://localhost:49327`; no token, Register button, or Event button is required.
4. Confirm the plugin session:
   ```bash
   figma-react-restore sessions
   ```
5. Select one frame/component/region in Figma, then extract:
   ```bash
   figma-react-restore extract --selection
   ```
6. Stop the runtime service after extraction completes. Do not delete `.figma-react-restore/` here; the run artifacts are needed for build, verification, and user acceptance.
7. Build restoration evidence:
   ```bash
   figma-react-restore build-ir --run <runId>
   ```
8. Verify or restore the React route:
   ```bash
   figma-react-restore restore --project . --route http://localhost:3000 --run <runId> --max-iterations 3
   ```
9. Read `agent-brief.json` and `text-manifest.json` first, patch the React code, then rerun `restore` until it passes or reports `blocked`.

Token budget rule: for each repair round, read `agent-brief.json`, `text-manifest.json`, and the relevant React/CSS files first. Open `repair-plan.json`, `report.json`, or DesignIR only when a listed `nodeId`, `regionId`, `selector`, or evidence path is insufficient.

## Restoration Order

Use one canonical order for implementation and repair. Establish route state/scale first, then treat exact text as a hard gate before layout tuning:

1. page shell and route state
2. exact visible text content from `text-manifest.json`
3. macro layout and section boxes
4. region layout, padding, gaps, alignment
5. typography metrics with tolerance
6. image/icon assets and crop
7. color, borders, radius, shadow, gradients
8. responsive and interaction polish

Do not chase color/shadow diffs before layout and text wrapping are stable.

## Design Parameter Adoption

Prefer adaptive implementation using extracted design parameters over raster imitation:

- translate Figma layout evidence into CSS layout: flex/grid, container widths, padding, gaps, alignment, min/max sizes, and responsive constraints
- translate typography evidence into live text styles: font family, font size, weight, line-height, letter spacing, max-width, and wrapping
- translate visual tokens into CSS: colors, gradients, borders, radius, shadows, opacity, and spacing variables
- translate assets into correct `<img>`, SVG, icon components, or CSS masks only when they represent actual image/vector assets
- choose `preferredFormat: "svg"` assets first when available, and keep `fallbackPath` PNG as a compatibility fallback rather than the default
- preserve existing project conventions and design system primitives when they can express the Figma parameters accurately

Font package availability is allowed to affect raster appearance only. CSS `font-family`, `font-size`, `font-weight`, `line-height`, `letter-spacing`, text transform, and text color must still match the extracted Figma style evidence within verifier tolerance.

The goal is not just pixel similarity for one screenshot. The result should adapt to reasonable viewport/content changes while retaining the design's structure and style parameters.

## React Code Mapping

When implementing or repairing elements, add `data-figma-node` attributes on important DOM nodes where practical:

```tsx
<section data-figma-node="88:1" className="hero">
```

This lets the verifier connect Figma regions to DOM boxes and produce more precise repair plans.

## Stop Conditions

Stop and report the runtime status when it returns:

- `passed`: summarize artifacts and remaining known deviations if any.
- `blocked-insufficient-data`: ask for a better Figma selection or screenshot evidence.
- `blocked-environment`: fix browser, font, route, or dependency issues before editing code.
- `blocked-no-improvement`: report the best attempt and plateau reason instead of continuing blindly.
- `blocked-max-iterations`: report the latest repair plan and stop unless the user explicitly raises the iteration cap.

## Final Cleanup Rule

After final verification passes and the user confirms acceptance, automatically clean the project-scoped runtime artifacts and close any remaining local plugin runtime service. Do not ask for a second cleanup confirmation after acceptance.

- the normal flow should already stop `figma-react-restore service start` or `figma-react-restore service dev` immediately after extraction; at final cleanup, close only a still-running service that was started for this task
- if needed, terminate the `pid` in `<react-project>/.figma-react-restore/service.json` only after confirming it belongs to this project's `figma-react-restore` service
- remove `<react-project>/.figma-react-restore/` after the service exits
- never delete outside the active React project artifact root; do not clean before final verification and user acceptance because the artifacts are evidence
- if cleanup is blocked by permissions or a non-owned/shared service, report the exact path or PID that still needs manual cleanup

## References

- Design: `../../docs/figma-react-restore/design.md`
- V1 implementation spec: `../../docs/figma-react-restore/v1-implementation-spec.md`
- Figma plugin validation: `../../docs/figma-react-restore/figma-plugin-validation.md`
