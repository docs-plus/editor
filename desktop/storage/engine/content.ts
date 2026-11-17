/**
 * Document content: `load`, `append`, `compact` and `stateOf` (architecture
 * §5.2, §5.4 `content.ts`). The renderer owns the Y.Doc and compacts it
 * (D-A3); this module only stores bytes. It never parses an update, except
 * in {@link stateOf}, which merges stored rows for export and restore.
 *
 * Rule one: a Yjs update is never dropped once acknowledged. `append`
 * resolves only after COMMIT, and `compact` refuses an `upToSeq` that could
 * cover a row the renderer has not seen.
 */
import * as Y from "yjs";

import type { SqliteDriver } from "./driver";
import { StorageError } from "./errors";
import { scalar, transaction } from "./sql";

/** The stored `updates.origin` values: `UPDATE_ORIGINS` in `lib/platform/doc-store.ts`. */
export const STORED_ORIGINS = [
  "local",
  "migration",
  "remote",
  "restore",
] as const;
export type StoredOrigin = (typeof STORED_ORIGINS)[number];

export type LoadedContent = {
  snapshot: Uint8Array | null;
  updates: Uint8Array[];
  maxSeq: number;
  schema: number;
};

export type AppendInput = {
  origin: StoredOrigin;
  update: Uint8Array;
  title?: string;
  snippet?: string;
  schemaTo?: number;
};

/** Title and snippet caps (architecture §7 `str(200)`; details spec §6.3). */
export const MAX_TITLE_LENGTH = 200;
export const MAX_SNIPPET_LENGTH = 300;

function docExists(db: SqliteDriver, docId: string): boolean {
  return scalar(db, "SELECT 1 FROM docs WHERE id = ?", docId) !== undefined;
}

function snapshotUpto(db: SqliteDriver, docId: string): number {
  const value = scalar(
    db,
    "SELECT upto_seq FROM snapshots WHERE doc_id = ?",
    docId,
  );
  return typeof value === "number" ? value : 0;
}

/**
 * The highest seq this document has: of its rows, or of the rows its
 * snapshot replaced. A compaction can't claim to cover more than this.
 */
function lastDocSeq(db: SqliteDriver, docId: string): number {
  const value = scalar(
    db,
    "SELECT MAX(seq) FROM updates WHERE doc_id = ?",
    docId,
  );
  return Math.max(
    typeof value === "number" ? value : 0,
    snapshotUpto(db, docId),
  );
}

export function load(db: SqliteDriver, docId: string): LoadedContent {
  const doc = db.prepare("SELECT schema FROM docs WHERE id = ?").get(docId);
  if (!doc) throw new StorageError("not_found", "no such document");
  const snap = db
    .prepare("SELECT data, upto_seq FROM snapshots WHERE doc_id = ?")
    .get(docId);
  const upto = typeof snap?.upto_seq === "number" ? snap.upto_seq : 0;
  const rows = db
    .prepare(
      "SELECT seq, data FROM updates WHERE doc_id = ? AND seq > ? ORDER BY seq",
    )
    .all(docId, upto);
  const last = rows.at(-1)?.seq;
  return {
    snapshot: snap ? (snap.data as Uint8Array) : null,
    updates: rows.map((row) => row.data as Uint8Array),
    maxSeq: typeof last === "number" ? last : upto,
    schema: doc.schema as number,
  };
}

function validateAppend(input: AppendInput) {
  if (!STORED_ORIGINS.includes(input.origin))
    throw new StorageError("invalid_argument", "unknown origin");
  if (!(input.update instanceof Uint8Array) || input.update.byteLength === 0)
    throw new StorageError("invalid_argument", "empty update");
  if (
    input.schemaTo !== undefined &&
    (!Number.isInteger(input.schemaTo) || input.schemaTo < 0)
  )
    throw new StorageError("invalid_argument", "bad schemaTo");
}

/**
 * One row, plus the document's list metadata, in one transaction. Returns
 * the row's seq once committed.
 */
export function append(
  db: SqliteDriver,
  docId: string,
  input: AppendInput,
  now: number,
): number {
  validateAppend(input);
  return transaction(db, () => {
    const updated = db
      .prepare(
        `UPDATE docs SET
           modified_at = ?,
           size_bytes = size_bytes + ?,
           title = COALESCE(?, title),
           snippet = COALESCE(?, snippet),
           schema = COALESCE(?, schema)
         WHERE id = ?`,
      )
      .run(
        now,
        input.update.byteLength,
        input.title === undefined
          ? null
          : input.title.slice(0, MAX_TITLE_LENGTH),
        input.snippet === undefined
          ? null
          : input.snippet.slice(0, MAX_SNIPPET_LENGTH),
        input.schemaTo ?? null,
        docId,
      );
    if (updated.changes === 0)
      throw new StorageError("not_found", "no such document");
    return db
      .prepare(
        "INSERT INTO updates (doc_id, data, origin, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(docId, input.update, input.origin, now).lastInsertRowid;
  });
}

/**
 * Stores `state` as the snapshot and deletes rows `seq ≤ upToSeq`, in one
 * transaction (D-A3). A stale compaction (`upToSeq` below the stored
 * snapshot's) changes nothing. An `upToSeq` past the document's last row
 * is refused: it could claim rows the renderer has never seen.
 */
export function compact(
  db: SqliteDriver,
  docId: string,
  state: Uint8Array,
  upToSeq: number,
): void {
  if (!Number.isInteger(upToSeq) || upToSeq < 0)
    throw new StorageError("invalid_argument", "bad upToSeq");
  if (!(state instanceof Uint8Array) || state.byteLength === 0)
    throw new StorageError("invalid_argument", "empty state");
  transaction(db, () => {
    if (!docExists(db, docId))
      throw new StorageError("not_found", "no such document");
    if (upToSeq > lastDocSeq(db, docId))
      throw new StorageError(
        "invalid_argument",
        "upToSeq is past the document's rows",
      );
    if (upToSeq < snapshotUpto(db, docId)) return;
    db.prepare(
      `INSERT INTO snapshots (doc_id, data, upto_seq) VALUES (?, ?, ?)
       ON CONFLICT (doc_id) DO UPDATE SET data = excluded.data, upto_seq = excluded.upto_seq`,
    ).run(docId, state, upToSeq);
    db.prepare("DELETE FROM updates WHERE doc_id = ? AND seq <= ?").run(
      docId,
      upToSeq,
    );
    db.prepare(
      `UPDATE docs SET size_bytes = ? + COALESCE(
         (SELECT SUM(LENGTH(data)) FROM updates WHERE doc_id = ?), 0)
       WHERE id = ?`,
    ).run(state.byteLength, docId, docId);
  });
}

/**
 * The document's whole state as one update (for `.tinydoc`, restore and
 * the daily-copy reader). Merges without building a Y.Doc.
 */
export function stateOf(content: LoadedContent): Uint8Array {
  const parts = content.snapshot
    ? [content.snapshot, ...content.updates]
    : content.updates;
  if (parts.length === 0) return Y.encodeStateAsUpdate(new Y.Doc());
  return Y.mergeUpdates(parts);
}

/** Rows waiting for compaction, for diagnostics and T8. */
export function pendingRows(db: SqliteDriver): number {
  return Number(scalar(db, "SELECT COUNT(*) FROM updates") ?? 0);
}
