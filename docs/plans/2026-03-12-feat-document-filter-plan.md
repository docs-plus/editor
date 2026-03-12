---
title: "feat: Document Filter (Heading & Content)"
type: feat
status: completed
date: 2026-03-12
brainstorm: docs/brainstorms/2026-03-12-document-filter-brainstorm.md
---

# feat: Document Filter (Heading & Content)

## Overview

Add a document filtering feature that lets users search by heading text and body content, then filter the document to show only matching sections. The feature is built as a dedicated ProseMirror plugin mirroring the existing `HeadingFold` architecture, with a compact floating panel in the top-right corner below the toolbar.

**Two-phase UX:** while typing (debounced), only highlight matched text in the editor and TOC sidebar; on Enter, commit the term as a filter tag and fold non-matching sections via HeadingFold plugin (direct matches, ancestors, and descendants remain visible; non-matching sections show fold crinkle). Multiple tags combine with OR (default) or AND logic. Filter is per-tab — state cleared on tab switch.

**Performance:** all custom plugins use the `canMapDecorations` fast-path — typing within a paragraph is O(1) (filter inactive) or O(log D) (filter active). The O(N) `findAllSections` walk only runs on structural edits. HeadingFold conditionally copies state only when changed. `onTitleChange` fires only when title text actually differs.

## Problem Statement

Long documents with many heading sections are hard to navigate when looking for specific content. The existing fold/unfold and TOC sidebar help with structure, but users need a way to quickly narrow the visible document to only the sections relevant to their search terms — and share that filtered view via URL.

## Technical Approach

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  app/page.tsx                                                    │
│  └── reads URL search params on load → passes to SimpleEditor  │
├─────────────────────────────────────────────────────────────────┤
│  SimpleEditorContent                                             │
│  ├── HeadingFilter extension (plugin)                           │
│  │   ├── Plugin state: slugs, mode, previewQuery, decos        │
│  │   ├── Decoration.inline() for highlights (only decoration)  │
│  │   ├── Fold dispatch: tr.setMeta(headingFoldPluginKey, ...)  │
│  │   │   ├── Matched + ancestors + descendants: unfolded       │
│  │   │   └── Non-matching: folded (persist: false)             │
│  │   ├── Fold restore: savedFoldIds snapshot on filter clear   │
│  │   └── onFilterChange callback → React                       │
│  ├── HeadingFold extension (plugin)                             │
│  │   └── Extended: set meta supports persist?: boolean flag    │
│  ├── FilterBar (floating panel, top-right, sticky anchor)       │
│  │   ├── Row 1: search icon, input, match count, close         │
│  │   ├── Row 2: filter chips, ANY/ALL toggle, clear            │
│  │   └── Collapsed mode: shows chips only when bar closed      │
│  └── TocSidebar                                                 │
│      ├── filteredIds → dimming non-matching (committed filter)  │
│      └── previewMatchIds → highlighting matches (while typing) │
└─────────────────────────────────────────────────────────────────┘
```

### Plugin State Shape

```typescript
// heading-filter-plugin.ts

type HeadingFilterMeta =
  | { type: "preview"; query: string }
  | { type: "commit"; slug: string }
  | { type: "remove"; slug: string }
  | { type: "clear" }
  | { type: "setMode"; mode: "or" | "and" }
  | { type: "apply"; slugs: string[]; mode: "or" | "and" };

interface HeadingFilterState {
  slugs: string[];            // committed filter tags
  mode: "or" | "and";         // combination logic
  previewQuery: string;       // live typing (not yet committed)
  matchedSectionIds: Set<string>;  // data-toc-id of matching sections
  totalSections: number;      // total section count (for "3/12")
  decos: DecorationSet;       // inline highlights + node hiding
}
```

### Plugin ↔ React Communication

```
React → Plugin: editor.commands.filterPreview("upd")
                 editor.commands.commitFilter("update")
                 editor.commands.removeFilter("update")
                 editor.commands.clearFilter()
                 editor.commands.setFilterMode("and")

Plugin → React: onFilterChange(state: {
                   matchedSectionIds: Set<string>,
                   totalSections: number,
                   slugs: string[],
                   mode: "or" | "and"
                 })
