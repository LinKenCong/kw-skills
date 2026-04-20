---
name: figma-to-code
description: Extract live Figma design data through a local plugin + bridge (no MCP required), export SVG/PNG assets and screenshots, and translate Figma designs into production frontend code (React, Tailwind, CSS Modules). Use this skill whenever the user mentions Figma URLs, Figma node IDs, design-to-code conversion, pixel-perfect UI restoration, visual implementation from design specs, extracting design tokens, or any task involving translating a Figma design into frontend components — even if they don't explicitly say "Figma" but paste a figma.com link or reference a design file. Also triggers on troubleshooting Figma plugin connections, bridge setup, or extraction issues.
---

# Figma Design-to-Code

Extract design data via a local Figma Desktop plugin + Bridge, then translate into production frontend code. No Figma MCP Server required.

## Locate Skill Directory

Before use, glob for `**/figma-to-code/bridge.mjs` to determine the install path. All subsequent commands use this path. For example, if installed at `/path/to/figma-to-code/`, the bridge client is `/path/to/figma-to-code/scripts/bridge_client.mjs`.

## Workflow Overview

```
Phase 1: Connect → Phase 2: Extract → Phase 3: Implement HTML → Phase 4: Validate HTML
  → Phase 5: Convert (5.1 Analyze → 5.2 Plan → 5.3 Generate → 5.4 Lint → 5.5 Build → 5.6 Dev)
  → Phase 6: Acceptance → Phase 7: Cleanup
```

**Core strategy:** First generate a single-file HTML as the "golden reference", iterate with the user until visually perfect, then convert to the target tech stack with engineering-grade verification (lint → build → dev).

Each phase has explicit completion criteria and user confirmation gates. Do not skip confirmations to jump ahead.

**Interaction rule:** Always use AskUserQuestion with predefined options for user confirmations and choices. Avoid free-text prompts like "tell me when ready" — provide clickable options instead.

**Data rule:** All extraction data is cached under `<skill>/cache/`. After extraction, use `query` subcommands to read pruned data on demand — never read `extraction.json` directly (it is too large). The `cacheDir` from extraction output is passed as `--cache` to all query commands.

---

## Phase 1: Connect

Goal: Ensure both the Bridge server and the Figma plugin are operational.

### 1.1 Detect and Start Bridge

```bash
node <skill>/scripts/bridge_client.mjs ensure
```

Check the return value:
- `ok: true` → Bridge is ready. Read the `pid` field from the JSON response and inform the user: **Bridge is running on `localhost:3333` (PID: <pid from response>)** so they can manage it manually later if needed.
- Startup failure → Prompt user to check if port 3333 is occupied and confirm Node.js ≥ 18.

### 1.2 Check Plugin Connection

Inspect the `health.pluginConnected` field:
- `true` → Connection is healthy, proceed to Phase 2.
- `false` → Instruct the user to launch the plugin in Figma Desktop (menu: Plugins → Development → Figma Bridge Extractor) and wait until the plugin panel shows "Bridge SSE Connected".

If the user encounters plugin installation issues, read `references/plugin-install.md` for guidance.

---

## Phase 2: Extract

Goal: Retrieve design data from Figma and confirm the data is usable.

### 2.1 Determine Extraction Method

If the user has already provided a figma.com URL, use the URL method directly without asking. Otherwise, ask the user which method to use:

| Method | Use When | Command |
|--------|----------|---------|
| **Figma URL** | User provides a figma.com link | `extract "<url>" --assets --screenshot` |
| **Current Selection** | User has selected an element in Figma | `extract-selection --assets --screenshot` |

If the user chooses "Current Selection", confirm they have already selected the target element in Figma Desktop before running the extraction.

### 2.2 Check Cache

Before extracting, check if `cache/<fileKey>/<nodeId>/extraction.json` already exists (`:` in nodeId is replaced with `-` in the path). If it exists and the user does not need a refresh, use the cached data directly.

### 2.3 Run Extraction

```bash
node <skill>/scripts/bridge_client.mjs extract-selection --assets --screenshot
# or
node <skill>/scripts/bridge_client.mjs extract "<figma-url>" --assets --screenshot
```

After extraction, save the `cacheDir` field from the response — all subsequent `query` commands use this path via `--cache <cacheDir>`.

### 2.4 Handle Extraction Failures

