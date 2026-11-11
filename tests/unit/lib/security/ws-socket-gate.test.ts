import { describe, expect, it } from "bun:test";

import { createSocketGate } from "@/lib/security/ws-socket-gate";

const base = {
  socketsPerIp: 2,
  maxSockets: 3,
  upgradesPerMinute: 100,
  allowedOrigins: ["https://tiny.docs.plus"],
};

describe("createSocketGate (A04-4, A05-2)", () => {
  it("rejects foreign origins but allows script clients without one", () => {
    const gate = createSocketGate(base);
    expect(gate.admit("1.1.1.1", "https://evil.example")).toMatchObject({
      allowed: false,
      status: 403,
    });
    expect(gate.admit("1.1.1.1", "https://tiny.docs.plus").allowed).toBe(true);
    expect(gate.admit("1.1.1.1", null).allowed).toBe(true);
  });

  it("allows any origin when no allowlist is configured", () => {
    const gate = createSocketGate({ ...base, allowedOrigins: [] });
    expect(gate.admit("1.1.1.1", "https://evil.example").allowed).toBe(true);
  });

  it("caps open sockets per IP and in total, and frees slots on close", () => {
    const gate = createSocketGate(base);
    gate.opened("1.1.1.1");
    gate.opened("1.1.1.1");
    expect(gate.admit("1.1.1.1", null)).toMatchObject({ status: 429 });
    gate.opened("2.2.2.2");
    expect(gate.admit("3.3.3.3", null)).toMatchObject({ status: 503 });
    gate.closed("1.1.1.1");
    expect(gate.admit("1.1.1.1", null).allowed).toBe(true);
    expect(gate.openSockets()).toBe(2);
  });

  it("rate-limits upgrades per IP", () => {
    const gate = createSocketGate({ ...base, upgradesPerMinute: 2 });
    expect(gate.admit("1.1.1.1", null).allowed).toBe(true);
    expect(gate.admit("1.1.1.1", null).allowed).toBe(true);
    expect(gate.admit("1.1.1.1", null)).toMatchObject({
      reason: "ws_upgrade_rate",
    });
  });
});
