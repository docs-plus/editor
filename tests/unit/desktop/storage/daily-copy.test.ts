import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import * as Y from "yjs";

import { DAILY_KEEP, localDate } from "@/desktop/storage/engine/daily-copy";
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
