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

  it("forgets quiet keys and fails closed when the key table is full (A04-6)", () => {
    let now = 0;
    const limiter = createSlidingWindowLimiter({
      limit: 5,
      windowMs: 1000,
      now: () => now,
      maxKeys: 100,
    });
    for (let i = 0; i < 100; i++) limiter.check(`ip-${i}`);
    expect(limiter.size()).toBe(100);
    expect(limiter.check("new-ip").allowed).toBe(false);

    now = 1001;
    expect(limiter.check("new-ip").allowed).toBe(true);
    expect(limiter.size()).toBe(1);
  });
});
