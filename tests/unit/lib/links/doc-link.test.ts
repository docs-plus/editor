import { describe, expect, it } from "bun:test";

import {
  DOC_LINK_SCHEME,
  docHref,
  hereHref,
  isOurScheme,
  parseDocLink,
} from "@/lib/links/doc-link";

const KEY = "0123456789abcdef0123456789abcdef";
const TOC = "6f1c2a3b-4d5e-4f60-8a9b-0c1d2e3f4a5b";

describe("parseDocLink (search-linking §4.1)", () => {
  it("accepts the three forms", () => {
    expect(parseDocLink(`tinydocy:doc/${KEY}`)).toEqual({
      kind: "doc",
      key: KEY,
      tocId: null,
    });
    expect(parseDocLink(`tinydocy:doc/${KEY}#${TOC}`)).toEqual({
      kind: "doc",
      key: KEY,
      tocId: TOC,
    });
    expect(parseDocLink(`tinydocy:here#${TOC}`)).toEqual({
      kind: "here",
      tocId: TOC,
    });
  });

  it.each([
    [`tinydocy:doc/${KEY.toUpperCase()}`, "uppercase key"],
    [`TINYDOCY:doc/${KEY}`, "uppercase scheme"],
    [`tinydocy:doc/${KEY.slice(1)}`, "short key"],
    [`tinydocy:doc/${KEY}0`, "long key"],
    [`tinydocy://local/doc/${KEY}`, "slashes"],
    [`tinydocy:doc/${KEY}/extra`, "extra segment"],
    [`tinydocy:doc/${KEY}#${TOC}#x`, "extra hash"],
    [`tinydocy:doc/${KEY}#short`, "short heading id"],
    [`tinydocy:here`, "here without a heading"],
    [` tinydocy:doc/${KEY}`, "leading space"],
    ["javascript:alert(1)", "javascript"],
    ["https://example.com", "web link"],
    ["", "empty"],
  ])("refuses %s (%s)", (href) => {
    expect(parseDocLink(href)).toBeNull();
  });
});

describe("builders", () => {
  it("round-trip through the parser", () => {
    expect(parseDocLink(docHref(KEY))).toEqual({
      kind: "doc",
      key: KEY,
      tocId: null,
    });
    expect(parseDocLink(docHref(KEY, TOC))?.kind).toBe("doc");
    expect(parseDocLink(hereHref(TOC))).toEqual({ kind: "here", tocId: TOC });
    expect(docHref(KEY, TOC)).toBe(`${DOC_LINK_SCHEME}:doc/${KEY}#${TOC}`);
  });
});

describe("isOurScheme", () => {
  it.each([
    `tinydocy:doc/${KEY}`,
    `TINYDOCY:doc/${KEY}`,
    ` tinydocy:doc/${KEY}`,
    `\u0000tiny\tdocy:here#x`,
    "tinydocy://local/anything",
    "TinyDocy:future-form",
  ])("claims %p, which must never leave the app", (href) => {
    expect(isOurScheme(href)).toBe(true);
  });

  it.each(["https://tinydocy.app", "mailto:a@b.c", "tinydocy", "x-tinydocy:a"])(
    "leaves %p alone",
    (href) => {
      expect(isOurScheme(href)).toBe(false);
    },
  );
});