```

### Decoration Strategy

| Phase | Decoration Type | Target | CSS Class | When |
|-------|----------------|--------|-----------|------|
| Preview (typing) | `Decoration.inline()` | Matched text spans | `heading-filter-highlight` | Debounced while typing |
| Committed filter | `Decoration.inline()` | Matched text spans (all committed slugs) | `heading-filter-highlight` | After Enter |
| Committed filter | Fold dispatch to HeadingFold | Non-matching section IDs | HeadingFold's own crinkle classes | After Enter |

**Fold-delegation model (replaces three-tier decorations):**

- **Direct matches** (`directMatchIds`): Unfolded — heading + body fully visible
- **Ancestor sections** (`ancestorIds`): Unfolded — heading visible for hierarchy context
- **Descendant sections** (`descendantIds`): Unfolded — full subtree of matched headings visible
- **Non-matching sections**: Folded via HeadingFold plugin (`persist: false`) — heading visible with fold crinkle, body content hidden

The filter plugin produces ONLY `Decoration.inline()` highlights. All section show/hide is handled by HeadingFold through `tr.setMeta(headingFoldPluginKey, { type: "set", ids: sectionsToFold, persist: false })`.

### Section Matching Algorithm

```typescript
// helpers/match-section.ts

interface SectionMatch {
  section: SectionInfo;
  matches: TextMatch[];     // text match positions for inline decorations
}

function matchSections(
  doc: PMNode,
  query: string,
): SectionMatch[]

function filterSections(
  doc: PMNode,
  slugs: string[],
  mode: "or" | "and",
): FilterResult  // { matchedIds: Set<string>; totalSections: number }
```

**Algorithm:**

1. Walk `doc.content` top-level nodes to find all headings (`findAllSections()`)
2. For each heading, compute own-content range via `computeOwnRange()` — from heading pos to the next heading of **any** level (not the full hierarchical section). This prevents parent sections from false-matching on nested subsection content.
3. Walk text nodes in the own-content range via `doc.nodesBetween()` to find absolute match positions
4. Case-insensitive substring search; record absolute `from/to` positions for inline decorations
5. OR mode: section visible if it matches ANY slug
6. AND mode: section visible if it matches ALL slugs
7. Ancestor preservation: `getAncestorIds()` walks sections in order maintaining a heading stack by level; for each matched section, all stack entries (ancestors) are included.
8. Descendant propagation: `getDescendantIds()` walks sections after each match; includes all deeper headings until a heading of equal or lower level is reached.
9. `filterSections()` returns `{ matchedIds, totalSections }` where `matchedIds = directMatchIds ∪ ancestorIds ∪ descendantIds`.

### Fold Coordination

**Implemented approach — Fold plugin delegation (DRY, KISS):**

Filter plugin dispatches fold commands directly to HeadingFold via ProseMirror meta, reusing fold's existing crinkle/hiding decorations:

1. HeadingFold's `set` meta extended with `persist?: boolean` — filter uses `persist: false` to prevent filter-driven folds from saving to localStorage
2. HeadingFold's state extended with `skipPersist: boolean` — when true, `saveFoldedIds()` is skipped in `view().update()`
3. Filter plugin snapshots user's original fold state into `savedFoldIds` closure variable when a filter is first applied
4. On filter apply/change: `tr.setMeta(headingFoldPluginKey, { type: "set", ids: sectionsToFold, persist: false })`
5. On filter clear: `tr.setMeta(headingFoldPluginKey, { type: "set", ids: savedFoldIds, persist: true })` to restore original folds
6. `prevSlugs/prevMode/prevMatchedIds` updated BEFORE `view.dispatch(tr)` to prevent infinite loop from re-entrant view updates
7. Title H1 (index 0) always skipped when computing sections to fold (matches `findAllSections` behavior)

### URL Encoding

```typescript
// helpers/filter-url.ts

// Encode: terms are URL-encoded individually, separated by "|"
// Example: ?filter=update|fix&mode=or
// Pipe "|" chosen over comma to avoid conflicts with terms containing commas

function decodeFilterParams(searchString: string): { slugs: string[]; mode: "or" | "and" } | null
function updateFilterUrl(slugs: string[], mode: "or" | "and"): void  // history.replaceState
function readFilterUrl(): { slugs: string[]; mode: "or" | "and" } | null
```

### Cursor Relocation

When a committed filter hides the section containing the cursor:

- Move selection to the start of the nearest visible section (after current position)
- If no visible section after, move to the document title (pos 1)
- Implementation: in the filter plugin's `view().update()`, after decorations change, check if cursor is in a hidden range and dispatch a `setTextSelection` if needed

---

## Implementation Phases

### Phase 1: Foundation — Helpers + Plugin Core

**Goal:** ProseMirror plugin that can receive filter state via commands and produce decorations. No React UI yet — testable via editor commands in the console.

#### Files

| File | Purpose |
|------|---------|
| `components/tiptap-node/heading-node/helpers/match-section.ts` | Text matching within sections |
| `components/tiptap-node/heading-node/helpers/filter-url.ts` | URL search param encoding/decoding |
| `components/tiptap-node/heading-node/heading-filter-plugin.ts` | ProseMirror plugin (state, decorations) |
| `components/tiptap-node/heading-node/heading-filter-extension.ts` | Tiptap extension wrapper with commands |
| `components/tiptap-node/heading-node/heading-filter.scss` | CSS for `heading-filter-hidden` + `heading-filter-highlight` |

#### `match-section.ts`

```typescript
import type { Node as PMNode } from "@tiptap/pm/model";

