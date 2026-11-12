import * as Y from "yjs";

/**
 * Bump when the editor schema changes in a way old local copies must not be
 * merged into: every copy under an older epoch is ignored and cleared.
 */
export const OFFLINE_CACHE_EPOCH = 1;
/**
 * Namespace for copies written by schema-aware bundles. Hardcoded, never
 * derived from CLIENT_SCHEMA: pre-N bundles only read and prune keys without
 * it, so they can never load or merge these copies.
 */
export const OFFLINE_NAMESPACE = "s2";
/** Copies older than this are dropped. Keep below TOMBSTONE_RETENTION_DAYS. */
export const OFFLINE_DOC_MAX_AGE_DAYS = 14;
/** At most this many documents are kept on the device. */
export const OFFLINE_MAX_DOCS = 30;
/** Origin for updates applied from the local copy. */
export const LOCAL_ORIGIN = Symbol("tinydocy-local-copy");

const DAY_MS = 24 * 60 * 60 * 1000;
const DB_NAME = "tinydocy-offline";
const STORE = "docs";

export type StoredDoc = {
  /** `<epoch>:<server host>~s2:<document name>`, or the legacy `<epoch>:<server host>:<document name>` */
  key: string;
  name: string;
  update: Uint8Array;
  updatedAt: number;
};

/** Persistence backend: IndexedDB in browsers, a Map in tests. */
export interface DocStoreBackend {
  get(key: string): Promise<StoredDoc | undefined>;
  put(doc: StoredDoc): Promise<void>;
  delete(key: string): Promise<void>;
  /**
   * Deletes `key` only if it still holds a copy with this `updatedAt` and
   * byte length, checked and deleted atomically. True if it was deleted.
   */
  deleteIfUnchanged(
    key: string,
    expected: { updatedAt: number; byteLength: number },
  ): Promise<boolean>;
  all(): Promise<StoredDoc[]>;
  clear(): Promise<void>;
}

export function storeKey(serverHost: string, name: string): string {
  return `${OFFLINE_CACHE_EPOCH}:${serverHost}~${OFFLINE_NAMESPACE}:${name}`;
}

/** Key pre-N bundles read and write; merged into `storeKey` on load. */
export function legacyStoreKey(serverHost: string, name: string): string {
  return `${OFFLINE_CACHE_EPOCH}:${serverHost}:${name}`;
}

/** The saved copy plus a legacy copy still waiting to be merged. */
export type LoadedCopy = {
  current: Uint8Array | null;
  legacy: StoredDoc | null;
};

function isUnchanged(
  doc: StoredDoc | undefined,
  expected: { updatedAt: number; byteLength: number },
): boolean {
  return (
    doc !== undefined &&
    doc.updatedAt === expected.updatedAt &&
    doc.update.byteLength === expected.byteLength
  );
}

function isCurrent(doc: StoredDoc, now: number): boolean {
  return (
    doc.key.startsWith(`${OFFLINE_CACHE_EPOCH}:`) &&
    now - doc.updatedAt < OFFLINE_DOC_MAX_AGE_DAYS * DAY_MS
  );
}

/** Local copies of collaborative documents, scoped to one collab server. */
export class LocalDocStore {
  constructor(
    private readonly backend: DocStoreBackend,
    private readonly serverHost: string,
    private readonly now: () => number = Date.now,
  ) {}

  /** Both copies of `name`, or null if neither exists (expired ones are deleted). */
  async load(name: string): Promise<LoadedCopy | null> {
    const current = await this.read(storeKey(this.serverHost, name));
    const legacy = await this.read(legacyStoreKey(this.serverHost, name));
    if (!current && !legacy) return null;
    return { current: current?.update ?? null, legacy };
  }

  private async read(key: string): Promise<StoredDoc | null> {
    const stored = await this.backend.get(key);
    if (!stored) return null;
    if (!isCurrent(stored, this.now())) {
      await this.backend.delete(key);
      return null;
    }
    return stored;
  }

