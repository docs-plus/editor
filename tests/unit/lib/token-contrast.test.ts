import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { contrastRatio, MIN_TEXT_CONTRAST } from "@/lib/text-style-contrast";
import {
  oklchToHex,
  readThemeTokens,
  type Theme,
} from "@/tests/helpers/css-tokens";

const ROOT = join(import.meta.dir, "../../..");

/** Surfaces primary-coloured text can sit on. */
const SURFACES = [
  "background",
  "card",
  "popover",
  "sidebar",
  "muted",
  "secondary",
] as const;

function hex(theme: Theme, token: string): string {
  const value = readThemeTokens(theme)[token];
  if (value === undefined) throw new Error(`--${token} not defined`);
  return oklchToHex(value);
}

describe("design token contrast", () => {
  it("converts oklch tokens to sRGB hex", () => {
    expect(oklchToHex("oklch(1 0 0)")).toBe("#ffffff");
    expect(oklchToHex("oklch(0 0 0)")).toBe("#000000");
    expect(oklchToHex("oklch(0.555 0.163 48.998)")).toBe("#bb4d00");
    expect(oklchToHex("oklch(0.769 0.188 70.08)")).toBe("#fe9a00");
  });

  // P2.9c-1 adds the high-contrast set to this loop.
  it.each<Theme>(["light", "dark"])(
    "--primary-ink is at least 4.5:1 on every surface (%s)",
    (theme) => {
      const ink = hex(theme, "primary-ink");
      for (const surface of SURFACES) {
        const ratio = contrastRatio(ink, hex(theme, surface));
        expect({ surface, ok: ratio >= MIN_TEXT_CONTRAST }).toEqual({
          surface,
          ok: true,
        });
      }
    },
  );

  it("fixes the measured dark bug", () => {
    const background = hex("dark", "background");
    expect(
      contrastRatio(hex("dark", "primary-ink"), background),
    ).toBeGreaterThan(9);
    // Filled buttons keep --primary (white text on it); as text it fails.
    expect(contrastRatio(hex("dark", "primary"), background)).toBeLessThan(3);
  });

  it("leaves light unchanged", () => {
    expect(hex("light", "primary-ink")).toBe(hex("light", "primary"));
    expect(hex("light", "primary")).toBe("#bb4d00");
  });

  it("never uses --primary as a text or border colour", () => {
    const hits: string[] = [];
    // Tailwind utilities in TSX.
    for (const pattern of ["components/**/*.tsx", "app/**/*.tsx"]) {
      for (const file of new Bun.Glob(pattern).scanSync(ROOT)) {
        const source = readFileSync(join(ROOT, file), "utf8");
        if (/\b(text|border)-primary(?![-\w])/.test(source)) hits.push(file);
      }
    }
    // Text and border declarations in stylesheets; fills (background) may
    // keep --primary.
    const declaration =
      /(?:^|[;{\s])((?:color|border[\w-]*|outline[\w-]*|text-decoration[\w-]*|caret-color|column-rule[\w-]*)\s*:[^;{}]*var\(--primary[,)][^;{}]*)/g;
    for (const pattern of [
      "app/**/*.{css,scss}",
      "components/**/*.{css,scss}",
      "extensions/**/*.{css,scss}",
      "styles/**/*.{css,scss}",
    ]) {
      for (const file of new Bun.Glob(pattern).scanSync(ROOT)) {
        const source = readFileSync(join(ROOT, file), "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/^\s*\/\/.*$/gm, "");
        for (const [, found] of source.matchAll(declaration)) {
          hits.push(`${file}: ${found.trim()}`);
        }
      }
    }
    expect(hits.sort()).toEqual([]);
  });
});
