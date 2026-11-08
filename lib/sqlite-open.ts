import Database from "better-sqlite3";

import { getSqliteDbPath } from "@/lib/sqlite-db-path";

/** SQLite `SQLITE_BUSY` result code */
export const SQLITE_BUSY = 5;

type SqliteBinding = string | number | bigint | boolean | Uint8Array;

/**
 * Statement surface shared by better-sqlite3 (Next.js, scripts and tests on
 * Node) and `bun:sqlite` (Hocuspocus server on Bun).
 */
export interface SqliteStatement {
  run(...params: SqliteBinding[]): unknown;
  get(...params: SqliteBinding[]): unknown;
  all(...params: SqliteBinding[]): unknown[];
}

/** Driver-agnostic handle for helpers that only run plain SQL. */
export interface SqliteDatabase {
  exec(sql: string): unknown;
  prepare(sql: string): SqliteStatement;
}

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
