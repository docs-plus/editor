/**
 * Cleaning for comment text (comments design §4.3), run on write and again
 * on render. Self-contained on purpose: the comments chunk is lazy, and a
 * module it shares with the editor chunk (`lib/clean-text.ts`,
 * `lib/user-identity.ts`) would be split out of the editor group, which
 * costs that group about 1.6 KB gz (contract A16).
 */
import { CLIENT_LIMITS } from "@/lib/comments/limits";

/**
 * Bidi marks, embeddings, overrides and isolates, zero-width spaces, the
 * byte-order mark, and C0, DEL and C1 controls except `\n`. ZWNJ and ZWJ
 * stay: Persian names and emoji sequences need them.
 */
const UNSAFE_CHARS =
  /[\p{Cc}\u200B\u200E\u200F\u061C\u2060\uFEFF\u202A-\u202E\u2066-\u2069]/gu;
const WHITESPACE_RUN = /\s+/gu;
const TRAILING_LINE_SPACE = /[^\S\n]+\n/g;
const BLANK_LINES = /\n{3,}/g;

/** A message body: NFC, unsafe characters dropped, `\n` kept, trimmed. */
export function cleanBody(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(UNSAFE_CHARS, (char) => (char === "\n" ? char : ""))
    .replace(TRAILING_LINE_SPACE, "\n")
    .replace(BLANK_LINES, "\n\n")
    .trim();
}

/** One line (a name or a suggestion): unsafe characters become spaces. */
export function cleanLine(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(UNSAFE_CHARS, " ")
    .replace(WHITESPACE_RUN, " ")
    .trim();
}

let segmenter: Intl.Segmenter | null = null;

function graphemes(text: string): string[] {
  if (typeof Intl.Segmenter !== "function") return Array.from(text);
  segmenter ??= new Intl.Segmenter(undefined, { granularity: "grapheme" });
  return Array.from(segmenter.segment(text), (part) => part.segment);
}

/**
 * `text` in at most `max` UTF-16 units, cut at a grapheme boundary. With
 * `ellipsis`, a cut text ends in "…" inside the same budget.
 */
export function clampText(text: string, max: number, ellipsis = false): string {
  if (text.length <= max) return text;
  const budget = ellipsis ? max - 1 : max;
  let out = "";
  for (const grapheme of graphemes(text)) {
    if (out.length + grapheme.length > budget) break;
    out += grapheme;
  }
  return ellipsis ? `${out.trimEnd()}…` : out;
}

/**
 * An author name as comments store it: one clean line of at most 40
 * units. The identity allows up to 320 units (32 graphemes), so writing it
 * unclamped would produce entries the server rejects.
 */
export function cleanAuthorName(raw: string): string {
  return clampText(cleanLine(raw), CLIENT_LIMITS.name).trim();
}

/** The quoted text: one line, at most 280 units, "…" when cut. */
export function cleanQuote(raw: string): string {
  return clampText(cleanLine(raw), CLIENT_LIMITS.quote, true);
}
