/**
 * Text colour, highlight and font size tokens (spec §3, Appendix A).
 * Owned by PR C. No browser imports: the server imports this file too.
 *
 * Contract: token *values* may only be added, never renamed or removed
 * (spec §3 schema evolution rule). Swatch order is the array order.
 */
import { HIGHLIGHT_TOKENS, type HighlightToken } from "@/lib/highlight-tokens";

export { HIGHLIGHT_TOKENS, type HighlightToken };

/** Mark names. Not in `SCHEMA_MARK_NAMES` until PR C's server half ships. */
export const TEXT_COLOR_MARK = "textColor";
export const FONT_SIZE_MARK = "fontSize";
export const HIGHLIGHT_MARK = "highlight";

/** Render attributes (`renderHTML` emits them; paste keeps them). */
export const TEXT_COLOR_ATTR = "data-text-color";
export const FONT_SIZE_ATTR = "data-font-size";
export const HIGHLIGHT_ATTR = "data-highlight";

/** Text colour tokens: the same ten names as the highlight palette. */
export const TEXT_COLOR_TOKENS = HIGHLIGHT_TOKENS;
export type TextColorToken = HighlightToken;

/** `fontSize` mark values. "M" (default) is the absence of the mark. */
export const FONT_SIZE_TOKENS = ["xs", "sm", "lg", "xl"] as const;
export type FontSizeToken = (typeof FONT_SIZE_TOKENS)[number];

/** Stepper ladder, smallest first; `"md"` means "no fontSize mark". */
export const FONT_SIZE_LADDER = ["xs", "sm", "md", "lg", "xl"] as const;
export type FontSizeStep = (typeof FONT_SIZE_LADDER)[number];

/** Rendered size in em per step. */
export const FONT_SIZE_EM: Readonly<Record<FontSizeStep, number>> = {
  xs: 0.75,
  sm: 0.875,
  md: 1,
  lg: 1.25,
  xl: 1.5,
};

/** Light / dark values per token (Appendix A). Contrast is unit-tested by C. */
export interface ThemedColor {
  light: string;
  dark: string;
}

export const TEXT_COLOR_PALETTE: Readonly<Record<TextColorToken, ThemedColor>> =
  {
    gray: { light: "#57534e", dark: "#a8a29e" },
    brown: { light: "#8a4b2a", dark: "#d0a284" },
    red: { light: "#dc2626", dark: "#f87171" },
    orange: { light: "#c2410c", dark: "#fb923c" },
    yellow: { light: "#a16207", dark: "#facc15" },
    green: { light: "#15803d", dark: "#4ade80" },
    teal: { light: "#0f766e", dark: "#2dd4bf" },
    blue: { light: "#2563eb", dark: "#60a5fa" },
    purple: { light: "#9333ea", dark: "#c084fc" },
    pink: { light: "#db2777", dark: "#f472b6" },
  };

export const HIGHLIGHT_PALETTE: Readonly<Record<HighlightToken, ThemedColor>> =
  {
    gray: { light: "#e7e5e4", dark: "#3f3f46" },
    brown: { light: "#eddcd0", dark: "#4a3228" },
    red: { light: "#fecaca", dark: "#5c2a2e" },
    orange: { light: "#fed7aa", dark: "#5c3b23" },
    yellow: { light: "#fef08a", dark: "#574f12" },
    green: { light: "#bbf7d0", dark: "#1f4a30" },
    teal: { light: "#99f6e4", dark: "#174542" },
    blue: { light: "#bfdbfe", dark: "#1e3a5f" },
    purple: { light: "#e9d5ff", dark: "#45305e" },
    pink: { light: "#fbcfe8", dark: "#5a2945" },
  };

export function isTextColorToken(value: unknown): value is TextColorToken {
  return (
    typeof value === "string" &&
    (TEXT_COLOR_TOKENS as readonly string[]).includes(value)
  );
}

export function isFontSizeToken(value: unknown): value is FontSizeToken {
  return (
    typeof value === "string" &&
    (FONT_SIZE_TOKENS as readonly string[]).includes(value)
  );
}
