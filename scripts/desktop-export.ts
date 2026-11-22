/**
 * Shared by `scripts/build-desktop.ts` and `next.config.ts`: what leaves the
 * desktop static export (NEXT_PUBLIC_APP_TARGET=desktop) and how. No Bun
 * APIs and no top-level await: `next.config.ts` imports it.
 *
 * What leaves the export, and how:
 * - Web-only route handlers (`app/api`, `llms.txt`, `/pwa-icons`) are
 *   `route.web.ts(x)`. `next.config.ts` gives the desktop target page
 *   extensions that don't match them. No file moves.
 * - The files in `WEB_ONLY_FILES` can't use that switch, so
 *   `bun run build:desktop` parks them for the build and puts them back:
 *   - Metadata files: Turbopack ignores `pageExtensions` for them (spike
 *     S1), and with `force-static` they would put the web manifest,
 *     `og:image` and `apple-touch-icon` tags into every desktop page (#115).
 *   - Pages: Next 16.4.6 drops the root layout's font preload from a
 *     `page.web.tsx` (`getPreloadableFonts` strips only `.tsx`, so it looks
 *     up `app/privacy/page.web` in a manifest keyed `app/privacy/page`).
 *     Renaming would change the web HTML.
 *
 * Parking rules (#111, #115): park inside the checkout (a rename across
 * drives fails with EXDEV on Windows runners), put back what an interrupted
 * run left first, put back in `finally` and on SIGINT/SIGTERM, and refuse to
 * run if a file is both in `app/` and parked. `next.config.ts` refuses a web
 * build while anything is parked, so a killed run can't ship a web build
 * without its sitemap or its privacy page.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
} from "node:fs";
import { join, relative } from "node:path";

/** Web-only files parked during a desktop export, relative to the root. */
export const WEB_ONLY_FILES = [
  "app/sitemap.ts",
  "app/robots.ts",
  "app/manifest.ts",
  "app/opengraph-image.tsx",
  "app/apple-icon.tsx",
  "app/privacy/page.tsx",
  "app/offline/page.tsx",
] as const;

/** Where those files wait during a desktop export (gitignored). */
export const PARKING_DIR = ".desktop-export-parked";

const parkedName = (rel: string) => rel.replaceAll("/", "__");

/** Files currently parked under `root`, as repo-relative paths. */
export function listParked(root: string): string[] {
  const dir = join(root, PARKING_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).map((name) => name.replaceAll("__", "/"));
}

/** Puts back every parked file. Throws if one also exists in `app/`. */
export function restoreParked(root: string): string[] {
  const restored: string[] = [];
  for (const rel of listParked(root)) {
    if (existsSync(join(root, rel))) {
      throw new Error(
        `${rel} is both in app/ and in ${PARKING_DIR}/; keep the right copy and delete the other`,
      );
    }
    renameSync(join(root, PARKING_DIR, parkedName(rel)), join(root, rel));
    restored.push(rel);
  }
  const dir = join(root, PARKING_DIR);
  if (existsSync(dir)) rmdirSync(dir);
  return restored;
}

/** Moves `WEB_ONLY_FILES` out of `app/`. */
export function parkWebOnlyFiles(root: string): string[] {
  const dir = join(root, PARKING_DIR);
  mkdirSync(dir, { recursive: true });
  const parked: string[] = [];
  for (const rel of WEB_ONLY_FILES) {
    if (!existsSync(join(root, rel))) continue;
    renameSync(join(root, rel), join(dir, parkedName(rel)));
    parked.push(rel);
  }
  return parked;
}

/** Top-level names in `out/` that belong to the web build only. */
const WEB_ONLY_OUTPUT =
  /^(api|privacy|offline|pwa-icons|llms\.txt|sitemap|robots|manifest|opengraph-image|twitter-image|apple-icon)(\.|$)/;

/** Head tags that file-convention metadata adds; none may reach desktop. */
const WEB_ONLY_TAGS = [
  /<link rel="manifest"/,
  /<meta property="og:image"/,
  /<meta name="twitter:image"/,
  /<link rel="apple-touch-icon"/,
  /href="\/privacy"/,
];

function walk(dir: string, visit: (path: string) => void): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    visit(path);
    if (entry.isDirectory()) walk(path, visit);
  }
}

/**
 * Problems with an exported `out/`, empty when it is a valid desktop
 * renderer: no web-only route, no web metadata tag in any page, and the
 * flat segment-prefetch layout (Windows writes `__next.<segment>/`, #103).
 * With `bootScript`, every page must also inline that exact string: the
 * desktop CSP allows inline scripts by their SHA-256, so a page whose boot
 * script differs from the hashed one would run without preferences.
 */
export function checkDesktopExport(
  outDir: string,
  { bootScript }: { bootScript?: string } = {},
): string[] {
  const problems: string[] = [];
  for (const name of readdirSync(outDir)) {
    if (WEB_ONLY_OUTPUT.test(name)) problems.push(`web-only output: ${name}`);
  }
  walk(outDir, (path) => {
    const rel = relative(outDir, path);
    const name = rel.split(/[\\/]/).at(-1) ?? "";
    if (name.startsWith("__next.") && !name.endsWith(".txt")) {
      problems.push(`nested segment directory (Windows layout): ${rel}`);
    }
    if (!rel.endsWith(".html")) return;
    const html = readFileSync(path, "utf8");
    for (const tag of WEB_ONLY_TAGS) {
      if (tag.test(html)) problems.push(`${rel} has ${tag.source}`);
    }
    if (bootScript && !html.includes(`<script>${bootScript}</script>`)) {
      problems.push(`${rel} lacks the boot script`);
    }
  });
  return problems;
}
