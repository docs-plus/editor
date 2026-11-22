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
  /** The schema this build writes (`DOC_SCHEMA` from `lib/doc-migrations`). Default 0. */
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
  compacting: Promise<void> | null;
  /** `load` succeeded, so `close` must give the document back to the store. */
  held: boolean;
  closed: boolean;
};

/** A session being flushed and closed after its release delay. */
type Closing = { done: Promise<void>; batcher: Batcher | null };

function defaultScheduleIdle(fn: () => void): void {
  if (typeof requestIdleCallback === "function") requestIdleCallback(fn);
  else setTimeout(fn, 0);
}

export function createLocalSession(options: LocalSessionOptions): DocSession {
  const store = options.store;
  const clock = options.clock ?? systemClock;
  const schema = options.schema ?? 0;
  const migrations = [...(options.migrations ?? [])].sort(
    (a, b) => a.to - b.to,
  );
  const scheduleIdle = options.scheduleIdle ?? defaultScheduleIdle;
  const entries = new Map<string, Entry>();
  /**
   * Sessions still flushing and closing: a re-open waits for the store to
   * let go, and `flush()` (quit) still covers their last batches.
   */
  const closing = new Map<string, Closing>();

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
    entry.batcher.push(stored, update);
  }

  function fail(entry: Entry, error: DocStoreError): void {
    setState(entry, { error });
  }

  /** Drops the entry, so the next `open` starts a new session. */
  function forget(entry: Entry): void {
    if (entries.get(entry.docId) === entry) entries.delete(entry.docId);
  }

  async function hydrate(entry: Entry): Promise<void> {
    await closing.get(entry.docId)?.done;
    let loaded: LoadedDoc;
    try {
      loaded = await store.load(entry.docId);
    } catch (error) {
      // Not held (another window has it, say): the next open tries again.
      fail(
        entry,
        isDocStoreError(error)
          ? error
          : new DocStoreError("library_unavailable", String(error)),
      );
      forget(entry);
      return;
    }
    entry.held = true;
    if (entry.closed) {
      await store.close(entry.docId);
      return;
    }
    try {
      Y.transact(
        entry.doc,
        () => {
          if (loaded.snapshot) Y.applyUpdate(entry.doc, loaded.snapshot);
          for (const update of loaded.updates) {
            Y.applyUpdate(entry.doc, update);
          }
        },
        HYDRATE_ORIGIN,
      );
    } catch (error) {
      fail(entry, new DocStoreError("corrupt", String(error)));
      return;
    }
    const batcher = new Batcher({
      store,
      docId: entry.docId,
      loaded,
      clock,
      describe: options.describe && (() => options.describe?.(entry.doc) ?? {}),
      onHealth: (health) => {
        // At the size cap the batcher halts with every edit kept in the open
        // Y.Doc: the document goes read-only (WriteGate) and explains the cap
        // (D-O3); "Copy into a new tab" carries the edits the store refused.
        if (health.failing?.code === "document_too_large")
          setState(entry, { readOnlyReason: "document_too_large" });
        options.onHealth?.(entry.docId, health);
      },
      onCompactDue: () => scheduleIdle(() => void compact(entry)),
    });
    entry.batcher = batcher;
    for (const { origin, update } of entry.early) batcher.push(origin, update);
    entry.early = [];

    const readOnlyReason = loaded.schema > schema ? "doc_too_new" : null;
    if (!readOnlyReason && loaded.schema < schema) {
      try {
        migrate(entry, batcher, loaded.schema);
      } catch (error) {
        fail(entry, new DocStoreError("migration_failed", String(error)));
        return;
      }
    }
    setState(entry, { ready: true, authoritative: true, readOnlyReason });
  }

  /**
   * Runs the pending migrations, appended as `migration`. The schema moves
   * only past steps that finished: after each one, an empty update carries
   * its `schemaTo` (the batcher merges it into the same append). If a step
   * throws, its partial edit is still saved, as content, and the schema stays
   * at the last finished step, so the next open runs that step again.
   */
  function migrate(entry: Entry, batcher: Batcher, from: number): void {
    for (const migration of migrations) {
      if (migration.to <= from || migration.to > schema) continue;
      entry.doc.transact(() => migration.migrate(entry.doc), MIGRATION_ORIGIN);
      batcher.push("migration", EMPTY_UPDATE, migration.to);
    }
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
    forget(entry);
    const batcher = entry.batcher;
    if (batcher) {
      // A halted batcher (size cap) rejects: its refused edits can't be
      // stored, so close without compacting instead of hanging the close
      // and every re-open. The shell warns before releasing such a document
      // and offers "Copy into a new tab" (the refused edits live only in
      // this Y.Doc).
      const flushed = await batcher.flush().then(
        () => true,
        () => false,
      );
      await entry.compacting;
      if (flushed && batcher.rowsSinceSnapshot > 0) await compact(entry);
      batcher.dispose();
    }
    // Set after the final compaction, so a load still in flight closes itself.
    entry.closed = true;
    if (entry.held) await store.close(entry.docId);
    entry.awareness.destroy();
    entry.doc.destroy();
  }

  function startClose(entry: Entry): void {
    entry.releaseTimer = null;
    const record: Closing = { done: close(entry), batcher: entry.batcher };
    closing.set(entry.docId, record);
    record.done = record.done.finally(() => {
      if (closing.get(entry.docId) === record) closing.delete(entry.docId);
    });
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
      compacting: null,
      held: false,
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
      const batchers = [
        ...[...entries.values()].map((entry) => entry.batcher),
        ...[...closing.values()].map((record) => record.batcher),
      ];
      // Every document is flushed; a halted one (size cap) is reported after
      // the others are durable, never by hanging the quit.
      const results = await Promise.allSettled(
        batchers.map((batcher) => batcher?.flush()),
      );
      const refused = results.find((result) => result.status === "rejected");
      if (refused) throw (refused as PromiseRejectedResult).reason;
    },
  };
}
