import type { Editor } from "@tiptap/core";
import type { Mark } from "@tiptap/pm/model";

import {
  type ActionOption,
  type AnyAction,
  type ContextKind,
  type Ctx,
  defineAction,
  type Enabled,
} from "@/lib/editor-actions/types";
import { emitUiIntent } from "@/lib/editor-actions/ui-intents";
import { computeContext } from "@/lib/editor-context/snapshot";
import { highlightTokenFromValue } from "@/lib/highlight-tokens";
import {
  BaselineIcon,
  BlockquoteIcon,
  CodeBlockIcon,
  DividerIcon,
  EraserIcon,
  HighlighterIcon,
  ImagePlusIcon,
  MediaEmbedIcon,
  MermaidIcon,
  MinusIcon,
  PlusIcon,
  TableIcon,
} from "@/lib/icons";
import {
  forgetChoices,
  HIGHLIGHT_CHOICE,
  INSERT_KIND_CHOICE,
  type InsertKind,
  isTableSize,
  RECENT_COLORS_CHOICE,
  rememberChoice,
  TABLE_SIZE_CHOICE,
  TEXT_COLOR_CHOICE,
} from "@/lib/remembered-choice";
import {
  FONT_SIZE_LADDER,
  FONT_SIZE_MARK,
  type FontSizeStep,
  HIGHLIGHT_MARK,
  HIGHLIGHT_TOKENS,
  type HighlightToken,
  isFontSizeToken,
  isTextColorToken,
  TEXT_COLOR_MARK,
  TEXT_COLOR_TOKENS,
  type TextColorToken,
} from "@/lib/text-style-tokens";

/**
 * PR D2 actions (contract §4). Id prefixes: color. size. insert. memory.
 * Every `run` is one transaction, re-validates its argument and writes
 * memory only after its command returned true (contract §6). Runs never
 * move focus: the surface decides where focus goes.
 */

/** Kinds that hold inline text formatting. */
const TEXT_KINDS: readonly ContextKind[] = [
  "table",
  "title",
  "heading",
  "list",
  "paragraph",
];
/** Kinds where a block may be inserted (the title refuses in `enabled`). */
const INSERT_KINDS: readonly ContextKind[] = [
  "table",
  "heading",
  "list",
  "paragraph",
];

const capitalize = (token: string) =>
  token.charAt(0).toUpperCase() + token.slice(1);

/** "red" → "Red". Token names double as their visible labels. */
export const colorLabel = capitalize;

/**
 * Whether a command exists on this editor. Until PR C registers its marks,
 * `editor.can().setTextColor` is undefined; actions must refuse, not throw.
 */
function hasCommand(editor: Editor, name: string): boolean {
  return (
    typeof (editor.commands as Record<string, unknown>)[name] === "function"
  );
}

function canDo(ctx: Ctx, name: string, check: (editor: Editor) => boolean) {
  return ctx.can(name, (editor) => hasCommand(editor, name) && check(editor));
}

const enabledIf = (ok: boolean, reason: string): Enabled =>
  ok ? true : { reason };

interface MarkState {
  /** Distinct marks of the type found in the selection. */
  marks: readonly Mark[];
  /** Two values, or a value next to unmarked text. */
  mixed: boolean;
}

/** One mark type across the selection (or at the caret), per snapshot. */
function markState(ctx: Ctx, markName: string): MarkState {
  return ctx.memo(`marks:${markName}`, () => {
    const { state } = ctx;
    const { from, to, empty, $from } = state.selection;
    const pick = (marks: readonly Mark[]) =>
      marks.filter((mark) => mark.type.name === markName);
    if (empty) {
      return { marks: pick(state.storedMarks ?? $from.marks()), mixed: false };
    }
    const found: Mark[] = [];
    let unmarked = false;
    state.doc.nodesBetween(from, to, (node) => {
      if (!node.isText) return;
      const marks = pick(node.marks);
      if (marks.length === 0) unmarked = true;
      for (const mark of marks) {
        if (!found.some((seen) => seen.eq(mark))) found.push(mark);
      }
      // Stop walking once the answer is "mixed".
      return found.length + (unmarked ? 1 : 0) < 2;
    });
    return {
      marks: found,
      mixed: found.length > 1 || (unmarked && found.length > 0),
    };
  });
}

/** The single value of a mark attribute across the selection, or null. */
function singleAttr(ctx: Ctx, markName: string, attr: string): unknown {
  const { marks, mixed } = markState(ctx, markName);
  return !mixed && marks.length === 1 ? marks[0].attrs[attr] : null;
}

const hasMark = (ctx: Ctx, markName: string) =>
  markState(ctx, markName).marks.length > 0;
const isMixed = (ctx: Ctx, markName: string) => markState(ctx, markName).mixed;

