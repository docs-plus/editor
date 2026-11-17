/**
 * Spike quit flow (#106). Main owns quitting; a page can't veto it.
 *
 * 1. Pages never veto a close. The web app's unsynced-edits guard
 *    (`useUnsyncedChangesGuard`, a `beforeunload` with preventDefault) is
 *    right in a browser tab, where unsynced edits live only in the page. In
 *    Electron a vetoing `beforeunload` cancels the close silently (no
 *    dialog), which also cancels app.quit(): the app keeps running with no
 *    window. On desktop the edits are durable in main's storage, so main
 *    ignores the veto (`will-prevent-unload` -> preventDefault) and logs it.
 * 2. Windows close first (renderer unload), so every update a renderer sent
 *    before unloading is already in main's queue. Then `will-quit` is held
 *    once while the registered flushers run (storage: drain the commit queue,
 *    close the database), bounded by FLUSH_BUDGET_MS.
 * 3. A watchdog started on the first quit request calls app.exit() after
 *    HARD_BUDGET_MS, whatever is still pending, so quit always ends.
 * 4. Nothing in a quit path may throw: an uncaught exception in main shows
 *    a modal error box (Windows, macOS, Linux) and the process never exits.
 *
 * SPIKE_QUIT_FLOW=0 disables all of it (S1/S5 behaviour, #106 "before").
 */
import { performance } from "node:perf_hooks";

import { app, ipcMain } from "electron";

export const FLUSH_BUDGET_MS = Number(
  process.env.SPIKE_QUIT_FLUSH_BUDGET_MS ?? 1500,
);
export const HARD_BUDGET_MS = Number(
  process.env.SPIKE_QUIT_HARD_BUDGET_MS ?? 3000,
);

type Flusher = { name: string; run: () => Promise<unknown> };
const flushers: Flusher[] = [];

/** Work that must finish before the process exits (storage flush). */
export function onQuitFlush(name: string, run: () => Promise<unknown>): void {
  flushers.push({ name, run });
}

let startedAt = 0;
const log = (event: string, extra: Record<string, unknown> = {}) => {
  if (process.env.SPIKE_QUIT_LOG !== "1") return;
  const ms = startedAt
    ? Math.round((performance.now() - startedAt) * 10) / 10
    : null;
  console.log(`[quit-flow] ${JSON.stringify({ event, ms, ...extra })}`);
};

export const quitFlowEnabled = process.env.SPIKE_QUIT_FLOW !== "0";

export function installQuitFlow(): void {
  // Spike evidence for the ordering claim in step 2: a renderer's pagehide
  // IPC should arrive before its window's "closed" event.
  ipcMain.on("spike.pagehide", (_e, href: string) =>
    log("renderer-pagehide", { href: href.slice(0, 40) }),
  );
  if (!quitFlowEnabled) return;

  let phase: "running" | "closing" | "flushing" | "done" = "running";

  app.on("web-contents-created", (_e, wc) => {
    wc.on("will-prevent-unload", (event) => {
      event.preventDefault();
      log("unload-veto-ignored", { phase });
    });
  });

  app.on("before-quit", () => {
    if (phase !== "running") return;
    phase = "closing";
    startedAt = performance.now();
    log("start");
    setTimeout(() => {
      log("watchdog-exit", { phase });
      app.exit(0);
    }, HARD_BUDGET_MS).unref();
  });

  app.on("will-quit", (event) => {
    if (phase === "done") return;
    if (phase === "flushing") {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    phase = "flushing";
    log("flush-start", { flushers: flushers.map((f) => f.name) });
    const timeout = new Promise<"timeout">((r) =>
      setTimeout(() => r("timeout"), FLUSH_BUDGET_MS).unref(),
    );
    const all = Promise.allSettled(
      flushers.map(async (f) => {
        const t = performance.now();
        await f.run();
        log("flushed", {
          name: f.name,
          took: Math.round(performance.now() - t),
        });
      }),
    );
    void Promise.race([all, timeout])
      .then((result) => {
        if (result === "timeout")
          log("flush-timeout", { budget: FLUSH_BUDGET_MS });
        else
          for (const r of result)
            if (r.status === "rejected")
              log("flush-failed", { error: String(r.reason) });
      })
      .finally(() => {
        phase = "done";
        log("exit");
        app.quit();
      });
  });
}
