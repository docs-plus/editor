import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";

import * as Y from "yjs";

import { openBunSqlite } from "@/desktop/dev/bun-sqlite-driver";
import {
  CLEAN_OPENS_TO_KEEP_PRE_COPIES,
  LIBRARY_FILE,
  type Library,
} from "@/desktop/storage/engine/library";
import { updatesInvariant } from "@/desktop/storage/engine/migrations";
import { docId, writeFormat1Library } from "@/tests/helpers/format-1-library";
import {
  createClock,
  createTempDir,
  createTestHost,
  openTestLibrary,
  type TestClock,
} from "@/tests/helpers/storage-library";

let temp: ReturnType<typeof createTempDir>;
let clock: TestClock;
const open: Library[] = [];

beforeEach(() => {
  temp = createTempDir();
  clock = createClock();
});
afterEach(() => {
  for (const library of open.splice(0)) library.shutdown();
  temp.cleanUp();
});

function openLib(dir = temp.dir, options = {}) {
  const library = openTestLibrary(dir, createTestHost(clock), options);
  open.push(library);
  return library;
}

function raw(dir = temp.dir) {
  return new Database(join(dir, LIBRARY_FILE));
}

function textOfRaw(db: Database, id: string): string {
  const doc = new Y.Doc();
  const snap = db
    .query("SELECT data FROM snapshots WHERE doc_id = ?")
    .get(id) as { data: Uint8Array } | null;
  if (snap) Y.applyUpdate(doc, snap.data);
  for (const row of db
    .query("SELECT data FROM updates WHERE doc_id = ? ORDER BY seq")
    .all(id) as { data: Uint8Array }[])
    Y.applyUpdate(doc, row.data);
  return doc.getText("t").toString();
}

function schemaOf(dir: string) {
  const db = raw(dir);
  const rows = db
    .query(
      "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
    )
    .all();
  db.close();
  return rows;
}

function invariantOf(dir: string) {
  const driver = openBunSqlite(join(dir, LIBRARY_FILE), { readOnly: false });
  try {
    return updatesInvariant(driver, createTestHost(clock));
  } finally {
    driver.close();
  }
}

describe("format 1 → 2 (offline revision §3)", () => {
  test("keeps every update byte and every document's content", () => {
    writeFormat1Library(temp.dir, { docs: 20 });
    const before = invariantOf(temp.dir);
    const v1 = raw();
    const texts = Array.from({ length: 20 }, (_, d) => textOfRaw(v1, docId(d)));
    v1.close();
    const library = openLib();
    expect(library.status).toMatchObject({ formatVersion: 2, readOnly: null });
    library.shutdown();
    open.length = 0;
    expect(invariantOf(temp.dir)).toBe(before);
    const v2 = raw();
    for (let d = 0; d < 20; d += 1)
      expect(textOfRaw(v2, docId(d))).toBe(texts[d] ?? "");
    v2.close();
  });

  test("sets head_seq, title_key and derived_seq, and moves a trashed doc out of its folder", () => {
    writeFormat1Library(temp.dir, { docs: 6 });
    openLib().shutdown();
    open.length = 0;
    const db = raw();
    const rows = db
      .query(
        `SELECT id, title_key, head_seq, derived_seq, folder_id, trashed_from,
           (SELECT MAX(seq) FROM updates u WHERE u.doc_id = docs.id) AS max_seq
         FROM docs ORDER BY id`,
      )
      .all() as Record<string, string | number | null>[];
    for (const row of rows) {
      expect(row.head_seq).toBe(row.max_seq);
      expect(row.derived_seq).toBeNull();
      expect(String(row.title_key)).toStartWith("doc ");
    }
    const trashed = rows.find((r) => r.id === docId(1));
    expect(trashed?.folder_id).toBeNull();
    db.close();
  });

  test("merges tags that collide under tagNameKey into the one with more documents", () => {
    const { cafeId, cafeLowerId } = writeFormat1Library(temp.dir, { docs: 8 });
    const library = openLib();
    const tags = library.sidebar().tags;
    expect(tags.map((t) => t.id).sort()).toEqual(
      [cafeLowerId, tags.find((t) => t.name === "Work")?.id ?? ""].sort(),
    );
    const tagged = library
      .sidebar()
      .docs.filter((d) => d.tagIds.includes(cafeLowerId))
      .map((d) => d.id)
      .sort();
    expect(tagged).toEqual([docId(0), docId(3), docId(4), docId(5)].sort());
    expect(tags.some((t) => t.id === cafeId)).toBe(false);
  });

  test("a fresh library and a migrated one have identical schemas", () => {
    writeFormat1Library(temp.dir, { docs: 3 });
    openLib().shutdown();
    const fresh = createTempDir();
    openLib(fresh.dir).shutdown();
    open.length = 0;
    expect(schemaOf(temp.dir)).toEqual(schemaOf(fresh.dir));
    fresh.cleanUp();
  });

  test("leaves foreign keys on, foreign_key_check clean and the WAL empty", () => {
    writeFormat1Library(temp.dir);
    const library = openLib();
    expect(library.stats().pragmas.foreignKeys).toBe(1);
    library.shutdown();
    open.length = 0;
    const db = raw();
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
  });

  test("takes one backup first", () => {
    writeFormat1Library(temp.dir);
    openLib();
    const copies = createTestHost(clock)
      .list(temp.dir)
      .filter((f) => f.startsWith("library.pre-v1-"));
    expect(copies).toHaveLength(1);
  });
});

