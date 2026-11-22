/**
 * Opening the web library's database and running its transactions (web
 * library §2.3, §2.4). One `LibraryDb` per tab: `IdbDocStore` and, later,
 * `IdbDocumentIndex` share it.
 *
 * Opening:
 * - `onupgradeneeded` creates the stores (`library-schema.ts`).
 * - `onblocked`: another tab holds an older version open. The open waits,
 *   and `library_upgrade_blocked` tells the person to close other tabs.
 * - `onversionchange`: a newer bundle in another tab wants to upgrade. The
 *   close hooks flush every queued write, then the connection closes and
 *   `library_reload` asks for a reload. Writes after that reject with
 *   `library_unavailable`, which is retryable, so the batcher keeps them.
 * - A database or `format_version` newer than this bundle knows opens
 *   read-only (`library_too_new`): reads work, writes reject.
 * - No IndexedDB, or an `open()` that fails: `library_unavailable`. There
 *   is never a silent fallback to memory.
 *
 * Transactions issue every request synchronously in the task that created
 * them (no `await` on anything but IndexedDB), and settle on `complete`,
 * never on request success: a write that later aborts (quota) must reject.
 */
import { DocStoreError } from "@/lib/platform/doc-store";

import {
  LIBRARY_DB_NAME,
  LIBRARY_DB_VERSION,
  LIBRARY_FORMAT_VERSION,
  META_KEYS,
  type MetaRow,
  STORES,
  type StoreName,
  upgradeLibrary,
} from "./library-schema";

/** Library-wide states the app health shows (web library §9). */
export type LibraryEvent =
  | "library_upgrade_blocked"
  | "library_reload"
  | "library_too_new";

export type OpenLibraryOptions = {
  /** Default `globalThis.indexedDB`; null or missing means unavailable. */
  factory?: IDBFactory | null;
  /** Default `globalThis.IDBKeyRange`: the one belonging to `factory`. */
  keyRange?: typeof IDBKeyRange;
  /** Default `tinydocy-library`. */
  name?: string;
  /** Default {@link LIBRARY_DB_VERSION}; tests open a later one to upgrade. */
  version?: number;
  now?: () => number;
  onEvent?: (event: LibraryEvent) => void;
};

/** `strict` for content and index writes, `relaxed` for caches (§2.3). */
export type WriteDurability = "strict" | "relaxed";

/** The DOMException name of a failed write, or of a request inside it. */
function errorName(error: unknown): string | undefined {
  return (error as { name?: unknown } | null)?.name as string | undefined;
}

/**
 * The `DocStoreError` for an IndexedDB failure. Quota comes as an aborted
 * transaction whose error is `QuotaExceededError` (§2.6); a closed
 * connection (another tab upgraded, or site data was cleared) throws
 * `InvalidStateError`. Everything else is an I/O error. All three are
 * retryable: the batcher keeps the batch and retries it in order. A
 * uniqueness clash (`ConstraintError`) is the caller's mistake.
 */
export function toDocStoreError(error: unknown): DocStoreError {
  if (error instanceof DocStoreError) return error;
  const name = errorName(error);
  if (name === "QuotaExceededError") {
    return new DocStoreError("quota_exceeded", "storage is full");
  }
  if (name === "InvalidStateError") {
    return new DocStoreError("library_unavailable", "the library is closed");
  }
  if (name === "ConstraintError") {
    return new DocStoreError("invalid_argument", "the row already exists");
  }
  return new DocStoreError("io_error", name ?? "the browser refused to save");
}

export class LibraryDb {
  private closedFlag = false;
  private readonly closeHooks = new Set<() => Promise<void>>();

  /** @internal Use {@link openLibraryDb}. */
  constructor(
    readonly db: IDBDatabase,
    /** A newer bundle wrote this library: reads only (`library_too_new`). */
    readonly readOnly: boolean,
    private readonly keyRange: typeof IDBKeyRange,
    private readonly onEvent: (event: LibraryEvent) => void,
  ) {
    db.onversionchange = () => void this.handleVersionChange();
    // The browser closed it (site data cleared, say): writes now reject.
    db.onclose = () => {
      this.closedFlag = true;
    };
  }

  get closed(): boolean {
    return this.closedFlag;
  }

  /**
   * Registers work to finish before an upgrade in another tab closes this
   * connection (a store's queued writes). Returns the unregister function.
   */
  addCloseHook(hook: () => Promise<void>): () => void {
    this.closeHooks.add(hook);
    return () => this.closeHooks.delete(hook);
  }

  close(): void {
    this.closedFlag = true;
    this.db.close();
  }

  /** Every `updates.by_doc` key of one document, in seq order. */
  docRange(docId: string): IDBKeyRange {
    return this.keyRange.bound([docId, 0], [docId, Number.POSITIVE_INFINITY]);
  }

  /** Rejects a write when this bundle may not write the library. */
  assertWritable(): void {
    if (this.readOnly) {
      throw new DocStoreError(
        "library_too_new",
        "a newer version of TinyDocy saved this library",
      );
    }
    if (this.closedFlag) {
      throw new DocStoreError("library_unavailable", "the library is closed");
    }
  }

