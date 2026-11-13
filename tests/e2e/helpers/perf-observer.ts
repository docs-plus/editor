import type { Page } from "@playwright/test";

export interface PerfEntry {
  name: string;
  startTime: number;
  processingStart: number;
  processingEnd: number;
  duration: number;
}

export async function injectPerfObserver(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as Window & { __perf_entries?: PerfEntry[] }).__perf_entries = [];
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (
          entry.entryType === "event" &&
          (entry.name === "keydown" || entry.name === "keypress")
        ) {
          const e = entry as PerformanceEntry & {
            processingStart?: number;
            processingEnd?: number;
          };
          (
            window as Window & { __perf_entries?: PerfEntry[] }
          ).__perf_entries?.push({
            name: entry.name,
            startTime: entry.startTime,
            processingStart: e.processingStart ?? 0,
            processingEnd: e.processingEnd ?? 0,
            duration: entry.duration,
          });
        }
      }
    });
    observer.observe({
      type: "event",
      buffered: true,
      durationThreshold: 16,
    } as PerformanceObserverInit);
  });
}

export async function collectPerfEntries(page: Page): Promise<PerfEntry[]> {
  return page.evaluate(() => {
    const entries =
      (window as Window & { __perf_entries?: PerfEntry[] }).__perf_entries ??
      [];
    (window as Window & { __perf_entries?: PerfEntry[] }).__perf_entries = [];
    return entries;
  });
}

export function computeLatencyStats(entries: PerfEntry[]): {
  count: number;
  p50: number;
  p95: number;
  mean: number;
  max: number;
} {
  if (entries.length === 0)
    return { count: 0, p50: 0, p95: 0, mean: 0, max: 0 };

  const durations = entries.map((e) => e.duration).sort((a, b) => a - b);
  const count = durations.length;
  const mean = durations.reduce((a, b) => a + b, 0) / count;
  const p50 = durations[Math.floor(count * 0.5)] ?? 0;
  const p95 = durations[Math.floor(count * 0.95)] ?? 0;
  const max = durations[count - 1] ?? 0;

  return { count, p50, p95, mean, max };
}

export type LatencyStats = ReturnType<typeof computeLatencyStats>;

export function logLatencyStats(label: string, stats: LatencyStats): void {
  console.log(`=== Performance: ${label} ===`);
  console.log(`Samples: ${stats.count}`);
  console.log(`p50: ${stats.p50.toFixed(1)}ms`);
  console.log(`p95: ${stats.p95.toFixed(1)}ms`);
  console.log(`Mean: ${stats.mean.toFixed(1)}ms`);
  console.log(`Max: ${stats.max.toFixed(1)}ms`);
}

type KeystrokeWindow = Window & {
  __keystroke_latencies?: number[];
  __keydown_ts?: number;
};

/**
 * Times each keystroke's synchronous handling: from its keydown `timeStamp` to
 * a microtask queued by a bubble-phase `input` listener on `window`, the last
 * listener of the event. By then ProseMirror's DOM-change flush (a
 * MutationObserver microtask), the Yjs write and the toolbar's transaction
 * listener have all run, so their work in the event is included. Deferred
 * work (timers, React renders) is not; Task 7's commit budget gates that.
 *
 * It must not stop at a task such as a `MessageChannel` message: under CPU
 * throttle Chrome runs input ahead of normal-priority tasks, so such messages
 * pile up while typing continues and drain together once it stops, timing
 * the scheduler's backlog and whatever task ran before it instead of the key.
 * Unlike Event Timing it has no 16 ms floor and, unlike
 * requestAnimationFrame, no frame quantization.
 */
export async function injectKeystrokeTimer(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as KeystrokeWindow;
    w.__keystroke_latencies = [];
    window.addEventListener(
      "keydown",
      (e) => {
        w.__keydown_ts = e.timeStamp;
      },
      true,
    );
    window.addEventListener("input", () => {
      const keydownTs = w.__keydown_ts;
      if (keydownTs === undefined) return;
      w.__keydown_ts = undefined;
      queueMicrotask(() => {
        w.__keystroke_latencies?.push(performance.now() - keydownTs);
      });
    });
  });
}

export async function collectKeystrokeLatencies(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const w = window as KeystrokeWindow;
    const samples = w.__keystroke_latencies ?? [];
    w.__keystroke_latencies = [];
    return samples;
  });
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.floor(sorted.length * (p / 100)),
  );
  return sorted[idx] ?? 0;
}

export function median(values: number[]): number {
  return percentile(values, 50);
}

/**
 * Resolves once the page's main thread has had `streak` idle periods in a
 * row of at least `minIdleMs` each (`requestIdleCallback`), so a timing run
 * starts after load, sync and render work has drained instead of after a
 * fixed sleep that a slow or throttled machine can overrun.
 */
export async function waitForMainThreadIdle(
  page: Page,
  { streak = 2, minIdleMs = 40, timeoutMs = 15_000 } = {},
): Promise<void> {
  await page.evaluate(
    ({ streak, minIdleMs, timeoutMs }) =>
      new Promise<void>((resolve, reject) => {
        const giveUp = performance.now() + timeoutMs;
        let idle = 0;
        const tick = (deadline: IdleDeadline) => {
          idle = deadline.timeRemaining() >= minIdleMs ? idle + 1 : 0;
          if (idle >= streak) resolve();
          else if (performance.now() > giveUp)
            reject(new Error(`main thread not idle after ${timeoutMs} ms`));
          else requestIdleCallback(tick);
        };
        requestIdleCallback(tick);
      }),
    { streak, minIdleMs, timeoutMs },
  );
}
