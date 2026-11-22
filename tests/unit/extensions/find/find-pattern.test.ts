import { describe, expect, it } from "bun:test";

import {
  buildFindPattern,
  type FindOptions,
} from "@/extensions/find/find-pattern";

const loose: FindOptions = { caseSensitive: false, wholeWord: false };

/** Every match of `query` in `text` as `[index, matched text]`. */
function matches(text: string, query: string, options = loose) {
  const pattern = buildFindPattern(query, options);
  if (!pattern) return null;
  return [...text.matchAll(pattern)].map((m) => [m.index, m[0]]);
}

describe("buildFindPattern", () => {
  it("returns null for an empty query", () => {
    expect(buildFindPattern("", loose)).toBeNull();
  });

  it("matches literally: regex syntax in the query is plain text", () => {
    expect(matches("a.b axb (c) [d] a-b", "a.b")).toEqual([[0, "a.b"]]);
    expect(matches("(c) [d] a-b $1 ^x", "(c)")).toEqual([[0, "(c)"]]);
    expect(matches("[d] a-b", "a-b")).toEqual([[4, "a-b"]]);
    expect(matches("x\\y", "\\")).toEqual([[1, "\\"]]);
  });

  it("ignores case unless match case is on", () => {
    expect(matches("Find find FIND", "find")).toEqual([
      [0, "Find"],
      [5, "find"],
      [10, "FIND"],
    ]);
    expect(
      matches("Find find FIND", "find", {
        caseSensitive: true,
        wholeWord: false,
      }),
    ).toEqual([[5, "find"]]);
  });

  it("whole word skips matches inside longer words, in any script", () => {
    const whole = { caseSensitive: false, wholeWord: true };
    expect(matches("cat concat cats cat_ cat.", "cat", whole)).toEqual([
      [0, "cat"],
      [21, "cat"],
    ]);
    // Persian: a zero-width non-joiner keeps "کتاب‌ها" (books) one word.
    expect(matches("کتاب کتاب‌ها", "کتاب", whole)).toEqual([[0, "کتاب"]]);
  });

  it("folds Arabic and Persian letter forms and digits, unless match case is on", () => {
    // Arabic ي and ك against Persian ی and ک.
    expect(matches("علي علی", "علی")).toEqual([
      [0, "علي"],
      [4, "علی"],
    ]);
    expect(matches("كتاب", "کتاب")).toEqual([[0, "كتاب"]]);
    expect(matches("سال ۱۴۰۳ و 1403 و ١٤٠٣", "1403")).toEqual([
      [4, "۱۴۰۳"],
      [11, "1403"],
      [18, "١٤٠٣"],
    ]);
    expect(
      matches("علي", "علی", { caseSensitive: true, wholeWord: false }),
    ).toEqual([]);
  });

  it("ignores Arabic harakat and tatweel between letters", () => {
    expect(matches("كِتَاب", "كتاب")).toEqual([[0, "كِتَاب"]]);
    expect(matches("كتــاب", "كتاب")).toEqual([[0, "كتــاب"]]);
  });

  it("keeps astral characters whole", () => {
    expect(matches("a😀b 😀", "😀")).toEqual([
      [1, "😀"],
      [5, "😀"],
    ]);
  });

  it("never matches an empty string", () => {
    expect(matches("abc", "ً")).toEqual([]);
  });
});
