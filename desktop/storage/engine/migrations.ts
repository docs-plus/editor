/**
 * The `format_version` runner (architecture §5.4 `migrations.ts`, D-A6).
 *
 * - **Newer than the app:** the library opens read-only with
 *   `library_too_new`, and nothing is written (checked before any other
 *   write; see `library.ts`).
 * - **Older:** `VACUUM INTO library.pre-v<n>-<utc>.sqlite` first (the last 2
 *   are kept), then each step in its own transaction, which also bumps
 *   `format_version`. A failed step leaves the library read-only with
 *   `migration_failed`; a kill between steps resumes at the next one.
 *
 * **A rebuild step** (offline data-model revision §3.1) rebuilds tables, so
 * it needs `foreign_keys` off, which SQLite ignores inside a transaction:
 * 1. the backup above;
 * 2. `preflight`, read-only: any problem aborts with `migration_failed`
 *    and writes nothing;
 * 3. `foreign_keys = OFF` (asserted) and `temp_store = MEMORY`, outside any
 *    transaction;
 * 4. snapshot the `updates` invariant (row count, bytes, and a hash of
 *    `seq || data` in seq order);
 * 5. `BEGIN IMMEDIATE`, the step;
 * 6. `foreign_key_check` must return no rows, and the `updates` invariant
 *    must be unchanged, or it rolls back;
 * 7. `format_version`, `COMMIT`;
 * 8. finally `foreign_keys = ON` (asserted) and `wal_checkpoint(TRUNCATE)`.
 *
 * Tests pass their own steps (soak T5); {@link FORMAT_STEPS} holds the real
 * ones. A fresh library is created at format 1 and runs them with no backup.
 */
import type { SqliteDriver } from "./driver";
import { StorageError } from "./errors";
import { FORMAT_2_STEP } from "./format-2";
import type { StorageHost } from "./host";
import { readMeta, scalar, transaction, writeMeta } from "./sql";

/** What a step can report while it runs. */
export type StepContext = {
  /** A line for the migration log (for example, a tag merge). */
  log(line: string): void;
  /** A statement boundary: soak T24b kills the process at each one. */
  boundary(name: string): void;
};

export type FormatStep = {
  /** The `format_version` this step produces. */
  to: number;
  /** Rebuilds tables: runs with `foreign_keys` off and the checks above. */
  rebuild?: boolean;
  /** Read-only checks that block the step; one line per problem. */
  preflight?(db: SqliteDriver): string[];
  up(db: SqliteDriver, context: StepContext): void;
};

/** Steps from format 1 to the current `FORMAT_VERSION`, in order. */
export const FORMAT_STEPS: readonly FormatStep[] = [FORMAT_2_STEP];

export type RunOptions = {
  /** A brand-new library: no backup to take. */
  fresh?: boolean;
  log?: (line: string) => void;
  boundary?: (name: string) => void;
};

export const PRE_MIGRATION_KEEP = 2;
const PRE_MIGRATION = /^library\.pre-v\d+-[0-9TZ]+\.sqlite$/;

/** `20261117T031700Z`: sortable, and valid in a file name on every OS. */
export function utcStamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
}

export function readFormatVersion(db: SqliteDriver): number {
  const value = Number.parseInt(readMeta(db, "format_version") ?? "", 10);
  if (!Number.isInteger(value) || value < 1)
    throw new StorageError("corrupt", "meta.format_version is missing");
  return value;
}

/** Takes the pre-migration copy and prunes older ones. */
export function backUpBeforeMigration(
  db: SqliteDriver,
  host: StorageHost,
  dir: string,
  from: number,
): string {
  const name = `library.pre-v${from}-${utcStamp(host.now())}.sqlite`;
  const target = host.join(dir, name);
  const partial = `${target}.partial`;
  if (host.exists(partial)) host.remove(partial);
  db.prepare("VACUUM INTO ?").run(partial);
  host.rename(partial, target);
  const copies = host
    .list(dir)
    .filter((file) => PRE_MIGRATION.test(file))
    .sort();
  for (const old of copies.slice(0, -PRE_MIGRATION_KEEP))
    host.remove(host.join(dir, old));
  return target;
}

