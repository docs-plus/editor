---
title: "feat: Test Realism, Soak Testing & Performance Stress Probe"
type: feat
status: completed
date: 2026-03-15
---

# Test Realism, Soak Testing & Performance Stress Probe

## Overview

Build two new testing layers on top of the existing test infrastructure: a **Headless Stress Probe** (Vitest) for fast algorithmic regression detection, and a **Playwright Soak Runner** for sustained browser-level realism testing. Also add **Yjs soak scenarios** (TDD) that expose known collaboration-layer gaps as failing tests before fixing them.

Brainstorm: `docs/brainstorms/2026-03-15-test-realism-and-soak-brainstorm.md`

## Problem Statement

The existing test suite verifies correctness (schema invariants, plugin state, feature E2E) and concurrency convergence (Yjs load harness), but cannot answer:

1. **At what document size does the editor become unusably slow?** No test measures the heading-count ceiling where ProseMirror transaction time exceeds one frame budget.
2. **Does the editor leak memory or degrade over sustained editing sessions?** Short E2E specs don't exercise long-running behavior — memory leaks, stale decorations, awareness state bloat, and gradual latency creep go undetected.
3. **Does Yjs collaboration recover from real-world failures?** No test simulates server crashes, WebSocket drops, rapid tab switching, or sustained multi-user editing with schema integrity checks.

---

## Technical Approach

### Architecture

```
tests/
├── unit/
│   └── stress/
│       └── headless-stress-probe.test.ts   # Vitest — binary-search capacity ceiling
├── e2e/
│   ├── helpers/
│   │   ├── editor-page.ts                  # (existing) — extend with undo, insert, heap
│   │   ├── perf-observer.ts                # (existing) — no changes needed
│   │   ├── soak-bot.ts                     # NEW — weighted-random action generator
│   │   └── soak-journeys.ts               # NEW — 2 scripted critical-path sequences
│   ├── soak.spec.ts                        # NEW — single-user soak + memory tracking
│   ├── soak-collab.spec.ts                 # NEW — multi-user soak + schema integrity
│   └── yjs-soak/
│       ├── reconnection.spec.ts            # NEW — TDD: kill/restart Hocuspocus
│       └── rapid-tab-switch.spec.ts        # NEW — TDD: mount/unmount 20x
├── helpers/
│   └── document-generators.ts              # (existing) — add generateLargeDocument
```

### What Already Exists (Reuse)

| File | What it provides |
|------|-----------------|
| `tests/helpers/create-test-editor.ts` | `createTestEditor()` with full plugin chain — reused by headless probe |
| `tests/helpers/document-generators.ts` | `generateRandomDocument()` — extended with `generateLargeDocument()` |
| `tests/helpers/assert-invariants.ts` | `assertAllInvariants()` — reused; add JSON-level variant |
| `tests/e2e/helpers/editor-page.ts` | `EditorPage` POM — extended for soak actions |
| `tests/e2e/helpers/perf-observer.ts` | `injectPerfObserver`, `computeLatencyStats` — reused by soak |
| `tests/load/yjs-load-harness.ts` | 100-client convergence — not modified, independent |

### What's New

| Component | Location | Purpose |
|-----------|----------|---------|
| Headless Stress Probe | `tests/unit/stress/headless-stress-probe.test.ts` | Binary-search heading ceiling, multiple transaction types |
| Soak Bot | `tests/e2e/helpers/soak-bot.ts` | Weighted-random action generator |
| Soak Journeys | `tests/e2e/helpers/soak-journeys.ts` | 2 scripted critical-path sequences |
| Single-User Soak | `tests/e2e/soak.spec.ts` | Configurable-duration browser soak + memory tracking |
| Multi-User Soak | `tests/e2e/soak-collab.spec.ts` | N dynamic users (env `SOAK_USERS`, default 3) editing same doc + schema integrity |
| Yjs Reconnection | `tests/e2e/yjs-soak/reconnection.spec.ts` | TDD: kill/restart Hocuspocus mid-session |
| Yjs Rapid Tab Switch | `tests/e2e/yjs-soak/rapid-tab-switch.spec.ts` | TDD: mount/unmount 20x |

### Design Decisions (Simplicity)

Decisions driven by YAGNI and the simplicity review:

- **No SoakReporter module** — inline `console.log` + `JSON.stringify` in soak specs. A full report module is overengineered for test output.
- **No HocuspocusManager class** — inline `spawn`/`kill` directly in `reconnection.spec.ts`. A class abstraction for one test is unjustified.
- **2 journeys, not 4** — paste/undo/redo already covered by soak bot weights. One combined journey + one filter journey suffices.
- **2 document shapes, not 3** — flat + deep are sufficient for ceiling detection. Mixed (random) adds variance without benefit.
- **No median-of-3** — single measurement per binary-search step. Add median-of-3 only if flakiness is observed.
- **2 Yjs soak files, not 4** — memory tracking folded into `soak.spec.ts`; schema integrity folded into `soak-collab.spec.ts`. Only reconnection and rapid-tab-switch need separate files.
- **N-user soak via env var** — `SOAK_USERS` (default 3) dynamically creates browser contexts. Originally 2; expanded post-implementation to test collaboration at scale. The load harness complements this with 100-client headless convergence.

---

## Implementation Phases

### Phase 1: Headless Stress Probe

**File:** `tests/unit/stress/headless-stress-probe.test.ts`

A Vitest test that binary-searches for the heading count where ProseMirror transaction processing time exceeds the 16ms p95 threshold. Runs on every `bun run test`.

#### Design

```
binary_search(low=10, high=2000):
  mid = (low + high) / 2
  generate document with `mid` headings
  create editor, warm up with 20 transactions (discard timing)
  run 100 transactions of each type, measure wall-clock time
  compute p95 across all transaction types
  if p95 < 16ms → low = mid + 1
  if p95 >= 16ms → high = mid
  when high - low <= 5 → ceiling = low

  FAIL if ceiling < 200 (configurable minimum)
  REPORT ceiling number always
```

