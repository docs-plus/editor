# AGENTS.md

## Learned User Preferences

- Use Bun exclusively — `bun`, `bunx`, never `npm`, `npx`, `yarn`, or `pnpm`
- Follow Conventional Commits — atomic commits, imperative mood, no AI/tool/agent references or trailers (`Made-with: Cursor`, `Co-authored-by: AI`); always show a commit review report and wait for explicit approval before committing
- Apply DRY, KISS, and SOLID principles — prefer simpler state over nullable + guards; avoid overengineering (prefer simple fixed config over port-check scripts when complexity adds minimal value); extract complex inline casts or nested ternaries into named helper functions; disable overzealous lint rules at config level rather than scattering disable comments; prefer discoverable upper_snake env flags for operational toggles (limits, logging, throttle) instead of hiding behavior in code; remove temporary compatibility shims and duplicated folder structures once migrations are complete
- Review from a senior staff engineer / head-of-engineering perspective when asked, including OWASP-oriented gaps when changes touch transport, persistence, or abuse surfaces; for editor plugin code, review as ProseMirror/Tiptap core author checking for performance issues and memory leaks; when review delegation is requested, use the `code-reviewer` subagent
- Prefer `lucide-react` icons via `lib/icons.tsx` barrel file; brand SVGs (Discord, GitHub) also live there — avoid one-off icon wrapper components elsewhere
- Use named exports only (no `export default` except where required by framework); title-case acronyms in PascalCase names — `TocSidebar` not `TOCSidebar`
- Avoid hydration mismatches — never use `useState(() => loadFromLocalStorage())`; use `useEffect` with a "ready" state flag; never nest `<button>` inside `<button>`
- Prefer margin-positioned layout (e.g. TOC in left margin) so main content stays centered; TOC item click: cursor at end of heading node, scroll heading to top of viewport (`block: "start"`, not center), defer scroll via `requestAnimationFrame` after selection/focus settle
- Use shadcn/ui components from `components/ui/` for new UI — design tokens are shadcn CSS variables; `--tt-*` tokens remain only for editor node SCSS
- Keep `.cursor/skills/` and `.cursor/rules/` tracked in git — never ignore them
- Always verify changes by running them — open the app and screenshot for UI; run tests end-to-end for test code; fix issues before considering work done
- When writing specifications or design documents, keep them self-contained; update related docs after feature implementation to keep teams synchronized

## Learned Workspace Facts

- TinyDocy is a lightweight collaborative editor testbed for docs.plus, positioned as an online-capable demo where abuse and OWASP-minded guardrails matter; stack is Next.js 16 App Router + Tiptap 3 + Yjs + Hocuspocus + SQLite, with Bun runtime
- Persistence is Hocuspocus WebSocket + SQLite via custom `bun run hocus` (`scripts/hocus-server.ts`) using `@hocuspocus/extension-sqlite`, custom WS guardrails in `lib/security/*`, and optional official `extension-logger` / `extension-throttle` toggled by `HOCUS_*` env; local dev starts both services with `make dev` (`make -j2`)
- Root `README.md` is the only README; tests docs live in `tests/TESTING.md`; avoid adding `CHANGELOG.md` or deployment PM2/Traefik guides
- Code quality/tooling: Biome for formatting/linting, ESLint scoped to Next.js rules, strict TypeScript; Husky runs lint-staged pre-commit and commitlint on commit-msg
- Naming and exports: kebab-case files, PascalCase components with title-case acronyms, camelCase hooks/utils, named exports by default
- shadcn/ui components in `components/ui/` are the default for new UI; old `tiptap-ui-primitive` is fully replaced
- Utilities are domain-split in `lib/`: `utils.ts`, `shortcuts.ts`, `editor-utils.ts`, `url-utils.ts`, `icons.tsx`, and `user-identity.ts`
- Tabs are synced through Y.Doc `global-tabs` (`useSyncedTabs`) with Playground fixed at index 0; `activeTabId` is local per user; close operations call `DELETE /api/documents/[id]`, which is HTTP rate-limited separately from WS throttles on Hocuspocus; the canonical editor implementation lives in `components/document-editor/` (legacy `components/tiptap-templates/simple` has been removed)
- TOC supports dnd-kit drag-and-drop and section move semantics via `moveSection()`; heading-level and fold behavior are plugin-driven and optimized for large docs; collaboration carets use `@tiptap/extension-collaboration-caret` with `HocuspocusProvider`; user identity is persisted in localStorage (`tinydocy-user`)
- Heading stack extensions (fold, filter, drag, scale) should stay cleanly bounded so other Tiptap apps can adopt them without pulling in the full `components/document-editor` shell
- Document schema enforces title-first (`heading block*`), heading levels 1-6, and title-scoped paste handling; empty docs are seeded when Yjs fragment is empty
- Testing stack is Vitest + Playwright (+ Yjs load/soak harness); use `bun run test` (not `bun test`), run Playwright with `CI=` against existing dev servers, and use `window.__HOCUS_URL`/`window.__HOCUS_TOKEN`/`window.__GLOBAL_TABS_DOC` hooks for test isolation; subprocesses that spawn `bun run hocus` for reconnect-heavy flows should set `HOCUS_THROTTLE=0` so official throttle does not false-positive ban clients
