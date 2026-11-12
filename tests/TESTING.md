# Testing Infrastructure

TinyDocy uses a multi-layer testing strategy covering schema correctness, feature behavior, performance, long-running stability, and real-time collaboration at scale.

**Recent additions:** Configurable performance tests — `make test-perf` (single-user typing latency, `PERF_HEADINGS`, `PERF_SHAPE`) and `make test-perf-collab` (multi-user concurrent typing on a shared document, `PERF_COLLAB_USERS`, `PERF_COLLAB_HEADINGS`, `PERF_COLLAB_SHAPE`). See Performance Tests and Multi-User Performance Tests sections below. All test layers write reports to `test-reports/` when run via Make targets. Collaboration tests use `retries: 2` and extended waits to reduce flakiness.

**Prerequisites:** Dev servers must be running for Playwright tests.

```bash
make dev
```

## Quick Reference

| Command | What it runs | Duration |
|---------|-------------|----------|
| `make test` | Unit, fuzz, schema and plugin tests (`bun test`) | ~8s |
| `make test-fuzz` | Chaos and structured fuzz tests | ~1s |
| `make test-stress` | Headless stress probe (binary search for heading ceiling) | ~30s |
| `make test-e2e` | Playwright `chromium` E2E suite (features, collaboration), then the `perf` project (typing budget) | ~90s |
| `make test-perf` | Typing latency tests only, `perf` project without its `chromium` dependency (default 10, 50 headings; `PERF_HEADINGS=200` for custom) | ~15s |
| `make test-perf-collab` | Multi-user typing latency on shared doc (default 2 users, 50 headings) | ~30s |
| `make test-load` | Yjs load harness (100 headless clients, convergence) | ~40s |
| `make test-soak-quick` | Single-user soak (5 min, 50 headings, rich content) | ~6 min |
| `make test-soak-collab-quick` | Multi-user soak (30s, 3 users, 10 headings) | ~50s |
| `make test-soak` | Full soak suite (single + multi-user, 30 min) | ~35 min |
| `make test-yjs-soak` | Yjs reconnection + rapid tab switch | ~20s |

## Test Architecture

```
tests/
├── setup.ts                              # `bun test` preload (happy-dom window, Bun-native fetch/timers)
├── helpers/
│   ├── create-test-editor.ts             # Headless Tiptap Editor factory
│   ├── document-builders.ts              # ProseMirror node builders (via prosemirror-test-builder)
│   ├── document-generators.ts            # Random and large document generators
│   ├── env-parsers.ts                    # Generic parseEnvNumber (?? semantics)
│   ├── perf-config.ts                    # PERF_* env parsing (parsePerfShape, parsePerfHeadings)
│   ├── report-writer.ts                 # writeReport(filename, data) → test-reports/
│   ├── import-fresh.ts                   # importFresh(): re-import a module after changing env
│   ├── soak-config.ts                    # SOAK_* env parsing (parseSoakDuration, parseSoakHeadings, etc.)
│   ├── assert-invariants.ts              # Schema invariant assertions (`bun:test`)
│   └── assert-invariants-json.ts         # Schema invariant assertions (Playwright-safe, no `bun:test` dep)
├── fixtures/                             # Static JSON document fixtures
├── unit/
│   ├── schema/                           # TitleDocument enforcement, paste handling, schema invariants, trailing node
│   ├── plugins/                          # HeadingScale, HeadingFold, HeadingDrag, HeadingFilter state
│   ├── helpers/                          # canMapDecorations, computeSection, fold-storage, filter-url, move-section, tab-api, media-embed URL gate
│   ├── hooks/                            # useSyncedTabs bootstrap + active-tab resolution (mocked Hocuspocus provider)
│   ├── lib/                              # Security guardrails, legacy Yjs mark migration (link/code → hyperlink/inlineCode)
│   ├── extensions/                       # Render-once, CaretBlockVisible, fast TOC, incremental code highlighting
│   ├── ci/                               # Workflow rules: read-only tokens, no persisted credentials, SHA-pinned actions
│   ├── fuzz/                             # Chaos fuzz (5000 ops) + structured schema fuzz (5000 ops)
│   └── stress/                           # Headless stress probe (binary search for heading ceiling)
├── e2e/
│   ├── helpers/
│   │   ├── editor-page.ts                # Playwright Page Object Model for the editor
│   │   ├── playwright-modifier-key.ts    # Meta vs Control for keyboard shortcuts
│   │   ├── perf-observer.ts              # PerformanceObserver injection + latency stats
│   │   ├── soak-bot.ts                   # Weighted-random action generator (10 action types)
│   │   └── soak-journeys.ts              # 2 scripted critical-path sequences
│   ├── collaboration.spec.ts             # 2-user collaboration (join + real-time sync)
│   ├── drag.spec.ts                      # Heading drag handle visibility
│   ├── extensions.spec.ts                # docs.plus extensions: link popovers, inline code, indent, Mermaid, media embeds, image resize gripper
│   ├── filter.spec.ts                    # Heading filter open + query + highlight
│   ├── fold.spec.ts                      # Fold chevron + crinkle unfold
│   ├── performance.spec.ts               # Keystroke-to-paint latency (10 + 50 headings)
│   ├── performance-collab.spec.ts        # Multi-user typing latency on shared doc
│   ├── pwa-connection.spec.ts            # Offline edits, connection status, offline banner/shell
│   ├── offline-copies.spec.ts            # IndexedDB copies: repeat visit, reload, deletion, clearing
│   ├── toc-sidebar.spec.ts               # TOC rendering + scroll-to-heading
│   ├── toc-drag.spec.ts                  # TOC drag-and-drop reorder + level change
│   ├── tabs.spec.ts                      # Tab bar: regenerate, new tab, close-all
│   ├── security-headers.spec.ts          # Hardening headers + CSP media-embed host allowlist
│   ├── soak.spec.ts                      # Single-user soak (journeys + bot + memory tracking)
│   ├── soak-collab.spec.ts               # N-user collaboration soak (dynamic, configurable)
│   └── yjs-soak/
│       ├── reconnection.spec.ts          # Kill/restart Hocuspocus mid-session
│       └── rapid-tab-switch.spec.ts      # Mount/unmount Yjs providers via tab switching
└── load/
    └── yjs-load-harness.ts               # Standalone Bun script: N-client Yjs convergence test
```

