# TinyDocy Desktop and v1: test and release strategy

- **Status:** Draft v1, 2026-11-16, amended by plan v7. Planning only. Nothing here is built yet.
- **Owner answers (plan v7, 2026-11-16):**
  - **D31:** feedback goes to a **new dedicated email alias** the owner reads; the owner files sanitised GitHub issues (owner question 2, as recommended). Owner action: create the alias.
  - **D32:** testers **4 macOS / 4 Windows / 2 Linux** (owner question 3). Builds: **Gate 2** unsigned for the owner and 2 technical testers; **Gate 3** signed `0.2.0-beta` for all 10; **Gate 5** public `1.0.0-beta`; **stable `1.0.0`** after 8 weeks (owner question 1, as recommended).
  - **Staff integration review:** the `firefox` Playwright project is defined once, by **Q7** (§1.2); L7 adds the RTL specs to it, and P2.13's exit depends on Q7. **Q14 and OB3** (What's New) are one PR, and so are **Q16 and OB4** (`/download`) ([onboarding design](2026-11-16-onboarding-templates-import-design.md) §6). The update channel's default is computed, never stored (§4.1, preferences row 23). The beta's owner load (§7.1) is counted in plan §8.1–§8.2 and risk K23.
- **Plan v8 (D33–D41, 2026-11-16):** **D36** phones and tablets are fully supported in v1: the [phones and tablets design](2026-11-16-phones-tablets-design.md)'s `mobile`, `mobile-webkit` and `mobile-perf` projects join §1.2 (M28), its §9.4 real-device checklist runs at Gate 5 and at stable promotions only (§5.3), and 3 phone testers join the beta for the web library. **D40** adds the S1 test that the server never receives the edit secret `e` (§1.10) and the S8/S16 golden checks (§1.9). **D41** adds a conditional phone line to the editor-chunk ledger. Gate 3's `classic` pixel baseline covers the page, not icons (B1 changes icons before Gate 2). `/privacy` ships in parts: summary and `#desktop` at Gate 3, `#shared-documents` and `/terms` at Gate 4, `#my-documents` at Gate 5.
- **Owner of this document:** the QA lens (plan §8.1). The release-manager duties belong to the owner (O).
- **Builds on:**
  - [Plan v7](2026-11-15-desktop-local-first-design.md): §8 phases, §9 testing (T1–T19), §10 gates, §13 owner decisions
  - [Architecture](2026-11-15-desktop-architecture.md): §9 diagnostics, §10 startup budget, §11 testing seams
  - The feature designs' test sections: [web library](2026-11-16-web-library-design.md) §10, [image store](2026-11-16-image-store-design.md) §8, [comments](2026-11-16-comments-design.md) §8 and §10, [preferences](2026-11-16-preferences-design.md) §5.15
  - [`tests/TESTING.md`](../../../tests/TESTING.md), `.github/workflows/*`, and AGENTS.md
- **What this adds.** One place that says, for every layer and every gate:
  - which test runs
  - where it runs (on every PR, nightly, or before a release)
  - what counts as evidence
  - how builds reach the 10 testers and, later, the public
  - how a bad build is stopped
- **Where it wins.** The feature designs still own their test cases. This document owns **when** each one runs, **what blocks** a gate, and **the release process**.
- **Fixed rules carried in from AGENTS.md and the plan:**
  - Bun only (`bun`, `bun <bin>`, `bunx --bun`)
  - never test against tiny.docs.plus: use localhost, or staging for Live features
  - a CHANGELOG entry in every PR
  - design review with screenshots before any visible UI merges
  - merge only on CI against the current main
  - every workflow passes `tests/unit/ci/workflow-permissions.test.ts`

---

## 0. Summary

1. **Five rings of tests, set by cost.**
   - **Every PR (about 30 minutes wall clock):** Linux checks, `chromium` + `perf`, the new `local` project, a Linux `browsers` job (the web library specs on WebKit and Firefox), and one macOS `electron` job.
   - **Nightly:** the three-OS `electron` matrix, durability soaks T1–T19, the property tests at 50,000 cases, the `library-soak`, and the existing soaks.
   - **Before each release:** real machines, staging, and the N-1 → N update on signed artifacts.
2. **The "7-night streak" gets one definition (§1.6).** It means 7 consecutive UTC days on which every scheduled run of the gating nightly workflows passed. An infrastructure failure voids the day and doesn't reset the streak. A test failure resets it.
3. **Flake policy.** A retried pass is a bug with a 2-working-day clock. Quarantine lasts at most 14 days. **Durability and data-loss tests are never quarantined.**
4. **Visual regression stays narrow.**
   - Prefer comparisons inside one run (the existing action-preview pattern).
   - Stored `toHaveScreenshot` baselines only for Linux Chromium, generated in CI, and at most 40 images.
   - No stored baselines for Electron, ever.
5. **The beta program** (Gate 3 → Gate 5):
   - signed builds on the update feed's `beta` channel
   - a week-by-week task list
   - feedback by email to the dedicated alias (D31) with Copy Diagnostics; GitHub is optional, because it needs an account
   - a 5-minute weekly check-in
   - a data-loss reply within 2 working days, and the rollout halted the same day
6. **Releases.**
   - `desktop-vX.Y.Z` tags, separate from web `vX.Y.Z`
   - weekly beta trains
   - staged stable rollouts at 10 → 30 → 60 → 100% over 7 days
   - halt with `stagingPercentage: 0`
   - **rollback is always roll-forward** to a higher version
   - `format_version` bumps ship in two steps
7. **Owner load during the beta:** about 4–6 hours a week, peaking at 10 in a data-loss week. That is about half of the plan's 10 owner-hours a week (§7).

---

## 1. Test pyramid

### 1.1 Layers

| # | Layer | Tool | What it proves | Exists today | Added by |
|---|---|---|---|---|---|
| L0 | Static and budgets | Biome, ESLint, `bun run typecheck`, `bun audit`, `check-editor-chunk-size.ts`, the workflow-permissions test | Code style, types, supply chain, the editor-chunk ledger (D23: ≈1,540 B gz in eight measured lines; D41, v8: ≈1,580–1,660 B in ten, one of them conditional on M18, details §1 rule 5; `EDITOR_CHUNK_BUDGET_BYTES` lowered to `main` plus the ledger) | yes | P2.4 (desktop tsconfig), P3.1 (workflow rules for secrets jobs) |
| L1 | Unit and contract | `bun test` (happy-dom; `fake-indexeddb` for the web library) | The `DocStore`, `DocSession`, `BlobStore` and `DocumentIndex` contracts on memory, `bun:sqlite` and IndexedDB. The reducer table, guards, filename cleaning, migrations, prefs schema, boot-script parity, token contrast, the refusal matrices. | partly | P2.1, P2.6, P2.6b, W2, P4.0, P4.2, P4.9 |
| L2 | Property and fuzz | `bun test`, seeded PRNG, seed printed | Invariants under random histories (§1.3) | chaos and schema fuzz | P2.5, P2.6, P2.6b, W2, P4.2f-2, P4.9 |
| L3 | Browser e2e | Playwright `chromium`, `local`, `webkit`, `firefox`, `pwa` | Behaviour in a real engine, with no packaging | `chromium`, `webkit` (by hand), `pwa` | `local` (P2.4), `firefox` (Q7) |
| L4 | Packaged app e2e | Playwright `_electron` (experimental in Playwright; Electron ≥ 21) | Persistence across relaunch, quit and update, fuses, the protocol route, `argv`, startup marks | no | P2.5 (S4 grows into it) |
| L5 | Soak and durability | `tests/load/*.ts`, Playwright `soak` / `yjs-soak` / `library-soak` | T1–T19, a year of growth, multiple tabs, mixed versions, load | Yjs, colour and mixed-version soaks | P2.6 (T1–T8), P2.6b (T16–T18), W12, P4.x (T9–T15, T19) |
| L6 | Performance | `perf` project, `electron` perf marks, unit timing | The budgets in §1.4 | typing and toolbar | P2.6, P2.7b, P2.9c-1, P4.9 |
| L7 | Manual on real machines | the release checklist (§4.4) | Install, update, uninstall, IME, signing prompts, the 3-OS live session | the PWA install list | P3.4 |

**Shape.** Most cases live in L1–L2, because they are fast, deterministic and run on Linux. L3 covers each user flow once, per engine. L4 covers only what needs a packaged app; anything the dev bridge can prove belongs in `local`, not `electron`. L5 and L6 run nightly. L7 is a checklist, not a test suite, and it shrinks as L4 grows.