#### Transaction Types (full plugin pipeline)

Each transaction measures `state.apply()` + decoration rebuild + section computation + fold state recalc — the full plugin chain:

1. **Text insert** — insert 10 characters at a random position within a paragraph
2. **Heading insert** — insert a new heading node at a random position between existing headings
3. **Heading delete** — delete a heading and its content (section)
4. **Fold toggle** — dispatch `HeadingFoldMeta.set(tr, { type: "toggle", tocId })` on a random heading
5. **Filter apply** — dispatch `HeadingFilterMeta.set(tr, { type: "preview", query: "Section" })` to trigger filter decoration rebuild

#### Document Shapes

Two shapes, with warm-up per shape:

1. **Flat** — all H1 sections (many top-level headings). 5-transaction warm-up before first measurement.
2. **Deep** — H1 > H2 > H3 > H4 > H5 > H6 pattern, repeated (maximum nesting). 5-transaction warm-up before first measurement.

The reported ceiling is the **minimum** across both shapes.

#### Warm-Up

Before measurement at each binary-search step, apply 20 transactions (discarded) to let V8 JIT optimize hot paths. Additionally, 5 warm-up transactions when switching to a new document shape.

#### Test Skeleton

```typescript
// tests/unit/stress/headless-stress-probe.test.ts
import { describe, expect, test } from "vitest";
import type { JSONContent } from "@tiptap/core";
import { createTestEditor } from "@/tests/helpers/create-test-editor";

const MIN_CEILING = 200;
const TARGET_P95_MS = 16;
const WARMUP_COUNT = 20;
const MEASURE_COUNT = 100; // 20 per type × 5 types

type DocShape = "flat" | "deep";

function generateDocumentWithShape(
  headingCount: number,
  shape: DocShape,
): JSONContent {
  const content: JSONContent[] = [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] },
  ];
  for (let i = 1; i < headingCount; i++) {
    const level = shape === "flat" ? 1 : ((i % 6) + 1);
    content.push(
      { type: "heading", attrs: { level }, content: [{ type: "text", text: `H${i}` }] },
      { type: "paragraph", content: [{ type: "text", text: `Content ${i}` }] },
    );
  }
  return { type: "doc", content };
}

function measureTransactionP95(headingCount: number, shape: DocShape): number {
  const doc = generateDocumentWithShape(headingCount, shape);
  const editor = createTestEditor({ content: doc });

  // Warm-up: discard timing
  for (let i = 0; i < WARMUP_COUNT; i++) {
    // apply a text-insert transaction
  }

  // Measure: 100 transactions (20 per type)
  const timings: number[] = [];
  for (let i = 0; i < MEASURE_COUNT; i++) {
    const start = performance.now();
    // apply transaction by type (i % 5 selects type)
    const elapsed = performance.now() - start;
    timings.push(elapsed);
  }

  timings.sort((a, b) => a - b);
  const p95 = timings[Math.floor(timings.length * 0.95)] ?? 0;
  editor.destroy();
  return p95;
}

function binarySearchCeiling(shape: DocShape): number {
  let low = 10;
  let high = 2000;
  while (high - low > 5) {
    const mid = Math.floor((low + high) / 2);
    const p95 = measureTransactionP95(mid, shape);
    if (p95 < TARGET_P95_MS) low = mid + 1;
    else high = mid;
  }
  return low;
}

describe("headless stress probe", () => {
  test("finds capacity ceiling across document shapes", { timeout: 60_000 }, () => {
    const shapes: DocShape[] = ["flat", "deep"];
    const ceilings = shapes.map((shape) => {
      const ceiling = binarySearchCeiling(shape);
      console.log(`[stress-probe] ${shape}: ceiling = ${ceiling} headings`);
      return ceiling;
    });
    const minCeiling = Math.min(...ceilings);
    console.log(`[stress-probe] overall ceiling: ${minCeiling} headings`);
    expect(minCeiling).toBeGreaterThanOrEqual(MIN_CEILING);
  });
});
```

#### Task Checklist

- [x] Create `tests/unit/stress/headless-stress-probe.test.ts`
- [x] Implement `generateDocumentWithShape(count, shape)` for flat/deep
- [x] Implement 5 transaction type generators (text insert, heading insert, heading delete, fold toggle, filter apply)
- [x] Implement warm-up (20 tx per step, 5 tx per shape switch), measurement (100 tx), p95 calculation
- [x] Implement binary search (single measurement per step; no median-of-3 initially)
- [x] Run and verify: ceiling should be ≥200 for current codebase
- [x] Verify it runs within `bun run test` (included by vitest.config include pattern)

---

### Phase 2: Soak Infrastructure — Helpers

#### Task 2.1: Extend `EditorPage` POM

**File:** `tests/e2e/helpers/editor-page.ts` (existing)

Add methods needed by soak bot and journeys. All new methods use typed alternatives to avoid Biome `noExplicitAny` warnings:

```typescript
async undo(): Promise<void> {
  const mod = getModifierKey();
  await this.page.keyboard.press(`${mod}+z`);
}

async redo(): Promise<void> {
  const mod = getModifierKey();
  await this.page.keyboard.press(`${mod}+Shift+z`);
}

/** Inserts text at cursor via editor API (not clipboard paste — does not exercise paste handlers). */
async insertTextAtCursor(text: string): Promise<void> {
  await this.page.evaluate((t: string) => {
    const editor = (window as Window & {
      __tiptap_editor?: { commands: { insertContent: (c: string) => void } };
    }).__tiptap_editor;
    editor?.commands.insertContent(t);
  }, text);
}

async changeHeadingLevel(level: number): Promise<void> {
  const mod = getModifierKey();
  await this.page.keyboard.press(`${mod}+Alt+${level}`);
}

async scrollToBottom(): Promise<void> {
  await this.page.keyboard.press("End");
  await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
}

async scrollToTop(): Promise<void> {
  await this.page.keyboard.press("Home");
  await this.page.evaluate(() => window.scrollTo(0, 0));
}

async getHeapSize(): Promise<number | null> {
  return this.page.evaluate(() => {
    const perf = performance as Performance & {
      memory?: { usedJSHeapSize: number };
    };
    return perf.memory?.usedJSHeapSize ?? null;
  });
}

async getDocumentHeadingCount(): Promise<number> {
  return this.page.evaluate(() => {
    const editor = (window as Window & {
      __tiptap_editor?: { getJSON: () => { content?: Array<{ type?: string }> } };
    }).__tiptap_editor;
    return editor?.getJSON().content?.filter((n) => n.type === "heading").length ?? 0;
  });
}
```

