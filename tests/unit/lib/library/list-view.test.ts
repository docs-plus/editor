import { describe, expect, it } from "bun:test";

import {
  cleanListViewPrefs,
  decodeListViewColumns,
  encodeListViewColumns,
  groupOptions,
  listPlaceKey,
  resolveListView,
  sortOptions,
} from "@/lib/library/list-view";

describe("listPlaceKey", () => {
  it("names every place", () => {
    expect(listPlaceKey({ kind: "library" })).toBe("library");
    expect(listPlaceKey({ kind: "recent" })).toBe("recent");
    expect(listPlaceKey({ kind: "pinned" })).toBe("pinned");
    expect(listPlaceKey({ kind: "trash" })).toBe("trash");
    expect(listPlaceKey({ kind: "folder", id: "f1" })).toBe("folder:f1");
    expect(listPlaceKey({ kind: "tag", id: "t1" })).toBe("tag:t1");
  });
});

describe("resolveListView", () => {
  it("defaults folders to Title, List, no groups (details §6.3)", () => {
    expect(resolveListView({ kind: "folder", id: "f" }, {})).toEqual({
      sort: "title",
      descending: false,
      view: "list",
      group: "none",
    });
  });

  it("defaults Recent to Modified, newest first, by date", () => {
    expect(resolveListView({ kind: "recent" }, {})).toEqual({
      sort: "modified",
      descending: true,
      view: "list",
      group: "date",
    });
  });

  it("defaults Pinned to its own order", () => {
    expect(resolveListView({ kind: "pinned" }, {}).sort).toBe("manual");
  });

  it("applies what was saved for that place only", () => {
    const saved = { "folder:a": { view: "preview" as const } };
    expect(resolveListView({ kind: "folder", id: "a" }, saved).view).toBe(
      "preview",
    );
    expect(resolveListView({ kind: "folder", id: "b" }, saved).view).toBe(
      "list",
    );
  });

  it("ignores choices the place doesn't offer", () => {
    const saved = {
      recent: { sort: "manual" as const, group: "folder" as const },
      library: { group: "folder" as const },
    };
    expect(resolveListView({ kind: "recent" }, saved).sort).toBe("modified");
    expect(resolveListView({ kind: "recent" }, saved).group).toBe("folder");
    expect(resolveListView({ kind: "library" }, saved).group).toBe("none");
  });
});

describe("options", () => {
  it("offers Manual in folders and Pinned, not in Recent or tags", () => {
    expect(sortOptions({ kind: "library" })).toContain("manual");
    expect(sortOptions({ kind: "pinned" })).toContain("manual");
    expect(sortOptions({ kind: "recent" })).not.toContain("manual");
    expect(sortOptions({ kind: "tag", id: "t" })).not.toContain("manual");
  });

  it("offers By folder only in lists that span folders", () => {
    expect(groupOptions({ kind: "recent" })).toContain("folder");
    expect(groupOptions({ kind: "tag", id: "t" })).toContain("folder");
    expect(groupOptions({ kind: "folder", id: "f" })).not.toContain("folder");
  });
});

describe("cleanListViewPrefs", () => {
  it("keeps known values and drops the rest", () => {
    expect(
      cleanListViewPrefs({
        sort: "size",
        descending: "yes",
        view: "preview",
        group: "date",
      } as never),
    ).toEqual({ view: "preview", group: "date" });
  });
});

describe("folders columns", () => {
  it("round-trips through folders.sort, view and group", () => {
    const prefs = {
      sort: "created" as const,
      descending: true,
      view: "preview" as const,
      group: "date" as const,
    };
    const columns = encodeListViewColumns(prefs);
    expect(columns).toEqual({
      sort: "created desc",
      view: "preview",
      group: "date",
    });
    expect(decodeListViewColumns(columns)).toEqual(prefs);
  });

  it("stores nulls for unset choices and reads junk as unset", () => {
    expect(encodeListViewColumns({})).toEqual({
      sort: null,
      view: null,
      group: null,
    });
    expect(
      decodeListViewColumns({ sort: "size up", view: "grid", group: null }),
    ).toEqual({});
  });
});
