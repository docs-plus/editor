/**
 * `local-session`: the `DocSession` for documents whose authority is a local
 * `DocStore` (desktop architecture §5.1, D-A4). Desktop gives it an
 * `IpcDocStore`, the web library an `IdbDocStore`, tests and the dev bridge a
 * `MemoryDocStore`.
 *
 * open:    load (no timeout) → apply with HYDRATE_ORIGIN (never appended) →
 *          migration hook, before the editor binds → ready and authoritative
 * edits:   every other update goes to the batcher, origin mapped to a stored one
 * release: deferred, so a same-tick re-open reuses the session; then flush →
 *          compact → close
 */
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

import {
  Batcher,
  type BatcherHealth,
  type Clock,
  type DocSummary,
  systemClock,
} from "@/lib/platform/batcher";
import {
  type DocHandle,
  type DocHandleState,
  type DocSession,
  HYDRATE_ORIGIN,
  MIGRATION_ORIGIN,
  STORAGE_ORIGIN,
} from "@/lib/platform/doc-session";
import {
  type DocStore,
  DocStoreError,
  isDocStoreError,
  type LoadedDoc,
  type UpdateOrigin,
} from "@/lib/platform/doc-store";

/** A released session waits this long for a re-open before it closes. */
export const RELEASE_DELAY_MS = 1000;

/** One forward migration: brings a document from schema `to - 1` to `to`. */
export type DocMigration = {
  to: number;
  /** Runs inside a `MIGRATION_ORIGIN` transaction, outside undo. */
  migrate(doc: Y.Doc): void;
};

export type LocalSessionOptions = {
  store: DocStore;
  /** The schema this build writes (`DOC_SCHEMA`). Default 1. */
  schema?: number;
  /** The open hook's forward migrations; the list starts empty (architecture §5.1). */
  migrations?: readonly DocMigration[];
  clock?: Clock;
  /** Title and snippet for the index, read when a batch is sent. */
  describe?: (doc: Y.Doc) => DocSummary;
  /** Save health per document: `cant_save` and `saving_behind` (architecture §6.1). */
  onHealth?: (docId: string, health: BatcherHealth) => void;
  /** Runs compaction off the typing path. Default `requestIdleCallback`. */
  scheduleIdle?: (fn: () => void) => void;
};

const INITIAL_STATE: DocHandleState = {
  ready: false,
  authoritative: false,
  readOnlyReason: null,
  error: null,
};

/** An update that changes nothing: records a `schemaTo` when a migration had no edits. */
const EMPTY_UPDATE = Y.encodeStateAsUpdate(new Y.Doc());

type Entry = {
  docId: string;
  doc: Y.Doc;
  awareness: Awareness;
  state: DocHandleState;
  listeners: Set<() => void>;
  refs: number;
  releaseTimer: unknown;
  /** Set once loaded: from then on this session holds the document in the store. */
  batcher: Batcher | null;
  /** Updates made before the batcher exists; never dropped. */
  early: { origin: UpdateOrigin; update: Uint8Array }[];
  migratingTo: number | null;
  compacting: Promise<void> | null;
  closed: boolean;
};

function defaultScheduleIdle(fn: () => void): void {
  if (typeof requestIdleCallback === "function") requestIdleCallback(fn);
  else setTimeout(fn, 0);
}

