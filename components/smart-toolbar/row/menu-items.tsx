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
import type { KeyCombo } from "@/lib/editor-actions/types";
import { isMac } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

/*
 * The menu chunk's shared parts (`menu-bodies.ts`, lazy): `ToolbarMenu`'s
 * popup and the registry items its bodies list.
 */

/**
 * A fixed width, except that a menu of items with a check slot grows to fit
 * them, so long shortcuts ("Ctrl+Shift+E") never wrap under their label.
 */
const MENU_WIDTH =
  "min-w-52 has-data-[check-slot]:w-max has-data-[check-slot]:max-w-(--available-width)";

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
      className={MENU_WIDTH}
    >
      {children}
    </DropdownMenuContent>
  );
}

/**
 * The visible reason line (design pass §10), indented past an icon. It
 * adds no width of its own (`contain`), so it wraps in a menu that grows to
 * fit its items.
 */
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
    <DropdownMenuReason
      id={id}
      className={cn("[contain:inline-size]", indent && "ps-5.5")}
    >
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
 * The visible hint is hidden from the name ("Superscript", not
 * "Superscript⌘."); the item announces its keys instead.
 */
const keyShortcuts = (combo: KeyCombo | undefined, mac: boolean) =>
  combo ? ariaKeyShortcuts(combo, mac) : undefined;

/** An action's shortcut hint, at the item's end. */
function Shortcut({
  combo,
  mac,
  className,
}: {
  combo?: KeyCombo;
  mac: boolean;
  className?: string;
}) {
  return combo ? (
    <DropdownMenuShortcut aria-hidden="true" className={className}>
      {formatKeyCombo(combo, mac)}
    </DropdownMenuShortcut>
  ) : null;
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
  const mac = isMac();
  const common = {
    inset: insetProp(Icon === undefined),
    disabled: reason !== undefined,
    "aria-describedby": reason ? reasonId : undefined,
    "aria-keyshortcuts": keyShortcuts(action.shortcut, mac),
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
      <Shortcut combo={action.shortcut} mac={mac} />
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

/**
 * A decorated radio item's check: out of the end padding into a fixed
 * slot before the shortcut, so every shortcut ends at the item's edge, as
 * Outdent's and Indent's do in the T3 ¶ menu. The check, shortcut and
 * reason line are `order-1`: after the icon and label, in DOM order.
 */
const CHECK_BEFORE_SHORTCUT =
  "pr-1.5 *:data-[slot=dropdown-menu-radio-item-indicator]:static *:data-[slot=dropdown-menu-radio-item-indicator]:order-1 *:data-[slot=dropdown-menu-radio-item-indicator]:ml-auto *:data-[slot=dropdown-menu-radio-item-indicator]:size-4 *:data-[slot=dropdown-menu-reason]:order-1";

/** One registry action as a radio item of a value menu. */
export function ActionRadioItem({
  id,
  editor,
  value,
  onPicked,
  arg,
  label,
  decorated = false,
}: {
  id: string;
  editor: Editor;
  value: string;
  onPicked: () => void;
  /** Passed to the action's run, such as a language for `code.language`. */
  arg?: unknown;
  label?: string;
  /** Shows the action's icon and shortcut, as `ActionMenuItem` does (align). */
  decorated?: boolean;
}) {
  const view = useActionView(id, editor);
  const reasonId = useId();
  const action = editorActions.get(id);
  if (!action || !view) return null;
  const reason = view.enabled === true ? undefined : view.enabled.reason;
  const Icon = decorated ? action.icon : undefined;
  const shortcut = decorated ? action.shortcut : undefined;
  const mac = isMac();
  return (
    <DropdownMenuRadioItem
      value={value}
      closeOnClick
      className={shortcut ? CHECK_BEFORE_SHORTCUT : undefined}
      data-check-slot={shortcut ? "" : undefined}
      disabled={reason !== undefined}
      aria-describedby={reason ? reasonId : undefined}
      aria-keyshortcuts={keyShortcuts(shortcut, mac)}
      data-action-id={id}
      onClick={() => {
        if (reason) return;
        onPicked();
        runAction(editor, action, arg);
      }}
    >
      {Icon ? <Icon aria-hidden="true" /> : null}
      <span>{label ?? action.label}</span>
      <Shortcut combo={shortcut} mac={mac} className="order-1 ml-0" />
      <Reason id={reasonId} reason={reason} indent={Icon !== undefined} />
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
