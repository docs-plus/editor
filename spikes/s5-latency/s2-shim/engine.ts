// TEMPORARY stand-in for spikes/s2-storage/engine.ts until spike/s2-storage is
// pushed and merged; same pragmas (WAL, synchronous FULL, fullfsync on macOS).
import type { DatabaseSync, StatementSync } from "node:sqlite";

export type Synchronous = "FULL" | "OFF";

export const openDatabase = ({
  path,
  synchronous,
}: {
  path: string;
  synchronous: Synchronous;
}) => {
  const { DatabaseSync: Database } =
    require("node:sqlite") as typeof import("node:sqlite");
  const db: DatabaseSync = new Database(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`PRAGMA synchronous = ${synchronous}`);
  if (process.platform === "darwin") {
    db.exec("PRAGMA fullfsync = 1");
    db.exec("PRAGMA checkpoint_fullfsync = 1");
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS docs (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS updates (
      doc_id TEXT NOT NULL, seq INTEGER NOT NULL, origin TEXT NOT NULL, data BLOB NOT NULL,
      PRIMARY KEY (doc_id, seq)
    ) STRICT, WITHOUT ROWID;
  `);
  return db;
};

export const timedCommit = (
  db: DatabaseSync,
  insert: StatementSync,
  seq: number,
  payload: Uint8Array,
) => {
  const start = performance.now();
  db.exec("BEGIN IMMEDIATE");
  insert.run("commit-loop", seq, payload);
  db.exec("COMMIT");
  return performance.now() - start;
};
