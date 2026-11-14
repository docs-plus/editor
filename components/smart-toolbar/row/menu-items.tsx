"use client";

import type { Editor } from "@tiptap/react";
import { type ReactNode, useId } from "react";

import {
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioItem,
  DropdownMenuReason,
  DropdownMenuShortcut,
} from "@/components/ui/dropdown-menu";
import { useActionView } from "@/hooks/use-editor-context";
import { editorActions } from "@/lib/editor-actions";
import {
  ariaKeyShortcuts,
  formatKeyCombo,
} from "@/lib/editor-actions/key-combo";
import { runAction } from "@/lib/editor-actions/registry";
import { isMac } from "@/lib/shortcuts";

/*
 * The menu chunk's shared parts (`menu-bodies.ts`, lazy): `ToolbarMenu`'s
 * popup and the registry items its bodies list.
 */

/**
 * `ToolbarMenu`'s popup. Marked `data-toolbar-popup`, so focus inside it
 * keeps the slot held.
 */
export function ToolbarMenuContent({
  finalFocus,
  label,
  children,
}: {
  finalFocus: () => HTMLElement | boolean;
  label?: string;
  children?: ReactNode;
}) {
  return (
    <DropdownMenuContent
      align="start"
      finalFocus={finalFocus}
      data-toolbar-popup=""
      aria-label={label}
      className="min-w-52"
    >
      {children}
    </DropdownMenuContent>
  );
}

/** The visible reason line (design pass §10), indented past an icon. */
function Reason({
  id,
  reason,
  indent,
}: {
  id: string;
  reason?: string;
  indent?: boolean;
}) {
  return reason ? (
    <DropdownMenuReason id={id} className={indent ? "ps-5.5" : undefined}>
      {reason}
    </DropdownMenuReason>
  ) : null;
}

interface ActionItemProps {
  id: string;
  editor: Editor;
  arg?: unknown;
  onPicked: () => void;
  /** Checkbox item (`menuitemcheckbox`) for toggles such as superscript. */
  checkbox?: boolean;
  /**
   * Keeps a checkbox item's check column free on a plain item, so its
   * shortcut lines up with theirs in a menu that mixes both (⋯).
   */
  checkColumn?: boolean;
  label?: string;
}

/**
 * An item's `inset` prop, which starts its text in the icon column. Only
 * `true` or absent, never `false`: the primitives would write
 * `data-inset="false"`, which still matches `data-inset:`.
 */
const insetProp = (inset: boolean) => (inset ? true : undefined);

/**
 * One registry action as a menu item, with its reason and shortcut. Every
 * menu listing these has iconed items, so one without an icon is inset.
 */
export function ActionMenuItem({
  id,
  editor,
  arg,
  onPicked,
  checkbox = false,
  checkColumn = false,
  label,
}: ActionItemProps) {
  const view = useActionView(id, editor);
  const reasonId = useId();
  const action = editorActions.get(id);
  if (!action || !view) return null;
  const reason = view.enabled === true ? undefined : view.enabled.reason;
  const Icon = action.icon;
  const { shortcut } = action;
  const mac = isMac();
  const common = {
    inset: insetProp(Icon === undefined),
    disabled: reason !== undefined,
    "aria-describedby": reason ? reasonId : undefined,
    // The visible hint is hidden from the name ("Superscript", not
    // "Superscript⌘."); the item announces its keys instead.
    "aria-keyshortcuts": shortcut ? ariaKeyShortcuts(shortcut, mac) : undefined,
    "data-action-id": id,
    onClick: () => {
      onPicked();
      runAction(editor, action, arg);
    },
  };
  const body = (
    <>
      {Icon ? <Icon aria-hidden="true" /> : null}
      <span>{label ?? action.label}</span>
      {shortcut ? (
        <DropdownMenuShortcut aria-hidden="true">
          {formatKeyCombo(shortcut, mac)}
        </DropdownMenuShortcut>
      ) : null}
      <Reason id={reasonId} reason={reason} indent={Icon !== undefined} />
    </>
  );
  return checkbox ? (
    <DropdownMenuCheckboxItem {...common} checked={view.active} closeOnClick>
      {body}
    </DropdownMenuCheckboxItem>
  ) : (
    <DropdownMenuItem {...common} className={checkColumn ? "pr-8" : undefined}>
      {body}
    </DropdownMenuItem>
  );
}

/** One registry action as a radio item of a value menu. */
export function ActionRadioItem({
  id,
  editor,
  value,
  onPicked,
  arg,
  label,
  inset = false,
}: {
  id: string;
  editor: Editor;
  value: string;
  onPicked: () => void;
  /** Passed to the action's run, such as a language for `code.language`. */
  arg?: unknown;
  label?: string;
  /** Starts the text in the icon column, beside iconed items (T3 ¶). */
  inset?: boolean;
}) {
  const view = useActionView(id, editor);
  const reasonId = useId();
  const action = editorActions.get(id);
  if (!action || !view) return null;
  const reason = view.enabled === true ? undefined : view.enabled.reason;
  return (
    <DropdownMenuRadioItem
      value={value}
      closeOnClick
      inset={insetProp(inset)}
      disabled={reason !== undefined}
      aria-describedby={reason ? reasonId : undefined}
      data-action-id={id}
      onClick={() => {
        if (reason) return;
        onPicked();
        runAction(editor, action, arg);
      }}
    >
      <span>{label ?? action.label}</span>
      <Reason id={reasonId} reason={reason} />
    </DropdownMenuRadioItem>
  );
}

/** A plain list of registry actions, such as the table's Row ▾. */
export function ActionMenuItems({
  ids,
  editor,
  onPicked,
}: {
  ids: readonly string[];
  editor: Editor;
  onPicked: () => void;
}) {
  return ids.map((id) => (
    <ActionMenuItem key={id} id={id} editor={editor} onPicked={onPicked} />
  ));
}
