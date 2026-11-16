import type { Database } from "bun:sqlite";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import path from "node:path";

import { logAbuseEvent } from "../lib/security/abuse-log";
import {
  bootstrapDocumentActivityTable,
  countExpiredTombstones,
  countStaleDocuments,
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
 * purges. PM2 runs this daily (editor-purge in ecosystem.config.cjs); a run
 * started by a deploy exits at once (see DEPLOY_MARKER_NAME).
 */
export type PurgeMode = "off" | "dry-run" | "on";

const PURGE_MODES: readonly PurgeMode[] = ["off", "dry-run", "on"];

/** Days a dated backup is kept; `db-first.sqlite` is kept forever. */
export const PURGE_BACKUP_RETENTION_DAYS = 14;

/** The very first backup, taken before the first real purge. Never deleted. */
export const FIRST_BACKUP_NAME = "db-first.sqlite";

/**
 * `scripts/deploy.sh` writes this file (Unix seconds) next to the database
 * just before it registers editor-purge with PM2. PM2 cannot register an app
 * without running it, so the run that follows finds the marker, deletes it
 * and exits: deploys never purge, only the cron does.
 */
export const DEPLOY_MARKER_NAME = ".purge-skip-next";

/** A marker older than this is ignored (the run it was for never came). */
const DEPLOY_MARKER_MAX_AGE_MS = 10 * 60 * 1000;

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
    ? countStaleDocuments(db, documentCutoffMs)
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
 * Deletes the deploy marker next to `dbPath` and says whether it was fresh,
 * i.e. whether this run was started by a deploy registering the app.
 */
export function consumeDeployMarker(
  dbPath: string,
  nowMs: number = Date.now(),
): boolean {
  const marker = path.join(
    path.dirname(path.resolve(dbPath)),
    DEPLOY_MARKER_NAME,
  );
  if (!existsSync(marker)) return false;
  const writtenAtMs = Number(readFileSync(marker, "utf8").trim()) * 1000;
  rmSync(marker, { force: true });
  const ageMs = nowMs - writtenAtMs;
  return ageMs >= 0 && ageMs < DEPLOY_MARKER_MAX_AGE_MS;
}

const backupStamp = (ms: number) =>
  `db-${new Date(ms).toISOString().replace(/[:.]/g, "-")}.sqlite`;

/**
 * Copies the database with `VACUUM INTO` (a consistent snapshot, safe while
 * Hocus writes) into `backups/` next to `dbPath`. The first backup ever is
 * `db-first.sqlite` and is kept forever; later ones are
 * `db-<UTC time>.sqlite`, deleted after PURGE_BACKUP_RETENTION_DAYS. The copy
 * is written under a temporary name and renamed, so a killed run never
 * leaves a half-written backup. Throws if the copy fails.
 */
export function backupDatabase(
  db: Database,
  dbPath: string,
  {
    nowMs = Date.now(),
    retentionDays = PURGE_BACKUP_RETENTION_DAYS,
  }: { nowMs?: number; retentionDays?: number } = {},
): string {
  const dir = path.join(path.dirname(path.resolve(dbPath)), "backups");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const first = path.join(dir, FIRST_BACKUP_NAME);
  const file = existsSync(first) ? path.join(dir, backupStamp(nowMs)) : first;
  const partial = `${file}.partial`;
  // A run killed while copying leaves its .partial behind under a name no
  // later run would reuse. Only one purge runs at a time, so any left is junk.
  for (const name of readdirSync(dir)) {
    if (name.endsWith(".partial"))
      rmSync(path.join(dir, name), { force: true });
  }
  db.prepare("VACUUM INTO ?").run(partial);
  renameSync(partial, file);

  // Dated names sort by time, so everything before the cutoff's name is
  // older than the retention window. db-first.sqlite never matches.
  const cutoff = backupStamp(nowMs - retentionDays * DAY_MS);
  for (const name of readdirSync(dir)) {
    if (/^db-\d{4}-\d{2}-\d{2}T[\d-]+Z\.sqlite$/.test(name) && name < cutoff) {
      rmSync(path.join(dir, name), { force: true });
    }
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
  if (consumeDeployMarker(getSqliteDbPath())) {
    logAbuseEvent("retention_purge_registered", { mode });
    return;
  }
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
