import { blockActions } from "@/lib/editor-actions/core/blocks";
import { inlineActions } from "@/lib/editor-actions/core/inline";
import { slotActions } from "@/lib/editor-actions/core/slot";
import type { AnyAction } from "@/lib/editor-actions/types";

/**
 * PR D1 actions. Id prefixes: history. style. mark. format. list. align.
 * indent. section. table. code. mermaid. media. view.
 * Bodies live in `core/`: inline (history, marks, link, clear formatting),
 * blocks (style, list, align, indent) and slot (section, table, code,
 * Mermaid, media, view).
 */
export const coreActions: readonly AnyAction[] = [
  ...inlineActions,
  ...blockActions,
  ...slotActions,
];
