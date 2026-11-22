/**
 * Derived rows commit without waiting for the disk (soak T21). They are a
 * cache: a power cut loses the rows and their `derived_seq` together, so
 * the document reads as stale and is derived again. Skipping the fsync
 * keeps a reader queued behind a derive (backlinks, T21) from waiting for
 * F_FULLFSYNC (about 4 ms on macOS) or FlushFileBuffers (7–10 ms on a
 * Windows runner). Everything else keeps the configured `synchronous`.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import * as Y from "yjs";

import { openBunSqlite } from "@/desktop/dev/bun-sqlite-driver";
import type { DerivedRows } from "@/desktop/storage/engine/derive";
import type { OpenSqlite } from "@/desktop/storage/engine/driver";
import type { Library } from "@/desktop/storage/engine/library";
import {
  createClock,
  createTempDir,
  createTestHost,
  openTestLibrary,
} from "@/tests/helpers/storage-library";

let temp: ReturnType<typeof createTempDir>;
let library: Library | null = null;
let log: string[] = [];

/** `openBunSqlite`, recording every `exec` on the library's connection. */
const recording: OpenSqlite = (path, options) => {
  const db = openBunSqlite(path, options);
  return {
    ...db,
    exec(sql) {
      log.push(sql.trim());
      db.exec(sql);
    },
  };
};

beforeEach(() => {
  temp = createTempDir();
  log = [];
});
afterEach(() => {
  library?.shutdown();
  library = null;
  temp.cleanUp();
});

const rows: DerivedRows = {
  links: [],
  headings: [{ ord: 0, toc_id: "h1", level: 1, text: "Intro" }],
  title: "Title",
  snippet: "snippet",
};

function open(synchronous?: "FULL" | "OFF") {
  library = openTestLibrary(temp.dir, createTestHost(createClock()), {
    openSqlite: recording,
    ...(synchronous ? { synchronous } : {}),
  });
  return library;
}

function appendOne(lib: Library, id: string): number {
  lib.load(id, "w");
  const doc = new Y.Doc();
  doc.getText("t").insert(0, "x");
  return lib.append(id, "w", {
    origin: "local",
    update: Y.encodeStateAsUpdate(doc),
  });
}

/** The `synchronous` pragmas and transaction boundaries `run` issued. */
function syncTrace(run: () => void): string[] {
  log = [];
  run();
  return log.filter((sql) => /^(PRAGMA synchronous|BEGIN|COMMIT)/.test(sql));
}

describe("derive commits skip the fsync", () => {
  test("putDerived commits at NORMAL and puts FULL back", () => {
    const lib = open();
    const { id } = lib.createDoc();
    const seq = appendOne(lib, id);
    const trace = syncTrace(() => {
      expect(lib.putDerived(id, seq, rows)).toBe("ok");
    });
    expect(trace[0]).toBe("PRAGMA synchronous = NORMAL");
    expect(trace.at(-1)).toBe("PRAGMA synchronous = FULL");
    expect(trace.slice(1, -1).some((sql) => sql.startsWith("BEGIN"))).toBe(
      true,
    );
  });

  test("appends never change the level, and a library below FULL is left alone", () => {
    const lib = open("OFF");
    const { id } = lib.createDoc();
    const appendTrace = syncTrace(() => appendOne(lib, id));
    expect(appendTrace.some((sql) => sql.startsWith("PRAGMA"))).toBe(false);
    const seq = Number(
      (lib.stats() as unknown as { pragmas: { synchronous: number } }).pragmas
        .synchronous,
    );
    expect(seq).toBe(0);
    // Already below FULL: nothing to skip, so nothing changes.
    const trace = syncTrace(() => lib.putDerived(id, 1, rows));
    expect(trace.some((sql) => sql.startsWith("PRAGMA"))).toBe(false);
  });

  test("a refused putDerived still puts the level back", () => {
    const lib = open();
    const { id } = lib.createDoc();
    const seq = appendOne(lib, id);
    const bad: DerivedRows = {
      ...rows,
      headings: [{ ord: 0, toc_id: "h1", level: 9, text: "too deep" }],
    };
    const trace = syncTrace(() => {
      expect(() => lib.putDerived(id, seq, bad)).toThrow();
    });
    expect(trace[0]).toBe("PRAGMA synchronous = NORMAL");
    expect(trace.at(-1)).toBe("PRAGMA synchronous = FULL");
  });
});
