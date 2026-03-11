"use client";

import type { Editor } from "@tiptap/react";
import { forwardRef, useCallback, useEffect, useState } from "react";
// --- Tiptap UI ---
import type { UseLinkPopoverConfig } from "@/components/tiptap-ui/link-popover";
import { useLinkPopover } from "@/components/tiptap-ui/link-popover";
// --- UI ---
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { ToolbarButtonProps } from "@/components/ui/toolbar-button";
import { ToolbarButton } from "@/components/ui/toolbar-button";
// --- Hooks ---
import { useTiptapEditor } from "@/hooks/use-tiptap-editor";
// --- Icons ---
import {
  CornerDownLeftIcon,
  ExternalLinkIcon,
  LinkIcon,
  TrashIcon,
} from "@/lib/icons";

export interface LinkMainProps {
  /**
   * The URL to set for the link.
   */
  url: string;
  /**
   * Function to update the URL state.
   */
  setUrl: React.Dispatch<React.SetStateAction<string | null>>;
  /**
   * Function to set the link in the editor.
   */
  setLink: () => void;
  /**
   * Function to remove the link from the editor.
   */
  removeLink: () => void;
  /**
   * Function to open the link.
   */
  openLink: () => void;
  /**
   * Whether the link is currently active in the editor.
   */
  isActive: boolean;
}

export interface LinkPopoverProps
  extends Omit<ToolbarButtonProps, "type">,
    UseLinkPopoverConfig {
  /**
   * Callback for when the popover opens or closes.
   */
  onOpenChange?: (isOpen: boolean) => void;
  /**
   * Whether to automatically open the popover when a link is active.
   * @default true
   */
  autoOpenOnLinkActive?: boolean;
}

/**
 * Link button component for triggering the link popover
 */
export const LinkButton = forwardRef<HTMLButtonElement, ToolbarButtonProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <ToolbarButton
        type="button"
        className={className}
        aria-label="Link"
        tooltip="Link"
        ref={ref}
        {...props}
      >
        {children || <LinkIcon />}
      </ToolbarButton>
    );
  },
);

LinkButton.displayName = "LinkButton";

/**
 * Main content component for the link popover
 */
const LinkMain: React.FC<LinkMainProps> = ({
  url,
  setUrl,
  setLink,
  removeLink,
  openLink,
  isActive,
}) => {
  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      setLink();
    }
  };

  return (
    <div className="flex items-center gap-1">
      <Input
        type="url"
        placeholder="Paste a link..."
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={handleKeyDown}
        autoFocus
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        aria-label="Link URL"
      />

      <Button
        type="button"
        onClick={setLink}
        aria-label="Apply link"
        disabled={!url && !isActive}
        variant="ghost"
        size="icon-sm"
      >
        <CornerDownLeftIcon />
      </Button>

      <div
        aria-hidden="true"
        className="h-5 w-px self-center bg-foreground/20"
      />

      <div className="flex items-center gap-0.5">
        <Button
          type="button"
          onClick={openLink}
          aria-label="Open in new window"
          disabled={!url && !isActive}
          variant="ghost"
          size="icon-sm"
        >
          <ExternalLinkIcon />
        </Button>

        <Button
          type="button"
          onClick={removeLink}
          aria-label="Remove link"
          disabled={!url && !isActive}
          variant="ghost"
          size="icon-sm"
        >
          <TrashIcon />
        </Button>
      </div>
    </div>
  );
};

/**
 * Link content component for standalone use
 */
export const LinkContent: React.FC<{
  editor?: Editor | null;
}> = ({ editor }) => {
  const linkPopover = useLinkPopover({
    editor,
  });

  return <LinkMain {...linkPopover} />;
};

/**
 * Link popover component for Tiptap editors.
 *
 * For custom popover implementations, use the `useLinkPopover` hook instead.
 */
export const LinkPopover = forwardRef<HTMLButtonElement, LinkPopoverProps>(
  (
    {
      editor: providedEditor,
      hideWhenUnavailable = false,
      onSetLink,
      onOpenChange,
      autoOpenOnLinkActive = true,
      onClick,
      children,
      ...buttonProps
    },
    ref,
  ) => {
    const { editor } = useTiptapEditor(providedEditor);
    const [isOpen, setIsOpen] = useState(false);

    const {
      isVisible,
      canSet,
      isActive,
      url,
      setUrl,
      setLink,
      removeLink,
      openLink,
      label,
      Icon,
    } = useLinkPopover({
      editor,
      hideWhenUnavailable,
      onSetLink,
    });

    const handleOnOpenChange = useCallback(
      (nextIsOpen: boolean) => {
        setIsOpen(nextIsOpen);
        onOpenChange?.(nextIsOpen);
      },
      [onOpenChange],
    );

    const handleSetLink = useCallback(() => {
      setLink();
      setIsOpen(false);
    }, [setLink]);

    const handleClick = useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        setIsOpen(!isOpen);
      },
      [onClick, isOpen],
    );

    useEffect(() => {
      if (autoOpenOnLinkActive && isActive) {
        setIsOpen(true);
      }
    }, [autoOpenOnLinkActive, isActive]);

    if (!isVisible) {
      return null;
    }

    return (
      <Popover open={isOpen} onOpenChange={handleOnOpenChange}>
        <PopoverTrigger
          render={
            <LinkButton
              disabled={!canSet}
              isActive={isActive}
              aria-label={label}
              aria-pressed={isActive}
              onClick={handleClick}
              {...buttonProps}
              ref={ref}
            />
          }
        >
          {children ?? <Icon />}
        </PopoverTrigger>

        <PopoverContent>
          <LinkMain
            url={url}
            setUrl={setUrl}
            setLink={handleSetLink}
            removeLink={removeLink}
            openLink={openLink}
            isActive={isActive}
          />
        </PopoverContent>
      </Popover>
    );
  },
);

LinkPopover.displayName = "LinkPopover";
