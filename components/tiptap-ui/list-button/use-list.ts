"use client";

import type { Editor } from "@tiptap/react";
import { useCallback } from "react";

// --- Hooks ---
import { useTiptapEditor } from "@/hooks/use-tiptap-editor";
// --- Lib ---
import { isNodeInSchema, shouldShowEditorButton } from "@/lib/editor-utils";
// --- Icons ---
import { ListIcon, ListOrderedIcon, ListTodoIcon } from "@/lib/icons";
import { canToggleList, toggleList } from "@/lib/list-commands";
import type { ListType } from "@/lib/remembered-choice";

export {
  canToggleList,
  setListTypeInPlace,
  toggleList,
} from "@/lib/list-commands";
export type { ListType } from "@/lib/remembered-choice";

/**
 * Configuration for the list functionality
 */
export interface UseListConfig {
  /**
   * The Tiptap editor instance.
   */
  editor?: Editor | null;
  /**
   * The type of list to toggle.
   */
  type: ListType;
  /**
   * Whether the button should hide when list is not available.
   * @default false
   */
  hideWhenUnavailable?: boolean;
  /**
   * Callback function called after a successful toggle.
   */
  onToggled?: () => void;
}

export const listIcons = {
  bulletList: ListIcon,
  orderedList: ListOrderedIcon,
  taskList: ListTodoIcon,
};

export const listLabels: Record<ListType, string> = {
  bulletList: "Bullet List",
  orderedList: "Ordered List",
  taskList: "Task List",
};

export const LIST_SHORTCUT_KEYS: Record<ListType, string> = {
  bulletList: "mod+shift+8",
  orderedList: "mod+shift+7",
  taskList: "mod+shift+9",
};

/**
 * Checks if list is currently active
 */
export function isListActive(editor: Editor | null, type: ListType): boolean {
  if (!editor?.isEditable) return false;

  switch (type) {
    case "bulletList":
      return editor.isActive("bulletList");
    case "orderedList":
      return editor.isActive("orderedList");
    case "taskList":
      return editor.isActive("taskList");
    default:
      return false;
  }
}

/**
 * Determines if the list button should be shown
 */
export function shouldShowListButton(props: {
  editor: Editor | null;
  type: ListType;
  hideWhenUnavailable: boolean;
}): boolean {
  const { editor, type, hideWhenUnavailable } = props;

  return shouldShowEditorButton(editor, hideWhenUnavailable, () => {
    if (!isNodeInSchema(type, editor)) return false;
    if (!editor?.isActive("inlineCode")) return canToggleList(editor, type);
    return true;
  });
}

/**
 * Custom hook that provides list functionality for Tiptap editor
 *
 * @example
 * ```tsx
 * // Simple usage
 * function MySimpleListButton() {
 *   const { isVisible, handleToggle, isActive } = useList({ type: "bulletList" })
 *
 *   if (!isVisible) return null
 *
 *   return <button onClick={handleToggle}>Bullet List</button>
 * }
 *
 * // Advanced usage with configuration
 * function MyAdvancedListButton() {
 *   const { isVisible, handleToggle, label, isActive } = useList({
 *     type: "orderedList",
 *     editor: myEditor,
 *     hideWhenUnavailable: true,
 *     onToggled: () => console.log('List toggled!')
 *   })
 *
 *   if (!isVisible) return null
 *
 *   return (
 *     <MyButton
 *       onClick={handleToggle}
 *       aria-label={label}
 *       aria-pressed={isActive}
 *     >
 *       Toggle List
 *     </MyButton>
 *   )
 * }
 * ```
 */
export function useList(config: UseListConfig) {
  const {
    editor: providedEditor,
    type,
    hideWhenUnavailable = false,
    onToggled,
  } = config;

  const { editor } = useTiptapEditor(providedEditor);
  const canToggle = canToggleList(editor, type);
  const isActive = isListActive(editor, type);

  const isVisible =
    !editor || shouldShowListButton({ editor, type, hideWhenUnavailable });

  const handleToggle = useCallback(() => {
    if (!editor) return false;

    const success = toggleList(editor, type);
    if (success) {
      onToggled?.();
    }
    return success;
  }, [editor, type, onToggled]);

  return {
    isVisible,
    isActive,
    handleToggle,
    canToggle,
    label: listLabels[type],
    shortcutKeys: LIST_SHORTCUT_KEYS[type],
    Icon: listIcons[type],
  };
}
