import { describe, expect, it } from "bun:test";

import * as Y from "yjs";

import {
  bindLocalCopy,
  createMemoryBackend,
  LOCAL_ORIGIN,
  LocalDocStore,
  OFFLINE_DOC_MAX_AGE_DAYS,
  storeKey,
} from "@/lib/offline";
import { TOMBSTONE_RETENTION_DAYS } from "@/lib/security/guardrail-config";

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
    expect(await store.load("doc-a")).toEqual(Uint8Array.from([1, 2, 3]));
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
    Y.applyUpdate(reloaded, (await store.load("doc")) ?? new Uint8Array());
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
        delete: async () => {},
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
