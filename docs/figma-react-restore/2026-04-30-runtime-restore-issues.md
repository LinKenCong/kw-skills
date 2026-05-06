# figma-react-restore Runtime Restore Issues - 2026-04-30

## Context

Observed while restoring the test project:

- Project: `/Users/juzixin/CODE_TEMPORARY/test-skills/app`
- Run: `.figma-react-restore/runs/run_mol9rx1u_2421846f`
- Attempt: `.figma-react-restore/runs/run_mol9rx1u_2421846f/restore/attempts/003`

This document records the current product and implementation issues before further fixes.

## Issues

### 1. Missing Per-Command And Runtime Logs

Current run artifacts include structured outputs such as `run.json`, `artifacts.json`, `extraction.raw.json`, `design-ir.json`, `fidelity-spec.json`, `report.json`, `agent-brief.json`, and image artifacts. They do not provide a single chronological debug log for each CLI command, service lifecycle event, plugin job, artifact upload, and output path.

Observed symptom:

- Extraction warning says to inspect runtime service logs, but there is no stable run-local service log path.
- Asset upload failure only appears as a warning in `extraction.raw.json`:
  - `ASSET_ARTIFACT_UPLOAD_FAILED`
  - `Maximum call stack size exceeded`

Needed direction:

- Write command/service/job logs under `.figma-react-restore/logs/` or the run directory.
- Include command argv, cwd, project root, pid, service start/stop decisions, session id, job id, run id, artifact upload start/success/failure, generated file paths, and redacted error stack traces.
- Never log `adminToken`, `jobSecret`, or other secrets.

### 2. Service Lifecycle Causes Too Much User Authorization Friction

The managed extraction flow starts and stops a local runtime service. In Codex sandboxed environments, writing outside the current workspace, listening on localhost, and terminating a process may require user authorization.

Observed symptom:

- Skill execution now asks for authorization more often than earlier versions.
- The user experiences service start/kill as extra interaction steps.

Likely causes:

- Target project is outside the current repo writable root.
- `extract --manage-service` can still require local service start/stop side effects.
- Manual `service start`, `sessions`, `extract`, and `service stop` flows multiply interactions.

Needed direction:

- Prefer a single managed extraction command.
- Hide service lifecycle from the skill user when possible.
- Add idle self-exit for managed services to reduce explicit kill/stop operations.
- Make CLI output include `serviceStarted`, `serviceStopped`, and `logPath`.
- Document that Codex writable roots affect authorization prompts.

### 3. Restore Quality Regressed Or Did Not Improve

Attempt 003 shows a failed restore with visible regressions:

- `final-report.json` status: `blocked`
- Blocked reason: `blocked-max-iterations: reached 3 restore attempts`
- `report.json` failure counts:
  - `layout-spacing`: 48
  - `asset-missing`: 8
  - `color`: 2

Main observed quality issues:

- Footer logo mark is visually missing at the expected position.
- Text visual styling/casing differs substantially from the Figma baseline.
- Agent brief prioritizes broad `layout-spacing` failures and does not clearly identify the missing/mispositioned logo as a concrete fix.

### 4. Text Case Is Not Enforced As Visual Text Evidence

Figma text evidence includes `textCase: "UPPER"` for multiple text nodes, but verifier text checks pass because they compare the raw characters instead of the rendered visual casing.

Observed examples:

- Figma text node `20:534`: characters `Train Hard. Live Better`, `textCase: UPPER`
- Expected visual: `TRAIN HARD. LIVE BETTER`
- Actual page: `Train Hard. Live Better`

Current verifier behavior:

- `textResults` pass.
- Pixel diffs are often downgraded to `TEXT_PIXEL_DIFF_TOLERATED_FONT_RENDERING`.

Needed direction:

- Treat Figma `textCase` as hard text/style evidence.
- Check rendered text or computed `text-transform`.
- Do not classify text-case mismatch as font-rendering tolerance.

### 5. Asset Policy Creates Noise And Some False Severity

The run contains asset extraction warnings:

- `ASSET_SCAN_TRUNCATED`
- `ASSET_ARTIFACT_UPLOAD_FAILED`
- `REFERENCE_ONLY_ASSET_EXPORTED`

The verifier reports high-severity `asset-missing` failures even when some image regions visually pass and only asset provenance differs.

Needed direction:

