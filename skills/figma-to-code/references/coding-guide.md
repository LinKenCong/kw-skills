# Coding Guide

Translating Figma extraction data into production frontend code. Read the relevant section when implementing each component.

---

## 1. Reading Query Data

`query subtree` returns nodes with `box`, `style`, and `text` fields — all already pruned to only non-default values. Translate these into CSS, not copy them verbatim.

**Key judgment: sizing strategy**

| `wSizing` value | Meaning | CSS |
|-----------------|---------|-----|
| `"fill"` | Stretch to fill parent | `flex: 1; min-width: 0` (in flex-row) or `width: 100%` (in flex-col) |
| `"hug"` | Shrink to content | Don't set width — let content determine size |
| (absent) | Fixed width | Use `box.w` value — but outer containers MUST use `max-width`, not `width` |

Same logic applies to `hSizing`.

**Absent fields = default values.** If a field is missing from query output, it means the default: `opacity` absent = 1, `gap` absent = 0, `justify` absent = flex-start, `align` absent = stretch, `position` absent = static.

---

## 2. Layout Strategy

### Outer Container Rule

The outermost page container must NEVER use a fixed width. Always use:
```css
width: 100%; max-width: [design-width]px;
```
This prevents horizontal overflow on viewports narrower than the design width.

### Flex Layout Mapping

| Query field | CSS property | Notes |
|-------------|-------------|-------|
| `display: "flex"` | `display: flex` | |
| `dir: "column"` | `flex-direction: column` | `"row"` is default, can omit |
| `justify` | `justify-content` | Values map directly |
| `align` | `align-items` | Values map directly |
| `gap: N` | `gap: Npx` | |
| `columnGap: N` | `column-gap: Npx` | Cross-axis spacing, only in wrap layouts |
| `wrap: true` | `flex-wrap: wrap` | |
| `pad: N` | `padding: Npx` | Uniform |
| `pad: [t,r,b,l]` | `padding: Tpx Rpx Bpx Lpx` | Per-side (e.g., `pad: [20,20,66,20]` → `padding: 20px 20px 66px 20px`) |

### Sizing in Flex Containers

| Scenario | CSS |
|----------|-----|
| `wSizing: "fill"` in flex-row parent | `flex: 1; min-width: 0` |
| `wSizing: "fill"` in flex-col parent | `width: 100%` |
| Fixed width in flex-row parent | `width: [N]px; flex-shrink: 0` — shrink-0 prevents compression |
| `hSizing: "fill"` in flex-col parent | `flex: 1; min-height: 0` |
| `layoutGrow: 1` | `flex-grow: 1` |
| `layoutAlign: "STRETCH"` | `align-self: stretch` (usually inherited) |

### Absolute Positioning & Overflow

When `position: "absolute"` appears in query data, use `position: absolute` with `top`/`left` from `box.x`/`box.y` and ensure the parent has `position: relative`. When `overflow: "hidden"` appears, add `overflow: hidden` — common on image containers and clipped sections.

### Responsive / Adaptive Strategy

Figma designs are fixed-width canvases. The code must work across viewport sizes. Apply these rules from outermost to innermost:

**Rule 1: Page container — never fixed width**
```
WRONG:  width: 1280px
RIGHT:  width: 100%; max-width: 1280px; margin: 0 auto
```

**Rule 2: Side-by-side layouts — must have a collapse strategy**

Add a breakpoint where flex-row layouts wrap to column on narrow viewports.

```css
/* Default: side by side */
display: flex; flex-direction: row;

/* Below design width: stack vertically */
@media (max-width: 768px) {
  flex-direction: column;
}
```

**Rule 3: Fixed-width children — must shrink or wrap**

| Scenario | Problem | Solution |
|----------|---------|----------|
| `w-[426px]` text panel in flex-row | Overflows on narrow viewports | `w-full md:w-[426px]` — full-width on mobile, fixed on desktop |
| Three `flex-1` columns | Too narrow on mobile | `flex-wrap: wrap` + `min-width` on children |
| `h-[480px]` fixed height | Content gets clipped when width forces text to wrap more | Use `min-h-[480px]` instead, or `h-auto` on mobile |

**Rule 4: Large text — must scale**

| Text size | Strategy |
|-----------|----------|
| > 80px | `font-size: clamp(40px, 8vw, 116px)` — scales between 40px and 116px based on viewport |
| 40–80px | `font-size: clamp(24px, 5vw, 57px)` — or similar proportional range |
| < 40px | Usually fine as-is |

**Rule 5: Images — must maintain aspect ratio**

