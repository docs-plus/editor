/**
 * The `DocStore` contract (desktop architecture §11): every store passes the
 * same cases. They run on `MemoryDocStore` under `bun test` today; P2.6 runs
 * them on the engine over `bun:sqlite` and over `node:sqlite` inside an
 * Electron worker, and W2 on `IdbDocStore` with `fake-indexeddb`.
 *
 * So the cases are plain data, `{ name, run(harness) }`, that assert with
 * `node:assert/strict` and use no Bun or DOM API and no timers. Any runner
 * registers them through `defineDocStoreContract`, which takes the runner's
 * own `describe` and `it`.
 *
 * What the cases rely on:
 * - Every document is made with `createDoc` first; an id never created is
 *   never loaded, so a store may reject one with `not_found`.
 * - A client always `load`s a document before writing it. Only the
 *   `exclusiveOpen` cases write without a load, and expect `forbidden`.
 * - Errors are matched by their `code` property, not by class.
 *
 * Content is compared through Yjs, never by counting rows: the desktop and
 * web compaction rules keep different rows for the same content.
 */
import assert from "node:assert/strict";

import * as Y from "yjs";

import {
  type DocStore,
  type DocStoreErrorCode,
  type LoadedDoc,
  UPDATE_ORIGINS,
} from "@/lib/platform/doc-store";

/** One empty library. Every case gets its own. */
export type DocStoreLibrary = {
  /** A new client of this library: one window (desktop) or tab (web). */
  connect(): DocStore;
  /** Creates the document's index row, as `DocumentIndex.create` would. */
  createDoc(docId: string, schema: number): Promise<void>;
  /** Releases files, handles and timers. */
  dispose(): Promise<void>;
};

export type DocStoreHarness = {
  createLibrary(): Promise<DocStoreLibrary>;
  /**
   * The store lets one client hold a document at a time (desktop: main's
   * open-document registry). False for the web library, where any tab may
   * append and a lease outside the store decides who edits.
   */
  exclusiveOpen: boolean;
};

export type DocStoreContractCase = {
  name: string;
  /** Skips the case when the store lacks this capability. */
  requires?: "exclusiveOpen";
  run(harness: DocStoreHarness): Promise<void>;
};

/** A Yjs update that inserts `text` at the end of the `t` text root of `from`. */
function edit(from: Y.Doc, text: string): Uint8Array {
  const before = Y.encodeStateVector(from);
  from.getText("t").insert(from.getText("t").length, text);
  return Y.encodeStateAsUpdate(from, before);
}

function docFrom(loaded: LoadedDoc): Y.Doc {
  const doc = new Y.Doc();
  if (loaded.snapshot) Y.applyUpdate(doc, loaded.snapshot);
  for (const update of loaded.updates) Y.applyUpdate(doc, update);
  return doc;
}

function textOf(loaded: LoadedDoc): string {
  return docFrom(loaded).getText("t").toString();
}

/** The loaded content has every struct of `reference` and nothing pending. */
function assertSameContent(loaded: LoadedDoc, reference: Y.Doc): void {
  const doc = docFrom(loaded);
  assert.equal(doc.getText("t").toString(), reference.getText("t").toString());
  assert.deepEqual(
    Y.decodeStateVector(Y.encodeStateVector(doc)),
    Y.decodeStateVector(Y.encodeStateVector(reference)),
  );
  assert.equal(doc.store.pendingStructs, null);
}

/**
 * The store rejected with `code`. Checked by property, not by class: the
 * storage engine may not import `lib/` at runtime (architecture §3.3), so its
 * errors are `{ code }`-shaped; the adapter turns them into `DocStoreError`.
 */
async function assertRejectsWith(
  promise: Promise<unknown>,
  code: DocStoreErrorCode,
): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.equal((error as { code?: unknown } | null)?.code, code);
    return true;
  });
}

/** Runs `body` with a fresh library and always disposes it. */
async function withLibrary(
  harness: DocStoreHarness,
  body: (library: DocStoreLibrary) => Promise<void>,
): Promise<void> {
  const library = await harness.createLibrary();
  try {
    await body(library);
  } finally {
    await library.dispose();
  }
}

