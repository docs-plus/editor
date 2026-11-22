import { describe, expect, it } from "bun:test";

import { consentLinksLine } from "@/lib/links/consent";
import { LINK_COPY } from "@/lib/links/link-copy";

describe("consentLinksLine", () => {
  it("is null when no link will become plain text", () => {
    expect(consentLinksLine(0)).toBeNull();
    expect(consentLinksLine(-1)).toBeNull();
  });

  it("uses the central §8 copy", () => {
    expect(consentLinksLine(1)).toBe(LINK_COPY.consent(1));
    expect(consentLinksLine(3)).toBe(LINK_COPY.consent(3));
  });

  it("names the count, singular and plural (spec §8 copy)", () => {
    expect(consentLinksLine(1)).toBe(
      "1 link to your other documents will become plain text.",
    );
    expect(consentLinksLine(3)).toBe(
      "3 links to your other documents will become plain text.",
    );
    expect(LINK_COPY.keepLinks).toBe("Keep Links");
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
