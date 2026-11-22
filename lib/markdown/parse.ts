/**
 * Markdown to editor content: the Markdown paste rule (details spec E2,
 * P2.12) and the import engine (IM1) share it. Pure: no DOM, no editor,
 * no schema of its own. The caller passes the parser (the editor's
 * `editor.markdown`, or a headless `MarkdownManager` built from the
 * headless schema's extensions) and the schema to check against.
 */
import type { JSONContent } from "@tiptap/core";
import { Fragment, type Schema, Slice } from "@tiptap/pm/model";

/** `editor.markdown`, or `new MarkdownManager({ extensions })` headless. */
export interface MarkdownParser {
  parse(markdown: string): JSONContent;
}

/**
 * Explicit Markdown syntax: a block marker at a line start, or paired
 * inline markers. Indentation alone is not syntax, so text pasted from a
 * terminal or an email never turns into a code block by itself.
 */
const BLOCK_SYNTAX =
  /^ {0,3}(?:#{1,6}[ \t]+\S|[-*+][ \t]+\S|\d{1,9}[.)][ \t]+\S|>|```|~~~|(?:[-*_][ \t]*){3,}$|\|.*\|[ \t]*$)/m;
const INLINE_SYNTAX =
  /\*\*[^*\n]+\*\*|__[^_\n]+__|(?:^|[^\w*])\*[^*\s][^*\n]*\*(?![\w*])|(?:^|[^\w_])_[^_\s][^_\n]*_(?!\w)|`[^`\n]+`|!?\[[^\]\n]+\]\([^)\s]+\)|~~[^~\n]+~~/;

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
 * The blocks `markdown` parses to, checked against `schema`. Throws when
 * the result does not fit it (an unknown node, or content a node can't
 * hold). Never adds a title: the caller decides where the blocks go.
 */
export function parseMarkdownFragment(
  parser: MarkdownParser,
  schema: Schema,
  markdown: string,
): Fragment {
  const fragment = Fragment.fromJSON(
    schema,
    parser.parse(markdown).content ?? [],
  );
  fragment.forEach((node) => {
    node.check();
  });
  return fragment;
}

/**
 * The paste rule (E2): when the clipboard holds only plain text and it
 * parses as Markdown with formatting, the slice to paste; otherwise null,
 * and the editor pastes plain text as it always has. The slice is opened
 * as deep as it goes, as ProseMirror opens a parsed HTML paste, so one
 * formatted line joins the paragraph at the caret.
 */
export function markdownPasteSlice(
  parser: MarkdownParser,
  schema: Schema,
  text: string,
): Slice | null {
  if (!hasMarkdownSyntax(text)) return null;
  let json: JSONContent;
  let fragment: Fragment;
  try {
    json = parser.parse(text);
    if (!hasMarkdownFormatting(json)) return null;
    fragment = parseMarkdownFragment({ parse: () => json }, schema, text);
  } catch {
    return null;
  }
  return fragment.size > 0 ? Slice.maxOpen(fragment) : null;
}
