/**
 * Main's handle on the storage worker (desktop architecture §2, §6.3).
 * `doc-handlers` (P2.5) forwards validated `doc.*` and `index.*` calls
 * through {@link StorageClient.call}; the quit coordinator ends with
 * {@link StorageClient.shutdown}.
 *
 * Bytes in a request are transferred, not copied. If the worker dies, every
 * pending call rejects with `worker_restarting`, which the renderer's
 * batcher retries (resending an append is harmless).
 */
import { Worker } from "node:worker_threads";

import type { StorageErrorEnvelope } from "./engine/errors";
import type { LibraryStatus } from "./engine/library";
import {
  type StorageMessage,
  type StorageOp,
  type StorageOps,
  type StorageWorkerOptions,
  transferablesOf,
} from "./protocol";

export class StorageCallError extends Error {
  readonly code: StorageErrorEnvelope["code"];
  readonly retryable: boolean;
  constructor(envelope: StorageErrorEnvelope) {
    super(envelope.message);
    this.name = "StorageCallError";
    this.code = envelope.code;
    this.retryable = envelope.retryable;
  }
}

type Pending = { resolve(value: unknown): void; reject(error: Error): void };

export type StorageClientEvents = {
  onIndexChanged?: (rev: number) => void;
  /** The worker exited without being asked to (crash). */
  onExit?: (code: number) => void;
};

export class StorageClient {
  readonly status: LibraryStatus;
  /** Worker spawn to `ready`, and the open alone inside it. */
  readonly timings: { readyMs: number; openMs: number };
  private readonly worker: Worker;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private closing = false;

  private constructor(
    worker: Worker,
    status: LibraryStatus,
    timings: { readyMs: number; openMs: number },
    events: StorageClientEvents,
  ) {
    this.worker = worker;
    this.status = status;
    this.timings = timings;
    worker.on("message", (message: StorageMessage) => {
      if (message.type === "reply") {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.result.ok) pending.resolve(message.result.value);
        else pending.reject(new StorageCallError(message.result.error));
      } else if (message.type === "index_changed") {
        events.onIndexChanged?.(message.rev);
      }
    });
    worker.on("exit", (code) => {
      this.failPending();
      if (!this.closing) events.onExit?.(code);
    });
  }

  /**
   * Starts the worker and waits for `ready`. Rejects with the open error
   * (`cloud_folder`, `locked_elsewhere`, `corrupt`…) if the library can't
   * open; a read-only library still resolves, with `status.readOnly` set.
   */
  static start(
    workerPath: string,
    options: StorageWorkerOptions,
    events: StorageClientEvents = {},
  ): Promise<StorageClient> {
    const started = performance.now();
    const worker = new Worker(workerPath, { workerData: options });
    return new Promise((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      worker.once("error", onError);
      worker.once("message", (message: StorageMessage) => {
        worker.off("error", onError);
        if (message.type === "ready") {
          resolve(
            new StorageClient(
              worker,
              message.status,
              {
                readyMs: performance.now() - started,
                openMs: message.openMs,
              },
              events,
            ),
          );
        } else if (message.type === "open_failed") {
          void worker.terminate();
          reject(new StorageCallError(message.error));
        } else {
          void worker.terminate();
          reject(new Error(`unexpected first message ${message.type}`));
        }
      });
    });
  }

  call<K extends StorageOp>(
    op: K,
    args: StorageOps[K]["args"],
  ): Promise<StorageOps[K]["result"]> {
    if (this.closing && op !== "shutdown")
      return Promise.reject(
        new StorageCallError({
          code: "library_unavailable",
          retryable: false,
          message: "the library is closing",
        }),
      );
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.worker.postMessage({ id, op, args }, transferablesOf(args));
    });
  }

  /**
   * The quit flush's last step (architecture §8.2): every call already sent
   * commits first, then the worker checkpoints, clears `unclean_exit` and
   * closes. After `timeoutMs` it is terminated; WAL keeps every committed
   * row, and the next open runs `quick_check`.
   */
  async shutdown(timeoutMs = 2000): Promise<"clean" | "terminated"> {
    if (this.closing) return "clean";
    this.closing = true;
    const exited = new Promise<void>((resolve) =>
      this.worker.once("exit", () => resolve()),
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"terminated">((resolve) => {
      timer = setTimeout(() => resolve("terminated"), timeoutMs);
    });
    const clean = this.call("shutdown", {})
      .then(() => exited)
      .then(() => "clean" as const);
    const outcome = await Promise.race([clean, timeout]).catch(
      () => "terminated" as const,
    );
    clearTimeout(timer);
    if (outcome === "terminated") await this.worker.terminate();
    return outcome;
  }

  private failPending() {
    for (const pending of this.pending.values())
      pending.reject(
        new StorageCallError({
          code: "worker_restarting",
          retryable: true,
          message: "the storage worker stopped",
        }),
      );
    this.pending.clear();
  }
}
