---
date: 2026-03-20
topic: extension-cleanup
---

# Editor Extension Cleanup & Standalone Packaging

## What We're Building

Restructure the 5 custom Tiptap extensions (HeadingScale, HeadingDrag, HeadingFold, HeadingFilter, TitleDocument) from the monolithic `components/tiptap-node/heading-node/` directory into a flat top-level `extensions/` directory. Each extension becomes a self-contained, copy-paste portable folder with barrel exports and co-located styles. The HeadingFilter→HeadingFold coupling is broken via callback-based integration so each extension works independently.

The goal: a developer can copy `extensions/heading-fold/` into their own Tiptap project and it works without pulling in the rest of TinyDocy.

## Why This Approach

Three approaches were considered:

1. **Flat `extensions/` directory (chosen)** — top-level directory, each extension is its own folder, clean barrel exports, fully decoupled. Best for portability and discoverability.
2. **In-place cleanup in `tiptap-node/`** — less disruption but the `-node` suffix is semantically wrong for `Extension.create` types, and the nested location is not discoverable for external devs.
3. **Hybrid** — move only targets, leave the rest. Creates two conventions for extension location.

Approach 1 was chosen because:

- The `-node` suffix on `tiptap-node/` is misleading — HeadingScale, HeadingDrag, HeadingFold, HeadingFilter are `Extension.create`, not `Node.create`
- A top-level `extensions/` is the standard Tiptap community convention for custom extensions
- Flat folders with barrel exports make copy-paste integration trivial

## Key Decisions

- **Directory structure**: `extensions/<name>/` — flat, one folder per extension, no nesting

  ```
  extensions/
  ├── heading-scale/
  │   ├── index.ts              (barrel: extension + types)
  │   ├── heading-scale.ts      (Extension.create wrapper)
  │   └── heading-scale.scss    (co-located styles)
  ├── heading-drag/
  │   ├── index.ts
  │   ├── heading-drag.ts
  │   ├── heading-drag-plugin.ts
  │   ├── heading-drag.scss
  │   └── helpers/
  │       ├── drag-helpers.ts
  │       ├── find-heading-from-cursor.ts
  │       └── reposition-handle.ts
  ├── heading-fold/
  │   ├── index.ts
  │   ├── heading-fold.ts
  │   ├── heading-fold-plugin.ts
  │   ├── heading-fold.scss
  │   └── helpers/
  │       └── fold-storage.ts
  ├── heading-filter/
  │   ├── index.ts
  │   ├── heading-filter.ts
  │   ├── heading-filter-plugin.ts
  │   ├── heading-filter.scss
  │   └── helpers/
  │       ├── match-section.ts
  │       └── filter-url.ts
  ├── title-document/
  │   ├── index.ts
  │   └── title-document.ts
  └── shared/
      ├── index.ts
      ├── can-map-decorations.ts
      └── compute-section.ts
  ```

- **Decoupling HeadingFilter ↔ HeadingFold**: via callback options following Tiptap's `addOptions()` convention
  - HeadingFilter gets an `onFilterApplied(filteredSectionIds: Set<string>)` callback option
  - HeadingFilter no longer imports `headingFoldPluginKey`
  - The consumer (editor template) wires Filter output to Fold input when both are present
  - HeadingFold works standalone (manual fold/unfold); HeadingFilter works standalone (filter without fold integration)

- **Shared helpers**: `extensions/shared/` directory with barrel `index.ts`
  - `canMapDecorations` — used by all 4 heading extensions (decoration optimization fast-path)
  - `computeSection` — used by HeadingFold and HeadingDrag (section boundary computation)
  - `heading-node.scss` — base heading styles shared across all heading extensions
  - Documented as an explicit dependency: "if you copy an extension, also copy `shared/`"

- **External dependencies**: HeadingDrag requires `@floating-ui/dom` for handle positioning — the only non-Tiptap/ProseMirror peer dependency across all 5 extensions

- **Naming convention**: Drop the `-extension` suffix from filenames, keep PascalCase exports
  - `heading-fold.ts` not `heading-fold-extension.ts` (the folder name already says "extension")
  - Export names unchanged: `HeadingFold`, `HeadingScale`, `TitleDocument`
  - Plugin files keep `-plugin.ts` suffix: `heading-fold-plugin.ts` (distinguishes ProseMirror plugin from Tiptap extension)

- **Styles**: Co-located `.scss` files inside each extension folder
  - Consumer imports style alongside extension: `import "@/extensions/heading-fold/heading-fold.scss"`
  - Base heading styles (`heading-node.scss`) move to `extensions/shared/heading-node.scss` since they apply to all heading extensions

- **Barrel exports**: Each `index.ts` exports:
  - The extension itself (named export)
  - PluginKey (if applicable)
  - TypeScript types for options/state (e.g., `HeadingFilterCallbackState`, `HeadingFoldOptions`)
  - Nothing else — no styles re-export from TS
  - Types are part of the public API — UI components like `tiptap-ui/heading-filter/` import them from the barrel

## Scope — What Stays in `components/tiptap-node/`

These are NOT part of this refactor (they are project-specific NodeViews, not portable extensions):

- `image-upload-node/` — React NodeView with project-specific upload logic
- `horizontal-rule-node/` — trivial `.extend()` wrapper, stays in place
- All SCSS-only directories (blockquote-node, code-block-node, etc.) — styling only, no extension logic

`components/tiptap-ui/` is also out of scope — those are project-specific UI components.

**Deferred**: `document-editor.tsx` was historically large and orchestrated many extensions, but splitting it is a separate concern from extension portability. Clean it up in a follow-up after extensions are restructured — the import simplification from barrel files will already reduce its noise.

## Migration Notes

- **Old directory cleanup**: `components/tiptap-node/heading-node/` and `components/tiptap-node/document-node/` are deleted after the move — no symlinks or stubs
- **Import rewrites**: All consumers update paths from `@/components/tiptap-node/heading-node/*` to `@/extensions/<name>`; affected files include `document-editor.tsx`, `tiptap-ui/heading-filter/use-heading-filter.ts`, `toc-sidebar/` (if it imports heading types)
- **Build config**: No changes expected — Next.js handles SCSS imports from any project directory; path aliases in `tsconfig.json` may need an `@/extensions/*` entry if not covered by a catch-all

## Open Questions

_(None — all questions resolved during brainstorming)_

## Next Steps

→ `/workflows:plan` for implementation details (file moves, import rewrites, decoupling implementation, barrel file contents)
