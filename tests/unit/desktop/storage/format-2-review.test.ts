/** Cases from the durability review of #170. */

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";

import * as Y from "yjs";

import { openBunSqlite } from "@/desktop/dev/bun-sqlite-driver";
import { isDeleteOnly } from "@/desktop/storage/engine/content";
import type { OpenSqlite } from "@/desktop/storage/engine/driver";
import { StorageError } from "@/desktop/storage/engine/errors";
import { FORMAT_2_STEP } from "@/desktop/storage/engine/format-2";
import {
  IDLE_MS,
  LIBRARY_FILE,
  type Library,
} from "@/desktop/storage/engine/library";
import { TRASH_RETENTION_MS } from "@/desktop/storage/engine/library-index";
import type {
  FormatStep,
  StepContext,
} from "@/desktop/storage/engine/migrations";
import { writeFormat1Library } from "@/tests/helpers/format-1-library";
import {
  createClock,
  createTempDir,
  createTestHost,
  mustFolder,
  openTestLibrary,
  type TestClock,
} from "@/tests/helpers/storage-library";

let temp: ReturnType<typeof createTempDir>;
let clock: TestClock;
const opened: Library[] = [];

beforeEach(() => {
  temp = createTempDir();
  clock = createClock();
});
afterEach(() => {
  for (const library of opened.splice(0)) library.shutdown();
  temp.cleanUp();
});

function openLib(options = {}) {
  const library = openTestLibrary(temp.dir, createTestHost(clock), options);
  opened.push(library);
  return library;
}

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof StorageError) return error.code;
    throw error;
  }
  return undefined;
}

function updateOf(doc: Y.Doc, change: () => void): Uint8Array {
  let update: Uint8Array = new Uint8Array();
  doc.once("update", (u: Uint8Array) => {
    update = u;
  });
  change();
  return update;
}

describe("isDeleteOnly", () => {
  const doc = new Y.Doc();
  const first = updateOf(doc, () => doc.getText("t").insert(0, "hello world"));
  const insert = updateOf(doc, () => doc.getText("t").insert(0, ">"));
  const deletion = updateOf(doc, () => doc.getText("t").delete(0, 3));
  const mixed = updateOf(doc, () =>
    doc.transact(() => {
      doc.getText("t").delete(0, 1);
      doc.getText("t").insert(0, "x");
    }),
  );

  test("a deletion is delete-only; inserts and mixed edits aren't", () => {
    expect(isDeleteOnly(deletion)).toBe(true);
    expect(isDeleteOnly(first)).toBe(false);
    expect(isDeleteOnly(insert)).toBe(false); // starts above clock 0
    expect(isDeleteOnly(mixed)).toBe(false);
  });

  test("a GC-only state still adds clocks; a diff with nothing new is delete-only", () => {
    const gc = new Y.Doc();
    gc.getText("t").insert(0, "gone");
    gc.getText("t").delete(0, 4);
    expect(isDeleteOnly(Y.encodeStateAsUpdate(gc))).toBe(false);
    const nothingNew = Y.diffUpdate(
      Y.encodeStateAsUpdate(doc),
      Y.encodeStateVector(doc),
    );
    expect(isDeleteOnly(nothingNew)).toBe(true);
  });

  test("a malformed update is invalid_argument", () => {
    expect(codeOf(() => isDeleteOnly(new Uint8Array([255, 255, 255, 1])))).toBe(
      "invalid_argument",
    );
  });
});

test("I10 counts a client whose structs start above clock 0", () => {
  const library = openLib();
  const { id } = library.createDoc();
  library.load(id, "w");
  const doc = new Y.Doc();
  doc.getText("t").insert(0, "never stored"); // clocks 0..11 stay local
  const later = updateOf(doc, () => doc.getText("t").insert(0, "stored"));
  const seq = library.append(id, "w", { origin: "local", update: later });
  const unrelated = new Y.Doc();
  unrelated.getText("t").insert(0, "other");
  expect(
    codeOf(() =>
      library.compact(id, "w", Y.encodeStateAsUpdate(unrelated), seq),
    ),
  ).toBe("invalid_argument");
  expect(() =>
    library.compact(id, "w", Y.encodeStateAsUpdate(doc), seq),
  ).not.toThrow();
});

test("a backup restored over a purged id revives its image rows (I11)", () => {
  const library = openLib();
  const { id } = library.createDoc();
  const db = new Database(library.path);
  const hash = "a".repeat(64);
  db.prepare(
    "INSERT INTO blobs (hash, mime, size, created_at, origin) VALUES (?, 'image/png', 1, 0, 'insert')",
  ).run(hash);
  db.prepare(
    "INSERT INTO doc_blobs (doc_id, hash, kind) VALUES (?, ?, 'current')",
  ).run(id, hash);
  db.close();
  library.trashDoc(id);
  library.purgeDoc(id);
  const doc = new Y.Doc();
  doc.getText("t").insert(0, "back");
  library.restoreDocFromBackup(
    {
      id,
      title: "back",
      kind: "doc",
      schema: 0,
      lineage: crypto.randomUUID(),
      linkKey: "e".repeat(32),
      folderId: null,
    },
    Y.encodeStateAsUpdate(doc),
  );
  const check = new Database(library.path, { readonly: true });
  expect(
    check.query("SELECT dropped_at FROM doc_blobs WHERE doc_id = ?").get(id),
  ).toEqual({ dropped_at: null });
  check.close();
});

