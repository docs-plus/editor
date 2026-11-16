// Spike S5: typing latency in Electron against Chrome for Testing of the same
// major, and the D-A1 commit arms (storage commits in a worker vs on main).
//
// Two measures per keystroke, both recorded in every arm:
// - observer: perf-observer's keydown `timeStamp` -> input-event microtask.
//   CDP-dispatched keys are stamped when main hands them on, so this can't
//   see a stall on Electron's main thread. Used for Electron vs Chrome.
// - runner: the runner's Date.now() just before it sends the key -> the
//   renderer's Date.now() in the input-event microtask (one machine clock).
//   Includes any wait on main. Used for the commit arms vs electron-idle.
//
// Each round runs every arm once, in a rotated order; each trial is a fresh
// launch. p95 per trial (warm-up keys dropped), then the median of rounds.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { arch, cpus, loadavg, platform, release } from "node:os";
import { join, resolve } from "node:path";

import {
  _electron,
  type CDPSession,
  chromium,
  type ElectronApplication,
  expect,
  type Page,
  test,
} from "@playwright/test";
import type { JSONContent } from "@tiptap/core";

import { EditorPage } from "../../tests/e2e/helpers/editor-page";
import {
  collectKeystrokeLatencies,
  injectKeystrokeTimer,
  median,
  percentile,
  waitForMainThreadIdle,
} from "../../tests/e2e/helpers/perf-observer";
import { generateLargeDocument } from "../../tests/helpers/document-generators";

const ALL_ARMS = [
  "chrome",
  "chrome-control",
  "electron-idle",
  "electron-worker-commits",
  "electron-main-commits",
] as const;
type Arm = (typeof ALL_ARMS)[number];

const env = process.env;
const ARMS = (env.S5_ARMS?.split(",") as Arm[] | undefined) ?? [...ALL_ARMS];
const HEADINGS = (env.PERF_HEADINGS ?? "50,500").split(",").map(Number);
const ROUNDS = Number(env.PERF_ROUNDS ?? 7);
const CPU_THROTTLE = Number(env.PERF_CPU_THROTTLE ?? 4);
const KEYSTROKES = Number(env.KEYSTROKES ?? 220);
const WARMUP_KEYSTROKES = Number(env.WARMUP_KEYSTROKES ?? 20);
/** The Chrome arms load out/ over http (serve-out.ts). */
const BASE_URL = env.S5_BASE_URL ?? "http://127.0.0.1:3900";
/** The Electron arms load out/ through S1's shell, on its own origin. */
const ELECTRON_BASE_URL = env.S5_ELECTRON_BASE_URL ?? "app://tinydocy";
const MACHINE = env.S5_MACHINE ?? `${platform()}-${arch()}`;
const HERE = import.meta.dirname ?? __dirname;
const RESULTS = resolve(HERE, "results");
const MAIN_CJS = join(HERE, "dist", "main.cjs");

const electronPath = () => {
  if (env.ELECTRON_PATH) return env.ELECTRON_PATH;
  const dir = join(HERE, "node_modules", "electron");
  return join(dir, "dist", readFileSync(join(dir, "path.txt"), "utf8").trim());
};
const chromePath = () => {
  if (!env.CHROME_PATH) throw new Error("CHROME_PATH (Chrome for Testing 156)");
  return env.CHROME_PATH;
};

type ElectronWindow = Window & { __runner_stamps?: number[] };

/** Renderer Date.now() in the input-event microtask, one per keystroke. */
const injectRunnerClockStamp = (page: Page) =>
  page.addInitScript(() => {
    const w = window as ElectronWindow;
    w.__runner_stamps = [];
    window.addEventListener("input", () => {
      queueMicrotask(() => {
        w.__runner_stamps?.push(Date.now());
      });
    });
  });

const takeRunnerStamps = (page: Page) =>
  page.evaluate(() => {
    const w = window as ElectronWindow;
    const stamps = w.__runner_stamps ?? [];
    w.__runner_stamps = [];
    return stamps;
  });

interface MainStats {
  eld: { p50: number; p99: number; max: number; mean: number; count: number };
  commits: { commits: number; commitsPerSecond: number } | null;
}

type S5Global = typeof globalThis & {
  __s5: {
    start(): Promise<void>;
    stop(): Promise<MainStats>;
    busyWait(ms: number): void;
    eldResolutionMs: number;
    versions: Record<string, string>;
  };
};

interface Session {
  page: Page;
  cdp(): Promise<CDPSession>;
  app?: ElectronApplication;
  version: string;
  close(): Promise<void>;
}

