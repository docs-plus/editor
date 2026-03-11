import type { Node as PMNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import { ReplaceStep } from "@tiptap/pm/transform";

/**
 * Check if a transaction is safe for `DecorationSet.map()` on heading
 * node decorations.
 *
 * `DecorationSet.map()` correctly remaps positions for content-only edits
 * (typing, backspace within a block) — the decoration's `to` shifts by
 * exactly the same amount as the node grows, preserving the boundary match.
 *
 * It breaks for structural changes:
 *  - **Splits** (Enter): `slice.openStart > 0` inserts a sibling node,
 *    shifting `to` past it while the original node doesn't grow.
 *  - **Joins** (Backspace at block start): deletion crosses a node boundary,
 *    collapsing two nodes into one with a mismatched decoration range.
 *  - **Moves** (drag): delete + insert in separate steps — decorations are
 *    removed at the old position, not created at the new one.
 *  - **Heading insertion** (paste): new headings need new decorations that
 *    `map()` cannot create.
 *
 * Returns true only for single-step content-only edits where `map()` is
 * guaranteed to produce correct decoration boundaries.
 */
export function canMapDecorations(tr: Transaction, oldDoc: PMNode): boolean {
  if (tr.steps.length !== 1) return false;

  const step = tr.steps[0];
  if (!(step instanceof ReplaceStep)) return false;

  const { slice } = step;
  if (slice.openStart > 0 || slice.openEnd > 0) return false;

  if (step.from !== step.to) {
    const $from = oldDoc.resolve(step.from);
    const $to = oldDoc.resolve(step.to);
    if (!$from.sameParent($to)) return false;
  }

  for (let i = 0; i < slice.content.childCount; i++) {
    if (slice.content.child(i).type.name === "heading") return false;
  }
  return true;
}
