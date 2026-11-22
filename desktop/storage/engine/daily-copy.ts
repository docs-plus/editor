/**
 * Daily copies (D-A6; architecture §5.4 `daily-copy.ts`): once a local day,
 * on the first idle moment, `VACUUM INTO daily/library-<date>.sqlite`,
 * keeping the newest 7. They are the Local release's restore points
 * ("Restore from a daily snapshot"), and its protection against a corrupt
 * library.
 *
 * Each copy is written to `<name>.partial` and renamed, so a kill mid-copy
 * never leaves a half file under a real name. Retention is by count, so a
 * clock jump can't delete good copies early.
 */
import type { SqliteDriver } from "./driver";
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

/**
 * Writes today's copy if there isn't one yet. Returns the copy's file name,
 * or null when it was already taken today.
 */
export function takeDailyCopy(
  db: SqliteDriver,
  host: StorageHost,
  dir: string,
  now: number,
): string | null {
  if (!isDailyCopyDue(db, now)) return null;
  const date = localDate(now);
  const folder = host.join(dir, DAILY_DIR);
  host.mkdirp(folder);
  for (const file of host.list(folder))
    if (file.endsWith(".partial")) host.remove(host.join(folder, file));
  const name = dailyCopyName(date);
  const target = host.join(folder, name);
  const partial = `${target}.partial`;
  db.prepare("VACUUM INTO ?").run(partial);
  if (host.exists(target)) host.remove(target);
  host.rename(partial, target);
  writeMeta(db, "last_daily_copy", date);
  const copies = listDailyCopies(host, dir);
  for (const old of copies.slice(0, -DAILY_KEEP))
    host.remove(host.join(folder, old));
  return name;
}