### 1.2 Playwright projects

| Project | Target | Specs | When |
|---|---|---|---|
| `chromium` | `next dev` + Hocus (`make dev`) | everything except soak, perf and pwa, as today. Adds the preferences checks 1–13 (preferences §5.15) and the share and comments e2e with shares on. | every PR |
| `perf` | same, one worker, after `chromium` | `performance.spec.ts`, `toolbar-perf.spec.ts`, plus the comments, page and list cases (§1.4) | every PR |
| `local` (new, P2.4) | `NEXT_PUBLIC_APP_TARGET=desktop`, dev bridge to `bun desktop/dev/storage-host.ts`, a temp library per worker, no Hocus | desktop renderer flows: library, sidebar, Settings panes, keyboard checklist (UX §8.3), page width per document, image paste and reload | every PR (Linux) |
| `webkit` | as `chromium` | today's core editing list, **plus** the web library specs (persistence, multiple tabs, export and import, storage states) and the Persian spacing check | library specs: every PR. Core editing list: nightly (today it runs only by hand). |
| `firefox` (new; **defined once, by Q7**) | as `chromium` | the web library specs, plus the Persian spacing check. **L7 adds** the RTL document specs (P2.13) and the letter-spacing and joining check to this same project ([languages design](2026-11-16-languages-rtl-design.md) §8.2); no other PR defines a second `firefox` project. | library specs: every PR. RTL specs: nightly. P2.13's exit depends on Q7. |
| `electron` (new, P2.5) | the packaged internal build with `NEXT_PUBLIC_TEST_HOOKS=1`, `TINYDOCY_USER_DATA` and `TINYDOCY_BACKUP_DIR` per test | relaunch persistence (S4), T4 quit and update, fuses, `argv` and navigation denial, `/_asset/` route, no network with the Playground or a library document with images open, no flash at launch, startup marks, ⌘+ / ⌘0 text size, the menu accelerators | macOS smoke on every PR. All three OSes nightly. |
| `pwa` | production build on port 3847 | unchanged | nightly |
| `soak`, `yjs-soak` | as today | plus a comments variant (3 clients at the client rate limit for 10 minutes) | nightly |
| `library-soak` (new, W12) | production build, library origin | 30 minutes, 3 tabs, random handoffs, reloads, crashes and compactions | nightly |
| `mobile`, `mobile-webkit`, `mobile-perf` (new, M28; v8, D36) | as `chromium`, with phone and tablet viewports, `hasTouch` and a coarse pointer | the phones design's §9.2 specs: sheets, the phone bar, target sizes, storage states, the handoff page variants; `mobile-perf` holds its §6.2 budgets | `mobile`: every PR; `mobile-webkit` and `mobile-perf`: nightly |
| `staging` (new, P4.1) | the staging Hocus and Next (owner-provisioned subdomain), read from `E2E_STAGING_URL` | share open, click-to-open, a second browser sees the edit, the capacity cases, T15, the asset cases from image store §8 | pre-release, and by hand before Gate 4. **Never** pointed at tiny.docs.plus: the config refuses any host without a staging label. |

**Two rules for every project:**
- `serviceWorkers: "block"` everywhere except `pwa` and `library-soak`.
- `EditorPage.waitForSync()` waits on `data-server-synced`, which `local-session` sets once the document is ready and authoritative (architecture §8.1). After that, tests type at full speed.

### 1.3 Property and fuzz suites

Every suite uses a seeded PRNG and prints the seed. A failure records the seed in the issue, so `SEED=<n> bun test <file>` replays it.

| Suite | Invariant | PR count | Nightly | PR that adds it |
|---|---|---|---|---|
| Compaction (desktop, D-A3) | random appends, compactions and reopens on the engine (`bun:sqlite`): the Y.Doc state equals a reference document | 2,000 | 50,000 | P2.6 |
| Compaction with several writers (web, W-D3) | 2–3 `IdbDocStore` sessions, a stale writer, a stolen lock: `load()` equals the union of every acked update | 2,000 | 50,000 | W2/W3 |
| Asset GC (image store §3.4) | GC never deletes a referenced blob, a version's blob, or a blob restorable from a daily copy younger than 7 days | 2,000 | 50,000 | P2.6b, W11 |
| Comment anchors (comments §10) | a thread whose text survives resolves to the oracle's range; after a full undo, every thread resolves to its original quote | 2,000 | 50,000 | P4.9 |
| Comment convergence | 3 Y.Docs, random order and delays: identical ranges and status | 500 | 10,000 | P4.9 |
| Client-server comment agreement | every update made by `lib/comments` passes `validate.ts` | 2,000 | 50,000 | P4.9 |
| IPC guards (architecture §7) | no guard throws; none accepts input out of bounds; unknown keys are refused | 10,000 inputs per channel | 200,000 | P2.5 |
| `doc-handlers` sender and registry | appends from a window that doesn't hold the document are refused | 1,000 | 20,000 | P2.5 |
| `/_asset/` route and `argv` filter | only `^[0-9a-f]{64}$` and allowed schemes pass; traversal returns 404 | 5,000 | 100,000 | P2.5, P2.6b |
| Import guard | hostile `.tinydoc` (unknown roots, oversize, bad header, polyglot) is refused, never repaired | 2,000 | 20,000 | P2.6, P4.11 |
| Existing chaos and schema fuzz | unchanged | 5,000 ops | unchanged | — |

**Cost.** Each PR suite stays under 20 seconds. The nightly counts run in one Linux job (`nightly-desktop.yml` › `property`) of about 15 minutes.

### 1.4 Performance budgets

Hosted runners are noisy, so there are two kinds of check:
- **A/B comparisons inside one run** gate PRs.
- **Absolute numbers** gate PRs only with slack, and are measured exactly on real machines before a release.

| Budget | Source | Gate on PR | Nightly / release |
|---|---|---|---|
| Typing p95: toolbar on vs off | `performance.spec.ts` | ≤ 10% overhead (A/B) | 50 and 500 headings |
| Typing in Electron vs Chrome | S5, D-A1 | — | within 10%, macOS and Windows nightly; owner's M1 and a Windows laptop with Defender on, before each gate |
| Typing with 300 comment threads | comments §8 | ≤ 5% vs none (A/B, 1,000 headings) | — |
| Page text size or spacing change | preferences §5.15 | one layout, zero HeadingScale rebuilds | — |
| Cold start to first editable document | architecture §10 | `electron` macOS: ≤ 1.8 s (1.2 s × 1.5) | the full mark table on 3 OSes; the exact numbers on real machines before each gate |
| Sidebar populated, 1,000 documents | architecture §10, P2.6 | `local`: ≤ 600 ms × 1.5 | 3 OSes; real machines |
| List render, 1,000 and 10,000 documents | P2.7b | `local`: ≤ 100 ms at 1,000; 10,000 reported | 10,000 gated at the P2.7b target |
| Tab switch | P2.9a | ≤ 100 ms × 1.5 | — |
| Web library sidebar from IndexedDB, 1,000 documents | web library §10 | ≤ 600 ms × 1.5 | — |
| Comments open (300 threads, 2,000 blocks) | comments §8 | ≤ 50 ms total, no slice over 8 ms (unit timing, informational on PR) | gated nightly |
| Image insert (10 photos of 12 MP) while typing | image store §8 | within the `perf` budget | — |
| Bundles | chunk script, `SLASH_BUDGET`, `PALETTE_BUDGET` | editor allowance, comments lazy ≤ 14 KB (reported), palette 20 KB, slash 6 KB | — |

**Trend file.** Each nightly run writes `test-reports/perf-trend-<date>.json`, uploaded as an artifact for 90 days. `scripts/perf-trend.ts` prints the last 14 nights. A rise of more than 15% over the 7-night median opens an issue, even if the gate passed.

### 1.5 Accessibility

- **axe** through the existing `expectNoSeriousA11yViolations` helper (WCAG 2.2 AA, no serious or critical violations): on every new surface and state, in both themes. That includes:
  - sidebar, lists, Trash and Quick Open
  - Settings panes and the Page popover
  - comment cards, panel and draft
  - storage states and the share dialogs
  - every state in UX §5 and web library §9
- **Keyboard checklists** as Playwright specs, with no pointer:
  - UX §8.3 items 1–12 in `local`, and the native-menu items in `electron`
  - F6 region cycling (UX §8.2)
  - the comments keyboard flow (comments §11.5)
  - the web library sidebar
