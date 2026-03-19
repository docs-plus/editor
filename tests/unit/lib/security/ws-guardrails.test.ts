import { describe, expect, it } from "vitest";

import { createWsGuardrails } from "@/lib/security/ws-guardrails";

describe("createWsGuardrails", () => {
  it("enforces per-ip websocket connection cap", () => {
    const guardrails = createWsGuardrails({ wsConnectionsPerIp: 2 });
    expect(guardrails.onConnect("1.2.3.4").allowed).toBe(true);
    expect(guardrails.onConnect("1.2.3.4").allowed).toBe(true);

    const denied = guardrails.onConnect("1.2.3.4");
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) {
      expect(denied.reason).toBe("ws_connection_limit_exceeded");
    }

    guardrails.onDisconnect("1.2.3.4");
    expect(guardrails.onConnect("1.2.3.4").allowed).toBe(true);
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
    expect(
      guardrails.canStoreDocument("global-tabs-session", 1000).allowed,
    ).toBe(true);
  });
});