| Error | Cause | Action |
|-------|-------|--------|
| `NO_PLUGIN_CONNECTION` | Figma Desktop plugin not running or SSE disconnected | Return to Phase 1.2, prompt user to relaunch the plugin |
| `node not found` | Invalid nodeId or file not open in Figma | Prompt user to open the corresponding file in Figma Desktop |
| Timeout (60s) | Node tree too large | Suggest user select a smaller subtree and re-extract |

### 2.5 Report Extraction Results

- **Node name** and **type** (GROUP / FRAME / COMPONENT etc.)
- **Dimensions** (width × height)
- **Child node count** and key structural overview
- **Exported asset paths** (SVG/PNG file locations)
- **Screenshot path** (if available)

### 2.6 Confirm Result and Fidelity Mode

Ask the user to confirm the extraction result AND choose a design fidelity mode in a single question:

| Option | Meaning |
|--------|---------|
| **High-fidelity** | Pixel-perfect restoration — strict color/font/spacing matching from extraction data |
| **Prototype** | Elements complete + reasonable layout — use project design system for styling, skip pixel-level precision |
| **Re-extract** | Data incomplete or wrong element selected, return to 2.1 |

The chosen mode determines behavior in Phase 3 and Phase 4.

---

## Phase 3: Implement HTML

Goal: Generate a single-file HTML as the "golden reference" (code-based source of truth for the design).

HTML is the golden reference: no build, no framework overhead, easy debug cycle.

### 3.1 Understand Structure

```bash
node <skill>/scripts/bridge_client.mjs query tree --cache <cacheDir> --frame <chosen_frame> --depth 3
```

Analyze the component tree to understand the page layout and section hierarchy.

### 3.2 Establish Design Variables

```bash
node <skill>/scripts/bridge_client.mjs query palette --cache <cacheDir> --frame <chosen_frame>
```

Map the deduplicated colors, fonts, and spacing values to CSS custom properties. In **prototype mode**, skip pixel-level precision — use reasonable values.

### 3.3 User Confirms Plan

Present the section breakdown and design token summary to the user. Wait for approval before writing code.

### 3.4 Implement the HTML File

**Progressive loading (mandatory):** First run `query tree --depth 1` to get the page skeleton (section names, sizes, offsets). Then query each section's subtree one at a time as you implement it — do not load all subtrees at once.

Query each section's subtree data and write a single `index.html` file:

```bash
node <skill>/scripts/bridge_client.mjs query subtree <nodeId> --cache <cacheDir>
```

**Output rules:**
- Single file with embedded `<style>` block and Google Fonts `<link>`
- Use native CSS with CSS custom properties (`:root { --color-X: ... }`)
- No frameworks, no preprocessors, no build tools
- Image areas use placeholder backgrounds (gradient or solid color matching design tone)
- Save to `<cacheDir>/golden-reference.html` — all intermediate artifacts belong in the cache directory, not the project directory

> **Before writing any code**, read `references/coding-guide.md` — especially Section 6 (Common Failures) and Section 7 (Worked Example).

**Core principles:**
- Query data describes **design intent**, not final code — translate to semantic HTML + CSS
- In **high-fidelity mode**: match every extracted value exactly (font, size, weight, spacing, color)
- In **prototype mode**: focus on element completeness and logical layout
- Never read `extraction.json` directly — always use `query` commands
- **Alignment rule**: when multiple sections share a visual boundary (e.g., image/text split at the same x-position), ensure fixed widths match across sections to produce pixel-aligned edges

---

## Phase 4: Validate HTML

Goal: Automatically compare the golden reference HTML against the design screenshot using layered validation — pattern pre-scan, region-based visual diff, and adaptive fix loop with cumulative memory.

### 4.0 Pattern Pre-Scan

Before any visual diff, run the static pattern scanner to detect known failure modes:

```bash
node <skill>/scripts/pattern-scan.mjs \
  --html <cacheDir>/golden-reference.html \
  --json
```

This detects common CSS/layout mistakes (e.g., `flex: 1` without `min-width: 0`, fixed width on outer container, large font-size without `clamp()`).

If the output contains detected patterns:
1. Read each pattern's `fix` instruction
2. Apply the fixes to `golden-reference.html`
3. This is a pure text-based operation — no images needed

If no patterns detected: skip to 4.1.

### 4.1 Region-Based Visual Diff