test("a backup state that doesn't apply is refused", () => {
  const library = openLib();
  expect(
    codeOf(() =>
      library.restoreDocFromBackup(
        {
          id: crypto.randomUUID(),
          title: "x",
          kind: "doc",
          schema: 0,
          lineage: crypto.randomUUID(),
          linkKey: "f".repeat(32),
          folderId: null,
        },
        new Uint8Array([255, 1, 2, 3]),
      ),
    ),
  ).toBe("invalid_argument");
});

test("a folder trashed in format 1 gets a group and is purged after 30 days", async () => {
  writeFormat1Library(temp.dir, { docs: 4, folders: 2 });
  const raw = new Database(join(temp.dir, LIBRARY_FILE));
  raw.exec("UPDATE folders SET trashed_at = 1 WHERE parent_id IS NOT NULL");
  raw.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  raw.close();
  const library = openLib();
  expect(library.status.formatVersion).toBe(2);
  const before = library.trashList().items.filter((i) => i.kind === "folder");
  expect(before).toHaveLength(1);
  clock.advance(TRASH_RETENTION_MS + IDLE_MS);
  await library.runIdleJobs();
  expect(library.trashList().items.filter((i) => i.kind === "folder")).toEqual(
    [],
  );
});

test("a step that throws midway rolls back, restores foreign keys, and retries on reopen", () => {
  writeFormat1Library(temp.dir, { docs: 6 });
  const failing = openLib({
    formatSteps: [
      {
        ...FORMAT_2_STEP,
        up(db: Parameters<FormatStep["up"]>[0], context: StepContext) {
          FORMAT_2_STEP.up(db, context);
          throw new Error("boom after the rebuild");
        },
      },
    ],
  });
  expect(failing.status).toMatchObject({
    readOnly: "migration_failed",
    formatVersion: 1,
  });
  expect(failing.stats().pragmas.foreignKeys).toBe(1);
  failing.shutdown();
  opened.length = 0;
  const raw = new Database(join(temp.dir, LIBRARY_FILE), { readonly: true });
  expect(
    raw
      .query("SELECT 1 FROM sqlite_master WHERE name IN ('links', 'docs_v2')")
      .get(),
  ).toBeNull();
  raw.close();
  const library = openLib();
  expect(library.status).toMatchObject({ formatVersion: 2, readOnly: null });
});

describe("the engine's own statements use their indexes (§3.5)", () => {
  /** A driver that records every SQL string the engine prepares. */
  function recording(seen: Set<string>): OpenSqlite {
    return (path, options) => {
      const driver = openBunSqlite(path, options);
      return {
        ...driver,
        prepare(sql) {
          seen.add(sql);
          return driver.prepare(sql);
        },
      };
    };
  }

  test("each named index serves a statement the engine runs", async () => {
    const seen = new Set<string>();
    const library = openLib({ openSqlite: recording(seen) });
    const folder = mustFolder(library, { name: "f" });
    const { id, linkKey } = library.createDoc({ folderId: folder.id });
    library.trashFolder(folder.id);
    library.restoreFolder(folder.id);
    library.searchTitles("a");
    library.searchHeadings("a");
    library.backlinks(linkKey);
    library.nextStale();
    clock.advance(TRASH_RETENTION_MS + IDLE_MS);
    await library.runIdleJobs();
    void id;
    const db = new Database(library.path, { readonly: true });
    const plans = [...seen]
      .filter((sql) => /^\s*(SELECT|UPDATE|DELETE)/i.test(sql))
      .map((sql) => {
        // Plan with text and with numeric parameters: the type changes
        // which index a comparison can use.
        return ["x", 0]
          .map((value) => {
            try {
              const params = (sql.match(/\?/g) ?? []).map(() => value);
              return (
                db.query(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as {
                  detail: string;
                }[]
              )
                .map((row) => row.detail)
                .join(" | ");
            } catch {
              return "";
            }
          })
          .join(" || ");
      })
      .join("\n");
    db.close();
    for (const index of [
      "docs_trashed",
      "docs_trash_group",
      "folders_trash_group",
      "docs_stale",
      "docs_title_key",
      "doc_headings_text",
      "links_target",
    ])
      expect(`${index}: ${plans.includes(index)}`).toBe(`${index}: true`);
  });
});
