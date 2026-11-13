import type { CSSProperties } from "react";

import { colorLabel } from "@/lib/editor-actions/surface-actions";
import {
  type HighlightToken,
  TEXT_COLOR_PALETTE,
  type TextColorToken,
} from "@/lib/text-style-tokens";

/** One colour choice; a null token is "Default text" / "No highlight". */
export type Swatch =
  | { kind: "text"; token: TextColorToken | null }
  | { kind: "highlight"; token: HighlightToken | null };

export function swatchName(swatch: Swatch): string {
  if (swatch.kind === "text") {
    return swatch.token ? `${colorLabel(swatch.token)} text` : "Default text";
  }
  return swatch.token
    ? `${colorLabel(swatch.token)} highlight`
    : "No highlight";
}

/**
 * Inline custom properties read by `smart-toolbar.scss`, so the token
 * palette stays the one source of colour: text swatches carry both theme
 * values, highlights reuse the editor's highlight variables.
 */
export function swatchStyle(swatch: Swatch): CSSProperties | undefined {
  if (!swatch.token) return undefined;
  if (swatch.kind === "highlight") {
    return {
      "--swatch": `var(--tt-color-highlight-${swatch.token})`,
    } as CSSProperties;
  }
  const { light, dark } = TEXT_COLOR_PALETTE[swatch.token];
  return { "--swatch-light": light, "--swatch-dark": dark } as CSSProperties;
}
