import { afterEach, describe, expect, it } from "bun:test";

import * as Y from "yjs";

import type { AppendRecord } from "@/lib/platform/doc-store";
import { IdbDocStore } from "@/lib/platform/web/library/idb-doc-store";
import { createLibraryDoc } from "@/lib/platform/web/library/library-docs";
import {
  META_KEYS,
  type MetaRow,
  STORES,
  type UpdateRow,
} from "@/lib/platform/web/library/library-schema";
import { defineDocStoreContract } from "@/tests/helpers/doc-store-contract";
import {
  createFakeBrowser,
  createFakeLibrary,
  hasCode,
  injectQuotaFault,
} from "@/tests/helpers/fake-idb";

defineDocStoreContract(
  { describe, it },
  "DocStore contract: IdbDocStore (fake-indexeddb)",
  { exclusiveOpen: false, createLibrary: createFakeLibrary },
);

/** A Yjs update that appends `text` to the `t` root of `from`. */
function edit(from: Y.Doc, text: string): Uint8Array {
  const before = Y.encodeStateVector(from);
  from.getText("t").insert(from.getText("t").length, text);
  return Y.encodeStateAsUpdate(from, before);
}

function local(update: Uint8Array): AppendRecord {
  return { origin: "local", update };
}

/** The text a fresh client loads. */
async function storedText(
  library: Awaited<ReturnType<typeof createFakeLibrary>>,
  docId = "doc",
): Promise<string> {
  const loaded = await library.connect().load(docId);
  const doc = new Y.Doc();
  if (loaded.snapshot) Y.applyUpdate(doc, loaded.snapshot);
  for (const update of loaded.updates) Y.applyUpdate(doc, update);
  return doc.getText("t").toString();
}

let disarm: (() => void) | null = null;
afterEach(() => {
  disarm?.();
  disarm = null;
});

