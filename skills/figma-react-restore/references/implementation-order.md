# Implementation And Repair Order

Read this file when editing React, CSS, Tailwind classes, component structure, route state, or design tokens from a repair plan.

## Canonical Order

Establish route state and scale first, then treat exact text as a hard gate before layout tuning:

0. Open the full-page diff first, then process `agent-brief.json.mustReadVisualEvidence` one expected/diff pair at a time.
1. Page shell and route state.
2. Exact visible text content from `text-manifest.json`.
3. Macro layout and section boxes.
4. Region layout, padding, gaps, alignment.
5. Typography metrics with tolerance.
6. Image/icon assets and crop.
7. Color, borders, radius, shadow, gradients.
8. Responsive and interaction polish.

Do not chase color, shadow, radius, or decorative detail before layout and text wrapping are stable.

If `mustReadVisualEvidence` is non-empty and the current queue item's `expectedPath` or `diffPath` image cannot be opened, stop and report `blocked` instead of repairing from memory or guessing. Do not open all Top 5 region pairs at once; each pair should guide one focused repair target. Use `regionId`/`nodeId` as the source locator; use `scope`, `evidenceRegionId`, and `box` to understand whether the image is the exact region, an expanded crop, or a containing section.

## Page Shell And State

Before local visual tuning, make sure the route matches the Figma frame state:

- correct route and viewport
- correct logged-in/logged-out state
- correct selected tab, modal, menu, carousel, or form state
- correct data or mock content needed by the design
- no loading skeleton, error state, or route transition unless that is the selected Figma state

If the route state cannot be made equivalent, report the mismatch instead of overfitting CSS.

## Exact Text Rule

Use `text-manifest.json` for expected strings. Preserve exact spelling, casing, punctuation, numbers, and brand words. Use screenshots only to locate placement or detect missing evidence.

Fix `text-content` failures before layout, font metrics, assets, and color tuning.

## Layout Repair

Translate Figma layout evidence into maintainable CSS:

- flex/grid structure
- container widths
- min/max sizes
- padding
- gaps
- alignment
- section offsets
- responsive constraints

Prefer existing project conventions and design system primitives when they can express the Figma parameters accurately.

## Typography Repair

Translate typography evidence into live text styles:

- font family
- font size
- font weight
- line height
- letter spacing
- max-width
- wrapping behavior
- text transform
- text color

Do not use raster text. Do not hide live text under an image.

## Design Parameter Adoption

Prefer adaptive implementation using extracted design parameters over raster imitation:

- translate visual tokens into CSS colors, gradients, borders, radius, shadows, opacity, and spacing variables
- use reusable components where appropriate
- preserve semantic DOM
- preserve existing architecture and naming patterns
- avoid unnecessary refactors, file moves, and duplicate implementations

The goal is not just pixel similarity for one screenshot. The result should adapt to reasonable viewport/content changes while retaining the design's structure and style parameters.

## React Code Mapping

When implementing or repairing elements, add `data-figma-node` attributes on important DOM nodes where practical:

```tsx
<section data-figma-node="88:1" className="hero">
```

This lets the verifier connect Figma regions to DOM boxes and produce more precise repair plans. Do not add misleading mappings to unrelated elements.

## Repair Loop

After patching:

1. Rerun `restore` or `verify`.
2. Read the new `agent-brief.json`.
3. Open the new full-page diff, then the next `mustReadVisualEvidence` expected/diff pair before the next focused edit.
4. Confirm the targeted failure count or diff decreases.
5. Stop on `blocked-no-improvement` rather than making blind tweaks.
