/**
 * The daily-copy thread (P2.6 decision 5). The storage worker starts one per
 * copy; it reads the library through its own read-only connection, so the
 * writer never waits on it, and it yields between batches, so the storage
 * worker can `terminate()` it on quit within milliseconds.
 *
 * Replies once: `{ ok: true, report, ms }` or `{ ok: false, code, message }`.
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

const port = parentPort;
if (!port) throw new Error("the copy worker must run in a worker_thread");
const { source, partial, batchRows } = workerData as CopyWorkerData;
const started = performance.now();

copyLibraryBatched(openNodeSqlite, source, partial, {
  batchRows,
  yieldNow: () => new Promise((resolve) => setImmediate(resolve)),
}).then(
  (report) =>
    port.postMessage({ ok: true, report, ms: performance.now() - started }),
  (error) => {
    const { code, message } = toEnvelope(error);
    port.postMessage({ ok: false, code, message });
  },
);
