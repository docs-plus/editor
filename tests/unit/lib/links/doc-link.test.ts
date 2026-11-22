import { describe, expect, it } from "bun:test";

import {
  DOC_LINK_SCHEME,
  docHref,
  hereHref,
  isOurScheme,
  isWebLink,
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

  /**
   * Scheme parity (linking review, code review 3): every character the
   * Hyperlink extension's gate, a browser's URL parser or a bidi-aware
   * renderer drops or hides must not turn a `tinydocy:` href into "not
   * ours", or `navigate` would hand it to `openExternal`. One case per
   * class, leading and inside the scheme; the strict parser refuses each.
   */
  it.each([
    ["0001", "C0 control"],
    ["001F", "C0 control (unit separator)"],
    ["0009", "tab"],
    ["000A", "line feed"],
    ["0020", "space"],
    ["007F", "delete"],
    ["00A0", "no-break space"],
    ["2028", "line separator"],
    ["2029", "paragraph separator"],
    ["2007", "figure space"],
    ["3000", "ideographic space"],
    ["200B", "zero-width space"],
    ["200C", "zero-width non-joiner"],
    ["200D", "zero-width joiner"],
    ["200E", "left-to-right mark"],
    ["200F", "right-to-left mark"],
    ["202A", "left-to-right embedding"],
    ["202E", "right-to-left override"],
    ["2066", "left-to-right isolate"],
    ["2069", "pop directional isolate"],
    ["FEFF", "byte order mark"],
  ])("claims a tinydocy: href hiding U+%s (%s)", (hex) => {
    const char = String.fromCharCode(Number.parseInt(hex, 16));
    for (const href of [
      `${char}tinydocy:doc/${KEY}`,
      `tiny${char}docy:doc/${KEY}`,
      `TinyDocy${char}:doc/${KEY}`,
      `${char}${char}TINYDOCY${char}:here#${TOC}`,
    ]) {
      expect(isOurScheme(href)).toBe(true);
      expect(parseDocLink(href)).toBeNull();
    }
  });
});

describe("isWebLink", () => {
  it.each([
    "https://a.b",
    "http://a.b",
    "mailto:a@b.c",
    " HTTPS://a.b",
    "ht\ttps://a.b",
  ])("allows %p", (href) => expect(isWebLink(href)).toBe(true));
  it.each([
    "ms-msdt:x",
    "search-ms:x",
    "smb://a",
    "vscode://a",
    "tinydocy:doc/x",
    "ftp://a",
    "javascript:alert(1)",
    "\u0001https://a.b",
    "/relative",
    "#top",
    "",
  ])("refuses %p", (href) => expect(isWebLink(href)).toBe(false));
});
