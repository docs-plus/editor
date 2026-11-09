import type { Node as PMNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import { Mapping, type Step } from "@tiptap/pm/transform";

export interface ChangedRange {
  from: number;
  to: number;
}

/**
 * Where a step changed the document when its step map is empty: attribute
 * steps (`pos`) and mark steps (`from`/`to`). `null` for a step with neither
 * (document attributes, or a custom step), which callers must treat as a
 * change anywhere.
 */
function rangeOfMaplessStep(step: Step): ChangedRange | null {
  const { pos, from, to } = step as unknown as Record<string, unknown>;
  if (typeof pos === "number") return { from: pos, to: pos + 1 };
  if (typeof from === "number" && typeof to === "number") return { from, to };
  return null;
}

/**
 * The ranges of the final document that `transactions` (applied in order)
 * inserted or changed, mapped through every later step. Returns `null` when
 * a step changed the document somewhere it does not say, so callers must
 * treat the whole document as changed.
 *
 * Positions are clamped to the final document and every range is ordered
 * (`from <= to`). Deletions leave an empty range where the content was, so
 * a node that now spans the deletion point counts as changed.
 */
export function changedRanges(
  transactions: readonly Transaction[],
): ChangedRange[] | null {
  const mapping = new Mapping();
  const steps: Step[] = [];
  for (const tr of transactions) {
    mapping.appendMapping(tr.mapping);
    steps.push(...tr.steps);
  }
  const last = transactions[transactions.length - 1];
  if (!last) return [];
  const size = last.doc.content.size;
  const clamp = (pos: number) => Math.max(0, Math.min(size, pos));

  const ranges: ChangedRange[] = [];
  for (let index = 0; index < steps.length; index++) {
    const rest = mapping.slice(index + 1);
    let mapped = false;
    mapping.maps[index].forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      mapped = true;
      const from = clamp(rest.map(newStart, -1));
      const to = clamp(rest.map(newEnd, 1));
      ranges.push({ from: Math.min(from, to), to: Math.max(from, to) });
    });
    if (mapped) continue;
    const own = rangeOfMaplessStep(steps[index]);
    if (!own) return null;
    const from = clamp(rest.map(own.from, -1));
    const to = clamp(rest.map(own.to, 1));
    ranges.push({ from: Math.min(from, to), to: Math.max(from, to) });
  }
  return ranges;
}

/**
 * Whether a node accepted by `match` overlaps or touches one of `ranges` in
 * `doc`. Inline content is not walked.
 */
export function rangesTouchNode(
  doc: PMNode,
  ranges: readonly ChangedRange[],
  match: (node: PMNode) => boolean,
): boolean {
  let found = false;
  for (const { from, to } of ranges) {
    doc.nodesBetween(from, to, (node) => {
      if (found) return false;
      if (match(node)) {
        found = true;
        return false;
      }
      return !node.isTextblock;
    });
    if (found) return true;
  }
  return false;
}
