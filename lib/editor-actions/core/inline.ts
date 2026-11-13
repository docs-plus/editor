import {
  buildPreviewOptionsFromAnchor,
  openPreviewHyperlink,
} from "@docs.plus/extension-hyperlink";
import type { Editor } from "@tiptap/core";
import { yUndoPluginKey } from "@tiptap/y-tiptap";

import type {
  AnyAction,
  Ctx,
  Enabled,
  IconComponent,
} from "@/lib/editor-actions/types";
import {
  BoldIcon,
  Code2Icon,
  ItalicIcon,
  LinkIcon,
  Redo2Icon,
  RemoveFormattingIcon,
  StrikeIcon,
  SubscriptIcon,
  SuperscriptIcon,
  UnderlineIcon,
  Undo2Icon,
} from "@/lib/icons";

export const NO_FORMATTING_IN_CODE = "Code has no formatting.";
const SELECT_TEXT = "Select text to format.";
export const HYPERLINK_MARK = "hyperlink";

/** Reasons shared by every inline (mark) action, or `null` when allowed. */
function inlineBlocked(ctx: Ctx): Enabled | null {
  if (ctx.inCodeBlock) return { reason: NO_FORMATTING_IN_CODE };
  if (ctx.nodeSelectionType) return { reason: SELECT_TEXT };
  return null;
}

// --- History -------------------------------------------------------------

/** Undo/redo depth: the Yjs UndoManager stack, else the editor's history. */
function hasHistory(editor: Editor, which: "undo" | "redo"): boolean {
  const manager = yUndoPluginKey.getState(editor.state)?.undoManager;
  if (manager) {
    return (
      (which === "undo" ? manager.undoStack : manager.redoStack).length > 0
    );
  }
  try {
    return which === "undo" ? editor.can().undo() : editor.can().redo();
  } catch {
    return false;
  }
}

function historyAction(
  which: "undo" | "redo",
  label: string,
  shortcut: string,
  icon: IconComponent,
): AnyAction {
  return {
    id: `history.${which}`,
    label,
    group: "history",
    contexts: "any",
    icon,
    shortcut,
    enabled: (ctx) =>
      ctx.can(which, (editor) => hasHistory(editor, which))
        ? true
        : { reason: `Nothing to ${which}.` },
    run: (editor) =>
      which === "undo"
        ? editor.chain().focus().undo().run()
        : editor.chain().focus().redo().run(),
  };
}

// --- Marks ---------------------------------------------------------------

/** True when some text in the selection carries `name` (for "mixed"). */
function rangeHasMark(ctx: Ctx, name: string): boolean {
  return ctx.memo(`hasMark:${name}`, () => {
    const type = ctx.state.schema.marks[name];
    if (!type) return false;
    return ctx.state.selection.ranges.some((range) =>
      ctx.state.doc.rangeHasMark(range.$from.pos, range.$to.pos, type),
    );
  });
}

interface MarkSpec {
  name: string;
  id: string;
  label: string;
  shortcut: string;
  icon: IconComponent;
  markdownHint?: string;
}

function markAction(spec: MarkSpec): AnyAction {
  return {
    id: spec.id,
    label: spec.label,
    group: "mark",
    contexts: "any",
    icon: spec.icon,
    shortcut: spec.shortcut,
    markdownHint: spec.markdownHint,
    enabled(ctx) {
      const blocked = inlineBlocked(ctx);
      if (blocked) return blocked;
      if (!ctx.state.schema.marks[spec.name]) {
        return { reason: "Not available in this version." };
      }
      return ctx.can(`toggleMark:${spec.name}`, (editor) =>
        editor.can().toggleMark(spec.name),
      )
        ? true
        : { reason: "Formatting isn't available here." };
    },
    isActive: (ctx) => ctx.activeMarks.has(spec.name),
    isMixed: (ctx) =>
      !ctx.empty &&
      !ctx.activeMarks.has(spec.name) &&
      rangeHasMark(ctx, spec.name),
    run: (editor) => editor.chain().focus().toggleMark(spec.name).run(),
  };
}

