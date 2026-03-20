---
title: "refactor: extract standalone Tiptap extensions into flat extensions/ directory"
type: refactor
status: completed
date: 2026-03-20
brainstorm: docs/brainstorms/2026-03-20-extension-cleanup-brainstorm.md
---

# refactor: extract standalone Tiptap extensions into flat `extensions/` directory

## Overview

Move the 5 custom Tiptap extensions (HeadingScale, HeadingDrag, HeadingFold, HeadingFilter, TitleDocument) from `components/tiptap-node/{heading-node,document-node}/` into a flat `extensions/` directory at the project root. Each extension gets its own folder with a barrel `index.ts`, co-located SCSS, and self-contained helpers. The HeadingFilter → HeadingFold coupling is broken via a synchronous callback injected through Tiptap options, preserving current ProseMirror transaction semantics.

## Implementation Update (2026-03-20)

This plan has been implemented in the current branch.

- File moves completed (`components/tiptap-node/{heading-node,document-node}` -> `extensions/*`)
- Barrel exports added for all extension directories
- `HeadingFilter` decoupled from direct `HeadingFold` import via optional `foldAdapter`
- Production and test imports rewritten to new extension paths
- Old directories removed
- Added adapter-focused integration tests:
  - filter applies temporary folds when adapter is present
  - fold state restores on clear
  - standalone mode (no adapter) keeps fold state unchanged
  - adapter errors degrade gracefully

Verification run:

- `bun run test`: 138 passed, 4 skipped
- `bun run lint`: no errors (warnings only)
- `bunx biome check --fix` on touched files: clean
- `bunx tsc --noEmit`: still fails on pre-existing unrelated files (`scripts/hocus-server.ts`, `tests/unit/fuzz/schema-fuzz.test.ts`, `tests/unit/stress/headless-stress-probe.test.ts`)

Note: checklist sections below are the original planning checklist and are kept for audit trail.
Treat them as historical planning artifacts, not current execution status.

## Motivation

- `tiptap-node/` directory name is semantically wrong — 4 of 5 extensions use `Extension.create`, not `Node.create`
- All 5 extensions live in a single `heading-node/` directory with no barrel exports — consumers use long, brittle import paths
- HeadingFilter directly imports `headingFoldPluginKey` from HeadingFold, making them inseparable
- External developers cannot copy an extension folder and use it independently
- A flat `extensions/<name>/` structure with barrel files follows Tiptap community conventions

## File Move Map

### Source → Destination

```
components/tiptap-node/heading-node/heading-scale-extension.ts    → extensions/heading-scale/heading-scale.ts
components/tiptap-node/heading-node/heading-drag-extension.ts     → extensions/heading-drag/heading-drag.ts
components/tiptap-node/heading-node/heading-drag-plugin.ts        → extensions/heading-drag/heading-drag-plugin.ts
components/tiptap-node/heading-node/heading-drag.scss             → extensions/heading-drag/heading-drag.scss
components/tiptap-node/heading-node/helpers/drag-helpers.ts       → extensions/heading-drag/helpers/drag-helpers.ts
components/tiptap-node/heading-node/helpers/find-heading-from-cursor.ts → extensions/heading-drag/helpers/find-heading-from-cursor.ts
components/tiptap-node/heading-node/helpers/reposition-handle.ts  → extensions/heading-drag/helpers/reposition-handle.ts
components/tiptap-node/heading-node/heading-fold-extension.ts     → extensions/heading-fold/heading-fold.ts
components/tiptap-node/heading-node/heading-fold-plugin.ts        → extensions/heading-fold/heading-fold-plugin.ts
components/tiptap-node/heading-node/heading-fold.scss             → extensions/heading-fold/heading-fold.scss
components/tiptap-node/heading-node/helpers/fold-storage.ts       → extensions/heading-fold/helpers/fold-storage.ts
components/tiptap-node/heading-node/heading-filter-extension.ts   → extensions/heading-filter/heading-filter.ts
components/tiptap-node/heading-node/heading-filter-plugin.ts      → extensions/heading-filter/heading-filter-plugin.ts
components/tiptap-node/heading-node/heading-filter.scss           → extensions/heading-filter/heading-filter.scss
components/tiptap-node/heading-node/helpers/filter-url.ts         → extensions/heading-filter/helpers/filter-url.ts
components/tiptap-node/heading-node/helpers/match-section.ts      → extensions/shared/match-section.ts
components/tiptap-node/heading-node/helpers/can-map-decorations.ts → extensions/shared/can-map-decorations.ts
components/tiptap-node/heading-node/helpers/compute-section.ts    → extensions/shared/compute-section.ts
components/tiptap-node/heading-node/heading-node.scss             → extensions/shared/heading-node.scss
components/tiptap-node/document-node/document-node-extension.ts   → extensions/title-document/title-document.ts
```

