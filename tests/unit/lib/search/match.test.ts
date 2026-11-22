import { describe, expect, it } from "bun:test";

import { findTerm, queryTerms, sourceRanges } from "@/lib/search/match";
import { normalizeWithOffsets } from "@/lib/search/normalize";

describe("queryTerms", () => {
  it("normalizes and splits on whitespace", () => {
    expect(queryTerms("  Café   PLAN ")).toEqual(["cafe", "plan"]);
  });

  it("splits on ZWNJ between terms", () => {
    expect(queryTerms("می‌روم")).toEqual(["می", "روم"]);
  });

  it("returns nothing for a blank query", () => {
    expect(queryTerms(" ‌ ")).toEqual([]);
  });
});

describe("findTerm", () => {
  it("prefers a word-prefix match over an earlier substring", () => {
    expect(findTerm("plan", "explanation plan")).toEqual({
      prefix: true,
      start: 12,
      end: 16,
    });
  });

  it("falls back to a substring match", () => {
    expect(findTerm("plan", "explanation")).toEqual({
      prefix: false,
      start: 2,
      end: 6,
    });
  });

  it("treats ZWNJ and punctuation as word boundaries", () => {
    expect(findTerm("روم", "می‌روم")?.prefix).toBe(true);
    expect(findTerm("plan", "q4-plan")?.prefix).toBe(true);
  });

  it("finds CJK inside a longer run without segmenting", () => {
    expect(findTerm("東京", "東京都の計画")).toEqual({
      prefix: true,
      start: 0,
      end: 2,
    });
    expect(findTerm("計画", "東京都の計画")?.prefix).toBe(false);
  });

  it("returns null when absent", () => {
    expect(findTerm("zebra", "plan")).toBeNull();
  });
});

describe("sourceRanges", () => {
  it("maps normalized hits back to the original string, merged", () => {
    const title = "Café Plan";
    const norm = normalizeWithOffsets(title);
    const a = findTerm("caf", norm.text);
    const b = findTerm("e", norm.text);
    if (!a || !b) throw new Error("no match");
    expect(sourceRanges(norm, [a, b])).toEqual([[0, 4]]);
  });

  it("keeps an accent inside its highlight", () => {
    const title = "café";
    const norm = normalizeWithOffsets(title);
    const hit = findTerm("cafe", norm.text);
    if (!hit) throw new Error("no match");
    const [[start, end]] = sourceRanges(norm, [hit]);
    expect(title.slice(start, end)).toBe(title);
  });
});
