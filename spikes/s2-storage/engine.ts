// The storage engine under test: `node:sqlite` with the D-A6 pragmas and the
// docs / snapshots / updates schema. Runs in the worker thread, or on main's
// own thread for the S5 `electron-main-commits` arm.
import { writeSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";

export type Synchronous = "FULL" | "OFF";

export interface OpenOptions {
  path: string;
  synchronous: Synchronous;
  /** macOS only; default on. Off is the plain-fsync control. */
  fullfsync?: boolean;
}

export interface Pragmas {
  journal_mode: unknown;
  synchronous: unknown;
  fullfsync: unknown;
  checkpoint_fullfsync: unknown;
  sqlite_version: unknown;
}

export interface Row {
  seq: number;
  data: Uint8Array;
}

export interface Loaded {
  snapshot: Row | null;
  updates: Row[];
}

const isMac = process.platform === "darwin";

/** Writes a protocol line straight to fd 1, so it is out before the next step. */
export const line = (text: string) => {
  writeSync(1, `${text}\n`);
};

export const openDatabase = ({
  path,
  synchronous,
  fullfsync = true,
}: OpenOptions) => {
  // `require`, not `import`: this is the D-A12 question (does it load?).
  const { DatabaseSync: Database } =
    require("node:sqlite") as typeof import("node:sqlite");
  const db: DatabaseSync = new Database(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`PRAGMA synchronous = ${synchronous}`);
  if (isMac && fullfsync) {
    db.exec("PRAGMA fullfsync = 1");
    db.exec("PRAGMA checkpoint_fullfsync = 1");
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS docs (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS snapshots (
      doc_id TEXT PRIMARY KEY,
      seq INTEGER NOT NULL,
      data BLOB NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS updates (
      doc_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      origin TEXT NOT NULL,
      data BLOB NOT NULL,
      PRIMARY KEY (doc_id, seq)
    ) STRICT, WITHOUT ROWID;
  `);
  return db;
};

const pragma = (db: DatabaseSync, name: string) => {
  const row = db.prepare(`PRAGMA ${name}`).get() as
    | Record<string, unknown>
    | undefined;
  return row ? Object.values(row)[0] : null;
};

export const readPragmas = (db: DatabaseSync): Pragmas => ({
  journal_mode: pragma(db, "journal_mode"),
  synchronous: pragma(db, "synchronous"),
  fullfsync: pragma(db, "fullfsync"),
  checkpoint_fullfsync: pragma(db, "checkpoint_fullfsync"),
  sqlite_version: (
    db.prepare("SELECT sqlite_version() AS v").get() as { v: string }
  ).v,
});

export const ensureDoc = (db: DatabaseSync, docId: string) => {
  db.prepare("INSERT OR IGNORE INTO docs (id, created_at) VALUES (?, ?)").run(
    docId,
    Date.now(),
  );
};

/** One batch, one transaction. Prints `ACK <seq>` once COMMIT has returned. */
export const appendBatch = (db: DatabaseSync, docId: string, rows: Row[]) => {
  const insert = db.prepare(
    "INSERT INTO updates (doc_id, seq, origin, data) VALUES (?, ?, 'local', ?)",
  );
  const last = rows[rows.length - 1];
  if (!last) return;
  line(`BATCH_BEGIN ${rows[0]?.seq} ${last.seq}`);
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const row of rows) insert.run(docId, row.seq, row.data);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  line(`ACK ${last.seq}`);
};

/**
 * Compaction: the renderer's `encodeStateAsUpdate` plus the seq it covers,
 * in one transaction.
 */
export const compact = (
  db: DatabaseSync,
  docId: string,
  seq: number,
  snapshot: Uint8Array,
) => {
  line(`COMPACT_BEGIN ${seq} ${snapshot.byteLength}`);
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      `INSERT INTO snapshots (doc_id, seq, data) VALUES (?, ?, ?)
       ON CONFLICT (doc_id) DO UPDATE SET seq = excluded.seq, data = excluded.data`,
    ).run(docId, seq, snapshot);
    db.prepare("DELETE FROM updates WHERE doc_id = ? AND seq <= ?").run(
      docId,
      seq,
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  line(`COMPACT_ACK ${seq}`);
};

export const load = (db: DatabaseSync, docId: string): Loaded => {
  const snapshot =
    (db
      .prepare("SELECT seq, data FROM snapshots WHERE doc_id = ?")
      .get(docId) as Row | undefined) ?? null;
  const updates = db
    .prepare(
      "SELECT seq, data FROM updates WHERE doc_id = ? AND seq > ? ORDER BY seq",
    )
    .all(docId, snapshot?.seq ?? 0) as unknown as Row[];
  return { snapshot, updates };
};

/** Integrity facts for the kill harness: no Yjs here, only rows. */
export const inspect = (db: DatabaseSync, docId: string) => {
  const quickCheck = db
    .prepare("PRAGMA quick_check")
    .all()
    .map((row) => Object.values(row as Record<string, unknown>)[0]);
  const snapshot = db
    .prepare("SELECT seq FROM snapshots WHERE doc_id = ?")
    .get(docId) as { seq: number } | undefined;
  const seqs = (
    db
      .prepare("SELECT seq FROM updates WHERE doc_id = ? ORDER BY seq")
      .all(docId) as { seq: number }[]
  ).map((row) => row.seq);
  const snapshotSeq = snapshot?.seq ?? 0;
  // Fully before or fully after a compaction: rows start right after the
  // snapshot's seq and have no gaps.
  const contiguous = seqs.every((seq, i) => seq === snapshotSeq + 1 + i);
  return {
    quickCheck,
    snapshotSeq,
    rowCount: seqs.length,
    minRowSeq: seqs[0] ?? null,
    maxSeq: seqs[seqs.length - 1] ?? snapshotSeq,
    contiguous,
  };
};

/** One 4 KB row per transaction; returns the commit time in ms. */
export const timedCommit = (
  db: DatabaseSync,
  insert: ReturnType<DatabaseSync["prepare"]>,
  seq: number,
  payload: Uint8Array,
) => {
  const start = performance.now();
  db.exec("BEGIN IMMEDIATE");
  insert.run("commit-loop", seq, payload);
  db.exec("COMMIT");
  return performance.now() - start;
};
