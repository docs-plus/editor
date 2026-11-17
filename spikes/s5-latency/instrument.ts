// Spike S5 instrumentation for Electron main, loaded before S1's shell.
//
// S5_MODE picks the load on main while the renderer types:
// - idle: nothing
// - worker-commits: S2's storage worker runs back-to-back 4 KB commits
// - main-commits: S2's same commit loop on main's own thread (D-A1)
// Both open the database with S2's pragmas (WAL, synchronous FULL, and
// fullfsync + checkpoint_fullfsync on macOS).
//
// The runner drives it through `globalThis.__s5` (Playwright's
// electronApp.evaluate runs in this process). Bun inlines `__dirname` at
// build time, so paths come from app.getAppPath() (dist/).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { Worker } from "node:worker_threads";

import { app } from "electron";

import { onQuitFlush } from "../s1-shell/quit";
import { startCommitLoop } from "../s2-storage/commit-loop";
import { openDatabase } from "../s2-storage/engine";

type Mode = "idle" | "worker-commits" | "main-commits";
const mode = (process.env.S5_MODE ?? "idle") as Mode;
const COMMIT_SIZE = 4096;
/** monitorEventLoopDelay sampling interval (ms). The histogram records the
 * whole interval between samples, so an idle loop reads about this value. */
const ELD_RESOLUTION_MS = 1;
/** The Chrome arms' viewport. */
const CONTENT_SIZE = { width: 1280, height: 720 };

// Playwright adds these to Chrome; _electron.launch does not. Same flags in
// every arm, so an occluded window doesn't throttle only the Electron arms.
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-background-timer-throttling");

const dir = mkdtempSync(join(tmpdir(), "s5-latency-"));
// S1 reads this when its module body runs (after this one): a fresh device
// copy per launch.
process.env.TINYDOCY_USER_DATA ??= join(dir, "user-data");
const dbPath = join(dir, "storage.sqlite");

app.on("browser-window-created", (_event, win) => {
  win.setContentSize(CONTENT_SIZE.width, CONTENT_SIZE.height);
});

interface CommitStats {
  commits: number;
  commitsPerSecond: number;
  [key: string]: unknown;
}

interface Load {
  stop(): Promise<CommitStats | null>;
}

const workerLoad = async (): Promise<Load> => {
  const worker = new Worker(join(app.getAppPath(), "worker.cjs"));
  let failure: Error | null = null;
  const pending = new Set<(e: Error) => void>();
  const fail = (e: Error) => {
    failure = e;
    for (const reject of pending) reject(e);
  };
  worker.on("error", fail);
  worker.on("exit", (code) =>
    fail(new Error(`storage worker exited (${code})`)),
  );
  let next = 0;
  const call = (msg: Record<string, unknown>) =>
    new Promise<unknown>((resolve, reject) => {
      if (failure) return reject(failure);
      pending.add(reject);
      const id = ++next;
      const onMessage = (r: {
        id: number;
        ok: boolean;
        result?: unknown;
        error?: string;
      }) => {
        if (r.id !== id) return;
        worker.off("message", onMessage);
        pending.delete(reject);
        if (r.ok) resolve(r.result);
        else reject(new Error(r.error));
      };
      worker.on("message", onMessage);
      worker.postMessage({ ...msg, id });
    });
  await call({ type: "open", path: dbPath, synchronous: "FULL" });
  await call({ type: "loop-start", size: COMMIT_SIZE });
  return {
    stop: async () => {
      const stats = (await call({ type: "loop-stop" })) as CommitStats;
      await call({ type: "close" });
      await worker.terminate();
      return stats;
    },
  };
};

const mainLoad = (): Load => {
  const db = openDatabase({ path: dbPath, synchronous: "FULL" });
  const loop = startCommitLoop(db, COMMIT_SIZE);
  return {
    stop: async () => {
      const stats = loop.stop() as unknown as CommitStats;
      db.close();
      return stats;
    },
  };
};

const histogram = monitorEventLoopDelay({ resolution: ELD_RESOLUTION_MS });
let load: Load | null = null;
const ms = (ns: number) => Math.round((ns / 1e6) * 1000) / 1000;

const s5 = {
  mode,
  versions: { ...process.versions },
  eldResolutionMs: ELD_RESOLUTION_MS,
  async start() {
    if (mode === "worker-commits") load = await workerLoad();
    else if (mode === "main-commits") load = mainLoad();
    histogram.reset();
    histogram.enable();
  },
  async stop() {
    histogram.disable();
    const eld = {
      p50: ms(histogram.percentile(50)),
      p99: ms(histogram.percentile(99)),
      max: ms(histogram.max),
      mean: ms(histogram.mean),
      count: histogram.count,
    };
    const commits = load ? await load.stop() : null;
    load = null;
    return { eld, commits };
  },
  /** Sanity check for the histogram: block main for `forMs`. */
  busyWait(forMs: number) {
    const end = performance.now() + forMs;
    while (performance.now() < end) {
      // spin
    }
  },
};
(globalThis as unknown as { __s5: typeof s5 }).__s5 = s5;

// #106 flush-before-quit: a running storage load is drained and its database
// closed before the process exits (S1's quit flow holds will-quit for it).
onQuitFlush("storage", async () => {
  const running = load;
  load = null;
  const stats = running ? await running.stop() : null;
  if (process.env.SPIKE_QUIT_LOG === "1")
    console.log(
      `[s5] ${JSON.stringify({ event: "storage-closed", commits: stats?.commits ?? 0 })}`,
    );
});

// #106: on Windows Chromium still holds files in userData (inside `dir`)
// when "quit" fires, so rmSync throws EBUSY/EPERM. An uncaught exception in
// main shows Electron's modal error box, and the process never exits. Never
// throw from a quit handler; the runner removes what's left after exit.
// S5_CLEANUP=throw keeps the original handler (the #106 "before" arm).
app.on("quit", () => {
  if (process.env.S5_CLEANUP === "throw") {
    console.log("[s5] cleanup start");
    rmSync(dir, { recursive: true, force: true });
    console.log("[s5] cleanup done");
    return;
  }
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (error) {
    console.log(`[s5] cleanup left ${dir}: ${(error as Error).message}`);
  }
});

// S5_SELFTEST=1: start the arm's load, stop it after a second, print, quit.
if (process.env.S5_SELFTEST === "1") {
  void app.whenReady().then(async () => {
    try {
      await s5.start();
      await new Promise((r) => setTimeout(r, 1000));
      console.log(JSON.stringify(await s5.stop()));
    } catch (error) {
      console.log("selftest failed:", error);
    }
    app.quit();
  });
}
