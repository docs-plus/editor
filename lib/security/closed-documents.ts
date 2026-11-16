import type { Database } from "bun:sqlite";

import { cleanText } from "@/lib/clean-text";
import { isSystemDocumentId } from "@/lib/security/doc-id-validator";
import { CLOSED_RETENTION_DAYS } from "@/lib/security/guardrail-config";
import { MAX_TAB_TITLE_LENGTH } from "@/lib/tab-api";

/**
 * Closed tabs (soft deletes). Closing writes a `document_closures` row and
 * leaves `documents` alone, so the tab can be restored for
 * `CLOSED_RETENTION_DAYS`; the daily retention purge then deletes and
 * tombstones it. The window is enforced when the server answers, so a closure
 * past it is gone even before the purge runs.
 */

export type ClosedDocument = { id: string; title: string; closedAt: number };

export const CLOSED_LIST_LIMIT = 20;

const DAY_MS = 86_400_000;
const DEFAULT_PURGE_BATCH_SIZE = 100;

function inImmediateTransaction<T>(db: Database, run: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = run();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function isTombstonedName(db: Database, name: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM document_tombstones WHERE name = ?").get(name),
  );
}

/** A display-safe title: `""` unless a string, cleaned and capped. */
export function cleanClosedTitle(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const cleaned = cleanText(raw);
  const codePoints = [...cleaned];
  return codePoints.length > MAX_TAB_TITLE_LENGTH
    ? codePoints.slice(0, MAX_TAB_TITLE_LENGTH).join("")
    : cleaned;
}

export function closedCutoffMs(
  nowMs: number,
  days: number = CLOSED_RETENTION_DAYS,
): number {
  return nowMs - days * DAY_MS;
}

/**
 * Records a closure. A tombstoned name is `"gone"` and writes nothing.
 * Closing also refreshes idle activity so retention cannot tombstone the
 * document inside its closed window.
 */
export function closeDocumentSoftly(
  db: Database,
  name: string,
  title: string,
  tabsDoc: string,
  nowMs: number = Date.now(),
): "closed" | "gone" {
  return inImmediateTransaction(db, () => {
    if (isTombstonedName(db, name)) return "gone";
    db.prepare(
      `INSERT INTO document_closures (name, tabs_doc, closed_at, title)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET
         tabs_doc = excluded.tabs_doc,
         closed_at = excluded.closed_at,
         title = excluded.title`,
    ).run(name, tabsDoc, nowMs, title);
    db.prepare(
      `UPDATE document_activity
       SET last_persisted_at = MAX(last_persisted_at, ?)
       WHERE name = ?`,
    ).run(nowMs, name);
    return "closed";
  });
}

/**
 * Removes a closure. `"gone"` when tombstoned or closed before `cutoffMs`
 * (the row stays for the purge); `"not_closed"` when there is no closure.
 */
export function restoreClosedDocument(
  db: Database,
  name: string,
  cutoffMs: number,
  nowMs: number = Date.now(),
): "restored" | "not_closed" | "gone" {
  return inImmediateTransaction(db, () => {
    if (isTombstonedName(db, name)) return "gone";
    const closure = db
      .prepare("SELECT closed_at FROM document_closures WHERE name = ?")
      .get(name) as { closed_at: number } | null;
    if (!closure) return "not_closed";
    if (closure.closed_at < cutoffMs) return "gone";
    db.prepare("DELETE FROM document_closures WHERE name = ?").run(name);
    db.prepare(
      "UPDATE document_activity SET last_persisted_at = ? WHERE name = ?",
    ).run(nowMs, name);
    return "restored";
  });
}

/** Restorable closures of one tab list, newest first. */
export function listClosedDocuments(
  db: Database,
  tabsDoc: string,
  cutoffMs: number,
  limit: number = CLOSED_LIST_LIMIT,
): ClosedDocument[] {
  const rows = db
    .prepare(
      `SELECT c.name, c.title, c.closed_at
       FROM document_closures c
       WHERE c.tabs_doc = ?
         AND c.closed_at >= ?
         AND EXISTS (SELECT 1 FROM documents d WHERE d.name = c.name)
         AND NOT EXISTS (SELECT 1 FROM document_tombstones t WHERE t.name = c.name)
       ORDER BY c.closed_at DESC, c.name ASC
       LIMIT ?`,
    )
    .all(tabsDoc, cutoffMs, limit) as Array<{
    name: string;
    title: string;
    closed_at: number;
  }>;
  return rows.map((row) => ({
    id: row.name,
    title: row.title,
    closedAt: row.closed_at,
  }));
}

/**
 * Deletes and tombstones every document closed before `cutoffMs`, one
 * `BEGIN IMMEDIATE` per batch, until none remain.
 */
export function purgeClosedDocuments(
  db: Database,
  cutoffMs: number,
  batchSize: number = DEFAULT_PURGE_BATCH_SIZE,
  nowMs: number = Date.now(),
): { deletedCount: number; deletedNames: string[] } {
  const deletedNames: string[] = [];
  const selectBatch = db.prepare(
    `SELECT name FROM document_closures
     WHERE closed_at < ?
     ORDER BY closed_at ASC, name ASC
     LIMIT ?`,
  );
  const deleteDocument = db.prepare("DELETE FROM documents WHERE name = ?");
  const deleteActivity = db.prepare(
    "DELETE FROM document_activity WHERE name = ?",
  );
  const deleteClosure = db.prepare(
    "DELETE FROM document_closures WHERE name = ?",
  );
  const tombstone = db.prepare(
    `INSERT INTO document_tombstones (name, deleted_at) VALUES (?, ?)
     ON CONFLICT(name) DO UPDATE SET deleted_at = excluded.deleted_at`,
  );

  // Every selected closure row is deleted, so each batch makes progress.
  for (;;) {
    const names = inImmediateTransaction(db, () => {
      const batch = (
        selectBatch.all(cutoffMs, batchSize) as Array<{ name: string }>
      ).map((row) => row.name);
      for (const name of batch) {
        deleteClosure.run(name);
        // A system name never gets a closure through the API; never delete one.
        if (isSystemDocumentId(name)) continue;
        deleteDocument.run(name);
        deleteActivity.run(name);
        tombstone.run(name, nowMs);
        deletedNames.push(name);
      }
      return batch;
    });
    if (names.length === 0) break;
  }

  return { deletedCount: deletedNames.length, deletedNames };
}
