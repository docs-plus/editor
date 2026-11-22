/**
 * Reads the fuse wire out of a packaged binary and fails unless every fuse
 * is what electron-builder.yml asks for (plan §7 "Electron fuses"; P2.5
 * exit criterion "CI asserts the fuses"). Reads the binary, not the config,
 * so a builder that silently skipped flipping is caught.
 *
 *   bun desktop/build/check-fuses.ts <TinyDocy.app | TinyDocy.exe | tinydocy> [--inspect on|off]
 *
 * `--inspect` is the expected `EnableNodeCliInspectArguments` (SEC-001):
 * `off` (the default) for every installer; `on` only for the test flavor's
 * unpacked build, which Playwright's `_electron` drives through the
 * inspector.
 */
import { existsSync } from "node:fs";

import { FuseV1Options, getCurrentFuseWire } from "@electron/fuses";

/** The wire's bytes: ASCII "1" and "0" (`FuseState`, not exported by the package's entry). */
const ENABLE = 0x31;
const DISABLE = 0x30;

const inspectAt = process.argv.indexOf("--inspect");
const inspectArg = inspectAt > 0 ? process.argv[inspectAt + 1] : "off";
if (inspectArg !== "on" && inspectArg !== "off") {
  console.error("[fuses] --inspect takes on or off");
  process.exit(2);
}

export const EXPECTED_FUSES: Record<keyof typeof FuseV1Options, boolean> = {
  RunAsNode: false,
  EnableCookieEncryption: true,
  EnableNodeOptionsEnvironmentVariable: false,
  EnableNodeCliInspectArguments: inspectArg === "on",
  EnableEmbeddedAsarIntegrityValidation: true,
  OnlyLoadAppFromAsar: true,
  LoadBrowserProcessSpecificV8Snapshot: false,
  GrantFileProtocolExtraPrivileges: false,
};

const target = process.argv[2];
if (!target || !existsSync(target)) {
  console.error(`[fuses] no packaged binary at ${target ?? "(none)"}`);
  process.exit(1);
}

const wire = await getCurrentFuseWire(target);
const failures: string[] = [];
for (const [name, expected] of Object.entries(EXPECTED_FUSES)) {
  const index = FuseV1Options[name as keyof typeof FuseV1Options];
  const state = (wire as unknown as Record<number, number>)[index];
  const actual = state === ENABLE ? true : state === DISABLE ? false : null;
  const line = `${name}: ${actual === null ? `state ${String(state)}` : actual ? "on" : "off"}`;
  console.log(
    `[fuses] ${line}${actual === expected ? "" : `  (expected ${expected ? "on" : "off"})`}`,
  );
  if (actual !== expected) failures.push(name);
}
if (failures.length > 0) {
  console.error(`[fuses] wrong: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("[fuses] every fuse is as configured");