const isHighlightToken = (value: unknown): value is HighlightToken =>
  typeof value === "string" &&
  (HIGHLIGHT_TOKENS as readonly string[]).includes(value);

/* ------------------------------------------------------------------ */
/* Colour (M1–M3)                                                      */
/* ------------------------------------------------------------------ */

const TEXT_COLOR_REASON = "Text colour isn't available here.";
const HIGHLIGHT_REASON = "Highlight isn't available here.";

const textColorOptions: readonly ActionOption<TextColorToken>[] =
  TEXT_COLOR_TOKENS.map((token) => ({
    value: token,
    label: `${colorLabel(token)} text`,
    keywords: [token, "colour", "color"],
  }));

const highlightOptions: readonly ActionOption<HighlightToken>[] =
  HIGHLIGHT_TOKENS.map((token) => ({
    value: token,
    label: `${colorLabel(token)} highlight`,
    keywords: [token, "highlight", "background"],
  }));

/** The current text colour token of the selection, or null. */
export function currentTextColor(ctx: Ctx): TextColorToken | null {
  const value = singleAttr(ctx, TEXT_COLOR_MARK, "color");
  return isTextColorToken(value) ? value : null;
}

/** The current highlight token (legacy values mapped), or null. */
export function currentHighlight(ctx: Ctx): HighlightToken | null {
  return highlightTokenFromValue(singleAttr(ctx, HIGHLIGHT_MARK, "color"));
}

const canTextColor = (ctx: Ctx) =>
  canDo(ctx, "setTextColor", (editor) => editor.can().setTextColor("red"));
const canHighlight = (ctx: Ctx) =>
  canDo(ctx, "setHighlight", (editor) =>
    editor.can().setHighlight({ color: "yellow" }),
  );

const textColorApply = defineAction<TextColorToken>({
  id: "color.text.apply",
  label: "Text colour",
  group: "color",
  contexts: TEXT_KINDS,
  keywords: ["colour", "color", "font colour"],
  icon: BaselineIcon,
  enabled: (ctx) => enabledIf(canTextColor(ctx), TEXT_COLOR_REASON),
  isActive: (ctx) => hasMark(ctx, TEXT_COLOR_MARK),
  isMixed: (ctx) => isMixed(ctx, TEXT_COLOR_MARK),
  value: (ctx) => {
    const token = currentTextColor(ctx);
    return token ? colorLabel(token) : null;
  },
  options: () => textColorOptions,
  run(editor, token) {
    if (!isTextColorToken(token) || !hasCommand(editor, "setTextColor")) {
      return false;
    }
    if (!editor.chain().setTextColor(token).run()) return false;
    rememberChoice(TEXT_COLOR_CHOICE, token);
    rememberChoice(RECENT_COLORS_CHOICE, { kind: "text", token });
    return true;
  },
});

const textColorUnset = defineAction({
  id: "color.text.unset",
  label: "Default text colour",
  group: "color",
  contexts: TEXT_KINDS,
  keywords: ["remove colour", "clear colour"],
  enabled: (ctx) => enabledIf(canTextColor(ctx), TEXT_COLOR_REASON),
  run: (editor) =>
    hasCommand(editor, "unsetTextColor") &&
    editor.chain().unsetTextColor().run(),
});

const highlightApply = defineAction<HighlightToken>({
  id: "color.highlight.apply",
  label: "Highlight",
  group: "color",
  contexts: TEXT_KINDS,
  keywords: ["highlight", "background", "marker"],
  icon: HighlighterIcon,
  enabled: (ctx) => enabledIf(canHighlight(ctx), HIGHLIGHT_REASON),
  isActive: (ctx) => hasMark(ctx, HIGHLIGHT_MARK),
  isMixed: (ctx) => isMixed(ctx, HIGHLIGHT_MARK),
  value: (ctx) => {
    const token = currentHighlight(ctx);
    return token ? colorLabel(token) : null;
  },
  options: () => highlightOptions,
  run(editor, token) {
    // Only bare tokens are written; render maps legacy values (B4).
    if (!isHighlightToken(token)) return false;
    if (!editor.chain().setHighlight({ color: token }).run()) return false;
    rememberChoice(HIGHLIGHT_CHOICE, token);
    rememberChoice(RECENT_COLORS_CHOICE, { kind: "highlight", token });
    return true;
  },
});

const highlightUnset = defineAction({
  id: "color.highlight.unset",
  label: "No highlight",
  group: "color",
  contexts: TEXT_KINDS,
  keywords: ["remove highlight", "clear highlight"],
  enabled: (ctx) => enabledIf(canHighlight(ctx), HIGHLIGHT_REASON),
  run: (editor) => editor.chain().unsetHighlight().run(),
});

/* ------------------------------------------------------------------ */
/* Size                                                                */
/* ------------------------------------------------------------------ */

