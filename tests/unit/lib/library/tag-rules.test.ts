import { describe, expect, it } from "bun:test";

import {
  cleanTagName,
  findTagByName,
  MAX_TAGS_PER_DOC,
  TAG_NAME_MAX,
  tagNameKey,
} from "@/lib/library/tag-rules";

describe("cleanTagName", () => {
  it("trims and collapses spaces", () => {
    expect(cleanTagName("  q4   plans ")).toBe("q4 plans");
  });

  it("caps at 40 characters without splitting a character", () => {
    expect(TAG_NAME_MAX).toBe(40);
    expect(cleanTagName("a".repeat(50))).toHaveLength(40);
    const emoji = `${"a".repeat(39)}😀😀`;
    expect(Array.from(cleanTagName(emoji))).toHaveLength(40);
  });

  it("is empty for blank names", () => {
    expect(cleanTagName("   ")).toBe("");
  });
});

describe("tagNameKey", () => {
  it("ignores case, beyond ASCII too", () => {
    expect(tagNameKey("Plans")).toBe(tagNameKey("plans"));
    expect(tagNameKey("ÄRGER")).toBe(tagNameKey("ärger"));
  });

  it("treats composed and decomposed text as one name", () => {
    expect(tagNameKey("Café")).toBe(tagNameKey("Café"));
  });

  it("keeps accented and plain letters apart", () => {
    expect(tagNameKey("café")).not.toBe(tagNameKey("cafe"));
  });
});

describe("findTagByName", () => {
  const tags = [
    { id: "t1", name: "Planning", color: null },
    { id: "t2", name: "Finance", color: null },
  ];

  it("finds by key", () => {
    expect(findTagByName(tags, " planning ")?.id).toBe("t1");
    expect(findTagByName(tags, "plan")).toBeUndefined();
  });

  it("limits documents to 20 tags", () => {
    expect(MAX_TAGS_PER_DOC).toBe(20);
  });
});
