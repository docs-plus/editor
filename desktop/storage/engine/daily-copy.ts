/**
 * Daily copies (D-A6; architecture §5.4 `daily-copy.ts`): once a local day,
 * on the first idle moment, `VACUUM INTO daily/library-<date>.sqlite`,
 * keeping the newest 7. They are the Local release's restore points
 * ("Restore from a daily snapshot"), and its protection against a corrupt
 * library.
 *
 * Each copy is written to `<name>.partial` and renamed, so a kill mid-copy
 * never leaves a half file under a real name; the next open sweeps it.
 * Retention is by count, so a clock jump can't delete good copies early.
 *
 * The copy reads through its own read-only connection in a second thread
 * (`copy-worker.ts`): `VACUUM INTO` of a 240 MB library took up to 9 s on a
 * Windows runner, and on the writer it would hold every append, and the
 * quit flush, behind it.
 */
import type { OpenSqlite, SqliteDriver } from "./driver";
import type { StorageHost } from "./host";
import { readMeta, writeMeta } from "./sql";

export const DAILY_DIR = "daily";
export const DAILY_KEEP = 7;
const DAILY = /^library-\d{4}-\d{2}-\d{2}\.sqlite$/;

/** `YYYY-MM-DD` in local time: "today" is the person's day, not UTC's. */
export function localDate(ms: number): string {
  const date = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function dailyCopyName(date: string): string {
  return `library-${date}.sqlite`;
}

export function listDailyCopies(host: StorageHost, dir: string): string[] {
  return host
    .list(host.join(dir, DAILY_DIR))
    .filter((file) => DAILY.test(file))
    .sort();
}

export function isDailyCopyDue(db: SqliteDriver, now: number): boolean {
  return readMeta(db, "last_daily_copy") !== localDate(now);
}

/** One daily copy in flight. */
export type DailyCopyJob = {
  date: string;
  /** The library file the copy reads. */
  source: string;
  /** Where `VACUUM INTO` writes; renamed to `target` once complete. */
  partial: string;
  target: string;
};

/** Deletes leftover `.partial` files (a killed copy). Best effort. */
export function sweepPartialCopies(host: StorageHost, dir: string) {
  const folder = host.join(dir, DAILY_DIR);
  for (const file of host.list(folder)) {
    if (!file.endsWith(".partial")) continue;
    try {
      host.remove(host.join(folder, file));
    } catch {
      // Still open elsewhere (Windows); the next open sweeps it.
    }
  }
}

/** Today's copy job, or null when today's copy exists. */
export function planDailyCopy(
  db: SqliteDriver,
  host: StorageHost,
  dir: string,
  source: string,
  now: number,
): DailyCopyJob | null {
  if (!isDailyCopyDue(db, now)) return null;
  const date = localDate(now);
  const folder = host.join(dir, DAILY_DIR);
  host.mkdirp(folder);
  sweepPartialCopies(host, dir);
  const target = host.join(folder, dailyCopyName(date));
  return { date, source, partial: `${target}.partial`, target };
}

/**
 * Writes the copy from its own read-only connection, so the writer never
 * waits on it: in WAL a reader never blocks the writer. Runs in the copy
 * thread (`desktop/storage/copy-worker.ts`); tests run it inline.
 */
export function copyLibraryInto(
  openSqlite: OpenSqlite,
  source: string,
  partial: string,
) {
  const reader = openSqlite(source, { readOnly: true });
  try {
    reader.prepare("VACUUM INTO ?").run(partial);
  } finally {
    reader.close();
  }
}

/**
 * Publishes a finished copy: rename into place, record the day, keep the
 * newest {@link DAILY_KEEP}, then a passive checkpoint, since the copy's
 * long read held the WAL from shrinking.
 */
export function finishDailyCopy(
  db: SqliteDriver,
  host: StorageHost,
  dir: string,
  job: DailyCopyJob,
): string {
  if (host.exists(job.target)) host.remove(job.target);
  host.rename(job.partial, job.target);
  writeMeta(db, "last_daily_copy", job.date);
  const folder = host.join(dir, DAILY_DIR);
  for (const old of listDailyCopies(host, dir).slice(0, -DAILY_KEEP))
    host.remove(host.join(folder, old));
  db.exec("PRAGMA wal_checkpoint(PASSIVE)");
  return dailyCopyName(job.date);
}
