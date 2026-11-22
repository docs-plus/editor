/**
 * Reads the fuse wire out of a packaged binary and fails unless every fuse
 * is what electron-builder.yml asks for (plan §7 "Electron fuses"; P2.5
 * exit criterion "CI asserts the fuses"). Reads the binary, not the config,
 * so a builder that silently skipped flipping is caught.
 *
 *   bun desktop/build/check-fuses.ts <TinyDocy.app | TinyDocy.exe | tinydocy>
 */
import { existsSync } from "node:fs";

import { FuseState, FuseV1Options, getCurrentFuseWire } from "@electron/fuses";

export const EXPECTED_FUSES: Record<keyof typeof FuseV1Options, boolean> = {
  RunAsNode: false,
  EnableCookieEncryption: true,
  EnableNodeOptionsEnvironmentVariable: false,
  // On in the internal build: Playwright attaches through the inspector.
  EnableNodeCliInspectArguments: true,
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
  const state = (wire as unknown as Record<number, FuseState>)[index];
  const actual =
    state === FuseState.ENABLE
      ? true
      : state === FuseState.DISABLE
        ? false
        : null;
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
