"use client";

import {
  createHyperlinkPopover,
  editHyperlinkPopover,
  Hyperlink,
  type HyperlinkOptions,
  previewHyperlinkPopover,
} from "@docs.plus/extension-hyperlink";
import { isMediaUrl } from "@docs.plus/extension-hypermultimedia";
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
import { UniqueID } from "@tiptap/extension-unique-id";
import { Selection } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import type { TagParseRule } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { StarterKit } from "@tiptap/starter-kit";
import DOMPurify from "dompurify";
import { Marked, type marked } from "marked";
import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";

import { HorizontalRule } from "@/components/tiptap-node/horizontal-rule-node/horizontal-rule-node-extension";
import { ImageUploadNode } from "@/components/tiptap-node/image-upload-node/image-upload-node-extension";
import {
  handleImageUpload,
  IMAGE_UPLOAD_LIMIT,
  MAX_FILE_SIZE,
} from "@/components/tiptap-node/image-upload-node/upload-utils";
import { ActionPreview } from "@/extensions/action-preview";
import {
  renderCaret,
  renderCaretSelection,
} from "@/extensions/collaboration-caret/safe-caret-render";
import { DecorationHost } from "@/extensions/decoration-host/decoration-host";
import { EditorActionShortcuts } from "@/extensions/editor-action-shortcuts";
import { HeadingDrag } from "@/extensions/heading-drag";
import {
  HeadingFilter,
  type HeadingFilterCallbackState,
} from "@/extensions/heading-filter";
import { HeadingFold, headingFoldPluginKey } from "@/extensions/heading-fold";
import { HeadingScale } from "@/extensions/heading-scale";
import { HyperMultimediaKit } from "@/extensions/hyper-multimedia/hyper-multimedia-kit";
import {
  CaretBlockVisible,
  CollaborationRenderOnce,
  NodeViewsRenderOnce,
} from "@/extensions/render-once";
import { RepeatFormatting } from "@/extensions/repeat-formatting";
import { SlashTrigger } from "@/extensions/slash-trigger/slash-trigger";
import { SmartTypography } from "@/extensions/smart-typography/smart-typography";
import { FastTableOfContents } from "@/extensions/table-of-contents";
import { FontSize, TextColor } from "@/extensions/text-style-marks";
import { TitleDocument } from "@/extensions/title-document";
import { TokenHighlight } from "@/extensions/token-highlight";
import { WriteGate } from "@/extensions/write-gate/write-gate";
import { SUBSCRIPT_SHORTCUT } from "@/lib/app-shortcuts";
import type { LinkHost } from "@/lib/links/link-host-types";
import { lowlight } from "@/lib/lowlight";
import { isWebLink } from "@/lib/web-link";

import { SafeCodeBlock } from "./safe-code-block";

/** Minimal valid doc per TitleDocument schema (H1 + body). */
export const DEFAULT_EDITOR_CONTENT = {
  type: "doc",
  content: [{ type: "heading", attrs: { level: 1 } }, { type: "paragraph" }],
} satisfies JSONContent;

/**
 * Subscript on the key this build advertises (`SUBSCRIPT_SHORTCUT`): ⌘, on
 * the web, ⌘⇧, on desktop, where ⌘, opens Settings. `extend` replaces the
 * parent's `Mod-,` binding.
 */
const SubscriptByTarget = Subscript.extend({
  addKeyboardShortcuts() {
    return {
      [SUBSCRIPT_SHORTCUT]: () => this.editor.commands.toggleSubscript(),
    };
  },
});

/**
 * The editor's link policy is `isWebLink` (`lib/web-link.ts`). It is
 * `isAllowedUri`, the one policy for commands, autolink and paste rules;
 * `LinkPolicyHyperlink` applies the same option to HTML paste and to
 * rendering, so a host that passes its own `isAllowedUri` replaces it at
 * all three. Parse and render call it with one string and no context (a
 * missing href arrives as "undefined" or "null"), so a host policy must not
 * need one.
 */
export { isWebLink };

/** The one protocol check for parse and render: the policy on any value. */
const allows = (options: HyperlinkOptions, href: unknown) =>
  (options.isAllowedUri as (href: string) => boolean)(`${href}`);

