import type { SqliteDriver, SqlRow } from "./driver";
import { storageErrorFrom } from "./driver";

/**
 * Runs `body` in one `BEGIN IMMEDIATE … COMMIT`: one transaction, one fsync.
 * Any throw rolls back, and a driver failure becomes a `StorageError`.
 */
export function transaction<T>(db: SqliteDriver, body: () => T): T {
  try {
    db.exec("BEGIN IMMEDIATE");
  } catch (error) {
    throw storageErrorFrom(error);
  }
  try {
    const result = body();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // The failed statement may already have rolled the transaction back.
    }
    throw storageErrorFrom(error);
  }
}

/** Reads one column of one row; undefined when there is no row. */
export function scalar(
  db: SqliteDriver,
  sql: string,
  ...params: (string | number | null)[]
): SqlRow[string] | undefined {
  const row = db.prepare(sql).get(...params);
  return row ? Object.values(row)[0] : undefined;
}

export function readMeta(db: SqliteDriver, key: string): string | null {
  const value = scalar(db, "SELECT value FROM meta WHERE key = ?", key);
  return typeof value === "string" ? value : null;
}

export function writeMeta(db: SqliteDriver, key: string, value: string) {
  db.prepare(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}

/** `meta.rev`: moves on every change the files sidebar shows. */
export function readRev(db: SqliteDriver): number {
  return Number.parseInt(readMeta(db, "rev") ?? "0", 10);
}

/** Bumps `meta.rev`; call inside the write's transaction. */
export function bumpRev(db: SqliteDriver): number {
  const rev = readRev(db) + 1;
  writeMeta(db, "rev", String(rev));
  return rev;
}

/** 32 lowercase hex characters from the platform CSPRNG (`link_key`). */
export function randomHex32(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
