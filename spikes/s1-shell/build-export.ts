/**
 * Spike S1: desktop static export with the "prebuild overlay" fallback.
 *
 * Turbopack honours `pageExtensions` for `page.*` and `route.*` files, but
 * not for metadata files: `sitemap.web.ts` becomes a route at
 * `/sitemap.web` in the web build instead of `/sitemap.xml`. So the web-only
 * metadata files keep their plain names and this script moves them out of
 * `app/` for the desktop build only, then puts them back.
 *
 * Usage (repo root): bun spikes/s1-shell/build-export.ts
 */
import { existsSync, mkdtempSync, readdirSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const WEB_ONLY_METADATA = [
  "app/sitemap.ts",
  "app/robots.ts",
  "app/opengraph-image.tsx",
  "app/manifest.ts",
  "app/apple-icon.tsx",
];

const parked = mkdtempSync(join(tmpdir(), "s1-overlay-"));
const moved: string[] = [];
let exitCode = 1;
try {
  for (const rel of WEB_ONLY_METADATA) {
    const from = join(ROOT, rel);
    if (!existsSync(from)) continue;
    renameSync(from, join(parked, rel.replaceAll("/", "__")));
    moved.push(rel);
  }
  const started = performance.now();
  const proc = Bun.spawn(["bun", "next", "build"], {
    cwd: ROOT,
    stdio: ["ignore", "inherit", "inherit"],
    env: {
      ...process.env,
      NEXT_PUBLIC_APP_TARGET: "desktop",
      NEXT_PUBLIC_SERVICE_WORKER: "0",
      NEXT_PUBLIC_HOCUS_URL:
        process.env.NEXT_PUBLIC_HOCUS_URL ?? "ws://127.0.0.1:1234",
    },
  });
  exitCode = await proc.exited;
  console.log(
    `[s1] desktop export exit=${exitCode} in ${Math.round(performance.now() - started)} ms`,
  );
} finally {
  for (const rel of moved) {
    renameSync(join(parked, rel.replaceAll("/", "__")), join(ROOT, rel));
  }
}

if (exitCode === 0) {
  const top = readdirSync(join(ROOT, "out")).sort();
  const leaked = top.filter((f) =>
    /^(sitemap|robots|opengraph-image|manifest|apple-icon)/.test(f),
  );
  console.log(`[s1] out/ top level: ${top.join(" ")}`);
  console.log(
    `[s1] web-only metadata in out/: ${leaked.length ? leaked.join(" ") : "none"}`,
  );
  if (leaked.length) exitCode = 1;
}
process.exit(exitCode);
