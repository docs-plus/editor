type RateLimitDecision = {
  allowed: boolean;
  retryAfterSeconds: number;
  remaining: number;
};

type SlidingWindowLimiterOptions = {
  limit: number;
  windowMs: number;
  now?: () => number;
};

export type SlidingWindowLimiter = {
  check(key: string): RateLimitDecision;
};

export function createSlidingWindowLimiter(
  options: SlidingWindowLimiterOptions,
): SlidingWindowLimiter {
  const buckets = new Map<string, number[]>();
  const now = options.now ?? Date.now;

  return {
    check(key: string): RateLimitDecision {
      const current = now();
      const cutoff = current - options.windowMs;
      const existing = buckets.get(key) ?? [];
      const recent = existing.filter((timestamp) => timestamp > cutoff);

      if (recent.length >= options.limit) {
        const oldest = recent[0] ?? current;
        const retryAfterMs = Math.max(options.windowMs - (current - oldest), 0);
        const retryAfterSeconds = Math.max(Math.ceil(retryAfterMs / 1000), 1);
        buckets.set(key, recent);
        return {
          allowed: false,
          retryAfterSeconds,
          remaining: 0,
        };
      }

      recent.push(current);
      buckets.set(key, recent);
      return {
        allowed: true,
        retryAfterSeconds: 0,
        remaining: Math.max(options.limit - recent.length, 0),
      };
    },
  };
}