### Helper ownership rationale

| Helper | Owner | Why |
|--------|-------|-----|
| `can-map-decorations.ts` | `shared/` | Used by all 4 heading extensions |
| `compute-section.ts` | `shared/` | Used by HeadingFold, HeadingDrag, TOC sidebar |
| `match-section.ts` | `shared/` | `findAllSections` used by HeadingFilter + TOC sidebar; `filterSections`/`matchSections` build on it |
| `heading-node.scss` | `shared/` | Base heading styles including `--hd-size` consumed by HeadingScale |
| `drag-helpers.ts` | `heading-drag/helpers/` | Only used by HeadingDrag |
| `find-heading-from-cursor.ts` | `heading-drag/helpers/` | Only used by HeadingDrag |
| `reposition-handle.ts` | `heading-drag/helpers/` | Only used by HeadingDrag |
| `fold-storage.ts` | `heading-fold/helpers/` | Only used by HeadingFold |
| `filter-url.ts` | `heading-filter/helpers/` | Used by HeadingFilter + `use-heading-filter` UI hook |

## Decoupling: HeadingFilter ↔ HeadingFold

### Problem

`heading-filter-plugin.ts` imports `headingFoldPluginKey` and dispatches fold metas synchronously inside `view.update()` at 3 sites:

1. **Line 279**: `headingFoldPluginKey.getState(view.state)` — snapshots current fold state before filtering
2. **Lines 293–297**: `tr.setMeta(headingFoldPluginKey, { type: "set", ids: sectionsToFold, persist: false })` — folds non-matching sections
3. **Lines 301–305**: `tr.setMeta(headingFoldPluginKey, { type: "set", ids: savedFoldIds, persist: true })` — restores original folds on clear

### Constraint

The fold dispatch **must stay synchronous** within `view.update()`. Routing through React state would cause flicker and transaction ordering bugs (double dispatch / re-entrancy in ProseMirror).

### Solution: injected `foldAdapter` option

Add a `foldAdapter` option to HeadingFilter that receives a synchronous callback object:

```typescript
// extensions/heading-filter/heading-filter.ts
export interface HeadingFilterFoldAdapter {
  getFoldedIds: (state: EditorState) => Set<string>
  setTemporaryFolds: (tr: Transaction, ids: Set<string>) => Transaction
  restoreFolds: (tr: Transaction, savedIds: Set<string>) => Transaction
}

export interface HeadingFilterOptions {
  onFilterChange?: (state: HeadingFilterCallbackState) => void
  foldAdapter?: HeadingFilterFoldAdapter  // optional — filter works without it
}
```

The `foldAdapter` must also be added to `HeadingFilterPluginOptions` and passed through in `addProseMirrorPlugins()`:

```typescript
// extensions/heading-filter/heading-filter.ts — addProseMirrorPlugins()
addProseMirrorPlugins() {
  return [
    createHeadingFilterPlugin({
      onFilterChange: this.options.onFilterChange,
      foldAdapter: this.options.foldAdapter,  // ← pass through to plugin
    }),
  ];
},
```

**Consumer wiring** in `document-editor.tsx`:

