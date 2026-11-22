/**
 * Convergence (comments design §10): three clients make interleaved random
 * edits, comments and re-anchors, and exchange updates in random orders
 * with random delays. After a full sync every client resolves every thread
 * to the same range and status.
 */
import { describe, expect, it } from "bun:test";

import * as Y from "yjs";

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

const REMOTE = "remote";

function network(seed: number) {
  const rng = seededRng(seed);
  const first = createHarnessClient({
    content: randomDocument(rng),
    author: testAuthor("A".repeat(22)),
  });
  const clients: HarnessClient[] = [first];
  for (const letter of ["B", "C"]) {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(first.doc), REMOTE);
    clients.push(
      createHarnessClient({ doc, author: testAuthor(letter.repeat(22)) }),
    );
  }
  /** queues[from][to]: updates in flight. */
  const queues = clients.map(() => clients.map(() => [] as Uint8Array[]));
  clients.forEach((client, from) => {
    client.doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === REMOTE) return;
      clients.forEach((_, to) => {
        if (to !== from) queues[from][to].push(update);
      });
    });
  });

  const deliverOne = (): boolean => {
    const pending: [number, number][] = [];
    queues.forEach((row, from) => {
      row.forEach((queue, to) => {
        if (queue.length) pending.push([from, to]);
      });
    });
    if (!pending.length) return false;
    const [from, to] = pickOne(rng, pending);
    // Random order within a channel too: Yjs keeps what it can't apply yet.
    const queue = queues[from][to];
    const [update] = queue.splice(randInt(rng, 0, queue.length - 1), 1);
    const client = clients[to];
    Y.applyUpdate(client.doc, update, REMOTE);
    client.reload();
    client.refreshRanges();
    return true;
  };

  const act = () => {
    const client = pickOne(rng, clients);
    const roll = rng();
    if (roll < 0.55) {
      const next = randomTransaction(rng, client.state);
      if (next) client.apply(next.tr);
    } else if (roll < 0.75) {
      const range = randomTextRange(rng, client.state.doc);
      if (range) client.createThread(range);
    } else {
      const threads = readThreads(client.store.map);
      if (!threads.length) return;
      const thread = pickOne(rng, threads);
      if (roll < 0.9) client.store.reply(thread.tid, "a reply");
      else client.store.setResolved(thread.tid, !thread.status?.r);
    }
  };

  return { rng, clients, deliverOne, act };
}

function resolvedView(client: HarnessClient) {
  client.reload();
  return readThreads(client.store.map).map((thread) => ({
    tid: thread.tid,
    resolved: thread.status?.r ?? false,
    messages: thread.messages.length,
    range: client.resolve(thread.tid),
  }));
}

describe("comment convergence", () => {
  for (let seed = 1; seed <= 40; seed++) {
    it(`seed ${seed}: three clients agree after a full sync`, () => {
      const { rng, clients, deliverOne, act } = network(seed);
      const steps = randInt(rng, 20, 60);
      for (let step = 0; step < steps; step++) {
        act();
        // Random delays: deliver none, one or a few updates per step.
        for (let index = randInt(rng, 0, 3); index > 0; index--) deliverOne();
      }
      while (deliverOne()) {
        // Drain every queue.
      }
      const views = clients.map(resolvedView);
      const text = clients.map((client) => client.state.doc.toJSON());
      expect(text[1]).toEqual(text[0]);
      expect(text[2]).toEqual(text[0]);
      expect(views[1]).toEqual(views[0]);
      expect(views[2]).toEqual(views[0]);
      for (const client of clients) client.doc.destroy();
    });
  }
});
