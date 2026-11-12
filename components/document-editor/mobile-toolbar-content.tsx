"use client";

import { ColorHighlightPopoverContent } from "@/components/tiptap-ui/color-highlight-popover";
import { ToolbarGroup, ToolbarSeparator } from "@/components/ui/toolbar";
import { ToolbarButton } from "@/components/ui/toolbar-button";
import { ArrowLeftIcon, HighlighterIcon } from "@/lib/icons";

interface MobileToolbarContentProps {
  onBack: () => void;
}

/** Secondary mobile toolbar panel for picking a highlight color. */
export function MobileToolbarContent({ onBack }: MobileToolbarContentProps) {
  return (
    <>
      <ToolbarGroup>
        <ToolbarButton onClick={onBack} size="sm">
          <ArrowLeftIcon />
          <HighlighterIcon />
        </ToolbarButton>
      </ToolbarGroup>

      <ToolbarSeparator />

      <ColorHighlightPopoverContent navigation="toolbar" />
    </>
  );
}
