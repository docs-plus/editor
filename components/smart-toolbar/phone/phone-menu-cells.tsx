"use client";

import type { Editor } from "@tiptap/react";

import { ActionButton } from "@/components/smart-toolbar/action-button";
import { InsertMenu } from "@/components/smart-toolbar/insert-menu";
import {
  ActionMenuItem,
  ToolbarMenu,
  useMenuFocus,
} from "@/components/smart-toolbar/row/action-menu";
import { ListIcon } from "@/lib/icons";

const LIST_IDS = ["list.bullet", "list.ordered", "list.task"];

/** List ▾ as one cell: the registry's list toggles in a menu. */
function ListCell({ editor }: { editor: Editor }) {
  const menu = useMenuFocus(editor);
  return (
    <ToolbarMenu
      label="List"
      tooltip="List"
      readOnly={false}
      icon={<ListIcon aria-hidden="true" />}
      showLabel={false}
      open={menu.open}
      onOpenChange={menu.onOpenChange}
      finalFocus={menu.finalFocus}
      contentLabel="List"
    >
      {LIST_IDS.map((id) => (
        <ActionMenuItem
          key={id}
          id={id}
          editor={editor}
          checkbox
          onPicked={menu.markPicked}
        />
      ))}
    </ToolbarMenu>
  );
}

/**
 * The phone bar's last cells (spec §4.7): List ▾, Indent and Insert ▾.
 * They reuse the row's menus, which the editor chunk already holds, so the
 * editor shell renders them and hands them to the lazy bar
 * (`mobile-toolbar-content.tsx`). Importing the menus from the bar's own
 * chunk splits them into a shared chunk and costs the editor chunk group
 * about 1.5 KB gz in lost compression (contract A9).
 */
export function PhoneMenuCells({ editor }: { editor: Editor }) {
  return (
    <>
      <ListCell editor={editor} />
      <ActionButton id="indent.indent" editor={editor} variant="phone" />
      <InsertMenu editor={editor} />
    </>
  );
}
