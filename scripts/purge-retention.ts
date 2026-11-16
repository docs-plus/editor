import type { Database } from "bun:sqlite";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

import { logAbuseEvent } from "../lib/security/abuse-log";
import {
  bootstrapDocumentActivityTable,
  countExpiredTombstones,
  findStaleDocuments,
  purgeStaleDocuments,
  purgeTombstones,
} from "../lib/security/activity-store";
import {
  RETENTION_DAYS,
  TOMBSTONE_RETENTION_DAYS,
} from "../lib/security/guardrail-config";
import { getSqliteDbPath } from "../lib/sqlite-db-path";
import { isSqliteBusyError, openSqlite } from "../lib/sqlite-open";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `PURGE_MODE`: `off` does nothing; `dry-run` (the default) logs what a
 * purge would delete and changes nothing; `on` backs the database up, then
 * purges.
 */
export type PurgeMode = "off" | "dry-run" | "on";

const PURGE_MODES: readonly PurgeMode[] = ["off", "dry-run", "on"];

/** Backups kept in `backups/` next to the database; older ones are removed. */
export const PURGE_BACKUPS_KEPT = 7;

export function parsePurgeMode(value: string | undefined): PurgeMode {
  const mode = value?.trim() || "dry-run";
  if (!PURGE_MODES.includes(mode as PurgeMode)) {
    throw new Error(
      `PURGE_MODE must be one of ${PURGE_MODES.join(", ")}; got "${value}"`,
    );
  }
  return mode as PurgeMode;
}

interface PurgeOptions {
  retentionDays?: number;
  batchSize?: number;
  nowMs?: number;
}

function cutoffs(options: PurgeOptions) {
  const nowMs = options.nowMs ?? Date.now();
  return {
    nowMs,
    documentCutoffMs:
      nowMs - (options.retentionDays ?? RETENTION_DAYS) * DAY_MS,
    // Tombstones must outlive every offline copy in a browser, which can
    // reconnect long after the document went idle on the server.
    tombstoneCutoffMs: nowMs - TOMBSTONE_RETENTION_DAYS * DAY_MS,
  };
}

export function runRetentionPurge(
  db: Database,
  options: PurgeOptions = {},
): { deletedCount: number; deletedNames: string[] } {
  bootstrapDocumentActivityTable(db);
  const { nowMs, documentCutoffMs, tombstoneCutoffMs } = cutoffs(options);
  const result = purgeStaleDocuments(
    db,
    documentCutoffMs,
    options.batchSize,
    nowMs,
  );
  purgeTombstones(db, tombstoneCutoffMs);
  return result;
}

const hasTable = (db: Database, name: string) =>
  db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name) !== null;

/**
 * What `runRetentionPurge` would delete with the same options. Reads only:
 * it creates no table and writes no row.
 */
export function previewRetentionPurge(
  db: Database,
  options: PurgeOptions = {},
): {
  wouldDeleteCount: number;
  wouldDeleteNames: string[];
  staleTotal: number;
  expiredTombstoneCount: number;
} {
  const { documentCutoffMs, tombstoneCutoffMs } = cutoffs(options);
  const hasActivity = hasTable(db, "document_activity");
  const wouldDeleteNames = hasActivity
    ? findStaleDocuments(db, documentCutoffMs, options.batchSize)
    : [];
  // The whole backlog: a run deletes at most one batch of it.
  const staleTotal = hasActivity
    ? findStaleDocuments(db, documentCutoffMs, Number.MAX_SAFE_INTEGER).length
    : 0;
  const expiredTombstoneCount = hasTable(db, "document_tombstones")
    ? countExpiredTombstones(db, tombstoneCutoffMs)
    : 0;
  return {
    wouldDeleteCount: wouldDeleteNames.length,
    wouldDeleteNames,
    staleTotal,
    expiredTombstoneCount,
  };
}

/**
 * Copies the database to `backups/db-<UTC time>.sqlite` next to `dbPath`
 * with `VACUUM INTO` (a consistent snapshot, safe while Hocus writes), then
 * keeps only the newest `keep` backups. Throws if the copy fails.
 */
export function backupDatabase(
  db: Database,
  dbPath: string,
  { nowMs = Date.now(), keep = PURGE_BACKUPS_KEPT } = {},
): string {
  const dir = path.join(path.dirname(path.resolve(dbPath)), "backups");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stamp = new Date(nowMs).toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `db-${stamp}.sqlite`);
  db.prepare("VACUUM INTO ?").run(file);

  const backups = readdirSync(dir)
    .filter((name) => /^db-.+\.sqlite$/.test(name))
    .sort();
  for (const old of backups.slice(0, Math.max(0, backups.length - keep))) {
    rmSync(path.join(dir, old), { force: true });
  }
  return file;
}

function purgeWithBusyRetry(db: Database): void {
  try {
    const result = runRetentionPurge(db);
    logAbuseEvent("retention_purge_completed", {
      deletedCount: result.deletedCount,
      deletedNames: result.deletedNames,
    });
  } catch (error) {
    if (!isSqliteBusyError(error)) throw error;
    const retried = runRetentionPurge(db);
    logAbuseEvent("retention_purge_completed_retry", {
      deletedCount: retried.deletedCount,
      deletedNames: retried.deletedNames,
    });
  }
}

function runCli(): void {
  const mode = parsePurgeMode(process.env.PURGE_MODE);
  if (mode === "off") {
    logAbuseEvent("retention_purge_skipped", { mode });
    return;
  }

  const db = openSqlite({ busyTimeoutMs: 10_000 });
  try {
    if (mode === "dry-run") {
      logAbuseEvent("retention_purge_dry_run", {
        retentionDays: RETENTION_DAYS,
        tombstoneRetentionDays: TOMBSTONE_RETENTION_DAYS,
        ...previewRetentionPurge(db),
      });
      return;
    }

    let backup: string;
    try {
      backup = backupDatabase(db, getSqliteDbPath());
    } catch (error) {
      logAbuseEvent("retention_purge_backup_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      process.exitCode = 1;
      return;
    }
    logAbuseEvent("retention_purge_backup_written", { backup });
    purgeWithBusyRetry(db);
  } finally {
    db.close();
  }
}

if (import.meta.main) {
  runCli();
}
