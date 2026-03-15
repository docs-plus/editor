---
date: 2026-03-15
topic: e2e-testing-strategy
---

# E2E Testing Strategy for TinyDocy

## What We're Building

A comprehensive testing strategy for TinyDocy's collaborative document editor, covering four concerns: **schema correctness** (enforced document model with fuzzing), **feature E2E** (drag, fold, filter in a real browser), **performance** (typing latency in long/complex documents), and **concurrency** (100 simultaneous Yjs users editing the same document).

The strategy uses three specialized layers — Vitest for fast headless schema tests, Playwright for browser-based E2E and performance baselines, and a custom Yjs load harness for scaled concurrency simulation. CI/CD integration is deferred to a later phase.

## Why This Approach

**Considered:**

- **Approach A (chosen): Vitest + Playwright + Custom Yjs Harness** — each tool excels at its layer; concurrency scales without 100 browsers; schema fuzzing runs in milliseconds.
- **Approach B: Playwright + k6** — k6 is battle-tested for load testing, but encoding Yjs sync protocol in k6 is non-trivial.
- **Approach C: Playwright-only** — simplest setup, but can't reach 100 concurrent users and schema fuzzing in a browser is slow.

Approach A was chosen because:

- Vitest gives sub-second feedback on schema invariants and paste handling without browser overhead
- Playwright is the gold standard for ProseMirror/Tiptap browser testing — it can measure real keystroke-to-paint timing via Performance API
- The custom Yjs harness gives precise control over CRDT simulation at scale (connect 100 `Y.Doc` instances to Hocuspocus via WebSocket) without the cost of 100 real browsers
- The hybrid model (a few Playwright browsers + many headless Yjs clients) satisfies both UX verification and load correctness

## Key Decisions

### Layer 1: Vitest — Schema & Model Tests (headless, fast)

- **What it tests:** TitleDocument enforcement (first node always H1), paste handling (promotion to H1, inline marks, non-textblock flattening), document structure invariants after complex operations
- **Invariant scope (Vitest layer):** first node is H1, valid schema (`heading block*`), heading levels 1-6 only, unique heading IDs (`data-toc-id`), heading hierarchy consistency, section boundaries compute correctly via `computeSection`, fold state survives edits, marks survive JSON serialization roundtrip, no orphaned decorations in `DecorationSet` after transactions
- **Fuzzing:** Two modes — (a) structured randomization generating valid documents with random heading depths/counts/content lengths, verifying invariants hold; (b) true fuzzing injecting malformed HTML pastes, broken markdown, rapid random operations to find crashes
- **Fuzz scale:** Medium — 5,000-10,000 random operations per run (~30-60 seconds), run as a dedicated test suite
- **Why headless:** Schema invariants don't need a browser — ProseMirror's `EditorState` and `Transaction` APIs work in Node.js. Tests run in <1s (excluding fuzz suite).
- **Pattern:** Create editor state with extensions → apply transactions/pastes → assert schema invariants

### Layer 2: Playwright — Feature E2E & Performance

- **What it tests:** All heading features (drag sections, fold/unfold with crinkle animation, filter with hierarchy visibility, TOC sidebar sync), plus performance baselines
- **Feature E2E:** Navigate to editor, create document with known structure, exercise each feature, assert DOM state. Use real-world document structures that mimic actual usage patterns (complex heading trees, mixed content types). Functional assertions only (DOM state, CSS classes, computed styles) — no screenshot/pixel comparison.
- **Browser-only invariants (promoted from exhaustive scope):** all node types render correctly in the DOM, no memory leaks in plugins (measure via `performance.measureUserAgentSpecificMemory()` or heap snapshots), plugin cleanup on editor destroy
- **Performance:** Establish baselines first — measure keystroke-to-paint latency via `PerformanceObserver` in documents of increasing size (10, 50, 100, 500 headings). Record baselines, then set regression thresholds based on what we learn.
- **Concurrency UX:** 2-3 Playwright browser contexts connected to the same document, verifying Yjs sync produces correct merged state and typing remains responsive

### Layer 3: Custom Yjs Load Harness — Concurrency at Scale

- **What it tests:** 100 simultaneous users editing the same document — CRDT convergence, no data loss, Hocuspocus stability, WebSocket throughput
- **How:** Node.js script that spawns N `Y.Doc` + `HocuspocusProvider` instances, each performing random edits (insert text, add headings, delete sections) at configurable rates. After a test duration, all docs must converge to identical state.
- **Scenarios:** Two modes — (a) distributed editing (users edit different sections, realistic production pattern); (b) conflict-heavy stress (multiple users deliberately edit the same paragraph/heading to stress CRDT merge)
- **Form factor:** Standalone Node.js script (not a Vitest test) — invoked via `bun run test:load` or similar. Outputs a report (convergence pass/fail, timing, memory) to stdout.
- **Why custom:** No existing tool natively speaks the Yjs sync protocol. Building a thin harness (~200-300 lines) using `yjs` + `@hocuspocus/provider` (already in our deps) is simpler than adapting a generic load tool.
- **Metrics:** Convergence time, message throughput, memory usage, document size growth, any lost updates

### Test Data Strategy

- **Fixture documents:** Curated JSON documents exercising edge cases — empty document, single H1 only, deeply nested (H1>H2>H3>H4>H5>H6), wide (50 H1 sections), mixed (headings + lists + images + blockquotes + code blocks)
- **Generated documents:** Randomized generators producing valid documents of configurable complexity for stress testing
- **Fuzz inputs:** Malformed HTML clipboard data, broken markdown, rapid concurrent conflicting edits

### Performance Baseline Approach

- No hard targets yet — first run establishes baselines
- Measure: keystroke-to-paint latency, decoration rebuild time, Yjs sync roundtrip, fold/unfold animation frame drops
- After baselines exist, set regression thresholds (e.g., "must not regress more than 20% from baseline")

## Resolved Questions

- **Test server:** Tests require the dev server (`make dev`) to be running — no ephemeral Hocuspocus spin-up for now
- **Visual regression:** Functional assertions only — no screenshot/pixel comparison testing
- **Concurrency scenarios:** Both distributed editing (realistic) and conflict-heavy (stress) modes
- **Heading edge cases:** Derive from real-world document structures, not synthetic edge case lists
- **Fuzz scale:** Medium — 5,000-10,000 random operations (~30-60 seconds per run)
- **Invariant depth:** Exhaustive — schema, hierarchy, marks roundtrip, decoration cleanup, memory leaks
- **CI/CD:** Deferred to a separate brainstorm/plan

## Next Steps

→ `/workflows:plan` for implementation details — file structure, test utilities, specific test cases, dependency setup
