import { describe, expect, it } from "bun:test";

import * as Y from "yjs";

import {
  bindLocalCopy,
  createMemoryBackend,
  type DocStoreBackend,
  LOCAL_ORIGIN,
  LocalDocStore,
  legacyStoreKey,
  mergeIntoStored,
  OFFLINE_CACHE_EPOCH,
  OFFLINE_DOC_MAX_AGE_DAYS,
  OFFLINE_NAMESPACE,
  storeKey,
} from "@/lib/offline";
import { TOMBSTONE_RETENTION_DAYS } from "@/lib/security/guardrail-config";
import { LegacyLocalDocStore } from "@/tests/fixtures/legacy-local-doc-store";

const DAY = 24 * 60 * 60 * 1000;
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function makeStore(now = () => 1_000_000) {
  const backend = createMemoryBackend();
  return { backend, store: new LocalDocStore(backend, "ws.example", now) };
}

describe("LocalDocStore", () => {
  it("expires copies before the server forgets tombstones", () => {
    expect(OFFLINE_DOC_MAX_AGE_DAYS).toBeLessThan(TOMBSTONE_RETENTION_DAYS);
  });

  it("round-trips a document and scopes keys by server", async () => {
    const { backend, store } = makeStore();
    await store.save("doc-a", Uint8Array.from([1, 2, 3]));
    expect(await store.load("doc-a")).toEqual({
      current: Uint8Array.from([1, 2, 3]),
      legacy: null,
    });
    expect(
      await new LocalDocStore(backend, "other.host").load("doc-a"),
    ).toBeNull();
    expect((await backend.all())[0]?.key).toBe(storeKey("ws.example", "doc-a"));
  });

  it("drops copies older than the max age on load", async () => {
    let now = 0;
    const { store } = makeStore(() => now);
    await store.save("old", Uint8Array.from([1]));
    now = (OFFLINE_DOC_MAX_AGE_DAYS + 1) * DAY;
    expect(await store.load("old")).toBeNull();
  });

  it("prunes unwanted, stale and excess copies but never kept ones", async () => {
    let now = 0;
    const { store, backend } = makeStore(() => now);
    for (const name of ["a", "b", "c", "d"]) {
      now += 1000;
      await store.save(name, Uint8Array.from([1]));
    }
    const removed = await store.prune({
      keep: new Set(["a"]),
      isWanted: (name) => name !== "d",
      maxDocs: 2,
    });
    // d is unwanted; of a, b, c only 2 may stay and a is kept, so b (oldest
    // evictable) goes.
    expect(removed.sort()).toEqual(["b", "d"]);
    expect((await backend.all()).map((doc) => doc.name).sort()).toEqual([
      "a",
      "c",
    ]);
  });
});

describe("bindLocalCopy", () => {
  it("restores a saved copy before the network and saves later changes", async () => {
    const { store } = makeStore();
    const first = new Y.Doc();
    first.getText("t").insert(0, "offline edit");
    await store.save("doc", Y.encodeStateAsUpdate(first));

    const doc = new Y.Doc();
    const origins: unknown[] = [];
    doc.on("update", (_u: Uint8Array, origin: unknown) => origins.push(origin));
    const binding = bindLocalCopy(doc, "doc", store, { debounceMs: 5 });
    expect(await binding.hydrated).toBe(true);
    expect(doc.getText("t").toString()).toBe("offline edit");
    expect(origins).toEqual([LOCAL_ORIGIN]);

    doc.getText("t").insert(0, "more ");
    await tick(20);
    const reloaded = new Y.Doc();
    Y.applyUpdate(
      reloaded,
      (await store.load("doc"))?.current ?? new Uint8Array(),
    );
    expect(reloaded.getText("t").toString()).toBe("more offline edit");
    binding.destroy();
  });

  it("keeps editing working when storage fails", async () => {
    const failing = new LocalDocStore(
      {
        get: async () => {
          throw new Error("quota");
        },
        put: async () => {
          throw new Error("quota");
        },
        putMerged: async () => {
          throw new Error("quota");
        },
        delete: async () => {},
        deleteIfUnchanged: async () => false,
        all: async () => [],
        clear: async () => {},
      },
      "ws.example",
    );
    const doc = new Y.Doc();
    const binding = bindLocalCopy(doc, "doc", failing, { debounceMs: 1 });
    expect(await binding.hydrated).toBe(false);
    doc.getText("t").insert(0, "still works");
    await tick(10);
    expect(doc.getText("t").toString()).toBe("still works");
    binding.destroy();
  });

  it("applies nothing after destroy", async () => {
    const { store } = makeStore();
    const seed = new Y.Doc();
    seed.getText("t").insert(0, "late");
    await store.save("doc", Y.encodeStateAsUpdate(seed));
    const doc = new Y.Doc();
    const binding = bindLocalCopy(doc, "doc", store);
    binding.destroy();
    expect(await binding.hydrated).toBe(false);
    expect(doc.getText("t").toString()).toBe("");
  });
});

