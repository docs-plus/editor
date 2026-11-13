"use client";

import type { CSSProperties, ReactNode } from "react";

import type { FormatBundle } from "@/extensions/repeat-formatting/bundle";

import "./format-preview.scss";

/**
 * Inline CSS for the marks of a saved format (design pass §4, §7): weight,
 * style and decoration. Colour, highlight and size come from the
 * `data-*` tokens `FormatPreview` sets, through `format-preview.scss`.
 */
export function formatPreviewStyle(bundle: FormatBundle): CSSProperties {
  const decoration = [
    bundle.underline && "underline",
    bundle.strike && "line-through",
  ].filter(Boolean);
  return {
    fontWeight: bundle.bold ? 700 : undefined,
    fontStyle: bundle.italic ? "italic" : undefined,
    textDecorationLine: decoration.length ? decoration.join(" ") : undefined,
  };
}

/**
 * `children` rendered in `bundle`'s formatting. Tokens only, never stored
 * CSS, so a tampered bundle cannot inject a value.
 */
export function FormatPreview({
  bundle,
  children,
}: {
  bundle: FormatBundle;
  children: ReactNode;
}) {
  return (
    <span
      className="st-format-preview"
      data-text-color={bundle.textColor ?? undefined}
      data-highlight={bundle.highlight ?? undefined}
      data-font-size={bundle.fontSize ?? undefined}
      style={formatPreviewStyle(bundle)}
    >
      {children}
    </span>
  );
}
