"use client";

import { useCurrentEditor } from "@tiptap/react";

import { ToolbarButton } from "@/components/ui/toolbar-button";
import { CloseIcon } from "@/lib/icons";

import { ActionButton } from "./action-button";
import type { SurfaceProps } from "./types";

export type MobileBarMode = "all" | "selection";

/**
 * Whether the phone bar shows its normal cells or the selection cells
 * (spec §4.7). Never swaps while focus is inside the bar (VoiceOver would
 * lose its place); otherwise swaps to "selection" iff text is selected and
 * the user has not pressed ✕ for this selection. D2's phone bar calls it.
 */
export function nextMobileBarMode(input: {
  hasTextSelection: boolean;
  focusInBar: boolean;
  dismissedForSelection: boolean;
  current: MobileBarMode;
}): MobileBarMode {
  if (input.focusInBar) return input.current;
  return input.hasTextSelection && !input.dismissedForSelection
    ? "selection"
    : "all";
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
      {PHONE_SELECTION_CELL_IDS.map((id) => (
        <ActionButton key={id} id={id} editor={editor} variant="phone" />
      ))}
      <ToolbarButton
        type="button"
        aria-label="Back to all tools"
        tooltip="Back to all tools"
        className="sticky end-0 min-h-11 min-w-11 bg-background"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onBack}
      >
        <CloseIcon className="tiptap-button-icon" aria-hidden="true" />
      </ToolbarButton>
    </>
  );
}
