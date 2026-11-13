"use client";

import type { Editor } from "@tiptap/react";

import { DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { editorActions } from "@/lib/editor-actions";
import { MoreHorizontalIcon } from "@/lib/icons";

import {
  ActionMenuItem,
  ToolbarMenu,
  useMenuFocus,
  useSurfaceEditor,
} from "./action-menu";

/** Toggles shown as checkbox items, then plain commands (spec §4.1 ⋯). */
const TOGGLES = ["mark.superscript", "mark.subscript", "mark.inlineCode"];
/**
 * Later tracks' ids are listed here and skipped until they land
 * (contract §3.2): Forget my choices (D2), All actions… (E).
 */
const COMMANDS = ["format.clear", "memory.forget", "palette.open"];

/**
 * ⋯ More formatting: superscript, subscript, inline code, clear
 * formatting, then D2's and E's entries once registered. Never disabled as a
 * whole: each item says why it cannot run.
 */
export function OverflowMenu({ editor: provided }: { editor?: Editor | null }) {
  const editor = useSurfaceEditor(provided);
  const menu = useMenuFocus(editor);
  if (!editor) return null;
  const commands = COMMANDS.filter((id) => editorActions.has(id));
  return (
    <ToolbarMenu
      label="More formatting"
      tooltip="More formatting"
      readOnly={false}
      icon={<MoreHorizontalIcon aria-hidden="true" />}
      showLabel={false}
      open={menu.open}
      onOpenChange={menu.onOpenChange}
      finalFocus={menu.finalFocus}
      contentLabel="More formatting"
    >
      {TOGGLES.map((id) => (
        <ActionMenuItem
          key={id}
          id={id}
          editor={editor}
          checkbox
          onPicked={menu.markPicked}
        />
      ))}
      <DropdownMenuSeparator />
      {commands.map((id) => (
        <ActionMenuItem
          key={id}
          id={id}
          editor={editor}
          onPicked={menu.markPicked}
        />
      ))}
    </ToolbarMenu>
  );
}
