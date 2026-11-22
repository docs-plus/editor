import { beforeEach, describe, expect, it } from "bun:test";

import * as Y from "yjs";

import { COMMENT_ORIGIN, COMMENTS_ROOT } from "@/lib/comments/model";
import { BATCH_IDLE_MS } from "@/lib/platform/batcher";
import { MIGRATION_ORIGIN, STORAGE_ORIGIN } from "@/lib/platform/doc-session";
import type {
  AppendRecord,
  CompactResult,
  DocStore,
} from "@/lib/platform/doc-store";
import {
  createLocalSession,
  type LocalSessionOptions,
  RELEASE_DELAY_MS,
} from "@/lib/platform/local-session";
import {
  MemoryDocLibrary,
  MemoryDocStore,
} from "@/lib/platform/memory-doc-store";
import { FakeClock, settle } from "@/tests/helpers/platform-fakes";

const DOC = "doc";

let clock: FakeClock;
let library: MemoryDocLibrary;

beforeEach(() => {
  clock = new FakeClock();
  library = new MemoryDocLibrary();
});

/** A store that records appends and closes around a memory store. */
class SpyStore implements DocStore {
  readonly appends: AppendRecord[] = [];
  readonly closed: string[] = [];
  compactions = 0;
  foreign: Uint8Array | null = null;

  constructor(readonly inner: DocStore) {}

  load(docId: string) {
    return this.inner.load(docId);
  }
  async append(docId: string, record: AppendRecord) {
    const seq = await this.inner.append(docId, record);
    this.appends.push(record);
    return seq;
  }
  async compact(
    docId: string,
    state: Uint8Array,
    upToSeq: number,
  ): Promise<CompactResult> {
    this.compactions++;
    await this.inner.compact(docId, state, upToSeq);
    return { foreign: this.foreign };
  }
  async close(docId: string) {
    this.closed.push(docId);
    await this.inner.close(docId);
  }
  flush() {
    return this.inner.flush();
  }
}

function makeSession(
  options: Partial<LocalSessionOptions> & { store?: DocStore } = {},
) {
  const store =
    (options.store as SpyStore | undefined) ??
    new SpyStore(new MemoryDocStore({ library }));
  const session = createLocalSession({
    clock,
    scheduleIdle: (fn) => clock.setTimeout(fn, 0),
    ...options,
    store,
  });
  return { session, store: store as SpyStore };
}

/** Seeds the library with `text` as one stored update row. */
async function seed(text: string, schema = 0): Promise<void> {
  library.createDoc(DOC, schema);
  const writer = new MemoryDocStore({ library });
  await writer.load(DOC);
  const doc = new Y.Doc();
  doc.getText("t").insert(0, text);
  await writer.append(DOC, {
    origin: "local",
    update: Y.encodeStateAsUpdate(doc),
  });
  await writer.close(DOC);
}

function textIn(loaded: {
  snapshot: Uint8Array | null;
  updates: Uint8Array[];
}) {
  const doc = new Y.Doc();
  if (loaded.snapshot) Y.applyUpdate(doc, loaded.snapshot);
  for (const update of loaded.updates) Y.applyUpdate(doc, update);
  return doc.getText("t").toString();
}

