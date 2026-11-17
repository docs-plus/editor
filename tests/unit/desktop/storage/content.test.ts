import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import * as Y from "yjs";

import { StorageError } from "@/desktop/storage/engine/errors";
import type { Library } from "@/desktop/storage/engine/library";
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
let library: Library;
let docId: string;

beforeEach(() => {
  temp = createTempDir();
  clock = createClock();
  library = openTestLibrary(temp.dir, createTestHost(clock));
  docId = library.createDoc({ title: "Untitled" }).id;
});
afterEach(() => {
  library.shutdown();
  temp.cleanUp();
});

function edit(doc: Y.Doc, text: string): Uint8Array {
  let update: Uint8Array = new Uint8Array();
  const capture = (u: Uint8Array) => {
    update = u;
  };
  doc.once("update", capture);
  doc.getText("t").insert(doc.getText("t").length, text);
  return update;
}

function textOf(loaded: {
  snapshot: Uint8Array | null;
  updates: Uint8Array[];
}) {
  const doc = new Y.Doc();
  if (loaded.snapshot) Y.applyUpdate(doc, loaded.snapshot);
  for (const update of loaded.updates) Y.applyUpdate(doc, update);
  return doc.getText("t").toString();
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

describe("load and append", () => {
  test("a new document loads empty at schema 0", () => {
    expect(library.load(docId, "w1")).toEqual({
      snapshot: null,
      updates: [],
      maxSeq: 0,
      schema: 0,
    });
  });

  test("appends come back in order with increasing seqs", () => {
    const doc = new Y.Doc();
    library.load(docId, "w1");
    const a = library.append(docId, "w1", {
      origin: "local",
      update: edit(doc, "a"),
    });
    const b = library.append(docId, "w1", {
      origin: "local",
      update: edit(doc, "b"),
    });
    expect(b).toBeGreaterThan(a);
    const loaded = library.load(docId, "w1");
    expect(loaded.updates).toHaveLength(2);
    expect(loaded.maxSeq).toBe(b);
    expect(textOf(loaded)).toBe("ab");
  });

  test("seqs are global across documents", () => {
    const other = library.createDoc().id;
    const doc = new Y.Doc();
    const a = library.append(docId, "w1", {
      origin: "local",
      update: edit(doc, "a"),
    });
    const b = library.append(other, "w2", {
      origin: "local",
      update: edit(doc, "b"),
    });
    expect(b).toBe(a + 1);
  });

  test("an append updates the title, snippet, schema, size and modified time", () => {
    clock.advance(5000);
    const update = edit(new Y.Doc(), "hello");
    library.append(docId, "w1", {
      origin: "migration",
      update,
      title: "Hello",
      snippet: "hello world",
      schemaTo: 2,
    });
    const row = library.sidebar().docs[0];
    expect(row?.title).toBe("Hello");
    expect(row?.snippet).toBe("hello world");
    expect(row?.modifiedAt).toBe(clock.now);
    expect(row?.sizeBytes).toBe(update.byteLength);
    expect(library.load(docId, "w1").schema).toBe(2);
  });

  test("an append without a title keeps the old one; titles are capped", () => {
    library.append(docId, "w1", {
      origin: "local",
      update: edit(new Y.Doc(), "x"),
      title: "T".repeat(500),
    });
    library.append(docId, "w1", {
      origin: "local",
      update: edit(new Y.Doc(), "y"),
    });
    expect(library.sidebar().docs[0]?.title).toHaveLength(200);
  });

  test("appending the same bytes twice (a resend) changes nothing", () => {
    const doc = new Y.Doc();
    const update = edit(doc, "once");
    library.append(docId, "w1", { origin: "local", update });
    library.append(docId, "w1", { origin: "local", update });
    expect(textOf(library.load(docId, "w1"))).toBe("once");
  });

  test("refuses bad input and unknown documents", () => {
    const update = edit(new Y.Doc(), "x");
    expect(
      codeOf(() =>
        library.append(docId, "w1", { origin: "bogus" as "local", update }),
      ),
    ).toBe("invalid_argument");
    expect(
      codeOf(() =>
        library.append(docId, "w1", {
          origin: "local",
          update: new Uint8Array(),
        }),
      ),
    ).toBe("invalid_argument");
    expect(
      codeOf(() =>
        library.append(crypto.randomUUID(), "w1", { origin: "local", update }),
      ),
    ).toBe("not_found");
    expect(codeOf(() => library.load(crypto.randomUUID(), "w1"))).toBe(
      "not_found",
    );
  });

  test("a failed append writes nothing", () => {
    const update = edit(new Y.Doc(), "x");
    codeOf(() =>
      library.append(crypto.randomUUID(), "w1", { origin: "local", update }),
    );
    expect(library.stats().pendingRows).toBe(0);
  });
});

describe("compaction (D-A3)", () => {
  test("stores the snapshot and deletes the rows it covers", () => {
    const doc = new Y.Doc();
    library.load(docId, "w1");
    library.append(docId, "w1", { origin: "local", update: edit(doc, "a") });
    const covered = library.append(docId, "w1", {
      origin: "local",
      update: edit(doc, "b"),
    });
    const state = Y.encodeStateAsUpdate(doc);
    const late = library.append(docId, "w1", {
      origin: "local",
      update: edit(doc, "c"),
    });
    expect(library.compact(docId, "w1", state, covered)).toEqual({
      foreign: null,
    });
    const loaded = library.load(docId, "w1");
    expect(loaded.updates).toHaveLength(1);
    expect(loaded.maxSeq).toBe(late);
    expect(textOf(loaded)).toBe("abc");
    expect(library.sidebar().docs[0]?.sizeBytes).toBe(
      state.byteLength + (loaded.updates[0]?.byteLength ?? 0),
    );
  });

  test("maxSeq is the snapshot's when every row is folded in", () => {
    const doc = new Y.Doc();
    const seq = library.append(docId, "w1", {
      origin: "local",
      update: edit(doc, "a"),
    });
    library.compact(docId, "w1", Y.encodeStateAsUpdate(doc), seq);
    expect(library.load(docId, "w1")).toMatchObject({
      updates: [],
      maxSeq: seq,
    });
  });

  test("a seq is never reused after compaction deletes the newest rows", () => {
    const doc = new Y.Doc();
    const seq = library.append(docId, "w1", {
      origin: "local",
      update: edit(doc, "a"),
    });
    library.compact(docId, "w1", Y.encodeStateAsUpdate(doc), seq);
    library.shutdown();
    library = openTestLibrary(temp.dir, createTestHost(clock));
    const next = library.append(docId, "w1", {
      origin: "local",
      update: edit(doc, "b"),
    });
    expect(next).toBeGreaterThan(seq);
    expect(textOf(library.load(docId, "w1"))).toBe("ab");
  });

  test("a stale compaction never moves the snapshot back", () => {
    const doc = new Y.Doc();
    const first = library.append(docId, "w1", {
      origin: "local",
      update: edit(doc, "a"),
    });
    const oldState = Y.encodeStateAsUpdate(doc);
    const second = library.append(docId, "w1", {
      origin: "local",
      update: edit(doc, "b"),
    });
    library.compact(docId, "w1", Y.encodeStateAsUpdate(doc), second);
    library.compact(docId, "w1", oldState, first);
    expect(textOf(library.load(docId, "w1"))).toBe("ab");
  });

  test("refuses an upToSeq past the last assigned seq", () => {
    const doc = new Y.Doc();
    const seq = library.append(docId, "w1", {
      origin: "local",
      update: edit(doc, "a"),
    });
    expect(
      codeOf(() =>
        library.compact(docId, "w1", Y.encodeStateAsUpdate(doc), seq + 1),
      ),
    ).toBe("invalid_argument");
  });

  test("stateOf merges the snapshot and rows", () => {
    const doc = new Y.Doc();
    const seq = library.append(docId, "w1", {
      origin: "local",
      update: edit(doc, "a"),
    });
    library.compact(docId, "w1", Y.encodeStateAsUpdate(doc), seq);
    library.append(docId, "w1", { origin: "local", update: edit(doc, "b") });
    const copy = new Y.Doc();
    Y.applyUpdate(copy, library.stateOf(docId));
    expect(copy.getText("t").toString()).toBe("ab");
  });
});

describe("one window per document (registry)", () => {
  test("a second window gets already_open; the first keeps working", () => {
    library.load(docId, "w1");
    expect(codeOf(() => library.load(docId, "w2"))).toBe("already_open");
    expect(library.load(docId, "w1").schema).toBe(0);
  });

  test("another window can't append or compact an open document", () => {
    library.load(docId, "w1");
    const update = edit(new Y.Doc(), "x");
    expect(
      codeOf(() => library.append(docId, "w2", { origin: "local", update })),
    ).toBe("forbidden");
    expect(codeOf(() => library.compact(docId, "w2", update, 0))).toBe(
      "forbidden",
    );
  });

  test("close and a closed window release the document", () => {
    library.load(docId, "w1");
    library.close(docId, "w1");
    expect(library.load(docId, "w2").schema).toBe(0);
    library.releaseOwner("w2");
    expect(library.isOpen(docId)).toBe(false);
  });

  test("closing from another window does nothing", () => {
    library.load(docId, "w1");
    library.close(docId, "w2");
    expect(library.isOpen(docId)).toBe(true);
  });

  test("main's content writes refuse an open document", () => {
    library.load(docId, "w1");
    expect(codeOf(() => library.purgeDoc(docId))).toBe("document_open");
    library.close(docId, "w1");
    library.purgeDoc(docId);
    expect(library.sidebar().docs).toEqual([]);
  });
});

describe("compaction property (architecture §11)", () => {
  // A seeded PRNG keeps failures reproducible.
  function mulberry32(seed: number) {
    let a = seed;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  for (const seed of [1, 2, 3, 4, 5]) {
    test(`random appends, compactions, crashes and reopens (seed ${seed})`, () => {
      const random = mulberry32(seed);
      const reference = new Y.Doc();
      // The renderer's copy: rebuilt from storage on every reopen.
      let session = new Y.Doc();
      let ackedSeq = 0;
      const hydrate = () => {
        const loaded = library.load(docId, "w1");
        session = new Y.Doc();
        if (loaded.snapshot) Y.applyUpdate(session, loaded.snapshot);
        for (const u of loaded.updates) Y.applyUpdate(session, u);
        ackedSeq = loaded.maxSeq;
      };
      hydrate();
      for (let step = 0; step < 300; step += 1) {
        const roll = random();
        if (roll < 0.7) {
          const text = session.getText("t");
          const pos = Math.floor(random() * (text.length + 1));
          let update: Uint8Array = new Uint8Array();
          session.once("update", (u: Uint8Array) => {
            update = u;
          });
          if (text.length > 0 && random() < 0.25)
            text.delete(Math.min(pos, text.length - 1), 1);
          else
            text.insert(
              pos,
              String.fromCharCode(97 + Math.floor(random() * 26)),
            );
          Y.applyUpdate(reference, update);
          ackedSeq = library.append(docId, "w1", { origin: "local", update });
        } else if (roll < 0.85) {
          library.compact(
            docId,
            "w1",
            Y.encodeStateAsUpdate(session),
            ackedSeq,
          );
        } else if (roll < 0.95) {
          library.close(docId, "w1");
          library.shutdown();
          library = openTestLibrary(temp.dir, createTestHost(clock));
          hydrate();
        } else {
          crash(library);
          library = openTestLibrary(temp.dir, createTestHost(clock));
          hydrate();
        }
        if (step % 25 === 0 || roll >= 0.85) {
          const stored = library.load(docId, "w1");
          const rebuilt = new Y.Doc();
          if (stored.snapshot) Y.applyUpdate(rebuilt, stored.snapshot);
          for (const u of stored.updates) Y.applyUpdate(rebuilt, u);
          expect(rebuilt.getText("t").toString()).toBe(
            reference.getText("t").toString(),
          );
          expect(Y.encodeStateVector(rebuilt)).toEqual(
            Y.encodeStateVector(reference),
          );
        }
      }
    });
  }
});