interface TextMatch {
  from: number;
  to: number;
}

export interface SectionInfo {
  id: string;
  pos: number;
  level: number;
  childIndex: number;
}

export interface SectionMatch {
  section: SectionInfo;
  matches: TextMatch[];
}

export interface FilterResult {
  matchedIds: Set<string>;       // union of directMatchIds + ancestorIds + descendantIds
  totalSections: number;
}

export function findAllSections(doc: PMNode): SectionInfo[] {
  // Walk doc.content top-level nodes, collect heading positions
  // with data-toc-id, level, and child index. Skips first H1 (title).
}

function searchTextInRange(
  doc: PMNode,
  from: number,
  to: number,
  query: string,
): TextMatch[] {
  // Internal helper (not exported)
  // Case-insensitive substring search within [from, to)
  // Uses doc.nodesBetween() to walk text nodes and find absolute positions
}

function computeOwnRange(
  doc: PMNode,
  headingPos: number,
  headingChildIndex: number,
): { from: number; to: number } {
  // Computes the "own content" range for a heading: from heading pos
  // to the next heading of ANY level. Prevents parent sections from
  // matching on nested subsection text.
}

export function matchSections(
  doc: PMNode,
  query: string,
): SectionMatch[] {
  // Combines findAllSections + computeOwnRange + searchTextInRange
  // Uses computeOwnRange (not computeSection) for accurate scoping
}

// Internal (not exported) — walks sections maintaining a heading stack by level
function getAncestorIds(sections: SectionInfo[], matchedIds: Set<string>): Set<string>

// Internal (not exported) — for each matched heading, includes all deeper headings until equal/lower level
function getDescendantIds(sections: SectionInfo[], matchedIds: Set<string>): Set<string>

export function filterSections(
  doc: PMNode,
  slugs: string[],
  mode: "or" | "and",
): FilterResult {
  // For each slug, run matchSections
  // OR: union of matched section IDs
  // AND: intersection of matched section IDs
  // Returns { matchedIds: directMatchIds ∪ ancestorIds ∪ descendantIds, totalSections }
}
```

#### `heading-filter-plugin.ts`

```typescript
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { canMapDecorations } from "./helpers/can-map-decorations";
import {
  filterSections,
  matchSections,
  findAllSections,
  type SectionMatch,
} from "./helpers/match-section";
import { computeSection } from "./helpers/compute-section";

export const headingFilterPluginKey = new PluginKey<HeadingFilterState>("headingFilter");

// ... types (HeadingFilterMeta, HeadingFilterState, HeadingFilterPluginOptions)

function buildFilterDecorations(
  doc: PMNode,
  state: Omit<HeadingFilterState, "decos">,
): DecorationSet {
  const { slugs, previewQuery } = state;

  if (slugs.length === 0 && previewQuery.length === 0) return DecorationSet.empty;

  const decorations: Decoration[] = [];

  // Only inline highlights — no Decoration.node() or Decoration.widget()
  // All section folding is delegated to HeadingFold plugin via view().update()
  const allQueries = [...slugs];
  if (previewQuery.length > 0) allQueries.push(previewQuery);

  const seenRanges = new Set<string>();

  for (const query of allQueries) {
    const sectionMatches = matchSections(doc, query);
    for (const sm of sectionMatches) {
      for (const m of sm.matches) {
        const key = `${m.from}:${m.to}`;
        if (seenRanges.has(key)) continue;
        seenRanges.add(key);

        decorations.push(
          Decoration.inline(m.from, m.to, { class: "heading-filter-highlight" })
        );
      }
    }
  }

  return decorations.length > 0
    ? DecorationSet.create(doc, decorations)
    : DecorationSet.empty;
}

