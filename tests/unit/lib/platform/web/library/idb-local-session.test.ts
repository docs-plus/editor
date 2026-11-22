/**
 * `local-session` and the batcher over `IdbDocStore` (web library §2.6, §7.1):
 * the shared session code, unchanged, on the web store. A write that hits
 * the quota keeps its batch queued in order, reports `cant_save`, and saves
 * everything without a gap once space is back.
 */
import { afterEach, describe, expect, it } from "bun:test";

import * as Y from "yjs";

import {
  BATCH_IDLE_MS,
  type BatcherHealth,
  RETRY_BASE_MS,
} from "@/lib/platform/batcher";
import { createLocalSession } from "@/lib/platform/local-session";
import { IdbDocStore } from "@/lib/platform/web/library/idb-doc-store";
import type { LibraryEvent } from "@/lib/platform/web/library/library-db";
import { createLibraryDoc } from "@/lib/platform/web/library/library-docs";
import { STORES } from "@/lib/platform/web/library/library-schema";
import {
  createFakeBrowser,
  createFakeLibrary,
  injectQuotaFault,
} from "@/tests/helpers/fake-idb";
import { FakeClock } from "@/tests/helpers/platform-fakes";

/** Waits in real time: IndexedDB commits on its own task queue. */
async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 500 && !check(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  expect(check()).toBe(true);
}

let disarm: (() => void) | null = null;
afterEach(() => {
  disarm?.();
  disarm = null;
});

describe("local-session over IdbDocStore", () => {
  it("keeps a batch that hit the quota, reports cant_save, and saves it in order later", async () => {
    const library = await createFakeLibrary();
    await library.createDoc("doc", 0);
    const clock = new FakeClock();
    const health: BatcherHealth[] = [];
    const session = createLocalSession({
      store: library.connect(),
      clock,
      scheduleIdle: (fn) => clock.setTimeout(fn, 0),
      onHealth: (_docId, next) => health.push(next),
    });
    const handle = session.open("doc");
    await until(() => handle.getState().ready);

    disarm = injectQuotaFault();
    handle.doc.getText("t").insert(0, "first");
    await clock.advance(BATCH_IDLE_MS);
    await until(() => health.at(-1)?.failing?.code === "quota_exceeded");

    const reader = () => library.connect().load("doc");
    expect((await reader()).updates.length).toBe(0);

    // Typing goes on; it queues behind the failed batch.
    handle.doc.getText("t").insert(5, " second");
    disarm();
    disarm = null;
    await clock.advance(RETRY_BASE_MS);
    await until(() => health.at(-1)?.failing === null);
    await clock.advance(BATCH_IDLE_MS);
    await handle.flush();

    const loaded = await reader();
    const doc = new Y.Doc();
    if (loaded.snapshot) Y.applyUpdate(doc, loaded.snapshot);
    for (const update of loaded.updates) Y.applyUpdate(doc, update);
    expect(doc.getText("t").toString()).toBe("first second");
    handle.release();
    await library.dispose();
  });
});

/**
 * The contract W4 must honour after an upgrade in another tab (web library
 * §2.2 As built): `IdbDocStore` has no reopen path, so a reload is the only
 * recovery, and only a session drain registered as a close hook writes the
 * batches the batcher still holds before the connection closes.
 */
describe("an upgrade in another tab, with local-session over IdbDocStore", () => {
  async function setUp() {
    const browser = createFakeBrowser();
    const events: LibraryEvent[] = [];
    const library = await browser.open({ onEvent: (e) => events.push(e) });
    await createLibraryDoc(library, { id: "doc" });
    const clock = new FakeClock();
    const health: BatcherHealth[] = [];
    const session = createLocalSession({
      store: new IdbDocStore({ library }),
      clock,
      scheduleIdle: (fn) => clock.setTimeout(fn, 0),
      onHealth: (_docId, next) => health.push(next),
    });
    const handle = session.open("doc");
    await until(() => handle.getState().ready);
    /** Opens version 2, as a newer bundle's tab; resolves once it is in. */
    const upgrade = () =>
      new Promise<IDBDatabase>((resolve, reject) => {
        const request = browser.factory.open("tinydocy-library", 2);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    const rowCount = (db: IDBDatabase) =>
      new Promise<number>((resolve) => {
        const request = db
          .transaction(STORES.updates, "readonly")
          .objectStore(STORES.updates)
          .count();
        request.onsuccess = () => resolve(request.result);
      });
    return {
      library,
      events,
      clock,
      health,
      session,
      handle,
      upgrade,
      rowCount,
    };
  }

  it("writes a queued batch first when W4 registers the session drain as a close hook", async () => {
    const { library, events, session, handle, upgrade, rowCount } =
      await setUp();
    library.addCloseHook(() => session.flush());
    // Queued in the batcher: its idle timer never fires (the clock is fake).
    handle.doc.getText("t").insert(0, "typed just before the upgrade");

    const newer = await upgrade();
    expect(library.closed).toBe(true);
    expect(events).toEqual(["library_reload"]);
    expect(await rowCount(newer)).toBe(1);
    newer.close();
    handle.release();
  });

  it("without that hook, leaves the batch queued and failing until the reload", async () => {
    const { library, events, clock, health, handle, upgrade, rowCount } =
      await setUp();
    handle.doc.getText("t").insert(0, "typed just before the upgrade");

    const newer = await upgrade();
    expect(library.closed).toBe(true);
    expect(events).toEqual(["library_reload"]);
    expect(await rowCount(newer)).toBe(0);

    // The batch is still held, and every retry fails retryably: W4's
    // beforeunload guard stays armed until the reload.
    await clock.advance(BATCH_IDLE_MS);
    await until(() => health.at(-1)?.failing?.code === "library_unavailable");
    expect(health.at(-1)?.failing?.retryable).toBe(true);
    newer.close();
    handle.release();
  });
});
