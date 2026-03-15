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
