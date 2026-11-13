import {
  closeMediaToolbar,
  openMediaToolbar,
} from "@docs.plus/extension-hypermultimedia";
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection } from "@tiptap/pm/state";

import { headingFoldPluginKey } from "@/extensions/heading-fold/heading-fold-plugin";
import { computeSection } from "@/extensions/shared/compute-section";
import {
  CODE_LANGUAGE_CHOICE,
  CODE_LANGUAGES,
  sanitizeCodeLanguage,
} from "@/lib/code-language";
import type {
  AnyAction,
  Ctx,
  Enabled,
  IconComponent,
} from "@/lib/editor-actions/types";
import { emitUiIntent } from "@/lib/editor-actions/ui-intents";
import { codeLanguageAt } from "@/lib/editor-context/snapshot";
import { moveSection } from "@/lib/editor-utils";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronsDownUpIcon,
  Columns3Icon,
  CopyIcon,
  FilterIcon,
  MoonStarIcon,
  PanelLeftIcon,
  Rows3Icon,
  SlidersHorizontalIcon,
  TableCellsMergeIcon,
  TableIcon,
} from "@/lib/icons";
import { rememberChoice } from "@/lib/remembered-choice";

// --- Sections ------------------------------------------------------------

export const HEADING_GONE = "This heading is gone.";

interface SectionEntry {
  pos: number;
  level: number;
  index: number;
  id: string | null;
}

/** The heading's stable id: the TOC id the fold plugin uses, else UniqueID. */
export function headingIdOf(node: PMNode): string | null {
  return (
    (node.attrs["data-toc-id"] as string | null | undefined) ??
    (node.attrs.id as string | null | undefined) ??
    null
  );
}

/** Top-level headings, the title excluded; one walk per `state.doc`. */
function sectionIndex(ctx: Ctx): readonly SectionEntry[] {
  return ctx.docMemo("sections", () => sectionsOf(ctx.state.doc));
}

function sectionsOf(doc: PMNode): SectionEntry[] {
  const entries: SectionEntry[] = [];
  doc.forEach((node, pos, index) => {
    if (index === 0 || node.type.name !== "heading") return;
    entries.push({
      pos,
      level: node.attrs.level as number,
      index,
      id: headingIdOf(node),
    });
  });
  return entries;
}

interface MovePlan {
  from: number;
  to: number;
  target: number;
}

/**
 * Swaps with the adjacent sibling section of the same level. Up: the nearest
 * earlier heading of level ≤ L must be exactly L. Down: the heading at this
 * section's end must be exactly L. The title never moves and is never a
 * target.
 */
function planMove(
  doc: PMNode,
  sections: readonly SectionEntry[],
  at: number,
  direction: "up" | "down",
): MovePlan | null {
  const i = sections.findIndex((entry) => entry.pos === at);
  if (i < 0) return null;
  const self = sections[i];
  const own = computeSection(doc, self.pos, self.level, self.index);
  if (direction === "up") {
    for (let j = i - 1; j >= 0; j -= 1) {
      if (sections[j].level > self.level) continue;
      if (sections[j].level !== self.level) return null;
      return { from: own.from, to: own.to, target: sections[j].pos };
    }
    return null;
  }
  const next = sections.find((entry) => entry.pos === own.to);
  if (!next || next.level !== self.level) return null;
  const after = computeSection(doc, next.pos, next.level, next.index);
  return { from: own.from, to: own.to, target: after.to };
}

/** The live top-level heading for `id`, or the one at the caret. */
function liveHeading(editor: Editor, id: unknown): SectionEntry | null {
  const { doc, selection } = editor.state;
  // `null`: the slot was held on a heading without an id; never guess.
  if (id === null) return null;
  const sections = sectionsOf(doc);
  if (typeof id === "string") {
    return sections.find((entry) => entry.id === id) ?? null;
  }
  const index = selection.$head.index(0);
  return sections.find((entry) => entry.index === index) ?? null;
}

/** The top-level heading at the caret of a snapshot, if it is a section. */
function caretSection(ctx: Ctx): SectionEntry | null {
  if (ctx.isTitle || ctx.headingLevel === null) return null;
  const index = ctx.state.selection.$head.index(0);
  return sectionIndex(ctx).find((entry) => entry.index === index) ?? null;
}

function moveAction(direction: "up" | "down"): AnyAction {
  const edge =
    direction === "up"
      ? "Already first at this level."
      : "Already last at this level.";
  return {
    id: direction === "up" ? "section.moveUp" : "section.moveDown",
    label: direction === "up" ? "Move section up" : "Move section down",
    group: "section",
    contexts: ["heading"],
    icon: direction === "up" ? ArrowUpIcon : ArrowDownIcon,
    enabled(ctx) {
      const section = caretSection(ctx);
      if (!section) return { reason: HEADING_GONE };
      return ctx.memo(`move:${direction}`, () =>
        planMove(ctx.state.doc, sectionIndex(ctx), section.pos, direction),
      )
        ? true
        : { reason: edge };
    },
    /**
     * `arg` is the heading id the slot held when it rendered. A collaborator
     * may delete that heading while the button has focus; the caret then
     * maps into another heading, so the move is refused rather than applied
     * to the wrong section.
     */
    run(editor, arg) {
      const section = liveHeading(editor, arg);
      if (!section) return false;
      const plan = planMove(
        editor.state.doc,
        sectionsOf(editor.state.doc),
        section.pos,
        direction,
      );
      if (!plan) return false;
      const before = editor.state.doc;
      moveSection(editor.view, plan.from, plan.to, plan.target);
      return editor.state.doc !== before;
    },
  };
}