function yState(text: string): Uint8Array {
  const doc = new Y.Doc();
  doc.getText("t").insert(0, text);
  return Y.encodeStateAsUpdate(doc);
}

function textOf(update: Uint8Array | undefined): string {
  const doc = new Y.Doc();
  if (update) Y.applyUpdate(doc, update);
  return doc.getText("t").toString();
}

async function keys(backend: DocStoreBackend): Promise<string[]> {
  return (await backend.all()).map((doc) => doc.key).sort();
}

describe("~s2 namespace", () => {
  it("saves under ~s2 and never bumps the epoch", async () => {
    const { store, backend } = makeStore();
    await store.save("a", Uint8Array.from([1]));
    expect((await backend.all())[0]?.key).toBe("1:ws.example~s2:a");
    expect(OFFLINE_CACHE_EPOCH).toBe(1);
    expect(OFFLINE_NAMESPACE).toBe("s2");
    expect(legacyStoreKey("ws.example", "a")).toBe("1:ws.example:a");
  });

  it("is invisible to a pre-N bundle's load and prune", async () => {
    const { store, backend } = makeStore();
    const legacy = new LegacyLocalDocStore(
      backend,
      "ws.example",
      () => 1_000_000,
    );
    await store.save("a", Uint8Array.from([1]));
    expect(await legacy.load("a")).toBeNull();
    expect(
      await legacy.prune({
        keep: new Set(),
        isWanted: () => false,
        maxDocs: 0,
      }),
    ).toEqual([]);
    expect(await keys(backend)).toEqual(["1:ws.example~s2:a"]);
  });

  it("loads both copies and expires each one separately", async () => {
    let now = 0;
    const { store, backend } = makeStore(() => now);
    const legacy = new LegacyLocalDocStore(backend, "ws.example", () => now);
    await legacy.save("a", Uint8Array.from([1]));
    now = (OFFLINE_DOC_MAX_AGE_DAYS - 1) * DAY;
    await store.save("a", Uint8Array.from([2]));
    expect(await store.load("a")).toEqual({
      current: Uint8Array.from([2]),
      legacy: {
        key: "1:ws.example:a",
        name: "a",
        update: Uint8Array.from([1]),
        updatedAt: 0,
      },
    });
    now = (OFFLINE_DOC_MAX_AGE_DAYS + 1) * DAY;
    expect(await store.load("a")).toEqual({
      current: Uint8Array.from([2]),
      legacy: null,
    });
    expect(await keys(backend)).toEqual(["1:ws.example~s2:a"]);
    now = (2 * OFFLINE_DOC_MAX_AGE_DAYS + 1) * DAY;
    expect(await store.load("a")).toBeNull();
    expect(await keys(backend)).toEqual([]);
  });

  it("merges the legacy copy, saves, then retires it", async () => {
    const { store, backend } = makeStore();
    const legacy = new LegacyLocalDocStore(
      backend,
      "ws.example",
      () => 1_000_000,
    );
    await legacy.save("a", yState("pre-N offline edit"));

    const doc = new Y.Doc();
    const binding = bindLocalCopy(doc, "a", store, { debounceMs: 5 });
    expect(await binding.hydrated).toBe(true);
    expect(doc.getText("t").toString()).toBe("pre-N offline edit");
    await binding.flush();

    expect(await keys(backend)).toEqual(["1:ws.example~s2:a"]);
    expect(
      textOf((await backend.get(storeKey("ws.example", "a")))?.update),
    ).toBe("pre-N offline edit");
    binding.destroy();
  });

  it("merges current and legacy copies into one document", async () => {
    const { store, backend } = makeStore();
    const base = new Y.Doc();
    base.getText("t").insert(0, "base");
    const newer = new Y.Doc();
    Y.applyUpdate(newer, Y.encodeStateAsUpdate(base));
    newer.getText("t").insert(4, " new");
    const older = new Y.Doc();
    Y.applyUpdate(older, Y.encodeStateAsUpdate(base));
    older.getText("t").insert(0, "old ");
    await store.save("a", Y.encodeStateAsUpdate(newer));
    await new LegacyLocalDocStore(backend, "ws.example", () => 1_000_000).save(
      "a",
      Y.encodeStateAsUpdate(older),
    );

    const doc = new Y.Doc();
    const binding = bindLocalCopy(doc, "a", store);
    expect(await binding.hydrated).toBe(true);
    await binding.flush();
    expect(doc.getText("t").toString()).toBe("old base new");
    expect(await keys(backend)).toEqual(["1:ws.example~s2:a"]);
    expect(
      textOf((await backend.get(storeKey("ws.example", "a")))?.update),
    ).toBe("old base new");
    binding.destroy();
  });

  it("keeps the legacy copy when the save fails", async () => {
    const memory = createMemoryBackend();
    const backend: DocStoreBackend = {
      ...memory,
      putMerged: async (doc, merge) => {
        if (doc.key.includes("~s2:")) throw new Error("quota");
        await memory.putMerged(doc, merge);
      },
    };
    const store = new LocalDocStore(backend, "ws.example", () => 1_000_000);
    await new LegacyLocalDocStore(backend, "ws.example", () => 1_000_000).save(
      "a",
      yState("keep me"),
    );

    const doc = new Y.Doc();
    const binding = bindLocalCopy(doc, "a", store);
    expect(await binding.hydrated).toBe(true);
    await binding.flush();
    expect(doc.getText("t").toString()).toBe("keep me");
    expect(await keys(backend)).toEqual(["1:ws.example:a"]);
    expect(textOf((await backend.get("1:ws.example:a"))?.update)).toBe(
      "keep me",
    );
    binding.destroy();
  });

  it("keeps a legacy copy rewritten after the merge", async () => {
    let now = 1_000_000;
    const { store, backend } = makeStore(() => now);
    const legacy = new LegacyLocalDocStore(backend, "ws.example", () => now);
    await legacy.save("a", yState("first"));
    const loaded = await store.load("a");
    if (!loaded?.legacy) throw new Error("expected a legacy copy");

    // A pre-N tab writes a newer legacy copy between merge and retirement.
    now += 1000;
    await legacy.save("a", yState("first"));
    await store.save("a", loaded.legacy.update);
    expect(await store.retireLegacy("a", loaded.legacy)).toBe(false);
    expect(await keys(backend)).toEqual([
      "1:ws.example:a",
      "1:ws.example~s2:a",
    ]);
    expect((await store.load("a"))?.legacy?.updatedAt).toBe(now);

    // Same timestamp but different content is also a rewrite.
    const same = await store.load("a");
    if (!same?.legacy) throw new Error("expected a legacy copy");
    await legacy.save("a", yState("longer rewrite"));
    expect(await store.retireLegacy("a", same.legacy)).toBe(false);

    const latest = await store.load("a");
    if (!latest?.legacy) throw new Error("expected a legacy copy");
    expect(await store.retireLegacy("a", latest.legacy)).toBe(true);
    expect(await keys(backend)).toEqual(["1:ws.example~s2:a"]);
    expect(await store.retireLegacy("a", latest.legacy)).toBe(false);
  });

  it("removes both keys and prunes legacy keys like current ones", async () => {
    let now = 0;
    const { store, backend } = makeStore(() => now);
    const legacy = new LegacyLocalDocStore(backend, "ws.example", () => now);
    const other = new LegacyLocalDocStore(backend, "other.host", () => now);
    await legacy.save("a", Uint8Array.from([1]));
    await store.save("a", Uint8Array.from([1]));
    await store.remove("a");
    expect(await keys(backend)).toEqual([]);

    for (const name of ["b", "c", "d", "e"]) {
      now += 1000;
      await legacy.save(name, Uint8Array.from([1]));
    }
    await other.save("x", Uint8Array.from([1]));
    const removed = await store.prune({
      keep: new Set(["b"]),
      isWanted: (name) => name !== "e",
      maxDocs: 2,
    });
    // e is unwanted; of b, c, d only 2 may stay and b is kept, so c goes.
    expect(removed.sort()).toEqual(["c", "e"]);
    expect(await keys(backend)).toEqual([
      "1:other.host:x",
      "1:ws.example:b",
      "1:ws.example:d",
    ]);

    now += OFFLINE_DOC_MAX_AGE_DAYS * DAY;
    await store.prune({ keep: new Set(["b"]) });
    // Stale copies go even when kept, like current ones.
    expect(await keys(backend)).toEqual([]);
  });

  it("evicts a document's legacy and current keys together", async () => {
    let now = 0;
    const { store, backend } = makeStore(() => now);
    const legacy = new LegacyLocalDocStore(backend, "ws.example", () => now);
    now = 1000;
    await legacy.save("old", Uint8Array.from([1]));
    now = 2000;
    await store.save("mid", Uint8Array.from([1]));
    now = 3000;
    await store.save("old", Uint8Array.from([1]));
    now = 4000;
    await store.save("new", Uint8Array.from([1]));
    const removed = await store.prune({ keep: new Set(), maxDocs: 2 });
    expect(removed).toEqual(["mid"]);
    expect(await keys(backend)).toEqual([
      "1:ws.example:old",
      "1:ws.example~s2:new",
      "1:ws.example~s2:old",
    ]);
  });
});

