/**
 * The daily copy, made in batches so it can be stopped (P2.6 decision 5).
 *
 * `VACUUM INTO` is one native call: a worker thread running it can't be
 * terminated, and Node joins worker threads on exit, so a quit during a copy
 * waited for it (9 s for a 240 MB library on a Windows runner). This copy
 * yields between batches, where `Worker.terminate()` takes effect.
 *
 * It must be as trustworthy as `VACUUM INTO`:
 * - **one snapshot:** the library is attached read-only (`mode=ro`) to the
 *   copy's connection, and the whole copy is one transaction on that
 *   connection, so every batch reads the same snapshot of the library
 *   while the writer keeps committing (WAL);
 * - **the schema verbatim:** tables from the library's `sqlite_master`
 *   first, then the rows, then indexes and triggers; `sqlite_sequence`,
 *   `user_version` and `application_id` are copied (`format_version` lives
 *   in `meta`, a table);
 * - **verified before it is kept:** row counts per table against the
 *   snapshot and `integrity_check`, inside the transaction; any mismatch
 *   rolls back and nothing is committed. The caller renames the file into
 *   place only after this resolves.
 *
 * The result keeps every row, but isn't compacted the way `VACUUM INTO`'s
 * is: free pages of the library are simply not copied, so sizes stay close.
 */
import type { OpenSqlite, SqliteDriver } from "./driver";
import { StorageError } from "./errors";
import { scalar } from "./sql";

export type CopyOptions = {
  /** At most this many rows per batch; the copy yields after each one. */
  batchRows?: number;
  /**
   * At most about this many bytes per batch (a single larger row is its own
   * batch). One batch is one native statement that `terminate()` can't
   * interrupt, so this bounds how long a quit waits: 4 MiB is a few ms.
   */
  batchBytes?: number;
  /** Lets the event loop run (and `terminate()` land) between batches. */
  yieldNow: () => Promise<void>;
  /** Tests only: tamper with the copy before it is verified. */
  beforeVerify?: (dest: SqliteDriver) => void;
};

export type CopyReport = { tables: number; rows: number; batches: number };

