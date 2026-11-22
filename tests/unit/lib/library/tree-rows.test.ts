import { describe, expect, it } from "bun:test";

import {
  buildTreeRows,
  entryTitle,
  itemKey,
  parseItemKey,
} from "@/lib/library/tree-rows";
import type { DocumentEntry, FolderEntry } from "@/lib/platform/document-index";

const folders: FolderEntry[] = [
  { id: "w", name: "Work", parentId: null, createdAt: 0 },
  { id: "a", name: "Archive", parentId: null, createdAt: 0 },
  { id: "q", name: "Q4", parentId: "w", createdAt: 0 },
];
const items: DocumentEntry[] = [
  { id: "d1", title: "zeta", createdAt: 0 },
  { id: "d2", title: "Éclair", createdAt: 0 },
  { id: "d3", title: "Budget", createdAt: 0, folderId: "w" },
  { id: "d4", title: "", createdAt: 0, folderId: "q" },
  { id: "d10", title: "Item 10", createdAt: 0 },
  { id: "d9", title: "Item 9", createdAt: 0 },
];

const shape = (expanded: string[]) =>
  buildTreeRows({ items, folders }, new Set(expanded)).map((row) => [
    row.key,
    row.level,
    row.posInSet,
    row.setSize,
    row.expanded,
  ]);

describe("buildTreeRows", () => {
  it("lists folders first, then documents, each sorted by name", () => {
    expect(shape([])).toEqual([
      ["folder:a", 1, 1, 6, false],
      ["folder:w", 1, 2, 6, false],
      ["doc:d2", 1, 3, 6, undefined],
      ["doc:d9", 1, 4, 6, undefined],
      ["doc:d10", 1, 5, 6, undefined],
      ["doc:d1", 1, 6, 6, undefined],
    ]);
  });

  it("shows the children of expanded folders, one level deeper", () => {
    expect(shape(["w", "q"]).slice(0, 5)).toEqual([
      ["folder:a", 1, 1, 6, false],
      ["folder:w", 1, 2, 6, true],
      ["folder:q", 2, 1, 2, true],
      ["doc:d4", 3, 1, 1, undefined],
      ["doc:d3", 2, 2, 2, undefined],
    ]);
  });

  it("hides children of a collapsed folder even if a child is expanded", () => {
    expect(shape(["q"]).map(([key]) => key)).not.toContain("doc:d4");
  });

  it("knows each row's parent and whether a folder is empty", () => {
    const rows = buildTreeRows({ items, folders }, new Set(["w"]));
    const q = rows.find((row) => row.key === "folder:q");
    expect(q?.parentId).toBe("w");
    expect(q?.empty).toBe(false);
    expect(rows.find((row) => row.key === "folder:a")?.empty).toBe(true);
  });
});

describe("item keys", () => {
  it("round-trips", () => {
    expect(itemKey({ kind: "folder", id: "x" })).toBe("folder:x");
    expect(parseItemKey("doc:a:b")).toEqual({ kind: "doc", id: "a:b" });
    expect(parseItemKey("nope")).toBeNull();
  });
});

describe("entryTitle", () => {
  it("shows Untitled for a blank title", () => {
    expect(entryTitle({ title: "  " })).toBe("Untitled");
    expect(entryTitle({ title: "Plan" })).toBe("Plan");
  });
});