## Test Reports (`test-reports/`)

All test layers write reports when run via Make targets:

| Report file | Source | Contents |
|-------------|--------|----------|
| `unit-report.xml` | `make test` | JUnit XML from `bun test` (suites, tests, durations) |
| `fuzz-report.xml` | `make test-fuzz` | JUnit XML |
| `stress-report.xml` | `make test-stress` | JUnit XML |
| `e2e-report.json` | `make test-e2e` | Playwright JSON (tests, outcomes) |
| `perf-report-{ts}.json` | `make test-perf` | Latency stats per heading count |
| `perf-collab-report-{ts}.json` | `make test-perf-collab` | Multi-user latency stats |
| `load-report-{ts}.json` | `make test-load` | Clients, edits, throughput, convergence |
| `soak-report-{ts}.json` | `make test-soak-quick` | Journeys, memory, latency, verdict |
| `soak-collab-report-{ts}.json` | `make test-soak-collab-quick` | Users, actions, errors |
| `*-playwright-report.json` | soak targets | Playwright JSON for soak runs |
| `yjs-soak-report.json` | `make test-yjs-soak` | Playwright JSON for yjs-soak |

## Layer 1: Unit Tests (`bun test`)

Fast, headless tests that validate the document model, ProseMirror plugin state, and utility functions without a browser. `bunfig.toml` `[test]` limits `bun test` to `tests/unit` and preloads `tests/setup.ts` (a happy-dom window).

All files share one process, so tests must not leave state behind:

- **Module mocks** — spread the real module into `mock.module()` and replace only what the test needs (other files import the same module), then load the module under test with `await import()` (static imports are hoisted above the mock).
- **Import-time state or env** — load the module with `importFresh()` (`tests/helpers/import-fresh.ts`) after setting `process.env`, and call `resetModules()` in `afterEach`.

```bash
make test          # all unit tests
make test-fuzz     # fuzz tests only
make test-stress   # stress probe only
```

### Schema Tests

Verify the `heading block*` schema (TitleDocument extension) — first node is always H1, heading levels 1-6, paste handling preserves invariants, the trailing node appended after a non-paragraph last block is a paragraph (never a heading). 10 random documents are generated and validated each run.

### Plugin Tests

Assert internal state of HeadingScale, HeadingFold, HeadingFilter, and HeadingDrag after dispatching specific transactions. Validates decoration rebuilds, fold toggling, filter matching, `canMapDecorations` fast-path behavior, and `moveSection` atomicity (reorder, level change, combined, undo).

