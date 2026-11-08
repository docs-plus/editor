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
- docs.plus editor extensions: link popovers with autolink and `Mod-K`,
  inline code, Tab indent, cursor-local placeholders, live Mermaid diagrams and
  charts, and media embeds (image, video, audio, YouTube, Vimeo, Loom,
  SoundCloud, Spotify, X).

## Prerequisites

- [Bun](https://bun.sh) `>=1.3.10`
- [Node.js](https://nodejs.org) `>=22.22.2` (Next.js, Vitest, ESLint and the
  git hooks run on Node)
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
- Discord / GitHub buttons (bottom status strip): optional
  `NEXT_PUBLIC_DISCORD_INVITE_URL`, `NEXT_PUBLIC_GITHUB_REPO_URL` — defaults in
  `lib/constants.ts`

Redis scaling notes:

- Redis extension is opt-in via `HOCUS_REDIS=1`.
- Default Redis endpoint is `127.0.0.1:6380` (non-default port to avoid server
  conflicts with other Redis instances).
- `ecosystem.config.cjs` can run a local `editor-redis` process, but this
  requires a host-installed `redis-server` binary.
- Redis does not replace SQLite persistence; keep Hocuspocus at one instance per
  SQLite file unless you move persistence to shared storage.

Editor extensions:

- The `@docs.plus/extension-*` packages are wired in
  `components/document-editor/document-editor-config.ts`; their stylesheets are
  themed to the shadcn tokens in `document-editor.scss`.
- Embed providers are allowlisted by exact host in the CSP (`next.config.ts`).
- Mermaid SVG is sanitized with DOMPurify because any collaborator can author
  a diagram.
- Documents stored before the switch carry `link` / `code` marks; Hocuspocus
  renames them to `hyperlink` / `inlineCode` on load
  (`lib/yjs-mark-migration.ts`).
- `.github/workflows/docs-plus-extensions.yml` refreshes the extensions every
  3 days and opens a verified PR. It needs "Allow GitHub Actions to create and
  approve pull requests" enabled in the repository settings.

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
- `bun run typecheck` — TypeScript (`tsc --noEmit`)
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

## Community & Upstream

TinyDocy is the validation testbed for **docs.plus** — features are proven here
before landing in the production editor.

- [docs.plus](https://www.docs.plus) — live platform
- [docs-plus/docs.plus](https://github.com/docs-plus/docs.plus) — production
  repo
- [Discord](https://discord.com/invite/25JPG38J59) — join the community

## License

MIT — see [LICENSE](LICENSE).
