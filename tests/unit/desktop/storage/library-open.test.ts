import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { StorageError } from "@/desktop/storage/engine/errors";
import { LIBRARY_FILE } from "@/desktop/storage/engine/library";
import { LOCK_FILE } from "@/desktop/storage/engine/lock";
import type { FormatStep } from "@/desktop/storage/engine/migrations";
import { TABLES_V1 } from "@/desktop/storage/engine/schema";
import {
  crash,
  createClock,
  createTempDir,
  createTestHost,
  openTestLibrary,
  type TestClock,
} from "@/tests/helpers/storage-library";

let temp: ReturnType<typeof createTempDir>;
let clock: TestClock;

beforeEach(() => {
  temp = createTempDir();
  clock = createClock();
});
afterEach(() => temp.cleanUp());

function raw(dir = temp.dir) {
  return new Database(join(dir, LIBRARY_FILE));
}

function rejectsWith(code: string, run: () => unknown) {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(StorageError);
  expect((caught as StorageError).code).toBe(code as StorageError["code"]);
}

describe("creating a library", () => {
  test("creates every format-1 table and the meta rows", () => {
    const library = openTestLibrary(temp.dir, createTestHost(clock));
    library.shutdown();
    const db = raw();
    const tables = db
      .query(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((row) => (row as { name: string }).name);
    expect(tables).toEqual([...TABLES_V1]);
    const meta = Object.fromEntries(
      db
        .query("SELECT key, value FROM meta")
        .all()
        .map((row) => {
          const { key, value } = row as { key: string; value: string };
          return [key, value];
        }),
    );
    expect(meta.format_version).toBe("1");
    expect(meta.yjs_encoding).toBe("v1");
    expect(meta.library_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(meta.unclean_exit).toBe("0");
    db.close();
  });

  test("the docs columns include the v7/v8 seams and the §6.3 list columns", () => {
    openTestLibrary(temp.dir, createTestHost(clock)).shutdown();
    const db = raw();
    const columns = db
      .query("SELECT name, \"notnull\" FROM pragma_table_info('docs')")
      .all() as { name: string; notnull: number }[];
    const byName = new Map(columns.map((c) => [c.name, c.notnull]));
    for (const name of [
      "lineage",
      "link_key",
      "kind",
      "pin_key",
      "size_bytes",
      "snippet",
      "trash_group",
      "trashed_from",
      "mirrored_at",
      "schema",
    ])
      expect(byName.has(name)).toBe(true);
    expect(byName.get("link_key")).toBe(1);
    expect(byName.get("lineage")).toBe(1);
    const view = db
      .query("SELECT name FROM pragma_table_info('doc_view')")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(view).toEqual(["doc_id", "width", "place", "remote_images"]);
    db.close();
  });

  test("sets WAL, synchronous=FULL and foreign keys", () => {
    const library = openTestLibrary(temp.dir, createTestHost(clock));
    const db = (
      library as unknown as {
        db: {
          prepare(s: string): { get(): Record<string, unknown> | undefined };
        };
      }
    ).db;
    expect(db.prepare("PRAGMA journal_mode").get()).toEqual({
      journal_mode: "wal",
    });
    expect(db.prepare("PRAGMA synchronous").get()).toEqual({ synchronous: 2 });
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({
      foreign_keys: 1,
    });
    library.shutdown();
  });

  test("turns on fullfsync on macOS", () => {
    const library = openTestLibrary(
      temp.dir,
      createTestHost(clock, { platform: "darwin" }),
      { fullfsync: true },
    );
    const db = (
      library as unknown as {
        db: {
          prepare(s: string): { get(): Record<string, unknown> | undefined };
        };
      }
    ).db;
    expect(db.prepare("PRAGMA fullfsync").get()).toEqual({ fullfsync: 1 });
    expect(db.prepare("PRAGMA checkpoint_fullfsync").get()).toEqual({
      checkpoint_fullfsync: 1,
    });
    library.shutdown();
  });

  test("refuses a file that isn't a library", () => {
    const db = raw();
    db.exec("CREATE TABLE other (x)");
    db.close();
    rejectsWith("corrupt", () =>
      openTestLibrary(temp.dir, createTestHost(clock)),
    );
    // The lock is released on failure.
    expect(() => readFileSync(join(temp.dir, LOCK_FILE))).toThrow();
  });
});

describe("cloud folders", () => {
  test("refuses a library inside a synced folder", () => {
    const dir = join(temp.dir, "Dropbox", "TinyDocy");
    rejectsWith("cloud_folder", () =>
      openTestLibrary(dir, createTestHost(clock)),
    );
  });
});

describe("library.lock", () => {
  test("refuses a library another running process holds", () => {
    writeFileSync(join(temp.dir, LOCK_FILE), "424242");
    const host = createTestHost(clock, { isPidAlive: (pid) => pid === 424242 });
    rejectsWith("locked_elsewhere", () => openTestLibrary(temp.dir, host));
  });

  test("takes over a stale lock", () => {
    writeFileSync(join(temp.dir, LOCK_FILE), "424242");
    const host = createTestHost(clock, { isPidAlive: () => false });
    const library = openTestLibrary(temp.dir, host);
    expect(readFileSync(join(temp.dir, LOCK_FILE), "utf8")).toBe(
      String(process.pid),
    );
    library.shutdown();
    expect(() => readFileSync(join(temp.dir, LOCK_FILE))).toThrow();
  });
});

describe("unclean exit", () => {
  test("a clean shutdown needs no quick_check", () => {
    openTestLibrary(temp.dir, createTestHost(clock)).shutdown();
    const library = openTestLibrary(temp.dir, createTestHost(clock));
    expect(library.status.uncleanExit).toBe(false);
    expect(library.status.quickCheck).toBeNull();
    library.shutdown();
  });

  test("a crash runs quick_check on the next open", () => {
    const first = openTestLibrary(temp.dir, createTestHost(clock));
    first.createDoc();
    crash(first);
    const library = openTestLibrary(temp.dir, createTestHost(clock));
    expect(library.status.uncleanExit).toBe(true);
    expect(library.status.quickCheck).toBe("ok");
    expect(library.status.readOnly).toBeNull();
    library.shutdown();
  });

  test("shutdown checkpoints the WAL into the main file", () => {
    const library = openTestLibrary(temp.dir, createTestHost(clock));
    library.createDoc({ title: "kept" });
    library.shutdown();
    const wal = join(temp.dir, `${LIBRARY_FILE}-wal`);
    let walBytes = 0;
    try {
      walBytes = readFileSync(wal).byteLength;
    } catch {
      walBytes = 0;
    }
    expect(walBytes).toBe(0);
  });

  test("shutdown is idempotent", () => {
    const library = openTestLibrary(temp.dir, createTestHost(clock));
    library.shutdown();
    expect(() => library.shutdown()).not.toThrow();
  });
});

describe("format_version guard (T6)", () => {
  function makeNewerLibrary() {
    const library = openTestLibrary(temp.dir, createTestHost(clock));
    library.createDoc({ title: "from the future" });
    library.shutdown();
    const db = raw();
    db.exec("UPDATE meta SET value = '7' WHERE key = 'format_version'");
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    db.close();
  }

  test("a newer library opens read-only and is never written", () => {
    makeNewerLibrary();
    const before = readFileSync(join(temp.dir, LIBRARY_FILE));
    const library = openTestLibrary(temp.dir, createTestHost(clock));
    expect(library.status.readOnly).toBe("library_too_new");
    expect(library.status.formatVersion).toBe(7);
    expect(library.sidebar().docs.map((d) => d.title)).toEqual([
      "from the future",
    ]);
    rejectsWith("library_too_new", () => library.createDoc());
    const id = library.sidebar().docs[0]?.id ?? "";
    expect(library.load(id, "w1").updates).toEqual([]);
    rejectsWith("library_too_new", () =>
      library.append(id, "w1", {
        origin: "local",
        update: new Uint8Array([1]),
      }),
    );
    library.shutdown();
    expect(readFileSync(join(temp.dir, LIBRARY_FILE)).equals(before)).toBe(
      true,
    );
  });
});

describe("format migrations (T5)", () => {
  const addColumn: FormatStep = {
    to: 2,
    up: (db) => db.exec("ALTER TABLE docs ADD COLUMN extra TEXT"),
  };
  const addTable: FormatStep = {
    to: 3,
    up: (db) => db.exec("CREATE TABLE later (x INTEGER) STRICT"),
  };

  test("takes a pre-migration copy, then runs each step", () => {
    openTestLibrary(temp.dir, createTestHost(clock)).shutdown();
    const library = openTestLibrary(temp.dir, createTestHost(clock), {
      formatVersion: 3,
      formatSteps: [addColumn, addTable],
    });
    expect(library.status.formatVersion).toBe(3);
    expect(library.status.readOnly).toBeNull();
    library.shutdown();
    const copies = createTestHost(clock)
      .list(temp.dir)
      .filter((f) => f.startsWith("library.pre-v1-"));
    expect(copies).toHaveLength(1);
    const copy = new Database(join(temp.dir, copies[0] ?? ""));
    expect(
      (
        copy
          .query("SELECT value FROM meta WHERE key = 'format_version'")
          .get() as { value: string }
      ).value,
    ).toBe("1");
    copy.close();
  });

  test("a failed step leaves the library read-only at the last good version", () => {
    openTestLibrary(temp.dir, createTestHost(clock)).shutdown();
    const library = openTestLibrary(temp.dir, createTestHost(clock), {
      formatVersion: 3,
      formatSteps: [
        addColumn,
        {
          to: 3,
          up: (db) => {
            db.exec("CREATE TABLE half (x)");
            throw new Error("boom");
          },
        },
      ],
    });
    expect(library.status.readOnly).toBe("migration_failed");
    expect(library.status.formatVersion).toBe(2);
    rejectsWith("library_read_only", () => library.createDoc());
    library.shutdown();
    const db = raw();
    expect(
      db.query("SELECT 1 FROM sqlite_master WHERE name = 'half'").get(),
    ).toBeNull();
    db.close();
  });

  test("keeps the newest two pre-migration copies", () => {
    openTestLibrary(temp.dir, createTestHost(clock)).shutdown();
    for (const to of [2, 3, 4]) {
      clock.advance(60_000);
      openTestLibrary(temp.dir, createTestHost(clock), {
        formatVersion: to,
        formatSteps: [
          { to: 2, up: () => {} },
          { to: 3, up: () => {} },
          { to: 4, up: () => {} },
        ],
      }).shutdown();
    }
    const copies = createTestHost(clock)
      .list(temp.dir)
      .filter((f) => f.startsWith("library.pre-v"))
      .sort();
    expect(copies).toHaveLength(2);
    expect(copies[0]).toStartWith("library.pre-v2-");
    expect(copies[1]).toStartWith("library.pre-v3-");
  });
});

test("stats reads the pragmas back as set", () => {
  const library = openTestLibrary(temp.dir, createTestHost(clock));
  // checkpoint_fullfsync's default differs between SQLite builds.
  expect(library.stats().pragmas).toMatchObject({
    journalMode: "wal",
    synchronous: 2,
    fullfsync: 0,
    foreignKeys: 1,
  });
  library.shutdown();
});

test("shutdown releases every file handle (Windows can delete the folder)", () => {
  const lsof = Bun.which("lsof");
  if (!lsof) return;
  const library = openTestLibrary(temp.dir, createTestHost(clock));
  library.createDoc({ title: "x" });
  library.sidebar();
  library.shutdown();
  const open = Bun.spawnSync([lsof, "-p", String(process.pid)])
    .stdout.toString()
    .split("\n")
    .filter((line) => line.includes(temp.dir));
  expect(open).toEqual([]);
});
