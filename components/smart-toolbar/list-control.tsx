"use client";

import { ActionButton } from "@/components/smart-toolbar/action-button";
import { ListDropdownMenu } from "@/components/tiptap-ui/list-dropdown-menu";
import {
  LIST_TYPE_CHOICE,
  type ListType,
  useRememberedChoice,
} from "@/lib/remembered-choice";

import type { SurfaceProps } from "./types";

/** M9 face → D1's registry id for that list type. */
const LIST_ACTION: Record<ListType, string> = {
  bulletList: "list.bullet",
  orderedList: "list.ordered",
  taskList: "list.task",
};

/**
 * Row list control (M9): a face that applies the remembered list type,
 * then the list menu. The face is D1's `list.*` action, whose `run()`
 * writes `LIST_TYPE_CHOICE`; until D1 lands the id is unknown and
 * `ActionButton` renders nothing, leaving today's menu. PR D2 owns.
 */
export function ListControl({ editor }: SurfaceProps) {
  const listType = useRememberedChoice(LIST_TYPE_CHOICE);
  return (
    <div className="st-split" data-list-face={listType.last}>
      <ActionButton id={LIST_ACTION[listType.last]} editor={editor} />
      <ListDropdownMenu
        editor={editor ?? undefined}
        types={["bulletList", "orderedList", "taskList"]}
      />
    </div>
  );
}
