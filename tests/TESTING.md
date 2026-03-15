# Testing Infrastructure

TinyDocy uses a multi-layer testing strategy covering schema correctness, feature behavior, performance, long-running stability, and real-time collaboration at scale.

**Recent additions:** Configurable performance tests — `make test-perf` (single-user typing latency, `PERF_HEADINGS`, `PERF_SHAPE`) and `make test-perf-collab` (multi-user concurrent typing on a shared document, `PERF_COLLAB_USERS`, `PERF_COLLAB_HEADINGS`, `PERF_COLLAB_SHAPE`). See Performance Tests and Multi-User Performance Tests sections below. All test layers write JSON reports to `test-reports/` when run via Make targets.

**Prerequisites:** Dev servers must be running for Playwright tests.

```bash
make dev
```

## Quick Reference

| Command | What it runs | Duration |
|---------|-------------|----------|
| `make test` | Vitest unit + fuzz + schema + plugin tests | ~2s |
| `make test-fuzz` | Chaos and structured fuzz tests | ~1s |
| `make test-stress` | Headless stress probe (binary search for heading ceiling) | ~30s |
| `make test-e2e` | Playwright chromium E2E suite (features, performance, collaboration) | ~90s |
| `make test-perf` | Typing latency tests only (default 10, 50 headings; `PERF_HEADINGS=200` for custom) | ~15s |
| `make test-perf-collab` | Multi-user typing latency on shared doc (default 2 users, 50 headings) | ~30s |
| `make test-load` | Yjs load harness (100 headless clients, convergence) | ~40s |
| `make test-soak-quick` | Single-user soak (5 min, 50 headings, rich content) | ~6 min |
| `make test-soak-collab-quick` | Multi-user soak (30s, 3 users, 10 headings) | ~50s |
| `make test-soak` | Full soak suite (single + multi-user, 30 min) | ~35 min |
| `make test-yjs-soak` | Yjs reconnection + rapid tab switch | ~20s |

## Test Architecture

```
tests/
├── setup.ts                              # Vitest global setup (jsdom, localStorage mock)
├── helpers/
│   ├── create-test-editor.ts             # Headless Tiptap Editor factory
│   ├── document-builders.ts              # ProseMirror node builders (via prosemirror-test-builder)
│   ├── document-generators.ts            # Random and large document generators
│   ├── env-parsers.ts                    # Generic parseEnvNumber (?? semantics)
│   ├── perf-config.ts                    # PERF_* env parsing (parsePerfShape, parsePerfHeadings, parsePerfNumber)
│   ├── report-writer.ts                 # writeReport(filename, data) → test-reports/
│   ├── soak-config.ts                    # SOAK_* env parsing (parseSoakDuration, parseSoakHeadings, etc.)
│   ├── assert-invariants.ts              # Schema invariant assertions (Vitest)
│   └── assert-invariants-json.ts         # Schema invariant assertions (Playwright-safe, no vitest dep)
├── fixtures/                             # Static JSON document fixtures
├── unit/
│   ├── schema/                           # TitleDocument enforcement, paste handling, schema invariants
│   ├── plugins/                          # HeadingScale, HeadingFold, HeadingDrag, HeadingFilter state
│   ├── helpers/                          # canMapDecorations, computeSection, fold-storage, filter-url
│   ├── fuzz/                             # Chaos fuzz (5000 ops) + structured schema fuzz (5000 ops)
│   └── stress/                           # Headless stress probe (binary search for heading ceiling)
├── e2e/
│   ├── helpers/
│   │   ├── editor-page.ts                # Playwright Page Object Model for the editor
│   │   ├── perf-observer.ts              # PerformanceObserver injection + latency stats
│   │   ├── soak-bot.ts                   # Weighted-random action generator (10 action types)
│   │   └── soak-journeys.ts              # 2 scripted critical-path sequences
│   ├── collaboration.spec.ts             # 2-user collaboration (join + real-time sync)
│   ├── drag.spec.ts                      # Heading drag handle visibility
│   ├── filter.spec.ts                    # Heading filter open + query + highlight
│   ├── fold.spec.ts                      # Fold chevron + crinkle unfold
│   ├── performance.spec.ts               # Keystroke-to-paint latency (10 + 50 headings)
│   ├── performance-collab.spec.ts        # Multi-user typing latency on shared doc
│   ├── toc-sidebar.spec.ts               # TOC rendering + scroll-to-heading
│   ├── soak.spec.ts                      # Single-user soak (journeys + bot + memory tracking)
│   ├── soak-collab.spec.ts               # N-user collaboration soak (dynamic, configurable)
│   └── yjs-soak/
│       ├── reconnection.spec.ts          # Kill/restart Hocuspocus mid-session
│       └── rapid-tab-switch.spec.ts      # Mount/unmount Yjs providers via tab switching
└── load/
    └── yjs-load-harness.ts               # Standalone Bun script: N-client Yjs convergence test
```

