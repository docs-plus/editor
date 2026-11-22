/**
 * `listThreads(ydoc)` on a bare Y.Doc (offline data-model revision §4.5,
 * I12): no editor, no schema, no DOM. Repair reports Detached and orphaned
 * threads from it; it must agree with the editor's resolution and never
 * write to the document.
 */
import { describe, expect, it } from "bun:test";

import * as Y from "yjs";

import { listThreads } from "@/lib/comments/list-threads";
import { COMMENT_ORIGIN, messageKey } from "@/lib/comments/model";

import {
  randInt,
  randomDocument,
  randomTextRange,
  randomTransaction,
  seededRng,
} from "../../../helpers/comment-fuzz-ops";
import {
  createHarnessClient,
  testAuthor,
} from "../../../helpers/comment-harness";

/** The document as storage holds it: a fresh Y.Doc with no typed roots. */
function bare(doc: Y.Doc): Y.Doc {
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
  return copy;
}

describe("listThreads on a bare Y.Doc", () => {
  it("lists nothing, and creates no root, in a document without comments", () => {
    const doc = bare(createHarnessClient().doc);
    expect(listThreads(doc)).toEqual({ threads: [], orphans: [] });
    expect(doc.share.has("comments")).toBe(false);
    expect(listThreads(new Y.Doc())).toEqual({ threads: [], orphans: [] });
  });

  it("reports Detached threads and orphaned keys without writing", () => {
    // Title / "alpha beta gamma": the paragraph's text starts at 8.
    const client = createHarnessClient();
    const beta = client.createThread({ from: 14, to: 18 });
    const gamma = client.createThread({ from: 19, to: 24 });
    const across = client.createThread({ from: 3, to: 11 });
    client.apply(client.state.tr.delete(19, 24));
    const lost = "Q".repeat(22);
    client.doc.transact(() => {
      client.store.map.set(messageKey(lost, "R".repeat(22)), {
        au: testAuthor(),
        b: "A reply that raced a delete",
        c: Date.UTC(2026, 10, 16),
      });
    }, COMMENT_ORIGIN);

    const doc = bare(client.doc);
    const updates: Uint8Array[] = [];
    doc.on("update", (update: Uint8Array) => updates.push(update));
    const { threads, orphans } = listThreads(doc);

    const byId = new Map(threads.map((t) => [t.tid, t]));
    expect(threads).toHaveLength(3);
    expect(byId.get(beta ?? "")?.detached).toBe(false);
    expect(byId.get(gamma ?? "")?.detached).toBe(true);
    expect(byId.get(across ?? "")?.detached).toBe(false);
    expect(byId.get(beta ?? "")?.head.q).toBe("beta");
    expect(byId.get(beta ?? "")?.messages).toHaveLength(1);
    expect(orphans).toEqual([messageKey(lost, "R".repeat(22))]);
    expect(updates).toEqual([]);
  });

  it("agrees with the editor's resolution through random edits", () => {
    let threads = 0;
    let detached = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const rng = seededRng(seed);
      const client = createHarnessClient({ content: randomDocument(rng) });
      for (let n = randInt(rng, 1, 8); n > 0; n--) {
        const range = randomTextRange(rng, client.state.doc);
        if (range) client.createThread(range);
      }
      for (let n = randInt(rng, 1, 10); n > 0; n--) {
        const next = randomTransaction(rng, client.state);
        if (next) client.apply(next.tr);
      }
      for (const thread of listThreads(bare(client.doc)).threads) {
        threads++;
        if (thread.detached) detached++;
        expect([seed, thread.tid, thread.detached]).toEqual([
          seed,
          thread.tid,
          client.resolve(thread.tid) === null,
        ]);
      }
    }
    // Both outcomes are exercised.
    expect(threads).toBeGreaterThan(100);
    expect(detached).toBeGreaterThan(0);
  });
});
