"use client";

import { ActionButton } from "@/components/smart-toolbar/action-button";
import { ListDropdownMenu } from "@/components/tiptap-ui/list-dropdown-menu";
import { LIST_ACTION_IDS } from "@/lib/list-commands";
import { LIST_TYPE_CHOICE, useRememberedChoice } from "@/lib/remembered-choice";

import type { SurfaceProps } from "./types";

/**
 * Row list control (M9): a face that applies the remembered list type,
 * then the list menu. The face and the menu's list picks both run D1's
 * `list.*` action, whose `run()` writes `LIST_TYPE_CHOICE`. PR D2 owns.
 */
export function ListControl({ editor }: SurfaceProps) {
  const listType = useRememberedChoice(LIST_TYPE_CHOICE);
  return (
    <div className="st-split" data-list-face={listType.last}>
      <ActionButton id={LIST_ACTION_IDS[listType.last]} editor={editor} />
      <ListDropdownMenu
        editor={editor ?? undefined}
        types={["bulletList", "orderedList", "taskList"]}
      />
    </div>
  );
}
