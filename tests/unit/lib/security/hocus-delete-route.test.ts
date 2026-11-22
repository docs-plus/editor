import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";

import { createHocusDeleteRoute } from "@/lib/security/hocus-delete-route";
import { createSlidingWindowLimiter } from "@/lib/security/rate-limit";
import { createShareDb } from "@/tests/helpers/share-db";

const IP = "203.0.113.30";

function del(id: string) {
  return new Request(`http://hocus.test/api/documents/${id}`, {
    method: "DELETE",
  });
}

describe("Hocus DELETE /api/documents/:id (P4.1)", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("rate-limits per IP with Retry-After, like the Next.js route", async () => {
    const route = createHocusDeleteRoute({
      db: createShareDb(),
      limiter: createSlidingWindowLimiter({ limit: 1, windowMs: 60_000 }),
    });
    expect((await route.handle(del(crypto.randomUUID()), IP)).status).toBe(200);
    const limited = await route.handle(del(crypto.randomUUID()), IP);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
    expect(await limited.json()).toMatchObject({
      error: "Rate limit exceeded",
    });
  });

  it("refuses nested paths and undecodable ids", async () => {
    const route = createHocusDeleteRoute({ db: createShareDb() });
    for (const id of ["a/b", "%E0%A4%A", ""]) {
      expect((await route.handle(del(id), IP)).status).toBe(400);
    }
  });
});
