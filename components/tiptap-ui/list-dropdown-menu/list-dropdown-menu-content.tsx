"use client";

import type { Editor } from "@tiptap/react";

import { canToggleList } from "@/components/tiptap-ui/list-button";
import type { ListOption } from "@/components/tiptap-ui/list-dropdown-menu/use-list-dropdown-menu";
import {
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";

/**
 * `ListDropdownMenu`'s popup: "No list", then each list type, the current
 * one checked. It loads with the smart toolbar's menu chunk
 * (`components/smart-toolbar/menu-bodies.ts`), so the editor chunk keeps
 * only the trigger.
 */
export function ListMenuContent({
  editor,
  lists,
  value,
  onValueChange,
  finalFocus,
}: {
  editor: Editor | null;
  lists: ListOption[];
  value: string;
  onValueChange: (value: string) => void;
  finalFocus: () => HTMLElement | boolean;
}) {
  return (
    <DropdownMenuContent align="start" finalFocus={finalFocus}>
      <DropdownMenuRadioGroup value={value} onValueChange={onValueChange}>
        <DropdownMenuRadioItem value="none" closeOnClick>
          No list
        </DropdownMenuRadioItem>
        {lists.map((option) => (
          <DropdownMenuRadioItem
            key={option.type}
            value={option.type}
            closeOnClick
            disabled={!canToggleList(editor, option.type)}
          >
            {option.label}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  );
}
