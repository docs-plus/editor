"use client";

import type { Editor } from "@tiptap/react";
import { useCallback, useRef, useState } from "react";

import {
  canToggleList,
  type ListType,
} from "@/components/tiptap-ui/list-button";
import {
  type ListValue,
  setListType,
  useListDropdownMenu,
} from "@/components/tiptap-ui/list-dropdown-menu/use-list-dropdown-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
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

  const picked = useRef(false);
  const { filteredLists, canToggle, isActive, isVisible, value, Icon } =
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

  const handleValueChange = useCallback(
    (next: string) => {
      picked.current = true;
      setListType(editor, next as ListValue);
    },
    [editor],
  );

  // After a pick the editor already holds the selection, so focus goes
  // there; Esc and outside clicks fall back to the trigger.
  const finalFocus = useCallback(() => {
    if (!picked.current) return true;
    picked.current = false;
    return editor?.view.dom ?? true;
  }, [editor]);

  if (!isVisible) {
    return null;
  }

  return (
    <DropdownMenu open={isOpen} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger
        disabled={!canToggle}
        render={
          <ToolbarButton
            type="button"
            isActive={isActive}
            tabIndex={-1}
            disabled={!canToggle}
            aria-label="List"
            aria-haspopup="menu"
            tooltip="List"
            size="sm"
            {...buttonProps}
          />
        }
      >
        <Icon />
        <ChevronDownIcon className="size-3 opacity-60" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" finalFocus={finalFocus}>
        <DropdownMenuRadioGroup value={value} onValueChange={handleValueChange}>
          <DropdownMenuRadioItem value="none">No list</DropdownMenuRadioItem>
          {filteredLists.map((option) => (
            <DropdownMenuRadioItem
              key={option.type}
              value={option.type}
              disabled={!canToggleList(editor, option.type)}
            >
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
