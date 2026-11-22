/**
 * The condition on D-A6's amendment (derived rows commit at
 * `synchronous=NORMAL`): a power cut may lose the last derive commit while
 * the content append before it, committed FULL, survives. The derived rows
 * and `derived_seq` are lost together, so the document reads as stale and
 * the next derive puts them back.
 *
 * A power cut is simulated on the files. Right after the FULL append the
 * main file and the WAL are what a synced disk holds; the derive then adds
 * frames that were never synced. After a crash the main file is put back
 * and the WAL is cut to the append's end (the derive's commit dropped) or
 * into the derive's first frame (a torn tail). Closing the connection would
 * checkpoint the WAL into the main file, hence the copy taken before it.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  readFileSync,
  rmSync,
  statSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import * as Y from "yjs";

import type { DerivedRows } from "@/desktop/storage/engine/derive";
import { LIBRARY_FILE, type Library } from "@/desktop/storage/engine/library";
import {
  crash,
  createClock,
  createTempDir,
  createTestHost,
  openTestLibrary,
} from "@/tests/helpers/storage-library";

const TARGET = "ab".repeat(16);

let temp: ReturnType<typeof createTempDir>;
const open: Library[] = [];

beforeEach(() => {
  temp = createTempDir();
});
afterEach(() => {
  for (const library of open.splice(0)) library.shutdown();
  temp.cleanUp();
});

function openLibrary(): Library {
  const library = openTestLibrary(temp.dir, createTestHost(createClock()));
  open.push(library);
  return library;
}

const rows: DerivedRows = {
  links: [
    {
      ord: 0,
      src_toc_id: "",
      target_key: TARGET,
      target_toc_id: "",
      text: "see",
      context: "see the other one",
    },
  ],
  headings: [{ ord: 0, toc_id: "h1", level: 1, text: "Intro" }],
  title: "Linked",
  snippet: "snippet",
};

function textOf(library: Library, id: string): string {
  const content = library.load(id, "check");
  const doc = new Y.Doc();
  if (content.snapshot) Y.applyUpdate(doc, content.snapshot);
  for (const update of content.updates) Y.applyUpdate(doc, update);
  library.close(id, "check");
  return doc.getText("t").toString();
}

/**
 * One document with a FULL append and a NORMAL derive after it. Returns the
 * files as they stood after the append, and the WAL's length then.
 */
function appendThenDerive() {
  const path = join(temp.dir, LIBRARY_FILE);
  const library = openLibrary();
  const { id } = library.createDoc({ title: "Linked" });
  library.load(id, "w");
  const doc = new Y.Doc();
  doc.getText("t").insert(0, "kept");
  const seq = library.append(id, "w", {
    origin: "local",
    update: Y.encodeStateAsUpdate(doc),
  });
  library.close(id, "w");
  // What a synced disk holds now: the FULL append is in the WAL.
  const main = readFileSync(path);
  const walEnd = statSync(`${path}-wal`).size;
  expect(walEnd).toBeGreaterThan(0);
  expect(library.putDerived(id, seq, rows)).toBe("ok");
  expect(library.backlinks(TARGET)).toHaveLength(1);
  const wal = readFileSync(`${path}-wal`);
  expect(wal.byteLength).toBeGreaterThan(walEnd);
  crash(library);
  open.splice(open.indexOf(library), 1);
  return { id, seq, path, main, wal, walEnd };
}

/** Puts the "synced" files back, the WAL cut at `walLength`. */
function powerCut(
  files: ReturnType<typeof appendThenDerive>,
  walLength: number,
) {
  writeFileSync(files.path, files.main);
  writeFileSync(`${files.path}-wal`, files.wal);
  truncateSync(`${files.path}-wal`, walLength);
  // A cold start: the WAL index is rebuilt from the WAL itself.
  if (existsSync(`${files.path}-shm`)) rmSync(`${files.path}-shm`);
}

describe("a power cut after a NORMAL derive commit (D-A6 amendment)", () => {
  const cuts: [
    string,
    (files: ReturnType<typeof appendThenDerive>) => number,
  ][] = [
    ["the derive's commit is dropped", (files) => files.walEnd],
    // 32-byte WAL header, then frames of a 24-byte header and one page.
    [
      "the WAL tail is torn inside the derive's first frame",
      (files) => files.walEnd + 24 + 100,
    ],
  ];

  for (const [name, cutAt] of cuts)
    test(name, () => {
      const files = appendThenDerive();
      powerCut(files, cutAt(files));

      const library = openLibrary();
      expect(library.status.uncleanExit).toBe(true);
      expect(library.status.quickCheck).toBe("ok");
      expect(library.status.readOnly).toBeNull();
      // The FULL append survived; the derive did not.
      expect(textOf(library, files.id)).toBe("kept");
      expect(library.backlinks(TARGET)).toEqual([]);
      // derived_seq went with its rows: the document reads as stale.
      expect(library.nextStale()).toBe(files.id);

      // The derive queue puts the rows back.
      expect(library.putDerived(files.id, files.seq, rows)).toBe("ok");
      expect(library.backlinks(TARGET)).toHaveLength(1);
      expect(library.nextStale()).toBeNull();
    });

  test("control: with the WAL whole, the derive survives the crash", () => {
    const files = appendThenDerive();
    powerCut(files, files.wal.byteLength);
    const library = openLibrary();
    expect(library.backlinks(TARGET)).toHaveLength(1);
    expect(library.nextStale()).toBeNull();
  });
});
