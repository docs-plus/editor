/**
 * Repair and rebuild (offline revision §4.5, P2.6f). Idempotent: running
 * it twice changes nothing.
 *
 * - **Check** (idle, at most daily, read-mostly): raise `head_seq` to
 *   `MAX(seq)` (never lower it, I6), recompute `size_bytes` (I9), assert
 *   I1–I4 and report violations without fixing them silently, report
 *   `doc_blobs` rows whose document is gone with no `dropped_at` (§4.6).
 * - **Rebuild index** (Settings › Storage, or a `derive_version` change):
 *   `derived_seq = NULL` in chunks of 500 rows, one transaction each, so
 *   appends interleave; the derive queue then drains. The only path that
 *   resets derivation.
 * - **After a failed `quick_check`** (SEC-009): never repair in place. Read
 *   the damaged file read-only and rebuild into a new file in the explicit
 *   table order, keeping rows that read cleanly; run `foreign_key_check`
 *   and `integrity_check` on it. The damaged file is kept.
 */
import { readOnlyUri } from "./copy-library";
import type { OpenSqlite, SqliteDriver, SqlRow, SqlValue } from "./driver";
import { storageErrorFrom } from "./driver";
import { StorageError } from "./errors";
import { MAX_FOLDER_DEPTH, TABLES_V2 } from "./format-2";
import type { StorageHost } from "./host";
import { FORMAT_STEPS, runFormatSteps } from "./migrations";
import { FORMAT_VERSION, SCHEMA_V1, YJS_ENCODING } from "./schema";
import { bumpRev, scalar, transaction, writeMeta } from "./sql";

export type RepairReport = {
  /** Documents whose `head_seq` rose to their newest row. */
  headSeqRaised: number;
  /** Documents whose `size_bytes` was recomputed. */
  sizeFixed: number;
  /** I1–I4 violations, one line each, reported and never fixed silently. */
  violations: string[];
  /** `doc_blobs` rows of purged documents with no `dropped_at`. */
  orphanBlobRows: number;
};

export type RebuildReport = {
  copiedRows: number;
  skippedRows: number;
  /** `foreign_key_check` and `integrity_check` on the new file. */
  foreignKeyCheck: "ok" | string;
  integrityCheck: "ok" | string;
};

export const RESET_CHUNK = 500;

// ── Check mode ──────────────────────────────────────────────────────────

/** The highest seq a document has: its newest row, or its snapshot's. */
const NEWEST_SEQ = `MAX(
  COALESCE((SELECT MAX(seq) FROM updates u WHERE u.doc_id = docs.id), 0),
  COALESCE((SELECT upto_seq FROM snapshots s WHERE s.doc_id = docs.id), 0))`;

/** I9, as `compact` writes it: the snapshot plus every remaining row. */
const STORED_BYTES = `
  COALESCE((SELECT LENGTH(data) FROM snapshots s WHERE s.doc_id = docs.id), 0)
  + COALESCE((SELECT SUM(LENGTH(data)) FROM updates u WHERE u.doc_id = docs.id), 0)`;

type FolderNode = { parent: string | null; trashed: boolean };

/**
 * The folder ids above `id`, nearest first, or null when the chain loops.
 * A parent that doesn't exist ends the chain (I1 reports it).
 */
function ancestors(
  folders: ReadonlyMap<string, FolderNode>,
  id: string | null,
): string[] | null {
  const chain: string[] = [];
  for (let at = id; at !== null; at = folders.get(at)?.parent ?? null) {
    if (chain.includes(at)) return null;
    chain.push(at);
  }
  return chain;
}

