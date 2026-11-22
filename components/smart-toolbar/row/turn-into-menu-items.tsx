"use client";

import type { EditorState } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { useId, useSyncExternalStore } from "react";

import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuReason,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { useActionView } from "@/hooks/use-editor-context";
import { editorActions } from "@/lib/editor-actions";
import { TITLE_STYLE_REASON } from "@/lib/editor-actions/core/blocks";
import {
  ariaKeyShortcuts,
  formatKeyCombo,
} from "@/lib/editor-actions/key-combo";
import { canRun, runAction } from "@/lib/editor-actions/registry";
import type { AnyAction, IconComponent } from "@/lib/editor-actions/types";
import { computeContext } from "@/lib/editor-context/snapshot";
import { getEditorContextStore } from "@/lib/editor-context/store";
import { HeadingIcon, TypeIcon } from "@/lib/icons";
import { isMac } from "@/lib/shortcuts";

import { type StyleFace, styleFace } from "../bubble/style-face";
import { lazySurface } from "../lazy-surface";

/*
 * Style ▾ ("Turn into", spec §7.4, BQ10, BQ11): one body for the bubble's
 * Style ▾ and the row's, in the menu chunk (`menu-bodies.ts`). The row adds
 * Your formats below a separator; the bubble never does.
 */

/** The block types, in menu order ("More headings ▸" holds H4–H6). */
export const TURN_INTO_IDS = [
  "style.paragraph",
  "style.heading1",
  "style.heading2",
  "style.heading3",
  /* More headings ▸ */
  "list.bullet",
  "list.ordered",
  "list.task",
  "insert.quote",
  "insert.codeBlock",
] as const;

/** "More headings ▸" (spec §7.4). */
export const MORE_HEADING_IDS = [
  "style.heading4",
  "style.heading5",
  "style.heading6",
] as const;

const HEADING_IDS = TURN_INTO_IDS.slice(0, 4);
const LIST_IDS = TURN_INTO_IDS.slice(4, 7);
const BLOCK_IDS = TURN_INTO_IDS.slice(7);

/** One word per block type (BQ11): "Text", never "Normal text". */
const LABELS: Partial<Record<string, string>> = { "style.paragraph": "Text" };
/** Text has no icon in the registry; kept here, in the lazy menu chunk. */
const ICONS: Partial<Record<string, IconComponent>> = {
  "style.paragraph": TypeIcon,
};

const LIST_ID_BY_TYPE: Readonly<Record<string, string>> = {
  bulletList: "list.bullet",
  orderedList: "list.ordered",
  taskList: "list.task",
};

/** The list id every top-level block of the selection shares, or "". */
function listId(state: EditorState): string {
  const { doc, selection } = state;
  const last = doc.childCount - 1;
  const end = Math.min(selection.$to.index(0), last);
  let id = "";
  for (let index = selection.$from.index(0); index <= end; index += 1) {
    const own = LIST_ID_BY_TYPE[doc.child(index).type.name] ?? "";
    if (id && own !== id) return "";
    id = own;
  }
  return id;
}

/**
 * The checked row for a face: its block type. Title and Mixed check
 * nothing (spec §7.4 "Mixed selection: no ✓"), nor does a mix of lists.
 */
function currentId(face: StyleFace, state: EditorState): string {
  if (face === "Text") return "style.paragraph";
  if (face === "List") return listId(state);
  if (face === "Quote") return "insert.quote";
  if (face === "Code") return "insert.codeBlock";
  if (face.startsWith("H")) return `style.heading${face.slice(1)}`;
  return "";
}

const serverValue = () => "Text|";

/**
 * The face and the checked id, re-rendered when either changes (the
 * shared context store: selection at once, doc changes after the settle
 * window), so a remote edit or a caret move updates the ✓ and the title
 * lock while the menu is open.
 */
function useTurnIntoValue(editor: Editor): [StyleFace, string] {
  const value = useSyncExternalStore(
    getEditorContextStore(editor).subscribe,
    () => {
      const face = styleFace(editor.state);
      return `${face}|${currentId(face, editor.state)}`;
    },
    serverValue,
  );
  const [face, id] = value.split("|");
  return [face as StyleFace, id];
}

/** Lists and quotes a text style turns out of (ruling a: Turn into unwraps). */
const WRAPPERS = new Set([
  "bulletList",
  "orderedList",
  "taskList",
  "blockquote",
]);

function inWrapper(state: EditorState): boolean {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if (WRAPPERS.has($from.node(depth).type.name)) return true;
  }
  return false;
}

/**
 * Runs a pick. Text and the headings turn a list item or a quote into
 * that block, unwrapped, in one undo step (the registry's `setTextStyle`
 * only restyles a textblock in place); everything else is the registry's
 * own run. The registry's checks still decide (`canRun`: the title,
 * read-only, code).
 */
function turnInto(editor: Editor, action: AnyAction): boolean {
  if (!action.id.startsWith("style.") || !inWrapper(editor.state)) {
    return runAction(editor, action);
  }
  if (!canRun(action, computeContext(editor))) return false;
  const level = Number(action.id.slice("style.heading".length)) || 0;
  const chain = editor.chain().focus().clearNodes();
  return (
    level ? chain.setNode("heading", { level }) : chain.setNode("paragraph")
  ).run();
}