First, get the page section layout for region-based analysis:

```bash
node <skill>/scripts/bridge_client.mjs query tree --cache <cacheDir> --frame <chosen_frame> --depth 1
```

From the tree output, construct a regions JSON array using each top-level child's `name`, `offset: [x, y]`, and `size: [w, h]`:

```json
[{"name": "Hero section", "x": 0, "y": 0, "w": 1280, "h": 480}, ...]
```

Then run the visual diff with regions:

```bash
node <skill>/scripts/visual-diff.mjs \
  --design <cacheDir>/screenshot.png \
  --html <cacheDir>/golden-reference.html \
  --out-dir <cacheDir> \
  --regions '<regions-json>' \
  --json
```

This outputs:
- `mismatchRate` — global percentage of differing pixels
- `regions[]` — per-region mismatch rates sorted worst-first, with cropped diff images for the worst 1-2 regions

If `mismatchRate ≤ 5%`: proceed directly to 4.3.

### 4.2 Adaptive Fix Loop

If `mismatchRate > 5%`, enter the fix loop.

**Initialize:** `roundMemory = []` (a JSON array you maintain in context across rounds).

**Each round:**
1. Read the region diff JSON output — focus on the region(s) with the highest `mismatchRate`
2. Read the cropped diff image(s) for the worst 1-2 regions (not the full-page diff)
3. Review `roundMemory` — avoid repeating changes that previously caused regressions
4. Fix `golden-reference.html` targeting the worst region first
5. Re-run `visual-diff.mjs --regions` (same command as 4.1)
6. Append a memory entry:
   ```json
   {
     "round": N,
     "changesMade": "brief description of what was changed",
     "beforeGlobalRate": X.X,
     "afterGlobalRate": Y.Y,
     "regionDeltas": [
       {"name": "hero", "before": 18.3, "after": 3.1},
       {"name": "footer", "before": 8.0, "after": 9.2, "regressed": true}
     ]
   }
   ```
7. Check convergence:
   - **Continue** if improvement ≥ 1% (absolute) AND `mismatchRate > 5%`
   - **Stop** if improvement < 1% (stagnant) OR `mismatchRate ≤ 5%` (target met) OR round ≥ 5 (hard limit)

> **Note:** Font rendering differences between Figma (Skia) and browsers produce ~1-3% baseline noise. A 5% threshold accounts for this.

### 4.3 User Confirmation Gate

Present the final results to the user:
- Current global mismatch rate
- Per-region mismatch breakdown (from regions output)
- Side-by-side: design screenshot vs HTML screenshot
- Number of auto-fix rounds performed and convergence status

Ask the user to confirm:

| Option | Action |
|--------|--------|
| **HTML looks correct** | Proceed to Phase 5 |
| **Issues found** | User describes problems → fix HTML → return to 4.1 |
| **Re-extract** | Data issue, return to Phase 2 |

---

## Phase 5: Convert

Goal: Convert the golden reference HTML into production-quality framework code that passes lint, build, and dev verification.

Use `<cacheDir>/golden-reference.html` as the **sole style source** — do not re-query extraction data. Read `references/coding-guide.md` Section 12 before starting.

### 5.1 Analyze Target Project

Ask the user:
1. Target tech stack (React + Tailwind / Next.js + Tailwind / Vue + CSS / Svelte / etc.)
2. New project or existing project?
3. If existing: project path and any constraints

Then **read the project to understand its conventions**:
- `package.json` → `scripts` (identify which scripts handle lint, build, dev), `dependencies`, `devDependencies`
- Framework config: `next.config.*`, `tsconfig.json`, `tailwind.config.*`, `vite.config.*`, etc.
- Existing component directory structure → naming conventions (PascalCase files? index barrels?), export patterns (default vs named), style approach (Tailwind classes? CSS Modules? styled-components?)

**Infer verification commands** from `package.json` scripts:
- Lint command: look for scripts containing `lint`, `eslint`, `biome check`
- Build command: look for scripts containing `build`, `tsc`, `next build`
- Dev command: look for scripts containing `dev`, `start`, `serve`

Present the inferred commands to the user for confirmation. If any command is ambiguous or missing, ask the user to specify.

### 5.2 Plan Component Structure

