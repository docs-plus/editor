"use client";

import type { Editor } from "@tiptap/react";
import { useCurrentEditor } from "@tiptap/react";

import { ToolbarButton } from "@/components/ui/toolbar-button";
import { useActionView } from "@/hooks/use-editor-context";
import { editorActions } from "@/lib/editor-actions";
import { runAction } from "@/lib/editor-actions/registry";
import { colorLabel } from "@/lib/editor-actions/surface-actions";
import { CloseIcon } from "@/lib/icons";
import {
  HIGHLIGHT_CHOICE,
  TEXT_COLOR_CHOICE,
  useRememberedChoice,
} from "@/lib/remembered-choice";

import { ActionButton } from "./action-button";
import { type Swatch, swatchStyle } from "./color/swatch";
import { PaintFormatButton } from "./formats/paint-format-button";
import type { SurfaceProps } from "./types";

export type MobileBarMode = "all" | "selection";

/**
 * Whether the phone bar shows its normal cells or the selection cells
 * (spec §4.7). ✕ for this selection (`dismissedForSelection`) always means
 * "all": it is the user's own action, so it overrides the focus guard.
 * Otherwise it never swaps while focus is inside the bar (VoiceOver would
 * lose its place), and swaps to "selection" iff text is selected. D2's
 * phone bar calls it and resets `dismissedForSelection` on a new selection.
 */
export function nextMobileBarMode(input: {
  hasTextSelection: boolean;
  focusInBar: boolean;
  dismissedForSelection: boolean;
  current: MobileBarMode;
}): MobileBarMode {
  if (input.dismissedForSelection) return "all";
  if (input.focusInBar) return input.current;
  return input.hasTextSelection ? "selection" : "all";
}

const COLOR_CELLS = {
  text: {
    id: "color.text.apply",
    choice: TEXT_COLOR_CHOICE,
    apply: "Apply text colour",
  },
  highlight: {
    id: "color.highlight.apply",
    choice: HIGHLIGHT_CHOICE,
    apply: "Apply highlight",
  },
} as const;

/**
 * Text colour or highlight: applies the colour last used (M3), and shows
 * it as a 12×3 bar under the icon, like the row's split face. The Aa
 * sheet keeps the full palette.
 */
function ColorCell({
  kind,
  editor,
}: {
  kind: keyof typeof COLOR_CELLS;
  editor: Editor;
}) {
  const { id, choice, apply } = COLOR_CELLS[kind];
  const token = useRememberedChoice(choice).last;
  const view = useActionView(id, editor);
  const action = editorActions.get(id);
  if (!view || !action) return null;
  const reason = view.enabled === true ? undefined : view.enabled.reason;
  const label = `${apply}: ${colorLabel(token)}`;
  const Icon = action.icon;
  return (
    <ToolbarButton
      type="button"
      data-action-id={id}
      data-surface="phone"
      aria-label={label}
      tooltip={label}
      disabled={reason !== undefined}
      disabledReason={reason}
      className="st-split-face"
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => runAction(editor, action, token)}
    >
      {Icon ? <Icon aria-hidden="true" /> : null}
      <span
        aria-hidden="true"
        className={`st-face-bar st-face-bar--${kind}`}
        style={swatchStyle({ kind, token } as Swatch)}
      />
    </ToolbarButton>
  );
}

/**
 * After ✕ the cells unmount under focus. Once the bar re-renders its
 * normal cells, focus its first enabled one, so focus never drops to
 * `<body>` (spec §6.6). Does nothing if focus already moved out of the
 * bar. In the bar it may already be: WebKit fires no `focusout` for the
 * removed ✕, so the toolbar's own repair puts focus on the cell at ✕'s
 * index (Insert) first.
 */
function focusBarAfterBack(bar: Element | null): void {
  if (!bar) return;
  requestAnimationFrame(() => {
    const active = document.activeElement;
    if (active && active !== document.body && !bar.contains(active)) return;
    const target =
      bar.querySelector<HTMLElement>(
        "button:not([disabled]):not([aria-disabled='true'])",
      ) ?? bar.querySelector<HTMLElement>("button");
    target?.focus();
  });
}

/** The bar's label while swapped; the bar stays one `role="toolbar"`. */
export const SELECTION_BAR_LABEL = "Selection formatting";

/**
 * The cells in order (design pass §6): B I U, text colour, highlight,
 * link, Paint format, then ✕. Below 360px U leaves for the Aa sheet
 * (`phone.scss`), as do strikethrough, clear formatting and Your formats.
 */
export const PHONE_SELECTION_CELL_IDS = [
  "mark.bold",
  "mark.italic",
  "mark.underline",
  "color.text.apply",
  "color.highlight.apply",
  "mark.link",
  "repeat.copy",
] as const;

/**
 * Mobile selection swap (spec §4.7, design pass §6): eight 44px cells,
 * B I U A▁ ✎▁ 🔗 🖌 ✕ (352px; seven below 360px), so nothing scrolls and
 * no cell is ever under ✕. Rendered by D2's phone bar in place of its own
 * cells, inside its one toolbar. ✕ "Back to all tools", set off by a left
 * divider, calls `onBack` (D2 sets `dismissedForSelection`), then moves
 * focus to the bar's first cell once the normal cells are back.
 */
export function PhoneSelectionCells({
  editor: provided,
  onBack,
}: SurfaceProps & {
  onBack: () => void;
}) {
  const { editor: contextEditor } = useCurrentEditor();
  const editor = provided ?? contextEditor ?? null;
  if (!editor) return null;
  return (
    <>
      <ActionButton id="mark.bold" editor={editor} variant="phone" />
      <ActionButton id="mark.italic" editor={editor} variant="phone" />
      <ActionButton id="mark.underline" editor={editor} variant="phone" />
      <ColorCell kind="text" editor={editor} />
      <ColorCell kind="highlight" editor={editor} />
      <ActionButton id="mark.link" editor={editor} variant="phone" />
      <PaintFormatButton editor={editor} phone />
      <ToolbarButton
        type="button"
        aria-label="Back to all tools"
        tooltip="Back to all tools"
        className="shadow-[-1px_0_0_var(--border)]"
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          const bar = event.currentTarget.closest('[role="toolbar"]');
          onBack();
          focusBarAfterBack(bar);
        }}
      >
        <CloseIcon className="tiptap-button-icon" aria-hidden="true" />
      </ToolbarButton>
    </>
  );
}
