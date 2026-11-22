import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import * as sass from "sass";

import { contrastRatio, MIN_TEXT_CONTRAST } from "@/lib/text-style-contrast";
import { HIGHLIGHT_PALETTE, HIGHLIGHT_TOKENS } from "@/lib/text-style-tokens";
import {
  oklchToHex,
  readScssVar,
  readThemeTokens,
  type Theme,
} from "@/tests/helpers/css-tokens";

const ROOT = join(import.meta.dir, "../../..");

const PARAGRAPH_SCSS =
  "components/tiptap-node/paragraph-node/paragraph-node.scss";

/** Surfaces primary-coloured text can sit on. */
const SURFACES = [
  "background",
  "card",
  "popover",
  "sidebar",
  "muted",
  "secondary",
] as const;

/**
 * The increased-contrast token set (P2.9c-1, preferences design §5.4),
 * compiled from `styles/_page.scss`, laid over the theme's tokens.
 */
function contrastTokens(theme: Theme): Record<string, string> {
  const css = sass.compile(join(ROOT, "styles/_page.scss")).css;
  const selector =
    theme === "dark"
      ? ":root.dark[data-contrast=more] {"
      : ":root[data-contrast=more] {";
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`no ${selector} block`);
  const body = css.slice(start, css.indexOf("}", start));
  const tokens: Record<string, string> = {};
  for (const [, name, value] of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    tokens[name] = value.trim();
  }
  return tokens;
}

type ContrastSet = "normal" | "more";

function hex(theme: Theme, token: string, set: ContrastSet = "normal"): string {
  const value = {
    ...readThemeTokens(theme),
    ...(set === "more" ? contrastTokens(theme) : {}),
  }[token];
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

  const SETS: [Theme, ContrastSet][] = [
    ["light", "normal"],
    ["dark", "normal"],
    ["light", "more"],
    ["dark", "more"],
  ];

  it.each(SETS)(
    "--primary-ink is at least 4.5:1 on every surface (%s, %s contrast)",
    (theme, set) => {
      const ink = hex(theme, "primary-ink", set);
      for (const surface of SURFACES) {
        const ratio = contrastRatio(ink, hex(theme, surface, set));
        expect({ surface, ok: ratio >= MIN_TEXT_CONTRAST }).toEqual({
          surface,
          ok: true,
        });
      }
    },
  );

  it.each<Theme>(["light", "dark"])(
    "increased contrast: text 7:1, muted text 7:1, borders and focus 3:1 (%s)",
    (theme) => {
      const failing: string[] = [];
      const check = (
        token: string,
        min: number,
        surfaces: readonly string[],
      ) => {
        for (const surface of surfaces) {
          const ratio = contrastRatio(
            hex(theme, token, "more"),
            hex(theme, surface, "more"),
          );
          if (ratio < min)
            failing.push(`${token} on ${surface} ${ratio.toFixed(2)}`);
        }
      };
      expect(contrastTokens(theme).foreground).toBe(
        theme === "dark" ? "oklch(1 0 0)" : "oklch(0 0 0)",
      );
      check("foreground", 7, ["background", "card", "muted"]);
      check("muted-foreground", 7, ["background", "card", "popover"]);
      check("muted-foreground", 4.5, ["muted", "secondary", "sidebar"]);
      check("border", 3, ["background", "card"]);
      check("focus-ring", 3, ["background", "card", "muted"]);
      expect(failing).toEqual([]);
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
  it("reads editor SCSS custom properties per theme", () => {
    expect(readScssVar(PARAGRAPH_SCSS, ":root", "--link-text-color")).toBe(
      "#1155cc",
    );
    expect(readScssVar(PARAGRAPH_SCSS, ".dark", "--link-text-color")).toBe(
      "#93c5fd",
    );
  });

  it.each<Theme>(["light", "dark"])(
    "document links reach 4.5:1 on the page and on cards (%s)",
    (theme) => {
      const selector = theme === "dark" ? ".dark" : ":root";
      const link = readScssVar(PARAGRAPH_SCSS, selector, "--link-text-color");
      for (const surface of ["background", "card"]) {
        const ratio = contrastRatio(link, hex(theme, surface));
        expect({ surface, ok: ratio >= MIN_TEXT_CONTRAST }).toEqual({
          surface,
          ok: true,
        });
      }
    },
  );

  // #104. Highlights in the document use HIGHLIGHT_PALETTE:
  // `text-style-marks.scss` redefines `--tt-color-highlight-*` inside
  // `.tiptap`, so the global values in `styles/_variables.scss` only colour
  // the old popover swatches and are not the document's backgrounds.
  it.each<Theme>(["light", "dark"])(
    "document links reach 4.5:1 on every highlight (%s)",
    (theme) => {
      const selector = theme === "dark" ? ".dark" : ":root";
      const link = readScssVar(PARAGRAPH_SCSS, selector, "--link-text-color");
      const failing = HIGHLIGHT_TOKENS.map((highlight) => ({
        highlight,
        ratio: contrastRatio(link, HIGHLIGHT_PALETTE[highlight][theme]),
      }))
        .filter(({ ratio }) => ratio < MIN_TEXT_CONTRAST)
        .map(({ highlight, ratio }) => `${highlight} ${ratio.toFixed(2)}:1`);
      expect(failing).toEqual([]);
    },
  );
});