describe("IdbDocStore: several writers (W-D3)", () => {
  it("keeps a row it never applied when it compacts (the §2.5 counterexample)", async () => {
    const library = await createFakeLibrary();
    await library.createDoc("doc", 1);
    const a = library.connect();
    const b = library.connect();
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    await a.load("doc");
    await b.load("doc");

    let upTo = 0;
    upTo = await a.append("doc", local(edit(docA, "A1 ")));
    // B, stale, appends a row A never sees.
    await b.append("doc", local(edit(docB, "B1 ")));
    upTo = await a.append("doc", local(edit(docA, "A2 ")));
    await a.compact("doc", Y.encodeStateAsUpdate(docA), upTo);

    const text = await storedText(library);
    expect(text).toContain("B1");
    expect(text).toContain("A1");
    expect(text).toContain("A2");
    await library.dispose();
  });

  it("merges another tab's snapshot and returns it as foreign", async () => {
    const library = await createFakeLibrary();
    await library.createDoc("doc", 1);
    const a = library.connect();
    const b = library.connect();
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    await a.load("doc");
    await b.load("doc");

    const seqB = await b.append("doc", local(edit(docB, "from B")));
    const first = await b.compact("doc", Y.encodeStateAsUpdate(docB), seqB);
    expect(first.foreign).toBeNull();

    const seqA = await a.append("doc", local(edit(docA, "from A")));
    const { foreign } = await a.compact(
      "doc",
      Y.encodeStateAsUpdate(docA),
      seqA,
    );
    expect(foreign).not.toBeNull();
    Y.applyUpdate(docA, foreign as Uint8Array);
    expect(docA.getText("t").toString()).toContain("from B");

    // A now holds B's content, so compacting again merges nothing.
    const again = await a.compact("doc", Y.encodeStateAsUpdate(docA), seqA);
    expect(again.foreign).toBeNull();
    const text = await storedText(library);
    expect(text).toContain("from A");
    expect(text).toContain("from B");
    await library.dispose();
  });

  it("keeps another tab's content when a compact's foreign was never applied", async () => {
    const library = await createFakeLibrary();
    await library.createDoc("doc", 1);
    const a = library.connect();
    const b = library.connect();
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    await a.load("doc");
    await b.load("doc");

    const seqB = await b.append("doc", local(edit(docB, "from B")));
    await b.compact("doc", Y.encodeStateAsUpdate(docB), seqB);
    let seqA = await a.append("doc", local(edit(docA, "from A")));
    const first = await a.compact("doc", Y.encodeStateAsUpdate(docA), seqA);
    expect(first.foreign).not.toBeNull();
    // The caller drops `foreign` (its apply threw, say): B's rows are gone,
    // so the next compact must still merge the stored snapshot.
    seqA = await a.append("doc", local(edit(docA, " again")));
    const second = await a.compact("doc", Y.encodeStateAsUpdate(docA), seqA);
    expect(second.foreign).not.toBeNull();
    const text = await storedText(library);
    expect(text).toContain("from B");
    expect(text).toContain("again");

    // Once the caller applies it, compaction stops merging.
    Y.applyUpdate(docA, second.foreign as Uint8Array);
    const third = await a.compact("doc", Y.encodeStateAsUpdate(docA), seqA);
    expect(third.foreign).toBeNull();
    expect(await storedText(library)).toContain("from B");
    await library.dispose();
  });

  it("loads rows below the snapshot's seq that another tab left", async () => {
    const library = await createFakeLibrary();
    await library.createDoc("doc", 1);
    const a = library.connect();
    const b = library.connect();
    const docA = new Y.Doc();
    await a.load("doc");
    await b.load("doc");
    await b.append("doc", local(edit(new Y.Doc(), "early B")));
    const seqA = await a.append("doc", local(edit(docA, "late A")));
    await a.compact("doc", Y.encodeStateAsUpdate(docA), seqA);

    const loaded = await library.connect().load("doc");
    expect(loaded.updates.length).toBe(1);
    expect(loaded.maxSeq).toBe(seqA);
    expect(await storedText(library)).toContain("early B");
    await library.dispose();
  });

  it("keeps size_bytes equal to the stored bytes after compaction", async () => {
    const library = await createFakeLibrary();
    await library.createDoc("doc", 1);
    const store = library.connect();
    const doc = new Y.Doc();
    await store.load("doc");
    let seq = 0;
    for (let i = 0; i < 5; i++) {
      seq = await store.append("doc", local(edit(doc, `${i}`)));
    }
    const state = Y.encodeStateAsUpdate(doc);
    await store.compact("doc", state, seq);
    const row = await library.admin.run<{ size_bytes: number }>(
      [STORES.docs],
      "readonly",
      null,
      (tx, { done }) => {
        const request = tx.objectStore(STORES.docs).get("doc");
        request.onsuccess = () => done(request.result);
      },
    );
    expect(row.size_bytes).toBe(state.byteLength);
    await library.dispose();
  });
});

