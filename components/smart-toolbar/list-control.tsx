"use client";

import { ListDropdownMenu } from "@/components/tiptap-ui/list-dropdown-menu";

import type { SurfaceProps } from "./types";

/**
 * Row list menu with the remembered list-type face (M9). PR D2 owns.
 * SKELETON: today's list dropdown.
 */
export function ListControl({ editor }: SurfaceProps) {
  return (
    <ListDropdownMenu
      editor={editor ?? undefined}
      types={["bulletList", "orderedList", "taskList"]}
    />
  );
}
