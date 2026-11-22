import { describe, expect, it } from "bun:test";

import * as Y from "yjs";

import { CLIENT_LIMITS } from "@/lib/comments/limits";
import { liveBytes } from "@/lib/comments/measure";
import {
  type Author,
  COMMENT_ORIGIN,
  messageKey,
  statusKey,
  threadKey,
} from "@/lib/comments/model";
import { createCommentStore } from "@/lib/comments/store";
import { readThreads } from "@/lib/comments/threads";

const ANN: Author = { id: "A".repeat(22), n: "Ann", k: "#E57373" };
const BO: Author = { id: "B".repeat(22), n: "Bo", k: "#64B5F6" };
const ANCHORS = { s: new Uint8Array([1, 2, 3]), e: new Uint8Array([4, 5]) };
const NOW = Date.UTC(2026, 10, 16);

function setup(
  options: {
    doc?: Y.Doc;
    allowed?: boolean;
    manager?: boolean;
    author?: Author;
    rates?: { threads: number; messages: number };
    now?: () => number;
  } = {},
) {
  const doc = options.doc ?? new Y.Doc();
  let allowed = options.allowed ?? true;
  const store = createCommentStore({
    doc,
    canComment: () => allowed,
    canManageAll: () => options.manager ?? false,
    author: () => options.author ?? ANN,
    now: options.now ?? (() => NOW),
    rates: options.rates ?? { threads: 1000, messages: 1000 },
  });
  return {
    doc,
    store,
    allow: (next: boolean) => {
      allowed = next;
    },
  };
}

const create = (
  store: ReturnType<typeof setup>["store"],
  body = "Looks good",
) => {
  const result = store.create({ anchors: ANCHORS, quote: "beta", body });
  if (!result.ok) throw new Error(result.reason);
  return result.tid;
};

