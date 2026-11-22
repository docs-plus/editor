import { describe, expect, it } from "bun:test";

import { type DragPayload, dropVerdict } from "@/lib/library/drop-rules";
import type { LibraryIndexSnapshot } from "@/lib/platform/document-index";

const snapshot: LibraryIndexSnapshot = {
  rev: 1,
  ready: true,
  trashCount: 0,
  tags: [],
  listViews: {},
  trash: [],
  folders: [
    { id: "work", name: "Work", parentId: null, createdAt: 0 },
    { id: "q4", name: "Q4", parentId: "work", createdAt: 0 },
    { id: "home", name: "Home", parentId: null, createdAt: 0 },
  ],
  items: [
    { id: "plan", title: "Plan", createdAt: 0, folderId: "q4" },
    { id: "note", title: "Note", createdAt: 0, pinKey: "p1" },
  ],
};

const drag = (payload: Partial<DragPayload>): DragPayload => ({
  items: [],
  label: "",
  ...payload,
});

describe("dropVerdict (details spec §6.1)", () => {
  it("refuses a folder dropped into itself or its descendant", () => {
    const work = drag({ items: [{ kind: "folder", id: "work" }] });
    expect(dropVerdict(snapshot, work, { kind: "folder", id: "work" })).toBe(
      "refused",
    );
    expect(dropVerdict(snapshot, work, { kind: "folder", id: "q4" })).toBe(
      "refused",
    );
    expect(dropVerdict(snapshot, work, { kind: "folder", id: "home" })).toBe(
      "ok",
    );
  });

  it("does nothing when everything is already there", () => {
    const plan = drag({ items: [{ kind: "doc", id: "plan" }] });
    expect(dropVerdict(snapshot, plan, { kind: "folder", id: "q4" })).toBe(
      "noop",
    );
    expect(dropVerdict(snapshot, plan, { kind: "root" })).toBe("ok");
  });

  it("moves several items together, or refuses them all", () => {
    const both = drag({
      items: [
        { kind: "doc", id: "note" },
        { kind: "folder", id: "work" },
      ],
    });
    expect(dropVerdict(snapshot, both, { kind: "folder", id: "q4" })).toBe(
      "refused",
    );
    expect(dropVerdict(snapshot, both, { kind: "folder", id: "home" })).toBe(
      "ok",
    );
  });

  it("pins only documents that aren't pinned yet", () => {
    expect(
      dropVerdict(snapshot, drag({ items: [{ kind: "doc", id: "plan" }] }), {
        kind: "pinned",
      }),
    ).toBe("ok");
    expect(
      dropVerdict(snapshot, drag({ items: [{ kind: "doc", id: "note" }] }), {
        kind: "pinned",
      }),
    ).toBe("noop");
    expect(
      dropVerdict(snapshot, drag({ items: [{ kind: "folder", id: "home" }] }), {
        kind: "pinned",
      }),
    ).toBe("noop");
  });

  it("reorders pins only from the Pinned list", () => {
    const fromPinned = drag({
      items: [{ kind: "doc", id: "note" }],
      fromPinned: true,
    });
    expect(dropVerdict(snapshot, fromPinned, { kind: "pin", id: "x" })).toBe(
      "ok",
    );
    expect(dropVerdict(snapshot, fromPinned, { kind: "pin", id: "note" })).toBe(
      "noop",
    );
    expect(dropVerdict(snapshot, fromPinned, { kind: "root" })).toBe("noop");
  });

  it("takes anything to Trash", () => {
    expect(
      dropVerdict(snapshot, drag({ items: [{ kind: "folder", id: "home" }] }), {
        kind: "trash",
      }),
    ).toBe("ok");
  });
});
