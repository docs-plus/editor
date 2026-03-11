---
date: 2026-03-10
topic: heading-fold-unfold
status: superseded
superseded_by: docs/brainstorms/2026-03-11-fold-overlay-to-decoration-brainstorm.md
---

# Heading Fold/Unfold with Paper Crinkle Effect

> **Superseded**: This brainstorm described the initial overlay-based architecture (absolutely-positioned divs + SVG crinkle). That approach was fully replaced on 2026-03-11 with a `Decoration.node()` + `Decoration.widget()` architecture that eliminated all overlay positioning code. See the [overlay-to-decoration brainstorm](../brainstorms/2026-03-11-fold-overlay-to-decoration-brainstorm.md) for the re-architecture rationale.

## What We're Building

A fold/unfold system for heading sections that lets users collapse portions of their document. When folded, the section content is replaced by a **paper crinkle/accordion visual** — an SVG-rendered strip (~40-50px) showing realistic drawn fold lines with shadows, as if the paper has been physically folded like a fan. Unfolding smooths the creases and reveals the content.

Fold behavior respects heading hierarchy: folding an H3 collapses everything until the next same-or-higher-level heading (H3, H2, or H1), including nested children (H4, H5, H6 under it). This is the standard outliner model already used by `computeSection()`.

The title H1 at position 0 is never foldable. Fold state is per-user, per-document, persisted in localStorage.

## Why This Approach

### Approaches Considered

1. **Plugin View DOM Manager (chosen)** — ProseMirror plugin's `view` owns all DOM: crinkle overlays, content hiding, animation timing. Mirrors the HeadingDrag architecture.

2. **Decorations + Plugin View** — Decorations hide content, plugin view manages overlays. Rejected because decoration changes are instant and can't be animated to match overlay timing.

3. **React Overlay Layer** — React component renders overlays. Rejected because it introduces a new architectural pattern and React re-renders are async, causing timing gaps.

### Why Plugin View DOM Manager

- **Proven pattern**: HeadingDrag already uses this exact architecture — plugin view manages external DOM elements (drag wrapper, ghost, drop indicator) positioned outside contenteditable.
- **Animation control**: Full imperative control over animation choreography. The fold/unfold timing between the overlay animation and content collapse must be perfectly synchronized.
- **No framework bridge**: No React ↔ ProseMirror state coordination. The plugin is the single source of truth.
- **Architectural consistency**: Fits naturally alongside HeadingDrag and HeadingScale in the extension stack.

## Key Decisions

- **Trigger**: Toggle chevron in the TOC sidebar only. No in-editor toggle icon. This keeps the editor canvas clean and uncluttered.

- **Title H1**: Never foldable. Consistent with HeadingDrag (skips title at pos 0).

- **Section boundaries**: Reuse `computeSection(doc, headingPos, headingLevel)` — heading + everything until next same-or-higher-level heading.

- **Hierarchy cascade**: Folding a heading folds its entire section, which includes any child headings (H4 under H3, etc.). The child headings and their content are all hidden.

- **Crinkle visual**: SVG-rendered fold lines with shadows for realism. Fixed height ~40-50px regardless of original section length. The overlay **stays visible** in folded state as the visual representation of the fold.

- **Animation flow**:
  - **Fold**: Overlay appears over section, plays crinkle animation (paper compresses into pleats). Content behind overlay collapses in sync. Overlay remains visible showing crinkled paper.
  - **Unfold**: Overlay plays unfold animation (creases flatten). Content behind expands in sync. When animation completes, overlay is removed and content is fully readable.

- **Architecture**: ProseMirror plugin with `view` component. Plugin view manages all DOM — crinkle overlays inserted into editor wrapper (outside contenteditable), content hiding via CSS classes on DOM nodes. No ProseMirror decorations for fold visual.

- **Persistence**: Per-user, per-document in localStorage. Key pattern: `tinydocy-folds-{documentId}`. Store folded heading IDs (from TableOfContents extension `data-toc-id` attributes, not positions — positions change on edit).

- **TOC sidebar**: Child headings of a folded section are hidden from the TOC. Only the folded parent heading is visible (with chevron indicating fold state). The chevron is the sole toggle control.

- **Overlay click**: Clicking the crinkle overlay toggles fold state (unfolds the section). This complements the TOC chevron and follows the industry-standard expectation that a visible affordance with `cursor: pointer` is interactive.

