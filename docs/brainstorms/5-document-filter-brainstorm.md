---
date: 2026-03-12
topic: document-filter
status: implemented
---

# Document Filter (Heading & Content)

## What We're Building

A document filter feature that lets users search by heading text and body content, then filter the document to show only matching sections. The filter delegates ALL section folding to the existing `HeadingFold` plugin — no duplicated crinkle/hiding code. When a filter is committed, non-matching sections are folded via the fold plugin (showing the fold crinkle), while matching sections, their ancestors (for hierarchy context), and their descendants (full subtree) remain visible.

Matching text is highlighted with `Decoration.inline()` using an amber/yellow background. Multiple filter terms can be stacked as tags, combined with OR (default) or AND logic via a toggle.

The filter UI is a compact floating panel anchored in the top-right corner below the toolbar (sticky positioning via a zero-height anchor element). Users type a term and see live highlighting (debounced) without section folding. Pressing Enter locks the term as a persistent filter tag, folds non-matching sections via HeadingFold, and allows adding more terms. Active filter tags appear as removable chips. The filter state is encoded in URL search params for sharing, scoped per-tab (cleared on tab switch).

## Why This Approach

### Approach chosen: Dedicated ProseMirror Filter Plugin (Approach A)

Three approaches were evaluated:

1. **Dedicated Filter Plugin + Fold Delegation** (chosen) — A new `HeadingFilter` extension + plugin that handles only inline highlights and match counting. All section folding is delegated to `HeadingFold` via `tr.setMeta(headingFoldPluginKey, { type: "set", ids, persist: false })`. DRY — zero duplicated crinkle/hiding code.

2. **Unified Fold+Filter Plugin** (rejected) — Extends `HeadingFold` to handle filter state too. Tightest fold reuse but couples two features, making the fold plugin more complex and harder to maintain independently.

3. **React State + CSS** (rejected) — All logic in React with CSS classes on DOM nodes. Simplest but fights ProseMirror's rendering model and doesn't truly reuse fold decorations. Highlight marks would change the Yjs document.

### Why A (with fold delegation) won

- Fold plugin stays single-purpose — extended only with a `persist?: boolean` flag on `set` meta to skip localStorage saves for filter-driven folds
- Filter plugin is lean: only `Decoration.inline()` highlights, section matching, and fold dispatch
- `computeOwnRange`, `canMapDecorations`, and `computeSection` are shared utilities
- On filter clear, original fold state is restored from a snapshot (`savedFoldIds`)

## Key Decisions

### Search & Matching

- **Search scope**: heading text + body content (full section text search)
- **Match algorithm**: case-insensitive substring matching
- **Two-phase UX**:
  1. **While typing** (debounced ~250ms): highlight matched text with `Decoration.inline()` in the editor + dim/highlight in TOC. All sections remain visible — no folding yet.
  2. **On Enter** (commit): lock the term as a filter tag, fold non-matching sections, keep highlights. Input clears for the next term.
- **Multi-filter logic**: OR by default (show section if ANY filter matches), with toggle to AND (show only if ALL filters match)
- **Match count**: show a count indicator (e.g. "3/12 sections") in the filter UI

### Decorations & Visibility

- **Phase 1 (typing)**: `Decoration.inline()` on matched text spans — amber/yellow highlight background (`.heading-filter-highlight`), visually distinct from user-applied `Highlight` marks. All sections remain visible; no folding occurs during preview. TOC sidebar highlights matching items via `previewMatchIds` prop.
- **Phase 2 (committed filter)**: Filter plugin dispatches fold commands to HeadingFold:
  - *Direct matches*: unfolded (fully visible — heading + body content)
  - *Ancestor sections* (`getAncestorIds`): unfolded — heading visible for hierarchy context
  - *Descendant sections* (`getDescendantIds`): unfolded — full subtree of matched headings visible
  - *Non-matching sections*: folded via HeadingFold (shows fold crinkle, hides body content)
- **Search scope per heading**: `computeOwnRange()` limits text search to a heading's own content (heading text + body paragraphs up to the next heading of any level), preventing parent sections from false-matching on nested subsection content
- **Ancestor preservation**: if a child heading matches, all ancestor headings up to root stay visible (path-to-root preservation via `getAncestorIds()`)
- **Descendant propagation**: if a heading matches, all nested child headings (its subtree) remain visible via `getDescendantIds()` — preserves full hierarchy tree
- **Title preservation**: document title (first H1, enforced by TitleDocument) is always visible regardless of filter; title H1 (index 0) is always skipped in fold dispatch and `findAllSections`
- **Fold coordination**: filter dispatches `tr.setMeta(headingFoldPluginKey, { type: "set", ids: sectionsToFold, persist: false })` to fold non-matching sections; `persist: false` prevents filter-driven folds from saving to localStorage; on filter clear, original fold state is restored from a snapshot (`savedFoldIds`)
- **No animation during typing**: live preview only adds inline highlights + TOC highlighting, no section folding. Folding happens on Enter (commit)

