/** Highlight palette tokens (spec Appendix A). Order is the swatch order. */
export const HIGHLIGHT_TOKENS = [
  "gray",
  "brown",
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "blue",
  "purple",
  "pink",
] as const;

export type HighlightToken = (typeof HIGHLIGHT_TOKENS)[number];

const LEGACY_VAR = /^var\(--tt-color-highlight-([a-z]+)\)$/;

const isHighlightToken = (value: string): value is HighlightToken =>
  (HIGHLIGHT_TOKENS as readonly string[]).includes(value);

/**
 * Maps a stored highlight `color` value to a palette token. Accepts a bare
 * token or the legacy `var(--tt-color-highlight-X)` string; everything else
 * (hex, other variables, hostile strings) is null.
 */
export function highlightTokenFromValue(value: unknown): HighlightToken | null {
  if (typeof value !== "string") return null;
  const candidate = LEGACY_VAR.exec(value)?.[1] ?? value;
  return isHighlightToken(candidate) ? candidate : null;
}