const foldAction: AnyAction = {
  id: "section.fold",
  label: "Fold section",
  group: "section",
  contexts: ["heading"],
  icon: ChevronsDownUpIcon,
  // Folding is per-viewer view state; it never changes the document.
  mutates: false,
  enabled: (ctx) => (caretSection(ctx)?.id ? true : { reason: HEADING_GONE }),
  isActive(ctx) {
    const id = caretSection(ctx)?.id;
    if (!id) return false;
    return headingFoldPluginKey.getState(ctx.state)?.foldedIds.has(id) ?? false;
  },
  run(editor, arg) {
    const section = liveHeading(editor, arg);
    if (!section?.id || !editor.can().toggleFold?.(section.id)) return false;
    return editor.commands.toggleFold(section.id);
  },
};

// --- Code and Mermaid ----------------------------------------------------

const LANGUAGE_LABELS = new Map(
  CODE_LANGUAGES.map((option) => [option.value, option.label]),
);
/** Common short names, so `js` reads (and checks) as JavaScript. */
const LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
  js: "javascript",
  ts: "typescript",
  py: "python",
  sh: "bash",
  yml: "yaml",
  md: "markdown",
  html: "xml",
};
const NO_CODE = "No code block here.";

/** Visible language name; unknown but safe names show as typed. */
export function languageLabel(language: string | null): string {
  if (!language) return "Plain text";
  return (
    LANGUAGE_LABELS.get(LANGUAGE_ALIASES[language] ?? language) ??
    sanitizeCodeLanguage(language) ??
    "Plain text"
  );
}

function languageAction(id: string, label: string, kind: "code" | "mermaid") {
  const action: AnyAction = {
    id,
    label,
    group: "code",
    contexts: [kind],
    icon: undefined,
    enabled: (ctx) => (ctx.inCodeBlock ? true : { reason: NO_CODE }),
    value: (ctx) => languageLabel(codeLanguageAt(ctx)),
    options: () => CODE_LANGUAGES,
    run(editor, arg) {
      const language = sanitizeCodeLanguage(arg);
      if (!language || !LANGUAGE_LABELS.has(language)) return false;
      if (!editor.isActive("codeBlock")) return false;
      const ok = editor
        .chain()
        .focus()
        .updateAttributes("codeBlock", { language })
        .run();
      // M4: Mermaid fails the allowlist, so it is never remembered.
      if (ok) rememberChoice(CODE_LANGUAGE_CHOICE, language);
      return ok;
    },
  };
  return action;
}

function codeTextAt(editor: Editor): string | null {
  const { $head } = editor.state.selection;
  for (let depth = $head.depth; depth > 0; depth -= 1) {
    const node = $head.node(depth);
    if (node.type.name === "codeBlock") return node.textContent;
  }
  return null;
}

function hasClipboard(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.clipboard?.writeText === "function"
  );
}

function copyAction(id: string, label: string, kind: "code" | "mermaid") {
  const action: AnyAction = {
    id,
    label,
    group: "code",
    contexts: [kind],
    icon: CopyIcon,
    mutates: false,
    enabled(ctx): Enabled {
      if (!ctx.inCodeBlock) return { reason: NO_CODE };
      return hasClipboard()
        ? true
        : { reason: "Copying isn't available here." };
    },
    run(editor) {
      const text = codeTextAt(editor);
      if (text === null || !hasClipboard()) return false;
      void navigator.clipboard.writeText(text).catch(() => {});
      return true;
    },
  };
  return action;
}

// --- Tables --------------------------------------------------------------

type TableCommand =
  | "addRowBefore"
  | "addRowAfter"
  | "deleteRow"
  | "addColumnBefore"
  | "addColumnAfter"
  | "deleteColumn"
  | "toggleHeaderRow"
  | "mergeOrSplit";

function tableAction(
  command: TableCommand,
  label: string,
  icon?: IconComponent,
  extra: Partial<AnyAction> = {},
): AnyAction {
  return {
    id: `table.${command}`,
    label,
    group: "table",
    contexts: ["table"],
    icon,
    enabled: (ctx) =>
      ctx.can(`table:${command}`, (editor) => editor.can()[command]())
        ? true
        : { reason: "Not available here." },
    run: (editor) => editor.chain().focus()[command]().run(),
    ...extra,
  };
}