#### Task 2.2: Add `generateLargeDocument` to Document Generators

**File:** `tests/helpers/document-generators.ts` (existing)

```typescript
export function generateLargeDocument(
  headingCount: number,
  shape: "flat" | "deep" | "mixed" = "mixed",
): { type: "doc"; content: unknown[] } {
  const content: unknown[] = [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "Soak Test Document" }],
    },
  ];
  for (let i = 1; i < headingCount; i++) {
    let level: number;
    switch (shape) {
      case "flat":
        level = 2;
        break;
      case "deep":
        level = (i % 5) + 2; // H2-H6
        break;
      case "mixed":
        level = randomInt(2, 6); // H2-H6 for body headings
        break;
    }
    content.push(
      { type: "heading", attrs: { level }, content: [{ type: "text", text: `Section ${i}` }] },
      { type: "paragraph", content: [{ type: "text", text: `Content for section ${i}.` }] },
    );
  }
  return { type: "doc", content };
}
```

#### Task 2.3: Add JSON-Level Schema Assertions

**File:** `tests/helpers/assert-invariants.ts` (existing)

Add a function that checks schema invariants from editor JSON output (for Playwright tests where we don't have ProseMirror `Node` objects):

```typescript
export function assertInvariantsFromJSON(
  json: { content?: Array<{ type?: string; attrs?: Record<string, unknown> }> },
): void {
  const content = json?.content;
  if (!content || content.length === 0) {
    throw new Error("Document has no content");
  }
  // First node must be heading with level 1
  const first = content[0];
  if (first.type !== "heading") {
    throw new Error(`First node is "${first.type}", expected "heading"`);
  }
  if (first.attrs?.level !== 1) {
    throw new Error(`First heading level is ${first.attrs?.level}, expected 1`);
  }
  // All heading levels must be 1-6
  for (const node of content) {
    if (node.type === "heading") {
      const level = node.attrs?.level as number;
      if (level < 1 || level > 6) {
        throw new Error(`Invalid heading level: ${level}`);
      }
    }
  }
}
```

#### Task 2.4: Soak Bot

**File:** `tests/e2e/helpers/soak-bot.ts` (new)

Weighted-random action generator that drives the soak runner:

```typescript
import type { EditorPage } from "./editor-page";

export interface SoakAction {
  name: string;
  weight: number;
  execute: (ep: EditorPage) => Promise<void>;
}

export const DEFAULT_ACTIONS: SoakAction[] = [
  { name: "type",          weight: 55, execute: async (ep) => { /* type 5-20 random chars */ } },
  { name: "fold",          weight: 10, execute: async (ep) => { /* toggle random heading fold */ } },
  { name: "unfold",        weight:  5, execute: async (ep) => { /* unfold random folded heading */ } },
  { name: "scroll",        weight: 10, execute: async (ep) => { /* scroll to random position */ } },
  { name: "filter",        weight:  5, execute: async (ep) => { /* open filter, type query, commit or clear */ } },
  { name: "drag",          weight:  3, execute: async (ep) => { /* drag a heading section */ } },
  { name: "undo",          weight:  5, execute: async (ep) => { /* undo */ } },
  { name: "redo",          weight:  2, execute: async (ep) => { /* redo */ } },
  { name: "insert",        weight:  3, execute: async (ep) => { /* insertTextAtCursor with random text */ } },
  { name: "heading-level", weight:  2, execute: async (ep) => { /* change heading level */ } },
];

export function pickAction(actions: SoakAction[]): SoakAction {
  const totalWeight = actions.reduce((sum, a) => sum + a.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const action of actions) {
    roll -= action.weight;
    if (roll <= 0) return action;
  }
  return actions[actions.length - 1];
}

export interface SoakRunOptions {
  delayBetweenMs?: number;
  intervalMs?: number;
  onInterval?: (elapsedMs: number) => Promise<void>;
}

export interface SoakStats {
  actionCounts: Record<string, number>;
  totalActions: number;
  errors: Array<{ action: string; error: string; timestamp: number }>;
}

export class SoakBot {
  private actions: SoakAction[];

  constructor(
    private editorPage: EditorPage,
    actions?: SoakAction[],
  ) {
    this.actions = actions ?? DEFAULT_ACTIONS;
  }

  async runFor(durationMs: number, options?: SoakRunOptions): Promise<SoakStats> {
    const delayBetween = options?.delayBetweenMs ?? 200;
    const intervalMs = options?.intervalMs ?? 30_000;
    const onInterval = options?.onInterval;
    const stats: SoakStats = { actionCounts: {}, totalActions: 0, errors: [] };
    const start = Date.now();
    let lastIntervalCheck = start;

    while (Date.now() - start < durationMs) {
      const action = pickAction(this.actions);
      try {
        await action.execute(this.editorPage);
        stats.actionCounts[action.name] = (stats.actionCounts[action.name] ?? 0) + 1;
        stats.totalActions++;
      } catch (err) {
        stats.errors.push({
          action: action.name,
          error: err instanceof Error ? err.message : String(err),
          timestamp: Date.now() - start,
        });
        // Fail-fast: stop on too many errors
        if (stats.errors.length >= 10) break;
      }

      // Interval callback (e.g. memory sampling)
      const now = Date.now();
      if (onInterval && now - lastIntervalCheck >= intervalMs) {
        await onInterval(now - start);
        lastIntervalCheck = now;
      }

      await new Promise((r) => setTimeout(r, delayBetween));
    }

    return stats;
  }
}
```

#### Task 2.5: Soak Journeys

**File:** `tests/e2e/helpers/soak-journeys.ts` (new)

Two scripted sequences (down from four — paste/undo/redo is covered by soak bot weights):

```typescript
import type { Page } from "@playwright/test";
import type { EditorPage } from "./editor-page";
import { collectPerfEntries, computeLatencyStats } from "./perf-observer";

export interface JourneyResult {
  name: string;
  pass: boolean;
  p95: number;
  threshold: number;
  actionCount: number;
  durationMs: number;
}

const LATENCY_THRESHOLD_MS = 100;

// Journey 1: Typing + Structural Editing
// Type 200 characters, create 3 headings, fold each, unfold each, delete one
// Measures keystroke-to-paint latency across typing and structural ops
export async function typingAndStructuralJourney(
  page: Page,
  ep: EditorPage,
): Promise<JourneyResult> {
  const start = Date.now();
  let actionCount = 0;

  // Type 200 characters rapidly
  await page.keyboard.type("a".repeat(200), { delay: 10 });
  actionCount += 200;

  // Create 3 headings
  for (let i = 0; i < 3; i++) {
    await ep.pressKey("Enter");
    await ep.changeHeadingLevel(2);
    await ep.typeText(`Journey Heading ${i + 1}`);
    actionCount += 3;
  }

  // Fold each heading (via TOC sidebar)
  const headings = await ep.getHeadingsWithTocIds();
  const bodyHeadings = headings.filter((h) => h.level !== undefined && h.level > 1);
  for (const h of bodyHeadings.slice(0, 3)) {
    await ep.clickFoldChevron(h.tocId);
    actionCount++;
  }

  // Unfold each
  for (const h of bodyHeadings.slice(0, 3)) {
    await ep.clickFoldChevron(h.tocId);
    actionCount++;
  }

  const entries = await collectPerfEntries(page);
  const stats = computeLatencyStats(entries);
  const durationMs = Date.now() - start;

  return {
    name: "typing-and-structural",
    pass: stats.p95 < LATENCY_THRESHOLD_MS,
    p95: stats.p95,
    threshold: LATENCY_THRESHOLD_MS,
    actionCount,
    durationMs,
  };
}

// Journey 2: Filter Lifecycle
// Open filter → type → commit → edit while filtered → clear → repeat 3x
export async function filterLifecycleJourney(
  page: Page,
  ep: EditorPage,
): Promise<JourneyResult> {
  const start = Date.now();
  let actionCount = 0;

  for (let round = 0; round < 3; round++) {
    await ep.openFilter();
    await ep.typeFilter(`Section`);
    await ep.commitFilter();
    actionCount += 3;

    // Edit while filtered
    await page.click(".tiptap");
    await ep.typeText("Filtered edit ");
    actionCount++;

    await ep.clearFilter();
    actionCount++;
  }

  const entries = await collectPerfEntries(page);
  const stats = computeLatencyStats(entries);
  const durationMs = Date.now() - start;

  return {
    name: "filter-lifecycle",
    pass: stats.p95 < LATENCY_THRESHOLD_MS,
    p95: stats.p95,
    threshold: LATENCY_THRESHOLD_MS,
    actionCount,
    durationMs,
  };
}

export async function runAllJourneys(
  page: Page,
  ep: EditorPage,
): Promise<JourneyResult[]> {
  return [
    await typingAndStructuralJourney(page, ep),
    await filterLifecycleJourney(page, ep),
  ];
}
```

#### Task Checklist

- [x] Extend `EditorPage` with `undo`, `redo`, `insertTextAtCursor`, `changeHeadingLevel`, `scrollToBottom`, `scrollToTop`, `getHeapSize`, `getDocumentHeadingCount` — all using typed casts (no `any`)
- [x] Add `generateLargeDocument` to `tests/helpers/document-generators.ts`
- [x] Add `assertInvariantsFromJSON` to `tests/helpers/assert-invariants.ts`
- [x] Create `tests/e2e/helpers/soak-bot.ts` with `SoakBot` class, typed `SoakRunOptions`, and weighted-random action selection
- [x] Create `tests/e2e/helpers/soak-journeys.ts` with 2 journeys (typing+structural, filter lifecycle)

---

### Phase 3: Soak Runner Specs

#### Task 3.1: Single-User Soak — `tests/e2e/soak.spec.ts`

Combines the soak runner with memory tracking (previously a separate `memory-growth.spec.ts`):

```typescript
import { expect, test } from "@playwright/test";
import { generateLargeDocument } from "@/tests/helpers/document-generators";
import { EditorPage } from "./helpers/editor-page";
import { collectPerfEntries, computeLatencyStats, injectPerfObserver } from "./helpers/perf-observer";
import { SoakBot } from "./helpers/soak-bot";
import { runAllJourneys } from "./helpers/soak-journeys";

const SOAK_DURATION = Number(process.env.SOAK_DURATION ?? 1_800_000);
const SOAK_HEADINGS = Number(process.env.SOAK_HEADINGS ?? 200);
const MEMORY_GROWTH_LIMIT = 50; // percent
const WARMUP_DURATION = 120_000; // 2 minutes

test.setTimeout(SOAK_DURATION + 300_000);

test("single-user soak — sustained editing with memory tracking", async ({ page }) => {
  await injectPerfObserver(page);
  const ep = new EditorPage(page);
  await ep.goto();
  await ep.waitForSync();
  await ep.setContent(generateLargeDocument(SOAK_HEADINGS));

  // Phase 1: Scripted journeys (hard pass/fail thresholds)
  const journeyResults = await runAllJourneys(page, ep);
  for (const j of journeyResults) {
    console.log(`[journey] ${j.name}: p95=${j.p95.toFixed(1)}ms (threshold ${j.threshold}ms) — ${j.pass ? "PASS" : "FAIL"}`);
    expect(j.pass, `Journey "${j.name}" failed: p95=${j.p95.toFixed(1)}ms > ${j.threshold}ms`).toBe(true);
  }

  // Phase 2: Warm-up + memory baseline
  const warmupBot = new SoakBot(ep);
  await warmupBot.runFor(WARMUP_DURATION, { delayBetweenMs: 500 });
  const baselineHeap = await ep.getHeapSize();

  // Phase 3: Stochastic bot with memory sampling
  const memorySamples: Array<{ elapsed: number; heap: number }> = [];
  const bot = new SoakBot(ep);
  const soakStats = await bot.runFor(SOAK_DURATION, {
    delayBetweenMs: 200,
    intervalMs: 30_000,
    onInterval: async (elapsed) => {
      const heap = await ep.getHeapSize();
      if (heap !== null) {
        memorySamples.push({ elapsed, heap });
      }
    },
  });

  // Phase 4: Final checks
  const finalHeap = await ep.getHeapSize();
  const growthPercent = baselineHeap && finalHeap
    ? ((finalHeap - baselineHeap) / baselineHeap) * 100
    : null;

  // Phase 5: Latency stats
  const entries = await collectPerfEntries(page);
  const latency = computeLatencyStats(entries);

  // Phase 6: Report (inline — no separate reporter module)
  const report = {
    timestamp: new Date().toISOString(),
    headingCount: SOAK_HEADINGS,
    duration: { configured: SOAK_DURATION, actual: SOAK_DURATION + WARMUP_DURATION },
    journeys: journeyResults,
    soak: soakStats,
    memory: { baselineHeap, finalHeap, growthPercent, samples: memorySamples },
    latency,
    verdict: "PASS" as "PASS" | "FAIL",
    failReasons: [] as string[],
  };

  if (growthPercent !== null && growthPercent >= MEMORY_GROWTH_LIMIT) {
    report.verdict = "FAIL";
    report.failReasons.push(`Memory grew ${growthPercent.toFixed(1)}% (limit: ${MEMORY_GROWTH_LIMIT}%)`);
  }
  if (soakStats.errors.length > 0) {
    report.verdict = "FAIL";
    report.failReasons.push(`${soakStats.errors.length} action errors`);
  }

  console.log("\n=== Soak Test Report ===");
  console.log(`Duration:   ${(SOAK_DURATION / 60_000).toFixed(0)} min`);
  console.log(`Headings:   ${SOAK_HEADINGS}`);
  console.log(`Actions:    ${soakStats.totalActions}`);
  console.log(`Errors:     ${soakStats.errors.length}`);
  console.log(`Memory:     ${growthPercent !== null ? `${growthPercent.toFixed(1)}%` : "N/A (non-Chrome)"}`);
  console.log(`Latency:    p50=${latency.p50.toFixed(1)}ms p95=${latency.p95.toFixed(1)}ms`);
  console.log(`Verdict:    ${report.verdict}`);

  // Write JSON for CI artifacts
  const fs = await import("node:fs");
  fs.writeFileSync(`soak-report-${Date.now()}.json`, JSON.stringify(report, null, 2));

  // Assertions
  if (growthPercent !== null) {
    expect(growthPercent).toBeLessThan(MEMORY_GROWTH_LIMIT);
  }
  expect(soakStats.errors).toHaveLength(0);
});
```

#### Task 3.2: Multi-User Collaboration Soak — `tests/e2e/soak-collab.spec.ts`

Combines multi-user soak with schema integrity checks (previously a separate `schema-integrity.spec.ts`):

```typescript
import { expect, test } from "@playwright/test";
import { generateLargeDocument } from "@/tests/helpers/document-generators";
import { assertInvariantsFromJSON } from "@/tests/helpers/assert-invariants";
import { EditorPage } from "./helpers/editor-page";
import { SoakBot } from "./helpers/soak-bot";

const SOAK_DURATION = Number(process.env.SOAK_DURATION ?? 1_800_000);

test.setTimeout(SOAK_DURATION + 300_000);

test("multi-user soak — 2 users editing concurrently with schema checks", async ({ browser }) => {
  const [ctxA, ctxB] = await Promise.all([
    browser.newContext(),
    browser.newContext(),
  ]);
  const [pageA, pageB] = await Promise.all([ctxA.newPage(), ctxB.newPage()]);
  const [epA, epB] = [new EditorPage(pageA), new EditorPage(pageB)];

  // Both navigate to same document
  const docId = `soak-collab-${Date.now()}`;
  await Promise.all([epA.goto(docId), epB.goto(docId)]);
  await Promise.all([epA.waitForSync(), epB.waitForSync()]);

  // User A seeds the document
  await epA.setContent(generateLargeDocument(100));
  await pageA.waitForTimeout(2000); // sync propagation

  // Run bots concurrently with periodic schema integrity checks
  const bots = [new SoakBot(epA), new SoakBot(epB)];
  const editors = [epA, epB];

  const results = await Promise.all(
    bots.map((bot, i) =>
      bot.runFor(SOAK_DURATION, {
        delayBetweenMs: 300,
        intervalMs: 60_000, // check schema every minute
        onInterval: async () => {
          const json = await editors[i].getEditorJSON();
          try {
            assertInvariantsFromJSON(
              json as { content?: Array<{ type?: string; attrs?: Record<string, unknown> }> },
            );
          } catch (err) {
            console.error(`[schema] User ${i} invariant violation:`, (err as Error).message);
            throw err; // fail-fast
          }
        },
      }),
    ),
  );

  // Drain: wait for Yjs convergence
  await Promise.all([pageA.waitForTimeout(5000), pageB.waitForTimeout(5000)]);

  // Verify convergence: both editors have same content
  const [jsonA, jsonB] = await Promise.all([epA.getEditorJSON(), epB.getEditorJSON()]);
  expect(JSON.stringify(jsonA)).toBe(JSON.stringify(jsonB));

  // Final schema check on converged state
  assertInvariantsFromJSON(
    jsonA as { content?: Array<{ type?: string; attrs?: Record<string, unknown> }> },
  );

  // Report
  for (const [i, r] of results.entries()) {
    console.log(`[soak-collab] User ${i}: ${r.totalActions} actions, ${r.errors.length} errors`);
  }

  await Promise.all([ctxA.close(), ctxB.close()]);
});
```

#### Task Checklist

- [x] Create `tests/e2e/soak.spec.ts` with single-user soak (journeys + bot + memory — inline reporting)
- [x] Create `tests/e2e/soak-collab.spec.ts` with 2-user concurrent soak + schema integrity
- [x] Both specs support `SOAK_DURATION` and `SOAK_HEADINGS` env vars
- [x] Both produce stdout summary; single-user writes JSON to file
- [x] Fail-fast on memory growth >50%, schema violation, or 10+ action errors

---

### Phase 4: Yjs Soak Scenarios (TDD)

These tests expose known collaboration-layer gaps as failing tests. Only two specs — memory tracking and schema integrity are folded into the soak specs above.

#### Task 4.1: Reconnection Recovery — `tests/e2e/yjs-soak/reconnection.spec.ts`

Inline Hocuspocus lifecycle management (no separate `HocuspocusManager` class):

```typescript
import { type ChildProcess, spawn } from "node:child_process";
import net from "node:net";
import { expect, test } from "@playwright/test";
import { EditorPage } from "../helpers/editor-page";

const HOCUS_PORT = 1235;
const HOCUS_DB = "db-soak-test.sqlite";

async function waitForPort(port: number, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const reachable = await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ port, host: "127.0.0.1" });
      socket.on("connect", () => { socket.destroy(); resolve(true); });
      socket.on("error", () => resolve(false));
    });
    if (reachable) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Port ${port} not reachable within ${timeoutMs}ms`);
}