const HEADING_SIZE_REASON = "Headings scale automatically.";
const SIZE_REASON = "Font size isn't available here.";

export const FONT_SIZE_LABELS: Readonly<Record<FontSizeStep, string>> = {
  xs: "Extra small",
  sm: "Small",
  md: "Medium",
  lg: "Large",
  xl: "Extra large",
};

export const FONT_SIZE_SHORT: Readonly<Record<FontSizeStep, string>> = {
  xs: "XS",
  sm: "S",
  md: "M",
  lg: "L",
  xl: "XL",
};

const isFontSizeStep = (value: unknown): value is FontSizeStep =>
  typeof value === "string" &&
  (FONT_SIZE_LADDER as readonly string[]).includes(value);

/** The selection's size step; `"md"` when unmarked or mixed. */
export function currentSizeStep(ctx: Ctx): FontSizeStep {
  const size = singleAttr(ctx, FONT_SIZE_MARK, "size");
  if (isFontSizeToken(size)) return size;
  return "md";
}

function sizeEnabled(ctx: Ctx): Enabled {
  // `headingLevel` also covers the title, whatever kind the snapshot gives.
  if (ctx.headingLevel !== null) return { reason: HEADING_SIZE_REASON };
  return enabledIf(
    canDo(ctx, "setFontSize", (editor) => editor.can().setFontSize("lg")),
    SIZE_REASON,
  );
}

function applySize(editor: Editor, step: FontSizeStep): boolean {
  if (step === "md") {
    return (
      hasCommand(editor, "unsetFontSize") &&
      editor.chain().unsetFontSize().run()
    );
  }
  return (
    hasCommand(editor, "setFontSize") && editor.chain().setFontSize(step).run()
  );
}

/** One step up or down from the live selection, clamped to the ladder. */
function stepSize(editor: Editor, delta: 1 | -1): boolean {
  const index = FONT_SIZE_LADDER.indexOf(
    currentSizeStep(computeContext(editor)),
  );
  const next = FONT_SIZE_LADDER[index + delta];
  return next !== undefined && applySize(editor, next);
}

const sizeIncrease = defineAction({
  id: "size.increase",
  label: "Increase font size",
  group: "size",
  contexts: TEXT_KINDS,
  keywords: ["bigger", "larger", "font size"],
  icon: PlusIcon,
  enabled(ctx) {
    const base = sizeEnabled(ctx);
    if (base !== true) return base;
    return enabledIf(
      currentSizeStep(ctx) !== "xl",
      "Already the largest size.",
    );
  },
  run: (editor) => stepSize(editor, 1),
});

const sizeDecrease = defineAction({
  id: "size.decrease",
  label: "Decrease font size",
  group: "size",
  contexts: TEXT_KINDS,
  keywords: ["smaller", "font size"],
  icon: MinusIcon,
  enabled(ctx) {
    const base = sizeEnabled(ctx);
    if (base !== true) return base;
    return enabledIf(
      currentSizeStep(ctx) !== "xs",
      "Already the smallest size.",
    );
  },
  run: (editor) => stepSize(editor, -1),
});

const sizeOptions: readonly ActionOption<FontSizeStep>[] = FONT_SIZE_LADDER.map(
  (step) => ({ value: step, label: FONT_SIZE_LABELS[step] }),
);

const sizeSet = defineAction<FontSizeStep>({
  id: "size.set",
  label: "Font size",
  group: "size",
  contexts: TEXT_KINDS,
  keywords: ["font size", "text size"],
  enabled: sizeEnabled,
  isMixed: (ctx) => isMixed(ctx, FONT_SIZE_MARK),
  value: currentSizeStep,
  options: () => sizeOptions,
  run: (editor, step) => isFontSizeStep(step) && applySize(editor, step),
});

/* ------------------------------------------------------------------ */
/* Insert (M10 memory of the kind, M17a table size)                    */
/* ------------------------------------------------------------------ */

const TITLE_REASON = "Not available in the title.";

function insertEnabled(
  ctx: Ctx,
  command: string,
  check: (e: Editor) => boolean,
) {
  if (ctx.isTitle) return { reason: TITLE_REASON };
  return enabledIf(canDo(ctx, command, check), "Can't insert that here.");
}

function inserted(kind: InsertKind, ok: boolean): boolean {
  if (ok) rememberChoice(INSERT_KIND_CHOICE, kind);
  return ok;
}

const insertImage = defineAction({
  id: "insert.image",
  label: "Image",
  group: "insert",
  contexts: INSERT_KINDS,
  keywords: ["picture", "photo", "upload"],
  icon: ImagePlusIcon,
  // `imageUpload` is the image's first step: a drop zone, not a file.
  enabled: (ctx) =>
    insertEnabled(ctx, "insertContent", (editor) =>
      editor.can().insertContent({ type: "imageUpload" }),
    ),
  run: (editor) =>
    inserted(
      "image",
      Boolean(editor.schema.nodes.imageUpload) &&
        editor.chain().insertContent({ type: "imageUpload" }).run(),
    ),
});

