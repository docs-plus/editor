"use client";

import type { Editor } from "@tiptap/react";
import { forwardRef, useMemo, useRef, useState } from "react";

// --- Tiptap UI ---
import type {
  HighlightColor,
  UseColorHighlightConfig,
} from "@/components/tiptap-ui/color-highlight-button";
import {
  ColorHighlightButton,
  pickHighlightColorsByValue,
  useColorHighlight,
} from "@/components/tiptap-ui/color-highlight-button";
// --- UI ---
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { ToolbarButtonProps } from "@/components/ui/toolbar-button";
import { ToolbarButton } from "@/components/ui/toolbar-button";
// --- Hooks ---
import { useMenuNavigation } from "@/hooks/use-menu-navigation";
import { useTiptapEditor } from "@/hooks/use-tiptap-editor";
// --- Icons ---
import { BanIcon, HighlighterIcon } from "@/lib/icons";

export interface ColorHighlightPopoverContentProps {
  /**
   * The Tiptap editor instance.
   */
  editor?: Editor | null;
  /**
   * Optional colors to use in the highlight popover.
   * If not provided, defaults to a predefined set of colors.
   */
  colors?: HighlightColor[];
  /**
   * When true, uses the actual color value (colorValue) instead of CSS variable (value).
   * @default false
   */
  useColorValue?: boolean;
}

export interface ColorHighlightPopoverProps
  extends Omit<ToolbarButtonProps, "type">,
    Pick<
      UseColorHighlightConfig,
      "editor" | "hideWhenUnavailable" | "onApplied"
    > {
  /**
   * Optional colors to use in the highlight popover.
   * If not provided, defaults to a predefined set of colors.
   */
  colors?: HighlightColor[];
  /**
   * When true, uses the actual color value (colorValue) instead of CSS variable (value).
   * @default false
   */
  useColorValue?: boolean;
}

export const ColorHighlightPopoverButton = forwardRef<
  HTMLButtonElement,
  ToolbarButtonProps
>(({ className, children, ...props }, ref) => (
  <ToolbarButton
    type="button"
    className={className}
    aria-label="Highlight text"
    tooltip="Highlight"
    ref={ref}
    {...props}
  >
    {children ?? <HighlighterIcon />}
  </ToolbarButton>
));

ColorHighlightPopoverButton.displayName = "ColorHighlightPopoverButton";

export function ColorHighlightPopoverContent({
  editor,
  colors = pickHighlightColorsByValue([
    "var(--tt-color-highlight-green)",
    "var(--tt-color-highlight-blue)",
    "var(--tt-color-highlight-red)",
    "var(--tt-color-highlight-purple)",
    "var(--tt-color-highlight-yellow)",
  ]),
  useColorValue = false,
}: ColorHighlightPopoverContentProps) {
  const { handleRemoveHighlight } = useColorHighlight({ editor });
  const containerRef = useRef<HTMLDivElement>(null);

  const menuItems = useMemo(
    () => [...colors, { label: "Remove highlight", value: "none" }],
    [colors],
  );

  const { selectedIndex } = useMenuNavigation({
    containerRef,
    items: menuItems,
    orientation: "both",
    onSelect: (_item) => {
      if (!containerRef.current) return false;
      const highlightedElement = containerRef.current.querySelector(
        '[data-highlighted="true"]',
      ) as HTMLElement;
      if (highlightedElement) highlightedElement.click();
      return true;
    },
    autoSelectFirstItem: false,
  });

  return (
    <div ref={containerRef} tabIndex={0} className="flex items-center gap-1">
      <div className="flex items-center gap-0.5">
        {colors.map((color, index) => (
          <ColorHighlightButton
            key={color.value}
            editor={editor}
            highlightColor={useColorValue ? color.colorValue : color.value}
            tooltip={color.label}
            aria-label={`${color.label} highlight color`}
            tabIndex={index === selectedIndex ? 0 : -1}
            data-highlighted={selectedIndex === index}
            useColorValue={useColorValue}
          />
        ))}
      </div>
      <div
        aria-hidden="true"
        className="h-5 w-px self-center bg-foreground/20"
      />
      <Button
        onClick={handleRemoveHighlight}
        aria-label="Remove highlight"
        tabIndex={selectedIndex === colors.length ? 0 : -1}
        type="button"
        role="menuitem"
        variant="ghost"
        size="icon-sm"
        data-highlighted={selectedIndex === colors.length}
      >
        <BanIcon />
      </Button>
    </div>
  );
}

export function ColorHighlightPopover({
  editor: providedEditor,
  colors = pickHighlightColorsByValue([
    "var(--tt-color-highlight-green)",
    "var(--tt-color-highlight-blue)",
    "var(--tt-color-highlight-red)",
    "var(--tt-color-highlight-purple)",
    "var(--tt-color-highlight-yellow)",
  ]),
  hideWhenUnavailable = false,
  useColorValue = false,
  onApplied,
  ...props
}: ColorHighlightPopoverProps) {
  const { editor } = useTiptapEditor(providedEditor);
  const [isOpen, setIsOpen] = useState(false);
  const { isVisible, canColorHighlight, isActive, label, Icon } =
    useColorHighlight({
      editor,
      hideWhenUnavailable,
      onApplied,
    });

  if (!isVisible) return null;

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger
        render={
          <ColorHighlightPopoverButton
            disabled={!canColorHighlight}
            isActive={isActive}
            aria-pressed={isActive}
            aria-label={label}
            tooltip={label}
            {...props}
          />
        }
      >
        <Icon />
      </PopoverTrigger>
      <PopoverContent aria-label="Highlight colors">
        <ColorHighlightPopoverContent
          editor={editor}
          colors={colors}
          useColorValue={useColorValue}
        />
      </PopoverContent>
    </Popover>
  );
}
