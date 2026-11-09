import { Extension } from "@tiptap/core";
import type { ResolvedPos } from "@tiptap/pm/model";
import {
  type EditorState,
  Plugin,
  PluginKey,
  type Transaction,
} from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/** Class on the top-level block(s) holding the selection's ends. */
export const CARET_BLOCK_CLASS = "is-caret-block";

export const caretBlockPluginKey = new PluginKey<CaretBlockState>(
  "caretBlockVisible",
);

interface CaretBlockState {
  /** Start positions of the decorated top-level blocks. */
  starts: readonly number[];
  decorations: DecorationSet;
}

/** Start of the top-level block containing `$pos`, or null at the doc edge. */
function topLevelStart($pos: ResolvedPos): number | null {
  if ($pos.depth >= 1) return $pos.before(1);
  // A node selection of a top-level block resolves at depth 0.
  return $pos.nodeAfter ? $pos.pos : null;
}

function caretBlockStarts(state: EditorState): number[] {
  const { $from, $to } = state.selection;
  const starts = new Set<number>();
  for (const $pos of [$from, $to]) {
    const start = topLevelStart($pos);
    if (start !== null) starts.add(start);
  }
  return [...starts];
}

function build(state: EditorState): CaretBlockState {
  const starts = caretBlockStarts(state);
  const decorations = DecorationSet.create(
    state.doc,
    starts.flatMap((start) => {
      const node = state.doc.nodeAt(start);
      return node
        ? [
            Decoration.node(start, start + node.nodeSize, {
              class: CARET_BLOCK_CLASS,
            }),
          ]
        : [];
    }),
  );
  return { starts, decorations };
}

function sameStarts(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((start, i) => start === b[i]);
}

/**
 * Marks the top-level block(s) holding the selection so CSS can keep them
 * out of `content-visibility: auto` (see `document-editor.scss`).
 *
 * Chromium misplaces the caret when a character is typed into a block whose
 * content it is still skipping: a block created a moment ago (Enter, a new
 * heading) or one an edit has just switched to `auto`. The character is
 * inserted but the DOM selection reports a spot before it, or in the
 * previous block, and ProseMirror takes that selection: "marker" typed
 * right after Enter becomes "arkerm". It happens with plain contenteditable
 * too, and never without `content-visibility`. Keeping the caret's block
 * rendered avoids it.
 */
export const CaretBlockVisible = Extension.create({
  name: "caretBlockVisible",

  addProseMirrorPlugins() {
    return [
      new Plugin<CaretBlockState>({
        key: caretBlockPluginKey,
        state: {
          init: (_config, state) => build(state),
          apply(tr: Transaction, previous, _oldState, newState) {
            if (!tr.docChanged && !tr.selectionSet) return previous;
            if (!tr.docChanged) {
              const starts = caretBlockStarts(newState);
              if (sameStarts(starts, previous.starts)) return previous;
            }
            return build(newState);
          },
        },
        props: {
          decorations: (state) =>
            caretBlockPluginKey.getState(state)?.decorations,
        },
      }),
    ];
  },
});
