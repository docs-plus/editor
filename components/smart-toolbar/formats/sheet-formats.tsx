"use client";

import type { Editor } from "@tiptap/react";
import { useId, useState } from "react";

import { ToolbarButton } from "@/components/ui/toolbar-button";
import { bundleSetLabel } from "@/extensions/repeat-formatting/bundle";
import { runAction } from "@/lib/editor-actions/registry";
import {
  formatsApplyAction,
  formatsRestoreAction,
  formatsSaveAction,
  runWithEngine,
} from "@/lib/editor-actions/v11-actions";
import { TrashIcon, Undo2Icon } from "@/lib/icons";
import { lastRemovedFormat, type SavedFormat } from "@/lib/saved-formats";

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
  reasonId,
}: {
  editor: Editor;
  format: SavedFormat;
  /** The visible note saying why formats cannot apply, when they cannot. */
  reasonId: string | undefined;
}) {
  const id = useId();
  return (
    <>
      <ToolbarButton
        type="button"
        data-saved-format=""
        data-surface="phone"
        size="sm"
        aria-describedby={reasonId ?? id}
        disabled={reasonId !== undefined}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() =>
          runWithEngine(editor, () =>
            runAction(editor, formatsApplyAction, format.id),
          )
        }
      >
        <FormatPreview bundle={format.bundle}>{format.name}</FormatPreview>
      </ToolbarButton>
      {reasonId ? null : (
        <span id={id} hidden>
          {bundleSetLabel(format.bundle)}
        </span>
      )}
    </>
  );
}

/**
 * Why a sheet control cannot run, as a visible line (design pass §10),
 * across the grid's full width.
 */
function SheetReason({ id, text }: { id: string; text: string | undefined }) {
  return text ? (
    <p
      id={id}
      className="st-sheet-reason st-sheet-wide text-xs text-muted-foreground"
    >
      {text}
    </p>
  ) : null;
}

/**
 * "Restore ‘X’" for the last format removed in this tab (`formats.restore`,
 * design pass §4): phones have no palette, where desktop offers it, and the
 * pill's Undo lasts 5 s. Full width with its reason as a visible line, like
 * Save, when the name came back meanwhile or the cap is reached.
 */
function SheetRestore({
  editor,
  format,
}: {
  editor: Editor;
  format: SavedFormat;
}) {
  const reason = useEActionReason(formatsRestoreAction, editor);
  const reasonId = useId();
  return (
    <div className="st-sheet-wide">
      <ToolbarButton
        type="button"
        data-surface="phone"
        size="sm"
        aria-describedby={reason ? reasonId : undefined}
        disabled={reason !== undefined}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() =>
          runWithEngine(editor, () =>
            runAction(editor, formatsRestoreAction, format.id),
          )
        }
      >
        <Undo2Icon aria-hidden="true" />
        <span className="min-w-0 truncate">Restore ‘{format.name}’</span>
      </ToolbarButton>
      <SheetReason id={reasonId} text={reason} />
    </div>
  );
}

/** The last removed format while it is still gone, else null. */
function restorable(saved: readonly SavedFormat[]): SavedFormat | null {
  const last = lastRemovedFormat();
  return last && !saved.some((format) => format.id === last.format.id)
    ? last.format
    : null;
}

/**
 * Your formats in the phone's Aa sheet (design pass §6): the same
 * previews as the style dropdown, then "Save selection as format…",
 * which closes the sheet before the palette's save view opens over the
 * page, and "Remove a format", which opens the names as a list of their
 * own, inset under it: a tap removes at once with Undo on the pill, as
 * in the dropdown (§4), and "Restore ‘X’" under them until the next
 * removal or a reload. A pick keeps the sheet open, like the colours.
 * Phones show no tooltips, so why a control is unavailable is a visible
 * line under it (§10). Save, Remove and the list span the grid's width,
 * so a long label never pushes the sheet wider than the screen.
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
  const applyReasonId = useId();
  const saveReasonId = useId();
  const applyReason = saved.length > 0 ? apply : undefined;
  const removed = restorable(saved);
  return (
    <div className="st-sheet-list">
      {saved.map((format) => (
        <SheetFormat
          key={format.id}
          editor={editor}
          format={format}
          reasonId={applyReason ? applyReasonId : undefined}
        />
      ))}
      <SheetReason id={applyReasonId} text={applyReason} />
      <div className="st-sheet-wide">
        <ToolbarButton
          type="button"
          data-surface="phone"
          size="sm"
          aria-describedby={save ? saveReasonId : undefined}
          disabled={save !== undefined}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            onClose();
            openPalette(editor, "save-format");
          }}
        >
          <span className="min-w-0 truncate">Save selection as format…</span>
        </ToolbarButton>
        <SheetReason id={saveReasonId} text={save} />
      </div>
      {saved.length > 0 ? (
        <ToolbarButton
          type="button"
          data-surface="phone"
          size="sm"
          className="st-sheet-wide"
          aria-expanded={removing}
          aria-controls={removeId}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setRemoving(!removing)}
        >
          <span className="min-w-0 truncate">Remove a format</span>
        </ToolbarButton>
      ) : null}
      {removing && saved.length > 0 ? (
        <ul
          id={removeId}
          aria-label="Remove a format"
          className="st-sheet-list st-sheet-wide ps-3"
        >
          {saved.map((format, index) => (
            <li key={format.id} className="min-w-0">
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
      {removed ? (
        <SheetRestore key={removed.id} editor={editor} format={removed} />
      ) : null}
    </div>
  );
}