### Fuzz Tests

- **Chaos fuzz:** 5000 random malformed operations (invalid positions, null content, out-of-range levels) — verifies the editor never crashes
- **Schema fuzz:** 5000 random valid operations (insert heading, delete, split, join) — verifies invariants hold after each

### Stress Probe

Binary search for the heading count ceiling where ProseMirror transaction time exceeds 16ms (one frame budget). Tests 5 transaction types (text insert, heading insert/delete, fold toggle, filter apply) on flat and deep document shapes. Reports the ceiling — expected minimum 200 headings.

## Layer 2: E2E Tests (Playwright)

Browser-based feature verification using Chromium. Tests interact with the real editor via the `EditorPage` page object model.

```bash
make test-e2e
```

### Feature Tests

| Test | Validates |
|------|-----------|
| `drag.spec.ts` | Hovering a heading shows the drag handle |
| `extensions.spec.ts` | Link preview + `Mod-K` create; backtick inline code; Tab indent; Mermaid renders; media embeds stack and unsafe URLs are rejected; the image resize gripper covers the hovered image and resizes it |
| `filter.spec.ts` | CMD+SHIFT+F opens filter; typing highlights matches |
| `fold.spec.ts` | Fold chevron hides content; crinkle click unfolds |
| `pwa-connection.spec.ts` | Text typed offline survives a tab switch and syncs to a second browser after reconnecting; reload asks only while edits are unsynced; status strip goes online / reconnecting / offline with one announcement per transition; offline banner and disabled tab create/close; calm notice instead of the red alert before the editor opens offline. Simulates offline with `context.setOffline()` plus `page.routeWebSocket()` (setOffline alone does not close an open WebSocket) |
| `offline-copies.spec.ts` | A repeat visit opens the document from the device while the collab server is unreachable; edits made while disconnected survive a reload and sync to a second browser; a document deleted while away disappears from the tab bar and its copy is removed; closing a tab removes its copy and "Delete offline copies" on `/privacy` clears the rest. Inspects IndexedDB without creating it. Needs `next dev` and hocus on one `DB_PATH` |
| `toolbar.spec.ts` | Toolbar behaviour: menus named by value with radio items, indent and outdent in lists, disabled reasons, focus kept when controls hide, headings and caret clear of the sticky toolbar, catch-up within the commit budget |
| `toolbar-a11y.spec.ts` | Focus outline and pressed bar contrast in light, dark and forced colours; highlight dialog and mobile panel keyboard behaviour; axe sweep (WCAG 2.2 AA, no serious or critical violations) of the toolbar in paragraph, title, heading, list, code block, table and read-only contexts and with the style menu, list menu and highlight dialog open, in both themes |
| `toc-sidebar.spec.ts` | TOC lists all headings; clicking scrolls to heading |
| `toc-drag.spec.ts` | TOC drag handle visibility; title H1 not draggable; drag reorder moves editor sections; folded section drag handle |

### Performance Tests

Measure keystroke-to-paint latency using the Event Timing API via `PerformanceObserver`. Reports p50/p95/mean/max. Config is via env vars; the Makefile serves as the CLI interface (e.g. `make test-perf PERF_HEADINGS=200`).

```bash
make test-perf                                    # default: 10, 50 headings, flat shape
make test-perf PERF_HEADINGS=200                  # single size
make test-perf PERF_HEADINGS=10,50,200           # multiple sizes
make test-perf PERF_SHAPE=mixed                   # random heading hierarchy (H2–H6)
make test-perf PERF_SHAPE=deep PERF_HEADINGS=50   # deep shape + 50 headings
```

| Variable | Default | Description |
|----------|---------|-------------|
| `PERF_HEADINGS` | `10,50` | Comma-separated heading counts to test |
| `PERF_SHAPE` | `flat` | Document hierarchy: `flat` (all H2), `deep` (cycling H2–H6), `mixed` (random H2–H6) |
| `PERF_ROUNDS` | `5` | A/B rounds per heading count (toolbar off vs on, alternating order); the median p95 of each arm is compared |
| `PERF_CPU_THROTTLE` | `4` | CDP `Emulation.setCPUThrottlingRate` applied before typing |
| `PERF_MAX_REGRESSION` | `0.10` | Allowed toolbar-on p95 overhead versus toolbar off in the same run |