  /**
   * Deletes the legacy copy once it is merged and saved, unless a pre-N tab
   * rewrote it since `legacy` was loaded. True if it was deleted.
   */
  async retireLegacy(name: string, legacy: StoredDoc): Promise<boolean> {
    return this.backend.deleteIfUnchanged(
      legacyStoreKey(this.serverHost, name),
      { updatedAt: legacy.updatedAt, byteLength: legacy.update.byteLength },
    );
  }

  async save(name: string, update: Uint8Array): Promise<void> {
    await this.backend.put({
      key: storeKey(this.serverHost, name),
      name,
      update,
      updatedAt: this.now(),
    });
  }

  async remove(name: string): Promise<void> {
    await this.backend.delete(storeKey(this.serverHost, name));
    await this.backend.delete(legacyStoreKey(this.serverHost, name));
  }

  async clear(): Promise<void> {
    await this.backend.clear();
  }

  /**
   * Deletes expired and other-epoch copies, copies whose names `isWanted`
   * rejects, and the least recently saved documents beyond `maxDocs` (both
   * keys of a document count once and go together). Names in `keep` (open
   * or unsynced documents) are never deleted. Current and legacy keys of
   * this server follow the same rules.
   */
  async prune({
    keep,
    isWanted = () => true,
    maxDocs = OFFLINE_MAX_DOCS,
  }: {
    keep: ReadonlySet<string>;
    isWanted?: (name: string) => boolean;
    maxDocs?: number;
  }): Promise<string[]> {
    const now = this.now();
    const prefixes = [
      storeKey(this.serverHost, ""),
      legacyStoreKey(this.serverHost, ""),
    ];
    const docs = await this.backend.all();
    const removed: string[] = [];
    const survivors: StoredDoc[] = [];
    for (const doc of docs) {
      const ours = prefixes.some((prefix) => doc.key.startsWith(prefix));
      const stale = !isCurrent(doc, now);
      if (keep.has(doc.name) && ours && !stale) {
        survivors.push(doc);
        continue;
      }
      if (!ours && !stale) continue; // another server's live copy
      if (stale || !isWanted(doc.name)) {
        await this.backend.delete(doc.key);
        removed.push(doc.name);
      } else {
        survivors.push(doc);
      }
    }
    const byName = new Map<string, StoredDoc[]>();
    for (const doc of survivors) {
      byName.set(doc.name, [...(byName.get(doc.name) ?? []), doc]);
    }
    const lastSaved = (copies: StoredDoc[]) =>
      Math.max(...copies.map((doc) => doc.updatedAt));
    const evictable = [...byName]
      .filter(([name]) => !keep.has(name))
      .sort(([, a], [, b]) => lastSaved(a) - lastSaved(b));
    let excess = byName.size - maxDocs;
    for (const [name, copies] of evictable) {
      if (excess <= 0) break;
      for (const doc of copies) await this.backend.delete(doc.key);
      removed.push(name);
      excess--;
    }
    return [...new Set(removed)];
  }
}

export type LocalBinding = {
  /** Resolves once the local copy (if any) is applied; true if it had content. */
  hydrated: Promise<boolean>;
  /** Writes pending changes now. */
  flush(): Promise<void>;
  destroy(): void;
};

/**
 * Mirrors `doc` into the store: applies the saved copy first (with
 * LOCAL_ORIGIN), then saves the compacted state shortly after every change,
 * local or remote. A legacy copy is merged too, saved under the current key,
 * and only then retired. Storage errors never break editing; they only
 * disable the local copy for this document.
 */
