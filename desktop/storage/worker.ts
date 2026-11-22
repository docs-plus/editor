/**
 * The storage worker's entry (D-A1): a `worker_thread` inside Electron
 * main, and the only SQLite connection to the library. Main starts it in
 * parallel with the first window and sends it validated requests; it
 * answers them one at a time, in order, so a `flush` or `shutdown` queued
 * behind appends runs after they have committed.
 *
 * Messages: `ready` (or `open_failed`) once, then one `reply` per request,
 * and `index_changed` after a metadata write. Idle jobs run between
 * requests after 30 s without a write: the Trash purge here, and the daily
 * copy in its own thread (`copy-worker.ts`), so a long copy never holds an
 * append or the quit flush.
 *
 * With `trace`, the engine's protocol lines (`BATCH_BEGIN`, `ACK <seq>`,
 * `COMPACT_BEGIN`, `COMPACT_ACK`) go straight to fd 1 with `writeSync`, so
 * the durability soak knows what committed before it kills the process.
 */
import { writeSync } from "node:fs";
import { rm } from "node:fs/promises";
import { parentPort, Worker, workerData } from "node:worker_threads";

import type { CopyWorkerStop } from "./copy-worker";
import { openNodeSqlite } from "./drivers/node-sqlite";
import type { DailyCopyJob } from "./engine/daily-copy";
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

if (!parentPort)
  throw new Error("the storage worker must run in a worker_thread");
const port = parentPort;

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
    idleMs: options.idleMs,
  });
  post({
    type: "ready",
    status: library.status,
    openMs: performance.now() - started,
  });
} catch (error) {
  post({ type: "open_failed", error: toEnvelope(error) });
}

/** Sends `index_changed` if anything the sidebar shows moved. */
function announceChanges(open: Library) {
  const changed = open.takeIndexChanges();
  if (changed) post({ type: "index_changed", ...changed });
}

/** The daily copy running in its own thread, if any (decision 5). */
let copy: { job: DailyCopyJob; thread: Worker } | null = null;

function startCopy(open: Library, job: DailyCopyJob, copyWorkerPath: string) {
  const thread = new Worker(copyWorkerPath, {
    workerData: { source: job.source, partial: job.partial },
  });
  copy = { job, thread };
  const settle = (reason: string | null, ms?: number) => {
    if (copy?.thread !== thread) return;
    copy = null;
    if (!library) return; // shut down meanwhile; shutdown abandoned the job
    try {
      if (reason === null) {
        open.completeDailyCopy(job, ms ?? null);
      } else open.failDailyCopy(job, reason);
    } catch (error) {
      open.failDailyCopy(job, `daily_copy_failed: ${toEnvelope(error).code}`);
    }
    announceChanges(open);
  };
  thread.once("message", (reply: { ok: boolean; code?: string; ms?: number }) =>
    settle(reply.ok ? null : `daily_copy_failed: ${reply.code}`, reply.ms),
  );
  thread.once("error", (error) =>
    settle(`daily_copy_failed: ${String(error)}`),
  );
  thread.once("exit", (code) => settle(`daily_copy_failed: exit ${code}`));
  // A failed copy closed its files before answering; a crashed one may not
  // have, so the engine's own delete can miss on Windows. Retry it.
  thread.once("exit", () => {
    if (copy?.thread !== thread) void removePartial(job.partial);
  });
}

/**
 * Deletes a partial copy, retrying while Windows still reports it busy
 * (a handle closing, Defender or the indexer scanning a fresh file). At
 * most about 420 ms; whatever is left, the next open's sweep removes.
 */
async function removePartial(partial: string): Promise<boolean> {
  try {
    await rm(partial, { force: true, maxRetries: 6, retryDelay: 20 });
    return true;
  } catch {
    return false;
  }
}

/** Resolves with what ended the copy thread, or "timed_out" after `ms`. */
function settleWithin(
  thread: Worker,
  ms: number,
): Promise<"answered" | "exited" | "timed_out"> {
  return new Promise((resolve) => {
    const done = (outcome: "answered" | "exited" | "timed_out") => {
      clearTimeout(guard); // a pending timer would keep this thread alive
      thread.off("message", onMessage);
      thread.off("exit", onExit);
      resolve(outcome);
    };
    const onMessage = () => done("answered");
    const onExit = () => done("exited");
    const guard = setTimeout(() => done("timed_out"), ms);
    thread.once("message", onMessage);
    thread.once("exit", onExit);
  });
}

/**
 * Stops a running copy for quit (decision 5), within about 1.2 s of the 2 s
 * shutdown budget:
 * 1. ask the thread to stop: at its next yield it rolls back and closes its
 *    connection, so no handle holds the partial file (Windows won't delete
 *    an open file), then answers and exits (measured in ms);
 * 2. if it hasn't answered within 500 ms, `terminate()` it (300 ms guard);
 * 3. delete the partial file, retrying while Windows reports it busy.
 * The previous copies are never touched; the next open sweeps any partial
 * still left.
 */
async function stopCopy() {
  const running = copy;
  if (!running) return;
  copy = null;
  const started = performance.now();
  running.thread.postMessage({ type: "stop" } satisfies CopyWorkerStop);
  let outcome: string = await settleWithin(running.thread, 500);
  if (outcome === "timed_out") {
    const exited = settleWithin(running.thread, 300);
    void running.thread.terminate();
    outcome = `terminated_${await exited}`;
  }
  const removed = await removePartial(running.job.partial);
  if (options.trace)
    line(
      `COPY_STOPPED ${outcome} ${Math.round(performance.now() - started)} ${removed ? "removed" : "left"}`,
    );
}

let idleTimer: ReturnType<typeof setInterval> | null = null;
if (library) {
  const open = library;
  idleTimer = setInterval(() => {
    try {
      if (!copy && options.copyWorkerPath) {
        const job = open.beginDailyCopy();
        if (job) startCopy(open, job, options.copyWorkerPath);
      }
      open.purgeExpiredTrash();
    } catch {
      // A failed purge or copy start retries on the next pass.
    }
    announceChanges(open);
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
  const open = library;
  if (request.op === "shutdown") {
    void shutDown(open, request);
    return;
  }
  const result = dispatch(open, request);
  post({ type: "reply", id: request.id, result });
  announceChanges(open);
});

/**
 * The quit flush's last step. Every request sent before it has committed:
 * the writer never waited on the daily copy. Stop the copy, then
 * checkpoint, clear `unclean_exit`, close and release the lock.
 */
async function shutDown(open: Library, request: StorageRequest) {
  if (idleTimer) clearInterval(idleTimer);
  await stopCopy();
  const result = dispatch(open, request);
  library = null;
  post({ type: "reply", id: request.id, result });
  port.close();
}