```typescript
HeadingFilter.configure({
  onFilterChange: setFilterState,
  foldAdapter: {
    getFoldedIds: (state) => headingFoldPluginKey.getState(state)?.foldedIds ?? new Set(),
    setTemporaryFolds: (tr, ids) =>
      tr.setMeta(headingFoldPluginKey, { type: "set", ids, persist: false }),
    restoreFolds: (tr, savedIds) =>
      tr.setMeta(headingFoldPluginKey, { type: "set", ids: savedIds, persist: true }),
  },
})
```

**Inside `heading-filter-plugin.ts`**: replace the 3 `headingFoldPluginKey` call sites with `options.foldAdapter?.xxx()` calls. If `foldAdapter` is `undefined`, skip fold coordination — filter works standalone (highlights only, no fold toggling).

### Behavior matrix

| Extensions present | Behavior |
|----|-----|
| Filter + Fold (with adapter) | Full coordination — current behavior preserved |
| Filter only (no adapter) | Filter highlights matching sections, no fold toggling |
| Fold only | Manual fold/unfold, no filter integration |

## Barrel File Contents

### `extensions/heading-scale/index.ts`

```typescript
export { HeadingScale, headingScalePluginKey } from "./heading-scale"
```

### `extensions/heading-drag/index.ts`

```typescript
export { HeadingDrag } from "./heading-drag"
```

### `extensions/heading-fold/index.ts`

```typescript
export { HeadingFold } from "./heading-fold"
export type { HeadingFoldOptions } from "./heading-fold"
export { headingFoldPluginKey } from "./heading-fold-plugin"
export type { HeadingFoldPluginOptions } from "./heading-fold-plugin"
```

### `extensions/heading-filter/index.ts`

```typescript
export { HeadingFilter } from "./heading-filter"
export type { HeadingFilterOptions, HeadingFilterFoldAdapter } from "./heading-filter"
export { headingFilterPluginKey } from "./heading-filter-plugin"
export type {
  HeadingFilterCallbackState,
  HeadingFilterState,
  HeadingFilterMeta,
} from "./heading-filter-plugin"
```

### `extensions/title-document/index.ts`

```typescript
export { TitleDocument } from "./title-document"
```

### `extensions/shared/index.ts`

```typescript
export { canMapDecorations } from "./can-map-decorations"
export { computeSection } from "./compute-section"
export { findAllSections, filterSections, matchSections } from "./match-section"
```

## Import Rewrite Inventory

### Production code (3 files)

| File | Old imports | New imports |
|------|------------|------------|
| `components/document-editor/document-editor.tsx` | 5 extension imports + 1 type import + 4 SCSS imports + 1 helper | 5 from barrels + 4 SCSS from new paths + 1 helper from barrel |
| `components/toc-sidebar/toc-sidebar.tsx` | `computeSection` from `../tiptap-node/heading-node/helpers/compute-section`, `findAllSections` from `../tiptap-node/heading-node/helpers/match-section` | Both from `@/extensions/shared` |
| `components/tiptap-ui/heading-filter/use-heading-filter.ts` | `HeadingFilterCallbackState` + `updateFilterUrl` from heading-node paths | From `@/extensions/heading-filter` barrel + `@/extensions/heading-filter/helpers/filter-url` |

### Test code (12 files)

