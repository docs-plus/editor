---
date: 2026-03-11
topic: fold-overlay-to-decoration
status: implemented
---

# Replace Fold Overlays with Decoration + CSS ::after

## What We're Building

A re-architecture of the heading fold crinkle visual, replacing the absolutely-positioned overlay divs with a CSS `::after` pseudo-element driven by `Decoration.node()`. The fold/unfold behavior, persistence, TOC integration, and cursor skip remain identical — only the rendering strategy changes.

## The Problem

The current approach uses absolutely-positioned overlay divs (`overlayMap`) outside the document flow. Every layout change — fold, unfold, edit, heading addition, window resize — requires manual repositioning via `reconcileFold` and `repositionAllOverlays`. This causes:

- **Position lag**: overlays visually detach from their heading during animations and doc edits
- **Delayed updates**: overlay position updates happen asynchronously, creating visible "jumping"
- **Code complexity**: ~130+ lines exist purely for position management (`reconcileFold`, `repositionAllOverlays`, `createOverlayElement`, `measureContentHeight`)
- **domObserver hacks**: imperative DOM mutations require `domObserver.stop()/start()` guards throughout

This is an architectural problem — more repositioning logic cannot fix it. The overlay will always lag behind layout changes because it's decoupled from the document flow.

## Why This Approach

### Approaches Considered

1. **Decoration.node() + CSS ::after (chosen)** — The crinkle becomes a CSS pseudo-element on the heading itself. ProseMirror decorations manage the class lifecycle. The `::after` is always in the correct position because it's part of the heading's box model.

2. **Decoration.widget()** — Insert a real DOM crinkle element via ProseMirror widget decoration. ProseMirror manages positioning. Rejected because widget decorations are inside contenteditable, requiring `contenteditable="false"` workarounds, and widget creation/destruction makes animation harder.

3. **Fix overlay positioning** — Add more repositioning calls, use `requestAnimationFrame` loops during animation. Rejected because it patches symptoms, not the root cause.

### Why Decoration.node() + ::after

- **Zero positioning code**: The `::after` is part of the heading element's flow. It moves with the heading automatically. No `reconcileFold`, no `repositionAllOverlays`, no `overlayMap`.
- **ProseMirror-native**: Decorations are the standard ProseMirror way to add visual attributes to nodes. `DecorationSet.map()` handles position remapping on doc changes.
- **CSS gradients match the crinkle visual**: The SVG crinkle is 8 alternating mountain/valley gradient strips with fold lines — this is reproducible with `repeating-linear-gradient`.
- **No domObserver hacks for classes**: `Decoration.node()` applies classes through ProseMirror's own rendering pipeline. No imperative class manipulation, no mutation observer interference.
- **Massive code reduction**: Eliminates `overlayMap`, `createOverlayElement`, `reconcileFold`, `repositionAllOverlays`, `crinkle-renderer.ts`, and all overlay lifecycle management.

## Key Decisions

- **Crinkle visual via CSS `::after`**: The heading gets a `heading-section-folded` class via `Decoration.node()`. CSS `::after` draws the crinkle using `repeating-linear-gradient` to replicate the mountain/valley strips. Fixed height 45px.

- **Content hiding via Decoration.node()**: Content nodes in folded sections get a `heading-fold-hidden` class via `Decoration.node()`. CSS: `display: none !important`.

- **All fold state expressed through decorations**: The plugin's `props.decorations()` method returns a `DecorationSet` built from `foldedIds`. This means ProseMirror handles class application, removal, and position mapping. No imperative DOM class manipulation.

- **Pure decoration architecture — no imperative DOM**: ALL visual state is expressed through `Decoration.node()`. The plugin view never touches the DOM directly. It only measures content height and schedules state transitions via ProseMirror transactions. Zero `domObserver` hacks.

- **Animation via CSS `@starting-style`**: Instead of the 5-phase JS choreography, CSS `@starting-style` defines the initial values of transitions when a class is first applied. When the decoration adds `heading-section-folding` class, the browser starts `::after` height at `contentHeight` and transitions to 45px — all in CSS, GPU-accelerated. Supported in Chrome 117+, Safari 17.5+, Firefox 129+ (all 1.5+ years old by March 2026).

- **Plugin state phases**: Plugin state tracks animation phases — `foldingIds` (being folded, with measured contentHeight), `unfoldingIds` (being unfolded), `foldedIds` (settled). Each phase maps to a different CSS class via decoration. Plugin view only schedules phase transitions (`folding → folded`, `unfolding → removed`) via `setTimeout` after animation duration.

- **`::after` animation visual**: During fold, the `::after` starts at contentHeight with the crinkle gradient fixed at 45px via `background-size: 100% 45px; background-position: bottom`. As it compresses, the transparent space above the gradient shrinks until only the 45px crinkle remains. This is visually BETTER than the current SVG approach where the crinkle stretches during animation.

- **Click handling on heading**: Since `::after` can't have its own click listener, a click handler on the heading element (via `handleClickOn` plugin prop or `handleClick`) detects clicks in the `::after` region by checking if the click Y coordinate is below the heading text's bottom edge. This plus the TOC sidebar chevron provides two toggle triggers.

- **SVG renderer eliminated**: `crinkle-renderer.ts` is deleted. The crinkle visual is pure CSS.