const open = async (arm: Arm): Promise<Session> => {
  if (arm.startsWith("chrome")) {
    const browser = await chromium.launch({
      executablePath: chromePath(),
      headless: false,
      args: ["--window-size=1280,800"],
    });
    const context = await browser.newContext({
      baseURL: BASE_URL,
      viewport: { width: 1280, height: 720 },
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    return {
      page,
      cdp: () => context.newCDPSession(page),
      version: `Chrome for Testing ${browser.version()}`,
      close: () => browser.close(),
    };
  }
  const mode = arm.replace("electron-", "");
  const app = await _electron.launch({
    executablePath: electronPath(),
    args: [MAIN_CJS],
    env: { ...env, S5_MODE: mode } as Record<string, string>,
  });
  const page = await app.firstWindow();
  // EditorPage navigates to "/"; an Electron context has no baseURL.
  const goto = page.goto.bind(page);
  page.goto = (url, options) =>
    goto(new URL(url, ELECTRON_BASE_URL).href, options);
  const versions = await app.evaluate(
    () => (globalThis as S5Global).__s5.versions,
  );
  return {
    page,
    app,
    cdp: () => app.context().newCDPSession(page),
    version: `Electron ${versions.electron} (Chromium ${versions.chrome}, Node ${versions.node})`,
    close: () => app.close(),
  };
};

interface Trial {
  arm: Arm;
  observerP95: number;
  runnerP95: number;
  main: MainStats | null;
  load1m: number;
  visible: boolean;
  focused: boolean;
  version: string;
}

const runTrial = async (arm: Arm, doc: JSONContent): Promise<Trial> => {
  const s = await open(arm);
  try {
    const { page } = s;
    await injectKeystrokeTimer(page);
    await injectRunnerClockStamp(page);
    const editorPage = new EditorPage(page);
    await editorPage.goto();
    await editorPage.waitForSync();
    await editorPage.setContent(doc);
    await expect(
      page.getByRole("toolbar", { name: "Formatting", exact: true }),
    ).toBeVisible();
    const cdp = await s.cdp();
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_THROTTLE });
    await page.click(".tiptap p");
    await waitForMainThreadIdle(page);
    const { visible, focused } = await page.evaluate(() => ({
      visible: document.visibilityState === "visible",
      focused: document.hasFocus(),
    }));
    await collectKeystrokeLatencies(page);
    await takeRunnerStamps(page);
    await s.app?.evaluate(() => (globalThis as S5Global).__s5.start());

    const sent: number[] = [];
    for (let i = 0; i < KEYSTROKES; i++) {
      sent.push(Date.now());
      await page.keyboard.press("a", { delay: 10 });
    }

    const main =
      (await s.app?.evaluate(() => (globalThis as S5Global).__s5.stop())) ??
      null;
    const observer = await collectKeystrokeLatencies(page);
    const stamps = await takeRunnerStamps(page);
    expect(observer.length, `${arm} observer samples`).toBe(KEYSTROKES);
    expect(stamps.length, `${arm} runner samples`).toBe(KEYSTROKES);
    const runner = stamps.map((t, i) => t - (sent[i] ?? t));
    return {
      arm,
      observerP95: percentile(observer.slice(WARMUP_KEYSTROKES), 95),
      runnerP95: percentile(runner.slice(WARMUP_KEYSTROKES), 95),
      main,
      load1m: loadavg()[0] ?? 0,
      visible,
      focused,
      version: s.version,
    };
  } finally {
    await s.close();
  }
};

const round2 = (n: number) => Math.round(n * 100) / 100;

