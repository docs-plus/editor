import {
  type EditorState,
  TextSelection,
  type Transaction,
} from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";

import { announceLater } from "@/lib/announce-later";
import { suggestedCodeLanguage } from "@/lib/code-language";
import { editorActions } from "@/lib/editor-actions";
import { TITLE_STYLE_REASON } from "@/lib/editor-actions/core/blocks";
import { availability, runAction } from "@/lib/editor-actions/registry";
import {
  inCell,
  liftWrapped,
  wrappedBlocks,
} from "@/lib/editor-actions/style-lift";
import type { AnyAction } from "@/lib/editor-actions/types";
import { computeContext } from "@/lib/editor-context/snapshot";
import { INSERT_KIND_CHOICE, rememberChoice } from "@/lib/remembered-choice";

/*
 * Turn into's picks (spec §7.2), in the menu chunk: the registry runs
 * them, and this adds what only Turn into promises. A range from the title
 * starts after it ("The title stays a heading."); Code block lifts list
 * items and quote lines first, like the text styles; a range with table
 * cells converts around them ("Table cells keep their type."); Code block
 * over marks says "Formatting removed". Each pill offers Undo.
 */

/** The registry's title refusals: a range past the title skips it instead. */
const TITLE_REASONS = new Set([
  TITLE_STYLE_REASON,
  "Not available in the title.",
]);

/** A range that starts in the title and runs on past it (⌘A). */
export function spansPastTitle(state: EditorState): boolean {
  const { selection } = state;
  return (
    !selection.empty &&
    selection.$from.index(0) === 0 &&
    selection.$to.index(0) > 0
  );
}

/** Whether `reason` is only the title's, which a range past it skips. */
export const isTitleReason = (reason: string | undefined) =>
  reason !== undefined && TITLE_REASONS.has(reason);

/**
 * Whether the selection has a text node with any mark, and whether it
 * mixes textblocks in table cells with others (the cells path). A caret or
 * range inside one cell is not mixed: the cell converts, as on `main`.
 */
function scan(state: EditorState): { marks: boolean; cells: boolean } {
  let marks = false;
  let inside = false;
  let outside = false;
  const { from, to } = state.selection;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.isText && node.marks.length > 0) marks = true;
    if (node.isTextblock) {
      if (inCell(state.doc, pos)) inside = true;
      else outside = true;
    }
    return true;
  });
  return { marks, cells: inside && outside };
}

/** A text style's node and level for `style.*` ids (`style.heading2`). */
function styleTarget(id: string): { name: string; level?: number } {
  const level = Number(id.slice("style.heading".length));
  return level ? { name: "heading", level } : { name: "paragraph" };
}

/**
 * The text style over every selected textblock outside a table cell; cells
 * keep their type (spec §7.2). After `liftWrapped`, so items are top level.
 */
function setStyleOutsideCells(tr: Transaction, id: string): void {
  const { name, level } = styleTarget(id);
  const type = tr.doc.type.schema.nodes[name];
  if (!type) return;
  const { from, to } = tr.selection;
  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true;
    if (inCell(tr.doc, pos)) return false;
    const align = node.attrs.textAlign ?? null;
    tr.setNodeMarkup(
      pos,
      type,
      level ? { level, textAlign: align } : { textAlign: align },
    );
    return false;
  });
}

/** Names what a pick did that the writer may not expect, with Undo. */
function say(editor: Editor, notes: readonly string[]): void {
  if (notes.length === 0) return;
  announceLater(notes.join(" "), {
    action: {
      label: "Undo",
      run: () => {
        const undo = editorActions.get("history.undo");
        if (undo) runAction(editor, undo);
      },
    },
  });
}

/** Moves a range that starts in the title to start after it. */
function skipTitle(editor: Editor): void {
  const { doc, selection, tr } = editor.state;
  const after = doc.resolve(doc.child(0).nodeSize);
  editor.view.dispatch(
    tr.setSelection(TextSelection.between(after, selection.$to)),
  );
}

/** Runs a Turn into pick as one undo step; false when nothing ran. */
export function turnInto(editor: Editor, action: AnyAction): boolean {
  const notes: string[] = [];
  if (spansPastTitle(editor.state)) {
    skipTitle(editor);
    notes.push("The title stays a heading.");
  }
  const found = scan(editor.state);
  const code = action.id === "insert.codeBlock";
  let ok: boolean;
  if (found.cells && action.id.startsWith("style.")) {
    ok =
      availability(action, computeContext(editor)) === true &&
      editor
        .chain()
        .focus()
        .command(({ tr }) => {
          liftWrapped(tr, true);
          setStyleOutsideCells(tr, action.id);
          return true;
        })
        .run();
    if (ok) notes.push("Table cells keep their type.");
  } else if (liftsInto(editor, action.id)) {
    // The registry refuses a code block or quote inside a list or quote:
    // Turn into lifts the selected items out first, in the same step.
    ok = wrapChain(editor, action.id, editor.chain().focus()).run();
    if (ok) {
      rememberChoice(INSERT_KIND_CHOICE, code ? "codeBlock" : "quote");
      if (code && found.marks) notes.push("Formatting removed");
    }
  } else {
    ok = runAction(editor, action);
    if (ok && code && found.marks) notes.push("Formatting removed");
  }
  if (ok) say(editor, notes);
  return ok;
}

type Chain = ReturnType<Editor["chain"]>;

/** Code block or Quote over the selection, its items lifted out first. */
function wrapChain(editor: Editor, id: string, chain: Chain, dryRun = false) {
  const lifted = chain.command(({ tr }) => liftWrapped(tr));
  if (id === "insert.quote") return lifted.setBlockquote();
  // The dry run (`liftsInto`) skips the language, whose suggestion scans
  // the whole document.
  const language = dryRun ? null : suggestedCodeLanguage(editor.state.doc);
  return lifted.toggleCodeBlock(language ? { language } : undefined);
}

/**
 * The dry runs per editor state: an open menu renders its rows on every
 * store change, and the answer only changes with the document or the
 * selection, so each state runs them once (once per open, in practice).
 */
const dryRuns = new WeakMap<EditorState, Map<string, boolean>>();

/**
 * Whether Turn into runs Code block or Quote by lifting first: the
 * selection has list items or quote lines, and the lifted blocks take it.
 */
export function liftsInto(editor: Editor, id: string): boolean {
  if (id !== "insert.codeBlock" && id !== "insert.quote") return false;
  if (!editor.isEditable) return false;
  const { state } = editor;
  let answers = dryRuns.get(state);
  if (!answers) {
    answers = new Map();
    dryRuns.set(state, answers);
  }
  let answer = answers.get(id);
  if (answer === undefined) {
    answer = dryRun(editor, id);
    answers.set(id, answer);
  }
  return answer;
}

function dryRun(editor: Editor, id: string): boolean {
  if (wrappedBlocks(editor.state.tr).length === 0) return false;
  // Inside a quote, Quote stays the checked, refused row.
  if (id === "insert.quote" && computeContext(editor).inBlockquote) {
    return false;
  }
  try {
    return wrapChain(editor, id, editor.can().chain(), true).run();
  } catch {
    return false;
  }
}