- **Forced colours and contrast:**
  - forced colours and `prefers-contrast: more`, emulated in `chromium` (WebKit has neither; it skips, as today)
  - the token contrast unit test (preferences §5.15)
- **Text spacing and scaling:** the WCAG 1.4.12 audit (preferences check 4), and interface zoom at 200% on desktop.
- **Reduced motion:** `data-motion` and the emulated media query.
- **Limits.** Playwright's own guide says automated checks miss many problems. So each design review also includes a keyboard-only walkthrough of the new surface by the UX lens, recorded in the PR.

### 1.6 Nightly streak: the definition

Plan §10 needs "7 nightly runs in a row". `nightly.yml` runs twice a day, so a count of runs is ambiguous. **The definition:**

- **Gating workflows.** `nightly.yml` and the new `nightly-desktop.yml`, on `main`, at the commit current at schedule time.
- **A green day** is a UTC calendar day on which every scheduled run of both workflows finished `success`.
- **A red day** is any job failing on a test assertion, a budget or a timeout inside a test step. It **resets the streak to 0**.
- **A void day** is a run that was cancelled or failed before any test step: runner lost, GitHub outage, a dependency download failure. It neither counts nor resets. One manual re-run is allowed per void day, linked from the streak issue. At most 2 void days fit in one streak; a third resets it.
- **Tracking.** `scripts/nightly-streak.ts` reads `gh run list` and prints the current streak per gate (Gate 2/3 set: T1–T8 and T16–T18; Gate 5 set: T1–T19 plus `library-soak`). A pinned issue holds the latest output.
- **Gate rule.** Gate 2 needs a 5-day streak. Gates 3 and 5 need 7 days. The streak must end within 3 days of the build being signed off.

### 1.7 Flake policy

TESTING.md already says a retried pass is a bug, not a pass. This extends it:

1. **Retries.**
   - PR Playwright keeps `--retries=1`. `electron` gets 1 retry.
   - Soaks, durability T-cases and property tests get **0 retries**: a failure there is evidence.
2. **A retried pass** opens an issue labelled `flaky` the same day, with the trace and the seed. The issue names the lens of the PR that added the test.
3. **2 working days** to fix it, or to quarantine it with `test.describe.configure({ tag: "@quarantine" })`. A quarantined test leaves the gating projects and runs in a non-gating nightly `quarantine` job.
4. **At most 5 tests in quarantine** at once, and **at most 14 days** each. After that the test is fixed or deleted, and the deletion goes in the CHANGELOG entry.
5. **Never quarantined:** T1–T19, the compaction, GC and anchor property tests, the refusal matrices, the IPC guard fuzz, and anything named in a gate. A flake there is treated as a possible data-loss bug (S0, §3.6).
6. **"Fixed" means** the spec passes 30 consecutive runs under `--repeat-each=30` on the runner type where it flaked, and the PR attaches the output.

### 1.8 Visual regression

**Decision: no broad `toHaveScreenshot` suite.** Playwright says rendering varies by OS, version, hardware and headless mode, and it advises generating baselines in the environment that compares them. This repo has three OSes and agents on macOS, so stored baselines would mostly report noise.

| Use | Method | Where |
|---|---|---|
| A preview equals the applied result | comparison inside one run (the `action-preview.spec.ts` pattern: at most N pixels differ by more than 2 levels) | `chromium` |
| `classic` look pixel-identical to `main` (P2.9c-1) | **stored baseline**, Linux Chromium only, generated in CI from `main` on the §5.6 fixture | `chromium`, `maxDiffPixels: 0` |
| No jump on load; skeleton and editor card the same width | geometry assertions (bounding boxes, layout-shift entries), not pixels | `chromium`, `local`, `electron` |
| Page style and width matrix | stored baselines, Linux Chromium, ≤ 24 images, `threshold: 0.2`, `maxDiffPixels: 50` | `chromium` |
| Design review | screenshots saved as artifacts (`*_SCREENS_DIR`), looked at by the UX lens, never asserted | all projects, Electron included |

**Updating baselines.** A `workflow_dispatch` job, `update-snapshots`, runs on `ubuntu-latest`, writes the PNGs, and uploads them as an artifact. The author commits them, and the PR names which baselines changed and why. The total stays at 40 images or fewer.

### 1.9 Cross-version tests

| Test | What | When |
|---|---|---|
| Mixed-version soak (existing) | N+1, N and pre-N clients on one document | nightly |
| **Desktop N with web N+1** in one share (P4.6) | the newer web can't insert a mark the floor doesn't allow; the older desktop never freezes | staging, before Gate 5. A `chromium` + `local` variant against local Hocus on every PR touching `lib/schema-*`. |
| **Golden libraries** (new; v8 adds S8 and S16) | every golden's `.tinydoc` files carry the `TINYDOC2` header (`v`, `minReader`, `enc: null`) and every `docs` row has a `link_key` (never NULL). A golden is added for each `format_version` or `DOC_SCHEMA` change, and for each stable minor (not each weekly beta, which would break the 5 MB cap in §3.1): `tests/fixtures/libraries/<format_version>-<version>/`, a small library (20 documents, tags, folders, 3 images, one comment thread), made by `scripts/fixtures/make-golden-library.ts` running **that** release. Every PR opens every golden in the engine and checks the migration hook output against a manifest. | every PR (L1) |
| **Older app, newer library** (T6) | the previous release opens the newest golden read-only | nightly `electron` |
| **N-1 → N update**, per installer format | a local generic feed (a Bun static server on 127.0.0.1) serves N; the installed N-1 updates, relaunches, and the library and backups are intact. N-1 is the last released signed artifact, downloaded from the feed host by checksum. | pre-release, on all 3 OSes; nightly on macOS once P3.3 lands |
| `.tinydoc` round trip across versions | files exported by each golden's version import identically | every PR |
| Web download → desktop import (P2.10) | identical content | every PR (`local`) |

### 1.10 Security tests

| Surface | Tests | When |
|---|---|---|
| IPC (architecture §7) | guard fuzz (§1.3); sender-frame and registry checks; golden messages; "no path from the renderer" (a `dialog.*` call with a path is refused) | every PR |
| Electron hardening | fuses asserted on the packaged binary; `will-navigate` and `window.open` denied; permission handler denies by default; the desktop CSP has no `'unsafe-inline'` and its hash matches the boot script | every PR (macOS `electron` smoke) |
| Release artifact markers | the artifact contains neither the dev-bridge nor the test-hook marker string (PR builds set `NEXT_PUBLIC_TEST_HOOKS=1`, so this runs only on release artifacts) | `release-desktop.yml`, before signing |
| Privacy | seed a known title; it never appears in `logs/diagnostics.jsonl`, Copy Diagnostics, any network request, URL or analytics call; no network with the Playground open; spellcheck makes no request | every PR (`local`, `chromium`), nightly (`electron`) |
| Share API (P4.2), OWASP-oriented | the refusal matrix (guessing, wrong token, a view token that writes, deleted, expired, removed); constant-time compare; failed-token keys per `share_id`, /64 and /48; CORS limited to the two origins; CSRF; JSON-only bodies; caps and the global creation cap; `created_ip_hash` expiry. Mapped to OWASP ASVS chapters in the Gate 4 write-up. | every PR (unit, against `spawnHocus()`) |
| Link secrets (seam S1, P4.2a–c, P4.4, W10; v8) | a P4.2 unit test asserts that **the server never receives `e`** (or `view`): create, connect, reset and asset requests carry only hashes or derived tokens; HKDF test vectors agree between Node `hkdfSync` and WebCrypto `deriveBits` (S1c); a create whose three hashes aren't distinct, or aren't 32 bytes, is refused; no token appears in a URL or a log line | every PR |
| Share API, black box | an OWASP ZAP **passive** baseline scan, rate-limited, because staging shares the production box (plan §12). The Docker image is pinned by digest, since the workflow test only checks `uses:` pins. It runs from a `workflow_dispatch` job against **staging** `/api/shares`, `/s/<id>` and the asset routes. Its report is attached to the Gate 4 sign-off. | before Gate 4 and each server release that touches these routes |
| Assets (image store §8) | the PUT matrix (422, 411, 415, 507, 451, 403, 410), the quota race, the existence oracle, sniffing, polyglots, GPS stripping | every PR |
| Comments (comments §10) | the validator refusal matrix, view-only produces zero updates, the root allowlist, delete-set root checks | every PR |
| Supply chain | `bun audit --audit-level=high`; SHA-pinned actions; provenance and SBOM verified on the release artifact (`gh attestation verify`); the extended workflow-permissions test (a job with secrets installs nothing) | every PR; at release |

