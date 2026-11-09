# TinyDocy

TinyDocy is a free, open-source (MIT) document editor where several people edit
the same page at once and see each other's cursors. It is built with Tiptap 3,
Yjs and Hocuspocus, needs no account, and is the public testbed for
[docs.plus](https://docs.plus): editor features land here first and move to
docs.plus once they pass collaboration and scale checks.

**Live demo: [tiny.docs.plus](https://tiny.docs.plus)** — open it in two
windows and watch edits sync. It is a public sandbox: everyone sees the same
documents, so don't type anything private.

## Core Capabilities

- Title-first document schema (`heading block*`) enforced at editor level.
- Section-level fold/unfold, drag/reorder, and heading filtering.
- Real-time multi-user collaboration with presence/carets.
- Multi-tab document workflow with synced tab state.
- TOC sidebar with click navigation and section drag/drop.
- Rich content blocks: lists, task lists, code blocks with syntax
  highlighting, tables, blockquotes and text marks.
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
- Hocuspocus 4 WebSocket server on `:1234` (`Bun.serve`, SQLite via
  `bun:sqlite`)

## Configuration

Primary runtime knobs are environment-driven:

- Guardrails and limits: `lib/security/guardrail-config.ts`
- Client IP trust: set `TRUSTED_PROXY=1` only behind a reverse proxy that
  appends to `X-Forwarded-For` (`ecosystem.config.cjs` does). Without it,
  forwarding headers are ignored: WebSocket limits use the socket address and
  HTTP limits share one global key.
- Hocus extensions (`HOCUS_LOGGER`, `HOCUS_THROTTLE`, `HOCUS_REDIS`, ...):
  `lib/security/hocus-server-extensions.ts`
- WebSocket admission and size limits (`HOCUS_ALLOWED_ORIGINS`,
  `WS_SOCKETS_PER_IP`, `HOCUS_MAX_PAYLOAD_BYTES`, per-document caps, ...):
  `lib/security/guardrail-config.ts`, documented in the abuse runbook.
  `HOCUS_ALLOW_ISOLATED_TABS_DOCS=1` is for `make dev` and Playwright only.
- Embedded images are downscaled in the browser to
  `NEXT_PUBLIC_MAX_EMBED_IMAGE_BYTES` (default 256 KB) so one photo cannot push
  a document past the server's size cap.
- Hocus entrypoint: `scripts/hocus-server.ts`
- Hocus persistence + document size guardrail: `lib/hocus-persistence.ts`
- Discord / GitHub buttons (bottom status strip): optional
  `NEXT_PUBLIC_DISCORD_INVITE_URL`, `NEXT_PUBLIC_GITHUB_REPO_URL` — defaults in
  `lib/constants.ts`

Build-time settings (inlined by `bun run build`, so put them in
`.env.production` before building; setting them at runtime has no effect):

- `NEXT_PUBLIC_SITE_URL` — canonical origin for metadata, sitemap, robots and
  JSON-LD (default `https://tiny.docs.plus`). Site copy lives in
  `lib/site-config.ts`.
- `SEO_NOINDEX=1` — preview/staging builds: `noindex` meta, `Disallow: /`,
  empty sitemap.
- `NEXT_PUBLIC_GA_MEASUREMENT_ID=G-XXXXXXXXXX` — optional, opt-in Google
  Analytics 4. Unset or malformed IDs, `next dev`, Vitest and automated
  browsers ship no tag; the CSP only gains Google hosts when it is set.
  Visitors must click Allow, and Global Privacy Control / Do Not Track are
  honoured. Required GA property settings and the event list:
  [`docs/operations/analytics-runbook.md`](docs/operations/analytics-runbook.md).
- `NEXT_PUBLIC_PRIVACY_CONTROLLER`, `NEXT_PUBLIC_PRIVACY_EMAIL` — data
  controller and contact shown on `/privacy` (falls back to GitHub issues).
  Set both before enabling analytics.
- `NEXT_PUBLIC_SERVICE_WORKER=0` — emergency off switch for the service
  worker (default on): pages unregister it and delete its caches on the next
  load. See the PWA section below.

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
- Embed providers are allowlisted by exact host in the CSP
  (`lib/security/content-security-policy.ts`).
- Mermaid SVG is sanitized with DOMPurify because any collaborator can author
  a diagram.
- Documents stored before the switch carry `link` / `code` marks; Hocuspocus
  renames them to `hyperlink` / `inlineCode` on load
  (`lib/yjs-mark-migration.ts`).
- `.github/workflows/docs-plus-extensions.yml` refreshes the extensions every
  3 days and opens a verified PR. It needs "Allow GitHub Actions to create and
  approve pull requests" enabled in the repository settings.

Installable app (PWA):

- Files: `app/manifest.ts`, `app/pwa-icons/[id]` (any-192, any-512,
  maskable-512), `app/offline`, `lib/pwa/*` (worker and routing rules)
  and `components/pwa/*` (registration and the offline retry button).
- The manifest `id` is frozen at `"/"`: changing it orphans existing installs.
- The service worker (`lib/pwa/service-worker.ts`, served at
  `/_next/static/service-worker/sw.js`) registers only in production builds.
  It caches the app's own pages and `/_next/static` files, never documents,
  `/api` or cross-origin requests. Kill switch and deployment rules:
  [`docs/operations/service-worker-runbook.md`](docs/operations/service-worker-runbook.md).
- Deliberately omitted: `shortcuts` and `launch_handler` (no per-document URLs;
  focus-existing would break the two-window demo), `share_target`,
  `file_handlers` and `protocol_handlers` (a public sandbox must not receive
  files or links), Window Controls Overlay (clashes with the tab bar), push,
  badging and background sync (no accounts), and screenshots (for now).

Operational guidance:
[`docs/operations/abuse-guardrails-runbook.md`](docs/operations/abuse-guardrails-runbook.md),
[`docs/operations/analytics-runbook.md`](docs/operations/analytics-runbook.md),
[`docs/operations/service-worker-runbook.md`](docs/operations/service-worker-runbook.md)

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
  render-once/          Render a large collaborative doc once on mount
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
- `bun run typecheck` — TypeScript (app, the Bun-only Hocus server via
  `tsconfig.hocus.json`, and the service worker via `tsconfig.sw.json`)
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
