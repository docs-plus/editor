import type { Database } from "bun:sqlite";

import { isSystemDocumentId } from "@/lib/security/doc-id-validator";
import { isShareNamespace } from "@/lib/sharing/share-name";

const DEFAULT_BATCH_SIZE = 100;

export function bootstrapDocumentActivityTable(db: Database): void {
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
    CREATE TABLE IF NOT EXISTS document_closures (
      name TEXT PRIMARY KEY,
      tabs_doc TEXT NOT NULL,
      closed_at INTEGER NOT NULL,
      title TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS document_closures_tabs_closed_at
      ON document_closures (tabs_doc, closed_at);
  `);
}

/** True when the document was deleted through the API and must stay gone. */
export function isTombstoned(db: Database, name: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM document_tombstones WHERE name = ?").get(name),
  );
}

/**
 * Deletes a document, its activity and closure rows and records a tombstone, in one
 * transaction. The Hocuspocus process may still hold the document in memory;
 * the tombstone stops it from writing the document back (resurrection) and
 * from loading it again. Returns whether a stored document existed.
 */
export function deleteDocumentPermanently(
  db: Database,
  name: string,
  nowMs: number = Date.now(),
): boolean {
  db.exec("BEGIN IMMEDIATE");
  try {
    const existed = documentExists(db, name);
    db.prepare("DELETE FROM documents WHERE name = ?").run(name);
    db.prepare("DELETE FROM document_activity WHERE name = ?").run(name);
    db.prepare("DELETE FROM document_closures WHERE name = ?").run(name);
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
/** Tombstones `purgeTombstones` would delete with the same cutoff. Read-only. */
export function countExpiredTombstones(db: Database, cutoffMs: number): number {
  const row = db
    .prepare(
      "SELECT COUNT(*) AS count FROM document_tombstones WHERE deleted_at < ?",
    )
    .get(cutoffMs) as { count: number };
  return row.count;
}

export function purgeTombstones(db: Database, cutoffMs: number): number {
  const stale = db
    .prepare("SELECT name FROM document_tombstones WHERE deleted_at < ?")
    .all(cutoffMs);
  db.prepare("DELETE FROM document_tombstones WHERE deleted_at < ?").run(
    cutoffMs,
  );
  return stale.length;
}

export function upsertDocumentActivity(
  db: Database,
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

/**
 * Sandbox documents counted against `MAX_TOTAL_DOCUMENTS`: neither system
 * documents nor shares, which `MAX_TOTAL_SHARES` caps on their own.
 */
export function countNonSystemDocuments(db: Database): number {
  const rows = db.prepare("SELECT name FROM documents").all() as Array<{
    name: string;
  }>;
  let count = 0;
  for (const row of rows) {
    if (!isSystemDocumentId(row.name) && !isShareNamespace(row.name)) count++;
  }
  return count;
}

export function documentExists(db: Database, name: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM documents WHERE name = ? LIMIT 1").get(name),
  );
}

/**
 * Names of the documents `purgeStaleDocuments` would delete with the same
 * arguments: the oldest `batchSize` idle since before `cutoffMs`, minus
 * system documents. Read-only.
 */
export function findStaleDocuments(
  db: Database,
  cutoffMs: number,
  batchSize: number = DEFAULT_BATCH_SIZE,
): string[] {
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

  return staleRows
    .map((row) => row.name)
    .filter((name) => !isSystemDocumentId(name));
}

/**
 * How many documents are idle since before `cutoffMs`, minus system
 * documents: the whole backlog, of which a purge deletes one batch. Streams
 * the rows instead of loading them. Read-only.
 */
export function countStaleDocuments(db: Database, cutoffMs: number): number {
  const rows = db
    .prepare("SELECT name FROM document_activity WHERE last_persisted_at < ?")
    .iterate(cutoffMs) as IterableIterator<{ name: string }>;
  let count = 0;
  for (const row of rows) {
    if (!isSystemDocumentId(row.name)) count++;
  }
  return count;
}

export function purgeStaleDocuments(
  db: Database,
  cutoffMs: number,
  batchSize: number = DEFAULT_BATCH_SIZE,
  nowMs: number = Date.now(),
): { deletedCount: number; deletedNames: string[] } {
  const candidates = findStaleDocuments(db, cutoffMs, batchSize);

  if (candidates.length === 0) {
    return { deletedCount: 0, deletedNames: [] };
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    const deleteDocument = db.prepare("DELETE FROM documents WHERE name = ?");
    const deleteActivity = db.prepare(
      "DELETE FROM document_activity WHERE name = ?",
    );
    const deleteClosure = db.prepare(
      "DELETE FROM document_closures WHERE name = ?",
    );
    // Expired documents stay blocked like deleted ones, so an offline copy
    // shows them as deleted instead of silently recreating them.
    const tombstone = db.prepare(
      `INSERT INTO document_tombstones (name, deleted_at) VALUES (?, ?)
       ON CONFLICT(name) DO UPDATE SET deleted_at = excluded.deleted_at`,
    );

    for (const name of candidates) {
      deleteDocument.run(name);
      deleteActivity.run(name);
      deleteClosure.run(name);
      tombstone.run(name, nowMs);
    }

    db.exec("COMMIT");
    return { deletedCount: candidates.length, deletedNames: candidates };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
