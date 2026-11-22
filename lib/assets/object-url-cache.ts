/**
 * Reference-counted object URLs for image store bytes on the web (spec
 * §3.3, risk R2). The web library renders `asset:` images through these,
 * because IndexedDB bytes have no URL of their own.
 *
 * - One URL per hash, and one in-flight load per hash.
 * - **The caller's `AbortSignal` is the release:** a node view aborts it on
 *   destroy, so nothing leaks when a view is torn down. There is no
 *   separate `release()` to forget or call twice.
 * - A URL is revoked `graceMs` (30 s) after its count reaches 0, so a tab
 *   switch reuses it; `peek` picks it up synchronously.
 * - Every URL is revoked when the last attached editor detaches.
 * - Misses and load failures are not remembered: the next view tries again.
 */
import type { AssetHex } from "@/lib/assets/asset-ref";

export interface ObjectUrlApi {
  create(blob: Blob): string;
  revoke(url: string): void;
}

export interface CacheClock {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

type Entry = {
  count: number;
  url: string | null;
  loading: Promise<string | null> | null;
  timer: unknown;
};

export interface ObjectUrlCache {
  /** The URL for `hex`, loading its bytes once; held until `signal` aborts. */
  acquire(
    hex: AssetHex,
    load: () => Promise<Blob | null>,
    signal: AbortSignal,
  ): Promise<string | null>;
  /** A warm URL, held until `signal` aborts, or `null` without loading. */
  peek(hex: AssetHex, signal: AbortSignal): string | null;
  /** Counts an editor; the returned detach revokes everything after the last. */
  attach(): () => void;
}

const browserUrls: ObjectUrlApi = {
  create: (blob) => URL.createObjectURL(blob),
  revoke: (url) => URL.revokeObjectURL(url),
};

const browserClock: CacheClock = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createObjectUrlCache({
  urls = browserUrls,
  clock = browserClock,
  graceMs = 30_000,
}: {
  urls?: ObjectUrlApi;
  clock?: CacheClock;
  graceMs?: number;
} = {}): ObjectUrlCache {
  let entries = new Map<AssetHex, Entry>();
  let editors = 0;

  const drop = (hex: AssetHex, entry: Entry) => {
    if (entries.get(hex) !== entry) return;
    entries.delete(hex);
    if (entry.timer !== null) clock.clearTimeout(entry.timer);
    if (entry.url) urls.revoke(entry.url);
  };

  /** Counts one holder; `signal` aborting releases it, exactly once. */
  const hold = (hex: AssetHex, entry: Entry, signal: AbortSignal) => {
    entry.count += 1;
    if (entry.timer !== null) {
      clock.clearTimeout(entry.timer);
      entry.timer = null;
    }
    signal.addEventListener(
      "abort",
      () => {
        if (entries.get(hex) !== entry) return;
        entry.count -= 1;
        if (entry.count > 0 || entry.loading) return;
        entry.timer = clock.setTimeout(() => drop(hex, entry), graceMs);
      },
      { once: true },
    );
  };

  const settleLoad = (hex: AssetHex, entry: Entry, blob: Blob | null) => {
    entry.loading = null;
    if (entries.get(hex) !== entry) return null; // purged meanwhile
    if (!blob) {
      entries.delete(hex);
      return null;
    }
    try {
      entry.url = urls.create(blob);
    } catch {
      entries.delete(hex);
      return null;
    }
    if (entry.count === 0) {
      entry.timer = clock.setTimeout(() => drop(hex, entry), graceMs);
    }
    return entry.url;
  };

  return {
    async acquire(hex, load, signal) {
      if (signal.aborted) return null;
      let entry = entries.get(hex);
      if (!entry) {
        entry = { count: 0, url: null, loading: null, timer: null };
        entries.set(hex, entry);
        const created = entry;
        // Through a promise, so a loader that throws synchronously is a miss.
        created.loading = Promise.resolve()
          .then(load)
          .then(
            (blob) => settleLoad(hex, created, blob),
            () => settleLoad(hex, created, null),
          );
      }
      hold(hex, entry, signal);
      const url = entry.url ?? (await entry.loading);
      return signal.aborted ? null : url;
    },

    peek(hex, signal) {
      const entry = entries.get(hex);
      if (signal.aborted || !entry?.url) return null;
      hold(hex, entry, signal);
      return entry.url;
    },

    attach() {
      editors += 1;
      let attached = true;
      return () => {
        if (!attached) return;
        attached = false;
        editors -= 1;
        if (editors > 0) return;
        const all = entries;
        entries = new Map();
        for (const entry of all.values()) {
          if (entry.timer !== null) clock.clearTimeout(entry.timer);
          if (entry.url) urls.revoke(entry.url);
        }
      };
    },
  };
}