```css
width: 100%;
height: auto;          /* NOT fixed height */
aspect-ratio: 854/480; /* preserve original proportions */
object-fit: cover;
```

---

## 3. Typography

### Font Property Mapping

| Query field | CSS property | Notes |
|-------------|-------------|-------|
| `font` | `font-family` | |
| `size` | `font-size` | In px |
| `weight` | `font-weight` | 400=normal, 700=bold, 800=extrabold |
| `lh: "110%"` | `line-height: 110%` | Already includes unit |
| `ls: "-0.05em"` | `letter-spacing: -0.05em` | Already converted from Figma % to em |
| `case: "upper"` | `text-transform: uppercase` | |
| `align: "center"` | `text-align: center` | Absent = left (default) |
| `color: "#hex"` | `color: #hex` | Absent = #000000 (default) |

### Mixed-Style Text (segments)

When `segments` array exists, the text has multiple styles (different colors, fonts, or sizes within one text node):

```jsx
<h1>
  <span style={{ color: '#000000' }}>Train Hard. </span>
  <span style={{ color: '#808dfd' }}>Live Better</span>
</h1>
```

The shared styles (font, size, weight) go on the parent element. Only the differing styles go on each `<span>`.

### Large Headlines (>60px)

Headlines over 60px may overflow their container on smaller viewports. Mitigation options:
- `white-space: nowrap` — if the container is wide enough
- `clamp()` — responsive sizing: `font-size: clamp(60px, 8vw, 116px)`
- Let it wrap naturally — but verify the line break looks acceptable

---

## 4. Color & Effects

### Background

| Query field | CSS | Notes |
|-------------|-----|-------|
| `bg: "#hex"` | `background-color: #hex` | |
| `bgOpacity: 0.5` | `background-color: #hex` with alpha, or `opacity: 0.5` on a wrapper | |
| `gradient` | `background: linear-gradient(...)` | Build from `type` and `stops` array |
| `bgImage: "hash"` | Background image | Map hash to file in `assets/` directory |

### Borders

| Query field | CSS | Notes |
|-------------|-----|-------|
| `borderWidth: N` | `border: Npx solid [borderColor]` | All sides |
| `borderTop/Right/Bottom/Left: N` | `border-top: Npx solid [borderColor]` | Per-side borders |
| `borderColor: "#hex"` | Combined with border-width | |
| `radius: N` | `border-radius: Npx` | Uniform |
| `radius: [tl,tr,br,bl]` | `border-radius: TLpx TRpx BRpx BLpx` | Per-corner |

### Effects

| Query field | CSS |
|-------------|-----|
| `shadow: {x,y,blur,spread,color}` | `box-shadow: Xpx Ypx Blurpx Spreadpx Color` |
| `blur: N` | `backdrop-filter: blur(Npx)` |
| `opacity: N` | `opacity: N` |

### Images

When `bgImage` appears in node data, it references an exported image in the `assets/` directory. Use as:
- `<img>` with `object-fit: cover` for content images
- `background-image` for decorative backgrounds
- Always pair with `overflow: hidden` on the container

---

## 5. Component Decisions

### When to Split into Components

| Signal | Action |
|--------|--------|
| `type: "INSTANCE"` or `type: "COMPONENT"` | Must be a standalone component |
| Same structure repeated 2+ times at same level | Extract as reusable component |
| Name contains `/` (e.g., `Button/Primary`) | Component with variant |
| Deep nesting (>4 levels) | Consider splitting inner section |

### Naming Convention

Derive component names from Figma node names:
- `"Hero section"` → `HeroSection`
- `"Button A"` → `Button`
- `"Footer section"` → `Footer`

---

## 6. Common Failures

**These failures occurred in real implementations. Read before writing code.**

