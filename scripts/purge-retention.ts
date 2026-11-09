import type Database from "better-sqlite3";

import { logAbuseEvent } from "../lib/security/abuse-log";
import {
  bootstrapDocumentActivityTable,
  purgeStaleDocuments,
  purgeTombstones,
} from "../lib/security/activity-store";
import {
  RETENTION_DAYS,
  TOMBSTONE_RETENTION_DAYS,
} from "../lib/security/guardrail-config";
import { openBetterSqlite, SQLITE_BUSY } from "../lib/sqlite-open";

export function runRetentionPurge(
  db: Database.Database,
  options: { retentionDays?: number; batchSize?: number; nowMs?: number } = {},
): { deletedCount: number; deletedNames: string[] } {
  bootstrapDocumentActivityTable(db);
  const retentionDays = options.retentionDays ?? RETENTION_DAYS;
  const cutoffMs =
    (options.nowMs ?? Date.now()) - retentionDays * 24 * 60 * 60 * 1000;
  const nowMs = options.nowMs ?? Date.now();
  const result = purgeStaleDocuments(db, cutoffMs, options.batchSize, nowMs);
  // Tombstones must outlive every offline copy in a browser, which can
  // reconnect long after the document went idle on the server.
  purgeTombstones(db, nowMs - TOMBSTONE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  return result;
}

function runCli(): void {
  const db = openBetterSqlite({ timeoutMs: 10_000, busyTimeoutMs: 10_000 });
  try {
    try {
      const result = runRetentionPurge(db);
      logAbuseEvent("retention_purge_completed", {
        deletedCount: result.deletedCount,
        deletedNames: result.deletedNames,
      });
    } catch (error) {
      const sqliteCode = (error as { code?: number }).code;
      if (sqliteCode === SQLITE_BUSY) {
        const retried = runRetentionPurge(db);
        logAbuseEvent("retention_purge_completed_retry", {
          deletedCount: retried.deletedCount,
          deletedNames: retried.deletedNames,
        });
        return;
      }
      throw error;
    }
  } finally {
    db.close();
  }
}

if (import.meta.main) {
  runCli();
}
