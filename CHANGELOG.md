# Changelog

All notable changes to TinyDocy. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). TinyDocy is deployed
continuously from `main`, so entries are grouped by merged pull request rather
than by version number. Each entry lists anything an operator has to do when
deploying it.

## [Unreleased]

### Fixed
- **Image resize handles appear on the image again.** A host rule made every
  top-level editor child `position: relative`, including the media
  extension's resize gripper, so its handles were drawn below and beside the
  hovered image (wherever the gripper sat in the document flow). The rule now
  skips the gripper.

### Deploy
- Pull, build and restart as usual.

## 2026-11-09 · #14 CI on every pull request

### Added
- **CI on every pull request and push to `main`** (`.github/workflows/ci.yml`).
  - The checks job runs Biome, ESLint, the typecheck, unit tests and the
    production build.
  - The e2e job runs the Playwright Chromium suite against `next dev` and
    Hocuspocus.
  - Jobs get a read-only token and no secrets, and actions are pinned to
    commit SHAs.
  - The stress probe is a timing benchmark, so it runs as a separate,
    non-blocking step.

### Deploy
- Nothing to deploy. To require these checks before merging, add the two CI
  jobs as required status checks in the `main` branch protection rule.

## 2026-11-09 · #13 Faster typing, changelog and README

### Added
- `CHANGELOG.md` (this file). Contributors add an entry under Unreleased with
  every pull request.

### Changed
- **Typing is 3–4x faster in large documents.** With 1,455 blocks, a
  keystroke reaches the next frame in 13–14 ms on desktop (was 52–69 ms) and
  50–56 ms on an emulated phone (was 203–282 ms). Mount time is unchanged.
  - The editor shell no longer re-renders on every transaction, and the
    editor options stay stable, so Tiptap no longer reconfigures the view per
    keystroke.
  - Toolbar controls share one store per editor: selection, mark, focus and
    editable changes update them at once; document changes update them after
    150 ms of quiet (`TOOLBAR_SETTLE_MS`).
  - Heading ids are assigned only when a change touches a heading, instead
    of walking the whole document.
  - The outline rebuilds at most every 250 ms while typing, notifies only
    when it actually changes, and re-renders only the sidebar.
  - Code blocks are re-highlighted only where a change touches them
    (`components/document-editor/incremental-lowlight.ts`).
  - The Yjs sync plugin skips its pass when the document is unchanged.
- Root README restructured for evaluators, self-hosters, operators and
  contributors.

## 2026-11-09 · #12 Installable app, offline editing, faster large documents

### Added
- **Installable app (PWA).**
  - Full web app manifest with a frozen `id` of `/`, plus icons: any-192/512
    and maskable-512 from `app/pwa-icons/[id]`, and an opaque apple-touch-icon.
  - `theme-color` follows the dark-mode toggle; iOS web-app metadata.
  - An install button in the status strip, with a one-line iOS
    "Add to Home Screen" hint.
  - Analytics records `pwa_install { outcome }` only.
