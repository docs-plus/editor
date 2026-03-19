# TinyDocy

A lightweight collaborative document editor built on Tiptap 3, ProseMirror, and Yjs. TinyDocy serves as the testing ground and MVP for the [docs.plus](https://docs.plus) editor — every feature here is being validated for performance, reliability, and real-time collaboration before integration into the production editor.

This repository is intentionally small and focused. It exists to answer one question: **can these custom editor features handle real documents, real users, and real-world conditions?**

## What It Does

TinyDocy is a fully functional document editor with features that go beyond standard rich text:

| Feature | What it does |
|---------|-------------|
| **Enforced document model** | Every document starts with an H1 title. The schema (`heading block*`) is enforced at the ProseMirror level — paste, drag, and programmatic edits all respect it. |
| **Section fold/unfold** | Collapse any heading section to hide its content. Nested folds are supported. State persists in localStorage across sessions. A 3D CSS crinkle animation marks folded regions. |
| **Section drag (editor)** | Reorder a heading **and everything under it until the next peer-or-higher heading** from the **editor gutter** (floating handle). Custom pointer + `@floating-ui/dom` — not the browser’s HTML5 drag-and-drop API. |
| **Heading filter** | Filter the document by heading text. Sections that don't match are folded away. Supports OR/AND modes. State lives in URL params. Shortcut: `CMD+SHIFT+F`. |
| **Dynamic heading scale** | Heading font size adjusts based on depth and position within the document hierarchy, producing a natural visual rhythm. |
| **Real-time collaboration** | Multiple users edit the same document simultaneously via Yjs CRDTs and Hocuspocus WebSocket server. Changes merge automatically without conflicts. Collaboration carets show each user's cursor position with name and color, editable via a toolbar dialog. Live online user count displayed in the toolbar. |
| **Multi-tab documents** | Open multiple documents in tabs. Playground tab is always available. Keyboard shortcuts for new tab (`CMD+T`), close (`CMD+W`), and switch (`CMD+SHIFT+[/]`). |
| **Table of contents** | Margin **outline** that tracks headings: click to focus, place the caret at the end of the heading, and scroll it to the **top** of the viewport. Per-row fold toggles; **filter** dims non-matching rows and highlights preview matches while typing. |
| **TOC drag-and-drop** | **dnd-kit** outline reorder: **vertical** drag moves the whole section (same slice semantics as editor section drag); **horizontal** drag changes **only** that heading’s level (H1–H6). **Drag handle** on row hover; **document title (first H1) is not draggable**; **folded** sections still move as a unit; **DragOverlay** shows target level; one **ProseMirror** transaction on drop → **single undo** step. |
| **Rich content blocks** | Headings (1-6), paragraphs, bullet lists, ordered lists, task lists, blockquotes, syntax-highlighted code blocks (via lowlight), resizable tables, horizontal rules, images with upload, and inline marks (bold, italic, strike, code, underline, superscript, subscript, multicolor highlight, links). Markdown import/export supported. |
| **Dark mode** | Toggle between light and dark themes. Persisted in localStorage. No flash on page load. |

## Prerequisites

- [Bun](https://bun.sh) >= 1.3.10
- [Playwright browsers](https://playwright.dev/docs/intro) (for E2E tests): `bunx playwright install`

## Getting Started

```bash
# Install dependencies
bun install

# Start the editor (Next.js + Hocuspocus in parallel)
make dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

This starts two servers:

- **Next.js** on port 3000 — the editor UI
- **Hocuspocus** on port 1234 — WebSocket server for real-time collaboration, backed by SQLite

### Hocuspocus server (`bun run hocus`)

`make dev` runs `scripts/hocus-server.ts` (SQLite + guardrails); production PM2 uses the same `bun run hocus`.

**Env knobs:** defaults and parsing live in `lib/security/guardrail-config.ts` (HTTP/WS/doc limits, tabs, retention, `TRUSTED_PROXY`) and `lib/security/hocus-server-extensions.ts` (`HOCUS_LOGGER`, `HOCUS_THROTTLE`, and related). Ops-oriented notes: [`docs/operations/abuse-guardrails-runbook.md`](docs/operations/abuse-guardrails-runbook.md).

## Project Structure

```text
app/                    Next.js App Router (pages, layout, global styles)
components/
  tiptap-node/          Custom Tiptap/ProseMirror extensions
    document-node/        TitleDocument — enforced H1-first schema
    heading-node/         HeadingFold, HeadingDrag, HeadingFilter, HeadingScale
    code-block-node/      Syntax-highlighted code blocks (lowlight theme)
    table-node/           Resizable table styles
    image-upload-node/    Image upload with progress
    horizontal-rule-node/ Custom horizontal rule
  tiptap-ui/            Editor toolbar components (buttons, dropdowns, popovers)
  tiptap-templates/     Editor templates (SimpleEditor, ThemeToggle)
  toc-sidebar/          Table of contents sidebar
  tab-bar/              Multi-tab document switcher
  ui/                   shadcn/ui components (Base UI primitives)
hooks/                  Custom React hooks (tabs, Yjs document, theme)
lib/                    Utilities (shortcuts, editor helpers, icons, URL utils)
tests/                  Test infrastructure (see Testing below)
docs/                   Design documents, brainstorms, and implementation plans
```

## Scripts

| Command | Description |
|---------|-------------|
| `make dev` | Start Next.js + Hocuspocus dev servers |
| `bun run build` | Build for production |
| `bun run lint` | Run ESLint (Next.js rules) |
| `bun run check` | Run Biome lint + format check |
| `bun run check:fix` | Run Biome lint + format with auto-fix |

## Testing

Vitest (unit/fuzz/stress), Playwright (E2E, perf, soak, Yjs scenarios), and a Bun Yjs load harness. **Playwright needs `make dev` running** (or point tests at your stack; see guide).

```bash
make test              # unit — no servers
make test-e2e          # Playwright — needs dev stack
make test-perf         # typing latency (env-tunable)
make test-perf-collab  # multi-user latency
make test-yjs-soak     # reconnect / tab churn
make test-load         # N-client convergence harness
# …soak variants: Makefile is the menu of targets
```

Full layers, env reference, and CI notes: **[`tests/TESTING.md`](tests/TESTING.md)**.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Runtime** | [Bun](https://bun.sh) 1.3.10 |
| **Framework** | [Next.js](https://nextjs.org) 16 (App Router) |
| **Editor** | [Tiptap](https://tiptap.dev) 3 + [ProseMirror](https://prosemirror.net) |
| **Collaboration** | [Yjs](https://yjs.dev) + [Hocuspocus](https://hocuspocus.dev) (WebSocket + SQLite) |
| **Styling** | [Tailwind CSS](https://tailwindcss.com) 4, Sass |
| **UI Components** | [shadcn/ui](https://ui.shadcn.com) (Base UI primitives) |
| **Language** | TypeScript 5.9 (strict mode) |
| **Code Quality** | [Biome](https://biomejs.dev) (format + lint), ESLint (Next.js rules) |
| **Unit Tests** | [Vitest](https://vitest.dev) (jsdom) |
| **E2E Tests** | [Playwright](https://playwright.dev) (Chromium) |
| **Git Hooks** | [Husky](https://typicode.github.io/husky/) + lint-staged + commitlint |

## Conventions

- **Commits** — [Conventional Commits](https://www.conventionalcommits.org/) enforced by commitlint
- **Formatting** — Biome, auto-runs on commit via lint-staged
- **Naming** — kebab-case files, PascalCase components, camelCase hooks/utils
- **Exports** — Named exports only (no `export default` except where required by framework)
- **Dependencies** — Bun exclusively (`bun`, `bunx`, never npm/npx/yarn/pnpm)

## Relationship to docs.plus

TinyDocy is the prototyping environment for the [docs.plus](https://docs.plus) editor. Features are built and stress-tested here first — once validated against performance thresholds, collaboration edge cases, and document scale limits, they are integrated into the production editor. This repository is intentionally kept small, self-contained, and focused on the editor core.

## License

MIT — see [LICENSE](LICENSE) for details.
