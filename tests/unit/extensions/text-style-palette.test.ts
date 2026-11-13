import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

import {
  FONT_SIZE_EM,
  FONT_SIZE_TOKENS,
  HIGHLIGHT_PALETTE,
  HIGHLIGHT_TOKENS,
  TEXT_COLOR_PALETTE,
  TEXT_COLOR_TOKENS,
  type ThemedColor,
} from "@/lib/text-style-tokens";
import { contrastRatio } from "@/tests/helpers/contrast";

const SCSS = readFileSync(
  "extensions/text-style-marks/text-style-marks.scss",
  "utf8",
);

/** Page colours from app/globals.css (oklch 1 / 0.145 / 0.985). */
const PAGE = {
  light: { background: "#ffffff", text: "#0a0a0a" },
  dark: { background: "#0a0a0a", text: "#fafafa" },
} as const;

/** `$name: (token: (light: #x, dark: #y), …)` from the SCSS partial. */
function scssPalette(name: string): Record<string, ThemedColor> {
  const block = new RegExp(`\\$${name}:\\s*\\(([\\s\\S]*?)\\n\\);`).exec(
    SCSS,
  )?.[1];
  if (!block) throw new Error(`$${name} not found`);
  const entries = [
    ...block.matchAll(
      /"([a-z]+)":\s*\(\s*light:\s*(#[0-9a-f]{6}),\s*dark:\s*(#[0-9a-f]{6}),?\s*\)/gi,
    ),
  ];
  return Object.fromEntries(
    entries.map(([, token, light, dark]) => [token, { light, dark }]),
  );
}

describe("text style palette (Appendix A)", () => {
  it("page colours still match app/globals.css", () => {
    const css = readFileSync("app/globals.css", "utf8");
    expect(css).toContain("--background: oklch(1 0 0)");
    expect(css).toContain("--foreground: oklch(0.145 0 0)");
    expect(css).toContain("--background: oklch(0.145 0 0)");
    expect(css).toContain("--foreground: oklch(0.985 0 0)");
  });

  it("the SCSS partial renders exactly the TypeScript palette", () => {
    expect(scssPalette("text-colors")).toEqual({ ...TEXT_COLOR_PALETTE });
    expect(scssPalette("highlight-colors")).toEqual({ ...HIGHLIGHT_PALETTE });
  });

  it("the SCSS size steps match FONT_SIZE_EM", () => {
    for (const token of FONT_SIZE_TOKENS) {
      expect(SCSS).toContain(`"${token}": ${FONT_SIZE_EM[token]}em`);
    }
  });

  it("keeps sized text at heading size inside headings", () => {
    expect(SCSS).toMatch(
      /\.tiptap :is\(h1, h2, h3, h4, h5, h6\) span\[data-font-size\]\s*\{\s*font-size: inherit;/,
    );
  });

  for (const theme of ["light", "dark"] as const) {
    it(`every text colour is ≥ 4.5:1 on the ${theme} page`, () => {
      for (const token of TEXT_COLOR_TOKENS) {
        const ratio = contrastRatio(
          TEXT_COLOR_PALETTE[token][theme],
          PAGE[theme].background,
        );
        expect({ token, pass: ratio >= 4.5 }).toEqual({ token, pass: true });
      }
    });

    it(`page text is ≥ 7:1 on every ${theme} highlight`, () => {
      for (const token of HIGHLIGHT_TOKENS) {
        const ratio = contrastRatio(
          PAGE[theme].text,
          HIGHLIGHT_PALETTE[token][theme],
        );
        expect({ token, pass: ratio >= 7 }).toEqual({ token, pass: true });
      }
    });
  }

  /**
   * Coloured text on a highlight is an open decision (Appendix A, "Text
   * colour on a highlight"): these pairs fall below 4.5:1 today. Pinned so a
   * palette change, or a fix such as a scoped darker variant inside
   * `mark[data-highlight]`, has to update this list on purpose.
   */
  const ALL = HIGHLIGHT_TOKENS.join(" ");
  const BELOW_AA_ON_HIGHLIGHT: Record<
    "light" | "dark",
    Record<string, string>
  > = {
    light: {
      gray: "",
      brown: "",
      red: ALL,
      orange: ALL,
      yellow: ALL,
      green: ALL,
      teal: "gray brown red orange teal blue purple pink",
      blue: ALL,
      purple: "gray brown red orange green teal blue purple pink",
      pink: ALL,
    },
    dark: {
      gray: "gray orange yellow green teal",
      brown: "orange yellow green",
      red: ALL,
      orange: "orange yellow green",
      yellow: "",
      green: "",
      teal: "yellow",
      blue: "gray orange yellow green teal purple pink",
      purple: ALL,
      pink: ALL,
    },
  };

  for (const theme of ["light", "dark"] as const) {
    it(`text colour on a ${theme} highlight: pairs below 4.5:1 are the pinned open set`, () => {
      const below = Object.fromEntries(
        TEXT_COLOR_TOKENS.map((text) => [
          text,
          HIGHLIGHT_TOKENS.filter(
            (highlight) =>
              contrastRatio(
                TEXT_COLOR_PALETTE[text][theme],
                HIGHLIGHT_PALETTE[highlight][theme],
              ) < 4.5,
          ).join(" "),
        ]),
      );
      expect(below).toEqual(BELOW_AA_ON_HIGHLIGHT[theme]);
    });
  }
});
