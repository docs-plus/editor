/**
 * Client-server agreement (comments design §4.2, §10): every update the
 * comments client produces passes the server's checks, so an honest client
 * is never refused into a reconnect loop (K4). The server side here is
 * `tests/helpers/comment-update-check.ts`, built on the shared per-entry
 * check; P4.2f-2's `validate.ts` must accept the same updates.
 */
import { describe, expect, it } from "bun:test";

import * as Y from "yjs";

import { CLIENT_LIMITS, type CommentLimits } from "@/lib/comments/limits";
import { liveBytes } from "@/lib/comments/measure";
import { anchorKey, messageKey } from "@/lib/comments/model";
import { readThreads } from "@/lib/comments/threads";

import {
  pickOne,
  randInt,
  randomDocument,
  randomTextRange,
  randomTransaction,
  seededRng,
} from "../../../helpers/comment-fuzz-ops";
import {
  createHarnessClient,
  type HarnessClient,
  testAuthor,
} from "../../../helpers/comment-harness";
import { checkCommentUpdate } from "../../../helpers/comment-update-check";

const NOW = Date.UTC(2026, 10, 16);
const REMOTE = "server";
/** Stands in for many writers: one client allowed past the client cap. */
const CROWD = { ...CLIENT_LIMITS, threads: 400, messages: 10_000 };

/** Adds threads through `writer` until the server holds `count`. */
function fillTo(
  server: Y.Doc,
  writer: HarnessClient,
  count: number,
  rng: () => number,
) {
  for (
    let tries = 0;
    readThreads(server.getMap("comments")).length < count;
    tries++
  ) {
    if (tries > count * 4) throw new Error("could not fill");
    const range = randomTextRange(rng, writer.state.doc);
    if (range) writer.createThread(range, "x");
  }
}

/** A client whose every update goes through the server check first. */
function connect(
  server: Y.Doc,
  author = testAuthor(),
  manager = false,
  limits?: CommentLimits,
) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(server), REMOTE);
  const refusals: string[] = [];
  doc.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE) return;
    const reason = checkCommentUpdate(update, server, NOW);
    if (reason) refusals.push(reason);
  });
  const client = createHarnessClient({
    doc,
    author,
    canManageAll: () => manager,
    limits,
  });
  return { client, refusals };
}

function seededServer(seed: number): Y.Doc {
  const seedClient = createHarnessClient({
    content: randomDocument(seededRng(seed)),
  });
  const server = new Y.Doc();
  Y.applyUpdate(server, Y.encodeStateAsUpdate(seedClient.doc));
  return server;
}

function randomAction(rng: () => number, client: HarnessClient) {
  const roll = rng();
  const threads = readThreads(client.store.map);
  const thread = threads.length ? pickOne(rng, threads) : null;
  if (roll < 0.35 || !thread) {
    const next = randomTransaction(rng, client.state);
    if (next) client.apply(next.tr);
  } else if (roll < 0.5) {
    const range = randomTextRange(rng, client.state.doc);
    if (range) client.createThread(range, "Is this right?\nSecond line.");
  } else if (roll < 0.62) {
    client.store.reply(thread.tid, "Agreed.");
  } else if (roll < 0.7) {
    const live = thread.messages.filter((message) => !("del" in message));
    if (live.length)
      client.store.edit(thread.tid, pickOne(rng, live).mid, "Edited.");
  } else if (roll < 0.8) {
    const message = pickOne(rng, thread.messages);
    client.store.deleteMessage(thread.tid, message.mid);
  } else if (roll < 0.9) {
    client.store.setResolved(thread.tid, !thread.status?.r);
  } else {
    client.store.deleteThread(thread.tid);
  }
}

