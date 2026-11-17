import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import * as Y from "yjs";

import { openBunSqlite } from "@/desktop/dev/bun-sqlite-driver";
import {
  copyLibraryInto,
  DAILY_KEEP,
  localDate,
} from "@/desktop/storage/engine/daily-copy";
import { IDLE_MS, type Library } from "@/desktop/storage/engine/library";
import {
  createClock,
  createTempDir,
  createTestHost,
  openTestLibrary,
  type TestClock,
} from "@/tests/helpers/storage-library";

const DAY = 24 * 60 * 60 * 1000;

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

function write(docId: string, text: string) {
  if (!library.isOpen(docId)) library.load(docId, "w1");
  const doc = new Y.Doc();
  doc.getText("t").insert(0, text);
  library.append(docId, "w1", {
    origin: "local",
    update: Y.encodeStateAsUpdate(doc),
  });
}

describe("daily copies (D-A6)", () => {
  test("waits for 30 s without a write", () => {
    write(library.createDoc().id, "x");
    clock.advance(IDLE_MS - 1);
    expect(library.runIdleJobs().dailyCopy).toBeNull();
    clock.advance(1);
    expect(library.runIdleJobs().dailyCopy).toBe(
      `library-${localDate(clock.now)}.sqlite`,
    );
  });

  test("takes one copy a day and keeps the newest 7", () => {
    const docId = library.createDoc().id;
    const taken: string[] = [];
    for (let day = 0; day < 10; day += 1) {
      write(docId, `day ${day}`);
      clock.advance(IDLE_MS);
      const first = library.runIdleJobs().dailyCopy;
      expect(first).not.toBeNull();
      taken.push(localDate(clock.now));
      expect(library.runIdleJobs().dailyCopy).toBeNull();
      clock.advance(DAY);
    }
    expect(library.listDailyCopies()).toEqual(taken.slice(-DAILY_KEEP));
  });

  test("a copy restores one document's state as of that day", () => {
    const docId = library.createDoc().id;
    write(docId, "before");
    clock.advance(IDLE_MS);
    library.runIdleJobs();
    const day = localDate(clock.now);
    write(docId, "after");
    const restored = new Y.Doc();
    Y.applyUpdate(restored, library.readDailyCopy(day, docId));
    expect(restored.getText("t").toString()).toBe("before");
  });

  test("survives a leftover partial copy", () => {
    const host = createTestHost(clock);
    host.mkdirp(host.join(temp.dir, "daily"));
    const partial = host.join(
      temp.dir,
      "daily",
      `library-${localDate(clock.now)}.sqlite.partial`,
    );
    host.createExclusive(partial, "junk");
    clock.advance(IDLE_MS);
    expect(library.runIdleJobs().dailyCopy).not.toBeNull();
    expect(host.exists(partial)).toBe(false);
  });

  test("refuses a malformed date", () => {
    expect(() =>
      library.readDailyCopy("../../etc", crypto.randomUUID()),
    ).toThrow();
  });
});

describe("daily copy off the writer (begin, copy, complete or fail)", () => {
  function idle() {
    clock.advance(IDLE_MS);
  }

  test("begin waits for idle, hands out one job at a time, and nothing until it ends", () => {
    write(library.createDoc().id, "x");
    expect(library.beginDailyCopy()).toBeNull();
    idle();
    const job = library.beginDailyCopy();
    expect(job?.partial).toEndWith(".sqlite.partial");
    expect(job?.source).toBe(library.path);
    expect(library.beginDailyCopy()).toBeNull();
  });

  test("a copy made on its own read-only connection completes like the inline one", () => {
    const docId = library.createDoc().id;
    write(docId, "copied");
    idle();
    const job = library.beginDailyCopy();
    if (!job) throw new Error("no job");
    copyLibraryInto(openBunSqlite, job.source, job.partial);
    // The writer keeps committing while the copy is out.
    write(docId, " later");
    expect(library.completeDailyCopy(job)).toBe(
      `library-${localDate(clock.now)}.sqlite`,
    );
    expect(library.listDailyCopies()).toEqual([localDate(clock.now)]);
    const restored = new Y.Doc();
    Y.applyUpdate(restored, library.readDailyCopy(localDate(clock.now), docId));
    expect(restored.getText("t").toString()).toBe("copied");
    expect(library.beginDailyCopy()).toBeNull(); // done for today
  });

  test("a failed or abandoned copy leaves no partial, keeps older copies and retries", () => {
    const docId = library.createDoc().id;
    write(docId, "day one");
    idle();
    library.runIdleJobs();
    const kept = library.listDailyCopies();
    clock.advance(DAY);
    write(docId, " day two");
    idle();
    const job = library.beginDailyCopy();
    if (!job) throw new Error("no job");
    createTestHost(clock).createExclusive(job.partial, "half a copy");
    library.failDailyCopy(job, "quit");
    expect(createTestHost(clock).exists(job.partial)).toBe(false);
    expect(library.listDailyCopies()).toEqual(kept);
    expect(library.stats().lastDailyCopyError).toBe("quit");
    expect(library.beginDailyCopy()).not.toBeNull();
  });

  test("opening the library sweeps partial copies a killed process left", () => {
    const host = createTestHost(clock);
    library.shutdown();
    host.mkdirp(host.join(temp.dir, "daily"));
    const partial = host.join(
      temp.dir,
      "daily",
      "library-2026-11-16.sqlite.partial",
    );
    host.createExclusive(partial, "junk");
    library = openTestLibrary(temp.dir, host);
    expect(host.exists(partial)).toBe(false);
  });
});
