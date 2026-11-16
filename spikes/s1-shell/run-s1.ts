/**
 * Runs the S1 spec for one origin against its own loopback Hocus (temp
 * DB_PATH, HOCUS_THROTTLE=0, HOCUS_ALLOWED_ORIGINS = that origin only).
 * Usage (repo root): bun spikes/s1-shell/run-s1.ts app|https [-- playwright args]
 */
import { mkdirSync, mkdtempSync, openSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const kind = process.argv[2] === "https" ? "https" : "app";
const origin =
  kind === "https" ? "https://app.tinydocy.invalid" : "app://tinydocy";
const extra = process.argv.slice(3).filter((a) => a !== "--");
const ROOT = resolve(import.meta.dir, "../..");
const port = process.env.S1_HOCUS_PORT ?? "1294";
const evidence = join(
  import.meta.dir,
  "evidence",
  `${process.platform}-${kind}`,
);
mkdirSync(evidence, { recursive: true });
const hocusLog = join(evidence, "hocus.log");

const hocus = Bun.spawn(["bun", "scripts/hocus-server.ts"], {
  cwd: ROOT,
  stdout: openSync(hocusLog, "w"),
  stderr: "inherit",
  env: {
    ...process.env,
    DB_PATH: join(mkdtempSync(join(tmpdir(), "s1-db-")), "s1.sqlite"),
    HOCUS_PORT: port,
    HOCUS_HOST: "127.0.0.1",
    HOCUS_THROTTLE: "0",
    HOCUS_ALLOWED_ORIGINS: origin,
  },
});
await Bun.sleep(1500);

const tests = Bun.spawn(
  [
    "bun",
    "playwright",
    "test",
    "-c",
    "spikes/s1-shell/playwright.config.ts",
    ...extra,
  ],
  {
    cwd: ROOT,
    stdio: ["ignore", "inherit", "inherit"],
    env: {
      ...process.env,
      CI: "",
      SPIKE_ORIGIN: kind,
      SPIKE_HOCUS_URL: `ws://127.0.0.1:${port}`,
      S1_HOCUS_LOG: hocusLog,
    },
  },
);
const code = await tests.exited;
hocus.kill();
await hocus.exited;
process.exit(code);