describe("local-session open", () => {
  it("returns at once, then becomes ready and authoritative after hydrate", async () => {
    await seed("stored");
    const { session } = makeSession();
    const handle = session.open(DOC);
    expect(handle.getState()).toEqual({
      ready: false,
      authoritative: false,
      readOnlyReason: null,
      error: null,
    });
    expect(handle.provider).toBeNull();

    let notified = 0;
    handle.subscribe(() => notified++);
    await settle();
    expect(handle.getState()).toMatchObject({
      ready: true,
      authoritative: true,
      readOnlyReason: null,
    });
    expect(notified).toBeGreaterThan(0);
    expect(handle.doc.getText("t").toString()).toBe("stored");
  });

  it("keeps the same state object until something changes", async () => {
    const { session } = makeSession();
    const handle = session.open(DOC);
    await settle();
    expect(handle.getState()).toBe(handle.getState());
  });

  it("never appends the hydrated content", async () => {
    await seed("stored");
    const { session, store } = makeSession();
    const handle = session.open(DOC);
    await settle();
    await handle.flush();
    expect(store.appends).toHaveLength(0);
  });

  it("appends local edits in batches", async () => {
    const { session, store } = makeSession({
      describe: (doc) => ({ title: doc.getText("t").toString().slice(0, 5) }),
    });
    const handle = session.open(DOC);
    await settle();
    handle.doc.getText("t").insert(0, "hello");
    handle.doc.getText("t").insert(5, " world");
    await clock.advance(BATCH_IDLE_MS);
    expect(store.appends).toHaveLength(1);
    expect(store.appends[0]).toMatchObject({ origin: "local", title: "hello" });
  });

  it("stores comment writes, so comment roots count in size_bytes (I9)", async () => {
    // Comments live in the document's own Y.Doc (comments design §4.1)
    // and write with their own origin; nothing may filter that origin out
    // (offline data-model revision, P4.9 row).
    const { session, store } = makeSession();
    const handle = session.open(DOC);
    await settle();
    handle.doc.getText("t").insert(0, "hello");
    await clock.advance(BATCH_IDLE_MS);
    const before = store.appends.reduce((n, r) => n + r.update.byteLength, 0);
    handle.doc.transact(() => {
      handle.doc.getMap(COMMENTS_ROOT).set(`t:${"A".repeat(22)}`, {
        v: 1,
        q: "hello",
        c: 0,
        au: { id: "B".repeat(22), n: "Calm Otter", k: "#64B5F6" },
      });
    }, COMMENT_ORIGIN);
    await clock.advance(BATCH_IDLE_MS);
    expect(store.appends).toHaveLength(2);
    expect(store.appends[1]?.origin).toBe("local");
    const stored = store.appends.reduce((n, r) => n + r.update.byteLength, 0);
    expect(stored - before).toBeGreaterThan(60);
    const doc = new Y.Doc();
    for (const { update } of store.appends) Y.applyUpdate(doc, update);
    expect(doc.getMap(COMMENTS_ROOT).size).toBe(1);
  });

  it("keeps edits made before the content loads", async () => {
    await seed("stored");
    const store = new SpyStore(
      new MemoryDocStore({ library, loadDelayMs: 20 }),
    );
    const { session } = makeSession({ store });
    const handle = session.open(DOC);
    handle.doc.getText("t").insert(0, "early ");
    await new Promise((r) => setTimeout(r, 40));
    await handle.flush();
    expect(store.appends.map((a) => a.origin)).toEqual(["local"]);
    expect(handle.doc.getText("t").toString()).toContain("early ");
  });

  it("shares one Y.Doc and awareness between handles on the same document", async () => {
    const { session } = makeSession();
    const first = session.open(DOC);
    const second = session.open(DOC);
    expect(second.doc).toBe(first.doc);
    expect(second.awareness).toBe(first.awareness);
    expect(first.awareness.doc).toBe(first.doc);
  });

  it("reports a load refusal and stays not ready", async () => {
    library.createDoc(DOC, 0);
    const otherWindow = new MemoryDocStore({ library });
    await otherWindow.load(DOC);
    const { session, store } = makeSession();
    const handle = session.open(DOC);
    await settle();
    expect(handle.getState().ready).toBe(false);
    expect(handle.getState().error?.code).toBe("already_open");
    handle.release();
    await clock.advance(RELEASE_DELAY_MS);
    // It never held the document, so it must not release another window's hold.
    expect(store.closed).toEqual([]);
  });
});

describe("local-session migrations", () => {
  it("marks a document from a newer schema read-only and runs nothing", async () => {
    await seed("future", 5);
    let ran = false;
    const { session } = makeSession({
      schema: 2,
      migrations: [{ to: 2, migrate: () => (ran = true) }],
    });
    const handle = session.open(DOC);
    await settle();
    expect(handle.getState()).toMatchObject({
      ready: true,
      readOnlyReason: "doc_too_new",
    });
    expect(ran).toBe(false);
  });

  it("runs pending migrations in order before ready, appended as migration", async () => {
    await seed("v1", 1);
    const order: number[] = [];
    const readyWhileMigrating: boolean[] = [];
    const { session, store } = makeSession({
      schema: 3,
      migrations: [
        {
          to: 3,
          migrate: (doc) => {
            order.push(3);
            doc.getText("t").insert(0, "[3]");
          },
        },
        { to: 1, migrate: () => order.push(1) },
        {
          to: 2,
          migrate: (doc) => {
            order.push(2);
            readyWhileMigrating.push(handle.getState().ready);
            doc.getText("t").insert(0, "[2]");
          },
        },
      ],
    });
    const handle = session.open(DOC);
    await settle();
    expect(order).toEqual([2, 3]);
    expect(readyWhileMigrating).toEqual([false]);
    expect(handle.doc.getText("t").toString()).toBe("[3][2]v1");
    await handle.flush();
    expect(store.appends.map((a) => [a.origin, a.schemaTo])).toEqual([
      ["migration", 3],
    ]);
  });

  it("records the schema even when a migration changes nothing", async () => {
    await seed("v1", 1);
    const { session, store } = makeSession({
      schema: 2,
      migrations: [{ to: 2, migrate: () => {} }],
    });
    const handle = session.open(DOC);
    await settle();
    await handle.flush();
    expect(store.appends.map((a) => [a.origin, a.schemaTo])).toEqual([
      ["migration", 2],
    ]);
    handle.release();
    await clock.advance(RELEASE_DELAY_MS);
    expect((await new MemoryDocStore({ library }).load(DOC)).schema).toBe(2);
  });

  it("keeps migration edits out of local-origin batches", async () => {
    await seed("v1", 1);
    const { session, store } = makeSession({
      schema: 2,
      migrations: [
        {
          to: 2,
          migrate: (doc) => {
            doc.transact(
              () => doc.getText("t").insert(0, "m"),
              MIGRATION_ORIGIN,
            );
          },
        },
      ],
    });
    const handle = session.open(DOC);
    await settle();
    handle.doc.getText("t").insert(0, "typed");
    await handle.flush();
    expect(store.appends.map((a) => a.origin)).toEqual(["migration", "local"]);
  });
});

