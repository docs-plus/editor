import { describe, expect, it } from "bun:test";

import {
  buildListRows,
  compareManual,
  dateBucket,
  type ListRow,
} from "@/lib/library/list-rows";
import { resolveListView } from "@/lib/library/list-view";
import type {
  DocumentEntry,
  LibraryIndexSnapshot,
  ListViewPrefs,
} from "@/lib/platform/document-index";

// Wednesday 2026-11-18, 15:00 local time.
const NOW = new Date(2026, 10, 18, 15, 0, 0).getTime();
const at = (month: number, day: number, hour = 12) =>
  new Date(2026, month, day, hour).getTime();

const doc = (
  id: string,
  title: string,
  extra: Partial<DocumentEntry> = {},
): DocumentEntry => ({ id, title, createdAt: 1, ...extra });

function snapshot(
  items: DocumentEntry[],
  extra: Partial<LibraryIndexSnapshot> = {},
): LibraryIndexSnapshot {
  return {
    rev: 1,
    ready: true,
    items,
    folders: [
      { id: "f-work", name: "Work", parentId: null, createdAt: 1 },
      { id: "f-q4", name: "Q4", parentId: "f-work", createdAt: 1 },
      { id: "f-cafe", name: "Café", parentId: null, createdAt: 1 },
    ],
    trashCount: 0,
    tags: [
      { id: "t-fin", name: "finance", color: null },
      { id: "t-plan", name: "Planning", color: null },
    ],
    listViews: {},
    trash: [],
    ...extra,
  };
}

const keys = (rows: readonly ListRow[]) =>
  rows.map((row) => (row.kind === "group" ? `# ${row.label}` : row.key));

const view = (prefs: Partial<ListViewPrefs> = {}): ListViewPrefs => ({
  sort: "title",
  descending: false,
  view: "list",
  group: "none",
  ...prefs,
});

const NO_FILTER = { text: "", tagIds: [] };

describe("buildListRows: what a place lists", () => {
  const items = [
    doc("a", "Alpha"),
    doc("b", "beta", { folderId: "f-work" }),
    doc("c", "Gamma", { folderId: "f-q4", openedAt: at(10, 18) }),
    doc("d", "Delta", { pinKey: "p2", openedAt: at(10, 17) }),
    doc("e", "Echo", { pinKey: "p1", tagIds: ["t-fin"] }),
  ];
  const snap = snapshot(items);
  const build = (place: Parameters<typeof resolveListView>[0]) =>
    keys(
      buildListRows({
        snapshot: snap,
        place,
        prefs: resolveListView(place, {}),
        filter: NO_FILTER,
        now: NOW,
      }).rows,
    );

  it("the Library root: its folders first, then its documents", () => {
    expect(build({ kind: "library" })).toEqual([
      "folder:f-cafe",
      "folder:f-work",
      "doc:a",
      "doc:d",
      "doc:e",
    ]);
  });

  it("a folder: its subfolders and documents", () => {
    expect(build({ kind: "folder", id: "f-work" })).toEqual([
      "folder:f-q4",
      "doc:b",
    ]);
  });

  it("Recent: opened documents, grouped by date", () => {
    const rows = buildListRows({
      snapshot: snap,
      place: { kind: "recent" },
      prefs: view({ sort: "opened", descending: true, group: "date" }),
      filter: NO_FILTER,
      now: NOW,
    }).rows;
    expect(keys(rows)).toEqual(["# Today", "doc:c", "# Yesterday", "doc:d"]);
  });

  it("Pinned: in pin order", () => {
    expect(build({ kind: "pinned" })).toEqual(["doc:e", "doc:d"]);
  });

  it("a tag: its documents", () => {
    expect(build({ kind: "tag", id: "t-fin" })).toEqual(["doc:e"]);
  });

  it("Trash: trashed documents and folders, newest first", () => {
    const rows = buildListRows({
      snapshot: snapshot([], {
        trash: [
          {
            kind: "doc",
            id: "x",
            title: "Old",
            trashedAt: 1,
            folderId: "f-gone",
          },
          {
            kind: "folder",
            id: "f-z",
            name: "Drafts",
            trashedAt: 5,
            parentId: "f-work",
            docCount: 2,
          },
        ],
      }),
      place: { kind: "trash" },
      prefs: view(),
      filter: NO_FILTER,
      now: NOW,
    }).rows;
    expect(keys(rows)).toEqual(["trash:folder:f-z", "trash:doc:x"]);
    const [folderRow, docRow] = rows;
    expect(folderRow.kind === "trash" && folderRow.location).toBe("Work");
    expect(docRow.kind === "trash" && docRow.location).toBe("Library");
  });
});

