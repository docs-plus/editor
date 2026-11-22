/**
 * Seeded random documents and edits for the comment anchor fuzz (comments
 * design §10): typing, deletes, split, join, `setBlockType`, wrap, lift,
 * `moveSection`, `addMark` and paste-replace. Every op builds one
 * transaction; an op that doesn't fit the document returns `null`.
 */
import type { JSONContent } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { findWrapping, liftTarget } from "@tiptap/pm/transform";

import type { CommentRange } from "@/lib/comments/anchors";
import { SECTION_MOVE_META } from "@/lib/comments/reanchor";

export type Rng = () => number;

/** mulberry32: small, fast and reproducible. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const randInt = (rng: Rng, min: number, max: number) =>
  min + Math.floor(rng() * (max - min + 1));
export const pickOne = <T>(rng: Rng, items: readonly T[]): T =>
  items[Math.floor(rng() * items.length)];

const WORDS = [
  "alpha",
  "beta",
  "gamma",
  "delta",
  "omega",
  "kappa",
  "sigma",
  "zeta",
];

function sentence(rng: Rng): string {
  const count = randInt(rng, 2, 7);
  return Array.from({ length: count }, () => pickOne(rng, WORDS)).join(" ");
}

/** A title plus 3–10 blocks: paragraphs, headings, a quote or a list. */
export function randomDocument(rng: Rng): JSONContent {
  const text = () => [{ type: "text", text: sentence(rng) }];
  const blocks: JSONContent[] = [];
  const count = randInt(rng, 3, 10);
  for (let index = 0; index < count; index++) {
    const kind = rng();
    if (kind < 0.6) blocks.push({ type: "paragraph", content: text() });
    else if (kind < 0.75) {
      blocks.push({
        type: "heading",
        attrs: { level: randInt(rng, 2, 4) },
        content: text(),
      });
    } else if (kind < 0.88) {
      blocks.push({
        type: "blockquote",
        content: [{ type: "paragraph", content: text() }],
      });
    } else {
      blocks.push({
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [{ type: "paragraph", content: text() }],
          },
          {
            type: "listItem",
            content: [{ type: "paragraph", content: text() }],
          },
        ],
      });
    }
  }
  return {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Title" }],
      },
      ...blocks,
    ],
  };
}

/** Every text character position `[pos, pos + 1)` outside the title. */
function textPositions(doc: PMNode): number[] {
  const positions: number[] = [];
  const titleEnd = doc.firstChild?.nodeSize ?? 0;
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return true;
    for (let index = 0; index < node.text.length; index++) {
      if (pos + index >= titleEnd) positions.push(pos + index);
    }
    return false;
  });
  return positions;
}

/** A random non-empty range of text, usually inside one block. */
export function randomTextRange(rng: Rng, doc: PMNode): CommentRange | null {
  const positions = textPositions(doc);
  if (!positions.length) return null;
  const start = pickOne(rng, positions);
  const $start = doc.resolve(start);
  const crossBlocks = rng() < 0.15;
  const limit = crossBlocks ? doc.content.size : $start.end();
  const candidates = positions.filter((pos) => pos >= start && pos < limit);
  const last = candidates[Math.min(candidates.length - 1, randInt(rng, 0, 12))];
  return { from: start, to: last + 1 };
}

function textblockStarts(doc: PMNode): number[] {
  const starts: number[] = [];
  const titleEnd = doc.firstChild?.nodeSize ?? 0;
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      if (pos >= titleEnd) starts.push(pos + 1);
      return false;
    }
    return true;
  });
  return starts;
}

export type FuzzOp =
  | "type"
  | "delete"
  | "split"
  | "join"
  | "setBlockType"
  | "wrap"
  | "lift"
  | "moveSection"
  | "addMark"
  | "paste";

export const FUZZ_OPS: readonly FuzzOp[] = [
  "type",
  "delete",
  "split",
  "join",
  "setBlockType",
  "wrap",
  "lift",
  "moveSection",
  "addMark",
  "paste",
];

/** Splits the block holding `pos` (Enter), keeping the title-first schema. */
export function splitAt(state: EditorState, pos: number): Transaction | null {
  const $pos = state.doc.resolve(pos);
  if (!$pos.parent.isTextblock || $pos.depth < 1) return null;
  if ($pos.before(1) === 0) return null;
  const tr = state.tr;
  const type =
    $pos.parent.type.name === "heading"
      ? state.schema.nodes.paragraph
      : undefined;
  tr.split(pos, 1, type ? [{ type }] : undefined);
  return tr;
}