/**
 * Memory backend whose `~s2` saves land only when `release` is called, while
 * deletes land at once: a backend that does not keep call order.
 */
function gatedBackend() {
  const memory = createMemoryBackend();
  const gates: Array<() => void> = [];
  const backend: DocStoreBackend = {
    ...memory,
    putMerged: async (doc, merge) => {
      if (doc.key.includes("~s2:")) {
        await new Promise<void>((resolve) => gates.push(resolve));
      }
      await memory.putMerged(doc, merge);
    },
  };
  const release = () => {
    for (const open of gates.splice(0)) open();
  };
  return { backend, memory, release, pending: () => gates.length };
}

describe("removal during a legacy merge", () => {
  it("lands a removal after a save begun before it", async () => {
    const { backend, release } = gatedBackend();
    const store = new LocalDocStore(backend, "ws.example", () => 1_000_000);
    const saving = store.save("a", yState("late"));
    const removal = store.remove("a");
    await tick();
    release();
    await Promise.all([saving, removal]);
    expect(await keys(backend)).toEqual([]);
  });

  it("leaves no copy when a tab closes mid-merge", async () => {
    const { backend, release, pending } = gatedBackend();
    const store = new LocalDocStore(backend, "ws.example", () => 1_000_000);
    await new LegacyLocalDocStore(backend, "ws.example", () => 1_000_000).save(
      "a",
      yState("pre-N offline edit"),
    );
    const binding = bindLocalCopy(new Y.Doc(), "a", store);
    expect(await binding.hydrated).toBe(true);
    expect(pending()).toBe(1); // the merged save is in flight

    // forgetLocalCopy: destroy, then remove.
    binding.destroy();
    const removal = store.remove("a");
    release();
    await removal;
    await tick(10);
    expect(await keys(backend)).toEqual([]);
  });

  it("never resurrects a document deleted mid-merge", async () => {
    const { backend, memory, release } = gatedBackend();
    const store = new LocalDocStore(backend, "ws.example", () => 1_000_000);
    // A current copy too, written past the gate.
    await new LocalDocStore(memory, "ws.example", () => 1_000_000).save(
      "a",
      yState("base"),
    );
    await new LegacyLocalDocStore(backend, "ws.example", () => 1_000_000).save(
      "a",
      yState("pre-N offline edit"),
    );
    const doc = new Y.Doc();
    const binding = bindLocalCopy(doc, "a", store, { debounceMs: 5 });
    expect(await binding.hydrated).toBe(true);

    // document_deleted: destroy, then a fire-and-forget removeLocalCopy.
    binding.destroy();
    void store.remove("a");
    doc.getText("t").insert(0, "typed after delete");
    release();
    await tick(20);
    expect(await keys(backend)).toEqual([]);
  });

  it("drops saves a binding bound before the removal makes after it", async () => {
    const { backend, release } = gatedBackend();
    const store = new LocalDocStore(backend, "ws.example", () => 1_000_000);
    await new LegacyLocalDocStore(backend, "ws.example", () => 1_000_000).save(
      "a",
      yState("pre-N offline edit"),
    );
    const doc = new Y.Doc();
    const binding = bindLocalCopy(doc, "a", store, { debounceMs: 5 });
    expect(await binding.hydrated).toBe(true);
    doc.getText("t").insert(0, "typed before release");

    // A releasing session flushes, and a tab close removes the copy before
    // the flush's write is queued; nothing destroyed this binding.
    const flushing = binding.flush();
    const removal = store.remove("a");
    for (let i = 0; i < 3; i++) {
      release();
      await tick(10);
    }
    await Promise.all([flushing, removal]);
    expect(await keys(backend)).toEqual([]);

    // A binding made after the removal saves again.
    const reopened = new Y.Doc();
    const fresh = bindLocalCopy(reopened, "a", store, { debounceMs: 5 });
    expect(await fresh.hydrated).toBe(false);
    reopened.getText("t").insert(0, "reopened");
    await tick(10);
    release();
    await tick(10);
    expect(await keys(backend)).toEqual(["1:ws.example~s2:a"]);
  });

  it("keeps the legacy key for the removal once destroyed", async () => {
    const { backend, release } = gatedBackend();
    const store = new LocalDocStore(backend, "ws.example", () => 1_000_000);
    await new LegacyLocalDocStore(backend, "ws.example", () => 1_000_000).save(
      "a",
      yState("pre-N offline edit"),
    );
    const binding = bindLocalCopy(new Y.Doc(), "a", store);
    expect(await binding.hydrated).toBe(true);
    binding.destroy();
    release();
    await tick(10);
    // Not retired after destroy; a later load merges it again (idempotent).
    expect(await keys(backend)).toEqual([
      "1:ws.example:a",
      "1:ws.example~s2:a",
    ]);
  });
});

