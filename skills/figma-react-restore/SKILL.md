---
name: figma-react-restore
description: Use this skill whenever the user asks to restore, implement, compare, verify, or repair a Figma design in an existing React, Next.js, Vite React, Remix, or similar React project. This skill runs a local Figma plugin/runtime workflow, extracts the selected Figma frame or region, builds minimal restoration evidence, verifies a React route with browser screenshots and DOM/style checks, and produces repair plans for Agent-driven high-fidelity React page restoration.
---

# Figma React Restore

Use this skill to restore a Figma selection/frame into an existing React project. This is a new workflow and does not use the old `figma-to-code` command surface.

## Core Invariants

Always keep these rules in working memory, even when detailed instructions live in reference files:

- Prefer deterministic CLI/runtime evidence over manual visual judgment. The Agent edits React code; the runtime produces extraction artifacts, screenshots, visual diffs, DOM/style checks, verification reports, and repair plans.
- Read `agent-brief.json` first for each repair round. Open the full-page diff at `artifactPaths.diffPath` before region crops. Then process `mustReadVisualEvidence` one item at a time: open that item's `expectedPath` and `diffPath`, repair the source `regionId`/`nodeId`, and use `scope`/`evidenceRegionId`/`box` to understand exact-region vs expanded/section context. Avoid bulk-loading all region images. If the current required images cannot be opened, stop and report `blocked`. Read `text-manifest.json` before editing visible copy; it is the authoritative Figma text source.
- Visible text must exactly match `text-manifest.json`: do not guess text from screenshots, preserve spelling/casing/punctuation/numbers/brand words, and fix `text-content` failures before layout, assets, or color tuning.
- Do not read `extraction.raw.json`, `design-ir.json`, `trace.zip`, all region crops, or full DOM/style evidence unless `agent-brief.json` names a specific failure that needs that artifact.
- Never pass verification by rendering the Figma baseline screenshot, a full-page raster image, a large section slice, or any `allowedUse: "reference-only"` asset as implementation content.
- Keep the artifact root inside the target React project: `<react-project>/.figma-react-restore`. Use the same `--project <react-project>` across `doctor`, `service`, `sessions`, `extract`, `build-ir`, `verify`, and `restore`.
- Add `data-figma-node` to important DOM nodes where practical so verification can map Figma regions/text nodes back to React elements.
- Stop and report `blocked` states instead of guessing missing design evidence, inventing assets, or endlessly chasing no-improvement visual diffs.
- Do not delete `.figma-react-restore/` before final verification and user acceptance; after acceptance, clean only the active project-scoped artifact root and only services started for this task.

## Reading Router

Use the smallest reference set needed for the current task. Do not load every reference upfront.

Before running any extraction, verification, or restore CLI command, read `references/workflow.md` once for project-root and service-lifecycle rules.

| Situation | Read |
|---|---|
| Starting or operating the end-to-end workflow | `references/workflow.md` |
| Need to understand artifacts, reports, evidence levels, or token budget | `references/evidence.md` |
| Patching React/CSS from a repair plan | `references/implementation-order.md` |
| Handling images, icons, photos, `reference-only` assets, or screenshot-overlay failures | `references/assets.md` |

## Command Resolution

Use `figma-react-restore` when the bin is on `PATH`. If it is unavailable, run the CLI through this skill directory:

```bash
node <skill-dir>/dist/cli/index.js <command>
```

If dependencies are missing, run `npm install` inside the skill directory. If `dist/` is missing or source changed, run `npm run build` inside the skill directory.

## Default Loop

At a high level:

1. Run preflight and extraction from the React project root.
2. Build restoration evidence for the extracted run.
3. Run `restore` or `verify` against the target route.
4. Read `agent-brief.json`, open the full-page diff, process `mustReadVisualEvidence` expected/diff pairs one at a time, read `text-manifest.json`, and inspect the relevant React/CSS files.
5. Patch the real UI, rerun verification, and repeat until `passed` or `blocked`.

Detailed commands and service lifecycle rules are in `references/workflow.md`.

## Stop Conditions

Stop and report the runtime status when it returns:

- `passed`: summarize artifacts and remaining known deviations if any.
- `needs-initial-implementation`: build the first live React/CSS implementation for the route, then rerun `restore`; do not treat this baseline assessment as a repair iteration.
- `needs-agent-patch`: read the brief/manifest, patch the real UI, and rerun `restore`. `--max-iterations` counts only repair attempts after the baseline/initial implementation assessment.
- `blocked`: stop and inspect `blockedReason` or the top failure category.

Common `blockedReason` prefixes or failure categories:

- `blocked-insufficient-data` / `insufficient-design-data`: ask for a better Figma selection or screenshot evidence.
- `blocked-environment` / `blocked-environment`: fix browser, font, route, dependency, or request failures before editing React code.
- `blocked-no-improvement`: report the best attempt and plateau reason instead of continuing blindly.
- `blocked-max-iterations`: report the latest repair plan and stop unless the user explicitly raises the iteration cap.

## Maintenance Pointers

- Historical docs pointer: `../../docs/figma-react-restore/README.md`
- Long-lived workflow details: `references/`
- Runtime/plugin implementation: `src/` and `plugin/`
