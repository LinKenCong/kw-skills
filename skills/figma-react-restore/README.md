# figma-react-restore

Agent-oriented Figma-to-React restoration skill.

V1 focuses on verifying and repairing an existing React route from Figma selection evidence. It runs one local runtime service for the Figma plugin connection and uses CLI commands for extraction, IR building, browser verification, and repair-plan generation.

## Build

```bash
npm install
npm run build
```

If the bin is not linked, use the built CLI directly:

```bash
node dist/cli/index.js doctor
```

## Commands

```bash
figma-react-restore doctor
figma-react-restore service start
figma-react-restore sessions
figma-react-restore extract --selection
figma-react-restore build-ir --run <runId>
figma-react-restore verify --project . --route http://localhost:3000 --spec <spec>
figma-react-restore repair-plan --report <report>
figma-react-restore restore --project . --route http://localhost:3000 --run <runId>
```

## Figma plugin

Import `plugin/manifest.json` in Figma Desktop via Plugins -> Development -> Import plugin from manifest.