## Test Reports (`test-reports/`)

All test layers write JSON reports when run via Make targets:

| Report file | Source | Contents |
|-------------|--------|----------|
| `unit-report.json` | `make test` | Vitest JSON (suites, tests, durations) |
| `fuzz-report.json` | `make test-fuzz` | Vitest JSON |
| `stress-report.json` | `make test-stress` | Vitest JSON |
| `e2e-report.json` | `make test-e2e` | Playwright JSON (tests, outcomes) |
| `perf-report-{ts}.json` | `make test-perf` | Latency stats per heading count |
| `perf-collab-report-{ts}.json` | `make test-perf-collab` | Multi-user latency stats |
| `load-report-{ts}.json` | `make test-load` | Clients, edits, throughput, convergence |
| `soak-report-{ts}.json` | `make test-soak-quick` | Journeys, memory, latency, verdict |
| `soak-collab-report-{ts}.json` | `make test-soak-collab-quick` | Users, actions, errors |
| `*-playwright-report.json` | soak targets | Playwright JSON for soak runs |
| `yjs-soak-report.json` | `make test-yjs-soak` | Playwright JSON for yjs-soak |

## Layer 1: Unit Tests (Vitest)

Fast, headless tests that validate the document model, ProseMirror plugin state, and utility functions without a browser.

```bash
make test          # all unit tests
make test-fuzz     # fuzz tests only
make test-stress   # stress probe only
```

### Schema Tests

Verify the `heading block*` schema (TitleDocument extension) — first node is always H1, heading levels 1-6, paste handling preserves invariants. 10 random documents are generated and validated each run.

### Plugin Tests

Assert internal state of HeadingScale, HeadingFold, HeadingFilter, and HeadingDrag after dispatching specific transactions. Validates decoration rebuilds, fold toggling, filter matching, and `canMapDecorations` fast-path behavior.

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
| `filter.spec.ts` | CMD+SHIFT+F opens filter; typing highlights matches |
| `fold.spec.ts` | Fold chevron hides content; crinkle click unfolds |
| `toc-sidebar.spec.ts` | TOC lists all headings; clicking scrolls to heading |

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

1. **"user B sees content created by user A"** — User A types first, waits for Hocuspocus persistence, then User B joins. Deterministic (5/5 reliability).
2. **"real-time sync between two connected users"** — Both users connected simultaneously. Inherently timing-sensitive (`retries: 1`).

Each user gets a unique identity via `window.__HOCUS_TOKEN` injected through `page.addInitScript()`.

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

Spawns a dedicated Hocuspocus instance on port 1235, types content, kills the server, restarts it with SQLite persistence, and verifies no data loss. Uses `window.__HOCUS_URL` to redirect the editor's WebSocket.

### Rapid Tab Switch (`rapid-tab-switch.spec.ts`)

Creates multiple tabs via the tab bar UI, switches between them 20 times, types in each, and verifies content persists. Exercises the Y.Doc cache lifecycle in `useYjsDocument`.

## Layer 5: Load Harness (standalone Bun script)

Headless N-client Yjs convergence test — no browser required. CLI args override env vars (industry pattern: k6 `K6_*`, Benchmark `BENCHMARK_*`).

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

## Key Conventions

- **Rich document content** — `generateLargeDocument` produces 3-5 paragraphs + mixed structured blocks per heading section by default. Pass `{ richContent: false }` for lightweight documents.
- **User identity** — all multi-user tests inject unique `window.__HOCUS_TOKEN` per browser context. The `useYjsDocument` hook reads this and passes it to `HocuspocusProvider`.
- **Y.Doc caching** — `useYjsDocument` uses a module-level `docCache` with reference counting. Y.Doc instances persist across component unmounts (tab switches) to prevent content loss.
- **Platform-specific keys** — soak bot uses `Meta` (macOS) or `Control` (others) for keyboard shortcuts. Never use `Mod` — it is ProseMirror-only and unknown to Playwright.
- **Test isolation** — each test generates a unique `docId` with timestamp + random suffix to prevent cross-test interference on the shared Hocuspocus server.
- **Assertion split** — `assert-invariants.ts` (imports vitest `expect`) for unit tests; `assert-invariants-json.ts` (pure `throw`) for Playwright tests.

## Related Documentation

- [E2E Testing Strategy Plan](../docs/plans/5-feat-e2e-testing-strategy-plan.md) — original infrastructure plan (completed)
- [Test Realism & Soak Plan](../docs/plans/6-feat-test-realism-soak-and-stress-plan.md) — soak, stress, and collaboration layers (completed)
- [E2E Testing Brainstorm](../docs/brainstorms/8-e2e-testing-strategy-brainstorm.md) — initial requirements exploration
- [Test Realism Brainstorm](../docs/brainstorms/9-test-realism-and-soak-brainstorm.md) — soak and performance requirements
