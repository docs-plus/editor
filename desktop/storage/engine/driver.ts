/**
 * The engine's only view of SQLite (desktop architecture §3, §12 "Mobile").
 * Two drivers implement it: `node:sqlite` in the Electron storage worker
 * (`desktop/storage/drivers/node-sqlite.ts`) and `bun:sqlite` for unit tests
 * and the dev storage host (`desktop/dev/bun-sqlite-driver.ts`).
 *
 * Drivers normalize what differs between the two runtimes, so the engine
 * behaves the same on both:
 * - a missing row is `undefined` (Bun returns `null`);
 * - integers are numbers (no `bigint`);
 * - a BLOB is a `Uint8Array` the caller owns;
 * - parameters are positional `?` only;
 * - a failure carries the SQLite extended result code (see
 *   {@link sqliteResultCode}).
 */
import { StorageError, type StorageErrorCode } from "./errors";

export type SqlValue = string | number | null | Uint8Array;
export type SqlRow = Record<string, SqlValue>;

export interface SqliteStatement {
  run(...params: SqlValue[]): { changes: number; lastInsertRowid: number };
  get(...params: SqlValue[]): SqlRow | undefined;
  all(...params: SqlValue[]): SqlRow[];
}

export interface SqliteDriver {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

export type OpenSqlite = (
  path: string,
  options: { readOnly: boolean },
) => SqliteDriver;

/**
 * The SQLite extended result code of a driver error, or null when the error
 * did not come from SQLite. Bun puts it in `errno`, Node in `errcode`.
 */
export function sqliteResultCode(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const { errno, errcode } = error as { errno?: unknown; errcode?: unknown };
  if (typeof errcode === "number") return errcode;
  // Bun's SQLiteError: its constructor reports as Error, its name doesn't.
  if (typeof errno === "number" && (error as Error).name === "SQLiteError")
    return errno;
  return null;
}

// Primary result codes (https://sqlite.org/rescode.html).
const SQLITE_PERM = 3;
const SQLITE_BUSY = 5;
const SQLITE_LOCKED = 6;
const SQLITE_READONLY = 8;
const SQLITE_IOERR = 10;
const SQLITE_CORRUPT = 11;
const SQLITE_FULL = 13;
const SQLITE_CANTOPEN = 14;
const SQLITE_CONSTRAINT = 19;
const SQLITE_NOTADB = 26;

/** Maps a driver failure to the storage error a caller sees. */
export function storageErrorFrom(error: unknown): StorageError {
  if (error instanceof StorageError) return error;
  const code = sqliteResultCode(error);
  const message = error instanceof Error ? error.message : String(error);
  let mapped: StorageErrorCode = "io_error";
  switch (code === null ? null : code & 0xff) {
    case SQLITE_FULL:
      mapped = "disk_full";
      break;
    case SQLITE_CORRUPT:
    case SQLITE_NOTADB:
      mapped = "corrupt";
      break;
    case SQLITE_BUSY:
    case SQLITE_LOCKED:
      mapped = "locked_elsewhere";
      break;
    case SQLITE_READONLY:
    case SQLITE_PERM:
      mapped = "library_read_only";
      break;
    case SQLITE_CONSTRAINT:
      // A duplicate tag name or link key: the caller's input, not the disk.
      mapped = "invalid_argument";
      break;
    case SQLITE_CANTOPEN:
    case SQLITE_IOERR:
      mapped = "io_error";
      break;
  }
  return new StorageError(mapped, message);
}
