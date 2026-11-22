import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import * as Y from "yjs";

import { DOC_CAP_BYTES } from "@/desktop/storage/engine/content";
import type { DerivedRows } from "@/desktop/storage/engine/derive";
import { StorageError } from "@/desktop/storage/engine/errors";
import { MAX_FOLDER_DEPTH } from "@/desktop/storage/engine/format-2";
import type { Library } from "@/desktop/storage/engine/library";
import { MAX_FOLDER_DEPTH as LIBRARY_DEPTH } from "@/lib/library/folder-rules";
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

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof StorageError) return error.code;
    throw error;
  }
  return undefined;
}

function write(docId: string, text: string, owner = "w1") {
  if (!library.isOpen(docId)) library.load(docId, owner);
  const doc = new Y.Doc();
  doc.getText("t").insert(0, text);
  return library.append(docId, owner, {
    origin: "local",
    update: Y.encodeStateAsUpdate(doc),
  });
}

function row(sql: string, ...params: (string | number)[]) {
  const db = (
    library as unknown as {
      db: {
        prepare(s: string): {
          get(...p: unknown[]): unknown;
          all(...p: unknown[]): unknown[];
        };
      };
    }
  ).db;
  return {
    get: () => db.prepare(sql).get(...params),
    all: () => db.prepare(sql).all(...params),
  };
}

describe("folders (§4.2)", () => {
  test("the engine's depth limit is the library's", () => {
    expect(MAX_FOLDER_DEPTH).toBe(LIBRARY_DEPTH);
  });

  test("refuses a fifth level", () => {
    let parent: string | null = null;
    for (let level = 1; level <= MAX_FOLDER_DEPTH; level += 1)
      parent = mustFolder(library, { name: `L${level}`, parentId: parent }).id;
    expect(
      library.createFolder({ name: "too deep", parentId: parent }),
    ).toBeNull();
  });

  test("a move refuses a folder into itself and one that nests too deep", () => {
    const a = mustFolder(library, { name: "a" });
    const b = mustFolder(library, { name: "b", parentId: a.id });
    expect(library.moveItems([{ kind: "folder", id: a.id }], b.id)).toEqual({
      ok: false,
      reason: "into_itself",
    });
    const c = mustFolder(library, { name: "c", parentId: b.id });
    const d = mustFolder(library, { name: "d" });
    const e = mustFolder(library, { name: "e", parentId: d.id });
    void c;
    // a (3 levels) under e (depth 2) would make 5.
    expect(library.moveItems([{ kind: "folder", id: a.id }], e.id)).toEqual({
      ok: false,
      reason: "too_deep",
    });
  });

  test("trash takes the subtree under one group; restore brings back exactly that group", () => {
    const a = mustFolder(library, { name: "a" });
    const b = mustFolder(library, { name: "b", parentId: a.id });
    const inA = library.createDoc({ folderId: a.id });
    const inB = library.createDoc({ folderId: b.id });
    const alone = library.createDoc({ folderId: b.id });
    library.trashDoc(alone.id);
    const trashed = library.trashFolder(a.id);
    expect(trashed.docCount).toBe(2);
    expect(library.sidebar().folders).toEqual([]);
    expect(
      library
        .trashList()
        .items.map((i) => i.id)
        .sort(),
    ).toEqual([a.id, alone.id].sort());
    expect(library.restoreFolder(a.id).result).toBe("restored");
    const docs = library.sidebar().docs.map((d) => [d.id, d.folderId]);
    expect(docs).toContainEqual([inA.id, a.id]);
    expect(docs).toContainEqual([inB.id, b.id]);
    expect(docs.some(([id]) => id === alone.id)).toBe(false);
  });

  test("restore falls back to the root when the parent is in the Trash or gone", () => {
    const parent = mustFolder(library, { name: "p" });
    const child = mustFolder(library, { name: "c", parentId: parent.id });
    library.trashFolder(child.id);
    library.trashFolder(parent.id);
    expect(library.restoreFolder(child.id).result).toBe("restored_to_root");
    library.trashFolder(child.id);
    library.purgeFolder(parent.id);
    // The purge set trashed_from to NULL (ON DELETE SET NULL): the root.
    library.restoreFolder(child.id);
    expect(library.sidebar().folders).toEqual([
      expect.objectContaining({ id: child.id, parentId: null }),
    ]);
  });

  test("RESTRICT trap: a doc trashed alone never blocks purging its old folder", () => {
    const folder = mustFolder(library, { name: "f" });
    const sub = mustFolder(library, { name: "s", parentId: folder.id });
    const doc = library.createDoc({ folderId: folder.id });
    library.trashDoc(doc.id);
    library.trashFolder(sub.id);
    library.trashFolder(folder.id);
    expect(() => library.purgeFolder(folder.id)).not.toThrow();
    // The doc trashed alone survives, pointing nowhere; restore goes to the root.
    expect(library.restoreDoc(doc.id).folderId).toBeNull();
    expect(() => library.purgeFolder(sub.id)).not.toThrow();
  });

  test("purgeFolder refuses while a document in it is open, and marks its images dropped", () => {
    const folder = mustFolder(library, { name: "f" });
    const doc = library.createDoc({ folderId: folder.id });
    write(doc.id, "x");
    library.trashFolder(folder.id);
    expect(codeOf(() => library.purgeFolder(folder.id))).toBe("document_open");
    library.close(doc.id, "w1");
    library.purgeFolder(folder.id);
    expect(library.stats().docs).toBe(0);
  });
});

