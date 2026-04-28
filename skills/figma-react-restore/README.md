# figma-react-restore

Agent-oriented Figma-to-React restoration skill.

V1 focuses on verifying and repairing an existing React route from Figma selection evidence. It runs one local runtime service for the Figma plugin connection and uses CLI commands for extraction, IR building, browser verification, and repair-plan generation.

## Build

```bash
npm install
npm run build
npm test
npm run test:browser
```

If the bin is not linked, use the built CLI directly:

```bash
node dist/cli/index.js doctor
```

`npm run test:browser` launches local Playwright Chromium and may need to run outside restrictive sandboxes.

## Commands

```bash
figma-react-restore doctor
figma-react-restore service start
figma-react-restore service dev
figma-react-restore sessions
figma-react-restore extract --selection
figma-react-restore build-ir --run <runId>
figma-react-restore verify --project . --route http://localhost:3000 --spec <spec>
figma-react-restore repair-plan --report <report>
figma-react-restore brief --report <report> --plan <repair-plan>
figma-react-restore restore --project . --route http://localhost:3000 --run <runId> --max-iterations 3
```

Run these from the React project root, or pass the same `--project <react-project>` consistently. The artifact root is always `<react-project>/.figma-react-restore`. `doctor` only probes writability and does not create `.figma-react-restore`; `service start/dev` refuses a non-React parent folder so the runtime does not create an unused sibling artifact root.

`build-ir` writes `design-ir.json`, `text-manifest.json`, and `fidelity-spec.json`. `text-manifest.json` is the authoritative source for visible copy; do not infer text from screenshots when Figma text nodes are available.

Image/icon/photo assets must come from extraction artifacts. The plugin exports direct Figma image fills separately from whole-node raster exports so frames can use real image backgrounds with live DOM text overlays. Assets marked `allowedUse: "reference-only"` are visual evidence only and must not be rendered in the React page. If an expected image asset is missing, rerun extraction; do not draw or replace it with a lookalike.

If exact text, DOM boxes, and computed typography match but text-region pixels still differ, the verifier records a font-rendering warning instead of forcing more text repair. Install the design font locally for closer raster fidelity, or continue restoring non-font layout/assets/colors.

Font package differences only relax raster comparison. CSS font family, size, weight, line-height, letter spacing, and color are still verified against extracted Figma style evidence.

By default, `verify` and `repair-plan` print a compact summary and write `agent-brief.json`. Text-content failures are prioritized before layout and typography tuning. Use `--full-report` or `--full-plan` only when debugging the verifier itself.

## Development Service

Use hot restart while iterating on the skill service:

```bash
npm run dev:service -- --project <react-project>
```

`service dev` runs `tsc --watch`, watches `dist/**/*.js`, and restarts only the runtime service process after rebuilds. The Figma plugin reconnects automatically after service restarts.

`service start` binds to the fixed local endpoint `http://localhost:49327`. The development plugin manifest and UI are intentionally pinned to this endpoint, so V1 does not expose a custom port in the CLI. It does not hot-reload the Figma plugin UI/main script; relaunch or re-import the development plugin after changing files under `plugin/`.

## Figma plugin

Import `plugin/manifest.json` in Figma Desktop via Plugins -> Development -> Import plugin from manifest.

Start the runtime service first, then open the development plugin. The plugin auto-registers the current Figma session, uses EventSource when available, and falls back to polling without requiring token entry or Register/Event button clicks.

The plugin is intentionally a local development plugin. It uses Figma Design plugin APIs and local-only `devAllowedDomains`; it does not require Dev Mode, REST API access, Marketplace publishing, or plugin payments. Starter plan files are supported; Organization or Enterprise files may still be subject to Figma seat/admin restrictions.
