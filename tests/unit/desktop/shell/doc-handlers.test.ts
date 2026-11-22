import { describe, expect, test } from "bun:test";

import {
  createDocHandlers,
  type StorageCall,
} from "@/desktop/main/doc-handlers";
import { OpenDocRegistry } from "@/desktop/main/registry";
import { StorageCallError } from "@/desktop/storage/client";

const A = 1;
const B = 2;

function setup(opts: { windowDocs?: Record<number, string> } = {}) {
  const registry = new OpenDocRegistry();
  const calls: Array<{ op: string; args: unknown }> = [];
  const focused: number[] = [];
  const flushed: Array<[number, number]> = [];
  const failNext: { code?: string } = {};
  const call = (async (op: string, args: unknown) => {
    calls.push({ op, args });
    if (failNext.code) {
      const code = failNext.code;
      failNext.code = undefined;
      throw new StorageCallError({
        code: code as never,
        retryable: false,
        message: code,
      });
    }
    switch (op) {
      case "load":
        return { snapshot: null, updates: [], maxSeq: 0, schema: 0 };
      case "append":
        return 7;
      case "compact":
        return { foreign: null };
      case "createDoc":
        return { id: crypto.randomUUID(), lineage: "l", linkKey: "k", rev: 1 };
      default:
        return null;
    }
  }) as StorageCall;
  const docHandlers = createDocHandlers({
    registry,
    call,
    focusWindow: (id) => focused.push(id),
    windowDoc: (id) => opts.windowDocs?.[id] ?? null,
    build: "test-build",
    onFlushed: (w, r) => flushed.push([w, r]),
  });
  const { handlers } = docHandlers;
  return { registry, calls, focused, flushed, failNext, handlers, docHandlers };
}

const docId = "0f8fad5b-d9cb-469f-a165-70867728950e";
const record = { origin: "local", update: new Uint8Array([1, 2, 3]) };

