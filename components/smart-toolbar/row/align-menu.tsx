"use client";

import type { Editor } from "@tiptap/react";

import { useActionView } from "@/hooks/use-editor-context";
import { editorActions } from "@/lib/editor-actions";
import { READ_ONLY_REASON } from "@/lib/editor-actions/types";

import { menuBody } from "../lazy-menu";
import { ToolbarMenu, useMenuFocus, useSurfaceEditor } from "./action-menu";

const AlignMenuItems = menuBody((bodies) => bodies.AlignMenuItems);

/**
 * Align ▾: icon-only, named and drawn by the current alignment's registry
 * action ("Align left", "Justify"), so the trigger, its items, the palette
 * and the phone sheet share one label.
 */
export function AlignMenu({ editor: provided }: { editor?: Editor | null }) {
  const editor = useSurfaceEditor(provided);
  const view = useActionView("align.left", editor);
  const menu = useMenuFocus(editor);
  if (!editor || !view) return null;
  const value = view.value ?? "left";
  const action =
    editorActions.get(`align.${value}`) ?? editorActions.get("align.left");
  if (!action) return null;
  const Icon = action.icon;
  const readOnly =
    view.enabled !== true && view.enabled.reason === READ_ONLY_REASON;
  return (
    <ToolbarMenu
      label={action.label}
      tooltip="Alignment"
      readOnly={readOnly}
      icon={Icon && <Icon aria-hidden="true" />}
      showLabel={false}
      open={menu.open}
      onOpenChange={menu.onOpenChange}
      finalFocus={menu.finalFocus}
      contentLabel="Alignment"
    >
      <AlignMenuItems
        editor={editor}
        value={value}
        onPicked={menu.markPicked}
      />
    </ToolbarMenu>
  );
}
