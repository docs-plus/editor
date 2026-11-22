/**
 * Repair and rebuild (offline revision §4.5, P2.6f): check mode, "Rebuild
 * index", and the rebuild into a new file after a failed `quick_check`.
 * Every entry point runs twice: the second run changes nothing.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  closeSync,
  copyFileSync,
  existsSync,
  openSync,
  readFileSync,
  statSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";

import * as Y from "yjs";

import { openBunSqlite } from "@/desktop/dev/bun-sqlite-driver";
import type { SqliteDriver } from "@/desktop/storage/engine/driver";
import { StorageError } from "@/desktop/storage/engine/errors";
import { LIBRARY_FILE, type Library } from "@/desktop/storage/engine/library";
import {
  checkLibrary,
  RESET_CHUNK,
  rebuildIntoNewFile,
  resetDerivedChunk,
} from "@/desktop/storage/engine/repair";
import {
  createClock,
  createTempDir,
  createTestHost,
  mustFolder,
  mustTag,
  openTestLibrary,
  type TestClock,
} from "@/tests/helpers/storage-library";
import {
  createRng,
  derivedSnapshot,
  drainWithStub,
  randomEdit,
  rawDb,
} from "@/tests/helpers/storage-repair";

let temp: ReturnType<typeof createTempDir>;
let clock: TestClock;
let host: ReturnType<typeof createTestHost>;
let library: Library;

beforeEach(() => {
  temp = createTempDir();
  clock = createClock();
  host = createTestHost(clock);
  library = openTestLibrary(join(temp.dir, "lib"), host);
});
afterEach(() => {
  library.shutdown();
  temp.cleanUp();
});

const CLEAN = {
  headSeqRaised: 0,
  sizeFixed: 0,
  violations: [],
  orphanBlobRows: 0,
};

function check() {
  return checkLibrary(rawDb(library), host, clock.now);
}

/** A document with `edits` appended updates, closed again. */
function docWithContent(edits = 3, folderId: string | null = null) {
  const { id } = library.createDoc({ folderId });
  const rng = createRng(id.charCodeAt(0));
  library.load(id, "w");
  for (let i = 0; i < edits; i += 1)
    library.append(id, "w", {
      origin: "local",
      update: randomEdit(library.stateOf(id), rng, []),
    });
  library.close(id, "w");
  return id;
}

function column(db: SqliteDriver, sql: string, ...params: string[]) {
  const row = db.prepare(sql).get(...params);
  return row ? Object.values(row)[0] : undefined;
}

