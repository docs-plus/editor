import type { IncomingHttpHeaders } from "node:http";

import { describe, expect, it } from "vitest";

import {
  getClientIpFromHeaders,
  getPinnedClientIp,
  pinClientIp,
  UNKNOWN_CLIENT_IP,
} from "@/lib/security/client-ip";

const untrusted = { trustedProxy: false, nodeEnv: "production" };
const trusted = { trustedProxy: true, nodeEnv: "production" };

const spoofed = {
  "x-forwarded-for": "203.0.113.66",
  "x-real-ip": "203.0.113.77",
};

describe("getClientIpFromHeaders (HTTP, no socket address)", () => {
  describe("without a trusted proxy", () => {
    it("ignores client-supplied forwarding headers", () => {
      expect(getClientIpFromHeaders(new Headers(spoofed), untrusted)).toBe(
        UNKNOWN_CLIENT_IP,
      );
    });

    it("maps rotating spoofed headers to the same shared key", () => {
      const keys = ["198.51.100.1", "198.51.100.2", "198.51.100.3"].map((ip) =>
        getClientIpFromHeaders(
          new Headers({ "x-forwarded-for": ip, "x-real-ip": ip }),
          untrusted,
        ),
      );
      expect(new Set(keys)).toEqual(new Set([UNKNOWN_CLIENT_IP]));
    });

    it("defaults to untrusted when TRUSTED_PROXY is unset", () => {
      expect(
        getClientIpFromHeaders(new Headers(spoofed), { nodeEnv: "production" }),
      ).toBe(UNKNOWN_CLIENT_IP);
    });
  });

  describe("behind a trusted proxy", () => {
    it("uses the rightmost x-forwarded-for entry, which the proxy appended", () => {
      const headers = new Headers({
        "x-forwarded-for": "198.51.100.99, 203.0.113.10",
      });
      expect(getClientIpFromHeaders(headers, trusted)).toBe("203.0.113.10");
    });

    it("prefers x-forwarded-for over x-real-ip", () => {
      const headers = new Headers({
        "x-forwarded-for": "203.0.113.10",
        "x-real-ip": "198.51.100.5",
      });
      expect(getClientIpFromHeaders(headers, trusted)).toBe("203.0.113.10");
    });

    it("falls back to x-real-ip when x-forwarded-for is absent", () => {
      const headers = new Headers({ "x-real-ip": " 198.51.100.5 " });
      expect(getClientIpFromHeaders(headers, trusted)).toBe("198.51.100.5");
    });

    it("returns unknown when no forwarding header is present", () => {
      expect(getClientIpFromHeaders(new Headers(), trusted)).toBe(
        UNKNOWN_CLIENT_IP,
      );
    });

    it.each([
      ["a non-IP value", "not-an-ip"],
      ["an address with a port", "203.0.113.10:4711"],
      ["a private address outside development", "10.0.0.7"],
    ])("returns unknown for %s", (_label, value) => {
      const headers = new Headers({ "x-forwarded-for": value });
      expect(getClientIpFromHeaders(headers, trusted)).toBe(UNKNOWN_CLIENT_IP);
    });

    it("keeps private addresses in development", () => {
      const headers = new Headers({ "x-forwarded-for": "10.0.0.7" });
      expect(
        getClientIpFromHeaders(headers, {
          trustedProxy: true,
          nodeEnv: "development",
        }),
      ).toBe("10.0.0.7");
    });

    it("accepts IPv6 addresses", () => {
      const headers = new Headers({ "x-forwarded-for": "2001:db8::1" });
      expect(getClientIpFromHeaders(headers, trusted)).toBe("2001:db8::1");
    });
  });
});

describe("pinClientIp (WebSocket upgrade)", () => {
  describe("without a trusted proxy", () => {
    it("replaces spoofed headers with the socket address", () => {
      const headers: IncomingHttpHeaders = { ...spoofed };
      expect(pinClientIp(headers, "198.51.100.20", untrusted)).toBe(
        "198.51.100.20",
      );
      expect(headers).toEqual({ "x-real-ip": "198.51.100.20" });
    });

    it("unwraps IPv4-mapped IPv6 socket addresses", () => {
      const headers: IncomingHttpHeaders = {};
      expect(pinClientIp(headers, "::ffff:198.51.100.20", untrusted)).toBe(
        "198.51.100.20",
      );
    });

    it("treats a private socket address as unknown outside development", () => {
      const headers: IncomingHttpHeaders = { ...spoofed };
      expect(pinClientIp(headers, "::ffff:127.0.0.1", untrusted)).toBe(
        UNKNOWN_CLIENT_IP,
      );
      expect(headers["x-real-ip"]).toBe(UNKNOWN_CLIENT_IP);
    });

    it("keeps a loopback socket address in development", () => {
      const headers: IncomingHttpHeaders = {};
      expect(
        pinClientIp(headers, "127.0.0.1", {
          trustedProxy: false,
          nodeEnv: "development",
        }),
      ).toBe("127.0.0.1");
    });

    it("returns unknown when the socket address is missing", () => {
      const headers: IncomingHttpHeaders = { ...spoofed };
      expect(pinClientIp(headers, undefined, untrusted)).toBe(
        UNKNOWN_CLIENT_IP,
      );
    });
  });

  describe("behind a trusted proxy", () => {
    it("pins the proxy-appended address and drops x-forwarded-for", () => {
      const headers: IncomingHttpHeaders = {
        "x-forwarded-for": "198.51.100.99, 203.0.113.10",
        "x-real-ip": "198.51.100.5",
      };
      expect(pinClientIp(headers, "10.0.0.2", trusted)).toBe("203.0.113.10");
      expect(headers).toEqual({ "x-real-ip": "203.0.113.10" });
    });

    it("falls back to the socket address when the proxy sent no header", () => {
      const headers: IncomingHttpHeaders = {};
      expect(pinClientIp(headers, "203.0.113.30", trusted)).toBe(
        "203.0.113.30",
      );
    });
  });
});

describe("getPinnedClientIp", () => {
  it("reads the address pinned at upgrade", () => {
    const headers: IncomingHttpHeaders = { ...spoofed };
    pinClientIp(headers, "198.51.100.20", untrusted);
    expect(getPinnedClientIp(headers)).toBe("198.51.100.20");
  });

  it("returns unknown when nothing was pinned", () => {
    expect(getPinnedClientIp({})).toBe(UNKNOWN_CLIENT_IP);
  });
});
