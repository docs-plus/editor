/**
 * Builds the desktop renderer into `out/`: the static export with
 * NEXT_PUBLIC_APP_TARGET=desktop (desktop architecture §3.1 step 1), then
 * checks it (`scripts/desktop-export.ts`). Release builds run it on Linux
 * only (#103).
 *
 *   bun run build:desktop
 */

import { join } from "node:path";

import { buildBootScript } from "@/lib/prefs/boot-script";

import { checkDesktopExport } from "./desktop-export";

async function main(): Promise<number> {
  // One env for the build and for the boot script it must inline (the
  // script inlines NEXT_PUBLIC_REMEMBER_CHOICES at build time).
  const env: Record<string, string | undefined> = {
    ...process.env,
    NEXT_PUBLIC_APP_TARGET: "desktop",
  };
  const build = Bun.spawn(["bun", "next", "build"], {
    stdio: ["ignore", "inherit", "inherit"],
    env,
  });
  const code = await build.exited;
  if (code !== 0) return code;

  const problems = checkDesktopExport(join(process.cwd(), "out"), {
    bootScript: buildBootScript(env.NEXT_PUBLIC_REMEMBER_CHOICES !== "0"),
  });
  for (const problem of problems) console.error(`[desktop-export] ${problem}`);
  if (problems.length > 0) return 1;
  console.log("[desktop-export] out/ is a valid desktop renderer");
  return 0;
}

if (import.meta.main) process.exit(await main());