describe("preflight (§3.3): refuses, never coerces", () => {
  const cases: [string, string][] = [
    [
      "an orphaned folder_id",
      "UPDATE docs SET folder_id = 'gone' WHERE rowid = 1",
    ],
    ["pinned out of range", "UPDATE docs SET pinned = 2 WHERE rowid = 1"],
    [
      "a malformed link_key",
      "UPDATE docs SET link_key = 'XYZ' WHERE rowid = 1",
    ],
    [
      "trash columns without trashed_at",
      "UPDATE docs SET trash_group = 'g', trashed_at = NULL WHERE rowid = 1",
    ],
    [
      "a folder cycle",
      "UPDATE folders SET parent_id = (SELECT id FROM folders WHERE parent_id IS NOT NULL LIMIT 1) WHERE parent_id IS NULL",
    ],
  ];
  for (const [name, sql] of cases)
    test(name, () => {
      writeFormat1Library(temp.dir);
      const db = raw();
      db.exec(sql);
      db.close();
      const library = openLib();
      expect(library.status.readOnly).toBe("migration_failed");
      expect(library.status.formatVersion).toBe(1);
      library.shutdown();
      open.length = 0;
      const after = raw();
      expect(
        after
          .query(
            "SELECT 1 FROM pragma_table_info('docs') WHERE name = 'head_seq'",
          )
          .get(),
      ).toBeNull();
      after.close();
    });
});

describe("format-2 triggers", () => {
  function codeOf(run: () => unknown) {
    try {
      run();
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    return "ran";
  }

  test("link_key and lineage are frozen", () => {
    const library = openLib();
    library.createDoc();
    library.shutdown();
    open.length = 0;
    const db = raw();
    expect(
      codeOf(() =>
        db.exec(
          "UPDATE docs SET link_key = '00000000000000000000000000000001'",
        ),
      ),
    ).toContain("identity is frozen");
    expect(codeOf(() => db.exec("UPDATE docs SET lineage = 'x'"))).toContain(
      "identity is frozen",
    );
    db.close();
  });

  test("head_seq only rises", () => {
    const library = openLib();
    const { id } = library.createDoc();
    library.load(id, "w");
    const update = Y.encodeStateAsUpdate(new Y.Doc());
    const doc = new Y.Doc();
    doc.getText("t").insert(0, "x");
    library.append(id, "w", {
      origin: "local",
      update: Y.encodeStateAsUpdate(doc),
    });
    void update;
    library.shutdown();
    open.length = 0;
    const db = raw();
    expect(codeOf(() => db.exec("UPDATE docs SET head_seq = 0"))).toContain(
      "head_seq only rises",
    );
    db.close();
  });

  test("a folder can't become its own ancestor", () => {
    const library = openLib();
    const a = library.createFolder({ name: "a" });
    const b = library.createFolder({ name: "b", parentId: a?.id });
    library.shutdown();
    open.length = 0;
    const db = raw();
    expect(
      codeOf(() =>
        db
          .prepare("UPDATE folders SET parent_id = ? WHERE id = ?")
          .run(b?.id ?? "", a?.id ?? ""),
      ),
    ).toContain("folder cycle");
    db.close();
  });
});

describe("pragmas and pre-migration copies", () => {
  test("secure_delete is FAST on the writer", () => {
    const library = openLib();
    const db = (
      library as unknown as { db: { prepare(s: string): { get(): unknown } } }
    ).db;
    expect(db.prepare("PRAGMA secure_delete").get()).toEqual({
      secure_delete: 2,
    });
  });

  test(`pre-migration copies go after ${CLEAN_OPENS_TO_KEEP_PRE_COPIES} clean opens`, () => {
    writeFormat1Library(temp.dir);
    openLib().shutdown();
    open.length = 0;
    const copies = () =>
      createTestHost(clock)
        .list(temp.dir)
        .filter((f) => f.startsWith("library.pre-v"));
    // The migrating open was the first clean open at format 2.
    for (let i = 2; i < CLEAN_OPENS_TO_KEEP_PRE_COPIES; i += 1) {
      openLib().shutdown();
      open.length = 0;
    }
    expect(copies()).toHaveLength(1);
    openLib().shutdown();
    open.length = 0;
    expect(copies()).toHaveLength(0);
  });
});
