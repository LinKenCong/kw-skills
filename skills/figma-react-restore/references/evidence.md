# Evidence And Token Policy

Read this file when you need to understand artifacts, evidence levels, `agent-brief.json`, `text-manifest.json`, reports, repair plans, or why a run is blocked. Do not read full raw extraction, DesignIR, traces, or all crops unless this file and the current brief indicate they are necessary.

## Default Reading Order

For each repair round:

1. Read `agent-brief.json`.
2. Open the full-page diff at `agent-brief.json.artifactPaths.diffPath` to understand the global mismatch.
3. Process `agent-brief.json.mustReadVisualEvidence` sequentially: open one item's `expectedPath` and `diffPath`, repair that target, then move to the next item only if context remains clear.
4. Read `text-manifest.json` before editing any visible copy.
5. Read the relevant React/CSS files.
6. Open `repair-plan.json`, `report.json`, `design-ir.json`, trace evidence, or extra image crops only when a listed `nodeId`, `regionId`, `selector`, or `evidencePath` is insufficient.

The goal is to keep large local evidence out of model context until it is needed.

## Artifact Roles

| Artifact | Role | Default read? |
|---|---|---|
| `agent-brief.json` | Token-optimized status, metrics, top failures, top regions, required visual evidence, next actions, and evidence paths. | Yes |
| `text-manifest.json` | Authoritative visible text from Figma TextNode evidence. | Yes before editing copy |
| `repair-plan.json` | Ordered failures with recommended actions and confidence. | Only when brief is not enough |
| `report.json` | Full verification report: full-page diff, regions, DOM results, text results, failures, warnings. | Only for debugging a specific failure |
| `design-ir.json` | Minimal normalized design evidence: page, regions, texts, assets, colors, typography, layout hints. | Only when report/brief lacks needed Figma parameters |
| `extraction.raw.json` | Full raw extraction payload from the Figma plugin. | Avoid unless debugging extraction itself |
| `trace.zip` | Browser trace for route verification. | Avoid unless environment/rendering is blocked |
| Region crops/diffs | Visual evidence for a specific source region. `agent-brief.json.mustReadVisualEvidence` names the required Top 5 failed-region expected/diff image pairs when available; small text/icon sources may point at a contextual section or expanded-region crop. | After the full-page diff, open one required pair at a time; open extra named crop/diff only as needed |

## Must-Read Visual Evidence

`agent-brief.json.mustReadVisualEvidence` contains up to five retained failed-region evidence pairs that have both `expectedPath` and `diffPath`. Full-page diff remains the first visual evidence to open. Region evidence is selected by visual impact and diversity rather than raw `diffRatio` alone, so tiny font-rendering-only text slices cannot monopolize the Top 5; hard text/style/layout mismatches can still be retained.

Each item includes `rank`, source `regionId`, optional source `nodeId`, `scope`, `evidenceRegionId`, `diffRatio`, `diffPixels`, optional `threshold`, `expectedPath`, `diffPath`, and optional `box`. `scope` is `region`, `expanded-region`, or `section`; for contextual crops, `regionId`/`nodeId` still identify the precise failed source while `evidenceRegionId`/`box` identify the visual crop being opened.

Repair agents must first open the full-page diff, then handle the listed expected/diff pairs as a queue. For each queue item, open that evidence crop's expected image and diff image, make the focused repair for the source `regionId`/`nodeId`, and avoid opening all Top 5 pairs at once. This preserves context and prevents a later fix from being guided by stale visual evidence. Use `rank` only as JSON metadata for reading order; do not derive or rename artifact filenames from it. Filenames keep source node/region locators, not rank. Old reports may not include region `expectedPath`, so the array can be empty. An empty array does not block repair, but a non-empty array whose current item images cannot be opened is a `blocked` state that must be reported.

## Text Evidence

Visible text must come from Figma text nodes, not from screenshot guessing. Preserve exact spelling, casing, punctuation, numbers, and brand words from `text-manifest.json`, even if they look unusual. Do not "fix" design copy such as casing or typos unless the user explicitly requests editorial correction.

If a Figma text node is missing from the manifest, report `blocked-insufficient-data` or ask for re-extraction instead of inventing copy.

## Evidence Levels

| Level | Meaning | Agent behavior |
|---|---|---|
| `L3-structured` | Node tree, screenshot, regions, text, and assets are available. | Full restore loop is valid. |
| `L2-partial` | Some structured node evidence is available. | Repair with lower confidence; open specific evidence only as needed. |
| `L1-visual-only` | Only screenshot evidence is available. | Treat as insufficient for high-confidence restoration; ask for better extraction unless the user accepts lower layout/visual confidence. This never permits guessing exact text or missing assets. |
| `L0-blocked` | No usable screenshot or structured evidence. | Stop and ask for better input. |

## Verification Evidence

The verifier uses multiple gates rather than one aggregate score:

- full-page screenshot diff
- region screenshot diff
- exact text content diff
- DOM bounding box diff
- text computed style diff
- overflow/clipping check
- missing asset check
- prohibited screenshot/large-raster overlay check

Full-page diff is a broad signal. Repair decisions should prioritize exact text, region diff, DOM/style diff, and the repair plan.

## Font Rendering Policy

Exact text content is a hard gate. Typography metrics are checked with tolerance. If exact text, DOM box, and computed typography already match but text-region pixels still differ because the design font is missing or renders differently, do not keep chasing that pixel diff. Note the font limitation to the user and continue repairing non-font layout, assets, and colors.

CSS `font-family`, `font-size`, `font-weight`, `line-height`, `letter-spacing`, text transform, and text color must still match extracted Figma style evidence within verifier tolerance.

## DOM Mapping Evidence

The verifier can produce better repair plans when important elements include `data-figma-node`.

```tsx
<section data-figma-node="88:1" className="hero">
```

Use this on important text, sections, images, and containers where practical. Do not add fake or invisible nodes just to satisfy checks.