`performance.spec.ts` asserts the typing budget: p95 with the toolbar mounted must stay within `PERF_MAX_REGRESSION` of the same run with the toolbar off (`window.__TOOLBAR_OFF`, dev only). Each keystroke's synchronous handling is timed from its keydown `timeStamp` to a microtask queued by a bubble-phase `input` listener on `window`, after ProseMirror, Yjs and the toolbar's transaction listener have run; deferred renders are gated by the toolbar commit budget instead. Event Timing has a 16 ms floor, `requestAnimationFrame` quantizes to ~16.7 ms, and a task such as a `MessageChannel` message is starved under CPU throttle until typing stops, so none of them can time a keystroke. Nightly or manual runs can pass `PERF_HEADINGS=50,500`.

The spec runs in its own Playwright project, `perf` (one worker, `dependencies: ["chromium"]`), and the `chromium` project ignores it. Selecting both (`--project=chromium --project=perf`, as CI and `make test-e2e` do) times typing only after the parallel suite has finished, so other workers never compete for the CPU. Run it alone with `bun playwright test --project=perf --no-deps` (`make test-perf`).

### Multi-User Performance Tests (`performance-collab.spec.ts`)

Measures keystroke-to-paint latency when **multiple users type concurrently** in the same document. Each user types in a different paragraph to avoid conflicts. Reports per-user p50/p95 and aggregate stats.

```bash
make test-perf-collab                              # default: 2 users, 50 headings
make test-perf-collab PERF_COLLAB_USERS=3          # 3 concurrent users
make test-perf-collab PERF_COLLAB_HEADINGS=100      # larger document
make test-perf-collab PERF_COLLAB_SHAPE=mixed       # random heading hierarchy
```

| Variable | Default | Description |
|----------|---------|-------------|
| `PERF_COLLAB_USERS` | `2` | Number of concurrent users typing |
| `PERF_COLLAB_HEADINGS` | `50` | Document heading count |
| `PERF_COLLAB_SHAPE` | `flat` | Document hierarchy: `flat`, `deep`, `mixed` |

### Collaboration Tests

Two tests with distinct strategies:

1. **"user B sees content created by user A"** — User A types first, waits 4s for Hocuspocus persistence, then User B joins. Uses precondition `expect(.tiptap).not.toHaveText("")` before main assertion. May be flaky; `retries: 2`.
2. **"real-time sync between two connected users"** — Both users connected simultaneously. User A types; 2s wait before asserting on User B. Inherently timing-sensitive; `retries: 2`.

Each user gets a unique identity via `window.__HOCUS_TOKEN` injected through `page.addInitScript()`.

### PWA Tests

Every Playwright project runs with `serviceWorkers: "block"` except `pwa`, so caches never leak into other tests.

| Test | Project | Validates |
|------|---------|-----------|
| `pwa-manifest.spec.ts` | `chromium` (`make dev`) | Manifest shape and omitted members; icon sizes and opaque/rounded corners; apple and theme-color head tags; theme-color follows the dark toggle, reloads and soft navigation; install button (synthetic `beforeinstallprompt`, pre-hydration capture, hidden when installed, iOS hint by keyboard) |
| `pwa-offline.spec.ts` | `pwa` (production build) | Registration after `load` with scope `/`; cache contents (own static files and shell pages only); `sw.js` headers; offline reload of `/` shows the stored shell, unvisited paths show `/offline`; `/api` and other bypass routes never come from the worker; repeat visits are not slower; a fully offline reload reopens the editor with the document from the device |

The worker runs only on a production build. Use port 3847 and localhost only, never tiny.docs.plus:

```bash
NEXT_PUBLIC_HOCUS_URL=ws://127.0.0.1:1234 bun run build && PORT=3847 bun run start
HOCUS_THROTTLE=0 HOCUS_ALLOW_ISOLATED_TABS_DOCS=1 bun run hocus
PWA_BASE_URL=http://localhost:3847 CI= bun run test:pwa
```

Offline is simulated with `context.setOffline(true)`, which also cuts the worker's own fetches in Chromium. Unit tests for the routing rules live in `tests/unit/lib/pwa-sw-routing.test.ts`.

Manual install checklist (localhost production build):

