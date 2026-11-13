"use client";

import type { Editor } from "@tiptap/react";
import { useMemo } from "react";

// --- Tiptap UI ---
import {
  canToggleList,
  isListActive,
  type ListType,
  listIcons,
  setListTypeInPlace,
  toggleList,
} from "@/components/tiptap-ui/list-button";
// --- Hooks ---
import { useTiptapEditor } from "@/hooks/use-tiptap-editor";
// --- Lib ---
import { isNodeInSchema } from "@/lib/editor-utils";
// --- Icons ---
import { ListIcon, ListOrderedIcon, ListTodoIcon } from "@/lib/icons";

/**
 * Configuration for the list dropdown menu functionality
 */
export interface UseListDropdownMenuConfig {
  /**
   * The Tiptap editor instance.
   */
  editor?: Editor | null;
  /**
   * The list types to display in the dropdown.
   * @default ["bulletList", "orderedList", "taskList"]
   */
  types?: ListType[];
  /**
   * Whether the dropdown should be hidden when no list types are available
   * @default false
   */
  hideWhenUnavailable?: boolean;
}

export interface ListOption {
  label: string;
  type: ListType;
  icon: React.ElementType;
}

export const listOptions: ListOption[] = [
  {
    label: "Bullet List",
    type: "bulletList",
    icon: ListIcon,
  },
  {
    label: "Ordered List",
    type: "orderedList",
    icon: ListOrderedIcon,
  },
  {
    label: "Task List",
    type: "taskList",
    icon: ListTodoIcon,
  },
];

export function canToggleAnyList(
  editor: Editor | null,
  listTypes: ListType[],
): boolean {
  if (!editor?.isEditable) return false;
  return listTypes.some((type) => canToggleList(editor, type));
}

export function isAnyListActive(
  editor: Editor | null,
  listTypes: ListType[],
): boolean {
  if (!editor?.isEditable) return false;
  return listTypes.some((type) => isListActive(editor, type));
}

export function getFilteredListOptions(
  availableTypes: ListType[],
): typeof listOptions {
  return listOptions.filter(
    (option) => !option.type || availableTypes.includes(option.type),
  );
}

export function shouldShowListDropdown(params: {
  editor: Editor | null;
  listTypes: ListType[];
  hideWhenUnavailable: boolean;
  listInSchema: boolean;
  canToggleAny: boolean;
}): boolean {
  const { editor, hideWhenUnavailable, listInSchema, canToggleAny } = params;

  if (!editor) return false;

  if (!hideWhenUnavailable) {
    return true;
  }

  if (!listInSchema) return false;

  if (!editor.isActive("inlineCode")) {
    return canToggleAny;
  }

  return true;
}

export type ListValue = ListType | "none";

const LIST_TYPES: ListType[] = ["bulletList", "orderedList", "taskList"];

export function getListValue(editor: Editor | null): ListValue {
  if (!editor?.isEditable) return "none";
  return LIST_TYPES.find((type) => isListActive(editor, type)) ?? "none";
}

/**
 * Sets the list type of the selected blocks, or removes the list with
 * `"none"`. Unlike `toggleList`, picking the current value does nothing.
 */
export function setListType(editor: Editor | null, value: ListValue): boolean {
  if (!editor?.isEditable) return false;
  const current = getListValue(editor);
  if (current === value) return false;

  if (value === "none")
    return current !== "none" && toggleList(editor, current);
  if (current === "none") return toggleList(editor, value);
  return setListTypeInPlace(editor, value);
}

/**
 * Gets the currently active list type from the available types
 */
export function getActiveListType(
  editor: Editor | null,
  availableTypes: ListType[],
): ListType | undefined {
  if (!editor?.isEditable) return undefined;
  return availableTypes.find((type) => isListActive(editor, type));
}

/**
 * Custom hook that provides list dropdown menu functionality for Tiptap editor
 *
 * @example
 * ```tsx
 * // Simple usage
 * function MyListDropdown() {
 *   const {
 *     isVisible,
 *     activeType,
 *     isAnyActive,
 *     canToggleAny,
 *     filteredLists,
 *   } = useListDropdownMenu()
 *
 *   if (!isVisible) return null
 *
 *   return (
 *     <DropdownMenu>
 *       // dropdown content
 *     </DropdownMenu>
 *   )
 * }
 *
 * // Advanced usage with configuration
 * function MyAdvancedListDropdown() {
 *   const {
 *     isVisible,
 *     activeType,
 *   } = useListDropdownMenu({
 *     editor: myEditor,
 *     types: ["bulletList", "orderedList"],
 *     hideWhenUnavailable: true,
 *   })
 *
 *   // component implementation
 * }
 * ```
 */
export function useListDropdownMenu(config?: UseListDropdownMenuConfig) {
  const {
    editor: providedEditor,
    types = ["bulletList", "orderedList", "taskList"],
    hideWhenUnavailable = false,
  } = config || {};

  const { editor } = useTiptapEditor(providedEditor);

  const listInSchema = types.some((type) => isNodeInSchema(type, editor));

  const filteredLists = useMemo(() => getFilteredListOptions(types), [types]);

  const canToggleAny = canToggleAnyList(editor, types);
  const isAnyActive = isAnyListActive(editor, types);
  const activeType = getActiveListType(editor, types);
  const activeList = filteredLists.find((option) => option.type === activeType);

  const isVisible =
    !editor ||
    shouldShowListDropdown({
      editor,
      listTypes: types,
      hideWhenUnavailable,
      listInSchema,
      canToggleAny,
    });

  return {
    isVisible,
    activeType,
    value: getListValue(editor),
    isActive: isAnyActive,
    canToggle: canToggleAny,
    types,
    filteredLists,
    label: "List",
    Icon: activeList ? listIcons[activeList.type] : ListIcon,
  };
}
