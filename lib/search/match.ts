/**
 * Term matching for metadata search (UX §4.3, search-linking §3.2): word
 * prefixes first, then substrings. Works on normalized text
 * (`normalize.ts`); `sourceRanges` maps hits back to the original string so
 * a highlight keeps "Café" as typed.
 */
import { type NormalizedText, normalizeSearchText } from "./normalize";

const TERM_SEPARATOR = /[\s‌]+/u;
const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u;

/** The query's normalized terms; ZWNJ separates terms too. */
export function queryTerms(query: string): string[] {
  return normalizeSearchText(query)
    .split(TERM_SEPARATOR)
    .filter((term) => term.length > 0);
}

/** Where a term matched, in normalized offsets. */
export interface TermHit {
  /** It starts a word (start of text, or after a space, ZWNJ or punctuation). */
  readonly prefix: boolean;
  readonly start: number;
  readonly end: number;
}

function startsWord(text: string, at: number): boolean {
  return at === 0 || !WORD_CHAR.test(text[at - 1] ?? "");
}

/** The first word-prefix occurrence of `term` in `text`, else the first one. */
export function findTerm(term: string, text: string): TermHit | null {
  let first = -1;
  for (let at = text.indexOf(term); at >= 0; at = text.indexOf(term, at + 1)) {
    if (startsWord(text, at)) {
      return { prefix: true, start: at, end: at + term.length };
    }
    if (first < 0) first = at;
  }
  return first < 0
    ? null
    : { prefix: false, start: first, end: first + term.length };
}

/** Hits as sorted, merged `[start, end)` ranges of the original string. */
export function sourceRanges(
  normalized: NormalizedText,
  hits: readonly TermHit[],
): Array<[number, number]> {
  const ranges = hits
    .filter((hit) => hit.end > hit.start)
    .map((hit): [number, number] => [
      normalized.starts[hit.start],
      normalized.ends[hit.end - 1],
    ])
    .sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  return merged;
}