- Deduplicate same-node image-fill and node-export obligations.
- Distinguish visual missing assets from provenance-only violations.
- Keep true missing/blank logo or photo failures high severity.
- Downgrade visually passing but non-extracted-source cases to provenance warnings unless policy requires hard provenance.

### 6. Region Crop Artifacts Are Excessive

Attempt 003 writes a large number of region crop files under:

`restore/attempts/003/regions/`

Each region currently writes expected, actual, and diff crops. This is useful for debugging but can be excessive for normal agent repair loops.

Risks:

- Artifact directories become noisy.
- Agent briefs may point to many image paths.
- If an agent opens too many crops, token and image-processing cost can grow quickly.

Needed direction:

- Keep full-page `expected.png`, `actual.png`, and `diff.png`.
- For region artifacts, default to writing only the largest-difference Top 5 visual evidence pairs.
- Each Top 5 pair must include:
  - `node-<safeNodeId>.expected.png` or `region-<safeRegionId>.expected.png`
  - `node-<safeNodeId>.diff.png` or `region-<safeRegionId>.diff.png`
- Do not use rank-based filenames such as `rank-01.*`; filenames should identify the Figma node/region directly.
- Make `actual` region crops and non-Top-5 crops opt-in debug artifacts.
- Ensure `report.json` still includes enough numeric metadata to repair without opening every crop.
- Ensure `agent-brief.json` makes the Top 5 expected/diff images mandatory repair evidence, not optional debug files.

Observed inventory for attempt 003:

- `regions/` contains 243 PNG files, about 18 MiB total.
- The 243 files are 81 region triples:
  - 81 `*.expected.png` crops, about 6.35 MiB.
  - 81 `*.actual.png` crops, about 6.70 MiB.
  - 81 `*.diff.png` crops, about 4.46 MiB.
- `report.json` has 81 `regionResults`: 78 failed and 3 passed.
- Every `regionResult` currently records `expectedPath`, `actualPath`, and `diffPath`.
- `report.json` has 58 failures; 46 failures reference a region `diffPath` as `evidencePath`.
- `agent-brief.json` lists only 8 top failed regions and only their `diffPath`.

Conclusion:

- Region expected/actual crops are mostly debug artifacts after comparison.
- Diff crops are the only region images normally surfaced to the repair agent.
- Existing files do not consume LLM tokens by themselves; token/image cost is spent only if an agent opens or embeds those images.
- The current default still creates too much artifact noise and increases the chance that an agent opens unnecessary crops.
- The desired contract is to keep only the Top 5 highest-difference region evidence pairs by default.
- The repair agent must first read the full-page diff, then process retained region evidence one pair at a time.
- For each retained region, the repair agent must read both the expected crop and diff crop before editing that focused target, because the diff shows where the mismatch is and the expected crop shows the target visual.
- The agent should not open all Top 5 region pairs at once; this preserves context and reduces the chance of mixing fixes from unrelated regions.
- Ranking belongs in structured metadata such as `agent-brief.json`, not in filenames. Filenames should stay stable and useful for locating the Figma node or region.

Planned implementation path:

1. Change verification artifact policy so region comparison still computes all region metrics, but only persists Top 5 failed-region visual evidence pairs by default.
2. Name retained files by locator:
   - Prefer `node-<safeNodeId>.expected.png` and `node-<safeNodeId>.diff.png`.
   - Fall back to `region-<safeRegionId>.expected.png` and `region-<safeRegionId>.diff.png`.
3. Do not persist `actual` region crops in the default policy.
4. Add structured `mustReadVisualEvidence` to `agent-brief.json`, containing the Top 5 ordered list with `regionId`, `nodeId`, `diffRatio`, `diffPixels`, `box`, `expectedPath`, and `diffPath`.
5. Update SKILL/reference instructions so repair agents must open the full-page diff first, then process `mustReadVisualEvidence` expected/diff pairs sequentially, one focused fix at a time. If the current pair cannot be opened, explicitly mark it blocked.
6. Preserve a debug/full artifact mode later if needed; the immediate default should optimize normal repair loops.

Implementation status:

- Implemented the default Top 5 region visual evidence retention in `src/verify/report.ts`.
- Added `agent-brief.json.mustReadVisualEvidence` in `src/schema.ts` and `src/summary/agent-brief.ts`.
- Updated `SKILL.md`, `references/evidence.md`, and `references/implementation-order.md` to make full-page-first and one-region-at-a-time visual evidence reading part of the repair contract.
- Added tests for report artifact retention, agent brief must-read evidence, and schema compatibility.