describe("check mode", () => {
  test("a healthy library is a no-op, twice", () => {
    const folder = mustFolder(library, { name: "Work" });
    docWithContent(4, folder.id);
    docWithContent(2);
    expect(check()).toEqual(CLEAN);
    expect(check()).toEqual(CLEAN);
  });

  test("raises head_seq to the newest row and snapshot, never lowering it", () => {
    const db = rawDb(library);
    const behind = docWithContent(2);
    const snapped = docWithContent(1);
    const ahead = docWithContent(1);
    // A row the engine didn't account for (as after a bug or a bad restore).
    db.prepare(
      "INSERT INTO updates (doc_id, data, origin, created_at) VALUES (?, ?, 'local', 0)",
    ).run(behind, Y.encodeStateAsUpdate(new Y.Doc()));
    const top = Number(
      column(db, "SELECT MAX(seq) FROM updates WHERE doc_id = ?", behind),
    );
    db.prepare(
      "INSERT INTO snapshots (doc_id, data, upto_seq) VALUES (?, ?, ?)",
    ).run(snapped, Y.encodeStateAsUpdate(new Y.Doc()), top + 50);
    const aheadHead = Number(
      column(db, "SELECT head_seq FROM docs WHERE id = ?", ahead),
    );
    db.prepare("UPDATE docs SET head_seq = head_seq + 1000 WHERE id = ?").run(
      ahead,
    );

    const first = check();
    expect(first.headSeqRaised).toBe(2);
    expect(column(db, "SELECT head_seq FROM docs WHERE id = ?", behind)).toBe(
      top,
    );
    expect(column(db, "SELECT head_seq FROM docs WHERE id = ?", snapped)).toBe(
      top + 50,
    );
    // A head_seq above its rows (rows compacted away) is left alone.
    expect(column(db, "SELECT head_seq FROM docs WHERE id = ?", ahead)).toBe(
      aheadHead + 1000,
    );
    expect(check().headSeqRaised).toBe(0);
  });

  test("recomputes size_bytes as the snapshot plus the remaining rows (I9)", () => {
    const db = rawDb(library);
    const id = docWithContent(3);
    const { maxSeq } = library.load(id, "w");
    library.compact(id, "w", library.stateOf(id), maxSeq);
    library.append(id, "w", {
      origin: "local",
      update: randomEdit(library.stateOf(id), createRng(7), []),
    });
    library.close(id, "w");
    const right = Number(
      column(db, "SELECT size_bytes FROM docs WHERE id = ?", id),
    );
    db.prepare("UPDATE docs SET size_bytes = 7 WHERE id = ?").run(id);
    const revBefore = Number(
      column(db, "SELECT value FROM meta WHERE key = 'rev'"),
    );

    const first = check();
    expect(first.sizeFixed).toBe(1);
    expect(column(db, "SELECT size_bytes FROM docs WHERE id = ?", id)).toBe(
      right,
    );
    // The sidebar shows the size, so a fix moves rev; a no-op doesn't.
    const revAfter = Number(
      column(db, "SELECT value FROM meta WHERE key = 'rev'"),
    );
    expect(revAfter).toBeGreaterThan(revBefore);
    expect(check()).toEqual(CLEAN);
    expect(Number(column(db, "SELECT value FROM meta WHERE key = 'rev'"))).toBe(
      revAfter,
    );
  });

  test("reports an I1 foreign-key violation and leaves it", () => {
    const db = rawDb(library);
    const id = docWithContent(1);
    db.exec("PRAGMA foreign_keys = OFF");
    db.prepare("INSERT INTO doc_tags (doc_id, tag_id) VALUES (?, 'gone')").run(
      id,
    );
    db.exec("PRAGMA foreign_keys = ON");
    const first = check();
    expect(first.violations).toHaveLength(1);
    expect(first.violations[0]).toMatch(/^I1 .*doc_tags/);
    expect(check().violations).toEqual(first.violations);
    expect(column(db, "SELECT COUNT(*) FROM doc_tags")).toBe(1);
  });

  test("reports I2: a folder deeper than 4, and a cycle", () => {
    const db = rawDb(library);
    let parent: string | null = null;
    for (const name of ["a", "b", "c", "d", "e"]) {
      db.prepare(
        "INSERT INTO folders (id, parent_id, name, created_at, modified_at) VALUES (?, ?, ?, 0, 0)",
      ).run(name, parent, name);
      parent = name;
    }
    db.exec("PRAGMA foreign_keys = OFF");
    db.prepare(
      "INSERT INTO folders (id, parent_id, name, created_at, modified_at) VALUES ('x', 'y', 'x', 0, 0)",
    ).run();
    db.prepare(
      "INSERT INTO folders (id, parent_id, name, created_at, modified_at) VALUES ('y', 'x', 'y', 0, 0)",
    ).run();
    db.exec("PRAGMA foreign_keys = ON");
    const { violations } = check();
    expect(violations).toContain("I2 folder e is at depth 5");
    expect(violations).toContain("I2 folder x is in a cycle");
    expect(violations).toContain("I2 folder y is in a cycle");
    expect(check().violations).toEqual(violations);
  });

  test("reports I3: trash columns without trashed_at", () => {
    const db = rawDb(library);
    const id = docWithContent(1);
    const folder = mustFolder(library, { name: "F" });
    db.exec("PRAGMA ignore_check_constraints = ON");
    db.prepare("UPDATE docs SET trash_group = 'g' WHERE id = ?").run(id);
    db.prepare("UPDATE folders SET trash_group = 'g' WHERE id = ?").run(
      folder.id,
    );
    db.exec("PRAGMA ignore_check_constraints = OFF");
    expect(check().violations.sort()).toEqual(
      [
        `I3 doc ${id}: trash columns set without trashed_at`,
        `I3 folder ${folder.id}: trash columns set without trashed_at`,
      ].sort(),
    );
  });

  test("reports I4: a live document or folder under a trashed folder", () => {
    const db = rawDb(library);
    const outer = mustFolder(library, { name: "Outer" });
    const inner = mustFolder(library, { name: "Inner", parentId: outer.id });
    const doc = docWithContent(1, inner.id);
    db.prepare(
      "UPDATE folders SET trashed_at = 1, trash_group = 'g' WHERE id = ?",
    ).run(outer.id);
    expect(check().violations.sort()).toEqual(
      [
        `I4 doc ${doc}: folder ${outer.id} in its chain is in the Trash`,
        `I4 folder ${inner.id}: folder ${outer.id} in its chain is in the Trash`,
      ].sort(),
    );
  });

  test("a library built through the engine's own trash ops is clean", () => {
    const outer = mustFolder(library, { name: "Outer" });
    const inner = mustFolder(library, { name: "Inner", parentId: outer.id });
    docWithContent(1, inner.id);
    const loose = docWithContent(1, outer.id);
    library.trashDoc(loose);
    library.trashFolder(outer.id);
    expect(check()).toEqual(CLEAN);
    library.restoreFolder(outer.id);
    expect(check()).toEqual(CLEAN);
  });

  test("reports doc_blobs rows of a purged document with no dropped_at, and keeps them", () => {
    const db = rawDb(library);
    const hash = "a".repeat(64);
    db.prepare(
      "INSERT INTO blobs (hash, mime, size, created_at, origin) VALUES (?, 'image/png', 1, 0, 'insert')",
    ).run(hash);
    const kept = docWithContent(1);
    const purged = docWithContent(1);
    for (const doc of [kept, purged])
      db.prepare(
        "INSERT INTO doc_blobs (doc_id, hash, kind) VALUES (?, ?, 'current')",
      ).run(doc, hash);
    library.purgeDoc(purged);
    // The engine's purge stamps dropped_at: nothing to report.
    expect(check().orphanBlobRows).toBe(0);
    db.prepare(
      "INSERT INTO doc_blobs (doc_id, hash, kind) VALUES ('ghost', ?, 'current')",
    ).run(hash);
    db.prepare(
      "INSERT INTO doc_blobs (doc_id, hash, kind, dropped_at) VALUES ('ghost', ?, 'version', 5)",
    ).run(hash);
    expect(check().orphanBlobRows).toBe(1);
    expect(check().orphanBlobRows).toBe(1);
    expect(column(db, "SELECT COUNT(*) FROM doc_blobs")).toBe(4);
    expect(
      column(
        db,
        "SELECT dropped_at FROM doc_blobs WHERE doc_id = 'ghost' AND kind = 'current'",
      ),
    ).toBeNull();
  });

  test("Library.repairCheck runs check mode", () => {
    docWithContent(1);
    expect(library.repairCheck()).toEqual(CLEAN);
  });
});