- **Decoration attribute merging**: Both HeadingScale (`style: "--hd-size: Xpt"`) and HeadingFold (`class: "heading-section-folded"`, `style: "--fold-content-height: Xpx"`) use `Decoration.node()` on the same heading nodes. ProseMirror merges node decoration attributes — `class` values are space-concatenated, `style` values are concatenated with semicolons. No conflict.

## What Changes

| Component | Current | New |
|-----------|---------|-----|
| Crinkle visual | SVG in absolutely-positioned overlay div | CSS `::after` pseudo-element on heading |
| Positioning | Manual: `reconcileFold`, `repositionAllOverlays` | Automatic: part of heading's flow |
| Class management | Imperative: `classList.add/remove` + domObserver guards | Declarative: `Decoration.node()` |
| Content hiding | Imperative: `classList.add("heading-fold-hidden")` | Declarative: `Decoration.node()` with class |
| Animation | 5-phase JS choreography with overlay + margin sync | CSS `@starting-style` — browser handles transition start/end |
| Click target | `overlay.addEventListener("click", ...)` | Heading click handler with Y-coordinate check |
| Code deleted | — | `overlayMap`, `createOverlayElement`, `reconcileFold`, `repositionAllOverlays`, `repositionOverlay`, `measureContentHeight`, `crinkle-renderer.ts`, all domObserver calls |

## Animation Flow

### Fold (content → crinkle)

1. User clicks toggle → plugin measures `contentHeight` from DOM
2. Transaction dispatches: heading ID added to `foldingIds` with `contentHeight`
3. Decorations built: heading gets `class: "heading-section-folding"` + `style: "--fold-content-height: Xpx"`, content nodes get `class: "heading-fold-hidden"`
4. CSS `@starting-style` kicks in: `::after` starts at `contentHeight`, transitions to 45px. Crinkle gradient is `background-position: bottom` at fixed 45px — space above compresses away.
5. After 350ms: transaction moves heading ID from `foldingIds` to `foldedIds`. Decoration class swaps to `heading-section-folded`.

### Unfold (crinkle → content)

1. User clicks toggle → plugin retrieves stored `contentHeight`
2. Transaction dispatches: heading ID moved from `foldedIds` to `unfoldingIds`
3. Decorations built: heading gets `class: "heading-section-unfolding"` + `style: "--fold-content-height: Xpx"`, content nodes KEEP `class: "heading-fold-hidden"` (content stays hidden during animation)
4. CSS `@starting-style` kicks in: `::after` starts at 45px, transitions to `contentHeight`
5. After 350ms: transaction removes heading ID from `unfoldingIds` AND `foldedIds`. Decorations removed from heading and content nodes. Content becomes visible.

## What Stays the Same

- Plugin state: `foldedIds: Set<string>`, `state.apply()` with toggle/set/prune
- Persistence: localStorage via `fold-storage.ts`
- TOC sidebar: `filterItemsByFoldState`, chevron toggles, `onToggleFold`
- Cursor skip: `handleKeyDown` for arrow keys
- Extension wrapper: `HeadingFold` extension with `toggleFold` command
- Section boundaries: `computeSection` helper

## Open Questions

None — all questions resolved during brainstorm dialogue.

## Resolved Questions

- **Animation ↔ decoration boundary**: Pure decoration. All visual state through decorations. Plugin view only measures and schedules state transitions. No imperative DOM, no domObserver hacks.
- **Unfold animation**: Same `@starting-style` mechanism in reverse. Content stays hidden during expand animation, revealed after transition completes.
- **Decoration attribute merging**: ProseMirror merges `class` (space-concat) and `style` (semicolon-concat) from multiple `Decoration.node()` on the same element. HeadingScale and HeadingFold decorations coexist without conflict.
- **`@starting-style` browser support**: Chrome 117+, Safari 17.5+, Firefox 129+. Universally supported since mid-2024.

## Post-Implementation: Architecture Evolution

This brainstorm proposed `Decoration.node()` + CSS `::after` + `@starting-style` for the crinkle visual. During implementation, two significant changes were made:

1. **`::after` → `Decoration.widget()`**: The CSS `::after` pseudo-element could not support the 3D paper accordion effect (multiple child `div`s with individual `rotateX` transforms). The crinkle was re-implemented as a `Decoration.widget()` that inserts a real DOM element with 4–8 child `div`s styled as 3D fold strips via CSS `perspective` and `rotateX`.

2. **`@starting-style` → `@keyframes`**: CSS `@starting-style` proved unreliable for triggering animations on class changes applied by ProseMirror's decoration system. Replaced with explicit CSS `@keyframes` animations (`fold-crinkle`, `unfold-crinkle`) driven by animation state classes (`heading-section-folding`, `heading-section-unfolding`).

Additional features added during implementation:

- **Nested fold suppression**: When a parent heading is folded, child headings' widgets are suppressed (no double crinkle)
- **Dynamic strip count**: 4–8 strips based on content height (more content = more folds)
- **Hover peek**: Crinkle expands slightly on hover (45px → 58px) with enhanced `rotateX` angles

The core decisions from this brainstorm held: `Decoration.node()` for heading classes and content hiding, `DecorationSet.map()` fast-path via `canMapDecorations`, plugin state phases (folding/folded/unfolding), and click-on-crinkle toggle.

## Next Steps

→ `/workflows:plan` for implementation details
