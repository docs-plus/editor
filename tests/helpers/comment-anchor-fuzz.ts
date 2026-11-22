/**
 * One anchor fuzz case (comments design §10), shared by the unit suite
 * (2,000 cases) and the stress probe (50,000).
 *
 * Oracle: each thread's original range mapped through every ProseMirror
 * step (start sticks right, end sticks left; a section move shifts the
 * ranges inside it). Invariants:
 * 1. a thread whose text survives resolves to the oracle's text;
 * 2. a thread whose text was fully deleted is Detached;
 * 3. after undoing everything with `Y.UndoManager`, every thread resolves
 *    to its original text.
 */
import type { Node as PMNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";

import type { CommentRange } from "@/lib/comments/anchors";
import type { Id } from "@/lib/comments/model";
import { SECTION_MOVE_META, type SectionMove } from "@/lib/comments/reanchor";
import { textBounds } from "@/lib/comments/selection";

import {
  type FuzzOp,
  joinBackward,
  pickOne,
  type Rng,
  randInt,
  randomDocument,
  randomTextRange,
  randomTransaction,
  seededRng,
  splitAt,
} from "./comment-fuzz-ops";
import { createHarnessClient, type HarnessClient } from "./comment-harness";

const SEPARATOR = "¶";

export interface FuzzFailure {
  seed: number;
  /**
   * `"3-trimmed"`: invariant 3 for a thread some of whose text was deleted
   * or cut off before a structural edit re-anchored it to the rest; undo
   * restores the text but the live anchor keeps the shorter range (a
   * residual risk the suite measures, §13).
   */
  invariant: 1 | 2 | 3 | "3-trimmed";
  tid: Id;
  expected: string | null;
  actual: string | null;
  ops: FuzzOp[];
}

/** The text of `range`'s text characters, block breaks as `¶`. */
function textOf(doc: PMNode, range: CommentRange | null): string | null {
  const bounds = range && range.from < range.to ? textBounds(doc, range) : null;
  return bounds ? doc.textBetween(bounds.from, bounds.to, SEPARATOR) : null;
}

function mapOracle(tr: Transaction, range: CommentRange): CommentRange {
  const move = tr.getMeta(SECTION_MOVE_META) as SectionMove | undefined;
  if (move && range.from >= move.from && range.to <= move.to) {
    const shift = move.insertAt - move.from;
    return { from: range.from + shift, to: range.to + shift };
  }
  let { from, to } = range;
  for (const map of tr.mapping.maps) {
    from = map.map(from, 1);
    to = Math.max(from, map.map(to, -1));
  }
  return { from, to };
}

export interface FuzzCaseOptions {
  /** Forced first op, for the required fixed cases. */
  first?: (
    rng: Rng,
    client: HarnessClient,
  ) => { op: FuzzOp; tr: Transaction } | null;
  /** Random edits after `first`: 1 to this many (default 12), or none at 0. */
  maxOps?: number;
}

export interface FuzzCaseResult {
  threads: number;
  /** Threads some of whose text was deleted or cut off along the way. */
  trimmed: number;
  failures: FuzzFailure[];
}

/** Runs case `seed`: its thread counts and failed invariants. */
export function runFuzzCase(
  seed: number,
  options: FuzzCaseOptions = {},
): FuzzCaseResult {
  const rng = seededRng(seed);
  const client = createHarnessClient({ content: randomDocument(rng) });
  const threads = new Map<
    Id,
    { original: string; oracle: CommentRange; trimmed: boolean }
  >();
  const count = randInt(rng, 1, 30);
  for (let index = 0; index < count; index++) {
    const range = randomTextRange(rng, client.state.doc);
    if (!range) continue;
    const tid = client.createThread(range);
    if (!tid) continue;
    const original = textOf(client.state.doc, range) ?? "";
    threads.set(tid, { original, oracle: range, trimmed: false });
  }

  const ops: FuzzOp[] = [];
  const step = (tr: Transaction, op: FuzzOp) => {
    for (const thread of threads.values()) {
      const before = textOf(tr.before, thread.oracle);
      thread.oracle = mapOracle(tr, thread.oracle);
      const after = textOf(tr.doc, thread.oracle);
      // Some of its text was deleted, replaced or cut off by a move.
      const plain = (text: string) => text.replaceAll(SEPARATOR, "");
      if (
        after !== null &&
        before !== null &&
        !plain(after).includes(plain(before))
      ) {
        thread.trimmed = true;
      }
    }
    client.apply(tr);
    ops.push(op);
  };
  const first = options.first?.(rng, client);
  if (first) step(first.tr, first.op);
  const max = options.maxOps ?? 12;
  const total = max > 0 ? randInt(rng, 1, max) : 0;
  for (let index = 0; index < total; index++) {
    const next = randomTransaction(rng, client.state);
    if (next) step(next.tr, next.op);
  }

  const failures: FuzzFailure[] = [];
  const text = (range: CommentRange | null) => textOf(client.state.doc, range);
  for (const [tid, { oracle }] of threads) {
    const actual = text(client.resolve(tid));
    if (oracle.from < oracle.to) {
      const expected = text(oracle);
      if (actual !== expected) {
        failures.push({ seed, invariant: 1, tid, expected, actual, ops });
      }
    } else if (actual !== null) {
      failures.push({ seed, invariant: 2, tid, expected: null, actual, ops });
    }
  }

  while (client.undo.canUndo()) client.undo.undo();
  client.reload();
  for (const [tid, { original, trimmed }] of threads) {
    const actual = text(client.resolve(tid));
    if (actual !== original) {
      failures.push({
        seed,
        invariant: trimmed ? "3-trimmed" : 3,
        tid,
        expected: original,
        actual,
        ops,
      });
    }
  }
  client.doc.destroy();
  let trimmed = 0;
  for (const thread of threads.values()) if (thread.trimmed) trimmed++;
  return { threads: threads.size, trimmed, failures };
}

/**
 * The required fixed cases (§10): a split or a join BEFORE a thread's
 * range in the same block, the spike's detaching cases that the changed
 * range never overlaps.
 */
export const splitBeforeThread: FuzzCaseOptions["first"] = (rng, client) => {
  const ranges = [...client.tracker.ranges.values()];
  if (!ranges.length) return null;
  const range = pickOne(rng, ranges);
  const $from = client.state.doc.resolve(range.from);
  if ($from.parentOffset < 1) return null;
  const at = randInt(rng, $from.start() + 1, range.from);
  const tr = splitAt(client.state, at);
  return tr ? { op: "split", tr } : null;
};

export const joinBeforeThread: FuzzCaseOptions["first"] = (rng, client) => {
  const ranges = [...client.tracker.ranges.values()];
  if (!ranges.length) return null;
  const range = pickOne(rng, ranges);
  const tr = joinBackward(
    client.state,
    client.state.doc.resolve(range.from).start(),
  );
  return tr ? { op: "join", tr } : null;
};
