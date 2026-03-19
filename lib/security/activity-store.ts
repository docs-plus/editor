import type Database from "better-sqlite3";

import { isSystemDocumentId } from "@/lib/security/doc-id-validator";

const DEFAULT_BATCH_SIZE = 100;

export function bootstrapDocumentActivityTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS document_activity (
      name TEXT PRIMARY KEY,
      last_persisted_at INTEGER NOT NULL,
      last_size_bytes INTEGER NOT NULL DEFAULT 0
    )
  `);
}

export function upsertDocumentActivity(
  db: Database.Database,
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

export function countNonSystemDocuments(db: Database.Database): number {
  const rows = db.prepare("SELECT name FROM documents").all() as Array<{
    name: string;
  }>;
  let count = 0;
  for (const row of rows) {
    if (!isSystemDocumentId(row.name)) count++;
  }
  return count;
}

export function documentExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare("SELECT 1 FROM documents WHERE name = ? LIMIT 1")
    .get(name) as { 1: number } | undefined;
  return Boolean(row);
}

export function purgeStaleDocuments(
  db: Database.Database,
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
