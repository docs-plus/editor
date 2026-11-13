import { describe, expect, it } from "bun:test";

import {
  contrastRatio,
  isLowContrastPair,
  MIN_TEXT_CONTRAST,
} from "@/lib/text-style-contrast";
import { HIGHLIGHT_TOKENS, TEXT_COLOR_TOKENS } from "@/lib/text-style-tokens";

const pairs = TEXT_COLOR_TOKENS.flatMap((text) =>
  HIGHLIGHT_TOKENS.map((highlight) => [text, highlight] as const),
);

describe("text colour on a highlight: contrast table (O3)", () => {
  it("uses the WCAG AA threshold for body text", () => {
    expect(MIN_TEXT_CONTRAST).toBe(4.5);
  });

  it("computes WCAG 2.x contrast ratios", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBe(1);
    expect(contrastRatio("#dc2626", "#ffffff")).toBeCloseTo(
      contrastRatio("#ffffff", "#dc2626"),
      10,
    );
  });

  it("flags 77 of 100 light pairs and 49 of 100 dark pairs (Appendix A)", () => {
    const count = (theme: "light" | "dark") =>
      pairs.filter(([text, highlight]) =>
        isLowContrastPair(text, highlight, theme),
      ).length;
    expect(count("light")).toBe(77);
    expect(count("dark")).toBe(49);
  });

  it("flags the lowest pairs and passes the safe ones", () => {
    expect(isLowContrastPair("pink", "red", "light")).toBe(true);
    expect(isLowContrastPair("red", "red", "light")).toBe(true);
    expect(isLowContrastPair("red", "yellow", "dark")).toBe(true);
    expect(isLowContrastPair("gray", "yellow", "light")).toBe(false);
    expect(isLowContrastPair("yellow", "purple", "dark")).toBe(false);
    // Teal on yellow flips with the theme.
    expect(isLowContrastPair("teal", "yellow", "light")).toBe(false);
    expect(isLowContrastPair("teal", "yellow", "dark")).toBe(true);
  });

  it("never flags default text or no highlight", () => {
    for (const theme of ["light", "dark"] as const) {
      for (const text of TEXT_COLOR_TOKENS) {
        expect(isLowContrastPair(text, null, theme)).toBe(false);
      }
      for (const highlight of HIGHLIGHT_TOKENS) {
        expect(isLowContrastPair(null, highlight, theme)).toBe(false);
      }
      expect(isLowContrastPair(null, null, theme)).toBe(false);
    }
  });
});