### UI & Interaction

- **Filter panel**: a compact floating panel anchored in the top-right corner below the toolbar (sticky positioning via a zero-height `filter-panel-anchor`), toggled via toolbar button or `Cmd/Ctrl+Shift+F`
- **Panel layout**: two rows — (1) search input row with search icon, text input, match count (`"3/12 sections"`), and close button; (2) filter tags row with removable chips, ANY/ALL mode toggle, and clear button
- **Keyboard shortcut**: `Cmd/Ctrl+Shift+F` to open/focus the filter input; also a dedicated toolbar button (`FilterIcon` from `lib/icons.ts`)
- **Active filters**: removable custom chip elements (`.filter-chip`) — not shadcn Badge — clicking X immediately re-filters with remaining tags
- **Mode toggle**: inline ANY/ALL button toggles OR ↔ AND logic; styled as a compact bordered toggle (`.filter-panel-mode`)
- **Clear/Reset**: a clear button removes all active filters and restores normal view

#### Filter Panel Lifecycle

- **Escape**: closes/dismisses the filter panel, but keeps committed filter tags active
- **Dismissed + active tags**: the panel collapses to show only active filter chips (`.filter-panel--collapsed`) — quick access to see/remove active filters without reopening the full panel
- **Reopen** (`Cmd+Shift+F` again): restores previous state (active tags, mode) and focuses the input for immediate typing
- **Toolbar button indicator**: filter icon in toolbar shows active state (colored/badged) when filters are applied

#### Tag Interaction

- **Remove tag**: click X on chip → immediately re-filter with remaining tags (no "Apply" step)
- **Add tag**: type term in input → Enter commits as chip → input clears for next term
- **Clear all**: clear button removes all chips, restores normal view, closes panel

- **Mobile**: deferred to v2 — filter button hidden on mobile breakpoint

### Collaboration

- **Local only**: filter state is per-user, not synced via Yjs (same as fold state)
- **Decorations are view-local**: `Decoration.node()` and `Decoration.inline()` are not persisted or shared

### TOC Sidebar

- **Dimming** (committed filter): all headings remain in the TOC, but non-matching headings are visually dimmed via `filteredIds` prop and `.toc-sidebar-item--dimmed` class
- **Preview highlighting** (while typing): matching TOC items are highlighted (bold, darker text) via `previewMatchIds` prop and `.toc-sidebar-item--preview-match` class
- **Click on dimmed heading**: scrolls to the heading and temporarily reveals it (does not clear the filter)

### URL Sharing

- **Encoding**: URL search params — e.g. `?filter=update|fix&mode=or` (pipe `|` delimiter)
- **Application**: on page load, read search params and apply filter state to the editor
- **Document scope**: params include `doc` identifier — e.g. `?doc=abc&filter=update|fix&mode=or`
- **Update**: active filter changes update the URL via `history.replaceState` (no page reload)
- **Per-tab scoping**: filter is per-tab — URL params are cleared on component unmount (tab switch) via `useEffect` cleanup in `useHeadingFilter`

### Architecture

- **Extension**: `HeadingFilter` (Tiptap Extension wrapping the ProseMirror plugin)
- **Plugin**: `createHeadingFilterPlugin()` in `heading-filter-plugin.ts`
- **Plugin state**: `{ slugs: string[], mode: 'or' | 'and', previewQuery: string, matchedSectionIds: Set<string>, totalSections: number, decos: DecorationSet }`
- **Plugin responsibilities**: inline highlight decorations only; delegates all section folding to HeadingFold via `headingFoldPluginKey` meta dispatch
- **Fold coordination**: snapshots user's fold state into closure variable `savedFoldIds` before filter; dispatches `{ type: "set", ids: sectionsToFold, persist: false }` for filter folds; restores `savedFoldIds` with `persist: true` on filter clear
- **Commands**: `applyFilter(slugs, mode)`, `commitFilter(slug)`, `removeFilter(slug)`, `clearFilter()`, `setFilterMode(mode)`, `filterPreview(query)`
- **Callbacks**: `onFilterChange({ matchedSectionIds, totalSections, slugs, mode })` — informs React for TOC dimming/highlighting and URL sync
- **Helpers**: reuse `canMapDecorations()`; dedicated `matchSections()`, `computeOwnRange()`, `filterSections()`, `findAllSections()`, `searchTextInRange()` in `match-section.ts`; internal helpers `getAncestorIds()`, `getDescendantIds()` (not exported)
- **Location**: `components/tiptap-node/heading-node/` (alongside fold and drag)

### Performance Optimizations

All custom plugins (HeadingScale, HeadingDrag, HeadingFold, HeadingFilter) share the `canMapDecorations` fast-path pattern: content-only edits (typing, backspace within a block) use O(1) or O(log N) position remapping; structural changes (Enter, node moves, heading inserts) trigger a full O(N) rebuild.

