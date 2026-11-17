// Spike #106 runner, no Playwright: a loopback Hocus (temp DB, production's
// 2 MiB cap, throttle off), then one Electron launch per trial. Each trial
// loads the shell, types, asks it to quit and times the exit on this
// process's clock. A trial that hasn't exited after QUIT_TIMEOUT_MS is
// killed and counted as hung. Every server is local; never the live site.
//
//   bun spikes/quit/run.ts                  # the default matrix
//   QUIT_MATRIX=before,after bun spikes/quit/run.ts
//
// Results: spikes/quit/results/<machine>.json (+ the raw lines per trial).
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { arch, platform, tmpdir } from "node:os";
import { join, resolve } from "node:path";

const HERE = import.meta.dir;
const root = resolve(HERE, "../..");
const HOCUS_PORT = 1290; // baked into the export (NEXT_PUBLIC_HOCUS_URL)
const TIMEOUT_MS = Number(process.env.QUIT_TIMEOUT_MS ?? 20_000);
const REPS = Number(process.env.QUIT_REPS ?? 3);
const MACHINE = process.env.QUIT_MACHINE ?? `${platform()}-${arch()}`;

interface Arm {
  name: string;
  env: Record<string, string>;
}

/** before: S5's code as it ran. after: the quit flow + safe temp cleanup. */
const FLOW_OFF = { SPIKE_QUIT_FLOW: "0", S5_CLEANUP: "throw" };
const FLOW_ON = { SPIKE_QUIT_FLOW: "1", S5_CLEANUP: "safe" };
const ARMS: Record<string, Arm> = {
  "before-idle-launch": {
    name: "before: launch, no doc, no typing, quit",
    env: {
      ...FLOW_OFF,
      QUIT_HEADINGS: "0",
      QUIT_KEYS: "0",
      QUIT_THROTTLE: "1",
    },
  },
  "before-50": {
    name: "before: 50 headings, 4x, 220 keys, quit",
    env: { ...FLOW_OFF, QUIT_HEADINGS: "50" },
  },
  before: {
    name: "before: 500 headings, 4x, 220 keys, quit",
    env: { ...FLOW_OFF },
  },
  "before-close": {
    name: "before: 500 headings, 4x, 220 keys, close window",
    env: { ...FLOW_OFF, QUIT_VIA: "window-close" },
  },
  "before-no-throttle": {
    name: "before: 500 headings, no throttle, 220 keys, quit",
    env: { ...FLOW_OFF, QUIT_THROTTLE: "1" },
  },
  "before-settled": {
    name: "before: 500 headings, 4x, 220 keys, wait 10 s, quit",
    env: { ...FLOW_OFF, QUIT_SETTLE_MS: "10000" },
  },
  "cleanup-only": {
    name: "S5 temp cleanup fixed only: launch, quit",
    env: {
      SPIKE_QUIT_FLOW: "0",
      S5_CLEANUP: "safe",
      QUIT_HEADINGS: "0",
      QUIT_KEYS: "0",
      QUIT_THROTTLE: "1",
    },
  },
  "after-idle-launch": {
    name: "after: launch, no doc, no typing, quit",
    env: { ...FLOW_ON, QUIT_HEADINGS: "0", QUIT_KEYS: "0", QUIT_THROTTLE: "1" },
  },
  "after-50": {
    name: "after: 50 headings, 4x, 220 keys, quit",
    env: { ...FLOW_ON, QUIT_HEADINGS: "50" },
  },
  after: {
    name: "after: 500 headings, 4x, 220 keys, quit",
    env: { ...FLOW_ON },
  },
  "after-close": {
    name: "after: 500 headings, 4x, 220 keys, close window",
    env: { ...FLOW_ON, QUIT_VIA: "window-close" },
  },
  "after-storage": {
    name: "after: 500 headings, 4x, 220 keys while the storage worker commits, quit (flushes storage)",
    env: { ...FLOW_ON, S5_MODE: "worker-commits" },
  },
};
const DEFAULT_MATRIX = Object.keys(ARMS);
const matrix = (process.env.QUIT_MATRIX?.split(",") ?? DEFAULT_MATRIX).filter(
  (k) => {
    if (!ARMS[k]) throw new Error(`unknown arm ${k}`);
    return true;
  },
);

const electronPath = () => {
  if (process.env.ELECTRON_PATH) return process.env.ELECTRON_PATH;
  const dir = join(HERE, "node_modules", "electron");
  return join(dir, "dist", readFileSync(join(dir, "path.txt"), "utf8").trim());
};

const tmp = mkdtempSync(join(tmpdir(), "quit-hocus-"));
const hocus = Bun.spawn(["bun", "scripts/hocus-server.ts"], {
  cwd: root,
  env: {
    ...process.env,
    HOCUS_PORT: String(HOCUS_PORT),
    DB_PATH: join(tmp, "db.sqlite"),
    HOCUS_THROTTLE: "0",
    MAX_DOC_SIZE_BYTES: "2097152",
    HOCUS_ALLOW_ISOLATED_TABS_DOCS: "1",
    HOCUS_ALLOWED_ORIGINS: "app://tinydocy",
    WS_CONNECTION_LIMIT: "200",
    WS_SOCKETS_PER_IP: "600",
    WS_UPGRADE_RATE_LIMIT: "6000",
    DOC_CREATION_RATE_LIMIT: "2000",
  },
  stdout: "ignore",
  stderr: "inherit",
});

