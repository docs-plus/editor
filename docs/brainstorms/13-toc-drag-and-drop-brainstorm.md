# TOC Drag & Drop — Brainstorm

**Date:** 2026-03-18
**Status:** Implemented
**Deepened:** 2026-03-18
**Implemented:** 2026-03-18

## What We're Building

Section-level drag-and-drop in the TOC sidebar. Two-axis interaction:

- **Vertical drag** → reorder the section in the document
- **Horizontal drag** → change the dragged heading's level (indent/outdent)

Both changes apply in a single ProseMirror transaction on drop.

## Why This Approach

The editor already has heading drag-and-drop via custom mouse events. This feature mirrors that capability in the TOC, giving users an outliner-style experience. dnd-kit is already in the codebase (tab bar) and provides keyboard a11y, collision detection, and `DragOverlay` out of the box.

Two-axis in a single drag is a better UX than separating reorder from indent — it matches how outliners like Notion and Workflowy behave.

**Research validation:** The [official dnd-kit tree example](https://github.com/clauderic/dnd-kit/blob/master/stories/3%20-%20Examples/Tree/SortableTree.tsx) uses the exact same two-axis pattern (vertical sort + horizontal indent via `delta.x` in `onDragMove`). Our case is simpler — flat list with H1–H6 levels instead of arbitrary nesting depth.

## Key Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | **dnd-kit** for drag infrastructure | Already installed, proven in tab bar, keyboard a11y for free |
| 2 | **Full section move** (heading + all content until next heading of ≤ level) | Same semantics as existing editor drag, uses `computeSection` |
| 3 | **Two-axis drag**: vertical = reorder, horizontal = level change | Fluid outliner UX in one interaction |
| 4 | **Only dragged heading's level changes** (no cascade to children) | KISS — cascading level shifts are complex and surprising |
| 5 | **H1–H6 range** for horizontal level change | Full range including body H1s (chapters) |
| 6 | **Always active** — drag handle appears on TOC item hover | No feature flag, no toggle |
| 7 | **Title H1 (index 0) not draggable** | Consistent with editor drag; title is structural |
| 8 | **Single ProseMirror transaction** on drop | Atomic — reorder + level change in one undo step |
| 9 | **Drop indicator**: horizontal line between TOC items | Clean, standard pattern |
| 10 | **Level indicator**: badge/label on drag ghost showing target level (H1–H6) | Visual feedback during horizontal movement |
| 11 | **Folded sections are draggable** — move full content, fold state preserved | Natural outliner behavior; don't force unfold |
| 12 | **Flat drop order** — position = doc order, level only via horizontal drag | KISS — no smart nesting inference |
| 13 | **Single undo step** for reorder + level change | Natural consequence of single ProseMirror transaction |

## Technical Sketch

### dnd-kit setup

- `DndContext` with `PointerSensor` (activation distance 5px) + `KeyboardSensor`
- `SortableContext` with `verticalListSortingStrategy`
- **No axis restriction modifier** — allow free movement for two-axis
- `closestCenter` collision detection
- `DragOverlay` via `createPortal(overlay, document.body)` to avoid z-index/overflow issues from sidebar container

**Research insight:** `verticalListSortingStrategy` always returns `x: 0` for the sorting transform — it ignores horizontal pointer position entirely. This means it works correctly even without axis restriction; horizontal movement is our own concern, not the strategy's.

### Horizontal offset → level change

- Track `delta.x` from `onDragMove` — this is the canonical approach from the dnd-kit tree example
- Step threshold: **30px per level** (at 6 levels = 180px max range, fits within 270px sidebar)
- Compute `targetLevel = clamp(originalLevel + Math.round(deltaX / 30), 1, 6)`
- **Store `targetLevel` in a ref, not state** — only the `DragOverlay` reads it, avoids re-rendering all sortable items on horizontal movement
- Update level badge by reading the ref in the `DragOverlay` render

### Drop handler (ProseMirror transaction)

**Simplified pattern** (research finding — avoids `setNodeMarkup` and insert/delete branching):

1. Get section range via `computeSection(doc, headingPos, headingLevel)`
2. `doc.slice(sectionFrom, sectionTo)` to extract section content
3. If level changed: bake it into the content via `Fragment.replaceChild(0, newHeadingNode)` — avoids a separate `setNodeMarkup` step and extra position mapping
4. **Always delete-first, then insert at mapped target**:

   ```
   tr.delete(sectionFrom, sectionTo)
   tr.insert(tr.mapping.map(targetPos), content)
   ```

   This eliminates the if/else branching from the editor drag pattern. `tr.mapping.map()` correctly handles both move-up and move-down cases.
5. Move cursor to start of relocated heading: `tr.setSelection(TextSelection.create(tr.doc, mappedTarget + 1))`
6. `view.dispatch(tr.scrollIntoView())`

**Why this is better than the editor drag pattern:**

- 2 steps max (delete + insert) vs. conditional 2-step with branching
- No `setNodeMarkup` step — level change baked into content before positional ops
- Cleaner undo step, fewer StepMaps

### TOC rebuild flash mitigation (HIGH priority)

After dispatching the ProseMirror transaction, `@tiptap/extension-table-of-contents` fires `onUpdate` with entirely new item objects. This races dnd-kit's drop animation and can cause a visual pop.

**Solution:** Suppress `DragOverlay` synchronously in `onDragEnd` (set `activeId = null`) **before** dispatching the ProseMirror transaction. The user sees the ghost disappear, then the TOC list snaps to its new order — no competing animations.

### Component architecture

- `TocSidebar` gets `DndContext` + `SortableContext` wrapper
- Extract `SortableTocItem` as a **`React.memo` component** — critical for preventing re-render of all items on every sort-order change during drag
- `DragOverlay` renders via `createPortal` to `document.body` — simplified ghost (heading text + level badge)
- Use `CSS.Translate.toString(transform)` instead of `CSS.Transform.toString` — avoids triggering scale-related layout recalculations

### Drop indicator design

| Property | Value | Source |
|---|---|---|
| Thickness | 2px | Industry standard (Notion, Atlassian, Adobe Spectrum) |
| Color | `var(--primary)` / brand accent | Match existing brand tokens |
| Left terminal | 6px circle, same color | Anchors the indicator visually |
| Left offset | `targetLevel * 16px + 8px` | Communicates target indent level |
| Right | `8px` from container edge | Padding |

### Ghost (DragOverlay) design

| Property | Value |
|---|---|
| Opacity | `0.9` |
| Scale | `1.02` |
| Box shadow | `0 4px 12px rgba(0,0,0,0.15)` |
| Border radius | Match TOC item radius |
| Width | Fixed to original item width |
| Content | Heading text + level badge (H1–H6), updating live |

### Interaction thresholds

| Parameter | Value | Rationale |
|---|---|---|
| Activation distance | 5px | Dedicated handle disambiguates intent; 8px in tab bar where whole tab is target |
| Level step | 30px horizontal per level | 6 levels × 30px = 180px max; fits in 270px sidebar |
| Auto-scroll threshold | 20% of container height | dnd-kit default, percentage-based adapts to different heights |
| Auto-scroll max speed | 15px/frame | Prevents runaway scrolling |

### Keyboard accessibility

| Key | Action |
|---|---|
| `Space` / `Enter` | Pick up / drop item |
| `Arrow Up` / `Down` | Move to previous/next position |
| `Arrow Left` / `Right` | Outdent / indent (change level) |
| `Escape` | Cancel drag |

dnd-kit's `KeyboardSensor` handles vertical. Horizontal indent needs a custom `coordinateGetter` that maps left/right arrows to level changes.

### ARIA attributes

```html
<div role="tree" aria-label="Table of contents">
  <div role="treeitem" aria-level="2" aria-expanded="true"
       aria-roledescription="sortable">
    Section title
  </div>
</div>
```

Custom dnd-kit announcements for screen readers:

- `onDragStart`: "Picked up heading 'X'. Current level: H2."
- `onDragOver`: "Over 'Y'. Target level: H3."
- `onDragEnd`: "Dropped 'X' at level H3."

## Existing Code to Reuse

| Asset | Location | Usage |
|-------|----------|-------|
| `computeSection` | `heading-node/helpers/compute-section.ts` | Section range calculation |
| `findAllSections` | `heading-node/helpers/match-section.ts` | Section index/pos mapping |
| dnd-kit sensors pattern | `tab-bar/tab-bar.tsx` | `PointerSensor` + `KeyboardSensor` setup |
| `SortableTab` pattern | `tab-bar/tab-bar.tsx` | `React.memo` + `useSortable` composition |
| Drop indicator CSS | `heading-drag.scss` (`.heading-drag-indicator`) | Adapt for vertical TOC indicator |
| Ghost element styling | `heading-drag.scss` (`.heading-drag-ghost`) | Adapt for TOC ghost |

## Performance Profile

| Metric (100 headings) | Projected | Safe? |
|---|---|---|
| Re-render per sort change (with `React.memo`) | ~0.8ms | Yes |
| Collision detection per frame | ~0.04ms | Yes |
| ProseMirror transaction (50-block section) | ~2ms | Yes |
| TOC rebuild after drop | ~1.5ms | Yes |
| Total frame budget during drag | ~18% | Yes |

**Virtualization threshold:** ~150 items. Not needed for typical documents (10–40 headings).

## Known Limitations

### Yjs remote cursor jump (y-prosemirror bug)

[y-prosemirror #105](https://github.com/yjs/y-prosemirror/issues/105): Large section moves (delete + insert) can't be represented as a single-range diff. Other users' cursors may jump. This is a y-prosemirror limitation, not fixable in our transaction code. Small sections are less affected. Accept as known behavior until y-prosemirror is rewritten.

## Out of Scope

- Cascading level changes to child headings (future enhancement if needed)
- Multi-select drag (drag multiple TOC items at once)
- Cross-document drag
- Touch/mobile drag support (can add later via dnd-kit `TouchSensor`)
- Virtualization (not needed under ~150 items)

## Open Questions

_None — all resolved during brainstorm and research._