describe("tags (§4.2)", () => {
  test("rename refuses a name another tag has, by tagNameKey", () => {
    const a = mustTag(library, "Alpha");
    const b = mustTag(library, "Beta");
    expect(library.renameTag(b.id, "ALPHA")).toEqual({
      ok: false,
      reason: "exists",
      tagId: a.id,
    });
    expect(library.renameTag(b.id, "  ")).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(library.renameTag(b.id, "Bêta")).toMatchObject({ ok: true });
  });

  test("merge keeps one row for documents that had both", () => {
    const a = mustTag(library, "a");
    const b = mustTag(library, "b");
    const both = library.createDoc();
    const onlyA = library.createDoc();
    library.addTag(both.id, a.id);
    library.addTag(both.id, b.id);
    library.addTag(onlyA.id, a.id);
    expect(library.mergeTags(a.id, b.id)).not.toBe(false);
    const tagged = library.sidebar().docs.map((d) => [d.id, d.tagIds]);
    expect(tagged).toContainEqual([both.id, [b.id]]);
    expect(tagged).toContainEqual([onlyA.id, [b.id]]);
    expect(library.mergeTags(a.id, b.id)).toBe(false);
  });

  test("a document takes at most 20 tags", () => {
    const doc = library.createDoc();
    for (let i = 0; i < 20; i += 1)
      expect(library.addTag(doc.id, mustTag(library, `t${i}`).id)).not.toBe(
        false,
      );
    expect(library.addTag(doc.id, mustTag(library, "t20").id)).toBe(false);
  });
});

describe("one title writer (G4) and D-O5", () => {
  test("the content's title sets title_key; there is no rename", () => {
    const { id } = library.createDoc();
    library.load(id, "w1");
    const doc = new Y.Doc();
    doc.getText("t").insert(0, "x");
    library.append(id, "w1", {
      origin: "local",
      update: Y.encodeStateAsUpdate(doc),
      title: "Café Notes",
    });
    expect(
      row("SELECT title, title_key FROM docs WHERE id = ?", id).get(),
    ).toEqual({
      title: "Café Notes",
      title_key: "cafe notes",
    });
    expect("renameDoc" in library).toBe(false);
  });

  test("moving and tagging never change modified_at", () => {
    const folder = mustFolder(library, { name: "f" });
    const { id } = library.createDoc();
    const before = library.sidebar().docs[0]?.modifiedAt;
    clock.advance(5000);
    library.moveItems([{ kind: "doc", id }], folder.id);
    library.addTag(id, mustTag(library, "t").id);
    expect(library.sidebar().docs[0]?.modifiedAt).toBe(before);
  });
});

