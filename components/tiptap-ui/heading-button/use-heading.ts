"use client";

import type { Editor } from "@tiptap/react";
import { useCallback, useEffect, useState } from "react";
// --- Hooks ---
import { useTiptapEditor } from "@/hooks/use-tiptap-editor";
// --- Lib ---
import {
  BLOCK_CONVERTIBLE_TYPES,
  isNodeInSchema,
  isNodeTypeSelected,
  prepareBlockToggle,
  selectionWithinConvertibleTypes,
  shouldShowEditorButton,
} from "@/lib/editor-utils";
// --- Icons ---
import {
  HeadingFiveIcon,
  HeadingFourIcon,
  HeadingOneIcon,
  HeadingSixIcon,
  HeadingThreeIcon,
  HeadingTwoIcon,
} from "@/lib/icons";

export type Level = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Configuration for the heading functionality
 */
export interface UseHeadingConfig {
  /**
   * The Tiptap editor instance.
   */
  editor?: Editor | null;
  /**
   * The heading level.
   */
  level: Level;
  /**
   * Whether the button should hide when heading is not available.
   * @default false
   */
  hideWhenUnavailable?: boolean;
  /**
   * Callback function called after a successful heading toggle.
   */
  onToggled?: () => void;
}

export const headingIcons = {
  1: HeadingOneIcon,
  2: HeadingTwoIcon,
  3: HeadingThreeIcon,
  4: HeadingFourIcon,
  5: HeadingFiveIcon,
  6: HeadingSixIcon,
};

export const HEADING_SHORTCUT_KEYS: Record<Level, string> = {
  1: "ctrl+alt+1",
  2: "ctrl+alt+2",
  3: "ctrl+alt+3",
  4: "ctrl+alt+4",
  5: "ctrl+alt+5",
  6: "ctrl+alt+6",
};

/**
 * Checks if heading can be toggled in the current editor state
 */
export function canToggleHeading(
  editor: Editor | null,
  level?: Level,
  turnInto: boolean = true,
): boolean {
  if (!editor || !editor.isEditable) return false;
  if (
    !isNodeInSchema("heading", editor) ||
    isNodeTypeSelected(editor, ["image"])
  )
    return false;

  if (!turnInto) {
    return level
      ? editor.can().setNode("heading", { level })
      : editor.can().setNode("heading");
  }

  // Ensure selection is in nodes we're allowed to convert
  if (!selectionWithinConvertibleTypes(editor, [...BLOCK_CONVERTIBLE_TYPES]))
    return false;

  // Either we can set heading directly on the selection,
  // or we can clear formatting/nodes to arrive at a heading.
  return level
    ? editor.can().setNode("heading", { level }) || editor.can().clearNodes()
    : editor.can().setNode("heading") || editor.can().clearNodes();
}

/**
 * Checks if heading is currently active
 */
export function isHeadingActive(
  editor: Editor | null,
  level?: Level | Level[],
): boolean {
  if (!editor || !editor.isEditable) return false;

  if (Array.isArray(level)) {
    return level.some((l) => editor.isActive("heading", { level: l }));
  }

  return level
    ? editor.isActive("heading", { level })
    : editor.isActive("heading");
}

/**
 * Toggles heading in the editor
 */
export function toggleHeading(
  editor: Editor | null,
  level: Level | Level[],
): boolean {
  if (!editor || !editor.isEditable) return false;

  const levels = Array.isArray(level) ? level : [level];
  const toggleLevel = levels.find((l) => canToggleHeading(editor, l));

  if (!toggleLevel) return false;

  try {
    const chain = prepareBlockToggle(editor);

    const isActive = levels.some((l) =>
      editor.isActive("heading", { level: l }),
    );

    const toggle = isActive
      ? chain.setNode("paragraph")
      : chain.setNode("heading", { level: toggleLevel });

    toggle.run();

    editor.chain().focus().selectTextblockEnd().run();

    return true;
  } catch {
    return false;
  }
}

/**
 * Determines if the heading button should be shown
 */
export function shouldShowHeadingButton(props: {
  editor: Editor | null;
  level?: Level | Level[];
  hideWhenUnavailable: boolean;
}): boolean {
  const { editor, level, hideWhenUnavailable } = props;

  return shouldShowEditorButton(editor, hideWhenUnavailable, () => {
    if (!editor || !isNodeInSchema("heading", editor)) return false;
    if (!editor.isActive("code")) {
      if (Array.isArray(level)) {
        return level.some((l) => canToggleHeading(editor, l));
      }
      return canToggleHeading(editor, level);
    }
    return true;
  });
}

/**
 * Custom hook that provides heading functionality for Tiptap editor
 *
 * @example
 * ```tsx
 * // Simple usage
 * function MySimpleHeadingButton() {
 *   const { isVisible, isActive, handleToggle, Icon } = useHeading({ level: 1 })
 *
 *   if (!isVisible) return null
 *
 *   return (
 *     <button
 *       onClick={handleToggle}
 *       aria-pressed={isActive}
 *     >
 *       <Icon />
 *       Heading 1
 *     </button>
 *   )
 * }
 *
 * // Advanced usage with configuration
 * function MyAdvancedHeadingButton() {
 *   const { isVisible, isActive, handleToggle, label, Icon } = useHeading({
 *     level: 2,
 *     editor: myEditor,
 *     hideWhenUnavailable: true,
 *     onToggled: (isActive) => console.log('Heading toggled:', isActive)
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
 *       <Icon />
 *       Toggle Heading 2
 *     </MyButton>
 *   )
 * }
 * ```
 */
export function useHeading(config: UseHeadingConfig) {
  const {
    editor: providedEditor,
    level,
    hideWhenUnavailable = false,
    onToggled,
  } = config;

  const { editor } = useTiptapEditor(providedEditor);
  const [isVisible, setIsVisible] = useState<boolean>(true);
  const canToggleHeadingState = canToggleHeading(editor, level);
  const isActive = isHeadingActive(editor, level);

  useEffect(() => {
    if (!editor) return;

    const handleSelectionUpdate = () => {
      setIsVisible(
        shouldShowHeadingButton({ editor, level, hideWhenUnavailable }),
      );
    };

    handleSelectionUpdate();

    editor.on("selectionUpdate", handleSelectionUpdate);

    return () => {
      editor.off("selectionUpdate", handleSelectionUpdate);
    };
  }, [editor, level, hideWhenUnavailable]);

  const handleToggle = useCallback(() => {
    if (!editor) return false;

    const success = toggleHeading(editor, level);
    if (success) {
      onToggled?.();
    }
    return success;
  }, [editor, level, onToggled]);

  return {
    isVisible,
    isActive,
    handleToggle,
    canToggleHeading: canToggleHeadingState,
    label: `Heading ${level}`,
    shortcutKeys: HEADING_SHORTCUT_KEYS[level],
    Icon: headingIcons[level],
  };
}
