---
date: 2026-03-15
topic: test-realism-and-soak
---

# Test Realism, Soak Testing & Performance Limits

## What We're Building

Two complementary testing layers on top of the existing test infrastructure:

1. **Headless Stress Probe** (Vitest) — fast, runs on every `bun run test`, binary-searches for the heading count where ProseMirror transaction processing time degrades past threshold. Measures wall-clock time for `state.apply()` + full plugin pipeline (decoration rebuild, section computation, fold state recalc) — not browser rendering latency. Threshold: p95 transaction time < 16ms (one frame budget at 60fps).

2. **Playwright Soak Runner** — configurable-duration browser test (default 30 min) that simulates realistic multi-step editing sessions in a real browser. Measures keystroke-to-paint latency, JS heap growth, and feature interactions (fold/unfold, filter, drag, TOC navigation) over sustained periods. Runs locally on-demand and nightly in CI.

Together these answer: "Does the editor stay fast and stable under realistic use at realistic (and extreme) scale?"

## Why This Approach (Combined)

- **Headless probe** gives sub-second feedback on algorithmic performance. A developer can run `bun run test` after changing a plugin and instantly know if they regressed O(N) to O(N²). But it misses rendering costs — CSS layout, paint, compositing.

- **Browser soak** catches the full-stack picture: rendering pipeline, memory leaks from un-cleaned-up decorations or DOM nodes, Yjs state growth over time, and real keystroke latency. But it takes minutes, not seconds.

Neither alone is sufficient. The headless probe is the fast gate; the soak runner is the authoritative verdict.

## Key Decisions

- **Scripted journeys for critical paths:** Predefined sequences covering typing + structural operations (fold/unfold, drag, filter). These have hard pass/fail thresholds. TOC sidebar is passive and excluded from hard thresholds.

- **Stochastic bot for soak testing:** Weighted-random action selection — e.g., 60% type, 15% fold/unfold, 10% scroll, 10% filter, 5% drag. Runs for configurable duration. Simpler than a state machine, but still exercises realistic action distributions.

- **Tiered performance thresholds (two distinct metrics):**
  - *Headless probe (transaction time):* p95 < 16ms (one 60fps frame) for documents ≤200 headings. This is the ProseMirror processing budget, not end-to-end latency.
  - *Browser soak (keystroke-to-paint):* p95 < 100ms for typing and structural operations in documents ≤200 headings. This is the user-perceived latency including rendering.
  - Report-only for extreme stress sizes (500+ headings) — log metrics, no auto-fail
  - No regression detection against baselines initially (baselines are hardware-dependent)

- **Push-to-limits discovery:** Binary search for the heading count where p95 transaction time crosses 16ms (headless). Always reports the ceiling number. Fails the test if the ceiling drops below a configurable minimum (default: 200 headings).

- **Configurable soak duration:** Default 30 minutes, `--duration` flag for longer runs. CI nightly uses 30 min. Local developer can run 5 min quick soak or multi-hour endurance test.

- **Memory leak detection:** Sample `performance.measureUserAgentSpecificMemory()` (or `performance.memory` fallback) at 30-second intervals. Fail if JS heap grows >50% from baseline after warm-up.

- **Baseline management:** Local-only, gitignored. Each developer's baselines are hardware-specific. No git-tracked baselines — hard thresholds (p95 < 100ms) are the pass/fail criteria, not relative regressions.

## Resolved Questions

- **Where do tests run?** Local + CI nightly. Headless probe runs on every `bun run test`. Soak runner runs locally on-demand and in CI nightly pipeline.

- **What document sizes?** Realistic (50-200 headings) for pass/fail. Stress (500-1000) for reporting. Extreme (push to limits) for discovery.

- **What does "responsive" mean?** Two metrics: headless transaction time p95 < 16ms (ProseMirror processing budget), browser keystroke-to-paint p95 < 100ms (user-perceived). No baseline regression detection initially (hardware-dependent).

- **How long should soak tests run?** Configurable, default 30 min. CI uses default. Developers can pass `--duration 300000` (5 min) for quick runs or `--duration 14400000` (4 hours) for endurance.

- **Realism model?** Mix — scripted journeys for critical workflows with hard thresholds, stochastic weighted-random bot for soak/endurance with memory and stability checks.

- **Bot behavior model?** Weighted random — probability table (60% type, 15% fold, 10% scroll, 10% filter, 5% drag). Simpler than a state machine, exercises all features proportionally.

- **Soak collaboration?** Multi-user soak — 2-3 browser contexts editing the same document for the full soak duration, watching for state drift and Yjs divergence.

- **Reporting format?** Both — structured stdout summary for humans + JSON report file for CI artifacts and tooling.

- **Failure mode?** Fail fast — stop immediately when memory growth or latency spike is detected, report the failure point with collected evidence up to that moment.

- **Headless probe scope?** Full pipeline — transaction apply + decoration rebuild + section computation + fold state recalc. Measures the entire plugin chain, not just raw ProseMirror apply.

## Yjs Layer Audit Findings

The following issues in the collaboration layer directly inform soak test design:

1. **No reconnection feedback** — `useYjsDocument` never resets `synced` on disconnect; soak test should kill/restart Hocuspocus mid-session and verify recovery
2. **No content validation** — `enableContentCheck` not set; malformed Yjs updates can silently violate schema; soak test should verify schema invariants after sustained collaboration
3. **No awareness cursors** — awareness state allocated but unused; soak test should track awareness memory overhead
4. **Awareness scales linearly** — ~7 MB RSS per client from awareness state in load tests
5. **React strict-mode dual-mount** — rapid tab switching could create duplicate connections; soak test should exercise rapid mount/unmount cycles
6. **Hardcoded WebSocket URL** — blocks production deployment (not a test concern, but noted)

## Approach: Test-First (TDD)

Build soak tests that expose the Yjs layer gaps as failing tests, then fix the underlying issues. This ensures:

- Each fix has a corresponding test that proves it works
- Regressions are caught immediately
- The soak test suite doubles as a specification for correct behavior

### Explicit Yjs Soak Scenarios

1. **Reconnection recovery** — Kill Hocuspocus process mid-soak (or forcibly close the WebSocket), wait, restart. Verify: editor reconnects, state converges, no data loss, user can continue editing.

2. **Schema integrity under collaboration** — Two browser contexts perform sustained editing (create headings, delete content, paste, undo). After each interval, verify `assertFirstNodeIsH1` and `assertValidSchema` via `getEditorJSON()`. Fail immediately if schema is violated.

3. **Memory/awareness growth** — Track `performance.memory.usedJSHeapSize` (or `performance.measureUserAgentSpecificMemory()`) at 30-second intervals. After warm-up, fail if heap grows >50% from post-warmup baseline over the remaining duration. Also log awareness state size if accessible.

4. **Rapid tab switching** — Mount/unmount the editor component 20 times in rapid succession (switching between tabs that reference the same documentId). Verify: no duplicate Hocuspocus connections, no stale state, final editor content matches expected state.

## Next Steps

→ `/plan` for implementation details
