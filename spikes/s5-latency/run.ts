// Spike S5 runner: a loopback Hocus (temp DB, throttle off) and the app on
// 127.0.0.1, then the latency spec. Every server is local; never the live site.
//
//   bun spikes/s5-latency/run.ts               # serves the static export `out/`
//   S5_SERVE=next bun spikes/s5-latency/run.ts # serves a production build (`next start`)
//
// The Chrome arms load http://127.0.0.1:<port>; the Electron arms load the
// same out/ through S1's shell on app://tinydocy.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const APP_PORT = Number(process.env.S5_APP_PORT ?? 3900);
const HOCUS_PORT = Number(process.env.S5_HOCUS_PORT ?? 1290);
const origin = `http://127.0.0.1:${APP_PORT}`;
const tmp = mkdtempSync(join(tmpdir(), "s5-hocus-"));

const hocus = Bun.spawn(["bun", "scripts/hocus-server.ts"], {
  cwd: root,
  env: {
    ...process.env,
    HOCUS_PORT: String(HOCUS_PORT),
    DB_PATH: join(tmp, "db.sqlite"),
    HOCUS_THROTTLE: "0",
    // Production's cap (ecosystem.config.cjs, nightly.yml): the 500-heading
    // document is over the 1 MiB default, which makes the editor read-only.
    MAX_DOC_SIZE_BYTES: "2097152",
    HOCUS_ALLOW_ISOLATED_TABS_DOCS: "1",
    HOCUS_ALLOWED_ORIGINS: `${origin},app://tinydocy`,
    WS_CONNECTION_LIMIT: "200",
    WS_SOCKETS_PER_IP: "600",
    WS_UPGRADE_RATE_LIMIT: "6000",
    DOC_CREATION_RATE_LIMIT: "2000",
  },
  stdout: "ignore",
  stderr: "inherit",
});

const app =
  process.env.S5_SERVE !== "next"
    ? Bun.spawn(["bun", join(import.meta.dir, "serve-out.ts")], {
        cwd: root,
        env: { ...process.env, S5_APP_PORT: String(APP_PORT) },
        stdout: "inherit",
        stderr: "inherit",
      })
    : Bun.spawn(
        ["bun", "next", "start", "-H", "127.0.0.1", "-p", String(APP_PORT)],
        { cwd: root, stdout: "ignore", stderr: "inherit" },
      );

const cleanup = () => {
  hocus.kill();
  app.kill();
  rmSync(tmp, { recursive: true, force: true });
};
process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});

const waitFor = async (check: () => Promise<boolean>, what: string) => {
  const giveUp = Date.now() + 60_000;
  while (Date.now() < giveUp) {
    if (await check().catch(() => false)) return;
    await Bun.sleep(250);
  }
  throw new Error(`${what} did not come up`);
};

let code = 1;
try {
  await waitFor(async () => (await fetch(origin)).ok, `app on ${origin}`);
  await waitFor(
    () =>
      new Promise<boolean>((ok) => {
        const ws = new WebSocket(`ws://127.0.0.1:${HOCUS_PORT}`, {
          headers: { Origin: origin },
        } as unknown as string[]);
        ws.onopen = () => {
          ws.close();
          ok(true);
        };
        ws.onerror = () => ok(false);
      }),
    `hocus on ${HOCUS_PORT}`,
  );
  const test = Bun.spawn(
    [
      "bun",
      "playwright",
      "test",
      "-c",
      "spikes/s5-latency/playwright.config.ts",
      ...process.argv.slice(2),
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        CI: "",
        S5_BASE_URL: origin,
        SPIKE_HOCUS_URL: `ws://127.0.0.1:${HOCUS_PORT}`,
        SPIKE_OUT_DIR: join(root, "out"),
      },
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  code = await test.exited;
} finally {
  cleanup();
}
process.exit(code);
