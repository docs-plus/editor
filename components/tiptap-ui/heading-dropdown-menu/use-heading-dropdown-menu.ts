"use client";

import type { Editor } from "@tiptap/react";

// --- Tiptap UI ---
import {
  canToggleHeading,
  headingIcons,
  isHeadingActive,
  type Level,
  shouldShowHeadingButton,
} from "@/components/tiptap-ui/heading-button";
// --- Hooks ---
import { useTiptapEditor } from "@/hooks/use-tiptap-editor";
import { prepareBlockToggle } from "@/lib/editor-utils";
// --- Icons ---
import { HeadingIcon } from "@/lib/icons";

/**
 * Configuration for the heading dropdown menu functionality
 */
export interface UseHeadingDropdownMenuConfig {
  /**
   * The Tiptap editor instance.
   */
  editor?: Editor | null;
  /**
   * Available heading levels to show in the dropdown
   * @default [1, 2, 3, 4, 5, 6]
   */
  levels?: Level[];
  /**
   * Whether the dropdown should hide when headings are not available.
   * @default false
   */
  hideWhenUnavailable?: boolean;
}

export type TextStyleValue = "title" | "paragraph" | `heading-${Level}`;

export const TEXT_STYLE_LABELS: Record<TextStyleValue, string> = {
  title: "Title",
  paragraph: "Normal text",
  "heading-1": "Heading 1",
  "heading-2": "Heading 2",
  "heading-3": "Heading 3",
  "heading-4": "Heading 4",
  "heading-5": "Heading 5",
  "heading-6": "Heading 6",
};

/**
 * Reads the text style at the caret. The first block of a document is its
 * title, whatever its level.
 */
export function getTextStyleValue(editor: Editor | null): TextStyleValue {
  if (!editor) return "paragraph";
  const { $from } = editor.state.selection;
  if ($from.index(0) === 0) return "title";
  const { parent } = $from;
  if (parent.type.name !== "heading") return "paragraph";
  return `heading-${parent.attrs.level as Level}`;
}

/**
 * Sets the text style of the selected block. Unlike `toggleHeading`, picking
 * the current style does nothing.
 */
export function setTextStyle(
  editor: Editor | null,
  value: Exclude<TextStyleValue, "title">,
): boolean {
  if (!editor?.isEditable) return false;
  const current = getTextStyleValue(editor);
  if (current === "title" || current === value) return false;

  const level =
    value === "paragraph" ? undefined : (Number(value.slice(8)) as Level);
  if (level && !canToggleHeading(editor, level)) return false;

  try {
    const chain = prepareBlockToggle(editor);
    (level
      ? chain.setNode("heading", { level })
      : chain.setNode("paragraph")
    ).run();
    editor.chain().focus().selectTextblockEnd().run();
    return true;
  } catch {
    return false;
  }
}

/**
 * Gets the currently active heading level from the available levels
 */
export function getActiveHeadingLevel(
  editor: Editor | null,
  levels: Level[] = [1, 2, 3, 4, 5, 6],
): Level | undefined {
  if (!editor?.isEditable) return undefined;
  return levels.find((level) => isHeadingActive(editor, level));
}

/**
 * Custom hook that provides heading dropdown menu functionality for Tiptap editor
 *
 * @example
 * ```tsx
 * // Simple usage
 * function MyHeadingDropdown() {
 *   const {
 *     isVisible,
 *     activeLevel,
 *     isAnyHeadingActive,
 *     canToggleHeading,
 *     levels,
 *   } = useHeadingDropdownMenu()
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
 * function MyAdvancedHeadingDropdown() {
 *   const {
 *     isVisible,
 *     activeLevel,
 *   } = useHeadingDropdownMenu({
 *     editor: myEditor,
 *     levels: [1, 2, 3],
 *     hideWhenUnavailable: true,
 *   })
 *
 *   // component implementation
 * }
 * ```
 */
export function useHeadingDropdownMenu(config?: UseHeadingDropdownMenuConfig) {
  const {
    editor: providedEditor,
    levels = [1, 2, 3, 4, 5, 6],
    hideWhenUnavailable = false,
  } = config || {};

  const { editor } = useTiptapEditor(providedEditor);

  const activeLevel = getActiveHeadingLevel(editor, levels);
  const isActive = isHeadingActive(editor);
  const canToggleHeadingState = canToggleHeading(editor);

  const isVisible =
    !editor ||
    shouldShowHeadingButton({ editor, hideWhenUnavailable, level: levels });

  return {
    isVisible,
    value: getTextStyleValue(editor),
    activeLevel,
    isActive,
    canToggleHeading: canToggleHeadingState,
    levels,
    label: "Heading",
    Icon: activeLevel ? headingIcons[activeLevel] : HeadingIcon,
  };
}
