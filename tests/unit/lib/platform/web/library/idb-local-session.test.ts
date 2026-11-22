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
import { createFakeLibrary, injectQuotaFault } from "@/tests/helpers/fake-idb";
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
