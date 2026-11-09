import { describe, expect, it } from "vitest";

import { createWsGuardrails } from "@/lib/security/ws-guardrails";

describe("createWsGuardrails", () => {
  it("enforces per-ip websocket connection cap", () => {
    const guardrails = createWsGuardrails({ wsConnectionsPerIp: 2 });
    const connect = (ip: string) => {
      const decision = guardrails.canConnect(ip);
      if (decision.allowed) guardrails.onConnected(ip);
      return decision;
    };
    expect(connect("1.2.3.4").allowed).toBe(true);
    expect(connect("1.2.3.4").allowed).toBe(true);

    const denied = connect("1.2.3.4");
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) {
      expect(denied.reason).toBe("ws_connection_limit_exceeded");
    }

    guardrails.onDisconnect("1.2.3.4");
    expect(connect("1.2.3.4").allowed).toBe(true);
  });

  it("does not count attempts that never become connections (A04-3)", () => {
    const guardrails = createWsGuardrails({ wsConnectionsPerIp: 2 });
    // Ten auth attempts whose document load fails: checked, never connected.
    for (let i = 0; i < 10; i++) {
      expect(guardrails.canConnect("1.2.3.4").allowed).toBe(true);
    }
    expect(guardrails.canConnect("1.2.3.4").allowed).toBe(true);
  });

  it("stops tracking creation keys once their window passes", () => {
    let now = 0;
    const guardrails = createWsGuardrails({
      docCreationPerHour: 5,
      maxKeys: 3,
      now: () => now,
    });
    for (const ip of ["a", "b", "c"]) {
      expect(guardrails.canCreateDocument(ip, 0).allowed).toBe(true);
    }
    // Key table full: a new key fails closed instead of growing memory.
    expect(guardrails.canCreateDocument("d", 0).allowed).toBe(false);
    now += 60 * 60 * 1000 + 1;
    expect(guardrails.canCreateDocument("d", 0).allowed).toBe(true);
  });

  it("enforces doc creation per hour and total document cap", () => {
    let now = 1000;
    const guardrails = createWsGuardrails({
      maxTotalDocuments: 2,
      docCreationPerHour: 1,
      now: () => now,
    });

    expect(guardrails.canCreateDocument("1.2.3.4", 1).allowed).toBe(true);

    const deniedByRate = guardrails.canCreateDocument("1.2.3.4", 1);
    expect(deniedByRate.allowed).toBe(false);
    if (!deniedByRate.allowed) {
      expect(deniedByRate.reason).toBe("doc_creation_rate_limit_exceeded");
    }

    now += 60 * 60 * 1000 + 1;
    const deniedByTotal = guardrails.canCreateDocument("1.2.3.4", 2);
    expect(deniedByTotal.allowed).toBe(false);
    if (!deniedByTotal.allowed) {
      expect(deniedByTotal.reason).toBe("max_total_documents_exceeded");
    }
  });

  it("enforces document payload size for non-system docs", () => {
    const guardrails = createWsGuardrails({ maxDocSizeBytes: 10 });

    const denied = guardrails.canStoreDocument(
      "11111111-1111-1111-1111-111111111111",
      11,
    );
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) {
      expect(denied.reason).toBe("max_document_size_exceeded");
    }

    expect(guardrails.canStoreDocument("global-tabs", 1000).allowed).toBe(true);
  });

  it("caps shared system documents too (SEC-01)", () => {
    const guardrails = createWsGuardrails({
      maxDocSizeBytes: 100,
      maxPlaygroundDocSizeBytes: 200,
      maxTabsDocSizeBytes: 50,
    });
    expect(guardrails.canStoreDocument("global-tabs", 50).allowed).toBe(true);
    expect(guardrails.canStoreDocument("global-tabs", 51).allowed).toBe(false);
    expect(guardrails.canStoreDocument("playground", 200).allowed).toBe(true);
    expect(guardrails.canStoreDocument("playground", 201).allowed).toBe(false);
    // Without the isolation flag a `global-tabs-*` name is an ordinary doc.
    expect(guardrails.maxDocumentBytes("global-tabs-session")).toBe(100);
  });
});
