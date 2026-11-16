// Named update scenarios, so each workflow step is one line:
//   bun scenarios.ts <name>      (e.g. linux-gate, win-gate, mac-x64-update)
// Feeds are release/<version>/ as electron-builder wrote them; the signed
// scenarios copy release/0.0.2 into feeds/ and sign (or tamper) the copies
// with the throwaway key in $TINYDOCY_MANIFEST_KEY_DIR.
import { cpSync, existsSync, rmSync } from "node:fs";
import path from "node:path";

const root = import.meta.dir;
const appImage = (v: string) => `release/${v}/tinydocy-${v}-x86_64.AppImage`;
const deb = (v: string) => `release/${v}/tinydocy_${v}_amd64.deb`;
const nsis = (v: string) => `release/${v}/tinydocy-${v}-setup.exe`;
const macZip = (v: string, arch: "arm64" | "x64") =>
  `release/${v}/tinydocy-${v}-mac-${arch}.zip`;

type Args = string[];
const DOWNGRADE_LOG = ["--expect-log", "downgrade is disallowed"];
const CHECK_LOG = [
  "--expect-log",
  "after construction allowDowngrade=false",
  "--expect-log",
  "before checkForUpdates allowDowngrade=false",
];

const signedFeed = (tamper: boolean) => {
  const keyDir = process.env.TINYDOCY_MANIFEST_KEY_DIR;
  if (!keyDir) throw new Error("TINYDOCY_MANIFEST_KEY_DIR is not set");
  const dir = path.join(root, "feeds", tamper ? "tampered" : "signed");
  rmSync(dir, { recursive: true, force: true });
  cpSync(path.join(root, "release", "0.0.2"), dir, { recursive: true });
  const ymls = ["latest-linux.yml", "beta-linux.yml"]
    .map((f) => path.join(dir, f))
    .filter((f) => existsSync(f));
  const run = (args: string[]) => {
    const r = Bun.spawnSync(["bun", "sign-manifests.ts", ...args], {
      cwd: root,
      stdout: "inherit",
      stderr: "inherit",
    });
    if (r.exitCode !== 0) throw new Error(`sign-manifests ${args[0]} failed`);
  };
  run([
    "sign",
    "--key",
    path.join(keyDir, "manifest-key.pem"),
    "--out",
    dir,
    ...ymls,
  ]);
  if (tamper) run(["tamper", path.join(dir, "latest-linux.yml")]);
  return dir;
};

