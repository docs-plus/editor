"use client";

import type { Editor } from "@tiptap/react";

import { useActionView } from "@/hooks/use-editor-context";
import { announce } from "@/lib/announce";
import { editorActions } from "@/lib/editor-actions";
import { runAction } from "@/lib/editor-actions/registry";
import { type ColorTheme, isLowContrastPair } from "@/lib/text-style-contrast";
import { HIGHLIGHT_TOKENS, isTextColorToken } from "@/lib/text-style-tokens";

import { type Swatch, swatchName } from "./swatch";

/*
 * What both colour layouts share (`color-panel.tsx` grid, `color-rows.tsx`
 * named rows): the selection's colours, why a kind cannot apply, the O3
 * low-contrast rule, applying, and the pointed-swatch marker. Lazy colour
 * chunk only.
 */

const tokenOf = (value: string | null) => value?.toLowerCase() ?? null;

/** The token a view shows; null when none, mixed or not a palette token. */
function paletteToken(value: string | null | undefined) {
  return isTextColorToken(value) ? value : null;
}

/** The theme is a class on <html> (`lib/theme.ts`); this chunk is client-only. */
const currentTheme = (): ColorTheme =>
  document.documentElement.classList.contains("dark") ? "dark" : "light";

/** O3: true when a highlight swatch would put the current text below AA. */
function isLowContrast(
  swatch: Swatch,
  text: string | null | undefined,
  theme: ColorTheme,
): boolean {
  return (
    swatch.kind === "highlight" &&
    isLowContrastPair(paletteToken(text), swatch.token, theme)
  );
}

/** Tooltip: the disabled reason wins over the low-contrast note. */
export function swatchTitle(
  name: string,
  reason: string,
  low: boolean,
): string {
  if (reason) return `${name}: ${reason}`;
  return low ? `${name}: low contrast` : name;
}

export const LOW_CONTRAST = "Low contrast with the current text colour";

/**
 * The visible line under Highlight while any swatch is dotted: "Dotted:
 * hard to read with Red text" (design pass §11).
 */
export function lowContrastNote(text: string | null | undefined): string {
  const token = paletteToken(text);
  const name = token ? swatchName({ kind: "text", token }) : "default text";
  return `Dotted: hard to read with ${name}`;
}

/**
 * Marks the swatch under a mouse or pen (`data-pointed`, null for none)
 * and the panel while one is (`data-pointing`), so the swatch being
 * previewed wears the focus ring and keyboard focus on another swatch
 * steps down to a dashed one (`color-panel.scss`). Straight on the DOM:
 * pointing never re-renders the panel.
 */
export function markPointed(panel: HTMLElement | null, swatch: Element | null) {
  panel?.querySelector("[data-pointed]")?.removeAttribute("data-pointed");
  swatch?.setAttribute("data-pointed", "");
  panel?.toggleAttribute("data-pointing", swatch !== null);
}

export function applySwatch(editor: Editor, swatch: Swatch): boolean {
  const id =
    swatch.kind === "text"
      ? swatch.token
        ? "color.text.apply"
        : "color.text.unset"
      : swatch.token
        ? "color.highlight.apply"
        : "color.highlight.unset";
  const action = editorActions.get(id);
  return action ? runAction(editor, action, swatch.token ?? undefined) : false;
}

/**
 * Names a pick in the polite live region and on the pill, with Undo
 * (WCAG 4.1.3, spec §7.3 and §14): "Teal text".
 */
export function announcePick(editor: Editor, swatch: Swatch): void {
  announce(swatchName(swatch), {
    done: true,
    action: {
      label: "Undo",
      run: () => {
        const undo = editorActions.get("history.undo");
        if (undo) runAction(editor, undo);
      },
    },
  });
}

export interface ColorState {
  /** The current token per kind: null for none, undefined when mixed. */
  current: Record<Swatch["kind"], string | null | undefined>;
  /** Why a kind cannot apply here; "" when it can. */
  reasons: Record<Swatch["kind"], string>;
  isPressed: (swatch: Swatch) => boolean;
  /** O3 for one swatch, against the current text colour and theme. */
  isLow: (swatch: Swatch) => boolean;
  /** Any highlight swatch is dotted: show the note. */
  anyLow: boolean;
  /** The swatch to preview, or null when its kind cannot apply here. */
  previewable: (swatch: Swatch) => Swatch | null;
}

/** The selection's colour state, from the registry's views. */
export function useColorState(editor: Editor): ColorState {
  const textView = useActionView("color.text.apply", editor);
  const highlightView = useActionView("color.highlight.apply", editor);
  const current = {
    text: textView?.mixed ? undefined : tokenOf(textView?.value ?? null),
    highlight: highlightView?.mixed
      ? undefined
      : tokenOf(highlightView?.value ?? null),
  };
  const reasons = {
    text: textView && textView.enabled !== true ? textView.enabled.reason : "",
    highlight:
      highlightView && highlightView.enabled !== true
        ? highlightView.enabled.reason
        : "",
  };
  const theme = currentTheme();
  const isLow = (swatch: Swatch) => isLowContrast(swatch, current.text, theme);
  return {
    current,
    reasons,
    isPressed: (swatch) => current[swatch.kind] === swatch.token,
    isLow,
    anyLow: HIGHLIGHT_TOKENS.some((token) =>
      isLow({ kind: "highlight", token }),
    ),
    previewable: (swatch) => (reasons[swatch.kind] ? null : swatch),
  };
}
