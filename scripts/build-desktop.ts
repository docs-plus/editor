/**
 * Builds the desktop renderer into `out/`: the static export with
 * NEXT_PUBLIC_APP_TARGET=desktop (desktop architecture §3.1 step 1).
 * Release builds run it on Linux only (#103). How routes leave the export,
 * and the parking rules: `scripts/desktop-export.ts`.
 *
 *   bun run build:desktop
 */

import { join } from "node:path";

import { BOOT_SCRIPT } from "@/lib/prefs/boot-script";

import {
  checkDesktopExport,
  parkWebOnlyFiles,
  restoreParked,
} from "./desktop-export";

async function main(): Promise<number> {
  const root = process.cwd();
  const leftovers = restoreParked(root);
  for (const rel of leftovers) {
    console.log(`[desktop-export] put back ${rel}, left by an interrupted run`);
  }

  const parked = parkWebOnlyFiles(root);
  const putBack = () => {
    const restored = restoreParked(root);
    if (restored.length !== parked.length) {
      console.error(
        `[desktop-export] put back ${restored.length} of ${parked.length} files; check app/`,
      );
    }
  };
  const onSignal = (signal: NodeJS.Signals) => {
    putBack();
    process.exit(signal === "SIGINT" ? 130 : 143);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  let code: number;
  try {
    const build = Bun.spawn(["bun", "next", "build"], {
      cwd: root,
      stdio: ["ignore", "inherit", "inherit"],
      env: { ...process.env, NEXT_PUBLIC_APP_TARGET: "desktop" },
    });
    code = await build.exited;
  } finally {
    putBack();
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
  if (code !== 0) return code;

  const problems = checkDesktopExport(join(root, "out"), {
    bootScript: BOOT_SCRIPT,
  });
  for (const problem of problems) console.error(`[desktop-export] ${problem}`);
  if (problems.length > 0) return 1;
  console.log("[desktop-export] out/ is a valid desktop renderer");
  return 0;
}

if (import.meta.main) process.exit(await main());
