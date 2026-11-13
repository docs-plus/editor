"use client";

import type { SurfaceProps } from "./types";

/**
 * Mobile selection swap (spec §4.7): B I U S, colour, highlight, link,
 * clear, ✕ "Back to all tools". PR E owns. SKELETON: renders nothing, so
 * D2's phone bar keeps its normal cells.
 */
export function PhoneSelectionCells(
  _props: SurfaceProps & {
    onBack: () => void;
  },
) {
  return null;
}
