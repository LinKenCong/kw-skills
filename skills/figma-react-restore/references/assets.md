# Assets And Anti-Raster Rules

Read this file when handling images, icons, photos, SVG/PNG choices, image fills, `reference-only` assets, missing asset failures, crop failures, or screenshot-overlay failures.

## No Screenshot Overlay

Never pass verification by placing the Figma-exported screenshot, full-page raster image, or large cropped bitmap as the page background or foreground overlay.

Forbidden shortcuts:

- using the baseline screenshot as `<img>`, CSS `background-image`, canvas, SVG image, or absolutely positioned overlay to mimic the full page
- slicing the design into large raster blocks to bypass layout, typography, color, and asset implementation
- hiding real DOM content under a screenshot while keeping only invisible or minimal fake DOM nodes for verification
- tuning opacity, blend modes, z-index, clipping, or transforms to make a screenshot cover the rendered page

The implemented React page must be real, maintainable UI: semantic DOM, reusable components where appropriate, responsive layout, live text, CSS styles, and actual assets.

## Allowed Asset Use

- Export and use real image/icon/photo assets that exist as assets in the design.
- Prefer assets with `preferredFormat: "svg"` for real vector/icon/logo assets when available.
- Keep `fallbackPath` / `fallbackArtifactId` PNG as compatibility fallback, not the default, when SVG is accurate and supported by the target component stack.
- Translate real asset evidence into the correct implementation primitive: `<img>`, inline/external SVG, an existing icon component, or CSS mask only when the evidence represents an actual image/vector asset.
- Use small decorative raster assets when they correspond to actual design elements.
- Use extracted thin decorative strips, patterns, dividers, or borders when they are explicit design assets, even if they span the viewport width.
- Use extracted Figma image-fill assets for frames that have image fills, while keeping descendant text as live DOM/CSS.
- Use the full Figma screenshot only as verification evidence, never as implementation content.

Thin decorative strips are not the same as slicing whole sections. They must be explicit design assets, not a way to bypass layout implementation.

## Reference-Only Assets

Treat extracted assets with `allowedUse: "reference-only"` as visual evidence only. Do not import them, render them, or set them as CSS backgrounds in the React page.

Common reasons an asset is `reference-only`:

- it contains descendant text that must remain live DOM/CSS
- it is a layout container
- it is large enough to behave like a section/page slice
- it was exported only to help visual comparison

If the verifier reports reference-only usage, remove that asset from the rendered UI and rebuild the structure with DOM/CSS plus real implementation assets.

## Missing Assets

If a required image/icon/photo is missing from artifacts:

1. Re-run extraction first.
2. If the plugin still cannot extract that asset, finish the non-image layout/text/style work.
3. Report the missing asset to the user as blocked input.

Do not draw, hallucinate, gradient-fill, CSS-paint, or source a lookalike image to pass visual diff.

## Asset Repair Priority

Only tune assets after route state, exact text, macro layout, region layout, and typography are stable.

For `asset-crop` failures, adjust:

- source asset choice
- rendered box size
- `object-fit`
- `object-position`
- crop wrapper
- aspect ratio
- alignment inside the layout

For `asset-missing` failures, first confirm the expected extracted asset exists and is allowed for implementation.