---

## 2. Where each test runs, and what it costs

### 2.1 Rings

| Ring | Runs | Budget |
|---|---|---|
| **PR** (required checks) | `checks` (L0–L2, Linux) · `e2e` (`chromium` + `perf`, Linux, as today) · `local` (its own Linux job: it needs `next dev` built with `NEXT_PUBLIC_APP_TARGET=desktop`, and a second `next dev` can't share the worktree's dev directory, per TESTING.md; about 12 minutes) · `browsers` (web library specs on `webkit` + `firefox`, Linux; from W2) · `electron-mac` (unsigned `--dir` build plus the smoke specs, `macos-latest`; from P2.5) | 30 minutes wall clock. Jobs run in parallel. |
| **Nightly** (`nightly.yml` + new `nightly-desktop.yml`) | existing jobs · `electron` on macOS, Windows and Linux (full spec set, packaged installers) · `durability` (T1–T8 and T16–T18; T9–T15 and T19 from P4.x against a local Hocus) on Linux and macOS, plus Windows for T1–T3 · `property` (nightly counts) · `library-soak` · `webkit` core editing list · the `node:sqlite` contract suite inside Electron (D-A12) · `quarantine` (non-gating) | each job ≤ 60 minutes; the whole night ≤ 2 hours |
| **Pre-release** (`release-desktop.yml` checks plus the manual checklist) | signed artifacts on 3 OSes: install, N-1 → N update, uninstall and reinstall; `staging` project; ZAP (Gate 4 and server changes); real-machine perf; the manual list in §4.4 | about 3 owner-hours per stable release |
| **Electron bump** | the D-A12 smoke (`node:sqlite` present, WAL, SQLite in a worker, the protocol handler) plus the full nightly set, run on the bump PR by `workflow_dispatch` | must be green before merge |

### 2.2 Runner cost

- **The repository is public, so standard GitHub-hosted runners are free**, macOS and Windows included. Minutes aren't the constraint.
- **The constraints are concurrency and wall clock.**
  - GitHub Free allows 20 concurrent jobs, and only 5 concurrent macOS jobs.
  - PR `electron-mac` jobs and the nightly macOS jobs share those 5.
  - At about 45 PRs a week, with `cancel-in-progress` per PR, the PR load fits.
  - Nightly macOS jobs run at 03:41 UTC, when PR traffic is lowest. The 08:00 run skips the macOS durability job, so one macOS job runs at a time.
- **If the repo ever goes private**, macOS minutes cost about 10× Linux, and Windows about 1.7×. Then `electron-mac` moves to a `merge_group` or label trigger, and this section is revisited.

### 2.3 Required checks and path filters

- **Never use workflow `paths:` filters on a required check.** A required check that never starts stays pending and blocks the merge.
- Instead, `electron-mac` always runs. Its first step diffs against the merge base:
  - when nothing under `desktop/`, `lib/platform/`, `lib/prefs/`, `components/library/`, `app/`, `package.json`, `bun.lock` or `electron-builder.*` changed, it runs only the 2-minute smoke (launch, type, relaunch) and exits green
  - otherwise it runs the full PR spec set
- The same pattern applies to `browsers`, keyed on `lib/platform/`, `lib/library/` and `components/library/`.

### 2.4 Workflow rules for the new workflows

Every new workflow (`nightly-desktop.yml`, `release-desktop.yml`, `update-snapshots.yml`, `security-scan.yml`) follows the existing test:
- a read-only top-level token, and explicit per-job permissions
- `persist-credentials: false`
- actions pinned to commit SHAs
- the Node stub on PATH after install

**On signing:**
- PR builds stay **unsigned**, because fork PRs get no secrets.
- Signing happens only in the `desktop-release` environment, in a job that **installs nothing** and only signs and notarizes artifacts built by a job with no secrets (P3.1).
- S3 must show that `bun electron-builder` and `_electron` work with the Node stub on PATH. Electron's own bundled Node is fine; the system `node` is what the stub blocks. If S3 shows a builder step needs `node`, the exception is written into the workflow test, scoped to that one step.

