"use client";

import type { Editor } from "@tiptap/react";
import { useId, useState } from "react";

import { ToolbarButton } from "@/components/ui/toolbar-button";
import { bundleSetLabel } from "@/extensions/repeat-formatting/bundle";
import { runAction } from "@/lib/editor-actions/registry";
import {
  formatsApplyAction,
  formatsSaveAction,
  runWithEngine,
} from "@/lib/editor-actions/v11-actions";
import { TrashIcon } from "@/lib/icons";
import type { SavedFormat } from "@/lib/saved-formats";

import { openPalette } from "../palette/palette-store";
import { FormatPreview } from "./format-preview";
import { removeFormatWithUndo } from "./remove-format";
import { useEActionReason, useSavedFormats } from "./use-e-action";

/** Brings the first format to remove into view once the sheet settles. */
const focusSoon = (button: HTMLButtonElement | null) => {
  if (button) requestAnimationFrame(() => button.focus());
};

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
 * page, and "Remove a format", which lists the names: a tap removes at
 * once with Undo on the pill, as in the dropdown (§4). A pick keeps the
 * sheet open, like the colours.
 */
export function SheetFormats({
  editor,
  onClose,
  removing: startRemoving = false,
}: {
  editor: Editor;
  /** Closes the sheet, leaving focus to what opens next. */
  onClose: () => void;
  /** Opened for `formats.remove`: the Remove list starts open, focused. */
  removing?: boolean;
}) {
  const saved = useSavedFormats();
  const apply = useEActionReason(formatsApplyAction, editor);
  const save = useEActionReason(formatsSaveAction, editor);
  const [removing, setRemoving] = useState(startRemoving);
  const removeId = useId();
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
      {saved.length > 0 ? (
        <ToolbarButton
          type="button"
          data-surface="phone"
          size="sm"
          aria-expanded={removing}
          aria-controls={removeId}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setRemoving(!removing)}
        >
          Remove a format
        </ToolbarButton>
      ) : null}
      {removing && saved.length > 0 ? (
        <ul id={removeId} aria-label="Remove a format" className="contents">
          {saved.map((format, index) => (
            <li key={format.id} className="contents">
              <ToolbarButton
                ref={index === 0 && startRemoving ? focusSoon : undefined}
                type="button"
                data-surface="phone"
                size="sm"
                aria-label={`Remove ${format.name}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => removeFormatWithUndo(format, index)}
              >
                <TrashIcon aria-hidden="true" />
                <span className="min-w-0 truncate">{format.name}</span>
              </ToolbarButton>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