describe("IdbDocStore: writes", () => {
  it("records title, snippet, schema and the writer with each append", async () => {
    const library = await createFakeLibrary();
    await library.createDoc("doc", 1);
    const store = new IdbDocStore({
      library: library.browser.open(),
      writer: "test writer",
      now: () => 42,
    });
    await store.load("doc");
    await store.append("doc", {
      origin: "migration",
      update: edit(new Y.Doc(), "x"),
      title: "T".repeat(300),
      snippet: "S",
      schemaTo: 2,
    });
    const { doc, rows } = await library.admin.run<{
      doc: { title: string; snippet: string; modified_at: number };
      rows: UpdateRow[];
    }>([STORES.docs, STORES.updates], "readonly", null, (tx, { done }) => {
      const docRequest = tx.objectStore(STORES.docs).get("doc");
      const rowsRequest = tx.objectStore(STORES.updates).getAll();
      rowsRequest.onsuccess = () =>
        done({ doc: docRequest.result, rows: rowsRequest.result });
    });
    expect(doc.title.length).toBe(200);
    expect(doc.snippet).toBe("S");
    expect(doc.modified_at).toBe(42);
    expect(rows[0]).toMatchObject({
      doc_id: "doc",
      origin: "migration",
      writer: "test writer",
      created_at: 42,
    });
    await library.dispose();
  });

  it("commits content writes with strict durability", async () => {
    const library = await createFakeLibrary();
    await library.createDoc("doc", 1);
    const connection = await library.browser.open();
    const seen: unknown[] = [];
    const original = connection.db.transaction.bind(connection.db);
    connection.db.transaction = ((
      names: string[],
      mode: IDBTransactionMode,
      options?: IDBTransactionOptions,
    ) => {
      if (mode === "readwrite") seen.push(options?.durability);
      return original(names, mode, options);
    }) as typeof connection.db.transaction;
    const store = new IdbDocStore({ library: connection });
    const doc = new Y.Doc();
    await store.load("doc");
    const seq = await store.append("doc", local(edit(doc, "x")));
    await store.compact("doc", Y.encodeStateAsUpdate(doc), seq);
    expect(seen).toEqual(["strict", "strict"]);
    await library.dispose();
    connection.close();
  });

  it("rejects an unknown document with not_found", async () => {
    const library = await createFakeLibrary();
    const store = library.connect();
    await expect(store.load("missing")).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(
      store.append("missing", local(edit(new Y.Doc(), "x"))),
    ).rejects.toMatchObject({ code: "not_found" });
    await library.dispose();
  });

  it("rejects bad input with invalid_argument", async () => {
    const library = await createFakeLibrary();
    await library.createDoc("doc", 1);
    const store = library.connect();
    await store.load("doc");
    await expect(
      store.append("doc", local(new Uint8Array())),
    ).rejects.toMatchObject({ code: "invalid_argument" });
    await expect(
      store.append("doc", {
        origin: "pasted" as never,
        update: edit(new Y.Doc(), "x"),
      }),
    ).rejects.toMatchObject({ code: "invalid_argument" });
    await expect(
      store.compact("doc", new Uint8Array([0, 0]), -1),
    ).rejects.toMatchObject({ code: "invalid_argument" });
    await library.dispose();
  });

  it("refuses a duplicate document id", async () => {
    const library = await createFakeLibrary();
    await library.createDoc("doc", 1);
    await expect(
      createLibraryDoc(library.admin, { id: "doc" }),
    ).rejects.toMatchObject({ code: "invalid_argument" });
    await library.dispose();
  });
});

describe("IdbDocStore: the index rev (§4.1)", () => {
  /** `meta.rev`, the index change counter. */
  const readRev = (library: Awaited<ReturnType<typeof createFakeLibrary>>) =>
    library.admin.run<unknown>(
      [STORES.meta],
      "readonly",
      null,
      (tx, { done }) => {
        const request = tx.objectStore(STORES.meta).get(META_KEYS.rev);
        request.onsuccess = () =>
          done((request.result as MetaRow | undefined)?.value);
      },
    );

  it("leaves meta.rev alone on append and compact; only index writes bump it", async () => {
    const library = await createFakeLibrary();
    await library.createDoc("doc", 1);
    const afterCreate = await readRev(library);
    expect(afterCreate).toBe(1);
    const store = library.connect();
    const doc = new Y.Doc();
    await store.load("doc");
    const seq = await store.append("doc", {
      ...local(edit(doc, "x")),
      title: "A new title",
      snippet: "and a snippet",
    });
    await store.compact("doc", Y.encodeStateAsUpdate(doc), seq);
    expect(await readRev(library)).toBe(afterCreate);
    await library.dispose();
  });
});

