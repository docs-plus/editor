import type { Extension, JSONContent } from "@tiptap/core";
import { Editor } from "@tiptap/core";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { Highlight } from "@tiptap/extension-highlight";
import { HorizontalRule } from "@tiptap/extension-horizontal-rule";
import { Image } from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { TableOfContents } from "@tiptap/extension-table-of-contents";
import { TextAlign } from "@tiptap/extension-text-align";
import { UniqueID } from "@tiptap/extension-unique-id";
import { StarterKit } from "@tiptap/starter-kit";

import { TitleDocument } from "@/components/tiptap-node/document-node/document-node-extension";
import { HeadingFilter } from "@/components/tiptap-node/heading-node/heading-filter-extension";
import { HeadingFold } from "@/components/tiptap-node/heading-node/heading-fold-extension";
import { HeadingScale } from "@/components/tiptap-node/heading-node/heading-scale-extension";
import { lowlight } from "@/lib/lowlight";

export const DEFAULT_EXTENSIONS = [
  StarterKit.configure({
    document: false,
    horizontalRule: false,
    codeBlock: false,
  }),
  CodeBlockLowlight.configure({ lowlight }),
  TitleDocument,
  TableOfContents,
  HeadingScale,
  HeadingFold.configure({ documentId: "test" }),
  HeadingFilter,
  HorizontalRule,
  TextAlign.configure({ types: ["heading", "paragraph"] }),
  Highlight.configure({ multicolor: true }),
  Image,
  TaskList,
  TaskItem.configure({ nested: true }),
  TableKit,
  UniqueID.configure({ types: ["heading"] }),
] as Extension[];

export interface CreateTestEditorOptions {
  content?: JSONContent;
  extensions?: Extension[];
}

/**
 * Factory for creating a headless Tiptap Editor for unit tests.
 * Uses the TinyDocy extension chain minus DOM-dependent features
 * (HeadingDrag, Collaboration, Placeholder, etc.).
 */
export function createTestEditor(
  options: CreateTestEditorOptions = {},
): Editor {
  const { content, extensions = DEFAULT_EXTENSIONS } = options;
  const element =
    typeof document !== "undefined" ? document.createElement("div") : null;
  return new Editor({
    element,
    content,
    extensions,
  });
}
