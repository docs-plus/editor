/**
 * The web library's IndexedDB shape (web library §2.2; offline data-model
 * revision §3.2, §3.6): every store and index of version 1, the null-free
 * index keys, the derived-state columns, eviction detection, and an upgrade
 * over a populated library.
 */
import { describe, expect, it } from "bun:test";

import * as Y from "yjs";

import {
  DERIVED_FIELDS,
  PLATFORM_ONLY_FIELDS,
  WEB_INDEX_SENTINELS,
} from "@/lib/library-format/fields";
import {
  EVICTION_MARKER_KEY,
  libraryWasCleared,
  readEvictionMarker,
  writeEvictionMarker,
} from "@/lib/platform/web/library/eviction";
import { IdbDocStore } from "@/lib/platform/web/library/idb-doc-store";
import type { LibraryDb } from "@/lib/platform/web/library/library-db";
import { createLibraryDoc } from "@/lib/platform/web/library/library-docs";
import {
  type DocRow,
  LIBRARY_DB_NAME,
  LIBRARY_DB_VERSION,
  LIBRARY_FORMAT_VERSION,
  META_KEYS,
  type MetaRow,
  preMigrationCopyName,
  STORES,
  type StoreName,
  type UpdateRow,
} from "@/lib/platform/web/library/library-schema";
import { createFakeBrowser } from "@/tests/helpers/fake-idb";

type IndexShape = { keyPath: string | string[]; unique: boolean };
type StoreShape = {
  keyPath: string | string[] | null;
  autoIncrement: boolean;
  indexes: Record<string, IndexShape>;
};

/**
 * Version 1, store by store. Changing this table means a new
 * `LIBRARY_DB_VERSION` and an `upgradeLibrary` step (§3.6 version rule).
 */
const V1: Record<StoreName, StoreShape> = {
  meta: { keyPath: "key", autoIncrement: false, indexes: {} },
  docs: {
    keyPath: "id",
    autoIncrement: false,
    indexes: {
      by_folder: { keyPath: "list_key", unique: false },
      by_opened: { keyPath: "opened_at", unique: false },
      by_modified: { keyPath: "modified_at", unique: false },
      by_link_key: { keyPath: "link_key", unique: true },
      by_stale: { keyPath: "stale", unique: false },
    },
  },
  snapshots: { keyPath: "doc_id", autoIncrement: false, indexes: {} },
  updates: {
    keyPath: "seq",
    autoIncrement: true,
    indexes: { by_doc: { keyPath: ["doc_id", "seq"], unique: false } },
  },
  folders: {
    keyPath: "id",
    autoIncrement: false,
    indexes: { by_parent: { keyPath: "parent_key", unique: false } },
  },
  tags: {
    keyPath: "id",
    autoIncrement: false,
    indexes: { by_name_key: { keyPath: "name_key", unique: true } },
  },
  doc_tags: {
    keyPath: ["doc_id", "tag_id"],
    autoIncrement: false,
    indexes: { by_tag: { keyPath: "tag_id", unique: false } },
  },
  doc_view: { keyPath: "doc_id", autoIncrement: false, indexes: {} },
  md: { keyPath: "doc_id", autoIncrement: false, indexes: {} },
  import_sources: {
    keyPath: "doc_id",
    autoIncrement: false,
    indexes: { by_source_hash: { keyPath: "source_hash", unique: false } },
  },
  remotes: {
    keyPath: "doc_id",
    autoIncrement: false,
    indexes: { by_share: { keyPath: "share_id", unique: false } },
  },
  blobs: { keyPath: "hash", autoIncrement: false, indexes: {} },
  doc_blobs: {
    keyPath: ["doc_id", "hash", "kind"],
    autoIncrement: false,
    indexes: { by_hash: { keyPath: "hash", unique: false } },
  },
  links: {
    keyPath: ["src_doc_id", "ord"],
    autoIncrement: false,
    indexes: {
      by_target: { keyPath: ["target_key", "src_doc_id"], unique: false },
    },
  },
  headings: {
    keyPath: ["doc_id", "ord"],
    autoIncrement: false,
    indexes: {
      by_toc: { keyPath: ["doc_id", "toc_id"], unique: false },
      by_text_key: { keyPath: "text_key", unique: false },
    },
  },
};

