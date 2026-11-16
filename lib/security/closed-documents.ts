import type { Database } from "bun:sqlite";

import * as Y from "yjs";

import { cleanText } from "@/lib/clean-text";
import { isSystemDocumentId } from "@/lib/security/doc-id-validator";
import { CLOSED_RETENTION_DAYS } from "@/lib/security/guardrail-config";
import { isValidTabEntry, MAX_TAB_TITLE_LENGTH } from "@/lib/tab-api";

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
 * Ids in a stored tab list's `tabs` array. Empty when the list is not stored
 * or cannot be read.
 */
function storedTabIds(db: Database, tabsDoc: string): Set<string> {
  const ids = new Set<string>();
  const row = db
    .prepare("SELECT data FROM documents WHERE name = ?")
    .get(tabsDoc) as { data: Uint8Array } | null;
  if (!row) return ids;
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, row.data);
    for (const entry of doc.getArray("tabs").toArray()) {
      if (isValidTabEntry(entry)) ids.add(entry.id);
    }
  } catch {
    // Unreadable: treat the list as empty, so the closure is purged.
  } finally {
    doc.destroy();
  }
  return ids;
}

/**
 * Deletes and tombstones every document closed before `cutoffMs`, one
 * `BEGIN IMMEDIATE` per batch, until none remain. A document listed again in
 * the tab list it was closed from (a collaborator's stale title update or
 * reorder put the entry back, or the list's removal is not stored yet) is in
 * use: it and its closure stay, and a later purge decides again.
 */
export function purgeClosedDocuments(
  db: Database,
  cutoffMs: number,
  batchSize: number = DEFAULT_PURGE_BATCH_SIZE,
  nowMs: number = Date.now(),
): { deletedCount: number; deletedNames: string[] } {
  const deletedNames: string[] = [];
  // Keyset pages: kept (listed) closures stay, so the next page starts
  // after the last row seen instead of at the first remaining one.
  const selectBatch = db.prepare(
    `SELECT name, tabs_doc, closed_at FROM document_closures
     WHERE closed_at < ? AND (closed_at, name) > (?, ?)
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

  let after = { closedAt: Number.NEGATIVE_INFINITY, name: "" };
  for (;;) {
    const rows = inImmediateTransaction(db, () => {
      const batch = selectBatch.all(
        cutoffMs,
        after.closedAt,
        after.name,
        batchSize,
      ) as Array<{ name: string; tabs_doc: string; closed_at: number }>;
      // Read inside this transaction, so the decision uses the current list.
      const listedIn = new Map<string, Set<string>>();
      for (const { name, tabs_doc: tabsDoc } of batch) {
        // A system name never gets a closure through the API; never delete one.
        if (isSystemDocumentId(name)) {
          deleteClosure.run(name);
          continue;
        }
        let listed = listedIn.get(tabsDoc);
        if (!listed) {
          listed = storedTabIds(db, tabsDoc);
          listedIn.set(tabsDoc, listed);
        }
        if (listed.has(name)) continue;
        deleteClosure.run(name);
        deleteDocument.run(name);
        deleteActivity.run(name);
        tombstone.run(name, nowMs);
        deletedNames.push(name);
      }
      return batch;
    });
    const last = rows.at(-1);
    if (!last) break;
    after = { closedAt: last.closed_at, name: last.name };
  }

  return { deletedCount: deletedNames.length, deletedNames };
}
