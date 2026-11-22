/**
 * Lock contention (soak T4-copy on Windows: "database is locked"). Every
 * connection waits up to `BUSY_TIMEOUT_MS` for a lock another process holds
 * briefly, instead of failing at once; TRUNCATE checkpoints never wait, so
 * a reader such as a running daily copy can't stretch a quit.
 *
 * The lock is held by a second process: the engine's calls are synchronous,
 * so a holder in this process could never let go while one waits.
 */
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";

import * as Y from "yjs";

import { openBunSqlite } from "@/desktop/dev/bun-sqlite-driver";
import { copyLibraryBatched } from "@/desktop/storage/engine/copy-library";
import { BUSY_TIMEOUT_MS } from "@/desktop/storage/engine/driver";
import { LIBRARY_FILE } from "@/desktop/storage/engine/library";
import {
  createClock,
  createTempDir,
  createTestHost,
  openTestLibrary,
} from "@/tests/helpers/storage-library";

const HOLD_MS = 400;

let temp: ReturnType<typeof createTempDir>;

beforeEach(() => {
  temp = createTempDir();
});
afterEach(() => {
  temp.cleanUp();
});

/**
 * Starts a process that takes a lock on `path`, prints "held", keeps it
 * for `HOLD_MS` and lets go. `exclusive` also shuts out readers.
 */
async function holdLock(path: string, exclusive: boolean) {
  const script = `
    const { Database } = require("bun:sqlite");
    const db = new Database(${JSON.stringify(path)});
    ${exclusive ? 'db.exec("PRAGMA locking_mode = EXCLUSIVE");' : ""}
    db.exec("BEGIN IMMEDIATE");
    db.exec("INSERT OR REPLACE INTO meta (key, value) VALUES ('lock_probe', '1')");
    console.log("held");
    await Bun.sleep(${HOLD_MS});
    db.exec("COMMIT");
    db.close();
  `;
  const child = Bun.spawn([process.execPath, "-e", script], {
    stdout: "pipe",
    stderr: "inherit",
  });
  const reader = child.stdout.getReader();
  let out = "";
  while (!out.includes("held")) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`the lock holder exited: ${out}`);
    out += new TextDecoder().decode(value);
  }
  reader.releaseLock();
  return child;
}

describe("busy timeout", () => {
  test("is set on every connection the driver opens", () => {
    const db = openBunSqlite(join(temp.dir, "x.sqlite"), { readOnly: false });
    expect(db.prepare("PRAGMA busy_timeout").get()).toEqual({
      timeout: BUSY_TIMEOUT_MS,
    });
    db.close();
    expect(BUSY_TIMEOUT_MS).toBeGreaterThan(HOLD_MS * 2);
  });

  test("a write waits for another process's write lock instead of failing", async () => {
    const library = openTestLibrary(temp.dir, createTestHost(createClock()));
    try {
      const holder = await holdLock(join(temp.dir, LIBRARY_FILE), false);
      const started = performance.now();
      const { id } = library.createDoc({ title: "after the lock" });
      expect(performance.now() - started).toBeGreaterThan(HOLD_MS / 2);
      expect(library.sidebar().docs.map((d) => d.id)).toContain(id);
      expect(await holder.exited).toBe(0);
    } finally {
      library.shutdown();
    }
  });

  test("the daily copy waits for a lock that shuts out readers, then completes", async () => {
    const library = openTestLibrary(temp.dir, createTestHost(createClock()));
    library.createDoc({ title: "copied" });
    library.shutdown();
    const source = join(temp.dir, LIBRARY_FILE);
    const holder = await holdLock(source, true);
    const report = await copyLibraryBatched(
      openBunSqlite,
      source,
      join(temp.dir, "copy.partial"),
      { yieldNow: async () => {} },
    );
    expect(report.rows).toBeGreaterThan(0);
    expect(await holder.exited).toBe(0);
  });

  test("a TRUNCATE checkpoint never waits for a reader, so quit stays fast", () => {
    const library = openTestLibrary(temp.dir, createTestHost(createClock()));
    const { id } = library.createDoc({ title: "w" });
    library.load(id, "w");
    const doc = new Y.Doc();
    doc.getText("t").insert(0, "x".repeat(10_000));
    library.append(id, "w", {
      origin: "local",
      update: Y.encodeStateAsUpdate(doc),
    });
    library.close(id, "w");
    // A reader holding a snapshot, as a running daily copy does.
    const reader = new Database(join(temp.dir, LIBRARY_FILE), {
      readonly: true,
    });
    reader.exec("BEGIN");
    reader.query("SELECT COUNT(*) FROM docs").get();
    const started = performance.now();
    library.shutdown();
    expect(performance.now() - started).toBeLessThan(BUSY_TIMEOUT_MS / 2);
    reader.exec("COMMIT");
    reader.close();
  });
});