| File | Old import | New import |
|------|-----------|------------|
| `tests/helpers/create-test-editor.ts` | HeadingFilter, HeadingFold, HeadingScale, TitleDocument from heading-node/document-node paths | From respective barrels |
| `tests/helpers/assert-invariants.ts` | `computeSection` from heading-node helpers | From `@/extensions/shared` |
| `tests/unit/plugins/heading-filter.test.ts` | `headingFilterPluginKey` from heading-filter-plugin | From `@/extensions/heading-filter` barrel |
| `tests/unit/plugins/heading-fold.test.ts` | `headingFoldPluginKey` from heading-fold-plugin | From `@/extensions/heading-fold` barrel |
| `tests/unit/plugins/heading-scale.test.ts` | `headingScalePluginKey` from heading-scale-extension | From `@/extensions/heading-scale` barrel |
| `tests/unit/plugins/heading-drag.test.ts` | `buildHandleDecos` from helpers/drag-helpers | From `@/extensions/heading-drag/helpers/drag-helpers` |
| `tests/unit/stress/headless-stress-probe.test.ts` | `headingFilterPluginKey`, `headingFoldPluginKey` | From respective barrels |
| `tests/unit/helpers/can-map-decorations.test.ts` | `canMapDecorations` from helpers | From `@/extensions/shared` |
| `tests/unit/helpers/compute-section.test.ts` | `computeSection` from helpers | From `@/extensions/shared` |
| `tests/unit/helpers/filter-url.test.ts` | filter-url exports from helpers | From `@/extensions/heading-filter/helpers/filter-url` |
| `tests/unit/helpers/match-section.test.ts` | match-section exports from helpers | From `@/extensions/shared` |
| `tests/unit/helpers/fold-storage.test.ts` | fold-storage exports from helpers | From `@/extensions/heading-fold/helpers/fold-storage` |

**Total: 15 external files** requiring import rewrites.

## Internal Import Rewrites

After files move, cross-references within each extension update to relative paths:

| File | Rewrites needed |
|------|----------------|
| `heading-scale.ts` | `helpers/can-map-decorations` → `@/extensions/shared` |
| `heading-drag.ts` | `heading-drag-plugin` → `./heading-drag-plugin` (already relative, just verify) |
| `heading-drag-plugin.ts` | `helpers/can-map-decorations`, `helpers/compute-section` → `@/extensions/shared`; drag-specific helpers → `./helpers/*` |
| `heading-fold.ts` | `heading-fold-plugin` → `./heading-fold-plugin`; `helpers/fold-storage` → `./helpers/fold-storage` |
| `heading-fold-plugin.ts` | `helpers/can-map-decorations`, `helpers/compute-section` → `@/extensions/shared`; `helpers/fold-storage` → `./helpers/fold-storage` |
| `heading-filter.ts` | `heading-filter-plugin` → `./heading-filter-plugin` |
| `heading-filter-plugin.ts` | **Remove `headingFoldPluginKey` import**; `helpers/can-map-decorations` → `@/extensions/shared`; `helpers/match-section` → `@/extensions/shared` |

## Historical Planning Checklist (Archived)

### Phase 1: Create directory structure + move files

No code changes — pure file moves and renames.

- [ ] Create `extensions/` directory with subdirectories: `heading-scale/`, `heading-drag/`, `heading-drag/helpers/`, `heading-fold/`, `heading-fold/helpers/`, `heading-filter/`, `heading-filter/helpers/`, `title-document/`, `shared/`
- [ ] Move and rename all files per the File Move Map above (use `git mv` to preserve history)
- [ ] Verify no files remain in `components/tiptap-node/heading-node/` and `components/tiptap-node/document-node/`

### Phase 2: Fix internal imports

Update all within-extension and shared imports to new relative/absolute paths.

- [ ] Update imports in all 7 internal files per the Internal Import Rewrites table
- [ ] Verify internal imports resolve — `bunx tsc --noEmit` will still report errors from the 15 external consumer files (expected, fixed in Phase 5)

### Phase 3: Create barrel files

- [ ] Create `index.ts` for each of the 5 extensions + `shared/` per the Barrel File Contents section
- [ ] Verify: no circular dependency warnings from TypeScript

### Phase 4: Decouple HeadingFilter from HeadingFold

- [ ] Add `HeadingFilterFoldAdapter` interface to `heading-filter.ts`
- [ ] Add optional `foldAdapter` to `HeadingFilterOptions`
- [ ] In `heading-filter-plugin.ts`: replace 3 `headingFoldPluginKey` call sites with `options.foldAdapter?.xxx()` calls, wrapped in `try/catch` for resilience against buggy consumer adapters
- [ ] Remove `import { headingFoldPluginKey }` from `heading-filter-plugin.ts`
- [ ] Guard all fold coordination AND cursor relocation (lines 311–342) with `if (options.foldAdapter)` — filter works standalone when adapter is absent (highlights only, no cursor jump)
- [ ] In `document-editor-config.ts`: wire `foldAdapter` using `headingFoldPluginKey` (imported from `@/extensions/heading-fold`); ensure HeadingFold appears before HeadingFilter in the extensions array (fold plugin must be registered first for `getState()` to return data)

