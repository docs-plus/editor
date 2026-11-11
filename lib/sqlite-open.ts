import { Database, SQLiteError } from "bun:sqlite";

import { getSqliteDbPath } from "@/lib/sqlite-db-path";

export function isSqliteBusyError(error: unknown): boolean {
  return error instanceof SQLiteError && error.code === "SQLITE_BUSY";
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
