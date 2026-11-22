import { describe, expect, it } from "bun:test";

import * as Y from "yjs";

import { IdbDocStore } from "@/lib/platform/web/library/idb-doc-store";
import {
  type LibraryEvent,
  openLibraryDb,
  toDocStoreError,
} from "@/lib/platform/web/library/library-db";
import { createLibraryDoc } from "@/lib/platform/web/library/library-docs";
import {
  LIBRARY_DB_NAME,
  LIBRARY_FORMAT_VERSION,
  META_KEYS,
  type MetaRow,
  STORE_NAMES_V1,
  STORES,
} from "@/lib/platform/web/library/library-schema";
import { createFakeBrowser } from "@/tests/helpers/fake-idb";

function update(text: string): Uint8Array {
  const doc = new Y.Doc();
  doc.getText("t").insert(0, text);
  return Y.encodeStateAsUpdate(doc);
}

function rawOpen(factory: IDBFactory, version?: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request =
      version === undefined
        ? factory.open(LIBRARY_DB_NAME)
        : factory.open(LIBRARY_DB_NAME, version);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function readMeta(db: IDBDatabase): Promise<MetaRow[]> {
  return new Promise((resolve, reject) => {
    const request = db
      .transaction(STORES.meta, "readonly")
      .objectStore(STORES.meta)
      .getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function writeMeta(db: IDBDatabase, row: MetaRow): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.meta, "readwrite");
    tx.objectStore(STORES.meta).put(row);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

const until = async (check: () => boolean) => {
  for (let i = 0; i < 200 && !check(); i++) {
    await new Promise((r) => setTimeout(r, 1));
  }
};

describe("openLibraryDb: schema v1 (§2.2)", () => {
  it("creates every store and the meta rows on first open", async () => {
    const browser = createFakeBrowser();
    const library = await browser.open({ now: () => 7 });
    expect([...library.db.objectStoreNames].sort()).toEqual(
      [...STORE_NAMES_V1].sort(),
    );
    expect(library.db.name).toBe("tinydocy-library");
    expect(library.readOnly).toBe(false);
    const meta = Object.fromEntries(
      (await readMeta(library.db)).map((row) => [row.key, row.value]),
    );
    expect(meta[META_KEYS.formatVersion]).toBe(LIBRARY_FORMAT_VERSION);
    expect(meta[META_KEYS.yjsEncoding]).toBe("v1");
    expect(meta[META_KEYS.createdAt]).toBe(7);
    expect(meta[META_KEYS.rev]).toBe(0);
    expect(String(meta[META_KEYS.libraryId])).toMatch(/^[0-9a-f-]{36}$/);
    library.close();
  });

  it("keeps the library id across opens and counts index writes in rev", async () => {
    const browser = createFakeBrowser();
    const first = await browser.open();
    const id = (await readMeta(first.db)).find(
      (row) => row.key === META_KEYS.libraryId,
    )?.value;
    await createLibraryDoc(first, { id: "doc" });
    first.close();
    const second = await browser.open();
    const meta = await readMeta(second.db);
    expect(meta.find((row) => row.key === META_KEYS.libraryId)?.value).toBe(id);
    expect(meta.find((row) => row.key === META_KEYS.rev)?.value).toBe(1);
    second.close();
  });

  it("mints a lineage and a 32-hex link key for every new document", async () => {
    const browser = createFakeBrowser();
    const library = await browser.open();
    const a = await createLibraryDoc(library);
    const b = await createLibraryDoc(library);
    expect(a.linkKey).toMatch(/^[0-9a-f]{32}$/);
    expect(a.linkKey).not.toBe(b.linkKey);
    expect(a.lineage).not.toBe(b.lineage);
    library.close();
  });
});

describe("openLibraryDb: versions and old tabs (§2.4)", () => {
  it("opens read-only when format_version is newer than this bundle", async () => {
    const browser = createFakeBrowser();
    const writer = await browser.open();
    await createLibraryDoc(writer, { id: "doc", schema: 1 });
    await writeMeta(writer.db, {
      key: META_KEYS.formatVersion,
      value: LIBRARY_FORMAT_VERSION + 1,
    });
    writer.close();

    const events: LibraryEvent[] = [];
    const library = await browser.open({ onEvent: (e) => events.push(e) });
    expect(library.readOnly).toBe(true);
    expect(events).toEqual(["library_too_new"]);
    const store = new IdbDocStore({ library });
    expect((await store.load("doc")).schema).toBe(1);
    await expect(
      store.append("doc", { origin: "local", update: update("x") }),
    ).rejects.toMatchObject({ code: "library_too_new" });
    await expect(store.compact("doc", update("x"), 0)).rejects.toMatchObject({
      code: "library_too_new",
    });
    await expect(createLibraryDoc(library)).rejects.toMatchObject({
      code: "library_too_new",
    });
    library.close();
  });

  it("opens read-only when a newer bundle upgraded the database version", async () => {
    const browser = createFakeBrowser();
    (await browser.open()).close();
    (await rawOpen(browser.factory, 2)).close();

    const events: LibraryEvent[] = [];
    const library = await browser.open({ onEvent: (e) => events.push(e) });
    expect(library.readOnly).toBe(true);
    expect(library.db.version).toBe(2);
    expect(events).toEqual(["library_too_new"]);
    library.close();
  });

  it("reports library_upgrade_blocked while an old tab keeps the database open", async () => {
    const browser = createFakeBrowser();
    const oldTab = await rawOpen(browser.factory, 1);
    const events: LibraryEvent[] = [];
    const opening = browser.open({
      version: 2,
      onEvent: (e) => events.push(e),
    });
    await until(() => events.length > 0);
    expect(events).toEqual(["library_upgrade_blocked"]);
    oldTab.close();
    const library = await opening;
    expect(library.db.version).toBe(2);
    library.close();
  });

  it("flushes issued writes, closes and asks for a reload when another tab upgrades", async () => {
    const browser = createFakeBrowser();
    const events: LibraryEvent[] = [];
    const library = await browser.open({ onEvent: (e) => events.push(e) });
    await createLibraryDoc(library, { id: "doc", schema: 1 });
    const store = new IdbDocStore({ library });
    await store.load("doc");

    const inFlight = store.append("doc", {
      origin: "local",
      update: update("saved before the upgrade"),
    });
    const newer = await rawOpen(browser.factory, 2);
    await inFlight;
    expect(library.closed).toBe(true);
    expect(events).toEqual(["library_reload"]);

    const after = await store
      .append("doc", { origin: "local", update: update("later") })
      .catch((e) => e);
    expect(after.code).toBe("library_unavailable");
    expect(after.retryable).toBe(true);

    const rows = await new Promise<unknown[]>((resolve) => {
      const request = newer
        .transaction(STORES.updates, "readonly")
        .objectStore(STORES.updates)
        .getAll();
      request.onsuccess = () => resolve(request.result);
    });
    expect(rows.length).toBe(1);
    newer.close();
  });
});

describe("openLibraryDb: unavailable (§2.4)", () => {
  it("rejects with library_unavailable when there is no IndexedDB", async () => {
    await expect(openLibraryDb({ factory: null })).rejects.toMatchObject({
      code: "library_unavailable",
    });
  });

  it("rejects with library_unavailable when open() throws", async () => {
    const browser = createFakeBrowser();
    const factory = {
      open() {
        throw new DOMException("denied", "SecurityError");
      },
    } as unknown as IDBFactory;
    await expect(
      openLibraryDb({ factory, keyRange: browser.keyRange }),
    ).rejects.toMatchObject({ code: "library_unavailable" });
  });
});

describe("toDocStoreError", () => {
  it("maps browser failures to retryable store errors", () => {
    const quota = toDocStoreError(
      new DOMException("full", "QuotaExceededError"),
    );
    expect(quota.code).toBe("quota_exceeded");
    expect(quota.retryable).toBe(true);
    expect(toDocStoreError(new DOMException("x", "UnknownError")).code).toBe(
      "io_error",
    );
    expect(
      toDocStoreError(new DOMException("x", "InvalidStateError")).code,
    ).toBe("library_unavailable");
    expect(toDocStoreError(null).code).toBe("io_error");
  });
});