### Phase 5: Rewrite external imports

Update all 15 consumer files per the Import Rewrite Inventory tables.

- [ ] `document-editor.tsx`/`document-editor-config.ts` — rewrite imports + add `foldAdapter` wiring + update SCSS paths
- [ ] `toc-sidebar.tsx` — rewrite 2 imports to `@/extensions/shared`
- [ ] `use-heading-filter.ts` — rewrite 2 imports to `@/extensions/heading-filter`
- [ ] `create-test-editor.ts` — rewrite 4 imports to barrels
- [ ] `assert-invariants.ts` — rewrite 1 import to `@/extensions/shared`
- [ ] 7 unit test files — rewrite imports to barrels or direct paths
- [ ] `headless-stress-probe.test.ts` — rewrite 2 imports to barrels

### Phase 6: Delete old directories

- [ ] Delete `components/tiptap-node/heading-node/` (should be empty)
- [ ] Delete `components/tiptap-node/document-node/` (should be empty)

### Phase 7: Verify

- [ ] `bunx tsc --noEmit` — zero type errors
- [ ] `bun run test` — all unit tests pass
- [ ] `bun run lint` — no lint errors
- [ ] `bun run build` — production build succeeds (tree-shaking, static analysis)
- [ ] `rm -rf .next && bun run dev` — clean build, app starts, open editor, verify:
  - Heading scale renders correctly (different sizes)
  - Heading drag handle appears on hover
  - Heading fold works (click crinkle to fold/unfold)
  - Heading filter works (filter highlights + fold coordination)
  - Filter clear restores previous fold state
- [ ] Verify HeadingFilter works without HeadingFold (remove HeadingFold from extension list temporarily — filter should still highlight without fold toggling)

## Acceptance Criteria

- [ ] All 5 extensions live in `extensions/<name>/` with barrel `index.ts`
- [ ] Each extension folder is self-contained (only depends on `@tiptap/*`, `@/extensions/shared`, and declared peer deps like `@floating-ui/dom`)
- [ ] HeadingFilter does NOT import from HeadingFold — decoupled via `foldAdapter` option
- [ ] HeadingFilter works standalone (no foldAdapter) — highlights without fold toggling
- [ ] `components/tiptap-node/heading-node/` and `components/tiptap-node/document-node/` are deleted
- [ ] All 15 consumer files import from new paths
- [ ] All existing tests pass without modification (beyond import path updates)
- [ ] No runtime behavioral changes — fold/filter/drag/scale work identically to before

## Dependencies & Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| `git mv` rename tracking lost in complex moves | Blame history breaks | Move + rename in separate commits if needed; Git handles single-step renames well |
| ProseMirror transaction ordering after decoupling | Flicker, fold state corruption | `foldAdapter` runs synchronously inside `view.update` — same execution context as before |
| Missed import in test/e2e file | CI failure | Authoritative rewrite list above; `bunx tsc --noEmit` catches all |
| SCSS import path breaks | Visual regression, build error | Next.js resolves `@/` SCSS imports from tsconfig — no config change needed; manual verification in Phase 7 |
| SCSS inter-imports break on move | Build error | Verified: no SCSS files `@import` or `@use` each other — non-issue |

## References

- Brainstorm: `docs/brainstorms/2026-03-20-extension-cleanup-brainstorm.md`
- Current extensions: `extensions/` (heading-scale, heading-drag, heading-fold, heading-filter, title-document, shared)
- Legacy locations removed: `components/tiptap-node/heading-node/`, `components/tiptap-node/document-node/`
- Tiptap Extension.create API: <https://tiptap.dev/docs/editor/extensions/custom-extensions>