describe("merge on save", () => {
  it("merges a save into the stored copy", async () => {
    const { store } = makeStore();
    await store.save("a", yState("stored offline"));
    await store.save("a", yState("server state"));
    const text = textOf((await store.load("a"))?.current ?? undefined);
    expect(text).toContain("stored offline");
    expect(text).toContain("server state");
  });

  it("replaces an expired copy instead of merging it", async () => {
    let now = 0;
    const { store } = makeStore(() => now);
    await store.save("a", yState("expired"));
    now = (OFFLINE_DOC_MAX_AGE_DAYS + 1) * DAY;
    await store.save("a", yState("fresh"));
    now += 1;
    expect(textOf((await store.load("a"))?.current ?? undefined)).toBe("fresh");
  });

  it("keeps an unreadable copy and rejects the save", async () => {
    const { backend, store } = makeStore();
    const key = storeKey("ws.example", "a");
    await backend.put({
      key,
      name: "a",
      update: Uint8Array.from([255, 255, 255]),
      updatedAt: 1_000_000,
    });
    await expect(store.save("a", yState("new"))).rejects.toThrow();
    expect((await backend.get(key))?.update).toEqual(
      Uint8Array.from([255, 255, 255]),
    );
  });

  it("does not keep deleted text in the saved copy", async () => {
    const { backend, store } = makeStore();
    const doc = new Y.Doc();
    doc.getText("t").insert(0, "base");
    await store.save("a", Y.encodeStateAsUpdate(doc));
    doc.getText("t").insert(4, "x".repeat(10_000));
    await store.save("a", Y.encodeStateAsUpdate(doc));
    doc.getText("t").delete(4, 10_000);
    for (let i = 0; i < 3; i++) {
      await store.save("a", Y.encodeStateAsUpdate(doc));
    }
    expect(
      (await backend.get(storeKey("ws.example", "a")))?.update.byteLength,
    ).toBeLessThan(200);
  });

  it("returns the update untouched when the stamp matches", () => {
    const stored = {
      key: storeKey("ws.example", "a"),
      name: "a",
      update: Uint8Array.from([255, 255, 255]),
      updatedAt: 1_000_000,
    };
    const update = yState("next");
    // Undecodable bytes: only a skipped merge can succeed.
    expect(
      mergeIntoStored(stored, update, 1_000_001, {
        updatedAt: 1_000_000,
        byteLength: 3,
      }),
    ).toBe(update);
    expect(() =>
      mergeIntoStored(stored, update, 1_000_001, {
        updatedAt: 999,
        byteLength: 3,
      }),
    ).toThrow();
  });

  it("skips the merge when the stored copy is the binding's own last write", async () => {
    const backend = createMemoryBackend();
    const store = new LocalDocStore(backend, "ws.example", () => 1_000_000);
    const doc = new Y.Doc();
    const binding = bindLocalCopy(doc, "a", store, { debounceMs: 5 });
    await binding.hydrated;
    doc.getText("t").insert(0, "first");
    await binding.flush();
    const key = storeKey("ws.example", "a");
    const own = await backend.get(key);
    if (!own) throw new Error("no copy saved");
    // Same stamp, undecodable bytes: a merge would throw and disable the binding.
    await backend.put({
      ...own,
      update: new Uint8Array(own.update.byteLength).fill(255),
    });
    doc.getText("t").insert(0, "second ");
    await binding.flush();
    expect(textOf((await backend.get(key))?.update)).toBe("second first");
    binding.destroy();
  });
});

