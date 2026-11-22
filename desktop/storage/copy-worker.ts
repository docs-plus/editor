/**
 * The daily-copy thread (P2.6 decision 5). The storage worker starts one per
 * copy; it reads the library through its own read-only connection, so the
 * writer never waits on it, and it yields between batches.
 *
 * Stopping: the storage worker sends `{ type: "stop" }`. The next yield
 * throws, `copyLibraryBatched` rolls back and closes its connection (and the
 * read-only attach), and only then does this thread answer and exit. On
 * Windows a file stays undeletable while any handle is open, so the copy
 * must close its own handles before the storage worker removes the partial
 * file: `terminate()` alone skips that `finally` and is only the fallback.
 *
 * Replies once: `{ ok: true, report, ms }`, `{ ok: false, code, message }`, or
 * `{ ok: false, code: "stopped" }` after a stop.
 */
import { parentPort, workerData } from "node:worker_threads";

import { openNodeSqlite } from "./drivers/node-sqlite";
import { copyLibraryBatched } from "./engine/copy-library";
import { toEnvelope } from "./engine/errors";

export type CopyWorkerData = {
  source: string;
  partial: string;
  batchRows?: number;
};

/** What the storage worker sends to stop a copy. */
export type CopyWorkerStop = { type: "stop" };

const port = parentPort;
if (!port) throw new Error("the copy worker must run in a worker_thread");
const { source, partial, batchRows } = workerData as CopyWorkerData;
const started = performance.now();

class Stopped extends Error {}

let stopRequested = false;
port.on("message", (message: CopyWorkerStop) => {
  if (message.type === "stop") stopRequested = true;
});

const finish = (reply: Record<string, unknown>) => {
  port.postMessage(reply);
  port.close();
};

copyLibraryBatched(openNodeSqlite, source, partial, {
  batchRows,
  yieldNow: () =>
    new Promise<void>((resolve, reject) =>
      setImmediate(() => (stopRequested ? reject(new Stopped()) : resolve())),
    ),
}).then(
  (report) => finish({ ok: true, report, ms: performance.now() - started }),
  (error) => {
    if (error instanceof Stopped) return finish({ ok: false, code: "stopped" });
    const { code, message } = toEnvelope(error);
    finish({ ok: false, code, message });
  },
);