/** I2 (a forest at most {@link MAX_FOLDER_DEPTH} deep) and I4. */
function folderViolations(db: SqliteDriver): string[] {
  const out: string[] = [];
  const folders = new Map<string, FolderNode>();
  for (const row of db
    .prepare("SELECT id, parent_id, trashed_at FROM folders ORDER BY id")
    .all())
    folders.set(String(row.id), {
      parent: typeof row.parent_id === "string" ? row.parent_id : null,
      trashed: row.trashed_at !== null,
    });
  const trashedIn = (chain: string[]) =>
    chain.find((id) => folders.get(id)?.trashed === true);
  for (const [id, folder] of folders) {
    const chain = ancestors(folders, id);
    if (chain === null) {
      out.push(`I2 folder ${id} is in a cycle`);
      continue;
    }
    if (chain.length > MAX_FOLDER_DEPTH)
      out.push(`I2 folder ${id} is at depth ${chain.length}`);
    const trashed = folder.trashed ? undefined : trashedIn(chain.slice(1));
    if (trashed)
      out.push(
        `I4 folder ${id}: folder ${trashed} in its chain is in the Trash`,
      );
  }
  for (const row of db
    .prepare(
      "SELECT id, folder_id FROM docs WHERE trashed_at IS NULL AND folder_id IS NOT NULL ORDER BY id",
    )
    .all()) {
    const trashed = trashedIn(ancestors(folders, String(row.folder_id)) ?? []);
    if (trashed)
      out.push(
        `I4 doc ${row.id}: folder ${trashed} in its chain is in the Trash`,
      );
  }
  return out;
}

/** I3: trash columns set without `trashed_at` (the CHECKs refuse these). */
function trashColumnViolations(db: SqliteDriver): string[] {
  const out: string[] = [];
  for (const [table, what] of [
    ["docs", "doc"],
    ["folders", "folder"],
  ] as const)
    for (const row of db
      .prepare(
        `SELECT id FROM ${table} WHERE trashed_at IS NULL
           AND (trash_group IS NOT NULL OR trashed_from IS NOT NULL) ORDER BY id`,
      )
      .all())
      out.push(`I3 ${what} ${row.id}: trash columns set without trashed_at`);
  return out;
}

/** Check mode. */
export function checkLibrary(
  db: SqliteDriver,
  _host: StorageHost,
  _now: number,
): RepairReport {
  return transaction(db, () => {
    // I6: only ever raised (the `docs_head_seq_rises` trigger agrees).
    const headSeqRaised = db
      .prepare(
        `UPDATE docs SET head_seq = ${NEWEST_SEQ} WHERE head_seq < ${NEWEST_SEQ}`,
      )
      .run().changes;
    const sizeFixed = db
      .prepare(
        `UPDATE docs SET size_bytes = ${STORED_BYTES}
         WHERE size_bytes IS NOT ${STORED_BYTES}`,
      )
      .run().changes;
    // The sidebar shows the size; a run that fixes nothing writes nothing.
    if (headSeqRaised + sizeFixed > 0) bumpRev(db);
    const violations = [
      ...db
        .prepare("PRAGMA foreign_key_check")
        .all()
        .map((row) => `I1 ${JSON.stringify(row)}`),
      ...folderViolations(db),
      ...trashColumnViolations(db),
    ];
    // §4.6: reported, never deleted; GC's grace starts only at a purge.
    const orphanBlobRows = Number(
      scalar(
        db,
        `SELECT COUNT(*) FROM doc_blobs b WHERE b.dropped_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM docs d WHERE d.id = b.doc_id)`,
      ),
    );
    return { headSeqRaised, sizeFixed, violations, orphanBlobRows };
  });
}

// ── Rebuild index ───────────────────────────────────────────────────────

/**
 * One chunk of "Rebuild index": sets `derived_seq = NULL` on up to
 * {@link RESET_CHUNK} documents that still have one, in one transaction.
 * Returns how many it reset; 0 means done.
 *
 * The hashes go too: `derive.put` rewrites only a side whose hash changed,
 * so a kept hash would keep damaged rows that hash the same as fresh ones.
 */
