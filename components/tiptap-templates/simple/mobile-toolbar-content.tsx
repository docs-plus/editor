"use client";

import { ColorHighlightPopoverContent } from "@/components/tiptap-ui/color-highlight-popover";
import { LinkContent } from "@/components/tiptap-ui/link-popover";
import { ToolbarGroup, ToolbarSeparator } from "@/components/ui/toolbar";
import { ToolbarButton } from "@/components/ui/toolbar-button";
import { ArrowLeftIcon, HighlighterIcon, LinkIcon } from "@/lib/icons";

interface MobileToolbarContentProps {
  type: "highlighter" | "link";
  onBack: () => void;
}

export function MobileToolbarContent({
  type,
  onBack,
}: MobileToolbarContentProps) {
  return (
    <>
      <ToolbarGroup>
        <ToolbarButton onClick={onBack} size="sm">
          <ArrowLeftIcon />
          {type === "highlighter" ? <HighlighterIcon /> : <LinkIcon />}
        </ToolbarButton>
      </ToolbarGroup>

      <ToolbarSeparator />

      {type === "highlighter" ? (
        <ColorHighlightPopoverContent />
      ) : (
        <LinkContent />
      )}
    </>
  );
}
