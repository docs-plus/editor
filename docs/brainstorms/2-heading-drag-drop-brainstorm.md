# Heading Section Drag-and-Drop (Revised)

> **Revision date:** 2026-03-10
> **Original date:** 2026-03-09
> **Status:** Implemented — core drag-and-drop working with floating handle, drop indicator, drag ghost, section-level reorder, and auto-scroll.

## What We're Building

A drag handle that appears beside each heading (except the title H1), allowing users to grab and reorder entire heading "sections." When a user drags a heading, all content below it — paragraphs, sub-headings, lists, images — moves with it as a single unit. The boundary of a section is defined by the next heading of the same or higher level.

**Example:**

```
H1 Title (fixed, not draggable)
H2 Introduction        ← drag this
  paragraph A
  H3 Details
    paragraph B
  H3 Notes
    paragraph C
H2 Conclusion           ← stop here (same level)
  paragraph D
```

Dragging "H2 Introduction" moves: the H2 node + paragraph A + H3 Details + paragraph B + H3 Notes + paragraph C. "H2 Conclusion" and below stay in place.

## Why This Revision

The original implementation (custom ProseMirror plugin with `::before` pseudo-element handles and document-level mouse events) had three structural problems:

1. **Handle inside contenteditable.** The `::before` pseudo-element sits within the `.ProseMirror` container. Clicks in the handle zone send `event.target` to the ProseMirror container rather than the heading, requiring coordinate-based hit detection as a workaround.

2. **Unreliable visual feedback.** `view.nodeDOM(pos)` returns null under Yjs collaboration for top-level blocks, breaking both the drop indicator positioning and the section-opacity feedback. The fallback to `view.dom.children[i]` works but is fragile.

3. **No upstream lineage.** The entire drag mechanism is custom-built (~420 lines), with no relationship to Tiptap's official `@tiptap/extension-drag-handle`. This means no benefit from upstream bug fixes, collaboration improvements, or API evolution.

## Chosen Approach: Fork `@tiptap/extension-drag-handle`

Fork the Tiptap drag-handle extension source into the project, then modify it for heading-section-specific behavior.

### What we keep from upstream

| Component | Upstream source | Purpose |
|-----------|----------------|---------|
| Handle rendering | `drag-handle-plugin.ts` | Wrapper `<div>` (`position: absolute; pointer-events: none`) appended to `editor.view.dom.parentElement`, with handle element inside. Handle lives outside contenteditable. |
| Floating-ui positioning | `drag-handle-plugin.ts` (`repositionDragHandle`) | `@floating-ui/dom`'s `computePosition()` for pixel-perfect handle placement relative to the hovered heading's DOM element |
| Mousemove node detection | `drag-handle-plugin.ts` (`handleDOMEvents.mousemove`) | rAF-throttled mouse tracking using `pendingMouseCoords` pattern — schedules a single rAF per frame, finds nearest top-level block via coordinate detection |
| Handle visibility | `drag-handle-plugin.ts` (`showHandle`/`hideHandle`) | Show on hover via `visibility: ''`, hide via `visibility: 'hidden'` + `pointer-events: none`. Hide on `keydown` (typing) and `mouseleave`. |
| Collaboration position tracking | `drag-handle-plugin.ts` (`getRelativePos`/`getAbsolutePos`) | Yjs-safe position mapping via `@tiptap/y-tiptap`. Uses `isChangeOrigin` from `@tiptap/extension-collaboration` to distinguish local vs remote doc changes. |
| Plugin view lifecycle | `drag-handle-plugin.ts` (`view.destroy()`) | Cleanup: remove event listeners, cancel rAF, remove wrapper DOM from parent |
| Element detection helpers | `findNextElementFromCursor.ts`, `getOuterNode.ts` | Finding top-level block DOM elements from coordinates; clamping coordinates to content bounds |

### What we replace

| Original | Replacement | Reason |
|----------|-------------|--------|
| HTML5 DnD (`dragstart`/`dragend`/`drop`) | Custom mouse events (mousedown → mousemove → mouseup) | `draggable="true"` inside contenteditable is unreliable for section-level dragging. Custom mouse events give full control over the drag lifecycle. |
| Single-block drag (`dragHandler.ts`) | Section-level drag (`computeSection`) | We drag heading + all children, not a single block |
| `@tiptap/extension-node-range` dependency | Direct `doc.slice()` + `tr.insert()`/`tr.delete()` | NodeRangeSelection is for multi-block selection, not section reorder |
| Nested scoring system (`findBestDragTarget.ts`, `scoring.ts`, `defaultRules.ts`, `edgeDetection.ts`) | Simple heading-only filter | We only care about headings at depth 0, no scoring needed |