export function resetDerivedChunk(db: SqliteDriver): number {
  return transaction(
    db,
    () =>
      db
        .prepare(
          `UPDATE docs SET derived_seq = NULL, links_hash = NULL, headings_hash = NULL
           WHERE id IN (SELECT id FROM docs
             WHERE derived_seq IS NOT NULL OR links_hash IS NOT NULL
               OR headings_hash IS NOT NULL
             LIMIT ?)`,
        )
        .run(RESET_CHUNK).changes,
  );
}

// ── Rebuild into a new file ─────────────────────────────────────────────

/** Rows per read from the damaged file. */
const READ_BATCH = 32;

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** Runs `read`; a throw (a damaged page) comes back as `ok: false`. */
function attempt<T>(read: () => T): { ok: true; value: T } | { ok: false } {
  try {
    return { ok: true, value: read() };
  } catch {
    return { ok: false };
  }
}

/**
 * Opens the damaged file read-only. A WAL library with no `-shm` can't be
 * opened read-only, so with no `-wal` either it is opened immutable: there
 * is no WAL to miss. With a `-wal`, immutable would skip committed rows, so
 * the open fails instead.
 */
function openSource(
  openSqlite: OpenSqlite,
  host: StorageHost,
  source: string,
): SqliteDriver {
  if (!host.exists(source))
    throw new StorageError("not_found", "no library at that path");
  const probe = (db: SqliteDriver) =>
    db.prepare("SELECT COUNT(*) FROM sqlite_master").get();
  const db = openSqlite(source, { readOnly: true });
  try {
    probe(db);
    return db;
  } catch (error) {
    db.close();
    if (host.exists(`${source}-wal`)) throw storageErrorFrom(error);
  }
  const immutable = openSqlite(`${readOnlyUri(source)}&immutable=1`, {
    readOnly: true,
  });
  try {
    probe(immutable);
    return immutable;
  } catch (error) {
    immutable.close();
    throw storageErrorFrom(error);
  }
}

/**
 * A new format-2 file, made the way `Library.open` makes a new library:
 * `SCHEMA_V1`, then the same format steps. (`Library.open` itself takes a
 * folder and its lock, and `library.ts` imports this module.)
 */
function createSchema(db: SqliteDriver, host: StorageHost) {
  db.exec("PRAGMA journal_mode = DELETE");
  db.exec("PRAGMA synchronous = FULL");
  transaction(db, () => {
    db.exec(SCHEMA_V1);
    writeMeta(db, "format_version", "1");
    writeMeta(db, "yjs_encoding", YJS_ENCODING);
    writeMeta(db, "library_id", crypto.randomUUID());
    writeMeta(db, "created_at", String(host.now()));
    writeMeta(db, "rev", "0");
    writeMeta(db, "unclean_exit", "0");
  });
  runFormatSteps(db, host, "", FORMAT_VERSION, FORMAT_STEPS, { fresh: true });
}

function columnsOf(db: SqliteDriver, table: string): string[] {
  return db
    .prepare(`PRAGMA table_info(${quote(table)})`)
    .all()
    .map((column) => String(column.name));
}

function primaryKeyOf(db: SqliteDriver, table: string): string[] {
  return db
    .prepare(`PRAGMA table_info(${quote(table)})`)
    .all()
    .filter((column) => Number(column.pk) > 0)
    .sort((a, b) => Number(a.pk) - Number(b.pk))
    .map((column) => String(column.name));
}

/**
 * Reads a rowid table in rowid order, passing each readable row to `emit`.
 * A row that can't be read is skipped; a damaged page is stepped over by
 * finding the smallest rowid a read can start from without touching it
 * (gallop, then bisect). Reads start at a rowid (`>=`): a seek to a key
 * lands on the page that would hold it, so `> last` would land on the
 * damaged page whenever `last` is that page's divider.
 */
