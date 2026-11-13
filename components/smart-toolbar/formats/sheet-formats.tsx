"use client";

import type { Editor } from "@tiptap/react";
import { useId } from "react";

import { ToolbarButton } from "@/components/ui/toolbar-button";
import { bundleSetLabel } from "@/extensions/repeat-formatting/bundle";
import { runAction } from "@/lib/editor-actions/registry";
import {
  formatsApplyAction,
  formatsSaveAction,
} from "@/lib/editor-actions/v11-actions";
import type { SavedFormat } from "@/lib/saved-formats";

import { openPalette } from "../palette/palette-store";
import { FormatPreview } from "./format-preview";
import {
  runWithEngine,
  useEActionReason,
  useSavedFormats,
} from "./use-e-action";

function SheetFormat({
  editor,
  format,
  reason,
}: {
  editor: Editor;
  format: SavedFormat;
  reason: string | undefined;
}) {
  const id = useId();
  return (
    <>
      <ToolbarButton
        type="button"
        data-saved-format=""
        data-surface="phone"
        size="sm"
        aria-describedby={reason ? undefined : id}
        disabled={reason !== undefined}
        disabledReason={reason}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() =>
          runWithEngine(editor, () =>
            runAction(editor, formatsApplyAction, format.id),
          )
        }
      >
        <FormatPreview bundle={format.bundle}>{format.name}</FormatPreview>
      </ToolbarButton>
      {reason ? null : (
        <span id={id} hidden>
          {bundleSetLabel(format.bundle)}
        </span>
      )}
    </>
  );
}

/**
 * Your formats in the phone's Aa sheet (design pass §6): the same
 * previews as the style dropdown, then "Save selection as format…",
 * which closes the sheet before the palette's save view opens over the
 * page. A pick keeps the sheet open, like the colours.
 */
export function SheetFormats({
  editor,
  onClose,
}: {
  editor: Editor;
  /** Closes the sheet, leaving focus to what opens next. */
  onClose: () => void;
}) {
  const saved = useSavedFormats();
  const apply = useEActionReason(formatsApplyAction, editor);
  const save = useEActionReason(formatsSaveAction, editor);
  return (
    <div className="st-sheet-list">
      {saved.map((format) => (
        <SheetFormat
          key={format.id}
          editor={editor}
          format={format}
          reason={apply}
        />
      ))}
      <ToolbarButton
        type="button"
        data-surface="phone"
        size="sm"
        disabled={save !== undefined}
        disabledReason={save}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          onClose();
          openPalette(editor, "save-format");
        }}
      >
        Save selection as format…
      </ToolbarButton>
    </div>
  );
}
