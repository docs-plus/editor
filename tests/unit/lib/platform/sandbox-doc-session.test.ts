import { describe, expect, it } from "bun:test";

import type { HocuspocusProvider } from "@hocuspocus/provider";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

import type { CollabSession } from "@/lib/collab-session";
import {
  type CollabSessionApi,
  createSandboxDocSession,
} from "@/lib/platform/web/sandbox-doc-session";

/** A provider with only what the adapter touches. */
class FakeProvider {
  isSynced = false;
  awareness: Awareness;
  private handlers = new Map<string, Set<() => void>>();
  constructor(doc: Y.Doc) {
    this.awareness = new Awareness(doc);
  }
  on(event: string, handler: () => void) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)?.add(handler);
  }
  off(event: string, handler: () => void) {
    this.handlers.get(event)?.delete(handler);
  }
  emit(event: string) {
    for (const handler of this.handlers.get(event) ?? []) handler();
  }
  listenerCount(event: string) {
    return this.handlers.get(event)?.size ?? 0;
  }
}

type FakeSession = CollabSession & {
  fake: FakeProvider;
  listeners: Set<() => void>;
};

/** A stand-in for `lib/collab-session`, counting acquires and releases. */
function fakeCollab() {
  const sessions = new Map<string, FakeSession>();
  const calls = { acquire: 0, release: [] as string[], flushAll: 0 };
  const api: CollabSessionApi = {
    acquire(name) {
      calls.acquire++;
      let session = sessions.get(name);
      if (!session) {
        const doc = new Y.Doc();
        const fake = new FakeProvider(doc);
        session = {
          doc,
          provider: fake as unknown as HocuspocusProvider,
          rejectedReason: null,
          hasLocalCopy: false,
          hasSynced: false,
          fake,
          listeners: new Set(),
        };
        sessions.set(name, session);
      }
      return session;
    },
    release(name) {
      calls.release.push(name);
    },
    isReady: (session) =>
      session.provider.isSynced || session.hasSynced || session.hasLocalCopy,
    subscribe(session, listener) {
      const { listeners } = session as FakeSession;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async flushAll() {
      calls.flushAll++;
    },
  };
  const notify = (name: string) => {
    for (const listener of sessions.get(name)?.listeners ?? []) listener();
  };
  return { api, calls, session: (name: string) => sessions.get(name), notify };
}

describe("sandbox DocSession adapter", () => {
  it("opens a collab session and exposes its doc, awareness and provider", () => {
    const collab = fakeCollab();
    const handle = createSandboxDocSession(collab.api).open("doc");
    const session = collab.session("doc");
    expect(collab.calls.acquire).toBe(1);
    expect(handle.docId).toBe("doc");
    expect(handle.doc).toBe(session?.doc as Y.Doc);
    expect(handle.provider).toBe(session?.provider as HocuspocusProvider);
    expect(handle.awareness).toBe(session?.fake.awareness as Awareness);
    expect(handle.getState()).toEqual({
      ready: false,
      authoritative: false,
      readOnlyReason: null,
      error: null,
    });
  });

  it("is ready from the device copy, authoritative only once the server synced", () => {
    const collab = fakeCollab();
    const handle = createSandboxDocSession(collab.api).open("doc");
    const session = collab.session("doc") as FakeSession;
    session.hasLocalCopy = true;
    expect(handle.getState()).toMatchObject({
      ready: true,
      authoritative: false,
    });
    session.fake.isSynced = true;
    expect(handle.getState()).toMatchObject({
      ready: true,
      authoritative: true,
    });
  });

  it("stays authoritative after a disconnect resets the provider", () => {
    const collab = fakeCollab();
    const handle = createSandboxDocSession(collab.api).open("doc");
    const session = collab.session("doc") as FakeSession;
    session.hasSynced = true;
    session.fake.isSynced = false;
    expect(handle.getState()).toMatchObject({
      ready: true,
      authoritative: true,
    });
  });

  it("passes the sandbox refusal through as readOnlyReason", () => {
    const collab = fakeCollab();
    const handle = createSandboxDocSession(collab.api).open("doc");
    const session = collab.session("doc") as FakeSession;
    session.rejectedReason = "document_too_large";
    expect(handle.getState().readOnlyReason).toBe("document_too_large");
  });

  it("keeps the same state object until something changes", () => {
    const collab = fakeCollab();
    const handle = createSandboxDocSession(collab.api).open("doc");
    const first = handle.getState();
    expect(handle.getState()).toBe(first);
    (collab.session("doc") as FakeSession).hasSynced = true;
    const second = handle.getState();
    expect(second).not.toBe(first);
    expect(handle.getState()).toBe(second);
  });

  it("notifies subscribers on session changes and provider syncs", () => {
    const collab = fakeCollab();
    const handle = createSandboxDocSession(collab.api).open("doc");
    const session = collab.session("doc") as FakeSession;
    let calls = 0;
    const unsubscribe = handle.subscribe(() => calls++);
    collab.notify("doc");
    session.fake.emit("synced");
    expect(calls).toBe(2);
    unsubscribe();
    collab.notify("doc");
    session.fake.emit("synced");
    expect(calls).toBe(2);
    expect(session.fake.listenerCount("synced")).toBe(0);
  });

  it("releases the collab session once, however often release is called", () => {
    const collab = fakeCollab();
    const handle = createSandboxDocSession(collab.api).open("doc");
    handle.release();
    handle.release();
    expect(collab.calls.release).toEqual(["doc"]);
  });

  it("gives each open its own release", () => {
    const collab = fakeCollab();
    const docSession = createSandboxDocSession(collab.api);
    const first = docSession.open("doc");
    const second = docSession.open("doc");
    expect(second.doc).toBe(first.doc);
    first.release();
    second.release();
    expect(collab.calls.release).toEqual(["doc", "doc"]);
  });

  it("flushes the device copies", async () => {
    const collab = fakeCollab();
    const docSession = createSandboxDocSession(collab.api);
    await docSession.flush();
    await docSession.open("doc").flush();
    expect(collab.calls.flushAll).toBe(2);
  });
});
