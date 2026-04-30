# Evidence And Token Policy

Read this file when you need to understand artifacts, evidence levels, `agent-brief.json`, `text-manifest.json`, reports, repair plans, or why a run is blocked. Do not read full raw extraction, DesignIR, traces, or all crops unless this file and the current brief indicate they are necessary.

## Default Reading Order

For each repair round:

1. Read `agent-brief.json`.
2. Read `text-manifest.json` before editing any visible copy.
3. Read the relevant React/CSS files.
4. Open `repair-plan.json`, `report.json`, `design-ir.json`, trace evidence, or image crops only when a listed `nodeId`, `regionId`, `selector`, or `evidencePath` is insufficient.

The goal is to keep large local evidence out of model context until it is needed.

## Artifact Roles

| Artifact | Role | Default read? |
|---|---|---|
| `agent-brief.json` | Token-optimized status, metrics, top failures, top regions, next actions, and evidence paths. | Yes |
| `text-manifest.json` | Authoritative visible text from Figma TextNode evidence. | Yes before editing copy |
| `repair-plan.json` | Ordered failures with recommended actions and confidence. | Only when brief is not enough |
| `report.json` | Full verification report: full-page diff, regions, DOM results, text results, failures, warnings. | Only for debugging a specific failure |
| `design-ir.json` | Minimal normalized design evidence: page, regions, texts, assets, colors, typography, layout hints. | Only when report/brief lacks needed Figma parameters |
| `extraction.raw.json` | Full raw extraction payload from the Figma plugin. | Avoid unless debugging extraction itself |
| `trace.zip` | Browser trace for route verification. | Avoid unless environment/rendering is blocked |
| Region crops/diffs | Visual evidence for a specific region. | Open only the named crop/diff |

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
