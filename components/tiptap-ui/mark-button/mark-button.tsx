"use client";

import { forwardRef, useCallback } from "react";
// --- Tiptap UI ---
import type { UseMarkConfig } from "@/components/tiptap-ui/mark-button";
import { useMark } from "@/components/tiptap-ui/mark-button";
import { ShortcutBadge } from "@/components/tiptap-ui/shortcut-badge";
// --- UI Primitives ---
import type { ButtonProps } from "@/components/tiptap-ui-primitive/button";
import { Button } from "@/components/tiptap-ui-primitive/button";
// --- Hooks ---
import { useTiptapEditor } from "@/hooks/use-tiptap-editor";

export interface MarkButtonProps
  extends Omit<ButtonProps, "type">,
    UseMarkConfig {
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
 * Button component for toggling marks in a Tiptap editor.
 *
 * For custom button implementations, use the `useMark` hook instead.
 */
export const MarkButton = forwardRef<HTMLButtonElement, MarkButtonProps>(
  (
    {
      editor: providedEditor,
      type,
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
      handleMark,
      label,
      canToggle,
      isActive,
      Icon,
      shortcutKeys,
    } = useMark({
      editor,
      type,
      hideWhenUnavailable,
      onToggled,
    });

    const handleClick = useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        handleMark();
      },
      [handleMark, onClick],
    );

    if (!isVisible) {
      return null;
    }

    return (
      <Button
        type="button"
        disabled={!canToggle}
        variant="ghost"
        data-active-state={isActive ? "on" : "off"}
        data-disabled={!canToggle}
        role="button"
        tabIndex={-1}
        aria-label={label}
        aria-pressed={isActive}
        tooltip={label}
        onClick={handleClick}
        {...buttonProps}
        ref={ref}
      >
        {children ?? (
          <>
            <Icon className="tiptap-button-icon" />
            {text && <span className="tiptap-button-text">{text}</span>}
            {showShortcut && <ShortcutBadge shortcutKeys={shortcutKeys} />}
          </>
        )}
      </Button>
    );
  },
);

MarkButton.displayName = "MarkButton";
