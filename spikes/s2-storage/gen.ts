// Deterministic Yjs edit generator shared by Electron main (bundled) and the
// Bun kill harness. Update `seq` depends only on (seed, seq) and on the text
// before it, so a document rebuilt from the database and the harness's
// reference produce the same edits after a relaunch.
import { createHash } from "node:crypto";

import * as Y from "yjs";

export const CLIENT_ID = 1;
const ALPHABET = "abcdefghijklmnopqrstuvwxyz      .,\n";

const mulberry32 = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const randomText = (rand: () => number, length: number) => {
  const chunks: string[] = [];
  for (let i = 0; i < length; i += 1) {
    chunks.push(ALPHABET[Math.floor(rand() * ALPHABET.length)] as string);
  }
  return chunks.join("");
};

/** Applies edit `seq` to `doc` as a local transaction and returns its update. */
export const applyEdit = (
  doc: Y.Doc,
  seed: number,
  seq: number,
  seedBytes: number,
): Uint8Array => {
  if (doc.clientID !== CLIENT_ID) {
    throw new Error(`generator doc must use clientID ${CLIENT_ID}`);
  }
  const rand = mulberry32(seed * 1_000_003 + seq);
  const text = doc.getText("t");
  let update: Uint8Array | null = null;
  const capture = (u: Uint8Array) => {
    update = u;
  };
  doc.once("update", capture);
  doc.transact(() => {
    if (seq === 1) {
      text.insert(0, randomText(rand, seedBytes));
      return;
    }
    const length = text.length;
    if (length > 64 && rand() < 0.2) {
      const at = Math.floor(rand() * (length - 50));
      text.delete(at, 1 + Math.floor(rand() * 50));
    } else {
      const at = Math.floor(rand() * (length + 1));
      text.insert(at, randomText(rand, 1 + Math.floor(rand() * 200)));
    }
  });
  if (update === null) throw new Error(`edit ${seq} produced no update`);
  return update;
};

export const textHash = (doc: Y.Doc): string =>
  createHash("sha256").update(doc.getText("t").toString()).digest("hex");

export const newGeneratorDoc = () => {
  const doc = new Y.Doc();
  doc.clientID = CLIENT_ID;
  return doc;
};
