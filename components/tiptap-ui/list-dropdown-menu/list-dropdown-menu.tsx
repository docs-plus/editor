"use client";

import type { Editor } from "@tiptap/react";
import { useCallback, useState } from "react";

import { ListButton, type ListType } from "@/components/tiptap-ui/list-button";
import { useListDropdownMenu } from "@/components/tiptap-ui/list-dropdown-menu/use-list-dropdown-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ToolbarButtonProps } from "@/components/ui/toolbar-button";
import { ToolbarButton } from "@/components/ui/toolbar-button";
import { useTiptapEditor } from "@/hooks/use-tiptap-editor";
import { ChevronDownIcon } from "@/lib/icons";

export interface ListDropdownMenuProps
  extends Omit<ToolbarButtonProps, "type"> {
  /**
   * The Tiptap editor instance.
   */
  editor?: Editor;
  /**
   * The list types to display in the dropdown.
   */
  types?: ListType[];
  /**
   * Whether the dropdown should be hidden when no list types are available
   * @default false
   */
  hideWhenUnavailable?: boolean;
  /**
   * Callback for when the dropdown opens or closes
   */
  onOpenChange?: (isOpen: boolean) => void;
}

export function ListDropdownMenu({
  editor: providedEditor,
  types = ["bulletList", "orderedList", "taskList"],
  hideWhenUnavailable = false,
  onOpenChange,
  ...buttonProps
}: ListDropdownMenuProps) {
  const { editor } = useTiptapEditor(providedEditor);
  const [isOpen, setIsOpen] = useState(false);

  const { filteredLists, canToggle, isActive, isVisible, Icon } =
    useListDropdownMenu({
      editor,
      types,
      hideWhenUnavailable,
    });

  const handleOpenChange = useCallback(
    (open: boolean) => {
      setIsOpen(open);
      onOpenChange?.(open);
    },
    [onOpenChange],
  );

  if (!isVisible) {
    return null;
  }

  return (
    <DropdownMenu open={isOpen} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger
        render={
          <ToolbarButton
            type="button"
            isActive={isActive}
            tabIndex={-1}
            disabled={!canToggle}
            aria-label="List options"
            tooltip="List"
            size="sm"
            {...buttonProps}
          />
        }
      >
        <Icon />
        <ChevronDownIcon className="size-3 opacity-60" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start">
        <div className="flex flex-col gap-0.5 p-1">
          {filteredLists.map((option) => (
            <ListButton
              key={option.type}
              editor={editor}
              type={option.type}
              text={option.label}
              showTooltip={false}
              size="sm"
              className="w-full justify-start"
            />
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