export function createLocalSession(options: LocalSessionOptions): DocSession {
  const store = options.store;
  const clock = options.clock ?? systemClock;
  const schema = options.schema ?? 1;
  const migrations = [...(options.migrations ?? [])].sort(
    (a, b) => a.to - b.to,
  );
  const scheduleIdle = options.scheduleIdle ?? defaultScheduleIdle;
  const entries = new Map<string, Entry>();
  /** Sessions still flushing and closing, so a re-open waits for the store to let go. */
  const closing = new Map<string, Promise<void>>();

  function setState(entry: Entry, change: Partial<DocHandleState>): void {
    entry.state = { ...entry.state, ...change };
    for (const listener of entry.listeners) listener();
  }

  /** The stored origin of a Yjs transaction origin, or null if it came from storage. */
  function storedOrigin(origin: unknown): UpdateOrigin | null {
    if (origin === HYDRATE_ORIGIN || origin === STORAGE_ORIGIN) return null;
    if (origin === MIGRATION_ORIGIN) return "migration";
    // (Live) the provider maps to "remote" once `SyncAttachment` lands.
    return "local";
  }

  function onUpdate(entry: Entry, update: Uint8Array, origin: unknown): void {
    const stored = storedOrigin(origin);
    if (!stored) return;
    if (!entry.batcher) {
      entry.early.push({ origin: stored, update });
      return;
    }
    const schemaTo =
      stored === "migration" ? (entry.migratingTo ?? undefined) : undefined;
    entry.batcher.push(stored, update, schemaTo);
  }

  async function hydrate(entry: Entry): Promise<void> {
    await closing.get(entry.docId);
    let loaded: LoadedDoc;
    try {
      loaded = await store.load(entry.docId);
    } catch (error) {
      setState(entry, {
        error: isDocStoreError(error)
          ? error
          : new DocStoreError("library_unavailable", String(error)),
      });
      return;
    }
    if (entry.closed) {
      await store.close(entry.docId);
      return;
    }
    Y.transact(
      entry.doc,
      () => {
        if (loaded.snapshot) Y.applyUpdate(entry.doc, loaded.snapshot);
        for (const update of loaded.updates) Y.applyUpdate(entry.doc, update);
      },
      HYDRATE_ORIGIN,
    );
    const batcher = new Batcher({
      store,
      docId: entry.docId,
      loaded,
      clock,
      describe: options.describe && (() => options.describe?.(entry.doc) ?? {}),
      onHealth: (health) => options.onHealth?.(entry.docId, health),
      onCompactDue: () => scheduleIdle(() => void compact(entry)),
    });
    entry.batcher = batcher;
    for (const { origin, update } of entry.early) batcher.push(origin, update);
    entry.early = [];

    const readOnlyReason = loaded.schema > schema ? "doc_too_new" : null;
    if (!readOnlyReason && loaded.schema < schema) {
      migrate(entry, batcher, loaded.schema);
    }
    setState(entry, { ready: true, authoritative: true, readOnlyReason });
  }

  /**
   * Runs the pending migrations, appended as `migration`. A closing empty
   * update records `schemaTo` even when no migration changed anything; the
   * batcher merges it into the same append.
   */
  function migrate(entry: Entry, batcher: Batcher, from: number): void {
    for (const migration of migrations) {
      if (migration.to <= from || migration.to > schema) continue;
      entry.migratingTo = migration.to;
      entry.doc.transact(() => migration.migrate(entry.doc), MIGRATION_ORIGIN);
    }
    entry.migratingTo = null;
    batcher.push("migration", EMPTY_UPDATE, schema);
  }

  function compact(entry: Entry): Promise<void> {
    if (!entry.batcher || entry.closed) return Promise.resolve();
    entry.compacting ??= entry.batcher
      .compact(() => Y.encodeStateAsUpdate(entry.doc))
      .then(
        ({ foreign }) => {
          if (foreign) Y.applyUpdate(entry.doc, foreign, STORAGE_ORIGIN);
        },
        // A failed compaction loses nothing: the rows stay and it runs again.
        () => {},
      )
      .finally(() => {
        entry.compacting = null;
      });
    return entry.compacting;
  }

  async function close(entry: Entry): Promise<void> {
    entries.delete(entry.docId);
    const batcher = entry.batcher;
    if (batcher) {
      await batcher.flush();
      await entry.compacting;
      if (batcher.rowsSinceSnapshot > 0) await compact(entry);
      batcher.dispose();
    }
    // Set after the final compaction, so a load still in flight closes itself.
    entry.closed = true;
    if (batcher) await store.close(entry.docId);
    entry.awareness.destroy();
    entry.doc.destroy();
  }

  function startClose(entry: Entry): void {
    entry.releaseTimer = null;
    const done = close(entry).finally(() => {
      if (closing.get(entry.docId) === done) closing.delete(entry.docId);
    });
    closing.set(entry.docId, done);
  }

  function createEntry(docId: string): Entry {
    const doc = new Y.Doc();
    const entry: Entry = {
      docId,
      doc,
      awareness: new Awareness(doc),
      state: INITIAL_STATE,
      listeners: new Set(),
      refs: 0,
      releaseTimer: null,
      batcher: null,
      early: [],
      migratingTo: null,
      compacting: null,
      closed: false,
    };
    doc.on("update", (update: Uint8Array, origin: unknown) =>
      onUpdate(entry, update, origin),
    );
    entries.set(docId, entry);
    void hydrate(entry);
    return entry;
  }

  function handleFor(entry: Entry): DocHandle {
    let released = false;
    return {
      docId: entry.docId,
      doc: entry.doc,
      awareness: entry.awareness,
      provider: null,
      getState: () => entry.state,
      subscribe(listener) {
        entry.listeners.add(listener);
        return () => entry.listeners.delete(listener);
      },
      flush: () => entry.batcher?.flush() ?? Promise.resolve(),
      release() {
        if (released) return;
        released = true;
        entry.refs--;
        if (entry.refs > 0) return;
        entry.releaseTimer = clock.setTimeout(
          () => startClose(entry),
          RELEASE_DELAY_MS,
        );
      },
    };
  }

  return {
    open(docId) {
      const entry = entries.get(docId) ?? createEntry(docId);
      if (entry.releaseTimer !== null) {
        clock.clearTimeout(entry.releaseTimer);
        entry.releaseTimer = null;
      }
      entry.refs++;
      return handleFor(entry);
    },
    async flush() {
      await Promise.all(
        [...entries.values()].map((entry) => entry.batcher?.flush()),
      );
    },
  };
}