/** Joins the textblock starting at `start` into the one before (Backspace). */
export function joinBackward(
  state: EditorState,
  start: number,
): Transaction | null {
  const $start = state.doc.resolve(start);
  const before = $start.before();
  const $before = state.doc.resolve(before);
  const prev = $before.nodeBefore;
  if (!prev?.isTextblock || before - prev.nodeSize <= 0) return null;
  if (!$before.parent.canReplace($before.index() - 1, $before.index() + 1)) {
    return null;
  }
  return state.tr.join(before);
}

function randomOp(
  rng: Rng,
  state: EditorState,
  op: FuzzOp,
): Transaction | null {
  const { doc, schema } = state;
  const positions = textPositions(doc);
  const starts = textblockStarts(doc);
  if (!positions.length || !starts.length) return null;
  const at = pickOne(rng, positions);
  switch (op) {
    case "type":
      return state.tr.insertText(
        pickOne(rng, ["X", "yy", " z "]),
        at + randInt(rng, 0, 1),
      );
    case "delete": {
      const end = Math.min(doc.resolve(at).end(), at + randInt(rng, 1, 6));
      return end > at ? state.tr.delete(at, end) : null;
    }
    case "split":
      return splitAt(state, at + randInt(rng, 0, 1));
    case "join":
      return joinBackward(state, pickOne(rng, starts));
    case "setBlockType": {
      const $at = doc.resolve(at);
      const toHeading = $at.parent.type.name === "paragraph";
      const type = toHeading ? schema.nodes.heading : schema.nodes.paragraph;
      const attrs = toHeading ? { level: randInt(rng, 2, 4) } : null;
      return state.tr.setBlockType($at.start(), $at.end(), type, attrs);
    }
    case "wrap": {
      const $at = doc.resolve(at);
      const range = $at.blockRange();
      if (!range) return null;
      const type =
        rng() < 0.5 ? schema.nodes.blockquote : schema.nodes.bulletList;
      const wrapping = findWrapping(range, type);
      return wrapping ? state.tr.wrap(range, wrapping) : null;
    }
    case "lift": {
      const range = doc.resolve(at).blockRange();
      const target = range ? liftTarget(range) : null;
      return range && target !== null && target !== undefined
        ? state.tr.lift(range, target)
        : null;
    }
    case "moveSection": {
      // A top-level block (never the title) moved before another, as
      // `moveSection` does: delete plus insert in one transaction.
      const blocks: { from: number; to: number }[] = [];
      doc.forEach((node, offset, index) => {
        if (index > 0)
          blocks.push({ from: offset, to: offset + node.nodeSize });
      });
      if (blocks.length < 2) return null;
      const moved = pickOne(rng, blocks);
      const targets = blocks.filter(
        (block) => block.from !== moved.from && block.from !== moved.to,
      );
      const targetBlock = pickOne(rng, targets);
      const target = rng() < 0.5 ? targetBlock.from : targetBlock.to;
      if (target > moved.from && target < moved.to) return null;
      const tr = state.tr;
      const content = doc.slice(moved.from, moved.to).content;
      tr.delete(moved.from, moved.to);
      const insertAt = tr.mapping.map(target);
      tr.insert(insertAt, content);
      tr.setMeta(SECTION_MOVE_META, {
        from: moved.from,
        to: moved.to,
        insertAt,
      });
      return tr;
    }
    case "addMark": {
      const end = Math.min(doc.resolve(at).end(), at + randInt(rng, 1, 8));
      return state.tr.addMark(at, end, schema.marks.bold.create());
    }
    case "paste": {
      const end = Math.min(doc.resolve(at).end(), at + randInt(rng, 0, 6));
      return state.tr.replaceWith(at, end, schema.text("pasted"));
    }
  }
}

/** One random op that fits, or `null` after a few tries. */
export function randomTransaction(
  rng: Rng,
  state: EditorState,
): { op: FuzzOp; tr: Transaction } | null {
  for (let attempt = 0; attempt < 8; attempt++) {
    const op = pickOne(rng, FUZZ_OPS);
    try {
      const tr = randomOp(rng, state, op);
      if (tr?.docChanged && state.doc.firstChild?.type.name === "heading") {
        // The title-first schema: a transaction may not end it.
        if (
          tr.doc.firstChild?.type.name === "heading" &&
          tr.doc.firstChild.attrs.level === 1
        ) {
          return { op, tr };
        }
      }
    } catch {
      // A transform that doesn't fit this document: try another op.
    }
  }
  return null;
}
