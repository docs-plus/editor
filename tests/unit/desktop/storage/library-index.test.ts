import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";

import * as Y from "yjs";

import { StorageError } from "@/desktop/storage/engine/errors";
import {
  IDLE_MS,
  LIBRARY_FILE,
  type Library,
} from "@/desktop/storage/engine/library";
import { TRASH_RETENTION_MS } from "@/desktop/storage/engine/library-index";
import {
  createClock,
  createTempDir,
  createTestHost,
  openTestLibrary,
  type TestClock,
} from "@/tests/helpers/storage-library";

let temp: ReturnType<typeof createTempDir>;
let clock: TestClock;
let library: Library;

beforeEach(() => {
  temp = createTempDir();
  clock = createClock();
  library = openTestLibrary(temp.dir, createTestHost(clock));
});
afterEach(() => {
  library.shutdown();
  temp.cleanUp();
});

function codeOf(run: () => unknown) {
  try {
    run();
  } catch (error) {
    if (error instanceof StorageError) return error.code;
    throw error;
  }
  return undefined;
}

describe("creating documents", () => {
  test("mints a UUID, a lineage and a 32-hex link key at insert", () => {
    const a = library.createDoc();
    const b = library.createDoc();
    expect(a.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.lineage).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.linkKey).toMatch(/^[0-9a-f]{32}$/);
    expect(a.lineage).not.toBe(b.lineage);
    expect(a.linkKey).not.toBe(b.linkKey);
  });

  test("keeps a lineage and link key only when given (backup restore)", () => {
    const lineage = crypto.randomUUID();
    const linkKey = "a".repeat(32);
    expect(library.createDoc({ lineage, linkKey })).toMatchObject({
      lineage,
      linkKey,
    });
    expect(codeOf(() => library.createDoc({ linkKey }))).toBe(
      "invalid_argument",
    );
  });

  test("refuses malformed ids, link keys and kinds", () => {
    expect(codeOf(() => library.createDoc({ id: "../x" }))).toBe(
      "invalid_argument",
    );
    expect(codeOf(() => library.createDoc({ linkKey: "XYZ" }))).toBe(
      "invalid_argument",
    );
    expect(codeOf(() => library.createDoc({ kind: "page" as "doc" }))).toBe(
      "invalid_argument",
    );
  });

  test("templates are stored with kind 'template'", () => {
    library.createDoc({ kind: "template", title: "Weekly" });
    expect(library.sidebar().docs[0]?.kind).toBe("template");
  });
});

describe("the sidebar snapshot", () => {
  test("lists live folders, documents and tags; rev moves on every write", () => {
    const start = library.sidebar().rev;
    const folder = library.createFolder({ name: "Work" });
    const doc = library.createDoc({ title: "Plan", folderId: folder.id });
    const tag = library.createTag("urgent", "red");
    library.setDocTags(doc.id, [tag.id]);
    const snapshot = library.sidebar();
    expect(snapshot.rev).toBe(start + 4);
    expect(snapshot.folders.map((f) => f.name)).toEqual(["Work"]);
    expect(snapshot.docs[0]).toMatchObject({
      id: doc.id,
      title: "Plan",
      folderId: folder.id,
      tagIds: [tag.id],
      pinned: false,
      kind: "doc",
    });
    expect(snapshot.tags).toEqual([
      { id: tag.id, name: "urgent", color: "red" },
    ]);
  });

  test("tag names are unique regardless of case", () => {
    library.createTag("Urgent");
    expect(codeOf(() => library.createTag("urgent"))).toBe("invalid_argument");
  });

  test("opening a document records opened_at", () => {
    const doc = library.createDoc();
    clock.advance(1000);
    library.load(doc.id, "w1");
    expect(library.sidebar().docs[0]?.openedAt).toBe(clock.now);
  });

  test("rename and move", () => {
    const folder = library.createFolder({ name: "A" });
    const doc = library.createDoc({ title: "x" });
    library.renameDoc(doc.id, "  Renamed  ");
    library.moveDoc(doc.id, folder.id, "m");
    expect(library.sidebar().docs[0]).toMatchObject({
      title: "Renamed",
      folderId: folder.id,
      sortKey: "m",
    });
    expect(codeOf(() => library.renameDoc(crypto.randomUUID(), "y"))).toBe(
      "not_found",
    );
  });
});

describe("Trash and purge", () => {
  test("trash hides a document and restore brings it back to its folder", () => {
    const folder = library.createFolder({ name: "A" });
    const doc = library.createDoc({ folderId: folder.id });
    library.trashDoc(doc.id);
    expect(library.sidebar().docs).toEqual([]);
    library.restoreDoc(doc.id);
    expect(library.sidebar().docs[0]?.folderId).toBe(folder.id);
  });

  test("purge cascades to rows, snapshot, tags, view and import source", () => {
    const doc = library.createDoc();
    const tag = library.createTag("t");
    library.setDocTags(doc.id, [tag.id]);
    const ydoc = new Y.Doc();
    ydoc.getText("t").insert(0, "x");
    const update = Y.encodeStateAsUpdate(ydoc);
    library.load(doc.id, "w1");
    const seq = library.append(doc.id, "w1", { origin: "local", update });
    library.compact(doc.id, "w1", update, seq);
    library.append(doc.id, "w1", { origin: "local", update });
    library.shutdown();
    const raw = new Database(join(temp.dir, LIBRARY_FILE));
    raw.exec("PRAGMA foreign_keys = ON");
    raw
      .prepare("INSERT INTO doc_view (doc_id, width) VALUES (?, 'wide')")
      .run(doc.id);
    raw
      .prepare(
        "INSERT INTO import_sources (doc_id, source_hash) VALUES (?, 'h')",
      )
      .run(doc.id);
    raw.close();
    library = openTestLibrary(temp.dir, createTestHost(clock));
    library.purgeDoc(doc.id);
    library.shutdown();
    const check = new Database(join(temp.dir, LIBRARY_FILE));
    for (const table of [
      "updates",
      "snapshots",
      "doc_tags",
      "doc_view",
      "import_sources",
    ]) {
      const row = check.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as {
        n: number;
      };
      expect(`${table}=${row.n}`).toBe(`${table}=0`);
    }
    check.close();
    library = openTestLibrary(temp.dir, createTestHost(clock));
  });

  test("idle jobs empty Trash after 30 days, skipping open documents", () => {
    const old = library.createDoc();
    const open = library.createDoc();
    const recent = library.createDoc();
    library.trashDoc(old.id);
    library.trashDoc(open.id);
    clock.advance(TRASH_RETENTION_MS - 1000);
    library.trashDoc(recent.id);
    library.load(open.id, "w1");
    clock.advance(IDLE_MS + 1000);
    expect(library.runIdleJobs().purged).toBe(1);
    expect(library.stats().docs).toBe(2);
  });
});

describe("ids and schema at creation", () => {
  test("accepts any safe id and stores the given schema", () => {
    const { id } = library.createDoc({ id: "doc-a_1", schema: 3 });
    expect(library.load(id, "w1").schema).toBe(3);
  });

  test("refuses ids that aren't safe in SQL, paths or logs", () => {
    for (const id of ["", "../x", "a b", "a/b", "-x", "x".repeat(65)])
      expect(codeOf(() => library.createDoc({ id }))).toBe("invalid_argument");
    expect(codeOf(() => library.createDoc({ schema: -1 }))).toBe(
      "invalid_argument",
    );
  });
});