describe("duplicate and backup restore (§4.2, I5)", () => {
  test("duplicate copies content, tags and view, with new identity and no derived rows", () => {
    const { id, linkKey } = library.createDoc({ title: "Source" });
    write(id, "hello");
    library.addTag(id, mustTag(library, "t").id);
    const copy = library.duplicateDoc(id);
    expect(copy.linkKey).not.toBe(linkKey);
    const state = new Y.Doc();
    Y.applyUpdate(state, library.stateOf(copy.id));
    expect(state.getText("t").toString()).toBe("hello");
    expect(
      library.sidebar().docs.find((d) => d.id === copy.id)?.tagIds,
    ).toHaveLength(1);
    expect(
      row(
        "SELECT derived_seq IS NOT head_seq AS stale FROM docs WHERE id = ?",
        copy.id,
      ).get(),
    ).toEqual({ stale: 1 });
  });

  test("a restore keeps identity, and a collision inserts a new row instead", () => {
    const state = (() => {
      const doc = new Y.Doc();
      doc.getText("t").insert(0, "from backup");
      return Y.encodeStateAsUpdate(doc);
    })();
    const backup = {
      id: crypto.randomUUID(),
      title: "Backup",
      kind: "doc" as const,
      schema: 0,
      lineage: crypto.randomUUID(),
      linkKey: "ab".repeat(16),
      folderId: null,
    };
    const first = library.restoreDocFromBackup(backup, state);
    expect(first).toMatchObject({
      id: backup.id,
      linkKey: backup.linkKey,
      duplicateOf: null,
    });
    const again = library.restoreDocFromBackup(backup, state);
    expect(again.duplicateOf).toBe(backup.id);
    expect(again.id).not.toBe(backup.id);
    expect(again.linkKey).not.toBe(backup.linkKey);
  });
});

describe("derive.put (§4.3)", () => {
  const rows = (text = "Intro"): DerivedRows => ({
    links: [
      {
        ord: 0,
        src_toc_id: "",
        target_key: "cd".repeat(16),
        target_toc_id: "",
        text: "see",
        context: "see the other",
      },
    ],
    headings: [{ ord: 0, toc_id: "h1", level: 1, text }],
    title: "Title‮",
    snippet: "snippet",
  });

  test("writes rows at head_seq, strips controls, and then the doc is fresh", () => {
    const { id } = library.createDoc();
    const seq = write(id, "x");
    expect(library.putDerived(id, seq, rows())).toBe("ok");
    expect(library.nextStale()).toBeNull();
    expect(row("SELECT title FROM docs WHERE id = ?", id).get()).toEqual({
      title: "Title",
    });
    expect(library.searchHeadings("intr")).toEqual([
      { docId: id, tocId: "h1", level: 1, text: "Intro" },
    ]);
    expect(library.backlinks("cd".repeat(16))).toHaveLength(1);
  });

  test("a derive from an older state is stale and writes nothing; one from the future is refused", () => {
    const { id } = library.createDoc();
    const first = write(id, "a");
    write(id, "b");
    expect(library.putDerived(id, first, rows())).toBe("stale");
    expect(row("SELECT COUNT(*) AS n FROM links").get()).toEqual({ n: 0 });
    expect(codeOf(() => library.putDerived(id, first + 99, rows()))).toBe(
      "invalid_argument",
    );
  });

  test("an unchanged side isn't rewritten, but derived_seq always advances", () => {
    const { id } = library.createDoc();
    library.putDerived(id, write(id, "a"), rows());
    const seq = write(id, "b");
    library.putDerived(id, seq, rows("Intro"));
    expect(row("SELECT derived_seq FROM docs WHERE id = ?", id).get()).toEqual({
      derived_seq: seq,
    });
  });

  test("refuses bad shapes and too many rows; a purged doc is gone", () => {
    const { id } = library.createDoc();
    const seq = write(id, "a");
    const bad = rows();
    expect(
      codeOf(() =>
        library.putDerived(id, seq, {
          ...bad,
          headings: [{ ord: 0, toc_id: "h", level: 7, text: "x" }],
        }),
      ),
    ).toBe("invalid_argument");
    expect(
      codeOf(() =>
        library.putDerived(id, seq, {
          ...bad,
          links: [
            { ...(bad.links[0] as DerivedRows["links"][0]), target_key: "x" },
          ],
        }),
      ),
    ).toBe("invalid_argument");
    const many = Array.from({ length: 5001 }, (_, ord) => ({
      ord,
      toc_id: `h${ord}`,
      level: 2,
      text: "x",
    }));
    expect(
      codeOf(() => library.putDerived(id, seq, { ...bad, headings: many })),
    ).toBe("invalid_argument");
    library.close(id, "w1");
    library.trashDoc(id);
    library.purgeDoc(id);
    expect(library.putDerived(id, seq, rows())).toBe("gone");
  });
});

