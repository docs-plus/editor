"use client";

import type { Editor } from "@tiptap/react";

import { setListType } from "@/components/tiptap-ui/list-dropdown-menu/use-list-dropdown-menu";
import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { editorActions } from "@/lib/editor-actions";

import { ActionRadioItem } from "../row/menu-items";

const NO_LIST = "none";
const LIST_IDS = ["list.bullet", "list.ordered", "list.task"];

/**
 * The phone List ▾ cell's items (menu chunk, `menu-bodies.ts`): "No list",
 * then the registry's list actions, `value` checked. Its trigger is
 * `ListCell` in `phone-menu-cells.tsx`.
 */
export function PhoneListMenuItems({
  editor,
  value,
  onPicked,
}: {
  editor: Editor;
  /** The current list action, or "none". */
  value: string;
  onPicked: () => void;
}) {
  return (
    <DropdownMenuRadioGroup value={value}>
      <DropdownMenuRadioItem
        value={NO_LIST}
        closeOnClick
        onClick={() => {
          onPicked();
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
            onPicked={onPicked}
          />
        ),
      )}
    </DropdownMenuRadioGroup>
  );
}