function spawnHocuspocus(): ChildProcess {
  return spawn("bunx", [
    "@hocuspocus/cli",
    "--port", String(HOCUS_PORT),
    "--sqlite", HOCUS_DB,
  ], { stdio: "pipe" });
}

async function killProcess(proc: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    let resolved = false;
    const done = () => { if (!resolved) { resolved = true; resolve(); } };
    proc.on("exit", done);
    proc.kill("SIGTERM");
    setTimeout(() => {
      if (!proc.killed) proc.kill("SIGKILL");
      done();
    }, 3000);
  });
}

test.describe("yjs reconnection recovery", () => {
  let hocus: ChildProcess;

  test.afterEach(async () => {
    if (hocus) await killProcess(hocus);
    // Clean up test database
    const fs = await import("node:fs");
    try { fs.unlinkSync(HOCUS_DB); } catch { /* ignore ENOENT */ }
  });

  test("editor recovers from Hocuspocus restart without data loss", async ({ page }) => {
    // Start test Hocuspocus on port 1235
    hocus = spawnHocuspocus();
    await waitForPort(HOCUS_PORT);

    // Override WS URL to point at test Hocuspocus
    await page.addInitScript(`window.__HOCUS_URL = "ws://127.0.0.1:${HOCUS_PORT}"`);

    const ep = new EditorPage(page);
    await ep.goto();
    await ep.waitForSync();

    // Type initial content
    await ep.typeText("Hello before crash");
    await page.waitForTimeout(1000);
    const beforeJson = await ep.getEditorJSON();

    // Kill Hocuspocus
    await killProcess(hocus);
    await page.waitForTimeout(2000);

    // Type while disconnected
    await ep.typeText(" — offline edit");

    // Restart Hocuspocus
    hocus = spawnHocuspocus();
    await waitForPort(HOCUS_PORT);
    await page.waitForTimeout(5000); // wait for reconnect + sync

    // Verify: content includes both pre-crash and offline edits
    const afterJson = await ep.getEditorJSON();
    const textContent = JSON.stringify(afterJson);
    expect(textContent).toContain("Hello before crash");
    expect(textContent).toContain("offline edit");
  });
});
```

**Minimal prod code change required:** Add to `hooks/use-yjs-document.ts`:

```typescript
// At module scope, replace the hardcoded WS_URL:
declare global {
  interface Window {
    __HOCUS_URL?: string;
  }
}

