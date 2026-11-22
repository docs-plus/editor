/**
 * Re-anchoring (comments design §5.3). Yjs alone detaches an anchor when
 * y-prosemirror recreates its block (a type change, a wrap, a split or a
 * join before the range, a section move). The client that made the edit
 * holds ProseMirror's exact mapping, so it alone re-anchors the threads it
 * touched. Remote transactions only re-resolve: their mapping is one
 * whole-span replace and would invent positions.
 */
import type { Node as PMNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";

import {
  type CommentRange,
  createAnchorPair,
  resolveAnchors,
  resolvePair,
  sameRange,
} from "@/lib/comments/anchors";
import type { AnchorBinding, CommentsDeps } from "@/lib/comments/deps";
import { type Anchors, anchorKey, type Id } from "@/lib/comments/model";
import { textBounds } from "@/lib/comments/selection";
import type { CommentStore } from "@/lib/comments/store";

/**
 * The meta `moveSection` sets: the moved slice `[from, to)` of the old
 * document now starts at `insertAt` of the new one. ProseMirror's mapping
 * collapses a moved range, so ranges inside are shifted instead (§5.3).
 */
export const SECTION_MOVE_META = "sectionMove";
export interface SectionMove {
  from: number;
  to: number;
  insertAt: number;
}

const overlaps = (a: CommentRange, b: CommentRange) =>
  a.from <= b.to && a.to >= b.from;

/**
 * Where the block around `pos` starts: its textblock, or with `top` its
 * top-level block (between blocks, the one before).
 */
function blockStart(doc: PMNode, pos: number, top: boolean): number {
  const $pos = doc.resolve(pos);
  if ($pos.depth < 1) return pos - ($pos.nodeBefore?.nodeSize ?? 0);
  return $pos.before(top || !$pos.parent.isTextblock ? 1 : $pos.depth);
}

/** Where that block ends (between blocks, the one after). */
function blockEnd(doc: PMNode, pos: number, top: boolean): number {
  const $pos = doc.resolve(pos);
  if ($pos.depth < 1) return pos + ($pos.nodeAfter?.nodeSize ?? 0);
  return $pos.after(top || !$pos.parent.isTextblock ? 1 : $pos.depth);
}

/**
 * Whether y-prosemirror may recreate a block for `tr`: y-tiptap's check
 * (Enter, a join, block content pasted or deleted) plus any
 * `ReplaceAroundStep` (a type change, a wrap or a lift), which keeps the
 * block count but still detaches anchors (§3).
 */
function isStructural(deps: CommentsDeps, tr: Transaction): boolean {
  return (
    deps.isStructuralTransaction(tr, tr.before) ||
    tr.steps.some((step) => "gapFrom" in step)
  );
}

/** A range mapped through `tr`: start sticks right, end sticks left. */
function mapRange(tr: Transaction, { from, to }: CommentRange): CommentRange {
  const start = tr.mapping.map(from, 1);
  return { from: start, to: Math.max(start, tr.mapping.map(to, -1)) };
}

export interface RangeTracker {
  /** Each thread's current highlight range. Detached threads have none. */
  readonly ranges: Map<Id, CommentRange>;
  /**
   * A local doc change: maps every range, and marks for a check every
   * thread in the textblocks it changed, or in the top-level blocks a
   * structural change spans (a split or join before the range detaches it
   * without touching it, §3). Textblocks, not just the changed text: the
   * sync plugin diffs a block's text as strings, so in repeated text it
   * may delete other (equal) characters than ProseMirror did, and an
   * anchor nearby drifts by a character.
   */
  local(tr: Transaction): void;
  /** A remote change: maps every range; returns the threads to re-resolve. */
  remote(tr: Transaction): Set<Id>;
  /** The threads marked by `local` since the last call. */
  takePending(): Set<Id>;
}

export function createRangeTracker(deps: CommentsDeps): RangeTracker {
  const ranges = new Map<Id, CommentRange>();
  let pending = new Set<Id>();

  /** Maps every range; returns the zones to compare with, or `null` (all). */
  function mapAll(tr: Transaction, zones: CommentRange[] | null): Set<Id> {
    const move = tr.getMeta(SECTION_MOVE_META) as SectionMove | undefined;
    const hit = new Set<Id>();
    for (const [tid, range] of ranges) {
      let next: CommentRange;
      if (move && range.from >= move.from && range.to <= move.to) {
        const shift = move.insertAt - move.from;
        next = { from: range.from + shift, to: range.to + shift };
        hit.add(tid);
      } else next = mapRange(tr, range);
      ranges.set(tid, next);
      if (!zones || zones.some((zone) => overlaps(zone, next))) hit.add(tid);
    }
    return hit;
  }

  return {
    ranges,

    local(tr) {
      if (!tr.docChanged || !ranges.size) return;
      const changed = deps.changedRanges([tr]);
      const top = isStructural(deps, tr);
      const zones =
        changed?.map(({ from, to }) => ({
          from: blockStart(tr.doc, from, top),
          to: blockEnd(tr.doc, to, top),
        })) ?? null;
      for (const tid of mapAll(tr, zones)) pending.add(tid);
    },

    remote(tr) {
      if (!tr.docChanged || !ranges.size) return new Set();
      return mapAll(tr, deps.changedRanges([tr]));
    },

    takePending() {
      const taken = pending;
      pending = new Set();
      return taken;
    },
  };
}

/**
 * The check after a local change (§5.3), once the sync plugin has written
 * Yjs: for each marked thread whose mapped range is not empty, resolve its
 * current pair from Yjs, and if that differs, write new anchors from the
 * mapped range (the store keeps the first pair as `ps`/`pe`). An empty
 * mapped range means its text was deleted: the anchor stays, so undo
 * brings it back. Writes go through the store, so `canComment()` gates
 * them, and all of them leave as ONE Yjs update (`store.batch`): a paste
 * or a section move over many threads is one message, not one per thread
 * (Throttle bans bursts). Returns the threads re-anchored.
 *
 * Run it before any remote change is applied: `tracker.ranges` must still
 * be the local transaction's mapping, which matches `binding` and `doc`.
 */
export function reanchor(
  deps: CommentsDeps,
  binding: AnchorBinding,
  doc: PMNode,
  store: CommentStore,
  tracker: RangeTracker,
  tids: Iterable<Id>,
): Id[] {
  const writes: AnchorWrite[] = [];
  for (const tid of tids) {
    const anchors = store.map.get(anchorKey(tid)) as Anchors | undefined;
    const tracked = tracker.ranges.get(tid);
    // A mapped range can end on a block boundary (a split, a move): the
    // anchors go on its text.
    const mapped = tracked && textBounds(doc, tracked);
    if (!mapped || !anchors) continue;
    const current = resolvePair(deps, binding, anchors.s, anchors.e);
    if (sameRange(current, mapped)) continue;
    const pair = createAnchorPair(deps, binding, mapped);
    if (pair) writes.push([tid, pair]);
  }
  return writeAnchors(store, writes);
}

type AnchorWrite = readonly [Id, Pick<Anchors, "s" | "e">];

/**
 * Writes re-anchors as one Yjs update, and opens no transaction when there
 * is nothing to write (the check runs as often as every keystroke).
 */
function writeAnchors(store: CommentStore, writes: AnchorWrite[]): Id[] {
  const written: Id[] = [];
  if (!writes.length) return written;
  store.batch(() => {
    for (const [tid, pair] of writes) {
      if (store.setAnchors(tid, pair, "reanchor").ok) written.push(tid);
    }
  });
  return written;
}

const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, index) => byte === b[index]);

/**
 * After an undo or redo brought a thread's text back: Yjs follows undo's
 * re-created text (`redone`) only on the client that undid, so the thread
 * resolves there and stays Detached (or short) for everyone else. Call it
 * for the threads whose anchors are only live on this client
 * (`anchorsOnlyLiveHere`): for each that resolves, a pair made from its
 * resolved range that differs from the stored one is written (same
 * `"reanchor"` rules, one update). The byte check ends it: the next
 * resolution finds the stored pair equal and writes nothing.
 */
export function refreshAnchors(
  deps: CommentsDeps,
  binding: AnchorBinding,
  store: CommentStore,
  tids: Iterable<Id>,
): Id[] {
  const writes: AnchorWrite[] = [];
  for (const tid of tids) {
    const anchors = store.map.get(anchorKey(tid)) as Anchors | undefined;
    const range = anchors && resolveAnchors(deps, binding, anchors);
    const pair = range && createAnchorPair(deps, binding, range);
    if (
      pair &&
      anchors &&
      !(sameBytes(pair.s, anchors.s) && sameBytes(pair.e, anchors.e))
    ) {
      writes.push([tid, pair]);
    }
  }
  return writeAnchors(store, writes);
}
