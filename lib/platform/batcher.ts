/**
 * The batcher (desktop architecture §5.2, D-A2): sits between a document's
 * Y.Doc and its `DocStore`, shared by desktop and the web library.
 *
 * - Updates are merged per origin and appended 250 ms after the last update,
 *   or 1 s after the first, whichever comes first. `flush()` (blur, hide,
 *   close, quit) sends at once. So a kill loses at most the last second.
 * - One append in flight per document; batches go in order.
 * - A failed append stays queued and is retried in order with backoff, never
 *   skipped (details spec §1 rule 3): a gap would strand every later update.
 * - A refusal no retry can fix (any non-retryable code but `forbidden`,
 *   which a worker restart causes briefly; above all `document_too_large`,
 *   D-O3) halts the batcher: no retry loop runs, the refused batch and
 *   everything after it stay queued and are never dropped, and every
 *   `flush()` rejects with the refusal instead of waiting forever. The
 *   session goes read-only; the open Y.Doc still holds every edit, and
 *   "Copy into a new tab" carries it (stored state doesn't have it).
 * - It counts rows since the snapshot and asks for compaction past 500 rows
 *   or 1 MiB; `compact()` captures the seq and the state in one task, with
 *   no append in flight.
 *
 * No per-keystroke timer churn: a push only arms a timer when none is set;
 * the timer re-checks the deadline when it fires.
 */
import * as Y from "yjs";

import {
  type AppendRecord,
  type CompactResult,
  type DocStore,
  DocStoreError,
  isDocStoreError,
  type LoadedDoc,
  type UpdateOrigin,
} from "@/lib/platform/doc-store";

/** Send this long after the last update… */
export const BATCH_IDLE_MS = 250;
/** …or this long after the first, whichever is sooner. */
export const BATCH_MAX_WAIT_MS = 1000;
/** First retry delay after a failed append; doubles up to `RETRY_MAX_MS` (web library §2.6). */
export const RETRY_BASE_MS = 2000;
export const RETRY_MAX_MS = 60_000;
/** Ask for compaction past this many rows since the snapshot… */
export const COMPACT_MAX_ROWS = 500;
/** …or this many bytes of rows. */
export const COMPACT_MAX_BYTES = 1024 * 1024;
/** Unacked bytes past this are app health `saving_behind` (architecture §6.1). */
export const SAVING_BEHIND_BYTES = 4 * 1024 * 1024;

