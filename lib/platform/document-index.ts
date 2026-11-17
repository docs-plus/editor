/**
 * `DocumentIndex`: the list of documents and their metadata, apart from
 * their content (`DocStore`) and their open editing session (`DocSession`).
 *
 * Implementations:
 * - web sandbox: `GlobalTabsIndex` (`lib/platform/web/global-tabs-index.ts`),
 *   the shared `global-tabs` Y.Doc;
 * - web library (W2): `IdbDocumentIndex`, IndexedDB with a rev feed over
 *   BroadcastChannel;
 * - desktop: `IpcDocumentIndex`, the SQLite `docs` and `folders` tables;
 * - tests: `MemoryDocumentIndex` (`tests/helpers/memory-document-index.ts`).
 *
 * Contract (`tests/unit/platform/document-index-contract.ts`):
 * - `snapshot()` returns the same object until something changes, and `rev`
 *   grows with every change, so it suits `useSyncExternalStore`.
 * - Before `ready` the list is empty and every mutation is refused.
 * - `create`, `rename` and `move` apply to the snapshot before they return
 *   and notify subscribers synchronously; an index whose storage is remote
 *   (IPC, IndexedDB) applies them optimistically and persists them later.
 * - `trash` and `restore` may need a server answer, so they are async.
 * - Listeners may run inside the backing store's transaction (Yjs observers):
 *   they must not write back to the index synchronously.
 *
 * Which document is active is per-window state, never in the index.
 * Folders, pins, tags, purge and title search join the port with the
 * libraries that need them (P2.7a/b).
 */

/** One document in the index. */
export interface DocumentEntry {
  readonly id: string;
  readonly title: string;
  readonly createdAt: number;
}

export interface DocumentIndexSnapshot {
  /** Grows by at least one with every change and every (re)load. */
  readonly rev: number;
  /** False until the first load; the list is empty until then. */
  readonly ready: boolean;
  /** In display order. */
  readonly items: readonly DocumentEntry[];
}

/**
 * - `load`: the index (re)loaded from its source of truth (first load,
 *   reconnect, a missed rev); per-window state should be re-resolved.
 * - `change`: an entry was added, removed, renamed or moved, here or
 *   elsewhere.
 */
export type DocumentIndexEventType = "load" | "change";

export type DocumentIndexListener = (
  type: DocumentIndexEventType,
  snapshot: DocumentIndexSnapshot,
) => void;

/**
 * A document to bring back from the Trash. `index` is the position it was
 * trashed from (an implementation-defined hint, from `TrashResult`);
 * without one it is appended.
 */
export type RestorableEntry = { id: string; title: string; index?: number };

export interface TrashResult {
  /** Trashed and removed from the list, in the order asked. */
  readonly trashed: RestorableEntry[];
  /** Ids that could not be trashed; they stay listed. */
  readonly failed: string[];
}

/**
 * - `restored`: it was in the Trash and is live again.
 * - `not_closed`: it was already live (restored elsewhere first, or an
 *   earlier answer was lost).
 * - `gone`: it can no longer be restored.
 *
 * `restored` and `not_closed` both leave the document listed.
 */
export type RestoreResult = "restored" | "not_closed" | "gone";

export interface DocumentIndex {
  snapshot(): DocumentIndexSnapshot;
  /** Returns the unsubscribe function. */
  subscribe(listener: DocumentIndexListener): () => void;
  /** Lists a new, empty document; null when refused (not ready, full). */
  create(init?: { title?: string }): DocumentEntry | null;
  rename(id: string, title: string): void;
  /** Moves `id` to position `toIndex` of `snapshot().items`. */
  move(id: string, toIndex: number): void;
  /** Moves documents to the Trash; each one leaves the list once it is there. */
  trash(ids: readonly string[]): Promise<TrashResult>;
  /**
   * Brings documents back and lists the ones that are live again, at their
   * old position when known; null when the answer never arrived.
   */
  restore(
    entries: readonly RestorableEntry[],
  ): Promise<Record<string, RestoreResult> | null>;
  /** Stops listening to the store; later mutations are ignored. */
  destroy(): void;
}