function firstRowIsHeader(ctx: Ctx): boolean {
  return ctx.memo("tableHeaderRow", () => {
    const { $head } = ctx.state.selection;
    for (let depth = $head.depth; depth > 0; depth -= 1) {
      const node = $head.node(depth);
      if (node.type.name !== "table") continue;
      const row = node.firstChild;
      if (!row || row.childCount === 0) return false;
      let all = true;
      row.forEach((cell) => {
        if (cell.type.name !== "tableHeader") all = false;
      });
      return all;
    }
    return false;
  });
}

// --- Media ---------------------------------------------------------------

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
const MEDIA_OPTIONS_BUTTON =
  '[data-slot="context-slot"] [data-action-id="media.options"]';
/** Kit toolbars that already return focus on Esc. */
const escapeWired = new WeakSet<HTMLElement>();

/**
 * Esc in the kit toolbar (outside its own popovers) closes it and returns
 * focus to the slot's "Media options…" button, else to the editor.
 */
function wireEscape(
  editor: Editor,
  toolbar: HTMLElement,
  target: HTMLElement,
  returnTo: HTMLElement | null,
): void {
  if (escapeWired.has(toolbar)) return;
  escapeWired.add(toolbar);
  toolbar.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const from = event.target;
    if (from instanceof Element && from.closest(".floating-popover")) return;
    event.preventDefault();
    // Keeps the kit's document-level Esc from also focusing the editor.
    event.stopPropagation();
    closeMediaToolbar(target);
    const back =
      (returnTo?.isConnected ? returnTo : null) ??
      document.querySelector<HTMLElement>(MEDIA_OPTIONS_BUTTON);
    if (back) back.focus();
    else editor.view.focus();
  });
}

/**
 * Opens the HyperMultimedia kit's own toolbar for the selected media node
 * (otherwise reachable only on hover) and moves focus to its first control,
 * so a keyboard user can reach it (WCAG 2.1.1); Esc comes back. A toolbar
 * with nothing focusable stays open for the pointer and focus stays on the
 * slot button. Returns the toolbar element, or null when none opened.
 */
export function openMediaOptions(editor: Editor): HTMLElement | null {
  const { selection } = editor.state;
  if (!(selection instanceof NodeSelection)) return null;
  const target = editor.view.nodeDOM(selection.from);
  if (!(target instanceof HTMLElement)) return null;
  const active = document.activeElement;
  const returnTo = active instanceof HTMLElement ? active : null;
  const toolbar = openMediaToolbar({
    target,
    editor,
    nodeType: selection.node.type.name,
    nodePos: selection.from,
  });
  if (!toolbar) return null;
  const first = toolbar.querySelector<HTMLElement>(FOCUSABLE);
  if (!first) return toolbar;
  wireEscape(editor, toolbar, target, returnTo);
  first.focus();
  return toolbar;
}

const mediaOptionsAction: AnyAction = {
  id: "media.options",
  label: "Media options…",
  group: "media",
  contexts: ["media"],
  icon: SlidersHorizontalIcon,
  enabled: (ctx) =>
    ctx.nodeSelectionType ? true : { reason: "No media selected." },
  run: (editor) => openMediaOptions(editor) !== null,
};

// --- View (shell intents; never change the doc) --------------------------

function viewAction(
  id: string,
  label: string,
  intent: "outline.toggle" | "filter.toggle" | "theme.toggle",
  icon: IconComponent,
): AnyAction {
  return {
    id,
    label,
    group: "view",
    contexts: "any",
    icon,
    mutates: false,
    enabled: () => true,
    run: (editor) => emitUiIntent(editor, { type: intent }),
  };
}

export const slotActions: readonly AnyAction[] = [
  foldAction,
  moveAction("up"),
  moveAction("down"),
  tableAction("addRowBefore", "Insert row above", Rows3Icon),
  tableAction("addRowAfter", "Insert row below", Rows3Icon),
  tableAction("deleteRow", "Delete row"),
  tableAction("addColumnBefore", "Insert column left", Columns3Icon),
  tableAction("addColumnAfter", "Insert column right", Columns3Icon),
  tableAction("deleteColumn", "Delete column"),
  tableAction("toggleHeaderRow", "Header row", TableIcon, {
    isActive: firstRowIsHeader,
  }),
  tableAction("mergeOrSplit", "Merge or split cells", TableCellsMergeIcon, {
    value: (ctx) =>
      ctx.can("table:mergeCells", (editor) => editor.can().mergeCells())
        ? "merge"
        : "split",
  }),
  languageAction("code.language", "Code language", "code"),
  copyAction("code.copy", "Copy code", "code"),
  languageAction("mermaid.language", "Diagram language", "mermaid"),
  copyAction("mermaid.copySource", "Copy source", "mermaid"),
  mediaOptionsAction,
  viewAction("view.outline", "Toggle outline", "outline.toggle", PanelLeftIcon),
  viewAction("view.filter", "Filter sections", "filter.toggle", FilterIcon),
  viewAction("view.theme", "Switch theme", "theme.toggle", MoonStarIcon),
];
