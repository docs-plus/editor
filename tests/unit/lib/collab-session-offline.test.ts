import { afterAll, afterEach, describe, expect, it, mock, vi } from "bun:test";

import * as hocuspocusProvider from "@hocuspocus/provider";
import * as Y from "yjs";

import * as offline from "@/lib/offline";
import { LegacyLocalDocStore } from "@/tests/fixtures/legacy-local-doc-store";

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

const HOST = "ws.example";
const NOW = () => 1_000_000;

/**
 * Memory backend whose `~s2` puts wait until `open()`, so a legacy merge
 * stays in flight while the session releases.
 */
function gatedBackend() {
  const memory = offline.createMemoryBackend();
  const gate = Promise.withResolvers<void>();
  const backend: offline.DocStoreBackend = {
    ...memory,
    put: async (doc) => {
      if (doc.key.includes("~s2:")) await gate.promise;
      await memory.put(doc);
    },
  };
  return { backend, memory, open: () => gate.resolve() };
}

let store: offline.LocalDocStore | null = null;
// Copied: `mock.module` patches the real namespace in place. Other files
// in this process keep the real store while `store` is null.
const real = { ...offline };
mock.module("@/lib/offline", () => ({
  ...real,
  getLocalDocStore: () => store ?? real.getLocalDocStore(),
  removeLocalCopy: (name: string) =>
    store
      ? void store.remove(name).catch(() => {})
      : real.removeLocalCopy(name),
}));
mock.module("@hocuspocus/provider", () => ({
  ...hocuspocusProvider,
  HocuspocusProvider: FakeProvider,
  HocuspocusProviderWebsocket: class {},
}));
// Loaded after the mocks: static imports are hoisted above `mock.module`.
const {
  acquireCollabSession,
  DOCUMENT_DELETED_REASON,
  forgetLocalCopy,
  liveSessionNames,
  releaseCollabSession,
} = await import("@/lib/collab-session");

const unique = () => `doc-${crypto.randomUUID()}`;

/** Lets the memory backend's promise chains run (timers are fake). */
async function settle(): Promise<void> {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

/** An update from the server: not an edit, but it schedules a save. */
function receive(
  session: { doc: Y.Doc },
  provider: FakeProvider,
  text: string,
) {
  const other = new Y.Doc();
  other.getText("t").insert(0, text);
  Y.applyUpdate(session.doc, Y.encodeStateAsUpdate(other), provider);
}

async function storedText(
  backend: offline.DocStoreBackend,
  name: string,
): Promise<string | null> {
  const copy = await backend.get(offline.storeKey(HOST, name));
  if (!copy) return null;
  const doc = new Y.Doc();
  Y.applyUpdate(doc, copy.update);
  return doc.getText("t").toString();
}

/**
 * Seeds a legacy copy (its merge save stays gated), opens the session,
 * receives an update shortly before the release delay ends, and runs the
 * release: the session leaves the map with its flush still waiting.
 */
async function releaseMidMerge() {
  const { backend, memory, open } = gatedBackend();
  store = new offline.LocalDocStore(backend, HOST, NOW);
  const name = unique();
  const legacy = new Y.Doc();
  legacy.getText("t").insert(0, "pre-N offline edit");
  await new LegacyLocalDocStore(memory, HOST, NOW).save(
    name,
    Y.encodeStateAsUpdate(legacy),
  );
  vi.useFakeTimers();
  const session = acquireCollabSession(name);
  const provider = created.at(-1) as FakeProvider;
  await settle();
  expect(provider.attach).toHaveBeenCalledOnce();
  expect(session.doc.getText("t").toString()).toBe("pre-N offline edit");

  releaseCollabSession(name);
  vi.advanceTimersByTime(900);
  receive(session, provider, "late update");
  vi.advanceTimersByTime(200);
  expect(provider.destroy).toHaveBeenCalledOnce();
  expect(liveSessionNames().has(name)).toBe(false);
  return { backend, memory, name, open };
}

async function drain(open: () => void): Promise<void> {
  open();
  await settle();
  vi.advanceTimersByTime(5000);
  await settle();
}

afterEach(() => {
  for (const provider of created) {
    provider.emit("unsyncedChanges", { number: 0 });
  }
  vi.useRealTimers();
  created.length = 0;
  store = null;
});

afterAll(() => {
  store = null;
});

describe("offline copy of a releasing session", () => {
  it("leaves no copy when the tab closes while the session releases", async () => {
    const { memory, name, open } = await releaseMidMerge();
    forgetLocalCopy(name);
    await drain(open);
    expect(await memory.all()).toEqual([]);
  });

  it("leaves no copy when the reopened document is deleted", async () => {
    const { memory, name, open } = await releaseMidMerge();
    acquireCollabSession(name);
    const reopened = created.at(-1) as FakeProvider;
    await settle();
    reopened.emit("authenticationFailed", { reason: DOCUMENT_DELETED_REASON });
    await drain(open);
    expect(await memory.all()).toEqual([]);
  });

  it("still saves unsynced edits and late updates on release", async () => {
    const { backend, open } = gatedBackend();
    open();
    store = new offline.LocalDocStore(backend, HOST, NOW);
    const name = unique();
    vi.useFakeTimers();
    const session = acquireCollabSession(name);
    const provider = created.at(-1) as FakeProvider;
    await settle();
    session.doc.getText("t").insert(0, "typed offline ");

    releaseCollabSession(name);
    vi.advanceTimersByTime(1001);
    expect(liveSessionNames().has(name)).toBe(true); // unsynced: kept alive
    provider.emit("unsyncedChanges", { number: 0 });
    vi.advanceTimersByTime(4500);
    receive(session, provider, "late update");
    vi.advanceTimersByTime(500); // the dirty recheck releases it
    expect(provider.destroy).toHaveBeenCalledOnce();
    await settle();

    const text = await storedText(backend, name);
    expect(text).toContain("typed offline");
    expect(text).toContain("late update");
  });
});
