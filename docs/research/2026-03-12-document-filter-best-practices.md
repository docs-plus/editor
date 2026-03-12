# Document Filter: Best Practices Research

**Date:** 2026-03-12  
**Topic:** ProseMirror/Tiptap document section filter implementation  
**Related:** [2026-03-12-document-filter-brainstorm](../brainstorms/2026-03-12-document-filter-brainstorm.md)

---

## 1. Building `Decoration.inline()` for Text Search Matches

### Core API

```ts
Decoration.inline(from: number, to: number, spec: { class?: string; style?: string }, options?: object)
```

- **Positions**: `from` and `to` are absolute document positions (not relative to a node).
- **Spec**: Use `class` for CSS-based styling (recommended) or `style` for inline styles.
- **Visual-only**: Decorations do not modify the document; they overlay styling.

### Finding Match Positions

**Option A: Manual traversal with `doc.descendants()`**

```ts
const matches: { from: number; to: number }[] = [];
const searchLower = searchTerm.toLowerCase();

doc.descendants((node, pos) => {
  if (!node.isText) return true;
  const text = node.text ?? "";
  let idx = 0;
  while (true) {
    const found = text.toLowerCase().indexOf(searchLower, idx);
    if (found === -1) break;
    matches.push({ from: pos + found, to: pos + found + searchTerm.length });
    idx = found + 1;
  }
  return true;
});
```

**Option B: `doc.textBetween()` + manual position tracking**

- `doc.textBetween(from, to)` returns plain text between positions.
- For section-scoped search (your use case), iterate sections via `computeSection()`, then use `doc.textBetween(section.from, section.to)` to get section text. To map match offsets back to positions, you must track the mapping from offset → position (e.g., by walking `doc.nodesBetween` and accumulating offsets).

**Option C: `prosemirror-search` package**

- Official ProseMirror module: `SearchQuery` with `findNext()` / `findPrev()` returning `SearchResult` with `from`/`to`.
- Built-in plugin highlights matches with `.ProseMirror-search-match` and `.ProseMirror-active-search-match`.
- **Caveat**: Designed for single-query find-next/prev, not section-scoped multi-term OR/AND filtering. You may need to adapt or implement custom logic for your section-based filter.

### Building the DecorationSet

```ts
function buildHighlightDecorations(doc: PMNode, matches: { from: number; to: number }[]): DecorationSet {
  const decorations = matches.map(({ from, to }) =>
    Decoration.inline(from, to, { class: "heading-filter-highlight" })
  );
  return decorations.length > 0
    ? DecorationSet.create(doc, decorations)
    : DecorationSet.empty;
}
```

### Critical: Map Decorations on Document Change

Always remap decorations when the document changes:

```ts
apply(tr, prev, oldState, newState) {
  if (tr.docChanged) {
    prev = prev.map(tr.mapping, newState.doc);
  }
  // Then apply filter-specific updates (new search term, etc.)
}
```

- **`DecorationSet.map(mapping, doc)`** shifts decoration positions according to the transaction mapping.
- For content-only edits (typing within a block), `canMapDecorations(tr, oldState.doc)` can gate a fast path; structural changes require a full rebuild.

### Edge Cases (from ProseMirror issues)

- Avoid decorations that end exactly at the boundary of non-leaf inline nodes (e.g., links) — can cause rendering glitches.
- Multiple overlapping inline decorations: plugin order controls application order.
- Store decoration state in plugin state, not closed-over variables, to avoid stale references.

---

## 2. Performance Patterns for Text Search in Large Documents

### Debouncing (Primary Mitigation)

