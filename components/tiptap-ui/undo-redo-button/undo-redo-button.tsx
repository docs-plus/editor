"use client";

import { forwardRef, useCallback } from "react";

import { ShortcutBadge } from "@/components/tiptap-ui/shortcut-badge";
// --- Tiptap UI ---
import type { UseUndoRedoConfig } from "@/components/tiptap-ui/undo-redo-button";
import { useUndoRedo } from "@/components/tiptap-ui/undo-redo-button";
// --- UI Primitives ---
import type { ToolbarButtonProps } from "@/components/ui/toolbar-button";
import { ToolbarButton } from "@/components/ui/toolbar-button";
// --- Hooks ---
import { useTiptapEditor } from "@/hooks/use-tiptap-editor";

export interface UndoRedoButtonProps
  extends Omit<ToolbarButtonProps, "type">,
    UseUndoRedoConfig {
  /**
   * Optional text to display alongside the icon.
   */
  text?: string;
  /**
   * Optional show shortcut keys in the button.
   * @default false
   */
  showShortcut?: boolean;
}

/**
 * Button component for triggering undo/redo actions in a Tiptap editor.
 *
 * For custom button implementations, use the `useHistory` hook instead.
 */
export const UndoRedoButton = forwardRef<
  HTMLButtonElement,
  UndoRedoButtonProps
>(
  (
    {
      editor: providedEditor,
      action,
      text,
      hideWhenUnavailable = false,
      onExecuted,
      showShortcut = false,
      onClick,
      children,
      ...buttonProps
    },
    ref,
  ) => {
    const { editor } = useTiptapEditor(providedEditor);
    const { isVisible, handleAction, label, canExecute, Icon, shortcutKeys } =
      useUndoRedo({
        editor,
        action,
        hideWhenUnavailable,
        onExecuted,
      });

    const handleClick = useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        handleAction();
      },
      [handleAction, onClick],
    );

    if (!isVisible) {
      return null;
    }

    return (
      <ToolbarButton
        type="button"
        disabled={!canExecute}
        tabIndex={-1}
        aria-label={label}
        tooltip={label}
        onClick={handleClick}
        {...buttonProps}
        ref={ref}
      >
        {children ?? (
          <>
            <Icon />
            {text && <span>{text}</span>}
            {showShortcut && <ShortcutBadge shortcutKeys={shortcutKeys} />}
          </>
        )}
      </ToolbarButton>
    );
  },
);

UndoRedoButton.displayName = "UndoRedoButton";
