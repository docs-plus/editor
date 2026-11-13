# Changelog

All notable changes to TinyDocy. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). TinyDocy is deployed
continuously from `main`, so entries are grouped by merged pull request rather
than by version number. Each entry lists anything an operator has to do when
deploying it. Tagged releases (`vX.Y.Z`, from v0.1.0) bundle the entries merged
since the previous tag.

## [Unreleased]

### Smart toolbar schema (PR C, release N+1)

Release N+1's data layer for the smart toolbar. No toolbar UI. Merge and
deploy **only after the N+1 ship gates pass** (runbook: ≥ 95% `schema=2` over
24 h held ≥ 48 h, the refused-client and mixed-version soaks, the staging
drill).

#### Added
- **`textColor` and `fontSize` marks** (`extensions/text-style-marks/`):
  standalone, inclusive like bold, one token attribute each (`color`: the ten
  palette names; `size`: `xs sm lg xl`, the default size has no mark). They
  render only `data-text-color` / `data-font-size` for a known token, never
  inline style; anything else renders as plain text.
- **Commands for the toolbar:** `setTextColor`, `unsetTextColor`,
  `setFontSize`, `unsetFontSize`. Each is one transaction, an empty selection
  sets a stored mark, and an invalid token returns false. `setFontSize`
  refuses headings and the title.
- **Appendix A palette** in `extensions/text-style-marks/text-style-marks.scss`
  for light and dark, with a contrast test (text ≥ 4.5:1 on the page, page
  text ≥ 7:1 on every highlight) and a test that the SCSS matches
  `lib/text-style-tokens.ts`. Palette text on a palette highlight is often
  below 4.5:1 (77/100 light, 49/100 dark pairs): an open decision for PR D
  (spec Appendix A), with the failing set pinned in the palette test.

#### Changed
- **Highlights store tokens:** `setHighlight` / `toggleHighlight` accept a
  palette token or the release N `var(--tt-color-highlight-X)` form (stored as
  the token X) and refuse anything else, so the old "Default background"
  swatch is a no-op. `toggleHighlight()`, Mod-Shift-H and `==x==` now use
  yellow instead of an invisible mark; Mod-Shift-H on any highlight removes it
  in one press. Toggling and the popover's pressed state compare tokens
  (`activeHighlightToken`), so a legacy value counts as its token.
- **Hocus can rewrite stored legacy highlight colours** to their token on
  load (`afterLoadDocument`, alongside the `link`/`code` rename in
  `lib/yjs-mark-migration.ts`); tokens and unknown values are left alone.
  Off by default (`HOCUS_REWRITE_LEGACY_HIGHLIGHTS=1` turns it on): release
  N's popover compares raw values, so on a rewritten highlight N tabs would
  show no pressed swatch and need two clicks to remove it.
