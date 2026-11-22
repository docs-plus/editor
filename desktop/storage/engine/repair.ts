/**
 * Repair and rebuild (offline revision §4.5, P2.6f). Idempotent: running
 * it twice changes nothing.
 *
 * - **Check** (idle, at most daily, read-mostly): raise `head_seq` to
 *   `MAX(seq)` (never lower it, I6), recompute `size_bytes` (I9), assert
 *   I1–I4 and report violations without fixing them silently, report
 *   `doc_blobs` rows whose document is gone with no `dropped_at` (§4.6).
 * - **Rebuild index** (Settings › Storage, or a `derive_version` change):
 *   `derived_seq = NULL` in chunks of 500 rows, one transaction each, so
 *   appends interleave; the derive queue then drains. The only path that
 *   resets derivation.
 * - **After a failed `quick_check`** (SEC-009): never repair in place. Read
 *   the damaged file read-only and rebuild into a new file in the explicit
 *   table order, keeping rows that read cleanly; run `foreign_key_check`
 *   and `integrity_check` on it. The damaged file is kept.
 *
 * Signatures are fixed by P2.6d; P2.6f implements the bodies.
 */
import type { OpenSqlite, SqliteDriver } from "./driver";
import { StorageError } from "./errors";
import type { StorageHost } from "./host";

export type RepairReport = {
  /** Documents whose `head_seq` rose to their newest row. */
  headSeqRaised: number;
  /** Documents whose `size_bytes` was recomputed. */
  sizeFixed: number;
  /** I1–I4 violations, one line each, reported and never fixed silently. */
  violations: string[];
  /** `doc_blobs` rows of purged documents with no `dropped_at`. */
  orphanBlobRows: number;
};

export type RebuildReport = {
  copiedRows: number;
  skippedRows: number;
  /** `foreign_key_check` and `integrity_check` on the new file. */
  foreignKeyCheck: "ok" | string;
  integrityCheck: "ok" | string;
};

export const RESET_CHUNK = 500;

/** Check mode. */
export function checkLibrary(
  _db: SqliteDriver,
  _host: StorageHost,
  _now: number,
): RepairReport {
  throw new StorageError("io_error", "repair check is not built yet (P2.6f)");
}

/**
 * One chunk of "Rebuild index": sets `derived_seq = NULL` on up to
 * {@link RESET_CHUNK} documents that still have one, in one transaction.
 * Returns how many it reset; 0 means done.
 */
export function resetDerivedChunk(_db: SqliteDriver): number {
  throw new StorageError("io_error", "rebuild index is not built yet (P2.6f)");
}

/** Rebuilds a damaged library into a new file at `target` (SEC-009). */
export function rebuildIntoNewFile(
  _openSqlite: OpenSqlite,
  _host: StorageHost,
  _source: string,
  _target: string,
): RebuildReport {
  throw new StorageError("io_error", "rebuild is not built yet (P2.6f)");
}
