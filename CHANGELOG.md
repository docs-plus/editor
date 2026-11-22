# Changelog

All notable changes to TinyDocy. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). TinyDocy is deployed
continuously from `main`, so entries are grouped by merged pull request rather
than by version number. Each entry lists anything an operator has to do when
deploying it. Tagged releases (`vX.Y.Z`, from v0.1.0) bundle the entries merged
since the previous tag.

## [Unreleased]

### Phones M20: one keyboard measurement, sheets ride the keyboard

The on-screen keyboard is measured once for the whole page (phones and
tablets design §4.6, §6.4, §6.5, PR M20). Phones only: desktop subscribes to
nothing and renders the same. The editor chunk group is unchanged (393,820 B
gz, 0 B against `main` at `903b5c8`, 1,207 B under the fence); everything
lives in the phone bar's lazy chunk.

#### Added

- **Phones:** `lib/keyboard-inset.ts`, one `visualViewport` listener set
  shared by every subscriber and removed with the last one. While anything
  subscribes, `<html>` carries `--keyboard-inset` and
  `--visual-viewport-height`, written at most once per frame.
- **Phones:** bottom sheets ride the keyboard by default: they sit on
  `--keyboard-inset` and never grow past the visual viewport, so a field in
  a sheet stays above the keyboard (iOS Safari and Android Chrome). A
  caller caps the height with `[--sheet-max-h:…]`, which keeps that cap. A
  sheet with no field passes `keyboard={false}`; the Aa sheet does, so it
  looks and moves exactly as before.
- **Phones:** after a rotation (or an iPad window resize below 768 px) the
  caret is scrolled back into view once, if you were writing. No
  transaction steps, so no Yjs traffic or undo entry.
- **Tests:** the hidden-page flush starts in the `visibilitychange` task
  (sandbox device copy) and a library `flush()` appends at once and never
  compacts; a leak spec checks the listener set leaves with the bar.

#### Changed

- **Phones:** `hooks/use-keyboard-inset.ts` moved into
  `lib/keyboard-inset.ts`; the phone bar reads the shared store.
- **Docs:** the awareness rate check (§6.5): carets are sent on every
  selection change, not at most every 100 ms; the throttle is an open owner
  decision. Moving the slash menu's own `visualViewport` listener onto the
  store is follow-up row M20a; the old plans now point at
  `lib/keyboard-inset.ts`.

#### Fixed (review)

- **Phones:** a rotation and a blur in the same frame no longer cancel each
  other: the viewport events and the focusout share one task, which applies
  the reset or measures and then always checks the width, so the caret still
  comes back into view. A viewport scroll in that frame no longer cancels
  the iOS drift reset.
- **Phones:** the Aa sheet no longer mounts on the keyboard and drops a
  frame later when opened while writing; it stays on the screen bottom.
- **Phones:** the phone bar scrolls the caret on mount and unmount only when
  the width moved, once per frame: not twice under StrictMode, not on an
  editor switch, and still on the first mount, so a page loaded in landscape
  and rotated to portrait gets its caret back.
- **Tests:** the leak spec counts `visualViewport` and `document` listeners
  against a bar-less baseline instead of matching source names, so it works
  on minified builds and also catches a leaked `focusout`.

### Image store A1: the shared asset core

The shared core of the image store (spec `2026-11-16-image-store-design.md`,
D4, PR A1). Library documents will store `asset:sha256-<hex>` refs instead of
data URLs; desktop storage (P2.6b) and the web library (W11) build on this.
No web code path produces a ref yet, and the public sandbox is unchanged:
its editor imports none of this. The editor chunk group and first-load JS
are byte for byte the same as `main` at `84a9458` (+0 B gz; A1 has no D23
ledger line).

#### Added

- **Image store:** `lib/assets/`:
  - `asset-ref` (format, parse, `findAssetRefs`, `rewriteAssetRefs` for
    exports);
  - `sniff` (magic bytes, plus header-only sizes: refuses SVG renamed as
    PNG, mismatched types, truncated headers and pixel bombs);
  - `hash` (SHA-256);
  - `prepareImageAsset` (the insert pipeline: GIFs pass through without
    their comments and XMP, within 2560 px a side, 1,000 frames and 160 MP
    summed over frames; PNG and WebP metadata stripping; JPEG always
    re-encoded; a 2 MB / 2560 px cap; a format whose size the header doesn't
    give, such as AVIF, HEIC or BMP, decodes only in the worker);
  - an encode worker (`createImageBitmap` + `OffscreenCanvas`) that falls
    back to the main-thread canvas when it can't load or times out (60 s),
    but never retries an image that crashed it. A 12 MP photo encodes with
    the main thread's longest gap at 11 ms, against 75 ms on the main
    thread (Chromium);
  - the resolver, and a reference-counted object-URL cache released through
    `AbortSignal`.
- **Platform:** the `BlobStore` port (`lib/platform/blob-store.ts`) over
  format 2's `blobs` and `doc_blobs` tables (no new tables), `MemoryBlobStore`,
  and a framework-free contract suite for P2.6b and W11
  (`tests/helpers/blob-store-contract.ts`), including the GC property test:
  no referenced or restorable blob is ever collected.
- **Editor:** `AssetHyperMultimediaKit` (`extensions/hyper-multimedia/asset-kit.ts`)
  for hosts with an image store (P2.6b, W11). It renders `asset:` images
  through the §6.2 fallback until HyperMultimedia 2.4 (U1), drops pasted
  `asset:` images with a notice when the document has no image store, adds
  Alt text… to the image toolbar, copies an image as PNG (so it pastes as a
  picture anywhere), and keeps `<img alt>` in step with alt changes,
  including undo and collaborators' edits. Everything but its
  routing is one lazy chunk. The upstream request is written up in
  `docs/research/2026-11-22-hypermultimedia-2.4-u1-upstream-note.md`.
- **Headless:** `extensions/hyper-multimedia/asset-image-parse.ts`, the
  `asset:` image parse rules with no runtime imports, for the headless
  schema (P2.8a).

#### Changed

- **Schema:** `CLIENT_SCHEMA` is 3 ("knows asset refs"). The server's floor
  stays 2, so schema-2 bundles still connect and are counted as `low` in the
  per-minute `client_schema` log line. No deploy step.

### Live sharing P4.1 and P4.2a–d: the share server, dark

The server side of live sharing, in the Hocus process, shipped **dark**:
`HOCUS_SHARES` and `HOCUS_DELETE_ROUTE` default to off, and with both off
production behaves as before. The only visible difference is that
`/api/info`, `/api/shares…` and `/api/documents/…` on the Hocus host answer
404 instead of the health check's `ok`. No client code changes (editor chunk
+0 B).

#### Added

- **Sharing (P4.2a):** `lib/sharing/`, with these parts:
  - the `shares` table, created only when shares are on;
  - the `share:<uuid v4>` name validator, which also refuses the reserved
    `sync:` prefix (seam S6b);
  - no auto-create: a share document needs its row;
  - `MAX_TOTAL_SHARES` (2,000), counted apart from `MAX_TOTAL_DOCUMENTS`;
  - per-address (IPv4, IPv6 /64, and a larger shared budget per /48) and
    global hourly creation limits;
  - a share that stays `pending` for an hour stops counting toward the cap
    and is ended as `expired` on first contact;
  - each hash column is unique, so a create or reset that reuses a hash
    answers `409 hash_in_use`;
  - `created_ip_hash` (an HMAC), cleared 30 days after creation by an
    hourly sweep.

  The client generates every secret. The server mints only `share_id` and
  stores three distinct 32-byte SHA-256 hashes (seam S1). The token wire
  format is frozen in `lib/sharing/share-token.ts`, with test vectors.
- **Sharing (P4.2b):** `onAuthenticate` for `share:*`, active only with
  shares on. It looks up the row by `share_id`, compares with
  `timingSafeEqual`, and treats a view token as `readOnly`.
  - An unknown share, a wrong token and a share over its failed-token
    limit get the same refusal (`share_unavailable`, byte for byte), and an
    unknown share costs the same digest comparisons. Only token holders
    learn `sharing_stopped`, `link_reset`, `expired`, `removed` or
    `view_only`.
  - Failed tokens are counted per IPv4 address, IPv6 /64 and /48 (past the
    limit the address gets `busy`) and per existing `share_id` (past the
    limit its edit and view tokens are refused too, never its owner
    secret). Both tables evict their least recently used key when full,
    so neither stops counting nor refuses an address it has not seen.
    Clients must retry `share_unavailable` with backoff, never treat it as
    terminal.
  - A connection that joins while its share is stopped or made view-only
    is closed once connected.
  - A share ends 30 days after its last stored edit.
  - Viewers are marked in awareness (`viewer: true`, no cursor).
  - Share connections have their own per-IP cap
    (`SHARE_WS_CONNECTIONS_PER_IP`, 10, refused as `busy`), apart from the
    sandbox's cap.
  - Shares never get `document_activity` rows, so the sandbox retention
    purge never touches them.
- **Sharing (P4.2c):** owner endpoints, which need the owner secret as
  `Authorization: Bearer`:
  - `DELETE /api/shares/:id` (stop sharing)
  - `POST …/reset` (a new `share_id` from three new hashes; the old link
    ends as `link_reset`)
  - `POST …/view-only`

  Each closes the share's live connections. `GET …/status` takes any token
  of the share. CORS is limited to `HOCUS_SHARE_ORIGINS`. A mutation from
  any other `Origin` is refused. Bodies are JSON only, small, and unknown
  keys are refused. The endpoints are rate-limited per address and per
  IPv6 /48 (owner calls only per address, once the address is under its
  failed-token limit), before the origin check.
  `lineage` is a dashed UUID or 32 hex digits.
- **Sharing (P4.2d):** `GET /api/info` returns `apiVersion` 1,
  `serverVersion`, the schemas, `maxDocBytes`, `maxFrameBytes`, `yjsFormat`
  and `features.shares`. Share connections and creates require client
  schema ≥ 3 (`SHARE_SCHEMA_FLOOR`). `HOCUS_SHARES=on|readonly|off` is the
  kill switch.
- **Hocus (P4.1):** `DELETE /api/documents/:id` in the Hocus process
  (`lib/security/hocus-delete-route.ts`), behind `HOCUS_DELETE_ROUTE=on`.
  It keeps the Next.js route's contract and also refuses `share:*` and
  `sync:*` names. The Next.js route stays the live one; a test pins that it
  refuses those names too.
- **Tests:** unit tests for the config defaults, the token format, the
  store, the auth refusal matrix and the HTTP API. Hocus integration tests
  (`tests/unit/scripts/hocus-shares.test.ts`) cover:
  - dark by default;
  - edit and view tokens, guesses and the schema floor;
  - viewer awareness;
  - stop and view-only;
  - the separate share connection cap;
  - the server never receiving, storing or logging a raw link secret.

#### Changed

- **Security:** `readJsonBody` and `withBusyRetry` moved to
  `lib/security/json-body.ts`, so Hocus doesn't import `next/server`.
  `http-route-guards` re-exports them.
- **Security:** `countNonSystemDocuments` skips `share:*` names.

**Deploy:** nothing to do. Leave `HOCUS_SHARES` and `HOCUS_DELETE_ROUTE`
unset. Turning P4.1 on later is its own step: route `DELETE
/api/documents/*` on `tiny.docs.plus` to Hocus in Traefik, set
`HOCUS_DELETE_ROUTE=on`, restart with `--update-env`, and run the close-tab
e2e suite on staging. Shares stay off until Gate 4.
### CI: sharded e2e, a perf job, one gate check, docs-only skip

The Playwright suite runs in parallel, so CI on a pull request or `main`
takes about 7.5 minutes instead of about 27 (median of the last five green
`main` runs, 19.7 to 31.6 min). Required check names are unchanged.

#### Changed

