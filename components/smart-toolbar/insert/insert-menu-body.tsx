"use client";

import type { Editor } from "@tiptap/react";

import { embedMedia } from "@/components/tiptap-ui/media-embed-popover";
import { MediaEmbedForm } from "@/components/tiptap-ui/media-embed-popover/media-embed-popover";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useEditorContext } from "@/hooks/use-editor-context";
import { editorActions } from "@/lib/editor-actions";
import { availability, runAction } from "@/lib/editor-actions/registry";
import type { AnyAction } from "@/lib/editor-actions/types";
import {
  INSERT_KIND_CHOICE,
  type TableSize,
  useRememberedChoice,
} from "@/lib/remembered-choice";

import { TableSizeGrid } from "./table-size-grid";

/*
 * The Insert menu's items and steps, a lazy chunk (owner decision O1).
 * `InsertMenu` keeps the trigger, the M10 face and the step popover eager.
 */

/** "insert.codeBlock" → "codeBlock", the M10 kind. */
const kindOf = (action: AnyAction) => action.id.slice("insert.".length);

/**
 * The menu items: mounted only while the menu is open, so the snapshot
 * subscription costs nothing while typing.
 */
export function InsertMenuItems({ editor }: { editor: Editor }) {
  const ctx = useEditorContext(editor);
  const lastKind = useRememberedChoice(INSERT_KIND_CHOICE);
  return editorActions.list({ group: "insert" }).map((action) => {
    const enabled = ctx ? availability(action, ctx) : true;
    const reason = enabled === true ? undefined : enabled.reason;
    const Icon = action.icon;
    return (
      <DropdownMenuItem
        key={action.id}
        data-action-id={action.id}
        data-last={
          lastKind.ready && kindOf(action) === lastKind.last ? "" : undefined
        }
        disabled={reason !== undefined}
        title={reason}
        onClick={() => runAction(editor, action)}
      >
        {Icon ? <Icon aria-hidden="true" /> : null}
        <span>{action.label}</span>
        {reason ? <span className="sr-only">({reason})</span> : null}
      </DropdownMenuItem>
    );
  });
}

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
