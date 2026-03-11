"use client";

import { forwardRef, useCallback } from "react";
import { ShortcutBadge } from "@/components/tiptap-ui/shortcut-badge";

// --- Tiptap UI ---
import type { UseTextAlignConfig } from "@/components/tiptap-ui/text-align-button";
import { useTextAlign } from "@/components/tiptap-ui/text-align-button";
// --- UI Primitives ---
import type { ToolbarButtonProps } from "@/components/ui/toolbar-button";
import { ToolbarButton } from "@/components/ui/toolbar-button";
// --- Hooks ---
import { useTiptapEditor } from "@/hooks/use-tiptap-editor";

type IconProps = React.SVGProps<SVGSVGElement>;
type IconComponent = ({ className, ...props }: IconProps) => React.ReactElement;

export interface TextAlignButtonProps
  extends Omit<ToolbarButtonProps, "type">,
    UseTextAlignConfig {
  /**
   * Optional text to display alongside the icon.
   */
  text?: string;
  /**
   * Optional show shortcut keys in the button.
   * @default false
   */
  showShortcut?: boolean;
  /**
   * Optional custom icon component to render instead of the default.
   */
  icon?: React.MemoExoticComponent<IconComponent> | React.FC<IconProps>;
}

/**
 * Button component for setting text alignment in a Tiptap editor.
 *
 * For custom button implementations, use the `useTextAlign` hook instead.
 */
export const TextAlignButton = forwardRef<
  HTMLButtonElement,
  TextAlignButtonProps
>(
  (
    {
      editor: providedEditor,
      align,
      text,
      hideWhenUnavailable = false,
      onAligned,
      showShortcut = false,
      onClick,
      icon: CustomIcon,
      children,
      ...buttonProps
    },
    ref,
  ) => {
    const { editor } = useTiptapEditor(providedEditor);
    const {
      isVisible,
      handleTextAlign,
      label,
      canAlign,
      isActive,
      Icon,
      shortcutKeys,
    } = useTextAlign({
      editor,
      align,
      hideWhenUnavailable,
      onAligned,
    });

    const handleClick = useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        handleTextAlign();
      },
      [handleTextAlign, onClick],
    );

    if (!isVisible) {
      return null;
    }

    const RenderIcon = CustomIcon ?? Icon;

    return (
      <ToolbarButton
        type="button"
        disabled={!canAlign}
        isActive={isActive}
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
            <RenderIcon />
            {text && <span>{text}</span>}
            {showShortcut && <ShortcutBadge shortcutKeys={shortcutKeys} />}
          </>
        )}
      </ToolbarButton>
    );
  },
);

TextAlignButton.displayName = "TextAlignButton";
