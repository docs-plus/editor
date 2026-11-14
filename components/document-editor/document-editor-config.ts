"use client";

import {
  createHyperlinkPopover,
  editHyperlinkPopover,
  Hyperlink,
  previewHyperlinkPopover,
} from "@docs.plus/extension-hyperlink";
import {
  HyperMultimediaKit,
  isMediaUrl,
} from "@docs.plus/extension-hypermultimedia";
import { Indent } from "@docs.plus/extension-indent";
import { InlineCode } from "@docs.plus/extension-inline-code";
import { Mermaid } from "@docs.plus/extension-mermaid";
import {
  Placeholder,
  type PlaceholderRenderProps,
} from "@docs.plus/extension-placeholder";
import type { HocuspocusProvider } from "@hocuspocus/provider";
import type { JSONContent } from "@tiptap/core";
import { CollaborationCaret } from "@tiptap/extension-collaboration-caret";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Subscript } from "@tiptap/extension-subscript";
import { Superscript } from "@tiptap/extension-superscript";
import { TableKit } from "@tiptap/extension-table";
import type { TableOfContentData } from "@tiptap/extension-table-of-contents";
import { TextAlign } from "@tiptap/extension-text-align";
import { Typography } from "@tiptap/extension-typography";
import { UniqueID } from "@tiptap/extension-unique-id";
import { Selection } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { StarterKit } from "@tiptap/starter-kit";
import DOMPurify from "dompurify";
import { Marked, type marked } from "marked";
import type * as Y from "yjs";

import { HorizontalRule } from "@/components/tiptap-node/horizontal-rule-node/horizontal-rule-node-extension";
import { ImageUploadNode } from "@/components/tiptap-node/image-upload-node/image-upload-node-extension";
import {
  handleImageUpload,
  IMAGE_UPLOAD_LIMIT,
  MAX_FILE_SIZE,
} from "@/components/tiptap-node/image-upload-node/upload-utils";
import { EditorActionShortcuts } from "@/extensions/editor-action-shortcuts";
import { HeadingDrag } from "@/extensions/heading-drag";
import {
  HeadingFilter,
  type HeadingFilterCallbackState,
} from "@/extensions/heading-filter";
import { HeadingFold, headingFoldPluginKey } from "@/extensions/heading-fold";
import { HeadingScale } from "@/extensions/heading-scale";
import {
  CaretBlockVisible,
  CollaborationRenderOnce,
  NodeViewsRenderOnce,
} from "@/extensions/render-once";
import { RepeatFormatting } from "@/extensions/repeat-formatting";
import { SlashTrigger } from "@/extensions/slash-trigger/slash-trigger";
import { FastTableOfContents } from "@/extensions/table-of-contents";
import { FontSize, TextColor } from "@/extensions/text-style-marks";
import { TitleDocument } from "@/extensions/title-document";
import { TokenHighlight } from "@/extensions/token-highlight";
import { lowlight } from "@/lib/lowlight";

import { SafeCodeBlock } from "./safe-code-block";

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

function getPlaceholderText({
  node,
  pos,
  parentName,
}: PlaceholderRenderProps): string {
  if (node.type.name === "heading" && pos === 0) return "Enter document name";
  if (node.type.name === "paragraph" && parentName in PARENT_PLACEHOLDER) {
    return PARENT_PLACEHOLDER[parentName];
  }
  return PLACEHOLDER_TEXT[node.type.name] ?? "";
}

/**
 * Diagram sources are written by any collaborator, so every Mermaid SVG is
 * sanitized before it enters the page. Profile per the extension's security
 * guide: keeps ids, inline styles, roles and ARIA names; drops links, images,
 * `<use>` and `<style>` so a source cannot fetch URLs or restyle the page.
 */
function sanitizeMermaidSvg(svg: string): Node {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true },
    ADD_ATTR: ["role"],
    FORBID_TAGS: ["style", "a", "image", "use"],
    FORBID_ATTR: ["href", "xlink:href"],
    RETURN_DOM_FRAGMENT: true,
  });
}

/**
 * A marked instance for one editor's `Markdown` extension. With the
 * module-wide default, every editor adds its tokenizers to `marked` and stays
 * reachable after destroy. The option is typed as that default; the extension
 * only uses `Lexer`, `lexer`, `defaults`, `use` and `setOptions`, which a
 * `Marked` instance has.
 */
function createMarkedInstance(): typeof marked {
  return new Marked() as unknown as typeof marked;
}

interface BuildDocumentEditorExtensionsOptions {
  documentId: string;
  ydoc: Y.Doc;
  provider: HocuspocusProvider;
  onFoldChange: (foldedIds: Set<string>) => void;
  onFilterChange: (state: HeadingFilterCallbackState) => void;
  onTocUpdate: (anchors: TableOfContentData) => void;
  /**
   * Called when the shared document stops fitting the schema (the editor
   * freezes). Runs inside the sync binding: record only, never write.
   */
  onInvalidContent?: (error: Error) => void;
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
  onInvalidContent,
}: BuildDocumentEditorExtensionsOptions) {
  return [
    StarterKit.configure({
      document: false,
      horizontalRule: false,
      undoRedo: false,
      codeBlock: false,
      // Replaced by @docs.plus Hyperlink / InlineCode; both claim the same
      // tags and command names, so the StarterKit marks must stay off.
      link: false,
      code: false,
      // TitleDocument's content is `heading block*`, so the schema's default
      // top-level type is `heading`; pin the trailing node to a paragraph.
      trailingNode: { node: "paragraph" },
    }),
    Hyperlink.configure({
      popovers: {
        previewHyperlink: previewHyperlinkPopover,
        editHyperlink: editHyperlinkPopover,
        createHyperlink: createHyperlinkPopover,
      },
      // Let pasted media URLs become embeds instead of plain links.
      shouldAutoLink: (url) => !isMediaUrl(url),
      // Public sandbox: links are user-generated content.
      HTMLAttributes: {
        target: null,
        rel: "noopener noreferrer nofollow ugc",
        class: null,
      },
    }),
    InlineCode,
    SafeCodeBlock.configure({ lowlight }),
    Mermaid.configure({ sanitize: sanitizeMermaidSvg }),
    Indent,
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
    CollaborationRenderOnce.configure({
      document: ydoc,
      ...(onInvalidContent ? { ySyncOptions: { onInvalidContent } } : {}),
    }),
    NodeViewsRenderOnce,
    CaretBlockVisible,
    RepeatFormatting,
    SlashTrigger,
    CollaborationCaret.configure({
      provider,
    }),
    HorizontalRule,
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TokenHighlight.configure({ multicolor: true }),
    HyperMultimediaKit,
    Typography,
    Superscript,
    Subscript,
    Selection,
    Placeholder.configure({ placeholder: getPlaceholderText }),
    UniqueID.configure({
      types: ["heading"],
    }),
    FastTableOfContents.configure({
      onUpdate: onTocUpdate,
      scrollParent: () =>
        (document.querySelector(".document-editor-wrapper") as HTMLElement) ??
        window,
    }),
    ImageUploadNode.configure({
      accept: "image/*",
      maxSize: MAX_FILE_SIZE,
      limit: IMAGE_UPLOAD_LIMIT,
      upload: handleImageUpload,
      onError: (error) => console.error("Upload failed:", error),
    }),
    TableKit.configure({ table: { resizable: true } }),
    Markdown.configure({ marked: createMarkedInstance() }),
    // After every existing mark, so their ranks stay put (spec §3).
    TextColor,
    FontSize,
    EditorActionShortcuts,
  ];
}
