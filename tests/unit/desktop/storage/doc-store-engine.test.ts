import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import * as Y from "yjs";

import { IDLE_MS, type Library } from "@/desktop/storage/engine/library";
import { TRASH_RETENTION_MS } from "@/desktop/storage/engine/library-index";
import { dispatch } from "@/desktop/storage/protocol";
import {
  createClock,
  createTempDir,
  createTestHost,
  openTestLibrary,
} from "@/tests/helpers/storage-library";

let temp: ReturnType<typeof createTempDir>;
let library: Library;

beforeEach(() => {
  temp = createTempDir();
  library = openTestLibrary(temp.dir, createTestHost(createClock()));
});
afterEach(() => {
  library.shutdown();
  temp.cleanUp();
});

describe("dispatch", () => {
  test("a failure comes back as an envelope, never a throw", async () => {
    expect(
      dispatch(library, {
        id: 2,
        op: "load",
        args: { docId: "nope", owner: "w1" },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "not_found", retryable: false },
    });
  });
});

describe("the index change feed", () => {
  test("an append that changes the title moves rev and names the document", async () => {
    const { id } = library.createDoc();
    library.load(id, "w1");
    library.takeIndexChanges();
    const before = library.sidebar().rev;
    const doc = new Y.Doc();
    doc.getText("t").insert(0, "x");
    library.append(id, "w1", {
      origin: "local",
      update: Y.encodeStateAsUpdate(doc),
      title: "New title",
    });
    expect(library.takeIndexChanges()).toEqual({
      rev: before + 1,
      changes: [{ kind: "doc", id }],
    });
    expect(library.takeIndexChanges()).toBeNull();
  });

  test("index writes report each changed row once", async () => {
    const folder = library.createFolder({ name: "A" });
    const { id } = library.createDoc({ folderId: folder.id });
    library.renameDoc(id, "x");
    library.moveDoc(id, null, "a");
    const tag = library.createTag("t");
    expect(library.takeIndexChanges()?.changes).toEqual([
      { kind: "folder", id: folder.id },
      { kind: "doc", id },
      { kind: "tag", id: tag.id },
    ]);
  });

  test("the idle Trash purge is announced", async () => {
    const clock = createClock();
    library.shutdown();
    library = openTestLibrary(temp.dir, createTestHost(clock));
    const { id } = library.createDoc();
    library.trashDoc(id);
    library.takeIndexChanges();
    clock.advance(TRASH_RETENTION_MS + IDLE_MS);
    expect((await library.runIdleJobs()).purged).toBe(1);
    expect(library.takeIndexChanges()?.changes).toEqual([{ kind: "doc", id }]);
  });
});
