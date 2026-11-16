import { expect } from "@playwright/test";

import { openSqlite } from "@/lib/sqlite-open";
import { runRetentionPurge } from "@/scripts/purge-retention";

/**
 * Reaches into the SQLite file the dev servers share (`DB_PATH`, default
 * `./db.sqlite`), from the Playwright process. Only ever touches the rows of
 * the document under test: other workers' closures share the file.
 */

const REPO_ROOT = new URL("../../../", import.meta.url).pathname;

/** Moves one closure back in time (e.g. past `CLOSED_RETENTION_DAYS`). */
export function backdateClosure(id: string, closedAt: number): void {
  const db = openSqlite();
  try {
    const result = db
      .prepare("UPDATE document_closures SET closed_at = ? WHERE name = ?")
      .run(closedAt, id);
    expect(result.changes).toBe(1);
  } finally {
    db.close();
  }
}

/**
 * Runs the retention purge once, in this process: the same
 * `runRetentionPurge` the daily `editor-purge` job runs with `PURGE_MODE=on`,
 * without its backup (`VACUUM INTO` of the whole dev database on every call).
 */
export function runRetentionPurgeNow(): void {
  const db = openSqlite({ busyTimeoutMs: 10_000 });
  try {
    runRetentionPurge(db);
  } finally {
    db.close();
  }
}

/** Takes one document down at once, as an operator does on the host. */
export function runDeleteDocumentScript(id: string): void {
  const result = Bun.spawnSync(
    ["bun", "run", "scripts/delete-document.ts", id],
    { cwd: REPO_ROOT, env: process.env, stdout: "pipe", stderr: "pipe" },
  );
  expect(result.exitCode, result.stderr.toString()).toBe(0);
}

export function isTombstoned(id: string): boolean {
  const db = openSqlite();
  try {
    return Boolean(
      db.prepare("SELECT 1 FROM document_tombstones WHERE name = ?").get(id),
    );
  } finally {
    db.close();
  }
}
