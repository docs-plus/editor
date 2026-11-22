import { describe, expect, it } from "bun:test";

import {
  NORMALIZER_VERSION,
  normalizeSearchText,
  normalizeWithOffsets,
} from "@/lib/search/normalize";

describe("normalizeSearchText (search-linking §3.2)", () => {
  it("is versioned", () => {
    expect(NORMALIZER_VERSION).toBe(1);
  });

  it.each([
    ["Café", "cafe"],
    ["CAFÉ", "cafe"],
    ["café", "cafe"],
    ["Ångström", "angstrom"],
    ["naïve résumé", "naive resume"],
    ["Ğüş", "gus"],
  ])("folds case and Latin accents: %s", (input, expected) => {
    expect(normalizeSearchText(input)).toBe(expected);
  });

  it("strips Arabic harakat, the superscript alef and Quranic marks", () => {
    expect(normalizeSearchText("كِتَابٌ")).toBe("کتاب");
    expect(normalizeSearchText("هٰذا")).toBe("هذا");
    expect(normalizeSearchText("ذٰلِكَۖ")).toBe("ذلک");
  });

  it("strips tatweel", () => {
    expect(normalizeSearchText("ســـلام")).toBe("سلام");
  });

  it("strips Hebrew points and cantillation", () => {
    expect(normalizeSearchText("שָׁלוֹם")).toBe("שלום");
    expect(normalizeSearchText("בְּרֵאשִׁ֖ית")).toBe("בראשית");
  });

  it("folds Arabic yeh and kaf to their Persian letters", () => {
    expect(normalizeSearchText("علي")).toBe("علی");
    expect(normalizeSearchText("كتاب")).toBe("کتاب");
    expect(normalizeSearchText("كتاب")).toBe(normalizeSearchText("کتاب"));
  });

  it("folds Persian and Arabic-Indic digits to ASCII", () => {
    expect(normalizeSearchText("۱۴۰۳")).toBe("1403");
    expect(normalizeSearchText("١٤٠٣")).toBe("1403");
    expect(normalizeSearchText("گزارش ۱۴۰۳")).toBe("گزارش 1403");
  });

  it("keeps ZWNJ inside words", () => {
    expect(normalizeSearchText("می‌روم")).toBe("می‌روم");
  });

  it("leaves marks of other scripts alone", () => {
    // Devanagari vowel signs and Thai tone marks are letters' parts there.
    expect(normalizeSearchText("हिन्दी")).toBe("हिन्दी".normalize("NFD"));
    expect(normalizeSearchText("ภาษาไทย")).toBe("ภาษาไทย");
    expect(normalizeSearchText("東京都")).toBe("東京都");
  });

  it("matches the same text typed composed or decomposed", () => {
    expect(normalizeSearchText("한국어")).toBe(
      normalizeSearchText("한국어".normalize("NFD")),
    );
  });
});

describe("normalizeWithOffsets", () => {
  it("maps each normalized character back to its source range", () => {
    const { text, starts, ends } = normalizeWithOffsets("Café");
    expect(text).toBe("cafe");
    expect(starts).toEqual([0, 1, 2, 3]);
    expect(ends).toEqual([1, 2, 3, 4]);
  });

  it("gives a stripped mark to the character before it", () => {
    const source = "café au";
    const { text, starts, ends } = normalizeWithOffsets(source);
    expect(text).toBe("cafe au");
    // "e" covers "e" plus the combining acute.
    expect(source.slice(starts[3], ends[3])).toBe("é");
  });

  it("keeps astral characters whole", () => {
    const source = "a😀b";
    const { text, starts, ends } = normalizeWithOffsets(source);
    expect(text).toBe("a😀b");
    const emoji = text.indexOf("😀");
    expect(source.slice(starts[emoji], ends[emoji + 1])).toBe("😀");
  });

  it("maps Arabic letters through stripped harakat", () => {
    const source = "كِتَاب";
    const { text, starts, ends } = normalizeWithOffsets(source);
    expect(text).toBe("کتاب");
    expect(source.slice(starts[0], ends[1])).toBe("كِتَ");
  });
});
