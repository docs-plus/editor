import { afterEach, describe, expect, it, mock, vi } from "bun:test";

import * as hocuspocusProvider from "@hocuspocus/provider";
import { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";

const created: FakeProvider[] = [];

/** The provider surface collab-session and the adapter touch. */
class FakeProvider {
  isSynced = false;
  awareness: Awareness;
  attach = vi.fn();
  detach = vi.fn();
  destroy = vi.fn();
  private handlers = new Map<string, Set<(payload: unknown) => void>>();
  constructor({ document }: { document: Y.Doc }) {
    this.awareness = new Awareness(document);
    created.push(this);
  }
  on(event: string, handler: (payload: unknown) => void) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)?.add(handler);
  }
  off(event: string, handler: (payload: unknown) => void) {
    this.handlers.get(event)?.delete(handler);
  }
  emit(event: string, payload?: unknown) {
    for (const handler of this.handlers.get(event) ?? []) handler(payload);
  }
  listenerCount(event: string) {
    return this.handlers.get(event)?.size ?? 0;
  }
}

mock.module("@hocuspocus/provider", () => ({
  ...hocuspocusProvider,
  HocuspocusProvider: FakeProvider,
  HocuspocusProviderWebsocket: class {},
}));
// Loaded after the mock: static imports are hoisted above `mock.module`.
const { sandboxDocSession } = await import(
  "@/lib/platform/web/sandbox-doc-session"
);

const unique = () => `doc-${crypto.randomUUID()}`;
const lastProvider = () => created.at(-1) as FakeProvider;

afterEach(() => {
  // Sessions are collab-session module state: leave none dirty.
  for (const provider of created) {
    provider.emit("unsyncedChanges", { number: 0 });
  }
  vi.useRealTimers();
  created.length = 0;
});

describe("sandbox DocSession adapter", () => {
  it("opens a collab session and exposes its doc, awareness and provider", () => {
    const handle = sandboxDocSession.open(unique());
    const provider = lastProvider();
    expect(handle.provider as unknown).toBe(provider);
    expect(handle.awareness).toBe(provider.awareness);
    expect(handle.awareness.doc).toBe(handle.doc);
    expect(handle.getState()).toEqual({
      ready: false,
      authoritative: false,
      readOnlyReason: null,
      error: null,
    });
    handle.release();
  });

  it("becomes ready and authoritative once the server synced", () => {
    const handle = sandboxDocSession.open(unique());
    const provider = lastProvider();
    let calls = 0;
    const unsubscribe = handle.subscribe(() => calls++);
    provider.isSynced = true;
    provider.emit("synced");
    expect(calls).toBeGreaterThan(0);
    expect(handle.getState()).toMatchObject({
      ready: true,
      authoritative: true,
    });
    // A disconnect resets the provider; the session stays authoritative.
    provider.isSynced = false;
    expect(handle.getState()).toMatchObject({
      ready: true,
      authoritative: true,
    });
    unsubscribe();
    expect(provider.listenerCount("synced")).toBe(1); // collab-session's own
    handle.release();
  });

  it("keeps the same state object until something changes", () => {
    const handle = sandboxDocSession.open(unique());
    const first = handle.getState();
    expect(handle.getState()).toBe(first);
    lastProvider().emit("synced");
    const second = handle.getState();
    expect(second).not.toBe(first);
    expect(handle.getState()).toBe(second);
    handle.release();
  });

  it("passes collab-session's refusal through as readOnlyReason", () => {
    const handle = sandboxDocSession.open(unique());
    let calls = 0;
    handle.subscribe(() => calls++);
    lastProvider().emit("authenticationFailed", { reason: "document_deleted" });
    expect(calls).toBe(1);
    expect(handle.getState().readOnlyReason).toBe("document_deleted");
    handle.release();
  });

  it("shares one session between opens and releases it after the last", () => {
    vi.useFakeTimers();
    const name = unique();
    const first = sandboxDocSession.open(name);
    const second = sandboxDocSession.open(name);
    expect(second.doc).toBe(first.doc);
    expect(created).toHaveLength(1);
    first.release();
    vi.advanceTimersByTime(2000);
    expect(lastProvider().destroy).not.toHaveBeenCalled();
    second.release();
    vi.advanceTimersByTime(2000);
    expect(lastProvider().destroy).toHaveBeenCalledTimes(1);
  });

  it("works as an unbound release, the way the hook calls it", () => {
    vi.useFakeTimers();
    const { release } = sandboxDocSession.open(unique());
    release();
    vi.advanceTimersByTime(2000);
    expect(lastProvider().destroy).toHaveBeenCalledTimes(1);
  });

  it("flushes the device copies", async () => {
    const handle = sandboxDocSession.open(unique());
    await expect(sandboxDocSession.flush()).resolves.toBeUndefined();
    await expect(handle.flush()).resolves.toBeUndefined();
    handle.release();
  });
});
