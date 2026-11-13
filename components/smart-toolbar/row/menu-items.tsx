"use client";

import type { Editor } from "@tiptap/react";
import { useId } from "react";

import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuRadioItem,
  DropdownMenuShortcut,
} from "@/components/ui/dropdown-menu";
import { useActionView } from "@/hooks/use-editor-context";
import { editorActions } from "@/lib/editor-actions";
import { formatKeyCombo } from "@/lib/editor-actions/key-combo";
import { runAction } from "@/lib/editor-actions/registry";
import { isMac } from "@/lib/shortcuts";

/*
 * Registry actions as menu items, a lazy chunk (owner decision O1).
 * `action-menu.tsx` re-exports them through `lazy()`, and `ToolbarMenu`
 * holds the Suspense boundary and the preloads.
 */

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
  arg,
  label,
}: {
  id: string;
  editor: Editor;
  value: string;
  onPicked: () => void;
  /** Passed to the action's run, such as a language for `code.language`. */
  arg?: unknown;
  label?: string;
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
        runAction(editor, action, arg);
      }}
    >
      <span>{label ?? action.label}</span>
      <Reason id={reasonId} reason={reason} />
    </DropdownMenuRadioItem>
  );
}