**On the renderer (#103, [Windows export spike](../../research/2026-11-17-spike-windows-export.md)):**
- Windows never runs the desktop `next build`. Next 16.4.6 exports segment-prefetch files there under the wrong path (`__next.<segment>/__PAGE__.txt`), and prefetch 404s. Upstream: vercel/next.js#85374, still unfixed in 16.5 canary.
- `release-desktop.yml` and `nightly-desktop.yml` export the renderer once, in a Linux job with no secrets, and upload `out/` with a sha256 manifest. Each OS's packaging job downloads it and checks the manifest before staging. Every installer in a release then carries byte-identical renderer files, and one build provenance covers them. The signing job is unchanged: it still installs nothing and signs what the packaging jobs built.
- The PR job `electron-mac` may export on its own macOS runner; macOS and Linux write the same layout.
- The stage step fails on any `__next.*` directory in `out/` (architecture §3.1), so a Windows-built renderer can't reach a package by accident.
- Revisit when a Next release with the fix (vercel/next.js#92340 or vercel/next.js#99058) is pinned: Windows may then export again, but the single Linux build stays, for the identical bytes.

---

## 3. Test data

### 3.1 Rules

- **Never production data.**
  - No document, title or image from tiny.docs.plus.
  - No output of the D14 root audit (`audit-doc-roots.ts`) is ever committed or used as a fixture.
- **Generated, seeded, reproducible.** Generators extend `tests/helpers/document-generators.ts` and print their seed. Large fixtures are generated at test time into temp folders. CI caches them, keyed by a hash of the generator's source.
- **Only small goldens are committed:**
  - the golden libraries (§1.9)
  - hostile files
  - EXIF samples
  - the existing JSON fixtures
  - together under 5 MB
- **Synthetic images only.**
  - PNG, JPEG and WebP are drawn by the generator, using an encoder already in the dependency tree, or taken from tiny committed samples. No new image dependency is added for tests.
  - GPS and EXIF blocks are synthetic, with made-up coordinates.

### 3.2 Fixture library (`scripts/fixtures/`)

| Fixture | Contents | Used by |
|---|---|---|
| `library-s` | 20 documents, 3 folders, 5 tags | `local` and `electron` smoke |
| `library-1k` | 1,000 documents in 4-level folders, 30 tags, about 200 MB with images (the architecture §10 target) | startup and sidebar budgets, T8 |
| `library-10k` | 10,000 documents, titles only, about 40 MB | the P2.7b list budget |
| `doc-large` | 1,000 and 2,000 headings, rich content (the `generateLargeDocument` defaults) | `perf`, find and replace, comments open |
| `doc-near-cap` | 1.9 MB of Yjs state, near the 2 MiB production cap and frame cap | T11, size refusals |
| `doc-images` | 10 inline data-URL images (migration source), 200 asset images, 12 MP photos | P2.6c, T17, T18, the image `perf` case |
| `doc-rtl` | Persian body with Arabic-script diacritics, mixed RTL and LTR blocks, Persian titles | P2.13, the spacing check on three engines |
| `doc-comments` | 300 threads, overlaps, detached cases | comments `perf` and design review |
| `doc-legacy` | `link` and `code` marks, editor-root leftovers, schema 1 and 2 bundles | migrations, mixed-version soak |
| `hostile/` | titles with separators, `..`, reserved names (`CON`, `aux`), 300-character names, trailing dots; a bad `.tinydoc` header; unknown roots; an SVG named `.png`; an HTML/PNG polyglot; a GIF bomb | P2.8, the import guard, image sniffing |
| `prefs/` | about 40 stored preference payloads, including newer `v` and invalid ones | boot-script parity, migration matrix |
| `web-library/` | IndexedDB dumps at `format_version` N and N+1 | the versions test, the eviction marker |

**Seeding commands** (all Bun):
- `bun scripts/fixtures/generate.ts --set library-1k --seed 42 --out $TMP`
- `bun scripts/fixtures/make-golden-library.ts`: run by the release job against the release build; its output is committed in the release-prep PR

---

## 4. Beta program for the 10 testers

### 4.1 Distribution

- **Signed builds on the update feed's `beta` channel**, from Gate 3.
  - electron-builder's generic provider (owner-controlled host, plan §8.3).
  - The tester installs once from a direct link in the onboarding email. Updates arrive in the app.
  - No GitHub Release is used for update files (plan §2: the GitHub provider reads `/releases/latest`).
- **The channel defaults to the installed build's line.**
  - Every build before 1.0.0 is a beta (§5.1), and the stable feed stays empty until then. A tester on a Stable default would check an empty feed and never update.
  - **Rule (adopted in plan v7):** a build whose version has a prerelease suffix defaults `updates.channel` to Beta; a plain version defaults to Stable. **The default is computed, never stored:** the default `prefs` JSON has no `"channel"` key (preferences row 23 and §5.2, amended). A stored choice, made by the user, always wins.
  - The update-channel rule is on D30's never-cut list.
- **Channel mapping, verified in S3** ([write-up](../../research/2026-11-16-spike-s3-packaging-updates.md), electron-updater 6.8.11):

  | `prefs.updates.channel` | Stored? | `autoUpdater.channel` | `allowPrerelease` | Feed file | Then |
  |---|---|---|---|---|---|
  | unset (default) | never; computed from `app.getVersion()` | setter **not called**: a `-beta.N` build's `app-update.yml` already says `channel: beta` | constructor default | `latest*.yml`, or `beta*.yml` for a `-beta.N` build | `allowDowngrade = false` |
  | Stable | yes | `"latest"` | `false` | `latest*.yml` | `allowDowngrade = false`, the last assignment |
  | Beta | yes | `"beta"` | `true` | `beta*.yml` | `allowDowngrade = false`, the last assignment |

  - A `-beta.N` build requests `beta.yml` (`beta-mac.yml`, `beta-linux.yml`).
  - **Stable builds also write `beta.yml`** with `generateUpdatesFilesForAllChannels: true`, and a `0.0.3-beta.1` install was offered and installed stable `0.0.4`.
  - **Only the `channel` setter turns `allowDowngrade` on.** `generateUpdatesFilesForAllChannels` is build-time only. P3.3 assigns `allowDowngrade = false` after the setter, right before every `checkForUpdates`. A feed offering `0.0.0` then installs nothing, on the default path and after switching from Beta to Stable. The negative control without the reset installed `0.0.0`.
  - `allowPrerelease` only affects the GitHub provider. It is set so the state reads consistently.
- **Live features before Gate 4 point at staging** (plan §8.4). Beta builds read the staging URL at build time. A tester never shares through production before Gate 4.
- **Gate 2 builds** are unsigned internal builds for the owner and 2 technical testers who accept the Gatekeeper and SmartScreen steps (D32). All 10 get signed `0.2.0-beta` builds at Gate 3.

### 4.2 Onboarding (week 0 of the beta)

- **One email per tester**, from the owner, containing:
  - the download link and checksum
  - what the beta is: private local documents, offline, and nothing leaves your machine unless you share
  - what to expect: weekly updates, a 5-minute weekly check-in, and how to report a problem
  - the privacy note: no telemetry, update checks only, crash dumps stay on your machine
  - how to leave, and what happens to your documents (they stay; uninstall never deletes them)
- **A 20-minute call, or a written walkthrough if they prefer:**
  - install
  - Where Are My Documents? (Help)
  - Backup and Restore
  - Report a Problem
  - Copy Diagnostics
- **A tester ID, T01–T10.** Only the owner holds the ID-to-name map, kept offline and never in the repo or an issue.
- **OS mix** (D32): 4 macOS (recommended: at least one Intel), 4 Windows 11, 2 Linux (recommended: one GNOME Wayland, for the IME).

### 4.3 What we ask each week

Each week has one focus task of 15–30 minutes. Otherwise testers use the app for real work.

| Week | Focus task | Proves |
|---|---|---|
| 1 | Install. Move 5 real documents in (import, or Download from the web sandbox). Make folders and tags. | First run, import (P2.8, P2.10), the sidebar |
| 2 | Work offline for a day (Wi-Fi off). Use Quick Open and Find. | Goal 1; no network dependency |
| 3 | Restore drill: Restore from Backup…, then Restore from a daily snapshot. Then Undo. | D-A6, D-A7, P2.9b |
| 4 | Let an update install with documents open. Force-quit the app once while typing, then reopen. | T4 in the wild; quit flush; `quick_check` |
| 5 | A long document (over 1 MB) with 10 or more pasted images. Print it. | The image store, P2.6c, the print stylesheet |
| 6 | Page preferences: a style, text size, per-document width, reading mode. A Persian or RTL document if you write one. | P2.9c, P2.13 |
| 7 | Export all, then move to a second machine or account if you have one (Help › Moving Computers). | Export round trip, golden import |
| 8 | Free use, plus the exit survey (§4.9) | D0 bar |
| From Gate 4 | Pairs of testers share a document on staging, comment, and reset the link. Then a 3-person session across Mac, Windows and Linux. | Live rows, comments, T12–T14 in the wild |

### 4.4 Release checklist

**Every beta and stable build.** QA prepares it, O signs it. It is filed as a `desktop-release` issue from a template.

- [ ] **For a gate release:** the nightly streak meets the gate (§1.6), and the streak issue is linked. **For a weekly beta train:** the §5.2 train rule holds. **For a hotfix or security release:** the hotfix evidence set (§5.6) is attached.
- [ ] CI green on the tagged commit of `main`. No open S0 or S1 for this version.
- [ ] The release job is green: provenance, SBOM, signature and notarization verified; the artifacts contain no dev-bridge or test-hook marker.
- [ ] On real machines, at least one per OS: fresh install, N-1 → N update, uninstall and reinstall (library and backups survive), and a document over 1 MB with images.
- [ ] Gatekeeper shows no block. The SmartScreen behaviour matches the documented note.
- [ ] Startup and typing on the owner's M1 and a Windows laptop: within the architecture §10 targets.
- [ ] The release notes (§5.4) are reviewed, and the in-app What's New matches them.
- [ ] The feed is edited for the rollout start (§5.5), and the halt procedure is rehearsed on the beta channel once per gate.
- [ ] **Live releases only:** the `staging` project is green; the 3-OS live session ran; a share link survived a link-scanning mail service.

### 4.5 Feedback without accounts

**Help › Report a Problem…** opens a small native dialog with two choices:

1. **Email (default).**
   - Opens the mail app with a prefilled subject (`TinyDocy <version> problem`) and a short template: what you did, what you expected, what happened, and is a document missing or wrong?
   - One line asks the tester to paste Copy Diagnostics.
   - It goes to the new dedicated email alias the owner reads (D31). The owner files sanitised GitHub issues from it (§4.7).
   - No account needed.
2. **GitHub** (needs an account).
   - Opens the `desktop-bug` issue form, which has a field for diagnostics and a reminder: "Don't paste document text."

**Copy Diagnostics** carries only what architecture §9 allows:
- versions, channel, `format_version`
- library counts and sizes
- the last 200 log entries (codes and hashed ids only)
- crash dumps listed, and attached only after a second consent

**Any new field must be a count, an enum or a hashed id.** The privacy e2e test (§1.10) checks that.

### 4.6 Crash triage

- **Dumps stay local.** `crashReporter.start({ uploadToServer: false })` stores minidumps in `app.getPath('crashDumps')` (plan non-goal: no uploads).
- **Symbolication.** `bunx --bun electron-minidump <dump>` downloads Electron's symbols from `symbols.electronjs.org`.
  - The app ships no native modules of its own (`node:sqlite` is part of Electron), so Electron's symbols cover every native frame.
  - If a native module is ever added, `dump_syms` output for every shipped version is kept beside the release artifacts.
- **JavaScript errors** come from the diagnostics log codes (architecture §9). The release record keeps the `IPC_BUILD` SHA, so any log maps to its exact commit.

### 4.7 From feedback to issues and PRs

1. **The owner reads the inbox twice a week** (Tuesday and Friday), and daily for any message that says a document is missing or wrong.
2. **Each report becomes a GitHub issue filed by the owner.** It is sanitized: tester ID only, no document text, diagnostics attached with hashed ids.
   - Labels: `beta-feedback`, a severity, an area.
3. **Severity:**

   | Sev | Meaning | Response |
   |---|---|---|
   | **S0** | Data loss or corruption, a document visible to others without consent, a security issue | Reply within 2 working days (plan P3.4); same day if possible. Halt the rollout the same day if the report is plausible. Fix PR with a regression test that fails on `main` first, as P1.1 did. Hotfix (§5.6). |
   | **S1** | Crash at launch, can't open the library, an update fails, can't type | Reply in 2 working days; fix in the next train or a hotfix |
   | **S2** | A feature is broken but has a workaround | Next train |
   | **S3** | Polish and copy | Batched into design-review follow-ups |

4. **Every fix PR links the issue and carries a CHANGELOG entry.** When it ships, the owner replies to the tester with the version that fixes it.
5. **No fix is "done" until a test covers it**, at the lowest layer that can reproduce it.

### 4.8 Weekly check-in template

A plain-text email, sent each Monday. Testers can answer in one line each.

```text
TinyDocy beta, week N. About 5 minutes, reply inline.

1. Version (Help › About › Copy Version Info):
2. On how many days this week did you write or edit in TinyDocy? (0–7)
3. Roughly how many documents do you have in it now?
4. Did anything go missing, look wrong, or fail to save? (yes/no; if yes, a line,
   and Copy Diagnostics if you can)
5. This week's task (<focus task>): done / skipped / stuck where?
6. The one thing that annoyed you most:
7. Would you keep using it if the beta ended today? (yes / maybe / no)
```

The owner copies the answers into a private spreadsheet keyed by tester ID. Only aggregates go into the gate issue ("6 of 10 edited on 3 or more days").

### 4.9 Success bar (D0) and exit to Gate 5

**D0 success bar**, measured from check-ins only (no telemetry). It is checked at Gate 3 + 4 weeks, and again before Gate 5:
- At least 5 of 10 testers edited on 1 or more days a week in each of weeks 3 and 4 (plan §10's example).
- At least 3 of 10 answer "yes" to question 7 in week 4.
- Zero unresolved S0 reports. Every S0 has a regression test.
- Every tester installed a signed build without help, or the install guide was fixed after the first one who needed it.

**Exit from the beta to Gate 5:**
- [ ] The D0 bar is met in two consecutive check-in rounds.
- [ ] At least 2 auto-update cycles completed on the beta channel by every active tester, with no manual reinstall.
- [ ] No S0 in the last 4 weeks. No open S1.
- [ ] From Gate 4: at least 4 testers used sharing and comments on staging for 2 weeks, and the 3-OS session passed.
- [ ] The plan §10 Gate 5 checklist and §6's evidence table are complete.
- [ ] An exit survey (5 questions, the same channel) is collected from at least 7 testers.

---

## 5. Release process

### 5.1 Versioning

| Line | Tag | Version | Released by |
|---|---|---|---|
| Web (unchanged) | `vX.Y.Z` | the web app at tiny.docs.plus, deployed continuously | `release.yml` (GitHub Release with generated notes) |
| Desktop | `desktop-vX.Y.Z[-beta.N]` | the Electron app | `release-desktop.yml` (P3.1) → the feed host |

**Mapping to gates** (owner question 1):

| Gate | Desktop version | Channel | Who |
|---|---|---|---|
| Gate 2 | `0.1.0-internal.N`, unsigned, not on the feed | — | owner and up to 2 technical testers |
| Gate 3 (Local milestone) | `0.2.0-beta.1` onward | `beta` | the 10 testers |
| Gate 5 (v1 public) | `1.0.0-beta.1` onward | `beta`; the public download page says "Beta" | public |
| Stable v1.0 (plan §10: 8 weeks of beta, 2 update cycles, a schema-floor rehearsal, an Electron major) | `1.0.0` | `stable` opens | public |

**Rules:**
- **semver:** minor for features, patch for fixes, major only for a change that drops a supported OS or a library format reader.
- **`format_version`, `DOC_SCHEMA` and `CLIENT_SCHEMA` are separate from the app version.** Each release note states them.
- **The web library launches with Gate 5:** `NEXT_PUBLIC_LIBRARY` turns on at the library origin, and the web is tagged `vX.Y.0` that day.
- **Tag hygiene:**
  - `release.yml` triggers on `v*`, and `desktop-v…` doesn't start with `v`, so it doesn't match.
  - A unit test asserts both directions, so a future pattern change can't publish a web release for a desktop tag, or the reverse.
  - A tag ruleset limits `desktop-v*` to the owner.
- **Desktop GitHub Releases, if created for notes, use `--latest=false`**, so the repo page keeps pointing at the web release.

### 5.2 Release train

| Period | Cadence | Content |
|---|---|---|
| Gate 3 → Gate 5 | **beta weekly**: cut Monday from `main` if the streak holds, out Tuesday | everything merged; testers get the week's focus task with it |
| After Gate 5 | **beta weekly**, **stable every 4 weeks**: the beta that has spent 7 or more days at 100% with no S0 or S1 is promoted | Electron is upgraded at least every second major (K13); a release with an Electron major gets a full extra beta week |
| Any time | hotfix and security releases (§5.6, §5.7) | — |

**Train rule (lighter than a gate).** A weekly beta ships when:
- CI is green on the commit
- the durability set (T1–T8 and T16–T18, and T9–T15 and T19 once they exist) passed on the last 2 nights
- there is no open S0

The full 7-day streak is kept for gates only. Requiring it for every train, with a reset on any red night, could stall weekly betas for weeks. If the train rule fails, the train waits; the scope doesn't change.

### 5.3 Per-gate release checklist (adds to §4.4)

| Gate | Added items |
|---|---|
| Gate 2 | Internal build installs on all 3 OSes. T1–T8 and T16–T18: a 5-day streak. No open data-loss bug. The 10 testers named and onboarded (signed builds follow at Gate 3). |
| Gate 3 | The whole plan §10 Local list. A 7-day streak. The release runbook followed once on a beta. The privacy page's summary and `#desktop` section (v8; `#shared-documents` and `/terms` at Gate 4, `#my-documents` at Gate 5), Help pages and the support mailbox live. The halt rehearsed. The D33 trademark answer and D35 organisation signing in hand: this build locks the install identifiers. |
| Gate 4 (server, not a desktop release) | The share API, assets and comments server on production behind `HOCUS_SHARES`, `HOCUS_ASSETS` and `HOCUS_COMMENTS`. The OWASP write-up with the ZAP report. The Deploy notes, legal, privacy, terms and takedown runbook signed off. The D14 audit run. The `staging` project green against the exact commit being deployed. |
| Gate 5 | The whole plan §10 v1 list. A 7-day streak including T9–T15, T19 and `library-soak`. The beta exit (§4.9). The download page and README live. The announcement drafted. **v8 (D36):** the phones design's §9.4 real-device checklist on the owner's iPhone, the bought Android and the device cloud; `#my-documents` live. |
| Stable v1.0 | Plan §10's Stable list. The schema-floor rehearsal recorded in the schema runbook. **v8:** the phones §9.4 checklist again, as at every stable promotion; weekly betas don't run it. |

### 5.4 Release notes and What's New

- **The source is CHANGELOG.md** (Keep a Changelog, grouped by PR, as now).
  - Each PR that changes the desktop app adds a `Desktop:` line in user voice inside its entry.
  - Operator-facing Deploy notes stay where they are.
- **At release,** `scripts/desktop-release-notes.ts` collects the `Desktop:` lines merged since the last `desktop-v*` tag into `desktop/whats-new/<version>.md`. That file has at most 6 bullets in user voice, plus the format and schema line.
- **The owner edits the file in the release-prep PR.**
- **The CHANGELOG gets a `## Desktop <version>` heading** under Unreleased in that PR, pointing at the notes.
- **In the app, What's New is bundled at build time and never fetched** (Goal 1: no network unless the user asks).
  - After an update, one pill per launch: "Updated to 1.2." with [What's New].
  - Help › What's New opens the bundled page.
  - There is no modal and no automatic popup.

### 5.5 Staged rollout and halt

electron-builder documents `stagingPercentage` (0–100), set by editing `latest.yml` / `latest-mac.yml` on the feed.

| Channel | Schedule |
|---|---|
| `beta` (10 testers, then the public beta) | 100% after the owner's own install and update check. With 10 testers, percentages are meaningless; with the public beta, use the stable schedule from `1.0.0-beta.1` onward. |
| `stable` | Day 0: 10% → day 2: 30% → day 4: 60% → day 7: 100%. Each step needs no new S0 or S1 report since the previous one and an empty Report-a-Problem inbox check. (Apple's own phased release runs 1% to 100% over 7 days; a small user base needs bigger first steps to learn anything.) |

**Halt:**
1. Set `stagingPercentage: 0` in that OS's manifest. P3.3's exit criterion requires new downloads to stop within 5 minutes.
2. Post a note on the download page.
3. Open an S0 or S1 incident issue.

**Verify in P3.3:** a community report says a manual "Check for Updates" can bypass staging unless the value is exactly 0. Until that is confirmed, the halt always uses 0, never a small percentage.

### 5.6 Rollback, hotfix and the `format_version` guard

- **Rollback means roll forward.** electron-builder says a bad release is pulled by shipping a higher version. The app never downgrades (`allowDowngrade` off).
- **Hotfix path:**
  1. Fix PR to `main` with a regression test.
  2. If `main` holds unreleased work that isn't ready, cut `desktop-release/X.Y` at the bad tag and cherry-pick the fix. CI runs on PRs into that branch.
  3. Tag `desktop-vX.Y.(Z+1)` and roll it out on the stable schedule, compressed to 0 → 50 → 100% within 24 hours when the fix is small and the halt is in effect.
- **Hotfix evidence set** (in place of the streak, which counts only `main` and can't wait 7 days):
  - CI green on the exact commit
  - one `workflow_dispatch` run of `nightly-desktop.yml` on that commit (durability and `electron` on 3 OSes), green
  - the real-machine install and N-1 → N update from §4.4
  - the waiver recorded in the release issue
  - **No waiver for a release that changes `format_version`**: that needs the full streak.
- **`format_version` bumps ship in two steps.** T6 makes a newer library read-only in an older app, so a bad bump can't be rolled back by shipping older code. The rule:
  1. **Release N** ships the reader for the new format and the migration, both dormant.
  2. **Release N+1** turns the writer on, only after N has spent 14 days at 100% on stable. It runs `VACUUM INTO` before migrating (D-A6), and T5 and T6 cover that exact pair in the nightly.
  3. If N+1 is bad, N+2 fixes forward, and the pre-migration copy stays available through "Restore from a daily snapshot".
  - A bump never shares a release with an Electron major.
- **Schema floors on the server** (`CLIENT_SCHEMA`) follow the existing schema rollout runbook, extended for desktop (P3.4).

### 5.7 Security releases within 7 days

1. **Day 0:** triage an advisory or report against `SECURITY.md` within 1 working day (Electron security release, dependency CVE, or our own bug).
2. **Electron fixes need the documented `minimumReleaseAge` override:**
   - the PR sets a per-package exception in `bunfig.toml` with an expiry comment
   - names the advisory
   - and a follow-up PR removes it after 3 days
3. **Ship to beta the same day the hotfix evidence set (§5.6) is green.** Ship to stable on a compressed schedule: 25% → 100% within 48 hours.
4. **Disclosure** after 100%, in the CHANGELOG and the release notes. The 7-day clock ends at 100% on stable.

### 5.8 Download page, README and announcement

- **During the beta:** no public download page. Testers get a direct link and SHA-256 checksums by email.
- **At Gate 5, a `/download` page on the web.** Its copy comes from `site-config.ts`, as every public copy does. It has:
  - OS detection, with links to all formats on the feed host and their checksums
  - system requirements
  - the SmartScreen note and the Linux `.deb` / AppImage steps
  - "Beta" until 1.0.0
  - the privacy line: no account, no telemetry, documents stay on your computer
- **README:** a Download section linking the page, with no step-by-step installer guides. Help pages carry those.
- **The announcement** is drafted in the Gate 5 issue, posted by the owner on the existing community channels, and links the release notes.
- **No marketing claim the tests don't back.** "Works offline" and "nothing leaves your computer" are each backed by a named test (the no-network checks in §1.10).

---

## 6. Gate evidence map

### 6.1 By gate

| Gate | Required evidence | Where it comes from |
|---|---|---|
| **Gate 1** | S1–S5 pass notes with logs or screenshots on 3 OSes. The D-A12 smoke runs in CI. D0–D10 answered. Staging reachable (a `curl` of `/api/info` on the staging host). Signing enrolment under way. | spike PRs (throwaway code; only the D-A12 smoke and the S4 spec survive into `electron`) |
| **Gate 2** | T1–T8 and T16–T18: a 5-day streak. The `DocStore` / `DocSession` / `BlobStore` contracts on memory, `bun:sqlite` and `node:sqlite` in Electron. The compaction and GC property tests at nightly counts. The `local` project green. The keyboard checklist (UX §8.3) green. Startup and sidebar budgets on macOS. No open data-loss bug. | `nightly-desktop.yml`, `checks`, `e2e`, `electron-mac` |
| **Gate 3** | Everything in Gate 2, with a 7-day streak. The N-1 → N update on every installer format. Signing, provenance, SBOM. Screenshots of every Local state on 3 OSes (UX sign-off). No network with the Playground open, and none from spellcheck. The chunk budget for both targets; `perf` with no regression; the `classic` pixel baseline (the page, not icons: B1 changes icons before Gate 2, v8). The §4.4 checklist. | nightly, release job, real machines, the design-review artifacts |
| **Gate 4** | The share API refusal matrix; capacity and the server restart (T15) on staging; the comments validator and root allowlist; the asset PUT matrix; the ZAP report; the OWASP write-up; the D14 audit. | `checks`, `staging`, `security-scan.yml` |
| **Gate 5** | T1–T19 and `library-soak`: a 7-day streak. P4.6 skew e2e on staging. The web library on `chromium`, `webkit` and `firefox` (eviction, multiple tabs, quota). Comments anchor fuzz and view-only zero-write. The image GC, hash and migration tests. UX sign-off on every live state. The beta exit (§4.9). | all rings, the beta records |
| **Stable 1.0** | 8 weeks with no data-loss report, 2 update cycles, a schema-floor rehearsal, an Electron major shipped | release records |

### 6.2 By PR group

| PR group | Must add, and pass on the PR | Nightly or pre-release evidence |
|---|---|---|
| **P1.1, P1.1b** (sandbox storage) | A test that fails on `main` first (slow-hydrate overwrite; two tabs overwriting). Unit and e2e green. | T7 |
| **P1.2** (shortcuts) | Shortcut registry has no duplicates. Screenshots for design review. | — |
| **P2.1–P2.3** (ports, no-provider editor, index) | The contract suites. The tab e2e suite unchanged. No socket with no provider. The chunk allowance. | the `node:sqlite` contract in Electron |
| **P2.4–P2.5** (target, shell) | The `local` project. The fuses. `argv` and navigation denial. The IPC guard fuzz. Installers build on 3 OSes. | `electron` on 3 OSes |
| **P2.6, P2.6b, P2.6c** (storage, assets, migration) | The compaction and GC property tests. The `BlobStore` contract. Route fuzz. The migration size-drop and undo-untouched tests. Golden library 1 committed. | T1–T8, T16–T18; the sidebar budget at 1,000 documents |
| **P2.7a, P2.7b** (library UI) | The keyboard checklist. Folder-into-descendant refused. The list budgets at 1,000 and 10,000. axe on every state. Design review. | 10,000 gated |
| **P2.8, P2.10** (files, Download) | Round trips. Hostile filenames. Secrets stripped. Download → import identical. | cross-version `.tinydoc` |
| **P2.9c-1, P2.9c-2, F1–F5, W13** (preferences) | Preferences unit list and Playwright checks 1–13. The `classic` baseline. Boot-script parity and CSP hash. The Persian check on three engines. Chunk ≤ +150 B. Design review. | Electron no-flash |
| **P2.9a, P2.9b** (chrome, Settings) | UX §11 checklist items 1–14 on each OS. Every Local state screenshotted. Backup and restore round trip with Undo. No network with the Playground. | `electron` on 3 OSes |
| **P2.11–P2.13** (find, Markdown, RTL) | Find on 1,000 headings with no typing lag. Markdown round trip. RTL round trip and the mixed-version soak. | mixed-version soak |
| **P3.1–P3.5** (distribution) | The extended workflow test (a job with secrets installs nothing). The tag-pattern test. The halt within 5 minutes. N-1 → N for every format. Runbook dry run. | pre-release |
| **P4.0–P4.8** (live) | The reducer table covers every §5.5 state. The refusal matrix including 1009. View-only filtering. An e2e for each live state. Presence doesn't re-render the toolbar. Restore is one forward edit. | T9–T15 and T19; `staging` |
| **P4.2f-1, P4.2f-2, P4.9–P4.12** (comments) | Anchor fuzz, convergence and agreement. The validator matrix. View-only zero updates. Copies stripped. `perf` within 5%. Design review at 1440, 1100 and 820 px. | the comments soak variant |
| **Image store** (U1, A0, A1, W11, S-A1, S-A2) | The image store §8 unit list and the mixed-version list. | T16–T19; staging asset cases |
| **Web library** (W1–W13) | Web library §10 rows on `chromium`, `webkit` and `firefox`. Fresh storage makes no socket and no GA request. The privacy title test. | `library-soak`, 50,000-run multi-writer property test |

**Every PR, whatever the group:**
- a CHANGELOG entry
- a design review if the UI is visible
- merged only on CI against the current main
- stacked PRs retargeted to `main` before the parent merges

---

## 7. Owner workload, questions, and the task list

### 7.1 Owner hours during the beta (Gate 3 → Gate 5)

| Task | Hours a week |
|---|---|
| Inbox and issue filing (twice a week, plus same-day S0 reads) | 1.0 |
| Weekly check-in: send, read, aggregate | 0.5 |
| Beta train: approve the release job, edit the feed, install on own Mac | 0.75 |
| Real-machine checks on Windows and Linux (install, update) | 1.0 (lower if a tester or the second person covers them) |
| Replies to testers, onboarding stragglers | 0.5 |
| Design reviews for beta fixes | 0.5–1.5 |
| From Gate 4: staging sessions and the 3-OS live check | +0.5–1.0 |
| **Normal week** | **about 4–6** |
| **A week with an S0 report** (reproduce, halt, hotfix, reply) | **up to 10** |

This is about half of the plan's 10 owner-hours a week, during the same months as Phase 4 reviews. **Plan v7 counts it:** about 5 of the 10 owner-hours a week from Gate 3 to Gate 5 (plan §8.1, §8.2, risk K23). A second person (K15) who handles the inbox and Windows checks would take about 2 hours off it.

### 7.2 Owner questions (each with a recommendation)

**All three answered in plan v7 as recommended:** question 1 by D32, question 2 by D31, question 3 by D32 (4 / 4 / 2). The text below is kept as the record.

1. **Gate-to-version mapping.**
   - Plan Gate 2 says the 10 testers "have the build", while Gate 3 says they get signed builds.
   - **Recommended:**
     - Gate 2: owner plus at most 2 technical testers on unsigned `0.1.0-internal` builds
     - Gate 3: all 10 on signed `0.2.0-beta` builds
     - Gate 5: public `1.0.0-beta.N`, labelled Beta
     - Stable `1.0.0` after the plan's 8-week bar (§5.1)
2. **The feedback mailbox.**
   - **Recommended:** a dedicated address you control (for example, a `desktop-beta@` alias on the docs.plus domain), read by you (or the second person), with you filing sanitized GitHub issues.
   - Testers may use GitHub if they want, but are never required to have an account.
3. **Tester OS mix and real-machine coverage.**
   - **Recommended:** recruit 4 macOS (one Intel), 4 Windows 11 and 2 Linux (one GNOME Wayland).
   - Name one Windows tester and one Linux tester as release-check volunteers, so the per-release install and update check doesn't need machines you don't own.

### 7.3 PR and task list

Effort is in agent-days. Rows marked "in P…" ride inside an existing plan PR. The others are new.

| # | PR / task | Contents | Effort | Lands with |
|---|---|---|---|---|
| Q1 | `test(fixtures): seeded fixture generators` | `scripts/fixtures/generate.ts`, the §3.2 sets, synthetic images and EXIF, the hostile set, a CI cache key | 2.0 | before P2.6 |
| Q2 | `ci: local project as its own PR job` | in P2.4: a separate Linux job with its own `next dev` (desktop target) and the dev storage host | 0.5 | P2.4 |
| Q3 | `ci: electron-mac PR job` | unsigned `--dir` build, smoke and full spec sets, merge-base diff step, artifact on failure | 1.5 | P2.5 |
| Q4 | `ci: nightly-desktop workflow` | `electron` on 3 OSes, `durability`, `property`, the Electron `node:sqlite` contract, `webkit` core list, `quarantine` | 3.0 | P2.6 |
| Q5 | `chore(scripts): nightly streak tracker` | `scripts/nightly-streak.ts`, the §1.6 rules, a pinned issue updated by hand from its output | 0.5 | P2.6 |
| Q6 | `test: flake quarantine` | `@quarantine` tag, grep-invert in gating projects, the TESTING.md policy, a unit test that refuses quarantine tags in the never-quarantine list | 1.0 | any time |
| Q7 | `ci: browsers job for the web library` | `webkit` + `firefox` projects, library specs, Persian spacing. **The only PR that defines the `firefox` project**; L7 adds its RTL specs to it, and P2.13's exit depends on it. | 1.0 | W2 (and before P2.13) |
| Q8 | `test(a11y): keyboard checklist and region focus specs` | UX §8.3 items 1–12, F6, the helper extended to Electron windows | 1.5 | P2.7a, P2.9b |
| Q9 | `test(visual): Linux baselines and update-snapshots workflow` | the `classic` and page-matrix baselines, ≤ 40 images | 1.0 | P2.9c-1 |
| Q10 | `test(security): ZAP baseline against staging` | `security-scan.yml` (`workflow_dispatch`, read-only, staging URL from an environment variable, refuses non-staging hosts) | 1.0 | P4.2 |
| Q11 | `test: golden libraries and the local update feed` | `make-golden-library.ts`, the every-PR golden open, N-1 → N with a Bun static feed | 2.0 | P2.6, P3.3 |
| Q12 | `test(ci): tag-pattern and release-workflow rules` | `v*` vs `desktop-v*` in both directions; the secrets-job rule | 0.5 | P3.1 |
| Q13 | `docs(ops): desktop release and beta runbook` | in P3.4: §4 and §5 as `docs/operations/desktop-release-runbook.md` and `desktop-beta-program.md`; the `desktop-release` issue template; the check-in template | 1.0 | P3.4 |
| Q14 | `feat(desktop): Report a Problem and What's New` | in P3.4: the dialog, `mailto` template (to the D31 alias), `desktop-bug` issue form, `desktop-release-notes.ts`, the bundled What's New page and pill. **Merged with OB3** (onboarding design): one PR, one What's New. **Design review.** | 1.5 | P3.4 |
| Q15 | `test(perf): trend reports` | `perf-trend.ts`, 90-day artifacts, the 15% drift issue | 1.0 | P2.6 |
| Q16 | `feat(web): download page` | `/download` from `site-config.ts`, checksums, README section. **Merged with OB4** (onboarding design): one PR, one `/download` page. **Design review.** | 1.0 | before Gate 5 |
| Q17 | `docs(tests): TESTING.md for the new layers` | projects, rings, streak, flake policy, fixtures | 0.5 | with Q4 |
| | **Total** | | **about 20.5** | |

**Order.** Q1, Q6 and Q17 any time. Q2–Q5, Q11 and Q15 alongside Phase 2. Q12–Q14 with Phase 3. Q7 with W2. Q10 before Gate 4. Q16 before Gate 5.

---

## Sources

- electron-builder, Auto Update (staged rollouts, `stagingPercentage`, generic provider, pulling a release by a higher version): https://www.electron.build/docs/features/auto-update
- Electron, `crashReporter` (`uploadToServer: false`, the `crashDumps` path): https://www.electronjs.org/docs/latest/api/crash-reporter
- Electron, Crash Reporting tutorial (symbol server, `electron-minidump`, `dump_syms` for native modules): https://www.electronjs.org/docs/latest/tutorial/crash-reporting
- Apple, Release a version update in phases (1, 2, 5, 10, 20, 50, 100% over 7 days; pause up to 30 days): https://developer.apple.com/help/app-store-connect/update-your-app/release-a-version-update-in-phases/
- GitHub, Actions billing (standard runners free in public repositories): https://docs.github.com/en/billing/concepts/product-billing/github-actions
- GitHub, Actions limits (Free: 20 concurrent jobs, 5 macOS): https://docs.github.com/en/actions/reference/limits
- GitHub, runner per-minute rates (macOS about 10×, Windows about 1.7× Linux): https://docs.github.com/en/billing/reference/actions-minute-multipliers
- Playwright, Visual comparisons (rendering varies by OS and hardware; platform in snapshot names; `maxDiffPixels`, `threshold`): https://playwright.dev/docs/test-snapshots
- Playwright, Electron (experimental; Electron ≥ 21): https://playwright.dev/docs/api/class-electron
- Playwright, Accessibility testing (`@axe-core/playwright`; automated checks miss many problems): https://playwright.dev/docs/accessibility-testing
- Google Testing Blog, Flaky tests at Google (rerun only for tests marked flaky): https://testing.googleblog.com/2016/05/flaky-tests-at-google-and-how-we.html
- **Unverified (community report, check in P3.3):** a manual update check bypasses staging unless `stagingPercentage` is 0 (electron-builder PR #9016, as reported in a Trezor Suite PR).
