import { Mark } from "@tiptap/core";
import { isChangeOrigin } from "@tiptap/extension-collaboration";
import {
  Fragment,
  type MarkType,
  type Node as PMNode,
  Slice,
} from "@tiptap/pm/model";
import {
  type EditorState,
  Plugin,
  PluginKey,
  type Transaction,
} from "@tiptap/pm/state";

import { changedRanges } from "@/extensions/shared/changed-ranges";
import {
  FONT_SIZE_ATTR,
  FONT_SIZE_MARK,
  type FontSizeToken,
  isFontSizeToken,
} from "@/lib/text-style-tokens";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    fontSize: {
      /**
       * Sets a size step on text outside headings and the title. An empty
       * selection sets a stored mark (not in a heading). False for anything
       * but a token, or when nothing in the selection can take it.
       */
      setFontSize: (size: FontSizeToken) => ReturnType;
      /** Removes size from the selection, or from the whole run around an empty cursor. */
      unsetFontSize: () => ReturnType;
    };
  }
}

const HEADING = "heading";

const tokenOf = (element: HTMLElement): FontSizeToken | null => {
  const value = element.getAttribute(FONT_SIZE_ATTR);
  return isFontSizeToken(value) ? value : null;
};

/** True for a textblock that may carry `fontSize`: never a heading (the title is one). */
const takesSize = (block: PMNode, type: MarkType) =>
  block.type.name !== HEADING && block.type.allowsMarkType(type);

export const fontSizeHeadingGuardKey = new PluginKey("fontSizeHeadingGuard");

/** A Yjs transaction, or one another plugin appended in response to one. */
const isRemote = (tr: Transaction) =>
  isChangeOrigin(tr) ||
  isChangeOrigin(
    (tr.getMeta("appendedTransaction") as Transaction | undefined) ?? tr,
  );

const hasMark = (node: PMNode, type: MarkType) => {
  let found = false;
  node.descendants((child) => {
    found ||= !!type.isInSet(child.marks);
    return !found;
  });
  return found;
};

/** `fragment` with `fontSize` removed from every heading's text. */
function stripFromHeadings(fragment: Fragment, type: MarkType): Fragment {
  const nodes: PMNode[] = [];
  let changed = false;
  fragment.forEach((node) => {
    let next = node;
    if (node.type.name === HEADING) {
      if (hasMark(node, type)) {
        const content: PMNode[] = [];
        node.content.forEach((child) => {
          content.push(child.mark(type.removeFromSet(child.marks)));
        });
        next = node.copy(Fragment.from(content));
      }
    } else if (!node.isTextblock && node.childCount > 0) {
      const inner = stripFromHeadings(node.content, type);
      if (inner !== node.content) next = node.copy(inner);
    }
    if (next !== node) changed = true;
    nodes.push(next);
  });
  return changed ? Fragment.from(nodes) : fragment;
}

/**
 * Removes `fontSize` that a local edit put inside a heading: turning a sized
 * paragraph into a heading (commands, `## `), paste and drop into headings
 * and the title, typing with a stored size. Runs in the same transaction, so
 * one undo restores the size. Remote (Yjs) transactions are never rewritten:
 * old documents and other clients' edits render at heading size through CSS
 * instead (`text-style-marks.scss`).
 */
function headingGuard(type: MarkType): Plugin {
  return new Plugin({
    key: fontSizeHeadingGuardKey,
    props: {
      // A pasted heading's text never keeps its size, even where the paste
      // flows it into a paragraph.
      transformPasted: (slice) =>
        new Slice(
          stripFromHeadings(slice.content, type),
          slice.openStart,
          slice.openEnd,
        ),
    },
    appendTransaction(transactions, _oldState, state: EditorState) {
      if (!transactions.some((tr) => tr.docChanged)) return null;
      if (transactions.some(isRemote)) return null;

      const ranges = changedRanges(transactions) ?? [
        { from: 0, to: state.doc.content.size },
      ];
      let tr: Transaction | null = null;
      for (const { from, to } of ranges) {
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (node.type.name !== HEADING) return !node.isTextblock;
          const start = pos + 1;
          const end = pos + node.nodeSize - 1;
          if (state.doc.rangeHasMark(start, end, type)) {
            tr ??= state.tr;
            tr.removeMark(start, end, type);
          }
          return false;
        });
      }
      return tr;
    },
  });
}

/**
 * Font size as a ladder step (spec §3): `xs sm lg xl`; the default size is
 * the absence of the mark. Standalone mark, rendered only as
 * `data-font-size` for a known token, never as inline style. Kept out of
 * headings and the title by its command and the heading guard, never by the
 * schema (spec §3 schema evolution rule).
 */
export const FontSize = Mark.create({
  name: FONT_SIZE_MARK,

  inclusive: true,

  addAttributes() {
    return {
      size: {
        default: null,
        parseHTML: tokenOf,
        renderHTML: (attributes: Record<string, unknown>) =>
          isFontSizeToken(attributes.size)
            ? { [FONT_SIZE_ATTR]: attributes.size }
            : {},
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: `span[${FONT_SIZE_ATTR}]`,
        consuming: false,
        getAttrs: (element) => (tokenOf(element) ? null : false),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", HTMLAttributes, 0];
  },

  addCommands() {
    return {
      setFontSize:
        (size) =>
        ({ state, tr, dispatch }) => {
          if (!isFontSizeToken(size)) return false;
          const type = state.schema.marks[this.name];
          const mark = type.create({ size });
          const { selection } = state;

          if (selection.empty) {
            if (!takesSize(selection.$from.parent, type)) return false;
            if (dispatch) tr.addStoredMark(mark);
            return true;
          }

          let applied = false;
          for (const { $from, $to } of selection.ranges) {
            state.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
              if (!node.isTextblock) return true;
              if (!takesSize(node, type)) return false;
              const from = Math.max(pos + 1, $from.pos);
              const to = Math.min(pos + node.nodeSize - 1, $to.pos);
              if (from < to) {
                applied = true;
                if (dispatch) tr.addMark(from, to, mark);
              }
              return false;
            });
          }
          return applied;
        },
      unsetFontSize:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name, { extendEmptyMarkRange: true }),
    };
  },

  addProseMirrorPlugins() {
    return [headingGuard(this.type)];
  },
});