/** A read-only SQLite URI for `path`, on every OS. */
export function readOnlyUri(path: string): string {
  const slashed = path.replace(/\\/g, "/");
  const encoded = encodeURI(slashed).replace(/\?/g, "%3F").replace(/#/g, "%23");
  return `file:${slashed.startsWith("/") ? "" : "///"}${encoded}?mode=ro`;
}

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

type SchemaObject = { type: string; name: string; sql: string };

/** An SQL expression for a row's stored size, from every column's length. */
function rowSize(db: SqliteDriver, table: string): string {
  const columns = db
    .prepare(`PRAGMA lib.table_info(${quote(table)})`)
    .all()
    .map((column) => `COALESCE(LENGTH(${quote(String(column.name))}), 0)`);
  return columns.length > 0 ? columns.join(" + ") : "0";
}

/** Primary-key columns of a WITHOUT ROWID table, in key order. */
function keyColumns(db: SqliteDriver, table: string): string[] {
  return db
    .prepare(`PRAGMA lib.table_info(${quote(table)})`)
    .all()
    .filter((column) => Number(column.pk) > 0)
    .sort((a, b) => Number(a.pk) - Number(b.pk))
    .map((column) => quote(String(column.name)));
}

async function copyRowidTable(
  db: SqliteDriver,
  table: string,
  { batchRows, batchBytes }: { batchRows: number; batchBytes: number },
  yieldNow: () => Promise<void>,
): Promise<number> {
  const name = quote(table);
  // LENGTH() of a BLOB or TEXT comes from the record header: no payload read.
  const sizes = db.prepare(
    `SELECT rowid AS r, ${rowSize(db, table)} AS b FROM lib.${name} WHERE rowid > ? ORDER BY rowid LIMIT ?`,
  );
  const insert = db.prepare(
    `INSERT INTO main.${name} SELECT * FROM lib.${name} WHERE rowid > ? AND rowid <= ?`,
  );
  let cursor = Number.MIN_SAFE_INTEGER;
  let batches = 0;
  for (;;) {
    let last: number | null = null;
    let bytes = 0;
    for (const row of sizes.all(cursor, batchRows)) {
      if (last !== null && bytes + Number(row.b) > batchBytes) break;
      last = Number(row.r);
      bytes += Number(row.b);
    }
    if (last === null) return batches;
    insert.run(cursor, last);
    cursor = last;
    batches += 1;
    await yieldNow();
  }
}

async function copyKeyedTable(
  db: SqliteDriver,
  table: string,
  { batchRows }: { batchRows: number; batchBytes: number },
  yieldNow: () => Promise<void>,
): Promise<number> {
  const name = quote(table);
  const order = keyColumns(db, table).join(", ") || "1";
  const insert = db.prepare(
    `INSERT INTO main.${name} SELECT * FROM lib.${name} ORDER BY ${order} LIMIT ? OFFSET ?`,
  );
  let batches = 0;
  for (let offset = 0; ; offset += batchRows) {
    if (insert.run(batchRows, offset).changes === 0) return batches;
    batches += 1;
    await yieldNow();
  }
}

function count(db: SqliteDriver, schema: "main" | "lib", table: string) {
  return Number(scalar(db, `SELECT COUNT(*) FROM ${schema}.${quote(table)}`));
}

/**
 * Copies the library at `source` into a new file at `partial`. Resolves
 * once the copy is committed and verified; rejects (with nothing committed)
 * on a mismatch, an I/O error, or a throw from `yieldNow`.
 */
export async function copyLibraryBatched(
  openSqlite: OpenSqlite,
  source: string,
  partial: string,
  {
    batchRows = 256,
    batchBytes = 4 * 1024 * 1024,
    yieldNow,
    beforeVerify,
  }: CopyOptions,
): Promise<CopyReport> {
  const dest = openSqlite(partial, { readOnly: false });
  let attached = false;
  let open = false;
  try {
    dest.exec("PRAGMA journal_mode = DELETE");
    dest.exec("PRAGMA synchronous = FULL");
    dest.prepare("ATTACH DATABASE ? AS lib").run(readOnlyUri(source));
    attached = true;
    dest.exec("BEGIN");
    open = true;
    // The first read pins the library's snapshot for the whole copy.
    const objects = dest
      .prepare(
        "SELECT type, name, sql FROM lib.sqlite_master WHERE sql IS NOT NULL ORDER BY rowid",
      )
      .all() as SchemaObject[];
    const tables = objects.filter(
      (o) => o.type === "table" && !o.name.startsWith("sqlite_"),
    );
    for (const table of tables) dest.exec(table.sql);
    for (const pragma of ["user_version", "application_id"]) {
      const value = Number(scalar(dest, `PRAGMA lib.${pragma}`) ?? 0);
      dest.exec(`PRAGMA main.${pragma} = ${Math.trunc(value)}`);
    }
    const report: CopyReport = { tables: tables.length, rows: 0, batches: 0 };
    for (const table of tables) {
      const keyed = /\bWITHOUT\s+ROWID\b/i.test(table.sql);
      report.batches += await (keyed ? copyKeyedTable : copyRowidTable)(
        dest,
        table.name,
        { batchRows, batchBytes },
        yieldNow,
      );
    }
    const hasSequence = objects.some((o) => o.name === "sqlite_sequence");
    if (hasSequence) {
      dest.exec("DELETE FROM main.sqlite_sequence");
      dest.exec(
        "INSERT INTO main.sqlite_sequence (name, seq) SELECT name, seq FROM lib.sqlite_sequence",
      );
    }
    for (const object of objects)
      if (object.type !== "table" && !object.name.startsWith("sqlite_"))
        dest.exec(object.sql);
    beforeVerify?.(dest);
    for (const table of tables) {
      const copied = count(dest, "main", table.name);
      if (copied !== count(dest, "lib", table.name))
        throw new StorageError("corrupt", `copy of ${table.name} is short`);
      report.rows += copied;
    }
    if (
      hasSequence &&
      count(dest, "main", "sqlite_sequence") !==
        count(dest, "lib", "sqlite_sequence")
    )
      throw new StorageError("corrupt", "copy of sqlite_sequence is short");
    const check = String(scalar(dest, "PRAGMA main.integrity_check"));
    if (check !== "ok")
      throw new StorageError(
        "corrupt",
        `copy failed integrity_check: ${check}`,
      );
    dest.exec("COMMIT");
    open = false;
    return report;
  } finally {
    try {
      if (open) dest.exec("ROLLBACK");
      if (attached) dest.exec("DETACH DATABASE lib");
    } catch {
      // The connection closes below either way.
    }
    dest.close();
  }
}
