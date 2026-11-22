import { describe, expect, test } from "bun:test";

import { fail, ok } from "@/desktop/shared/errors";
import {
  DOC_STORE_CHANNELS,
  type TinydocyBridge,
} from "@/desktop/shared/ipc-contract";
import {
  createIpcDocStore,
  IPC_DOC_STORE_CHANNELS,
} from "@/lib/platform/desktop/ipc-doc-store";
import { isDocStoreError } from "@/lib/platform/doc-store";

function fakeBridge(answer: (channel: string, args: unknown) => unknown) {
  const calls: Array<{ channel: string; args: unknown }> = [];
  const bridge = {
    build: "test",
    invoke: async (channel: string, args: unknown) => {
      calls.push({ channel, args });
      return answer(channel, args);
    },
    on: () => () => undefined,
  } as unknown as TinydocyBridge;
  return { bridge, calls };
}

describe("IpcDocStore", () => {
  test("its channel map equals the contract's", () => {
    expect(IPC_DOC_STORE_CHANNELS).toEqual(DOC_STORE_CHANNELS);
  });

  test("forwards each op to its doc.* channel with the same arguments", async () => {
    const loaded = { snapshot: null, updates: [], maxSeq: 0, schema: 0 };
    const { bridge, calls } = fakeBridge((channel) =>
      channel === "doc.open"
        ? ok(loaded)
        : channel === "doc.append"
          ? ok(4)
          : channel === "doc.compact"
            ? ok({ foreign: null })
            : ok(null),
    );
    const store = createIpcDocStore(bridge);
    const docId = crypto.randomUUID();
    const record = { origin: "local" as const, update: new Uint8Array([1]) };
    expect(await store.load(docId)).toEqual(loaded);
    expect(await store.append(docId, record)).toBe(4);
    expect(await store.compact(docId, new Uint8Array([2]), 4)).toEqual({
      foreign: null,
    });
    await store.close(docId);
    await store.flush();
    expect(calls.map((c) => c.channel)).toEqual([
      "doc.open",
      "doc.append",
      "doc.compact",
      "doc.close",
      "doc.flush",
    ]);
    expect(calls[1].args).toEqual({ docId, record });
  });

  test("a refusal becomes a DocStoreError with main's code", async () => {
    const { bridge } = fakeBridge(() => fail("already_open"));
    const error = await createIpcDocStore(bridge)
      .load(crypto.randomUUID())
      .catch((e: unknown) => e);
    expect(isDocStoreError(error) && error.code).toBe("already_open");
  });

  test("a code the store doesn't know is library_unavailable (retryable)", async () => {
    const { bridge } = fakeBridge(() => fail("doc_too_new"));
    const error = await createIpcDocStore(bridge)
      .flush()
      .catch((e: unknown) => e);
    expect(isDocStoreError(error) && error.code).toBe("library_unavailable");
  });
});
