import { describe, expect, it } from "bun:test";

import {
  DIAGRAM_CELL,
  insertSheetGroups,
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

/** `buildSlashItems`' shape: Suggested copies first, templates last. */
const ITEMS: SlashItem[] = [
  item("insert.divider", "Suggested", { key: "suggested:insert.divider" }),
  item("style.paragraph", "Text"),
  item("style.heading1", "Text"),
  item("style.heading4", "Text", { searchOnly: true }),
  item("list.bullet", "Lists"),
  item("insert.image", "Insert"),
  item("insert.table", "Insert", { arg: { rows: 3, cols: 3 } }),
  item("insert.quote", "Insert", { reason: "Already in a quote." }),
  item("insert.divider", "Insert", { recent: true }),
  item("template.mermaid:flowchart", "Diagrams", {
    actionId: "template.mermaid",
    lead: true,
  }),
  item("template.mermaid:pie", "Diagrams", { actionId: "template.mermaid" }),
];

const WITHOUT_SUGGESTED = ITEMS.filter((i) => i.section !== "Suggested");

const keys = (items: readonly SlashItem[]) => items.map((i) => i.key);

describe("insertSheetGroups", () => {
  it("titles the block section by whether the caret's block is empty", () => {
    const empty = insertSheetGroups(WITHOUT_SUGGESTED, { emptyBlock: true });
    expect(empty.groups.map((g) => g.title)).toEqual(["Blocks", "Insert"]);
    const text = insertSheetGroups(WITHOUT_SUGGESTED, { emptyBlock: false });
    expect(text.groups.map((g) => g.title)).toEqual(["Turn into", "Insert"]);
  });

  it("keeps the menu's order, drops search-only rows, keeps reasons", () => {
    const { groups, diagrams } = insertSheetGroups(WITHOUT_SUGGESTED, {
      emptyBlock: true,
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

  it("leads with the menu's own Suggested rows; each kind keeps its cell", () => {
    const { groups } = insertSheetGroups(ITEMS, { emptyBlock: true });
    expect(groups.map((g) => g.key)).toEqual(["suggested", "blocks", "insert"]);
    expect(keys(groups[0].items)).toEqual(["suggested:insert.divider"]);
    expect(keys(groups[2].items)).toContain("insert.divider");
  });

  it("seats Diagram ▸ at insert.mermaid's place, as the one Diagram cell", () => {
    const diagram = item("insert.mermaid", "Insert", { label: "Diagram" });
    const { groups } = insertSheetGroups(WITHOUT_SUGGESTED, {
      emptyBlock: true,
      diagram,
      insertOrder: [
        "insert.image",
        "insert.table",
        "insert.quote",
        "insert.mermaid",
        "insert.divider",
      ],
    });
    expect(keys(groups[1].items)).toEqual([
      "insert.image",
      "insert.table",
      "insert.quote",
      DIAGRAM_CELL,
      "insert.divider",
    ]);
  });
});