describe("local-session release", () => {
  it("reuses the session when re-opened within the delay", async () => {
    const { session, store } = makeSession();
    const first = session.open(DOC);
    await settle();
    first.release();
    await clock.advance(RELEASE_DELAY_MS - 1);
    const second = session.open(DOC);
    expect(second.doc).toBe(first.doc);
    await clock.advance(RELEASE_DELAY_MS * 2);
    expect(store.closed).toEqual([]);
  });

  it("ignores a second release of the same handle", async () => {
    const { session, store } = makeSession();
    const first = session.open(DOC);
    const second = session.open(DOC);
    await settle();
    first.release();
    first.release();
    await clock.advance(RELEASE_DELAY_MS * 2);
    expect(store.closed).toEqual([]);
    second.release();
    await clock.advance(RELEASE_DELAY_MS);
    expect(store.closed).toEqual([DOC]);
  });

  it("flushes, compacts and closes after the delay", async () => {
    const { session, store } = makeSession();
    const handle = session.open(DOC);
    await settle();
    handle.doc.getText("t").insert(0, "kept");
    handle.release();
    await clock.advance(RELEASE_DELAY_MS);
    expect(store.appends).toHaveLength(1);
    expect(store.compactions).toBe(1);
    expect(store.closed).toEqual([DOC]);

    const loaded = await new MemoryDocStore({ library }).load(DOC);
    expect(loaded.snapshot).not.toBeNull();
    expect(loaded.updates).toHaveLength(0);
    expect(textIn(loaded)).toBe("kept");
  });

  it("opens a fresh session after close, with the saved content", async () => {
    const { session } = makeSession();
    const first = session.open(DOC);
    await settle();
    first.doc.getText("t").insert(0, "again");
    first.release();
    await clock.advance(RELEASE_DELAY_MS);
    const second = session.open(DOC);
    expect(second.doc).not.toBe(first.doc);
    await settle();
    expect(second.getState().ready).toBe(true);
    expect(second.doc.getText("t").toString()).toBe("again");
  });

  it("waits for a closing session before re-opening the document", async () => {
    const store = new SpyStore(
      new MemoryDocStore({ library, writeDelayMs: 15 }),
    );
    const { session } = makeSession({ store });
    const first = session.open(DOC);
    await settle();
    first.doc.getText("t").insert(0, "slow");
    first.release();
    await clock.advance(RELEASE_DELAY_MS); // close starts, append takes 15 ms
    const second = session.open(DOC);
    await new Promise((r) => setTimeout(r, 60));
    await settle();
    expect(second.getState().error).toBeNull();
    expect(second.getState().ready).toBe(true);
    expect(second.doc.getText("t").toString()).toBe("slow");
  });
});

describe("local-session flush and compaction", () => {
  it("DocSession.flush saves every open document", async () => {
    const { session, store } = makeSession();
    const a = session.open("doc-a");
    const b = session.open("doc-b");
    await settle();
    a.doc.getText("t").insert(0, "a");
    b.doc.getText("t").insert(0, "b");
    await session.flush();
    expect(store.appends).toHaveLength(2);
  });

  it("compacts on idle when the batcher asks", async () => {
    await seed("x");
    const { session, store } = makeSession();
    const handle = session.open(DOC);
    await settle();
    const big = "y".repeat(1024 * 1024 + 1);
    handle.doc.getText("t").insert(0, big);
    await handle.flush();
    await clock.advance(0);
    expect(store.compactions).toBe(1);
  });

  it("applies foreign state with STORAGE_ORIGIN and never appends it", async () => {
    const { session, store } = makeSession();
    const other = new Y.Doc();
    other.getText("t").insert(0, "other tab");
    store.foreign = Y.encodeStateAsUpdate(other);
    const handle = session.open(DOC);
    await settle();
    const origins: unknown[] = [];
    handle.doc.on("update", (_u: Uint8Array, origin: unknown) =>
      origins.push(origin),
    );
    handle.doc.getText("t").insert(0, "mine ");
    handle.release();
    await clock.advance(RELEASE_DELAY_MS);
    expect(origins).toContain(STORAGE_ORIGIN);
    expect(store.appends).toHaveLength(1);
    expect(store.appends[0].origin).toBe("local");
  });
});