export function createHeadingFilterPlugin(
  options: HeadingFilterPluginOptions,
): Plugin<HeadingFilterState> {
  // Closure state for fold coordination
  let prevSlugs: string[] = [];
  let prevMode: "or" | "and" = "or";
  let prevMatchedIds: Set<string> = new Set();
  let savedFoldIds: Set<string> | null = null;

  // Plugin structure:
  // - state.init(): empty filter state, DecorationSet.empty
  // - state.apply(): handle meta via applyMeta()
  //   - canMapDecorations fast path (typing):
  //     - Inactive: return prev unchanged — O(1), zero allocations
  //     - Active: prev.decos.map() — O(log D), skips findAllSections
  //   - Structural change: full rebuild via computeNewState()
  //   - computeNewState(): preview query takes priority over committed slugs for matchedSectionIds
  // - props.decorations(): return decos from state (inline highlights only)
  // - view().update():
  //   1. Fire onFilterChange callback when slugs/mode/matchedIds change
  //   2. Snapshot savedFoldIds when filter first applied
  //   3. Dispatch fold commands to HeadingFold (persist: false for filter folds)
  //   4. Restore savedFoldIds when filter cleared (persist: true)
  //   5. Update prevSlugs/prevMode/prevMatchedIds BEFORE dispatch (prevents infinite loop)
  //   6. Cursor relocation: move to title if cursor is in a folded section
  //   7. Title H1 (index 0) always skipped via findAllSections()
  // - view().destroy(): cleanup closure state
}
```

#### `heading-filter-extension.ts`

```typescript
import { Extension } from "@tiptap/core";
import {
  createHeadingFilterPlugin,
  headingFilterPluginKey,
} from "./heading-filter-plugin";

export interface HeadingFilterOptions {
  onFilterChange?: (state: {
    matchedSectionIds: Set<string>;
    totalSections: number;
    slugs: string[];
    mode: "or" | "and";
  }) => void;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    headingFilter: {
      filterPreview: (query: string) => ReturnType;
      commitFilter: (slug: string) => ReturnType;
      removeFilter: (slug: string) => ReturnType;
      clearFilter: () => ReturnType;
      setFilterMode: (mode: "or" | "and") => ReturnType;
      applyFilter: (slugs: string[], mode: "or" | "and") => ReturnType;
    };
  }
}

export const HeadingFilter = Extension.create<HeadingFilterOptions>({
  name: "headingFilter",

  addOptions() {
    return { onFilterChange: undefined };
  },

  addCommands() {
    return {
      filterPreview:
        (query) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(headingFilterPluginKey, { type: "preview", query });
          }
          return true;
        },
      commitFilter:
        (slug) =>
        ({ tr, dispatch }) => {
          if (!slug.trim()) return false;
          if (dispatch) {
            tr.setMeta(headingFilterPluginKey, { type: "commit", slug: slug.trim() });
          }
          return true;
        },
      removeFilter:
        (slug) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(headingFilterPluginKey, { type: "remove", slug });
          }
          return true;
        },
      clearFilter:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(headingFilterPluginKey, { type: "clear" });
          }
          return true;
        },
      setFilterMode:
        (mode) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(headingFilterPluginKey, { type: "setMode", mode });
          }
          return true;
        },
      applyFilter:
        (slugs, mode) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(headingFilterPluginKey, { type: "apply", slugs, mode });
          }
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      createHeadingFilterPlugin({
        onFilterChange: this.options.onFilterChange,
      }),
    ];
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Shift-f": () => {
        // This shortcut is handled by the React UI (toggles filter bar visibility)
        // The extension emits an event that the React component listens to
        return false; // Let it propagate to React
      },
    };
  },
});
```

#### `heading-filter.scss`

```scss
// Only inline highlight — all section folding delegated to HeadingFold plugin
// No .heading-filter-hidden, .heading-filter-folded, or .heading-filter-crinkle
.heading-filter-highlight {
  background-color: rgba(255, 196, 0, 0.35);
  border-radius: 2px;
  .dark & { background-color: rgba(255, 196, 0, 0.25); }
}
```

#### `filter-url.ts`

```typescript
const FILTER_PARAM = "filter";
const MODE_PARAM = "mode";
const DELIMITER = "|";

export function decodeFilterParams(
  searchString: string,
): { slugs: string[]; mode: "or" | "and" } | null {
  const params = new URLSearchParams(searchString);
  const raw = params.get(FILTER_PARAM);
  if (!raw) return null;
  const slugs = raw.split(DELIMITER).map(decodeURIComponent).filter(Boolean);
  const mode = params.get(MODE_PARAM) === "and" ? "and" : "or";
  return slugs.length > 0 ? { slugs, mode } : null;
}

export function updateFilterUrl(slugs: string[], mode: "or" | "and"): void {
  const url = new URL(window.location.href);
  if (slugs.length === 0) {
    url.searchParams.delete(FILTER_PARAM);
    url.searchParams.delete(MODE_PARAM);
  } else {
    url.searchParams.set(FILTER_PARAM, slugs.map(encodeURIComponent).join(DELIMITER));
    url.searchParams.set(MODE_PARAM, mode);
  }
  history.replaceState(null, "", url.toString());
}

