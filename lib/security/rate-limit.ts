import { RATE_LIMIT_MAX_KEYS } from "@/lib/security/guardrail-config";

type RateLimitDecision = {
  allowed: boolean;
  retryAfterSeconds: number;
  remaining: number;
};

type SlidingWindowLimiterOptions = {
  limit: number;
  windowMs: number;
  now?: () => number;
  /** Distinct keys tracked before new keys fail closed. */
  maxKeys?: number;
};

export type SlidingWindowLimiter = {
  check(key: string): RateLimitDecision;
  /** Number of tracked keys (for tests and metrics). */
  size(): number;
};

/**
 * Per-key timestamp lists, swept once per window so keys that went quiet do
 * not accumulate. When `maxKeys` distinct keys are live, unseen keys are
 * denied (fail closed) instead of growing memory without bound.
 */
export function createTimestampWindows(
  windowMs: number,
  now: () => number,
  maxKeys: number,
) {
  const windows = new Map<string, number[]>();
  let lastSweep = now();

  function sweep(current: number): void {
    if (current - lastSweep < windowMs) return;
    lastSweep = current;
    const cutoff = current - windowMs;
    for (const [key, timestamps] of windows) {
      if ((timestamps.at(-1) ?? 0) <= cutoff) windows.delete(key);
    }
  }

  return {
    /** Recent timestamps for `key`, or null when the key table is full. */
    recent(key: string): number[] | null {
      const current = now();
      sweep(current);
      const existing = windows.get(key);
      if (!existing && windows.size >= maxKeys) return null;
      const cutoff = current - windowMs;
      const recent = (existing ?? []).filter((t) => t > cutoff);
      windows.set(key, recent);
      return recent;
    },
    size: () => windows.size,
  };
}

export function createSlidingWindowLimiter(
  options: SlidingWindowLimiterOptions,
): SlidingWindowLimiter {
  const now = options.now ?? Date.now;
  const windows = createTimestampWindows(
    options.windowMs,
    now,
    options.maxKeys ?? RATE_LIMIT_MAX_KEYS,
  );

  return {
    check(key: string): RateLimitDecision {
      const current = now();
      const recent = windows.recent(key);
      if (!recent || recent.length >= options.limit) {
        const oldest = recent?.[0] ?? current;
        const retryAfterMs = recent
          ? Math.max(options.windowMs - (current - oldest), 0)
          : options.windowMs;
        return {
          allowed: false,
          retryAfterSeconds: Math.max(Math.ceil(retryAfterMs / 1000), 1),
          remaining: 0,
        };
      }
      recent.push(current);
      return {
        allowed: true,
        retryAfterSeconds: 0,
        remaining: Math.max(options.limit - recent.length, 0),
      };
    },
    size: windows.size,
  };
}
