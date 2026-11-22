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
    async createStore(now) {
      return { store: new MemoryBlobStore({ now }), dispose: async () => {} };
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
    expect(store.rows("d").size).toBe(0);
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
    expect(store.rows("d").get(hex)).toEqual({
      kind: "provisional",
      droppedAt: null,
    });
    // Fetching the bytes again (a share) repairs it.
    await store.put("d", contractImage(1), "image/png", "fetched");
    expect(await store.has([hex])).toEqual([hex]);
  });

  it("marks rows current on recount", async () => {
    const store = new MemoryBlobStore({ now: () => 5 });
    const { hex } = await store.put("d", contractImage(1), "image/png");
    await store.recount("d", [hex]);
    expect(store.rows("d").get(hex)).toEqual({
      kind: "current",
      droppedAt: null,
    });
  });
});
