import { afterEach, describe, expect, it, mock, vi } from "bun:test";

import * as hocuspocusProvider from "@hocuspocus/provider";
import * as Y from "yjs";

import * as serverGate from "@/lib/security/client-schema-gate";
import { SCHEMA_REJECTED } from "@/lib/security/hocus-document-guard";

const created: FakeProvider[] = [];

class FakeProvider {
  isSynced = false;
  attach = vi.fn();
  detach = vi.fn();
  destroy = vi.fn();
  private handlers = new Map<string, Set<(payload: unknown) => void>>();
  constructor() {
    created.push(this);
  }
  on(event: string, handler: (payload: unknown) => void) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)?.add(handler);
  }
  off(event: string, handler: (payload: unknown) => void) {
    this.handlers.get(event)?.delete(handler);
  }
  emit(event: string, payload: unknown) {
    for (const handler of this.handlers.get(event) ?? []) handler(payload);
  }
}

mock.module("@hocuspocus/provider", () => ({
  ...hocuspocusProvider,
  HocuspocusProvider: FakeProvider,
  HocuspocusProviderWebsocket: class {},
}));
// Loaded after the mock: static imports are hoisted above `mock.module`.
const {
  acquireCollabSession,
  CLIENT_OUTDATED_REASON,
  DOCUMENT_DELETED_REASON,
  DOCUMENT_TOO_LARGE_REASON,
  hasUnsyncedCollabChanges,
  OFFLINE_BUDGET_REASON,
  onSynced,
  releaseCollabSession,
  SCHEMA_REJECTED_REASON,
  subscribeUnsyncedChanges,
} = await import("@/lib/collab-session");

const unique = () => `doc-${crypto.randomUUID()}`;

/** The server acknowledged everything: the provider's count reached 0. */
const acknowledge = (provider: FakeProvider) =>
  provider.emit("unsyncedChanges", { number: 0 });

afterEach(() => {
  // Sessions are module state: leave none dirty for the next test.
  for (const provider of created) acknowledge(provider);
  vi.useRealTimers();
  created.length = 0;
});

describe("collab sessions", () => {
  it("reuses a live session when remounted within the release delay", () => {
    vi.useFakeTimers();
    const name = unique();
    const first = acquireCollabSession(name);
    releaseCollabSession(name);
    vi.advanceTimersByTime(500);
    const second = acquireCollabSession(name);
    expect(second.provider).toBe(first.provider);
    expect(created).toHaveLength(1);
    expect(created[0]?.destroy).not.toHaveBeenCalled();
  });

  it("destroys an unused session after the delay", () => {
    vi.useFakeTimers();
    const name = unique();
    acquireCollabSession(name);
    releaseCollabSession(name);
    vi.advanceTimersByTime(1001);
    expect(created[0]?.destroy).toHaveBeenCalledOnce();
    acquireCollabSession(name);
    expect(created).toHaveLength(2);
  });

  it("stops syncing a document the server refused for size", () => {
    const session = acquireCollabSession(unique());
    const provider = created[0] as FakeProvider;
    provider.emit("close", { event: { code: 1000, reason: "" } });
    expect(provider.detach).not.toHaveBeenCalled();

    provider.emit("close", { event: { reason: DOCUMENT_TOO_LARGE_REASON } });
    provider.emit("close", { event: { reason: DOCUMENT_TOO_LARGE_REASON } });
    expect(provider.detach).toHaveBeenCalledOnce();
    expect(session.rejectedReason).toBe(DOCUMENT_TOO_LARGE_REASON);
  });
});

