/**
 * `SqliteDriver` over `node:sqlite`, for the Electron storage worker
 * (D-A1). `node:sqlite` returns `undefined` for a missing row and plain
 * numbers by default, which is what the driver contract wants; BLOBs come
 * back as fresh `Uint8Array`s. Loaded with `process.getBuiltinModule`, so a
 * build of Electron without it fails here with a clear error (D-A12).
 */
import type { DatabaseSync } from "node:sqlite";

import {
  applyBusyTimeout,
  type OpenSqlite,
  type SqliteDriver,
  type SqliteStatement,
  type SqlRow,
  type SqlValue,
} from "../engine/driver";

type NodeSqlite = typeof import("node:sqlite");

function loadNodeSqlite(): NodeSqlite {
  const sqlite = process.getBuiltinModule("node:sqlite") as
    | NodeSqlite
    | undefined;
  if (!sqlite) throw new Error("node:sqlite is not built into this runtime");
  return sqlite;
}

function wrap(db: DatabaseSync): SqliteDriver {
  const cache = new Map<string, SqliteStatement>();
  return {
    exec: (sql) => db.exec(sql),
    prepare(sql) {
      const cached = cache.get(sql);
      if (cached) return cached;
      const statement = db.prepare(sql);
      const wrapped: SqliteStatement = {
        run: (...params: SqlValue[]) => {
          const result = statement.run(...params);
          return {
            changes: Number(result.changes),
            lastInsertRowid: Number(result.lastInsertRowid),
          };
        },
        get: (...params: SqlValue[]) =>
          statement.get(...params) as SqlRow | undefined,
        all: (...params: SqlValue[]) => statement.all(...params) as SqlRow[],
      };
      cache.set(sql, wrapped);
      return wrapped;
    },
    close: () => db.close(),
  };
}

export const openNodeSqlite: OpenSqlite = (path, { readOnly }) => {
  const { DatabaseSync } = loadNodeSqlite();
  return applyBusyTimeout(
    wrap(
      new DatabaseSync(path, {
        readOnly,
        // The engine turns them on itself, the same on both drivers.
        enableForeignKeyConstraints: false,
      }),
    ),
  );
};
