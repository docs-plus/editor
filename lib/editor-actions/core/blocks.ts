import type { Editor } from "@tiptap/core";
import type { Selection } from "@tiptap/pm/state";

import type { AnyAction, Ctx, IconComponent } from "@/lib/editor-actions/types";
import { computeContext } from "@/lib/editor-context/snapshot";
import {
  BLOCK_CONVERTIBLE_TYPES,
  prepareBlockToggle,
  selectionWithinConvertibleTypes,
} from "@/lib/editor-utils";
import {
  AlignCenterIcon,
  AlignJustifyIcon,
  AlignLeftIcon,
  AlignRightIcon,
  HeadingFiveIcon,
  HeadingFourIcon,
  HeadingOneIcon,
  HeadingSixIcon,
  HeadingThreeIcon,
  HeadingTwoIcon,
  IndentDecreaseIcon,
  IndentIncreaseIcon,
  ListIcon,
  ListOrderedIcon,
  ListTodoIcon,
} from "@/lib/icons";

// --- Text style ----------------------------------------------------------

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
export type TextStyleValue = "title" | "paragraph" | `heading-${HeadingLevel}`;

export const TEXT_STYLE_LABELS: Record<TextStyleValue | "mixed", string> = {
  title: "Title",
  paragraph: "Normal text",
  "heading-1": "Heading 1",
  "heading-2": "Heading 2",
  "heading-3": "Heading 3",
  "heading-4": "Heading 4",
  "heading-5": "Heading 5",
  "heading-6": "Heading 6",
  mixed: "Mixed",
};

export const TITLE_STYLE_REASON = "Title is always H1.";

function styleOfBlock(
  name: string,
  level: unknown,
): Exclude<TextStyleValue, "title"> | null {
  if (name === "paragraph") return "paragraph";
  if (name === "heading") return `heading-${level as HeadingLevel}`;
  return null;
}

/**
 * The text style of the selection: "title" in the first block, the one
 * style every selected textblock shares, else "mixed". Stops at the first
 * block that differs.
 */
export function textStyleOf(ctx: Ctx): TextStyleValue | "mixed" {
  return ctx.memo("textStyle", () => {
    if (ctx.isTitle) return "title";
    const { selection, doc } = ctx.state;
    const { $from } = selection;
    if (selection.empty) {
      return (
        styleOfBlock($from.parent.type.name, $from.parent.attrs.level) ??
        "paragraph"
      );
    }
    let style: TextStyleValue | "mixed" | null = null;
    doc.nodesBetween(selection.from, selection.to, (node, pos) => {
      if (style === "mixed") return false;
      if (!node.isTextblock) return true;
      const own =
        pos === 0
          ? "title"
          : (styleOfBlock(node.type.name, node.attrs.level) ?? "paragraph");
      style = style === null || style === own ? own : "mixed";
      return false;
    });
    return style ?? "paragraph";
  });
}

/** Reads the text style at the caret of a live editor (outside a snapshot). */
export function getTextStyleValue(editor: Editor | null): TextStyleValue {
  if (!editor) return "paragraph";
  const { $from } = editor.state.selection;
  if ($from.index(0) === 0) return "title";
  return (
    styleOfBlock($from.parent.type.name, $from.parent.attrs.level) ??
    "paragraph"
  );
}

function canSetTextStyle(editor: Editor, level?: HeadingLevel): boolean {
  if (!editor.schema.nodes.heading) return false;
  if (!selectionWithinConvertibleTypes(editor, [...BLOCK_CONVERTIBLE_TYPES])) {
    return false;
  }
  const direct = level
    ? editor.can().setNode("heading", { level })
    : editor.can().setNode("paragraph");
  return direct || editor.can().clearNodes();
}

/** True when the selection starts in the title, which is always H1. */
function startsInTitle(selection: Selection): boolean {
  return selection.$from.index(0) === 0;
}

/**
 * Sets the text style of the selected blocks. Unlike `toggleHeading`,
 * picking the style every selected block already has does nothing; a mixed
 * range is converted. A range that starts in the title is refused.
 */