- **CI:** the `chromium` and `library` projects run in three shards
  (`Playwright shard N/3`, `--retries=1`, about 6 min each; every shard
  starts the library's Bun harness), and the typing budget in its own
  job on its own runner (`Playwright perf (typing budget)`, `--no-deps`, one
  worker, about 5 min).
- **CI:** `Playwright (Chromium)`, the required check, always runs. It merges
  the shards' and perf's blob reports (failures are annotated at their file
  and line; the HTML report is uploaded on failure) and passes only if all
  of them passed.
- **CI:** a pull request that changes only `docs/**` or Markdown files (none
  under `desktop/**`) skips the shards, perf and the `desktop` job, and
  `Playwright (Chromium)` passes with a notice. Pushes, the merge queue and manual runs always run
  everything.
- **Tests:** `tests/unit/ci/ci-workflow.test.ts` checks the shards, the
  gate's `needs` and `if`, and runs the docs-only and verdict scripts.

**Deploy:** none. Each CI run now uses about seven jobs instead of two; the
merge queue's build concurrency (runbook) is set with that in mind.

### Hover-preview pixel test no longer races the swatch's leave timer

`action-preview.spec.ts`'s "previews exactly what applying renders" cases
(the table header ones most often) failed about 40% of runs locally and on
both attempts of some CI runs. Moving the pointer off the swatch schedules the
preview's clear after the 80 ms dwell; applying had already removed the
preview, so the test drew its own "applied" render before that clear ran,
and the clear erased it mid-capture (the blurred selection's tint then showed,
about 900 pixels). Test only; no app or Deploy change.

#### Fixed

- **Tests:** before drawing the applied render, the test waits for a page
  timer of the same dwell (`PREVIEW_DWELL_MS`), which fires after the
  pending clear. 40 repeats: no pixel failures (11 of 24 before).

### Nightly back to green: offline shell, palette budget, soak

The nightly had failed on every run since 2026-11-16. Three independent
causes: two fixed in the app, and the soak's filter journey now judges
commands apart from typing (owner's decision).

#### Fixed

- **Offline:** a document is saved on the device at its first server sync,
  not 750 ms later. The tab list could already be on the device, so a reload
  offline in that window showed the tab bar over an editor that never
  loaded, with no message (the nightly's flaky "offline shell" test).
- **Offline:** files a first visit loads before the service worker controls
  the page (the editor chunk among them) are now stored in its static cache:
  the page hands the worker its loaded `/_next/static` URLs once it takes
  control, and then any that were still in flight then (files that did not
  pass through the worker, `workerStart` 0). Before, offline reopening relied
  on the browser's HTTP cache; with that evicted it showed "Something went
  wrong" instead of the editor.
- **Palette:** the first Alt+/ loads 13.4 KB gz again (contract A7: 20 KB),
  down from 24.4 KB. The identity dialog's own chunk (#126/#129) moved the
  shared `Dialog` out of the first-load bundle, so the palette now fetches
  it; that tipped a palette already at 20,475 B. The fix removes dead weight
  instead: cmdk builds its unused `Command.Dialog` from Radix Dialog at module
  level, so all of Radix Dialog (focus scope, dismissable layer, scroll lock)
  rode in the palette chunk. `@radix-ui/react-dialog`, which only cmdk
  depends on, is aliased to a stub (`lib/cmdk-radix-dialog-stub.ts`).

#### Changed

- **Tests:** the `pwa` offline tests clear the browser's HTTP cache before
  going offline, so only the service worker can serve the app; a new test
  checks that every static file the first visit loaded ends up in its cache,
  and the offline shell test waits for the device copy and asserts the
  editor's title, not any `h1` (the error page has one).
- **Nightly:** the palette budget step writes to its own output folder, so
  it no longer deletes the pwa step's traces when both fail.
- **Soak:** the `filter-lifecycle` journey judges its typing at 100 ms and
  its commands (Mod+Shift+F to open the filter bar, Enter to commit a
  filter) apart at 200 ms, INP's "good" bound. Its p95 was decided by those
  six events, each a full editor-shell re-render costing 90–170 ms under
  `next dev` on a runner, so it swung between 64 and 168 ms on one commit;
  typing stayed at 40–72 ms. Moving the filter state out of the shell is a
  tracked follow-up. Journeys log their slowest events with the step each
  fell in and its input delay, processing and presentation times
  (`tests/TESTING.md`, "Soak journeys").

### Languages L0: translation-ready foundation (docs, glossary, i18n groundwork)

PR L0 of the languages design (`2026-11-16-languages-rtl-design.md` §9),
with the unwired groundwork of L1a. Nothing in the app imports the new
modules, so the web app, its English copy and the editor chunk are
unchanged (0 B).

#### Added

- **i18n:** `lib/i18n/` with the eager `t()` (`t-core.ts`: lookup, `{name}`,
  interface locale and `dir`; client-side state, set once at boot), the
  eager direction helper (`dir.ts`: `dirOf` from the locale's likely
  script, so `ku-Arab` is right to left), the lazy ICU MessageFormat 1
  subset (`format.ts`: plural with CLDR categories, select, number, date,
  time, rich tags; `selectordinal` and nested plurals refused; its `t()`
  shows English when a translation fails to parse), BCP 47 matching and
  native names (`locale.ts`, lazy only), bidi helpers (`isolate.ts`,
  including `stripBidiControls` for filenames) and the registry render
  boundary (`registry-labels.ts`; keywords split on `,` `،` `、` `，`).
  English stays in code and needs no catalog.
- **i18n:** `bun run i18n:extract` writes `locales/en/<ns>.json` from `t()`
  calls and the action registry's labels and keywords (88 messages today,
  in `actions.json`), skips `t(` in comments, and fails on imports of
  `t-core` or `format` that would hide calls (relative paths, `t as x`,
  `import *`, re-exports, dynamic imports); `bun run i18n:check` checks
  freshness, ICU syntax, placeholders, plural categories, banned literals
  (⌘ ⌥ ⇧ ⌃, `Ctrl+`, straight double quotes), `core` simplicity (no ICU
  apostrophe escapes either), translations filed under their own
  namespace and reserved shortcuts (Shift+Space); `bun run i18n:pseudo`
  builds `en-XA` and `ar-XB` into the git-ignored `locales/pseudo/`.
- **i18n:** `tests/unit/i18n/catalog-check.test.ts` runs the check in
  `bun run test`, so **changing an action's label or keywords in
  `lib/editor-actions` now needs `bun run i18n:extract`** in the same
  commit. `editor-chunk-imports.test.ts` keeps the formatter, `Intl`
  helpers, `locale.ts` and catalogs out of the editor chunk, and pins
  `t-core` and `registry-labels` to `dir.ts` alone.
- **i18n:** `NEXT_PUBLIC_PSEUDO_LOCALES=1` lists the pseudo-locales; it is
  off by default, never set in production, and nothing reads it yet.
- **Docs:** `locales/glossary.md` (fixed terms per language, seeded from UX
  §9.2) and the L0 amendments: UX §9.4 copy rules, §4.6 RTL keyboard notes,
  §2.4 casing `select` and `.lproj`, §14 RTL checks for S1; preferences
  §5.4 RTL letter spacing, §5.13 script fallback faces, §5.15 `firefox`;
  details E9 Arabic-script and Hebrew folding and §14 `ar-XB` gallery;
  comments §11.2 sides follow the interface; toolbar contract A19.

### Web library W2: the IndexedDB storage engine (dark)

The storage core of My documents, the personal library stored in the
browser (spec `2026-11-16-web-library-design.md` §2, PR W2). It lands dark:
nothing in the web app imports it, `NEXT_PUBLIC_LIBRARY` defaults to off,
and the web build is unchanged: every JS and CSS file under
`.next/static` matches a build of `main` at `903b5c8` (apart from the
build's version string), the editor chunk group measures 393,820 B gz on
both (+0 B, 1,207 B under the fence), and no built file contains the
library. W2 is not done: `IdbDocumentIndex` is still open, and the
contract suite in three browsers and the `perf` comparison are deferred to
the CI session's Q7 job (spec §2.2, "Still open for W2").

#### Added

- **Web library:** `IdbDocStore`, the `DocStore` port over a new IndexedDB
  database `tinydocy-library` (schema version 1, every store the library
  will need, including the image store and Live seams). Every content write
  is one `durability: "strict"` transaction that settles on commit; a full
  disk or any other abort rejects with a retryable error and writes
  nothing, so the batcher keeps the batch and retries it in order.
- **Web library:** version 1 takes the desktop's format 2 data model
  (offline data-model revision §3.6): the derived `links` and `headings`
  stores, `head_seq`, `derived_seq`, `links_hash`, `headings_hash`,
  `title_key` and a numeric `stale` sentinel (`by_stale`) on documents,
  folder trash groups, snake_case `doc_blobs`, `''` for every nullable
  index key part, the `pre-v<n>` copy name, an eviction sentinel with its
  `localStorage` marker, and the `library.json` field lists
  (`lib/library-format/fields.ts`).
- **Web library:** compaction that stays safe with any number of tabs
  writing the same document (W-D3): it merges into the stored snapshot and
  deletes only the rows its own session applied, and returns another tab's
  snapshot as `foreign` for `local-session` to apply.
- **Web library:** compaction treats `foreign` as apply-then-ack: until a
  later compaction's state covers it, each compaction merges the stored
  snapshot again, so a caller that drops `foreign` loses nothing.
- **Web library:** opening handles an upgrade in another tab (close hooks,
  close, "Reload"), a blocked upgrade and its clearing
  (`library_upgrade_unblocked`), a newer database or `format_version`
  (read-only), and a browser that won't store anything (never a silent
  fallback to memory). Close hooks get 5 s together and may throw without
  an unhandled rejection. `IdbDocStore.dispose()` unregisters its close
  hook and forgets every open document, also one still loading. After an
  upgrade in another tab, a reload is the only recovery; the contract W4
  must wire up (register the session drain as a close hook) is tested.
- **Web library:** `persist()`, `persisted()` and `estimate()` helpers with
  the §2.6–§2.7 rules (silent requests on Chromium and Safari only, every
  iOS browser counted as Safari, also in iPadOS desktop mode, the 10 GiB
  Chromium quota report
  ignored), and the `NEXT_PUBLIC_LIBRARY` switch, which never deletes the
  library.
- **Tests:** the shared `DocStore` contract suite on `IdbDocStore` under
  `fake-indexeddb` (new dev dependency), a seeded multi-writer compaction
  property test (2,000 runs from seed 1 on every PR, about 21 s;
  `LIBRARY_PROPERTY_RUNS`, `LIBRARY_PROPERTY_BASE_SEED`,
  `LIBRARY_PROPERTY_SEED`, Yjs client ids from the seed), quota fault
  injection through `local-session`, the exact version 1 schema and an
  upgrade of a populated library, web library import boundaries, and a
  check that no import, static or dynamic, from `app/`, `components/`,
  `hooks/`, `extensions/`, `lib/`, `scripts/` or `types/` resolves into the
  library.
- **CI:** the nightly `library-property` job runs the property test at
  50,000 runs, seeded from the run id.

#### Changed

- **Spec:** a web library append bumps `meta.rev` only when it changes the
  title or snippet; `modified_at` and `size_bytes` never do, and neither
  does compaction. `IdbDocumentIndex` also reloads its snapshot on
  `pageshow` from bfcache and when the tab becomes visible (spec §2.2).
- **Spec:** the image store's web `doc_blobs` and `blobs` rows are
  snake_case, as on desktop.

### Test infrastructure: seeded fixtures and the nightly streak tracker

Test strategy Q1 and Q5 (`2026-11-16-test-release-strategy.md` §1.6, §3).
Scripts and tests only: no app, server or workflow change, and the editor
chunk is unchanged (0 B).

#### Added

- **Fixtures:** `bun scripts/fixtures/generate.ts --set <name> --seed <n>
  --out <dir>` builds the §3.2 sets from a seed it prints first
  (`SEED=<n>` replays): `library-s`, `library-1k`, `library-10k` (written
  through the storage engine), `doc-large`, `doc-near-cap` (1.9 MiB of Yjs
  state), `doc-images`, `doc-rtl`, `doc-legacy`, `exif` and `hostile`. Each
  set writes a `manifest.json`; `--list` names the sets still waiting on
  unmerged work (comments, preferences, the web library, the asset store,
  `.tinydoc`), and `--cache-key` prints a hash of every module the
  generators import (a unit test walks the imports so the list can't fall
  behind). A set folder that already holds files is refused unless `--force`
  empties it; bad input prints one line and exits 2. `FIXTURES_FULL_SIZE=1`
  (off by default) adds the slow full-size replay tests (12 MP photos,
  `library-1k`, `library-10k`). The `doc-images` photos are PNGs with an
  `eXIf` block, not JPEGs; each is written to disk as it is drawn.
- **Nightly streak:** `bun scripts/nightly-streak.ts` reads the scheduled
  runs of `nightly.yml` (and `nightly-desktop.yml` once it exists) with
  read-only `gh` calls and prints the §1.6 streak per gate as Markdown for
  the pinned streak issue: green, red and void days, the one re-run per void
  run, at most 2 void days per streak, and "not running yet" for a gate
  whose job sets no nightly job carries. A job set counts only when every
  job carrying its label finished `success` (a skipped job or matrix leg
  doesn't), a day missing a run of either gating workflow is void, and the
  setup steps that void a run are pinned against the workflow files by a
  unit test.

#### Changed

- **Tests:** `generateLargeDocument` and `generateRandomDocument` take an
  optional seeded `random`; callers that pass none keep `Math.random`.

### Desktop P2.7b: list views, sort, filter and tags

The library's list views for desktop and the web library (D3), in
`components/library/`, on top of P2.7a's sidebar. The web sandbox doesn't
use them: nothing in the web build imports `components/library` or
`lib/library`.

#### Added

- **Platform:** `LibraryIndex` gains tags (`tags`, `addTag`, `removeTag`,
  `createTag`, `renameTag`, `mergeTags`; unique by `tagNameKey`, the shared
  search normalizer, so case, accents and digit shapes don't make a new
  tag; 40 characters, 20 per document), list choices per place (`listViews`,
  `setListView`; a folder's map to `folders.sort`, `view` and `"group"`,
  the rest to `meta`), Manual order inside a folder (`moveInFolder`,
  `docs.sort_key`), the Trash list (`trash`: documents and folder units,
  newest first), one `trashGroup` per trashed folder's subtree, and list
  metadata on entries (`modifiedAt`, `snippet`, `tagIds`, `sortKey`).
  Modified counts content edits only (D-O5), sibling folders may share a
  name (D-O6), and `rename` on
  a `LibraryIndex` is documented as editing the title heading through a
  session, never the stored title (offline data-model revision §4.2). `MemoryDocumentIndex` implements them and the
  shared contract suite covers them for P2.6's `IpcDocumentIndex` and W2's
  `IdbDocumentIndex`.
- **Library:** list views for Recent, Pinned, the Library root, a folder,
  a tag and Trash, as an ARIA grid with one tab stop: sort by Title,
  Modified, Created, Opened or Manual (pin order in Pinned), List or
  Preview (title plus a 2-line snippet), group by date (Today, Yesterday,
  This week, This month, Earlier) or by folder, all kept per folder. The
  tree keeps sorting by title. Lists are windowed (first paint of a
  folder's list 33 ms at 1,000 documents and 45 ms at 10,000 on a
  production build; targets 100 and 300 ms). P2.7a's sidebar tree is not
  windowed yet: expanding a folder of 10,000 documents there takes about
  2.6 s. Arrow, Home/End and Page keys, Shift to extend, Space,
  ⌘A, Enter (a folder opens its list), F2, ⌘⌫ / Delete, ⌘Z, Shift+F10,
  type-to-select, and ⌥⌘↑ / ⌥⌘↓ in a Manual folder.
- **Library:** the filter bar: ⌘F while a list has focus, matching titles,
  tags and folder names through the shared normalizer, never body text
  (D24); a tag filter that combines tags with AND; and a Modified date
  range. It is per window and not saved.
- **Library:** the Tags section in the sidebar (collapsed, no counts),
  each tag opening a list of its documents; F2 renames a tag everywhere,
  and a name another tag has asks "Merge “plans” into “planning”?" with
  Cancel focused.
- **Library:** the Trash list with Restore (row menu, Shift+F10, or the
  header button), "Restored “Q4 plan” to Drafts." in the pill, and the
  UX §5.2 empty states. Delete Forever and Empty Trash come with P2.8.
- **Tests:** `library-lists.spec.ts` (UX §8.3 item 4, list keys, filter,
  per-folder choices, Manual order, tags, axe in both themes and RTL) and
  `library-lists-speed.spec.ts` on the harness, which now seeds large
  libraries (`?seed=10000`), a Trash (`?trash=1`) and builds production
  React with `LIBRARY_HARNESS_PROD=1`.

### Security: the web editor links only to https, http and mailto

The Hyperlink extension's own check is a denylist (`javascript:`, `data:`,
`vbscript:`, `file:`, `blob:`), so a pasted or collaborator-delivered (Yjs)
link to `ms-msdt:`, `search-ms:`, `smb:`, `vscode:` or any other OS protocol
handler stayed a live `<a href>` that Mod-click, middle-click or the
browser's "Open link" handed to the OS. The editor now allows only
`https:`, `http:` and `mailto:` (editor chunk group +145 B gz, CSS
unchanged).

#### Security

- **Editor:** `isWebLink` is the editor's `isAllowedUri`, so commands,
  autolink, paste rules and every open the extension makes refuse any other
  scheme. `LinkPolicyHyperlink` applies the same option where the extension
  skips it: a pasted `<a href>` off the policy keeps its text and loses the
  link, and a stored one (Yjs, older documents) renders with no `href`, so
  it can't be followed at all.
- **Editor:** the scheme is checked after leading whitespace only; a
  scheme split by whitespace or led by a control character is refused.
- **Editor:** pasted link titles are dropped (a tooltip a stranger chose).
  Titles already in a document still render.

#### Changed

- **Editor:** links that worked before and are now refused (none is used by
  the app itself): `tel:` (including bare E.164 numbers, which no longer
  autolink), `sms:`, `ftp:`/`ftps:`, the extension's app-scheme catalog
  (`whatsapp:`, `tg:`, `zoommtg:`, `msteams:`, `slack:`, `spotify:`,
  `vscode:`…), relative links (`#anchor`, `/path`, `./x`, `?q`) and
  protocol-relative `//host` links. The link form shows its error for them;
  existing ones stay as text that looks like a link but does not open.
- **Docs:** search-linking spec §4.4 and §4.8 say what the sandbox now does
  with a `tinydocy:` link; `docs/upstream/extension-hyperlink-allowuri-parse.md`
  is a ready-to-file issue for the extension.
- **Build:** the details spec's editor-chunk ledger (§1 rule 5) and the
  chunk script record "#168 security allowlist: +145 B", a security
  exemption outside LK1's line (coordinator-approved 2026-11-22). The
  fence still passes, so it is unchanged.

### Desktop P2.9c-1: the page engine (text size, width, spacing, reading mode)

Pages now take their text size, width and spacing from preferences, through
`<html>` attributes and CSS variables, on the web and on desktop
(preferences design §5, owner answers Q1, Q2 and Q4). Browsers that used
TinyDocy before keep today's exact look (`classic`) until they change a
setting; a pixel test against `main` proves it. New browsers get the new
Default page: 16 px text, a 33 em line (a 624 px card) and 1.6 line
spacing. There are no controls yet: the Page popover, the palette entries
and Settings arrive with P2.9c-2 and W13. Against `main` at `84a9458`, the editor chunk group grows by 109 B gz
(394,127 B; the ledger's smart-quotes line is 150 B). The first load grows
by 537 B gz of JavaScript (`PageFrame`) and 475 B gz of CSS (the Default
card, the docking threshold and the contrast set). The store and the
page-text rules load later. The boot script grows from 600 B to 2,445 B
(352 B to 1,212 B gzipped) per HTML response.

#### Added

- **Page:** `lib/prefs/` holds the schema (text sizes 14–32 px in rem,
  widths Narrow 30 em, Standard 33 em, Wide 46 em and Full, spacing
  Compact, Normal and Relaxed), the web store over new `tinydocy-ui`
  slots (`page`, `a11y`, `spellcheck`, `smartQuotes`, `rememberPlace`)
  and the attribute applier. They load in a lazy runtime that `PageFrame`
  starts once the page is idle, which keeps `<html>` in step across tabs
  and with the OS contrast setting.
- **Page:** `styles/_page.scss` holds what the first paint needs: the
  Default card, the skeleton's width and outline column, the docking
  threshold and increased contrast. `_page-text.scss` holds the knobs, the
  document text's rules, reading mode and the motion override; it loads
  next to the editor, which waits for it.
- **Page:** boot script v2 (`lib/prefs/boot-script.ts`, replacing
  `lib/theme-boot.ts`) decides the theme and the page look from one
  storage snapshot before first paint. Its allowlists are generated from
  the schema, a parity test runs it against `resolveBoot()` over 224
  payloads, and `BOOT_SCRIPT_SHA256` is its CSP source for the desktop
  shell; `bun run build:desktop` fails if an exported page inlines any
  other string.
- **Page:** `PageFrame` wraps the editor and its skeleton, on the web
  and in the desktop root. It decides whether the outline docks: when
  the main area is at least the card plus 302 px wide, which CSS computes
  from the card's own variables (`--page-dock-min`): 950 px in `classic`,
  as before; 926 px for Default; Full never docks.
- **Page:** reading mode, per tab and never stored (`data-reading` on
  `<html>`): the document is read-only through the editor's `readOnly`
  prop and the toolbar hides. It emits no Yjs update.
- **Writing:** a smart-quotes switch (owner Q2). Typography's input rules
  read `data-smart-quotes`, so turning it off rebuilds nothing; code
  blocks and inline code never curl. A spellcheck switch through
  `<html spellcheck="false">`. A Remember my place switch that gates the
  continue position and forgets stored places when turned off.
- **Accessibility:** Increase contrast and Reduce motion overrides for the
  web (owner Q4, `data-contrast`, `data-motion`). The high-contrast token
  set also follows the OS setting (`prefers-contrast: more`) outside
  `classic`: the boot script and the runtime set `data-contrast` for it.

#### Changed

- **Page:** every paragraph renders at one size, including table cells,
  list items and blockquotes (the Default page fixes the old 15/16 px mix).
  Lists, cells and headings read the page's line spacing.
- **Headings:** HeadingScale writes `--hd-size` in twelfths of
  `--hd-unit` (1 em of the page's text size by default), so headings
  follow Text size; `classic` sets it to 16 px and keeps the old pt sizes
  at any browser text size.
- **Outline:** `PageFrame` alone decides docking, before the first paint;
  the outline panel's fixed 949 px breakpoint is gone.
- **Skeleton:** the loading card takes the same width as the editor card,
  so the page doesn't jump when the editor arrives.

No schema or protocol change; no Deploy note.

### Desktop P2.5: the Electron shell

The desktop app now has a shell: an Electron main process, a sandboxed
preload and an unsigned internal build for macOS, Windows and Linux. It
serves the desktop export on `app://tinydocy` and stores documents through
the storage worker. Nothing changes on the web.

#### Added

- **Desktop:** the typed bridge. `desktop/shared/ipc-contract.ts` declares
  each call (`app.hello`, `app.flushed`, `doc.open`, `doc.append`,
  `doc.compact`, `doc.close`, `doc.flush`, `index.create`) and event
  (`app.flushRequested`, `index.changed`) once, with the guard main runs on
  it. The preload exposes `window.tinydocy` (`build`, `invoke`, `on`) and
  nothing else. Main refuses calls until a window's preload has said hello
  with the same build.
- **Desktop:** the main process (`desktop/main/`):
  - serves the export through the `app://tinydocy` handler with a CSP built
    per page (inline-script hashes, Tiptap's stylesheet by hash, no
    `'unsafe-inline'` scripts, `img-src 'self'`, no X hosts);
  - shows each window on `ready-to-show` over a background that matches
    the OS theme, sandboxed, with no page zoom, reload or DevTools;
  - refuses navigation away from the app origin and `window.open` (an
    `https` link opens in the system browser) and denies permissions by
    default;
  - sets YouTube's Referer to the website's origin;
  - holds the single-instance lock, and filters `argv` and `open-file` to
    `tinydocy://`, `tinydocy://local/<uuid>` and existing `.md`, `.html`
    and `.tinydoc` files (import is P2.8);
  - keeps the open-document registry: opening a document that another
    window holds focuses that window;
  - starts the storage worker beside the first window, restarts it after a
    crash (at most 3 times a minute, replaying the registry), and is
    otherwise read-only.
- **Desktop:** quitting never waits on the page (#106). Main ignores
  `beforeunload` vetoes and asks each window to flush through the bridge
  (at most 3 s). It then shuts the worker down (at most 2 s) and exits; a
  watchdog guarantees the exit.
- **Desktop:** the unsigned internal build (`desktop/build/`): DMG, NSIS
  installer, `.deb` and AppImage. Fuses: `RunAsNode` off, `NodeOptions`
  off, cookie encryption on, ASAR integrity on (Electron enforces it on
  macOS and Windows only), app only from the ASAR. `check-fuses.ts` reads
  them back from the installed binary.
- **Tests:** the `electron` Playwright project runs against the installed
  app on all three OSes (`desktop-shell.yml`, also nightly). It covers the
  D-A12 checks, the bridge, the registry, the refusals and the quit. Unit
  tests cover the guards and the `argv` filter (both fuzzed), the
  registry, the handlers, the supervisor and the quit coordinator.

- **Desktop:** the packaged renderer opens documents from local storage:
  `DesktopRoot` puts `local-session` over `IpcDocStore`
  (`createRpcDocStore` over `window.tinydocy`). A window gets its document
  from main; one opened with none gets this install's default document
  until the library UI (P2.7).

#### Security (review of #135)

- **Desktop:** two build flavors. The **release** flavor (installers) has
  the inspect fuse off and compiles every test hook out (a build check
  refuses a release bundle that names one). The **test** flavor (unpacked,
  never shipped) keeps the hooks and the inspector for Playwright.
- **Desktop:** Windows registers `tinydocy://` as `… -- "%1"`; a link with
  `--inspect=9229` after it opens no inspector (checked on the installed
  release app on all three OSes).
- **Desktop:** only the app's own top frame can send an `https` link to
  the system browser, at most 3 per window per 10 s; embed frames and an
  unknown focused frame are refused. Downloads and device choosers
  (Bluetooth, HID, serial, USB) are refused.
- **Desktop:** every response from `app://tinydocy` carries a CSP (a
  minimal one for non-HTML, SVG sandboxed); symlinks are never served,
  and a renderer export containing one fails the build.
- **Desktop:** a `tinydocy://local/<uuid>` link opens a window only for a
  document that exists, at most 5 new windows per 10 s; CSP reports from
  a page are capped per window; a renderer may append only `local` and
  `migration` updates, and `schemaTo` only with `migration`.
- **Desktop:** the sync URL baked into `connect-src` must be a bare
  `ws:`/`wss:` origin (`wss:` for release). On Windows the library lives
  under `%LOCALAPPDATA%\TinyDocy`.
- **Desktop:** the Linux spellcheck guard is installed on every session as
  it is created. An offline spec reads Chromium's net-log for a whole
  session and finds nothing leaving the machine; the only entry besides
  loopback is Chromium's IPv6 reachability probe, which sends no packet.

#### Changed

- **Desktop:** the D-A12 smoke serves its fixture on `app://tinydocy` with
  the shell's path rules. A test keeps every Electron pin at 45.3.2.
- **Desktop:** Linux spellcheck stays off until dictionaries can be
  delivered without a network download (#100). Turning it off alone still
  let Chromium download a dictionary from Google, so Linux also sets no
  spellcheck languages and a closed loopback download URL; a spec fails
  on any spellcheck event. macOS and Windows use the OS spellchecker.

### Desktop P2.8a: headless schema, Markdown export and safe file names

The first part of plan P2.8: the parts that need no Electron shell. Nothing in the web app imports them yet. The web build is unchanged against `main` at `903b5c8`: the editor chunk group is identical (393,820 B gz), and so are 98 of the 99 chunk files. The 99th is the Hocuspocus provider chunk, which embeds the build's commit SHA. Its raw size is equal, and the gzipped size moves by about 1 B on every commit.

#### Added

- **Headless schema** (`lib/headless/`): the editor's ProseMirror schema built from its schema extensions, with no view, DOM, React or collaboration plugins.
  - It converts a Y.Doc to ProseMirror and back through `@tiptap/y-tiptap`. Reading never writes to the Y.Doc, and an unknown node or mark name throws instead of being dropped.
  - It runs in Bun, in a `worker_thread` and in a browser bundle.
  - Tests compare it with the editor's schema (names, content, groups, attribute defaults, mark order) and keep it free of `components/`, React, Hocuspocus, DOMPurify, lowlight and Mermaid.
  - Markdown export, the import engine (IM1) and the web library's export (W7) share it.
- **Markdown export:** `exportMarkdown(ydoc, { tags, createdAt, modifiedAt })` writes front matter (title, tags, ISO dates), then the body.
  - The front matter is JSON-quoted, so a hostile title stays one YAML scalar.
  - The body escapes literal Markdown syntax: line starts, `==`, code fences and inline code that hold backticks.
  - The node and mark mapping and every degradation are in `docs/design/2026-11-22-markdown-mapping.md`. Colours, font sizes, paragraph and heading alignment, link titles and embed options are dropped. Line breaks in headings become spaces. Letter and roman list numbers become digits. Merged table cells are unmerged in place.
  - Only the document fragment and the metadata passed in reach the file: comments and secrets never do.
- **Markdown import (first piece of IM1):** `importMarkdown(text)` reads the title (front matter, then a leading H1, then the file name), tags (capped at 40 characters and 20 per document), and dates.
  - A restricted front matter reader accepts string scalars and flat lists only. It refuses anchors, aliases, tags, block scalars and nested maps, and caps the block at 64 KiB.
  - Round-trip tests export then import every editor fixture plus an all-nodes document, and expect exactly the documented losses.
- **Safe file names** (`lib/filenames.ts`): titles become names that work on macOS, Windows and Linux.
  - Separators, `<>:"|?*`, control, bidi and zero-width characters are removed. So are leading dots, trailing dots and spaces, and `..`.
  - Windows device names (`CON`, `nul.tar.gz`, `COM¹`) get a `_`.
  - Names are cut at a grapheme boundary to 255 UTF-8 bytes, and relative paths are kept to 240 characters.
  - Collisions get ` (2)`, compared without regard to case or Unicode normalisation.
  - A property test runs 1,000 hostile titles.

### Typing-latency check judges paired rounds

`performance.spec.ts` failed on clean runs about once in twenty: across 63 CI
results the toolbar-on/off ratio of the two arms' median p95s had an sd of
0.051 around 1.02, so the 10% budget sat about 2 sd out. It failed before
P2.2 as well (1.26 and 1.20 on branches without it); P2.2 did not shift it
(median ratio 1.00 with it). Test only; no Deploy note.

#### Changed

- **Tests:** the verdict is the median of the per-round on/off ratios (each
  round types both arms back to back, which cancels the runner's drift: sd
  0.037 on the same 63 runs). The 10% budget is unchanged.
- **Tests:** a run over budget after `PERF_ROUNDS` (7) runs
  `PERF_EXTRA_ROUNDS` more (default 7, `0` disables) and is judged on all of
  them, so a noisy draw gets a second look and a real regression still fails.

### The editor no longer imports the sandbox status chip

`components/document-editor/` no longer reaches `collab-session` through the
status chip, so the desktop graph won't load it from there (desktop
architecture §3.3). The web looks and loads the same: the chip still paints in
the same commit as the editor (12 cold loads on a production build, median
0.0 ms apart, as on `main`) and no new chunk is made. No schema or protocol
change; no Deploy note.

#### Changed

- **Editor:** `DocumentEditor` takes the connection and identity chip as a
  `statusChip` prop, still shown only with a provider. The web sandbox's root,
  `components/editor-app/sandbox-document-editor.tsx`, wraps the editor in the
  sandbox `DocSession` and passes `CollabStatusGroup`; `EditorApp` lazy-loads
  it in place of the editor, so the chip stays in the editor's chunk group.
- **Tests:** the editor import-boundary test has no exceptions left (the
  `user-identity-button.tsx` entry P2.1c listed is gone).
- **Bytes:** the editor chunk group grows by 198 B gz on `main` after P2.1c
  (about 100 B of code; the rest is the minifier re-ranking names in the
  editor's hoisted module); the app shell grows by 1 B. The D23 ledger
  (details §1 rule 5) gains a 198 B line for it, and the fence rises by
  exactly that, to `main` + 2,053 B.

### Desktop P2.4b: the dev bridge, the desktop root and the `local` project

The desktop renderer now opens a document from storage. Under a
desktop-target `next dev` with `NEXT_PUBLIC_DESKTOP_BRIDGE=dev`, storage is a
dev storage host on `MemoryDocLibrary` reached over a loopback socket, with no
Hocus. The web build is unchanged: its route table, client chunks, pages and
`sw.js` match the P2.1c baseline apart from Next's build id.

#### Added

- `components/desktop/desktop-root.tsx`, the desktop composition root. It
  puts `local-session` over `createRpcDocStore` into `DocSessionProvider` and
  opens one document (`?doc=`, until the library UI). It saves on blur, hide
  and pagehide. `app/page.desktop.tsx` loads it with `ssr: false`.
- The dev bridge. `lib/platform/desktop/dev-bridge.ts` is the renderer's
  `call`, typed against P2.6's `DocStoreCalls`. `desktop/dev/storage-host.ts`
  is the host.
  - The host listens on 127.0.0.1 only, with a random token and an origin
    check, and never runs in production.
  - Each connection is one window: one holder per document, released when it
    closes. Requests run in order.
  - `lib/platform/desktop/dev-bridge-wire.ts` is the binary codec.
  - Errors cross as `{ code, retryable }`, like the real IPC: no exception
    message reaches the renderer, and unknown failures are `internal`.
  - `DesktopRoot` retries `already_open` for about 500 ms, because a reload's
    new connection can beat the old one's release.
  - `next.config.ts` refuses a desktop production build with
    `NEXT_PUBLIC_DESKTOP_BRIDGE=dev`.
  - P2.1's `DocStore` contract passes through the whole path.
  - Architecture §11 lists how the bridge differs from the IPC path, so a
    green `local` run is not read as proof of it.
- The `local` Playwright project: one storage host per worker. An edit survives
  a reload, the only sockets are the dev server's and the host's, and an X post
  renders as the link card.
- A `desktop` CI job builds the export on Linux and runs the `desktop` and
  `local` projects, with no retries for `local`. The nightly copy is
  removed.

#### Changed

- **Desktop routes are an allowlist.** The desktop target's `pageExtensions`
  are `["desktop.tsx", "desktop.ts"]`. Its routes are the root page plus
  re-exports of the layout, the error page and `/about`.
  - This retires P2.4a's move-aside: nothing is parked for the export, and
    `next.config.ts` no longer guards against parked files.
  - The alternatives were measured and rejected. A `page.desktop.tsx` beside
    `page.tsx` loses to it silently. Branching `page.tsx` on the flag pulls
    desktop chunks into the web build.
- The export check also fails on the dev bridge's marker string
  (architecture §11 release check).
- `next.config.ts` always defines `NEXT_PUBLIC_DESKTOP_BRIDGE`, so release
  builds drop the bridge's branch.
- The `desktop` project no longer needs Hocus. The X link card test moved to
  `local`, because a release export has no storage until P2.5.

### Docs: offline data model revision (format 2)

Design only; nothing changes for users and there is no deploy step.

#### Added

- **Specs:** `docs/superpowers/specs/2026-11-22-offline-data-model-revision.md`.
  It contains:
  - the verdict on the offline goal;
  - library format 2 as one forward migration: FKs, CHECKs, `links`,
    `doc_headings`, `blobs`, `doc_blobs`, and `head_seq`/`derived_seq`
    staleness;
  - the relationship invariants and the repair job;
  - the long-document policy and benchmarks T20–T25;
  - the offline feature matrix;
  - new plan rows: P2.6d–f, LK4a, LJ1, P2.5b, B0, OF1, OF2;
  - instructions for the work in progress;
  - owner decisions D-O1–D-O8.

#### Changed

- **Specs:** the desktop local-first plan §3 points to the revision.

### Design: document links UX review (LK1)

A review of the linking UX for LK1 (document links core) by the Head of
Engineering, senior staff, UI and accessibility lenses, with a clickable
prototype for the owner's design review. Documentation only; no app or server
change.

#### Added

- **Docs:**
  - `docs/design/2026-11-22-document-links-prototype.html`: document, web and
    broken links in text; the link states; the preview popover; following,
    arrival and Back; the first-time hint and the consent-window line; and,
    as LK2 and LK4 previews, the ⌘K picker with heading links, the hovercard
    and Linked from. Switches for each owner decision, theme, direction,
    width, mode and reduced motion.
  - 41 headless screenshots in `docs/design/2026-11-22-document-links/`.
  - `docs/superpowers/specs/2026-11-16-search-linking-design.md`: amendments
    to §4.2, §4.3, §4.5, §4.6, §5, §7, §8 and §10–§12 and owner questions
    Q4–Q10, marked
    "Proposed, pending owner approval (2026-11-22)".
- **Finding:** with the link icon as `display: inline-block` (the hyperlink
  package's default), a line can break between the icon and the link's first
  word (18–28% of widths in headless Chromium, LTR and RTL). An inline,
  `nowrap` icon span with a word joiner after the svg never split.

### Desktop P2.1c: the editor opens documents through `DocSession`

`use-yjs-document` now opens documents through the `DocSession` its
composition root provides, instead of importing `collab-session`. The web
provides the sandbox adapter, which wraps `collab-session` unchanged, so
nothing changes for users. The adapter loads with the lazy editor chunk,
not on first load (first load −32 B gz, editor chunk group +275 B gz). The
desktop and library roots will provide `local-session`.

#### Added

- **Platform:** `lib/platform/doc-session-context.tsx`
  (`DocSessionProvider`, `useDocSession`) and
  `lib/platform/web/sandbox-doc-session.ts` (`sandboxDocSession`, the
  sandbox `DocSession` over `collab-session`).
- **Editor:** `components/editor-app/sandbox-document-editor.tsx`, the web
  wrapper that `EditorApp` loads lazily in place of `DocumentEditor`: the
  editor under the sandbox `DocSession`.
- **Tests:** an import-boundary test that neither the hook nor any module in
  `components/document-editor/` loads `collab-session` or a platform
  adapter. One known path remains for P2.2: `CollabStatusGroup` is imported
  statically and its connection status reads `collab-session`.

#### Changed

- **Editor:** `use-yjs-document` returns the same fields as before, now read
  from the `DocSession` handle (`ydoc` and `awareness` are `undefined`, not
  `null`, before the first open).
- **Build:** the D23 editor-chunk ledger gains P2.1c's measured 275 B line
  (K14's P2.1 allowance), and `EDITOR_CHUNK_LEDGER_BYTES` rises by exactly
  that, from 1,580 B to 1,855 B, so the fence is `main` + 1,855 B.
- **Tests:** `FakeClock.advance` (`tests/helpers/platform-fakes.ts`) drains
  promise callbacks instead of waiting on real `setTimeout(0)` macrotasks, so
  the batcher's simulated-kill property test no longer depends on machine
  load (8 s at load average 50 before, 0.25 s now) and no longer flakes
  against the 5 s timeout.
- **Tests:** the SIGKILL batcher test kills its child once at least 10
  tokens are past the 1 s window and it is still typing, instead of at a
  fixed time, so a slow CI runner makes the run longer rather than failing
  its "enough typed" check.
- **Editor:** the read-only notice compares `ReadOnlyReason` strings, and its
  Reload button saves through `DocSession.flush()` (on the web, the same
  device-copy flush as before) before reloading.

### Desktop P2.7a: files sidebar, Quick Open and Move to…

The library's files sidebar for desktop and the web library (D3), in
`components/library/`, driven by a `LibraryIndex`. The web sandbox doesn't
use it: the web build is unchanged (every JS and CSS chunk identical to
`main`; first load and editor chunk +0 B).

#### Added

- **Platform:** `LibraryIndex` extends the `DocumentIndex` port with
  folders (4 levels), all-or-none moves that refuse a folder into its own
  subtree, pins in their own order, `markOpened`, and a folder trashed and
  restored as one unit (to the root when its parent is gone).
  `GlobalTabsIndex` stays a plain `DocumentIndex`. `MemoryDocumentIndex`
  implements it, and the shared contract suite covers it for P2.6's
  `IpcDocumentIndex` and W2's `IdbDocumentIndex`.
- **Search:** `lib/search/normalize.ts`, the one metadata normalizer
  (D-A8): case, Latin, Arabic and Hebrew marks, tatweel, Arabic yeh and kaf
  to Persian, Persian and Arabic-Indic digits to ASCII, with an offset map
  so highlights keep the original text. `lib/search/match.ts` matches word
  prefixes before substrings.
- **Library:** the files sidebar (Search, Recent, Pinned, the Library tree,
  Trash), an APG tree with one tab stop, multi-select, type-ahead, F2
  rename, Move to Trash (⌘⌫ / Delete) and file-operation undo (⌘Z, 20
  steps), Shift+F10 row menus, and pointer drag and drop with
  spring-loaded folders (700 ms, or Space). Move to… lists recent
  destinations first and keeps refused folders visible with the reason.
  Quick Open searches titles and folder names only (D24), shows the folder
  path, offers Create when nothing matches, and opens in a new tab with
  ⌘Enter. Right-to-left sidebars mirror, ← and → included. New Document
  goes into the folder that has focus in the sidebar, else the root.
  Document renames go through the host's `onRenameDocument`, so desktop and
  the web library can edit the title heading (details spec §2.3).
- **Focus:** `lib/region-focus.ts` moves between regions with F6 /
  Shift+F6 and returns to the last focused element of each.
- **Tests:** the `library` Playwright project runs the keyboard checklist,
  folder refusals, drag and drop, RTL keys and axe on a Bun harness
  (`tests/harness/library`, `bun run harness:library`); CI starts it in
  the e2e job. Unit tests cover the normalizer, the matcher, folder and
  drop rules, tree rows, keys, the undo stack and F6 regions; the import
  boundary test keeps the library UI free of sandbox, desktop, editor and
  test code.

#### Changed

- **Build:** `app/globals.css` leaves `components/library` and
  `tests/harness` out of Tailwind's sources; the library styles itself in
  plain CSS on the shadcn tokens, shipped only with the components.

### Retention purge: on

The daily `editor-purge` run now deletes. Four dry runs in production
(2026-11-19 to 2026-11-22, 03:17) each listed the same 2 documents idle for
more than 30 days (`staleTotal` 2), no closed documents past 7 days and no
expired tombstones.

#### Changed

- **Ops:** `PURGE_MODE` is `on` for `editor-purge` in `ecosystem.config.cjs`.
  Each run first backs the database up to `backups/` (`db-first.sqlite` kept
  forever, dated copies 14 days) and deletes nothing if the backup fails.

**Deploy:** nothing to do by hand. The automatic deploy registers the new env
without purging; the next 03:17 run writes `db-first.sqlite` and does the
first real purge. To stop it: set `PURGE_MODE` back to `dry-run` or `off` in a
pull request, or `bunx pm2@6.0.14 stop editor-purge` on the host.

### CI: `main` runs are never cancelled; merge queue support

A merge on `main` no longer cancels the previous commit's CI run, which left
that commit undeployed (29f6faf and e64ae84). CI also runs in the merge queue,
so the owner can require it on `main`. No app change.

#### Changed

- **CI:** only pull request runs are cancelled by a newer push. A started run
  on `main` always finishes and can deploy; runs queue in commit order, and
  when several merges land together the newest commit's run waits and
  deploys everything before it.
- **CI:** a `merge_group` trigger. Merge queue runs never deploy (Deploy acts
  only on CI runs from a push to `main`).
- **Tests:** `tests/unit/ci/ci-workflow.test.ts` pins the triggers, the
  no-cancel rule and the two required check names;
  `workflow-permissions.test.ts` requires explicit read-only permissions on
  every job of a `pull_request` or `merge_group` workflow.

**Deploy:** none. **Owner (once):** to turn the merge queue on, add
**Require merge queue** to the **Protect main** ruleset as
`docs/operations/deploy-runbook.md` → *Turning the merge queue on*
describes; the required checks keep their names.

### Desktop: no partial daily copy left after a quit on Windows

On Windows, a quit during a daily copy could leave
`daily/library-<date>.sqlite.partial` behind. The copy thread was stopped
with `terminate()`, which skips its cleanup, so its SQLite handle could still
hold the file when shutdown tried to delete it. Windows won't delete an open
file, and nothing retried.

#### Fixed

- **Desktop:** quit now asks the copy thread to stop. At its next batch the
  thread rolls back, closes its connection and the read-only attach, and only
  then exits; `terminate()` is the fallback after 500 ms. The partial file is
  then deleted with retries for about 420 ms, inside the 2 s shutdown budget.
  The previous copies are never touched.
- **Desktop:** the storage host's deletes retry briefly on `EBUSY`. Opening a
  library still succeeds when a partial can't be deleted yet; the next open
  removes it.
- **Tests:** T4-copy runs 30 times on `windows-latest`. Every quit must land
  during a copy, and every copy must be stopped with its partial deleted.

### Docs: Phase 2 status, and the runbook and AGENTS.md brought up to date

Documentation only; no app or server change.

#### Added

- **Docs:** `docs/superpowers/plans/2026-11-22-phase-2-status.md`. It
  records:
  - where each Phase 2 row stands;
  - the decisions made while executing it: the daily-copy design, the
    editor-chunk ledger lines and the 0 B rule, the bubble redesign
    rulings, landing dark;
  - how work merges;
  - what waits on the owner;
  - the head-of-engineering estimates.

  The design spec's Phase 2 heading links to it.

#### Changed

- **Docs:** the deploy runbook records that automatic deploys and the
  retention purge are on in production, and that over a non-login SSH
  command PM2 runs as `~/.bun/bin/bunx`.
- **Docs:** `AGENTS.md` records:
  - the desktop and local-first layering: the ports, contract suites,
    storage worker, desktop export, library UI and landing dark;
  - the editor-chunk budget rule;
  - the batch-and-wait merge practice;
  - the Node 14 `install_deps` shim on the host;
  - the purge state.

### Selection bubble P0: a plugin-free controller and a first-line anchor

The selection bubble no longer registers a ProseMirror plugin from its lazy
chunk, and it anchors to the line it belongs to (spec
`2026-11-17-bubble-and-quick-insert-design.md` §12.1, v1 contract A18). The
editor chunk group is unchanged (393,465 B gz, −1 B against `main` at
`29f6faf`, 1,287 B under the P2.2 fence), and the
bubble chunk shrinks from 12,238 B to 9,798 B gz (−2,440 B).

#### Changed

- **Bubble:** a `BubbleController` per editor shows, hides and positions the
  bubble instead of Tiptap's `BubbleMenu`, so the bubble chunk landing no
  longer rebuilds all 29 plugin views. The DOM contract is unchanged: one
  `[data-smart-bubble]` root, appended to the scroll container on show and
  removed on hide.
- **Bubble:** it anchors to the first selected line that shows, not to the
  box between the selection's two ends: a selection that wraps onto the
  next line is centred on its selected part of the first line, not the
  middle of the column, and one that starts at the end of a paragraph
  anchors to the next line's text, never to a whole block. Below the text,
  it stays in view when the selection runs past the bottom of the window.
- **Bubble:** Esc on a bubble item plays the 90 ms exit fade before the
  bubble goes; a re-shown bubble never flashes at its old position.

#### Fixed

- **Bubble:** select all (⌘A / Ctrl+A) shows the bubble, under the first
  visible line; a whitespace-only selection shows none.

### Desktop P2.6 decision 5: daily copies never hold up a save or a quit

A daily `VACUUM INTO` on the storage worker blocked every save behind it, for
up to 9 s on a Windows runner. That included the quit flush, so a quit during
a copy could drop the final batch of edits. The copy now runs in its own
thread and can be stopped.

#### Changed

- **Desktop:** the daily copy (`desktop/storage/engine/copy-library.ts`)
  - copies the library in batches of at most 256 rows or about 4 MiB, from
    one read-only snapshot, inside one transaction;
  - creates the schema verbatim and copies `sqlite_sequence`,
    `user_version` and `application_id`;
  - checks row counts and `integrity_check` before the copy is renamed into
    place, then runs a passive WAL checkpoint;
  - on failure, keeps the previous copies and records `daily_copy_failed`.
- **Desktop:** the storage worker runs that copy in a second thread
  (`desktop/storage/copy-worker.ts`), so saves never wait on it. On quit it
  stops the copy in milliseconds and deletes the partial file; the previous
  copy stays. Opening the library sweeps any partial copy left behind.
- **Tests:** soak case `T4-copy` quits during a copy on all three OSes. T8
  compares the copy's time and size with `VACUUM INTO`'s on the year-end
  library. A unit test restores a copy and runs the `DocStore` contract on it.
- **Docs:** the architecture spec records the quit budget (3 s flush, then
  2 s worker shutdown), the batched copy, and `utilityProcess` as the
  upgrade path once P2.5 exists.

### Desktop P2.6: the library storage worker

The SQLite engine behind the desktop library, where documents, folders and
tags live, and the `worker_thread` that runs it inside Electron main (D-A1).
Nothing in the web app or its build uses it yet; P2.5's shell starts the
worker and P2.7 builds the files sidebar on it.

#### Added

- **Desktop:** `desktop/storage/engine/`, with no `node:`, `bun:` or
  Electron imports, behind a `SqliteDriver` seam (`node:sqlite` in the
  worker, `bun:sqlite` in tests and the dev host):
  - the format-1 schema, so the Local release needs no later migration:
    `docs` (lineage and a `NOT NULL` `link_key` minted at insert, `kind`, the
    list columns), `folders`, `tags`, `doc_tags`, `doc_view(doc_id, width,
    place, remote_images)`, `import_sources`, `snapshots` and `updates` with
    an `AUTOINCREMENT` seq;
  - the open order: cloud-synced folders refused, `library.lock` with a pid
    check, WAL with `synchronous=FULL` (`fullfsync` on macOS), and the
    `format_version` guard before any write, so a newer library opens
    read-only and untouched; `quick_check` after an unclean exit;
  - format migrations with a `VACUUM INTO` copy first (2 kept), one
    transaction per step, and read-only on failure;
  - appends and renderer-driven compaction in one transaction each, with
    one window per document (`already_open`, `forbidden`, `document_open`);
  - documents, folders, tags, Trash (emptied after 30 days) and the sidebar
    snapshot, with a change feed: every change the sidebar shows, appends
    included, moves `rev`, and the worker sends `index_changed` with the
    changed rows;
  - a daily `VACUUM INTO` copy on the first idle moment, keeping 7, and a
    reader for restoring one document from a day;
  - shutdown for the quit flush: WAL checkpoint, `unclean_exit` cleared,
    lock released.
- **Desktop:** `desktop/storage/worker.ts` and `client.ts`: the worker
  answers main one request at a time with `Result` envelopes and transferred
  bytes; the client rejects pending calls with `worker_restarting` if the
  worker dies and ends with a 2 s shutdown.
- **Platform:** `lib/doc-migrations/` (the open-time migration hook list,
  empty so far, and `checkImport`, which refuses an import that is too
  large, isn't Yjs, or carries a node, mark or root this build doesn't
  know) and `lib/platform/desktop/rpc-doc-store.ts` (`DocStore` over worker
  replies, for `IpcDocStore`).
- **Tests:** P2.1's shared `DocStore` contract on the engine, on
  `bun:sqlite` under `bun test` and on `node:sqlite` inside the Electron
  worker; engine suites (open, content, index and its change feed, daily
  copies, codes, and a property test of random appends, compactions,
  crashes and reopens); the import-boundary test's storage rows; and
  `tests/load/desktop-durability-soak.ts` with its Electron harness in
  `desktop/storage-harness/` for soak cases T1–T6 and T8.
- **CI:** `desktop-storage-soak.yml` on macOS, Windows and Linux: 20 kills
  per case on pull requests that touch storage, 200 nightly or with the
  `storage-soak-full` label. `bun run typecheck` also checks the new
  `tsconfig.desktop-node.json`.

#### Changed

- **Docs:** the desktop architecture spec records where P2.6 put the engine
  and the harness, the worker-side registry check and `claim`, the
  import-boundary allowance for `lib/schema-names.ts`, and that T7 is covered
  by `local-session`'s tests, not the storage soak.

### Editor without a provider; WriteGate; the editor-chunk fence (P2.2)

Desktop Phase 2, P2.2. The web editor behaves as before: it still gets its
provider, and nothing passes the new read-only prop. The editor chunk goes
from +15,284 B to +15,578 B (+294 B of P2.2's 300 B line in the D23 ledger),
and the budget drops from 23.5 KB to +16,864 B (`main` plus the 1,580 B
ledger), leaving 1,286 B for the ledger's other lines. No schema or protocol
change; no Deploy note.

#### Added

- **Editor:** `DocumentEditor` takes the session's Awareness and accepts no
  provider. With none, the connection chip isn't rendered and no socket
  opens. Carets use the Awareness directly, and the extension list depends
  on it rather than on the provider, so attaching a provider later never
  rebuilds the extensions (no `setOptions`).
- **Editor:** `WriteGate` (`extensions/write-gate/`), a `filterTransaction`
  plugin over a ref. With the new `readOnly` prop, no local ProseMirror
  change reaches the document, including the writes plugins make when a
  document opens. Changes from collaborators still apply. The schema
  guard's repair writes Yjs directly and is not gated yet; it must be when
  something first sets `readOnly`.
- **Editor:** the decoration host (`extensions/decoration-host/`): declared
  layers each get a plugin holding a `DecorationSet`, set by the meta-only
  `setDecorationLayer` command, either mapped or cleared on document
  changes. No layer is declared yet; comments and Find will declare theirs.

#### Changed

- **Build:** `scripts/check-editor-chunk-size.ts` budget is `main` at
  P2.2 plus the D23 ledger (+16,864 B), and it prints exact bytes.

### Desktop renderer export (P2.4)

`bun run build:desktop` builds the desktop renderer: the static export the
Electron shell will load. The web build is unchanged. Its route table, client
chunks (names and sizes), manifests and every page apart from `/icon`'s URL
match `main`. The `/icon?<hash>` cache-buster changes because `app/icon.tsx`
gained `dynamic = "force-static"`; the PNG is byte-identical.

#### Added

- `bun run build:desktop` (`scripts/build-desktop.ts`) writes `out/` with
  `NEXT_PUBLIC_APP_TARGET=desktop` and `output: "export"`. Desktop routes:
  `/`, `/about`, `/_not-found`, `/icon`. It fails if a web-only route, a web
  metadata tag or the Windows segment layout (#103) reaches `out/`.
- `desktop/shared/export-paths.ts`: the `app://` protocol handler's path rules
  for P2.5. `/about` maps to `about.html`, RSC `.txt` files keep their
  exported names, and the extension-less `/icon` is `image/png`. Unknown
  types and traversal are refused. `scripts/serve-desktop-export.ts` serves
  `out/` with them for tests.
- The `desktop` Playwright project runs on the export instead of `next start`.
  It checks that every request the renderer makes is answered and none goes
  to a web-only route. Nightly runs it on Linux (`desktop-renderer`).

#### Changed

- Web-only route handlers are `route.web.ts(x)` (`app/api/**`, `llms.txt`,
  `pwa-icons/[id]`). `next.config.ts` switches `pageExtensions`, `output` and
  `headers()` on the target flag.
- The export parks the five web metadata files and the `/privacy` and
  `/offline` pages in `.desktop-export-parked/` for the build and puts them
  back, as spike #115 measured is required. Renaming the pages would drop
  their font preload on the web: Next 16.4.6 looks up `page.web` in a font
  manifest keyed `page`.
- `next.config.ts` refuses a web build while anything is parked.
- The desktop build never registers the service worker, whose precache lists
  `/privacy` (#117 follow-up).

### Design: selection bubble and quick insert

A draft design for the owner's review: a fuller one-row selection bubble, a
caret-local way to insert blocks, amendments to the "/" menu (Suggested, an
inline hint, a footer), and a phone Insert sheet. Documentation only; no app
or server change.

#### Added

- **Docs:**
  - `docs/superpowers/specs/2026-11-17-bubble-and-quick-insert-design.md`:
    the audit of today's bubble, Insert, "/" and phone surfaces; research
    across eight editors (two rounds of owner references, including Notion's
    panel and "/" menu) and the platform guidance; the proposed design with
    owner decisions O1–O12; and a phased plan.
  - `docs/design/2026-11-17-bubble-quick-insert-prototype.html`: a clickable
    prototype with a switch for each decision, theme, RTL, reduced motion and
    device.
  - Screenshots of today's UI and of the prototype in
    `docs/design/2026-11-17-bubble-quick-insert/`.
- **Finding:** the lazy selection bubble mounts Tiptap's React `<BubbleMenu>`,
  which calls `registerPlugin` from a lazy chunk. When the chunk lands it
  rebuilds every plugin view (29 of 29 measured), after the editor is already
  interactive. The spec's phase 0 replaces it.

### Desktop P2.1b: `local-session`, the batcher and `MemoryDocStore`

The second half of desktop plan P2.1: the platform-neutral storage path that
desktop and the web library share, behind the P2.1a ports. Nothing in the web
app uses it yet; `lib/collab-session.ts` is unchanged.

#### Added

- **Platform:** `lib/platform/local-session.ts`, the `DocSession` over a
  `DocStore`: load with no timeout, hydrate (never appended), migration hook
  before ready, deferred release (1 s), then flush, compact and close. Edits
  made before the content loads are kept, `flush()` also covers sessions
  that are closing, a refused load is retried on the next open, and
  unreadable content or a failing migration is reported (`corrupt`,
  `migration_failed`) with the schema advanced only past finished steps.
- **Platform:** `lib/platform/batcher.ts`: appends 250 ms after the last
  update or 1 s after the first, one append in flight per document, failed
  appends retried in order with backoff (2 s doubling to 60 s) and never
  skipped, save health (`failing`, `behind` past 4 MiB), and the compaction
  trigger (500 rows or 1 MiB since the snapshot).
- **Platform:** `lib/platform/memory-doc-store.ts`, the in-memory `DocStore`
  (one client per document, `failNext`, load and write delays) for tests and
  the dev bridge.
- **Tests:** the `DocStore` contract suite (`tests/helpers/doc-store-contract.ts`),
  written as runner-neutral cases so P2.6 can run it on SQLite and inside
  Electron; it passes on `MemoryDocStore`. A real-process SIGKILL test and a
  fake-clock property test show a kill loses only the last second of typing.

### Desktop P2.1a: `DocSession` and `DocStore` port types

The first half of desktop plan P2.1: the types the editor, the storage worker
and the web library code against. Types and one error class only; nothing
imports them yet, so the web app is unchanged.

#### Added

- **Platform:** `lib/platform/doc-session.ts` (`DocSession`, `DocHandle`,
  `DocHandleState`, `ReadOnlyReason`, and the `HYDRATE_ORIGIN`,
  `STORAGE_ORIGIN` and `MIGRATION_ORIGIN` transaction origins) and
  `lib/platform/doc-store.ts` (`DocStore`, `LoadedDoc`, `AppendRecord`,
  `CompactResult`, `UPDATE_ORIGINS`, and `DocStoreError` with the
  architecture §9 storage codes plus the web library's `quota_exceeded`).

#### Changed

- **Docs:** the desktop architecture spec now puts each port in its own file
  under `lib/platform/` (no `ports.ts`), and records P2.1's amendments to the
  port shapes. `DocStore.compact` resolves with `{ foreign }` for the web
  library's merge-into-snapshot compaction; the web library design notes it.

### Desktop P2.3: the tab list behind a `DocumentIndex` port (#122)

The shared tab list now sits behind a `DocumentIndex` port, so the desktop
library (SQLite) and the web library (IndexedDB) can serve the same list
later. Tab behaviour is unchanged: the tab e2e specs pass without changes.

#### Added

- **Platform:** `lib/platform/document-index.ts`, the `DocumentIndex` port:
  `snapshot()` (`rev`, `ready`, `items`), `subscribe()` with `load` and
  `change` events, `create`, `rename`, `move`, `trash`, `restore` and
  `destroy`. The active tab stays per window, outside the port.
- **Tests:** one contract suite (`tests/unit/platform/`) runs on
  `MemoryDocumentIndex` (`tests/helpers/memory-document-index.ts`) and on the
  web implementation. Web-only tests cover Playground, bootstrap and
  poisoned entries.

#### Changed

- **Tabs:** `GlobalTabsIndex` (`lib/platform/web/global-tabs-index.ts`) now
  holds the `global-tabs` Y.Doc logic: the bootstrap and legacy migration,
  sanitized reads, rename, reorder, soft close (forgetting the device copy)
  and restore. `useSyncedTabs` is its React adapter. It keeps the active tab,
  the title debounce, the tab cap, the confirmations and the Undo pill.
- **Tabs:** the legacy-list migration keeps the stored active tab id when it
  clears the old list, because the hook now reads that id after the seed.
- **Tabs:** first-load JS grows 564 B gz (319,253 B against 318,689 B on
  `next start`). The editor chunk is unchanged.

### CSS icons as files, so the desktop CSP needs no `data:` images

The eight `data:image/svg+xml` icons in the stylesheets (seven unique) would be
blocked by the desktop app's `img-src 'self'` (#102). They now ship as files.

#### Changed

- **Icons:** the phone bar's context-slot icons (Heading, Code, Table, Media),
  the checklist tick and the heading drag grip are SVG files beside their
  stylesheets. The bundler serves them as hashed `/_next/static/media/*.svg`
  (`image/svg+xml`), so they look the same in both themes. The drag grip is
  now one mask tinted per theme, and draws in the system text colour under
  forced colours.
- **Offline:** when the service worker stores a stylesheet, it also stores
  the `/_next/static` files the sheet references, so CSS icons draw offline
  even before they were first shown.
- **Tests:** a unit test fails if a stylesheet uses a `data:` URL again or
  points a relative `url()` at a missing file.

The web CSP keeps `data:` in `img-src`: images inserted into documents are
stored as `data:` URLs.

### Dark links on highlighted text

Links inside highlighted text are readable in dark mode (#104).

#### Fixed

- Dark-mode document links are lighter: `#93c5fd` instead of `#5b9cf2`. On the
  ten highlight colours they now read at 4.60–6.55:1 instead of 2.95–4.21:1
  (yellow is the lowest), and at 10.98:1 on the page and 9.94:1 on cards.
  Light mode is unchanged (4.54–5.65:1 on highlights). Links keep their
  underline.
- `token-contrast.test.ts` and `link-underlines.spec.ts` check every highlight
  × link pair in both themes against 4.5:1.

### Windows export spike: where the desktop renderer is built

This decides #103 and fixes #111, two Windows problems in building the desktop
renderer (the Next.js static export). Documentation only; no app or server
change.

#### Added

- **Docs:** `docs/research/2026-11-17-spike-windows-export.md` and its
  evidence in `docs/research/spike-evidence/windows-export/`, including a
  draft upstream comment for vercel/next.js#85374 (not posted).
  - On Windows, Next 16.4.6 and 16.5 canary write segment-prefetch files
    into `__next.<segment>/` directories, so prefetch 404s.
  - The renderer is therefore built once on Linux and packaged on every OS.
  - Parking the web-only metadata files inside the checkout fixes `EXDEV`
    on Windows runners.

#### Changed

- **Docs:** the desktop architecture §3.1 and the test and release strategy
  §2.4 now say:
  - The renderer is exported once, on Linux.
  - The stage step refuses a Windows-built `out/`.
  - The metadata move-aside stays in Phase 2, with leftover recovery.

### Tests: run 500-heading perf and soak documents at production's 2 MiB cap

A 500-heading flat document (`generateLargeDocument(500, { shape: "flat" })`,
about 1.2 MB as JSON) was over Hocuspocus's 1 MiB default
`MAX_DOC_SIZE_BYTES`: the server refused it, the editor turned read-only and
a perf run recorded 0 of 220 keystrokes, failing with only "keystroke
samples". Closes #110. Test tooling only; no app or server change.

#### Changed

- **Tests:** `make dev-hocus`, and so `make dev`, Playwright's `webServer`,
  CI's e2e job and the nightly jobs, starts Hocus with production's
  `MAX_DOC_SIZE_BYTES=2097152` (`Makefile`, the one source; an environment
  value overrides it). Local `make dev` now has production's cap too.

#### Added

- **Tests:** `EditorPage.expectSavedToServer()` waits until the server has
  acknowledged every edit and fails with the size notice's text if it
  refused them. The perf, toolbar-perf, collaborative perf and soak specs
  call it after seeding their document; the typing perf spec checks it
  again after typing.

### Desktop seams: Privacy link and X link card (#99, #101)

Web-side groundwork for the desktop renderer, found by spike S1. Every change
sits behind `NEXT_PUBLIC_APP_TARGET=desktop`; the web build is unchanged
(editor chunk group −17 B gz, first load +53 B gz).

#### Added

- **Desktop:** an X post renders as a static link card: "Post by @user", the
  URL and an Open on X button that opens a new window (the system browser in
  the desktop shell). The kit's `x` node stays in the schema, so documents
  with X posts stay valid and web clients still embed them; the card never
  asks X for anything and loads no `widgets.js`.
- **Tests:** a `desktop` Playwright project that checks a desktop-flag
  production build makes no `/privacy` request and no request to X's hosts.

#### Changed

- **Desktop:** the Privacy links (site footer, status strip, analytics
  consent) go to the website's privacy page in a new window instead of the
  web-only `/privacy`, so the app never prefetches a page it doesn't have.
- **Desktop:** the Embed dialog neither lists nor accepts X.

### Deploy: run install scripts on Bun, not the host's Node 14

The first automated deploy failed at `bun install`: husky's `prepare` script
ran on the production host's own `node` (Node 14, used by other services
there), which cannot parse it. Production kept serving the previous build.

#### Fixed

- **Deploy:** `scripts/deploy.sh` installs through `install_deps`, which puts a
  `node` that is Bun first on `PATH` and sets `HUSKY=0`, for both the build
  checkout and the live checkout. PM2 is unchanged.

**Deploy:** `deploy.sh` runs from the live checkout, so pull this commit there
once (`git pull --ff-only` in `/opt/projects/editor.docs.plus`) before the next
deploy.

### Spike S5 results: typing latency and D-A1

Records spike S5 of the desktop Phase 1 plan: typing latency in Electron
against Chrome for Testing 156, and storage commits in the worker against
commits on main's own thread. Documentation only; no app or server change.

#### Added

- **Docs:** `docs/research/2026-11-16-spike-s5-latency.md`, the S5 write-up,
  and its raw results in `docs/research/spike-evidence/s5/`. D-A1 keeps the
  storage worker: commits on main's own thread slow typing by 9–38% and
  stall main's event loop past 8 ms on every machine measured. The verdict
  machines' rows (the owner's M1, a Windows laptop with Defender on) and the
  IME checks are pending owner hardware.

#### Changed

- **Docs:** the D-A1 rows in the desktop architecture and design specs now
  say "keep the storage worker", provisional until the owner's machines are
  measured.

### Closing a tab can be undone

Closing a tab or closing all tabs shows an Undo pill for 5 s, and Recently
closed in the tab bar restores any tab closed in the last 7 days.

#### Added

- Undo after closing one tab or all tabs.
- Recently closed in the tab bar. Anyone using the sandbox can see and restore
  these tabs.

### Closed documents are kept for 7 days

Closing a tab no longer deletes the document on the server. It is kept for
`CLOSED_RETENTION_DAYS` (7) and can be restored; then the daily retention
purge deletes and tombstones it.

#### Added

- `POST /api/documents/restore` and `GET /api/documents/closed` (turn the list
  off with `CLOSED_DOCUMENTS_LIST=0`).
- `scripts/delete-document.ts` deletes and tombstones one document at once,
  for takedowns.

#### Changed

- `DELETE /api/documents/[id]` closes softly. Closed documents count toward
  `MAX_TOTAL_DOCUMENTS` until they are purged.

#### Deploy

- Deploy only after `PURGE_MODE` is `on` for the `editor-purge` app (the daily
  purge from #97). With `dry-run` or `off`, closed documents are hidden after
  7 days but never deleted, and they keep counting toward
  `MAX_TOTAL_DOCUMENTS`. The dry-run log lists them as
  `wouldDeleteClosedNames`.
- No migration: `document_closures` is created on first use; `documents` is
  unchanged.
- `CLOSED_RETENTION_DAYS` (7) is in the shared `storageEnv` of
  `ecosystem.config.cjs`, so Next.js, Hocus and the purge use the same value.
- Closing no longer frees `MAX_TOTAL_DOCUMENTS` capacity for 7 days. To free
  it, or to take content down, run on the host:

  ```bash
  cd /opt/projects/editor.docs.plus && DB_PATH=/opt/projects/editor.docs.plus/db.sqlite bun run scripts/delete-document.ts <id>
  ```
- Rollback: older code ignores `document_closures`; documents closed meanwhile
  stay stored, unlisted, until idle retention removes them (30 days). Browsers
  already holding W1b bundles show Undo, which then fails with "Check your
  connection." This is acceptable for a rollback window.

### Automatic deploys and a daily retention purge, both off until turned on

The Deploy workflow can now deploy by itself after CI passes on `main`, and
a daily PM2 job runs the retention purge, which has never run in production.
Both start off: automatic deploys wait for the owner to set `AUTO_DEPLOY`,
and the purge only logs what it would delete until `PURGE_MODE` is `on`.

#### Added

- **Automatic deploys (opt-in).** The Deploy workflow also runs when CI
  completes on `main` (`workflow_run`). It deploys that commit only if the
  repository variable `AUTO_DEPLOY` is `on` and the CI run passed and came
  from a push, never from a pull request or a fork. Unset means off. The
  on-`main` and green-CI checks and the `production` environment are
  unchanged, and the runner still checks out no code.
  `gh workflow run deploy.yml` still deploys by hand at any time.
- Only runs that will deploy join the `deploy-production` concurrency group,
  so a skipped run (failed CI, a fork's `main`, automatic deploys off) cannot
  cancel a deploy waiting its turn.
- **`editor-purge`**, a PM2 app in `ecosystem.config.cjs`, runs
  `scripts/purge-retention.ts` daily at 03:17 (host time, `cron_restart`,
  `autorestart: false`). It shares `DB_PATH` with `editor-next` and
  `editor-hocus` through one `storageEnv` object, where retention settings
  also belong. Only the cron purges: `scripts/deploy.sh` registers or
  updates it (`startOrRestart --update-env`) after the new build is live,
  and writes a marker, `.purge-skip-next`, first. The run PM2 starts then
  exits without purging (`retention_purge_registered`). Starting it by hand
  or `pm2 resurrect` does run it.
- **`PURGE_MODE`** for the purge: `off`; `dry-run` (the default, and the
  file's value), which logs `retention_purge_dry_run` with the documents an
  `on` run would delete (`wouldDeleteNames`), the whole backlog
  (`staleTotal`) and the expiring tombstones, and changes nothing; and `on`.
  An `on` run first copies the database with `VACUUM INTO` into `backups/`
  next to `DB_PATH`, and deletes nothing if that fails (exit 1,
  `retention_purge_backup_failed`). The first backup, `db-first.sqlite`, is
  kept forever; later `db-<UTC time>.sqlite` copies are deleted after 14
  days by age, not count. Copies are written as `*.partial` and renamed when
  complete. An unknown value is refused.
- Tests: the purge modes, the dry run (it writes nothing and lists exactly
  what the purge deletes), the backups (the first kept forever, 14-day age
  rotation), the deploy marker, and the CLI in each
  mode, including a failed backup; `workflow_run` workflows must not check
  out code and must require a successful CI run from a push; the ecosystem
  file, `deploy.sh` and the Deploy workflow are checked against each other
  (`tests/unit/ci/deploy-config.test.ts`).

See "Automatic deploys" and "Scheduled jobs" in
`docs/operations/deploy-runbook.md`.

#### Deploy

Nothing deploys by itself and nothing is deleted on merge. In order:

1. **Finish the one-time setup** in the deploy runbook if it is not done:
   the deploy key on the host, the `production` environment limited to
   `main` with its secrets, and `git pull --ff-only` once on the host.
2. **Deploy by hand:** `gh workflow run deploy.yml`. The deploy that first
   brings this change runs the host's previous `scripts/deploy.sh` (script
   changes apply from the next deploy), so it may not start `editor-purge`.
   If `bunx pm2@6.0.14 ls` does not list it, register it the way
   `deploy.sh` does (the marker makes that first run exit at once), then save
   the PM2 list so it survives a reboot:
   ```bash
   cd /opt/projects/editor.docs.plus
   date +%s > .purge-skip-next
   bunx pm2@6.0.14 start ecosystem.config.cjs --only editor-purge
   bunx pm2@6.0.14 save
   ```
   Its first real run is the next 03:17, as a dry run: it deletes nothing.
3. **Turn automatic deploys on** only after a manual deploy has succeeded:
   `gh variable set AUTO_DEPLOY --body on`.
4. **Turning the purge on** is a later, separate change. Read the
   `retention_purge_dry_run` lines from a few daily runs
   (`bunx pm2@6.0.14 logs editor-purge`). If the listed documents should go,
   set `PURGE_MODE: "on"` in `ecosystem.config.cjs` in a pull request. From
   the next 03:17 run, every run backs up to `backups/` before it deletes up
   to 100 documents: the first to `db-first.sqlite` (kept forever), then
   dated copies kept 14 days. Check the disk has room for about 16 copies of
   `db.sqlite`.

### Phase 1 shell spike results (S1, S4)

Records what the Electron shell spikes found and the decisions they settle.
Documentation only; no app or server change. The spike code stays on its
`spike/*` branches.

#### Added

- `docs/research/2026-11-16-spike-s1-shell-origin.md`: the static export in
  Electron on both candidate origins, on macOS, Windows and Linux (CSP,
  embeds, spellcheck, preload, sender check, menus), with screenshots in
  `docs/research/spike-evidence/s1/`.
- `docs/research/2026-11-16-spike-s4-electron-e2e.md`: Playwright `_electron`
  relaunches the packaged app and the text comes back offline; the spec is
  kept as a reference for P2.5.

#### Changed

- Desktop specs: the app origin is `app://tinydocy` with a YouTube Referer
  rewrite (D-A11); `pageExtensions` covers pages and routes while metadata
  files are moved aside for the desktop build (D-A9); main, worker and
  preload stay CJS bundles that find their files through
  `app.getAppPath()`.

### Storage and packaging spike results (S2, S3)

- **Docs:** Phase 1 storage and packaging spike results (S2, S3) and the
  decisions they settle: the storage worker stands until S5 decides D-A1,
  `bun electron-builder` with no `node` exception, the update-channel
  mapping with `allowDowngrade` reset last, and signed Linux manifests.
  Documentation only; no app or server change.

### Two tabs editing one document offline keep each other's edits

Each save now reads, merges and writes the device copy in one IndexedDB
transaction.

#### Fixed

- A second tab's save no longer drops the first tab's offline edits.
- Each save carries its own id, so a tab never mistakes another tab's save
  for its own, even one of the same size in the same millisecond.

### Offline copies keep unsynced edits after a slow read

When the device copy took longer than 1 s to read, the next save replaced it
with the server's state and edits made offline were lost. Saves now merge into
the stored copy.

#### Fixed

- A copy read after the 1 s timeout stays on the device and opens on the next
  visit.

### Playwright CI job gets 45 minutes

The Playwright job was cancelled at its 30-minute limit on busy runners
before its tests finished, failing pull requests whose tests all passed.

#### Changed

- The Playwright (Chromium) job's `timeout-minutes` rises from 30 to 45. The
  lint, typecheck, unit test and build job stays at 20.

### Link underlines and dark link colour

Document links stay underlined everywhere (WCAG 1.4.1), set slightly below the
text.

#### Fixed

- Dark-mode document links are brighter (≥4.5:1): `#5b9cf2` reads at 7.05:1 on
  the page and 6.39:1 on cards, instead of 4.39:1 and 3.98:1.

#### Changed

- The underline sits `0.15em` below the text, clear of descenders.

### Identity validation

Your name and caret colour are checked before they are sent to
collaborators, and collaborators' names are cleaned before their carets are
drawn.

#### Fixed

- A stored colour outside the 8 swatches, or a name with control,
  direction-override or zero-width characters, is repaired.
- Blocked browser storage no longer breaks the editor; the identity lasts for
  the session.
- The identity dialog says "Enter a name." or "Use 32 characters or fewer."
  instead of silently keeping the old name, and counts emoji and Persian names
  correctly.
- Names are capped in length and in stacked accent marks, so a collaborator's
  name can no longer draw over the document.

### System theme

New browsers follow the system's light or dark setting, from the first paint and live as it changes.

#### Added

- ⋯ › Appearance offers System, Light and Dark. The row button still switches between light and dark.
- On phones, which have no ⋯ menu, the theme button in the Aa sheet steps through System, Light and Dark. Its label says what comes next.

#### Fixed

- The palette's Switch theme works.

#### Changed

- Browsers that used TinyDocy before keep Light (written once on the next load) or the Dark they chose.

### Shortcut clashes

⌘⇧R only aligns right, also on the Playground, and outside the editor it
reloads the page again. Regenerate Playground is in the Alt+/ palette, the
keyboard path to the Playground tab's Regenerate button.

#### Added

- Alt+/ › Regenerate Playground, listed only on the Playground (no key).

#### Fixed

- ⌘⇧R no longer regenerates the Playground; the Regenerate button's tooltip
  no longer shows it.

#### Changed

- Desktop builds (`NEXT_PUBLIC_APP_TARGET=desktop`) bind Subscript to ⌘⇧, so
  that ⌘, can open Settings. The web keeps ⌘,; Strikethrough keeps ⌘⇧S.

### Image privacy

Inserted and pasted images no longer carry camera metadata.

#### Fixed

- JPEG photos are always re-encoded, which removes Exif and GPS location and
  bakes in the rotation.
- PNG and WebP keep their pixels but lose text, time, Exif, XMP and unknown
  chunks. A PNG or WebP carrying an Exif rotation is re-encoded instead.
- Re-encoded JPEGs (Safari, which cannot encode WebP) lose the Exif and
  Photoshop segments its encoder adds.
- New images get empty alt text instead of the file name.

#### Changed

- Small JPEGs over 1600 px on the longest side are now downscaled, and
  re-encoded JPEGs are converted to sRGB.
- GIFs are unchanged, so animations keep working.

### Desktop smoke test (D-A12)

- **CI:** a desktop smoke test checks, on every Electron bump and nightly,
  that `node:sqlite` loads, WAL works, SQLite runs in a worker thread and a
  custom app protocol serves pages (D-A12).

### Dark primary text contrast

In dark mode, primary-coloured text, borders and lines (the heading filter's
ALL button, link-style buttons, the outline's drag drop line, the privacy
notice border and the table picker's cell borders) use a new `--primary-ink`
token.

#### Fixed

- Dark primary text reads at 9.3:1 on the page instead of 2.8:1. Light mode
  and filled primary buttons are unchanged.
- The outline's drop line reads at 8.4:1 on the dark sidebar instead of
  2.5:1.

### Desktop local-first planning documents

Adds the planning set for TinyDocy Desktop: the installable app for macOS,
Windows and Linux, the personal web library, live sharing and comments.
Documentation only; no app or server change.

#### Added

- `docs/superpowers/specs/`: the desktop design (v8, decisions D0–D41),
  architecture, UX, details, preferences, web library, image store,
  comments, onboarding and import, languages, search and linking, phones and
  tablets, brand and website, test and release strategy, and the post-v1
  roadmap.
- `docs/research/`: the research reports behind them.
- `docs/design/2026-11-15-desktop-prototype.html`: a throwaway clickable
  prototype.
- `docs/superpowers/plans/`: the Phase 1 implementation plans (web fixes and
  spikes).

### Deploy workflow

Production now deploys through a manual GitHub workflow,
`.github/workflows/deploy.yml`. `gh workflow run deploy.yml` deploys the tip
of `main`; `-f ref=<sha>` deploys a specific commit of `main`.

- **Checks before deploying.** The workflow refuses a commit unless it is on
  `main` and its CI run on `main` passed, waiting for that run if needed. It
  never checks out or runs repository code on the runner.
- **SSH.** It connects to the host with strict host-key checking. The key's
  `authorized_keys` entry is a forced command, so the key can only run
  `scripts/deploy.sh`.
- **On the host, `scripts/deploy.sh`:**
  - accepts only a full SHA on `origin/main`, never moves backwards, and
    refuses a checkout with local changes;
  - builds Next.js in a second checkout while the site keeps serving;
  - restarts Hocus from `ecosystem.config.cjs`, then swaps `.next` (the
    previous build stays in `.next.prev`) and restarts Next.js;
  - puts the previous build back if Next.js does not answer within 90 s.
- **Serialised.** One deploy at a time, by the workflow's concurrency group
  and a lock on the host.
- **Tests.** A unit test checks that the script refuses anything but a
  full SHA before it runs anything.

See `docs/operations/deploy-runbook.md`.

#### Deploy

One-time setup, done by the operator (the runbook gives the commands):

- check that the host's plain SSH session finds `bun`, `git`, `flock` and
  `curl` and can `git fetch`, and move any env the running PM2 apps have but
  `ecosystem.config.cjs` lacks into the file first;
- create a deploy key and add it to the host's `authorized_keys` with the
  `restrict,command="…/scripts/deploy.sh"` prefix;
- create the `production` environment, limited to `main`, with the
  `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY` and `DEPLOY_KNOWN_HOSTS`
  secrets (`DEPLOY_PORT` if SSH is not on 22);
- `git pull --ff-only` once on the host, so the script exists there before
  the first run.

Production env now has to live in `ecosystem.config.cjs`, because every
deploy restarts with `--update-env` from that file.

### Legacy highlight rewrite on in the PM2 config

`ecosystem.config.cjs` now sets `HOCUS_REWRITE_LEGACY_HIGHLIGHTS=1` for
`editor-hocus`, so Hocus rewrites stored legacy highlight colours
(`var(--tt-color-highlight-X)`) to their token as each document loads.
Production has run with it since 2026-11-15 (set with
`pm2 restart --update-env` and `pm2 save`); the config now matches, so
`pm2 start` or `pm2 reload ecosystem.config.cjs` keeps it.

#### Deploy

No action: the running process already has the flag. The next
`git pull` brings the config in line with it.

### Seed out of undo history; stable bubble-in-row matrix

The selection bubble's "bubble-in-row matrix" e2e test failed about one
run in seven under load, in Chromium and WebKit. It had two causes, one
of them in the app. The editor chunk grows by 18 B (the y-tiptap patch);
the palette's first Alt+/ is unchanged.

#### Fixed
- Undo could remove a document's seeded content. A change made with
  `addToHistory: false` (the Playground seed, which has headings) still
  became an undo step: UniqueID and the outline add heading ids in a
  transaction appended to it, and y-tiptap took the history flag from
  that last transaction. Undo was enabled on a fresh Playground, and Undo
  wiped it, together with any edit made within the next 500 ms (the Yjs
  undo manager merges changes that close). `@tiptap/y-tiptap` 3.3.0 is
  patched (`patches/@tiptap%2Fy-tiptap@3.3.0.patch`) so an appended
  transaction keeps its root transaction's `addToHistory: false`. User
  edits stay undoable as before.
- `selection-bubble.spec.ts`: the matrix test loaded its fixture as an
  undo step, so its first Bold could join the fixture and the undo after
  it wiped the page ("some words" not found). Fixtures in that spec now
  load outside the undo history, as the app seeds a document.
- The same test lost a click on the bubble (the Link popover never
  opened, or a mark was missing): when the bubble was still sliding in,
  Playwright retried the click and scrolled the page, which brought the
  text under the sticky row; the bubble flipped below the text between
  mousedown and mouseup, and the click landed on the page. The matrix now
  runs on a page too short to bring the text under the row.

#### Deploy
- Run `bun install` before `bun run build`: the new `patchedDependencies`
  entry patches `@tiptap/y-tiptap` at install time.

### No unstyled flash of lazy surfaces in Safari

The editor chunk goes from +19,519 B to +19,679 B of the 23.5 KB budget
(+160 B); the palette's first Alt+/ is unchanged (20,475 B). Nothing to do
when deploying.

#### Fixed
- Safari: the phone bar could show unstyled for a moment (Redo and the
  Insert label shown, cells narrower than 44px), and the colour popover
  as a column of bare icons, when another lazy stylesheet was still
  loading, such as a window narrowed below 768px while the desktop
  surfaces were still preloading. Safari keeps a loaded stylesheet inactive until every other
  one has loaded or failed, so a lazy chunk could render before its own
  CSS applied. The phone bar, every lazy surface (colour popover, Insert
  steps, selection bubble, diagram templates, Your formats, the Continue
  chip) and the palette now render once the CSS loaded so far applies
  (`lib/styles-applied.ts`), at once outside Safari. A stylesheet that
  failed (offline) does not count, and none waits longer than 1.5 s.

### Paint format pressed before the formatting tools load

No schema or protocol change; no Deploy note. The editor chunk grows by
10 B (the shared "Couldn’t load formatting tools." string); the palette's
first Alt+/ is unchanged (20,475 B).

#### Fixed
- The Paint format brush (selection bubble and phone selection cells)
  pressed before the lazy formatting engine had loaded did nothing
  visible, and the press was dropped as soon as the user selected the
  text to paint: early actions run only if the selection has not moved,
  and for the brush the next selection is the point. The brush now shows
  pressed at once, with the copy cursor and the pill, keeps the text it
  was pressed on (following edits, a collaborator's too), and once the
  engine lands arms on that text and paints a mouse selection made
  meanwhile (on touch, the second tap) if it is still the selection then.
  As when armed, the mouse selection is read a frame after the pointer-up
  and only a non-empty one counts: a plain click then Shift+arrows only
  arms, and the keyboard selection takes the brush or ⌘⌥V. A second press
  on the same text or Esc cancels; a failed load says so with Retry.
  Other early actions still run only on an unmoved selection.

### No colour preview over inline code

The hover preview of a colour swatch now shows only what applying does.
No schema or protocol change; no Deploy note. The editor chunk grows by
109 B, to +19,628 B of the 23.5 KB budget (4,436 B left); the palette's
first Alt+/ is untouched.

#### Fixed
- Resting on a text colour or highlight swatch painted the colour over
  inline code and code blocks in the selection, although applying never
  colours them (inline code excludes every mark; a code block allows
  none). The preview now skips the text the mark cannot go on, decided by
  the editor schema the same way applying is, so that text keeps its
  selection tint. `setActionPreview` takes `{ attrs, mark }`.

### Phone sheet: Remove and Restore keep keyboard focus

In the phone "Text format" sheet, Remove a format and "Restore ‘X’"
unmounted the button that had keyboard focus, which fell to the sheet
itself. No schema or protocol change; no Deploy note. The editor chunk
measures 1 B more (build noise: only lazy phone-bar code changed); the
palette's first Alt+/ is untouched.

#### Fixed
- After a remove from a hardware keyboard, focus moves to the next
  remove button (the previous one after the last), or to the "Your
  formats" heading once the list is empty, with the buttons' focus ring.
- After "Restore ‘X’", focus moves to the restored format's button.
- Opening the sheet at its Remove list (the Save dialog's cap link)
  focuses the first remove button once; before, every new first row
  took focus again, e.g. after a restore.
- Taps leave focus where it was, and the status pill's announcements are
  unchanged.

### Phone status pill clear of the footer chips

CSS in the lazy phone bar chunk, plus a slash menu load retry that adds
3 B gzipped to the editor chunk; the palette's first Alt+/ is untouched.
Nothing to do when deploying.

#### Fixed
- On a phone the status pill (a refused "/" pick, a removed format's Undo,
  an unavailable cell's reason) covered the presence chip and the
  Discord, GitHub and Privacy chips: it spans the bar's width 8 px above
  it, in the chips' band. The chips now hide while a pill shows on the
  bar, as they already did for the selection bar, and come back when it
  closes (design pass §5).
- After the "/" menu's chunk failed to load, a "/" typed while that
  failed fetch was still settling (the runtime fetches a failed chunk once
  more, a moment later) never opened the menu, even once the chunk could
  load. A failed load is now fetched once more at once.

### Toolbar roving skips Base UI focus guards

The toolbar's roving tabindex no longer takes over the focus guards Base
UI renders around an open menu or popover's trigger. No schema or
protocol change; no Deploy note. The editor chunk grows by 25 B; the
palette's first Alt+/ is untouched (it does not load the toolbar).

#### Fixed
- With a menu open and focus back on its trigger (a screen reader's
  cursor can do this), ArrowRight closed the menu and threw focus out of
  the toolbar into the document: the toolbar counted Base UI's
  `tabindex="0"` guards as items, stamped them `tabindex="-1"` and
  `data-toolbar-item`, and roved onto them. It now skips them, in every
  engine (on Safari they also carry `role="button"`), and never rewrites
  their `tabindex`. Tab and Shift+Tab out of an open menu, and from its
  trigger, behave as before.

#### Added
- `toolbar-focus-guards.spec.ts`: the guards keep `tabindex="0"` and no
  `data-toolbar-item` with the text style and list menus open; Tab and
  Shift+Tab out of an open menu and from its trigger; arrows from the
  trigger of an open menu reach the same items as with it closed.

### Filtered sections re-fold after collaborator edits

With a heading filter applied, the folds now follow edits that change
which sections match, such as a collaborator renaming or adding a heading.
No schema or protocol change; no Deploy note. The editor chunk grows by
198 B (gzip, measured against `main` on the same machine); the palette's
first Alt+/ is untouched.

#### Fixed
- A heading filter folded the unmatched sections only when its words or
  mode changed. A collaborator renaming a heading so it now matches (or no
  longer matches), or adding a section, left the folds stale. Now, 250 ms
  after such an edit (as often as the outline rebuilds), the filter
  unfolds the sections that started to match and folds the ones that
  stopped matching. Folds you set yourself stay as they are, the section
  holding your caret is never folded, and nothing moves while you type a
  new filter word.
- Pressing Enter within 250 ms of typing a filter word committed it, but
  the word's pending preview landed afterwards and stayed applied. Closing
  the filter bar or clearing the filters had the same race. A pending
  preview is now dropped on commit, close and clear.

#### Added
- `tests/e2e/filter-collab.spec.ts`: a collaborator's rename unfolds the
  section on a filtered reader's screen, and a section they add that does
  not match arrives folded.

### A refused "/" pick puts the query back in the right place

No schema or protocol change; no Deploy note. The editor chunk and the
palette's first Alt+/ are unchanged (0 B); the "/" menu's chunk grows by
224 B, to 5,784 B of its 6 KB budget.

#### Fixed
- When a "/" menu pick was refused after its "/query" had been removed
  (the run declined, or the document changed under it), the text went
  back at the position it had before the pick, ignoring anything
  dispatched in between: a wrap in a quote or a paragraph added above
  left "/query" in the wrong block and the caret one character off. The
  position is now mapped through every change made meanwhile, in the
  order they applied; nothing is put back when the line itself is gone.

### Filter links carry at most 8 words

A `?filter=` link applies on load, and each of its words is matched
against every section, then again on every edit, so a crafted link with
thousands of words could stall the reader's tab. No schema or protocol
change; no Deploy note. The editor chunk goes from +19,519 B to +19,595 B
of the 23.5 KB budget (4,469 B left); the palette's first Alt+/ is
untouched (20,475 B).

#### Security
- A filter link keeps its first 8 distinct words, each cut to 64
  characters (never inside an emoji), and drops the rest; the URL then
  shows only the words applied. Real filters are a few short words, so
  the cap bounds the matching work at 8 × 64 characters per section
  (`MAX_FILTER_WORDS`, `MAX_FILTER_WORD_LENGTH` in
  `extensions/heading-filter/helpers/filter-url.ts`). Filters added in
  the filter bar are not capped.

### Guardrail refusals without a stack trace

Server only; the editor chunk and the palette's first Alt+/ do not change.
Nothing to do when deploying beyond the usual Hocus restart.

#### Fixed
- Every guardrail refusal (`document_deleted`, `invalid_document_name`,
  `ws_connection_limit_exceeded`, `doc_creation_rate_limit_exceeded`,
  `max_total_documents_exceeded`) printed a Bun code frame and an
  `[onConnect]` or `[onLoadDocument]` hook error to the Hocus error log next
  to its `ws_guardrail_rejected` abuse line: emptying `.stack` does not stop
  Bun's code frame. Hooks now throw a plain `{ reason }` value
  (`guardrailRefusal()` in `lib/security/guardrail-refusal.ts`), as
  outdated-client refusals already do, so each refusal writes only its abuse
  line. Clients get the same reasons and the abuse lines are unchanged.

### WebKit compatibility pass

A `webkit` Playwright project runs the core editing specs in Safari's
engine (by hand; CI still runs Chromium only), and the Safari bugs it
found are fixed. No schema or protocol change; no Deploy note. The editor
chunk grows by 1 B, to +19,284 B of the 23.5 KB budget (4,780 B left);
the palette's first Alt+/ is untouched.

#### Added
- `bun playwright test --project=webkit` (after
  `bun playwright install webkit`): toolbar, selection bubble, Paint
  format, palette, "/" menu, Continue chip, hover preview, phone bar,
  collaboration and leak specs. Tests that need Chromium's DevTools
  protocol (heap and listener counts, raw touch drags, CPU throttling) or
  forced colours skip there; `tests/TESTING.md` lists what WebKit does
  differently.

#### Fixed
- Safari: the selection bubble could open on top of the selected line
  instead of above it, so a drag over the next words hit the bubble and
  Paint format never applied. Safari keeps a loaded stylesheet inactive
  while another one is still loading, so the bubble was placed before its
  lazy stylesheet made the scroll container its containing block, then
  dropped 38px when it did. That rule now lives with the container's own
  styles.
- Safari: the code language select in the phone's Aa sheet (below 360px)
  was 22px tall; it is 44px, like every other target there.
- Safari: Back (✕) on the phone's selection cells, pressed from the
  keyboard, left focus on Insert instead of the bar's first cell: WebKit
  fires no `focusout` for the removed button, so the toolbar's own focus
  repair ran first.

### The outline follows a heading jump

The editor chunk goes from +19,283 B to +19,355 B of the 23.5 KB budget
(+72 B); nothing to do when deploying. Headings themselves land where they
did: the editor's scroll area already keeps jump targets clear of the
toolbar (`scroll-padding-top`, measured flush under it at 800 to 1440 px),
and a heading `scroll-margin-top` on top of it would land them 44 px lower
and make the outline mark the heading before as active. Whether the
outline centres or tops its heading is unchanged.

#### Fixed
- After a jump (an outline pick, the Continue chip's Go) or a scroll, the
  outline now keeps the active heading's row in view (as
  `block: "nearest"`). Go to Section 45 of a long document used to leave
  the outline showing Sections 1 to 25. Only the outline's own box
  scrolls: `scrollIntoView` would also move the page the jump has just
  positioned. A drag, or the drop that ends it, never scrolls it.
- The docked outline stuck 16 px from the top of the scroll area, so its
  top 28 px (the "Outline" header, or the active row) sat under the
  sticky toolbar once the page scrolled. It now sticks right below the
  toolbar (`--tt-toolbar-height`), where it already starts.

### Colour popover keeps clear of the selection

The editor chunk goes from +19,283 B to +19,381 B of the 23.5 KB budget
(4,683 B left; the avoidance itself is in the lazy colour chunk), and the
first Alt+/ palette load is unchanged; nothing to do when deploying.

#### Fixed
- The text colour and highlight popovers, opened from the toolbar row with
  the page at the top, covered the first lines of the document, hiding the
  very words the hover preview colours. The popover now keeps off the
  selection: it slides along the row while it still spans its button, or
  else opens just below the selected lines, still under its button.
  Keyboard focus, the selection bubble's popover and the phone's Aa sheet
  are unchanged.

### Accurate "Default text" and "No highlight" previews

No change to the editor chunk (the rules load with the colour popover);
nothing to do when deploying.

#### Fixed
- Hovering "Default text" or "No highlight" now previews exactly what
  applying gives over links, inline code and table header cells. The
  preview used to paint the page's text colour and background, so a
  coloured link previewed black instead of link blue, inline code lost
  its grey box and colour, and a highlighted header cell lost its tint.
  Inside the mark it previews away, the preview now reads what is under
  that mark (the page, a link's colour, or the header tint over the
  page); elsewhere it lets the context's own colours show through.

### Previewed colours stay true under the phone sheet

In the lazy phone bar and colour chunks: the editor chunk and the
palette's first Alt+/ chunk are unchanged; nothing to do when deploying.

#### Fixed
- On a narrow window with a mouse, the "Text format" sheet's scrim dimmed
  the document, so a colour previewed by hovering a swatch showed darker
  than applying it would. While a preview shows, the scrim now fades
  clear (it still catches taps) and comes back when the preview ends.
  Touch never previews, so its scrim is unchanged.
- Opening that sheet with a mouse could preview a colour nobody pointed
  at: the swatch that slid up past the still pointer kept the hover, so
  its colour showed on the selection and the scrim cleared. A swatch now
  previews only once the mouse moves over it.

### Colour preview from the keyboard on touch devices

The editor chunk is unchanged (+19,281 B of the 23.5 KB budget; the
change is in the lazy colour chunk) and the first Alt+/ chunk is
unchanged; nothing to do when deploying.

#### Fixed
- On a touch-first device (`pointer: coarse`), such as an iPad or an
  Android tablet with a hardware keyboard, arrowing through the colour
  swatches showed no preview: the preview was gated as a whole on a fine
  hovering pointer. Arrow keys now preview there as on a desktop, while a
  tap, or a pointer such as an iPad trackpad, still previews nothing and
  does not clear the keyboard's preview. Forced colours and
  `NEXT_PUBLIC_ACTION_PREVIEW=0` still turn previews off everywhere.

### Clear marker on the previewed colour swatch

The editor chunk does not grow (the change is in the lazy colour panel);
nothing to do when deploying.

#### Fixed
- In the colour popover the swatch under the mouse, the one previewed on
  the selection, only darkened its border, while a mouse-opened popover
  put its full focus ring on the pressed swatch, so the ring pointed at
  the wrong colour. The swatch under a mouse or pen now wears the focus
  ring (Highlight in forced colours, with or without a preview), and
  keyboard focus on another swatch steps down to a dashed 1px ring until
  an arrow key hands the ring back. Touch shows no marker; the Aa sheet's
  colours behave the same.

### "/" menu says why a pick was refused

The editor chunk goes from +19,283 B to +19,270 B of the 23.5 KB budget
(4,794 B left); the "/" menu chunk grows by 50 B gz (5,341 B of 6 KB) and
the first Alt+/ not at all; nothing to do when deploying.

#### Fixed
- A "/" menu row whose block could no longer go there (the document
  changed after the menu opened, for example a collaborator wrapped the
  line in a quote) closed the menu and did nothing, without a word. The
  status pill, and the screen reader, now say why, in the menu's own
  words ("Quote: Already in a quote."), and "/quo" stays as typed. A
  pick that was allowed but did nothing still says nothing.

### Home, End, Page Up and Page Down in the "/" menu

The code is in the lazy slash chunk only (5,509 B gz of its 6 KB budget);
the editor chunk is unchanged (+19,282 B of the 23.5 KB budget) and the
palette chunk is untouched; nothing to do when deploying.

#### Added
- The open "/" menu takes Home and End (first and last option) and Page Up
  and Page Down (the farthest option still on one screen of the list with
  the active one, never wrapping). The editor's `aria-activedescendant`
  follows, and the active option scrolls into view. Modified keys
  (Shift+End, Ctrl+Home) and every key while the menu is closed stay
  caret keys.

### Paint format keyboard test waits for the brush to arm

Test only: no app code changes, and the editor chunk is unchanged (0 B).
Nothing to do when deploying.

#### Fixed
- `paint-format.spec.ts` "activating the brush again applies to the new
  selection" failed intermittently on loaded CI runners. It clicked the
  brush and moved the selection at once. A click that lands before the
  lazy formatting engine has loaded waits for it, and is dropped if the
  selection has moved by then, as designed, so the brush never armed.
  The test now waits for the brush to show as pressed before it selects
  the next text, as the other Paint format tests do.

### Status pill stays clear of a bubble that appears later

The editor chunk is unchanged (−2 B, loader hashes); the selection bubble
and phone bar chunks, which hold the pill, grow by 136 B and 153 B gz; the
palette's first Alt+/ is byte-identical. Nothing to do when deploying.

#### Fixed
- On desktop the status pill moved beside the selection bubble only if the
  bubble was already there when the notice showed. A bubble that appeared
  or moved afterwards (a new selection, a scroll) could sit under the pill,
  covering the brush. While it shows, the pill now places itself again,
  at most once a frame, whenever the bubble appears, moves, closes or
  scrolls, and goes back under the row's centre once the bubble is gone.
  Its observers stop when it closes.

### Restore a removed format from the phone sheet

The editor chunk goes from +19,283 B to +19,296 B of the 23.5 KB budget
(13 B: one more export of the eager actions module); the code is in the
lazy phone bar chunk (+142 B gz) and the first Alt+/ chunk is unchanged.
Nothing to do when deploying.

#### Added
- On phones, the Aa sheet's Your formats offers "Restore ‘X’" for the
  last removed format, until the next removal, a restore or a reload.
  Phones have no Alt+/ palette, so the status pill's 5-second Undo was
  the only way back. It runs the same `formats.restore` action as the
  palette: it puts the format back where it was, keeps the sheet open
  and, when it cannot run (the name was saved again, or the 20-format
  cap), says why on a visible line. Full width, 44 px tall, no sideways
  scroll at 320 px.

### One label for saving a format

The editor chunk goes from +19,283 B to +19,284 B of the 23.5 KB budget
(4,780 B left); the first Alt+/ palette chunks stay at 20,475 B. Nothing to
do when deploying.

#### Changed
- Saving a format is called "Save selection as format…" everywhere: the
  Alt+/ palette said "Save as format…" while the text style dropdown and the
  phone's Aa sheet said "Save selection as format…". The save view's title is
  now "Save selection as format" too. The dropdown and the sheet read the
  label from the `formats.save` action, so the three can no longer drift
  apart. Typing "save as format" in the palette still finds it.

### Align items with icons and shortcuts

Menu chunk only: the editor chunk and the first Alt+/ palette load are
unchanged; nothing to do when deploying.

#### Changed
- The four align items in Align ▾ and in the T3 ¶ (Paragraph) menu now
  show their icons and shortcuts (Mod+Shift+L, E, R, J), like Outdent and
  Indent beside them in ¶, which used to leave them as inset text. The
  radio check sits in a fixed slot before the shortcut, so every shortcut
  ends at one edge. Each item announces its keys with
  `aria-keyshortcuts`. All four keys reach the editor in Chromium
  (Mod+Shift+R does not reload and Mod+Shift+J does not open Downloads),
  and `toolbar-row.spec.ts` now checks it.
- A toolbar menu with these items grows to fit them, so "Ctrl+Shift+E"
  stays on its label's line off macOS; reason lines wrap within that
  width instead of widening the menu.

### One name for justified alignment

The editor chunk goes from +19,283 B to +19,208 B of the 23.5 KB budget
(4,856 B left); the first Alt+/ palette load is unchanged (20,475 B);
nothing to do when deploying.

#### Changed
- The Align ▾ trigger now takes its name and icon from the `align.*`
  registry action instead of its own copy of the labels, so the trigger,
  the menu items, the ¶ menu, the palette and the phone Text format sheet
  share one source: "Align left", "Align center", "Align right" and
  "Justify". The old "Align justify" tooltip wording left with the
  pre-registry text-align button; no visible wording changes.

### Trash icon on Delete row and Delete column

The editor chunk goes from +19,283 B to +19,282 B of the 23.5 KB budget
(the icon is in the lazy menu chunk); nothing to do when deploying.

#### Changed
- In the table's Row ▾ and Column ▾ menus, and in the Table tools menu
  that stands in for them on narrow windows and phones, Delete row and
  Delete column now have a trash icon and line up with the other items,
  instead of inset text with an empty icon column. The palette and the
  phone "Text format" sheet are unchanged.

### Image resize gripper survives plugin view rebuilds

The editor chunk grows by 116 B gzipped (measured +19,283 B to +19,399 B
of the 23.5 KB budget); nothing to do when deploying.

#### Fixed
- Hovering an image while a lazy chunk was still loading could hide its
  resize gripper and media toolbar at once, and a resize drag could stop
  midway. A lazy chunk that registers a plugin (the selection bubble's
  `BubbleMenu`) reconfigures the editor; ProseMirror then destroys and
  recreates every plugin view, and the destroy hooks of
  `@docs.plus/extension-hypermultimedia`'s media controls hide the active
  gripper and abort a running drag. The editor now uses
  `extensions/hyper-multimedia/`'s `HyperMultimediaKit`, which skips those
  two destroy hooks when only the plugin list changed; they still run when
  the editor is destroyed or the plugin is removed. This retires the
  "known, not fixed" note from the resize gripper test fix, and the test
  no longer waits for the bubble's plugin before hovering.

### Shared filter links apply on load

The editor chunk goes from +19,283 B to +19,294 B of the 23.5 KB budget;
nothing to do when deploying.

#### Fixed
- Opening a link with `?filter=…` never applied the heading filter: the
  filter hook wrote its empty state to the URL on its first render, before
  the editor existed, so the query was gone by the time it was read (and
  React's development remount stripped it again). The link's filter is now
  read on mount and applied after the first server sync, so it folds the
  real sections, not an empty or stale device copy. The URL keeps the
  filter until then, and mirrors it afterwards as before.
- A hand-typed filter link with a bare `%` (`?filter=50%25`) threw while
  decoding; that slug is now kept as typed.

### Outdated-client refusals without a stack trace

Server only; the editor chunk does not change. Nothing to do when deploying
beyond the usual Hocus restart.

#### Fixed
- Every refused outdated client printed a Bun code frame and stack trace to
  the Hocus error log. Hocuspocus logs a hook error whenever it has a
  `message`, and Bun's code frame ignores the emptied `.stack`. `onConnect`
  now throws a plain `{ reason: "client_outdated" }` value instead, which
  Hocuspocus still sends to the client as the refusal reason but does not
  log; refusals show up only in the per-minute `client_schema` aggregate.

### Quiet production build: quoted highlight colour keys

Build output only: the compiled CSS is byte-identical, so the editor chunk
and the first Alt+/ palette chunk do not change; no Deploy note.

#### Fixed
- `next build` printed ten Sass warnings from the document highlight rules:
  the token list held bare colour names (`gray`, `blue`, ...), which Sass
  reads as colours and warns about when interpolated into a selector. The
  names are now quoted strings, like the maps in `text-style-marks.scss`
  already were, and the build compiles without Sass warnings.

### Selection bubble brush size test tolerates sub-pixel boxes

Test only; no app, schema or protocol change; no Deploy note.

#### Fixed
- `selection-bubble.spec.ts` checked the Paint format brush's box with an
  exact `toBe(28)`, and a CI runner measured 28.000015 px. It now uses
  `toBeCloseTo(28, 1)` for the width and height.

### Menu focus after a quick second open

The editor chunk goes from +19,248 B to +19,283 B of the 23.5 KB budget
(4,781 B left); nothing to do when deploying.

#### Fixed
- A toolbar menu opened while the previous one was still animating out
  (Esc, then a click on another menu) closed again at once: when the old
  popup unmounted, Base UI moved focus back to its trigger. Toolbar menus
  and the desktop List menu now return focus to their trigger only while
  it is still lost with the closing menu, as the Insert menu's step
  already did. This turned `toolbar-ladder.spec.ts` red on slower CI
  runners.

### Continue chip phone test waits for the page to stop

Test only; no app, schema or protocol change; no Deploy note.

#### Fixed
- The 375px touch test of "Continue where you left off" tapped Go 300 ms
  after its touch pan, while the page was still coasting. On Linux,
  Chromium treats a tap that stops a coasting page as stopping the scroll
  rather than as a click, as phones do, so the chip stayed and `main`
  went red. The test now checks that the pan scrolled the page and taps
  Go once the page is at rest.

### "/" block menu

Type "/" at the start of a line, or after a space, for a short menu of
text styles, lists and Insert kinds under the caret: one more view of the
action registry, with no command of its own (plan
`docs/superpowers/plans/2026-11-13-smart-toolbar-later-slash-menu.md`,
contract amendment A17). No schema or protocol change; no Deploy note.

The editor chunk grows by 888 B, to +19,248 B of the 23.5 KB budget
(4,816 B left); the budget is unchanged. The menu is a lazy chunk
of 5,291 B gz (budget 6 KB), fetched when the browser is idle. The
palette's first Alt+/ is unchanged, file for file (403 B + 20,072 B =
20,475 B).

#### Added
- Typing "/" in a paragraph (including list items, quotes and table
  cells) at the block start or after whitespace opens a listbox under the
  caret: Text (Normal text, Heading 1–3; "/h4" finds 4–6), Lists, Insert
  (the table at its last size, shown as "3 × 3") and Diagrams (the five
  templates, the last used one noted). Typing filters by word prefix over
  labels, keywords and Markdown shortcuts ("/h2", "/##", "/quo", "/pic");
  each section shows once, best match first.
- Enter or a click applies the block and removes "/query" as one undo
  step; Esc leaves the text as typed. "/" then Enter, with nothing typed
  or arrowed, stays a line break. A match that cannot go here says why
  ("Quote: Already in a quote."); a finished word with no match closes the
  menu, as do "1 / 2", "/usr/bin" and a query over 24 characters.
- It never opens mid-word ("and/or"), in URLs, the title, headings, code,
  inline code, a read-only document or from a collaborator's typing; a
  collaborator deleting the "/" closes it.
- Focus never leaves the editor: the editor carries `aria-controls`,
  `aria-autocomplete`, `aria-haspopup` and `aria-activedescendant` while
  the menu is open, and a polite live region says "Block menu, 18
  options.", then each active row ("Table, 3 by 3, 9 of 18"). IME composition keeps its
  keys. Rows are 44 px on touch, and a tap keeps the phone keyboard; the
  list flips above the caret near the bottom, the phone bar and the
  keyboard (never apart from its caret: when content above the caret
  changes size or the keyboard opens, the caret is scrolled back into view
  first), and spans the screen below 640 px.

### Continue where you left off

Reopening a document offers a way back to the section you were in (spec
M15): a small chip above the title, "Continue where you left off ·
*Section*", with Go and ✕. No schema or protocol change; nothing to
deploy beyond the app.

The editor chunk grows by 475 B, to +17,724 B of the 23.5 KB budget
(6,340 B left); the budget is unchanged. The chip, its recorder and its
styles load as one lazy chunk (2.5 KB gz) when the browser is idle. The
palette's chunks are unchanged.

#### Added
- The place is remembered on this device only (`tinydocy-continue`: the
  section heading's id and a time, never text; 30 documents, 14 days),
  when you leave the text after choosing a place in it. A place in the
  title or the first sections is not offered. `NEXT_PUBLIC_REMEMBER_CHOICES=0`
  turns it off; "Forget my choices" keeps it, like the outline and folds.
- The chip shows after the server confirms the document (not offline, not
  in Playground, not when the heading is gone or hidden by a filter). It is
  never focused or announced and moves nothing. Go unfolds the sections
  hiding the heading, puts the caret at its end and scrolls it to the top,
  as an outline pick does. Your first click, key or typing in the
  document, Dismiss or Esc removes it until the next open; a touch scroll
  does not.
- Phones show "Continue · *Section*" above the presence chip and the bar;
  touch tablets show it at the bottom too.
- The section name is shown without control, invisible or bidi-control
  characters, so a collaborator's heading cannot spoof the chip.

#### Changed
- The outline's jump to a heading is shared with the chip
  (`lib/heading-navigation.ts`) and now scrolls without animation when you
  prefer reduced motion.

### Colour hover preview

Pointing at a text colour or highlight swatch shows it on the selected
text before you apply it (amendment A14). No schema or protocol change,
and nothing to do when deploying.

The editor chunk goes from +17,249 B to +17,464 B of the 23.5 KB budget
(+215 B; 6,600 B left); the colour popover chunk grows by 641 B gz. The
palette is unchanged.

#### Added
- Rest the mouse on a swatch for 80 ms, or move to one with the arrow
  keys, and the selection shows that colour. Moving away, Esc, closing
  the popover, applying, or your own change to the text or selection
  removes it; a collaborator's edit keeps it on your moved selection.
  Opening the popover previews nothing, and holding an arrow key waits
  for it to settle. Works in the row and bubble popovers, and in the
  Text format sheet with a mouse.
- Previews are drawn with decorations only: nothing reaches the
  document, the undo history or collaborators. They are off on touch, in
  forced colours, when read-only, for an empty selection, and over more
  than 200 blocks or 20,000 positions. `NEXT_PUBLIC_ACTION_PREVIEW=0`
  turns them off.

### Simplified toolbar

A "Simplified toolbar" setting in ⋯ (and in the Alt+/ palette) shows the
row's compact set at every width (later-phase plan "progressive
disclosure"; contract amendment A15). It is off by default, changes only
when the writer turns it on or off, and never reorders the row. No schema
or protocol change.

The editor chunk goes from +17,249 B to +17,701 B of the 23.5 KB budget
(+452 B; 6,363 B left); the budget is unchanged. The palette's first
Alt+/ is unchanged at 20,475 B gz (the palette entry costs it nothing).

#### Added
- ⋯ → Simplified toolbar (a checkbox; focus returns to ⋯) and the palette
  entry "Simplified toolbar" (keywords: compact, fewer tools, minimal,
  full toolbar). The row then shows the ladder's T4 set at any width:
  alignment and indent behind ¶, the context slot as one button, the
  colour pair as one button, Outline and Filter behind View, size as one
  menu, Insert without its label, Theme in ⋯. Every tool stays one click
  away through those stand-ins; below the T4 width the ladder applies as
  before.
- The status pill confirms each change ("Simplified toolbar on" or "Full
  toolbar on") with Undo.
- The setting is remembered in this browser (`tinydocy-ui`), survives
  "Forget my choices" and is read before the first paint, so the full row
  never flashes on load. With `NEXT_PUBLIC_REMEMBER_CHOICES=0` the item is
  disabled with "Remembering choices is turned off."
- Turning it on or off keeps the row at one Tab stop, and a stop on a tool
  it hides moves to that group's stand-in.

#### Fixed
- When the responsive ladder hides the item holding the row's Tab stop,
  the stop now moves to that group's stand-in (¶, View, colour) instead
  of whichever item is now at the same position.

### Palette leak test baseline

#### Fixed
- **Tests:** `palette-leaks.spec.ts` compares window and document listener
  counts only once two reads 1.5 s apart agree. A tab left within the last
  second keeps its provider (and that provider's `pagehide` listener) until
  `collab-session`'s deferred release, so on a slower runner the baseline
  missed one listener the after-switches read still had (101 vs 102,
  failing `main` since #37). A listener leaked per switch still fails.

### Design sign-off follow-ups

What the design sign-off of the smart toolbar design pass (#35) left
open: two narrow-phone layout fixes, a palette way back from "Remove a
format", palette polish, and an idle prefetch for cold offline starts.

The editor chunk goes from +16,680 B to +17,249 B of the 23.5 KB budget
(6,815 B left, was 7,384 B); the idle prefetch trigger is 58 B of that.
The palette's first Alt+/ loads 20,475 B gz of its 20,480 B budget (5 B
left, was 36 B); single-entry sets in `palette-sections.ts` became plain
id checks to make room. Budgets are unchanged.

#### Added
- After a saved format is removed, the Alt+/ palette offers
  "Restore ‘X’" first under Suggested here, until the next removal, a
  restore or a reload. The pill's Undo lasts 5 s, which a keyboard user
  may not reach. Restore puts the format back where it was; a row that
  cannot run says why (the name is taken again, or the 20-format cap).
  It is never kept in Recent.
- When the browser is idle after the first server sync, the app also
  fetches the formatting engine, the announcer and, on desktop, the
  selection bubble with its status pill, so the service worker has them
  and a load failure on a cold offline start is still said.

#### Changed
- Palette: Paint format and Repeat formatting show their icons
  (Paintbrush, Repeat); the ⋯ menu's Paint format shows the brush too.
  Size rows read "Extra small text" instead of "Font size: Extra small".
- Phone Aa sheet: Save's reason line sits right under "Save selection as
  format…" (about 2px, was about 13px), so the two read as one item.

#### Fixed
- On narrow phones (320px) the empty title's placeholder wraps to two
  lines and covered the first body line. It is in flow now, so the title
  grows with it; the caret still starts the first line.

### Toolbar menu alignment

Three visual inconsistencies in the toolbar menus. The layout changes sit
in the lazy menu chunk; only the list labels are in the editor chunk,
which grows by 1 B to +16,680 B of the 23.5 KB budget (7,384 B left).

#### Fixed
- Items without an icon start their text in the icon column, beside the
  items that have one: Delete row and Delete column (Row ▾, Column ▾ and
  the T3 Table tools menu), Paint format and All actions… (⋯ More
  formatting), and the four align items in the T3 ¶ menu.
- In ⋯ More formatting, the plain items keep the toggles' check column,
  so every shortcut ends at the same edge.
- The desktop List menu says "Bullet list", "Numbered list" and "Task
  list", as the phone and the action registry do, and is as wide as its
  longest label.

### Touch-tablet toolbar test flake (fix/e2e-focus-title-race)

#### Fixed
- **Tests:** `EditorPage.focusTitle()` waits for the frame in which
  Tiptap's deferred `view.focus()` runs. In a touch context on a Mac
  host, Tiptap takes the browser for iOS and focuses the editor at once,
  so the helper returned early. The late focus then pulled focus back
  from the toolbar after Alt+F10, and the touch-tablet "no tooltips"
  test in `toolbar-surfaces.spec.ts` failed about one run in three under
  three workers.

### Lazy toolbar menus

Every toolbar menu's popup and items move out of the editor chunk into one
lazy chunk (owner decision O1, the "menu bodies lazy" lead in contract A9;
amendment A13). Nothing changes for the writer.

The editor chunk goes from +23,994 B to +16,679 B of the 23.5 KB budget
(7,385 B left, was 70 B); the budget is unchanged. The palette's first
Alt+/ loads 20,444 B gz of its 20,480 B budget (36 B left, was 8 B).

#### Changed
- The triggers and Base UI's menu root stay in the editor chunk; the
  popups, positioner and items (Text style, Alignment, List, Insert, ⋯,
  the context slot's menus, the ladder stand-ins and the phone List cell)
  load as one chunk on a trigger's hover or focus, when the browser is
  idle after the first sync, or on the first open, which waits for it.
  Keys pressed while it loads are replayed into the menu, so a keyboard
  open still lands on the first item and loses no key.
- A menu whose chunk does not load says "Couldn’t open the menu." on the
  status pill, with Retry, as the palette does.

### Smart toolbar follow-ups

Minors left by the a11y review of the smart toolbar (contract §10), and
the design pass of PR E's surfaces
(`docs/superpowers/specs/2026-11-13-smart-toolbar-design-pass.md`).

The editor chunk ends at +23,994 B of the 23.5 KB budget (70 B left);
the budget is unchanged. The palette's first Alt+/ loads 20,472 B gz of
its 20,480 B budget.

#### Fixed
- Back on the phone selection bar dismisses the cells for that
  selection only.
- The Repeat extend session merges into its own bundle, not the shared
  memory another tab may have replaced (bold here plus red here no
  longer repeats as the other tab's italic plus red); "Forget my choices"
  ends the session.
- Saved formats stay fresh across tabs with no component mounted (the
  palette no longer lists or applies a format another tab deleted).
- Format names also lose the soft hyphen, the Arabic letter mark, the
  word joiner and the invisible operators.
- Alt+/ no longer takes Option-hyphen (en dash) on German and Swiss Mac
  layouts: it needs a key that types "/" (or "÷" on US-like Mac
  layouts); Alt+Shift+Z stays the fallback.
- While the engine loads, remote and meta-only transactions no longer
  push the user's own out of the capped buffer, and every engine use
  records the buffer first.
- **Selection bubble:** the bubble stays while any of its popups is open
  (the colour dialog).
- **Action palette:** no zoom under reduced motion. Esc in the save view
  goes back to the list, with focus in the search field; a second Esc
  closes. The format name is capped at 40 characters (it was cut silently
  at 40 after accepting 160) with a visible "Up to 40 characters" hint,
  saving announces "Saved format ‘name’", and the same error or an
  unavailable action's reason is read again on every try.
- **Palette order:** Repeat formatting is suggested once a bundle exists
  and Format opens with Paint format; saved formats have their own Your
  formats group; Undo and Redo moved to their own History group. A search
  for "repeat" ranks Repeat formatting above Paint format.
- New `lib/announce.ts` (`announce(message, options)`): one polite,
  visually hidden status node for messages that outlive the control that
  sent them, which also feeds the status pill.
- **Phone List menu:** tapping the list type that is already checked kept
  removing the list; it now only closes the menu, as on desktop.
- **One Esc leaves the row (M3):** Esc on a row, bubble or phone-bar item
  returns to the editor with its selection in one press, even while the
  item's focus tooltip shows (the toolbar takes the key in the capture
  phase; the tooltip still closes). A hover tooltip keeps its own Esc
  (WCAG 1.4.13), and an item whose popup is open keeps the key.
- **Short text style at T5 (M8):** the narrowest ladder tier shows "Text",
  "Title", "H1"–"H6" or "Mixed" instead of a truncated "N…". The trigger
  is named by its visible text, "H2 Heading 2" at T5 and "Heading 2" above
  it (WCAG 2.5.3).
- **Outline overlay below 950px (M11):** focus leaving it (Tab, a click in
  the row or the tabs) closes it, Esc anywhere closes it and returns focus
  to the trigger, and an outline with no headings focuses the dialog
  instead of dropping focus on `<body>`.
- **Connection chip at 320px (M15):** the status and links cards wrap and
  a long name truncates, so nothing is clipped off the left edge (WCAG
  1.4.10).
- **Lazy surface failures:** a colour popover or Insert step whose chunk
  does not load names it in the popup ("Couldn’t load colours.", "…the
  table picker.") with a muted alert icon and a Retry button that fetches
  the chunk again in place (design pass §12); reopening also retries. A
  palette that cannot load says "Couldn’t open actions. Check your
  connection and try again." on the status pill, with Retry, instead of
  staying silent. The bubble still just stays away.
- **Palette ranking:** groups sort by their best match again (a cmdk
  1.1.1 bug looked groups up by a value they never had, so any weak match
  under Suggested here beat a strong one in Format): "paint format",
  "format painter" and "brush" find Paint format first, "repeat" still
  finds Repeat formatting. The highlighted row stays in view as the
  groups reorder while typing.
- **Saving a format** announces once, as a confirmation ("Saved format
  ‘X’" or "Replaced format ‘X’"); the palette said it a second time.
- **Aa sheet colours:** ↑/↓ follow the swatch lines as the sheet lays
  them out (its grid fills the width), so they keep the column.
- **Touch tablets:** tooltips and shortcut glyphs are hidden on a coarse
  pointer at any width, not only with the phone bar.
- **Alt+F10 at 800px:** no longer reproducible on `main` (62 runs of the
  old repro pass); the 768px handoff test drives Alt+F10 again, and a new
  test repeats Alt+F10, arrows and Esc at 800px, loaded there and after a
  resize hid the tab stop.
- **Design sign-off (PR #35):**
  - Near the top of the page the desktop status pill no longer covers
    the selection bubble: it moves 8px right of it (or below it), so a
    second click on the armed brush cancels.
  - The phone Aa sheet no longer scrolls sideways at 320px and 375px:
    "Save selection as format…", "Remove a format" and the Remove list
    span the sheet, the list is inset under its toggle instead of mixed
    into the formats, and long names truncate. Why Save (or a format) is
    unavailable is a visible line, since phones have no tooltips.
  - A disabled menu item's label dims (a bare-text label did not), and
    its reason is read once, as the description, not also in the name.
  - While Paint format is armed, Esc on a toolbar item or in a menu no
    longer closes its pill: only Esc in the text does, which also
    cancels painting.
  - Arming Paint format and cancelling no longer replaces the Repeat
    bundle; it is remembered only once applied. A bundle that only clears
    reads "Plain (removes formatting)" and is not suggested first in the
    palette.
  - The presence and Privacy chips hide while the phone selection bar
    shows, instead of showing through behind its pill.
  - The phone brush pill says "Select text, then tap the brush again"
    (no emoji), and the "Couldn’t load" hint is no longer padded twice.

- **Typing budget flipped between runs, partly addressed**
  (`performance.spec.ts`). Every trial generated its own random document,
  so the two arms typed into different documents; at 50 headings that
  difference outweighed the toolbar's (resampled, about 27% of runs failed
  with a new document per trial, about 1% with one shared document). All
  trials of a heading count now share one document. One discarded warm-up
  trial per arm runs first, each arm waits for its own end state (toolbar
  mounted or gone) and then for an idle main thread, trials time 200
  keystrokes after 20 warm-up ones (was 90 after 10), and `PERF_ROUNDS`
  defaults to 7 (was 5). Both sizes can still fail on the 10% budget (see
  Known below): in isolation 50 headings passed 10/10 (was 8/10) and 10
  headings 8/10 (unchanged), and in a full chromium + perf run 50 headings
  failed once (5.0 vs 4.5 ms). The test timeout is now 300 s (about
  1.4 min per heading count locally, was about 36 s).
- **Arrow p95 measured the toolbar arm first and colder, on a cliff**
  (`toolbar-perf.spec.ts`). At 720 px the 60-key walk scrolled about five
  times; the frame after a scroll lays out the revealed blocks and costs
  several times a normal key, and those frames were about 5% of keys, right
  at the p95 rank, so one more or one fewer moved an arm's p95 by hundreds
  of ms. Both arms now open the same generated document in fresh 1280×4000
  contexts (the test checks that the walk does not scroll), run a discarded
  warm-up round each, then three interleaved rounds from the same start
  once the main thread is idle. Each press is one sample (Shift's own
  keydown used to count as a second) and waits for the previous press to
  paint, and p95 is taken over all of an arm's presses. Scroll frames are
  therefore no longer part of this budget. `TOOLBAR_PERF_CPU_THROTTLE`
  throttles both arms for local reproduction. The test timeout is now
  300 s.
- **Leak spec heap bound sat close to warm-up growth**
  (`editor-leak.spec.ts`). The baseline is now taken after 12 warm-up tab
  switches (was 6), and each measurement repeats GC and reads until two
  readings agree, instead of one reading after a fixed 2 s.
- **Resize gripper test timed out** (`extensions.spec.ts`). The lazy
  selection bubble registers its plugin when its chunk lands; that
  reconfigures the editor, ProseMirror recreates every plugin view, and the
  media controls hide an active gripper when theirs is destroyed. On a busy
  machine this landed after the hover. The test now waits for the bubble's
  plugin first.
- Known, not fixed here: the same reconfigure hides an active gripper for
  a user who hovers an image while the bubble chunk is still loading. The
  hide on plugin-view destroy is in `@docs.plus/extension-hypermultimedia`.
- Known, not fixed here: at 10 and 50 headings (p95 about 3-6 ms) single
  trials still swing by about 10% in both arms, from bursts of consecutive
  slow keystrokes whose cause was not found (they hit both arms alike, and
  line up with neither offline copy writes nor WebSocket sends), so the
  typing budget can still fail on noise. At this p95 and 0.1 ms timer
  ticks a 10% budget sits at the measurement floor; the ways out (gate on
  a larger document only, more rounds, or another measure of the
  toolbar's per-keystroke cost) change the gate and are the owner's call.

#### Added
- **Diagram ▸ templates in the Insert menu (M17b, design pass §9):**
  Diagram is one standard submenu row (hover, click, Enter or →) with the
  five Mermaid templates and their icons (Flowchart, Sequence, State,
  Mind map, Pie chart); the last used one is noted "Last used" and
  focused first. A collision flips the submenu to the menu's other side,
  never over its rows. When no template can go here (the title, inside a
  diagram) one note at the top says why instead of a reason per row.
  E's `template.mermaid` no longer shows up as a second, icon-less
  "Insert diagram" row. The submenu rides in the insert step's preloaded
  chunk; until it lands, Diagram is one item that inserts.
- **Paint format (design pass §1–2)** replaces Copy formatting: a brush
  after a separator in the selection bubble (28×28, `aria-pressed` while
  armed), "Paint format" in ⋯ and the palette. It picks up the formatting
  at the selection or caret (plain text picks up plain) as the remembered
  Repeat bundle. While armed the editor shows a copy cursor; the next
  mouse selection paints it as one undo step; on the keyboard, Alt+F10 to
  the brush, Esc back to the text, select, then ⌘⌥V (Ctrl+Alt+V or F4)
  or the brush again; on touch, tap the brush, select, tap it again
  (never on its own). Esc in the text, the brush on the same selection, a
  document switch or read-only cancel it.
- **Status pill (§5):** every announcement also shows as a short pill,
  8px under the sticky row on desktop and 8px above the phone bar (beside
  its cells, never in a masked element; the presence and Privacy chips
  sit under the bar's layer). It closes after 2.5 s (5 s with Undo or
  Retry), stays while hovered or focused, and Esc closes it. Repeat with
  nothing remembered says "Nothing to repeat yet. Format some text or use
  Paint format."; Repeat confirms "Repeated Bold, Yellow highlight".
- **Your formats in the text style dropdown (§4):** after the styles,
  each saved format named in its own formatting (described by its long
  label), "Save selection as format…" (the palette's save view) and
  "Remove a format ▸", which removes at once with Undo on the pill. The
  section is a lazy chunk loaded with the dropdown. A disabled item says
  why on a visible second line. The Aa sheet has the same Your formats
  section, with "Remove a format" (a tap removes, Undo on the pill, which
  sits above the open sheet). The Save dialog's "Remove a format" link
  at the cap opens the dropdown, or the sheet on a phone, at that list.
- **Format chips in the palette (§8):** Your formats rows show "A" in
  the format in their leading slot.
- **Phone selection bar (§6):** eight 44px cells, B I U A▁ ✎▁ 🔗 🖌 ✕,
  with no scroll or edge fades (U moves to the sheet below 360px; strike
  and clear formatting are in the sheet). The colour cells show the
  remembered colour as a bar; ✕ has a left divider.
- **Announcements** through one polite live region (`lib/announce.ts`):
  "Repeated Bold, Italic", "Picked up Bold. Select text to apply.",
  "Formatting applied", "Applied 'X'", "Saved format 'X'" / "Replaced
  format 'X'", "Removed 'X'", and the reason when the Repeat key cannot
  run (the key is then handled, not passed on).
- **Phone context slot cell:** the docked bar shows the current block's
  tools as one 44×44 cell between Indent and Insert (spec §4.7): section
  fold and moves, code language and copy, table rows and columns, and
  media options (a direct button, as in the row), from the same registry
  actions as the row's slot. It is held
  while focus is in the bar or its menu, so another writer's edit never
  removes it under focus. Below 404px Redo lives in the sheet, so the cell
  never shifts the others; below 360px the cell's tools move into the
  sheet (the language as a native select). The cell shows its kind
  (heading, code, table or image icon) beside its chevron, and the code
  menu has a "Language" group after a separator, with the current
  language checked, aliases included (`js` checks JavaScript).
- **Safe areas:** `viewport-fit=cover`. The tab strip and the loading
  skeleton clear the status bar and notch, the shell keeps clear of
  landscape notches, the phone bar keeps its cells above the home
  indicator while the keyboard is closed, and the Aa sheet and the
  about, privacy and offline pages pad by the insets. Desktop is
  unchanged.
- **Swipe down to close the Aa sheet:** drag its header (new handle)
  down past 80px or flick it; shorter drags snap back, reduced motion
  makes both instant, and Done, Esc and the backdrop still close it.

#### Changed
- **Design pass surfaces (§7–§12 of
  `docs/superpowers/specs/2026-11-13-smart-toolbar-design-pass.md`):**
  - **Save as format:** "Reuse this style anywhere. Saved on this
    device.", a preview box with "Sample text" in the format and its long
    label, an empty name with the placeholder "e.g. Warning", and Save
    disabled until the name is non-blank. Saving over a name says
    "Replaces your format ‘X’." first; at 20 formats the dialog says so
    with a "Remove a format" link (`formats.remove` UI intent). The view is its own chunk, loaded when it
    opens, so the palette chunk could take the row changes.
  - **Palette rows:** a leading `size-4` slot with the registry icon or a
    colour chip; 32 px rows, 48 px with a second line. Colour rows are
    named once ("Orange text"); saved formats get their own "Your
    formats" group, named by the format. An action under "Suggested here"
    (now at most 4) is not repeated in its home group, and unavailable
    rows sort to the bottom of theirs with the label at full contrast,
    the reason muted (`text-foreground/70` when selected) and no shortcut.
    The selected row's bar uses the focus-ring colour. Repeat formatting
    is named alone, with what it applies as its second line.
  - **Shortcuts:** toolbar tooltips use the palette's and menus'
    formatter, one `<kbd>`: "⌘⌥V" on macOS, "Ctrl+Alt+V" elsewhere (it
    said "Mod" off macOS).
  - **Menus:** a disabled item shows its reason as a visible second line
    (`DropdownMenuReason`, still its description); only the label and
    icon dim. Title-only and hidden reasons are gone from the row menus
    and Insert.
  - **Colour popover:** low-contrast highlights are no longer dimmed;
    their dotted border is 60% foreground (≥ 5:1), and the note names the
    colour: "Dotted: hard to read with Red text". The popover body and the
    table grid styles load with their own chunks, off the editor chunk.
- **Loading is not a state the user sees:** before the formatting engine
  lands, its actions are available and a click waits for it, as the
  Repeat key does; "Formatting tools are still loading." is gone. A
  failed load (a brush, Your formats, the Repeat key or a palette row)
  says "Couldn’t load formatting tools." on the pill, with Retry.
- "In this doc" formats left the menus and the palette, and the short
  "B · I · Red" notation is gone from all UI text.
- **Touch:** no tooltips and no shortcut glyphs on a coarse pointer; a
  tap on an unavailable phone cell or sheet row shows its reason on the
  pill instead, and a focused phone cell keeps its ring inside the bar.
  The Aa sheet's sections and row labels have a clear hierarchy, and its
  swatches fill the width.
- PR E's formatting engine (`lib/editor-actions/v11-engine.ts`) now lives
  in one lazy chunk. The selection bubble and the phone selection cells
  reach it through `getV11Engine()` / `loadV11Engine()` like the palette,
  instead of each carrying a copy (about 5 KB gz each). A unit test
  fails on any static import of the engine from app code.
- The selection-wide code check runs once per snapshot and stops at the
  first formattable character.
- E's palette keywords ride with the engine, and the eager shell drops
  its listener set, to keep the editor chunk near flat (+148 B gz).

### Smart toolbar later-phase plans (docs)

Docs only, no runtime change.

#### Added
- Implementation plans for the features spec §8 item 6 lists as "Later",
  in `docs/superpowers/plans/2026-11-13-smart-toolbar-later-*.md`:
  Continue where you left off (M15), the "/" menu, hover preview and the
  progressive-disclosure toggle. Each plan is grounded in `main` at
  `7abadc1` and states that it needs no schema or protocol change. Each
  also gives its WCAG 2.2 AA requirements, its performance and test plan,
  and its share of the editor-chunk headroom left under contract A12. The
  four allocations, plus Turbopack's split cost for new lazy chunks, add up
  to more than that headroom, so expect an owner budget amendment. The
  progressive-disclosure toggle is the cheapest and should be measured
  first.
- No plan for Document styles (M14b): its `styleRef` allowlist entry must
  ship in a deploy before the mark (spec §3.1), and nothing has been
  deployed yet. The "/" menu plan records why under "Not in scope".

### Smart toolbar v1.1, PR E: action palette and repeat formatting

Rebuilt on `main` after v1 (#32), branch `feat/smart-toolbar-e`.
Ships with v1's first deploy: the owner waived spec §8's 14-day hold and
raised the editor-chunk budget to 23.5 KB for E (contract A12; growth
+22.9 KB, of which E's eager shell is about 2.4 KB).

#### Added
- **Action palette:** Alt+/ (fallback Alt+Shift+Z) opens a searchable list
  of every registry action, grouped Recent, Suggested here, Format, Insert,
  Section, View and History; unavailable entries stay listed with their reason. The
  palette (cmdk 1.1.1) is a lazy chunk loaded on the first open, rendered
  in v1's `SurfaceBoundary`; one capture-phase key listener serves every
  tab.
- **Repeat formatting and Copy formatting:** Mod+Alt+V (and F4 off macOS)
  applies the last formatting as one undo step, setting marks rather than
  toggling them; Copy formatting picks up the selection's formatting.
- **Your formats** (saved in `tinydocy-formats`, kept by "Forget my
  choices"), **In this doc** (formats the document already uses, scanned on
  demand and never stored) and **Mermaid templates** (flowchart, sequence,
  state, mind map, pie).
- **Repeat split button** in the selection bubble, with the Formats menu
  (Repeat, Copy formatting, Save as format…, Your formats, In this doc).
- **Phone selection cells:** on the docked phone bar a text selection swaps
  the cells to B, I, U, S, text colour, highlight, link, clear and Repeat,
  with a sticky "Back to all tools". The bar never swaps under keyboard or
  VoiceOver focus or with the Aa sheet open, stays one toolbar, and scrolls
  sideways with scroll padding under the Back cell.
- Remembered choices (the Repeat bundle, Recent, the last diagram template)
  persist in v1's memory layer (`tinydocy-choices`).
- No schema, server or environment change; no Deploy step.

#### Changed
- **Bundle:** E's action bodies, Repeat commands, bundle recorder, saved
  formats, doc scan and diagram templates load as a lazy engine chunk when
  the editor is created; only the action definitions, the Repeat key
  binding and the palette listener stay eager. Until the engine lands
  (milliseconds), E's actions read "Formatting tools are still loading."
  and up to 50 transactions are buffered for the recorder. Measured with
  `scripts/check-editor-chunk-size.ts`: 401,311 B gz, +23,423 B over the
  baseline against the 20,480 B budget (v1 r2 alone: +19,346 B); E as first
  built measured +28,250 B. The budget is not raised here.
- **Palette budget** is 20 KB gz (owner decision O5, contract A7): 19,981 B
  on a local production build. The nightly `pwa` job runs the
  `PALETTE_BUDGET=1` check on its production build.
- The smart-toolbar barrel no longer re-exports `RepeatSplitButton` and
  `PhoneSelectionCells` (contract A6, E's sub-bullet): it pulled them into
  the editor chunk.
- Edits outside E's file scope (`nightly.yml`, cmdk's
  `patchedDependencies`, the phone bar, the barrel, `tests/TESTING.md`) are
  listed under the owner's ownership grant, contract A6.
  `tests/unit/ci/cmdk-patch.test.ts` fails when cmdk moves off 1.1.1 or the
  patch is missing.
- `palette-leaks.spec.ts` logs tab-switch heap and live editors.

#### Fixed
- **Repeat pressed before the engine chunk loaded did nothing.** On a slow
  network or a busy device the shortcut could arrive first; the key is now
  taken and Repeat runs once the engine lands, if the selection has not
  moved.
- The palette's search field keeps `aria-activedescendant` on the
  highlighted option on open, after arrow keys, while filtering, and drops
  it when nothing matches (WCAG 4.1.2); `patches/cmdk@1.1.1.patch` re-syncs
  the attribute.
- Palette rows name their keys with `aria-keyshortcuts` and hide the glyph
  from assistive technology; on a coarse pointer the rows and the Save as
  format field and buttons are 44px tall.
- Palette rows are named for their own action ("Heading 1", not "Heading 1:
  Normal text"), and the current style and alignment show a check and ",
  current" (WCAG 2.4.6).
- A polite status region announces "N actions" or "No matching actions"
  300 ms after the search changes (WCAG 4.1.3).
- In forced colours the palette and the Save as format form keep a
  CanvasText border.
- A palette or engine chunk that fails to load (offline, or replaced by a
  deploy) leaves the editor working: the palette closes and the next Alt+/
  fetches it again; without the engine the palette still opens.

### Smart toolbar plans for PR C, D1, D2 and E (docs)

Docs only, no runtime change.

#### Added
- Implementation plans for the rest of the smart toolbar rollout in
  `docs/superpowers/plans/`: PR C (text colour and font size schema,
  release N+1), PR D1 (action registry, sorted row and context slot),
  PR D2 (surfaces, memory and the responsive ladder) and PR E (palette,
  Repeat formatting and saved formats). They are the plans the work started
  from; where they differ, the v1 contract
  (`docs/superpowers/specs/2026-11-13-smart-toolbar-v1-contract.md` on the
  integration branch, §10 amendments) records what was built.

### Editor leak on tab switch (fix/editor-tab-leak)

Not specific to the smart toolbar: `main` has leaked since `@tiptap/markdown`
was added, so this fix can ship to `main` on its own.

#### Fixed
- **Destroyed editors stayed in memory.** `@tiptap/markdown` registered each
  editor's tokenizers on the module-wide `marked` instance and never removed
  them, which kept every closed editor reachable: 20 tab switches left 7
  extra live editors and 6 MB more heap, without limit. Each editor now gets
  its own `Marked` instance (`marked` is now a direct dependency, at the
  version already installed), and `tests/e2e/editor-leak.spec.ts` checks
  that 20 switches return to the baseline.
- Known, not fixed here: while a Playground image request is still pending,
  Chromium keeps the `<img>` alive and, through the media resize gripper's
  listeners, its closed editor. They are released once the request settles.
- **Tab-cap e2e timed out in CI.** `tabs.spec.ts` "create tab is blocked
  when cap is reached" slept 120 ms after each of its 48 clicks; on `main` it
  had grown from 16 s to 30 s in CI and already failed once there. It now
  waits for each new tab instead (about 9.8 s to 5.5 s locally), checks the
  tab count equals the cap in the button title, and allows 60 s for the 49
  editor mounts. The leak fix did not slow tab creation (about 80 ms per tab
  before and after).
- **Leak spec heap bound.** Heap still grows about 5% over 20 switches
  without a leak (it levels off near 10%), so the 5% bound in
  `editor-leak.spec.ts` failed most local runs. It is now 10%; the leak
  added about 17%, and the live-editor count stays the main check.

### Smart toolbar v1 integration (PR C + D1 + D2, r2 surfaces)

**Release order (owner override O10, 2026-11-13):** the owner chose to merge
v1 to `main` before release N (PR A + B) was deployed and before the N+1
adoption reading. The next deploy therefore goes from pre-N straight to N+1:
follow PR B's Deploy note and then PR C's in one window (Hocus first,
confirm `min=2 (floor 2, env 0)` and the refusals, then Next). Tabs still
open on the old build are refused per document (`client_outdated`) until
they reload; the mixed-version soak shows no content lost and no throttle
bans. PR E (palette, Repeat formatting, saved formats) is **not** part of
v1: it stays on its own branch until D's metrics hold for 14 days.

**What v1 has:** the sorted row, the context slot, the colour popover with
split faces, the size stepper, List and Insert menus, the memory layer with
Forget, the responsive ladder, the desktop selection bubble, the outline
overlay below 950px, and the docked phone bar with the Aa ("Text format")
sheet.

**Not in v1 yet** (spec §8 PR D items, deferred by contract §1.3): the phone
bar's context slot cell, and the mobile selection swap and Repeat split
button (PR E).

**Gates** (contract §10): the Nightly soaks (A10) and the Linux CI chunk
measurement (+18.9 KB of 20 KB) passed on the integration branch; release N
and the adoption reading are waived by the owner (O10), and the ladder
thresholds (A5) ship as measured. O1 to O4, O6, O8 and O9 are
decided: O2 (arrow-key p95) is log-only in v1, O8 waives the collab typing
comparison, and O9 accepts production's 2 MiB cap as the limit for
format-toggle growth (2026-11-13). O7, the perf typing budget, is closed by
the combined run (toolbar on 4.6/5.4 ms vs off 4.8/5.8 ms median p95). The
owner's O5, the palette budget, is E's A7 on `feat/smart-toolbar-e-v11` and
not part of v1.

#### Added
- **Selection bubble** (spec §4.3, desktop only): selecting text with a fine
  pointer shows B · I · U │ text colour split │ link above the selection
  (below it when the sticky toolbar or a collaborator's caret label is in
  the way). Every bubble action is also in the row. Typing, a node
  selection, code and Mermaid blocks, a selection inside one link and a
  read-only document hide it; Esc fades it out (90 ms) and keeps the
  selection; Alt+F10 focuses it when it shows, else the row. The colour
  popover opens from the bubble, away from the selection, and keeps it
  attached. Focus leaving the editor or the bubble (Tab, another control)
  hides it, and a click between its buttons keeps the editor focused. While
  the selection is scrolled out of view, or the bubble is wholly under the
  sticky row, it reads closed: Alt+F10 goes to the row and focus inside it
  returns to the editor. The bubble is its own lazy chunk (owner decision
  O1); touch devices and phone widths never load it.
- **Outline overlay below 950px** (spec §4.6, D2 Decision 5): from 768 to
  949px the outline slides over the page below the sticky toolbar instead of
  pushing it aside. It is a non-modal "Outline" dialog with a "Close
  outline" scrim; it focuses the active item when it opens, closes after a
  heading pick (caret at the heading's end), and Esc or the scrim return
  focus to the outline trigger (View ▾ at T4). Esc during a keyboard drag
  only cancels the drag. Its open state is never remembered, so a
  remembered "open" never covers the page on load; crossing 950px shows the
  docked state (M6) and keeps focus, or moves it to "Toggle outline".
- **More remembered choices** (spec §5, local only, cleared by Forget):
  - M4: a new code block takes the language most code blocks in the doc
    use (Mermaid excluded), else the last language you picked, else plain.
  - M9: the list face follows the last list type from the face, the list
    menu or a shortcut; the menu now runs the registry's `list.*` actions.
  - M10: at T1 the last inserted kind gets a labelled face beside the Insert
    menu; from T2 the plain menu pre-highlights it. A fresh profile keeps
    "+ Insert" (the fallback was "table").
  - M17a: the table grid reopens at your last size (now proven end to end,
    across reloads and Forget).
- **Responsive ladder** (spec §4.6): the fixed row is a size container and
  fits its width from 1440px down to 768px, mouse and touch, in paragraph,
  heading, code and table contexts. Tiers hide groups and show stand-ins:
  T2 size stepper to "M ▾", Insert icon only, Theme into ⋯; T3 align and
  indent to a ¶ menu, the slot to one button; T4 the colour pair to one
  button, Outline and Filter to View ▾; T5 U and S to an Aa menu, a short
  style value and no separators. Thresholds are the measured row widths
  (contract A5). Hidden items leave the roving order, and a resize re-stamps
  it so the row keeps one Tab stop. `toolbar-ladder.spec.ts` asserts the fit
  at every tier.
- **Docked phone bar** (spec §4.7, contract A6): below 768px the sticky row
  gives way to one 44px `role="toolbar"` docked above the on-screen keyboard
  (`visualViewport`, reset when focus leaves editable content, for iOS), with
  44×44 cells: Undo, Redo (from 360px; narrower phones find it in the sheet),
  Aa, Bold, Italic, List, Indent and Insert. Toggles show their state with
  `aria-pressed`. It hides in a read-only document. The caret and
  `scroll-padding-bottom` stay clear of the bar and the keyboard. The bar
  and its sheet are one lazy chunk, loaded only below 768px, so desktop
  never fetches them (contract A9).
- **Aa "Text format" sheet**: Colours first (the colour popover's panel:
  text, highlight, Recent, low-contrast dimming), then Style (Normal,
  H1–H6; locked in the title), Size (the XS–XL stepper, disabled in
  headings), Align and More (redo below 360px, outdent, underline,
  strikethrough, superscript, subscript, inline code, clear formatting,
  Forget my choices, link, a labelled theme switch), all registry actions
  with their reasons. It is modal: the page behind it is inert, the popup
  says `aria-modal` and Tab wraps inside it. Picks keep the sheet open;
  Link closes it and leaves focus in the link popover; Done returns focus
  to Aa. The bar's List menu is a radio menu like the row's.
- Crossing 768px with focus in the row or the phone bar moves focus to the
  toolbar that replaces it (same action when it shows one) instead of
  dropping it to the page.

- **Schema soaks in Nightly** (contract A10): a 50,000-toggle colour, highlight
  and size soak across three clients (convergence, stored copy, schema and
  size checks) and a mixed-version soak (pre-N clients refused, a release N
  editor freezes, nothing lost). `bun run test:soak:color` and
  `bun run test:soak:mixed-version`; see `tests/TESTING.md`.

#### Changed
- Mouse T2 starts below 1264px (was 1232px, contract A6): the widest M10
  face ("Code block") overflowed the T1 row by 31px. Touch is unchanged.
- The `list.*` actions use the list menu's in-place toggle (a list of
  another type is retyped in one step, nested lists too) and refuse the
  title; `toggleList` reports success only when the document changed.
- The row's scrollbar is no longer hidden: where it still overflows, the
  clipped controls can be found.
- On touch every row target is 44×44.
- Phones lose the sideways-scrolling row and its **Text style and colour**
  panel: the docked bar and the Aa sheet replace both.
- **Colour popover keeps open after a pick** (owner decision O4, spec
  §4.5): Enter or a click applies the swatch and keeps the popover open with
  focus on it, so writers can try several colours; Esc returns focus to the
  trigger. Focus opens on the applied swatch, else the section's first;
  arrows follow the token order; the check glyph sits on its own badge. PR
  A's per-swatch forced-colours border check runs on D2's swatches.
- **Low-contrast highlight swatches are dimmed** (owner decision O3, spec
  Appendix A): a highlight that would put the current text colour below
  4.5:1 is dimmed and described "Low contrast", but stays selectable; the
  focus ring keeps full strength. Text swatches never dim.
- **Editor chunk budget raised to 20 KB** (owner, contract A11): the r2
  fixes are eager and the budget had 16 B left; the combined branch measures
  +18.8 KB.
- **Editor chunk budget** (owner decision O1, contract A9): the Insert
  menu's table grid and embed form now load as their own chunk, on the
  Insert button's hover or focus (the colour popover and the bubble already
  did). The CI gate's budget is now +18.5 KB gz over the `58a9d22` baseline
  (measured +18.43 KB; spec §7 said +6 KB). Lazy slot controls and menu
  items were tried and reverted (contract A9).

#### Fixed
- **A lazy chunk that fails to load no longer crashes the page** (contract
  A9). If the colour popover body, an Insert step or the selection bubble
  cannot be fetched (offline, or a deploy replaced it), the popover stays
  empty or the bubble does not show; the editor and the tabs stay mounted
  and typing works. The next open fetches the chunk again. The colour and
  Insert chunks are now also fetched when the browser is idle after the
  first server sync, so the service worker caches them for offline use.
- **The selection bubble could vanish while open.** When its chunk arrived
  after the selection, the bubble was shown and then detached a frame later
  without closing, and it did not come back until the selection changed. It
  showed up as the intermittent `selection-bubble.spec.ts` failures under
  three e2e workers (contract A9 has the cause).
- **A selection change with focus inside the bubble threw.** Collapsing the
  selection programmatically (for example a remote edit) while a bubble
  button had focus made the bubble's hide run twice inside one transaction,
  and the second removal threw from the dispatch. Focus now returns to the
  editor instead.
- **Tab past the last bubble item dropped focus on the page.** It now
  returns to the editor with the selection intact, and the bubble stays
  away until a new selection, as after Esc.
- **The Insert face could undo a quote.** At T1 the remembered kind's face
  read as a "Quote" toggle, and a click with the caret in a quote unwrapped
  it. Faces are now named with a verb ("Insert quote"; the visible text is
  unchanged) and never show a pressed state, and Quote only inserts: inside
  a quote it is unavailable ("Already in a quote.").
- **The Insert step took focus back after it closed.** Base UI returns
  focus when the table grid or embed form unmounts, after its exit
  animation, and it always moved focus to Insert. A menu opened in that
  window (More formatting right after Esc on the grid, on a slow device)
  lost focus and closed at once; it failed CI under three workers. Picking
  a table size also ended with focus on Insert instead of in the new table.
  The step now stays rendered until it has finished closing, and focus goes
  back to Insert only when it is still inside the closing step.
- **A fold could stay half-animated.** Registering any editor plugin while
  a section was folding (the selection bubble mounts its plugin lazily)
  rebuilt the plugin views and dropped the timer that ends the animation,
  so the section stayed mid-fold until the next edit. The rebuilt view now
  finishes it.
- **Menu items read their shortcut as part of the name** ("Superscript⌘.").
  The hint is hidden from assistive technology and the item announces its
  keys through `aria-keyshortcuts`.
- `tests/e2e/editor-leak.spec.ts` also opens and closes the bubble and its
  colour popover 100 times and checks that the `document` and `window`
  listener counts (per event type, through CDP) return to the baseline.
- **Focus fell to the page when the ladder hid the focused control** (for
  example Underline at 850px, or browser zoom). It now moves to the same
  tier's stand-in, or the nearest visible item.
- **Crossing 768px with focus in the toolbar lost it.** Focus moves to the
  other toolbar, on the same action when it shows one.
- **The phone format sheet was not modal.** Tab escaped to the tab strip and
  the covered bar; the app shell is now inert while it is open, the popup is
  `aria-modal` and Tab wraps inside it. Link from the sheet leaves focus in
  the link popover.
- **A mixed state looked off.** `aria-pressed="mixed"` (bold on half a word)
  now shows a 6×2px half bar (≥3:1); in forced colours it is a dashed border,
  so the focus ring stays visible.
- **Menu items were 28px tall on touch.** On a coarse pointer they are at
  least 44px; mouse sizes are unchanged.
- **Colour popover polish:** a visible note under Highlight when swatches
  are dimmed for contrast, swatch borders at ≥3:1, and the roving focus
  follows a clicked swatch.
- **Reduced motion** turns off menu and popover animations, and the phone
  sheet's, not only the bubble's.
- An empty context slot no longer leaves two separators side by side.

### Smart toolbar v1, PR D1: action registry, sorted row and context slot

#### Added
- **Action registry** (`lib/editor-actions/core-actions.ts`, bodies in
  `lib/editor-actions/core/`): every toolbar command is one action with a
  label, icon, display shortcut, markdown hint, contexts and a reason when it
  cannot run. History reads the Yjs UndoManager stack; section moves, lists,
  tables and indent compute a real `can()` once per selection snapshot.
- **Context snapshot** (`lib/editor-context/snapshot.ts`): one O(depth) walk
  gives the kind (media, Mermaid, code, table, title, heading, list,
  paragraph), ancestor flags and the marks across the selection.
- **Sorted row** (spec §4.1): history, text style, size, B I U S, colour,
  link, Align ▾, List ▾, outdent and indent, the context slot, Insert and
  ⋯ More formatting (superscript, subscript, inline code, clear formatting).
  Controls never move or disappear: in a read-only document each says "This
  document is read-only." Group roots carry `data-toolbar-group` and
  collapsible items `data-collapse-tier` for the responsive ladder.
- **Context slot** (spec §4.2): a fixed 168px group before Insert with
  section tools (fold, move up, move down), the title lock, the code or
  diagram language and copy, table row and column menus, header row and
  merge or split, and Media options… (opens the media kit's toolbar with
  focus on its first control; Esc closes it and returns to the slot
  button). Contents hold while focus is in the toolbar; a section move
  carries the held heading id and refuses when a collaborator deleted it.
  The slot never clips focus outlines, and a long language name truncates
  (full name in the tooltip) instead of overflowing under WCAG 1.4.12 text
  spacing.
- **Keyboard model:** one Tab stop with a roving tabindex owned by the
  toolbar, Alt+F10 to the toolbar, Esc back to the document with its
  selection. With a focus tooltip open, the first Esc closes the tooltip
  and keeps focus (WCAG 1.4.13); the next returns to the document.
- **Clear formatting** (`Mod-\`, #392): removes every inline mark except
  links in one undo step; never touches block type, alignment or indent;
  disabled in code.
- **Shortcut hints** with `aria-keyshortcuts` on every toolbar action (#612).
- **Tests:** `toolbar-row.spec.ts` (row order, one Tab stop, Alt+F10 and Esc,
  slot per context, remote heading deletion while the slot has focus, clear
  formatting keeps links, read-only keeps focus, catch-up render budget,
  light and dark screenshots); unit tests for the snapshot, key combos, the
  core actions and the keymap.

#### Changed
- Indent and outdent mirror Tab (`sinkListItem`, then text indent).
- The toolbar Profiler records each update's `actualDuration`
  (`window.__toolbarRenderMs`, dev only); `toolbar-row.spec.ts` logs the
  catch-up render per burst in a 500-heading document and writes it to the
  perf report.
- Disabled reasons are full sentences ending in a period.
- Text style applies to a mixed range (the Style menu reads "Mixed") and
  keeps the range selected; a range that starts in the title is disabled
  with "Title is always H1."
- The toolbar's roving tabindex does no layout reads while focus is in the
  document, so slot swaps on arrow keys stay cheap; mark state for a range
  comes from one selection walk. `toolbar-row.spec.ts` reports arrow and
  Shift+Arrow p95 in a 500-heading document with and without the toolbar.
- `sanitizeCodeLanguage` moved to `lib/code-language.ts`.

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
- **Smart toolbar surfaces and memory (v1, PR D2).** Not deployable on its
  own: it ships with PR C's marks and PR D1's row, after the N+1 ship gates.
  - **Memory layer** (`lib/remembered-choice.ts`): versioned local storage
    under `tinydocy-choices` (cleared by the new **Forget my choices**
    action) and `tinydocy-ui` (outline open state, kept by Forget). Every
    read is re-validated against an allowlist; hostile, oversized or
    other-version payloads fall back to defaults. Written only by actions
    after their command succeeds. `NEXT_PUBLIC_REMEMBER_CHOICES=0` turns it
    off.
  - **Registry actions** `color.*`, `size.*`, `insert.*` and
    `memory.forget` (`lib/editor-actions/surface-actions.ts`).
  - **Colour split pair** with remembered faces ("Apply text colour: Red")
    and a lazily loaded popover: Recent (five mixed colours, frozen while
    open), text colours and highlights as named `aria-pressed` swatches in
    a roving grid.
  - **Size stepper** (`spinbutton`, disabled in headings with a reason),
    **Insert menu** listing the registry's insert actions with a table size
    grid that opens at the last size and an embed link step, and a
    remembered **list face** for D1's list actions.
  - **Phones** reach text colour, highlight and size from the colour panel.
    On touch every target is 44×44: the panel wraps to a second line at
    360px instead of scrolling sideways, popover swatches wrap at six per
    line (arrow keys follow the lines), the table grid caps at 6×6, and a
    tap opens the colour popover without taking focus.
  - Swatches of a colour kind that can't apply here stay focusable but are
    `aria-disabled` with the reason. Forced colours keep each swatch's
    colour and show pressed as a ring, separate from the focus outline.
  - **Bundle gate:** `scripts/check-editor-chunk-size.ts` (CI step) keeps
    the editor chunk group within 6 KB gz of the `58a9d22` baseline.
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
