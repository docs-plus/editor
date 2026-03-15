---
date: 2026-03-12
topic: naming-structure-abstraction-cleanup
---

# Naming, Structure & Abstraction Cleanup

## What We're Building

A systematic cleanup of TinyDocy's codebase to mature it from MVP-quality naming, folder structure, and abstraction patterns into industry-standard conventions. The work covers four areas: fixing naming inconsistencies and typos, reorganizing folder structure for consistency, splitting oversized files, and aligning plugin architecture patterns — all executed as independent, shippable passes.

## Why This Approach

The project accumulated technical debt during rapid MVP feature development. Naming is mostly clean (kebab-case files, PascalCase components, camelCase hooks all pass), but specific inconsistencies exist. Folder structure has loose files breaking the established pattern. The 733-line `lib/tiptap-utils.ts` god file mixes 5+ concern areas. Plugin architecture is inconsistent between `heading-fold-plugin` (uses helpers/) and `heading-drag-plugin` (monolithic). Scaffold code will be treated as regular code — upstream merge cost is accepted.

## Key Decisions

- **Scope**: Naming + folder structure + abstraction improvements. FAANG convention gaps (error boundaries, `types/`, `constants/`, env config, test infra) are deferred to a follow-up effort.
- **Scaffold boundary**: All code is fair game — scaffold code (tiptap-ui/, tiptap-ui-primitive/, tiptap-templates/) will be refactored freely. Upstream merge cost is accepted.
- **Acronym casing**: Title-case in PascalCase names — `TocSidebar` not `TOCSidebar`, following Google/Airbnb convention.
- **Export pattern**: Named exports only — remove all `export default`. Modern React/Next.js convention, tree-shakeable.
- **God file strategy**: Hybrid split — shared utilities (cn, shortcuts) stay in `lib/`, domain-specific utilities (upload, node manipulation) colocate near consumers.
- **Plugin helpers**: Both `heading-fold-plugin` and `heading-drag-plugin` will be reviewed for consistent helper extraction into `helpers/` subfolders.
- **Execution model**: Category-by-Category — 5 independent passes, each independently shippable.

## Execution Categories (in order)

### Pass 1: Naming & Typos

- Fix "TipTap" → "Tiptap" in README.md (2 occurrences)
- Rename `TOCSidebar` → `TocSidebar` (component export + all import references)
- Standardize `canToggle` → use specific names like `canToggleHeading`, `canToggleCodeBlock` to match existing `canToggleBlockquote`, `canToggleMark`, `canToggleList` pattern
- Resolve stale `// TODO: Needed?` in `lib/tiptap-utils.ts:258`
- Rename all `shouldShowButton` exports to domain-specific names — `shouldShowMarkButton`, `shouldShowBlockquoteButton`, `shouldShowHeadingButton`, `shouldShowCodeBlockButton`, `shouldShowTextAlignButton`, `shouldShowUndoRedoButton`, `shouldShowImageUploadButton` — and update all consumers

### Pass 2: Folder Structure

- Move `components/tab-bar.tsx` + `components/tab-bar.scss` → `components/tab-bar/tab-bar.tsx` + `components/tab-bar/tab-bar.scss`
- Move `components/tiptap-ui/shortcut-badge.tsx` → `components/tiptap-ui/shortcut-badge/shortcut-badge.tsx`
- Move `scss.d.ts` from project root → `types/scss.d.ts`
- Move `components/tiptap-icons.ts` → `lib/icons.ts` (utility barrel, not a component)
- Remove empty `docs/prototypes/` directory
- Update all import paths affected by moves

### Pass 3: Export Cleanup

- Remove all `export default` statements across the codebase
- Verify all barrel `index.tsx` re-exports still work
- Ensure no dynamic imports rely on default exports

### Pass 4: God File Split (`lib/tiptap-utils.ts`)

- Extract `cn()` → `lib/cn.ts` (shared utility)
- Extract `formatShortcutKey`, `parseShortcutKeys`, `isMac` → `lib/shortcuts.ts` (shared, used by toolbar)
- Extract URL sanitization (`isValidUrl`, `sanitizeUrl`, `sanitizeHref`) → `lib/url-utils.ts` (shared)
- Colocate `handleImageUpload`, `MAX_FILE_SIZE` → near `image-upload-node/`
- Colocate `focusNextNode`, `findNodePosition`, `isMarkInSchema` → near `tiptap-node/` or keep in `lib/node-utils.ts`
- Remove original `lib/tiptap-utils.ts` once all exports are relocated
- Update all import paths

### Pass 5: Plugin Helper Extraction

- Review `heading-drag-plugin.ts` view() function (~280 lines) — extract DOM creation, mouse event handlers, auto-scroll logic, and positioning into `helpers/`
- Review `heading-fold-plugin.ts` — verify helpers/ structure is clean and consistent
- Ensure both plugins follow the same architectural pattern: thin plugin shell + extracted helper functions

## Open Questions

_None — all key decisions have been resolved during brainstorming and review._

## Next Steps

→ `/workflows:plan` for implementation details per pass