- **Service worker** (`lib/pwa/*`, Next 16's native Turbopack worker):
  - pages are network-first, falling back to a stored copy or `/offline`;
    `/_next/static` is cache-first;
  - `/api`, RSC requests, cross-origin requests and WebSockets are never
    handled by the worker;
  - two-layer kill switch: `NEXT_PUBLIC_SERVICE_WORKER=0` plus a source
    `KILL_SWITCH` constant.
- **Offline editing, on by default** (`lib/offline/`, `lib/collab-session.ts`):
  - documents and the tab list open from IndexedDB before the server answers,
    and offline edits sync on reconnect;
  - copies last 14 days, at most 30 documents are kept, and offline edits pause
    at 512 KiB;
  - `/privacy` discloses the copies and has a "Delete offline copies" button;
  - `NEXT_PUBLIC_OFFLINE_CACHE=0` turns copies off and deletes stored ones.
- **Connection UX.**
  - Online / connecting / offline status with one live region.
  - Amber offline banner; tab create and close are disabled while offline.
  - A calm pre-ready offline notice; `100dvh` layout.
- Unsynced edits survive tab switches, and the leave-page prompt appears only
  while edits are unsynced.

### Changed
- **Large documents render once on mount instead of three times**
  (`extensions/render-once/`), and off-screen blocks skip layout
  (`content-visibility: auto`). With 1,247 blocks on an emulated phone, content
  appears at 3.9 s (was about 6 s), the longest freeze is 1.2 s (was 3.1 s) and
  heap use is 28 MB (was 53 MB).
- Tab titles change only from the visitor's own edits, never from cached or
  remote renders.

### Fixed
- Playground regenerate no longer replays on every editor remount.
- A closed tab's still-open session can no longer write its offline copy back.

### Security
- **Deleted documents stay deleted for offline clients.**
  - Tombstoned names are refused at connect.
  - Tab repair drops their tabs.
  - The retention purge tombstones expired documents.
  - Tombstones last `TOMBSTONE_RETENTION_DAYS` (default 90).
- Updates that only delete content may pass the size cap, so an over-cap
  document can be trimmed.
- CSP gains `worker-src 'self'` and `manifest-src 'self'`.

### Deploy
- Pull, build, and restart with `--update-env`.
- Check that `/_next/static/service-worker/sw.js` keeps
  `Cache-Control: public, max-age=0, must-revalidate` through the proxy. See
  `docs/operations/service-worker-runbook.md`.

## 2026-11-09 · #11 Faster first load, app-shell skeleton

### Added
- **App-shell skeleton** (`components/app-skeleton`). It is server-rendered in
  the live editor's geometry (tab bar, toolbar, outline, page card), with the
  SEO intro in the page card, and one skeleton covers every loading phase.

### Changed
- **The editor bundle is code-split** and preloaded while the tab list syncs.
  Initial JavaScript went from about 590 KB to 289 KB gzip.
- **One shared WebSocket** carries the tab list and documents, through a
  reference-counted session cache with deferred release
  (`lib/collab-session.ts`).
- **A cheaper table of contents** (`extensions/table-of-contents`): no forced
  layout per keystroke, rebuilds once per frame, and React is notified only
  when the active heading changes.
- Code blocks without a language skip highlight auto-detection.

### Fixed
- A document refused for size no longer triggers a reconnect storm. Before,
  clients retried about three times a second until Throttle banned their IP for
  five minutes.

## 2026-11-09 · #10 Over-cap documents open again

### Fixed
- The size guard counted the empty sync step 2 every client sends on connect,
  so documents already over the cap could not even be opened. Refused edits now
  make the editor read-only with a notice.

### Deploy
- Production allows 2 MiB documents (`MAX_DOC_SIZE_BYTES` in
  `ecosystem.config.cjs`); restart with `--update-env`.

## 2026-11-09 · #8, #9 Dependabot action updates

### Changed
- `actions/checkout` 7.0.1 and `actions/setup-node` 7.1.0, still pinned to
  commit SHAs.

## 2026-11-09 · #7 SEO, analytics and security hardening

### Added
- **SEO.**
  - Server-rendered intro instead of an empty body.
  - Metadata, Open Graph and Twitter cards, and a canonical URL.
  - `robots.txt`, `sitemap.xml`, manifest, icons and a share image.
  - `llms.txt` and a JSON-LD graph.
  - `/about` (features and FAQ) and `/privacy`.
  - `SEO_NOINDEX=1` for previews; `lib/site-config.ts` as the single source of
    copy.
- **Opt-in Google Analytics 4** (`NEXT_PUBLIC_GA_MEASUREMENT_ID`).
  - Nothing loads before the visitor clicks Allow, and GPC, DNT and automated
    browsers are never asked.
  - Consent Mode v2, with the query string stripped from page URLs.
  - Content-free events only. Setup checklist:
    `docs/operations/analytics-runbook.md`.
- Privacy controller and contact from `NEXT_PUBLIC_PRIVACY_CONTROLLER` and
  `NEXT_PUBLIC_PRIVACY_EMAIL`.

### Changed
- The Playground generates 4–6 sections, 3 levels deep (was 32–56, 6 deep).
- Tab can leave the formatting toolbar (WCAG 2.1.2).
- Embedded images are downscaled in the browser to
  `NEXT_PUBLIC_MAX_EMBED_IMAGE_BYTES` (default 256 KB).

### Security
Fixes from a full OWASP review in which each finding was confirmed by two
independent reviewers (3 high, 5 medium, 7 low):
- `global-tabs-*` test documents are only accepted with
  `HOCUS_ALLOW_ISOLATED_TABS_DOCS=1` (dev and tests); system documents are
  size-capped.
- The shared tab list is sanitized on every client read and repaired on the
  server.
- Size is enforced on incoming updates. Frame size, backpressure and awareness
  state are capped.
- Connections are counted only once established. Sockets are capped per IP and
  in total, upgrades are rate-limited, and unauthenticated sockets time out.
- `HOCUS_ALLOWED_ORIGINS` origin allowlist; deleted documents are tombstoned
  against resurrection.
- Code block languages are validated (`SafeCodeBlock`).
- A `Permissions-Policy` header; JSON-encoded Hocuspocus logs; structured abuse
  events.
- The dependency-refresh workflow runs without a write token, and its actions
  are pinned to SHAs.

### Deploy
- Set `HOCUS_ALLOWED_ORIGINS` (already in `ecosystem.config.cjs`).
- Back up the database and remove stray `global-tabs-*` rows.
- Click Regenerate on the Playground after deploying.

## 2026-11-09 · #6 Hocuspocus 4

### Changed
- Hocuspocus 4 on `Bun.serve`, with `bun:sqlite` persistence in the Hocuspocus
  process and better-sqlite3 13 on Node.

## 2026-11-09 · #5 Trailing paragraph

### Fixed
- The trailing node appends a paragraph instead of an empty heading.

## 2026-11-09 · #4 Tooling

### Changed
- Biome skips files ignored by git, and the extension refresh workflow runs on
  Node 24 actions.

## 2026-11-08 · #2 Trusted proxy

### Security
- Forwarding headers are trusted only with `TRUSTED_PROXY=1`, so clients can no
  longer spoof their IP to dodge per-IP limits.

## 2026-11-08 · #1 docs.plus editor extensions

### Added
- The `@docs.plus/extension-*` packages: Hyperlink, InlineCode, Indent,
  Placeholder, Mermaid and HyperMultimediaKit. Stored `link` and `code` marks
  are renamed on load.
- The Playground showcases the extensions, Mermaid diagrams and charts.
- A workflow refreshes the extensions every three days and opens a pull
  request.

### Changed
- All dependencies were updated to their latest versions, and the CSP allows
  the media embed providers by exact host.

### Fixed
- Heading fold animations finish after the editor remounts, tab import keeps
  the last active tab, and the TOC marks the active entry.

## 2026-03-16 – 2026-03-21 · Testbed baseline

The foundation these releases build on (see `docs/plans` and
`docs/brainstorms`):
- title-first schema;
- heading fold, drag, filter and scale extensions;
- TOC sidebar with drag-and-drop section moves;
- synced tabs with reorder and close-all;
- collaboration carets and user identity;
- shadcn/ui migration;
- abuse guardrails and retention purge;
- optional Redis and PM2 runtime;
- unit, e2e, soak, stress and Yjs load test layers.
