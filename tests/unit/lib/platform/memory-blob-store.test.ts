import { describe, expect, it } from "bun:test";

import { BlobStoreError } from "@/lib/platform/blob-store";
import { MemoryBlobStore } from "@/lib/platform/memory-blob-store";
import {
  contractImage,
  defineBlobStoreContract,
} from "@/tests/helpers/blob-store-contract";

defineBlobStoreContract(
  { describe, it },
  "BlobStore contract: MemoryBlobStore",
  {
    versions: true,
    async createStore(now) {
      const store = new MemoryBlobStore({ now });
      return {
        store,
        addVersionRef: (docId, hex) => store.addVersionRef(docId, hex),
        dispose: async () => {},
      };
    },
  },
);

defineBlobStoreContract(
  { describe, it },
  "BlobStore contract: MemoryBlobStore with synchronous URLs",
  {
    async createStore(now) {
      return {
        store: new MemoryBlobStore({
          now,
          syncUrl: (hex) => `app://tinydocy/_asset/${hex}`,
        }),
        dispose: async () => {},
      };
    },
  },
);

describe("MemoryBlobStore switches", () => {
  it("failNext rejects the next put and stores nothing", async () => {
    const store = new MemoryBlobStore();
    store.failNext(new BlobStoreError("quota_exceeded"));
    await expect(
      store.put("d", contractImage(1), "image/png"),
    ).rejects.toMatchObject({ code: "quota_exceeded" });
    expect(store.rows("d")).toEqual([]);
    await expect(
      store.put("d", contractImage(1), "image/png"),
    ).resolves.toEqual({
      hex: expect.any(String),
    });
  });

  it("markMissing hides the bytes but keeps the rows", async () => {
    const store = new MemoryBlobStore({ syncUrl: (hex) => `x:${hex}` });
    const { hex } = await store.put("d", contractImage(1), "image/png");
    store.markMissing(hex);
    expect(await store.get(hex)).toBeNull();
    expect(await store.has([hex])).toEqual([]);
    expect(store.url(hex)).toBeNull();
    expect(store.rows("d")).toEqual([
      { doc_id: "d", hash: hex, kind: "provisional", dropped_at: null },
    ]);
    // Fetching the bytes again (a share) repairs it.
    await store.put("d", contractImage(1), "image/png", "fetched");
    expect(await store.has([hex])).toEqual([hex]);
  });

  it("keys rows by (doc_id, hash, kind), as format 2's doc_blobs", async () => {
    const store = new MemoryBlobStore({ now: () => 5 });
    const { hex } = await store.put("d", contractImage(1), "image/png");
    await store.recount("d", [hex]);
    expect(store.rows("d")).toEqual([
      // The provisional row is superseded by the current one, not deleted.
      { doc_id: "d", hash: hex, kind: "provisional", dropped_at: 5 },
      { doc_id: "d", hash: hex, kind: "current", dropped_at: null },
    ]);
  });

  it("never adds a row for a hash it has no bytes for (RESTRICT)", async () => {
    const store = new MemoryBlobStore();
    await store.recount("d", ["e".repeat(64)]);
    expect(store.rows("d")).toEqual([]);
    expect(() => store.addVersionRef("d", "e".repeat(64))).toThrow();
  });
});
