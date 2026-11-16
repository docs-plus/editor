"use client";

import type { Editor } from "@tiptap/react";

import { MoreHorizontalIcon } from "@/lib/icons";

import { menuBody } from "../lazy-menu";
import { ToolbarMenu, useMenuFocus, useSurfaceEditor } from "./action-menu";

const OverflowMenuItems = menuBody((bodies) => bodies.OverflowMenuItems);

/**
 * ⋯ More formatting (items: `OverflowMenuItems`, menu chunk). Never
 * disabled as a whole: each item says why it cannot run.
 */
export function OverflowMenu({ editor: provided }: { editor?: Editor | null }) {
  const editor = useSurfaceEditor(provided);
  const menu = useMenuFocus(editor);
  if (!editor) return null;
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
      <OverflowMenuItems editor={editor} onPicked={menu.markPicked} />
    </ToolbarMenu>
  );
}
