import type { Editor } from "@tiptap/core";
import { Fragment, type Node as PMNode } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { Mapping, StepMap } from "@tiptap/pm/transform";
import { yUndoPluginKey } from "@tiptap/y-tiptap";

export type BlockDirection = "up" | "down";

/** `true`, or why not, in the registry's `Enabled` shape. */
export type BlockAvailability = true | { reason: string };

export const BLOCK_MOVE_REASONS = {
  title: "The title stays first.",
  titleDuplicate: "The title can't be duplicated.",
  first: "Already the first block.",
  last: "Already the last block.",
} as const;

export interface BlockMoveOptions {
  /**
   * `data-toc-id`s of the folded headings (the fold plugin's state). A
   * folded section is one unit: a block moves past it whole, and a folded
   * heading moves or is duplicated with its hidden body. Without it, every
   * top-level block is its own unit.
   */
  foldedIds?: ReadonlySet<string>;
}

/** Node types whose ids must be unique (UniqueID's and the TOC's). */
const ID_TYPES: ReadonlySet<string> = new Set(["heading"]);
const ID_ATTRS = ["id", "data-toc-id"] as const;

interface TopLevel {
  /** `offsets[i]` is where child `i` starts; `offsets[count]` is the end. */
  offsets: number[];
  /** Index of the outermost folded heading that hides child `i`, or -1. */
  hiddenBy: number[];
}

function topLevel(doc: PMNode, foldedIds?: ReadonlySet<string>): TopLevel {
  const offsets: number[] = [];
  const hiddenBy: number[] = [];
  // Open headings above the current block; the title is never a section.
  const open: { level: number; index: number; folded: boolean }[] = [];
  doc.forEach((node, offset, index) => {
    offsets.push(offset);
    const isHeading = index > 0 && node.type.name === "heading";
    const level = node.attrs.level as number;
    if (isHeading) {
      while (open.length > 0 && open[open.length - 1].level >= level) {
        open.pop();
      }
    }
    hiddenBy.push(open.find((heading) => heading.folded)?.index ?? -1);
    if (isHeading && foldedIds?.size) {
      const id = node.attrs["data-toc-id"] as string | null | undefined;
      open.push({ level, index, folded: !!id && foldedIds.has(id) });
    }
  });
  offsets.push(doc.content.size);
  return { offsets, hiddenBy };
}

/** True when `pos` is the very start of its top-level block's text. */
function atBlockStart(state: EditorState, pos: number): boolean {
  const $pos = state.doc.resolve(pos);
  if ($pos.parentOffset !== 0) return false;
  for (let depth = 1; depth < $pos.depth; depth++) {
    if ($pos.index(depth) !== 0) return false;
  }
  return true;
}

/**
 * The top-level blocks the selection touches, as child indices: every
 * block it covers, less a last block it only reaches the start of. A
 * folded heading at the end brings its hidden body.
 */
function selectedRange(state: EditorState, top: TopLevel) {
  const { doc, selection } = state;
  const $from = doc.resolve(selection.from);
  const $to = doc.resolve(selection.to);
  const start = $from.index(0);
  let end = $to.depth === 0 ? $to.index(0) - 1 : $to.index(0);
  if (!selection.empty && end > start && atBlockStart(state, selection.to)) {
    end -= 1;
  }
  end = Math.max(start, Math.min(end, doc.childCount - 1));
  const { hiddenBy } = top;
  while (
    end + 1 < doc.childCount &&
    hiddenBy[end + 1] >= start &&
    hiddenBy[end + 1] <= end
  ) {
    end += 1;
  }
  return { start, end };
}

interface MovePlan {
  from: number;
  to: number;
  insertAt: number;
}

function planMove(
  state: EditorState,
  direction: BlockDirection,
  options: BlockMoveOptions,
): MovePlan | { reason: string } {
  const top = topLevel(state.doc, options.foldedIds);
  const { start, end } = selectedRange(state, top);
  const { offsets, hiddenBy } = top;
  if (start === 0) return { reason: BLOCK_MOVE_REASONS.title };
  const from = offsets[start];
  const to = offsets[end + 1];
  if (direction === "up") {
    let above = start - 1;
    if (hiddenBy[above] >= 0) above = hiddenBy[above];
    if (above === 0) return { reason: BLOCK_MOVE_REASONS.first };
    return { from, to, insertAt: offsets[above] };
  }
  const below = end + 1;
  if (below >= state.doc.childCount) return { reason: BLOCK_MOVE_REASONS.last };
  let belowEnd = below;
  while (
    belowEnd + 1 < state.doc.childCount &&
    hiddenBy[belowEnd + 1] === below
  ) {
    belowEnd += 1;
  }
  return { from, to, insertAt: offsets[belowEnd + 1] };
}

/** The selection, shifted by `delta` into `tr.doc`. */
function shiftSelection(state: EditorState, tr: Transaction, delta: number) {
  return state.selection.map(tr.doc, new Mapping([StepMap.offset(delta)]));
}

/** Equal nodes that are new objects, so the sync plugin re-creates them. */
function recreated(fragment: Fragment): Fragment {
  const nodes: PMNode[] = [];
  fragment.forEach((node) => {
    // Not `node.copy(node.content)`: that returns `node` itself.
    nodes.push(node.type.create(node.attrs, node.content, node.marks));
  });
  return Fragment.from(nodes);
}

