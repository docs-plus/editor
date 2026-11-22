/**
 * Word and character count (details spec E3, P2.12): the engine behind
 * the ⋯ popover, the phone sheet and View › Word Count. Pure and computed
 * on demand by the surface that shows it, never on each keystroke. It
 * reads no editor state of its own, so nothing in the editor chunk loads
 * it.
 */
import type { Node } from "@tiptap/pm/model";

export interface TextCount {
  words: number;
  /** User-perceived characters (graphemes), spaces included. */
  characters: number;
  charactersWithoutSpaces: number;
}

/** A selection to count instead of the whole document. */
export interface CountRange {
  from: number;
  to: number;
}

/** Separates blocks so words never join across them; never counted. */
const BLOCK_BREAK = "\n";
const SPACE = /^\s+$/;

type Segment = { segment: string; isWordLike?: boolean };

/**
 * `Intl.Segmenter` splits words by the script's own rules (a ZWNJ stays
 * inside a Persian word, CJK splits by dictionary) and characters by
 * grapheme (one emoji sequence is one character). Older engines without
 * it count runs of non-space as words and code points as characters.
 */
function segments(text: string, granularity: "word" | "grapheme"): Segment[] {
  if (typeof Intl.Segmenter === "function") {
    return [...new Intl.Segmenter(undefined, { granularity }).segment(text)];
  }
  if (granularity === "grapheme") {
    return [...text].map((segment) => ({ segment }));
  }
  return (text.match(/\S+/g) ?? []).map((segment) => ({
    segment,
    isWordLike: /[\p{L}\p{N}]/u.test(segment),
  }));
}

/** Counts plain text; `\n` marks a block break and is never a character. */
export function countText(text: string): TextCount {
  let words = 0;
  for (const { isWordLike } of segments(text, "word")) {
    if (isWordLike) words += 1;
  }
  let characters = 0;
  let charactersWithoutSpaces = 0;
  for (const { segment } of segments(text, "grapheme")) {
    if (segment === BLOCK_BREAK) continue;
    characters += 1;
    if (!SPACE.test(segment)) charactersWithoutSpaces += 1;
  }
  return { words, characters, charactersWithoutSpaces };
}

/**
 * Counts `doc`, or only `range` when the writer has a selection (E3: "it
 * counts the selection when there is one"). The title counts like any
 * other block. Images, diagrams and other leaves without text add nothing.
 */
export function countWords(doc: Node, range?: CountRange): TextCount {
  const from = range?.from ?? 0;
  const to = range?.to ?? doc.content.size;
  return countText(doc.textBetween(from, to, BLOCK_BREAK, BLOCK_BREAK));
}
