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
import { CodeBlockIcon } from "@/lib/icons";

export const CODE_BLOCK_SHORTCUT_KEY = "mod+alt+c";

/**
 * Configuration for the code block functionality
 */
export interface UseCodeBlockConfig {
  /**
   * The Tiptap editor instance.
   */
  editor?: Editor | null;
  /**
   * Whether the button should hide when code block is not available.
   * @default false
   */
  hideWhenUnavailable?: boolean;
  /**
   * Callback function called after a successful code block toggle.
   */
  onToggled?: () => void;
}

/**
 * Checks if code block can be toggled in the current editor state
 */
export function canToggleCodeBlock(
  editor: Editor | null,
  turnInto: boolean = true,
): boolean {
  if (!editor || !editor.isEditable) return false;
  if (
    !isNodeInSchema("codeBlock", editor) ||
    isNodeTypeSelected(editor, ["image"])
  )
    return false;

  if (!turnInto) {
    return editor.can().toggleNode("codeBlock", "paragraph");
  }

  // Ensure selection is in nodes we're allowed to convert
  if (!selectionWithinConvertibleTypes(editor, [...BLOCK_CONVERTIBLE_TYPES]))
    return false;

  // Either we can toggle code block directly on the selection,
  // or we can clear formatting/nodes to arrive at a code block.
  return (
    editor.can().toggleNode("codeBlock", "paragraph") ||
    editor.can().clearNodes()
  );
}

/**
 * Toggles code block in the editor
 */
export function toggleCodeBlock(editor: Editor | null): boolean {
  if (!editor || !editor.isEditable) return false;
  if (!canToggleCodeBlock(editor)) return false;

  try {
    const chain = prepareBlockToggle(editor);

    const toggle = editor.isActive("codeBlock")
      ? chain.setNode("paragraph")
      : chain.toggleNode("codeBlock", "paragraph");

    toggle.run();

    editor.chain().focus().selectTextblockEnd().run();

    return true;
  } catch {
    return false;
  }
}

/**
 * Determines if the code block button should be shown
 */
export function shouldShowCodeBlockButton(props: {
  editor: Editor | null;
  hideWhenUnavailable: boolean;
}): boolean {
  const { editor, hideWhenUnavailable } = props;

  return shouldShowEditorButton(editor, hideWhenUnavailable, () => {
    if (!isNodeInSchema("codeBlock", editor)) return false;
    if (!editor?.isActive("code")) return canToggleCodeBlock(editor);
    return true;
  });
}

/**
 * Custom hook that provides code block functionality for Tiptap editor
 *
 * @example
 * ```tsx
 * // Simple usage - no params needed
 * function MySimpleCodeBlockButton() {
 *   const { isVisible, isActive, handleToggle } = useCodeBlock()
 *
 *   if (!isVisible) return null
 *
 *   return (
 *     <button
 *       onClick={handleToggle}
 *       aria-pressed={isActive}
 *     >
 *       Code Block
 *     </button>
 *   )
 * }
 *
 * // Advanced usage with configuration
 * function MyAdvancedCodeBlockButton() {
 *   const { isVisible, isActive, handleToggle, label } = useCodeBlock({
 *     editor: myEditor,
 *     hideWhenUnavailable: true,
 *     onToggled: (isActive) => console.log('Code block toggled:', isActive)
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
 *       Toggle Code Block
 *     </MyButton>
 *   )
 * }
 * ```
 */
export function useCodeBlock(config?: UseCodeBlockConfig) {
  const {
    editor: providedEditor,
    hideWhenUnavailable = false,
    onToggled,
  } = config || {};

  const { editor } = useTiptapEditor(providedEditor);
  const [isVisible, setIsVisible] = useState<boolean>(true);
  const canToggleCodeBlockState = canToggleCodeBlock(editor);
  const isActive = editor?.isActive("codeBlock") || false;

  useEffect(() => {
    if (!editor) return;

    const handleSelectionUpdate = () => {
      setIsVisible(shouldShowCodeBlockButton({ editor, hideWhenUnavailable }));
    };

    handleSelectionUpdate();

    editor.on("selectionUpdate", handleSelectionUpdate);

    return () => {
      editor.off("selectionUpdate", handleSelectionUpdate);
    };
  }, [editor, hideWhenUnavailable]);

  const handleToggle = useCallback(() => {
    if (!editor) return false;

    const success = toggleCodeBlock(editor);
    if (success) {
      onToggled?.();
    }
    return success;
  }, [editor, onToggled]);

  return {
    isVisible,
    isActive,
    handleToggle,
    canToggleCodeBlock: canToggleCodeBlockState,
    label: "Code Block",
    shortcutKeys: CODE_BLOCK_SHORTCUT_KEY,
    Icon: CodeBlockIcon,
  };
}