describe("content guards", () => {
  test(`the ${DOC_CAP_BYTES / 1048576} MiB cap refuses growth but lets deletions through`, () => {
    const { id } = library.createDoc();
    library.load(id, "w1");
    const doc = new Y.Doc();
    const add = (text: string) => {
      let update: Uint8Array = new Uint8Array();
      doc.once("update", (u: Uint8Array) => {
        update = u;
      });
      doc.getText("t").insert(0, text);
      return update;
    };
    library.append(id, "w1", {
      origin: "local",
      update: add("x".repeat(DOC_CAP_BYTES - 1000)),
    });
    expect(
      codeOf(() =>
        library.append(id, "w1", {
          origin: "local",
          update: add("y".repeat(2000)),
        }),
      ),
    ).toBe("document_too_large");
    let deletion: Uint8Array = new Uint8Array();
    doc.once("update", (u: Uint8Array) => {
      deletion = u;
    });
    doc.getText("t").delete(0, 10);
    expect(
      library.append(id, "w1", { origin: "local", update: deletion }),
    ).toBeGreaterThan(0);
  });

  test("I10: a compaction whose snapshot misses rows it replaces is refused", () => {
    const { id } = library.createDoc();
    const seq = write(id, "kept");
    const other = new Y.Doc();
    other.getText("t").insert(0, "unrelated");
    expect(
      codeOf(() =>
        library.compact(id, "w1", Y.encodeStateAsUpdate(other), seq),
      ),
    ).toBe("invalid_argument");
    expect(() =>
      library.compact(id, "w1", library.stateOf(id), seq),
    ).not.toThrow();
  });

  test("compaction never touches head_seq", () => {
    const { id } = library.createDoc();
    const seq = write(id, "a");
    library.compact(id, "w1", library.stateOf(id), seq);
    expect(row("SELECT head_seq FROM docs WHERE id = ?", id).get()).toEqual({
      head_seq: seq,
    });
  });
});

test("a compaction that leaves the file mostly free pages gives them back (T23)", () => {
  const { id } = library.createDoc();
  library.load(id, "w1");
  const doc = new Y.Doc();
  let last = 0;
  for (let i = 0; i < 200; i += 1) {
    let update: Uint8Array = new Uint8Array();
    doc.once("update", (u: Uint8Array) => {
      update = u;
    });
    doc.getText("t").insert(0, `${i}`.repeat(2000));
    last = library.append(id, "w1", { origin: "local", update });
  }
  doc.getText("t").delete(0, doc.getText("t").length);
  const db = (
    library as unknown as {
      db: { prepare(s: string): { get(): Record<string, number> } };
    }
  ).db;
  expect(db.prepare("PRAGMA auto_vacuum").get()).toEqual({ auto_vacuum: 2 });
  library.compact(id, "w1", library.stateOf(id), last);
  const pages = db.prepare("PRAGMA page_count").get().page_count ?? 0;
  const free = db.prepare("PRAGMA freelist_count").get().freelist_count ?? 0;
  expect(free / pages).toBeLessThanOrEqual(0.25);
});

test("a tag keeps the id its caller minted, unless the name is taken", () => {
  const id = crypto.randomUUID();
  expect(library.createTag("Mint", null, id)).toMatchObject({
    id,
    created: true,
  });
  expect(library.createTag("mint", null, crypto.randomUUID())).toMatchObject({
    id,
    created: false,
  });
  expect(library.createFolder({ name: "f" })).not.toBeNull();
  expect(library.sidebar().folders[0]?.createdAt).toBe(clock.now);
});

test("a new document lists in Recent at once; a duplicate or restore waits to be opened", () => {
  const { id } = library.createDoc({ title: "fresh" });
  write(id, "x");
  const created = library.sidebar().docs.find((d) => d.id === id);
  expect(created?.openedAt).toBe(clock.now);
  library.close(id, "w1");
  const copy = library.duplicateDoc(id);
  expect(
    library.sidebar().docs.find((d) => d.id === copy.id)?.openedAt,
  ).toBeNull();
});
