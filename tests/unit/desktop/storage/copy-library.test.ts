import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it, test } from "bun:test";
import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import * as Y from "yjs";

import { openBunSqlite } from "@/desktop/dev/bun-sqlite-driver";
import { copyLibraryBatched } from "@/desktop/storage/engine/copy-library";
import { LIBRARY_FILE, type Library } from "@/desktop/storage/engine/library";
import { defineDocStoreContract } from "@/tests/helpers/doc-store-contract";
import { createEngineDocStore } from "@/tests/helpers/engine-doc-store";
import {
  createClock,
  createTempDir,
  createTestHost,
  mustFolder,
  mustTag,
  openTestLibrary,
  type TestClock,
} from "@/tests/helpers/storage-library";

let temp: ReturnType<typeof createTempDir>;
let out: ReturnType<typeof createTempDir>;
let clock: TestClock;
let library: Library;

beforeEach(() => {
  temp = createTempDir();
  out = createTempDir("tinydocy-copy-");
  clock = createClock();
  library = openTestLibrary(temp.dir, createTestHost(clock));
});
afterEach(() => {
  library.shutdown();
  temp.cleanUp();
  out.cleanUp();
});

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function write(docId: string, text: string) {
  if (!library.isOpen(docId)) library.load(docId, "w1");
  const doc = new Y.Doc();
  doc.getText("t").insert(0, text);
  return library.append(docId, "w1", {
    origin: "local",
    update: Y.encodeStateAsUpdate(doc),
  });
}

/** A library with every table populated, and a compacted document. */
function populate() {
  const folder = mustFolder(library, { name: "Work" });
  const docs = Array.from({ length: 12 }, (_, i) =>
    library.createDoc({ title: `Doc ${i}`, folderId: folder.id }),
  );
  const tags = Array.from({ length: 5 }, (_, i) => mustTag(library, `t${i}`));
  for (const doc of docs.slice(0, 6))
    library.setDocTags(
      doc.id,
      tags.map((t) => t.id),
    );
  for (const [i, doc] of docs.entries()) {
    for (let n = 0; n < 5; n += 1) write(doc.id, `${i}:${n} `);
  }
  const first = docs[0]?.id ?? "";
  const seq = write(first, "x");
  // The document's whole state: compaction refuses one that loses rows (I10).
  library.compact(first, "w1", library.stateOf(first), seq);
  return docs.map((d) => d.id);
}

function describeFile(path: string) {
  const db = new Database(path, { readonly: true });
  const schema = db
    .query(
      "SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name",
    )
    .all();
  const counts = Object.fromEntries(
    (
      db
        .query(
          "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
        )
        .all() as { name: string }[]
    ).map(({ name }) => [
      name,
      (db.query(`SELECT COUNT(*) AS n FROM "${name}"`).get() as { n: number })
        .n,
    ]),
  );
  const sequence = db.query("SELECT * FROM sqlite_sequence").all();
  const meta = db.query("SELECT key, value FROM meta ORDER BY key").all();
  const pragmas = {
    user_version: db.query("PRAGMA user_version").get(),
    application_id: db.query("PRAGMA application_id").get(),
    integrity: db.query("PRAGMA integrity_check").get(),
  };
  db.close();
  return { schema, counts, sequence, meta, pragmas };
}

describe("copyLibraryBatched", () => {
  test("copies the schema verbatim, every row, the sequence and the pragmas", async () => {
    populate();
    const raw = new Database(library.path);
    raw.exec("PRAGMA user_version = 7; PRAGMA application_id = 1952807268");
    raw.close();
    const partial = join(out.dir, "copy.sqlite.partial");
    const report = await copyLibraryBatched(
      openBunSqlite,
      library.path,
      partial,
      {
        batchRows: 3,
        yieldNow: tick,
      },
    );
    const source = describeFile(library.path);
    const copy = describeFile(partial);
    expect(copy).toEqual(source);
    expect(copy.pragmas.integrity).toEqual({ integrity_check: "ok" });
    expect(report.rows).toBe(
      Object.entries(source.counts)
        .filter(([name]) => name !== "sqlite_sequence")
        .reduce((sum, [, n]) => sum + n, 0),
    );
    expect(report.batches).toBeGreaterThan(10);
  });

  test("is one snapshot: rows the writer commits during the copy aren't in it", async () => {
    const [docId = ""] = populate();
    const before = describeFile(library.path).counts;
    let writes = 0;
    const partial = join(out.dir, "copy.sqlite.partial");
    await copyLibraryBatched(openBunSqlite, library.path, partial, {
      batchRows: 2,
      yieldNow: async () => {
        // The writer keeps committing between batches.
        write(docId, `during ${writes++}`);
        await tick();
      },
    });
    expect(writes).toBeGreaterThan(5);
    expect(describeFile(partial).counts).toEqual(before);
    expect(describeFile(library.path).counts.updates).toBe(
      (before.updates ?? 0) + writes,
    );
  });

  test("refuses a copy whose rows don't match the snapshot, leaving nothing committed", async () => {
    populate();
    const partial = join(out.dir, "copy.sqlite.partial");
    await expect(
      copyLibraryBatched(openBunSqlite, library.path, partial, {
        yieldNow: tick,
        beforeVerify: (dest) => dest.exec("DELETE FROM main.doc_tags"),
      }),
    ).rejects.toMatchObject({ code: "corrupt" });
    const db = new Database(partial, { readonly: true });
    expect(db.query("SELECT COUNT(*) AS n FROM sqlite_master").get()).toEqual({
      n: 0,
    });
    db.close();
  });

  test("stops between batches when told to, and releases the files", async () => {
    populate();
    const partial = join(out.dir, "copy.sqlite.partial");
    let batches = 0;
    await expect(
      copyLibraryBatched(openBunSqlite, library.path, partial, {
        batchRows: 2,
        yieldNow: async () => {
          if (++batches === 4) throw new Error("terminated");
        },
      }),
    ).rejects.toThrow("terminated");
    const lsof = Bun.which("lsof");
    if (lsof) {
      const open = Bun.spawnSync([lsof, "-p", String(process.pid)])
        .stdout.toString()
        .split("\n")
        .filter((line) => line.includes(out.dir));
      expect(open).toEqual([]);
    }
  });

  test("writes a URI-safe read-only attach for paths with spaces and #", async () => {
    library.shutdown();
    const odd = createTempDir("tiny docy #1 ");
    library = openTestLibrary(odd.dir, createTestHost(clock));
    populate();
    const partial = join(out.dir, "copy.sqlite.partial");
    await copyLibraryBatched(openBunSqlite, library.path, partial, {
      yieldNow: tick,
    });
    expect(describeFile(partial).counts).toEqual(
      describeFile(library.path).counts,
    );
    library.shutdown();
    odd.cleanUp();
    library = openTestLibrary(temp.dir, createTestHost(clock));
  });
});