describe("buildListRows: sort", () => {
  const items = [
    doc("a", "item 10", { createdAt: 3, modifiedAt: 30 }),
    doc("b", "Item 9", { createdAt: 1, modifiedAt: 10 }),
    doc("c", "", { createdAt: 2, modifiedAt: 20, openedAt: 5 }),
  ];
  const sorted = (prefs: Partial<ListViewPrefs>) =>
    keys(
      buildListRows({
        snapshot: snapshot(items, { folders: [] }),
        place: { kind: "library" },
        prefs: view(prefs),
        filter: NO_FILTER,
        now: NOW,
      }).rows,
    );

  it("by title as people read it, Untitled included", () => {
    expect(sorted({ sort: "title" })).toEqual(["doc:b", "doc:a", "doc:c"]);
    expect(sorted({ sort: "title", descending: true })).toEqual([
      "doc:c",
      "doc:a",
      "doc:b",
    ]);
  });

  it("by dates", () => {
    expect(sorted({ sort: "modified", descending: true })).toEqual([
      "doc:a",
      "doc:c",
      "doc:b",
    ]);
    expect(sorted({ sort: "created" })).toEqual(["doc:b", "doc:c", "doc:a"]);
  });

  it("never-opened documents last, either way", () => {
    expect(sorted({ sort: "opened", descending: true })[0]).toBe("doc:c");
    expect(sorted({ sort: "opened" })[0]).toBe("doc:c");
  });

  it("Manual: sort keys first, then the rest oldest first", () => {
    const manual = [
      doc("x", "X", { createdAt: 1 }),
      doc("y", "Y", { createdAt: 2, sortKey: "m2" }),
      doc("z", "Z", { createdAt: 3, sortKey: "m1" }),
    ];
    expect([...manual].sort(compareManual).map((d) => d.id)).toEqual([
      "z",
      "y",
      "x",
    ]);
  });
});

describe("buildListRows: filter (metadata only, D24)", () => {
  const items = [
    doc("plan", "Q4 plan", { folderId: "f-q4", tagIds: ["t-plan"] }),
    doc("menu", "Menu", { folderId: "f-cafe", tagIds: ["t-fin"] }),
    doc("fa", "گزارش ۱۴۰۳", { tagIds: ["t-fin", "t-plan"] }),
    doc("body", "Notes", { snippet: "q4 plan inside the body" }),
  ];
  const filtered = (
    filter: { text?: string; tagIds?: string[]; since?: number },
    place: Parameters<typeof resolveListView>[0] = { kind: "recent" },
  ) =>
    buildListRows({
      snapshot: snapshot(
        items.map((item) => ({ ...item, openedAt: 1, modifiedAt: at(10, 1) })),
      ),
      place,
      prefs: view(),
      filter: { text: "", tagIds: [], ...filter },
      now: NOW,
    });

  it("matches titles, ignoring accents, case and digit shape", () => {
    expect(keys(filtered({ text: "1403" }).rows)).toEqual(["doc:fa"]);
    expect(keys(filtered({ text: "q4 PL" }).rows)).toEqual(["doc:plan"]);
  });

  it("matches tag and folder names, never the snippet", () => {
    expect(keys(filtered({ text: "cafe" }).rows)).toEqual(["doc:menu"]);
    expect(keys(filtered({ text: "planning" }).rows)).toEqual([
      "doc:plan",
      "doc:fa",
    ]);
    expect(keys(filtered({ text: "inside" }).rows)).toEqual([]);
  });

  it("combines tags with AND and hides folders", () => {
    expect(keys(filtered({ tagIds: ["t-fin", "t-plan"] }).rows)).toEqual([
      "doc:fa",
    ]);
    expect(
      keys(filtered({ tagIds: ["t-fin"] }, { kind: "library" }).rows),
    ).toEqual(["doc:fa"]);
  });

  it("keeps folder rows that match the text", () => {
    expect(keys(filtered({ text: "caf" }, { kind: "library" }).rows)).toEqual([
      "folder:f-cafe",
    ]);
  });

  it("filters by modified date", () => {
    expect(filtered({ since: at(10, 2) }).rows).toEqual([]);
    expect(filtered({ since: at(9, 30) }).rows).toHaveLength(4);
  });

  it("marks the matched title text and counts the place", () => {
    const result = filtered({ text: "plan" });
    const [row] = result.rows;
    expect(row.kind === "doc" && row.titleRanges).toEqual([[3, 7]]);
    expect(result.total).toBe(4);
  });
});

