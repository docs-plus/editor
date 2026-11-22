import type { Node as PMNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";

/** One match, as document positions. Mapped in place as the document changes. */
export interface FindHit {
  from: number;
  to: number;
}

/**
 * Most hits Find keeps. Past it the bar says "10,000+"; Replace all still
 * replaces every match (it scans without a cap).
 */
export const MAX_FIND_HITS = 10_000;

/**
 * A transaction with more steps than this (Replace all, a pasted document)
 * is rescanned whole rather than step by step.
 */
const MAX_INCREMENTAL_STEPS = 50;

/** Stands for a non-text inline node, so no match runs across one. */
const OBJECT = "￼";

/** Text of each textblock, kept per (immutable) node: unchanged blocks are never rebuilt. */
const textCache = new WeakMap<PMNode, string>();

/**
 * The textblock's text, one character per position: a hard break, image
 * or other inline node stands as U+FFFC, so offset `i` is position
 * `blockPos + 1 + i` and no match spans a line break.
 */
export function blockText(block: PMNode): string {
  let text = textCache.get(block);
  if (text === undefined) {
    let built = "";
    block.forEach((child) => {
      built += child.isText
        ? (child.text ?? "")
        : OBJECT.repeat(child.nodeSize);
    });
    text = built;
    textCache.set(block, text);
  }
  return text;
}

/**
 * Appends the hits of `pattern` (a global regex) in the textblocks that
 * overlap `from`–`to`, in document order, stopping at `limit` in all.
 */
export function scanHits(
  doc: PMNode,
  pattern: RegExp,
  from = 0,
  to = doc.content.size,
  out: FindHit[] = [],
  limit = MAX_FIND_HITS,
): FindHit[] {
  if (out.length >= limit) return out;
  doc.nodesBetween(from, to, (node, pos) => {
    if (out.length >= limit) return false;
    if (!node.isTextblock) return true;
    const text = blockText(node);
    const start = pos + 1;
    pattern.lastIndex = 0;
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
      out.push({
        from: start + match.index,
        to: start + match.index + match[0].length,
      });
      if (out.length >= limit) break;
    }
    return false;
  });
  return out;
}

/**
 * The ranges of `tr.doc` that its steps replaced, mapped to the final
 * document, sorted and merged.
 */
export function changedRanges(tr: Transaction): [number, number][] {
  const ranges: [number, number][] = [];
  const { maps } = tr.mapping;
  maps.forEach((map, index) => {
    const rest = tr.mapping.slice(index + 1);
    map.forEach((_oldFrom, _oldTo, newFrom, newTo) => {
      ranges.push([rest.map(newFrom, -1), rest.map(newTo, 1)]);
    });
  });
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  return merged;
}

/**
 * The textblocks each range touches, as `[start, end]`. An empty range
 * (a deletion) touches the block it falls inside; one on a boundary
 * between blocks touches none, since no block's text changed.
 */
function touchedBlocks(
  doc: PMNode,
  ranges: [number, number][],
): [number, number][] {
  const blocks: [number, number][] = [];
  for (const [from, to] of ranges) {
    doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isTextblock) return true;
      const last = blocks[blocks.length - 1];
      if (!last || last[1] <= pos) blocks.push([pos, pos + node.nodeSize]);
      return false;
    });
  }
  return blocks;
}

/** Result of `updateHits`: the new hits and the ones that were dropped. */
export interface HitUpdate {
  hits: FindHit[];
  /** Hits no longer in `hits` (their text changed or was deleted). */
  dropped: FindHit[];
}

/**
 * Brings `hits` (sorted, for `tr.before`) up to date with `tr.doc`
 * without a full scan: hits outside the changed textblocks are mapped in
 * place (same objects, new positions), and only the changed textblocks are
 * scanned again. A remote Yjs update replaces only the top-level blocks it
 * changed (`replaceChangedChildren`), so it is as cheap as a keystroke.
 * At `limit` the list is cut, so hits past the cap may be missing until
 * the next full scan (the caller rescans a capped list when idle).
 */
export function updateHits(
  hits: FindHit[],
  tr: Transaction,
  pattern: RegExp,
  limit = MAX_FIND_HITS,
): HitUpdate {
  if (!tr.docChanged) return { hits, dropped: [] };
  if (tr.steps.length > MAX_INCREMENTAL_STEPS) {
    return {
      hits: scanHits(tr.doc, pattern, 0, tr.doc.content.size, [], limit),
      dropped: hits,
    };
  }
  const blocks = touchedBlocks(tr.doc, changedRanges(tr));
  const kept: FindHit[] = [];
  const dropped: FindHit[] = [];
  let block = 0;
  for (const hit of hits) {
    const from = tr.mapping.mapResult(hit.from, 1);
    const to = tr.mapping.mapResult(hit.to, -1);
    if (from.deleted || to.deleted || to.pos - from.pos !== hit.to - hit.from) {
      dropped.push(hit);
      continue;
    }
    hit.from = from.pos;
    hit.to = to.pos;
    while (block < blocks.length && blocks[block][1] <= hit.from) block++;
    if (block < blocks.length && blocks[block][0] < hit.to) {
      dropped.push(hit);
      continue;
    }
    kept.push(hit);
  }
  const fresh: FindHit[] = [];
  for (const [from, to] of blocks) {
    scanHits(tr.doc, pattern, from, to, fresh, Number.POSITIVE_INFINITY);
  }
  // Mapping keeps document order, so two sorted lists merge.
  const merged: FindHit[] = [];
  let i = 0;
  let j = 0;
  while ((i < kept.length || j < fresh.length) && merged.length < limit) {
    if (
      j >= fresh.length ||
      (i < kept.length && kept[i].from < fresh[j].from)
    ) {
      merged.push(kept[i++]);
    } else merged.push(fresh[j++]);
  }
  while (i < kept.length) dropped.push(kept[i++]);
  return { hits: merged, dropped };
}
