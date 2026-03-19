import { describe, expect, it } from "vitest";

import { getClientIpFromHeaders } from "@/lib/security/client-ip";

describe("getClientIpFromHeaders", () => {
  it("prefers x-real-ip when present alongside x-forwarded-for", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.10, 10.0.0.1",
      "x-real-ip": "198.51.100.5",
    });
    expect(getClientIpFromHeaders(headers)).toBe("198.51.100.5");
  });

  it("uses x-real-ip alone", () => {
    const headers = new Headers({ "x-real-ip": "198.51.100.5" });
    expect(getClientIpFromHeaders(headers)).toBe("198.51.100.5");
  });

  it("returns unknown when ip headers are absent", () => {
    expect(getClientIpFromHeaders(new Headers())).toBe("unknown");
  });
});
