# TinyDocy

A lightweight collaborative document editor built on Tiptap 3, ProseMirror, and Yjs. TinyDocy serves as the testing ground and MVP for the [docs.plus](https://docs.plus) editor — every feature here is being validated for performance, reliability, and real-time collaboration before integration into the production editor.

This repository is intentionally small and focused. It exists to answer one question: **can these custom editor features handle real documents, real users, and real-world conditions?**

## What It Does

TinyDocy is a fully functional document editor with features that go beyond standard rich text:

| Feature | What it does |
|---------|-------------|
| **Enforced document model** | Every document starts with an H1 title. The schema (`heading block*`) is enforced at the ProseMirror level — paste, drag, and programmatic edits all respect it. |
| **Section fold/unfold** | Collapse any heading section to hide its content. Nested folds are supported. State persists in localStorage across sessions. A 3D CSS crinkle animation marks folded regions. |
| **Section drag-and-drop** | Drag an entire heading section (including nested subsections) to reorder the document. Uses custom mouse events with `@floating-ui/dom` positioning — no HTML5 drag-and-drop. |
| **Heading filter** | Filter the document by heading text. Sections that don't match are folded away. Supports OR/AND modes. State lives in URL params. Shortcut: `CMD+SHIFT+F`. |
| **Dynamic heading scale** | Heading font size adjusts based on depth and position within the document hierarchy, producing a natural visual rhythm. |
| **Real-time collaboration** | Multiple users edit the same document simultaneously via Yjs CRDTs and Hocuspocus WebSocket server. Changes merge automatically without conflicts. |
| **Multi-tab documents** | Open multiple documents in tabs. Playground tab is always available. Keyboard shortcuts for new tab (`CMD+T`), close (`CMD+W`), and switch (`CMD+SHIFT+[/]`). |
| **Table of contents** | A sidebar outline that updates reactively. Click to scroll. Fold toggles per section. Integrates with the heading filter to dim non-matching entries. |
| **Rich content blocks** | Headings (1-6), paragraphs, bullet lists, ordered lists, task lists, blockquotes, code blocks, horizontal rules, images with upload, and inline marks (bold, italic, strike, code, underline, superscript, subscript, multicolor highlight, links). |
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

## Project Structure

```text
app/                    Next.js App Router (pages, layout, global styles)
components/
  tiptap-node/          Custom Tiptap/ProseMirror extensions
    document-node/        TitleDocument — enforced H1-first schema
    heading-node/         HeadingFold, HeadingDrag, HeadingFilter, HeadingScale
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

TinyDocy has a comprehensive multi-layer testing infrastructure. Tests are a first-class concern — the editor is built to be tested, and the tests validate that features work under real-world conditions.

**All Playwright tests require `make dev` to be running.**

### Quick Start

```bash
# Unit tests (schema, plugins, fuzz) — no server needed
make test

# E2E tests (features, performance, collaboration) — needs make dev
make test-e2e

# Quick multi-user collaboration soak (30s, 3 users)
make test-soak-collab-quick

# Full test suite overview
make test-stress        # Headless stress probe (~30s)
make test-load          # 100-client Yjs convergence (~40s)
make test-yjs-soak      # Reconnection + tab switch (~20s)
make test-soak-quick    # 5-minute single-user soak
make test-soak          # Full 30-minute soak suite
```

### Test Layers

**Layer 1 — Unit tests (Vitest):** Schema invariants, plugin state, fuzz testing (10,000 random operations), and a stress probe that binary-searches for the heading count ceiling where transaction time exceeds one frame budget.

**Layer 2 — E2E tests (Playwright):** Feature verification (drag, fold, filter, TOC), keystroke-to-paint latency at 10 and 50 headings, and collaboration sync between multiple browser contexts with unique user identities.

**Layer 3 — Soak tests (Playwright):** Sustained editing sessions with stochastic bots, memory leak detection, and N-user collaboration with full document convergence verification. Documents use realistic content (paragraphs, lists, task lists, code blocks per section). Configurable via environment variables:

```bash
# 5 users editing for 10 minutes on a 30-heading document
SOAK_USERS=5 SOAK_DURATION=600000 SOAK_HEADINGS=30 make test-soak-collab-quick
```

**Layer 4 — Yjs scenarios:** Reconnection recovery (kill/restart Hocuspocus mid-session) and rapid tab switching (Y.Doc lifecycle under mount/unmount stress).

**Layer 5 — Load harness:** Standalone Bun script simulating up to 100 headless Yjs clients editing the same document, with byte-level convergence verification.

See [`tests/README.md`](tests/README.md) for the full testing guide, architecture diagram, and environment variable reference.

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

Private
