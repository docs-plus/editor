"use client";

import { forwardRef, useCallback } from "react";

// --- Tiptap UI ---
import type { UseCodeBlockConfig } from "@/components/tiptap-ui/code-block-button";
import { useCodeBlock } from "@/components/tiptap-ui/code-block-button";
import { ShortcutBadge } from "@/components/tiptap-ui/shortcut-badge";
// --- UI Primitives ---
import type { ToolbarButtonProps } from "@/components/ui/toolbar-button";
import { ToolbarButton } from "@/components/ui/toolbar-button";
// --- Hooks ---
import { useTiptapEditor } from "@/hooks/use-tiptap-editor";

export interface CodeBlockButtonProps
  extends Omit<ToolbarButtonProps, "type">,
    UseCodeBlockConfig {
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
 * Button component for toggling code block in a Tiptap editor.
 *
 * For custom button implementations, use the `useCodeBlock` hook instead.
 */
export const CodeBlockButton = forwardRef<
  HTMLButtonElement,
  CodeBlockButtonProps
>(
  (
    {
      editor: providedEditor,
      text,
      hideWhenUnavailable = false,
      onToggled,
      showShortcut = false,
      onClick,
      children,
      ...buttonProps
    },
    ref,
  ) => {
    const { editor } = useTiptapEditor(providedEditor);
    const {
      isVisible,
      canToggleCodeBlock,
      isActive,
      handleToggle,
      label,
      shortcutKeys,
      Icon,
    } = useCodeBlock({
      editor,
      hideWhenUnavailable,
      onToggled,
    });

    const handleClick = useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        handleToggle();
      },
      [handleToggle, onClick],
    );

    if (!isVisible) {
      return null;
    }

    return (
      <ToolbarButton
        type="button"
        isActive={isActive}
        disabled={!canToggleCodeBlock}
        tabIndex={-1}
        aria-label={label}
        aria-pressed={isActive}
        tooltip="Code Block"
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

CodeBlockButton.displayName = "CodeBlockButton";
