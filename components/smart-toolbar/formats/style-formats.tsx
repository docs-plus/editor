"use client";

import type { Editor } from "@tiptap/react";

import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { bundleSetLabel } from "@/extensions/repeat-formatting/bundle";
import { runAction } from "@/lib/editor-actions/registry";
import {
  formatsApplyAction,
  formatsSaveAction,
} from "@/lib/editor-actions/v11-actions";

import { openPalette } from "../palette/palette-store";
import { DescribedItem } from "./described-item";
import { FormatPreview } from "./format-preview";
import { removeFormatWithUndo } from "./remove-format";
import { useEActionReason, useSavedFormats } from "./use-e-action";

/**
 * Your formats in the text style dropdown (design pass §4), after the
 * styles: each saved format named in its own formatting (its description
 * is the long label, or why it cannot apply), "Save selection as format…"
 * (the palette's save view) and "Remove a format ▸", whose pick removes
 * at once with an Undo pill. A lazy chunk loaded with the dropdown's
 * first open (editor-chunk budget).
 */
export function StyleFormats({
  editor,
  onPicked,
}: {
  editor: Editor;
  /** Hands focus back to the editor when the menu closes. */
  onPicked: () => void;
}) {
  const saved = useSavedFormats();
  const apply = useEActionReason(formatsApplyAction, editor);
  const save = useEActionReason(formatsSaveAction, editor);
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuLabel>Your formats</DropdownMenuLabel>
        {saved.map((format) => (
          <DescribedItem
            key={format.id}
            data-saved-format=""
            label={
              <FormatPreview bundle={format.bundle}>
                {format.name}
              </FormatPreview>
            }
            description={apply ?? bundleSetLabel(format.bundle)}
            disabled={apply !== undefined}
            onClick={() => {
              onPicked();
              runAction(editor, formatsApplyAction, format.id);
            }}
          />
        ))}
        <DescribedItem
          label="Save selection as format…"
          description={save}
          disabled={save !== undefined}
          onClick={() => openPalette(editor, "save-format")}
        />
        {saved.length > 0 ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Remove a format</DropdownMenuSubTrigger>
            <DropdownMenuSubContent aria-label="Remove a format">
              {saved.map((format, index) => (
                <DropdownMenuItem
                  key={format.id}
                  onClick={() => {
                    onPicked();
                    removeFormatWithUndo(format, index);
                  }}
                >
                  <span className="min-w-0 truncate">{format.name}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : null}
      </DropdownMenuGroup>
    </>
  );
}