Based on the golden HTML structure and the project's existing patterns, propose a component breakdown:
- List each component with its target file path, responsibility, and props interface
- `INSTANCE`/`COMPONENT` nodes from extraction → standalone components; repeated HTML structures → reusable components
- Follow the project's existing directory organization (do not invent a new structure)

Present the plan to the user and wait for approval before generating code.

### 5.3 Generate Code

Implement components following the approved plan:
- Match the project's existing code style (naming, exports, imports, formatting)
- Preserve every CSS custom property and pixel value from the golden HTML — do not round to framework scale steps
- Apply Section 12 critical pitfalls (Tailwind preflight resets, heading weights, border defaults)
- Each component file should be self-contained and focused (single responsibility)

### 5.4 Lint Verification Gate

Run the lint command confirmed in 5.1.
- **Pass** → proceed to 5.5
- **Fail** → read error output, fix the reported issues, re-run (max 3 auto-fix rounds)
- After 3 failed rounds → output full lint report to user for manual guidance

### 5.5 Build Verification Gate

Run the build command confirmed in 5.1.
- **Pass** → proceed to 5.6
- **Fail** → analyze compiler/type errors, fix, re-run (max 3 auto-fix rounds)
- After 3 failed rounds → output full build error log to user

### 5.6 Dev Verification Gate

Start the dev server using the command confirmed in 5.1. Check for startup errors or runtime exceptions in the console output.
- **Pass (no errors within 5s)** → shut down dev server, proceed to Phase 6
- **Fail** → analyze errors, fix, re-run (max 3 auto-fix rounds)
- After 3 failed rounds → output error details to user

> **Gate progression rule:** Each gate must pass before entering the next. This ensures lint errors are resolved before build errors, and build errors before runtime errors — preventing cascading noise.

---

## Phase 6: Acceptance

Goal: Automatically validate that the target stack implementation matches the golden reference HTML.

### 6.1 Run Automated Validation

```bash
node <skill>/scripts/validate.mjs \
  --reference <cacheDir>/golden-reference.html \
  --target <target-url-or-path> \
  [--threshold 95]
```

Opens both in headless Chrome, matches text nodes, compares computed styles.

| Property group | Tolerance |
|----------------|-----------|
| Dimensions/spacing | ±1px |
| Colors | exact match (rgb values) |
| Fonts | exact match (family + weight) |

### 6.2 Interpret Results

- **Pass rate ≥ threshold** → Auto-pass. Output summary to user.
- **Pass rate < threshold** → Output failed checks. Agent automatically fixes the reported issues, then re-runs validation.
- **Max 3 auto-fix rounds.** If still below threshold after 3 rounds, output full report to user for manual review.

### 6.3 Manual Supplement

If automated validation passes but specific concerns remain, read `references/regression-acceptance.md` for the manual checklist. This covers items that computed-style comparison cannot catch:
- Responsive behavior at different viewports
- Overflow/clipping behavior
- Animation/transition states
- Interaction states (hover, focus)

---

## Phase 7: Cleanup

Goal: Confirm whether to release Bridge resources.

**This phase must be executed regardless of whether the skill succeeded or failed, and regardless of which phase was interrupted.**

### 7.1 Ask User Whether to Stop Bridge

Confirm with the user: should the Bridge be shut down?

- User may want to continue extracting other elements → keep it running. Remind the user that the Bridge is still on `localhost:3333` and can be stopped manually with `lsof -ti:3333 | xargs kill`.
- User has finished all design extraction work → shut it down.

### 7.2 Stop Bridge (after user confirms)

```bash
lsof -ti:3333 | xargs kill 2>/dev/null
```

After shutdown, inform the user that the Bridge has stopped.

---

## Reference Documents (load on demand)

| Scenario | Read |
|----------|------|
| Plugin installation or `NO_PLUGIN_CONNECTION` error | `references/plugin-install.md` |
| Phase 3 HTML implementation (layout, typography, common failures) | `references/coding-guide.md` |
| Phase 5 tech stack conversion pitfalls | `references/coding-guide.md` Section 12 |
| Phase 4.0 pattern pre-scan (static HTML analysis) | `scripts/pattern-scan.mjs --help` |
| Phase 4.1 visual diff (pixel comparison + regions) | `scripts/visual-diff.mjs --help` |
| Phase 4/6 acceptance check (manual supplement) | `references/regression-acceptance.md` |
| Phase 6 automated style validation script | `scripts/validate.mjs --help` |
