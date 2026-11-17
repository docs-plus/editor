import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type { Library } from "@/desktop/storage/engine/library";
import { dispatch } from "@/desktop/storage/protocol";
import type { DocStore } from "@/lib/platform/doc-store";
import { createEngineDocStore } from "@/tests/helpers/engine-doc-store";
import { STORAGE_DOC_STORE_CASES } from "@/tests/helpers/storage-doc-store-cases";
import {
  createClock,
  createTempDir,
  createTestHost,
  openTestLibrary,
} from "@/tests/helpers/storage-library";

let temp: ReturnType<typeof createTempDir>;
let library: Library;

beforeEach(() => {
  temp = createTempDir();
  library = openTestLibrary(temp.dir, createTestHost(createClock()));
});
afterEach(() => {
  library.shutdown();
  temp.cleanUp();
});

describe("DocStore over the engine (bun:sqlite)", () => {
  for (const testCase of STORAGE_DOC_STORE_CASES)
    test(testCase.name, async () => {
      const stores = new Map<string, DocStore>();
      await testCase.run({
        store(owner) {
          let store = stores.get(owner);
          if (!store) {
            store = createEngineDocStore(library, owner);
            stores.set(owner, store);
          }
          return store;
        },
        createDoc: async () => library.createDoc().id,
      });
    });
});

describe("dispatch", () => {
  test("a metadata write reports the new rev", () => {
    const { result, rev } = dispatch(library, {
      id: 1,
      op: "createFolder",
      args: { name: "A" },
    });
    expect(result.ok).toBe(true);
    expect(rev).toBe(library.sidebar().rev);
  });

  test("a failure comes back as an envelope, never a throw", () => {
    const { result, rev } = dispatch(library, {
      id: 2,
      op: "load",
      args: { docId: "nope", owner: "w1" },
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "not_found", retryable: false },
    });
    expect(rev).toBeNull();
  });
});
