import { describe, expect, it } from "vitest";

import {
  loadFoldedIds,
  saveFoldedIds,
} from "@/components/tiptap-node/heading-node/helpers/fold-storage";

describe("fold-storage", () => {
  it("saveFoldedIds + loadFoldedIds → roundtrip Set<string>", () => {
    const docId = "doc-1";
    const ids = new Set(["a", "b", "c"]);
    saveFoldedIds(docId, ids);
    const loaded = loadFoldedIds(docId);
    expect(loaded).toEqual(ids);
  });

  it("loadFoldedIds with no stored data → empty set", () => {
    const loaded = loadFoldedIds("nonexistent");
    expect(loaded).toEqual(new Set());
  });

  it("loadFoldedIds with corrupted JSON → empty set (graceful fallback)", () => {
    const docId = "corrupt-doc";
    localStorage.setItem(`tinydocy-folds-${docId}`, "not valid json {{{");
    const loaded = loadFoldedIds(docId);
    expect(loaded).toEqual(new Set());
  });

  it("different document IDs → independent storage", () => {
    saveFoldedIds("doc-a", new Set(["id1"]));
    saveFoldedIds("doc-b", new Set(["id2"]));
    expect(loadFoldedIds("doc-a")).toEqual(new Set(["id1"]));
    expect(loadFoldedIds("doc-b")).toEqual(new Set(["id2"]));
  });

  it("save empty set → removes from localStorage", () => {
    const docId = "doc-empty";
    saveFoldedIds(docId, new Set(["x"]));
    expect(localStorage.getItem(`tinydocy-folds-${docId}`)).not.toBeNull();
    saveFoldedIds(docId, new Set());
    expect(localStorage.getItem(`tinydocy-folds-${docId}`)).toBeNull();
  });

  it("non-string values in array → filtered out", () => {
    const docId = "doc-filter";
    localStorage.setItem(
      `tinydocy-folds-${docId}`,
      JSON.stringify(["valid", 123, null, { foo: 1 }, "also-valid"]),
    );
    const loaded = loadFoldedIds(docId);
    expect(loaded).toEqual(new Set(["valid", "also-valid"]));
  });
});
