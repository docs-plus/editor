import { describe, expect, it } from "vitest";

import { createSlidingWindowLimiter } from "@/lib/security/rate-limit";

describe("createSlidingWindowLimiter", () => {
  it("allows up to the limit, then throttles", () => {
    const now = 1_000;
    const limiter = createSlidingWindowLimiter({
      limit: 2,
      windowMs: 1_000,
      now: () => now,
    });

    expect(limiter.check("ip-a").allowed).toBe(true);
    expect(limiter.check("ip-a").allowed).toBe(true);

    const blocked = limiter.check("ip-a");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("resets allowance after window passes", () => {
    let now = 1_000;
    const limiter = createSlidingWindowLimiter({
      limit: 1,
      windowMs: 1_000,
      now: () => now,
    });

    expect(limiter.check("ip-a").allowed).toBe(true);
    expect(limiter.check("ip-a").allowed).toBe(false);

    now = 2_100;
    expect(limiter.check("ip-a").allowed).toBe(true);
  });
});
