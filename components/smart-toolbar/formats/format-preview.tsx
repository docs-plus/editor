"use client";

import type { ReactNode } from "react";

import type { FormatBundle } from "@/extensions/repeat-formatting/bundle";

import "./format-preview.scss";

const MARKS = ["bold", "italic", "underline", "strike"] as const;

/**
 * `children` rendered in `bundle`'s formatting (design pass §4, §7, §8):
 * a saved format's name in the style dropdown and the Aa sheet, its chip
 * in the palette, and the Save view's sample. Only `data-*` tokens, styled
 * by `format-preview.scss` (no inline CSS, and a tampered bundle cannot
 * inject a value).
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
      data-marks={MARKS.filter((mark) => bundle[mark]).join(" ")}
      data-text-color={bundle.textColor ?? undefined}
      data-highlight={bundle.highlight ?? undefined}
      data-font-size={bundle.fontSize ?? undefined}
    >
      {children}
    </span>
  );
}
