/**
 * The phone Insert sheet's cells (spec §8.3, O6): the "/" menu's items
 * (`buildSlashItems`) in its sections and order, laid out as a grid.
 * Pure, so the sheet and its unit test share it.
 *
 * - **Suggested** (optional, on top): the "/" menu's own Suggested rows
 *   (`buildSlashItems` with the recent kinds, `MAX_SUGGESTED`); a kind
 *   there also stays in its own section.
 * - **Blocks** or **Turn into**: the menu's Text and Lists. The same
 *   actions either way; the title says whether the caret's block is empty
 *   (converted in place) or has text (turned into that style).
 * - **Insert**: the menu's Insert kinds, inserted after the caret's block.
 *   Diagram templates (the menu's Diagrams) are one "Diagram ▸" cell whose
 *   step lists them.
 *
 * Unlike the menu, items that cannot run here stay, with their reason on
 * a second line (dp:207), so the fixed sections never move.
 */
import type { SlashItem } from "@/lib/slash-menu/slash-items";

export interface InsertSheetGroup {
  key: "suggested" | "blocks" | "insert";
  title: string;
  items: readonly SlashItem[];
}

/** The key of the "Diagram ▸" cell, which opens the templates step. */
export const DIAGRAM_CELL = "diagram";

export function insertSheetGroups(
  items: readonly SlashItem[],
  {
    emptyBlock,
    insertOrder = [],
    diagram = null,
  }: {
    emptyBlock: boolean;
    /** The registry's insert ids in order, to seat the Diagram ▸ cell. */
    insertOrder?: readonly string[];
    /**
     * The Diagram ▸ cell (label and icon of `insert.mermaid`), shown in
     * place of the templates when there are any.
     */
    diagram?: SlashItem | null;
  },
): { groups: InsertSheetGroup[]; diagrams: SlashItem[] } {
  const shown = items.filter((item) => !item.searchOnly);
  const of = (...sections: SlashItem["section"][]) =>
    shown.filter((item) => sections.includes(item.section));
  const suggested = of("Suggested");
  const blocks = of("Text", "Lists");
  const diagrams = of("Diagrams");
  const inserts = of("Insert");
  // At `insert.mermaid`'s own place, where the one Diagram cell sits before
  // the templates load: the Insert section never reorders.
  if (diagrams.length && diagram) {
    const rank = (item: SlashItem) => insertOrder.indexOf(item.actionId);
    const at = inserts.findIndex((item) => rank(item) > rank(diagram));
    inserts.splice(at < 0 ? inserts.length : at, 0, {
      ...diagram,
      key: DIAGRAM_CELL,
    });
  }
  const groups: InsertSheetGroup[] = [
    {
      key: "blocks",
      title: emptyBlock ? "Blocks" : "Turn into",
      items: blocks,
    },
    { key: "insert", title: "Insert", items: inserts },
  ];
  if (suggested.length) {
    groups.unshift({ key: "suggested", title: "Suggested", items: suggested });
  }
  return { groups, diagrams };
}
