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
import { existsSync, mkdirSync, readdirSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, parse, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const WEB_ONLY_METADATA = [
  "app/sitemap.ts",
  "app/robots.ts",
  "app/opengraph-image.tsx",
  "app/manifest.ts",
  "app/apple-icon.tsx",
];

// Parked inside the checkout: a rename across drives fails with EXDEV
// (Windows runners keep the repo on D: and the temp dir on C:).
const parked = join(ROOT, "spikes/s1-shell/.parked");
mkdirSync(parked, { recursive: true });
console.log(
  `[s1] repo root on ${parse(ROOT).root}, parked on ${parse(parked).root}, os.tmpdir() on ${parse(tmpdir()).root}`,
);

// A run killed between the move and the restore leaves files here. Put them
// back first, or this run would skip them (they no longer exist in app/) and
// the next web build would silently lose its sitemap, robots and manifest.
for (const name of readdirSync(parked)) {
  const rel = name.replaceAll("__", "/");
  if (!WEB_ONLY_METADATA.includes(rel)) continue;
  if (existsSync(join(ROOT, rel))) {
    throw new Error(
      `[s1] ${rel} exists in app/ and in .parked; resolve by hand`,
    );
  }
  renameSync(join(parked, name), join(ROOT, rel));
  console.log(`[s1] restored ${rel} left by an interrupted run`);
}
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