describe("folder depth after a restore (I2)", () => {
  // A trashed subtree whose old parent moved deeper while it was in the
  // Trash comes back at the root instead (P2.6d).
  test("restoring a folder never nests deeper than 4", () => {
    const p = mustFolder(library, { name: "P" });
    const a = mustFolder(library, { name: "A", parentId: p.id });
    const b = mustFolder(library, { name: "B", parentId: a.id });
    mustFolder(library, { name: "C", parentId: b.id });
    library.trashFolder(a.id);
    const q = mustFolder(library, { name: "Q" });
    const moved = library.moveItems([{ kind: "folder", id: p.id }], q.id);
    expect(moved.ok).toBe(true);
    library.restoreFolder(a.id);
    expect(check().violations).toEqual([]);
  });
});

describe("rebuild index", () => {
  function plantDerived(db: SqliteDriver, count: number) {
    const insert = db.prepare(
      `INSERT INTO docs (id, created_at, modified_at, lineage, link_key, head_seq,
         derived_seq, links_hash, headings_hash) VALUES (?, 0, 0, ?, ?, 3, 3, 'l', 'h')`,
    );
    const rng = createRng(count);
    db.exec("BEGIN");
    for (let i = 0; i < count; i += 1)
      insert.run(`d${i}`, crypto.randomUUID(), rng.hex32());
    db.exec("COMMIT");
  }

  test("resets derived_seq and both hashes in chunks of 500 until done", () => {
    const db = rawDb(library);
    plantDerived(db, 1200);
    expect(resetDerivedChunk(db)).toBe(RESET_CHUNK);
    expect(resetDerivedChunk(db)).toBe(RESET_CHUNK);
    expect(resetDerivedChunk(db)).toBe(200);
    expect(resetDerivedChunk(db)).toBe(0);
    expect(
      column(
        db,
        `SELECT COUNT(*) FROM docs WHERE derived_seq IS NOT NULL
           OR links_hash IS NOT NULL OR headings_hash IS NOT NULL`,
      ),
    ).toBe(0);
    expect(library.nextStale()).not.toBeNull();
  });

  test("resets a document that kept a hash with no derived_seq", () => {
    const db = rawDb(library);
    const id = docWithContent(1);
    db.prepare(
      "UPDATE docs SET derived_seq = NULL, links_hash = 'stale' WHERE id = ?",
    ).run(id);
    expect(resetDerivedChunk(db)).toBe(1);
    expect(
      column(db, "SELECT links_hash FROM docs WHERE id = ?", id),
    ).toBeNull();
    expect(resetDerivedChunk(db)).toBe(0);
  });

  test("Library.resetDerived resets everything; a second run resets nothing", () => {
    docWithContent(2);
    docWithContent(3);
    drainWithStub(library);
    expect(library.nextStale()).toBeNull();
    expect(library.resetDerived()).toBe(2);
    expect(library.resetDerived()).toBe(0);
    expect(drainWithStub(library)).toBe(2);
  });

  test("check mode never resets derivation", () => {
    docWithContent(2);
    drainWithStub(library);
    const before = derivedSnapshot(rawDb(library));
    check();
    expect(derivedSnapshot(rawDb(library))).toEqual(before);
  });
});