function readRowidTable(
  db: SqliteDriver,
  table: string,
  columns: readonly string[],
  emit: (row: SqlRow) => void,
) {
  const select = db.prepare(
    `SELECT rowid AS rowid_, ${columns.map(quote).join(", ")} FROM ${quote(table)}
     NOT INDEXED WHERE rowid >= ? ORDER BY rowid LIMIT ?`,
  );
  const nextKey = db.prepare(
    `SELECT rowid AS rowid_ FROM ${quote(table)} NOT INDEXED
     WHERE rowid >= ? ORDER BY rowid LIMIT 1`,
  );
  /** Whether a read starting at `key` gets past the damage. */
  const clears = (key: number) => attempt(() => nextKey.get(key)).ok;
  /** The smallest start after `from` (which fails) that clears it. */
  const pastDamage = (from: number): number | null => {
    let low = from;
    let step = 1;
    while (!clears(from + step)) {
      low = from + step;
      step *= 2;
      if (from + step > Number.MAX_SAFE_INTEGER) return null;
    }
    let high = from + step;
    while (high - low > 1) {
      const middle = low + Math.floor((high - low) / 2);
      if (clears(middle)) high = middle;
      else low = middle;
    }
    return high;
  };
  let start = Number.MIN_SAFE_INTEGER;
  for (;;) {
    const batch = attempt(() => select.all(start, READ_BATCH));
    if (batch.ok) {
      const last = batch.value.at(-1);
      if (!last) return;
      for (const row of batch.value) emit(row);
      start = Number(last.rowid_) + 1;
      continue;
    }
    // Something in this batch is damaged: go one row at a time.
    const key = attempt(() => nextKey.get(start));
    if (!key.ok) {
      const past = pastDamage(start);
      if (past === null) return;
      start = past;
      continue;
    }
    if (!key.value) return;
    const one = attempt(() => select.all(start, 1));
    if (one.ok && one.value[0]) emit(one.value[0]);
    start = Number(key.value.rowid_) + 1;
  }
}

/**
 * Reads a WITHOUT ROWID table in key order. Its first key column is a
 * document id; past a damaged page the read resumes at the next document
 * in `docIds` (sorted).
 */
function readKeyedTable(
  db: SqliteDriver,
  table: string,
  columns: readonly string[],
  key: readonly string[],
  docIds: readonly string[],
  emit: (row: SqlRow) => void,
) {
  const list = columns.map(quote).join(", ");
  const order = key.map(quote).join(", ");
  const first = quote(key[0] as string);
  const after = db.prepare(
    `SELECT ${list} FROM ${quote(table)} WHERE (${order}) > (${key.map(() => "?").join(", ")})
     ORDER BY ${order} LIMIT ?`,
  );
  const from = db.prepare(
    `SELECT ${list} FROM ${quote(table)} WHERE ${first} >= ? ORDER BY ${order} LIMIT ?`,
  );
  let read = (limit: number) => from.all("", limit);
  /** The document the read is at: past damage, resume after it. */
  const position: { doc: string | null } = { doc: null };
  const resumeAfter = (row: SqlRow) => {
    position.doc = String(row[key[0] as string]);
    const values = key.map((column) => row[column] as SqlValue);
    read = (limit) => after.all(...values, limit);
  };
  for (;;) {
    const batch = attempt(() => read(READ_BATCH));
    if (batch.ok) {
      const last = batch.value.at(-1);
      if (!last) return;
      for (const row of batch.value) emit(row);
      resumeAfter(last);
      continue;
    }
    // Something in this batch is damaged: one row, then skip a document.
    const one = attempt(() => read(1));
    if (one.ok) {
      const row = one.value[0];
      if (!row) return;
      emit(row);
      resumeAfter(row);
      continue;
    }
    const at = position.doc;
    const next: string | undefined = docIds.find(
      (id) => at === null || id > at,
    );
    if (next === undefined) return;
    position.doc = next;
    read = (limit) => from.all(next, limit);
  }
}