- **Paste keeps only our own styling:** our `data-text-color`,
  `data-font-size` and `data-highlight` (and release N's `data-color`) survive
  a paste between tabs; foreign colour, font size and background (Google Docs,
  Word, any `<mark>` without a token) paste as plain text. The Docs and Word
  tests use synthetic clipboard fixtures, not checked against a real
  clipboard.
- **Sizes stay out of headings:** a local edit that puts `fontSize` in a
  heading or the title (turning a sized paragraph into a heading, paste, drop)
  drops the size in the same undo step; sized text that reaches a heading
  remotely renders at the heading's size.

#### Security
- **Client schema floor in code:** `SCHEMA_FLOOR = 2`
  (`lib/security/client-schema-gate.ts`). Hocus enforces
  `max(HOCUS_MIN_CLIENT_SCHEMA, 2)`, so the gate is never log-only again and
  the env can only raise it. The startup line prints the effective minimum.
- **Ingress allowlist:** `textColor` and `fontSize` are allowed (this
  release's server half). Unknown names are still refused with 4422.

#### Deploy
Only after the N+1 ship gates pass, at low traffic. Hocus runs TypeScript from
source and the running `next start` keeps serving its existing `.next` until
it restarts, so pulling without building puts the server half live first.
1. In the live checkout: pull, then `bun install --frozen-lockfile` (no
   dependency changes in this release). **Do not build yet.**
2. **Restart Hocus first:** `bunx pm2@6.0.14 restart editor-hocus --update-env`.
3. **Confirm** `[hocus] client schema gate: min=2 (floor 2, env 0)` in its log,
   and within a minute a `client_schema` line: `ok` counts release N clients,
   `refused` counts any pre-N bundles (`client_outdated`; 0 is fine if none
   are left).
4. **Then build in a second checkout and swap it in.** Do not build in the
   live checkout: measured on spare ports (contract §2.3 builder check), an
   in-place `next build` under a running `next start` made the probed chunks
   return 500 for a moment during the build, and every changed chunk return
   500 from then until the restart while the old HTML still points at it, so
   pages that need a changed chunk fail (about 3 s locally with a warm
   Turbopack cache; longer on the live host). A `.next` built in another
   checkout and moved in served every page and chunk after the restart
   (checked locally, not on the live host). From `/opt/projects/editor.docs.plus`:
   ```sh
   git worktree add --detach ../editor-build HEAD
   cp .env.production ../editor-build/   # build-time NEXT_PUBLIC_* values
   (cd ../editor-build && bun install --frozen-lockfile && bun run build)
   rm -rf .next.prev && mv .next .next.prev && mv ../editor-build/.next .next \
     && bunx pm2@6.0.14 restart editor-next --update-env
   git worktree remove --force ../editor-build
   ```
   The floor and the allowlist are already live, so no N+1 bundle exists
   before the server half. Only the second between the `mv` and the restart
   can serve a missing chunk. To roll Next back, swap `.next.prev` back the
   same way; delete it once N+1 is healthy.
5. **Later, once release N tabs are gone** (the `client_schema` line's
   `builds` shows only the N+1 build id for a day), add
   `HOCUS_REWRITE_LEGACY_HIGHLIGHTS=1` to the Hocus env and restart it with
   `--update-env` at the next routine restart. It only tidies stored values;
   N+1 reads both forms.
6. Leave `HOCUS_MIN_CLIENT_SCHEMA` unset. **Never roll back below release N,
   and never lower the floor.** Before rolling Hocus back below this release,
   roll Next back first and set `HOCUS_MIN_CLIENT_SCHEMA=2` (release N's code
   has no floor); N+1 tabs still open then get 4422 on the new marks until
   they reload. See the runbook.

### Added
- **Toolbar accessibility tests:** `@axe-core/playwright` (dev dependency), an
  axe sweep of the toolbar in seven editor contexts and three open popups in
  light and dark (`toolbar-a11y.spec.ts`, WCAG 2.2 AA including target size),
  the toolbar behaviour spec (`toolbar.spec.ts`), and a typing-budget
  assertion in `performance.spec.ts` (p95 with the toolbar within 10% of
  toolbar off, per-keystroke timer, `PERF_ROUNDS` default 5).
  `E2E_BASE_URL` overrides the Playwright base URL.
- **Rollout safety for the smart toolbar (release N).** Lets later releases
  add new marks and nodes without corrupting older clients: a client that
  meets a name it does not know freezes the document read-only by design and
  asks for a reload, and never deletes it. See
  `docs/operations/schema-rollout-runbook.md`.
  - **Client version gate, log-only:** `HOCUS_MIN_CLIENT_SCHEMA` (default 0,
    no floor yet). Hocus logs per-minute `client_schema` counts and refuses
    nothing until an operator raises it.
  - **`schema` and `build` socket parameters** sent by the client
    (`NEXT_PUBLIC_BUILD_ID`, default the git short SHA).
  - **Ingress name allowlist:** updates that introduce a node or mark name
    outside the schema (current names plus legacy `link`/`code`), or put
    anything but an element at the top of a document, are refused: Hocus
    closes that document's connection with 4422 (`schema_rejected`, logged
    as `ws_unknown_schema_name`) and the client does not reconnect. The
    toolbar's `textColor` and `fontSize` are refused until the release that
    ships them deploys its server half first.
  - **Freeze on unknown, repair on misfit:** the editor goes read-only on an
    unknown schema name or an outdated client and shows a notice (outdated:
    reload, device copy kept; Reload waits at most 2 s for the copies). Any
    misfit of known names is fitted to the schema instead (a missing title,
    an emptied document, a top-level list item or hard break, a list holding
    a bare paragraph), so one raw write cannot lock a document; a failed
    repair shows a banner and sends `schema_repair_failed`.
  - **Offline `~s2` namespace** for device copies, with a transactional merge
    of legacy copies (the legacy key is deleted only after a successful
    save; IndexedDB writes now settle on commit). Saves and removals of one
    document run in order, so a merge still in flight when its tab closes or
    the document is deleted never writes the copy back, and a removal drops
    every later save of a session opened before it (one still flushing on
    release, which a tab close cannot reach, or one connected without its
    copy after the hydrate timeout).
  - **Token-aware highlight rendering** (attribute key stays `color`) and a
    teal highlight variable. The playground seed uses tokens.
  - **Schema snapshot test** and **schema rollout runbook**.
  - Hocus servers spawned by tests (`spawnHocus()`) no longer outlive an
    interrupted test run.
- **Smart toolbar design** (`docs/superpowers/specs/2026-11-12-smart-toolbar-design.md`):
  sorted toolbar, colour and font-size tokens, a memory layer that remembers
  your choices, a context slot, responsive tiers, and a five-PR rollout with
  a client version gate. The research sources and rollout experiments sit
  alongside it. Docs only, no runtime change.

### Changed
- **Typing budget runs on its own:** `performance.spec.ts` moved to a `perf`
  Playwright project (one worker, starts after `chromium`). CI and
  `make test-e2e` run `--project=chromium --project=perf`; `make test-perf`
  runs `--project=perf --no-deps`.
- **Toolbar updates catch up within 1 s** (`TOOLBAR_MAX_WAIT_MS`) during
  continuous remote edits, such as a collaborator typing without pause; local
  typing still waits for a pause, so it never forces a toolbar commit.
- **Toolbar controls derive visibility in render,** so they hide at once when
  a document turns read-only, and per-keystroke listener work is gone.
- **Highlights with an unknown value render as plain text:** a highlight
  whose value is not a known token (old hex highlights, the old "Default
  background") renders without an inline style. Stored values are untouched.
- `.gitignore` ignores `.claude/launch.json`, the local preview config.
- **Nightly runs twice a day:** 03:41 UTC (night) and 08:00 UTC (morning).
- **docs.plus extension refresh runs daily** at 04:17 UTC instead of every
  three days. `bunfig.toml` still holds back releases younger than 3 days.

### Fixed
- **Focus outline and pressed underline on every button:** `Button`
  (`components/ui/button.tsx`) draws a 2px solid focus outline and, while
  `aria-pressed` is true, a short centred underline (12px wide, 2px tall, 3px
  above the bottom edge, at least 3:1), so the new look applies app-wide, not
  only in the toolbar. Both stay visible in dark mode and in Windows High
  Contrast (forced colours, where the underline uses `HighlightText`).
- **Disabled toolbar controls stay focusable** and say why they are disabled.
- **Style and list menus are named by value** ("Normal text", "No list") and
  use radio items; picking the checked item does nothing. They close after a
  pick and return focus to the editor at once, so the next keystroke lands in
  the document.
- **Text styles are disabled in the title,** with the reason "Title is
  always H1"; the style button still reads "Title".
- **Highlight swatches are named pressed buttons** in a dialog. Focus stays
  in the dialog, Esc returns it to the Highlight button, and toolbar arrow
  keys move from whichever control has focus.
- **Switching list type keeps the whole list:** bullet, ordered and task
  lists convert in place in one undo step, keeping every item and nested
  lists (task checked state stays only in lists that remain task lists).
  Before, only the caret's item moved to the new list and the rest became
  paragraphs.
- **"No highlight" keeps focus in the highlight dialog,** so Esc still
  returns focus to the Highlight button.
- **Typing stays in the editor after arrowing in the toolbar:** a later
  toolbar re-render no longer pulls focus back to the last arrowed control.
- **Indent and outdent buttons work in lists,** like Tab.
- **Headings and the caret stay clear of the sticky toolbar.**
- **Focus no longer drops to the page** when a toolbar control disappears.
- **Undo no longer wipes a new document:** the empty-document seed is kept
  out of the undo history.
### Security
- **Top-level content can no longer lock a document:** content other than an
  element directly in a document's editor fragment made y-tiptap throw before
  the client repair could run, so no client could open that document and open
  editors could later overwrite it from a stale view. Ingress refuses it when
  it can place it, but a client could slip it past by sending it before the
  block it follows (and before this release, with a single update). Hocus now
  deletes such content after every change to the fragment's top level, in the
  same broadcast that delivers it whatever its size (Hocuspocus no longer
  flushes its broadcast queue early at 1 MiB), and cleans stored documents
  when they load (`editor_root_swept` abuse event, at most one line per
  document per minute plus a count).
- **Size-cap bypass closed:** the update-size guard decoded frames by hand
  and could be bypassed with SyncReply frames or padded varints. It now
  decodes with lib0 exactly as Hocuspocus does, so the cap and the new name
  allowlist see every update.

### Deploy
1. Pull, `bun install --frozen-lockfile`, then `bun run build`.
2. Restart Hocus first: `bunx pm2@6.0.14 restart editor-hocus --update-env`.
   Confirm `[hocus] client schema gate: min=0 (log only)` in its log.
3. Then restart Next: `bunx pm2@6.0.14 restart editor-next --update-env`.
4. Leave `HOCUS_MIN_CLIENT_SCHEMA` unset. Read the `client_schema` counts.
5. From now on, never roll back below this release, and never lower the gate
   once raised (see the runbook). `NEXT_PUBLIC_BUILD_ID` is optional.

## 2026-11-11 · #23 Unit tests on bun test, advisory gate in CI

### Changed
- **Unit tests on `bun test`:** Bun's test runner with a happy-dom preload
  (`tests/setup.ts`) replaces Vitest. `bun run test` takes about 8 s,
  against 9–12 s with Vitest; the stress probe runs on its own
  (`test:stress`). Module mocks use `mock.module()` and `await import()`,
  and modules that read env at import time load through `importFresh()`.
  Make targets write JUnit XML to `test-reports/`.
- **Load harness:** clients use Bun's built-in `WebSocket`.

### Added
- CI fails on high and critical advisories (`bun audit --audit-level=high`).

### Removed
- `vitest`, `jsdom`, `@vitejs/plugin-react`, `ws` and `@types/ws`.

### Deploy
- Pull, build and restart as usual.

## 2026-11-11 · #21 Bun runtime everywhere, one SQLite driver

### Changed
- **Bun runtime everywhere:** `bunfig.toml` `[run] bun = true` runs Next.js
  (dev, build, start), Vitest, ESLint, Playwright and commitlint on Bun
  instead of Node. Node.js is no longer needed. Bun 1.4.4 or later is
  required (`.tool-versions`, `engines`, `packageManager`).
- **One SQLite driver:** the documents API, the retention script and the
  tests use `bun:sqlite` through `openSqlite()` in `lib/sqlite-open.ts`,
  like Hocuspocus already did. The app `tsconfig.json` now uses Bun types,
  so `tsconfig.hocus.json` is gone.
- **CI:** workflows no longer install Node. After install, CI puts a failing
  `node` stub on `PATH`, so anything that falls back to Node fails the run.
  Plain `bunx` ignores `[run] bun`, so workflows, git hooks and scripts call
  local tools as `bun <bin>` (`bun playwright test`, `bun lint-staged`).

### Removed
- `better-sqlite3` and `@types/better-sqlite3` (native addon).

### Deploy
- Upgrade Bun on the server to 1.4.4 or later **before** pulling
  (`bun upgrade`; check with `bun --version`). This change is tested and
  pinned on 1.4.4.
- Then `bun install --frozen-lockfile`, `bun run build` and restart the apps
  as usual. They run on Bun because `bunfig.toml` sits in their working
  folder.
- Optional: to move the PM2 daemon itself off Node, run
  `bunx --bun pm2@6.0.14 kill` and then
  `bunx --bun pm2@6.0.14 start ecosystem.config.cjs` (and `save` if you use
  a saved process list).
  After that, Node can be removed from the server.

## 2026-11-11 · #20 Brand favicon, dependency updates

### Fixed
- **Favicon:** `/favicon.ico` was still the Create Next App default, so
  browser tabs, bookmarks and other clients that ask for it showed the wrong
  icon. It now holds the brand "T" mark at 16, 32 and 48 px, generated from
  the same `BrandMark` as `app/icon.tsx` by `scripts/generate-favicon.tsx`
  (run `bun scripts/generate-favicon.tsx` after changing the mark).

### Changed
- **Dependencies:** `@docs.plus/extension-*` 2.2.0 → 2.3.0, Tiptap 3.33.0 →
  3.33.1 (`@tiptap/y-tiptap` 3.2.0 → 3.3.0), Next.js and
  `eslint-config-next` 16.4.5 → 16.4.6, `lucide-react` 1.72.0,
  `react-hotkeys-hook` 5.4.0, `@vitejs/plugin-react` 6.3.0, `sass` 1.108.2.
  Installed ahead of the 3-day `minimumReleaseAge` window on purpose (the
  guard in `bunfig.toml` is unchanged). TypeScript 7 is left for its own
  change.

### Deploy
- Pull, build and restart as usual.

## 2026-11-09 · #18 README badges, release workflow, testing docs

### Added
- **README badges:** CI and nightly status, latest release, license, live
  demo, docs.plus links (website, source, npm extensions, Discord) and the
  stack.
- **Releases:** pushing a `v*` tag publishes a GitHub release
  (`.github/workflows/release.yml`) with the pull requests merged since the
  previous tag and a link to this file. The first tag is `v0.1.0`.

### Changed
- The workflow-rules test allows a workflow without actions (the release
  workflow only runs `gh`) and checks once across all workflows that the
  action parser still finds some.
- `tests/TESTING.md`, the repo-conventions skill and `AGENTS.md` describe the
  current test layout, CI and nightly runs, the server-sync wait in e2e
  helpers and the resize-gripper exception.

## 2026-11-09 · #16 Caret after Enter, nightly tests, CI for update PRs

### Added
- **Nightly workflow** (`.github/workflows/nightly.yml`, 03:41 UTC and on
  demand) for the layers CI skips: the `pwa` project against a production
  build, the Yjs and quick multi- and single-user soaks, and the load
  harness (100 clients, distributed and conflicting edits).

### Fixed
- **Typing right after Enter or a heading shortcut no longer scrambles the
  text.** Chromium misplaces the caret when a character is typed into a
  block whose content `content-visibility: auto` (added in #12) is still
  skipping, such as one just created: "marker" became "arkerm". The block
  holding the caret now stays rendered (`CaretBlockVisible`,
  `extensions/render-once/`). Reproduced without TinyDocy in a plain
  `contenteditable`; with the fix, stress runs that failed 23–60% of the
  time pass, and switching it off brings the failures back. This was the
  real cause of the e2e caret races #15 worked around, so the tests' caret
  waits (`settleCaret`) are removed again.

### Changed
- **Extension update PRs run CI.** Pull requests opened with the workflow
  token start no workflows, so the scheduled `@docs.plus` update PR would
  wait forever on the required CI checks. The update workflow now starts CI
  on its branch (`gh workflow run`, the documented exception).
- The soak's filter journey and bot used a class that no longer exists, so
  they never filtered; they find the input by its label again. `openFilter`
  leaves an open bar alone.

### Deploy
- Pull, build and restart as usual. Start the first nightly run from
  Actions → Nightly → Run workflow if you want results before 03:41 UTC.

## 2026-11-09 · #15 Image resize handles, e2e races

### Fixed
- **Image resize handles appear on the image again.** A host rule made every
  top-level editor child `position: relative`, including the media
  extension's resize gripper, so its handles were drawn below and beside the
  hovered image (wherever the gripper sat in the document flow). The rule now
  skips the gripper.

### Changed
- **E2E tests no longer race the editor.**
  - Helpers wait for the server's first sync before editing (the editor is
    editable earlier, from the device copy); the editor region carries
    `data-server-synced` for them.
  - `buildDocument` puts the caret in the title through the editor;
    `openFilter` no longer closes a bar the shortcut just opened;
    `typeInNewParagraphAtEnd` replaces three copies.
  - The Mod-K test waits for the shift-arrow selection; the offline banner
    test waits for a full reconnect before testing that the banner returns.

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
