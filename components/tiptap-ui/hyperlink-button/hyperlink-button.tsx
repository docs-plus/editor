"use client";

import { forwardRef, useCallback } from "react";

// --- Tiptap UI ---
import type { UseHyperlinkConfig } from "@/components/tiptap-ui/hyperlink-button";
import { useHyperlink } from "@/components/tiptap-ui/hyperlink-button";
// --- UI Primitives ---
import type { ToolbarButtonProps } from "@/components/ui/toolbar-button";
import { ToolbarButton } from "@/components/ui/toolbar-button";
// --- Icons ---
import { LinkIcon } from "@/lib/icons";

export interface HyperlinkButtonProps
  extends Omit<ToolbarButtonProps, "type">,
    UseHyperlinkConfig {}

/**
 * Opens the Hyperlink extension's create form, or the preview of the link
 * under the caret. Same behavior as `Mod-k`.
 */
export const HyperlinkButton = forwardRef<
  HTMLButtonElement,
  HyperlinkButtonProps
>(({ editor: providedEditor, onClick, children, ...buttonProps }, ref) => {
  const { isVisible, isActive, canOpen, handleOpen, label, shortcutKeys } =
    useHyperlink({ editor: providedEditor });

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      onClick?.(event);
      if (event.defaultPrevented) return;
      handleOpen();
    },
    [handleOpen, onClick],
  );

  if (!isVisible) return null;

  return (
    <ToolbarButton
      type="button"
      isActive={isActive}
      disabled={!canOpen}
      tabIndex={-1}
      aria-label={label}
      aria-pressed={isActive}
      tooltip={label}
      shortcutKeys={shortcutKeys}
      onClick={handleClick}
      {...buttonProps}
      ref={ref}
    >
      {children ?? <LinkIcon />}
    </ToolbarButton>
  );
});

HyperlinkButton.displayName = "HyperlinkButton";
