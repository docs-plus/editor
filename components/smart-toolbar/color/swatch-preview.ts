"use client";

import { NodeSelection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { PreviewAttrs } from "@/extensions/action-preview";
import {
  HIGHLIGHT_ATTR,
  isTextColorToken,
  TEXT_COLOR_ATTR,
} from "@/lib/text-style-tokens";

import type { Swatch } from "./swatch";

/**
 * Hover preview for colour swatches (smart toolbar later phase): the
 * selected text shows a swatch's colour before it is applied. This module
 * is in the lazy colour-panel chunk and reaches the eager `ActionPreview`
 * extension only through its command, so it adds nothing to the editor
 * chunk (the type import is erased).
 */

/** On every preview element (tests and devtools find it by this). */
const PREVIEW_CLASS = "tt-preview";
/** A pointer rests this long on a swatch before its preview shows. */
export const PREVIEW_DWELL_MS = 80;
/** No preview over more top-level blocks than this (select-all). */
export const PREVIEW_MAX_BLOCKS = 200;
/** Nor over a longer range, in positions (an O(1) stand-in for length). */
export const PREVIEW_MAX_POSITIONS = 20_000;

/**
 * The blurred editor's selection paint (`.selection`, from Tiptap's
 * `Selection`) lands on the preview element. A preview drops it, so the
 * previewed words show exactly what applying gives: no blue tint under a
 * text colour, nothing over a highlight.
 */
const NO_TINT = "background-color: transparent";

/**
 * The decoration a swatch previews. A text colour carries the real mark's
 * token attribute, so the token CSS paints it. Backgrounds and "Default
 * text" are an inline style built from a palette token, which outranks the
 * selection paint. Null for a token outside the palette.
 */
export function swatchPreviewAttrs(swatch: Swatch): PreviewAttrs | null {
  const { kind, token } = swatch;
  if (token !== null && !isTextColorToken(token)) return null;
  if (kind === "text") {
    return token
      ? { [TEXT_COLOR_ATTR]: token, class: PREVIEW_CLASS, style: NO_TINT }
      : { class: PREVIEW_CLASS, style: `color: var(--foreground); ${NO_TINT}` };
  }
  return token
    ? {
        nodeName: "mark",
        [HIGHLIGHT_ATTR]: token,
        class: PREVIEW_CLASS,
        style: `background-color: var(--tt-color-highlight-${token})`,
      }
    : { class: PREVIEW_CLASS, style: "background-color: var(--background)" };
}

/**
 * Whether the selection can show a preview: editable, not a caret (nothing
 * to colour) or a node, and within the caps. Never reads the text.
 */
export function canPreview(editor: Editor): boolean {
  const { selection } = editor.state;
  if (!editor.isEditable || selection.empty) return false;
  if (selection instanceof NodeSelection) return false;
  const { from, to, $from, $to } = selection;
  return (
    to - from <= PREVIEW_MAX_POSITIONS &&
    $to.index(0) - $from.index(0) < PREVIEW_MAX_BLOCKS
  );
}

/**
 * Previews need a mouse or pen that hovers, and are off in forced colours
 * (which override the colours a preview would show) and when
 * `NEXT_PUBLIC_ACTION_PREVIEW=0`. Read once at mount, like
 * `isCoarsePointer()`.
 */
function previewSupported(): boolean {
  return (
    process.env.NEXT_PUBLIC_ACTION_PREVIEW !== "0" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(hover: hover) and (pointer: fine)").matches &&
    !window.matchMedia("(forced-colors: active)").matches
  );
}

export interface SwatchPreview {
  /** Pointer entered a swatch: preview it after the dwell (mouse or pen). */
  hover(event: { pointerType: string }, swatch: Swatch | null): void;
  /** Pointer left a swatch: clear after the dwell unless another takes over. */
  leave(): void;
  /**
   * Arrow keys moved to a swatch: preview it at once, or after the dwell
   * for a repeated key, so holding an arrow does not flash the text.
   */
  show(swatch: Swatch | null, repeat?: boolean): void;
  /** Focus left the grid: clear at once. */
  clear(): void;
}

const OFF: SwatchPreview = {
  hover() {},
  leave() {},
  show() {},
  clear() {},
};

/**
 * Swatch handlers for one colour panel. A null swatch (its kind cannot
 * apply here) clears. One timer is the only resource; unmount (the
 * popover closing, Esc) cancels it and clears the preview.
 */
export function useSwatchPreview(editor: Editor): SwatchPreview {
  const [supported] = useState(previewSupported);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const preview = useMemo<SwatchPreview>(() => {
    if (!supported) return OFF;
    const set = (swatch: Swatch | null) => {
      clearTimeout(timer.current);
      if (editor.isDestroyed) return;
      const attrs = swatch && canPreview(editor) && swatchPreviewAttrs(swatch);
      editor.commands.setActionPreview(attrs || null);
    };
    const later = (swatch: Swatch | null) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(set, PREVIEW_DWELL_MS, swatch);
    };
    return {
      hover(event, swatch) {
        if (event.pointerType === "mouse" || event.pointerType === "pen") {
          later(swatch);
        }
      },
      leave: () => later(null),
      show: (swatch, repeat) => (repeat ? later : set)(swatch),
      clear: () => set(null),
    };
  }, [editor, supported]);

  useEffect(() => preview.clear, [preview]);

  return preview;
}