export type Clock = {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Index metadata sent with an append; computed once per send, never per keystroke. */
export type DocSummary = { title?: string; snippet?: string };

export type BatcherHealth = {
  /** The error the head batch last failed with, while it is being retried. */
  failing: DocStoreError | null;
  /** More than `SAVING_BEHIND_BYTES` not yet acked. */
  behind: boolean;
};

export type BatcherOptions = {
  store: DocStore;
  docId: string;
  /** What `store.load` returned: seeds `ackedSeq` and the row counters. */
  loaded: LoadedDoc;
  clock?: Clock;
  describe?: () => DocSummary;
  /** Called when `failing` or `behind` changes. */
  onHealth?: (health: BatcherHealth) => void;
  /** Called once when compaction is due, until `compact()` runs. */
  onCompactDue?: () => void;
};

type Batch = {
  origin: UpdateOrigin;
  parts: Uint8Array[];
  bytes: number;
  schemaTo?: number;
  firstAt: number;
  sending: boolean;
  waiters: Waiter[];
};

type Waiter = { resolve(): void; reject(error: DocStoreError): void };

export class Batcher {
  private readonly store: DocStore;
  private readonly docId: string;
  private readonly clock: Clock;
  private readonly options: BatcherOptions;

  private readonly queue: Batch[] = [];
  private lastPushAt = 0;
  private sending = false;
  private urgent = false;
  private paused = false;
  private disposed = false;
  private timer: unknown = null;
  private retryTimer: unknown = null;
  private retries = 0;
  /** Stopped at the size cap: nothing is sent until `retryNow()`. */
  private halted = false;
  private idleWaiters: (() => void)[] = [];

  private acked: number;
  private unacked = 0;
  private rows: { seq: number; bytes: number }[];
  private rowBytes: number;
  private compactAsked = false;
  private health: BatcherHealth = { failing: null, behind: false };

  constructor(options: BatcherOptions) {
    this.options = options;
    this.store = options.store;
    this.docId = options.docId;
    this.clock = options.clock ?? systemClock;
    this.acked = options.loaded.maxSeq;
    this.rows = options.loaded.updates.map((update) => ({
      seq: options.loaded.maxSeq,
      bytes: update.byteLength,
    }));
    this.rowBytes = this.rows.reduce((sum, row) => sum + row.bytes, 0);
  }

  /** The highest seq loaded or acked: what a compaction may cover. */
  get ackedSeq(): number {
    return this.acked;
  }

  /** Bytes pushed and not yet acked, including the append in flight. */
  get unackedBytes(): number {
    return this.unacked;
  }

  get rowsSinceSnapshot(): number {
    return this.rows.length;
  }

  push(origin: UpdateOrigin, update: Uint8Array, schemaTo?: number): void {
    if (this.disposed) return;
    const now = this.clock.now();
    let tail = this.queue.at(-1);
    if (!tail || tail.sending || tail.origin !== origin) {
      tail = {
        origin,
        parts: [],
        bytes: 0,
        firstAt: now,
        sending: false,
        waiters: [],
      };
      this.queue.push(tail);
    }
    tail.parts.push(update);
    tail.bytes += update.byteLength;
    if (schemaTo !== undefined) {
      tail.schemaTo = Math.max(tail.schemaTo ?? schemaTo, schemaTo);
    }
    this.unacked += update.byteLength;
    this.lastPushAt = now;
    this.updateHealth({ behind: this.unacked > SAVING_BEHIND_BYTES });
    this.kick();
  }

  /**
   * Sends everything queued now; resolves once all of it is acked. Rejects
   * with the refusal when the batcher is (or becomes) halted.
   */
  flush(): Promise<void> {
    const target = this.queue.at(-1);
    if (!target || this.disposed) return Promise.resolve();
    if (this.halted && this.health.failing)
      return Promise.reject(this.health.failing);
    this.urgent = true;
    this.clearTimer();
    const done = new Promise<void>((resolve, reject) =>
      target.waiters.push({ resolve, reject }),
    );
    this.kick();
    return done;
  }

  /** True while stopped at the size cap (`document_too_large`). */
  get isHalted(): boolean {
    return this.halted;
  }

  /** Retries a failed batch at once (after the person frees space, say). */
  retryNow(): void {
    if (this.retryTimer === null && !this.halted) return;
    this.halted = false;
    if (this.retryTimer !== null) this.clock.clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.urgent = true;
    this.kick();
  }

  /**
   * Compacts: waits until no append is in flight, then, in one task, takes
   * the highest acked seq and `encode()`s the state (architecture §5.2).
   * Batches still queued are in the state and are appended later with a
   * larger seq; the overlap is harmless.
   */
  async compact(encode: () => Uint8Array): Promise<CompactResult> {
    this.paused = true;
    try {
      while (this.sending) {
        await new Promise<void>((resolve) => this.idleWaiters.push(resolve));
      }
    } finally {
      this.paused = false;
    }
    const upToSeq = this.acked;
    const state = encode();
    this.kick();
    const result = await this.store.compact(this.docId, state, upToSeq);
    this.rows = this.rows.filter((row) => row.seq > upToSeq);
    this.rowBytes = this.rows.reduce((sum, row) => sum + row.bytes, 0);
    this.compactAsked = false;
    return result;
  }

  /** Stops every timer. Queued batches are dropped: flush first. */
  dispose(): void {
    this.disposed = true;
    this.clearTimer();
    if (this.retryTimer !== null) this.clock.clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  /** Sends the head batch if it is due, or arms a timer for when it will be. */
  private kick(): void {
    if (this.disposed || this.sending || this.paused || this.halted) return;
    if (this.retryTimer !== null || this.timer !== null) return;
    const head = this.queue[0];
    if (!head) return;
    const closed = this.queue.length > 1; // a later batch exists, so head can't grow
    const due =
      this.urgent || closed
        ? 0
        : Math.min(
            this.lastPushAt + BATCH_IDLE_MS,
            head.firstAt + BATCH_MAX_WAIT_MS,
          );
    const wait = due - this.clock.now();
    if (wait > 0) {
      this.timer = this.clock.setTimeout(() => {
        this.timer = null;
        this.kick();
      }, wait);
      return;
    }
    this.send(head);
  }

  private send(batch: Batch): void {
    batch.sending = true;
    this.sending = true;
    // Merged once and kept, so a retry resends the same bytes.
    if (batch.parts.length > 1) batch.parts = [Y.mergeUpdates(batch.parts)];
    const record: AppendRecord = {
      origin: batch.origin,
      update: batch.parts[0],
      ...this.options.describe?.(),
    };
    if (batch.schemaTo !== undefined) record.schemaTo = batch.schemaTo;
    this.store.append(this.docId, record).then(
      (seq) => this.onAck(batch, seq, record.update.byteLength),
      (error: unknown) => this.onFail(batch, error),
    );
  }

  private onAck(batch: Batch, seq: number, bytes: number): void {
    this.queue.shift();
    this.sending = false;
    this.retries = 0;
    this.acked = Math.max(this.acked, seq);
    this.unacked -= batch.bytes;
    this.rows.push({ seq, bytes });
    this.rowBytes += bytes;
    if (this.queue.length === 0) this.urgent = false;
    this.updateHealth({
      failing: null,
      behind: this.unacked > SAVING_BEHIND_BYTES,
    });
    for (const waiter of batch.waiters) waiter.resolve();
    this.wakeIdle();
    if (
      !this.compactAsked &&
      (this.rows.length > COMPACT_MAX_ROWS || this.rowBytes > COMPACT_MAX_BYTES)
    ) {
      this.compactAsked = true;
      this.options.onCompactDue?.();
    }
    this.kick();
  }

  private onFail(batch: Batch, error: unknown): void {
    batch.sending = false;
    this.sending = false;
    const failing = isDocStoreError(error)
      ? error
      : new DocStoreError("io_error", String(error));
    this.updateHealth({ failing });
    this.wakeIdle();
    if (this.disposed) return;
    // A refusal no retry can fix: stop, keep every batch, and answer every
    // flush with it. `forbidden` is the exception: a worker restart causes
    // it until main replays its registry.
    if (!failing.retryable && failing.code !== "forbidden") {
      this.halted = true;
      for (const queued of this.queue) {
        for (const waiter of queued.waiters) waiter.reject(failing);
        queued.waiters = [];
      }
      return;
    }
    const backoff = Math.min(RETRY_BASE_MS * 2 ** this.retries, RETRY_MAX_MS);
    this.retries++;
    this.retryTimer = this.clock.setTimeout(() => {
      this.retryTimer = null;
      this.kick();
    }, backoff);
  }

  private wakeIdle(): void {
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const resolve of waiters) resolve();
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    this.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  private updateHealth(change: Partial<BatcherHealth>): void {
    const next = { ...this.health, ...change };
    if (
      next.failing === this.health.failing &&
      next.behind === this.health.behind
    ) {
      return;
    }
    this.health = next;
    this.options.onHealth?.(next);
  }
}
