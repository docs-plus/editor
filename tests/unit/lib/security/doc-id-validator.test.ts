import { describe, expect, it } from "vitest";

import {
  isIsolatedTabsDocumentId,
  isSystemDocumentId,
  isTabsDocumentId,
  isValidUserDocumentId,
  isValidWsDocumentName,
} from "@/lib/security/doc-id-validator";

describe("doc-id-validator (SEC-01)", () => {
  it("treats only the two shared documents as system documents", () => {
    expect(isSystemDocumentId("playground")).toBe(true);
    expect(isSystemDocumentId("global-tabs")).toBe(true);
    expect(isSystemDocumentId("global-tabs-x")).toBe(false);
  });

  it("accepts per-test tab lists only behind the flag", () => {
    expect(isIsolatedTabsDocumentId("global-tabs-x", false)).toBe(false);
    expect(isValidWsDocumentName("global-tabs-test-1-abc", false)).toBe(false);
    expect(isIsolatedTabsDocumentId("global-tabs-x", true)).toBe(true);
    expect(isTabsDocumentId("global-tabs-x", true)).toBe(true);
    expect(isTabsDocumentId("global-tabs", false)).toBe(true);
  });

  it("rejects hostile names even with the flag on", () => {
    for (const name of [
      "global-tabs-\n",
      `global-tabs-${"a".repeat(10_000)}`,
      "global-tabs-../x",
      "global-tabs-<script>",
      "global-tabs-",
    ]) {
      expect(isIsolatedTabsDocumentId(name, true)).toBe(false);
      expect(isValidWsDocumentName(name, true)).toBe(false);
    }
  });

  it("never lets a user document reuse a reserved name", () => {
    expect(isValidUserDocumentId("playground")).toBe(false);
    expect(isValidUserDocumentId("global-tabs")).toBe(false);
    expect(isValidUserDocumentId("global-tabs-abc")).toBe(false);
    expect(isValidUserDocumentId("11111111-1111-1111-1111-111111111111")).toBe(
      true,
    );
    expect(isValidUserDocumentId("test-123-abc")).toBe(true);
  });
});
