import type { Database } from "bun:sqlite";

import { shareDocumentName } from "@/lib/sharing/share-name";

/**
 * The `shares` table (plan §6, P4.2a). Created only when `HOCUS_SHARES` is
 * not `off`, so a dark deploy touches no schema.
 *
 * Beyond the plan's columns: `view_only` keeps `edit_hash` so an edit token
 * on a view-only share is told `view_only` instead of counting as a failed
 * token; `last_edit_at` drives the 30-day expiry; `ended_at` dates the end.
 * An ended row is never deleted or reopened ("an ended share never comes
 * back"): it is the share's tombstone and holds the reason, while
 * `document_tombstones` keeps blocking the name in the existing paths.
 */
export const SHARE_END_REASONS = [
  "sharing_stopped",
  "link_reset",
  "expired",
  "removed",
] as const;

export type ShareEndReason = (typeof SHARE_END_REASONS)[number];

export type ShareStatus = "pending" | "committed" | "ended";

export type ShareRow = {
  share_id: string;
  lineage: string;
  /** bun:sqlite returns BLOBs as `Uint8Array`. */
  edit_hash: Uint8Array;
  view_hash: Uint8Array;
  owner_hash: Uint8Array;
  status: ShareStatus;
  view_only: number;
  ended_reason: ShareEndReason | null;
  created_at: number;
  last_edit_at: number;
  ended_at: number | null;
  created_ip_hash: string | null;
  size_bytes: number;
  schema: number;
};

export type NewShare = {
  shareId: string;
  lineage: string;
  editHash: Buffer;
  viewHash: Buffer;
  ownerHash: Buffer;
  schema: number;
  createdIpHash: string | null;
};

const REASONS_SQL = SHARE_END_REASONS.map((reason) => `'${reason}'`).join(", ");

export function bootstrapSharesTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS shares (
      share_id TEXT PRIMARY KEY,
      lineage TEXT NOT NULL,
      edit_hash BLOB NOT NULL,
      view_hash BLOB NOT NULL,
      owner_hash BLOB NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'committed', 'ended')),
      view_only INTEGER NOT NULL DEFAULT 0,
      ended_reason TEXT CHECK (ended_reason IS NULL OR ended_reason IN (${REASONS_SQL})),
      created_at INTEGER NOT NULL,
      last_edit_at INTEGER NOT NULL,
      ended_at INTEGER,
      created_ip_hash TEXT,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      schema INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS shares_status_last_edit
      ON shares (status, last_edit_at);
    CREATE INDEX IF NOT EXISTS shares_created_at ON shares (created_at);
  `);
}

export function getShare(db: Database, shareId: string): ShareRow | null {
  return (
    (db
      .prepare("SELECT * FROM shares WHERE share_id = ?")
      .get(shareId) as ShareRow | null) ?? null
  );
}

function insertShare(db: Database, share: NewShare, nowMs: number): void {
  db.prepare(
    `INSERT INTO shares (
       share_id, lineage, edit_hash, view_hash, owner_hash, status,
       created_at, last_edit_at, created_ip_hash, schema
     ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
  ).run(
    share.shareId,
    share.lineage,
    share.editHash,
    share.viewHash,
    share.ownerHash,
    nowMs,
    nowMs,
    share.createdIpHash,
    share.schema,
  );
}

/** Adds a `pending` share; it becomes `committed` after its first store. */
export function createShareRow(
  db: Database,
  share: NewShare,
  nowMs: number = Date.now(),
): void {
  insertShare(db, share, nowMs);
}

/**
 * A share that never had a stored edit expires this long after it was
 * created. Its creator connects right away, so an hour is generous, and
 * abandoned creates cannot hold `MAX_TOTAL_SHARES` slots for 30 days.
 */
export const PENDING_SHARE_TTL_MS = 60 * 60 * 1000;

/**
 * The `MAX_TOTAL_SHARES` count: committed shares edited within `expiryMs`
 * and pending shares created within `PENDING_SHARE_TTL_MS`.
 */
