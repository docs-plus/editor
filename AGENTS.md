# AGENTS.md

## Learned User Preferences

- Use Bun exclusively — `bun`, `bunx`, never `npm`, `npx`, `yarn`, or `pnpm`
- Follow Conventional Commits — atomic commits, imperative mood, no AI/tool/agent references or trailers (`Made-with: Cursor`, `Co-authored-by: AI`); always show a commit review report and wait for explicit approval before committing
- Apply DRY, KISS, and SOLID principles — prefer simpler state over nullable + guards; extract complex inline casts or nested ternaries into named helper functions; disable overzealous lint rules at config level rather than scattering disable comments
- Review from a senior staff engineer / head-of-engineering perspective when asked; for editor plugin code, review as ProseMirror/Tiptap core author checking for performance issues and memory leaks
- Prefer `lucide-react` icons via `lib/icons.ts` barrel file, not local SVG wrapper components
- Use named exports only (no `export default` except where required by framework); title-case acronyms in PascalCase names — `TocSidebar` not `TOCSidebar`
- Avoid hydration mismatches — never use `useState(() => loadFromLocalStorage())`; use `useEffect` with a "ready" state flag; never nest `<button>` inside `<button>`
- Prefer margin-positioned layout (e.g. TOC in left margin) so main content stays centered
- Use shadcn/ui components from `components/ui/` for new UI — design tokens are shadcn CSS variables; `--tt-*` tokens remain only for editor node SCSS
- Keep `.cursor/skills/` and `.cursor/rules/` tracked in git — never ignore them
- Always verify UI changes visually in the browser — open the app, take screenshots, and fix visual bugs before considering work done
- When writing specifications or design documents, keep them self-contained; update related docs after feature implementation to keep teams synchronized

## Learned Workspace Facts

- TinyDocy is a lightweight collaborative document editor built on Tiptap 3, Yjs, and Next.js 16 (App Router) with Bun as runtime (version pinned in `.tool-versions` and `package.json`); all code fully owned — `app/`, `hooks/`, `lib/`, `components/` can be freely refactored
- Code quality: Biome for formatting/linting; ESLint scoped to Next.js rules only (React 19 experimental hooks rules disabled); TypeScript strict mode; `noExplicitAny` and `noNonNullAssertion` warn in Biome; `a11y/useSemanticElements` off
- Git hooks via Husky: pre-commit runs lint-staged (Biome), commit-msg runs commitlint (config `.commitlintrc.json` — dot prefix required)
- Naming: kebab-case files, PascalCase components with title-case acronyms, camelCase hooks/utils; path alias `@/*` maps to root; `types/` for TS declarations, app types colocated
- localStorage keys follow pattern `tinydocy-theme`, `tinydocy-tabs`, `tinydocy-folds-{documentId}`; default theme light (dark mode opt-in, no OS `prefers-color-scheme` fallback)
- Utilities split by domain in `lib/`: `utils.ts` (cn via clsx + tailwind-merge), `shortcuts.ts` (keyboard), `editor-utils.ts` (ProseMirror/Tiptap), `url-utils.ts` (sanitization), `icons.ts` (Lucide barrel)
- UI: shadcn/ui (base-nova style, Base UI primitives, Tailwind v4) in `components/ui/`; old `tiptap-ui-primitive/` fully replaced; custom `ToolbarButton`, `Toolbar`, `Spacer`; Base UI data-attributes have higher CSS specificity — use plain `<div>` for toolbar/popover dividers; editor content area uses shadcn typography
- Document persistence: Hocuspocus (WebSocket) + SQLite via `@hocuspocus/cli`; dev servers run via `make dev` (Makefile with `make -j2`)
- Document model: first node is always H1 title (enforced by TitleDocument extension with schema `heading block*`); each body H1 starts a new section/chapter; heading levels 1-6 only
- Heading drag-and-drop: forked `@tiptap/extension-drag-handle` architecture with `@floating-ui/dom`, custom mouse events (no HTML5 DnD), section-level dragging; ProseMirror quirks: `view.nodeDOM(pos)` returns null under Yjs (use `view.dom.children[i]`), Tiptap React v3 re-parents `view.dom` after construction
- Heading fold/unfold: `Decoration.node()` for heading classes and content hiding, `Decoration.widget()` for 3D CSS crinkle accordion; nested folds suppressed by `outerFoldEnd`; fold state keyed by `data-toc-id` in localStorage; `canMapDecorations` helper shared with HeadingScale; `HeadingFoldMeta.set` supports `persist?: boolean` — filter-driven folds use `persist: false` to skip localStorage save; `view().update()` conditionally copies `prevFoldedIds`/`prevAnimating` only when state actually changed (avoids O(F) allocations per keystroke)
- Heading filter: delegates ALL folding to HeadingFold plugin (no duplicated crinkle/hiding code); `filterSections` returns `directMatchIds + ancestorIds + descendantIds` for full hierarchy tree visibility; preview typing updates `matchedSectionIds` live (preview takes priority over committed slugs for count); title H1 (index 0) always skipped in fold dispatch and `findAllSections`; filter is per-tab — URL params cleared on component unmount; TOC sidebar highlights preview matches via `previewMatchIds` prop; filter state in URL search params (`?filter=...&mode=or|and`); local-only; shortcut CMD/CTRL+SHIFT+F; floating panel UI (sticky anchor + absolute panel) in top-right; `computeOwnRange` prevents false matches from nested subsections; typing fast-path: `canMapDecorations` → O(1) return prev when inactive, O(log D) decos.map when active (skips `findAllSections` entirely — section count cannot change on content-only edits)
- Editor typing performance: `onUpdate` callback skips `onTitleChange` when title text unchanged (ref comparison); all custom plugins (HeadingScale, HeadingDrag, HeadingFold, HeadingFilter) use `canMapDecorations` fast-path for O(1) or O(log N) on content-only edits; structural changes trigger full O(N) rebuild
- Editor page boundary: `.editor-with-toc` has canvas background (`--tt-canvas-color`); `.simple-editor-content` has border, rounded corners (`--tt-radius-sm`), box-shadow (`--tt-page-shadow`), and top/bottom margin; mobile override removes border/shadow/margin for edge-to-edge display