// ── Rebuild into a new file (SEC-009) ──────────────────────────────────────

function sha(path: string): string {
  return new Bun.CryptoHasher("sha256")
    .update(readFileSync(path))
    .digest("hex");
}

/** Copies the library file with its WAL companions, as a damaged copy. */
function copyLibraryFiles(from: string, to: string) {
  copyFileSync(from, to);
  for (const suffix of ["-wal", "-shm"])
    if (existsSync(from + suffix)) copyFileSync(from + suffix, to + suffix);
}

/**
 * The leaf pages of `table`'s b-tree in key order, with their cell counts,
 * read from the file's bytes (`dbstat` isn't in every SQLite build). Read
 * after `shutdown()`: its TRUNCATE checkpoint leaves the WAL empty.
 */
function leavesInKeyOrder(path: string, table: string) {
  const db = openBunSqlite(path, { readOnly: true });
  let pageSize: number;
  let root: number;
  try {
    pageSize = Number(column(db, "PRAGMA page_size"));
    root = Number(
      column(db, "SELECT rootpage FROM sqlite_master WHERE name = ?", table),
    );
  } finally {
    db.close();
  }
  const file = readFileSync(path);
  const leaves: { page: number; cells: number }[] = [];
  const walk = (page: number) => {
    const start = (page - 1) * pageSize;
    const kind = file.readUInt8(start);
    const cells = file.readUInt16BE(start + 3);
    // 0x0d and 0x0a are table and index leaves; 0x05 and 0x02 interiors.
    if (kind === 0x0d || kind === 0x0a) {
      leaves.push({ page, cells });
      return;
    }
    if (kind !== 0x05 && kind !== 0x02)
      throw new Error(`page ${page} is not a b-tree page`);
    for (let cell = 0; cell < cells; cell += 1)
      walk(file.readUInt32BE(start + file.readUInt16BE(start + 12 + 2 * cell)));
    walk(file.readUInt32BE(start + 8));
  };
  walk(root);
  return { leaves, pageSize };
}

