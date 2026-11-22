/**
 * `IdbDocStore`: the web library's `DocStore` over IndexedDB (web library
 * §2.3–§2.6, W2). One instance per tab, over the tab's `LibraryDb`.
 *
 * Unlike desktop, any number of tabs may append to the same document: a
 * duplicated, restored, frozen or stolen-from tab can still write, and the
 * Web Locks lease (W3) only decides who edits. So compaction never assumes
 * it is alone (W-D3, §2.5):
 * - Each open document keeps `applied`, the update keys this session has in
 *   its Y.Doc (loaded at hydrate, or appended and acked), and `snapRev`, the
 *   rev of the snapshot it last loaded or wrote.
 * - `compact` deletes only keys in `applied` up to `upToSeq`, and merges
 *   into the stored snapshot when its rev isn't `snapRev` (another tab
 *   compacted). The merged-in snapshot comes back as `foreign`, which
 *   `local-session` applies with `STORAGE_ORIGIN` and never appends.
 * - Rows another tab appended are never deleted here; the next `load`
 *   returns them, whatever their seq.
 * - `foreign` is apply-then-ack: until a later `compact`'s state covers the
 *   foreign snapshot's state vector (the caller applied it), every compact
 *   merges the stored snapshot again and returns it again. A caller that
 *   drops `foreign` (a destroyed doc, an apply that throws) therefore never
 *   loses the other tab's content, whose rows that tab already deleted.
 *
 * Content writes are `durability: "strict"` and settle on `complete`; an
 * aborted write (quota, I/O) rejects with a retryable `DocStoreError` and
 * wrote nothing, so the batcher keeps the batch and retries it in order.
 */
import * as Y from "yjs";

import {
  type AppendRecord,
  type CompactResult,
  type DocStore,
  DocStoreError,
  type LoadedDoc,
  UPDATE_ORIGINS,
} from "@/lib/platform/doc-store";
import { normalizeSearchText } from "@/lib/search/normalize";

import type { LibraryDb } from "./library-db";
import {
  type DocRow,
  type SnapshotRow,
  STORES,
  staleFlag,
  type UpdateRow,
} from "./library-schema";

/** Title and snippet caps, as the desktop engine (`content.ts`). */
export const MAX_TITLE_LENGTH = 200;
export const MAX_SNIPPET_LENGTH = 300;

/** What this session holds of one open document (§2.5). */
type SessionState = {
  /** Update keys in this session's Y.Doc: loaded, or appended and acked. */
  applied: Set<number>;
  /** The rev of the snapshot this session last loaded or wrote. */
  snapRev: string | null;
  /**
   * The state vector of the last `foreign` this session returned, until a
   * compact's state covers it (the caller applied it). Null when none.
   */
  foreignSv: Map<number, number> | null;
};

/** Whether state vector `sv` has every insert `target` has. */
function covers(sv: Map<number, number>, target: Map<number, number>): boolean {
  for (const [client, clock] of target) {
    if ((sv.get(client) ?? 0) < clock) return false;
  }
  return true;
}

function stateVector(update: Uint8Array): Map<number, number> {
  return Y.decodeStateVector(Y.encodeStateVectorFromUpdate(update));
}

type Loaded = {
  doc: DocRow;
  snapshot: SnapshotRow | undefined;
  rows: UpdateRow[];
};

export type IdbDocStoreOptions = {
  /** The tab's library connection (or the promise of it). */
  library: LibraryDb | Promise<LibraryDb>;
  now?: () => number;
  /** Written to `updates.writer`, for diagnostics. Default a new UUID. */
  writer?: string;
};

function validateAppend(record: AppendRecord): void {
  if (!UPDATE_ORIGINS.includes(record.origin)) {
    throw new DocStoreError("invalid_argument", "unknown origin");
  }
  if (
    !(record.update instanceof Uint8Array) ||
    record.update.byteLength === 0
  ) {
    throw new DocStoreError("invalid_argument", "empty update");
  }
  const { schemaTo } = record;
  if (schemaTo !== undefined && (!Number.isInteger(schemaTo) || schemaTo < 0)) {
    throw new DocStoreError("invalid_argument", "bad schemaTo");
  }
}

function notFound(): DocStoreError {
  return new DocStoreError("not_found", "no such document");
}

export class IdbDocStore implements DocStore {
  private readonly library: Promise<LibraryDb>;
  private readonly now: () => number;
  private readonly writer: string;
  private readonly sessions = new Map<string, SessionState>();
  private readonly writes = new Set<Promise<unknown>>();
  private unregisterCloseHook: (() => void) | null = null;
  private disposed = false;

