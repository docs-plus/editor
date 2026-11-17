import { describe, expect, it } from "bun:test";

import * as Y from "yjs";

import { DocStoreError } from "@/lib/platform/doc-store";
import {
  MemoryDocLibrary,
  MemoryDocStore,
} from "@/lib/platform/memory-doc-store";
import {
  DOC_STORE_CONTRACT,
  type DocStoreHarness,
} from "@/tests/helpers/doc-store-contract";

const harness: DocStoreHarness = {
  exclusiveOpen: true,
  async createLibrary() {
    const library = new MemoryDocLibrary();
    return {
      connect: () => new MemoryDocStore({ library }),
      createDoc: async (docId, schema) => library.createDoc(docId, schema),
      dispose: async () => {},
    };
  },
};

describe("DocStore contract: MemoryDocStore", () => {
  for (const testCase of DOC_STORE_CONTRACT) {
    if (testCase.requires && !harness[testCase.requires]) continue;
    it(testCase.name, () => testCase.run(harness));
  }
});

function update(text: string): Uint8Array {
  const doc = new Y.Doc();
  doc.getText("t").insert(0, text);
  return Y.encodeStateAsUpdate(doc);
}

describe("MemoryDocStore", () => {
  it("opens an unknown document as empty, at the library's new-document schema", async () => {
    const store = new MemoryDocStore({
      library: new MemoryDocLibrary({ newDocSchema: 4 }),
    });
    const loaded = await store.load("fresh");
    expect(loaded).toEqual({
      snapshot: null,
      updates: [],
      maxSeq: 0,
      schema: 4,
    });
  });

  it("works without a shared library (one window)", async () => {
    const store = new MemoryDocStore();
    await store.load("doc");
    expect(
      await store.append("doc", { origin: "local", update: update("a") }),
    ).toBe(1);
  });

  it("failNext rejects the next call of that kind once and writes nothing", async () => {
    const library = new MemoryDocLibrary();
    const store = new MemoryDocStore({ library });
    await store.load("doc");
    store.failNext("append", "disk_full");

    const failed = store.append("doc", {
      origin: "local",
      update: update("a"),
    });
    await expect(failed).rejects.toBeInstanceOf(DocStoreError);
    await expect(failed).rejects.toMatchObject({ code: "disk_full" });
    expect(library.rowCount("doc")).toBe(0);

    await store.append("doc", { origin: "local", update: update("a") });
    expect(library.rowCount("doc")).toBe(1);
  });

  it("loadDelayMs delays load", async () => {
    const store = new MemoryDocStore({ loadDelayMs: 30 });
    const started = performance.now();
    await store.load("doc");
    expect(performance.now() - started).toBeGreaterThanOrEqual(25);
  });

  it("flush waits for delayed writes", async () => {
    const library = new MemoryDocLibrary();
    const store = new MemoryDocStore({ library, writeDelayMs: 20 });
    await store.load("doc");
    void store.append("doc", { origin: "local", update: update("a") });
    expect(library.rowCount("doc")).toBe(0);
    await store.flush();
    expect(library.rowCount("doc")).toBe(1);
  });
});
