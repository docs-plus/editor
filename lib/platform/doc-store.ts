/**
 * `DocStore`: the content port (desktop architecture §4, §5.2; web library
 * §2.3, §2.5). It stores one document's Yjs history as a snapshot plus an
 * append-only log of updates. Desktop implements it over IPC to the storage
 * worker (`IpcDocStore`, P2.6), the web library over IndexedDB (`IdbDocStore`,
 * W2), and tests and the dev bridge over memory (`MemoryDocStore`).
 *
 * Layers, from the editor down:
 * - `local-session` owns the Y.Doc and maps Yjs transaction origins to an
 *   {@link UpdateOrigin}.
 * - The batcher merges updates and calls {@link DocStore.append} at most once
 *   per document at a time.
 * - The store is unbatched: one `append` is one transaction (one fsync on
 *   desktop, one `strict` IndexedDB transaction on the web).
 *
 * Every rule here exists to keep one invariant: **a Yjs update is never
 * dropped once it exists** (details spec §1 rule 1). Stores never filter
 * updates; read-only modes are enforced in the editor, before an update
 * exists.
 *
 * Types only, plus the error class: this module must stay free of Yjs, React
 * and platform code, so the storage worker's engine and the IPC contract can
 * mirror it.
 */

/**
 * What produced a stored update: the `updates.origin` column. These are
 * stored strings, not Yjs transaction origins; `local-session` maps one to
 * the other (see `doc-session.ts`). Adding a value is a compatible change;
 * renaming or removing one is not, because old rows keep it.
 */
export const UPDATE_ORIGINS = [
  /** The person typing in this window or tab. */
  "local",
  /** A forward migration run by the open hook (architecture §5.1). */
  "migration",
  /** (Live) An update received from the sync server. */
  "remote",
  /** A forward edit that restores an older state (daily snapshot, version). */
  "restore",
] as const;

export type UpdateOrigin = (typeof UPDATE_ORIGINS)[number];

/**
 * A document as stored: `load` returns it. Applying `snapshot` and then every
 * entry of `updates`, in any order, yields the document's current content.
 */
export type LoadedDoc = {
  /** The compacted state (`Y.encodeStateAsUpdate`), or null before the first compaction. */
  snapshot: Uint8Array | null;
  /** Every update row not yet folded into `snapshot`, in `seq` order. */
  updates: Uint8Array[];
  /**
   * The highest `seq` this load covers: of the rows returned, or of the rows
   * the snapshot replaced. 0 for a document with no rows. Seqs are unique and
   * increasing across the whole library, not per document.
   */
  maxSeq: number;
  /** `docs.schema`: the document schema the content was last migrated to. */
  schema: number;
};

/** One `append`: a (merged) update plus the metadata the store indexes. */
export type AppendRecord = {
  origin: UpdateOrigin;
  /** A Yjs update (v1 encoding). May be a merge of many updates. */
  update: Uint8Array;
  /**
   * The document's title, from its first heading. The renderer sends it so
   * the storage side never parses Yjs (architecture §5.1). Omitted: unchanged.
   */
  title?: string;
  /** The list-view snippet (details spec §6.3). Omitted: unchanged. */
  snippet?: string;
  /** Set on a migration batch: `docs.schema` becomes this, in the same transaction. */
  schemaTo?: number;
};

/** What `compact` returns. */
export type CompactResult = {
  /**
   * Content the store merged into the snapshot that this session had never
   * applied, or null. Always null on desktop, where a document is open in at
   * most one window (D-A3). The web library's merge-into-snapshot rule (web
   * library §2.5, W-D3) returns another tab's snapshot here; the session
   * applies it to its Y.Doc with `STORAGE_ORIGIN`, never appended.
   */
  foreign: Uint8Array | null;
};

export interface DocStore {
  /**
   * Reads the document. On desktop this is also the claim in main's
   * open-document registry: it rejects with `already_open` while another
   * window holds the document. There is no timeout: it waits.
   */
  load(docId: string): Promise<LoadedDoc>;
  /**
   * Appends one row in one durable transaction and resolves with its `seq`
   * once committed. Appending the same bytes twice is harmless (a resend
   * after a restart): applying a Yjs update twice changes nothing. A
   * rejected append wrote nothing; the caller retries it in order and never
   * skips it.
   */
  append(docId: string, record: AppendRecord): Promise<number>;
  /**
   * Stores `state` as the snapshot and drops update rows it covers, in one
   * transaction. The caller guarantees, in one task with no append in
   * flight, that `state` is `Y.encodeStateAsUpdate(doc)` and `upToSeq` is the
   * highest seq loaded into or acked from that doc (architecture §5.2).
   * Desktop deletes every row with `seq ≤ upToSeq`; the web library merges
   * into the stored snapshot and deletes only rows its own session applied.
   */
  compact(
    docId: string,
    state: Uint8Array,
    upToSeq: number,
  ): Promise<CompactResult>;
  /** Ends this session's hold on the document (desktop: the registry entry). */
  close(docId: string): Promise<void>;
  /** Resolves once every append and compaction already issued is durable. */
  flush(): Promise<void>;
}

/**
 * Error codes a `DocStore` can reject with, spelled as desktop architecture
 * §9 spells them, plus the web library's `quota_exceeded` (§2.6).
 * `desktop/shared/errors.ts` (P2.5/P2.6) cannot import this module, so its
 * `ErrorCode` union must stay a superset of this one.
 */
export const DOC_STORE_ERROR_CODES = [
  // Contract (IPC)
  "invalid_argument",
  "forbidden",
  "build_mismatch",
  // Storage
  "not_found",
  "already_open",
  "document_open",
  "library_read_only",
  "library_too_new",
  "migration_failed",
  "disk_full",
  "io_error",
  "corrupt",
  "locked_elsewhere",
  "cloud_folder",
  "worker_restarting",
  "library_unavailable",
  // Content: the document is at its size cap (D-O3); not retryable, so a
  // refused append is never resent. Deletions still pass.
  "document_too_large",
  // Web library
  "quota_exceeded",
] as const;

export type DocStoreErrorCode = (typeof DOC_STORE_ERROR_CODES)[number];

/** Codes worth retrying automatically; the rest need a person or a restart. */
const RETRYABLE: ReadonlySet<DocStoreErrorCode> = new Set([
  "disk_full",
  "io_error",
  "worker_restarting",
  "library_unavailable",
  "quota_exceeded",
]);

export function isRetryableDocStoreError(code: DocStoreErrorCode): boolean {
  return RETRYABLE.has(code);
}

/**
 * How a `DocStore` rejects. Adapters turn transport errors into this
 * (desktop: the IPC `Result` envelope; web: an aborted transaction).
 */
export class DocStoreError extends Error {
  readonly code: DocStoreErrorCode;
  readonly retryable: boolean;

  constructor(code: DocStoreErrorCode, message: string = code) {
    super(message);
    this.name = "DocStoreError";
    this.code = code;
    this.retryable = isRetryableDocStoreError(code);
  }
}

export function isDocStoreError(error: unknown): error is DocStoreError {
  return error instanceof DocStoreError;
}