/**
 * Hyperlink with `isAllowedUri` also applied where the extension skips it:
 * pasted `<a href>` off the policy loses its mark (the text stays), and a
 * stored one (Yjs, older documents) renders with no `href` at all, so
 * neither a click nor the browser's own middle-click or "Open link" can
 * follow it. Pasted titles are dropped: a `title` is a tooltip a stranger
 * chose ("Your bank: click to verify"). Kept terse: it is editor-chunk bytes.
 */
export const LinkPolicyHyperlink = Hyperlink.extend({
  addAttributes() {
    return { ...this.parent?.(), title: { parseHTML: () => null } };
  },

  parseHTML() {
    // The parent's rules are `.hyperlink-icon` (ignored) then `a[href]`.
    const rules = this.parent?.() as Required<TagParseRule>[];
    const { getAttrs } = rules[1];
    rules[1].getAttrs = (node) =>
      allows(this.options, node.getAttribute("href")) && getAttrs(node);
    return rules;
  },

  renderHTML(props) {
    // The parent blanks an unsafe href to ""; a null href off the policy is
    // not rendered at all (ProseMirror skips null attributes), so the
    // anchor is not a link.
    const spec = this.parent?.(props) as [string, Record<string, unknown>, 0];
    if (!allows(this.options, spec[1].href)) spec[1].href = null;
    return spec;
  },
});

const PLACEHOLDER_TEXT: Record<string, string> = {
  heading: "Heading",
  paragraph: "Type / for blocks",
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
  /**
   * The session's one Awareness. It outlives any provider, so attaching or
   * detaching one never rebuilds the extensions (no `setOptions`).
   */
  awareness: Awareness;
  /** The provider of the moment, if any; read, never a dependency. */
  getProvider: () => HocuspocusProvider | null;
  /** WriteGate's check: false blocks every local document change. */
  canWrite: () => boolean;
  onFoldChange: (foldedIds: Set<string>) => void;
  onFilterChange: (state: HeadingFilterCallbackState) => void;
  onTocUpdate: (anchors: TableOfContentData) => void;
  /**
   * Called when the shared document stops fitting the schema (the editor
   * freezes). Runs inside the sync binding: record only, never write.
   */
  onInvalidContent?: (error: Error) => void;
  /**
   * Document links (search-linking §4.1): the host's Hyperlink options for
   * `tinydocy:` (isAllowedUri, navigate, linkIcon, popovers). Passed
   * through as they are; the web sandbox passes none.
   */
  linkHost?: LinkHost;
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
  awareness,
  getProvider,
  canWrite,
  onFoldChange,
  onFilterChange,
  onTocUpdate,
  onInvalidContent,
  linkHost,
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
    LinkPolicyHyperlink.configure({
      popovers: {
        previewHyperlink: previewHyperlinkPopover,
        editHyperlink: editHyperlinkPopover,
        createHyperlink: createHyperlinkPopover,
      },
      // Let pasted media URLs become embeds instead of plain links.
      shouldAutoLink: (url) => !isMediaUrl(url),
      isAllowedUri: isWebLink,
      // Public sandbox: links are user-generated content.
      HTMLAttributes: {
        target: null,
        rel: "noopener noreferrer nofollow ugc",
        class: null,
      },
      ...linkHost,
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
    // The caret reads only `provider.awareness` (3.x runtime), so it gets
    // the session's Awareness and works with no provider at all. UniqueID
    // finds this option too and waits for its "synced" event: forwarded to
    // the provider of the moment, as before (none on desktop Local).
    CollaborationCaret.configure({
      provider: {
        awareness,
        on: (event: string, fn: () => void) => getProvider()?.on(event, fn),
        off: (event: string, fn: () => void) => getProvider()?.off(event, fn),
      },
      render: renderCaret,
      selectionRender: renderCaretSelection,
    }),
    WriteGate.configure({ canWrite }),
    // Comment highlights and Find hits declare their layers here (rule 6).
    // Comments map their set through edits (comments design §8).
    DecorationHost.configure({ layers: [{ name: "comments", map: true }] }),
    HorizontalRule,
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TokenHighlight.configure({ multicolor: true }),
    HyperMultimediaKit,
    SmartTypography,
    Superscript,
    SubscriptByTarget,
    Selection,
    // Colour swatch previews: decorations only, never the doc (hover preview).
    ActionPreview,
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
