import { isSystemDocumentId } from "@/lib/security/doc-id-validator";
import type { SqliteDatabase } from "@/lib/sqlite-open";

const DEFAULT_BATCH_SIZE = 100;

export function bootstrapDocumentActivityTable(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS document_activity (
      name TEXT PRIMARY KEY,
      last_persisted_at INTEGER NOT NULL,
      last_size_bytes INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS document_tombstones (
      name TEXT PRIMARY KEY,
      deleted_at INTEGER NOT NULL
    );
  `);
}

/** True when the document was deleted through the API and must stay gone. */
export function isTombstoned(db: SqliteDatabase, name: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM document_tombstones WHERE name = ?").get(name),
  );
}

/**
 * Deletes a document and its activity row and records a tombstone, in one
 * transaction. The Hocuspocus process may still hold the document in memory;
 * the tombstone stops it from writing the document back (resurrection) and
 * from loading it again. Returns whether a stored document existed.
 */
export function deleteDocumentPermanently(
  db: SqliteDatabase,
  name: string,
  nowMs: number = Date.now(),
): boolean {
  db.exec("BEGIN IMMEDIATE");
  try {
    const existed = documentExists(db, name);
    db.prepare("DELETE FROM documents WHERE name = ?").run(name);
    db.prepare("DELETE FROM document_activity WHERE name = ?").run(name);
    db.prepare(
      `INSERT INTO document_tombstones (name, deleted_at) VALUES (?, ?)
       ON CONFLICT(name) DO UPDATE SET deleted_at = excluded.deleted_at`,
    ).run(name, nowMs);
    db.exec("COMMIT");
    return existed;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** Drops tombstones older than the retention cutoff; returns how many. */
export function purgeTombstones(db: SqliteDatabase, cutoffMs: number): number {
  const stale = db
    .prepare("SELECT name FROM document_tombstones WHERE deleted_at < ?")
    .all(cutoffMs);
  db.prepare("DELETE FROM document_tombstones WHERE deleted_at < ?").run(
    cutoffMs,
  );
  return stale.length;
}

export function upsertDocumentActivity(
  db: SqliteDatabase,
  name: string,
  sizeBytes: number,
  nowMs: number = Date.now(),
): void {
  const stmt = db.prepare(`
    INSERT INTO document_activity (name, last_persisted_at, last_size_bytes)
    VALUES (?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      last_persisted_at = excluded.last_persisted_at,
      last_size_bytes = excluded.last_size_bytes
  `);
  stmt.run(name, nowMs, sizeBytes);
}

export function countNonSystemDocuments(db: SqliteDatabase): number {
  const rows = db.prepare("SELECT name FROM documents").all() as Array<{
    name: string;
  }>;
  let count = 0;
  for (const row of rows) {
    if (!isSystemDocumentId(row.name)) count++;
  }
  return count;
}

export function documentExists(db: SqliteDatabase, name: string): boolean {
  const row = db
    .prepare("SELECT 1 FROM documents WHERE name = ? LIMIT 1")
    .get(name) as { 1: number } | undefined;
  return Boolean(row);
}

export function purgeStaleDocuments(
  db: SqliteDatabase,
  cutoffMs: number,
  batchSize: number = DEFAULT_BATCH_SIZE,
): { deletedCount: number; deletedNames: string[] } {
  const staleRows = db
    .prepare(
      `
      SELECT a.name
      FROM document_activity a
      WHERE a.last_persisted_at < ?
      ORDER BY a.last_persisted_at ASC
      LIMIT ?
    `,
    )
    .all(cutoffMs, batchSize) as Array<{ name: string }>;

  const candidates = staleRows
    .map((row) => row.name)
    .filter((name) => !isSystemDocumentId(name));

  if (candidates.length === 0) {
    return { deletedCount: 0, deletedNames: [] };
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    const deleteDocument = db.prepare("DELETE FROM documents WHERE name = ?");
    const deleteActivity = db.prepare(
      "DELETE FROM document_activity WHERE name = ?",
    );

    for (const name of candidates) {
      deleteDocument.run(name);
      deleteActivity.run(name);
    }

    db.exec("COMMIT");
    return { deletedCount: candidates.length, deletedNames: candidates };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