  constructor(options: IdbDocStoreOptions) {
    this.now = options.now ?? Date.now;
    this.writer = options.writer ?? crypto.randomUUID();
    this.library = Promise.resolve(options.library).then((library) => {
      // An upgrade in another tab waits for the transactions this store
      // already issued. Batches still queued in the batcher are the
      // session's: the composition root registers its flush too (§2.2).
      if (!this.disposed) {
        this.unregisterCloseHook = library.addCloseHook(() => this.flush());
      }
      return library;
    });
    // `load` and writes report a failed open; this only keeps it from
    // being an unhandled rejection before anyone asks.
    this.library.catch(() => {});
  }

  /**
   * One readonly transaction: the document row, its snapshot and every
   * update row. It sees every row committed before it started, and keys
   * only increase, so a row committed later is newer than all of these.
   */
  async load(docId: string): Promise<LoadedDoc> {
    const library = await this.library;
    const { doc, snapshot, rows } = await library.run<Loaded>(
      [STORES.docs, STORES.snapshots, STORES.updates],
      "readonly",
      null,
      (tx, { done, fail, guard }) => {
        const docRequest = tx.objectStore(STORES.docs).get(docId);
        const snapshotRequest = tx.objectStore(STORES.snapshots).get(docId);
        const rowsRequest = tx
          .objectStore(STORES.updates)
          .index("by_doc")
          .getAll(library.docRange(docId));
        // Requests complete in order, so the other two are done here.
        rowsRequest.onsuccess = guard(() => {
          const doc = docRequest.result as DocRow | undefined;
          if (!doc) {
            fail(notFound());
            return;
          }
          done({
            doc,
            snapshot: snapshotRequest.result as SnapshotRow | undefined,
            rows: rowsRequest.result as UpdateRow[],
          });
        });
      },
    );
    this.sessions.set(docId, {
      applied: new Set(rows.map((row) => row.seq)),
      snapRev: snapshot?.rev ?? null,
      foreignSv: null,
    });
    return {
      snapshot: snapshot ? snapshot.data : null,
      updates: rows.map((row) => row.data),
      maxSeq: Math.max(rows.at(-1)?.seq ?? 0, snapshot?.upto_seq ?? 0),
      schema: doc.schema,
    };
  }

  /** The update row and the document's list metadata, in one strict transaction. */
  append(docId: string, record: AppendRecord): Promise<number> {
    return this.track(async () => {
      const library = await this.library;
      library.assertWritable();
      validateAppend(record);
      const data = record.update.slice();
      const now = this.now();
      const seq = await library.run<number>(
        [STORES.updates, STORES.docs],
        "readwrite",
        "strict",
        (tx, { done, fail, guard }) => {
          const row: Omit<UpdateRow, "seq"> = {
            doc_id: docId,
            data,
            origin: record.origin,
            created_at: now,
            writer: this.writer,
          };
          const addRequest = tx.objectStore(STORES.updates).add(row);
          addRequest.onsuccess = () => done(addRequest.result as number);
          const docs = tx.objectStore(STORES.docs);
          const docRequest = docs.get(docId);
          // Requests complete in order, so the row's seq is known here.
          docRequest.onsuccess = guard(() => {
            const doc = docRequest.result as DocRow | undefined;
            if (!doc) {
              fail(notFound());
              return;
            }
            const title =
              record.title === undefined
                ? doc.title
                : record.title.slice(0, MAX_TITLE_LENGTH);
            // The derived rows are now behind (offline data-model §4.2).
            const headSeq = Math.max(doc.head_seq, addRequest.result as number);
            docs.put({
              ...doc,
              modified_at: now,
              size_bytes: doc.size_bytes + data.byteLength,
              title,
              title_key:
                title === doc.title
                  ? doc.title_key
                  : normalizeSearchText(title),
              snippet:
                record.snippet === undefined
                  ? doc.snippet
                  : record.snippet.slice(0, MAX_SNIPPET_LENGTH),
              schema: record.schemaTo ?? doc.schema,
              head_seq: headSeq,
              stale: staleFlag(headSeq, doc.derived_seq),
            } satisfies DocRow);
          });
        },
      );
      this.sessions.get(docId)?.applied.add(seq);
      return seq;
    });
  }

