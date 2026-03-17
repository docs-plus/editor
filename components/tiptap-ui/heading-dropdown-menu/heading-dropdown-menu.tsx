"use client";

import { forwardRef, useCallback, useState } from "react";

// --- Tiptap UI ---
import { HeadingButton } from "@/components/tiptap-ui/heading-button";
import type { UseHeadingDropdownMenuConfig } from "@/components/tiptap-ui/heading-dropdown-menu";
import { useHeadingDropdownMenu } from "@/components/tiptap-ui/heading-dropdown-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
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
    const { isVisible, isActive, canToggleHeading, Icon } =
      useHeadingDropdownMenu({
        editor,
        levels,
        hideWhenUnavailable,
      });

    const handleOpenChange = useCallback(
      (open: boolean) => {
        if (!editor || !canToggleHeading) return;
        setIsOpen(open);
        onOpenChange?.(open);
      },
      [canToggleHeading, editor, onOpenChange],
    );

    if (!isVisible) {
      return null;
    }

    return (
      <DropdownMenu open={isOpen} onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger
          render={
            <ToolbarButton
              type="button"
              isActive={isActive}
              tabIndex={-1}
              disabled={!canToggleHeading}
              aria-label="Format text as heading"
              aria-pressed={isActive}
              tooltip="Heading"
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
              <ChevronDownIcon className="size-3 opacity-60" />
            </>
          )}
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start">
          <div className="flex flex-col gap-0.5 p-1">
            {levels.map((level) => (
              <HeadingButton
                key={`heading-${level}`}
                editor={editor}
                level={level}
                text={`Heading ${level}`}
                showTooltip={false}
                size="sm"
                className="w-full justify-start"
              />
            ))}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  },
);

HeadingDropdownMenu.displayName = "HeadingDropdownMenu";