- **Recommendation**: Debounce search input by ~250ms (aligns with your brainstorm).
- **Rationale**: Users typically type multiple characters; debouncing avoids re-running search on every keystroke. Single-character searches (e.g., "a") can produce hundreds of matches and cause noticeable lag.
- **Source**: [ProseMirror discuss — responsiveness with large decoration sets](https://discuss.prosemirror.net/t/responsivness-improvements-for-rendering-of-a-large-set-of-decorations/8834)

### Implementation Pattern

```ts
// React: debounced callback to plugin
const debouncedApplyFilter = useMemo(
  () => debounce((term: string) => {
    editor?.commands.applyFilterHighlight?.(term);
  }, 250),
  [editor]
);

// On input change (phase 1: typing)
onChange={(e) => {
  setInputValue(e.target.value);
  debouncedApplyFilter(e.target.value);
}}
```

### When Debouncing Isn't Enough

For very large documents (30k+ chars) with high match density:

- **Viewport-only decorations**: Only render highlights for matches visible in the viewport. Requires mapping viewport bounds to doc positions and filtering decorations.
- **Batching**: Defer decoration updates across multiple `requestAnimationFrame` or transactions.
- **Limit matches**: Cap the number of inline decorations (e.g., first N matches) to avoid DOM overload.

### Incremental Search

- **Phase 1 (typing)**: Highlight only — no section folding. Keeps work minimal.
- **Phase 2 (Enter)**: Commit filter tags, then build `Decoration.node()` for hidden sections. Section hiding is cheaper than hundreds of inline decorations.
- Reuse `canMapDecorations` for typing-path updates when only content changes.

---

## 3. Next.js App Router URL Search Params

### Reading Params

**Client Components** — `useSearchParams`:

```ts
"use client";
import { useSearchParams } from "next/navigation";

const searchParams = useSearchParams();
const filter = searchParams.get("filter");   // "update,fix"
const mode = searchParams.get("mode");       // "or" | "and"
```

**Server Components / Pages** — `searchParams` prop:

```ts
export default function DocPage({ searchParams }: { searchParams: { filter?: string; mode?: string } }) {
  const filterTerms = searchParams.filter?.split(",").filter(Boolean) ?? [];
  // ...
}
```

### Updating Params (No Full Reload)

**Preferred: `router.replace()`**

```ts
"use client";
import { useRouter, usePathname } from "next/navigation";

const router = useRouter();
const pathname = usePathname();

function updateFilterInUrl(slugs: string[], mode: "or" | "and") {
  const params = new URLSearchParams();
  if (slugs.length > 0) params.set("filter", slugs.join(","));
  params.set("mode", mode);
  router.replace(`${pathname}?${params.toString()}`);
}
```

- Keeps SPA behavior, avoids full reload.
- `window.history.replaceState()` can trigger unnecessary re-renders in components using `useParams` (historically; fixed in recent Next.js).

**When to use `history.replaceState`**: If you need to update the URL without triggering Next.js navigation (e.g., to avoid re-running data fetches). For filter state, `router.replace` is usually sufficient.

### Application Flow

1. **On load**: Read `searchParams` in page/layout, pass initial filter state to editor (e.g., via extension options or `useEffect`).
2. **On filter change**: Callback from plugin (`onFilterChange`) → update URL via `router.replace`.
3. **Document scope**: Include `doc` in params if needed: `?doc=abc&filter=update,fix&mode=or`.

---

## 4. React State ↔ ProseMirror Plugin State Bridging

### Pattern: Transaction Metadata (`setMeta` / `getMeta`)

**Direction: React → ProseMirror**

1. React holds input state (e.g., `filterInput`, `committedTags`).
2. When state changes, dispatch a transaction with metadata:
   ```ts
   view.dispatch(state.tr.setMeta(pluginKey, { type: "setFilter", slugs: [...], mode: "or" }));
   ```
3. Plugin `apply()` reads `tr.getMeta(pluginKey)` and updates its state + decorations.

**Direction: ProseMirror → React**

1. Plugin calls a callback (e.g., `onFilterChange(matchedIds, slugs)`) when filter state changes.
2. Callback updates React state → re-renders TOC, URL sync, etc.

### Example: Filter Extension Options

```ts
// Extension
HeadingFilter.configure({
  documentId,
  onFilterChange: (matchedIds, slugs) => {
    setMatchedIds(matchedIds);
    updateFilterInUrl(slugs, mode);
  },
});
```

### Avoiding Stale Closures

- Pass callbacks via extension options (recreated when options change).
- Or use `editor.storage` / extension storage for values that need to be read inside the plugin without re-running `addProseMirrorPlugins`.

### Source

- [Using React or Redux state in a ProseMirror Plugin](https://anarchang.medium.com/using-react-or-redux-state-in-a-prosemirror-plugin-7af537c2233e)
- [ProseMirror DecorationSet in React](https://medium.com/@faisalmujtaba/prosemirror-decorationset-in-react-everything-i-wish-someone-had-told-me-6262eabae7ca)

---

## 5. Tiptap 3: React ↔ Plugin Communication

### Extension Options + Callbacks

Your existing pattern (HeadingFold):

```ts
HeadingFold.configure({
  documentId,
  onFoldChange: setFoldedIds,
})
```

- Options are passed at extension config time.
- Plugin calls `options.onFoldChange?.(foldedIds)` when state changes.
- **Filter**: Same pattern — `onFilterChange(matchedIds, slugs)` for TOC dimming and URL sync.

### Commands for React → Plugin

```ts
addCommands() {
  return {
    applyFilterHighlight: (term: string) => ({ tr, dispatch }) => {
      if (dispatch) {
        tr.setMeta(headingFilterPluginKey, { type: "highlight", term });
        dispatch(tr);
      }
      return true;
    },
    commitFilter: (slug: string) => ({ tr, dispatch }) => {
      if (dispatch) {
        tr.setMeta(headingFilterPluginKey, { type: "commit", slug });
        dispatch(tr);
      }
      return true;
    },
    clearFilter: () => ({ tr, dispatch }) => { /* ... */ },
  };
}
```

React calls `editor.commands.applyFilterHighlight(term)` (debounced) and `editor.commands.commitFilter(slug)` on Enter.

### Extension Storage

- `addStorage()` returns mutable data: `editor.storage.headingFilter`.
- Use for values that need to be read by other extensions or React without going through transactions.
- **Caveat**: Storage can be reset before `onCreate()` in some cases; prefer options + callbacks for critical state.

### useEditor and useTiptapState

- `useEditor()` creates the editor; pass extensions with options.
- `useTiptapState()` subscribes to specific state slices to avoid unnecessary re-renders.
- Filter UI can use `useTiptapState(editor, (s) => s.storage.headingFilter?.activeSlugs)` if you store slugs in extension storage.

### Meta Types

Define a union for type safety:

```ts
type HeadingFilterMeta =
  | { type: "highlight"; term: string }
  | { type: "commit"; slug: string }
  | { type: "remove"; slug: string }
  | { type: "clear" }
  | { type: "set"; slugs: string[]; mode: "or" | "and" };
```

---

## 6. Codebase-Specific Integration

### Existing Helpers

| Helper | Location | Use |
|--------|----------|-----|
| `computeSection(doc, headingPos, headingLevel, startChildIndex?)` | `helpers/compute-section.ts` | Section range `{ from, to }` for heading + content |
| `canMapDecorations(tr, oldDoc)` | `helpers/can-map-decorations.ts` | Safe to use `DecorationSet.map()` for typing-only edits |

### Section-Scoped Search

For `matchSection(doc, sectionFrom, sectionTo, term)`:

1. Use `doc.textBetween(sectionFrom, sectionTo)` to get section text.
2. Find substring matches (case-insensitive); map offsets back to absolute positions by walking `doc.nodesBetween(sectionFrom, sectionTo, ...)` and tracking offset accumulation.
3. Or: use `doc.descendants` and restrict to `pos >= sectionFrom && pos + node.nodeSize <= sectionTo` for text nodes.

### Decoration Coordination

- **HeadingFold** + **HeadingFilter**: Both use `Decoration.node()` on headings/content.
- ProseMirror merges node decoration attributes (`class` space-concatenated, `style` semicolon-concatenated).
- Filter plugin should apply `heading-filter-hidden` to non-matching section content nodes (same pattern as `heading-fold-hidden`).
- When filter is active, matching sections that are folded should be temporarily unfolded (filter wins); fold plugin can read filter state from a shared source or via plugin key.

### Plugin Order

- Filter plugin should run after fold plugin if both modify the same nodes, so filter's `heading-filter-hidden` takes precedence when applicable.
- Or: filter plugin suppresses fold decorations for matching sections by not applying fold when filter says "show this section."

---

## 7. Summary Checklist

| Area | Recommendation |
|------|-----------------|
| **Inline decorations** | `Decoration.inline(from, to, { class: "heading-filter-highlight" })`; find positions via `doc.descendants` or section-scoped `doc.textBetween` + offset mapping |
| **Performance** | Debounce 250ms for phase 1; phase 2 (section hide) is cheaper; use `canMapDecorations` for typing-path updates |
| **URL params** | `useSearchParams` to read; `router.replace(pathname + "?" + params)` to update |
| **React → Plugin** | `tr.setMeta(pluginKey, { ... })` via commands; plugin `apply()` handles it |
| **Plugin → React** | `onFilterChange(matchedIds, slugs)` callback in extension options |
| **Section search** | Reuse `computeSection`; implement `matchSection` with `doc.textBetween` + position mapping |
| **Decoration merging** | `Decoration.node()` for hide; `Decoration.inline()` for highlight; both merge via ProseMirror |

---

## References

- [ProseMirror/prosemirror-search](https://github.com/ProseMirror/prosemirror-search) — official search module
- [ProseMirror DecorationSet in React (Medium)](https://medium.com/@faisalmujtaba/prosemirror-decorationset-in-react-everything-i-wish-someone-had-told-me-6262eabae7ca)
- [Using React/Redux state in ProseMirror Plugin (Medium)](https://anarchang.medium.com/using-react-or-redux-state-in-a-prosemirror-plugin-7af537c2233e)
- [ProseMirror discuss: large decoration sets](https://discuss.prosemirror.net/t/responsivness-improvements-for-rendering-of-a-large-set-of-decorations/8834)
- [Next.js useSearchParams](https://nextjs.org/docs-wip/app/api-reference/functions/use-search-params)
- [Tiptap Extension API](https://tiptap.dev/docs/editor/extensions/custom-extensions/create-new/extension)
- TinyDocy: `heading-fold-plugin.ts`, `heading-scale-extension.ts`, `can-map-decorations.ts`, `compute-section.ts`
