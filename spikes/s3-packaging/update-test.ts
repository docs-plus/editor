// One update scenario end to end: install a build, write a marker into
// userData, serve a feed (feed.ts, in process), launch the app in update or
// check mode, wait for the expected final version to exit, then check
// version.txt, the marker, the feed log, the probe log and the net-logs.
//
//   bun update-test.ts --name gate-appimage --kind appimage \
//     --installer release/0.0.1/tinydocy-0.0.1-x86_64.AppImage \
//     --feed release/0.0.2 --expect-version 0.0.2 \
//     [--mode update|check] [--pref stable|beta] [--signed] \
//     [--downgrade-control] [--expect-feed <re>]... [--forbid-feed <re>]... \
//     [--expect-log <re>]... [--informational]
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

import { startFeed } from "./feed";

const { values } = parseArgs({
  options: {
    name: { type: "string" },
    kind: { type: "string" }, // appimage | nsis | mac-zip | deb
    installer: { type: "string" },
    feed: { type: "string" },
    "expect-version": { type: "string" },
    mode: { type: "string", default: "update" },
    pref: { type: "string" },
    signed: { type: "boolean", default: false },
    "downgrade-control": { type: "boolean", default: false },
    "expect-feed": { type: "string", multiple: true, default: [] },
    "forbid-feed": { type: "string", multiple: true, default: [] },
    "expect-log": { type: "string", multiple: true, default: [] },
    informational: { type: "boolean", default: false },
    "timeout-s": { type: "string", default: "300" },
  },
});
const need = (k: keyof typeof values) => {
  const v = values[k];
  if (typeof v !== "string" || !v) throw new Error(`--${k} is required`);
  return v;
};
const name = need("name");
const kind = need("kind");
const installer = path.resolve(need("installer"));
const feedRoot = path.resolve(need("feed"));
const expectVersion = need("expect-version");

const outRoot = path.resolve(process.env.S3_OUT ?? "out");
const work = path.join(outRoot, name);
rmSync(work, { recursive: true, force: true });
const userData = path.join(work, "userData");
mkdirSync(userData, { recursive: true });
const marker = `marker-${name}-${Date.now()}`;
writeFileSync(path.join(userData, "marker.txt"), marker);

const sh = (cmd: string, args: string[]) => {
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  if (r.status !== 0)
    throw new Error(`${cmd} ${args.join(" ")} -> ${r.status}`);
};

// Install the starting build and return the executable to launch.
const install = (): string => {
  switch (kind) {
    case "appimage": {
      const target = path.join(work, "TinyDocy.AppImage");
      copyFileSync(installer, target);
      chmodSync(target, 0o755);
      return target;
    }
    case "mac-zip": {
      sh("ditto", ["-x", "-k", installer, path.join(work, "app")]);
      return path.join(
        work,
        "app",
        "TinyDocy.app",
        "Contents",
        "MacOS",
        "TinyDocy",
      );
    }
    case "nsis": {
      const dir = path.join(
        process.env.LOCALAPPDATA ?? "",
        "Programs",
        "tinydocy",
      );
      const uninstaller = path.join(dir, "Uninstall TinyDocy.exe");
      if (existsSync(uninstaller))
        spawnSync(uninstaller, ["/S"], { stdio: "inherit" });
      for (
        let i = 0;
        i < 30 && existsSync(path.join(dir, "TinyDocy.exe"));
        i++
      ) {
        Bun.sleepSync(1000);
      }
      sh(installer, ["/S"]);
      const exe = path.join(dir, "TinyDocy.exe");
      if (!existsSync(exe)) throw new Error(`not installed at ${exe}`);
      return exe;
    }
    case "deb": {
      sh("sudo", ["apt-get", "install", "-y", "--allow-downgrades", installer]);
      return "/opt/TinyDocy/tinydocy";
    }
    default:
      throw new Error(`unknown --kind ${kind}`);
  }
};

const env: Record<string, string> = {
  TINYDOCY_USER_DATA: userData,
  TINYDOCY_MODE: values.mode ?? "update",
  TINYDOCY_TIMEOUT_MS: "200000",
};
if (values.pref) env.TINYDOCY_CHANNEL_PREF = values.pref;
if (values.signed) env.TINYDOCY_SIGNED_FEED = "1";
if (values["downgrade-control"]) env.TINYDOCY_DOWNGRADE_CONTROL = "1";
// Fallback for a relaunch that does not inherit the environment.
writeFileSync(path.join(homedir(), ".tinydocy-s3.json"), JSON.stringify(env));