### What we add

| Component | Purpose |
|-----------|---------|
| `computeSection(doc, headingPos, headingLevel)` | Compute section range: heading → next same-or-higher-level heading (or end of doc) |
| `canMapDecorations(tr, oldDoc)` + `buildHandleDecos(doc)` | Node decorations with `has-drag-handle` class for CSS styling; shared safety check determines whether `DecorationSet.map()` is safe or a full rebuild is needed |
| Drop indicator DOM element | Thin horizontal line (2px, brand color) positioned at candidate drop position during drag |
| Section visual feedback | `heading-section-dragging` class for opacity reduction + lift/shadow on the section being dragged |
| Custom drag ghost | Notion-style: heading text in a small floating card |
| Heading-only mousemove filter | Skip non-heading nodes in the upstream's `mousemove` handler |

## Decisions

1. **Title H1 is NOT draggable.** It lives at pos 0 and is enforced by `TitleDocument`. The drag handle only appears on headings at pos > 0.

2. **All H1-H6 levels are draggable.** Each level drags its own section — an H3 drags content until the next H3/H2/H1, an H1 (non-title) drags until the next H1.

3. **Section = heading + everything until next same-or-higher level.** Standard outliner behavior (Notion, Logseq, Roam). Given heading level `L` at position `P`, the section spans from `P` to the position of the next top-level heading with level `<= L`, or end of document.

4. **Drop target: any top-level block boundary** except before the title H1. The heading level does NOT auto-adjust on drop — it stays as-is. Sub-heading levels within a dragged section also preserve their relative levels.

5. **Custom mouse events, no HTML5 DnD.** Section-level dragging requires control over what constitutes the dragged content (a computed range, not a single DOM node). HTML5 DnD has no native concept of "drag a range of blocks," so we use mousedown/mousemove/mouseup on document for full lifecycle control.

6. **Handle lives outside contenteditable.** Rendered as a standalone DOM element positioned via `@floating-ui/dom`, appended to the editor's parent element (the Tiptap drag-handle pattern). The handle does NOT have `draggable="true"`.

7. **Notion-style visual feedback.** Grip dots (⠿) icon on hover, custom drag ghost showing heading text in a floating card, blue drop indicator line (2px, brand color), section opacity reduction during drag.

8. **Scope: headings only.** This is a section-level reorder tool, not a general block-drag system.

9. **Keyboard and touch support deferred.** Mouse-only for this iteration.

10. **Upstream tracking.** Fork from `@tiptap/extension-drag-handle` v3.20.1 with origin comments. Selective merge for future upstream updates.

## Fork Strategy

### File structure

```
components/tiptap-node/heading-node/
├── heading-drag-extension.ts     # Tiptap Extension (entry point)
├── heading-drag-plugin.ts        # ProseMirror plugin (forked from drag-handle-plugin.ts)
├── heading-drag.scss             # Handle, indicator, and drag feedback styles
└── helpers/
    ├── can-map-decorations.ts    # Shared safety check for DecorationSet.map() (also used by HeadingScale)
    ├── compute-section.ts        # Section range computation
    ├── find-heading-from-cursor.ts  # Adapted from findNextElementFromCursor.ts
    └── reposition-handle.ts      # floating-ui positioning (extracted from plugin)
```

### Upstream tracking

The forked code carries comments marking upstream origin:

```typescript
// Forked from @tiptap/extension-drag-handle v3.20.1
// Modified: [description of change]
```

When Tiptap releases updates to `@tiptap/extension-drag-handle`, we can diff the upstream changes against our fork and selectively merge relevant fixes (especially collaboration/position-tracking improvements).

### Dependencies

**Keep:**

- `@tiptap/y-tiptap` (already in the project, needed for Yjs relative position helpers)
- `@tiptap/extension-collaboration` (already in the project, needed for `isChangeOrigin` to detect remote Yjs changes in position tracking)

**Remove:**

- `@atlaskit/pragmatic-drag-and-drop` — not needed, was exploratory
- `@atlaskit/pragmatic-drag-and-drop-auto-scroll` — not needed
- `@tiptap/extension-drag-handle` — source is forked, runtime dependency is not needed
- `@tiptap/extension-node-range` — not needed for section drag

**Add:**

- `@floating-ui/dom` — must be a **direct** dependency, not relied on as transitive via `@floating-ui/react`. Transitive dependency resolution is fragile and can break if the intermediate package changes its internals.

## Interaction with Existing Extensions