/**
 * Overwrites one leaf page of `table` in the middle of the file with
 * garbage, at a page boundary. Returns how many rows the page held and how
 * many rows the leaves before it hold (a rowid table keeps every row in its
 * leaves).
 */
function corruptMiddleLeaf(
  path: string,
  table: string,
): { cells: number; before: number } {
  const { leaves, pageSize } = leavesInKeyOrder(path, table);
  const index = Math.floor(leaves.length / 2);
  const middle = leaves[index];
  if (!middle || leaves.length < 3) throw new Error(`too few ${table} leaves`);
  const before = leaves
    .slice(0, index)
    .reduce((sum, leaf) => sum + leaf.cells, 0);
  const fd = openSync(path, "r+");
  try {
    writeSync(
      fd,
      Buffer.alloc(pageSize, 0xab),
      0,
      pageSize,
      (middle.page - 1) * pageSize,
    );
  } finally {
    closeSync(fd);
  }
  return { cells: middle.cells, before };
}

/** Every update's seq and document, from a file before it is damaged. */
function rawSeqOwners(path: string): [number, string][] {
  const db = openBunSqlite(path, { readOnly: true });
  try {
    return db
      .prepare("SELECT seq, doc_id FROM updates ORDER BY seq")
      .all()
      .map((row) => [Number(row.seq), String(row.doc_id)]);
  } finally {
    db.close();
  }
}

function quickCheckOf(path: string): string {
  const db = openBunSqlite(path, { readOnly: true });
  try {
    return db
      .prepare("PRAGMA quick_check")
      .all()
      .map((row) => String(Object.values(row)[0]))
      .join("; ");
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  } finally {
    db.close();
  }
}

function schemaOf(db: SqliteDriver) {
  return db
    .prepare(
      "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
    )
    .all();
}