export const DOC_STORE_CONTRACT: readonly DocStoreContractCase[] = [
  {
    name: "a new document loads empty with its schema",
    run: (harness) =>
      withLibrary(harness, async (library) => {
        await library.createDoc("doc-a", 3);
        const loaded = await library.connect().load("doc-a");
        assert.equal(loaded.snapshot, null);
        assert.deepEqual(loaded.updates, []);
        assert.equal(loaded.maxSeq, 0);
        assert.equal(loaded.schema, 3);
      }),
  },
  {
    name: "appends return increasing seqs and reload in order",
    run: (harness) =>
      withLibrary(harness, async (library) => {
        await library.createDoc("doc-a", 1);
        const store = library.connect();
        await store.load("doc-a");
        const source = new Y.Doc();
        const seqs: number[] = [];
        for (const text of ["one ", "two ", "three"]) {
          seqs.push(
            await store.append("doc-a", {
              origin: "local",
              update: edit(source, text),
            }),
          );
        }
        assert.ok(seqs[0] > 0 && seqs[0] < seqs[1] && seqs[1] < seqs[2]);
        await store.close("doc-a");

        const loaded = await library.connect().load("doc-a");
        assert.equal(loaded.updates.length, 3);
        assert.equal(loaded.maxSeq, seqs[2]);
        assert.equal(textOf(loaded), "one two three");
        assertSameContent(loaded, source);
      }),
  },
  {
    name: "seqs increase across documents",
    run: (harness) =>
      withLibrary(harness, async (library) => {
        await library.createDoc("doc-a", 1);
        await library.createDoc("doc-b", 1);
        const store = library.connect();
        await store.load("doc-a");
        await store.load("doc-b");
        const a = new Y.Doc();
        const b = new Y.Doc();
        const first = await store.append("doc-a", {
          origin: "local",
          update: edit(a, "a"),
        });
        const second = await store.append("doc-b", {
          origin: "local",
          update: edit(b, "b"),
        });
        const third = await store.append("doc-a", {
          origin: "local",
          update: edit(a, "a"),
        });
        assert.ok(first < second && second < third);
        await store.close("doc-b");
        assert.equal(textOf(await library.connect().load("doc-b")), "b");
      }),
  },
  {
    name: "accepts every stored origin",
    run: (harness) =>
      withLibrary(harness, async (library) => {
        await library.createDoc("doc-a", 1);
        const store = library.connect();
        await store.load("doc-a");
        const source = new Y.Doc();
        for (const origin of UPDATE_ORIGINS) {
          await store.append("doc-a", { origin, update: edit(source, origin) });
        }
        await store.close("doc-a");
        assertSameContent(await library.connect().load("doc-a"), source);
      }),
  },
  {
    name: "title and snippet never change the content",
    run: (harness) =>
      withLibrary(harness, async (library) => {
        await library.createDoc("doc-a", 1);
        const store = library.connect();
        await store.load("doc-a");
        const source = new Y.Doc();
        await store.append("doc-a", {
          origin: "local",
          update: edit(source, "Hello"),
          title: "Hello",
          snippet: "Hello world",
        });
        await store.close("doc-a");
        assertSameContent(await library.connect().load("doc-a"), source);
      }),
  },
  {
    name: "a migration append with schemaTo sets the schema",
    run: (harness) =>
      withLibrary(harness, async (library) => {
        await library.createDoc("doc-a", 1);
        const store = library.connect();
        await store.load("doc-a");
        const source = new Y.Doc();
        await store.append("doc-a", {
          origin: "migration",
          update: edit(source, "m"),
          schemaTo: 2,
        });
        await store.close("doc-a");
        assert.equal((await library.connect().load("doc-a")).schema, 2);
      }),
  },
  {
    name: "a resent append is harmless",
    run: (harness) =>
      withLibrary(harness, async (library) => {
        await library.createDoc("doc-a", 1);
        const store = library.connect();
        await store.load("doc-a");
        const source = new Y.Doc();
        const update = edit(source, "once");
        await store.append("doc-a", { origin: "local", update });
        await store.append("doc-a", { origin: "local", update });
        await store.append("doc-a", {
          origin: "local",
          update: edit(source, " more"),
        });
        await store.close("doc-a");
        const loaded = await library.connect().load("doc-a");
        assert.equal(textOf(loaded), "once more");
        assertSameContent(loaded, source);
      }),
  },
  {
    name: "the store keeps its own copy of appended bytes",
    run: (harness) =>
      withLibrary(harness, async (library) => {
        await library.createDoc("doc-a", 1);
        const store = library.connect();
        await store.load("doc-a");
        const source = new Y.Doc();
        const update = edit(source, "kept");
        await store.append("doc-a", { origin: "local", update });
        update.fill(0);
        await store.close("doc-a");
        assertSameContent(await library.connect().load("doc-a"), source);
      }),
  },
  {
    name: "compaction keeps the content and returns no foreign state",
    run: (harness) =>
      withLibrary(harness, async (library) => {
        await library.createDoc("doc-a", 1);
        const store = library.connect();
        await store.load("doc-a");
        const source = new Y.Doc();
        let upToSeq = 0;
        for (let i = 0; i < 20; i++) {
          upToSeq = await store.append("doc-a", {
            origin: "local",
            update: edit(source, `${i},`),
          });
        }
        const result = await store.compact(
          "doc-a",
          Y.encodeStateAsUpdate(source),
          upToSeq,
        );
        assert.equal(result.foreign, null);
        await store.close("doc-a");

        const loaded = await library.connect().load("doc-a");
        assert.notEqual(loaded.snapshot, null);
        assert.ok(loaded.maxSeq >= upToSeq);
        assertSameContent(loaded, source);
      }),
  },
  {
    name: "rows appended after the compacted seq survive compaction",
    run: (harness) =>
      withLibrary(harness, async (library) => {
        await library.createDoc("doc-a", 1);
        const store = library.connect();
        await store.load("doc-a");
        const source = new Y.Doc();
        const upToSeq = await store.append("doc-a", {
          origin: "local",
          update: edit(source, "before "),
        });
        const state = Y.encodeStateAsUpdate(source);
        // Queued while the state was encoded, appended before compact lands.
        const late = await store.append("doc-a", {
          origin: "local",
          update: edit(source, "after"),
        });
        await store.compact("doc-a", state, upToSeq);
        await store.close("doc-a");

        const loaded = await library.connect().load("doc-a");
        assert.equal(loaded.maxSeq, late);
        assert.equal(textOf(loaded), "before after");
        assertSameContent(loaded, source);
      }),
  },
  {
    name: "compacting again over a snapshot keeps everything",
    run: (harness) =>
      withLibrary(harness, async (library) => {
        await library.createDoc("doc-a", 1);
        const source = new Y.Doc();
        for (let round = 0; round < 3; round++) {
          const store = library.connect();
          const loaded = await store.load("doc-a");
          let upToSeq = loaded.maxSeq;
          for (let i = 0; i < 5; i++) {
            upToSeq = await store.append("doc-a", {
              origin: "local",
              update: edit(source, `${round}.${i} `),
            });
          }
          await store.compact("doc-a", Y.encodeStateAsUpdate(source), upToSeq);
          await store.close("doc-a");
        }
        assertSameContent(await library.connect().load("doc-a"), source);
      }),
  },
  {
    name: "flush resolves after the issued writes",
    run: (harness) =>
      withLibrary(harness, async (library) => {
        await library.createDoc("doc-a", 1);
        const store = library.connect();
        await store.load("doc-a");
        const source = new Y.Doc();
        const pending = store.append("doc-a", {
          origin: "local",
          update: edit(source, "flushed"),
        });
        await store.flush();
        await pending;
        await store.close("doc-a");
        assertSameContent(await library.connect().load("doc-a"), source);
      }),
  },
  {
    name: "documents are independent",
    run: (harness) =>
      withLibrary(harness, async (library) => {
        await library.createDoc("doc-a", 1);
        await library.createDoc("doc-b", 1);
        const store = library.connect();
        await store.load("doc-a");
        await store.load("doc-b");
        const a = new Y.Doc();
        const b = new Y.Doc();
        await store.append("doc-a", { origin: "local", update: edit(a, "A") });
        await store.append("doc-b", { origin: "local", update: edit(b, "B") });
        await store.compact("doc-a", Y.encodeStateAsUpdate(a), 0);
        await store.close("doc-a");
        await store.close("doc-b");
        const reader = library.connect();
        assertSameContent(await reader.load("doc-a"), a);
        assertSameContent(await reader.load("doc-b"), b);
      }),
  },
  {
    name: "loading again from the same client is allowed",
    run: (harness) =>
      withLibrary(harness, async (library) => {
        await library.createDoc("doc-a", 1);
        const store = library.connect();
        await store.load("doc-a");
        const source = new Y.Doc();
        await store.append("doc-a", {
          origin: "local",
          update: edit(source, "x"),
        });
        assertSameContent(await store.load("doc-a"), source);
      }),
  },
  {
    name: "another client cannot load an open document until it closes",
    requires: "exclusiveOpen",
    run: (harness) =>
      withLibrary(harness, async (library) => {
        await library.createDoc("doc-a", 1);
        const first = library.connect();
        const second = library.connect();
        await first.load("doc-a");
        await assertRejectsWith(second.load("doc-a"), "already_open");
        await first.close("doc-a");
        await second.load("doc-a");
        await assertRejectsWith(first.load("doc-a"), "already_open");
      }),
  },
  {
    name: "a client cannot write a document it does not hold",
    requires: "exclusiveOpen",
    run: (harness) =>
      withLibrary(harness, async (library) => {
        await library.createDoc("doc-a", 1);
        const store = library.connect();
        const source = new Y.Doc();
        const update = edit(source, "x");
        await assertRejectsWith(
          store.append("doc-a", { origin: "local", update }),
          "forbidden",
        );
        await assertRejectsWith(store.compact("doc-a", update, 0), "forbidden");
        await store.load("doc-a");
        await store.close("doc-a");
        await assertRejectsWith(
          store.append("doc-a", { origin: "local", update }),
          "forbidden",
        );
      }),
  },
];

/** The two functions every test runner has (`bun:test`, `node:test`, Mocha, Vitest). */
export type ContractRunner = {
  describe(name: string, body: () => void): void;
  it(name: string, body: () => Promise<void>): void;
};

/** Registers every contract case the harness supports under `describe(title)`. */
export function defineDocStoreContract(
  runner: ContractRunner,
  title: string,
  harness: DocStoreHarness,
): void {
  runner.describe(title, () => {
    for (const testCase of DOC_STORE_CONTRACT) {
      if (testCase.requires && !harness[testCase.requires]) continue;
      runner.it(testCase.name, () => testCase.run(harness));
    }
  });
}