| Extension | Impact | Handling |
|---|---|---|
| **TitleDocument** | Title H1 must stay at pos 0 | Skip pos 0 heading; reject drops before title end |
| **HeadingScale** | Section structure changes | Both use `Decoration.node()` on headings. ProseMirror merges node decorations from multiple plugins automatically — HeadingScale sets `style`, HeadingDrag sets `class`. No conflict. Both share `canMapDecorations` for safe decoration updates. |
| **UniqueID** | Heading IDs must survive move | IDs are node attributes — preserved in slice |
| **TableOfContents** | Anchors update on doc change | TOC re-scans on `onUpdate` — automatic |
| **Collaboration** | Concurrent edits during drag | Yjs relative position tracking (from upstream fork). Standard ProseMirror transaction for move. |
| **Placeholder** | Irrelevant | No interaction |

## Performance and Memory Safety

### Handle element lifecycle

The handle is a single DOM element created once in `plugin.view()` and destroyed in `view.destroy()`. It is repositioned via `computePosition()` on every `mousemove` (rAF-throttled). No DOM allocation per heading — unlike widget decorations.

### Decoration lifecycle (canMapDecorations optimization)

Node decorations for `has-drag-handle` class (HeadingDrag) and `--hd-size` style (HeadingScale) both use a two-tier `apply` pattern guarded by a shared `canMapDecorations` safety check:

1. **No doc change** → return `prev` directly (zero allocation)
2. **Doc changed, content-only edit** (passes `canMapDecorations` check) → `DecorationSet.map()` (O(log H) position remap)
3. **Structural change** (splits, joins, moves, heading insertions) → full O(N) rebuild

The `canMapDecorations` check validates that a transaction is a single `ReplaceStep` with no structural depth changes, no cross-node-boundary deletions, and no heading content in the inserted slice. This prevents the `DecorationSet.map()` breakage discovered during implementation (see Lessons Learned below).

### Drag state: `WeakMap<EditorView, DragInfo>`

Ephemeral drag state (section range, indicator element, rAF id, document-level listeners) lives in a `WeakMap` keyed by `EditorView`. GC-safe, per-instance, no cross-editor contamination.

### rAF throttling

Both `mousemove` (for handle positioning) and drag-`mousemove` (for drop indicator) are throttled via `requestAnimationFrame` — caps work at ~60fps.

## Implementation Notes

### Dual UI pattern: floating handle + node decorations

The design uses **two complementary UI mechanisms**:

1. **Floating handle element** (from upstream fork) — a single DOM element positioned via `@floating-ui/dom` next to the currently hovered heading. This is the interactive drag affordance. It lives outside contenteditable and follows the mouse as it moves between headings.

2. **Node decorations** (`has-drag-handle` class) — applied to all non-title headings via ProseMirror `Decoration.node()`. These provide CSS hooks for subtle visual cues (e.g. cursor change on hover, heading highlight). They do NOT render the grip icon — the floating handle does that.

### Custom drag ghost

Since we use custom mouse events (not HTML5 DnD), we cannot use `event.dataTransfer.setDragImage()`. Instead, the drag ghost is a custom DOM element:

- Created on drag activation (after threshold)
- Contains the heading's text content in a small floating card
- Positioned absolutely, following the cursor via `mousemove`
- Removed on `mouseup` / cleanup

### Auto-scroll during drag

When the dragged section needs to move beyond the visible viewport, the editor should scroll automatically. During the `mousemove` handler, detect proximity to viewport edges (top/bottom 50px zone) and call `scrollBy()` on the scroll parent. This is simpler than a library-based solution and sufficient for the single-container case.

### Shared `canMapDecorations`

`canMapDecorations(tr, oldDoc)` is a shared helper in `components/tiptap-node/heading-node/helpers/can-map-decorations.ts`, imported by both `heading-scale-extension.ts` and `heading-drag-plugin.ts`. It determines whether a ProseMirror transaction is safe for `DecorationSet.map()` or requires a full decoration rebuild. This replaces an earlier fingerprint-based approach that was removed after discovering `DecorationSet.map()` breakage on block splits (see Lessons Learned).

### Editor blur during drag

If the editor loses focus during drag (user tabs away, another window gains focus), the `blur` event should trigger cleanup equivalent to `mouseup`. The `mouseup` listener on `document` handles most cases, but `blur` on `view.dom` provides an additional safety net.

## Edge Cases

