"use client";

import type { Editor } from "@tiptap/react";
import { useState } from "react";

import { MoreHorizontalIcon } from "@/lib/icons";

import { menuBody } from "../lazy-menu";
import { ToolbarMenu, useMenuFocus, useSurfaceEditor } from "./action-menu";

const OverflowMenuItems = menuBody((bodies) => bodies.OverflowMenuItems);

/**
 * T2 moves Theme into ⋯ (spec §4.6): the row's theme button is hidden by a
 * container query, so the menu checks it when it opens.
 */
function rowThemeHidden(): boolean {
  const button = document.querySelector<HTMLElement>(
    '[data-toolbar-group="theme"] button',
  );
  return button !== null && !button.checkVisibility();
}

/**
 * ⋯ More formatting (items: `OverflowMenuItems`, menu chunk). Never
 * disabled as a whole: each item says why it cannot run.
 */
export function OverflowMenu({ editor: provided }: { editor?: Editor | null }) {
  const editor = useSurfaceEditor(provided);
  const menu = useMenuFocus(editor);
  const [themeInMenu, setThemeInMenu] = useState(false);
  if (!editor) return null;
  return (
    <ToolbarMenu
      label="More formatting"
      tooltip="More formatting"
      readOnly={false}
      icon={<MoreHorizontalIcon aria-hidden="true" />}
      showLabel={false}
      open={menu.open}
      onOpenChange={(next) => {
        if (next) setThemeInMenu(rowThemeHidden());
        menu.onOpenChange(next);
      }}
      finalFocus={menu.finalFocus}
      contentLabel="More formatting"
    >
      <OverflowMenuItems
        editor={editor}
        onPicked={menu.markPicked}
        themeInMenu={themeInMenu}
      />
    </ToolbarMenu>
  );
}
