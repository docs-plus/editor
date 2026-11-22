/**
 * Tiptap injects its base stylesheet as `<style data-tiptap-style>` when an
 * editor mounts. Its text is a constant per Tiptap version, so the desktop
 * CSP allows it by hash (`style-src-elem`) instead of loosening the policy
 * or changing the web editor chunk. The text is read from `@tiptap/core`'s
 * bundle at build time; `tests/unit/desktop/shell/tiptap-style.test.ts`
 * checks it against what a live editor injects.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const STYLE_REGION =
  /\/\/#region src\/style\.ts\s*\n\s*const style = `([^`$\\]*)`;/;

export function tiptapStyleText(root: string): string {
  const require = createRequire(join(root, "package.json"));
  const pkgJson = require.resolve("@tiptap/core/package.json");
  const bundle = readFileSync(join(dirname(pkgJson), "dist/index.js"), "utf8");
  const match = STYLE_REGION.exec(bundle);
  if (!match)
    throw new Error(
      "@tiptap/core's injected style was not found: update desktop/build/tiptap-style.ts",
    );
  return match[1];
}