/**
 * Migrates `db` from its `format_version` to `target`. Returns the version
 * reached; throws `migration_failed` when a step fails (that step rolled
 * back, earlier ones stay).
 */
export function runFormatSteps(
  db: SqliteDriver,
  host: StorageHost,
  dir: string,
  target: number,
  steps: readonly FormatStep[],
  options: RunOptions = {},
): number {
  let version = readFormatVersion(db);
  if (version >= target) return version;
  const context: StepContext = {
    log: options.log ?? (() => {}),
    boundary: options.boundary ?? (() => {}),
  };
  if (!options.fresh) backUpBeforeMigration(db, host, dir, version);
  context.boundary("backup taken");
  for (const step of steps) {
    if (step.to <= version) continue;
    if (step.to > target) break;
    try {
      if (step.rebuild) runRebuildStep(db, host, step, context);
      else
        transaction(db, () => {
          step.up(db, context);
          writeMeta(db, "format_version", String(step.to));
        });
    } catch (error) {
      throw new StorageError(
        "migration_failed",
        `step to v${step.to}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    version = step.to;
  }
  if (version !== target)
    throw new StorageError("migration_failed", `no step reaches v${target}`);
  return version;
}

/**
 * The `updates` invariant: the bytes a rebuild must never touch. Row count,
 * total bytes, and a SHA-256 over each row's seq and data in seq order.
 */
export function updatesInvariant(db: SqliteDriver, host: StorageHost): string {
  const hasher = host.sha256();
  let rows = 0;
  let bytes = 0;
  const page = db.prepare(
    "SELECT seq, data FROM updates WHERE seq > ? ORDER BY seq LIMIT 512",
  );
  let cursor = -1;
  for (;;) {
    const batch = page.all(cursor);
    if (batch.length === 0) break;
    for (const row of batch) {
      const data = row.data as Uint8Array;
      hasher.update(`${row.seq}:`).update(data);
      rows += 1;
      bytes += data.byteLength;
      cursor = Number(row.seq);
    }
  }
  return `${rows}/${bytes}/${hasher.digest()}`;
}

function readForeignKeys(db: SqliteDriver): number {
  return Number(scalar(db, "PRAGMA foreign_keys"));
}

function runRebuildStep(
  db: SqliteDriver,
  host: StorageHost,
  step: FormatStep,
  context: StepContext,
) {
  const problems = step.preflight?.(db) ?? [];
  if (problems.length > 0)
    throw new StorageError(
      "migration_failed",
      `preflight refused v${step.to}: ${problems.slice(0, 20).join("; ")}`,
    );
  context.boundary("preflight passed");
  db.exec("PRAGMA foreign_keys = OFF");
  try {
    // With foreign keys still on, DROP TABLE docs would cascade into updates.
    if (readForeignKeys(db) !== 0)
      throw new StorageError("io_error", "foreign_keys did not turn off");
    db.exec("PRAGMA temp_store = MEMORY");
    const before = updatesInvariant(db, host);
    context.boundary("invariant taken");
    db.exec("BEGIN IMMEDIATE");
    try {
      step.up(db, context);
      const violations = db.prepare("PRAGMA foreign_key_check").all();
      if (violations.length > 0)
        throw new StorageError(
          "migration_failed",
          `foreign_key_check: ${JSON.stringify(violations.slice(0, 5))}`,
        );
      if (updatesInvariant(db, host) !== before)
        throw new StorageError("migration_failed", "updates changed");
      writeMeta(db, "format_version", String(step.to));
      context.boundary("before commit");
      db.exec("COMMIT");
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // The failed statement may already have rolled back.
      }
      throw error;
    }
    context.boundary("committed");
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
    if (readForeignKeys(db) !== 1)
      // biome-ignore lint/correctness/noUnsafeFinally: a library without FKs must not stay open
      throw new StorageError("io_error", "foreign_keys did not turn back on");
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  }
}