const insertEmbed = defineAction({
  id: "insert.embed",
  label: "Embed",
  group: "insert",
  contexts: INSERT_KINDS,
  keywords: ["video", "youtube", "audio", "media"],
  icon: MediaEmbedIcon,
  enabled: (ctx) =>
    ctx.isTitle
      ? { reason: TITLE_REASON }
      : enabledIf(Boolean(ctx.state.schema.nodes.image), "Can't embed here."),
  // Needs a link first: the shell opens its input; the embed itself writes.
  run: (editor) => emitUiIntent(editor, { type: "insert.open", kind: "embed" }),
});

const insertTable = defineAction<unknown>({
  id: "insert.table",
  label: "Table",
  group: "insert",
  contexts: INSERT_KINDS,
  keywords: ["grid", "rows", "columns"],
  icon: TableIcon,
  enabled: (ctx) =>
    insertEnabled(ctx, "insertTable", (editor) =>
      editor.can().insertTable({ rows: 2, cols: 2 }),
    ),
  run(editor, size) {
    // Without a valid size the shell opens the grid (M17a) first.
    if (!isTableSize(size)) {
      return emitUiIntent(editor, { type: "insert.open", kind: "table" });
    }
    const ok = editor
      .chain()
      .insertTable({ rows: size.rows, cols: size.cols, withHeaderRow: true })
      .run();
    if (ok)
      rememberChoice(TABLE_SIZE_CHOICE, { rows: size.rows, cols: size.cols });
    return inserted("table", ok);
  },
});

const insertQuote = defineAction({
  id: "insert.quote",
  label: "Quote",
  group: "insert",
  contexts: INSERT_KINDS,
  keywords: ["blockquote", "citation"],
  icon: BlockquoteIcon,
  markdownHint: "> ",
  isActive: (ctx) => ctx.inBlockquote,
  enabled: (ctx) =>
    insertEnabled(ctx, "toggleBlockquote", (editor) =>
      editor.can().toggleBlockquote(),
    ),
  run: (editor) => inserted("quote", editor.chain().toggleBlockquote().run()),
});

const insertCodeBlock = defineAction({
  id: "insert.codeBlock",
  label: "Code block",
  group: "insert",
  contexts: INSERT_KINDS,
  keywords: ["code", "snippet", "pre"],
  icon: CodeBlockIcon,
  markdownHint: "```",
  enabled: (ctx) =>
    insertEnabled(ctx, "toggleCodeBlock", (editor) =>
      editor.can().toggleCodeBlock(),
    ),
  run: (editor) =>
    inserted("codeBlock", editor.chain().toggleCodeBlock().run()),
});

const insertMermaid = defineAction({
  id: "insert.mermaid",
  label: "Diagram",
  group: "insert",
  contexts: INSERT_KINDS,
  keywords: ["mermaid", "chart", "flowchart"],
  icon: MermaidIcon,
  enabled: (ctx) =>
    insertEnabled(ctx, "insertMermaid", (editor) =>
      editor.can().insertMermaid(),
    ),
  run: (editor) =>
    inserted(
      "mermaid",
      hasCommand(editor, "insertMermaid") &&
        editor.chain().insertMermaid().run(),
    ),
});

const insertDivider = defineAction({
  id: "insert.divider",
  label: "Divider",
  group: "insert",
  contexts: INSERT_KINDS,
  keywords: ["horizontal rule", "line", "separator"],
  icon: DividerIcon,
  markdownHint: "---",
  enabled: (ctx) =>
    insertEnabled(ctx, "setHorizontalRule", (editor) =>
      editor.can().setHorizontalRule(),
    ),
  run: (editor) =>
    inserted("divider", editor.chain().setHorizontalRule().run()),
});

/* ------------------------------------------------------------------ */
/* Memory                                                              */
/* ------------------------------------------------------------------ */

const memoryForget = defineAction({
  id: "memory.forget",
  label: "Forget my choices",
  group: "memory",
  contexts: "any",
  keywords: ["reset", "clear", "privacy", "remembered"],
  icon: EraserIcon,
  mutates: false,
  enabled: () => true,
  run() {
    forgetChoices();
    return true;
  },
});

export const surfaceActions: readonly AnyAction[] = [
  textColorApply,
  textColorUnset,
  highlightApply,
  highlightUnset,
  sizeIncrease,
  sizeDecrease,
  sizeSet,
  insertImage,
  insertEmbed,
  insertTable,
  insertQuote,
  insertCodeBlock,
  insertMermaid,
  insertDivider,
  memoryForget,
] as readonly AnyAction[];
