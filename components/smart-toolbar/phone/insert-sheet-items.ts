/**
 * The phone Insert sheet's cells (spec §8.3, O6): the "/" menu's items
 * (`buildSlashItems`) in its sections and order, laid out as a grid.
 * Pure, so the sheet and its unit test share it.
 *
 * - **Suggested** (optional, on top): up to three recent insert kinds; a
 *   kind there also stays in its own section, as in the "/" menu.
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
import type { InsertKind } from "@/lib/remembered-choice";
import type { SlashItem } from "@/lib/slash-menu/slash-items";

/** Suggested shows at most this many kinds (O12 a). */
export const MAX_SUGGESTED = 3;

export interface InsertSheetGroup {
  key: "suggested" | "blocks" | "insert";
  title: string;
  items: readonly SlashItem[];
}

/**
 * The remembered insert kinds, newest first: the recent list, else the one
 * last kind (while `INSERT_KIND_CHOICE` keeps no recents), else none.
 */
export function suggestedKinds(choice: {
  last: InsertKind | null;
  recent: readonly (InsertKind | null)[];
}): InsertKind[] {
  const { last, recent } = choice;
  const kinds = recent.length ? recent : last ? [last] : [];
  return kinds.filter((kind): kind is InsertKind => kind !== null);
}

/** The built item for a remembered kind; a diagram is its last template. */
function itemOfKind(items: readonly SlashItem[], kind: InsertKind) {
  return (
    items.find((item) => item.actionId === `insert.${kind}`) ??
    (kind === "mermaid"
      ? items.find((item) => item.section === "Diagrams" && item.lead)
      : undefined)
  );
}

export function insertSheetGroups(
  items: readonly SlashItem[],
  { emptyBlock, kinds }: { emptyBlock: boolean; kinds: readonly InsertKind[] },
): { groups: InsertSheetGroup[]; diagrams: SlashItem[] } {
  const shown = items.filter((item) => !item.searchOnly);
  const blocks = shown.filter(
    (item) => item.section === "Text" || item.section === "Lists",
  );
  const inserts = shown.filter((item) => item.section === "Insert");
  const diagrams = shown.filter((item) => item.section === "Diagrams");
  const suggested: SlashItem[] = [];
  for (const kind of kinds) {
    const found = itemOfKind(shown, kind);
    if (found && !suggested.includes(found)) suggested.push(found);
    if (suggested.length === MAX_SUGGESTED) break;
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
