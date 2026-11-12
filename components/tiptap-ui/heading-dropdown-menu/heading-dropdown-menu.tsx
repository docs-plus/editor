"use client";

import { forwardRef, useCallback, useRef, useState } from "react";

// --- Tiptap UI ---
import { canToggleHeading } from "@/components/tiptap-ui/heading-button";
import type { UseHeadingDropdownMenuConfig } from "@/components/tiptap-ui/heading-dropdown-menu";
import {
  setTextStyle,
  TEXT_STYLE_LABELS,
  type TextStyleValue,
  useHeadingDropdownMenu,
} from "@/components/tiptap-ui/heading-dropdown-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
// --- UI ---
import type { ToolbarButtonProps } from "@/components/ui/toolbar-button";
import { ToolbarButton } from "@/components/ui/toolbar-button";
// --- Hooks ---
import { useTiptapEditor } from "@/hooks/use-tiptap-editor";
// --- Icons ---
import { ChevronDownIcon } from "@/lib/icons";

export interface HeadingDropdownMenuProps
  extends Omit<ToolbarButtonProps, "type">,
    UseHeadingDropdownMenuConfig {
  /**
   * Callback for when the dropdown opens or closes
   */
  onOpenChange?: (isOpen: boolean) => void;
}

/**
 * Dropdown menu component for selecting heading levels in a Tiptap editor.
 *
 * For custom dropdown implementations, use the `useHeadingDropdownMenu` hook instead.
 */
export const HeadingDropdownMenu = forwardRef<
  HTMLButtonElement,
  HeadingDropdownMenuProps
>(
  (
    {
      editor: providedEditor,
      levels = [1, 2, 3, 4, 5, 6],
      hideWhenUnavailable = false,
      onOpenChange,
      children,
      ...buttonProps
    },
    ref,
  ) => {
    const { editor } = useTiptapEditor(providedEditor);
    const [isOpen, setIsOpen] = useState<boolean>(false);
    const picked = useRef(false);
    const {
      isVisible,
      isActive,
      canToggleHeading: canToggle,
      value,
      Icon,
    } = useHeadingDropdownMenu({
      editor,
      levels,
      hideWhenUnavailable,
    });

    const handleOpenChange = useCallback(
      (open: boolean) => {
        if (open && (!editor || !canToggle)) return;
        setIsOpen(open);
        // Base UI returns focus only after the exit animation, and Tiptap's
        // focus() waits a frame: a keystroke typed before either would go
        // to the menu, so hand focus to the editor now.
        if (!open && picked.current) editor?.view.focus();
        onOpenChange?.(open);
      },
      [canToggle, editor, onOpenChange],
    );

    const handleValueChange = useCallback(
      (next: string) => {
        picked.current = true;
        setTextStyle(editor, next as Exclude<TextStyleValue, "title">);
      },
      [editor],
    );

    // After a pick the editor already holds the selection, so focus goes
    // there; Esc and outside clicks fall back to the trigger.
    const finalFocus = useCallback(() => {
      if (!picked.current) return true;
      picked.current = false;
      return editor?.view.dom ?? true;
    }, [editor]);

    if (!isVisible) {
      return null;
    }

    return (
      <DropdownMenu open={isOpen} onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger
          disabled={!canToggle}
          render={
            <ToolbarButton
              type="button"
              isActive={isActive}
              tabIndex={-1}
              disabled={!canToggle}
              aria-haspopup="menu"
              tooltip="Text style"
              size="sm"
              {...buttonProps}
              ref={ref}
            />
          }
        >
          {children ? (
            children
          ) : (
            <>
              <Icon />
              {TEXT_STYLE_LABELS[value]}
              <ChevronDownIcon className="size-3 opacity-60" />
            </>
          )}
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" finalFocus={finalFocus}>
          <DropdownMenuRadioGroup
            value={value}
            onValueChange={handleValueChange}
          >
            <DropdownMenuRadioItem value="paragraph" closeOnClick>
              {TEXT_STYLE_LABELS.paragraph}
            </DropdownMenuRadioItem>
            {levels.map((level) => (
              <DropdownMenuRadioItem
                key={level}
                value={`heading-${level}`}
                closeOnClick
                disabled={!canToggleHeading(editor, level)}
              >
                {TEXT_STYLE_LABELS[`heading-${level}`]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  },
);

HeadingDropdownMenu.displayName = "HeadingDropdownMenu";