- **Chrome desktop:** the install icon appears in the status strip and the address bar; the strip button opens the native dialog; installing opens a standalone window whose title bar follows the theme toggle, and the strip button is gone in both the window and the tab.
- **Chrome Android:** `adb reverse tcp:3847 tcp:3847`, open `http://localhost:3847`, install; the home-screen icon is the maskable "T" with no white ring.
- **iOS Simulator (Safari):** the strip's install button shows the Share → Add to Home Screen hint (Enter opens it, Escape closes it and returns focus); the home-screen icon has no black corners and is titled "TinyDocy".
- **Edge desktop:** same as Chrome desktop.
- DevTools → Application → Manifest shows no errors, App Id `/`, three icons; "Show only the minimum safe area for maskable icons" keeps the "T" inside the circle.

## Layer 3: Soak Tests (Playwright, long-running)

Sustained editing sessions that detect memory leaks, latency degradation, and schema corruption over time. Documents use realistic content (paragraphs, bullet lists, ordered lists, task lists, code blocks, blockquotes per section).

```bash
make test-soak-collab-quick   # 30s, 3 users — fast verification
make test-soak-quick           # 5 min single-user
make test-soak                 # full suite (30 min)
```

### Single-User Soak (`soak.spec.ts`)

1. Runs 2 scripted journeys (typing + structural edits, filter lifecycle)
2. Warm-up phase with stochastic bot
3. Sustained editing with memory sampling every 30s
4. Reports: JS heap growth, p50/p95 latency, action counts, error count
5. Writes JSON report to `test-reports/soak-report-{timestamp}.json`

### Multi-User Soak (`soak-collab.spec.ts`)

1. User 0 seeds a rich document, waits for rendering
2. Users 1..N-1 join sequentially (each verifies initial sync)
3. All N users run stochastic bots concurrently
4. Schema invariants checked every 60s per user
5. Final convergence assertion: all N documents must be identical

**Environment variables:**

| Variable | Default | Description |
|----------|---------|-------------|
| `SOAK_DURATION` | `1800000` (30 min) | How long bots run |
| `SOAK_HEADINGS` | `200` (single) / `20` (collab) | Document heading count |
| `SOAK_USERS` | `3` | Number of concurrent browser users |
| `SOAK_WARMUP` | auto (30s if &lt;10 min, 120s otherwise) | Warm-up duration before memory baseline |
| `SOAK_MEMORY_GROWTH_LIMIT` | `50` | Max heap growth % before fail (single-user soak) |

## Layer 4: Yjs Soak Scenarios

Targeted tests for collaboration-layer resilience.

```bash
make test-yjs-soak
```

### Reconnection Recovery (`reconnection.spec.ts`)

Spawns a dedicated Hocuspocus instance on port 1235 (`bun run hocus`), types content, kills the server, restarts it with SQLite persistence, and verifies no data loss. Uses `window.__HOCUS_URL` to redirect the editor's WebSocket.

### Rapid Tab Switch (`rapid-tab-switch.spec.ts`)

Creates multiple tabs via the tab bar UI, switches between them 20 times, types in each, and verifies content persists. Exercises the Y.Doc cache lifecycle in `useYjsDocument`.

## Layer 5: Load Harness (standalone Bun script)

Headless N-client Yjs convergence test — no browser required. Clients use Bun's built-in `WebSocket`. CLI args override env vars (industry pattern: k6 `K6_*`, Benchmark `BENCHMARK_*`).

```bash
make test-load                                              # 100 clients, 30s, distributed
make test-load LOAD_CLIENTS=50 LOAD_DURATION=10000          # env vars
bun tests/load/yjs-load-harness.ts --clients 50 --duration 10000 --scenario conflict
```

| Variable | Default | Description |
|----------|---------|-------------|
| `LOAD_CLIENTS` | `100` | Concurrent Yjs clients |
| `LOAD_DURATION` | `30000` | Steady-state duration (ms) |
| `LOAD_RATE` | `2` | Operations/second per client |
| `LOAD_SCENARIO` | `distributed` | `distributed` or `conflict` |
| `LOAD_URL` | `ws://127.0.0.1:1234` | Hocuspocus WebSocket URL |

Phases: connect → seed (realistic document with paragraphs, lists, task lists) → warm-up → steady-state editing → drain → byte-level + JSON-level convergence verification → structured report.

Each client gets a unique identity token (`load-client-{i}-{docId}`).

## CI (GitHub Actions)

`.github/workflows/ci.yml` runs on every pull request and push to `main`:

| Job | Runs |
|---|---|
| Lint, typecheck, unit tests, build | `bun run check`, `bun run lint`, `bun run typecheck`, `bun run test --exclude 'tests/unit/stress/**'`, `bun run build` |
| Playwright (Chromium) | `make dev`, a warm-up request per page, then `CI= bun playwright test --project=chromium --project=perf --retries=1` (`perf` starts after `chromium`, on one worker) |

