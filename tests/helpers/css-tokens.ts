/**
 * Reads the shadcn design tokens straight from `app/globals.css`, so contrast
 * tests measure the colours the app ships rather than a copy of them.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type Theme = "light" | "dark";

const GLOBALS_CSS = join(import.meta.dir, "../../app/globals.css");

/** Custom properties declared directly in a top-level `selector { … }` block. */
function readBlock(css: string, selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const block = new RegExp(`^${escaped}\\s*\\{([^}]*)\\}`, "m").exec(css);
  if (!block) throw new Error(`no top-level ${selector} block`);
  const tokens: Record<string, string> = {};
  for (const [, name, value] of block[1].matchAll(
    /--([\w-]+)\s*:\s*([^;]+);/g,
  )) {
    tokens[name] = value.trim();
  }
  return tokens;
}

/** Follows `var(--x)` until it reaches a literal value. */
function resolve(tokens: Record<string, string>, name: string): string {
  const seen = new Set<string>();
  let value = tokens[name];
  while (value !== undefined) {
    const ref = /^var\(--([\w-]+)\)$/.exec(value);
    if (!ref) return value;
    if (seen.has(ref[1])) throw new Error(`var() cycle at --${name}`);
    seen.add(ref[1]);
    value = tokens[ref[1]];
  }
  throw new Error(`--${name} not defined`);
}

/**
 * The theme's tokens, keyed without the leading `--`: `:root`, then `.dark`
 * overriding it for the dark theme, with `var(--x)` chains resolved. A token
 * that is missing reads as `undefined`, and a dangling `var()` throws.
 */
export function readThemeTokens(theme: Theme): Record<string, string> {
  const css = readFileSync(GLOBALS_CSS, "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );
  const merged = {
    ...readBlock(css, ":root"),
    ...(theme === "dark" ? readBlock(css, ".dark") : {}),
  };
  return Object.fromEntries(
    Object.keys(merged).map((name) => [name, resolve(merged, name)]),
  );
}

/** `oklch(L C h)` (opaque, L as 0–1) to `#rrggbb` via OKLab and sRGB gamma. */
export function oklchToHex(value: string): string {
  const match = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(value);
  if (!match) throw new Error(`not an opaque oklch() colour: ${value}`);
  const [L, C, h] = match.slice(1).map(Number);
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return `#${linear
    .map((x) => {
      const c = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
      const byte = Math.round(Math.min(1, Math.max(0, c)) * 255);
      return byte.toString(16).padStart(2, "0");
    })
    .join("")}`;
}