describe("IdbDocStore: lifetime", () => {
  it("forgets a document on close and everything on dispose", async () => {
    const library = await createFakeLibrary();
    await library.createDoc("one", 1);
    await library.createDoc("two", 1);
    const connection = await library.browser.open();
    const hooksBefore = connection.closeHookCount;
    const store = new IdbDocStore({ library: connection });
    await store.load("one");
    await store.load("two");
    expect(store.openDocCount).toBe(2);
    expect(connection.closeHookCount).toBe(hooksBefore + 1);
    await store.close("one");
    expect(store.openDocCount).toBe(1);
    await store.dispose();
    expect(store.openDocCount).toBe(0);
    expect(connection.closeHookCount).toBe(hooksBefore);
    connection.close();
    await library.dispose();
  });

  it("disposes cleanly when the library never opened", async () => {
    const { openLibraryDb } = await import(
      "@/lib/platform/web/library/library-db"
    );
    const store = new IdbDocStore({
      library: openLibraryDb({ factory: null }),
    });
    await store.dispose();
    expect(store.openDocCount).toBe(0);
  });
});

describe("IdbDocStore: quota and failures (§2.6)", () => {
  it("rejects an append that hits the quota and writes nothing", async () => {
    const library = await createFakeLibrary();
    await library.createDoc("doc", 1);
    const store = library.connect();
    const doc = new Y.Doc();
    await store.load("doc");
    await store.append("doc", local(edit(doc, "kept ")));

    disarm = injectQuotaFault();
    const failed = store.append("doc", local(edit(doc, "retried")));
    const error = await failed.catch((e) => e);
    expect(hasCode(error, "quota_exceeded")).toBe(true);
    expect(error.retryable).toBe(true);
    expect(await storedText(library)).toBe("kept ");

    // The batcher resends the same bytes once space is back.
    disarm();
    disarm = null;
    const resend = Y.encodeStateAsUpdate(doc);
    await store.append("doc", local(resend));
    expect(await storedText(library)).toBe("kept retried");
    await library.dispose();
  });

  it("rejects a compaction that hits the quota and keeps every row", async () => {
    const library = await createFakeLibrary();
    await library.createDoc("doc", 1);
    const store = library.connect();
    const doc = new Y.Doc();
    await store.load("doc");
    const seq = await store.append("doc", local(edit(doc, "safe")));
    disarm = injectQuotaFault(1, "put");
    await expect(
      store.compact("doc", Y.encodeStateAsUpdate(doc), seq),
    ).rejects.toMatchObject({ code: "quota_exceeded" });
    const loaded = await library.connect().load("doc");
    expect(loaded.snapshot).toBeNull();
    expect(loaded.updates.length).toBe(1);
    await library.dispose();
  });

  it("flush waits for a failed write to settle", async () => {
    const library = await createFakeLibrary();
    await library.createDoc("doc", 1);
    const store = library.connect();
    await store.load("doc");
    disarm = injectQuotaFault();
    const failed = store.append("doc", local(edit(new Y.Doc(), "x")));
    failed.catch(() => {});
    await store.flush();
    await expect(failed).rejects.toMatchObject({ code: "quota_exceeded" });
    await library.dispose();
  });
});

describe("IdbDocStore: unavailable library", () => {
  it("rejects every call with library_unavailable when IndexedDB is missing", async () => {
    const { openLibraryDb } = await import(
      "@/lib/platform/web/library/library-db"
    );
    const store = new IdbDocStore({
      library: openLibraryDb({ factory: null }),
    });
    await expect(store.load("doc")).rejects.toMatchObject({
      code: "library_unavailable",
    });
    await expect(
      store.append("doc", local(edit(new Y.Doc(), "x"))),
    ).rejects.toMatchObject({ code: "library_unavailable" });
  });

  it("rejects writes after the browser closes the connection, and keeps them retryable", async () => {
    const { forceCloseDatabase } = await import("fake-indexeddb");
    const browser = createFakeBrowser();
    const connection = await browser.open();
    await createLibraryDoc(connection, { id: "doc", schema: 1 });
    const store = new IdbDocStore({ library: connection });
    await store.load("doc");
    forceCloseDatabase(connection.db as never);
    const error = await store
      .append("doc", local(edit(new Y.Doc(), "x")))
      .catch((e) => e);
    expect(hasCode(error, "library_unavailable")).toBe(true);
    expect(error.retryable).toBe(true);
  });
});
