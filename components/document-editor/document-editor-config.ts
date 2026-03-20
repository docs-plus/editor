"use client";

import type { HocuspocusProvider } from "@hocuspocus/provider";
import type { JSONContent } from "@tiptap/core";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { Collaboration } from "@tiptap/extension-collaboration";
import { CollaborationCaret } from "@tiptap/extension-collaboration-caret";
import { Highlight } from "@tiptap/extension-highlight";
import { Image } from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Subscript } from "@tiptap/extension-subscript";
import { Superscript } from "@tiptap/extension-superscript";
import { TableKit } from "@tiptap/extension-table";
import {
  type TableOfContentData,
  TableOfContents,
} from "@tiptap/extension-table-of-contents";
import { TextAlign } from "@tiptap/extension-text-align";
import { Typography } from "@tiptap/extension-typography";
import { UniqueID } from "@tiptap/extension-unique-id";
import { Placeholder, Selection } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { StarterKit } from "@tiptap/starter-kit";
import type * as Y from "yjs";

import { HorizontalRule } from "@/components/tiptap-node/horizontal-rule-node/horizontal-rule-node-extension";
import { ImageUploadNode } from "@/components/tiptap-node/image-upload-node/image-upload-node-extension";
import {
  handleImageUpload,
  MAX_FILE_SIZE,
} from "@/components/tiptap-node/image-upload-node/upload-utils";
import { HeadingDrag } from "@/extensions/heading-drag";
import {
  HeadingFilter,
  type HeadingFilterCallbackState,
} from "@/extensions/heading-filter";
import { HeadingFold, headingFoldPluginKey } from "@/extensions/heading-fold";
import { HeadingScale } from "@/extensions/heading-scale";
import { TitleDocument } from "@/extensions/title-document";
import { lowlight } from "@/lib/lowlight";

/** Minimal valid doc per TitleDocument schema (H1 + body). */
export const DEFAULT_EDITOR_CONTENT = {
  type: "doc",
  content: [{ type: "heading", attrs: { level: 1 } }, { type: "paragraph" }],
} satisfies JSONContent;

const PLACEHOLDER_TEXT: Record<string, string> = {
  heading: "Heading",
  paragraph: "Type something...",
  codeBlock: "Write code...",
};

const PARENT_PLACEHOLDER: Record<string, string> = {
  listItem: "List",
  taskItem: "To-do",
  blockquote: "Quote",
};

interface BuildDocumentEditorExtensionsOptions {
  documentId: string;
  ydoc: Y.Doc;
  provider: HocuspocusProvider;
  onFoldChange: (foldedIds: Set<string>) => void;
  onFilterChange: (state: HeadingFilterCallbackState) => void;
  onTocUpdate: (anchors: TableOfContentData) => void;
}

function createHeadingFilterFoldAdapter() {
  return {
    getFoldedIds: (state: EditorState) =>
      headingFoldPluginKey.getState(state)?.foldedIds ?? new Set(),
    setTemporaryFolds: (tr: Transaction, ids: Set<string>) =>
      tr.setMeta(headingFoldPluginKey, {
        type: "set",
        ids,
        persist: false,
      }),
    restoreFolds: (tr: Transaction, savedIds: Set<string>) =>
      tr.setMeta(headingFoldPluginKey, {
        type: "set",
        ids: savedIds,
        persist: true,
      }),
  };
}

export function buildDocumentEditorExtensions({
  documentId,
  ydoc,
  provider,
  onFoldChange,
  onFilterChange,
  onTocUpdate,
}: BuildDocumentEditorExtensionsOptions) {
  return [
    StarterKit.configure({
      document: false,
      horizontalRule: false,
      undoRedo: false,
      codeBlock: false,
      link: {
        openOnClick: false,
        enableClickSelection: true,
      },
    }),
    CodeBlockLowlight.configure({ lowlight }),
    TitleDocument,
    HeadingScale,
    HeadingDrag,
    HeadingFold.configure({
      documentId,
      onFoldChange,
    }),
    HeadingFilter.configure({
      onFilterChange,
      foldAdapter: createHeadingFilterFoldAdapter(),
    }),
    Collaboration.configure({
      document: ydoc,
    }),
    CollaborationCaret.configure({
      provider,
    }),
    HorizontalRule,
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Highlight.configure({ multicolor: true }),
    Image,
    Typography,
    Superscript,
    Subscript,
    Selection,
    Placeholder.configure({
      showOnlyCurrent: true,
      includeChildren: true,
      placeholder: ({ editor, node, pos }) => {
        if (node.type.name === "heading" && pos === 0) {
          return "Enter document name";
        }
        if (node.type.name === "paragraph") {
          const parent = editor.state.doc.resolve(pos).parent.type.name;
          if (parent in PARENT_PLACEHOLDER) return PARENT_PLACEHOLDER[parent];
        }
        return PLACEHOLDER_TEXT[node.type.name] ?? "";
      },
    }),
    UniqueID.configure({
      types: ["heading"],
    }),
    TableOfContents.configure({
      onUpdate: onTocUpdate,
      scrollParent: () =>
        (document.querySelector(".document-editor-wrapper") as HTMLElement) ??
        window,
    }),
    ImageUploadNode.configure({
      accept: "image/*",
      maxSize: MAX_FILE_SIZE,
      limit: 3,
      upload: handleImageUpload,
      onError: (error) => console.error("Upload failed:", error),
    }),
    TableKit.configure({ table: { resizable: true } }),
    Markdown,
  ];
}
