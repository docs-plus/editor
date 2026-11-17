/**
 * `DocStore` cases for the desktop storage engine, written against the port
 * only. Framework-free (`node:assert`), so `bun test` runs them on
 * `bun:sqlite` and the Electron soak harness runs them on `node:sqlite` in
 * the real storage worker. P2.1's shared contract suite joins these once it
 * lands; these stay for the engine-specific rules (a library-wide seq,
 * `not_found` for a document that was never created).
 */
import assert from "node:assert/strict";

import * as Y from "yjs";

import { type DocStore, DocStoreError } from "@/lib/platform/doc-store";

export type StoreCaseContext = {
  /** One window's store; the same `owner` returns the same window. */
  store(owner: string): DocStore;
  /** Creates a document through the index and returns its id. */
  createDoc(): Promise<string>;
};

export type StoreCase = {
  name: string;
  run(context: StoreCaseContext): Promise<void>;
};

function edit(doc: Y.Doc, text: string): Uint8Array {
  let update: Uint8Array = new Uint8Array();
  doc.once("update", (u: Uint8Array) => {
    update = u;
  });
  const t = doc.getText("t");
  t.insert(t.length, text);
  return update;
}

function textOf(loaded: {
  snapshot: Uint8Array | null;
  updates: Uint8Array[];
}) {
  const doc = new Y.Doc();
  if (loaded.snapshot) Y.applyUpdate(doc, loaded.snapshot);
  for (const update of loaded.updates) Y.applyUpdate(doc, update);
  return doc.getText("t").toString();
}

async function rejection(promise: Promise<unknown>): Promise<DocStoreError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof DocStoreError, `not a DocStoreError: ${error}`);
    return error;
  }
  assert.fail("expected a rejection");
}

export const STORAGE_DOC_STORE_CASES: StoreCase[] = [
  {
    name: "a new document loads empty",
    async run({ store, createDoc }) {
      const id = await createDoc();
      assert.deepEqual(await store("w1").load(id), {
        snapshot: null,
        updates: [],
        maxSeq: 0,
        schema: 0,
      });
    },
  },
  {
    name: "appends load back in order with increasing seqs",
    async run({ store, createDoc }) {
      const id = await createDoc();
      const w1 = store("w1");
      await w1.load(id);
      const doc = new Y.Doc();
      const a = await w1.append(id, {
        origin: "local",
        update: edit(doc, "a"),
      });
      const b = await w1.append(id, {
        origin: "local",
        update: edit(doc, "b"),
      });
      assert.ok(b > a);
      const loaded = await w1.load(id);
      assert.equal(loaded.maxSeq, b);
      assert.equal(textOf(loaded), "ab");
    },
  },
  {
    name: "a resent append changes nothing",
    async run({ store, createDoc }) {
      const id = await createDoc();
      const w1 = store("w1");
      const update = edit(new Y.Doc(), "once");
      await w1.load(id);
      await w1.append(id, { origin: "local", update });
      await w1.append(id, { origin: "local", update });
      assert.equal(textOf(await w1.load(id)), "once");
    },
  },
  {
    name: "compaction folds covered rows into the snapshot and returns no foreign state",
    async run({ store, createDoc }) {
      const id = await createDoc();
      const w1 = store("w1");
      await w1.load(id);
      const doc = new Y.Doc();
      await w1.append(id, { origin: "local", update: edit(doc, "a") });
      const covered = await w1.append(id, {
        origin: "local",
        update: edit(doc, "b"),
      });
      const state = Y.encodeStateAsUpdate(doc);
      const late = await w1.append(id, {
        origin: "local",
        update: edit(doc, "c"),
      });
      assert.deepEqual(await w1.compact(id, state, covered), { foreign: null });
      const loaded = await w1.load(id);
      assert.ok(loaded.snapshot);
      assert.equal(loaded.updates.length, 1);
      assert.equal(loaded.maxSeq, late);
      assert.equal(textOf(loaded), "abc");
    },
  },
  {
    name: "a second window gets already_open until the first closes",
    async run({ store, createDoc }) {
      const id = await createDoc();
      await store("w1").load(id);
      const error = await rejection(store("w2").load(id));
      assert.equal(error.code, "already_open");
      assert.equal(error.retryable, false);
      await store("w1").close(id);
      assert.equal((await store("w2").load(id)).maxSeq, 0);
    },
  },
  {
    name: "flush resolves after every append already issued",
    async run({ store, createDoc }) {
      const id = await createDoc();
      const w1 = store("w1");
      await w1.load(id);
      const doc = new Y.Doc();
      const sent = ["a", "b", "c"].map((text) =>
        w1.append(id, { origin: "local", update: edit(doc, text) }),
      );
      await w1.flush();
      const seqs = await Promise.all(sent);
      assert.equal((await w1.load(id)).maxSeq, Math.max(...seqs));
    },
  },
  {
    name: "a rejected append writes nothing",
    async run({ store, createDoc }) {
      const id = await createDoc();
      const w1 = store("w1");
      await w1.load(id);
      const error = await rejection(
        w1.append(id, { origin: "local", update: new Uint8Array() }),
      );
      assert.equal(error.code, "invalid_argument");
      assert.deepEqual((await w1.load(id)).updates, []);
    },
  },
  {
    name: "a window that hasn't opened a document can't write it",
    async run({ store, createDoc }) {
      const id = await createDoc();
      const update = edit(new Y.Doc(), "x");
      const error = await rejection(
        store("w1").append(id, { origin: "local", update }),
      );
      assert.equal(error.code, "forbidden");
    },
  },
  {
    name: "an unknown document is not_found",
    async run({ store }) {
      const error = await rejection(store("w1").load(crypto.randomUUID()));
      assert.equal(error.code, "not_found");
    },
  },
];