const waitForHocus = async () => {
  const giveUp = Date.now() + 60_000;
  while (Date.now() < giveUp) {
    const up = await new Promise<boolean>((ok) => {
      const ws = new WebSocket(`ws://127.0.0.1:${HOCUS_PORT}`, {
        headers: { Origin: "app://tinydocy" },
      } as unknown as string[]);
      ws.onopen = () => {
        ws.close();
        ok(true);
      };
      ws.onerror = () => ok(false);
    });
    if (up) return;
    await Bun.sleep(250);
  }
  throw new Error("hocus did not come up");
};

interface Trial {
  arm: string;
  rep: number;
  /** Runner clock, from the `requested` line to process exit. null: hung. */
  quitMs: number | null;
  hung: boolean;
  exitCode: number | null;
  events: {
    event: string;
    ms: number | null;
    at: number;
    [k: string]: unknown;
  }[];
  stderrTail: string;
}

const runTrial = async (key: string, rep: number): Promise<Trial> => {
  const arm = ARMS[key] as Arm;
  const userData = mkdtempSync(join(tmpdir(), "quit-ud-"));
  const proc = Bun.spawn([electronPath(), join(HERE, "dist", "main.cjs")], {
    cwd: root,
    env: {
      ...process.env,
      SPIKE_HOCUS_URL: `ws://127.0.0.1:${HOCUS_PORT}`,
      SPIKE_OUT_DIR: join(root, "out"),
      SPIKE_QUIT_LOG: "1",
      TINYDOCY_USER_DATA: join(userData, "user-data"),
      ...arm.env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const events: Trial["events"] = [];
  let requestedAt: number | null = null;
  let resolveRequested: () => void = () => {};
  const requested = new Promise<void>((r) => {
    resolveRequested = r;
  });
  const readLines = async () => {
    const decoder = new TextDecoder();
    let buf = "";
    for await (const chunk of proc.stdout) {
      const at = performance.now();
      buf += decoder.decode(chunk);
      let nl = buf.indexOf("\n");
      while (nl >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        nl = buf.indexOf("\n");
        const m = /^\[(quit|quit-flow|s5)\] (.*)$/.exec(line);
        if (!m) continue;
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(m[2] as string);
        } catch {
          parsed = { event: `${m[1]}:${m[2]}`, ms: null };
        }
        if (m[1] === "quit-flow") parsed.event = `flow:${parsed.event}`;
        events.push({
          ...(parsed as { event: string; ms: number | null }),
          at,
        });
        if (parsed.event === "requested") {
          requestedAt = at;
          resolveRequested();
        }
        if (parsed.event === "probe-failed") resolveRequested();
      }
    }
  };
  const stderrText = new Response(proc.stderr).text();
  const lines = readLines();
  const exited = proc.exited.then((code) => ({ code, at: performance.now() }));
  // Setup (sync, setContent, typing) gets its own generous bound.
  const setup = await Promise.race([
    requested.then(() => true),
    exited.then(() => false),
    Bun.sleep(180_000).then(() => false),
  ]);
  let hung = false;
  let exit: { code: number; at: number } | null = null;
  if (setup) {
    exit = await Promise.race([exited, Bun.sleep(TIMEOUT_MS).then(() => null)]);
    if (!exit) {
      hung = true;
      proc.kill("SIGKILL");
      await proc.exited;
    }
  } else {
    proc.kill("SIGKILL");
    await proc.exited;
  }
  await lines.catch(() => {});
  const stderrTail = (await stderrText).split("\n").slice(-15).join("\n");
  try {
    rmSync(userData, { recursive: true, force: true, maxRetries: 5 });
  } catch {
    // Windows: a killed app's helpers may still hold files for a moment.
  }
  const quitMs =
    exit && requestedAt !== null ? Math.round(exit.at - requestedAt) : null;
  if (!setup) {
    console.log(`  ${key} #${rep}: setup failed\n${stderrTail}`);
  }
  for (const e of events) {
    if (requestedAt !== null) e.at = Math.round(e.at - requestedAt);
  }
  return {
    arm: key,
    rep,
    quitMs,
    hung,
    exitCode: exit?.code ?? null,
    events,
    stderrTail,
  };
};

const percentile = (xs: number[], p: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] ?? null;
};

let code = 0;
try {
  await waitForHocus();
  const trials: Trial[] = [];
  for (const key of matrix) {
    for (let rep = 0; rep < REPS; rep++) {
      const t = await runTrial(key, rep);
      trials.push(t);
      const flow = t.events
        .filter((e) => e.ms !== null && e.event !== "typed")
        .map((e) => `${e.event}@${e.ms}`)
        .join(" ");
      console.log(
        `${key} #${rep}: ${t.hung ? `HUNG (killed after ${TIMEOUT_MS} ms)` : `exit ${t.exitCode} in ${t.quitMs} ms`} | ${flow}`,
      );
    }
  }
  const summary = matrix.map((key) => {
    const ts = trials.filter((t) => t.arm === key);
    const times = ts.flatMap((t) => (t.quitMs === null ? [] : [t.quitMs]));
    return {
      arm: key,
      name: (ARMS[key] as Arm).name,
      trials: ts.length,
      hung: ts.filter((t) => t.hung).length,
      vetoed: ts.filter((t) =>
        t.events.some((e) => e.event === "will-prevent-unload"),
      ).length,
      medianMs: percentile(times, 50),
      maxMs: times.length ? Math.max(...times) : null,
    };
  });
  console.table(summary);
  mkdirSync(join(HERE, "results"), { recursive: true });
  writeFileSync(
    join(HERE, "results", `${MACHINE}.json`),
    JSON.stringify(
      { machine: MACHINE, timeoutMs: TIMEOUT_MS, summary, trials },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error);
  code = 1;
} finally {
  hocus.kill();
  await hocus.exited;
  try {
    rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
  } catch {}
}
process.exit(code);
