"use client";

import { ThemeToggle } from "@/components/document-editor/theme-toggle";
import { BlockquoteButton } from "@/components/tiptap-ui/blockquote-button";
import { CodeBlockButton } from "@/components/tiptap-ui/code-block-button";
import {
  ColorHighlightPopover,
  ColorHighlightPopoverButton,
} from "@/components/tiptap-ui/color-highlight-popover";
import { HeadingDropdownMenu } from "@/components/tiptap-ui/heading-dropdown-menu";
import { FilterToolbarButton } from "@/components/tiptap-ui/heading-filter";
import { HyperlinkButton } from "@/components/tiptap-ui/hyperlink-button";
import { ImageUploadButton } from "@/components/tiptap-ui/image-upload-button";
import { IndentButton } from "@/components/tiptap-ui/indent-button";
import { ListDropdownMenu } from "@/components/tiptap-ui/list-dropdown-menu";
import { MarkButton } from "@/components/tiptap-ui/mark-button";
import { MediaEmbedPopover } from "@/components/tiptap-ui/media-embed-popover";
import { MermaidButton } from "@/components/tiptap-ui/mermaid-button";
import { TextAlignButton } from "@/components/tiptap-ui/text-align-button";
import { UndoRedoButton } from "@/components/tiptap-ui/undo-redo-button";
import { Spacer } from "@/components/ui/spacer";
import { ToolbarGroup, ToolbarSeparator } from "@/components/ui/toolbar";
import { ToolbarButton } from "@/components/ui/toolbar-button";
import { PanelLeftIcon } from "@/lib/icons";

interface MainToolbarContentProps {
  onHighlighterClick: () => void;
  onTocToggle: () => void;
  onFilterToggle: () => void;
  isMobile: boolean;
  tocVisible: boolean;
  filterActive: boolean;
}

export function MainToolbarContent({
  onHighlighterClick,
  onTocToggle,
  onFilterToggle,
  isMobile,
  tocVisible,
  filterActive,
}: MainToolbarContentProps) {
  return (
    <>
      {!isMobile && (
        <ToolbarGroup>
          <ToolbarButton
            onClick={onTocToggle}
            aria-label="Toggle outline"
            tooltip="Toggle outline"
            isActive={tocVisible}
          >
            <PanelLeftIcon />
          </ToolbarButton>
          <FilterToolbarButton
            onClick={onFilterToggle}
            isActive={filterActive}
          />
        </ToolbarGroup>
      )}

      <Spacer />

      <ToolbarGroup>
        <UndoRedoButton action="undo" />
        <UndoRedoButton action="redo" />
      </ToolbarGroup>

      <ToolbarSeparator />

      <ToolbarGroup>
        <HeadingDropdownMenu levels={[1, 2, 3, 4, 5, 6]} />
        <ListDropdownMenu types={["bulletList", "orderedList", "taskList"]} />
        <BlockquoteButton />
        <CodeBlockButton />
        <MermaidButton />
      </ToolbarGroup>

      <ToolbarSeparator />

      <ToolbarGroup>
        <MarkButton type="bold" />
        <MarkButton type="italic" />
        <MarkButton type="strike" />
        <MarkButton type="inlineCode" />
        <MarkButton type="underline" />
        {!isMobile ? (
          <ColorHighlightPopover />
        ) : (
          <ColorHighlightPopoverButton onClick={onHighlighterClick} />
        )}
        <HyperlinkButton />
      </ToolbarGroup>

      <ToolbarSeparator />

      <ToolbarGroup>
        <MarkButton type="superscript" />
        <MarkButton type="subscript" />
      </ToolbarGroup>

      <ToolbarSeparator />

      <ToolbarGroup>
        <TextAlignButton align="left" />
        <TextAlignButton align="center" />
        <TextAlignButton align="right" />
        <TextAlignButton align="justify" />
      </ToolbarGroup>

      <ToolbarSeparator />

      <ToolbarGroup>
        <IndentButton action="outdent" />
        <IndentButton action="indent" />
      </ToolbarGroup>

      <ToolbarSeparator />

      <ToolbarGroup>
        <ImageUploadButton text="Add" size="sm" />
        <MediaEmbedPopover />
      </ToolbarGroup>

      <Spacer />

      {isMobile && <ToolbarSeparator />}

      <ToolbarGroup>
        <ThemeToggle />
      </ToolbarGroup>
    </>
  );
}
