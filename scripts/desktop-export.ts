/**
 * The desktop export's output check (architecture §3.1, §11), run by
 * `scripts/build-desktop.ts` after `next build`.
 *
 * Nothing moves to keep web-only routes out: the desktop target's
 * `pageExtensions` match only `*.desktop.tsx` files (`next.config.ts`), so
 * every plain web page, route handler and metadata file is invisible to it.
 * This check proves that on the output.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { DEV_BRIDGE_MARKER } from "../lib/platform/desktop/dev-bridge-wire";

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
 * renderer: no web-only route, no web metadata tag in any page, no dev
 * bridge code (architecture §11), and the flat segment-prefetch layout
 * (Windows writes `__next.<segment>/`, #103).
 */
export function checkDesktopExport(outDir: string): string[] {
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
    if (!/\.(html|js)$/.test(rel)) return;
    const text = readFileSync(path, "utf8");
    if (text.includes(DEV_BRIDGE_MARKER)) {
      problems.push(`${rel} has the dev bridge`);
    }
    if (!rel.endsWith(".html")) return;
    for (const tag of WEB_ONLY_TAGS) {
      if (tag.test(text)) problems.push(`${rel} has ${tag.source}`);
    }
  });
  return problems;
}