describe("local-session failures", () => {
  it("DocSession.flush also saves a session that is closing", async () => {
    const store = new SpyStore(
      new MemoryDocStore({ library, writeDelayMs: 20 }),
    );
    const { session } = makeSession({ store });
    const handle = session.open(DOC);
    await settle();
    handle.doc.getText("t").insert(0, "last words");
    handle.release();
    await clock.advance(RELEASE_DELAY_MS); // closing: the append is in flight
    await session.flush();
    expect(store.appends).toHaveLength(1);
  });

  it("stops at a migration that throws: content kept, schema not advanced", async () => {
    await seed("v1", 1);
    const { session, store } = makeSession({
      schema: 3,
      migrations: [
        { to: 2, migrate: (doc) => doc.getText("t").insert(0, "[2]") },
        {
          to: 3,
          migrate: (doc) => {
            doc.getText("t").insert(0, "[half]");
            throw new Error("bad migration");
          },
        },
      ],
    });
    const handle = session.open(DOC);
    await settle();
    expect(handle.getState().ready).toBe(false);
    expect(handle.getState().error?.code).toBe("migration_failed");
    await handle.flush();
    // The half-done step's edit exists, so it is saved, but the schema stays at 2.
    expect(handle.doc.getText("t").toString()).toBe("[half][2]v1");
    expect(store.appends.map((a) => a.schemaTo ?? null)).toContain(2);
    expect(store.appends.map((a) => a.schemaTo ?? null)).not.toContain(3);
    handle.release();
    await clock.advance(RELEASE_DELAY_MS);
    expect((await new MemoryDocStore({ library }).load(DOC)).schema).toBe(2);
  });

  it("reports stored content that cannot be applied as corrupt", async () => {
    library.createDoc(DOC, 0);
    const writer = new MemoryDocStore({ library });
    await writer.load(DOC);
    await writer.append(DOC, {
      origin: "local",
      update: new Uint8Array([255, 255, 255]),
    });
    await writer.close(DOC);
    const { session } = makeSession();
    const handle = session.open(DOC);
    await settle();
    expect(handle.getState().ready).toBe(false);
    expect(handle.getState().error?.code).toBe("corrupt");
  });

  it("loads again on the next open after a refused load", async () => {
    library.createDoc(DOC, 0);
    const otherWindow = new MemoryDocStore({ library });
    await otherWindow.load(DOC);
    const { session } = makeSession();
    const refused = session.open(DOC);
    await settle();
    expect(refused.getState().error?.code).toBe("already_open");

    await otherWindow.close(DOC);
    const retried = session.open(DOC);
    await settle();
    expect(retried.getState()).toMatchObject({ ready: true, error: null });
    refused.release();
    await clock.advance(RELEASE_DELAY_MS);
    expect(retried.getState().ready).toBe(true);
    retried.doc.getText("t").insert(0, "still open");
    await retried.flush();
  });
});

describe("local-session T7: slow hydrate never overwrites storage", () => {
  it(
    "writes nothing before a 1.5 s load resolves, then keeps both copies",
    async () => {
      await seed("stored edits ");
      const slow = new SpyStore(
        new MemoryDocStore({ library, loadDelayMs: 1500 }),
      );
      const { session } = makeSession({ store: slow });
      const handle = session.open(DOC);

      // Typed while the stored copy is still loading.
      handle.doc.getText("t").insert(0, "typed early");
      await clock.advance(5 * BATCH_IDLE_MS);
      await handle.flush();
      expect(slow.appends).toHaveLength(0);
      expect(slow.compactions).toBe(0);

      await new Promise((r) => setTimeout(r, 1600));
      await settle();
      expect(handle.getState().ready).toBe(true);
      handle.release();
      await clock.advance(RELEASE_DELAY_MS); // flush, compact (snapshot), close

      const reopened = await new MemoryDocStore({ library }).load(DOC);
      const text = textIn(reopened);
      expect(text).toContain("stored edits ");
      expect(text).toContain("typed early");
    },
    { timeout: 5000 },
  );
});

describe("local-session schema defaults", () => {
  it("matches the engine: schema 0, so a new document needs no migration append", async () => {
    const { session, store } = makeSession();
    const handle = session.open("brand-new");
    await settle();
    await handle.flush();
    expect(handle.getState()).toMatchObject({
      ready: true,
      readOnlyReason: null,
    });
    expect(store.appends).toHaveLength(0);
    expect((await store.load("brand-new")).schema).toBe(0);
  });
});