export function readFilterUrl(): { slugs: string[]; mode: "or" | "and" } | null {
  return decodeFilterParams(window.location.search);
}
```

#### Acceptance Criteria — Phase 1

- [x] `matchSections()` returns correct text matches with absolute positions for a query (uses `computeOwnRange`)
- [x] `filterSections()` correctly applies OR/AND logic across multiple slugs; returns `matchedIds` (union of directMatchIds + ancestorIds + descendantIds) and `totalSections`
- [x] `getAncestorIds()` preserves parent heading visibility for child matches
- [x] `getDescendantIds()` preserves child heading visibility for parent matches (full subtree)
- [x] Plugin produces `Decoration.inline()` for preview query and committed slugs (highlights only)
- [x] Plugin dispatches fold commands to HeadingFold for committed slugs (no filter-specific Decoration.node/widget)
- [x] Title H1 (pos 0) is never hidden
- [x] `canMapDecorations` fast path: O(1) return prev when inactive, O(log D) decos.map when active — `findAllSections` skipped on typing
- [x] Commands dispatch correct meta; `apply()` handles all meta types
- [x] `onFilterChange` callback fires with correct `matchedSectionIds`, `totalSections`, `slugs`, `mode`
- [x] URL encoding/decoding round-trips correctly, handles special characters
- [x] `filter-url.ts`: `decodeFilterParams` and `readFilterUrl` correctly parse URL params

---

### Phase 2: React UI — Filter Bar + Hook

**Goal:** Filter bar component below the toolbar with search input, tag badges, match count, mode toggle, and close button.

#### Files

| File | Purpose |
|------|---------|
| `components/tiptap-ui/heading-filter/use-heading-filter.ts` | React hook for filter bar state |
| `components/tiptap-ui/heading-filter/heading-filter.tsx` | Filter bar + badge bar components |
| `components/tiptap-ui/heading-filter/heading-filter.scss` | UI styles |
| `components/tiptap-ui/heading-filter/index.tsx` | Barrel export |
| `lib/icons.ts` | Add `FilterIcon` export |

#### `use-heading-filter.ts`

```typescript
import { useCallback, useEffect, useRef, useState } from "react";
import { useTiptapEditor } from "@/hooks/use-tiptap-editor";
import type { Editor } from "@tiptap/react";

interface FilterState {
  matchedSectionIds: Set<string>;
  totalSections: number;
  slugs: string[];
  mode: "or" | "and";
}

interface UseHeadingFilterReturn {
  // Bar visibility
  isBarOpen: boolean;
  openBar: () => void;
  closeBar: () => void;
  toggleBar: () => void;

  // Input state
  query: string;
  setQuery: (q: string) => void;

  // Filter state (from plugin)
  filterState: FilterState;
  hasActiveFilters: boolean;

  // Actions
  commitFilter: () => void;
  removeFilter: (slug: string) => void;
  clearAllFilters: () => void;
  setMode: (mode: "or" | "and") => void;

  // Refs
  inputRef: React.RefObject<HTMLInputElement | null>;
}

export function useHeadingFilter(
  options: { editor?: Editor | null; filterState: HeadingFilterCallbackState },
): UseHeadingFilterReturn {
  // Uses useTiptapEditor for editor context
  // Manages bar open/close state
  // Debounces query → editor.commands.filterPreview(query)
  // Enter → editor.commands.commitFilter(query)
  // Receives filterState from parent (via HeadingFilter extension onFilterChange callback)
  // Updates URL via filter-url.ts helpers
  // Cleanup useEffect: clears debounce timer + clears URL params on unmount (per-tab scoping)
}
```

#### `heading-filter.tsx`

Single `FilterBar` component handles both open and collapsed (tags-only) states. No separate `FilterBadgeBar` — the collapsed state is a CSS variant (`filter-panel--collapsed`) of the same panel.

```typescript
// FilterBar: floating panel with search input + chips + mode toggle + close
// FilterToolbarButton: toolbar button with active indicator

type FilterBarProps = UseHeadingFilterReturn;