| Symptom | Root Cause | Fix |
|---------|-----------|-----|
| Page overflows viewport horizontally | Outer container uses fixed `width: 1280px` | Change to `width: 100%; max-width: 1280px` |
| Buttons stretch to full width | Flex child default `align-self: stretch` | Add `width: fit-content` or wrap in `<div>` |
| Large headline gets clipped | Fixed container height with overflow:hidden | Remove fixed height, or use `min-height` instead |
| Fixed-width panel gets compressed | Flex row sibling takes too much space | Add `flex-shrink: 0` on fixed-width element |
| flex-1 child content overflows | Missing `min-width: 0` | Always pair `flex: 1` with `min-width: 0` in flex-row |
| Colors look wrong | Used rgba format instead of hex | Always use hex from query data |
| Inconsistent spacing | Mixed margin and padding approaches | Use `gap` for sibling spacing, `padding` for container internal spacing |
| Fonts not loading | Google Fonts URL misconfigured | Verify font family names match exactly; check network tab |
| Text segments not split | Mixed-color text rendered as single element | Check for `segments` array in text data |
| Side-by-side panels overlap on narrow viewport | Fixed-width panels in flex-row with no wrap strategy | Add `flex-col md:flex-row` or a media query breakpoint |
| Three-column cards squeeze to unreadable width | `flex-1` without min-width in row layout | Add `min-width` or `flex-wrap: wrap` with per-child min-width |
| 116px headline overflows container | Fixed font size too large for viewport | Use `clamp(40px, 8vw, 116px)` for responsive scaling |
| Fixed-height section clips wrapped text | `h-[480px]` doesn't account for text reflow on narrower widths | Use `min-h-[480px]` or `h-auto` at smaller breakpoints |

---

## 7. Worked Example

### Input: `query subtree "20:536"` (Hero Section)

```json
{
  "id": "20:536", "name": "Hero section", "type": "FRAME",
  "box": { "w": 1280, "h": 480, "display": "flex", "dir": "row", "maxW": 1920 },
  "children": [
    {
      "id": "20:537", "name": "Image", "type": "FRAME",
      "box": { "w": 854, "h": 480, "wSizing": "fill", "hSizing": "fill", "overflow": "hidden" },
      "style": { "bgImage": "fa185f92..." }
    },
    {
      "id": "20:538", "name": "Text panel", "type": "FRAME",
      "box": { "w": 426, "h": 480, "display": "flex", "dir": "column", "justify": "space-between", "pad": [20, 20, 66, 20] },
      "style": { "bg": "#e9ecff" },
      "children": [
        {
          "id": "20:539", "type": "TEXT",
          "text": { "text": "FOR THE COMMITTED", "font": "Anek Tamil", "size": 45, "weight": 700, "lh": "110%", "ls": "-0.03em", "case": "upper" }
        },
        {
          "id": "20:540", "name": "Body contain", "type": "FRAME",
          "box": { "display": "flex", "dir": "column", "justify": "flex-end", "gap": 20 },
          "children": [
            {
              "id": "20:541", "type": "TEXT",
              "text": { "text": "Train like an athlete with top-tier equipment and expert programming.", "font": "Geist", "size": 17, "lh": "131%", "ls": "0.01em" }
            },
            {
              "id": "20:542", "name": "Button A", "type": "INSTANCE",
              "component": { "name": "Button A", "variant": "Secondary" },
              "box": { "w": 105, "h": 41, "pad": [12, 17, 12, 17] },
              "style": { "bg": "#e9ecff", "radius": 7.246, "borderWidth": 0.725, "borderColor": "#000000" },
              "children": [
                { "id": "20:543", "type": "TEXT", "text": { "text": "About us", "font": "Geist Mono", "size": 15, "lh": "110%", "ls": "-0.01em", "case": "upper" } }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

### Output: React + Tailwind Component

```jsx
import Button from "./Button";