export function bindLocalCopy(
  doc: Y.Doc,
  name: string,
  store: LocalDocStore,
  {
    debounceMs = 750,
    hydrate = true,
  }: {
    debounceMs?: number;
    /** False to only save (the copy was not read in time). */
    hydrate?: boolean;
  } = {},
): LocalBinding {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let destroyed = false;
  let disabled = false;
  let migration: Promise<void> | undefined;

  const write = async () => {
    timer = undefined;
    if (disabled || destroyed) return;
    try {
      await store.save(name, Y.encodeStateAsUpdate(doc));
    } catch {
      disabled = true;
    }
  };
  const onUpdate = (_update: Uint8Array, origin: unknown) => {
    if (origin === LOCAL_ORIGIN || disabled) return;
    clearTimeout(timer);
    timer = setTimeout(write, debounceMs);
  };

  // LOCAL_ORIGIN updates never reach onUpdate, so the merged state is saved
  // explicitly; the legacy copy is deleted only once that save succeeded.
  const migrate = async (legacy: StoredDoc, merged: Uint8Array) => {
    try {
      await store.save(name, merged);
    } catch {
      disabled = true;
      return;
    }
    try {
      await store.retireLegacy(name, legacy);
    } catch {
      // Kept; the next load merges it again.
    }
  };

  const hydrated = (hydrate ? store.load(name) : Promise.resolve(null))
    .then((copy) => {
      if (destroyed || !copy) return false;
      if (copy.current) Y.applyUpdate(doc, copy.current, LOCAL_ORIGIN);
      if (copy.legacy) {
        Y.applyUpdate(doc, copy.legacy.update, LOCAL_ORIGIN);
        migration = migrate(copy.legacy, Y.encodeStateAsUpdate(doc));
      }
      return true;
    })
    .catch(() => {
      disabled = true;
      return false;
    })
    .finally(() => {
      if (!destroyed) doc.on("update", onUpdate);
    });

  return {
    hydrated,
    async flush() {
      await migration;
      if (!timer) return;
      clearTimeout(timer);
      await write();
    },
    destroy() {
      destroyed = true;
      clearTimeout(timer);
      doc.off("update", onUpdate);
    },
  };
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** IndexedDB backend, or null where IndexedDB is unavailable (SSR, some private modes). */
export function createIndexedDbBackend(): DocStoreBackend | null {
  if (typeof indexedDB === "undefined") return null;
  let dbPromise: Promise<IDBDatabase> | null = null;
  const open = () => {
    dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE, { keyPath: "key" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  };
  const withStore = async <T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> => {
    const db = await open();
    return request(run(db.transaction(STORE, mode).objectStore(STORE)));
  };
  /**
   * Runs `run` in one readwrite transaction and settles on commit, not on
   * request success: a write that later aborts (quota) must reject, or the
   * caller would treat an unsaved copy as saved.
   */
  const commit = async <T>(
    run: (store: IDBObjectStore, done: (value: T) => void) => void,
  ): Promise<T> => {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      let result: T;
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
      run(tx.objectStore(STORE), (value) => {
        result = value;
      });
    });
  };
  return {
    get: (key) => withStore("readonly", (s) => s.get(key)),
    put: (doc) =>
      commit<void>((s) => {
        s.put(doc);
      }),
    delete: (key) =>
      commit<void>((s) => {
        s.delete(key);
      }),
    // Check and delete in one transaction with no await in between, so a
    // pre-N tab cannot rewrite the copy after the check.
    deleteIfUnchanged: (key, expected) =>
      commit<boolean>((s, done) => {
        done(false);
        const req = s.get(key);
        req.onsuccess = () => {
          if (!isUnchanged(req.result as StoredDoc | undefined, expected)) {
            return;
          }
          s.delete(key);
          done(true);
        };
      }),
    all: () => withStore("readonly", (s) => s.getAll()),
    clear: () =>
      commit<void>((s) => {
        s.clear();
      }),
  };
}

/** In-memory backend for tests and environments without IndexedDB. */
export function createMemoryBackend(): DocStoreBackend {
  const docs = new Map<string, StoredDoc>();
  return {
    get: async (key) => docs.get(key),
    put: async (doc) => {
      docs.set(doc.key, doc);
    },
    delete: async (key) => {
      docs.delete(key);
    },
    deleteIfUnchanged: async (key, expected) => {
      if (!isUnchanged(docs.get(key), expected)) return false;
      docs.delete(key);
      return true;
    },
    all: async () => [...docs.values()],
    clear: async () => docs.clear(),
  };
}