function shapeOf(db: IDBDatabase): Record<string, StoreShape> {
  const names = [...db.objectStoreNames];
  const tx = db.transaction(names, "readonly");
  const shape: Record<string, StoreShape> = {};
  for (const name of names) {
    const store = tx.objectStore(name);
    const indexes: Record<string, IndexShape> = {};
    for (const indexName of [...store.indexNames]) {
      const index = store.index(indexName);
      indexes[indexName] = {
        keyPath: index.keyPath as string | string[],
        unique: index.unique,
      };
    }
    shape[name] = {
      keyPath: store.keyPath as string | string[] | null,
      autoIncrement: store.autoIncrement,
      indexes,
    };
  }
  return shape;
}

/** Every value of one store, or of one of its indexes for `query`. */
function readAll<T>(
  library: LibraryDb,
  store: StoreName,
  index?: string,
  query?: IDBValidKey | IDBKeyRange,
): Promise<T[]> {
  return library.run<T[]>([store], "readonly", null, (tx, { done }) => {
    const source = tx.objectStore(store);
    const request = (index ? source.index(index) : source).getAll(query);
    request.onsuccess = () => done(request.result as T[]);
  });
}

function put(library: LibraryDb, store: StoreName, value: unknown) {
  return library.run<void>([store], "readwrite", "strict", (tx, { done }) => {
    tx.objectStore(store).put(value);
    done(undefined);
  });
}

async function docRow(library: LibraryDb, id: string): Promise<DocRow> {
  const row = (await readAll<DocRow>(library, STORES.docs)).find(
    (candidate) => candidate.id === id,
  );
  if (!row) throw new Error(`no docs row ${id}`);
  return row;
}

const ids = (rows: { id: string }[]) => rows.map((row) => row.id);

function edit(from: Y.Doc, text: string): Uint8Array {
  const before = Y.encodeStateVector(from);
  from.getText("t").insert(from.getText("t").length, text);
  return Y.encodeStateAsUpdate(from, before);
}

describe("fake-indexeddb rejects invalid keys as browsers do", () => {
  it("leaves a record with a null or boolean index key out, and refuses such a primary key", async () => {
    const library = await createFakeBrowser().open();
    await createLibraryDoc(library, { id: "real" });
    const base = await docRow(library, "real");
    await put(library, STORES.docs, {
      ...base,
      id: "bool",
      link_key: "b".repeat(32),
      stale: true,
    });
    await put(library, STORES.docs, {
      ...base,
      id: "null",
      link_key: "c".repeat(32),
      stale: null,
    });
    expect(
      ids(await readAll<DocRow>(library, STORES.docs, "by_stale")),
    ).toEqual(["real"]);
    // A compound primary key with a null or boolean part: DataError.
    for (const bad of [null, false]) {
      await expect(
        put(library, STORES.links, { src_doc_id: "real", ord: bad }),
      ).rejects.toMatchObject({ code: "io_error", message: "DataError" });
    }
    library.close();
  });
});

