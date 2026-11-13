"use client";

import type { Editor } from "@tiptap/react";

import { ActionButton } from "@/components/smart-toolbar/action-button";
import { InsertMenu } from "@/components/smart-toolbar/insert-menu";
import {
  ActionRadioItem,
  DropdownMenuRadioGroup,
  ToolbarMenu,
  useMenuFocus,
} from "@/components/smart-toolbar/row/action-menu";
import { setListType } from "@/components/tiptap-ui/list-dropdown-menu/use-list-dropdown-menu";
import { DropdownMenuRadioItem } from "@/components/ui/dropdown-menu";
import { useActionView } from "@/hooks/use-editor-context";
import { editorActions } from "@/lib/editor-actions";
import { ListIcon } from "@/lib/icons";

const NO_LIST = "none";
const LIST_IDS = ["list.bullet", "list.ordered", "list.task"];

/** The current list action, or "none": the radio group's value. */
function useListValue(editor: Editor): string {
  const bullet = useActionView("list.bullet", editor);
  const ordered = useActionView("list.ordered", editor);
  const task = useActionView("list.task", editor);
  if (bullet?.active) return "list.bullet";
  if (ordered?.active) return "list.ordered";
  if (task?.active) return "list.task";
  return NO_LIST;
}

/**
 * List ▾ as one cell: a radio menu like the row's (`menuitemradio`, one
 * checked), "No list" then the registry's list actions.
 */
function ListCell({ editor }: { editor: Editor }) {
  const menu = useMenuFocus(editor);
  const value = useListValue(editor);
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
      <DropdownMenuRadioGroup value={value}>
        <DropdownMenuRadioItem
          value={NO_LIST}
          closeOnClick
          onClick={() => {
            menu.markPicked();
            setListType(editor, NO_LIST);
          }}
        >
          No list
        </DropdownMenuRadioItem>
        {LIST_IDS.map((id) =>
          // Re-tapping the checked type only closes the menu, as the row's
          // menu does (its radio group reports changes only): a toggle here
          // would remove the list.
          id === value ? (
            <DropdownMenuRadioItem
              key={id}
              value={id}
              closeOnClick
              data-action-id={id}
            >
              {editorActions.get(id)?.label}
            </DropdownMenuRadioItem>
          ) : (
            <ActionRadioItem
              key={id}
              id={id}
              value={id}
              editor={editor}
              onPicked={menu.markPicked}
            />
          ),
        )}
      </DropdownMenuRadioGroup>
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