const scenarios: Record<string, () => Args> = {
  // --- Linux AppImage (ubuntu-24.04, under xvfb-run) ---
  "linux-gate": () => [
    "--kind",
    "appimage",
    "--installer",
    appImage("0.0.1"),
    "--feed",
    "release/0.0.2",
    "--expect-version",
    "0.0.2",
    "--expect-feed",
    "GET /feed/latest-linux\\.yml",
    "--expect-feed",
    "GET /feed/tinydocy-0\\.0\\.2-x86_64\\.AppImage 200",
    ...CHECK_LOG,
  ],
  "linux-signed-valid": () => [
    "--kind",
    "appimage",
    "--installer",
    appImage("0.0.1"),
    "--feed",
    signedFeed(false),
    "--signed",
    "--expect-version",
    "0.0.2",
    "--expect-feed",
    "latest-linux\\.yml\\.sig",
    "--expect-log",
    "signature valid=true",
  ],
  "linux-signed-tampered": () => [
    "--kind",
    "appimage",
    "--installer",
    appImage("0.0.1"),
    "--feed",
    signedFeed(true),
    "--signed",
    "--expect-version",
    "0.0.1",
    "--expect-feed",
    "latest-linux\\.yml\\.sig",
    "--forbid-feed",
    "\\.AppImage",
    "--expect-log",
    "signature valid=false",
    "--expect-log",
    "event error manifest-signature",
  ],
  "linux-beta-offered-stable": () => [
    "--kind",
    "appimage",
    "--installer",
    appImage("0.0.3-beta.1"),
    "--feed",
    "release/0.0.4",
    "--expect-version",
    "0.0.4",
    // The beta install asks for beta-linux.yml first; only the relaunched
    // 0.0.4 (a stable build) asks for latest-linux.yml afterwards.
    "--expect-feed",
    "^[^\\n]*serving[^\\n]*\\n[^\\n]*GET /feed/beta-linux\\.yml[\\s\\S]*GET /feed/tinydocy-0\\.0\\.4-x86_64\\.AppImage 200[\\s\\S]*GET /feed/latest-linux\\.yml",
    "--expect-log",
    "v0\\.0\\.3-beta\\.1 .*default computed=beta",
    "--expect-log",
    "v0\\.0\\.3-beta\\.1 .*Found version 0\\.0\\.4",
  ],
  "linux-downgrade-default": () => [
    "--kind",
    "appimage",
    "--installer",
    appImage("0.0.1"),
    "--feed",
    "release/0.0.0",
    "--expect-version",
    "0.0.1",
    "--expect-feed",
    "GET /feed/latest-linux\\.yml",
    "--forbid-feed",
    "\\.AppImage",
    ...CHECK_LOG,
    ...DOWNGRADE_LOG,
  ],
  "linux-beta-to-stable-downgrade": () => [
    "--kind",
    "appimage",
    "--installer",
    appImage("0.0.3-beta.1"),
    "--feed",
    "release/0.0.0",
    "--pref",
    "stable",
    "--expect-version",
    "0.0.3-beta.1",
    "--expect-feed",
    "GET /feed/latest-linux\\.yml",
    "--forbid-feed",
    "beta-linux\\.yml",
    "--forbid-feed",
    "\\.AppImage",
    "--expect-log",
    "after channel setter \\(pref=stable\\) allowDowngrade=true channel=latest",
    ...CHECK_LOG,
    ...DOWNGRADE_LOG,
  ],
  // Negative control: the same path without the reset does downgrade.
  "linux-downgrade-control": () => [
    "--kind",
    "appimage",
    "--installer",
    appImage("0.0.3-beta.1"),
    "--feed",
    "release/0.0.0",
    "--pref",
    "stable",
    "--downgrade-control",
    "--expect-version",
    "0.0.0",
    "--informational",
    "--expect-log",
    "before checkForUpdates allowDowngrade=true",
  ],
  // .deb: CI records the download, the sha512 check and the install command.
  "linux-deb-update": () => [
    "--kind",
    "deb",
    "--installer",
    deb("0.0.1"),
    "--feed",
    "release/0.0.2",
    "--expect-version",
    "0.0.2",
    "--expect-feed",
    "tinydocy_0\\.0\\.2_amd64\\.deb",
    "--informational",
  ],

  // --- Windows NSIS (windows-latest) ---
  "win-gate": () => [
    "--kind",
    "nsis",
    "--installer",
    nsis("0.0.1"),
    "--feed",
    "release/0.0.2",
    "--expect-version",
    "0.0.2",
    "--expect-feed",
    "GET /feed/latest\\.yml",
    "--expect-feed",
    "GET /feed/tinydocy-0\\.0\\.2-setup\\.exe 200",
    ...CHECK_LOG,
  ],
  "win-beta-offered-stable": () => [
    "--kind",
    "nsis",
    "--installer",
    nsis("0.0.3-beta.1"),
    "--feed",
    "release/0.0.4",
    "--expect-version",
    "0.0.4",
    "--expect-feed",
    "^[^\\n]*serving[^\\n]*\\n[^\\n]*GET /feed/beta\\.yml[\\s\\S]*GET /feed/tinydocy-0\\.0\\.4-setup\\.exe 200[\\s\\S]*GET /feed/latest\\.yml",
    "--expect-log",
    "v0\\.0\\.3-beta\\.1 .*default computed=beta",
    "--expect-log",
    "v0\\.0\\.3-beta\\.1 .*Found version 0\\.0\\.4",
  ],
  "win-downgrade-default": () => [
    "--kind",
    "nsis",
    "--installer",
    nsis("0.0.1"),
    "--feed",
    "release/0.0.0",
    "--expect-version",
    "0.0.1",
    "--forbid-feed",
    "setup\\.exe",
    ...CHECK_LOG,
    ...DOWNGRADE_LOG,
  ],
  "win-beta-to-stable-downgrade": () => [
    "--kind",
    "nsis",
    "--installer",
    nsis("0.0.3-beta.1"),
    "--feed",
    "release/0.0.0",
    "--pref",
    "stable",
    "--expect-version",
    "0.0.3-beta.1",
    "--expect-feed",
    "GET /feed/latest\\.yml",
    "--forbid-feed",
    "setup\\.exe",
    ...CHECK_LOG,
    ...DOWNGRADE_LOG,
  ],

  // --- macOS (unsigned: Squirrel.Mac is expected to refuse the bundle) ---
  "mac-arm64-update": () => [
    "--kind",
    "mac-zip",
    "--installer",
    macZip("0.0.1", "arm64"),
    "--feed",
    "release/0.0.2",
    "--expect-version",
    "0.0.1",
    "--expect-feed",
    "GET /feed/latest-mac\\.yml",
    "--expect-feed",
    "GET /feed/tinydocy-0\\.0\\.2-mac-arm64\\.zip 200",
    "--forbid-feed",
    "mac-x64",
    "--expect-log",
    "did not pass validation|code signature|Code signature",
  ],
  "mac-x64-update": () => [
    "--kind",
    "mac-zip",
    "--installer",
    macZip("0.0.1", "x64"),
    "--feed",
    "release/0.0.2",
    "--expect-version",
    "0.0.1",
    "--expect-feed",
    "GET /feed/latest-mac\\.yml",
    "--expect-feed",
    "GET /feed/tinydocy-0\\.0\\.2-mac-x64\\.zip 200",
    "--forbid-feed",
    "mac-arm64",
    "--expect-log",
    "did not pass validation|code signature|Code signature",
  ],
  "mac-beta-offered-stable": () => [
    "--kind",
    "mac-zip",
    "--installer",
    macZip("0.0.3-beta.1", "arm64"),
    "--feed",
    "release/0.0.4",
    "--mode",
    "check",
    "--expect-version",
    "0.0.3-beta.1",
    "--expect-feed",
    "GET /feed/beta-mac\\.yml",
    "--forbid-feed",
    "latest-mac\\.yml",
    "--expect-log",
    "isUpdateAvailable=true",
  ],
};

const name = process.argv[2];
const make = name ? scenarios[name] : undefined;
if (!name || !make) {
  console.error(`scenarios: ${Object.keys(scenarios).join(", ")}`);
  process.exit(2);
}
const proc = Bun.spawnSync(
  ["bun", "update-test.ts", "--name", name, ...make()],
  { cwd: root, stdout: "inherit", stderr: "inherit" },
);
process.exit(proc.exitCode ?? 1);
