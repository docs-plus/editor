"use client";

import type { Editor } from "@tiptap/react";
import { forwardRef, useCallback } from "react";

// --- UI Primitives ---
import type { ToolbarButtonProps } from "@/components/ui/toolbar-button";
import { ToolbarButton } from "@/components/ui/toolbar-button";
// --- Hooks ---
import { useTiptapEditor } from "@/hooks/use-tiptap-editor";
// --- Icons ---
import { IndentDecreaseIcon, IndentIncreaseIcon } from "@/lib/icons";

export type IndentAction = "indent" | "outdent";

const INDENT_ACTIONS = {
  indent: { label: "Indent", shortcut: "tab", Icon: IndentIncreaseIcon },
  outdent: {
    label: "Outdent",
    shortcut: "shift+tab",
    Icon: IndentDecreaseIcon,
  },
} as const;

/** Runs the same context gate as the Tab key, without dispatching. */
export function canApplyIndent(
  editor: Editor | null,
  action: IndentAction,
): boolean {
  if (!editor?.isEditable) return false;
  try {
    return action === "indent" ? editor.can().indent() : editor.can().outdent();
  } catch {
    return false;
  }
}

export function applyIndent(
  editor: Editor | null,
  action: IndentAction,
): boolean {
  if (!editor || !canApplyIndent(editor, action)) return false;
  const chain = editor.chain().focus();
  return (action === "indent" ? chain.indent() : chain.outdent()).run();
}

export interface IndentButtonProps extends Omit<ToolbarButtonProps, "type"> {
  editor?: Editor | null;
  action: IndentAction;
}

export const IndentButton = forwardRef<HTMLButtonElement, IndentButtonProps>(
  (
    { editor: providedEditor, action, onClick, children, ...buttonProps },
    ref,
  ) => {
    const { editor } = useTiptapEditor(providedEditor);
    const { label, shortcut, Icon } = INDENT_ACTIONS[action];

    const handleClick = useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        applyIndent(editor, action);
      },
      [editor, action, onClick],
    );

    if (!editor?.isEditable) return null;

    return (
      <ToolbarButton
        type="button"
        disabled={!canApplyIndent(editor, action)}
        tabIndex={-1}
        aria-label={label}
        tooltip={label}
        shortcutKeys={shortcut}
        onClick={handleClick}
        {...buttonProps}
        ref={ref}
      >
        {children ?? <Icon />}
      </ToolbarButton>
    );
  },
);

IndentButton.displayName = "IndentButton";