describe("doc-handlers", () => {
  test("app.hello refuses another build and returns the window's document", async () => {
    const { handlers } = setup({ windowDocs: { [A]: docId } });
    expect(await handlers["app.hello"](A, { build: "other" })).toEqual({
      ok: false,
      error: { code: "build_mismatch", retryable: false },
    });
    expect(await handlers["app.hello"](A, { build: "test-build" })).toEqual({
      ok: true,
      value: { docId },
    });
  });

  test("dispatch refuses everything but app.hello until the window says hello", async () => {
    const { docHandlers, calls } = setup();
    const mismatch = {
      ok: false,
      error: { code: "build_mismatch", retryable: false },
    } as const;
    expect(await docHandlers.dispatch("doc.open", A, { docId })).toEqual(
      mismatch,
    );
    await docHandlers.dispatch("app.hello", A, { build: "other" });
    expect(await docHandlers.dispatch("doc.open", A, { docId })).toEqual(
      mismatch,
    );
    await docHandlers.dispatch("app.hello", A, { build: "test-build" });
    expect((await docHandlers.dispatch("doc.open", A, { docId })).ok).toBe(
      true,
    );
    expect(await docHandlers.dispatch("doc.flush", B, {})).toEqual(mismatch);
    docHandlers.forgetWindow(A);
    expect(await docHandlers.dispatch("doc.flush", A, {})).toEqual(mismatch);
    expect(calls.filter((c) => c.op === "load")).toHaveLength(1);
  });

  test("invalid arguments never reach storage", async () => {
    const { handlers, calls } = setup();
    for (const raw of [
      undefined,
      {},
      { docId: "playground" },
      { docId, owner: "w2" },
      [docId],
    ]) {
      const result = await handlers["doc.open"](A, raw);
      expect(result).toEqual({
        ok: false,
        error: { code: "invalid_argument", retryable: false },
      });
    }
    expect(calls).toEqual([]);
  });

  test("doc.open claims for the window and loads with its owner id", async () => {
    const { handlers, calls, registry } = setup();
    const result = await handlers["doc.open"](A, { docId });
    expect(result.ok).toBe(true);
    expect(registry.holder(docId)).toBe(A);
    expect(calls).toEqual([{ op: "load", args: { docId, owner: "w1" } }]);
    // Idempotent for the same window.
    expect((await handlers["doc.open"](A, { docId })).ok).toBe(true);
  });

  test("doc.open from another window is already_open and focuses the holder", async () => {
    const { handlers, focused, calls } = setup();
    await handlers["doc.open"](A, { docId });
    const result = await handlers["doc.open"](B, { docId });
    expect(result).toEqual({
      ok: false,
      error: { code: "already_open", retryable: false },
    });
    expect(focused).toEqual([A]);
    expect(calls.filter((c) => c.op === "load")).toHaveLength(1);
  });

  test("a failed load releases the claim unless main opened the window for it", async () => {
    const plain = setup();
    plain.failNext.code = "not_found";
    expect(await plain.handlers["doc.open"](A, { docId })).toEqual({
      ok: false,
      error: { code: "not_found", retryable: false },
    });
    expect(plain.registry.holder(docId)).toBeUndefined();

    const opened = setup({ windowDocs: { [A]: docId } });
    opened.registry.claim(docId, A);
    opened.failNext.code = "not_found";
    await opened.handlers["doc.open"](A, { docId });
    expect(opened.registry.holder(docId)).toBe(A);
  });

  test("append, compact and close need the window to hold the document", async () => {
    const { handlers, calls } = setup();
    const forbidden = {
      ok: false,
      error: { code: "forbidden", retryable: false },
    } as const;
    expect(await handlers["doc.append"](B, { docId, record })).toEqual(
      forbidden,
    );
    expect(
      await handlers["doc.compact"](B, {
        docId,
        state: new Uint8Array(1),
        upToSeq: 1,
      }),
    ).toEqual(forbidden);
    expect(await handlers["doc.close"](B, { docId })).toEqual(forbidden);
    expect(calls).toEqual([]);

    await handlers["doc.open"](A, { docId });
    expect(await handlers["doc.append"](A, { docId, record })).toEqual({
      ok: true,
      value: 7,
    });
    expect(calls.at(-1)).toEqual({
      op: "append",
      args: { docId, owner: "w1", record },
    });
  });

  test("close releases the claim, so another window can open it", async () => {
    const { handlers, registry } = setup();
    await handlers["doc.open"](A, { docId });
    expect((await handlers["doc.close"](A, { docId })).ok).toBe(true);
    expect(registry.holder(docId)).toBeUndefined();
    expect((await handlers["doc.open"](B, { docId })).ok).toBe(true);
  });

  test("a dead transport is library_unavailable, retryable", async () => {
    const registry = new OpenDocRegistry();
    const { handlers } = createDocHandlers({
      registry,
      call: (async () => {
        throw new Error("worker gone");
      }) as StorageCall,
      focusWindow: () => {},
      windowDoc: () => null,
    });
    expect(await handlers["doc.flush"](A, {})).toEqual({
      ok: false,
      error: { code: "library_unavailable", retryable: true },
    });
  });

  test("index.create returns only the new id", async () => {
    const { handlers, calls } = setup();
    const result = await handlers["index.create"](A, { title: "Notes" });
    expect(result.ok && Object.keys(result.value as object)).toEqual(["id"]);
    expect(calls).toEqual([{ op: "createDoc", args: { title: "Notes" } }]);
  });

  test("app.flushed reaches the coordinator", async () => {
    const { handlers, flushed } = setup();
    await handlers["app.flushed"](A, { requestId: 3 });
    expect(flushed).toEqual([[A, 3]]);
  });

  test("fuzz: a window that doesn't hold a document never reaches append", async () => {
    const { handlers, calls, registry } = setup();
    registry.claim(docId, A);
    for (let i = 0; i < 1000; i++) {
      const window = 2 + (i % 50);
      const result = await handlers["doc.append"](window, {
        docId: i % 2 ? docId : crypto.randomUUID(),
        record,
      });
      expect(result.ok).toBe(false);
    }
    expect(calls.filter((c) => c.op === "append")).toEqual([]);
  });
});
