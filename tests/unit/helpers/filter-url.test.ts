import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";

import {
  decodeFilterParams,
  MAX_FILTER_WORD_LENGTH,
  MAX_FILTER_WORDS,
  readFilterUrl,
  updateFilterUrl,
} from "@/extensions/heading-filter";

const words = (count: number, prefix = "w") =>
  Array.from({ length: count }, (_, i) => `${prefix}${i + 1}`);

describe("decodeFilterParams caps what a link can carry", () => {
  it("keeps small limits: 8 words of 64 characters", () => {
    expect(MAX_FILTER_WORDS).toBe(8);
    expect(MAX_FILTER_WORD_LENGTH).toBe(64);
  });

  it("keeps only the first 8 words of a longer link", () => {
    const result = decodeFilterParams(
      `?filter=${words(20).join("|")}&mode=and`,
    );
    expect(result).toEqual({ slugs: words(8), mode: "and" });
  });

  it("keeps all of a link at the cap", () => {
    const result = decodeFilterParams(`?filter=${words(8).join("|")}`);
    expect(result?.slugs).toEqual(words(8));
  });

  it("does not count empty segments toward the cap", () => {
    const raw = `||${words(8).join("||")}||extra`;
    expect(decodeFilterParams(`?filter=${raw}`)?.slugs).toEqual(words(8));
  });

  it("does not let repeated words use up the cap", () => {
    const raw = [...Array(50).fill("a"), "b", "a", "c"].join("|");
    expect(decodeFilterParams(`?filter=${raw}`)?.slugs).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("cuts a word to 64 characters", () => {
    const long = "x".repeat(100);
    expect(decodeFilterParams(`?filter=${long}|y`)?.slugs).toEqual([
      "x".repeat(64),
      "y",
    ]);
    const exact = "z".repeat(64);
    expect(decodeFilterParams(`?filter=${exact}`)?.slugs).toEqual([exact]);
  });

  it("measures a word after decoding, not as encoded in the link", () => {
    // 21 × "é" is 126 encoded characters but 21 decoded ones.
    const word = "é".repeat(21);
    const result = decodeFilterParams(`?filter=${encodeURIComponent(word)}`);
    expect(result?.slugs).toEqual([word]);
  });

  it("never splits a surrogate pair at the cut", () => {
    // 63 characters, then an emoji whose two halves straddle the cap.
    const word = `${"a".repeat(63)}😀tail`;
    const slug = decodeFilterParams(`?filter=${encodeURIComponent(word)}`)
      ?.slugs[0] as string;
    expect(slug).toBe("a".repeat(63));
    expect(() => encodeURIComponent(slug)).not.toThrow();
  });
});

describe("decodeFilterParams", () => {
  it("valid params → correct { slugs, mode }", () => {
    const result = decodeFilterParams("?filter=foo%7Cbar&mode=or");
    expect(result).toEqual({ slugs: ["foo", "bar"], mode: "or" });
  });

  it("missing params → null", () => {
    expect(decodeFilterParams("")).toBeNull();
    expect(decodeFilterParams("?other=1")).toBeNull();
  });

  it("mode=and → mode is 'and'", () => {
    const result = decodeFilterParams("?filter=test&mode=and");
    expect(result?.mode).toBe("and");
  });

  it("no mode param → defaults to 'or'", () => {
    const result = decodeFilterParams("?filter=test");
    expect(result?.mode).toBe("or");
  });

  it("empty filter value → null", () => {
    expect(decodeFilterParams("?filter=&mode=or")).toBeNull();
    expect(decodeFilterParams("?filter=|")).toBeNull();
  });

  it("a hand-typed % keeps the slug as typed instead of throwing", () => {
    expect(decodeFilterParams("?filter=50%25")?.slugs).toEqual(["50%"]);
    expect(decodeFilterParams("?filter=100%")?.slugs).toEqual(["100%"]);
    expect(decodeFilterParams("?filter=a%7C50%25%7Cb")?.slugs).toEqual([
      "a",
      "50%",
      "b",
    ]);
  });

  it("round-trips a slug with % written by updateFilterUrl", () => {
    window.history.replaceState(null, "", "/");
    updateFilterUrl(["50%", "a|b"], "and");
    expect(decodeFilterParams(window.location.search)).toEqual({
      slugs: ["50%", "a|b"],
      mode: "and",
    });
    window.history.replaceState(null, "", "/");
  });
});

describe("updateFilterUrl", () => {
  let replaceStateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    replaceStateSpy = vi
      .spyOn(history, "replaceState")
      .mockImplementation(() => {});
  });

  afterEach(() => {
    replaceStateSpy.mockRestore();
  });

  it("with slugs → calls replaceState with filter and mode params", () => {
    Object.defineProperty(window, "location", {
      value: { href: "http://localhost/", origin: "http://localhost" },
      writable: true,
      configurable: true,
    });
    updateFilterUrl(["foo", "bar"], "or");
    const url = replaceStateSpy.mock.calls[0][2] as string;
    expect(url).toMatch(/filter=foo%7Cbar/);
    expect(url).toContain("mode=or");
  });

  it("with empty slugs → removes params", () => {
    Object.defineProperty(window, "location", {
      value: {
        href: "http://localhost/?filter=old&mode=or",
        origin: "http://localhost",
      },
      writable: true,
      configurable: true,
    });
    updateFilterUrl([], "or");
    const url = replaceStateSpy.mock.calls[0][2] as string;
    expect(url).not.toContain("filter=");
    expect(url).not.toContain("mode=");
  });
});

describe("readFilterUrl", () => {
  beforeEach(() => {
    Object.defineProperty(window, "location", {
      value: new URL("http://localhost/"),
      writable: true,
    });
  });

  it("returns decoded params from window.location.search", () => {
    Object.defineProperty(window, "location", {
      value: new URL("http://localhost/?filter=hello%7Cworld&mode=and"),
      writable: true,
    });
    const result = readFilterUrl();
    expect(result).toEqual({ slugs: ["hello", "world"], mode: "and" });
  });

  it("returns null when no filter param", () => {
    Object.defineProperty(window, "location", {
      value: new URL("http://localhost/"),
      writable: true,
    });
    expect(readFilterUrl()).toBeNull();
  });
});