  /**
   * Runs `body` in one transaction and settles once it commits. `body`
   * issues every request synchronously, may issue more from request
   * callbacks, and reports its value through `done`. `fail` aborts with a
   * chosen error; a throw from `body` or `fail` aborts too.
   */
  run<T>(
    stores: readonly StoreName[],
    mode: IDBTransactionMode,
    durability: WriteDurability | null,
    body: (tx: IDBTransaction, control: TransactionControl<T>) => void,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let tx: IDBTransaction;
      try {
        if (this.closedFlag)
          throw new DOMException("closed", "InvalidStateError");
        tx = durability
          ? this.db.transaction([...stores], mode, { durability })
          : this.db.transaction([...stores], mode);
      } catch (error) {
        reject(toDocStoreError(error));
        return;
      }
      let result: T;
      let failure: DocStoreError | null = null;
      const fail = (error: unknown) => {
        failure ??= toDocStoreError(error);
        try {
          tx.abort();
        } catch {
          // Already finished or aborting.
        }
      };
      tx.oncomplete = () => resolve(result);
      // The browser's reason (quota, a constraint) wins over ours: once it
      // aborts, later requests in `body` throw incidental errors.
      tx.onabort = () =>
        reject(
          tx.error
            ? toDocStoreError(tx.error)
            : (failure ?? new DocStoreError("io_error", "aborted")),
        );
      const control: TransactionControl<T> = {
        done: (value) => {
          result = value;
        },
        fail,
        guard:
          (fn) =>
          (...args) => {
            try {
              fn(...args);
            } catch (error) {
              fail(error);
            }
          },
      };
      try {
        body(tx, control);
      } catch (error) {
        fail(error);
      }
    });
  }

  /** @internal Flushes, closes and asks for a reload (another tab upgrades). */
  async handleVersionChange(): Promise<void> {
    if (this.closedFlag) return;
    await Promise.allSettled([...this.closeHooks].map((hook) => hook()));
    this.close();
    this.onEvent("library_reload");
  }
}

export type TransactionControl<T> = {
  /** Sets the value the transaction resolves with on `complete`. */
  done(value: T): void;
  /** Aborts the transaction; it rejects with this error. */
  fail(error: unknown): void;
  /** Wraps a request callback so a throw aborts the transaction. */
  guard<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void;
};

function openRequest(
  factory: IDBFactory,
  name: string,
  version: number | undefined,
  now: () => number,
  onEvent: (event: LibraryEvent) => void,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request =
        version === undefined
          ? factory.open(name)
          : factory.open(name, version);
    } catch (error) {
      reject(error);
      return;
    }
    request.onupgradeneeded = (event) => {
      try {
        upgradeLibrary(
          request.result,
          event.oldVersion,
          crypto.randomUUID(),
          now(),
        );
      } catch (error) {
        request.transaction?.abort();
        reject(error);
      }
    };
    request.onblocked = () => onEvent("library_upgrade_blocked");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function readFormatVersion(db: IDBDatabase): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(STORES.meta)) {
      resolve(undefined);
      return;
    }
    const request = db
      .transaction(STORES.meta, "readonly")
      .objectStore(STORES.meta)
      .get(META_KEYS.formatVersion);
    request.onsuccess = () =>
      resolve((request.result as MetaRow | undefined)?.value);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Opens the library, creating it on first use. Rejects with
 * `library_unavailable` when this browser won't store anything.
 */
export async function openLibraryDb(
  options: OpenLibraryOptions = {},
): Promise<LibraryDb> {
  const factory =
    options.factory === undefined
      ? (globalThis.indexedDB as IDBFactory | undefined)
      : options.factory;
  const keyRange =
    options.keyRange ??
    (globalThis.IDBKeyRange as typeof IDBKeyRange | undefined);
  const name = options.name ?? LIBRARY_DB_NAME;
  const now = options.now ?? Date.now;
  const onEvent = options.onEvent ?? (() => {});
  if (!factory || !keyRange) {
    throw new DocStoreError("library_unavailable", "IndexedDB is unavailable");
  }

  let db: IDBDatabase;
  let tooNew = false;
  try {
    db = await openRequest(
      factory,
      name,
      options.version ?? LIBRARY_DB_VERSION,
      now,
      onEvent,
    );
  } catch (error) {
    if (errorName(error) !== "VersionError") {
      throw new DocStoreError("library_unavailable", errorName(error));
    }
    // A newer bundle upgraded the database: open it as it is, read-only.
    try {
      db = await openRequest(factory, name, undefined, now, onEvent);
    } catch (retryError) {
      throw new DocStoreError("library_unavailable", errorName(retryError));
    }
    tooNew = true;
  }

  // A newer tab may ask to upgrade while the format is read: let it in at
  // once, and hand back a closed library that asks for a reload.
  let upgradedMeanwhile = false;
  db.onversionchange = () => {
    upgradedMeanwhile = true;
    db.close();
  };
  try {
    const format = await readFormatVersion(db);
    if (typeof format === "number" && format > LIBRARY_FORMAT_VERSION) {
      tooNew = true;
    }
  } catch (error) {
    db.close();
    if (!upgradedMeanwhile) {
      throw new DocStoreError("library_unavailable", errorName(error));
    }
  }

  if (tooNew) onEvent("library_too_new");
  const library = new LibraryDb(db, tooNew, keyRange, onEvent);
  if (upgradedMeanwhile) library.handleVersionChange();
  return library;
}
