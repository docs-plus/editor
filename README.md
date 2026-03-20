# TinyDocy

TinyDocy is a collaborative document editor built with Tiptap 3, ProseMirror,
Yjs, and Hocuspocus. It is the focused validation environment for
[docs.plus](https://docs.plus): features land here first, then move upstream
after passing reliability, collaboration, and scale checks.

## Core Capabilities

- Title-first document schema (`heading block*`) enforced at editor level.
- Section-level fold/unfold, drag/reorder, and heading filtering.
- Real-time multi-user collaboration with presence/carets.
- Multi-tab document workflow with synced tab state.
- TOC sidebar with click navigation and section drag/drop.
- Rich content blocks (lists, tasks, code, tables, images, marks) plus
  markdown import/export.

## Prerequisites

- [Bun](https://bun.sh) `>=1.3.10`
- Playwright browsers for E2E: `bunx playwright install`

## Quick Start

```bash
bun install
make dev
```

Open [http://localhost:3000](http://localhost:3000).

Local dev runs two services:

- Next.js UI on `:3000`
- Hocuspocus WebSocket server on `:1234` (SQLite-backed)

## Configuration

Primary runtime knobs are environment-driven:

- Guardrails and limits: `lib/security/guardrail-config.ts`
- Hocus extensions (`HOCUS_LOGGER`, `HOCUS_THROTTLE`, `HOCUS_REDIS`, ...):
  `lib/security/hocus-server-extensions.ts`
- Hocus entrypoint: `scripts/hocus-server.ts`

Redis scaling notes:

- Redis extension is opt-in via `HOCUS_REDIS=1`.
- Default Redis endpoint is `127.0.0.1:6380` (non-default port to avoid server
  conflicts with other Redis instances).
- `ecosystem.config.cjs` can run a local `editor-redis` process, but this
  requires a host-installed `redis-server` binary.
- Redis does not replace SQLite persistence; keep Hocuspocus at one instance per
  SQLite file unless you move persistence to shared storage.

Operational guidance:
[`docs/operations/abuse-guardrails-runbook.md`](docs/operations/abuse-guardrails-runbook.md)

## Project Structure

```text
app/                    Next.js App Router
components/
  document-editor/      Canonical integrated editor shell
  tiptap-ui/            Editor toolbar UI components
  tiptap-node/          Remaining node assets (nodeviews + styles)
  toc-sidebar/          Table of contents
  tab-bar/              Multi-tab navigation
  ui/                   shadcn/ui components
extensions/             Standalone editor extensions
  title-document/       H1-first schema extension
  heading-scale/        Dynamic heading scale
  heading-drag/         Section drag extension
  heading-fold/         Fold/unfold extension
  heading-filter/       Heading filter extension
  shared/               Shared ProseMirror helpers
hooks/                  Shared React hooks
lib/                    Utilities and security modules
  security/             WS/HTTP guardrails and abuse controls
tests/                  Unit, E2E, perf, soak, load harness
docs/                   Plans, brainstorms, operations
```

## Scripts

Common commands:

- `make dev` — run Next.js + Hocuspocus
- `bun run build` — production build
- `bun run lint` — ESLint (Next.js rules)
- `bun run check` / `bun run check:fix` — Biome checks
- `bun run test` — Vitest suite

For full script inventory and test targets, see `package.json` and
`Makefile`.

## Testing

Test stack:

- Vitest for unit/fuzz/stress
- Playwright for E2E/perf/soak
- Bun Yjs load harness for convergence under concurrency

Detailed test layers, envs, and CI notes:
[`tests/TESTING.md`](tests/TESTING.md)

## Tech Stack

- Runtime: [Bun](https://bun.sh) (see `packageManager` in `package.json`)
- Framework: [Next.js](https://nextjs.org) 16 (App Router)
- Editor: [Tiptap](https://tiptap.dev) 3 + [ProseMirror](https://prosemirror.net)
- Collaboration: [Yjs](https://yjs.dev) + [Hocuspocus](https://hocuspocus.dev)
- Styling: Tailwind CSS 4 + Sass
- Language: TypeScript (strict)
- Quality: Biome + ESLint + Husky + commitlint

## Conventions

- Conventional Commits (enforced by commitlint)
- Named exports by default
- Bun-only workflow (`bun`, `bunx`)
- Kebab-case files, PascalCase components, camelCase hooks/utilities

## License

MIT — see [LICENSE](LICENSE).
