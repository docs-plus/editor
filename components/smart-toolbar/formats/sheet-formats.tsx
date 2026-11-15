"use client";

import type { Editor } from "@tiptap/react";
import {
  type MouseEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

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

/**
 * Where keyboard focus goes once the button it was on unmounts: the
 * restored format's own button, or the remove button that took the
 * removed one's place.
 */
type FocusAfter = { restored: string } | { removedAt: number };

/** Records where focus goes next, when the activated button had it. */
type KeepFocus = (
  event: MouseEvent<HTMLButtonElement>,
  after: FocusAfter,
) => void;

/**
 * The control that keeps the place after `after`: the restored format,
 * else the next remove button (the previous one after the last), else,
 * with the list gone, the section's heading.
 */
function focusTarget(
  root: HTMLElement,
  list: HTMLElement | null,
  saved: readonly SavedFormat[],
  after: FocusAfter,
): HTMLElement | null {
  if ("restored" in after) {
    const index = saved.findIndex((format) => format.id === after.restored);
    const apply = root.querySelectorAll<HTMLElement>("[data-saved-format]");
    return apply[index] ?? null;
  }
  const removes = list?.querySelectorAll("button") ?? [];
  if (removes.length > 0) {
    return removes[Math.min(after.removedAt, removes.length - 1)];
  }
  const labelledBy = root.closest("[aria-labelledby]");
  const heading = document.getElementById(
    labelledBy?.getAttribute("aria-labelledby") ?? "",
  );
  if (heading) heading.tabIndex = -1;
  return heading;
}

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
  keepFocus,
}: {
  editor: Editor;
  format: SavedFormat;
  keepFocus: KeepFocus;
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
        onClick={(event) => {
          keepFocus(event, { restored: format.id });
          runWithEngine(editor, () =>
            runAction(editor, formatsRestoreAction, format.id),
          );
        }}
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
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const focusAfter = useRef<FocusAfter | null>(null);
  const focusFirst = useRef(startRemoving);

  // A remove or restore unmounts the button that had keyboard focus, which
  // then falls to the sheet: move it on before paint. One-shot, on the
  // next change (a restore can wait for the engine chunk), and only while
  // focus is still dropped, so a user who moved on meanwhile stays put.
  useLayoutEffect(() => {
    const after = focusAfter.current;
    const root = rootRef.current;
    focusAfter.current = null;
    if (!after || !root || !document.activeElement?.contains(root)) return;
    const target = focusTarget(root, listRef.current, saved, after);
    target?.focus();
    // Its scroll margin too, so the ring clears the sheet's edge.
    target?.scrollIntoView({ block: "nearest" });
  }, [saved]);

  const keepFocus: KeepFocus = (event, after) => {
    if (event.currentTarget === document.activeElement) {
      focusAfter.current = after;
    }
  };

  /** The Remove list's first button, once, when the sheet opens at it. */
  const focusFirstOnce = (button: HTMLButtonElement | null) => {
    if (!button || !focusFirst.current) return;
    focusFirst.current = false;
    requestAnimationFrame(() => button.focus());
  };

  return (
    <div ref={rootRef} className="st-sheet-list">
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
          <span className="min-w-0 truncate">{formatsSaveAction.label}</span>
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
          ref={listRef}
          id={removeId}
          aria-label="Remove a format"
          className="st-sheet-list st-sheet-wide ps-3"
        >
          {saved.map((format, index) => (
            <li key={format.id} className="min-w-0">
              <ToolbarButton
                ref={index === 0 ? focusFirstOnce : undefined}
                type="button"
                data-surface="phone"
                size="sm"
                aria-label={`Remove ${format.name}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={(event) => {
                  keepFocus(event, { removedAt: index });
                  removeFormatWithUndo(format, index);
                }}
              >
                <TrashIcon aria-hidden="true" />
                <span className="min-w-0 truncate">{format.name}</span>
              </ToolbarButton>
            </li>
          ))}
        </ul>
      ) : null}
      {removed ? (
        <SheetRestore
          key={removed.id}
          editor={editor}
          format={removed}
          keepFocus={keepFocus}
        />
      ) : null}
    </div>
  );
}
