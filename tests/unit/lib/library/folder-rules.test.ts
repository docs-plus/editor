import { describe, expect, it } from "bun:test";

import {
  canCreateFolderIn,
  checkMove,
  folderDepth,
  folderPath,
  indexFolders,
  isInSubtree,
  MAX_FOLDER_DEPTH,
  moveRefusalMessage,
  subtreeHeight,
} from "@/lib/library/folder-rules";
import type { FolderEntry } from "@/lib/platform/document-index";

const f = (id: string, parentId: string | null): FolderEntry => ({
  id,
  name: id.toUpperCase(),
  parentId,
  createdAt: 0,
});

// a ─ b ─ c ─ d     (4 levels)
// e ─ f
const folders = indexFolders([
  f("a", null),
  f("b", "a"),
  f("c", "b"),
  f("d", "c"),
  f("e", null),
  f("f", "e"),
]);

describe("folder rules (details spec §6.1)", () => {
  it("nests 4 levels", () => {
    expect(MAX_FOLDER_DEPTH).toBe(4);
  });

  it("measures depth from the root and height of a subtree", () => {
    expect(folderDepth(folders, null)).toBe(0);
    expect(folderDepth(folders, "a")).toBe(1);
    expect(folderDepth(folders, "d")).toBe(4);
    expect(subtreeHeight(folders, "a")).toBe(4);
    expect(subtreeHeight(folders, "d")).toBe(1);
    expect(subtreeHeight(folders, "e")).toBe(2);
  });

  it("knows a folder's subtree", () => {
    expect(isInSubtree(folders, "a", "a")).toBe(true);
    expect(isInSubtree(folders, "a", "d")).toBe(true);
    expect(isInSubtree(folders, "b", "a")).toBe(false);
    expect(isInSubtree(folders, "a", null)).toBe(false);
  });

  it("gives the path from the root", () => {
    expect(folderPath(folders, "c").map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(folderPath(folders, null)).toEqual([]);
  });

  it("allows a new folder only above the last level", () => {
    expect(canCreateFolderIn(folders, null)).toBe(true);
    expect(canCreateFolderIn(folders, "c")).toBe(true);
    expect(canCreateFolderIn(folders, "d")).toBe(false);
    expect(canCreateFolderIn(folders, "missing")).toBe(false);
  });

  describe("checkMove", () => {
    it("allows documents anywhere", () => {
      expect(checkMove(folders, [{ kind: "doc", id: "x" }], "d")).toBeNull();
      expect(checkMove(folders, [{ kind: "doc", id: "x" }], null)).toBeNull();
    });

    it("refuses a folder into itself or its descendants", () => {
      const a = [{ kind: "folder", id: "a" }] as const;
      expect(checkMove(folders, a, "a")).toBe("into_itself");
      expect(checkMove(folders, a, "c")).toBe("into_itself");
      expect(checkMove(folders, [{ kind: "folder", id: "b" }], "d")).toBe(
        "into_itself",
      );
    });

    it("refuses nesting deeper than 4 levels", () => {
      // e (height 2) under c (depth 3) would reach level 5.
      expect(checkMove(folders, [{ kind: "folder", id: "e" }], "c")).toBe(
        "too_deep",
      );
      expect(checkMove(folders, [{ kind: "folder", id: "e" }], "b")).toBeNull();
      expect(checkMove(folders, [{ kind: "folder", id: "f" }], "c")).toBeNull();
    });

    it("refuses an unknown destination or folder", () => {
      expect(checkMove(folders, [{ kind: "doc", id: "x" }], "nope")).toBe(
        "not_found",
      );
      expect(checkMove(folders, [{ kind: "folder", id: "nope" }], null)).toBe(
        "not_found",
      );
    });

    it("refuses the whole set when one item is refused", () => {
      expect(
        checkMove(
          folders,
          [
            { kind: "doc", id: "x" },
            { kind: "folder", id: "a" },
          ],
          "b",
        ),
      ).toBe("into_itself");
    });
  });

  it("words each refusal for people", () => {
    expect(moveRefusalMessage("into_itself")).toBe(
      "A folder can't go inside itself.",
    );
    expect(moveRefusalMessage("too_deep")).toBe(
      "Folders can be nested 4 levels deep.",
    );
  });
});
