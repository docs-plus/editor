/** The Find bar's options (details spec E1). */
export interface FindOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
}

/** Characters the regex syntax reserves (the `u` flag escapes only these). */
const SYNTAX = /[\\^$.*+?()[\]{}|/]/g;

/**
 * Letter forms and digits that read the same (search-linking design §3.2
 * steps 3 and 4): Arabic ي/ك against Persian ی/ک, and Persian and
 * Arabic-Indic digits against ASCII. Each is one UTF-16 unit, so a match
 * keeps the document's own offsets.
 */
const FOLDS = ["يی", "كک"];
for (let digit = 0; digit < 10; digit++) {
  FOLDS.push(
    `${digit}${String.fromCharCode(0x06f0 + digit)}${String.fromCharCode(0x0660 + digit)}`,
  );
}
const FOLD_CLASS = new Map<string, string>();
for (const group of FOLDS) {
  for (const char of group) FOLD_CLASS.set(char, `[${group}]`);
}

/** Harakat, Quranic marks and tatweel, skipped between letters (§3.2 step 2). */
const ARABIC_MARKS = "\\u064B-\\u065F\\u0670\\u06D6-\\u06ED\\u0640";
const ARABIC_MARK = new RegExp(`[${ARABIC_MARKS}]`, "gu");
const ARABIC_SCRIPT = /[؀-ۿ]/;

/**
 * A word character for "Whole word": letters, combining marks, digits, the
 * underscore and the zero-width non-joiner, which joins parts of one
 * Persian word ("کتاب‌ها").
 */
const WORD = "[\\p{L}\\p{M}\\p{N}_\\u200C]";

/**
 * The global regex that finds `query` as plain text, or null for an empty
 * query. Without "Match case" it ignores case, letter forms, digit scripts
 * and Arabic marks; every rule keeps match offsets equal to the text's, so
 * a match maps straight back to document positions.
 */
export function buildFindPattern(
  query: string,
  { caseSensitive, wholeWord }: FindOptions,
): RegExp | null {
  if (!query) return null;
  let chars = Array.from(query);
  let joiner = "";
  if (!caseSensitive && ARABIC_SCRIPT.test(query)) {
    const bare = Array.from(query.replace(ARABIC_MARK, ""));
    if (bare.length > 0) chars = bare;
    joiner = `[${ARABIC_MARKS}]*`;
  }
  const body = chars
    .map((char) =>
      caseSensitive
        ? char.replace(SYNTAX, "\\$&")
        : (FOLD_CLASS.get(char) ?? char.replace(SYNTAX, "\\$&")),
    )
    .join(joiner);
  const source = wholeWord ? `(?<!${WORD})${body}(?!${WORD})` : body;
  return new RegExp(source, caseSensitive ? "gu" : "giu");
}
