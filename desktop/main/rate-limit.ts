/**
 * A fixed-window rate limiter per key (SEC-005 deep-link windows, SEC-010
 * CSP reports). Pure: the clock is injected.
 *
 * `take(key)` answers `"ok"` while the key is under `limit` in the current
 * window, then `"first_drop"` once (log one summary there) and `"dropped"`
 * for the rest of that window.
 */
export type TakeResult = "ok" | "first_drop" | "dropped";

type Bucket = { start: number; count: number };

export class FixedWindowLimiter {
  private readonly buckets = new Map<string | number, Bucket>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  take(key: string | number): TakeResult {
    const now = this.now();
    let bucket = this.buckets.get(key);
    if (!bucket || now - bucket.start >= this.windowMs) {
      bucket = { start: now, count: 0 };
      this.buckets.set(key, bucket);
      this.prune(now);
    }
    bucket.count++;
    if (bucket.count <= this.limit) return "ok";
    return bucket.count === this.limit + 1 ? "first_drop" : "dropped";
  }

  /** The key is gone (a window closed). */
  forget(key: string | number): void {
    this.buckets.delete(key);
  }

  /** Keys idle for two windows are dropped, so the map stays small. */
  private prune(now: number): void {
    for (const [key, bucket] of this.buckets)
      if (now - bucket.start >= this.windowMs * 2) this.buckets.delete(key);
  }
}
