/**
 * Characters removed from user-supplied text before it is shown: control
 * characters (C0, DEL, C1), zero-width spaces and joiners other than ZWNJ and
 * ZWJ, the byte-order mark, and every bidi mark, embedding, override and
 * isolate. ZWNJ (U+200C) and ZWJ (U+200D) are kept: Persian names and emoji
 * sequences need them.
 */
export const UNSAFE_TEXT_CHARS = /[\p{Cc}​‎‏؜⁠﻿‪-‮⁦-⁩]/gu;

const WHITESPACE_RUN = /\s+/gu;

/**
 * Cleans a display string: NFC, each unsafe character becomes a space,
 * whitespace runs collapse to one space, then trim. May return `""`.
 */
export function cleanText(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(UNSAFE_TEXT_CHARS, " ")
    .replace(WHITESPACE_RUN, " ")
    .trim();
}