const feedLog = path.join(work, "feed.log");
const feed = startFeed(feedRoot, feedLog);
const exe = install();
const startVersion = (() => {
  const m = path.basename(installer).match(/(\d+\.\d+\.\d+(?:-[\w.]+)?)/);
  return m?.[1] ?? "?";
})();
console.log(`[${name}] installed ${startVersion} -> ${exe}`);

const probeLog = path.join(userData, "probe.log");
const app = Bun.spawn([exe], {
  env: { ...process.env, ...env },
  stdout: Bun.file(path.join(work, "app-stdout.log")),
  stderr: Bun.file(path.join(work, "app-stderr.log")),
});

const readProbe = () =>
  existsSync(probeLog) ? readFileSync(probeLog, "utf8") : "";
const exitedAs = (log: string, v: string) =>
  log
    .split("\n")
    .some((l) => l.includes(` v${v} `) && l.includes("probe-exit"));

const deadline = Date.now() + Number(values["timeout-s"]) * 1000;
let firstExitAt = 0;
while (Date.now() < deadline) {
  const log = readProbe();
  if (exitedAs(log, expectVersion)) break;
  if (log.includes("probe-exit") && !firstExitAt) firstExitAt = Date.now();
  // Another version exited; give a relaunch 60 s to appear and finish.
  if (firstExitAt && Date.now() - firstExitAt > 60_000) break;
  await Bun.sleep(1000);
}
// Settle: nothing else may start and rewrite version.txt.
await Bun.sleep(8000);
app.kill();
feed.stop();

const finalVersion = readFileSync(
  path.join(userData, "version.txt"),
  "utf8",
).trim();
const markerNow = existsSync(path.join(userData, "marker.txt"))
  ? readFileSync(path.join(userData, "marker.txt"), "utf8")
  : "(missing)";
const feedText = existsSync(feedLog) ? readFileSync(feedLog, "utf8") : "";
const probeText = readProbe();
const netlogs = readdirSync(userData).filter((f) => f.startsWith("netlog-"));
const netText = netlogs
  .map((f) => readFileSync(path.join(userData, f), "utf8"))
  .join("\n");
const count = (text: string, re: RegExp) => (text.match(re) ?? []).length;

const checks: [string, boolean][] = [
  [
    `version.txt=${finalVersion} expected ${expectVersion}`,
    finalVersion === expectVersion,
  ],
  ["marker intact", markerNow === marker],
  [`netlog files=${netlogs.length}`, netlogs.length > 0],
  [
    `netlog github.com hits=${count(netText, /github\.com/gi)}`,
    count(netText, /github\.com/gi) === 0,
  ],
  [
    `netlog 127.0.0.1:8787 hits=${count(netText, /127\.0\.0\.1:8787/g)}`,
    count(netText, /127\.0\.0\.1:8787/g) > 0,
  ],
  ...(values["expect-feed"] ?? []).map((re): [string, boolean] => [
    `feed log matches /${re}/`,
    new RegExp(re).test(feedText),
  ]),
  ...(values["forbid-feed"] ?? []).map((re): [string, boolean] => [
    `feed log lacks /${re}/`,
    !new RegExp(re).test(feedText),
  ]),
  ...(values["expect-log"] ?? []).map((re): [string, boolean] => [
    `probe log matches /${re}/`,
    new RegExp(re).test(probeText),
  ]),
];
const pass = checks.every(([, ok]) => ok);

const report = [
  `=== update-test ${name}: ${pass ? "PASS" : "FAIL"}${values.informational ? " (informational)" : ""}`,
  `kind=${kind} start=${startVersion} feed=${path.basename(feedRoot)} mode=${values.mode} pref=${values.pref ?? "unset"} signed=${values.signed} control=${values["downgrade-control"]}`,
  ...checks.map(([label, ok]) => `  [${ok ? "x" : " "}] ${label}`),
  "--- feed log",
  feedText.trim(),
  "--- probe log",
  probeText.trim(),
].join("\n");
console.log(report);
writeFileSync(path.join(work, "report.txt"), `${report}\n`);
if (!pass && !values.informational) process.exit(1);