**HeadingFilter typing fast-path:**

- `canMapDecorations` returning `true` guarantees no heading addition/removal/reordering, so section count and IDs are unchanged
- When filter is inactive: `state.apply()` returns `prev` unchanged — O(1), zero allocations
- When filter is active: `state.apply()` remaps inline decorations via `prev.decos.map()` — O(log D), skips `findAllSections` entirely
- The O(N) `findAllSections` + `matchSections` rebuild only runs on structural edits (node splits, joins, drag moves)

**HeadingFold typing fast-path:**

- `view().update()` copies `prevFoldedIds` (Set) and `prevAnimating` (Map) only when their values actually changed, avoiding O(F) allocations per keystroke when fold state is stable

**SimpleEditor `onUpdate` callback:**

- `onTitleChange` fires only when the title text actually changes (ref comparison), preventing unnecessary parent re-renders on every keystroke in the document body

**Result:** for a 500-heading document, the per-keystroke cost is dominated by ProseMirror's internal handling + `DecorationSet.map()` operations — all custom plugin work is O(1) or O(log N) on the typing path.

### File Structure

```
components/tiptap-node/heading-node/
  heading-filter-extension.ts    # Tiptap extension wrapper with commands
  heading-filter-plugin.ts       # ProseMirror plugin (state, inline highlights, fold dispatch to HeadingFold)
  heading-filter.scss             # Editor decoration styles (highlight only — no hidden/folded/crinkle)
  heading-fold-plugin.ts         # Modified: HeadingFoldMeta.set supports persist?: boolean flag
  helpers/
    match-section.ts              # Text matching with computeOwnRange, filterSections, getAncestorIds, getDescendantIds
    filter-url.ts                 # URL search param read/write

components/tiptap-ui/heading-filter/
  heading-filter.tsx              # Floating panel UI (input, chips, mode toggle) + FilterToolbarButton
  use-heading-filter.ts           # React hook for filter state management (per-tab cleanup on unmount)
  heading-filter.scss             # Panel UI styles (sticky anchor, floating panel, chips, empty state)
  index.tsx                       # Barrel export
```

## Open Questions

None — all questions resolved.

## Resolved Questions

1. **Click on dimmed TOC heading**: scrolls to the heading and temporarily reveals it (does not clear the filter)
2. **Filter persistence**: URL params only — filters are ephemeral, cleared on page reload without params; URL params cleared on tab switch via `useEffect` cleanup
3. **Highlight color**: amber/yellow background — classic search highlight, visually distinct from user-applied `Highlight` marks
4. **Empty results**: show an empty state message (e.g. "No sections match your filter") with the document title (H1) still visible
5. **Collaboration**: filters are local only — each user has their own filter state, no sync via Yjs (same as fold)
6. **Title H1**: always visible regardless of filter (acts as document identity); title H1 (index 0) always skipped in fold dispatch and `findAllSections`
7. **Filter vs fold conflict**: filter delegates to fold plugin with `persist: false` — matching sections are temporarily unfolded, original fold state restored from `savedFoldIds` snapshot on filter clear
8. **Match count**: show count indicator (e.g. "3/12 sections"); preview query takes priority over committed slugs for live count updates while typing
9. **Animation**: no animation during live search (highlight + TOC highlight only). Section folding via HeadingFold happens on Enter (commit)
10. **Mobile**: desktop only for v1; mobile filter support deferred
11. **Debounce timing**: 250ms
12. **Match algorithm**: case-insensitive substring matching
13. **Escape behavior**: closes/dismisses the filter panel, keeps committed tags active
14. **Filter panel position**: floating panel in top-right corner below the toolbar (sticky anchor positioning)
15. **Tag removal**: immediate re-filter (no "Apply" step)
16. **Panel dismissal with active tags**: collapsed panel remains visible showing active filter chips (`.filter-panel--collapsed`)
17. **Reopen behavior**: restore previous state + focus input for immediate typing
18. **Descendant propagation**: when a heading matches, its entire subtree (all nested child headings) is also visible
19. **Per-tab scoping**: filter state is per-tab — URL params cleared on component unmount (tab switch)
20. **TOC preview highlighting**: TOC items highlight during preview typing via `previewMatchIds` prop (bold, darker text)

## Inspiration

- **docs.plus**: filter panel with search, active filter badges, algorithm toggle, tree-based DFS filtering with weight-based relevance
- **Reference code**: [`filterLogic.ts`](https://github.com/docs-plus/docs.plus/blob/main/packages/webapp/src/hooks/helpers/filterLogic.ts) — tree construction, DFS filtering, slug weight calculation, parent/child classification

## Implementation Status

Feature fully implemented across all four phases. See [implementation plan](../plans/4-feat-document-filter-plan.md) for phase details and acceptance criteria.