  /**
   * Merges `state` into the stored snapshot and deletes only the rows this
   * session applied up to `upToSeq` (§2.5). The caller guarantees, in one
   * task with no append in flight, that `state` is the Y.Doc's whole state
   * and `upToSeq` the highest seq loaded into or acked from it.
   *
   * A non-null `foreign` must be applied to the caller's Y.Doc. Until it is
   * (until a later `state` covers it), each compact merges and returns it
   * again, so a dropped `foreign` costs a repeat merge, never content. One
   * gap remains: a foreign snapshot that only deletes adds no inserts, so it
   * counts as covered at once, and dropping it brings that text back.
   *
   * It never touches `head_seq` (offline data-model revision §4.2).
   */
  compact(
    docId: string,
    state: Uint8Array,
    upToSeq: number,
  ): Promise<CompactResult> {
    return this.track(async () => {
      const library = await this.library;
      library.assertWritable();
      if (!Number.isInteger(upToSeq) || upToSeq < 0) {
        throw new DocStoreError("invalid_argument", "bad upToSeq");
      }
      if (!(state instanceof Uint8Array) || state.byteLength === 0) {
        throw new DocStoreError("invalid_argument", "empty state");
      }
      const session: SessionState = this.sessions.get(docId) ?? {
        applied: new Set<number>(),
        snapRev: null,
        foreignSv: null,
      };
      const keys = [...session.applied].filter((key) => key <= upToSeq);
      const own = state.slice();
      const rev = crypto.randomUUID();
      // The last foreign snapshot isn't in `state` yet: merge again.
      const foreignPending =
        session.foreignSv !== null &&
        !covers(stateVector(own), session.foreignSv);
      const foreign = await library.run<Uint8Array | null>(
        [STORES.snapshots, STORES.updates, STORES.docs],
        "readwrite",
        "strict",
        (tx, { done, fail, guard }) => {
          const snapshots = tx.objectStore(STORES.snapshots);
          const updates = tx.objectStore(STORES.updates);
          const docs = tx.objectStore(STORES.docs);
          const docRequest = docs.get(docId);
          const storedRequest = snapshots.get(docId);
          storedRequest.onsuccess = guard(() => {
            const doc = docRequest.result as DocRow | undefined;
            if (!doc) {
              fail(notFound());
              return;
            }
            const stored = storedRequest.result as SnapshotRow | undefined;
            // Another tab compacted since this session last saw the
            // snapshot: keep its content by merging, synchronously, here.
            const merge =
              stored !== undefined &&
              (stored.rev !== session.snapRev || foreignPending);
            const data = merge ? Y.mergeUpdates([stored.data, own]) : own;
            snapshots.put({
              doc_id: docId,
              data,
              rev,
              upto_seq: Math.max(stored?.upto_seq ?? 0, upToSeq),
            } satisfies SnapshotRow);
            // Deleting a key that is already gone is a no-op.
            for (const key of keys) updates.delete(key);
            const restRequest = updates
              .index("by_doc")
              .getAll(library.docRange(docId));
            restRequest.onsuccess = guard(() => {
              const rest = restRequest.result as UpdateRow[];
              docs.put({
                ...doc,
                size_bytes: rest.reduce(
                  (sum, row) => sum + row.data.byteLength,
                  data.byteLength,
                ),
              } satisfies DocRow);
              done(merge ? stored.data : null);
            });
          });
        },
      );
      if (this.sessions.get(docId) === session) {
        session.snapRev = rev;
        session.foreignSv = foreign ? stateVector(foreign) : null;
        for (const key of keys) session.applied.delete(key);
      }
      return { foreign };
    });
  }

  /** Forgets this session's state; the web has no open-document registry. */
  async close(docId: string): Promise<void> {
    this.sessions.delete(docId);
  }

  /** Documents this store holds session state for (diagnostics, tests). */
  get openDocCount(): number {
    return this.sessions.size;
  }

  /**
   * Ends this store: forgets every document and unregisters its close hook,
   * so the connection keeps no reference to it. Issued writes still settle.
   */
  async dispose(): Promise<void> {
    this.disposed = true;
    this.sessions.clear();
    await this.library.catch(() => null);
    this.unregisterCloseHook?.();
    this.unregisterCloseHook = null;
  }

  /**
   * Waits for every transaction this store already issued to settle. It
   * doesn't cover batches the batcher still holds: those are the session's
   * to drain (§2.2 As built).
   */
  async flush(): Promise<void> {
    await Promise.allSettled([...this.writes]);
  }

  /** Tracks a write for `flush`. */
  private track<T>(write: () => Promise<T>): Promise<T> {
    const pending = write();
    this.writes.add(pending);
    const untrack = () => this.writes.delete(pending);
    pending.then(untrack, untrack);
    return pending;
  }
}