1. **Adjacent same-level headings:** Section range is just the heading node itself.
2. **Last section in document:** `to = doc.content.size`.
3. **Drop between title H1 and first body block:** Valid (drop pos = title's nodeSize).
4. **Collaborative conflict:** User A drags while user B edits inside the section. Yjs merges at the text level. Transaction uses standard ProseMirror operations.
5. **Undo:** Single transaction = atomic Cmd+Z.
6. **Empty headings:** Handle shows, draggable, placeholder unaffected.
7. **Editor destroyed mid-drag:** `view.destroy()` removes handle, indicator, clears listeners.
8. **Drag cancelled (mouse leaves editor):** `mouseup` on document fires cleanup. If it doesn't fire, WeakMap + plugin destroy provides failsafe.
9. **Editor blur during drag:** `blur` on `view.dom` triggers cleanup — handles tab-away, window switch, and other focus-loss scenarios.
10. **Long document scroll during drag:** Auto-scroll engages when cursor is within 50px of viewport top/bottom edges during drag.

## Implementation Status

**Completed (2026-03-10):**

- Floating drag handle positioned via `@floating-ui/dom` — appears on hover beside any non-title heading
- Section-level drag: mousedown → 4px threshold → full drag lifecycle with custom mouse events
- Drag ghost: Notion-style floating card with heading text following cursor
- Drop indicator: blue 3px line with dot endpoints, positioned at nearest valid drop boundary
- Section feedback: 40% opacity + shadow on the section being dragged
- Auto-scroll: 50px zone at viewport top/bottom edges, 15px/tick speed
- Atomic ProseMirror transaction for move (single Cmd+Z undo)
- Shared `canMapDecorations` helper for safe `DecorationSet.map()` in both `HeadingScale` and `HeadingDrag`
- Fixed decoration loss on block splits (Enter key) — `canMapDecorations` prevents `map()` for structural changes
- Removed `@atlaskit/pragmatic-drag-and-drop`, `@tiptap/extension-drag-handle`, `@tiptap/extension-node-range`
- Added `@floating-ui/dom` as direct dependency

**Deferred:**

- Keyboard accessibility (drag via keyboard shortcuts)
- Touch device support (pointer events)
- Drag handle animation/transition on appear/disappear

## Lessons Learned

### Tiptap React v3 parent-swap lifecycle

The most significant implementation challenge. Tiptap React v3 creates `EditorView` with a temporary internal div as parent. When `EditorContent` mounts, it moves `view.dom` to the real container (`document-editor-content`). Any DOM elements appended to `view.dom.parentElement` in `plugin.view()` are orphaned on the temporary div, along with event listeners.

**Fix:** `mount()` detects parent changes by comparing `mountedParent` with `editorView.dom.parentElement` on every `update()` call. When the parent changes, it calls `unmountParent()` to clean up old listeners and re-mounts to the new parent.

### ProseMirror removes foreign DOM children

Appending the drop indicator to `editorView.dom` (the contenteditable) causes ProseMirror to silently remove it during DOM reconciliation. All floating UI elements (wrapper, handle, indicator) must live in the parent element, outside the contenteditable.

### DecorationSet.map() breaks on block splits

The most subtle bug. After dragging a heading to a new position, pressing Enter at the end of that heading caused it to lose both `--hd-size` (HeadingScale) and `has-drag-handle` (HeadingDrag) decorations permanently.

**Root cause:** ProseMirror's `splitBlock` command creates a `ReplaceStep` with `slice.openStart > 0`. When `DecorationSet.map()` processes this step, it shifts the decoration's `to` position past the newly created sibling node. The result is a decoration range `[from, to]` that no longer matches the original node's `[from, from + nodeSize]`, so ProseMirror silently drops it.

A fingerprint-based optimization (comparing heading level sequences) couldn't catch this because block splits don't change heading structure — the heading count and level sequence are identical before and after the split.

**Fix:** Replaced the fingerprint approach with `canMapDecorations(tr, oldDoc)`, which inspects the transaction's step structure to determine if `map()` is safe. The check rejects any step with `openStart > 0` (splits), cross-boundary deletions (joins), multi-step transactions (moves), or heading content in the inserted slice (paste). Content-only edits (typing, backspace within a block) pass the check and use the O(log H) `map()` fast path.

### Gap-aware drop targeting

When the dragged section spans many nodes, `findDropTarget` skips all of them, creating a large visual gap between the last non-skipped node and the first non-skipped node after the section. Without special handling, the drop indicator jumps to the far-away node instead of staying near the cursor.

**Fix:** When the cursor is in a gap between two non-skipped nodes, compute the gap midpoint and snap the indicator to the closer boundary.

## Open Questions

None — all decisions resolved, implementation complete.