/** Copy of `node` with no unique ids, so the id plugins mint new ones. */
function withoutIds(node: PMNode): PMNode {
  if (!ID_TYPES.has(node.type.name)) return node;
  const attrs = { ...node.attrs };
  for (const name of ID_ATTRS) if (name in attrs) attrs[name] = null;
  return node.type.create(attrs, node.content, node.marks);
}

/** Whether the selection's blocks can move: `true` or the reason. */
export function canMoveBlock(
  state: EditorState,
  direction: BlockDirection,
  options: BlockMoveOptions = {},
): BlockAvailability {
  const plan = planMove(state, direction, options);
  return "reason" in plan ? plan : true;
}

/**
 * The transaction that moves the selection's top-level blocks one unit
 * up or down, with the selection kept on them, or the reason it can't.
 * Read from `state` when it runs, never from positions held earlier.
 */
export function moveBlockTransaction(
  state: EditorState,
  direction: BlockDirection,
  options: BlockMoveOptions = {},
): Transaction | { reason: string } {
  const plan = planMove(state, direction, options);
  if ("reason" in plan) return plan;
  const { doc, tr } = state;
  const up = plan.insertAt < plan.from;
  const regionFrom = up ? plan.insertAt : plan.from;
  const regionTo = up ? plan.to : plan.insertAt;
  let moved = doc.slice(plan.from, plan.to).content;
  let passed = up
    ? doc.slice(plan.insertAt, plan.from).content
    : doc.slice(plan.to, plan.insertAt).content;
  // Yjs 13 has no move: the sync plugin keeps the Yjs blocks whose
  // ProseMirror nodes are the same objects and re-creates the rest, which
  // drops a collaborator's typing in them meanwhile. Re-create the smaller
  // side, so the larger one (the moved blocks on a tie) keeps its edits.
  if (moved.size < passed.size) moved = recreated(moved);
  else passed = recreated(passed);
  tr.replaceWith(
    regionFrom,
    regionTo,
    up ? moved.append(passed) : passed.append(moved),
  );
  const movedStart = up ? plan.insertAt : plan.from + passed.size;
  tr.setSelection(shiftSelection(state, tr, movedStart - plan.from));
  return tr.scrollIntoView();
}

/** Whether the selection's blocks can be duplicated: `true` or the reason. */
export function canDuplicateBlock(
  state: EditorState,
  options: BlockMoveOptions = {},
): BlockAvailability {
  const { start } = selectedRange(
    state,
    topLevel(state.doc, options.foldedIds),
  );
  return start === 0 ? { reason: BLOCK_MOVE_REASONS.titleDuplicate } : true;
}

/**
 * The transaction that inserts a copy of the selection's top-level blocks
 * right below them and moves the selection into the copy. Headings in the
 * copy lose their ids, so folds, the outline and "Continue where you left
 * off" never confuse the copy with the original.
 */
export function duplicateBlockTransaction(
  state: EditorState,
  options: BlockMoveOptions = {},
): Transaction | { reason: string } {
  const top = topLevel(state.doc, options.foldedIds);
  const { start, end } = selectedRange(state, top);
  if (start === 0) return { reason: BLOCK_MOVE_REASONS.titleDuplicate };
  const from = top.offsets[start];
  const to = top.offsets[end + 1];
  const copy: PMNode[] = [];
  state.doc.slice(from, to).content.forEach((node) => {
    copy.push(withoutIds(node));
  });
  const { tr } = state;
  tr.insert(to, Fragment.from(copy));
  tr.setSelection(shiftSelection(state, tr, to - from));
  return tr.scrollIntoView();
}

interface UndoManagerLike {
  stopCapturing(): void;
}

/**
 * Dispatches `tr` as its own Yjs undo step: `stopCapturing()` before and
 * after keeps typing, and the next move, out of its capture. The sync
 * plugin writes the transaction to Yjs as it is dispatched. Returns
 * whether the document changed (`WriteGate` may refuse it).
 */
function dispatchAsOneStep(editor: Editor, tr: Transaction): boolean {
  const undoManager = yUndoPluginKey.getState(editor.state)?.undoManager as
    | UndoManagerLike
    | undefined;
  const before = editor.state.doc;
  undoManager?.stopCapturing();
  editor.view.dispatch(tr);
  undoManager?.stopCapturing();
  return editor.state.doc !== before;
}

/**
 * Format › Move Block Up / Down (details spec E4, menu-only in v1): moves
 * the selection's top-level blocks as one undo step. The title never
 * moves, and nothing moves above it. Returns whether anything moved.
 */
export function moveBlock(
  editor: Editor,
  direction: BlockDirection,
  options: BlockMoveOptions = {},
): boolean {
  if (!editor.isEditable) return false;
  const tr = moveBlockTransaction(editor.state, direction, options);
  return "reason" in tr ? false : dispatchAsOneStep(editor, tr);
}

/**
 * Format › Duplicate Block (E4): copies the selection's top-level blocks
 * below them as one undo step. Never the title. Returns whether it ran.
 */
export function duplicateBlock(
  editor: Editor,
  options: BlockMoveOptions = {},
): boolean {
  if (!editor.isEditable) return false;
  const tr = duplicateBlockTransaction(editor.state, options);
  return "reason" in tr ? false : dispatchAsOneStep(editor, tr);
}
