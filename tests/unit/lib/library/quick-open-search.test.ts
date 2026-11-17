import { describe, expect, it } from "bun:test";

import { searchDocuments } from "@/lib/library/quick-open-search";
import type { DocumentEntry, FolderEntry } from "@/lib/platform/document-index";

const folders: FolderEntry[] = [
  { id: "w", name: "Work", parentId: null, createdAt: 0 },
  { id: "q", name: "Q4 Café", parentId: "w", createdAt: 0 },
];
const doc = (
  id: string,
  title: string,
  extra: Partial<DocumentEntry> = {},
): DocumentEntry => ({ id, title, createdAt: 0, ...extra });

const items = [
  doc("plan", "Q4 plan", { folderId: "q", openedAt: 10 }),
  doc("retro", "Q4 retro notes", { openedAt: 30 }),
  doc("explain", "Explanation", { openedAt: 50 }),
  doc("budget", "Budget", { folderId: "q" }),
  doc("fa", "گزارش كتاب ۱۴۰۳"),
  doc("old", "Old notes", { openedAt: 5 }),
];

const ids = (query: string, limit?: number) =>
  searchDocuments({ items, folders }, query, { limit }).map((r) => r.id);

describe("searchDocuments (UX §4.3, D24)", () => {
  it("lists the most recently opened for an empty query", () => {
    expect(ids("", 3)).toEqual(["explain", "retro", "plan"]);
  });

  it("puts word-prefix title matches before substrings", () => {
    expect(ids("plan")).toEqual(["plan", "explain"]);
  });

  it("ties go to the most recently opened", () => {
    expect(ids("q4")).toEqual(["retro", "plan", "budget"]);
  });

  it("matches folder names after titles, accents and case ignored", () => {
    // "budget" matches only by its folder; "plan" by title and folder.
    expect(ids("cafe")).toEqual(["plan", "budget"]);
  });

  it("needs every term, in the title or the folder path", () => {
    expect(ids("work budget")).toEqual(["budget"]);
    expect(ids("q4 notes")).toEqual(["retro"]);
    expect(ids("budget zebra")).toEqual([]);
  });

  it("folds Arabic letters and digits", () => {
    expect(ids("كتاب")).toEqual(["fa"]);
    expect(ids("1403")).toEqual(["fa"]);
    expect(ids("گزارش ١٤٠٣")).toEqual(["fa"]);
  });

  it("returns highlight ranges in the original title and the folder path", () => {
    const [plan] = searchDocuments({ items, folders }, "cafe pla");
    expect(plan.title).toBe("Q4 plan");
    expect(plan.titleRanges).toEqual([[3, 6]]);
    expect(plan.path).toEqual(["Work", "Q4 Café"]);
    expect(plan.matchedFolder).toBe(true);
    expect(plan.pathRanges).toEqual([[], [[3, 7]]]);
  });

  it("shows Untitled for a blank title", () => {
    const result = searchDocuments(
      { items: [doc("x", "  ")], folders: [] },
      "untitled",
    );
    expect(result.map((r) => r.title)).toEqual(["Untitled"]);
  });
});