describe("comment store (§4, §6)", () => {
  it("writes a thread as head, anchors and opening message in one transaction", () => {
    const { doc, store } = setup();
    const origins: unknown[] = [];
    doc.on("afterTransaction", (tr) => origins.push(tr.origin));
    const tid = create(store);
    expect(origins).toEqual([COMMENT_ORIGIN]);
    expect([...store.map.keys()].sort()).toEqual(
      [`a:${tid}`, messageKey(tid, tid), threadKey(tid)].sort(),
    );
    const [thread] = readThreads(store.map);
    expect(thread.head).toEqual({ v: 1, q: "beta", c: NOW, au: ANN });
    expect(thread.messages.map((m) => m.mid)).toEqual([tid]);
  });

  it("refuses empty and over-long bodies before writing", () => {
    const { store } = setup();
    expect(
      store.create({ anchors: ANCHORS, quote: "beta", body: "  \n " }),
    ).toEqual({
      ok: false,
      reason: "empty",
    });
    const long = "x".repeat(CLIENT_LIMITS.body + 1);
    expect(
      store.create({ anchors: ANCHORS, quote: "beta", body: long }),
    ).toEqual({
      ok: false,
      reason: "too-long",
    });
    expect(store.map.size).toBe(0);
  });

  it("orders replies by time, then id, and ignores orphans", () => {
    let at = NOW;
    const { store } = setup({ now: () => at });
    const tid = create(store);
    at += 10;
    const second = store.reply(tid, "second");
    at -= 5;
    const first = store.reply(tid, "first");
    if (!first.ok || !second.ok) throw new Error("reply refused");
    store.map.set(messageKey("Z".repeat(22), "Y".repeat(22)), {
      au: ANN,
      b: "orphan",
      c: NOW,
    });
    const threads = readThreads(store.map);
    expect(threads).toHaveLength(1);
    expect(threads[0].messages.map((m) => m.mid)).toEqual([
      tid,
      first.mid,
      second.mid,
    ]);
  });

  it("edits only your own message, keeping its author and time", () => {
    let author = ANN;
    const doc = new Y.Doc();
    const store = createCommentStore({
      doc,
      canComment: () => true,
      author: () => author,
      now: () => NOW + 1,
    });
    const tid = create(store);
    expect(store.edit(tid, tid, "Edited")).toEqual({ ok: true });
    expect(store.map.get(messageKey(tid, tid))).toEqual({
      au: ANN,
      b: "Edited",
      c: NOW + 1,
      ed: NOW + 1,
    });
    author = BO;
    expect(store.edit(tid, tid, "Mine now")).toEqual({
      ok: false,
      reason: "not-own",
    });
  });

  it("deletes a reply as a marker that keeps the original author and time", () => {
    const { store } = setup({ manager: true });
    const tid = create(store);
    const reply = store.reply(tid, "reply");
    if (!reply.ok) throw new Error("reply refused");
    expect(store.deleteMessage(tid, reply.mid)).toEqual({ ok: true });
    expect(store.map.get(messageKey(tid, reply.mid))).toEqual({
      au: ANN,
      c: NOW,
      del: true,
    });
  });

  it("lets the sharer delete anyone's thread, and others only their own", () => {
    const doc = new Y.Doc();
    const tid = create(setup({ doc, author: ANN }).store);
    expect(setup({ doc, author: BO }).store.deleteThread(tid)).toEqual({
      ok: false,
      reason: "not-own",
    });
    const removed = setup({
      doc,
      author: BO,
      manager: true,
    }).store.deleteThread(tid);
    expect(removed.ok).toBe(true);
    expect(doc.getMap("comments").size).toBe(0);
    if (!removed.ok) return;
    // The Undo pill re-writes the kept keys, forward.
    expect(setup({ doc }).store.restore(removed.removed)).toEqual({ ok: true });
    expect(readThreads(doc.getMap("comments"))).toHaveLength(1);
  });

  it("resolves and reopens, recording who and when", () => {
    const { store } = setup();
    const tid = create(store);
    store.setResolved(tid, true);
    expect(store.map.get(statusKey(tid))).toEqual({
      r: true,
      at: NOW,
      by: ANN,
    });
    store.setResolved(tid, false);
    expect(readThreads(store.map)[0].status?.r).toBe(false);
  });

  it("re-anchors keeping the first pair, and re-attaches keeping the current one", () => {
    const { store } = setup();
    const tid = create(store);
    const one = { s: new Uint8Array([9]), e: new Uint8Array([9]) };
    const two = { s: new Uint8Array([8]), e: new Uint8Array([8]) };
    store.setAnchors(tid, one, "reanchor");
    store.setAnchors(tid, two, "reanchor");
    expect(store.map.get(`a:${tid}`)).toEqual({
      ...two,
      ps: ANCHORS.s,
      pe: ANCHORS.e,
    });
    store.setAnchors(tid, one, "reattach");
    expect(store.map.get(`a:${tid}`)).toEqual({ ...one, ps: two.s, pe: two.e });
  });

  it("refuses at the client caps and rates, never the server's", () => {
    const capped = setup({ rates: { threads: 1000, messages: 100_000 } }).store;
    for (let index = 0; index < CLIENT_LIMITS.threads; index++) create(capped);
    expect(
      capped.create({ anchors: ANCHORS, quote: "q", body: "one more" }),
    ).toEqual({
      ok: false,
      reason: "threads-full",
    });

    const replies = setup().store;
    const tid = create(replies);
    for (let index = 1; index < CLIENT_LIMITS.messagesPerThread; index++) {
      expect(replies.reply(tid, `reply ${index}`).ok).toBe(true);
    }
    expect(replies.reply(tid, "too many")).toEqual({
      ok: false,
      reason: "replies-full",
    });

    const fast = setup({ rates: { threads: 6, messages: 20 } }).store;
    for (let index = 0; index < 6; index++) create(fast);
    expect(
      fast.create({ anchors: ANCHORS, quote: "q", body: "seventh" }),
    ).toEqual({
      ok: false,
      reason: "rate",
    });
  });

  it("refuses a write that would pass the byte budget", () => {
    const { store } = setup();
    const body = "x".repeat(CLIENT_LIMITS.body);
    let refused: string | null = null;
    while (!refused) {
      const created = store.create({ anchors: ANCHORS, quote: "q", body });
      if (!created.ok) {
        refused = created.reason;
        break;
      }
      for (let index = 0; index < 50 && !refused; index++) {
        const reply = store.reply(created.tid, body);
        if (!reply.ok) refused = reply.reason;
      }
    }
    expect(refused).toBe("storage-full");
    expect(liveBytes(store.map)).toBeLessThanOrEqual(CLIENT_LIMITS.bytes);
  });

  it("treats a thread from a newer version as read-only", () => {
    const { store } = setup();
    const tid = create(store);
    store.map.set(threadKey(tid), { v: 2, q: "beta", c: NOW, au: ANN });
    expect(store.reply(tid, "hi")).toEqual({ ok: false, reason: "newer" });
    expect(store.setResolved(tid, true)).toEqual({
      ok: false,
      reason: "newer",
    });
  });

  it("refuses to delete or restore a thread from a newer version", () => {
    const { doc, store } = setup({ manager: true });
    const tid = create(store);
    const reply = store.reply(tid, "a reply");
    if (!reply.ok) throw new Error(reply.reason);
    const removed = store.deleteThread(tid);
    if (!removed.ok) throw new Error(removed.reason);
    // The same thread, re-created by a newer TinyDocy with a newer head.
    const newer = removed.removed.map(([key, value]) =>
      key === threadKey(tid)
        ? ([key, { v: 2, q: "beta", c: NOW, au: ANN }] as const)
        : ([key, value] as const),
    );
    for (const [key, value] of newer) store.map.set(key, value);
    const updates: Uint8Array[] = [];
    doc.on("update", (update) => updates.push(update));
    const refused = { ok: false, reason: "newer" } as const;
    expect(store.deleteThread(tid)).toEqual(refused);
    expect(store.deleteMessage(tid, reply.mid)).toEqual(refused);
    expect(store.deleteMessage(tid, tid)).toEqual(refused);
    store.map.delete(messageKey(tid, reply.mid));
    updates.length = 0;
    // Restoring a key into it would re-set part of a shape it can't read.
    expect(store.restore(removed.removed)).toEqual(refused);
    // And a removed newer head is never written back either.
    for (const [key] of newer) store.map.delete(key);
    updates.length = 0;
    expect(store.restore(newer)).toEqual(refused);
    expect(updates).toHaveLength(0);
  });
});

describe("view-only (§6.2, §10)", () => {
  it("makes zero Yjs updates for every action when canComment() is false", () => {
    const doc = new Y.Doc();
    const writer = setup({ doc });
    const tid = create(writer.store);
    const reply = writer.store.reply(tid, "reply");
    if (!reply.ok) throw new Error("reply refused");

    const viewer = setup({ doc, allowed: false });
    const updates: Uint8Array[] = [];
    doc.on("update", (update) => updates.push(update));
    const { store } = viewer;
    const results = [
      store.create({ anchors: ANCHORS, quote: "q", body: "hello" }),
      store.reply(tid, "hello"),
      store.edit(tid, tid, "hello"),
      store.deleteMessage(tid, reply.mid),
      store.deleteMessage(tid, tid),
      store.deleteThread(tid),
      store.setResolved(tid, true),
      store.setAnchors(tid, ANCHORS, "reanchor"),
      store.setAnchors(tid, ANCHORS, "reattach"),
      store.restore([
        [threadKey("Q".repeat(22)), { v: 1, q: "x", c: NOW, au: ANN }],
      ]),
    ];
    for (const result of results)
      expect(result).toEqual({ ok: false, reason: "not-allowed" });
    expect(updates).toHaveLength(0);
  });
});