- **Cursor behavior**: Cursor/selection skips over folded regions. Arrow-down from a folded heading jumps to the next visible heading or content. Implemented via plugin `handleKeyDown`.

## Fold State Identification

Fold state is stored by heading `data-toc-id` (from TableOfContents extension), not by document position or UniqueID's `data-id`. The `data-toc-id` is the same attribute used by the TOC sidebar for item identification, ensuring consistency between the fold plugin and the TOC. On editor load, resolve `data-toc-id` → position to apply fold state.

## Overlay Positioning

The crinkle overlay element is:

- Inserted into `editorView.dom.parentElement` (same container as the HeadingDrag wrapper)
- Positioned absolutely, below the heading DOM element
- Height: ~40-50px fixed
- Width: matches the editor content width
- Must scroll with the editor content (lives in the scroll container)
- Must update position when content above changes (headings added/removed)

## Content Hiding Strategy

When a section is folded:

1. Identify all top-level content nodes in the section range (heading excluded)
2. Apply CSS class (`heading-fold-hidden`) to each DOM node via `view.dom.children[i]`
3. CSS: `display: none`
4. Insert crinkle overlay after the heading DOM element
5. During animation: coordinate overlay crinkle timing with content collapse timing

## Post-Implementation Learnings

These were discovered and resolved during implementation. Documented here so teams don't repeat the investigation.

### 1. Heading ID: `data-toc-id`, not `data-id`

The initial plan referenced `data-id` (from the UniqueID extension). In practice, the TOC sidebar uses `data-toc-id` (from the TableOfContents extension) for item identification. The fold plugin must use the same attribute for consistent state lookup between the plugin and the TOC. Mixing them causes fold toggles to silently fail (the plugin can't find the heading DOM).

### 2. ProseMirror DOM Reconciliation Strips Manual Classes

Adding CSS classes directly to ProseMirror-managed nodes (inside `view.dom`) works once, but ProseMirror's `DOMObserver` detects the mutation and may re-render the node on the next transaction, stripping the class. For the `heading-fold-hidden` class (which sets `display: none`), this means content reappears after any Yjs sync or user edit.

**Solution**: The plugin calls `view.domObserver.stop()` before DOM mutations and `view.domObserver.start()` after. This is a standard ProseMirror escape hatch for plugins that need imperative DOM control. The `reconcileFold()` function re-applies classes on every `update()` call for already-folded headings, guarded by stop/start to prevent infinite mutation loops.

### 3. Fold Animation Synchronization (5-Phase Choreography)

The fold animation requires precise coordination between the heading's `margin-bottom` transition and the overlay's `height` transition. The initial implementation added the CSS transition class before setting the initial margin value, causing the margin to animate from `0 → contentHeight` and then immediately interrupt to `contentHeight → CRINKLE_HEIGHT`. The overlay, meanwhile, animated cleanly — result: desync.

**Solution**: A 5-phase choreography:

1. **Measure** content height while content is still visible
2. **Create overlay** at full content height (masks the content area before anything changes)
3. **Swap** content → margin instantly (no transition class yet — overlay masks the disappearance)
4. **Commit** via forced reflow (`void el.offsetHeight`)
5. **Animate** — add transition class + set target values in the same frame

Both transitions use identical duration and easing via CSS custom properties (`--tt-fold-duration`, `--tt-transition-easing-cubic`).

### 4. Content Height Measurement

`getBoundingClientRect().bottom` on the last content node doesn't include its margin-bottom, leading to a height undercount. For sections that aren't the last in the document, measuring from `headingEl.bottom` to `nextSiblingEl.top` captures the exact visual space including inter-element margins.

### 5. Stale Fold IDs (Pruning)

When a collaborator deletes a folded heading, the fold ID becomes stale. The initial approach dispatched a transaction inside the plugin view's `update()` to remove stale IDs — this violates ProseMirror's data flow (state transitions shouldn't trigger side-effect dispatches in view hooks) and causes cascading transaction storms under heavy Yjs sync.

**Solution**: Pruning was moved to `state.apply()`. On `docChanged`, the plugin scans the new document for live heading `data-toc-id` values and removes any folded IDs that no longer exist. This is a single-pass, zero-dispatch operation.

## Reference Images

- **Paper accordion fold**: Physical reference for the crinkle effect (fan-fold pleats with light/shadow)
- **docs.plus**: Collapsed "Updates" section showing horizontal fold lines in the editor, with TOC sidebar toggle

## Next Steps

Implementation complete. Plan executed and verified. See plan document for task-by-task status.
