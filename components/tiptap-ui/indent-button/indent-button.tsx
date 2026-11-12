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
  indent: {
    label: "Indent",
    shortcut: "tab",
    Icon: IndentIncreaseIcon,
    disabledReason: "Indent works in paragraphs, quotes and list items",
  },
  outdent: {
    label: "Outdent",
    shortcut: "shift+tab",
    Icon: IndentDecreaseIcon,
    disabledReason: "Nothing to outdent here",
  },
} as const;

/** List item node types the schema knows, in the order Tab tries them. */
export function listItemTypes(editor: Editor): string[] {
  const { nodes } = editor.schema;
  return ["listItem", "taskItem"].filter((name) => nodes[name]);
}

type ListCommand = "sinkListItem" | "liftListItem";

const LIST_COMMAND: Record<IndentAction, ListCommand> = {
  indent: "sinkListItem",
  outdent: "liftListItem",
};

/** First list item type whose sink/lift command can run here, if any. */
function listTypeFor(editor: Editor, action: IndentAction): string | null {
  const command = LIST_COMMAND[action];
  return (
    listItemTypes(editor).find((type) => editor.can()[command](type)) ?? null
  );
}

/**
 * Mirrors the Tab / Shift+Tab chain without the table-cell moves: list item
 * sink or lift first, then the text indent.
 */
export function canApplyIndent(
  editor: Editor | null,
  action: IndentAction,
): boolean {
  if (!editor?.isEditable) return false;
  try {
    if (listTypeFor(editor, action)) return true;
    return action === "indent" ? editor.can().indent() : editor.can().outdent();
  } catch {
    return false;
  }
}

export function applyIndent(
  editor: Editor | null,
  action: IndentAction,
): boolean {
  if (!editor?.isEditable) return false;
  try {
    const type = listTypeFor(editor, action);
    const chain = editor.chain().focus();
    if (type) return chain[LIST_COMMAND[action]](type).run();
    if (!canApplyIndent(editor, action)) return false;
    return (action === "indent" ? chain.indent() : chain.outdent()).run();
  } catch {
    return false;
  }
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
    const { label, shortcut, Icon, disabledReason } = INDENT_ACTIONS[action];

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
        disabledReason={disabledReason}
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