/**
 * The row's grid: icon, label, shortcut, then the ✓ as the trailing cell
 * (`16px 1fr auto 16px`, spec §7.4); the reason line spans under the label.
 * `pr-1.5` beside `pe-1.5` until the logical `dropdown-menu.tsx` (P3)
 * lands: tailwind-merge drops the item's physical `pr-8` only for `pr-*`.
 */
const ROW =
  "grid grid-cols-[16px_1fr_auto_16px] items-center gap-x-2 pr-1.5 pe-1.5 *:data-[slot=dropdown-menu-radio-item-indicator]:static *:data-[slot=dropdown-menu-radio-item-indicator]:order-1 *:data-[slot=dropdown-menu-radio-item-indicator]:size-4 *:data-[slot=dropdown-menu-reason]:order-2 *:data-[slot=dropdown-menu-reason]:col-start-2 *:data-[slot=dropdown-menu-reason]:col-span-3";

interface TurnIntoItemProps {
  id: string;
  editor: Editor;
  onPicked: () => void;
  /** The shared title reason's id, when the selection is in the title. */
  titleReasonId?: string;
}

/**
 * One block type as a radio row. No Markdown chips (spec §7.4): they teach
 * in the "/" menu. A pick is one undo step (`turnInto`).
 */
function TurnIntoItem({
  id,
  editor,
  onPicked,
  titleReasonId,
}: TurnIntoItemProps) {
  const view = useActionView(id, editor);
  const reasonId = useId();
  const action = editorActions.get(id);
  if (!action || !view) return null;
  const own = view.enabled === true ? undefined : view.enabled.reason;
  const disabled = titleReasonId !== undefined || own !== undefined;
  const Icon = action.icon ?? ICONS[id];
  const mac = isMac();
  const combo = action.shortcut;
  return (
    <DropdownMenuRadioItem
      value={id}
      closeOnClick
      className={ROW}
      // The menu grows to fit its rows (`MENU_WIDTH`), so no label wraps
      // under its shortcut.
      data-check-slot=""
      disabled={disabled}
      aria-describedby={titleReasonId ?? (own ? reasonId : undefined)}
      aria-keyshortcuts={combo ? ariaKeyShortcuts(combo, mac) : undefined}
      data-action-id={id}
      onClick={() => {
        if (disabled) return;
        onPicked();
        turnInto(editor, action);
      }}
    >
      {Icon ? <Icon aria-hidden="true" /> : <span aria-hidden="true" />}
      <span>{LABELS[id] ?? action.label}</span>
      {/* The item announces its keys (`aria-keyshortcuts`), not the glyphs. */}
      <span aria-hidden="true">
        <kbd
          dir="ltr"
          className="font-sans text-xs tracking-widest text-muted-foreground"
        >
          {combo ? formatKeyCombo(combo, mac) : null}
        </kbd>
      </span>
      {own && !titleReasonId ? (
        <DropdownMenuReason id={reasonId}>{own}</DropdownMenuReason>
      ) : null}
    </DropdownMenuRadioItem>
  );
}

/** Your formats (design pass §4): a lazy chunk, fetched on first open. */
const StyleFormats = lazySurface(() =>
  import("../formats/style-formats").then((module) => module.StyleFormats),
);

export interface TurnIntoMenuItemsProps {
  editor: Editor;
  onPicked: () => void;
  /** The row's Style ▾ only: Your formats, below a separator. */
  formats?: boolean;
  /** With `formats`: opened at "Remove a format ▸" (`formats.remove`). */
  removing?: boolean;
}

/**
 * Style ▾ ("Turn into"): Text, H1–H3, More headings ▸, the three lists,
 * Quote and Code block, with ✓ on the current type. In the title every
 * row is disabled with "Title is always H1." (spec §7.2).
 */
export function TurnIntoMenuItems({
  editor,
  onPicked,
  formats = false,
  removing = false,
}: TurnIntoMenuItemsProps) {
  const [face, value] = useTurnIntoValue(editor);
  const titleId = useId();
  const inTitle = face === "Title";
  const titleReasonId = inTitle ? titleId : undefined;
  const item = (id: string) => (
    <TurnIntoItem
      key={id}
      id={id}
      editor={editor}
      onPicked={onPicked}
      titleReasonId={titleReasonId}
    />
  );
  return (
    <>
      {inTitle ? (
        <p id={titleId} className="px-2 py-1 text-xs text-muted-foreground">
          {TITLE_STYLE_REASON}
        </p>
      ) : null}
      <DropdownMenuRadioGroup value={value}>
        {HEADING_IDS.map(item)}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger
            disabled={inTitle}
            aria-describedby={titleReasonId}
          >
            <HeadingIcon aria-hidden="true" />
            <span>More headings</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent side="inline-end">
            <DropdownMenuRadioGroup value={value}>
              {MORE_HEADING_IDS.map(item)}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        {LIST_IDS.map(item)}
        <DropdownMenuSeparator />
        {BLOCK_IDS.map(item)}
      </DropdownMenuRadioGroup>
      {formats ? (
        <StyleFormats editor={editor} onPicked={onPicked} removing={removing} />
      ) : null}
    </>
  );
}
