# AGENTS.md

## Learned User Preferences

- Use Bun exclusively — `bun`, `bunx`, never `npm`, `npx`, `yarn`, or `pnpm`
- Follow Conventional Commits — atomic commits, imperative mood, no AI/tool/agent references anywhere in messages
- Never add trailers like `Made-with: Cursor` or `Co-authored-by: AI` — strip them entirely
- Always show a commit review report and wait for explicit approval before committing
- Avoid overengineering — prefer simple `useState` + `useEffect` over `useSyncExternalStore`, simpler state over nullable + guards, no "store previous props in state" patterns; if a lint rule forces contorted code, disable the rule at config level instead
- Apply DRY, KISS, and SOLID principles but do not over-merge Tiptap scaffold code for "DRY" — keep custom code and scaffold code separated
- Review from a senior staff engineer / head-of-engineering perspective when asked
- Prefer `react-icons/lu` (Lucide) via a barrel file, not local SVG wrapper components
- Avoid hydration mismatches — never use `useState(() => loadFromLocalStorage())`; use `useEffect` with a "ready" state flag instead; never nest `<button>` inside `<button>` (use `<div role="tab">` with `tabIndex` and `onKeyDown` for interactive containers that hold child buttons)
- Prefer margin-positioned layout (e.g. TOC in left margin) so main content stays centered
- Match existing design system tokens (`--tt-*`) when adding new UI components
- Disable overzealous lint rules at config level rather than scattering `eslint-disable` or `biome-ignore` comments across files — keep files clean
- Extract complex inline casts or nested ternaries into named helper functions for readability
- Keep `.cursor/skills/` and `.cursor/rules/` tracked in git — never ignore them

## Learned Workspace Facts

- TinyDocy is a lightweight collaborative document editor built on Tiptap 3, Yjs, and Next.js 16 (App Router)
- Runtime is Bun (version pinned in `.tool-versions` and `package.json` via `packageManager` + `engines`)
- Formatting and linting are handled by Biome; ESLint is scoped to Next.js-specific rules only (React 19 experimental hooks rules `set-state-in-effect`, `refs`, `immutability` are disabled)
- Git hooks via Husky: pre-commit runs lint-staged (Biome), commit-msg runs commitlint (config is `.commitlintrc.json` — the dot prefix is required)
- TypeScript strict mode is enabled; `noExplicitAny` and `noNonNullAssertion` are set to warn in Biome; `a11y/useSemanticElements` is off (false positive for toolbar `role="group"`)
- Path alias `@/*` maps to the project root
- localStorage keys follow the pattern `tinydocy-theme`, `tinydocy-tabs`, `tinydocy-doc-{id}`
- Custom code lives in `app/`, `hooks/`, `components/tab-bar`, `components/toc-sidebar`
- Tiptap scaffold code lives in `components/tiptap-*` — keep it mostly as-is for easier upstream updates
- Naming: kebab-case for directories and files, PascalCase for React component exports, camelCase for hooks and utils
- Two project-level skills exist: `repo-conventions` (tooling/standards) and `commit-review` (commit workflow)
- Storage uses a `StorageAdapter`-style interface with a localStorage adapter and per-document keys
