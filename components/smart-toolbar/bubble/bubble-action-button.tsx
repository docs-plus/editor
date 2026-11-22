"use client";

import type { Editor } from "@tiptap/react";

import { ToolbarButton } from "@/components/ui/toolbar-button";
import { useActionView } from "@/hooks/use-editor-context";
import { editorActions } from "@/lib/editor-actions";
import { INLINE_CODE_REASON } from "@/lib/editor-actions/inline-code-reason";
import {
  ariaKeyShortcuts,
  toShortcutKeys,
} from "@/lib/editor-actions/key-combo";
import { runAction } from "@/lib/editor-actions/registry";
import { isMac } from "@/lib/shortcuts";

/** Keeps the editor selection: act on click, never move focus on press. */
const keepSelection = (event: React.MouseEvent) => event.preventDefault();

/**
 * The registry's generic refusals for the bubble's mark, link and colour
 * items (`core/inline.ts`, `surface-actions.ts`), copied here because the
 * strings stay in the registry. A unit test keeps the two in step.
 */
export const GENERIC_MARK_REASONS: ReadonlySet<string> = new Set([
  "Formatting isn't available here.",
  "Links can't go here.",
  "Text colour isn't available here.",
]);

/**
 * The reason a refused bubble item gives: inside inline code, which takes
 * no other mark, a generic refusal says why (spec §7.2). Every other
 * reason (read-only, the title, code blocks) stays the registry's. Kept in
 * the bubble chunk so the editor chunk's registry stays as it is.
 */
export function useBubbleReason(
  editor: Editor,
  reason: string | undefined,
): string | undefined {
  const code = useActionView("mark.inlineCode", editor);
  return reason !== undefined &&
    code?.active &&
    GENERIC_MARK_REASONS.has(reason)
    ? INLINE_CODE_REASON
    : reason;
}

/**
 * `ActionButton`'s bubble variant, mirroring `components/smart-toolbar/
 * action-button.tsx` (contract §3.5: label, icon, Markdown hint, shortcut,
 * `aria-pressed` incl. "mixed", disabled with a reason), plus the inline
 * code reason (`useBubbleReason`). A copy, not a prop on `ActionButton`:
 * that module is in the editor chunk, and the phase's gate is 0 B. Keep the
 * two in step. B I U S and Link use it; ‹›, Tx and 💬 keep `ActionButton`,
 * since inline code never refuses them.
 */
export function BubbleActionButton({
  id,
  editor,
}: {
  id: string;
  editor: Editor;
}) {
  const view = useActionView(id, editor);
  const action = editorActions.get(id);
  const reason = useBubbleReason(
    editor,
    !view || view.enabled === true ? undefined : view.enabled.reason,
  );
  if (!action || !view) return null;
  const Icon = action.icon;
  const toggle = action.isActive !== undefined;
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
  return (
    <ToolbarButton
      type="button"
      data-action-id={id}
      data-surface="bubble"
      aria-label={action.label}
      tooltip={tooltip}
      shortcutKeys={
        action.shortcut ? toShortcutKeys(action.shortcut) : undefined
      }
      aria-keyshortcuts={
        action.shortcut ? ariaKeyShortcuts(action.shortcut, isMac()) : undefined
      }
      isActive={toggle ? view.active : undefined}
      aria-pressed={toggle && view.mixed ? "mixed" : undefined}
      disabled={reason !== undefined}
      disabledReason={reason}
      size="icon-sm"
      onMouseDown={keepSelection}
      onClick={() => runAction(editor, action)}
    >
      {Icon ? <Icon className="tiptap-button-icon" aria-hidden="true" /> : null}
    </ToolbarButton>
  );
}