- **Stress probe:** `bun run test:stress` runs as a separate step with
  `continue-on-error`. It measures transaction time, so a slow shared runner
  can miss its threshold without the code being wrong.
- **Retries:** a test that passes on retry is listed as "flaky" in the
  Playwright summary; treat that as a bug to fix, not a pass.
- **On failure:** `test-results/` and the dev-server log are uploaded as the
  `e2e-results` artifact.
- **Nightly, not per PR:** `.github/workflows/nightly.yml` runs the `pwa`
  project against a production build, the Yjs soak, the quick multi- and
  single-user soaks and the load harness (both scenarios) every day at 03:41
  and 08:00 UTC, or from Actions → Nightly → Run workflow. Run the layer locally before
  merging a change it covers.
- **Extension update PRs:** the scheduled `@docs.plus` update workflow starts
  CI on its branch itself (`gh workflow run ci.yml`), because pull requests
  opened with the workflow token start no workflows.
- **Workflow rules:** `tests/unit/ci/workflow-permissions.test.ts` checks every
  workflow file. Each workflow needs a read-only default token, explicit
  per-job permissions, `persist-credentials: false` on checkout, and actions
  pinned to commit SHAs.

## Key Conventions

- **Rich document content** — `generateLargeDocument` produces 3-5 paragraphs + mixed structured blocks per heading section by default. Pass `{ richContent: false }` for lightweight documents. Playground content includes tables, syntax-highlighted code blocks (multi-language), and highlighted text.
- **Test editor extensions** — `create-test-editor.ts` registers `TableKit`, `CodeBlockLowlight` (lowlight with common languages), `TaskList`/`TaskItem`, `Image`, `Highlight`, `TextAlign`, and `UniqueID` alongside schema enforcement extensions.
- **User identity** — all multi-user tests inject unique `window.__HOCUS_TOKEN` per browser context. The `useYjsDocument` hook reads this and passes it to `HocuspocusProvider`.
- **Y.Doc caching** — `useYjsDocument` uses a module-level `docCache` with reference counting. Y.Doc instances persist across component unmounts (tab switches) to prevent content loss.
- **Platform-specific keys** — soak bot uses `Meta` (macOS) or `Control` (others) for keyboard shortcuts. Never use `Mod` — it is ProseMirror-only and unknown to Playwright.
- **Test isolation** — each test generates a unique `docId` with timestamp + random suffix to prevent cross-test interference on the shared Hocuspocus server. Tab state is isolated via `window.__GLOBAL_TABS_DOC` (set per test in `EditorPage.goto()`) so parallel tests use separate `global-tabs-{docId}` Yjs documents.
- **Wait for the server, then type at full speed** — `EditorPage.waitForSync()` waits for `data-server-synced` on the editor region (the editor is editable earlier, from the device copy, and a new document is seeded only after the first server sync). Tests then type without artificial waits; if typed text lands in the wrong place, look for an app bug first (the caret-after-Enter race was `content-visibility`, fixed by `CaretBlockVisible`). Use `typeInNewParagraphAtEnd(page, text)` to add text at the end of a document.
- **Toolbar dev-only hooks** — `window.__TOOLBAR_OFF` (set before load) unmounts the toolbar for the A/B typing budget; `window.__toolbarCommits` counts toolbar store commits so tests can assert the update budget. Neither exists in production builds.
- **Assertion split** — `assert-invariants.ts` (imports `expect` from `bun:test`) for unit tests; `assert-invariants-json.ts` (pure `throw`) for Playwright tests.

## Related Documentation

- [E2E Testing Strategy Plan](../docs/plans/5-feat-e2e-testing-strategy-plan.md) — original infrastructure plan (completed)
- [Test Realism & Soak Plan](../docs/plans/6-feat-test-realism-soak-and-stress-plan.md) — soak, stress, and collaboration layers (completed)
- [E2E Testing Brainstorm](../docs/brainstorms/8-e2e-testing-strategy-brainstorm.md) — initial requirements exploration
- [Test Realism Brainstorm](../docs/brainstorms/9-test-realism-and-soak-brainstorm.md) — soak and performance requirements

Historical-doc note: some completed plans/brainstorms predate the `extensions/`
refactor and may reference legacy paths under
`components/tiptap-node/{heading-node,document-node}`.
