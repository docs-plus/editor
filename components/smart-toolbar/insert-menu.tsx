"use client";

import { BlockquoteButton } from "@/components/tiptap-ui/blockquote-button";
import { CodeBlockButton } from "@/components/tiptap-ui/code-block-button";
import { ImageUploadButton } from "@/components/tiptap-ui/image-upload-button";
import { MediaEmbedPopover } from "@/components/tiptap-ui/media-embed-popover";
import { MermaidButton } from "@/components/tiptap-ui/mermaid-button";

import type { SurfaceProps } from "./types";

/**
 * `+ Insert ▾`: image, embed, table, quote, code, diagram, divider; lists
 * every registry action in group `insert` (E adds templates that way);
 * M10 face, M17a table grid. PR D2 owns. SKELETON: today's buttons so the
 * row keeps every insert after D1 removes them from the row.
 */
export function InsertMenu({ editor }: SurfaceProps) {
  return (
    <>
      <BlockquoteButton editor={editor} />
      <CodeBlockButton editor={editor} />
      <MermaidButton editor={editor} />
      <ImageUploadButton editor={editor} text="Add" size="sm" />
      <MediaEmbedPopover editor={editor} />
    </>
  );
}