export default function HeroSection() {
  return (
    <section className="w-full flex flex-row max-w-[1920px]">
      {/* Image: wSizing=fill → flex-1, not fixed 854px */}
      <div className="flex-1 min-w-0 h-[480px] overflow-hidden">
        <img src="/images/hero.jpg" alt="Hero" className="w-full h-full object-cover" />
      </div>

      {/* Text panel: fixed 426px → shrink-0 */}
      <div className="w-[426px] shrink-0 h-[480px] flex flex-col justify-between pt-5 pr-5 pb-[66px] pl-5 bg-[#e9ecff]">
        <h2 className="font-['Anek_Tamil'] font-bold text-[45px] leading-[110%] tracking-[-0.03em] uppercase">
          ...
        </h2>
        <div className="flex flex-col justify-end gap-5">
          <p className="font-['Geist'] text-[17px] leading-[131%] tracking-[0.01em]">...</p>
          <div><Button>About us</Button></div>
        </div>
      </div>
    </section>
  );
}
```

### Translation Decisions Annotated

1. **Image container**: `wSizing: "fill"` → `flex-1 min-w-0` (not fixed 854px)
2. **Text panel**: No `wSizing` (= fixed) → `w-[426px] shrink-0`
3. **Button in flex**: Wrapped in `<div>` because parent has `justify: space-between`
4. **Padding `[20,20,66,20]`**: Bottom is non-standard → `pt-5 pr-5 pb-[66px] pl-5`
5. **Section width**: Uses `w-full max-w-[1920px]` (not fixed 1280px)
6. **INSTANCE node**: Reused as `<Button>` component

---

## 8. Node Traversal Rules

`query subtree` returns a recursive tree. Handle each node by type:

| Node Type | Handling |
|-----------|----------|
| Has `box.display: "flex"` | Generate a flex container; read direction/justify/align/gap/padding |
| `type: "TEXT"` | Read `text` field; note `segments` for mixed styles |
| Leaf node + `bgImage` | Use the corresponding image from `assets/` (see `bgImageFile` field) |
| `type: "GROUP"` without flex | Use relative positioning; calculate spacing from coordinate differences |

**Non-auto-layout spacing:** When a node lacks `box.display: "flex"` (GROUP), children use absolute coordinates. Use `child.box.x - parent.box.x` for relative position; coordinate difference between adjacent children = spacing.

---

## 9. Asset Usage

| Asset Type | Usage |
|------------|-------|
| `assets/*.svg` | Use as SVG component or `<img src>` |
| `assets/*@2x.png` | Use as `<img>` `src`; render at half the actual size (2x export) |
| `assets/<hash>.png` | Image fills exported by hash; referenced via `bgImageFile` in query output |

---

## 10. Fidelity Modes

### High-Fidelity Mode
- Use `query subtree` and `query palette` for all layout and style values
- Match every color, font, size, spacing value exactly
- Run the full regression-acceptance checklist

### Prototype Mode
- Use `query tree` for structure, `query text` for text content
- Use the project's existing design system tokens for styling
- Focus on: all elements present, logical layout structure, correct text content

---

## 11. Implementation Modes

### Mode A: HTML Golden Reference (Phase 3)

| Aspect | Behavior |
|--------|----------|
| Output | Single `index.html` with embedded `<style>` |
| CSS approach | Raw CSS with custom properties (`:root { --color-X }`) |
| Font loading | `<link>` to Google Fonts in `<head>` |
| Images | Placeholder backgrounds (gradient or solid color) |
| Build tools | None — zero dependencies |

### Mode B: Framework Conversion (Phase 5)

In Mode B, the golden reference HTML is the **sole source of truth** — do NOT re-query extraction data. This prevents double-translation errors.

---

## 12. Tech Stack Conversion Guide (HTML → Framework)

### Critical Pitfalls

| Pitfall | Root Cause | Fix |
|---------|-----------|-----|
| Headings lose bold weight | Tailwind preflight resets `h1-h6` to `font-weight: inherit` | Add explicit `font-bold` to all heading elements |
| Body line-height changes | Tailwind preflight sets `html { line-height: 1.5 }` | Explicit `line-height` on all text elements |
| Borders appear/disappear | Tailwind preflight adds default `border-color` | Use explicit `border-none` on elements without borders |
| SVG rendering changes | Tailwind sets `svg { display: block }` | SVGs in inline text need `inline-block` |

### CSS Variable → Framework Token Mapping

| HTML (raw CSS) | Tailwind v4 | Notes |
|----------------|-------------|-------|
| `:root { --color-X: #hex }` | `@theme { --color-X: #hex }` | Generates `bg-X`, `text-X` utilities |
| `font-family: var(--font-X)` | `@theme { --font-X: ... }` → `font-X` | Register in `@theme` block |
| `padding: 101px 20px 20px 20px` | `pt-[101px] px-5 pb-5` | Arbitrary values `[]` for non-standard sizes |
| `gap: 19px` | `gap-[19px]` | Arbitrary value |
| `border-radius: 7.246px` | `rounded-[7.246px]` | Arbitrary value |
| `font-size: clamp(40px, 8vw, 116px)` | `text-[clamp(40px,8vw,116px)]` | No spaces in Tailwind arbitrary values |

### Conversion Checklist

- [ ] Every `font-family` has a corresponding `@theme` token
- [ ] Every `font-weight` on headings is explicitly set (not relying on browser defaults)
- [ ] Every CSS custom property is mapped to a framework token
- [ ] Fixed pixel values preserved (not rounded to nearest Tailwind scale step)
- [ ] `border: none` explicit on elements without borders
- [ ] Responsive breakpoints match the HTML media queries

---

## 13. Handling Incomplete Data

| Situation | Action |
|-----------|--------|
| Large node truncated | Select a smaller subtree and re-extract |
| Some properties missing | Check if the node type supports that property |
| Need to refresh data | Re-run extraction to overwrite cache |
| Node has no structure | Suggest user select a parent with full child hierarchy |