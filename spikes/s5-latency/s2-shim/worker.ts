// TEMPORARY stand-in for spikes/s2-storage/worker.ts (open, loop-start, loop-stop).

import type { DatabaseSync } from "node:sqlite";
import { parentPort } from "node:worker_threads";

import { startCommitLoop } from "./commit-loop";
import { openDatabase } from "./engine";

const port = parentPort;
if (!port) throw new Error("worker.cjs must run in a worker thread");
let db: DatabaseSync | null = null;
let loop: ReturnType<typeof startCommitLoop> | null = null;

port.on(
  "message",
  (r: { id: number; type: string; path?: string; size?: number }) => {
    try {
      let result: unknown = null;
      if (r.type === "open")
        db = openDatabase({ path: r.path ?? "", synchronous: "FULL" });
      else if (r.type === "loop-start" && db)
        loop = startCommitLoop(db, r.size ?? 4096);
      else if (r.type === "loop-stop") {
        result = loop?.stop() ?? null;
        loop = null;
      } else if (r.type === "close") db?.close();
      port.postMessage({ id: r.id, ok: true, result });
    } catch (error) {
      port.postMessage({ id: r.id, ok: false, error: String(error) });
    }
  },
);
