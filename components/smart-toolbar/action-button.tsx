"use client";

import type { Editor } from "@tiptap/react";
import { useCurrentEditor } from "@tiptap/react";

import { ToolbarButton } from "@/components/ui/toolbar-button";
import { useActionView } from "@/hooks/use-editor-context";
import { editorActions } from "@/lib/editor-actions";
import {
  ariaKeyShortcuts,
  toShortcutKeys,
} from "@/lib/editor-actions/key-combo";
import { runAction } from "@/lib/editor-actions/registry";
import { isMac } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

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

/** Keeps the editor selection: act on click, never move focus on press. */
const keepSelection = (event: React.MouseEvent) => event.preventDefault();

/**
 * The one way any surface renders a registry action by id: row, slot and ⋯
 * (D1), bubble, phone bar and Aa sheet (D2), palette rows and phone
 * selection cells (E). Frozen signature (contract §3.5).
 *
 * Renders the label and icon, the shortcut hint (`formatKeyCombo` style)
 * and `aria-keyshortcuts` (#612), `aria-pressed` (incl. "mixed") only for
 * toggles, and disabled-with-reason (`aria-disabled` + `aria-describedby` +
 * tooltip; it stays focusable). Mousedown is prevented so the editor keeps
 * its selection; click runs `runAction`, which rechecks the live document.
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
  const toggle = action.isActive !== undefined;
  const mac = isMac();
  const tooltip = action.markdownHint ? (
    <span className="flex items-center gap-1.5">
      {action.label}
      <span className="font-mono text-muted-foreground">
        {action.markdownHint.trim()}
      </span>
    </span>
  ) : (
    action.label
  );
  const withLabel = showLabel || !Icon;
  return (
    <ToolbarButton
      type="button"
      data-action-id={id}
      data-surface={variant}
      aria-label={action.label}
      tooltip={tooltip}
      shortcutKeys={
        action.shortcut ? toShortcutKeys(action.shortcut) : undefined
      }
      aria-keyshortcuts={
        action.shortcut ? ariaKeyShortcuts(action.shortcut, mac) : undefined
      }
      isActive={toggle ? view.active : undefined}
      aria-pressed={toggle && view.mixed ? "mixed" : undefined}
      disabled={reason !== undefined}
      disabledReason={reason}
      size={withLabel ? "sm" : "icon-sm"}
      className={cn(variant === "menu" && "w-full justify-start")}
      onMouseDown={keepSelection}
      onClick={() => runAction(editor, action, arg)}
    >
      {Icon ? <Icon className="tiptap-button-icon" aria-hidden="true" /> : null}
      {withLabel ? <span>{action.label}</span> : null}
    </ToolbarButton>
  );
}
