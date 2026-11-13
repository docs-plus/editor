"use client";

import type { Editor } from "@tiptap/react";
import { useCurrentEditor } from "@tiptap/react";

import { ToolbarButton } from "@/components/ui/toolbar-button";
import { useActionView } from "@/hooks/use-editor-context";
import { availability, runAction } from "@/lib/editor-actions/registry";
import { repeatApplyAction } from "@/lib/editor-actions/v11-actions";
import { getEditorContextStore } from "@/lib/editor-context/store";
import { CloseIcon, RepeatIcon } from "@/lib/icons";

import { ActionButton } from "./action-button";
import { useRememberedBundle } from "./repeat-split-button";
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

/**
 * ↻ Repeat as a phone cell. `repeat.apply` reads the remembered bundle,
 * which is not part of the context snapshot (contract §3.1, documented
 * external read), so the cached `getView` can lag a bundle change. This
 * cell re-renders on bundle changes and on view changes, and computes its
 * availability from the live snapshot at render.
 */
function RepeatCell({ editor }: { editor: Editor }) {
  useActionView(repeatApplyAction.id, editor);
  useRememberedBundle();
  const enabled = availability(
    repeatApplyAction,
    getEditorContextStore(editor).getContext(),
  );
  const reason = enabled === true ? undefined : enabled.reason;
  return (
    <ToolbarButton
      type="button"
      data-action-id={repeatApplyAction.id}
      data-surface="phone"
      aria-label={repeatApplyAction.label}
      tooltip={repeatApplyAction.label}
      className="min-h-11 min-w-11"
      disabled={reason !== undefined}
      disabledReason={reason}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => runAction(editor, repeatApplyAction)}
    >
      <RepeatIcon className="tiptap-button-icon" aria-hidden="true" />
    </ToolbarButton>
  );
}

/**
 * After ✕ the cells unmount under focus. Once the bar re-renders its
 * normal cells, focus its first enabled one, so focus never drops to
 * `<body>` (spec §6.6). Does nothing if focus already moved elsewhere.
 */
function focusBarAfterBack(bar: Element | null): void {
  if (!bar) return;
  requestAnimationFrame(() => {
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const target =
      bar.querySelector<HTMLElement>(
        "button:not([disabled]):not([aria-disabled='true'])",
      ) ?? bar.querySelector<HTMLElement>("button");
    target?.focus();
  });
}

/** The bar's label while swapped; the bar stays one `role="toolbar"`. */
export const SELECTION_BAR_LABEL = "Selection formatting";

/** Registry ids, in order; unknown ids render nothing until their track lands. */
export const PHONE_SELECTION_CELL_IDS = [
  "mark.bold",
  "mark.italic",
  "mark.underline",
  "mark.strike",
  "color.text.apply",
  "color.highlight.apply",
  "mark.link",
  "format.clear",
  "repeat.apply",
] as const;

/**
 * Mobile selection swap (spec §4.7): B I U S, text colour, highlight,
 * link, clear, ↻ Repeat, then ✕ "Back to all tools". Rendered by D2's
 * phone bar in place of its own cells, inside its one toolbar, which
 * scrolls horizontally; ✕ stays pinned at the inline end. Cells are
 * registry actions through `ActionButton` (44×44 in the phone variant).
 * ✕ calls `onBack` (D2 sets `dismissedForSelection`), then moves focus to
 * the bar's first cell once the normal cells are back.
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
      {PHONE_SELECTION_CELL_IDS.map((id) =>
        id === repeatApplyAction.id ? (
          <RepeatCell key={id} editor={editor} />
        ) : (
          <ActionButton key={id} id={id} editor={editor} variant="phone" />
        ),
      )}
      <ToolbarButton
        type="button"
        aria-label="Back to all tools"
        tooltip="Back to all tools"
        className="sticky end-0 min-h-11 min-w-11 bg-background"
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
