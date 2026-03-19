import Database from "better-sqlite3";

import { getSqliteDbPath } from "@/lib/sqlite-db-path";

/** better-sqlite3 / sqlite3 `SQLITE_BUSY` */
export const SQLITE_BUSY = 5;

export function openBetterSqlite(options?: {
  /** Default 5000 */
  timeoutMs?: number;
  /** If set, runs `PRAGMA busy_timeout = …` (ms) */
  busyTimeoutMs?: number;
}): Database.Database {
  const timeoutMs = options?.timeoutMs ?? 5000;
  const db = new Database(getSqliteDbPath(), { timeout: timeoutMs });
  db.pragma("journal_mode = WAL");
  if (options?.busyTimeoutMs != null) {
    db.pragma(`busy_timeout = ${options.busyTimeoutMs}`);
  }
  return db;
}
