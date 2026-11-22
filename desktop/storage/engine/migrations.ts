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
 * Format 1 is the first, so {@link FORMAT_STEPS} is empty. Tests pass their
 * own steps to exercise the runner (soak T5).
 */
import type { SqliteDriver } from "./driver";
import { StorageError } from "./errors";
import type { StorageHost } from "./host";
import { readMeta, transaction, writeMeta } from "./sql";

export type FormatStep = {
  /** The `format_version` this step produces. */
  to: number;
  up(db: SqliteDriver): void;
};

/** Steps from format 1 to the current `FORMAT_VERSION`, in order. */
export const FORMAT_STEPS: readonly FormatStep[] = [];

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
): number {
  let version = readFormatVersion(db);
  if (version >= target) return version;
  backUpBeforeMigration(db, host, dir, version);
  for (const step of steps) {
    if (step.to <= version) continue;
    if (step.to > target) break;
    try {
      transaction(db, () => {
        step.up(db);
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
