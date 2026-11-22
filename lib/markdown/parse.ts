/**
 * Markdown to editor content: the Markdown paste rule (details spec E2,
 * P2.12) and the import engine (IM1) share it. Pure: no DOM, no editor,
 * no schema of its own. The caller passes the parser (the editor's
 * `editor.markdown`, or a headless `MarkdownManager` built from the
 * headless schema's extensions), the schema to check against and the
 * ProseMirror model classes (`MarkdownModel`).
 */
import type { JSONContent } from "@tiptap/core";
import type { Fragment, Schema, Slice } from "@tiptap/pm/model";

/**
 * `Fragment` and `Slice` from `@tiptap/pm/model`, passed in rather than
 * imported: the paste rule is a lazy chunk of the editor, and a lazy chunk
 * that imports a module the editor's chunk group also loads splits that
 * group (about +1 KB gz, measured). Headless callers pass the same two.
 */
export interface MarkdownModel {
  Fragment: typeof Fragment;
  Slice: typeof Slice;
}

/** `editor.markdown`, or `new MarkdownManager({ extensions })` headless. */
export interface MarkdownParser {
  parse(markdown: string): JSONContent;
}

/** A marked token, as far as the raw HTML check reads it. */
interface MarkdownToken {
  type: string;
  block?: boolean;
  tokens?: MarkdownToken[];
  items?: MarkdownToken[];
}

/**
 * The paste rule's parser: `editor.markdown` (or a headless
 * `MarkdownManager`), whose `instance` is the marked instance it parses
 * with, so the rule can look for raw HTML blocks first.
 */
export interface MarkdownPasteParser extends MarkdownParser {
  instance: { lexer(markdown: string): MarkdownToken[] };
}

/**
 * Longest plain text the paste rule parses (256 KiB). It runs on the main
 * thread during the paste, so anything longer pastes as plain text.
 */
export const MARKDOWN_PASTE_MAX_CHARS = 256 * 1024;

/**
 * Explicit Markdown syntax: a block marker at a line start, or paired
 * inline markers. Indentation alone is not syntax, so text pasted from a
 * terminal or an email never turns into a code block by itself. Linear in
 * the text: a link's text stops at the next bracket and its URL at the
 * next parenthesis, so a long line of `[` or `[a](` is read once.
 */
const BLOCK_SYNTAX =
  /^ {0,3}(?:#{1,6}[ \t]+\S|[-*+][ \t]+\S|\d{1,9}[.)][ \t]+\S|>|```|~~~|(?:[-*_][ \t]*){3,}$|\|.*\|[ \t]*$)/m;
const INLINE_SYNTAX =
  /\*\*[^*\n]+\*\*|__[^_\n]+__|(?:^|[^\w*])\*[^*\s][^*\n]*\*(?![\w*])|(?:^|[^\w_])_[^_\s][^_\n]*_(?!\w)|`[^`\n]+`|!?\[[^[\]\n]+\]\([^()\s]+\)|~~[^~\n]+~~/;

/** Cheap check before parsing: does the text use any Markdown syntax? */
export function hasMarkdownSyntax(text: string): boolean {
  return BLOCK_SYNTAX.test(text) || INLINE_SYNTAX.test(text);
}

/** Link marks, whatever the schema calls them (`hyperlink` here). */
const isLinkMark = (type: string) => /link$/i.test(type);

/** A link the parser made from a bare URL or address (GFM autolink). */
function isAutolink(text: string, href: unknown): boolean {
  if (typeof href !== "string") return false;
  return (
    href === text ||
    href === `http://${text}` ||
    href === `https://${text}` ||
    href === `mailto:${text}`
  );
}

const PLAIN_TYPES: ReadonlySet<string> = new Set([
  "doc",
  "paragraph",
  "text",
  "hardBreak",
]);

/**
 * Whether parsed content carries any formatting: a block other than a
 * paragraph, or a mark. A bare URL is not formatting: the link and embed
 * paste rules already handle it.
 */
export function hasMarkdownFormatting(content: JSONContent): boolean {
  if (content.type && !PLAIN_TYPES.has(content.type)) return true;
  for (const mark of content.marks ?? []) {
    if (
      !isLinkMark(mark.type) ||
      !isAutolink(content.text ?? "", mark.attrs?.href)
    ) {
      return true;
    }
  }
  return (content.content ?? []).some(hasMarkdownFormatting);
}

/**
 * `content` without link marks that have no target. The link extension
 * empties an unsafe href (`javascript:`, `data:`) where an HTML paste
 * drops the link: either way the text stays, unlinked.
 */
function withoutEmptyLinks(content: JSONContent): JSONContent {
  const result: JSONContent = { ...content };
  if (content.marks) {
    result.marks = content.marks.filter(
      (mark) => !isLinkMark(mark.type) || !!mark.attrs?.href,
    );
  }
  if (content.content) result.content = content.content.map(withoutEmptyLinks);
  return result;
}

/** The blocks of `json` as a fragment of `schema`, each one checked. */
function checkedFragment(
  schema: Schema,
  json: JSONContent,
  model: MarkdownModel,
): Fragment {
  const fragment = model.Fragment.fromJSON(schema, json.content ?? []);
  fragment.forEach((node) => {
    node.check();
  });
  return fragment;
}

/**
 * The blocks `markdown` parses to, checked against `schema`. Throws when
 * the result does not fit it (an unknown node, or content a node can't
 * hold). Never adds a title: the caller decides where the blocks go.
 */
export function parseMarkdownFragment(
  parser: MarkdownParser,
  schema: Schema,
  markdown: string,
  model: MarkdownModel,
): Fragment {
  return checkedFragment(
    schema,
    withoutEmptyLinks(parser.parse(markdown)),
    model,
  );
}

/**
 * Whether the Markdown has a raw HTML block (`<div>`, `<p>` or `<img>` on
 * lines of its own, at any depth). The parser reads one against the
 * title-first schema, so its first block becomes a level-1 heading (an
 * empty one for `<img>`), where an HTML paste fits it to the caret.
 * Inline HTML keeps only its inline content and is fine.
 */
function hasHtmlBlock(tokens: readonly MarkdownToken[]): boolean {
  return tokens.some(
    (token) =>
      (token.type === "html" && token.block === true) ||
      hasHtmlBlock(token.tokens ?? []) ||
      hasHtmlBlock(token.items ?? []),
  );
}

/**
 * The paste rule (E2): when the clipboard holds only plain text and it
 * parses as Markdown with formatting, the slice to paste; otherwise null,
 * and the editor pastes plain text as it always has. Also null for text
 * over `MARKDOWN_PASTE_MAX_CHARS` and for Markdown with a raw HTML block.
 * The slice is opened as deep as it goes, as ProseMirror opens a parsed
 * HTML paste, so one formatted line joins the paragraph at the caret.
 * Returned from `clipboardTextParser`, it then goes through the same
 * `transformPasted` and `handlePaste` props as an HTML paste.
 */
export function markdownPasteSlice(
  parser: MarkdownPasteParser,
  schema: Schema,
  text: string,
  model: MarkdownModel,
): Slice | null {
  if (text.length > MARKDOWN_PASTE_MAX_CHARS) return null;
  if (!hasMarkdownSyntax(text)) return null;
  let fragment: Fragment;
  try {
    if (hasHtmlBlock(parser.instance.lexer(text))) return null;
    const json = withoutEmptyLinks(parser.parse(text));
    if (!hasMarkdownFormatting(json)) return null;
    fragment = checkedFragment(schema, json, model);
  } catch {
    return null;
  }
  return fragment.size > 0 ? model.Slice.maxOpen(fragment) : null;
}
