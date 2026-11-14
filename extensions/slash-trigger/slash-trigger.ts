import { type Editor, Extension } from "@tiptap/core";
import {
  type EditorState,
  Plugin,
  PluginKey,
  type Transaction,
} from "@tiptap/pm/state";
import type { ReplaceStep } from "@tiptap/pm/transform";
import { ySyncPluginKey } from "@tiptap/y-tiptap";

/**
 * The "/" block menu's trigger (eager, so it is as small as it can be).
 * It watches local transactions for a typed "/" where a block action can
 * go, and keeps `{ from, query }` while the menu may show. Everything
 * else (keys, the combobox attributes, the list) is the lazy menu's
 * (`components/smart-toolbar/slash/`), mounted by `SlashMenuHost` while
 * this state is open. The query is ordinary text in the document.
 */

export type SlashState =
  | { readonly open: false }
  | {
      readonly open: true;
      /** Position of the "/" itself. */
      readonly from: number;
      /** The text typed after the "/" up to the caret. */
      readonly query: string;
    };

/** A longer query closes the menu ("/usr/bin…" is just text). */
export const SLASH_MAX_QUERY = 24;

const CLOSED: SlashState = { open: false };

export const slashTriggerKey = new PluginKey<SlashState>("slashTrigger");

/** The trigger's state; closed in a read-only or destroyed editor. */
export function getSlashState(editor: Editor): SlashState {
  if (editor.isDestroyed || !editor.isEditable) return CLOSED;
  return slashTriggerKey.getState(editor.state) ?? CLOSED;
}

/** Closes the menu, leaving "/query" as typed text (meta only). */
export function closeSlash(editor: Editor): void {
  if (slashTriggerKey.getState(editor.state)?.open) {
    editor.view.dispatch(editor.state.tr.setMeta(slashTriggerKey, true));
  }
}

/**
 * Where `tr` typed one "/" that may open the menu, else null: one local
 * insertion of exactly "/" at an empty caret (no paste, drop or remote
 * step), in a paragraph (so never the title, a heading or a code block),
 * outside inline code, at the block start or after whitespace or an
 * inline node. Ordinary typing costs the first check.
 */
function typedSlash(tr: Transaction, state: EditorState): number | null {
  if (tr.steps.length !== 1) return null;
  const { from, to, slice } = tr.steps[0] as ReplaceStep;
  const text =
    slice?.content.childCount === 1 ? slice.content.firstChild : null;
  if (text?.text !== "/" || from !== to) return null;
  if (tr.getMeta("uiEvent") || tr.getMeta(ySyncPluginKey)) return null;
  const { selection, doc } = state;
  if (!selection.empty || selection.head !== from + 1) return null;
  const $from = doc.resolve(from);
  if ($from.parent.type.name !== "paragraph") return null;
  if (text.marks.some((mark) => mark.type.spec.code)) return null;
  const before = $from.nodeBefore;
  return before?.isText && !/\s$/.test(before.text ?? "") ? null : from;
}

/**
 * The open state after `tr`, or closed. Local steps map the "/"; a
 * remote one replaces whole blocks, so the "/" is found again from the
 * caret the binding restored. The same object when nothing changed.
 */
function track(
  prev: Extract<SlashState, { open: true }>,
  tr: Transaction,
  state: EditorState,
): SlashState {
  const { selection, doc } = state;
  const head = selection.head;
  const from = tr.getMeta(ySyncPluginKey)
    ? head - 1 - prev.query.length
    : tr.mapping.map(prev.from, -1);
  if (!selection.empty || from < 0 || head <= from) return CLOSED;
  if (head > doc.resolve(from).end() || doc.textBetween(from, head)[0] !== "/")
    return CLOSED;
  const query = doc.textBetween(from + 1, head);
  // "1 / 2", "/usr/bin", a sentence: text, not a block query.
  if (query.length > SLASH_MAX_QUERY || /^\s|\/|\s\s/.test(query)) {
    return CLOSED;
  }
  return from === prev.from && query === prev.query
    ? prev
    : { open: true, from, query };
}

export const SlashTrigger = Extension.create({
  name: "slashTrigger",

  addProseMirrorPlugins() {
    const { editor } = this;
    return [
      new Plugin<SlashState>({
        key: slashTriggerKey,
        state: {
          init: () => CLOSED,
          apply(tr, prev, _old, state) {
            if (!prev.open) {
              const from = editor.isEditable ? typedSlash(tr, state) : null;
              return from === null ? prev : { open: true, from, query: "" };
            }
            if (tr.getMeta(slashTriggerKey) || tr.getMeta("blur")) {
              return CLOSED;
            }
            return tr.docChanged || tr.selectionSet
              ? track(prev, tr, state)
              : prev;
          },
        },
      }),
    ];
  },
});
