"use client";

import type { CSSProperties, ReactNode } from "react";

import type { FormatBundle } from "@/extensions/repeat-formatting/bundle";
import { FONT_SIZE_EM, TEXT_COLOR_PALETTE } from "@/lib/text-style-tokens";
import "./formats.scss";

/**
 * A saved format's name rendered in its own formatting (design pass §4):
 * weight, style, decoration, the token colour for both themes, the
 * highlight fill and the size, as inline custom properties read by
 * `formats.scss`. Tokens only, so a tampered stored bundle (already
 * validated on read) can never inject CSS.
 */
export function formatPreviewStyle(bundle: FormatBundle): CSSProperties {
  const decoration = [
    bundle.underline ? "underline" : "",
    bundle.strike ? "line-through" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const style: Record<string, string | number> = {};
  if (bundle.bold) style.fontWeight = 700;
  if (bundle.italic) style.fontStyle = "italic";
  if (decoration) style.textDecorationLine = decoration;
  if (bundle.fontSize) style.fontSize = `${FONT_SIZE_EM[bundle.fontSize]}em`;
  if (bundle.textColor) {
    const { light, dark } = TEXT_COLOR_PALETTE[bundle.textColor];
    style["--preview-light"] = light;
    style["--preview-dark"] = dark;
  }
  if (bundle.highlight) {
    style["--preview-fill"] = `var(--tt-color-highlight-${bundle.highlight})`;
  }
  return style as CSSProperties;
}

export function FormatPreview({
  bundle,
  children,
}: {
  bundle: FormatBundle;
  children: ReactNode;
}) {
  return (
    <span className="st-format-preview" style={formatPreviewStyle(bundle)}>
      {children}
    </span>
  );
}
