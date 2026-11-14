"use client";

import type { Editor } from "@tiptap/react";
import { useCallback, useRef, useState } from "react";

import {
  menuBody,
  prefetchMenuBodies,
  useMenuGate,
} from "@/components/smart-toolbar/lazy-menu";
import type { ListType } from "@/components/tiptap-ui/list-button";
import {
  type ListValue,
  setListType,
  useListDropdownMenu,
} from "@/components/tiptap-ui/list-dropdown-menu/use-list-dropdown-menu";
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu-trigger";
import type { ToolbarButtonProps } from "@/components/ui/toolbar-button";
import { ToolbarButton } from "@/components/ui/toolbar-button";
import { useTiptapEditor } from "@/hooks/use-tiptap-editor";
import { editorActions } from "@/lib/editor-actions";
import { runAction } from "@/lib/editor-actions/registry";
import type { AnyAction } from "@/lib/editor-actions/types";
import { ChevronDownIcon } from "@/lib/icons";
import { LIST_ACTION_IDS } from "@/lib/list-commands";

const LIST_ACTIONS = Object.fromEntries(
  Object.entries(LIST_ACTION_IDS).map(([type, id]) => [
    type,
    editorActions.get(id),
  ]),
) as Partial<Record<ListType, AnyAction>>;

/** The popup is in the toolbar's menu chunk (`list-dropdown-menu-content`). */
const ListMenuContent = menuBody((bodies) => bodies.ListMenuContent);

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
      // Base UI returns focus only after the exit animation, and Tiptap's
      // focus() waits a frame: a keystroke typed before either would go to
      // the menu, so hand focus to the editor now.
      if (!open && picked.current) editor?.view.focus();
      onOpenChange?.(open);
    },
    [editor, onOpenChange],
  );

  const handleValueChange = useCallback(
    (next: string) => {
      picked.current = true;
      const action = LIST_ACTIONS[next as ListType];
      // A list type goes through the registry, whose run() remembers it
      // (M9); "No list" is not a choice and writes nothing.
      if (editor && action) runAction(editor, action);
      else setListType(editor, next as ListValue);
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

  const gate = useMenuGate(handleOpenChange);

  if (!isVisible) {
    return null;
  }

  return (
    <DropdownMenu open={isOpen} onOpenChange={gate.onOpenChange}>
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
            onKeyDownCapture={gate.onKeyDownCapture}
            onPointerEnter={prefetchMenuBodies}
            onFocus={prefetchMenuBodies}
            {...buttonProps}
          />
        }
      >
        <Icon />
        <ChevronDownIcon className="size-3 opacity-60" />
      </DropdownMenuTrigger>

      <ListMenuContent
        editor={editor}
        lists={filteredLists}
        value={value}
        onValueChange={handleValueChange}
        finalFocus={finalFocus}
      />
    </DropdownMenu>
  );
}
