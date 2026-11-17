/**
 * The storage worker's entry (D-A1): a `worker_thread` inside Electron
 * main, and the only SQLite connection to the library. Main starts it in
 * parallel with the first window and sends it validated requests; it
 * answers them one at a time, in order, so a `flush` or `shutdown` queued
 * behind appends runs after they have committed.
 *
 * Messages: `ready` (or `open_failed`) once, then one `reply` per request,
 * and `index_changed` after a metadata write. Idle jobs (daily copy, Trash)
 * run between requests after 30 s without a write.
 *
 * With `trace`, the engine's protocol lines (`BATCH_BEGIN`, `ACK <seq>`,
 * `COMPACT_BEGIN`, `COMPACT_ACK`) go straight to fd 1 with `writeSync`, so
 * the durability soak knows what committed before it kills the process.
 */
import { writeSync } from "node:fs";
import { parentPort, workerData } from "node:worker_threads";

import { openNodeSqlite } from "./drivers/node-sqlite";
import { toEnvelope } from "./engine/errors";
import { Library } from "./engine/library";
import { createNodeHost } from "./node-host";
import {
  dispatch,
  type StorageMessage,
  type StorageRequest,
  type StorageWorkerOptions,
  transferablesOf,
} from "./protocol";

const port = parentPort;
if (!port) throw new Error("the storage worker must run in a worker_thread");

const options = workerData as StorageWorkerOptions;

const post = (message: StorageMessage) => {
  port.postMessage(
    message,
    message.type === "reply" && message.result.ok
      ? transferablesOf(message.result.value)
      : [],
  );
};

const line = (text: string) => {
  writeSync(1, `${text}\n`);
};

let library: Library | null = null;
const started = performance.now();
try {
  library = Library.open({
    dir: options.dir,
    host: createNodeHost(),
    openSqlite: openNodeSqlite,
    fullfsync: options.fullfsync,
    synchronous: options.synchronous,
    trace: options.trace ? line : undefined,
  });
  post({
    type: "ready",
    status: library.status,
    openMs: performance.now() - started,
  });
} catch (error) {
  post({ type: "open_failed", error: toEnvelope(error) });
}

let idleTimer: ReturnType<typeof setInterval> | null = null;
if (library) {
  const open = library;
  idleTimer = setInterval(() => {
    try {
      open.runIdleJobs();
    } catch {
      // A failed daily copy is reported through stats; the library is fine.
    }
  }, options.idlePollMs ?? 5000);
  idleTimer.unref();
}

port.on("message", (request: StorageRequest) => {
  if (!library) {
    post({
      type: "reply",
      id: request.id,
      result: {
        ok: false,
        error: {
          code: "library_unavailable",
          retryable: true,
          message: "the library did not open",
        },
      },
    });
    return;
  }
  const { result, rev } = dispatch(library, request);
  post({ type: "reply", id: request.id, result });
  if (rev !== null) post({ type: "index_changed", rev });
  if (request.op === "shutdown") {
    if (idleTimer) clearInterval(idleTimer);
    library = null;
    port.close();
  }
});