export function setTextStyle(
  editor: Editor | null,
  value: Exclude<TextStyleValue, "title">,
): boolean {
  if (!editor?.isEditable) return false;
  const { selection } = editor.state;
  if (startsInTitle(selection)) return false;
  if (textStyleOf(computeContext(editor)) === value) return false;
  const level =
    value === "paragraph"
      ? undefined
      : (Number(value.slice(8)) as HeadingLevel);
  if (!canSetTextStyle(editor, level)) return false;
  try {
    const chain = prepareBlockToggle(editor);
    (level
      ? chain.setNode("heading", { level })
      : chain.setNode("paragraph")
    ).run();
    // A caret moves to the end of its block; a range stays selected.
    const next = editor.chain().focus();
    (selection.empty ? next.selectTextblockEnd() : next).run();
    return true;
  } catch {
    return false;
  }
}

const HEADING_ICONS: Record<HeadingLevel, IconComponent> = {
  1: HeadingOneIcon,
  2: HeadingTwoIcon,
  3: HeadingThreeIcon,
  4: HeadingFourIcon,
  5: HeadingFiveIcon,
  6: HeadingSixIcon,
};

function styleAction(
  value: Exclude<TextStyleValue, "title">,
  shortcut: string,
  icon?: IconComponent,
): AnyAction {
  const level =
    value === "paragraph"
      ? undefined
      : (Number(value.slice(8)) as HeadingLevel);
  return {
    id: level ? `style.heading${level}` : "style.paragraph",
    label: TEXT_STYLE_LABELS[value],
    group: "style",
    contexts: "any",
    icon,
    shortcut,
    markdownHint: level ? `${"#".repeat(level)} ` : undefined,
    enabled(ctx) {
      if (ctx.isTitle || startsInTitle(ctx.state.selection)) {
        return { reason: TITLE_STYLE_REASON };
      }
      if (ctx.nodeSelectionType) return { reason: "Select text to style." };
      return ctx.can(`textStyle:${value}`, (editor) =>
        canSetTextStyle(editor, level),
      )
        ? true
        : { reason: "Text styles can't go here." };
    },
    isActive: (ctx) => textStyleOf(ctx) === value,
    value: (ctx) => TEXT_STYLE_LABELS[textStyleOf(ctx)],
    run: (editor) => setTextStyle(editor, value),
  };
}

// --- Lists ---------------------------------------------------------------

export type ListType = "bulletList" | "orderedList" | "taskList";

/** The nearest list's type at the head, or null outside a list. */
export function listTypeOf(ctx: Ctx): ListType | null {
  return ctx.memo("listType", () => {
    const { $head } = ctx.state.selection;
    for (let depth = $head.depth; depth > 0; depth -= 1) {
      const name = $head.node(depth).type.name;
      if (
        name === "bulletList" ||
        name === "orderedList" ||
        name === "taskList"
      ) {
        return name;
      }
    }
    return null;
  });
}

const LIST_COMMANDS = {
  bulletList: "toggleBulletList",
  orderedList: "toggleOrderedList",
  taskList: "toggleTaskList",
} as const;

function listAction(
  id: string,
  type: ListType,
  label: string,
  shortcut: string,
  icon: IconComponent,
  markdownHint: string,
): AnyAction {
  const command = LIST_COMMANDS[type];
  return {
    id,
    label,
    group: "list",
    contexts: "any",
    icon,
    shortcut,
    markdownHint,
    enabled(ctx) {
      if (ctx.inCodeBlock || ctx.nodeSelectionType) {
        return { reason: "Lists can't go here." };
      }
      if (!ctx.state.schema.nodes[type]) {
        return { reason: "Not available in this version." };
      }
      return ctx.can(command, (editor) => editor.can()[command]())
        ? true
        : { reason: "Lists can't go here." };
    },
    isActive: (ctx) => listTypeOf(ctx) === type,
    run: (editor) => editor.chain().focus()[command]().run(),
  };
}

// --- Alignment -----------------------------------------------------------

export type TextAlign = "left" | "center" | "right" | "justify";
const ALIGNABLE = new Set(["paragraph", "heading"]);

/** The alignment of the block at the head (default left). */
export function alignOf(ctx: Ctx): TextAlign {
  const { parent } = ctx.state.selection.$head;
  return ((parent.attrs.textAlign as TextAlign | null) ?? "left") as TextAlign;
}

