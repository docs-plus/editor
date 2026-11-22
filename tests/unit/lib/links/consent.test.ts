import { describe, expect, it } from "bun:test";

import { consentLinksLine, countLinkedDocuments } from "@/lib/links/consent";
import type { LinkRow } from "@/lib/links/extract-links";
import { LINK_COPY } from "@/lib/links/link-copy";

const KEY_A = "0123456789abcdef0123456789abcdef";
const KEY_B = "fedcba9876543210fedcba9876543210";
const TOC_1 = "11111111-1111-4111-8111-111111111111";

function row(key: string, tocId: string | null = null): LinkRow {
  return { srcTocId: null, key, tocId, text: "t", context: "t" };
}

describe("countLinkedDocuments", () => {
  it("is 0 without links", () => {
    expect(countLinkedDocuments([])).toBe(0);
  });

  it("counts distinct documents, not links or headings", () => {
    expect(
      countLinkedDocuments([
        row(KEY_A),
        row(KEY_A, TOC_1),
        row(KEY_B),
        row(KEY_B),
      ]),
    ).toBe(2);
  });
});

describe("consentLinksLine", () => {
  it("is null when the document links to none of yours", () => {
    expect(consentLinksLine(0)).toBeNull();
    expect(consentLinksLine(-1)).toBeNull();
  });

  it("uses the central §8 copy", () => {
    expect(consentLinksLine(1)).toBe(LINK_COPY.consent(1));
    expect(consentLinksLine(3)).toBe(LINK_COPY.consent(3));
  });

  it("names the count (spec §8 copy)", () => {
    expect(consentLinksLine(3)).toBe(
      "This document links to 3 of your documents. People you share with will see the link text but can't open them.",
    );
  });

  it("follows the copy when it changes", () => {
    const copy = LINK_COPY as { consent: (count: number) => string };
    const original = copy.consent;
    copy.consent = (count) => `links:${count}`;
    try {
      expect(consentLinksLine(2)).toBe("links:2");
    } finally {
      copy.consent = original;
    }
  });
});