export function countActiveShares(
  db: Database,
  nowMs: number,
  expiryMs: number,
): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count FROM shares
       WHERE (status = 'committed' AND last_edit_at >= ?)
          OR (status = 'pending' AND created_at >= ?)`,
    )
    .get(nowMs - expiryMs, nowMs - PENDING_SHARE_TTL_MS) as { count: number };
  return row.count;
}

/**
 * True when a share that has not ended is past its expiry: unedited for
 * `expiryMs`, or still pending `PENDING_SHARE_TTL_MS` after it was created.
 */
export function isShareExpired(
  share: ShareRow,
  nowMs: number,
  expiryMs: number,
): boolean {
  if (share.status === "pending") {
    return share.created_at < nowMs - PENDING_SHARE_TTL_MS;
  }
  return share.status !== "ended" && share.last_edit_at < nowMs - expiryMs;
}

/**
 * After a store of `share:<id>`: records the size and edit time, and
 * commits a pending share. Ended shares are left alone.
 */
export function recordShareStored(
  db: Database,
  shareId: string,
  sizeBytes: number,
  nowMs: number = Date.now(),
): void {
  db.prepare(
    `UPDATE shares SET
       status = CASE WHEN status = 'pending' THEN 'committed' ELSE status END,
       size_bytes = ?,
       last_edit_at = ?
     WHERE share_id = ? AND status != 'ended'`,
  ).run(sizeBytes, nowMs, shareId);
}

function endShareInTransaction(
  db: Database,
  shareId: string,
  reason: ShareEndReason,
  nowMs: number,
): boolean {
  const result = db
    .prepare(
      `UPDATE shares SET status = 'ended', ended_reason = ?, ended_at = ?
       WHERE share_id = ? AND status != 'ended'`,
    )
    .run(reason, nowMs, shareId);
  if (result.changes === 0) return false;
  const name = shareDocumentName(shareId);
  db.prepare("DELETE FROM documents WHERE name = ?").run(name);
  db.prepare(
    `INSERT INTO document_tombstones (name, deleted_at) VALUES (?, ?)
     ON CONFLICT(name) DO UPDATE SET deleted_at = excluded.deleted_at`,
  ).run(name, nowMs);
  return true;
}

/**
 * Ends a share for good: marks the row, deletes the stored document and
 * tombstones its name, in one transaction. False when it was already ended
 * or never existed. The caller closes live connections.
 */
export function endShare(
  db: Database,
  shareId: string,
  reason: ShareEndReason,
  nowMs: number = Date.now(),
): boolean {
  return db.transaction(() =>
    endShareInTransaction(db, shareId, reason, nowMs),
  )();
}

/** Turns editing off for everyone; the view token keeps working. */
export function setShareViewOnly(db: Database, shareId: string): boolean {
  const result = db
    .prepare(
      "UPDATE shares SET view_only = 1 WHERE share_id = ? AND status != 'ended'",
    )
    .run(shareId);
  return result.changes > 0;
}

/**
 * Reset link: ends `oldShareId` as `link_reset` and creates `next` with the
 * old lineage, in one transaction. False when the old share already ended.
 */
export function resetShare(
  db: Database,
  oldShareId: string,
  next: Omit<NewShare, "lineage">,
  nowMs: number = Date.now(),
): boolean {
  return db.transaction(() => {
    const old = getShare(db, oldShareId);
    if (!old || old.status === "ended") return false;
    endShareInTransaction(db, oldShareId, "link_reset", nowMs);
    insertShare(db, { ...next, lineage: old.lineage }, nowMs);
    return true;
  })();
}

/** Clears `created_ip_hash` on shares created before `cutoffMs`; returns how many. */
export function clearOldCreatorIpHashes(
  db: Database,
  cutoffMs: number,
): number {
  return db
    .prepare(
      "UPDATE shares SET created_ip_hash = NULL WHERE created_at < ? AND created_ip_hash IS NOT NULL",
    )
    .run(cutoffMs).changes;
}
