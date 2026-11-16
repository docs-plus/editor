// The storage worker: owns the only connection and runs one request at a
// time, in arrival order.
import type { DatabaseSync } from "node:sqlite";
import { parentPort } from "node:worker_threads";

import { runCommitLoop, startCommitLoop } from "./commit-loop";
import {
  appendBatch,
  compact,
  ensureDoc,
  inspect,
  load,
  openDatabase,
  type Row,
  readPragmas,
  type Synchronous,
} from "./engine";

export type Request =
  | {
      id: number;
      type: "open";
      path: string;
      synchronous: Synchronous;
      fullfsync?: boolean;
    }
  | { id: number; type: "append"; docId: string; rows: Row[] }
  | {
      id: number;
      type: "compact";
      docId: string;
      seq: number;
      snapshot: Uint8Array;
    }
  | { id: number; type: "load"; docId: string }
  | { id: number; type: "inspect"; docId: string }
  | { id: number; type: "commit-loop"; count: number; size: number }
  | { id: number; type: "loop-start"; size: number }
  | { id: number; type: "loop-stop" }
  | { id: number; type: "close" };

if (!parentPort) throw new Error("worker.cjs must run in a worker thread");
const port = parentPort;
let db: DatabaseSync | null = null;
let loop: ReturnType<typeof startCommitLoop> | null = null;

const need = () => {
  if (!db) throw new Error("database is not open");
  return db;
};

port.on("message", (request: Request) => {
  try {
    let result: unknown = null;
    switch (request.type) {
      case "open":
        db = openDatabase(request);
        result = readPragmas(db);
        break;
      case "append":
        ensureDoc(need(), request.docId);
        appendBatch(need(), request.docId, request.rows);
        break;
      case "compact":
        compact(need(), request.docId, request.seq, request.snapshot);
        break;
      case "load":
        result = load(need(), request.docId);
        break;
      case "inspect":
        result = inspect(need(), request.docId);
        break;
      case "commit-loop":
        result = runCommitLoop(need(), request.count, request.size);
        break;
      case "loop-start":
        loop = startCommitLoop(need(), request.size);
        break;
      case "loop-stop":
        result = loop?.stop() ?? null;
        loop = null;
        break;
      case "close":
        db?.close();
        db = null;
        break;
    }
    port.postMessage({ id: request.id, ok: true, result });
  } catch (error) {
    port.postMessage({ id: request.id, ok: false, error: String(error) });
  }
});
