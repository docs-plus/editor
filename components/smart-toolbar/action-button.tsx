"use client";

import type { Editor } from "@tiptap/react";
import { useCurrentEditor } from "@tiptap/react";

import { ToolbarButton } from "@/components/ui/toolbar-button";
import { useActionView } from "@/hooks/use-editor-context";
import { editorActions } from "@/lib/editor-actions";
import { runAction } from "@/lib/editor-actions/registry";

/** Where the button sits; drives size and label rules, never behaviour. */
export type ActionButtonVariant = "row" | "menu" | "bubble" | "phone";

export interface ActionButtonProps {
  /** Registry id. Unknown ids render nothing (a track not merged yet). */
  id: string;
  editor?: Editor | null;
  variant?: ActionButtonVariant;
  /** Show the label next to the icon (menus, Aa sheet). */
  showLabel?: boolean;
  /** Argument passed to `runAction` (swatch token, size step…). */
  arg?: unknown;
}

/**
 * The one way any surface renders a registry action by id: row, slot and ⋯
 * (D1), bubble, phone bar and Aa sheet (D2), palette rows and phone
 * selection cells (E). Frozen signature; PR D1 owns and implements:
 * label + icon, `formatKeyCombo` hint, `aria-keyshortcuts`, `aria-pressed`
 * (incl. "mixed"), disabled-with-reason (`aria-disabled` +
 * `aria-describedby` + tooltip, stays focusable), mousedown
 * `preventDefault` (keeps the editor selection) and `runAction`.
 * D2 and E never edit D1's `tiptap-ui` files to render an action.
 * SKELETON: a plain toolbar button that runs the action.
 */
export function ActionButton({
  id,
  editor: providedEditor,
  variant = "row",
  showLabel = false,
  arg,
}: ActionButtonProps) {
  const { editor: contextEditor } = useCurrentEditor();
  const editor = providedEditor ?? contextEditor ?? null;
  const view = useActionView(id, editor);
  const action = editorActions.get(id);
  if (!editor || !action || !view) return null;

  const Icon = action.icon;
  const reason = view.enabled === true ? undefined : view.enabled.reason;
  return (
    <ToolbarButton
      type="button"
      data-action-id={id}
      data-surface={variant}
      aria-label={action.label}
      tooltip={action.label}
      isActive={view.active}
      aria-pressed={view.mixed ? "mixed" : undefined}
      disabled={reason !== undefined}
      disabledReason={reason}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => runAction(editor, action, arg)}
    >
      {Icon ? <Icon className="tiptap-button-icon" /> : null}
      {showLabel || !Icon ? <span>{action.label}</span> : null}
    </ToolbarButton>
  );
}