describe("client-server agreement", () => {
  for (let seed = 1; seed <= 30; seed++) {
    it(`seed ${seed}: random histories from two authors all pass`, () => {
      const rng = seededRng(seed);
      const server = seededServer(seed);
      const ann = connect(server, testAuthor("A".repeat(22)), true);
      const bo = connect(server, testAuthor("B".repeat(22)), false);
      const sync = () => {
        for (const peer of [ann, bo]) {
          Y.applyUpdate(peer.client.doc, Y.encodeStateAsUpdate(server), REMOTE);
          peer.client.reload();
          peer.client.refreshRanges();
        }
      };
      for (let step = 0; step < randInt(rng, 40, 80); step++) {
        randomAction(rng, pickOne(rng, [ann, bo]).client);
        if (rng() < 0.3) sync();
      }
      expect(ann.refusals).toEqual([]);
      expect(bo.refusals).toEqual([]);
    });
  }

  it("passes ranges at a block's start and end", () => {
    const server = seededServer(7);
    const { client, refusals } = connect(server);
    const block = client.state.doc.child(1);
    const start = client.state.doc.child(0).nodeSize + 1;
    expect(client.createThread({ from: start, to: start + 2 })).not.toBeNull();
    const end = start + block.content.size;
    expect(client.createThread({ from: end - 2, to: end })).not.toBeNull();
    expect(refusals).toEqual([]);
  });

  it("lets the sharer delete someone else's message", () => {
    const server = seededServer(3);
    const bo = connect(server, testAuthor("B".repeat(22)));
    const range = randomTextRange(seededRng(1), bo.client.state.doc);
    const tid = range && bo.client.createThread(range);
    if (!tid) throw new Error("no thread");
    const reply = bo.client.store.reply(tid, "mine");
    if (!reply.ok) throw new Error("no reply");
    const sharer = connect(server, testAuthor("S".repeat(22)), true);
    expect(sharer.client.store.deleteMessage(tid, reply.mid)).toEqual({
      ok: true,
    });
    expect(sharer.client.store.deleteThread(tid).ok).toBe(true);
    expect([...bo.refusals, ...sharer.refusals]).toEqual([]);
  });

  it("never grows the byte count over 1,000 re-anchors", () => {
    const server = seededServer(5);
    const { client, refusals } = connect(server);
    const range = randomTextRange(seededRng(2), client.state.doc);
    const tid = range && client.createThread(range);
    if (!tid || !range) throw new Error("no thread");
    const anchors = client.store.map.get(anchorKey(tid)) as {
      s: Uint8Array;
      e: Uint8Array;
    };
    client.store.setAnchors(tid, anchors, "reanchor");
    const after = liveBytes(client.store.map);
    for (let index = 0; index < 1000; index++) {
      client.store.setAnchors(tid, anchors, "reanchor");
    }
    expect(liveBytes(client.store.map)).toBe(after);
    expect(liveBytes(server.getMap("comments"))).toBe(after);
    expect(refusals).toEqual([]);
  });
});

describe("offline catch-up (§4.2, §7.3)", () => {
  /** A client that writes offline and sends one diff on reconnect. */
  function offline(server: Y.Doc, author = testAuthor()) {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(server));
    const client = createHarnessClient({ doc, author });
    return {
      client,
      reconnect: () => {
        const update = Y.encodeStateAsUpdate(doc, Y.encodeStateVector(server));
        return checkCommentUpdate(update, server, NOW);
      },
    };
  }

  it("takes 30 comments written offline in one update", () => {
    const server = seededServer(11);
    const { client, reconnect } = offline(server);
    const rng = seededRng(4);
    for (let index = 0; index < 30; index++) {
      const range = randomTextRange(rng, client.state.doc);
      if (range) client.createThread(range, `note ${index}`);
    }
    expect(readThreads(client.store.map).length).toBeGreaterThan(20);
    expect(reconnect()).toBeNull();
  });

  it("refuses a cap crossed offline as comments_full; deleting then retrying passes", () => {
    const server = seededServer(12);
    const rng = seededRng(9);
    // 290 threads on the server, synced to the offline client.
    const filler = connect(
      server,
      testAuthor("F".repeat(22)),
      true,
      CROWD,
    ).client;
    fillTo(server, filler, 290, rng);
    const away = offline(server, testAuthor("O".repeat(22)));
    // Meanwhile others reach 320, the server's cap.
    fillTo(server, filler, 320, rng);
    const mine: string[] = [];
    for (let index = 0; index < 10; index++) {
      const range = randomTextRange(rng, away.client.state.doc);
      const tid = range && away.client.createThread(range, "offline");
      if (tid) mine.push(tid);
    }
    const before = Y.encodeStateAsUpdate(server);
    expect(away.reconnect()).toMatch(/^comments_full/);
    // A refused update is not applied: the server is unchanged.
    expect(Y.encodeStateAsUpdate(server)).toEqual(before);
    for (const tid of mine) away.client.store.deleteThread(tid);
    expect(away.reconnect()).toBeNull();
    expect(server.getMap("comments").has(messageKey(mine[0], mine[0]))).toBe(
      false,
    );
  });

  it("keeps concurrent creates at 299 threads within the server's 320", () => {
    const server = seededServer(13);
    const rng = seededRng(10);
    const filler = connect(
      server,
      testAuthor("F".repeat(22)),
      true,
      CROWD,
    ).client;
    fillTo(server, filler, 299, rng);
    const peers = ["A", "B", "C"].map((letter) =>
      offline(server, testAuthor(letter.repeat(22))),
    );
    for (const peer of peers) {
      const range = randomTextRange(rng, peer.client.state.doc);
      expect(
        range && peer.client.createThread(range, "at the same time"),
      ).toBeTruthy();
    }
    for (const peer of peers) expect(peer.reconnect()).toBeNull();
    expect(readThreads(server.getMap("comments")).length).toBe(302);
  });
});
