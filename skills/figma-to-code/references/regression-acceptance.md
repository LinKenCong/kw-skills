## Required Checks

### Layout
- [ ] Spacing (gap, margin, padding) matches the design
- [ ] Alignment (horizontal/vertical) is correct
- [ ] Sizing (fixed/auto/fill) matches the design
- [ ] Nested flex direction and wrap behavior are correct

### Typography
- [ ] font-family is correct
- [ ] font-size is correct
- [ ] font-weight is correct
- [ ] line-height is correct
- [ ] letter-spacing is correct (note unit: px vs %)
- [ ] text-align is correct
- [ ] Multi-segment text styles are correct (different weights/colors/decorations)

### Color
- [ ] Text color is correct
- [ ] Background color/gradient is correct
- [ ] Border color is correct
- [ ] Opacity is correct

### Geometry
- [ ] Padding in all four directions is correct
- [ ] Gap values are correct
- [ ] border-radius is correct (including independent corner radii)
- [ ] border-width is correct (including independent side widths)
- [ ] Icon click-area container size vs visual glyph size are both correct

### Effects
- [ ] box-shadow (offset/blur/spread/color) is correct
- [ ] Background blur (backdrop-filter) is correct
- [ ] Opacity / blend mode is correct

### Interaction (only if design includes variant states)
- [ ] Hover state is correct
- [ ] Active/pressed state is correct
- [ ] Disabled state is correct
- [ ] Focus state is correct

### Responsive
- [ ] Overflow behavior matches design constraints
- [ ] Min/max dimension constraints are correct

## Acceptance Report Format

After completing the checks, output:

```
## Acceptance Result

### Passed
- [list passed items]

### Known Deviations
- [list deviations with reasons]

### Not Verified
- [list items that could not be verified with reasons]
```

---

For automated validation (script usage, tolerance rules, result interpretation), see SKILL.md Phase 6.

### What the Script Cannot Check (manual supplement)

The automated script covers static computed styles on text nodes. The following must still be verified manually:

- **Responsive behavior** — viewport resizing, breakpoint transitions
- **Overflow / clipping** — scroll behavior, content truncation
- **Interaction states** — hover, focus, active, disabled
- **Animation / transitions** — timing, easing, keyframes
- **Non-text elements** — image placeholders, SVG rendering, icon sizing
- **Layout alignment** — whether visual boundaries (e.g., image/text panel edges) align across sections
