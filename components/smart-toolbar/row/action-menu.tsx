"use client";

import type { Editor } from "@tiptap/react";
import { useCurrentEditor } from "@tiptap/react";
import { type ReactNode, useCallback, useId, useRef, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToolbarButton } from "@/components/ui/toolbar-button";
import { useActionView } from "@/hooks/use-editor-context";
import { editorActions } from "@/lib/editor-actions";
import { formatKeyCombo } from "@/lib/editor-actions/key-combo";
import { runAction } from "@/lib/editor-actions/registry";
import { READ_ONLY_REASON } from "@/lib/editor-actions/types";
import { ChevronDownIcon } from "@/lib/icons";
import { isMac } from "@/lib/shortcuts";

/** The editor from props, else from `EditorContext`. */
export function useSurfaceEditor(provided?: Editor | null): Editor | null {
  const { editor } = useCurrentEditor();
  return provided ?? editor ?? null;
}

/**
 * Focus after a menu closes: after a pick the editor already holds the
 * selection, so focus goes there at once (a keystroke typed before Base UI's
 * exit animation would otherwise go to the menu); Esc and outside clicks
 * fall back to the trigger.
 */
export function useMenuFocus(editor: Editor | null) {
  const [open, setOpen] = useState(false);
  const picked = useRef(false);
  const onOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (!next && picked.current) editor?.view.focus();
    },
    [editor],
  );
  const finalFocus = useCallback(() => {
    if (!picked.current) return true;
    picked.current = false;
    return editor?.view.dom ?? true;
  }, [editor]);
  const markPicked = useCallback(() => {
    picked.current = true;
  }, []);
  return { open, onOpenChange, finalFocus, markPicked };
}

interface MenuTriggerProps {
  label: string;
  tooltip: string;
  /** Only the read-only reason disables a menu trigger; items carry theirs. */
  readOnly: boolean;
  icon?: ReactNode;
  showLabel?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  finalFocus: () => HTMLElement | boolean;
  children: ReactNode;
  contentLabel?: string;
}

/**
 * A toolbar menu button (spec §6.4): named by its visible value,
 * `aria-haspopup="menu"`, never `aria-pressed`. Its popup is marked
 * `data-toolbar-popup`, so focus inside it keeps the slot held.
 */
export function ToolbarMenu({
  label,
  tooltip,
  readOnly,
  icon,
  showLabel = true,
  open,
  onOpenChange,
  finalFocus,
  children,
  contentLabel,
}: MenuTriggerProps) {
  const handleOpenChange = (next: boolean) => {
    if (next && readOnly) return;
    onOpenChange(next);
  };
  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger
        disabled={readOnly}
        render={
          <ToolbarButton
            type="button"
            aria-haspopup="menu"
            aria-label={label}
            tooltip={tooltip}
            size="sm"
            disabled={readOnly}
            disabledReason={readOnly ? READ_ONLY_REASON : undefined}
          />
        }
      >
        {icon}
        {showLabel ? <span className="truncate">{label}</span> : null}
        <ChevronDownIcon className="size-3 opacity-60" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        finalFocus={finalFocus}
        data-toolbar-popup=""
        aria-label={contentLabel}
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Reason({ id, reason }: { id: string; reason?: string }) {
  return reason ? (
    <span id={id} hidden>
      {reason}
    </span>
  ) : null;
}

interface ActionItemProps {
  id: string;
  editor: Editor;
  arg?: unknown;
  onPicked: () => void;
  /** Checkbox item (`menuitemcheckbox`) for toggles such as superscript. */
  checkbox?: boolean;
  label?: string;
}

/** One registry action as a menu item, with its reason and shortcut. */
export function ActionMenuItem({
  id,
  editor,
  arg,
  onPicked,
  checkbox = false,
  label,
}: ActionItemProps) {
  const view = useActionView(id, editor);
  const reasonId = useId();
  const action = editorActions.get(id);
  if (!action || !view) return null;
  const reason = view.enabled === true ? undefined : view.enabled.reason;
  const Icon = action.icon;
  const common = {
    disabled: reason !== undefined,
    "aria-describedby": reason ? reasonId : undefined,
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
      {action.shortcut ? (
        <DropdownMenuShortcut>
          {formatKeyCombo(action.shortcut, isMac())}
        </DropdownMenuShortcut>
      ) : null}
      <Reason id={reasonId} reason={reason} />
    </>
  );
  return checkbox ? (
    <DropdownMenuCheckboxItem {...common} checked={view.active} closeOnClick>
      {body}
    </DropdownMenuCheckboxItem>
  ) : (
    <DropdownMenuItem {...common}>{body}</DropdownMenuItem>
  );
}

/** One registry action as a radio item of a value menu. */
export function ActionRadioItem({
  id,
  editor,
  value,
  onPicked,
}: {
  id: string;
  editor: Editor;
  value: string;
  onPicked: () => void;
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
      disabled={reason !== undefined}
      aria-describedby={reason ? reasonId : undefined}
      data-action-id={id}
      onClick={() => {
        if (reason) return;
        onPicked();
        runAction(editor, action);
      }}
    >
      <span>{action.label}</span>
      <Reason id={reasonId} reason={reason} />
    </DropdownMenuRadioItem>
  );
}

export { DropdownMenuRadioGroup };
