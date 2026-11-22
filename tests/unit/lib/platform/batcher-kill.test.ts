/**
 * Exit criterion of desktop plan P2.1: a kill during a batch loses at most
 * the unflushed window (≤ 1 s). A real process types through a `Batcher` and
 * is SIGKILLed mid-typing; its appends live in this (parent) process, so
 * they survive the kill the way committed rows survive in the storage worker.
 */
import { describe, expect, it } from "bun:test";
import path from "node:path";

import * as Y from "yjs";

import { BATCH_MAX_WAIT_MS } from "@/lib/platform/batcher";

const CHILD = path.join(import.meta.dir, "fixtures/batcher-kill-child.ts");
/** Timer lateness and IPC delay on a loaded CI runner. */
const JITTER_MS = 250;
/** Tokens that must be past the 1 s window before the kill, so the check means something. */
const MIN_DUE = 10;
/** The child must have typed this recently, so the kill lands mid-typing. */
const TYPING_NOW_MS = 200;
/** Gives up on a child too starved to type (a clear failure, not a hang). */
const MAX_EXTRA_WAIT_MS = 6000;

type ChildMessage =
  | { t: "ready" }
  | { t: "push"; token: string; at: number }
  | { t: "append"; id: number; update: string };

/** Tokens typed early enough that the batcher must have saved them by `now`. */
const dueAt = (pushedAt: Map<string, number>, now: number) =>
  [...pushedAt].filter(([, at]) => at <= now - BATCH_MAX_WAIT_MS - JITTER_MS);

/**
 * Lets the child type for at least `minRunMs`, then SIGKILLs it at the first
 * moment when at least MIN_DUE tokens are past the 1 s window and it is still
 * typing. The kill time follows what the child actually typed, never an
 * assumed typing rate, so a slow runner only makes the run longer.
 */
async function typeThenKill(minRunMs: number, mode: "bursty" | "steady") {
  const pushedAt = new Map<string, number>();
  const saved = new Y.Doc();
  let seq = 0;
  let onReady = () => {};
  const ready = new Promise<void>((resolve) => {
    onReady = resolve;
  });

  const child = Bun.spawn({
    cmd: [process.execPath, CHILD, mode],
    cwd: path.resolve(import.meta.dir, "../../../.."),
    stdout: "inherit",
    stderr: "inherit",
    ipc(message: ChildMessage, subprocess) {
      if (message.t === "ready") onReady();
      if (message.t === "push") {
        pushedAt.set(message.token, message.at);
      }
      if (message.t === "append") {
        // Durable from here on: this process outlives the kill.
        Y.applyUpdate(saved, Buffer.from(message.update, "base64"));
        subprocess.send({ t: "ack", id: message.id, seq: ++seq });
      }
    },
  });

  await ready;
  const started = Date.now();
  let killAt = 0;
  for (;;) {
    await new Promise((r) => setTimeout(r, 20));
    const now = Date.now();
    const lastPush = Math.max(0, ...pushedAt.values());
    if (
      now - started >= minRunMs &&
      dueAt(pushedAt, now).length >= MIN_DUE &&
      now - lastPush <= TYPING_NOW_MS
    ) {
      killAt = now;
      break;
    }
    if (now - started > minRunMs + MAX_EXTRA_WAIT_MS) {
      child.kill("SIGKILL");
      throw new Error(
        `child typed ${pushedAt.size} tokens in ${now - started} ms; too few to test the bound`,
      );
    }
  }
  child.kill("SIGKILL");
  await child.exited;
  return { pushedAt, saved: saved.getText("t").toString(), killAt };
}

describe("Batcher under SIGKILL", () => {
  it(
    "loses only what was typed in the last second",
    async () => {
      const runs = [
        [2200, "steady"],
        [2800, "bursty"],
        [3400, "steady"],
      ] as const;
      for (const [runMs, mode] of runs) {
        const { pushedAt, saved, killAt } = await typeThenKill(runMs, mode);
        const due = dueAt(pushedAt, killAt);
        expect(due.length).toBeGreaterThanOrEqual(MIN_DUE);
        const lost = due.filter(([token]) => !saved.includes(token));
        expect(lost).toEqual([]);
        // Sanity: the kill really landed mid-typing.
        expect(pushedAt.size).toBeGreaterThan(due.length);
      }
    },
    // Three runs of 2–3 s plus Bun start-up, which grows with runner load.
    { timeout: 40_000 },
  );
});
