import { Hyperlink } from "@docs.plus/extension-hyperlink";
import { HyperMultimediaKit } from "@docs.plus/extension-hypermultimedia";
import { InlineCode } from "@docs.plus/extension-inline-code";
import { type AnyExtension, Node } from "@tiptap/core";
import { Code } from "@tiptap/extension-code";
import { CodeBlock } from "@tiptap/extension-code-block";
import { Heading } from "@tiptap/extension-heading";
import { HorizontalRule } from "@tiptap/extension-horizontal-rule";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Subscript } from "@tiptap/extension-subscript";
import { Superscript } from "@tiptap/extension-superscript";
import { Table, TableKit } from "@tiptap/extension-table";
import { TextAlign } from "@tiptap/extension-text-align";
import { UniqueID } from "@tiptap/extension-unique-id";
import { StarterKit } from "@tiptap/starter-kit";

import { FastTableOfContents } from "@/extensions/table-of-contents/fast-table-of-contents";
import { FontSize, TextColor } from "@/extensions/text-style-marks";
import { TitleDocument } from "@/extensions/title-document";
import { TokenHighlight } from "@/extensions/token-highlight";

/** Same gate as `lib/code-language.ts`, which imports the editor's action modules. */
const SAFE_CODE_LANGUAGE = /^[A-Za-z0-9_+#.-]{1,40}$/;

function sanitizeCodeLanguage(value: unknown): string | null {
  return typeof value === "string" && SAFE_CODE_LANGUAGE.test(value)
    ? value
    : null;
}

/** First word of a fence info string (```` ```ts title="a.ts" ````). */
function languageFromInfoString(info: unknown): string | null {
  if (typeof info !== "string") return null;
  return sanitizeCodeLanguage(info.trim().split(/\s+/, 1)[0]);
}

/**
 * The editor's `SafeCodeBlock` (components/document-editor/safe-code-block.ts)
 * without lowlight: the same `language` attribute and the same gate on
 * Markdown parse and render. The editor's version adds only highlighting
 * plugins and `renderHTML`, which need a view.
 */
const HeadlessCodeBlock = CodeBlock.extend({
  addAttributes() {
    return {
      language: {
        default: sanitizeCodeLanguage(this.options.defaultLanguage),
        parseHTML: (element: HTMLElement) => {
          const { languageClassPrefix } = this.options;
          if (!languageClassPrefix) return null;
          const className = Array.from(
            element.firstElementChild?.classList ?? [],
          ).find((name) => name.startsWith(languageClassPrefix));
          return sanitizeCodeLanguage(
            className?.slice(languageClassPrefix.length),
          );
        },
        rendered: false,
      },
    };
  },

  parseMarkdown(token, helpers) {
    return (
      this.parent?.(
        { ...token, lang: languageFromInfoString(token.lang) },
        helpers,
      ) ?? []
    );
  },

  // The stock renderer always fences with three backticks, so code holding
  // a ``` line ends the block early. The fence here is longer than any
  // backtick run in the code.
  renderMarkdown(node, helpers) {
    const language = sanitizeCodeLanguage(node.attrs?.language) ?? "";
    const code = node.content ? helpers.renderChildren(node.content) : "";
    const longest = Math.max(
      0,
      ...(code.match(/`+/g) ?? []).map((run) => run.length),
    );
    const fence = "`".repeat(Math.max(3, longest + 1));
    return `${fence}${language}\n${code}\n${fence}`;
  },
});

/** Block syntax a paragraph line must not start with (CommonMark §4–5). */
const BLOCK_START =
  /^(#{1,6}(?=[ \t]|$)|>|[-+*](?=[ \t]|$)|\d{1,9}[.)](?=[ \t]|$)|=+[ \t]*$|([-*_])(?:[ \t]*\2){2,}[ \t]*$)/;

/**
 * A paragraph's Markdown with each line made safe to parse back as text:
 * leading spaces and tabs become character references (CommonMark strips
 * them, and four make an indented code block), and a leading block marker
 * (`# `, `- `, `1. `, `>`, `---`, `===`) is backslash-escaped.
 */
export function escapeParagraphLines(markdown: string): string {
  return markdown
    .split("\n")
    .map((line) => {
      const indent = /^[ \t]*/.exec(line)?.[0] ?? "";
      const rest = line.slice(indent.length);
      const safeIndent = indent.replace(/ /g, "&#32;").replace(/\t/g, "&#9;");
      if (!BLOCK_START.test(rest)) return safeIndent + rest;
      // An ordered-list marker is escaped at its `.` or `)`.
      const ordered = /^(\d{1,9})([.)])/.exec(rest);
      return ordered
        ? `${safeIndent}${ordered[1]}\\${ordered[2]}${rest.slice(ordered[0].length)}`
        : `${safeIndent}\\${rest}`;
    })
    .join("\n");
}

const HeadlessParagraph = Paragraph.extend({
  renderMarkdown(node, helpers, context) {
    return escapeParagraphLines(this.parent?.(node, helpers, context) ?? "");
  },
});

/**
 * A heading ending in ` #` would lose those characters: Markdown reads them
 * as an optional closing sequence.
 */
const HeadlessHeading = Heading.extend({
  renderMarkdown(node, helpers, context) {
    return (this.parent?.(node, helpers, context) ?? "").replace(
      /([ \t])(#+)([ \t]*)$/,
      "$1\\$2$3",
    );
  },
});

/**
 * The stock table renderer starts and ends with a newline; at the end of a
 * document that newline reads back as an extra empty paragraph.
 */
const HeadlessTable = Table.extend({
  renderMarkdown(node, helpers, context) {
    return (this.parent?.(node, helpers, context) ?? "").replace(
      /^\n+|\n+$/g,
      "",
    );
  },
});

/**
 * `@docs.plus` inline code wraps its text in single backticks, so a
 * backtick inside ends the span. Tiptap's own code mark picks a fence the
 * text does not contain.
 */
const HeadlessInlineCode = InlineCode.extend({
  renderMarkdown: Code.config.renderMarkdown,
});

/**
 * The editor's upload placeholder without its React node view. It exists
 * only while an image uploads, but a document saved meanwhile holds it, so
 * the schema must know it. Markdown drops it.
 */
const HeadlessImageUpload = Node.create({
  name: "imageUpload",
  group: "block",
  draggable: true,
  selectable: true,
  atom: true,

  addAttributes() {
    return {
      accept: { default: "image/*" },
      limit: { default: 1 },
      maxSize: { default: 0 },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="image-upload"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", { "data-type": "image-upload", ...HTMLAttributes }];
  },

  renderMarkdown: () => "",
});

/**
 * Title-first root (`heading block*`). `TitleDocument` replaces StarterKit's
 * `Document`, whose Markdown renderer joins the blocks; without it the
 * blocks run together.
 */
const HeadlessTitleDocument = TitleDocument.extend({
  renderMarkdown: (node, helpers) =>
    node.content ? helpers.renderChildren(node.content, "\n\n") : "",
});

/**
 * Superscript and subscript have no Markdown form; HTML keeps them in GFM
 * renderers, and the import path's HTML step parses them back.
 */
const HeadlessSuperscript = Superscript.extend({
  renderMarkdown: (node, helpers) =>
    `<sup>${helpers.renderChildren(node.content ?? [])}</sup>`,
});

const HeadlessSubscript = Subscript.extend({
  renderMarkdown: (node, helpers) =>
    `<sub>${helpers.renderChildren(node.content ?? [])}</sub>`,
});

/**
 * The editor's schema, from the extensions in
 * `buildDocumentEditorExtensions` that define nodes, marks or attributes,
 * with no view, DOM, React or collaboration plugins. Order matches the
 * editor's, so mark ranks (and Markdown mark nesting) match too. The
 * headless schema test compares the result with the editor's schema.
 */
export function buildHeadlessSchemaExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({
      document: false,
      horizontalRule: false,
      undoRedo: false,
      codeBlock: false,
      link: false,
      code: false,
      trailingNode: false,
      dropcursor: false,
      gapcursor: false,
      // Replaced below by versions that escape their Markdown.
      paragraph: false,
      heading: false,
    }),
    HeadlessParagraph,
    HeadlessHeading,
    Hyperlink.configure({
      HTMLAttributes: {
        target: null,
        rel: "noopener noreferrer nofollow ugc",
        class: null,
      },
    }),
    HeadlessInlineCode,
    HeadlessCodeBlock,
    HeadlessTitleDocument,
    HorizontalRule,
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TokenHighlight.configure({ multicolor: true }),
    HyperMultimediaKit,
    HeadlessSuperscript,
    HeadlessSubscript,
    UniqueID.configure({ types: ["heading"] }),
    FastTableOfContents,
    HeadlessImageUpload,
    HeadlessTable,
    TableKit.configure({ table: false }),
    TextColor,
    FontSize,
  ];
}
