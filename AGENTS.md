# AGENTS.md

## Learned User Preferences

- Use Bun exclusively — `bun`, `bunx`, never `npm`, `npx`, `yarn`, or `pnpm`
- Follow Conventional Commits — atomic commits, imperative mood, no AI/tool/agent references or trailers (`Made-with: Cursor`, `Co-authored-by: AI`); always show a commit review report and wait for explicit approval before committing
- Apply DRY, KISS, and SOLID principles — prefer simple `useState` + `useEffect` over `useSyncExternalStore`, simpler state over nullable + guards; do not over-merge Tiptap scaffold code for "DRY" — keep custom and scaffold code separated; disable overzealous lint rules at config level rather than scattering `eslint-disable` or `biome-ignore` comments
- Review from a senior staff engineer / head-of-engineering perspective when asked
- Prefer `react-icons/lu` (Lucide) via a barrel file, not local SVG wrapper components
- Avoid hydration mismatches — never use `useState(() => loadFromLocalStorage())`; use `useEffect` with a "ready" state flag instead; never nest `<button>` inside `<button>` (use `<div role="tab">` with `tabIndex` and `onKeyDown` for interactive containers that hold child buttons)
- Prefer margin-positioned layout (e.g. TOC in left margin) so main content stays centered
- Match existing design system tokens (`--tt-*`) when adding new UI components
- Extract complex inline casts or nested ternaries into named helper functions for readability
- Keep `.cursor/skills/` and `.cursor/rules/` tracked in git — never ignore them
- Include testing strategy when brainstorming or planning features — cover simple-to-complex scenarios and edge cases in E2E tests
- When writing specifications or design documents, keep them self-contained — do not reference non-existent files or unverified code patterns

## Learned Workspace Facts

- TinyDocy is a lightweight collaborative document editor built on Tiptap 3, Yjs, and Next.js 16 (App Router) with Bun as runtime (version pinned in `.tool-versions` and `package.json` via `packageManager` + `engines`)
- Formatting and linting are handled by Biome; ESLint is scoped to Next.js-specific rules only (React 19 experimental hooks rules `set-state-in-effect`, `refs`, `immutability` are disabled)
- Git hooks via Husky: pre-commit runs lint-staged (Biome), commit-msg runs commitlint (config is `.commitlintrc.json` — the dot prefix is required)
- TypeScript strict mode is enabled; `noExplicitAny` and `noNonNullAssertion` are set to warn in Biome; `a11y/useSemanticElements` is off (false positive for toolbar `role="group"`)
- Path alias `@/*` maps to the project root
- localStorage keys follow the pattern `tinydocy-theme`, `tinydocy-tabs`; default theme is light (dark mode opt-in, no OS `prefers-color-scheme` fallback)
- Custom code lives in `app/`, `hooks/`, `components/tab-bar`, `components/toc-sidebar`, `components/playground`; Tiptap scaffold code lives in `components/tiptap-*` — keep it mostly as-is for easier upstream updates
- Naming: kebab-case for directories and files, PascalCase for React component exports, camelCase for hooks and utils
- Document persistence uses Hocuspocus (WebSocket) + SQLite via `@hocuspocus/cli`; dev servers run via `make dev` (Makefile with `make -j2`)
- Document model: first node is always an H1 title (enforced by TitleDocument extension with schema `heading block*`); each body H1 starts a new section/chapter; heading levels 1-6 only (HTML standard)
- Editor content area targets Google Docs appearance — Arial font, 15px body text, 1.15 line-height, Google blue selection and link colors
- Heading drag-and-drop uses a forked `@tiptap/extension-drag-handle` architecture — handle outside contenteditable via `@floating-ui/dom`, custom mouse events (no HTML5 DnD), section-level dragging; ProseMirror view quirks: `view.nodeDOM(pos)` returns null under Yjs (use `view.dom.children[i]`), Tiptap React v3 re-parents `view.dom` after construction (plugins must detect parent change in `update()` and re-mount)