describe("two tabs saving one document", () => {
  it("keeps both tabs' edits when their saves overlap", async () => {
    const memory = createMemoryBackend();
    // Reads yield after reading, so both tabs read before either writes.
    const backend: DocStoreBackend = {
      ...memory,
      get: async (key) => {
        const stored = await memory.get(key);
        await tick();
        return stored;
      },
    };
    const tabA = new LocalDocStore(backend, "ws.example", () => 1_000_000);
    const tabB = new LocalDocStore(backend, "ws.example", () => 1_000_000);
    await Promise.all([
      tabA.save("a", yState("from tab A")),
      tabB.save("a", yState("from tab B")),
    ]);
    const text = textOf(
      (await memory.get(storeKey("ws.example", "a")))?.update,
    );
    expect(text).toContain("from tab A");
    expect(text).toContain("from tab B");
  });

  it("keeps both tabs' offline edits through their bindings", async () => {
    const backend = createMemoryBackend();
    const tabs = ["A", "B"].map((label) => {
      const store = new LocalDocStore(backend, "ws.example", () => 1_000_000);
      const doc = new Y.Doc();
      return {
        label,
        doc,
        binding: bindLocalCopy(doc, "a", store, { debounceMs: 5 }),
      };
    });
    for (const tab of tabs) await tab.binding.hydrated;
    // Neither tab reads the other's copy: each only saves.
    for (const tab of tabs) {
      tab.doc.getText("t").insert(0, `typed in tab ${tab.label} `);
      await tab.binding.flush();
    }
    const text = textOf(
      (await backend.get(storeKey("ws.example", "a")))?.update,
    );
    expect(text).toContain("typed in tab A");
    expect(text).toContain("typed in tab B");
    for (const tab of tabs) tab.binding.destroy();
  });
});
