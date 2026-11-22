/**
 * The text range a new comment anchors to (comments design §5.1): the
 * selection trimmed of whitespace at both ends, with at least one
 * character of text; with no selection, the word at the caret; with no
 * word, nothing (the command is disabled). Pure: reads the document only.
 */
import type { Node as PMNode } from "@tiptap/pm/model";

import type { CommentRange } from "@/lib/comments/anchors";
import { cleanQuote } from "@/lib/comments/clean";

const SPACE = /\s/u;
const WORD = /[\p{L}\p{N}\p{M}_'’-]/u;
/** Stands in for each inline leaf, so text offsets equal positions. */
const LEAF = String.fromCharCode(0xfffc);

/**
 * `[from, to)` narrowed to its first and last text characters (also past
 * whitespace with `trim`), or `null` when it holds no text. Anchors are
 * made only at text, never at a block boundary, where y-tiptap would make
 * a position on the root (§5.1).
 */
export function textBounds(
  doc: PMNode,
  { from, to }: CommentRange,
  trim = false,
): CommentRange | null {
  let start = -1;
  let end = -1;
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText || !node.text) return true;
    const lo = Math.max(from, pos);
    const hi = Math.min(to, pos + node.text.length);
    for (let at = lo; at < hi; at++) {
      if (trim && SPACE.test(node.text[at - pos])) continue;
      if (start < 0) start = at;
      end = at + 1;
    }
    return false;
  });
  return start < 0 ? null : { from: start, to: end };
}

/** The word around a caret at `pos`, or `null`. */
function wordAt(doc: PMNode, pos: number): CommentRange | null {
  const $pos = doc.resolve(pos);
  const parent = $pos.parent;
  if (!parent.isTextblock) return null;
  const text = parent.textBetween(0, parent.content.size, undefined, LEAF);
  const offset = $pos.parentOffset;
  let lo = offset;
  let hi = offset;
  while (lo > 0 && WORD.test(text[lo - 1])) lo--;
  while (hi < text.length && WORD.test(text[hi])) hi++;
  if (lo === hi) return null;
  const base = $pos.start();
  return { from: base + lo, to: base + hi };
}

/** The range a comment on this selection anchors to, or `null`. */
export function commentRangeFor(
  doc: PMNode,
  from: number,
  to: number,
): CommentRange | null {
  return from < to ? textBounds(doc, { from, to }, true) : wordAt(doc, from);
}

/** The thread head's quote for `range`. */
export const quoteOf = (doc: PMNode, { from, to }: CommentRange): string =>
  cleanQuote(doc.textBetween(from, to, " "));