test.describe("spike S5 typing latency", () => {
  test.describe.configure({ mode: "serial" });

  test("monitorEventLoopDelay sees a 50 ms stall on Electron main", async () => {
    const s = await open("electron-idle");
    try {
      const app = s.app as ElectronApplication;
      await app.evaluate(() => (globalThis as S5Global).__s5.start());
      await new Promise((r) => setTimeout(r, 200));
      await app.evaluate(() => (globalThis as S5Global).__s5.busyWait(50));
      await new Promise((r) => setTimeout(r, 200));
      const { eld } = await app.evaluate(() =>
        (globalThis as S5Global).__s5.stop(),
      );
      console.log(`eld sanity: ${JSON.stringify(eld)}`);
      expect(eld.max).toBeGreaterThanOrEqual(45);
      expect(eld.count).toBeGreaterThan(50);
    } finally {
      await s.close();
    }
  });

  for (const n of HEADINGS) {
    test(`arms at ${n} headings`, async () => {
      const doc = generateLargeDocument(n, { shape: "flat" });
      // A discarded warm-up trial per arm (first-launch caches).
      for (const arm of ARMS) await runTrial(arm, doc);
      const trials: Trial[] = [];
      for (let round = 0; round < ROUNDS; round++) {
        const order = ARMS.map(
          (_, i) => ARMS[(i + round) % ARMS.length] as Arm,
        );
        for (const arm of order) {
          const t = await runTrial(arm, doc);
          console.log(
            `n=${n} r=${round} ${arm}: observer p95 ${t.observerP95.toFixed(1)} runner p95 ${t.runnerP95.toFixed(1)}` +
              (t.main
                ? ` eld p99 ${t.main.eld.p99} max ${t.main.eld.max}` +
                  (t.main.commits
                    ? ` commits/s ${t.main.commits.commitsPerSecond.toFixed(0)}`
                    : "")
                : "") +
              ` load ${t.load1m.toFixed(1)} visible ${t.visible} focused ${t.focused}`,
          );
          trials.push({ ...t });
        }
      }

      const byArm = Object.fromEntries(
        ARMS.map((arm) => {
          const ts = trials.filter((t) => t.arm === arm);
          const eldP99 = ts.flatMap((t) => (t.main ? [t.main.eld.p99] : []));
          const eldMax = ts.flatMap((t) => (t.main ? [t.main.eld.max] : []));
          const cps = ts.flatMap((t) =>
            t.main?.commits ? [t.main.commits.commitsPerSecond] : [],
          );
          return [
            arm,
            {
              version: ts[0]?.version,
              observer: {
                rounds: ts.map((t) => round2(t.observerP95)),
                median: median(ts.map((t) => t.observerP95)),
              },
              runner: {
                rounds: ts.map((t) => t.runnerP95),
                median: median(ts.map((t) => t.runnerP95)),
              },
              eldP99: eldP99.length
                ? {
                    rounds: eldP99,
                    median: median(eldP99),
                    worst: Math.max(...eldP99),
                  }
                : null,
              eldMax: eldMax.length
                ? { rounds: eldMax, worst: Math.max(...eldMax) }
                : null,
              commitsPerSecond: cps.length
                ? {
                    rounds: cps.map(Math.round),
                    median: Math.round(median(cps)),
                  }
                : null,
              load1m: ts.map((t) => round2(t.load1m)),
              allVisible: ts.every((t) => t.visible),
              allFocused: ts.every((t) => t.focused),
            },
          ];
        }),
      ) as Record<
        Arm,
        {
          observer: { median: number };
          runner: { median: number };
          eldP99: { worst: number } | null;
        }
      >;

      const ratio = (a: number | undefined, b: number | undefined) =>
        a !== undefined && b ? round2(a / b) : null;
      const ratios = {
        "electron-idle / chrome (observer)": ratio(
          byArm["electron-idle"]?.observer.median,
          byArm.chrome?.observer.median,
        ),
        "chrome-control / chrome (observer, noise floor)": ratio(
          byArm["chrome-control"]?.observer.median,
          byArm.chrome?.observer.median,
        ),
        "electron-idle / chrome (runner)": ratio(
          byArm["electron-idle"]?.runner.median,
          byArm.chrome?.runner.median,
        ),
        "chrome-control / chrome (runner, noise floor)": ratio(
          byArm["chrome-control"]?.runner.median,
          byArm.chrome?.runner.median,
        ),
        "worker-commits / idle (runner)": ratio(
          byArm["electron-worker-commits"]?.runner.median,
          byArm["electron-idle"]?.runner.median,
        ),
        "main-commits / idle (runner)": ratio(
          byArm["electron-main-commits"]?.runner.median,
          byArm["electron-idle"]?.runner.median,
        ),
        "main-commits / idle (observer)": ratio(
          byArm["electron-main-commits"]?.observer.median,
          byArm["electron-idle"]?.observer.median,
        ),
      };
      console.log(
        `n=${n} summary ${JSON.stringify({ byArm, ratios }, null, 2)}`,
      );

      mkdirSync(RESULTS, { recursive: true });
      writeFileSync(
        join(RESULTS, `s5-${MACHINE}-${n}h-${Date.now()}.json`),
        JSON.stringify(
          {
            timestamp: new Date().toISOString(),
            machine: MACHINE,
            os: `${platform()} ${release()} ${arch()}`,
            cpu: cpus()[0]?.model,
            cpuCount: cpus().length,
            headings: n,
            rounds: ROUNDS,
            cpuThrottle: CPU_THROTTLE,
            keystrokes: KEYSTROKES,
            warmupKeystrokes: WARMUP_KEYSTROKES,
            arms: ARMS,
            byArm,
            ratios,
            trials,
          },
          null,
          2,
        ),
      );
    });
  }
});
