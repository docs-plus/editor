import type { Database } from "bun:sqlite";

import { logAbuseEvent } from "../lib/security/abuse-log";
import {
  bootstrapDocumentActivityTable,
  purgeStaleDocuments,
  purgeTombstones,
} from "../lib/security/activity-store";
import {
  closedCutoffMs,
  purgeClosedDocuments,
} from "../lib/security/closed-documents";
import {
  CLOSED_RETENTION_DAYS,
  RETENTION_DAYS,
  TOMBSTONE_RETENTION_DAYS,
} from "../lib/security/guardrail-config";
import { isSqliteBusyError, openSqlite } from "../lib/sqlite-open";

export function runRetentionPurge(
  db: Database,
  options: {
    retentionDays?: number;
    closedRetentionDays?: number;
    batchSize?: number;
    nowMs?: number;
  } = {},
): { deletedCount: number; deletedNames: string[]; closedNames: string[] } {
  bootstrapDocumentActivityTable(db);
  const nowMs = options.nowMs ?? Date.now();
  const retentionDays = options.retentionDays ?? RETENTION_DAYS;
  // Closed tabs first: they are past their restore window.
  const closed = purgeClosedDocuments(
    db,
    closedCutoffMs(nowMs, options.closedRetentionDays ?? CLOSED_RETENTION_DAYS),
    options.batchSize,
    nowMs,
  );
  const cutoffMs = nowMs - retentionDays * 24 * 60 * 60 * 1000;
  const result = purgeStaleDocuments(db, cutoffMs, options.batchSize, nowMs);
  // Tombstones must outlive every offline copy in a browser, which can
  // reconnect long after the document went idle on the server.
  purgeTombstones(db, nowMs - TOMBSTONE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  return { ...result, closedNames: closed.deletedNames };
}

function runCli(): void {
  const db = openSqlite({ busyTimeoutMs: 10_000 });
  try {
    try {
      const result = runRetentionPurge(db);
      logAbuseEvent("retention_purge_completed", {
        deletedCount: result.deletedCount,
        deletedNames: result.deletedNames,
        closedNames: result.closedNames,
      });
    } catch (error) {
      if (isSqliteBusyError(error)) {
        const retried = runRetentionPurge(db);
        logAbuseEvent("retention_purge_completed_retry", {
          deletedCount: retried.deletedCount,
          deletedNames: retried.deletedNames,
          closedNames: retried.closedNames,
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