describe("tinydocy-library version 1", () => {
  it("creates exactly the version 1 stores and indexes", async () => {
    const library = await createFakeBrowser().open();
    expect(LIBRARY_DB_VERSION).toBe(1);
    expect(shapeOf(library.db)).toEqual(V1);
    library.close();
  });

  it("lists root and in-folder documents not in Trash under by_folder [folder or '', '']", async () => {
    const library = await createFakeBrowser().open();
    await createLibraryDoc(library, { id: "root" });
    await createLibraryDoc(library, { id: "inside", folderId: "f1" });
    expect(
      ids(await readAll<DocRow>(library, STORES.docs, "by_folder", ["", ""])),
    ).toEqual(["root"]);
    expect(
      ids(await readAll<DocRow>(library, STORES.docs, "by_folder", ["f1", ""])),
    ).toEqual(["inside"]);
    library.close();
  });

  it("leaves never-opened documents out of by_opened (Recent lists opened ones)", async () => {
    const library = await createFakeBrowser().open();
    await createLibraryDoc(library, { id: "never" });
    await put(library, STORES.docs, {
      ...(await docRow(library, "never")),
      id: "opened",
      link_key: "d".repeat(32),
      opened_at: 5,
    });
    expect(
      ids(await readAll<DocRow>(library, STORES.docs, "by_opened")),
    ).toEqual(["opened"]);
    library.close();
  });

  it("creates a document stale, with head_seq 0 and a normalized title key", async () => {
    const library = await createFakeBrowser().open();
    await createLibraryDoc(library, { id: "doc", title: "Résumé Notes" });
    expect(await docRow(library, "doc")).toMatchObject({
      head_seq: 0,
      derived_seq: null,
      links_hash: null,
      headings_hash: null,
      stale: 1,
      title_key: "resume notes",
      list_key: ["", ""],
    });
    expect(
      ids(await readAll<DocRow>(library, STORES.docs, "by_stale", 1)),
    ).toEqual(["doc"]);
    library.close();
  });

  it("raises head_seq on append, keeps it on compact, and keeps stale in step", async () => {
    const library = await createFakeBrowser().open();
    await createLibraryDoc(library, { id: "doc" });
    // As if the derive queue had caught up at seq 0.
    await put(library, STORES.docs, {
      ...(await docRow(library, "doc")),
      derived_seq: 0,
      stale: 0,
    });
    expect(
      ids(await readAll<DocRow>(library, STORES.docs, "by_stale", 0)),
    ).toEqual(["doc"]);

    const store = new IdbDocStore({ library });
    await store.load("doc");
    const doc = new Y.Doc();
    const seq = await store.append("doc", {
      origin: "local",
      update: edit(doc, "x"),
      title: "Ünïcode Title",
    });
    expect(await docRow(library, "doc")).toMatchObject({
      head_seq: seq,
      stale: 1,
      title_key: "unicode title",
    });
    expect(
      ids(await readAll<DocRow>(library, STORES.docs, "by_stale", 1)),
    ).toEqual(["doc"]);

    await store.compact("doc", Y.encodeStateAsUpdate(doc), seq);
    expect(await docRow(library, "doc")).toMatchObject({
      head_seq: seq,
      stale: 1,
    });
    await store.dispose();
    library.close();
  });

  it("keys doc_blobs in snake_case and links and headings by [id, ord]", async () => {
    const library = await createFakeBrowser().open();
    const hash = "a".repeat(64);
    const target = "e".repeat(32);
    await put(library, STORES.docBlobs, {
      doc_id: "doc",
      hash,
      kind: "current",
      dropped_at: null,
    });
    await put(library, STORES.links, {
      src_doc_id: "doc",
      ord: 0,
      src_toc_id: "",
      target_key: target,
      target_toc_id: "",
      text: "a link",
      context: "",
    });
    await put(library, STORES.headings, {
      doc_id: "doc",
      ord: 0,
      toc_id: "h1",
      level: 1,
      text: "Intro",
      text_key: "intro",
    });
    expect(
      (await readAll(library, STORES.docBlobs, "by_hash", hash)).length,
    ).toBe(1);
    expect(
      (await readAll(library, STORES.links, "by_target", [target, "doc"]))
        .length,
    ).toBe(1);
    expect(
      (await readAll(library, STORES.headings, "by_toc", ["doc", "h1"])).length,
    ).toBe(1);
    expect(
      (await readAll(library, STORES.headings, "by_text_key", "intro")).length,
    ).toBe(1);
    library.close();
  });
});

describe("versions and copies (§3.6)", () => {
  it("names the forced pre-migration copy after the format it was taken at", () => {
    expect(preMigrationCopyName(1)).toBe("tinydocy-library.pre-v1");
    expect(preMigrationCopyName(LIBRARY_FORMAT_VERSION)).not.toBe(
      LIBRARY_DB_NAME,
    );
  });

  it("upgrades a populated library without changing a store, an index or a byte", async () => {
    const browser = createFakeBrowser();
    const v1 = await browser.open();
    const store = new IdbDocStore({ library: v1 });
    const docs = new Map<string, Y.Doc>();
    for (const id of ["one", "two"]) {
      await createLibraryDoc(v1, { id, title: id });
      await store.load(id);
      const doc = new Y.Doc();
      docs.set(id, doc);
      let seq = 0;
      for (let i = 0; i < 4; i++) {
        seq = await store.append(id, {
          origin: "local",
          update: edit(doc, `${id}${i} `),
        });
      }
      // "one" is compacted, "two" keeps every row.
      if (id === "one") {
        await store.compact(id, Y.encodeStateAsUpdate(doc), seq);
      }
    }
    await store.dispose();
    const before = {
      shape: shapeOf(v1.db),
      updates: await readAll<UpdateRow>(v1, STORES.updates),
      docs: await readAll<DocRow>(v1, STORES.docs),
      meta: await readAll<MetaRow>(v1, STORES.meta),
      snapshots: await readAll(v1, STORES.snapshots),
    };
    v1.close();

    const v2 = await browser.open({ version: LIBRARY_DB_VERSION + 1 });
    expect(v2.db.version).toBe(LIBRARY_DB_VERSION + 1);
    expect(shapeOf(v2.db)).toEqual(before.shape);
    // The `updates` invariant: the same rows, seqs and bytes, in order.
    expect(await readAll<UpdateRow>(v2, STORES.updates)).toEqual(
      before.updates,
    );
    expect(await readAll<DocRow>(v2, STORES.docs)).toEqual(before.docs);
    expect(await readAll<MetaRow>(v2, STORES.meta)).toEqual(before.meta);
    expect(await readAll(v2, STORES.snapshots)).toEqual(before.snapshots);
    const reader = new IdbDocStore({ library: v2 });
    for (const [id, doc] of docs) {
      const loaded = await reader.load(id);
      const copy = new Y.Doc();
      if (loaded.snapshot) Y.applyUpdate(copy, loaded.snapshot);
      for (const update of loaded.updates) Y.applyUpdate(copy, update);
      expect(copy.getText("t").toString()).toBe(doc.getText("t").toString());
    }
    await reader.dispose();
    v2.close();
  });
});

