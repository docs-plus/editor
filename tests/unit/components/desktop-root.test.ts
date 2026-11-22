/**
 * DesktopRoot's dev-bridge retry: a reload's `load` may reach the storage
 * host before the old connection's close has released the document.
 */
import { describe, expect, it } from "bun:test";

import { retryWhileReleasing } from "@/components/desktop/desktop-root";
import type { DocStoreError } from "@/lib/platform/doc-store";
import {
  MemoryDocLibrary,
  MemoryDocStore,
} from "@/lib/platform/memory-doc-store";

const noWait = () => Promise.resolve();

describe("retryWhileReleasing", () => {
  it("loads once the old connection lets go", async () => {
    const library = new MemoryDocLibrary();
    const old = new MemoryDocStore({ library });
    await old.load("doc");
    const waits: number[] = [];
    const store = retryWhileReleasing(
      new MemoryDocStore({ library }),
      async (ms) => {
        waits.push(ms);
        if (waits.length === 2) await old.close("doc");
      },
    );

    const loaded = await store.load("doc");
    expect(loaded.maxSeq).toBe(0);
    expect(waits).toEqual([100, 100]);
  });

  it("gives up after five tries, about half a second", async () => {
    const library = new MemoryDocLibrary();
    await new MemoryDocStore({ library }).load("doc");
    let waits = 0;
    const store = retryWhileReleasing(
      new MemoryDocStore({ library }),
      async () => {
        waits++;
      },
    );
    const error = await store.load("doc").catch((e: unknown) => e);
    expect((error as DocStoreError).code).toBe("already_open");
    expect(waits).toBe(4);
  });

  it("never retries other errors, and passes the rest through", async () => {
    const inner = new MemoryDocStore();
    inner.failNext("load", "corrupt");
    const store = retryWhileReleasing(inner, noWait);
    expect(
      ((await store.load("doc").catch((e: unknown) => e)) as DocStoreError)
        .code,
    ).toBe("corrupt");
    await store.load("doc");
    expect(
      await store.append("doc", {
        origin: "local",
        update: new Uint8Array([0, 0]),
      }),
    ).toBe(1);
  });
});