/** The current `updates` sequence must never fall below a seq in use. */
function carrySequence(source: SqliteDriver, dest: SqliteDriver) {
  const read = attempt(() =>
    scalar(source, "SELECT seq FROM sqlite_sequence WHERE name = 'updates'"),
  );
  const floor = Math.max(
    read.ok ? Number(read.value ?? 0) : 0,
    Number(scalar(dest, "SELECT COALESCE(MAX(seq), 0) FROM updates")),
    Number(scalar(dest, "SELECT COALESCE(MAX(head_seq), 0) FROM docs")),
    Number(scalar(dest, "SELECT COALESCE(MAX(upto_seq), 0) FROM snapshots")),
  );
  if (floor === 0) return;
  if (
    dest
      .prepare("UPDATE sqlite_sequence SET seq = ? WHERE name = 'updates'")
      .run(floor).changes === 0
  )
    dest
      .prepare("INSERT INTO sqlite_sequence (name, seq) VALUES ('updates', ?)")
      .run(floor);
}

/**
 * Settles rows whose parent was lost with a damaged page, so the new file
 * passes `foreign_key_check`: a nullable pointer that isn't `CASCADE`
 * (a folder, or `trashed_from`) is cleared, so the item lands at the
 * root, as a restore whose folder is gone does; any other row is dropped.
 * Returns how many rows were dropped.
 */
function settleForeignKeys(db: SqliteDriver): number {
  let dropped = 0;
  for (let pass = 0; pass < 32; pass += 1) {
    const broken = new Set(
      db
        .prepare("PRAGMA foreign_key_check")
        .all()
        .map((row) => `${row.table}\u0000${row.fkid}`),
    );
    if (broken.size === 0) return dropped;
    for (const entry of broken) {
      const [table = "", fkid = ""] = entry.split("\u0000");
      const fk = db
        .prepare(`PRAGMA foreign_key_list(${quote(table)})`)
        .all()
        .find((row) => String(row.id) === fkid);
      if (!fk) continue;
      const from = quote(String(fk.from));
      const orphan = `${from} IS NOT NULL AND ${from} NOT IN
        (SELECT ${quote(String(fk.to))} FROM ${quote(String(fk.table))})`;
      const nullable =
        db
          .prepare(`PRAGMA table_info(${quote(table)})`)
          .all()
          .find((column) => column.name === fk.from)?.notnull === 0;
      if (nullable && fk.on_delete !== "CASCADE")
        db.prepare(
          `UPDATE ${quote(table)} SET ${from} = NULL WHERE ${orphan}`,
        ).run();
      else
        dropped += db
          .prepare(`DELETE FROM ${quote(table)} WHERE ${orphan}`)
          .run().changes;
    }
  }
  return dropped;
}

function checkResult(db: SqliteDriver, pragma: string): string {
  const rows = db.prepare(`PRAGMA ${pragma}`).all();
  if (pragma === "integrity_check") {
    const messages = rows.map((row) => String(Object.values(row)[0]));
    return messages.length === 1 && messages[0] === "ok"
      ? "ok"
      : messages.slice(0, 5).join("; ");
  }
  return rows.length === 0
    ? "ok"
    : rows
        .slice(0, 5)
        .map((row) => JSON.stringify(row))
        .join("; ");
}

/** Where a path's folder ends: the last `/` or `\`. */
function parentOf(path: string): string | null {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return cut > 0 ? path.slice(0, cut) : null;
}