const MARKS: readonly MarkSpec[] = [
  {
    name: "bold",
    id: "mark.bold",
    label: "Bold",
    shortcut: "Mod-b",
    icon: BoldIcon,
    markdownHint: "**text**",
  },
  {
    name: "italic",
    id: "mark.italic",
    label: "Italic",
    shortcut: "Mod-i",
    icon: ItalicIcon,
    markdownHint: "*text*",
  },
  {
    name: "underline",
    id: "mark.underline",
    label: "Underline",
    shortcut: "Mod-u",
    icon: UnderlineIcon,
  },
  {
    name: "strike",
    id: "mark.strike",
    label: "Strike",
    shortcut: "Mod-Shift-s",
    icon: StrikeIcon,
    markdownHint: "~~text~~",
  },
  {
    name: "superscript",
    id: "mark.superscript",
    label: "Superscript",
    shortcut: "Mod-.",
    icon: SuperscriptIcon,
  },
  {
    name: "subscript",
    id: "mark.subscript",
    label: "Subscript",
    shortcut: "Mod-,",
    icon: SubscriptIcon,
  },
  {
    name: "inlineCode",
    id: "mark.inlineCode",
    label: "Inline code",
    shortcut: "Mod-e",
    icon: Code2Icon,
    markdownHint: "`code`",
  },
];

// --- Link ----------------------------------------------------------------

function findAnchorAtSelection(editor: Editor): HTMLAnchorElement | null {
  const { node } = editor.view.domAtPos(editor.state.selection.from);
  const element = node instanceof Element ? node : node.parentElement;
  return element?.closest("a") ?? null;
}

/**
 * Mirrors the extension's `Mod-k`: inside a link, open its preview popover
 * (copy / edit / remove); anywhere else, open the create-link form.
 */
export function openHyperlink(editor: Editor): boolean {
  if (editor.isActive(HYPERLINK_MARK)) {
    const link = findAnchorAtSelection(editor);
    if (link) {
      return openPreviewHyperlink(
        buildPreviewOptionsFromAnchor({ editor, link }),
      );
    }
  }
  return editor.chain().focus().openCreateHyperlinkPopover().run();
}

const linkAction: AnyAction = {
  id: "mark.link",
  label: "Link",
  group: "mark",
  contexts: "any",
  icon: LinkIcon,
  shortcut: "Mod-k",
  enabled(ctx) {
    const blocked = inlineBlocked(ctx);
    if (blocked) return blocked;
    if (!ctx.state.schema.marks[HYPERLINK_MARK]) {
      return { reason: "Not available in this version." };
    }
    if (ctx.activeMarks.has(HYPERLINK_MARK)) return true;
    return ctx.can("setMark:hyperlink", (editor) =>
      editor.can().setMark(HYPERLINK_MARK),
    )
      ? true
      : { reason: "Links can't go here." };
  },
  isActive: (ctx) => ctx.activeMarks.has(HYPERLINK_MARK),
  run: (editor) => openHyperlink(editor),
};

// --- Clear formatting (#392) ---------------------------------------------

/**
 * Removes every inline mark except `hyperlink` in one transaction. Never
 * touches block type, alignment or indent (those are node attributes). An
 * empty selection keeps only stored link marks, so the next keystroke types
 * plain text.
 */
export function clearFormatting(editor: Editor): boolean {
  const { state } = editor;
  const { tr, selection, schema } = state;
  const types = Object.values(schema.marks).filter(
    (type) => type.name !== HYPERLINK_MARK,
  );
  if (selection.empty) {
    const marks = state.storedMarks ?? selection.$from.marks();
    const kept = marks.filter((mark) => mark.type.name === HYPERLINK_MARK);
    if (kept.length === marks.length) return false;
    editor.view.dispatch(tr.setStoredMarks(kept));
    return true;
  }
  for (const range of selection.ranges) {
    for (const type of types) {
      tr.removeMark(range.$from.pos, range.$to.pos, type);
    }
  }
  if (!tr.docChanged) return false;
  editor.view.dispatch(tr);
  return true;
}

const clearFormattingAction: AnyAction = {
  id: "format.clear",
  label: "Clear formatting",
  group: "format",
  contexts: "any",
  icon: RemoveFormattingIcon,
  shortcut: "Mod-\\",
  keywords: ["remove", "reset", "plain"],
  enabled: (ctx) => inlineBlocked(ctx) ?? true,
  run: clearFormatting,
};

export const inlineActions: readonly AnyAction[] = [
  historyAction("undo", "Undo", "Mod-z", Undo2Icon),
  historyAction("redo", "Redo", "Mod-Shift-z", Redo2Icon),
  ...MARKS.map(markAction),
  linkAction,
  clearFormattingAction,
];
