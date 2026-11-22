/**
 * D-O3: an append refused at the size cap never drops the update. The
 * batcher stops retrying and keeps the batch, the session goes read-only
 * with `document_too_large`, and the edit is still in the Y.Doc, so
 * Duplicate or Export can carry it.
 */
import { describe, expect, it } from "bun:test";

import * as Y from "yjs";

import { Batcher, RETRY_MAX_MS } from "@/lib/platform/batcher";
import type { AppendRecord, DocStore } from "@/lib/platform/doc-store";
import { DocStoreError } from "@/lib/platform/doc-store";
import { createLocalSession } from "@/lib/platform/local-session";
import {
  MemoryDocLibrary,
  MemoryDocStore,
} from "@/lib/platform/memory-doc-store";
import { FakeClock, settle } from "@/tests/helpers/platform-fakes";

/** A store whose appends are refused at the cap once `full` is set. */
class CappedStore implements DocStore {
  full = false;
  attempts = 0;
  readonly accepted: AppendRecord[] = [];
  constructor(readonly inner: DocStore) {}
  load(docId: string) {
    return this.inner.load(docId);
  }
  async append(docId: string, record: AppendRecord) {
    this.attempts += 1;
    if (this.full) throw new DocStoreError("document_too_large");
    this.accepted.push(record);
    return this.inner.append(docId, record);
  }
  compact(docId: string, state: Uint8Array, upToSeq: number) {
    return this.inner.compact(docId, state, upToSeq);
  }
  close(docId: string) {
    return this.inner.close(docId);
  }
  flush() {
    return this.inner.flush();
  }
}

describe("an append refused at the size cap (D-O3)", () => {
  it("is never dropped, isn't retried in a loop, and the document goes read-only", async () => {
    const clock = new FakeClock();
    const library = new MemoryDocLibrary();
    library.createDoc("doc");
    const store = new CappedStore(new MemoryDocStore({ library }));
    const session = createLocalSession({
      store,
      clock,
      scheduleIdle: (fn) => clock.setTimeout(fn, 0),
    });
    const handle = session.open("doc");
    await settle();
    await clock.advance(0);
    expect(handle.getState().ready).toBe(true);

    store.full = true;
    handle.doc.getText("t").insert(0, "the edit that didn't fit");
    await clock.advance(2000);
    await settle();
    expect(store.attempts).toBe(1);
    expect(handle.getState().readOnlyReason).toBe("document_too_large");

    // Minutes pass: no retry loop.
    await clock.advance(RETRY_MAX_MS * 10);
    await settle();
    expect(store.attempts).toBe(1);

    // The edit is still in the Y.Doc: an export or a duplicate carries it.
    const exported = new Y.Doc();
    Y.applyUpdate(exported, Y.encodeStateAsUpdate(handle.doc));
    expect(exported.getText("t").toString()).toBe("the edit that didn't fit");
    expect(store.accepted).toHaveLength(0);
  });

  it("keeps the refused batch and sends it whole once the cap lifts", async () => {
    const clock = new FakeClock();
    const library = new MemoryDocLibrary();
    library.createDoc("doc");
    const store = new CappedStore(new MemoryDocStore({ library }));
    const loaded = await store.load("doc");
    const batcher = new Batcher({ store, docId: "doc", loaded, clock });
    const doc = new Y.Doc();
    doc.on("update", (update: Uint8Array) => batcher.push("local", update));
    store.full = true;
    doc.getText("t").insert(0, "kept");
    await clock.advance(2000);
    await settle();
    expect(batcher.isHalted).toBe(true);
    doc.getText("t").insert(4, " and more");
    await clock.advance(RETRY_MAX_MS * 3);
    await settle();
    expect(store.attempts).toBe(1);
    store.full = false;
    batcher.retryNow();
    await clock.advance(2000);
    await settle();
    const stored = new Y.Doc();
    for (const record of store.accepted) Y.applyUpdate(stored, record.update);
    expect(stored.getText("t").toString()).toBe("kept and more");
  });
});