describe("unsynced edits", () => {
  const typeLocally = (doc: Y.Doc, text = "x") =>
    doc.getText("t").insert(0, text);

  it("marks a session dirty on a local edit", () => {
    const session = acquireCollabSession(unique());
    expect(hasUnsyncedCollabChanges()).toBe(false);
    typeLocally(session.doc);
    expect(hasUnsyncedCollabChanges()).toBe(true);
  });

  it("does not mark a session dirty on a remote update", () => {
    const session = acquireCollabSession(unique());
    const other = new Y.Doc();
    other.getText("t").insert(0, "remote");
    Y.applyUpdate(session.doc, Y.encodeStateAsUpdate(other), created[0]);
    expect(session.doc.getText("t").toString()).toBe("remote");
    expect(hasUnsyncedCollabChanges()).toBe(false);
  });

  it("keeps a released session with unsynced edits alive", () => {
    vi.useFakeTimers();
    const name = unique();
    const first = acquireCollabSession(name);
    const provider = created[0] as FakeProvider;
    typeLocally(first.doc);
    releaseCollabSession(name);
    vi.advanceTimersByTime(60_000);
    expect(provider.destroy).not.toHaveBeenCalled();

    const again = acquireCollabSession(name);
    expect(again.doc).toBe(first.doc);
    expect(created).toHaveLength(1);
  });

  it("releases the session once the server acknowledges the edits", () => {
    vi.useFakeTimers();
    const name = unique();
    const session = acquireCollabSession(name);
    const provider = created[0] as FakeProvider;
    typeLocally(session.doc);
    releaseCollabSession(name);
    vi.advanceTimersByTime(1001);

    provider.emit("unsyncedChanges", { number: 2 });
    expect(hasUnsyncedCollabChanges()).toBe(true);
    acknowledge(provider);
    expect(hasUnsyncedCollabChanges()).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(provider.destroy).toHaveBeenCalledOnce();
  });

  it("stops waiting for a document the server refused", () => {
    vi.useFakeTimers();
    const name = unique();
    const session = acquireCollabSession(name);
    const provider = created[0] as FakeProvider;
    typeLocally(session.doc);
    provider.emit("authenticationFailed", { reason: "document_deleted" });
    expect(hasUnsyncedCollabChanges()).toBe(false);
    releaseCollabSession(name);
    vi.advanceTimersByTime(1001);
    expect(provider.destroy).toHaveBeenCalledOnce();
  });

  it("does not keep a document refused for size dirty", () => {
    const session = acquireCollabSession(unique());
    const provider = created[0] as FakeProvider;
    typeLocally(session.doc);
    provider.emit("close", { event: { reason: DOCUMENT_TOO_LARGE_REASON } });
    expect(hasUnsyncedCollabChanges()).toBe(false);
    typeLocally(session.doc);
    expect(hasUnsyncedCollabChanges()).toBe(false);
  });

  it("notifies subscribers once per transition", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeUnsyncedChanges(listener);
    const session = acquireCollabSession(unique());
    const provider = created[0] as FakeProvider;
    typeLocally(session.doc, "a");
    typeLocally(session.doc, "b");
    expect(listener).toHaveBeenCalledTimes(1);
    acknowledge(provider);
    acknowledge(provider);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    typeLocally(session.doc);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("counts a reused session that synced before as synced while offline", () => {
    vi.useFakeTimers();
    const name = unique();
    const session = acquireCollabSession(name);
    const provider = created[0] as FakeProvider;
    provider.isSynced = true;
    provider.emit("synced", { state: true });
    // The provider resets isSynced when the socket closes.
    provider.isSynced = false;
    typeLocally(session.doc);
    releaseCollabSession(name);
    vi.advanceTimersByTime(10_000);

    const handler = vi.fn();
    const stop = onSynced(acquireCollabSession(name), handler);
    expect(handler).toHaveBeenCalledOnce();
    stop();
  });

  it("marks a document deleted while away as refused and stops syncing it", () => {
    const session = acquireCollabSession(unique());
    const provider = created.at(-1) as FakeProvider;
    provider.emit("authenticationFailed", { reason: "rate_limited" });
    expect(session.rejectedReason).toBeNull();

    provider.emit("authenticationFailed", { reason: DOCUMENT_DELETED_REASON });
    expect(session.rejectedReason).toBe(DOCUMENT_DELETED_REASON);
    expect(provider.detach).toHaveBeenCalledOnce();
  });
});

describe("schema refusals", () => {
  it("detaches but keeps the copy when the client is outdated", () => {
    const session = acquireCollabSession(unique());
    const provider = created[0] as FakeProvider;
    provider.emit("authenticationFailed", { reason: CLIENT_OUTDATED_REASON });
    expect(provider.detach).toHaveBeenCalledOnce();
    expect(provider.destroy).not.toHaveBeenCalled();
    expect(session.rejectedReason).toBe(CLIENT_OUTDATED_REASON);
    session.doc.getText("t").insert(0, "x");
    expect(hasUnsyncedCollabChanges()).toBe(false);
  });

  it("stops syncing after a schema_rejected close", () => {
    const session = acquireCollabSession(unique());
    const provider = created[0] as FakeProvider;
    session.doc.getText("t").insert(0, "x");
    provider.emit("close", {
      event: { code: SCHEMA_REJECTED.code, reason: SCHEMA_REJECTED_REASON },
    });
    provider.emit("close", {
      event: { code: SCHEMA_REJECTED.code, reason: SCHEMA_REJECTED_REASON },
    });
    expect(provider.detach).toHaveBeenCalledOnce();
    expect(provider.destroy).not.toHaveBeenCalled();
    expect(session.rejectedReason).toBe(SCHEMA_REJECTED_REASON);
    expect(hasUnsyncedCollabChanges()).toBe(false);
  });

  it("stops syncing after a schema_rejected close while paused offline", () => {
    const session = acquireCollabSession(unique());
    const provider = created[0] as FakeProvider;
    session.doc.getText("t").insert(0, "x".repeat(600 * 1024));
    expect(session.rejectedReason).toBe(OFFLINE_BUDGET_REASON);
    provider.emit("close", { event: { reason: SCHEMA_REJECTED_REASON } });
    expect(provider.detach).toHaveBeenCalledOnce();
    expect(session.rejectedReason).toBe(SCHEMA_REJECTED_REASON);
  });

  it("shares reason strings with the server", () => {
    expect(CLIENT_OUTDATED_REASON).toBe(serverGate.CLIENT_OUTDATED_REASON);
    expect(SCHEMA_REJECTED_REASON).toBe(SCHEMA_REJECTED.reason);
  });
});
