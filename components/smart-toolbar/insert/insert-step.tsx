"use client";

import type { Editor } from "@tiptap/react";

import { embedMedia } from "@/components/tiptap-ui/media-embed-popover";
import { MediaEmbedForm } from "@/components/tiptap-ui/media-embed-popover/media-embed-popover";
import { editorActions } from "@/lib/editor-actions";
import { runAction } from "@/lib/editor-actions/registry";
import type { TableSize } from "@/lib/remembered-choice";

import { TableSizeGrid } from "./table-size-grid";

/*
 * The Insert menu's steps, a lazy chunk (owner decision O1). `InsertMenu`
 * keeps the trigger, the items, the M10 face and the step popover eager.
 */

/** A kind that needs input before it inserts (M10). */
export type InsertStepKind = "table" | "embed";

/** The table grid (opening at the last size, M17a) or the embed form. */
export function InsertStep({
  step,
  editor,
  tableSize,
  onDone,
}: {
  step: InsertStepKind;
  editor: Editor;
  tableSize: TableSize;
  onDone: () => void;
}) {
  if (step === "table") {
    return (
      <TableSizeGrid
        initial={tableSize}
        onPick={(size) => {
          const action = editorActions.get("insert.table");
          if (action) runAction(editor, action, size);
          onDone();
          editor.commands.focus();
        }}
      />
    );
  }
  return (
    <MediaEmbedForm
      onEmbed={(url) => embedMedia(editor, url)}
      onDone={onDone}
    />
  );
}
