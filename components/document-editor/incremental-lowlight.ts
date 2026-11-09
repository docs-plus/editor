import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

import { changedRanges } from "@/extensions/shared";
import type { lowlight as appLowlight } from "@/lib/lowlight";

type Lowlight = Pick<
  typeof appLowlight,
  "highlight" | "highlightAuto" | "registered"
>;

type HastNode = {
  value?: string;
  children?: HastNode[];
  properties?: { className?: string[] };
};

/** One highlighted run, as offsets into the code block's text. */
type Token = { from: number; to: number; className: string };

export interface IncrementalLowlightOptions {
  /** Code block node type name. */
  name: string;
  lowlight: Lowlight;
  defaultLanguage?: string | null;
}

export const incrementalLowlightPluginKey = new PluginKey<DecorationSet>(
  "incrementalLowlight",
);

function flatten(
  nodes: HastNode[],
  classes: string[] = [],
): { text: string; classes: string[] }[] {
  return nodes.flatMap((node) => {
    const nested = [...classes, ...(node.properties?.className ?? [])];
    return node.children
      ? flatten(node.children, nested)
      : [{ text: node.value ?? "", classes: nested }];
  });
}

/** Lowlight tokens for a code block, the same runs the stock plugin emits. */
export function tokenizeCodeBlock(
  node: ProseMirrorNode,
  { lowlight, defaultLanguage }: IncrementalLowlightOptions,
): Token[] {
  const language = node.attrs.language || defaultLanguage;
  const tree =
    language && lowlight.registered(language)
      ? lowlight.highlight(language, node.textContent)
      : lowlight.highlightAuto(node.textContent);
  const tokens: Token[] = [];
  let from = 0;
  for (const { text, classes } of flatten(tree.children as HastNode[])) {
    const to = from + text.length;
    if (classes.length > 0)
      tokens.push({ from, to, className: classes.join(" ") });
    from = to;
  }
  return tokens;
}

/**
 * Code blocks in `doc` that overlap a changed range, each once. `null`
 * ranges mean "anywhere": every code block is returned.
 */
function codeBlocksIn(
  doc: ProseMirrorNode,
  name: string,
  ranges: { from: number; to: number }[] | null,
): { node: ProseMirrorNode; pos: number }[] {
  const blocks = new Map<number, ProseMirrorNode>();
  const visit = (node: ProseMirrorNode, pos: number) => {
    if (node.type.name !== name) return !node.isTextblock;
    blocks.set(pos, node);
    return false;
  };
  if (ranges === null) doc.descendants(visit);
  else for (const { from, to } of ranges) doc.nodesBetween(from, to, visit);
  return [...blocks].map(([pos, node]) => ({ node, pos }));
}

/**
 * Syntax highlighting for code blocks that only re-highlights the blocks a
 * change touched. Produces the same decorations as the stock
 * `@tiptap/extension-code-block-lowlight` plugin, which it replaces.
 *
 * The stock plugin walks the whole document twice on every document
 * change, then re-highlights every code block whenever the cursor is in
 * one, a code block is added or removed, or a step spans one: on a large
 * document, each keystroke in a code block re-highlights all of them. Here,
 * decorations are mapped through each change and only code blocks that
 * overlap a changed range are highlighted again; a block whose node is
 * unchanged (moved, or rebuilt around by a collaborator's change) reuses
 * its cached tokens instead of running the highlighter.
 */
export function createIncrementalLowlightPlugin(
  options: IncrementalLowlightOptions,
) {
  /** Nodes are immutable, so a node's tokens never go stale. */
  const tokensByNode = new WeakMap<ProseMirrorNode, Token[]>();

  const decorationsFor = (node: ProseMirrorNode, pos: number) => {
    let tokens = tokensByNode.get(node);
    if (!tokens) {
      tokens = tokenizeCodeBlock(node, options);
      tokensByNode.set(node, tokens);
    }
    const start = pos + 1;
    return tokens.map(({ from, to, className }) =>
      Decoration.inline(start + from, start + to, { class: className }),
    );
  };

  const highlightAll = (doc: ProseMirrorNode) =>
    DecorationSet.create(
      doc,
      codeBlocksIn(doc, options.name, null).flatMap(({ node, pos }) =>
        decorationsFor(node, pos),
      ),
    );

  const apply = (tr: Transaction, set: DecorationSet): DecorationSet => {
    if (!tr.docChanged) return set;
    const ranges = changedRanges([tr]);
    if (ranges === null) return highlightAll(tr.doc);
    const blocks = codeBlocksIn(tr.doc, options.name, ranges);
    let next = set.map(tr.mapping, tr.doc);
    if (blocks.length === 0) return next;
    for (const { node, pos } of blocks) {
      next = next.remove(next.find(pos + 1, pos + node.nodeSize - 1));
    }
    return next.add(
      tr.doc,
      blocks.flatMap(({ node, pos }) => decorationsFor(node, pos)),
    );
  };

  return new Plugin<DecorationSet>({
    key: incrementalLowlightPluginKey,
    state: {
      init: (_, { doc }) => highlightAll(doc),
      apply,
    },
    props: {
      decorations: (state) => incrementalLowlightPluginKey.getState(state),
    },
  });
}
