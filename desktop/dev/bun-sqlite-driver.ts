/**
 * `SqliteDriver` over `bun:sqlite`, for unit tests and the dev storage host
 * (architecture §11). Normalizes Bun's differences from `node:sqlite`: a
 * missing row is `null` in Bun and `undefined` here, and integers stay
 * numbers (`safeIntegers` off).
 *
 * `close` finalizes every cached statement first: Bun's `close()` leaves a
 * connection with live statements open as a zombie that keeps the file
 * handles, which on Windows blocks deleting or replacing the library.
 */
import { Database } from "bun:sqlite";

import type {
  OpenSqlite,
  SqliteDriver,
  SqliteStatement,
  SqlRow,
  SqlValue,
} from "@/desktop/storage/engine/driver";

export const openBunSqlite: OpenSqlite = (path, { readOnly }) => {
  const db = readOnly
    ? new Database(path, { readonly: true })
    : new Database(path, { create: true });
  const cache = new Map<string, SqliteStatement>();
  const statements: { finalize(): void }[] = [];
  const driver: SqliteDriver = {
    exec: (sql) => db.exec(sql),
    prepare(sql) {
      const cached = cache.get(sql);
      if (cached) return cached;
      const statement = db.prepare<SqlRow, SqlValue[]>(sql);
      statements.push(statement);
      const wrapped: SqliteStatement = {
        run: (...params) => {
          const result = statement.run(...params);
          return {
            changes: result.changes,
            lastInsertRowid: Number(result.lastInsertRowid),
          };
        },
        get: (...params) => statement.get(...params) ?? undefined,
        all: (...params) => statement.all(...params),
      };
      cache.set(sql, wrapped);
      return wrapped;
    },
    close: () => {
      for (const statement of statements) statement.finalize();
      statements.length = 0;
      cache.clear();
      db.close();
    },
  };
  return driver;
};