describe("a daily copy restores as a working library", () => {
  test("every document and the list come back identical", async () => {
    const ids = populate();
    clock.advance(60_000);
    const result = await library.runIdleJobs();
    expect(result.dailyCopy).not.toBeNull();
    const copyPath = join(temp.dir, "daily", result.dailyCopy ?? "");
    copyFileSync(copyPath, join(out.dir, LIBRARY_FILE));
    const sidebar = library.sidebar();
    const restored = openTestLibrary(out.dir, createTestHost(clock));
    try {
      expect(restored.status.formatVersion).toBe(library.status.formatVersion);
      expect(restored.sidebar()).toEqual(sidebar);
      for (const id of ids) {
        const hash = (lib: Library) => {
          const doc = new Y.Doc();
          Y.applyUpdate(doc, lib.stateOf(id));
          return `${doc.getText("t").toString()}|${Y.encodeStateVector(doc).join(",")}`;
        };
        expect(hash(restored)).toBe(hash(library));
      }
      // AUTOINCREMENT survived: the copy never reuses a seq.
      const next = (() => {
        restored.load(ids[1] ?? "", "w9");
        const doc = new Y.Doc();
        doc.getText("t").insert(0, "after restore");
        return restored.append(ids[1] ?? "", "w9", {
          origin: "local",
          update: Y.encodeStateAsUpdate(doc),
        });
      })();
      expect(next).toBeGreaterThan(library.load(ids[1] ?? "", "w1").maxSeq);
    } finally {
      restored.shutdown();
    }
    expect(existsSync(`${copyPath}.partial`)).toBe(false);
  });
});

// P2.1's DocStore contract on libraries that are daily copies of others.
defineDocStoreContract(
  { describe, it },
  "DocStore contract on a restored daily copy (bun:sqlite)",
  {
    exclusiveOpen: true,
    async createLibrary() {
      const source = createTempDir();
      const target = createTempDir();
      const host = createTestHost(createClock());
      const original = openTestLibrary(source.dir, host);
      original.createDoc({ title: "seed" });
      const name = await original.takeDailyCopyNow();
      original.shutdown();
      copyFileSync(
        join(source.dir, "daily", name ?? ""),
        join(target.dir, LIBRARY_FILE),
      );
      const copy = openTestLibrary(target.dir, host);
      let clients = 0;
      return {
        connect: () => createEngineDocStore(copy, `client-${++clients}`),
        async createDoc(docId, schema) {
          copy.createDoc({ id: docId, schema });
        },
        async dispose() {
          copy.shutdown();
          source.cleanUp();
          target.cleanUp();
        },
      };
    },
  },
);

test("batches are bounded by bytes, so a stop never waits on a big batch", async () => {
  populate();
  const partial = join(out.dir, "bytes.sqlite.partial");
  const rowBound = await copyLibraryBatched(
    openBunSqlite,
    library.path,
    partial,
    {
      yieldNow: tick,
    },
  );
  const partial2 = join(out.dir, "bytes2.sqlite.partial");
  const byteBound = await copyLibraryBatched(
    openBunSqlite,
    library.path,
    partial2,
    {
      batchBytes: 1,
      yieldNow: tick,
    },
  );
  // One row per batch when every row is over the budget.
  expect(byteBound.batches).toBeGreaterThan(rowBound.batches);
  expect(byteBound.rows).toBe(rowBound.rows);
  expect(describeFile(partial2).counts).toEqual(describeFile(partial).counts);
});