### 7. Region Evidence Can Overfocus On Font Rendering And Tiny Text Slices

The current Top 5 region visual evidence is selected by region-level pixel diff. When local fonts differ from Figma fonts, the largest diffs can be dominated by a few title/text regions. This can make the repair loop repeatedly focus on typography raster differences instead of section-level layout or missing assets.

Observed risk:

- Top region diffs may all be title text slices caused by font package/rendering differences.
- Very small or narrow region crops can be too fragmented to understand the surrounding layout context.
- Repair agents may overfit individual text crops and lose the section-level target.

Needed direction:

- Keep text precision checks, but avoid letting font-rendering-only diffs monopolize Top 5 visual evidence.
- Prefer larger contextual evidence when a failed region is small or text-only:
  - Use the containing section crop when the region belongs to a section.
  - Or expand the crop box around the region with padding/minimum size.
- Rank visual evidence with category diversity or grouping, not only raw diff ratio.
- When text exactness and computed style checks pass, downgrade text-region pixel diffs from must-read Top 5 unless there is a hard text/style mismatch such as wrong casing, wrong font size, missing text, or wrong position.
- Record both the original failed `regionId` and the evidence crop scope, so the agent can locate the precise node while seeing enough surrounding context.

Potential implementation path:

1. Add an evidence crop scope resolver:
   - `region`: exact failed region crop.
   - `expanded-region`: failed region box expanded by padding/min dimensions and clamped to viewport.
   - `section`: nearest containing section region crop when available.
2. For `mustReadVisualEvidence`, include metadata such as source `regionId`/`nodeId`, `evidenceRegionId`, `scope`, and `box`.
3. Use section/expanded crops for small text/icon regions, while retaining precise `nodeId` and `regionId` for targeting.
4. Add diversity rules for Top 5 selection, for example no more than two font-rendering-tolerated text regions unless they have hard text/style failures.
5. Keep full-page diff first so the agent sees global mismatch before opening the contextual section crop.

Implementation status:

- Implemented contextual retained evidence in `src/verify/report.ts`: exact region metrics are still computed for every comparable region, but retained evidence crops can now be `region`, `expanded-region`, or `section`.
- The retained evidence selector ranks by visual impact and limits font-rendering-only text diffs so they cannot fill the Top 5; text/style/layout mismatches remain eligible.
- Retained filenames still use the source node/region locator and do not include rank. Default retained files are expected+diff only; actual region crops remain unpersisted.
- `report.json` region results now record `evidenceRank`, `evidenceScope`, `evidenceRegionId`, and `evidenceBox` when a crop is retained.
- `agent-brief.json.mustReadVisualEvidence` now preserves source `regionId`/`nodeId` and exposes `scope`, `evidenceRegionId`, and `box` for contextual evidence reading.
- Updated tests cover schema compatibility, agent brief contextual metadata, Top 5 expected/diff retention, section crops for tiny text regions, and font-rendering-only evidence limiting.

### 8. Baseline Verification Should Not Consume Repair Iterations

When the target route is empty, missing, or not yet implemented, the first visual comparison is only a baseline/assessment. Counting it as attempt 1 makes `--max-iterations` misleading and can block before the Agent has actually made enough code changes.

Observed risk:

- An empty page can produce a near-total diff and many low-value layout failures.
- The first screenshot can consume one of three default attempts even though no repair has happened yet.
- `blocked-max-iterations` can trigger after fewer real code-modification verification cycles than the user expects.

Needed direction:

- Split restore attempts into phases:
  - `baseline`: first assessment or environment-blocked route check.
  - `repair`: verification after implementation/repair work.
- Count only `phase: "repair"` attempts toward `--max-iterations`.
- If baseline detects a route that is essentially blank or unimplemented, return `needs-initial-implementation` and direct the Agent to build the first live React/CSS implementation before screenshot repair.
- Keep old restore state compatible by treating attempts without `phase` as `repair`.
- Run plateau detection only on repair attempts.

Implementation status:

- Implemented restore attempt `phase`, optional `repairIndex`, and `resultStatus` in `src/schema.ts` and `src/restore/loop.ts`.
- `restore` can now return `needs-initial-implementation` for blank/unimplemented baseline assessments.
- `--max-iterations` and plateau detection now count repair attempts only.
- Updated CLI help, workflow docs, SKILL stop conditions, manual E2E notes, and restore-loop tests.