const WS_URL =
  typeof window !== "undefined" && window.__HOCUS_URL
    ? window.__HOCUS_URL
    : "ws://127.0.0.1:1234";
```

**Expected initial failure:** `useYjsDocument` never resets `synced` on disconnect; reconnection may not properly re-sync.

#### Task 4.2: Rapid Tab Switching — `tests/e2e/yjs-soak/rapid-tab-switch.spec.ts`

```typescript
import { expect, test } from "@playwright/test";
import { EditorPage } from "../helpers/editor-page";

test("rapid tab switching does not create duplicate connections or stale state", async ({ page }) => {
  // Attach console listener BEFORE the test actions
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  const ep = new EditorPage(page);
  await ep.goto("tab-switch-test");
  await ep.waitForSync();
  await ep.typeText("Initial content");
  await page.waitForTimeout(1000);

  // Rapidly switch tabs 20 times
  for (let i = 0; i < 20; i++) {
    const targetTab = `other-doc-${i % 2}`;
    await page.evaluate((tabId: string) => {
      const state = JSON.parse(localStorage.getItem("tinydocy-tabs") ?? "{}");
      const tabs: Array<{ id: string; title: string; createdAt: number }> = state.tabs ?? [];
      if (!tabs.find((t) => t.id === tabId)) {
        tabs.push({ id: tabId, title: "Other", createdAt: Date.now() });
      }
      state.tabs = tabs;
      state.activeTabId = tabId;
      localStorage.setItem("tinydocy-tabs", JSON.stringify(state));
      window.dispatchEvent(new StorageEvent("storage", { key: "tinydocy-tabs" }));
    }, targetTab);

    await page.waitForTimeout(100);
  }

  // Switch back to original doc
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("tinydocy-tabs") ?? "{}");
    state.activeTabId = "tab-switch-test";
    localStorage.setItem("tinydocy-tabs", JSON.stringify(state));
    window.dispatchEvent(new StorageEvent("storage", { key: "tinydocy-tabs" }));
  });
  await page.waitForTimeout(2000);

  // Verify: content still present, no duplicate connection errors
  const json = await ep.getEditorJSON();
  const textContent = JSON.stringify(json);
  expect(textContent).toContain("Initial content");
  expect(consoleErrors.filter((e) => e.includes("duplicate"))).toHaveLength(0);
});
```

**Expected initial result:** May pass or fail depending on React strict-mode dual-mount behavior. Documents expected behavior regardless.

#### Task Checklist

- [x] Create `tests/e2e/yjs-soak/reconnection.spec.ts` with inline Hocuspocus spawn/kill on port 1235
- [x] Create `tests/e2e/yjs-soak/rapid-tab-switch.spec.ts` with console listener attached before actions
- [x] Add `declare global { interface Window { __HOCUS_URL?: string } }` to `hooks/use-yjs-document.ts`
- [x] Use `window.__HOCUS_URL` fallback in `useYjsDocument`
- [x] Both Yjs soak tests document expected initial failure (TDD)
- [x] `test.afterEach` guarantees Hocuspocus cleanup in reconnection spec

---

### Phase 5: Scripts, Config & Gitignore

#### Task 5.1: New & Updated `package.json` Scripts

```json
{
  "test:e2e": "bunx playwright test --project chromium",
  "test:stress": "vitest run tests/unit/stress/",
  "test:soak": "bunx playwright test --project soak",
  "test:soak:quick": "SOAK_DURATION=300000 bunx playwright test --project soak tests/e2e/soak.spec.ts",
  "test:yjs-soak": "bunx playwright test --project yjs-soak"
}
```

#### Task 5.2: Makefile Additions

```makefile
test-stress: ## Run headless stress probe
 bun run test:stress

