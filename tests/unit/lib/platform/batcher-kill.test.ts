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

type ChildMessage =
  | { t: "ready" }
  | { t: "push"; token: string; at: number }
  | { t: "append"; id: number; update: string };

async function typeThenKill(runMs: number, mode: "bursty" | "steady") {
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
  await new Promise((r) => setTimeout(r, runMs));
  const killAt = Date.now();
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
        const due = [...pushedAt].filter(
          ([, at]) => at <= killAt - BATCH_MAX_WAIT_MS - JITTER_MS,
        );
        expect(due.length).toBeGreaterThan(5);
        const lost = due.filter(([token]) => !saved.includes(token));
        expect(lost).toEqual([]);
        // Sanity: the kill really landed mid-typing.
        expect(pushedAt.size).toBeGreaterThan(due.length);
      }
    },
    { timeout: 20_000 },
  );
});
