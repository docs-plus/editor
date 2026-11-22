/**
 * IndexedDB for `bun test`: happy-dom has none, so web library tests use
 * `fake-indexeddb`. Each call is a fresh, empty browser profile, and nothing
 * is installed on `globalThis`, so tests can't leak databases into each
 * other.
 */
import {
  IDBFactory as FakeIDBFactory,
  IDBKeyRange as FakeIDBKeyRange,
  IDBObjectStore as FakeIDBObjectStore,
} from "fake-indexeddb";

import { DocStoreError } from "@/lib/platform/doc-store";
import { IdbDocStore } from "@/lib/platform/web/library/idb-doc-store";
import {
  type LibraryDb,
  type OpenLibraryOptions,
  openLibraryDb,
} from "@/lib/platform/web/library/library-db";
import { createLibraryDoc } from "@/lib/platform/web/library/library-docs";
import type { DocStoreLibrary } from "@/tests/helpers/doc-store-contract";

export type FakeBrowser = {
  factory: IDBFactory;
  keyRange: typeof IDBKeyRange;
  /** Opens a connection to the library, as one tab would. */
  open(
    options?: Omit<OpenLibraryOptions, "factory" | "keyRange">,
  ): Promise<LibraryDb>;
};

export function createFakeBrowser(): FakeBrowser {
  const factory = new FakeIDBFactory() as unknown as IDBFactory;
  const keyRange = FakeIDBKeyRange as unknown as typeof IDBKeyRange;
  return {
    factory,
    keyRange,
    open: (options = {}) => openLibraryDb({ ...options, factory, keyRange }),
  };
}

/** One library in a fresh fake browser, with one connection per client. */
export async function createFakeLibrary(): Promise<
  DocStoreLibrary & { browser: FakeBrowser; admin: LibraryDb }
> {
  const browser = createFakeBrowser();
  const admin = await browser.open();
  const connections: Promise<LibraryDb>[] = [];
  return {
    browser,
    admin,
    connect() {
      const library = browser.open();
      connections.push(library);
      return new IdbDocStore({ library });
    },
    async createDoc(docId, schema) {
      await createLibraryDoc(admin, { id: docId, schema });
    },
    async dispose() {
      for (const pending of connections) {
        (await pending.catch(() => null))?.close();
      }
      admin.close();
    },
  };
}

type FaultMode = "add" | "put";

/**
 * Makes the next readwrite transaction that calls `objectStore.<mode>` abort
 * with `QuotaExceededError`, the way a full disk reaches the page (§2.6):
 * the request runs, then the whole transaction rolls back. Returns the
 * function that disarms it.
 */
export function injectQuotaFault(
  times = 1,
  mode: FaultMode = "add",
): () => void {
  const proto = FakeIDBObjectStore.prototype as unknown as Record<
    FaultMode,
    (this: IDBObjectStore, ...args: unknown[]) => IDBRequest
  >;
  const original = proto[mode];
  let left = times;
  proto[mode] = function (this: IDBObjectStore, ...args: unknown[]) {
    const request = original.apply(this, args);
    if (left > 0 && this.transaction.mode === "readwrite") {
      left--;
      const tx = this.transaction as unknown as { _abort(name: string): void };
      // After the request runs, as a full disk aborts at commit.
      request.addEventListener("success", () =>
        tx._abort("QuotaExceededError"),
      );
    }
    return request;
  };
  return () => {
    proto[mode] = original;
  };
}

/** True when `error` is a `DocStoreError` with `code`. */
export function hasCode(error: unknown, code: string): boolean {
  return error instanceof DocStoreError && error.code === code;
}
