/**
 * Child process for `batcher-kill.test.ts`. Types into a Y.Doc through a real
 * `Batcher` on real timers. Its `DocStore` sends every append to the parent,
 * which is the durable side: an append is saved once the parent has it, and
 * acked back. The parent SIGKILLs this process mid-typing.
 *
 * Messages to the parent: `{ t: "push", token, at }` before each update is
 * handed to the batcher, `{ t: "append", id, update }` (base64) per append.
 * From the parent: `{ t: "ack", id, seq }`. Pass `steady` to type with no
 * pause long enough to trigger the idle flush.
 */
import * as Y from "yjs";

import { Batcher } from "@/lib/platform/batcher";
import type { AppendRecord, DocStore } from "@/lib/platform/doc-store";

type Ack = { t: "ack"; id: number; seq: number };

const send = (message: unknown) => process.send?.(message);
const waiting = new Map<number, (seq: number) => void>();
let nextId = 1;

process.on("message", (message: Ack) => {
  if (message.t !== "ack") return;
  waiting.get(message.id)?.(message.seq);
  waiting.delete(message.id);
});

const parentStore: DocStore = {
  load: async () => ({ snapshot: null, updates: [], maxSeq: 0, schema: 1 }),
  append: (_docId: string, record: AppendRecord) =>
    new Promise<number>((resolve) => {
      const id = nextId++;
      waiting.set(id, resolve);
      send({
        t: "append",
        id,
        update: Buffer.from(record.update).toString("base64"),
      });
    }),
  compact: async () => ({ foreign: null }),
  close: async () => {},
  flush: async () => {},
};

const doc = new Y.Doc();
const batcher = new Batcher({
  store: parentStore,
  docId: "kill",
  loaded: await parentStore.load("kill"),
});
doc.on("update", (update: Uint8Array) => batcher.push("local", update));

/** `steady`: no pause ever reaches the idle delay, so only the 1 s cap saves. */
const steady = process.argv[2] === "steady";
let n = 0;
function typeNext(): void {
  const token = `<${n++}>`;
  send({ t: "push", token, at: Date.now() });
  doc.getText("t").insert(doc.getText("t").length, token);
  // Bursts with pauses, some longer than the 250 ms idle delay.
  const pause = !steady && Math.random() < 0.1;
  const gap = pause ? 300 + Math.random() * 500 : Math.random() * 60;
  setTimeout(typeNext, gap);
}
send({ t: "ready" });
typeNext();
