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

import { HeadingFilter } from "@/extensions/heading-filter";
import { HeadingFold, headingFoldPluginKey } from "@/extensions/heading-fold";
import { HeadingScale } from "@/extensions/heading-scale";
import { TitleDocument } from "@/extensions/title-document";
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
  HeadingFilter.configure({
    foldAdapter: {
      getFoldedIds: (state) =>
        headingFoldPluginKey.getState(state)?.foldedIds ?? new Set(),
      setTemporaryFolds: (tr, ids) =>
        tr.setMeta(headingFoldPluginKey, {
          type: "set",
          ids,
          persist: false,
        }),
      restoreFolds: (tr, savedIds) =>
        tr.setMeta(headingFoldPluginKey, {
          type: "set",
          ids: savedIds,
          persist: true,
        }),
    },
  }),
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
