import { getSqliteDbPath } from "@/lib/sqlite-db-path";

import { Database } from "bun:sqlite";

/** SQLite `SQLITE_BUSY` result code */
const SQLITE_BUSY = 5;

/** True for `SQLITE_BUSY` errors from `bun:sqlite` (`errno` 5). */
export function isSqliteBusyError(error: unknown): boolean {
  const { code, errno } = (error ?? {}) as { code?: unknown; errno?: unknown };
  return code === "SQLITE_BUSY" || errno === SQLITE_BUSY;
}

/**
 * Opens the shared SQLite file (`DB_PATH`) in WAL mode. Next.js, the
 * Hocuspocus server and the retention script all run on Bun and share it.
 */
export function openSqlite({
  busyTimeoutMs = 5000,
}: {
  /** How long a write waits for another process's lock. Default 5000 ms. */
  busyTimeoutMs?: number;
} = {}): Database {
  const db = new Database(getSqliteDbPath());
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs};`);
  return db;
}