function alignAction(
  value: TextAlign,
  label: string,
  shortcut: string,
  icon: IconComponent,
): AnyAction {
  return {
    id: `align.${value}`,
    label,
    group: "align",
    contexts: "any",
    icon,
    shortcut,
    enabled(ctx) {
      if (ctx.nodeSelectionType || !ALIGNABLE.has(ctx.parentType)) {
        return { reason: "Alignment works in paragraphs and headings." };
      }
      return ctx.can(`align:${value}`, (editor) =>
        editor.can().setTextAlign(value),
      )
        ? true
        : { reason: "Alignment works in paragraphs and headings." };
    },
    isActive: (ctx) => alignOf(ctx) === value,
    value: (ctx) => alignOf(ctx),
    run: (editor) => editor.chain().focus().setTextAlign(value).run(),
  };
}

// --- Indent (mirrors Tab: sinkListItem → indent) -------------------------

export type IndentAction = "indent" | "outdent";

/** List item node types the schema knows, in the order Tab tries them. */
export function listItemTypes(editor: Editor): string[] {
  const { nodes } = editor.schema;
  return ["listItem", "taskItem"].filter((name) => nodes[name]);
}

const LIST_COMMAND = {
  indent: "sinkListItem",
  outdent: "liftListItem",
} as const;

function listTypeFor(editor: Editor, action: IndentAction): string | null {
  const command = LIST_COMMAND[action];
  return (
    listItemTypes(editor).find((type) => editor.can()[command](type)) ?? null
  );
}

/**
 * Mirrors the Tab / Shift+Tab chain without the table-cell moves: list item
 * sink or lift first, then the text indent.
 */
export function canApplyIndent(
  editor: Editor | null,
  action: IndentAction,
): boolean {
  if (!editor?.isEditable) return false;
  try {
    if (listTypeFor(editor, action)) return true;
    return action === "indent" ? editor.can().indent() : editor.can().outdent();
  } catch {
    return false;
  }
}

export function applyIndent(
  editor: Editor | null,
  action: IndentAction,
): boolean {
  if (!editor?.isEditable) return false;
  try {
    const type = listTypeFor(editor, action);
    const chain = editor.chain().focus();
    if (type) return chain[LIST_COMMAND[action]](type).run();
    if (!canApplyIndent(editor, action)) return false;
    return (action === "indent" ? chain.indent() : chain.outdent()).run();
  } catch {
    return false;
  }
}

function indentAction(
  action: IndentAction,
  label: string,
  shortcut: string,
  icon: IconComponent,
  reason: string,
): AnyAction {
  return {
    id: `indent.${action}`,
    label,
    group: "indent",
    contexts: "any",
    icon,
    shortcut,
    enabled: (ctx) =>
      ctx.can(`indent:${action}`, (editor) => canApplyIndent(editor, action))
        ? true
        : { reason },
    run: (editor) => applyIndent(editor, action),
  };
}

export const blockActions: readonly AnyAction[] = [
  styleAction("paragraph", "Mod-Alt-0"),
  ...([1, 2, 3, 4, 5, 6] as const).map((level) =>
    styleAction(`heading-${level}`, `Mod-Alt-${level}`, HEADING_ICONS[level]),
  ),
  listAction(
    "list.bullet",
    "bulletList",
    "Bullet list",
    "Mod-Shift-8",
    ListIcon,
    "- ",
  ),
  listAction(
    "list.ordered",
    "orderedList",
    "Numbered list",
    "Mod-Shift-7",
    ListOrderedIcon,
    "1. ",
  ),
  listAction(
    "list.task",
    "taskList",
    "Task list",
    "Mod-Shift-9",
    ListTodoIcon,
    "[ ] ",
  ),
  alignAction("left", "Align left", "Mod-Shift-l", AlignLeftIcon),
  alignAction("center", "Align center", "Mod-Shift-e", AlignCenterIcon),
  alignAction("right", "Align right", "Mod-Shift-r", AlignRightIcon),
  alignAction("justify", "Justify", "Mod-Shift-j", AlignJustifyIcon),
  indentAction(
    "outdent",
    "Outdent",
    "Shift-Tab",
    IndentDecreaseIcon,
    "Nothing to outdent here.",
  ),
  indentAction(
    "indent",
    "Indent",
    "Tab",
    IndentIncreaseIcon,
    "Indent works in paragraphs, quotes and list items.",
  ),
];
