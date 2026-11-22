/**
 * The quit coordinator (desktop architecture §6.3, §8.2). Main owns quitting;
 * a page can never veto it.
 *
 * #106: the web app's unsynced-edits guard is a vetoing `beforeunload`. In
 * Electron a veto cancels the window close silently, and `app.quit()` with
 * it, so the app kept running with no window on all three OSes. On desktop
 * the edits are durable in main's storage, so the shell never relies on
 * `beforeunload`: it asks each window to flush through the bridge
 * (`app.flushRequested`), and `index.ts` ignores every unload veto.
 *
 * Phases: running → flushing (every window answers `app.flushed`, or 3 s)
 * → shutdown (worker checkpoint and close, or terminated after 2 s) →
 * exiting. A watchdog exits after the whole budget plus a margin, whatever
 * is still pending, so a quit always ends. Re-entrant: a second request
 * (`before-quit` again, `quitAndInstall`) is ignored past `running`.
 *
 * Electron-free: everything it touches is injected.
 */

export type QuitPhase = "running" | "flushing" | "shutdown" | "exiting";
export type FlushReason = "quit" | "close";

export const FLUSH_BUDGET_MS = 3000;
export const SHUTDOWN_BUDGET_MS = 2000;
/** Past this, the watchdog exits whatever is pending. */
export const WATCHDOG_MS = FLUSH_BUDGET_MS + SHUTDOWN_BUDGET_MS + 1000;

export type QuitMark =
  | "quit_start"
  | "flush_done"
  | "flush_timeout"
  | "storage_closed"
  | "exit"
  | "watchdog_exit";

export type QuitDeps = {
  /** Windows to flush: each gets `app.flushRequested`. */
  windowIds: () => number[];
  requestFlush: (
    windowId: number,
    requestId: number,
    reason: FlushReason,
  ) => void;
  shutdownStorage: (timeoutMs: number) => Promise<string>;
  exit: (code: number) => void;
  now: () => number;
  setTimer: (ms: number, run: () => void) => { cancel(): void };
  mark?: (mark: QuitMark, fields: Record<string, number | string>) => void;
};

type PendingFlush = {
  waiting: Set<number>;
  done: () => void;
};

export class QuitCoordinator {
  phase: QuitPhase = "running";
  private nextRequestId = 1;
  private readonly flushes = new Map<number, PendingFlush>();
  private startedAt = 0;
  private running: Promise<void> | null = null;

  constructor(private readonly deps: QuitDeps) {}

  private elapsed(): number {
    return Math.round(this.deps.now() - this.startedAt);
  }

  private mark(mark: QuitMark, fields: Record<string, number | string> = {}) {
    try {
      this.deps.mark?.(mark, { ms: this.elapsed(), ...fields });
    } catch {
      // Nothing in a quit path may throw.
    }
  }

  /**
   * Asks `windowIds` to flush and resolves when each has answered, or after
   * `budgetMs`. Resolves with how many never answered.
   */
  flushWindows(
    windowIds: number[],
    reason: FlushReason,
    budgetMs = FLUSH_BUDGET_MS,
  ): Promise<number> {
    if (windowIds.length === 0) return Promise.resolve(0);
    const requestId = this.nextRequestId++;
    return new Promise<number>((resolve) => {
      const waiting = new Set(windowIds);
      let timer: { cancel(): void } | null = null;
      const finish = () => {
        if (!this.flushes.delete(requestId)) return;
        timer?.cancel();
        resolve(waiting.size);
      };
      this.flushes.set(requestId, { waiting, done: finish });
      timer = this.deps.setTimer(budgetMs, finish);
      for (const windowId of windowIds) {
        try {
          this.deps.requestFlush(windowId, requestId, reason);
        } catch {
          // A window that is gone can't answer; drop it from the wait.
          waiting.delete(windowId);
        }
      }
      if (waiting.size === 0) finish();
    });
  }

  /** A window answered `app.flushed`. Unknown ids are ignored. */
  confirmFlushed(windowId: number, requestId: number): void {
    const pending = this.flushes.get(requestId);
    if (!pending) return;
    pending.waiting.delete(windowId);
    if (pending.waiting.size === 0) pending.done();
  }

  /** A window closed mid-flush: stop waiting for it. */
  forgetWindow(windowId: number): void {
    for (const pending of [...this.flushes.values()]) {
      if (pending.waiting.delete(windowId) && pending.waiting.size === 0)
        pending.done();
    }
  }

  /** Runs the quit sequence once; later calls return the same promise. */
  quit(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.run();
    return this.running;
  }

  private async run(): Promise<void> {
    this.phase = "flushing";
    this.startedAt = this.deps.now();
    const windows = this.deps.windowIds();
    this.mark("quit_start", { windows: windows.length });
    let exited = false;
    const watchdog = this.deps.setTimer(WATCHDOG_MS, () => {
      this.mark("watchdog_exit", { phase: this.phase });
      exited = true;
      this.phase = "exiting";
      this.deps.exit(0);
    });

    try {
      const unanswered = await this.flushWindows(windows, "quit");
      this.mark(unanswered === 0 ? "flush_done" : "flush_timeout", {
        unanswered,
      });
    } catch {
      this.mark("flush_timeout", { unanswered: -1 });
    }

    this.phase = "shutdown";
    let outcome = "terminated";
    try {
      outcome = await this.deps.shutdownStorage(SHUTDOWN_BUDGET_MS);
    } catch {
      outcome = "failed";
    }
    this.mark("storage_closed", { outcome });

    if (exited) return; // the watchdog already exited
    this.phase = "exiting";
    watchdog.cancel();
    this.mark("exit");
    this.deps.exit(0);
  }
}
