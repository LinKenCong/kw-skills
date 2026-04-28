---
name: figma-react-restore
description: Use this skill whenever the user asks to restore, implement, compare, verify, or repair a Figma design in an existing React, Next.js, Vite React, Remix, or similar React project. This skill runs a local Figma plugin/runtime workflow, extracts the selected Figma frame or region, builds minimal restoration evidence, verifies a React route with browser screenshots and DOM/style checks, and produces repair plans for Agent-driven high-fidelity React page restoration.
---

# Figma React Restore

Use this skill to restore a Figma selection/frame into an existing React project. This is a new workflow and does not use the old `figma-to-code` command surface.

## Core Rule

Prefer the deterministic CLI/runtime over manual judgment. The Agent edits React code, but the runtime produces extraction artifacts, screenshots, visual diffs, DOM/style checks, verification reports, and repair plans.

## Command Resolution

Use `figma-react-restore` when the bin is on `PATH`. If it is unavailable, run the CLI through this skill directory:

```bash
node <skill-dir>/dist/cli/index.js <command>
```

If dependencies are missing, run `npm install` inside the skill directory. If `dist/` is missing or source changed, run `npm run build` inside the skill directory.

## Default Workflow

1. Run `figma-react-restore doctor` from the React project root.
2. Start the runtime service if needed:
   ```bash
   figma-react-restore service start
   ```
3. In Figma Desktop, run the `Figma React Restore` development plugin and connect it to the service token printed by the CLI.
4. Confirm the plugin session:
   ```bash
   figma-react-restore sessions
   ```
5. Select one frame/component/region in Figma, then extract:
   ```bash
   figma-react-restore extract --selection
   ```
6. Build restoration evidence:
   ```bash
   figma-react-restore build-ir --run <runId>
   ```
7. Verify or restore the React route:
   ```bash
   figma-react-restore restore --project . --route http://localhost:3000 --run <runId>
   ```
8. Read `repair-plan.json`, patch the React code, then rerun `restore` until it passes or reports `blocked`.

## Restoration Order

Always repair from large to small:

1. page shell and route state
2. macro layout and section boxes
3. region layout, padding, gaps, alignment
4. typography and content
5. image/icon assets and crop
6. color, borders, radius, shadow, gradients
7. responsive and interaction polish

Do not chase color/shadow diffs before layout and text wrapping are stable.

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

## References

- Design: `../../docs/figma-react-restore/design.md`
- V1 implementation spec: `../../docs/figma-react-restore/v1-implementation-spec.md`