describe("dateBucket", () => {
  const week = 1; // Monday
  it("today, yesterday, this week, this month, earlier", () => {
    expect(dateBucket(at(10, 18, 0), NOW, week)).toBe("today");
    expect(dateBucket(at(10, 19), NOW, week)).toBe("today"); // clock skew
    expect(dateBucket(at(10, 17, 23), NOW, week)).toBe("yesterday");
    expect(dateBucket(at(10, 16, 1), NOW, week)).toBe("week");
    expect(dateBucket(at(10, 15, 23), NOW, week)).toBe("month");
    expect(dateBucket(at(10, 1), NOW, week)).toBe("month");
    expect(dateBucket(at(9, 31, 23), NOW, week)).toBe("earlier");
  });

  it("follows the locale's first day of the week", () => {
    // Sunday 15 Nov is this week when weeks start on Sunday.
    expect(dateBucket(at(10, 15), NOW, 0)).toBe("week");
    expect(dateBucket(at(10, 15), NOW, 1)).toBe("month");
  });

  it("puts a week that began last month under this week", () => {
    const wednesday = new Date(2026, 11, 2, 9).getTime(); // from Mon 30 Nov
    expect(dateBucket(at(11, 1, 8), wednesday, 1)).toBe("yesterday");
    expect(dateBucket(at(10, 30, 8), wednesday, 1)).toBe("week");
    expect(dateBucket(at(10, 29, 8), wednesday, 1)).toBe("earlier");
  });
});

describe("buildListRows: grouping", () => {
  const items = [
    doc("t", "Today doc", { modifiedAt: at(10, 18, 9) }),
    doc("w", "Week doc", { modifiedAt: at(10, 16) }),
    doc("o", "Old doc", { modifiedAt: at(5, 1) }),
    doc("y", "Yesterday doc", { modifiedAt: at(10, 17) }),
  ];
  const grouped = (prefs: Partial<ListViewPrefs>) =>
    keys(
      buildListRows({
        snapshot: snapshot(items, { folders: [] }),
        place: { kind: "library" },
        prefs: view({ group: "date", ...prefs }),
        filter: NO_FILTER,
        now: NOW,
        weekStart: 1,
      }).rows,
    );

  it("by the sort's date, newest group first", () => {
    expect(grouped({ sort: "modified", descending: true })).toEqual([
      "# Today",
      "doc:t",
      "# Yesterday",
      "doc:y",
      "# This week",
      "doc:w",
      "# Earlier",
      "doc:o",
    ]);
  });

  it("by Modified, keeping title order inside a group, when sorted by title", () => {
    expect(grouped({ sort: "title" })[0]).toBe("# Today");
  });

  it("puts folders in their own group", () => {
    const rows = buildListRows({
      snapshot: snapshot(items),
      place: { kind: "library" },
      prefs: view({ group: "date", sort: "modified", descending: true }),
      filter: NO_FILTER,
      now: NOW,
    }).rows;
    expect(keys(rows).slice(0, 3)).toEqual([
      "# Folders",
      "folder:f-cafe",
      "folder:f-work",
    ]);
  });

  it("by folder, in Recent", () => {
    const rows = buildListRows({
      snapshot: snapshot([
        doc("a", "A", { openedAt: 1, folderId: "f-q4" }),
        doc("b", "B", { openedAt: 2 }),
        doc("c", "C", { openedAt: 3, folderId: "f-q4" }),
      ]),
      place: { kind: "recent" },
      prefs: view({ group: "folder" }),
      filter: NO_FILTER,
      now: NOW,
    }).rows;
    expect(keys(rows)).toEqual([
      "# Library",
      "doc:b",
      "# Work › Q4",
      "doc:a",
      "doc:c",
    ]);
  });
});
