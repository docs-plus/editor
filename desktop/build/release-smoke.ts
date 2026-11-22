/**
 * Smoke for an installed **release** build, which has no test hooks
 * (SEC-006), plus the inspector probe (SEC-001):
 *
 * 1. Nothing listens on 127.0.0.1:9229 yet.
 * 2. The app starts with its default userData, given a deep link followed
 *    by `--inspect=9229`; it must open its library (`library.sqlite`
 *    appears) and keep running.
 * 3. A second instance with the same arguments hands them over and exits.
 * 4. Still nothing listens on 9229: the inspect fuse is off, so neither
 *    launch opened an inspector.
 * 5. The app is closed gracefully (SIGTERM, or `taskkill` without `/F` on
 *    Windows) and must exit.
 *
 *   bun desktop/build/release-smoke.ts <installed executable>
 *
 * On Linux run it under `xvfb-run -a`.
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const executable = process.argv[2];
if (!executable) {
  console.error("usage: bun desktop/build/release-smoke.ts <executable>");
  process.exit(2);
}

const INSPECT_PORT = 9229;

/** Where a release build keeps its library (desktop/main/index.ts `libraryDir`). */
function libraryFile(): string {
  if (process.platform === "win32")
    return join(
      process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
      "TinyDocy",
      "library",
      "library.sqlite",
    );
  const userData =
    process.platform === "darwin"
      ? join(homedir(), "Library", "Application Support", "TinyDocy")
      : join(
          process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
          "TinyDocy",
        );
  return join(userData, "library", "library.sqlite");
}

async function listening(port: number): Promise<boolean> {
  try {
    const socket = await Bun.connect({
      hostname: "127.0.0.1",
      port,
      socket: { data() {} },
    });
    socket.end();
    return true;
  } catch {
    return false;
  }
}

async function until(
  check: () => boolean | Promise<boolean>,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await Bun.sleep(250);
  }
  return false;
}

const fail = (message: string): never => {
  console.error(`[release-smoke] FAIL: ${message}`);
  process.exit(1);
};

if (await listening(INSPECT_PORT))
  fail(`something already listens on ${INSPECT_PORT}; the probe can't tell`);

const args = [`tinydocy://local/${randomUUID()}`, `--inspect=${INSPECT_PORT}`];
const library = libraryFile();
const started = performance.now();
const app = Bun.spawn([executable, ...args], {
  stdout: "ignore",
  stderr: "ignore",
});
let exitCode: number | null = null;
void app.exited.then((code) => {
  exitCode = code;
});

if (!(await until(() => existsSync(library), 60_000))) {
  app.kill("SIGKILL");
  fail(`no library at ${library} within 60 s (exit ${exitCode})`);
}
const readyMs = Math.round(performance.now() - started);
if (exitCode !== null) fail(`the app exited (${exitCode}) after starting`);
console.log(`[release-smoke] library open after ${readyMs} ms: ${library}`);

const second = Bun.spawn([executable, ...args], {
  stdout: "ignore",
  stderr: "ignore",
});
const secondTimer = setTimeout(() => second.kill("SIGKILL"), 30_000);
const secondCode = await second.exited;
clearTimeout(secondTimer);
if (second.signalCode) fail("the second instance did not hand over and exit");
console.log(`[release-smoke] second instance exited ${secondCode}`);

// Give an inspector, if one were starting, time to bind.
await Bun.sleep(1500);
if (await listening(INSPECT_PORT))
  fail(`an inspector listens on 127.0.0.1:${INSPECT_PORT} (SEC-001)`);
console.log(`[release-smoke] no inspector on ${INSPECT_PORT}`);

const closing = performance.now();
if (process.platform === "win32") {
  // Without /F: a WM_CLOSE to each window, the user's own close path.
  Bun.spawnSync(["taskkill", "/PID", String(app.pid)]);
} else {
  app.kill("SIGTERM");
}
const exited = await until(() => exitCode !== null, 20_000);
if (!exited) {
  app.kill("SIGKILL");
  fail("the app did not exit within 20 s of a graceful close");
}
const closeMs = Math.round(performance.now() - closing);
console.log(
  `[release-smoke] ok: closed gracefully in ${closeMs} ms (exit ${exitCode})`,
);