/** Rebuilds a damaged library into a new file at `target` (SEC-009). */
export function rebuildIntoNewFile(
  openSqlite: OpenSqlite,
  host: StorageHost,
  source: string,
  target: string,
): RebuildReport {
  if (host.exists(target))
    throw new StorageError("invalid_argument", "the target already exists");
  const partial = `${target}.partial`;
  for (const file of [partial, `${partial}-journal`])
    if (host.exists(file)) host.remove(file);
  const folder = parentOf(target);
  if (folder) host.mkdirp(folder);
  const src = openSource(openSqlite, host, source);
  let dest: SqliteDriver | null = null;
  try {
    dest = openSqlite(partial, { readOnly: false });
    createSchema(dest, host);
    const report = copyRows(src, dest, host);
    dest.close();
    dest = null;
    host.rename(partial, target);
    return report;
  } catch (error) {
    try {
      dest?.close();
      for (const file of [partial, `${partial}-journal`])
        if (host.exists(file)) host.remove(file);
    } catch {
      // Already failing; the original error matters.
    }
    throw storageErrorFrom(error);
  } finally {
    src.close();
  }
}

function copyRows(
  src: SqliteDriver,
  dest: SqliteDriver,
  host: StorageHost,
): RebuildReport {
  // Rows go in table by table; a folder's parent may come later, so the
  // foreign keys are checked (and settled) once every row is in.
  dest.exec("PRAGMA foreign_keys = OFF");
  if (Number(scalar(dest, "PRAGMA foreign_keys")) !== 0)
    throw new StorageError("io_error", "foreign_keys did not turn off");
  let copiedRows = 0;
  let skippedRows = 0;
  const docIds: string[] = [];
  const sourceTables = new Map(
    src
      .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => [String(row.name), String(row.sql)] as const),
  );
  dest.exec("BEGIN IMMEDIATE");
  try {
    for (const table of TABLES_V2) {
      const sql = sourceTables.get(table);
      if (sql === undefined) continue;
      const have = new Set(columnsOf(src, table));
      const columns = columnsOf(dest, table).filter((name) => have.has(name));
      const insert =
        table === "meta"
          ? dest.prepare(
              `INSERT INTO meta (key, value) VALUES (?, ?)
               ON CONFLICT (key) DO UPDATE SET value = excluded.value
               WHERE meta.key <> 'format_version'`,
            )
          : dest.prepare(
              `INSERT INTO ${quote(table)} (${columns.map(quote).join(", ")})
               VALUES (${columns.map(() => "?").join(", ")})`,
            );
      let copied = 0;
      let rejected = 0;
      const emit = (row: SqlRow) => {
        if (table === "docs" && typeof row.id === "string") docIds.push(row.id);
        try {
          insert.run(
            ...(table === "meta"
              ? [row.key as SqlValue, row.value as SqlValue]
              : columns.map((column) => row[column] as SqlValue)),
          );
          copied += 1;
        } catch {
          rejected += 1;
        }
      };
      if (/\bWITHOUT\s+ROWID\b/i.test(sql)) {
        docIds.sort();
        readKeyedTable(
          src,
          table,
          columns,
          primaryKeyOf(src, table),
          docIds,
          emit,
        );
      } else readRowidTable(src, table, columns, emit);
      const count = attempt(() =>
        Number(scalar(src, `SELECT COUNT(*) FROM ${quote(table)}`)),
      );
      copiedRows += copied;
      skippedRows += count.ok ? Math.max(0, count.value - copied) : rejected;
    }
    carrySequence(src, dest);
    const dropped = settleForeignKeys(dest);
    copiedRows -= dropped;
    skippedRows += dropped;
    dest.exec("COMMIT");
  } catch (error) {
    try {
      dest.exec("ROLLBACK");
    } catch {
      // The failed statement may already have rolled back.
    }
    throw error;
  }
  dest.exec("PRAGMA foreign_keys = ON");
  // Derived rows may have lost rows with the damage: derive everything again.
  while (resetDerivedChunk(dest) > 0);
  // Rows lost to the damage leave head_seq and size_bytes to settle (I6, I9).
  checkLibrary(dest, host, host.now());
  return {
    copiedRows,
    skippedRows,
    foreignKeyCheck: checkResult(dest, "foreign_key_check"),
    integrityCheck: checkResult(dest, "integrity_check"),
  };
}
