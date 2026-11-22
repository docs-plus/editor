/**
 * The one search normalizer (search-linking design §3.2, D-A8). Applied to
 * every searched string (titles, folder names, later tags) and every query
 * term, on desktop and in the web library alike. Pure; no allocation beyond
 * the result.
 *
 * 1. Each code point is decomposed (NFD) and lower-cased, so text typed
 *    composed or decomposed matches.
 * 2. Only these marks are stripped: Latin combining diacritics, Arabic
 *    harakat and Quranic marks, Hebrew points and cantillation, and tatweel.
 *    Other scripts' marks (Devanagari, Thai…) are part of their letters.
 * 3. Arabic yeh and kaf fold to the Persian letters.
 * 4. Persian and Arabic-Indic digits fold to ASCII.
 * 5. ZWNJ stays (query terms split on it; see `lib/search/match.ts`).
 *
 * Bump {@link NORMALIZER_VERSION} whenever the output changes, so anything
 * that stores normalized strings can rebuild them.
 */
export const NORMALIZER_VERSION = 1;

function isStrippedMark(code: number): boolean {
  return (
    (code >= 0x0300 && code <= 0x036f) || // Latin combining diacritics
    (code >= 0x064b && code <= 0x065f) || // Arabic harakat
    code === 0x0670 || // superscript alef
    (code >= 0x06d6 && code <= 0x06ed) || // Quranic marks
    (code >= 0x0591 && code <= 0x05c7) || // Hebrew points, cantillation
    code === 0x0640 // tatweel
  );
}

function fold(code: number): string {
  if (code === 0x064a) return "ی"; // ي → ی
  if (code === 0x0643) return "ک"; // ك → ک
  if (code >= 0x06f0 && code <= 0x06f9) return String(code - 0x06f0);
  if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
  return String.fromCodePoint(code);
}

export interface NormalizedText {
  readonly text: string;
  /**
   * For each UTF-16 unit of `text`, where its source starts and ends in the
   * original string. A stripped mark belongs to the character before it, so
   * a highlight never splits a base letter from its accent.
   */
  readonly starts: readonly number[];
  readonly ends: readonly number[];
}

export function normalizeWithOffsets(source: string): NormalizedText {
  let text = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let index = 0;
  for (const char of source) {
    const end = index + char.length;
    let produced = false;
    for (const part of char.normalize("NFD").toLowerCase()) {
      const code = part.codePointAt(0) ?? 0;
      if (isStrippedMark(code)) continue;
      const out = fold(code);
      for (let unit = 0; unit < out.length; unit++) {
        starts.push(index);
        ends.push(end);
      }
      text += out;
      produced = true;
    }
    if (!produced && ends.length > 0) {
      // A stripped mark joins the character before it.
      const last = ends[ends.length - 1];
      for (let k = ends.length - 1; k >= 0 && ends[k] === last; k--) {
        ends[k] = end;
      }
    }
    index = end;
  }
  return { text, starts, ends };
}

export function normalizeSearchText(source: string): string {
  let text = "";
  for (const char of source) {
    for (const part of char.normalize("NFD").toLowerCase()) {
      const code = part.codePointAt(0) ?? 0;
      if (!isStrippedMark(code)) text += fold(code);
    }
  }
  return text;
}
