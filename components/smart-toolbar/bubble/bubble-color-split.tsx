"use client";

import type { Editor } from "@tiptap/react";

import { ToolbarButton } from "@/components/ui/toolbar-button";
import { useActionView } from "@/hooks/use-editor-context";
import { editorActions } from "@/lib/editor-actions";
import { runAction } from "@/lib/editor-actions/registry";
import { colorLabel } from "@/lib/editor-actions/surface-actions";
import { BaselineIcon, ChevronDownIcon } from "@/lib/icons";
import {
  TEXT_COLOR_CHOICE,
  useRememberedChoice,
} from "@/lib/remembered-choice";

import { swatchStyle } from "../color/swatch";
import { ColorPopoverButton } from "../color-controls";
import { useBubbleReason } from "./bubble-action-button";
import type { BubblePlacement } from "./bubble-rules";

const APPLY_ID = "color.text.apply";

/**
 * The bubble's text colour split (spec §7.1 slot 7): the face reapplies
 * the remembered colour ("Apply text colour: Red"), the 24px chevron opens
 * the colour menu away from the text. `ColorSplit`'s text half, with the
 * inline code reason (`useBubbleReason`), in the bubble chunk so the
 * editor chunk's split stays as it is.
 */
export function BubbleColorSplit({
  editor,
  placement,
}: {
  editor: Editor;
  placement: BubblePlacement;
}) {
  const view = useActionView(APPLY_ID, editor);
  const remembered = useRememberedChoice(TEXT_COLOR_CHOICE);
  const reason = useBubbleReason(
    editor,
    !view || view.enabled === true ? undefined : view.enabled.reason,
  );
  if (!view) return null;
  const faceLabel = `Apply text colour: ${colorLabel(remembered.last)}`;
  return (
    <div className="st-split" data-color-kind="text">
      <ToolbarButton
        type="button"
        className="st-split-face"
        aria-label={faceLabel}
        tooltip={faceLabel}
        disabled={reason !== undefined}
        disabledReason={reason}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          const action = editorActions.get(APPLY_ID);
          if (action) runAction(editor, action, remembered.last);
        }}
      >
        <BaselineIcon aria-hidden="true" />
        <span
          aria-hidden="true"
          className="st-face-bar st-face-bar--text"
          style={swatchStyle({ kind: "text", token: remembered.last })}
        />
      </ToolbarButton>
      <ColorPopoverButton
        editor={editor}
        focusKind="text"
        label="More text colours"
        className="st-split-chevron"
        reason={reason}
        side={placement}
      >
        <ChevronDownIcon aria-hidden="true" />
      </ColorPopoverButton>
    </div>
  );
}
