/**
 * Contrast of palette text on a palette highlight (spec Appendix A, owner
 * decision O3): the colour popover dims swatches that would put text below
 * WCAG AA on its highlight. Kept out of `text-style-tokens.ts` so only the
 * lazy colour panel (and tests) load it, never the editor chunk.
 */
import {
  HIGHLIGHT_PALETTE,
  type HighlightToken,
  TEXT_COLOR_PALETTE,
  type TextColorToken,
  type ThemedColor,
} from "@/lib/text-style-tokens";

export type ColorTheme = keyof ThemedColor;

/** WCAG 2.x AA for body text. */
export const MIN_TEXT_CONTRAST = 4.5;

/** WCAG 2.x relative luminance of a `#rrggbb` colour. */
function luminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) throw new Error(`not a #rrggbb colour: ${hex}`);
  const value = Number.parseInt(match[1], 16);
  const channel = (shift: number) => {
    const c = ((value >> shift) & 0xff) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
}

/** WCAG 2.x contrast ratio between two `#rrggbb` colours (1–21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * True when `text` on `highlight` is below AA in `theme`. Default text
 * (null) is ≥ 7:1 on every highlight and every text colour is ≥ 4.5:1 on
 * the page (no highlight), so a null side is never low (palette test).
 */
export function isLowContrastPair(
  text: TextColorToken | null,
  highlight: HighlightToken | null,
  theme: ColorTheme,
): boolean {
  if (!text || !highlight) return false;
  return (
    contrastRatio(
      TEXT_COLOR_PALETTE[text][theme],
      HIGHLIGHT_PALETTE[highlight][theme],
    ) < MIN_TEXT_CONTRAST
  );
}
