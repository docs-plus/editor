import { describe, expect, it } from "bun:test";

import {
  insertSheetGroups,
  suggestedKinds,
} from "@/components/smart-toolbar/phone/insert-sheet-items";
import type { SlashItem, SlashSection } from "@/lib/slash-menu/slash-items";

const item = (
  actionId: string,
  section: SlashSection,
  extra: Partial<SlashItem> = {},
): SlashItem => ({
  key: actionId,
  actionId,
  label: actionId,
  keywords: [],
  section,
  ...extra,
});

/** `buildSlashItems`' shape: registry order, templates last. */
const ITEMS: SlashItem[] = [
  item("style.paragraph", "Text"),
  item("style.heading1", "Text"),
  item("style.heading4", "Text", { searchOnly: true }),
  item("list.bullet", "Lists"),
  item("insert.image", "Insert"),
  item("insert.table", "Insert", { arg: { rows: 3, cols: 3 } }),
  item("insert.quote", "Insert", { reason: "Already in a quote." }),
  item("insert.divider", "Insert"),
  item("template.mermaid:flowchart", "Diagrams", {
    actionId: "template.mermaid",
    lead: true,
  }),
  item("template.mermaid:pie", "Diagrams", { actionId: "template.mermaid" }),
];

const keys = (items: readonly SlashItem[]) => items.map((i) => i.key);

describe("suggestedKinds", () => {
  it("prefers the recent kinds, else the last one, else none", () => {
    expect(
      suggestedKinds({ last: "table", recent: ["divider", "image"] }),
    ).toEqual(["divider", "image"]);
    expect(suggestedKinds({ last: "table", recent: [] })).toEqual(["table"]);
    expect(suggestedKinds({ last: null, recent: [] })).toEqual([]);
    expect(suggestedKinds({ last: null, recent: [null, "quote"] })).toEqual([
      "quote",
    ]);
  });
});

describe("insertSheetGroups", () => {
  it("titles the block section by whether the caret's block is empty", () => {
    const empty = insertSheetGroups(ITEMS, { emptyBlock: true, kinds: [] });
    expect(empty.groups.map((g) => g.title)).toEqual(["Blocks", "Insert"]);
    const text = insertSheetGroups(ITEMS, { emptyBlock: false, kinds: [] });
    expect(text.groups.map((g) => g.title)).toEqual(["Turn into", "Insert"]);
  });

  it("keeps the menu's order, drops search-only rows, keeps reasons", () => {
    const { groups, diagrams } = insertSheetGroups(ITEMS, {
      emptyBlock: true,
      kinds: [],
    });
    expect(keys(groups[0].items)).toEqual([
      "style.paragraph",
      "style.heading1",
      "list.bullet",
    ]);
    expect(keys(groups[1].items)).toEqual([
      "insert.image",
      "insert.table",
      "insert.quote",
      "insert.divider",
    ]);
    expect(groups[1].items[2].reason).toBe("Already in a quote.");
    expect(keys(diagrams)).toEqual([
      "template.mermaid:flowchart",
      "template.mermaid:pie",
    ]);
  });

  it("puts Suggested first, also leaving each kind in its own section", () => {
    const { groups } = insertSheetGroups(ITEMS, {
      emptyBlock: true,
      kinds: ["divider", "embed", "mermaid", "table"],
    });
    expect(groups.map((g) => g.key)).toEqual(["suggested", "blocks", "insert"]);
    // Embed is not built here (no item): skipped. A diagram is the last
    // used template.
    expect(keys(groups[0].items)).toEqual([
      "insert.divider",
      "template.mermaid:flowchart",
      "insert.table",
    ]);
    expect(keys(groups[2].items)).toContain("insert.divider");
  });

  it("caps Suggested at three", () => {
    const { groups } = insertSheetGroups(ITEMS, {
      emptyBlock: true,
      kinds: ["divider", "image", "table", "quote"],
    });
    expect(keys(groups[0].items)).toEqual([
      "insert.divider",
      "insert.image",
      "insert.table",
    ]);
  });
});