describe("eviction detection (§3.6)", () => {
  /** A `localStorage` stand-in; `broken` throws like blocked site data. */
  function memoryStorage(broken = false) {
    const values = new Map<string, string>();
    return {
      values,
      getItem(key: string) {
        if (broken) throw new DOMException("denied", "SecurityError");
        return values.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        if (broken) throw new DOMException("denied", "SecurityError");
        values.set(key, value);
      },
    };
  }

  it("writes the library id as the meta sentinel at creation and reads it at open", async () => {
    const browser = createFakeBrowser();
    const first = await browser.open();
    const meta = await readAll<MetaRow>(first, STORES.meta);
    const id = meta.find((row) => row.key === META_KEYS.libraryId)?.value;
    expect(typeof id).toBe("string");
    expect(
      meta.find((row) => row.key === META_KEYS.evictionSentinel)?.value,
    ).toBe(id);
    expect(first.evictionSentinel).toBe(id as string);
    first.close();
    const again = await browser.open();
    expect(again.evictionSentinel).toBe(id as string);
    again.close();
  });

  it("reports a cleared library only when the marker names a library that is gone", async () => {
    const storage = memoryStorage();
    const before = await createFakeBrowser().open();
    const sentinel = before.evictionSentinel as string;
    before.close();

    // First visit: no marker, nothing to report.
    expect(libraryWasCleared(readEvictionMarker(storage), sentinel)).toBe(
      false,
    );
    expect(writeEvictionMarker(storage, sentinel)).toBe(true);
    expect(storage.values.get(EVICTION_MARKER_KEY)).toBe(sentinel);
    expect(libraryWasCleared(readEvictionMarker(storage), sentinel)).toBe(
      false,
    );

    // The browser cleared IndexedDB: the next open creates a new library.
    const after = await createFakeBrowser().open();
    expect(
      libraryWasCleared(readEvictionMarker(storage), after.evictionSentinel),
    ).toBe(true);
    // A library with no sentinel row reads as cleared too.
    expect(libraryWasCleared(readEvictionMarker(storage), null)).toBe(true);
    after.close();
  });

  it("reads a missing or throwing localStorage as no marker", () => {
    expect(readEvictionMarker(undefined)).toBeNull();
    expect(readEvictionMarker(memoryStorage(true))).toBeNull();
    expect(writeEvictionMarker(undefined, "id")).toBe(false);
    expect(writeEvictionMarker(memoryStorage(true), "id")).toBe(false);
  });
});

describe("library.json field lists (§3.6)", () => {
  /** `table.field` for every listed field ("*" means the whole table). */
  const flat = (tables: Record<string, readonly string[] | "*">) =>
    Object.entries(tables).flatMap(([table, fields]) =>
      fields === "*" ? [`${table}.*`] : fields.map((f) => `${table}.${f}`),
    );

  it("lists the platform-only fields the spec names, and no field twice", () => {
    const platformOnly = [
      ...flat(PLATFORM_ONLY_FIELDS.web),
      ...flat(PLATFORM_ONLY_FIELDS.desktop),
    ];
    expect(platformOnly).toEqual([
      "docs.exported_at",
      "docs.md_at",
      "updates.writer",
      "snapshots.rev",
      "docs.mirrored_at",
    ]);
    const all = [
      ...platformOnly,
      ...flat(WEB_INDEX_SENTINELS),
      ...flat(DERIVED_FIELDS),
    ];
    expect(new Set(all).size).toBe(all.length);
  });
});
