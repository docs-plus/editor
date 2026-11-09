import * as Y from "yjs";

/**
 * Bump when the editor schema changes in a way old local copies must not be
 * merged into: every copy under an older epoch is ignored and cleared.
 */
export const OFFLINE_CACHE_EPOCH = 1;
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
  /** `<epoch>:<server host>:<document name>` */
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
  all(): Promise<StoredDoc[]>;
  clear(): Promise<void>;
}

export function storeKey(serverHost: string, name: string): string {
  return `${OFFLINE_CACHE_EPOCH}:${serverHost}:${name}`;
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

  async load(name: string): Promise<Uint8Array | null> {
    const key = storeKey(this.serverHost, name);
    const stored = await this.backend.get(key);
    if (!stored) return null;
    if (!isCurrent(stored, this.now())) {
      await this.backend.delete(key);
      return null;
    }
    return stored.update;
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
  }

  async clear(): Promise<void> {
    await this.backend.clear();
  }

  /**
   * Deletes expired and other-epoch copies, copies whose names `isWanted`
   * rejects, and the least recently saved copies beyond `maxDocs`. Names in
   * `keep` (open or unsynced documents) are never deleted.
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
    const prefix = `${OFFLINE_CACHE_EPOCH}:${this.serverHost}:`;
    const docs = await this.backend.all();
    const removed: string[] = [];
    const survivors: StoredDoc[] = [];
    for (const doc of docs) {
      const ours = doc.key.startsWith(prefix);
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
    const evictable = survivors
      .filter((doc) => !keep.has(doc.name))
      .sort((a, b) => a.updatedAt - b.updatedAt);
    let excess = survivors.length - maxDocs;
    for (const doc of evictable) {
      if (excess <= 0) break;
      await this.backend.delete(doc.key);
      removed.push(doc.name);
      excess--;
    }
    return removed;
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
 * local or remote. Storage errors never break editing; they only disable
 * the local copy for this document.
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

  const hydrated = (hydrate ? store.load(name) : Promise.resolve(null))
    .then((update) => {
      if (destroyed || !update) return false;
      Y.applyUpdate(doc, update, LOCAL_ORIGIN);
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
  return {
    get: (key) => withStore("readonly", (s) => s.get(key)),
    put: async (doc) => {
      await withStore("readwrite", (s) => s.put(doc));
    },
    delete: async (key) => {
      await withStore("readwrite", (s) => s.delete(key));
    },
    all: () => withStore("readonly", (s) => s.getAll()),
    clear: async () => {
      await withStore("readwrite", (s) => s.clear());
    },
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
    all: async () => [...docs.values()],
    clear: async () => docs.clear(),
  };
}