test-soak: ## Run full soak test suite (default 30 min)
 bun run test:soak

test-soak-quick: ## Run 5-minute quick soak
 bun run test:soak:quick

test-yjs-soak: ## Run Yjs soak scenarios (TDD)
 bun run test:yjs-soak
```

#### Task 5.3: `.gitignore` Additions

```gitignore
# Soak test reports (local-only, hardware-specific)
soak-report-*.json

# Soak test SQLite database
db-soak-test.sqlite
```

#### Task 5.4: Playwright Config Update

Separate projects with correct test matching to keep normal E2E fast:

```typescript
// playwright.config.ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  use: {
    baseURL: "http://localhost:3000",
    headless: true,
  },
  projects: [
    {
      name: "chromium",
      testMatch: ["**/*.spec.ts"],
      testIgnore: ["**/soak*.spec.ts", "**/yjs-soak/**"],
      use: { browserName: "chromium" },
    },
    {
      name: "soak",
      testMatch: ["**/soak.spec.ts", "**/soak-collab.spec.ts"],
      use: { browserName: "chromium" },
      timeout: 2_400_000, // 40 min (covers 30-min soak + buffer)
    },
    {
      name: "yjs-soak",
      testMatch: ["**/yjs-soak/**"],
      use: { browserName: "chromium" },
      timeout: 900_000, // 15 min
    },
  ],
  webServer: process.env.CI
    ? {
        command: "make dev",
        url: "http://localhost:3000",
        timeout: 60_000,
      }
    : undefined,
});
```

#### Task Checklist

- [x] Add `test:stress`, `test:soak`, `test:soak:quick`, `test:yjs-soak` to `package.json`
- [x] Add corresponding Makefile targets with `.PHONY`
- [x] Add `.gitignore` entries for soak reports and test SQLite
- [x] Update `playwright.config.ts` with 3 projects (chromium, soak, yjs-soak)
- [x] Verify `bun run test` still runs only unit tests (stress probe included, soak excluded)
- [x] Update `test:e2e` script to `bunx playwright test --project chromium` (Playwright runs ALL projects by default — explicit `--project` is required)
- [x] Verify `bun run test:e2e` runs only non-soak E2E specs

---

## Acceptance Criteria

### Functional Requirements

- [ ] `bun run test:stress` binary-searches capacity ceiling and reports ≥200 headings
- [ ] `bun run test:soak:quick` (5 min) completes: journeys pass, memory stable, bot runs without errors
- [ ] `bun run test:soak` (30 min) completes with same criteria over longer duration
- [ ] `bun run test:yjs-soak` runs both Yjs soak scenarios (reconnection expected to fail — TDD)
- [ ] Multi-user soak verifies content convergence and schema integrity across both browser contexts
- [ ] Soak reports output to stdout and JSON file

### Non-Functional Requirements

- [ ] Headless stress probe completes in <30 seconds
- [ ] Quick soak (5 min) completes in <7 minutes (soak + warm-up + buffer)
- [ ] `bun run test` still completes in <10 seconds (stress probe included)
- [ ] Soak bot exercises all action types proportionally to configured weights
- [ ] Memory sampling interval: every 30 seconds during soak

### Quality Gates

- [ ] Zero Biome linter errors in new test files
- [ ] TypeScript strict mode — no `any` casts (use typed performance/window extensions)
- [ ] All new helpers use named exports only
- [ ] Reconnection spec guarantees Hocuspocus cleanup via `test.afterEach`
- [ ] Soak JSON reports are valid JSON (parseable by CI artifact collectors)

---

## Dependencies & Prerequisites

- **Existing infrastructure:** All Phase 1-5 from prior plan must be complete (it is)
- **Runtime:** Bun 1.3.10+ (pinned), Chromium (installed)
- **Dev server:** `make dev` must be running for soak and E2E tests (documented in scripts)
- **No new dependencies** — uses existing Playwright, Vitest, and Node.js `child_process`/`net`

---

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Binary search oscillates at boundary | Medium | Low | ±5 heading tolerance; add median-of-3 later if flaky |
| `performance.memory` unavailable outside Chrome | Known | Medium | Guard with null check; skip memory assertion when null |
| Soak bot causes page crash | Low | Medium | Fail-fast after 10 errors; wrap each action in try/catch |
| Hocuspocus orphan process after test failure | Medium | High | `test.afterEach` guarantees cleanup; SIGKILL fallback |
| Port 1235 still bound after Hocuspocus kill | Medium | Medium | `waitForPort` with retry in reconnection spec |
| WS URL override leaks to production | Low | High | Only reads `window.__HOCUS_URL` when set; fallback to default URL |
| 30-min soak test flakes in CI | Medium | Medium | Generous timeouts; soak is nightly-only, not blocking PRs |
| Stress probe ceiling varies by hardware | Known | Low | Report-only; hard minimum of 200 is conservative |
| Yjs reconnection test fails (by design — TDD) | Certain | Positive | Expected; failure becomes specification for the fix |

---

## Post-Implementation Addendum

Changes applied after initial plan completion to address real-world usage gaps.

### Dynamic N-User Collaboration (soak-collab.spec.ts)

The original plan specified a hardcoded 2-user soak. This was expanded to support N dynamic users:

- **`SOAK_USERS` env var** (default: 3) — controls how many browser contexts are spawned
- **Sequential join** — User 0 seeds the document and waits for content to render, then Users 1..N-1 join sequentially (each verifies initial sync before proceeding), avoiding the unreliable parallel-join race condition
- **Per-user convergence** — final assertion compares all N replicas against User 0's document (not just pairwise A/B)
- **Tested at 5 users** with zero errors and full byte-level convergence

### Explicit User Identity (window.__HOCUS_TOKEN)

Each simulated user now presents a distinct identity to Hocuspocus, mirroring real-world multi-browser behavior:

- **`hooks/use-yjs-document.ts`** — reads `window.__HOCUS_TOKEN` and passes it as `token` to `HocuspocusProvider`
- **Playwright tests** — each `browser.newContext()` injects a unique token via `page.addInitScript()` (e.g., `soak-user-0-{docId}`, `soak-user-1-{docId}`)
- **Load harness** — each of the N headless clients passes `load-client-{i}-{docId}` as its token
- **Future-proof** — when authentication is added, the plumbing is already in place; currently `@hocuspocus/cli` accepts all tokens

### Realistic Document Content (document-generators.ts)

The original plan generated a single paragraph per heading section. Documents now include:

- **3-5 prose paragraphs** per section with multi-sentence, domain-relevant text
- **Structured blocks** randomly interleaved: bullet lists (3-6 items), ordered lists (3-5 items), task lists (3-5 items with checked/unchecked state), code blocks (multi-line TypeScript samples), blockquotes (2 paragraphs)
- **Realistic section titles** drawn from a pool of 20 professional heading names
- **`richContent` option** — defaults to `true`; pass `{ richContent: false }` for lightweight documents in performance-sensitive tests
- **Load harness seeding** — `seedDocument()` now builds 78 top-level nodes (10 sections with paragraphs, bullet lists, task lists, and trailing paragraphs) using push-first Y.XmlElement construction to avoid Yjs warnings
- **Test editor parity** — `createTestEditor` now registers `TaskList`/`TaskItem`; `VALID_BLOCK_NAMES` includes `taskList`/`taskItem`
- **Vitest/Playwright isolation** — `assertInvariantsFromJSON` extracted to `assert-invariants-json.ts` (no vitest import) to avoid CommonJS/ESM conflict in Playwright

### Collaboration Test Restructuring (collaboration.spec.ts)

The original single collaboration test was split into two focused tests:

| Test | Strategy | Reliability |
|------|----------|-------------|
| "user B sees content created by user A" | User A types → waits 2s → User B joins and gets content on initial sync | Deterministic (5/5) |
| "real-time sync between two connected users" | Both connected → User A types → User B polls for text | Inherently timing-sensitive; `retries: 1` |

### Y.Doc Lifecycle (use-yjs-document.ts)

Module-level `docCache` with reference counting ensures Y.Doc instances persist across React component unmounts during tab switches. `releaseDoc` decrements `refCount` without destroying the doc, preventing content loss on rapid tab switching. `onDisconnect` removed from `HocuspocusProvider` to keep the editor active during brief disconnections.

---

## References

### Internal References

- Prior plan: `docs/plans/2026-03-15-feat-e2e-testing-strategy-plan.md`
- Brainstorm: `docs/brainstorms/2026-03-15-test-realism-and-soak-brainstorm.md`
- Existing helpers: `tests/helpers/create-test-editor.ts`, `tests/helpers/document-generators.ts`, `tests/helpers/assert-invariants.ts`, `tests/helpers/assert-invariants-json.ts`
- Existing POM: `tests/e2e/helpers/editor-page.ts`
- Existing perf observer: `tests/e2e/helpers/perf-observer.ts`
- Yjs integration: `hooks/use-yjs-document.ts`
- Yjs load harness: `tests/load/yjs-load-harness.ts`
- Editor entry: `components/tiptap-templates/simple/simple-editor.tsx`

### External References

- Playwright test timeout config: <https://playwright.dev/docs/test-timeouts>
- `performance.memory` API (Chrome-only): <https://developer.mozilla.org/en-US/docs/Web/API/Performance/memory>
- PerformanceObserver Event Timing API: <https://developer.mozilla.org/en-US/docs/Web/API/PerformanceEventTiming>
