"use client";

import { forwardRef, useCallback } from "react";

// --- Tiptap UI ---
import type { UseHeadingConfig } from "@/components/tiptap-ui/heading-button";
import { useHeading } from "@/components/tiptap-ui/heading-button";
import { ShortcutBadge } from "@/components/tiptap-ui/shortcut-badge";
// --- UI Primitives ---
import type { ToolbarButtonProps } from "@/components/ui/toolbar-button";
import { ToolbarButton } from "@/components/ui/toolbar-button";
// --- Hooks ---
import { useTiptapEditor } from "@/hooks/use-tiptap-editor";

export interface HeadingButtonProps
  extends Omit<ToolbarButtonProps, "type">,
    UseHeadingConfig {
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
 * Button component for toggling heading in a Tiptap editor.
 *
 * For custom button implementations, use the `useHeading` hook instead.
 */
export const HeadingButton = forwardRef<HTMLButtonElement, HeadingButtonProps>(
  (
    {
      editor: providedEditor,
      level,
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
      canToggleHeading,
      isActive,
      handleToggle,
      label,
      Icon,
      shortcutKeys,
    } = useHeading({
      editor,
      level,
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
        tabIndex={-1}
        disabled={!canToggleHeading}
        aria-label={label}
        aria-pressed={isActive}
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

HeadingButton.displayName = "HeadingButton";
