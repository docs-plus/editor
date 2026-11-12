"use client";

import type { Editor } from "@tiptap/react";
import { forwardRef, useEffect, useMemo, useRef, useState } from "react";

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
  /**
   * "grid" runs its own roving tabindex and arrow keys (popover). "toolbar"
   * leaves the swatches as plain items of the surrounding toolbar (mobile panel).
   * @default "grid"
   */
  navigation?: "grid" | "toolbar";
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

const HIGHLIGHT_GROUP_LABEL = "Highlight colours";

/** "Green background" becomes "Green highlight". */
function swatchName(label: string) {
  return `${label.replace(/ background$/, "")} highlight`;
}

function firstPressedIndex(container: HTMLElement | null) {
  const items = Array.from(container?.querySelectorAll("button") ?? []);
  const index = items.findIndex(
    (item) => item.getAttribute("aria-pressed") === "true",
  );
  return Math.max(index, 0);
}

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
  navigation = "grid",
}: ColorHighlightPopoverContentProps) {
  const { handleRemoveHighlight } = useColorHighlight({ editor });
  const containerRef = useRef<HTMLDivElement>(null);
  const isGrid = navigation === "grid";

  const menuItems = useMemo(
    () => [...colors, { label: "No highlight", value: "none" }],
    [colors],
  );

  const { selectedIndex, setSelectedIndex } = useMenuNavigation({
    // Without a container the hook attaches no listener: toolbar mode leaves
    // arrow keys to the surrounding toolbar.
    containerRef: isGrid ? containerRef : undefined,
    items: menuItems,
    orientation: "both",
    captureTab: false,
    // Escape belongs to the popover, which closes itself.
    shouldHandle: (event) => event.key !== "Escape",
    onSelect: () => {
      itemAt(containerRef.current, selectedIndex)?.click();
    },
    autoSelectFirstItem: false,
  });

  // Start on the pressed swatch, else the first. Runs once on mount, after the
  // swatches have rendered their pressed state.
  useEffect(() => {
    if (isGrid) setSelectedIndex(firstPressedIndex(containerRef.current));
  }, [isGrid, setSelectedIndex]);

  // Arrow keys only move the roving index; follow it with focus.
  useEffect(() => {
    const container = containerRef.current;
    if (!isGrid || !container || selectedIndex === undefined) return;
    const target = itemAt(container, selectedIndex);
    if (
      target &&
      container.contains(document.activeElement) &&
      document.activeElement !== target
    ) {
      target.focus();
    }
  }, [isGrid, selectedIndex]);

  const tabIndexFor = (index: number) =>
    isGrid && index === selectedIndex ? 0 : -1;

  return (
    <div
      ref={containerRef}
      role="group"
      aria-label={HIGHLIGHT_GROUP_LABEL}
      data-roving-group={isGrid ? "" : undefined}
      onFocus={(event) => {
        if (!isGrid) return;
        const buttons = Array.from(
          containerRef.current?.querySelectorAll("button") ?? [],
        );
        const index = buttons.findIndex((button) =>
          button.contains(event.target as Node),
        );
        if (index !== -1) setSelectedIndex(index);
      }}
      className="flex items-center gap-1"
    >
      <div className="flex items-center gap-0.5">
        {colors.map((color, index) => (
          <ColorHighlightButton
            key={color.value}
            editor={editor}
            highlightColor={useColorValue ? color.colorValue : color.value}
            tooltip={swatchName(color.label)}
            aria-label={swatchName(color.label)}
            tabIndex={tabIndexFor(index)}
            useColorValue={useColorValue}
            // Applying refocuses the editor (Tiptap defers that by a frame);
            // take focus back so Esc still returns it to the trigger.
            onApplied={
              isGrid
                ? () =>
                    requestAnimationFrame(() =>
                      itemAt(containerRef.current, index)?.focus(),
                    )
                : undefined
            }
          />
        ))}
      </div>
      <div
        aria-hidden="true"
        className="h-5 w-px self-center bg-foreground/20"
      />
      <Button
        onClick={handleRemoveHighlight}
        aria-label="No highlight"
        tabIndex={tabIndexFor(colors.length)}
        type="button"
        variant="ghost"
        size="icon-sm"
      >
        <BanIcon />
      </Button>
    </div>
  );
}

function itemAt(container: HTMLElement | null, index: number | undefined) {
  if (index === undefined) return undefined;
  return container?.querySelectorAll("button")[index];
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
  const popupRef = useRef<HTMLDivElement>(null);
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
        disabled={!canColorHighlight}
        render={
          <ColorHighlightPopoverButton
            disabled={!canColorHighlight}
            isActive={isActive}
            aria-haspopup="dialog"
            aria-label={label}
            tooltip={label}
            {...props}
          />
        }
      >
        <Icon />
      </PopoverTrigger>
      <PopoverContent
        ref={popupRef}
        aria-label={HIGHLIGHT_GROUP_LABEL}
        initialFocus={() => {
          const buttons = popupRef.current?.querySelectorAll("button");
          return (
            popupRef.current?.querySelector<HTMLElement>(
              'button[aria-pressed="true"]',
            ) ??
            buttons?.[0] ??
            true
          );
        }}
      >
        <ColorHighlightPopoverContent
          editor={editor}
          colors={colors}
          useColorValue={useColorValue}
        />
      </PopoverContent>
    </Popover>
  );
}