describe("rebuild into a new file", () => {
  /** A library with folders, tags, view rows and derived rows; shut down. */
  function buildLibrary(docs: number) {
    const work = mustFolder(library, { name: "Work" });
    const tag = mustTag(library, "urgent");
    const ids: string[] = [];
    for (let i = 0; i < docs; i += 1) {
      const id = docWithContent(2, i % 2 === 0 ? work.id : null);
      library.addTag(id, tag.id);
      ids.push(id);
    }
    drainWithStub(library);
    const states = new Map(ids.map((id) => [id, library.stateOf(id)]));
    const libraryId = library.status.libraryId;
    library.shutdown();
    return {
      ids,
      states,
      libraryId,
      source: join(temp.dir, "lib", LIBRARY_FILE),
    };
  }

  function openRebuilt(target: string) {
    return openTestLibrary(join(target, ".."), host);
  }

  test("an intact library rebuilds row for row, with derivation reset", () => {
    const { ids, states, libraryId, source } = buildLibrary(6);
    const before = sha(source);
    const target = join(temp.dir, "out", LIBRARY_FILE);
    const report = rebuildIntoNewFile(openBunSqlite, host, source, target);
    expect(report.skippedRows).toBe(0);
    expect(report.copiedRows).toBeGreaterThan(ids.length * 3);
    expect(report.foreignKeyCheck).toBe("ok");
    expect(report.integrityCheck).toBe("ok");
    expect(sha(source)).toBe(before);

    const rebuilt = openRebuilt(target);
    try {
      expect(rebuilt.status.readOnly).toBeNull();
      expect(rebuilt.status.formatVersion).toBe(2);
      expect(rebuilt.status.libraryId).toBe(libraryId);
      for (const id of ids)
        expect(rebuilt.stateOf(id)).toEqual(states.get(id) as Uint8Array);
      expect(rebuilt.sidebar().docs).toHaveLength(ids.length);
      expect(
        rebuilt.sidebar().docs.every((doc) => doc.tagIds.length === 1),
      ).toBe(true);
      expect(rebuilt.repairCheck()).toEqual(CLEAN);
      // Derived rows come back through the queue.
      expect(drainWithStub(rebuilt)).toBe(ids.length);
      // The schema is a fresh library's, triggers and indexes included.
      const fresh = openTestLibrary(join(temp.dir, "fresh"), host);
      try {
        expect(schemaOf(rawDb(rebuilt))).toEqual(schemaOf(rawDb(fresh)));
      } finally {
        fresh.shutdown();
      }
    } finally {
      rebuilt.shutdown();
    }
  });

  test("a damaged library: keeps the readable rows, passes both checks, opens", () => {
    const { ids, states, source } = buildLibrary(60);
    const damaged = join(temp.dir, "damaged.sqlite");
    copyLibraryFiles(source, damaged);
    const owners = rawSeqOwners(damaged);
    const { cells, before: rowsBefore } = corruptMiddleLeaf(damaged, "updates");
    const lostSeqs = owners
      .slice(rowsBefore, rowsBefore + cells)
      .map(([seq]) => seq);
    const ownerOf = new Map(owners);
    const hitDocs = new Set(lostSeqs.map((seq) => ownerOf.get(seq)));
    expect(lostSeqs.length).toBeGreaterThan(0);
    expect(quickCheckOf(damaged)).not.toBe("ok");
    const before = sha(damaged);
    const target = join(temp.dir, "out", LIBRARY_FILE);

    const report = rebuildIntoNewFile(openBunSqlite, host, damaged, target);
    expect(report.skippedRows).toBe(lostSeqs.length);
    expect(report.foreignKeyCheck).toBe("ok");
    expect(report.integrityCheck).toBe("ok");
    expect(sha(damaged)).toBe(before);
    expect(existsSync(`${target}.partial`)).toBe(false);

    const rebuilt = openRebuilt(target);
    try {
      expect(rebuilt.status.readOnly).toBeNull();
      expect(rebuilt.repairCheck()).toEqual(CLEAN);
      const db = rawDb(rebuilt);
      // Every document row survived (only `updates` was hit).
      expect(rebuilt.sidebar().docs).toHaveLength(ids.length);
      // Documents with all their rows read back byte for byte.
      let intact = 0;
      for (const id of ids) {
        const rows = Number(
          column(db, "SELECT COUNT(*) FROM updates WHERE doc_id = ?", id),
        );
        if (rows === 2) {
          expect(rebuilt.stateOf(id)).toEqual(states.get(id) as Uint8Array);
          intact += 1;
        }
      }
      expect(intact).toBe(ids.length - hitDocs.size);
      // seq never goes back: the next append lands above every head_seq.
      const top = Number(column(db, "SELECT MAX(head_seq) FROM docs"));
      const id = ids[0] as string;
      rebuilt.load(id, "w");
      const seq = rebuilt.append(id, "w", {
        origin: "local",
        update: randomEdit(rebuilt.stateOf(id), createRng(1), []),
      });
      rebuilt.close(id, "w");
      expect(seq).toBeGreaterThan(top);
    } finally {
      rebuilt.shutdown();
    }
  }, 30_000);

  test("a damaged derived table: skips past the page, and the queue rebuilds it", () => {
    const keys = Array.from({ length: 40 }, (_, i) =>
      i.toString(16).padStart(32, "0"),
    );
    const ids: string[] = [];
    for (let i = 0; i < 30; i += 1) {
      const { id } = library.createDoc({ title: `Linked ${i}` });
      const doc = new Y.Doc();
      doc.getArray("headings").insert(0, [{ tocId: "t", level: 1, text: "T" }]);
      doc.getArray("links").insert(
        0,
        keys.map((targetKey, n) => ({ targetKey, text: `link number ${n}` })),
      );
      library.load(id, "w");
      library.append(id, "w", {
        origin: "local",
        update: Y.encodeStateAsUpdate(doc),
      });
      library.close(id, "w");
      ids.push(id);
    }
    drainWithStub(library);
    const healthy = derivedSnapshot(rawDb(library));
    library.shutdown();
    const damaged = join(temp.dir, "damaged.sqlite");
    copyLibraryFiles(join(temp.dir, "lib", LIBRARY_FILE), damaged);
    const { cells } = corruptMiddleLeaf(damaged, "links");
    expect(quickCheckOf(damaged)).not.toBe("ok");
    const target = join(temp.dir, "out", LIBRARY_FILE);

    const report = rebuildIntoNewFile(openBunSqlite, host, damaged, target);
    // Past the damage the read resumes at the next document, so a few rows
    // of the document the page ended in can go too; the queue rebuilds them.
    expect(report.skippedRows).toBeGreaterThanOrEqual(cells);
    expect(report.skippedRows).toBeLessThan(cells + 2 * keys.length);
    expect(report.foreignKeyCheck).toBe("ok");
    expect(report.integrityCheck).toBe("ok");

    const rebuilt = openRebuilt(target);
    try {
      expect(rebuilt.repairCheck()).toEqual(CLEAN);
      expect(drainWithStub(rebuilt)).toBe(ids.length);
      expect(derivedSnapshot(rawDb(rebuilt))).toEqual(healthy);
    } finally {
      rebuilt.shutdown();
    }
  }, 30_000);

  test("reads a lone file with no -wal or -shm next to it", () => {
    const { ids, source } = buildLibrary(3);
    const lone = join(temp.dir, "lone.sqlite");
    copyFileSync(source, lone);
    const report = rebuildIntoNewFile(
      openBunSqlite,
      host,
      lone,
      join(temp.dir, "out", LIBRARY_FILE),
    );
    expect(report.skippedRows).toBe(0);
    expect(report.integrityCheck).toBe("ok");
    expect(existsSync(`${lone}-shm`)).toBe(false);
    const rebuilt = openRebuilt(join(temp.dir, "out", LIBRARY_FILE));
    try {
      expect(rebuilt.sidebar().docs).toHaveLength(ids.length);
    } finally {
      rebuilt.shutdown();
    }
  });

  test("refuses a target that exists, and never touches it", () => {
    const { source } = buildLibrary(1);
    const target = join(temp.dir, "taken.sqlite");
    copyFileSync(source, target);
    const before = statSync(target).size;
    let code: string | undefined;
    try {
      rebuildIntoNewFile(openBunSqlite, host, source, target);
    } catch (error) {
      code = error instanceof StorageError ? error.code : String(error);
    }
    expect(code).toBe("invalid_argument");
    expect(statSync(target).size).toBe(before);
  });

  test("rebuilding the same source twice gives the same rows", () => {
    const { source } = buildLibrary(4);
    const first = rebuildIntoNewFile(
      openBunSqlite,
      host,
      source,
      join(temp.dir, "one.sqlite"),
    );
    const second = rebuildIntoNewFile(
      openBunSqlite,
      host,
      source,
      join(temp.dir, "two.sqlite"),
    );
    expect(second).toEqual(first);
  });
});
