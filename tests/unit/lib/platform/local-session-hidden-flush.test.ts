/**
 * Phones and tablets §6.4 (M20, v8): the flush a hidden page runs on a
 * library document must start its append in the same task and never
 * compact. Compaction encodes the whole document and replaces rows, too
 * slow for the moment before iOS may kill the tab; it waits for idle or
 * close while visible. This pins the `DocHandle.flush()` contract the web
 * library's `visibilitychange` handler (W-D2) calls.
 */
import { describe, expect, it } from "bun:test";

import * as Y from "yjs";

import { COMPACT_MAX_ROWS } from "@/lib/platform/batcher";
import type {
  AppendRecord,
  CompactResult,
  DocStore,
} from "@/lib/platform/doc-store";
import { createLocalSession } from "@/lib/platform/local-session";
import {
  MemoryDocLibrary,
  MemoryDocStore,
} from "@/lib/platform/memory-doc-store";
import { FakeClock, settle } from "@/tests/helpers/platform-fakes";

const DOC = "doc";

/** Records when an append starts (not when it is acked) and every compaction. */
class StartSpyStore implements DocStore {
  appendsStarted = 0;
  compactions = 0;
  constructor(readonly inner: DocStore) {}
  load(docId: string) {
    return this.inner.load(docId);
  }
  append(docId: string, record: AppendRecord) {
    this.appendsStarted++;
    return this.inner.append(docId, record);
  }
  compact(
    docId: string,
    state: Uint8Array,
    upToSeq: number,
  ): Promise<CompactResult> {
    this.compactions++;
    return this.inner.compact(docId, state, upToSeq);
  }
  close(docId: string) {
    return this.inner.close(docId);
  }
  flush() {
    return this.inner.flush();
  }
}

/** A document with more rows since its snapshot than compaction allows. */
async function seedPastCompaction(library: MemoryDocLibrary): Promise<void> {
  library.createDoc(DOC, 0);
  const writer = new MemoryDocStore({ library });
  await writer.load(DOC);
  const doc = new Y.Doc();
  for (let i = 0; i <= COMPACT_MAX_ROWS; i++) {
    const before = Y.encodeStateVector(doc);
    doc.getText("t").insert(0, "x");
    await writer.append(DOC, {
      origin: "local",
      update: Y.encodeStateAsUpdate(doc, before),
    });
  }
  await writer.close(DOC);
}

describe("library flush on hidden (no compaction)", () => {
  it("starts the append in the same task and never compacts", async () => {
    const library = new MemoryDocLibrary();
    await seedPastCompaction(library);
    const clock = new FakeClock();
    const store = new StartSpyStore(new MemoryDocStore({ library }));
    const idle: (() => void)[] = [];
    const session = createLocalSession({
      store,
      clock,
      // The page is hidden: idle callbacks do not run.
      scheduleIdle: (fn) => idle.push(fn),
    });
    const handle = session.open(DOC);
    await settle();
    expect(handle.getState().ready).toBe(true);

    handle.doc.getText("t").insert(0, "typed, then switched apps ");
    expect(store.appendsStarted).toBe(0); // batched: waits for 250 ms

    const flushed = handle.flush();
    // Synchronous: no timer, no await before the append is issued.
    expect(store.appendsStarted).toBe(1);
    await flushed;
    await settle();

    // Compaction is due (rows past the limit), but only asked for idle.
    expect(idle).toHaveLength(1);
    expect(store.compactions).toBe(0);

    // A second hidden flush with nothing pending writes nothing.
    await handle.flush();
    expect(store.appendsStarted).toBe(1);
    expect(store.compactions).toBe(0);
    handle.release();
  });
});