export function FilterBar({
  isBarOpen, query, setQuery, filterState, hasActiveFilters,
  commitFilter, removeFilter, clearAllFilters, setMode,
  closeBar, inputRef,
}: FilterBarProps) {
  if (!isBarOpen && !hasActiveFilters) return null;

  return (
    <div className="filter-panel-anchor">  {/* sticky zero-height anchor */}
      <div
        className={cn("filter-panel", !isBarOpen && "filter-panel--collapsed")}
        role="search"
        aria-label="Document filter"
      >
        {isBarOpen && (
          <div className="filter-panel-row">
            <SearchIcon className="filter-panel-icon" />
            <input className="filter-panel-input" placeholder="Find in document..." ... />
            <span role="status" className="filter-panel-count" aria-live="polite">
              {filterState.matchedSectionIds.size}/{filterState.totalSections}
            </span>
            <button className="filter-panel-close" onClick={closeBar}>
              <CloseIcon />
            </button>
          </div>
        )}

        {hasActiveFilters && (
          <div className="filter-panel-tags">
            {filterState.slugs.map(slug => (
              <span key={slug} className="filter-chip">
                {slug}
                <button className="filter-chip-remove" onClick={() => removeFilter(slug)}>
                  <CloseIcon />
                </button>
              </span>
            ))}
            <button
              className={cn("filter-panel-mode", filterState.mode === "and" && "filter-panel-mode--active")}
              onClick={() => setMode(filterState.mode === "or" ? "and" : "or")}
              aria-pressed={filterState.mode === "and"}
            >
              {filterState.mode === "or" ? "ANY" : "ALL"}
            </button>
            <button className="filter-panel-clear" onClick={clearAllFilters}>
              Clear
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function FilterToolbarButton({ onClick, isActive }: { ... }) {
  return (
    <ToolbarButton
      onClick={onClick}
      tooltip="Filter document"
      shortcutKeys="mod+shift+f"
      isActive={isActive}
      aria-label="Toggle document filter"
    >
      <FilterIcon />
    </ToolbarButton>
  );
}
```

#### Acceptance Criteria — Phase 2

- [x] Filter panel appears as floating panel in top-right below toolbar when opened (Cmd+Shift+F or button click)
- [x] Search input is auto-focused on open
- [x] Typing debounces (250ms) and triggers `filterPreview` command
- [x] Enter commits current query as a filter chip; input clears
- [x] Enter on empty input is a no-op
- [x] Filter chips show committed slugs with X button to remove
- [x] Removing a chip immediately re-filters
- [x] Match count shows `{matched}/{total} sections`
- [x] ANY/ALL toggle switches mode and re-filters
- [x] Clear button removes all tags and restores normal view
- [x] Escape closes the panel; committed tags remain active
- [x] When panel is closed with active tags, collapsed panel shown with chips
- [x] Reopening panel restores previous state and focuses input
- [x] Toolbar button shows active indicator when filters are applied
- [x] Duplicate terms are deduplicated (adding "fix" when "fix" already exists is a no-op)
- [x] Terms are trimmed (leading/trailing whitespace removed)

---

### Phase 3: Integration

**Goal:** Wire everything together in the editor, TOC, and app page.

#### Files Modified

| File | Changes |
|------|---------|
| `components/tiptap-templates/simple/simple-editor.tsx` | Add `HeadingFilter` extension, `FilterBar`, toolbar button, state wiring |
| `components/toc-sidebar/toc-sidebar.tsx` | Add `matchedSectionIds` prop for dimming |
| `components/toc-sidebar/toc-sidebar.scss` | Add dimmed heading styles |
| `app/page.tsx` | Read URL search params on load, pass to `SimpleEditor` |
| `lib/icons.ts` | Add `FilterIcon` (LuFilter), `SearchIcon` (LuSearch) |

#### `simple-editor.tsx` Changes

```typescript
// New state
const [filterState, setFilterState] = useState<FilterState>({
  matchedSectionIds: new Set(),
  totalSections: 0,
  slugs: [],
  mode: "or" as const,
});

// Extension config (in useEditor extensions array)
HeadingFilter.configure({
  onFilterChange: setFilterState,
}),

// In JSX, as direct sibling of Toolbar in main scroll container:
<FilterBar {...headingFilter} />

// In MainToolbarContent:
{!isMobile && (
  <ToolbarGroup>
    <FilterToolbarButton
      onClick={toggleFilterBar}
      isActive={filterState.slugs.length > 0}
    />
  </ToolbarGroup>
)}

// TocSidebar receives filter props:
<TocSidebar
  items={tocItems}
  editor={editor}
  foldedIds={foldedIds}
  onToggleFold={(id) => editor?.commands.toggleFold(id)}
  filteredIds={
    headingFilter.hasActiveFilters
      ? filterState.matchedSectionIds
      : undefined
  }
  previewMatchIds={
    headingFilter.query.trim().length > 0
      ? filterState.matchedSectionIds
      : undefined
  }
/>
```

#### `toc-sidebar.tsx` Changes

```typescript
// Props support both committed filter dimming and preview highlighting
interface TocSidebarProps {
  items: TableOfContentData;
  editor: Editor | null;
  foldedIds: Set<string>;
  onToggleFold: (id: string) => void;
  filteredIds?: Set<string>;       // committed filter — dims non-matching items
  previewMatchIds?: Set<string>;   // preview typing — highlights matching items
}

// In render, apply dimming and preview-match classes:
<button
  className={cn(
    "toc-sidebar-item",
    isFiltering && !filteredIds.has(item.id) && "toc-sidebar-item--dimmed",
    isPreviewing && previewMatchIds.has(item.id) && "toc-sidebar-item--preview-match",
  )}
>
```

#### `app/page.tsx` Changes

```typescript
import { readFilterUrl } from "@/components/tiptap-node/heading-node/helpers/filter-url";

// Read initial filter from URL on mount
const [initialFilter, setInitialFilter] = useState<{
  slugs: string[];
  mode: "or" | "and";
} | null>(null);

useEffect(() => {
  setInitialFilter(readFilterUrl());
}, []);

// Pass to SimpleEditor
<SimpleEditor
  key={activeTabId}
  documentId={activeTabId}
  initialFilter={initialFilter}
  // ... other props
/>
```

#### Acceptance Criteria — Phase 3

- [x] `HeadingFilter` extension is loaded in the editor
- [x] Filter panel renders as floating panel in top-right, sticky below toolbar
- [x] Toolbar button toggles filter panel visibility
- [x] Filter button hidden on mobile (`isMobile` guard)
- [x] TOC sidebar dims non-matching headings when committed filter is active (`filteredIds` → `toc-sidebar-item--dimmed`)
- [x] TOC sidebar highlights matching headings during preview typing (`previewMatchIds` → `toc-sidebar-item--preview-match`)
- [x] TOC dimming is visually clear (opacity, color change) but headings remain clickable
- [x] Clicking a dimmed TOC heading scrolls to the heading
- [x] URL search params are read on page load and applied as initial filter
- [x] URL is updated via `history.replaceState` when filter state changes
- [x] Clearing filter clears URL params
- [x] `FilterIcon` and `SearchIcon` added to `lib/icons.ts`

---

### Phase 4: Polish & Edge Cases

**Goal:** Handle edge cases, fold coordination, cursor relocation, empty state, keyboard accessibility.

#### Tasks

| Task | File(s) | Description |
|------|---------|-------------|
| Fold coordination | `heading-filter-plugin.ts`, `heading-fold-plugin.ts` | Filter dispatches fold commands to HeadingFold via meta with `persist: false`; fold plugin extended with `persist` flag and `skipPersist` state |
| Cursor relocation | `heading-filter-plugin.ts` | When cursor is in a hidden section after filter commit, move to nearest visible section |
| Empty state | `heading-filter.tsx`, `heading-filter.scss` | Show "No sections match your filter" message when `matchedSectionIds.size === 0` and slugs are committed |
| Keyboard shortcut | `heading-filter-extension.ts`, `use-heading-filter.ts` | Register `Cmd+Shift+F` to toggle filter bar |
| Focus management | `use-heading-filter.ts` | On Escape, return focus to editor; on reopen, focus input |
| Temporary reveal | `toc-sidebar.tsx` | Clicking a dimmed TOC heading scrolls to the heading position |
| Empty document | `heading-filter-plugin.ts` | When doc has only title H1, show "0/0 sections" and empty state |
| Plugin order | `simple-editor.tsx` | Ensure `HeadingFilter` is listed AFTER `HeadingFold` in extensions array so filter can dispatch to fold plugin |
| Per-tab scoping | `use-heading-filter.ts` | Filter URL params cleared on component unmount (tab switch) via `useEffect` cleanup |
| Descendant propagation | `match-section.ts` | `getDescendantIds()` ensures matched heading's full subtree stays visible |
| Preview TOC highlight | `toc-sidebar.tsx`, `toc-sidebar.scss` | `previewMatchIds` prop highlights matching TOC items during typing |
| ARIA | `heading-filter.tsx` | `role="search"`, `aria-label` on filter bar, `aria-live="polite"` on match count |

#### Acceptance Criteria — Phase 4

- [x] Filter delegates folding to HeadingFold via `persist: false` meta dispatch (no duplicated crinkle/hiding code)
- [x] Original fold state restored from `savedFoldIds` snapshot on filter clear
- [x] Cursor moves to document title when current position is in a non-matching section
- [x] Empty state message shown when no sections match
- [x] `Cmd/Ctrl+Shift+F` toggles filter panel
- [x] Focus returns to editor on Escape
- [x] Focus goes to input on reopen
- [x] Clicking dimmed TOC heading scrolls to the heading
- [x] Plugin order: HeadingFilter after HeadingFold
- [x] ARIA attributes on filter panel (`role="search"`), match count (`role="status"`, `aria-live="polite"`), and chips
- [x] Document with only title H1 shows appropriate match count
- [x] Filter is per-tab — URL params cleared on component unmount (tab switch)
- [x] Descendant propagation: matched heading's full subtree visible
- [x] Preview typing updates match count live (preview takes priority over committed slugs)
- [x] TOC sidebar highlights matching items during preview typing
- [x] Title H1 (index 0) consistently skipped in fold dispatch and section computation
- [x] No infinite loop in view().update() — prevSlugs/prevMode updated before dispatch
- [x] Performance: typing fast-path O(1) inactive / O(log D) active; zero findAllSections calls on content-only edits
- [x] Performance: HeadingFold view().update() conditionally copies Set/Map only when state changed
- [x] Performance: onTitleChange skipped via ref comparison when title text unchanged

---

## Alternative Approaches Considered

See [brainstorm document](../brainstorms/2026-03-12-document-filter-brainstorm.md) for full evaluation of:

1. Dedicated Filter Plugin (chosen)
2. Unified Fold+Filter Plugin (rejected: couples two features)
3. React State + CSS (rejected: fights ProseMirror model)

## Dependencies & Prerequisites

- ~~Current `refactor/naming-structure-cleanup` branch should be merged first (removes `tiptap-ui-primitive/` layer)~~ (done)
- `HeadingFold` plugin must be stable and working
- `computeSection` and `canMapDecorations` shared helpers must be available
- `ToolbarButton` from `components/ui/` for the toolbar filter button
- UI uses custom elements (`.filter-chip`, `.filter-panel-*`) instead of shadcn `Badge`/`Input` for a more compact, native-like appearance

## Risk Analysis & Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|-----------|------------|
| Performance with large docs (1000+ headings) | High | Low | Debounce, `canMapDecorations` fast path (O(1) inactive / O(log D) active on typing), conditional copies in fold view().update(), onTitleChange ref-guard; all O(N) work deferred to structural edits only |
| Fold ↔ Filter dispatch conflicts | High | Low | Filter dispatches to fold with `persist: false`, snapshots/restores original state; `prevSlugs` updated before dispatch to prevent infinite loop |
| URL params collide with future routing | Medium | Low | Use `filter` and `mode` param names that are unlikely to conflict |
| Inline decorations interfere with user highlights | Medium | Low | Distinct CSS class and amber color, no Mark modification |
| Yjs sync during filtering | Low | Low | Decorations are view-local, not synced; doc structure changes trigger rebuild |

## Quality Gates

### Functional Requirements

- [x] Phase 1: Plugin produces inline highlight decorations and dispatches fold commands for committed filters
- [x] Phase 2: Filter panel UI works end-to-end (type, enter, remove, clear, mode toggle)
- [x] Phase 3: TOC dimming + preview highlighting, toolbar button, URL params (per-tab)
- [x] Phase 4: Fold delegation, cursor relocation, empty state, keyboard, descendant propagation

### Non-Functional Requirements

- [x] No visible lag on typing in documents with < 200 headings (250ms debounce)
- [x] Typing fast-path: O(1) when filter inactive, O(log D) when active — `findAllSections` skipped entirely on content-only edits
- [x] HeadingFold `view().update()` copies `prevFoldedIds`/`prevAnimating` only when state changes (not on every transaction)
- [x] `onTitleChange` skipped when title text unchanged (ref comparison avoids parent re-renders on body edits)
- [x] Floating filter panel does not cause layout shift on the editor content (zero-height anchor)
- [x] Screen reader announces match count changes and empty state
- [x] No memory leaks (plugin cleanup, effect cleanup)

## File Inventory

### New Files (10)

```
components/tiptap-node/heading-node/
  heading-filter-extension.ts
  heading-filter-plugin.ts
  heading-filter.scss
  helpers/
    match-section.ts
    filter-url.ts

components/tiptap-ui/heading-filter/
  heading-filter.tsx
  use-heading-filter.ts
  heading-filter.scss
  index.tsx
```

### Modified Files (6)

```
components/tiptap-templates/simple/simple-editor.tsx
components/tiptap-node/heading-node/heading-fold-plugin.ts  # persist flag + skipPersist state
components/toc-sidebar/toc-sidebar.tsx                       # filteredIds + previewMatchIds props
components/toc-sidebar/toc-sidebar.scss                      # dimmed + preview-match styles
app/page.tsx
lib/icons.ts
```

## References

### Internal

- Fold plugin: `components/tiptap-node/heading-node/heading-fold-plugin.ts`
- Fold extension: `components/tiptap-node/heading-node/heading-fold-extension.ts`
- Section computation: `components/tiptap-node/heading-node/helpers/compute-section.ts`
- Decoration fast path: `components/tiptap-node/heading-node/helpers/can-map-decorations.ts`
- TOC sidebar: `components/toc-sidebar/toc-sidebar.tsx`
- Brainstorm: `docs/brainstorms/2026-03-12-document-filter-brainstorm.md`

### External

- [docs.plus filterLogic.ts](https://github.com/docs-plus/docs.plus/blob/main/packages/webapp/src/hooks/helpers/filterLogic.ts) — tree-based DFS filtering with weight-based relevance
- ProseMirror Decoration docs: `Decoration.inline()`, `Decoration.node()`, `DecorationSet`
