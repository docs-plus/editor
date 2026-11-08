"use client";

import type { Editor } from "@tiptap/react";
import { forwardRef, useCallback } from "react";

// --- UI Primitives ---
import type { ToolbarButtonProps } from "@/components/ui/toolbar-button";
import { ToolbarButton } from "@/components/ui/toolbar-button";
// --- Hooks ---
import { useTiptapEditor } from "@/hooks/use-tiptap-editor";
// --- Icons ---
import { MermaidIcon } from "@/lib/icons";

const LABEL = "Insert diagram";

export function isMermaidActive(editor: Editor | null): boolean {
  return Boolean(editor?.isActive("codeBlock", { language: "mermaid" }));
}

export function canInsertMermaid(editor: Editor | null): boolean {
  if (!editor?.isEditable) return false;
  try {
    return editor.can().insertMermaid();
  } catch {
    return false;
  }
}

export interface MermaidButtonProps extends Omit<ToolbarButtonProps, "type"> {
  editor?: Editor | null;
}

/**
 * Inserts a Mermaid diagram block (a `codeBlock` with `language: mermaid`)
 * that renders live under its source.
 */
export const MermaidButton = forwardRef<HTMLButtonElement, MermaidButtonProps>(
  ({ editor: providedEditor, onClick, children, ...buttonProps }, ref) => {
    const { editor } = useTiptapEditor(providedEditor);
    const isActive = isMermaidActive(editor);

    const handleClick = useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        if (event.defaultPrevented || !editor) return;
        editor.chain().focus().insertMermaid().run();
      },
      [editor, onClick],
    );

    if (!editor?.isEditable) return null;

    return (
      <ToolbarButton
        type="button"
        isActive={isActive}
        disabled={!canInsertMermaid(editor)}
        tabIndex={-1}
        aria-label={LABEL}
        aria-pressed={isActive}
        tooltip={LABEL}
        onClick={handleClick}
        {...buttonProps}
        ref={ref}
      >
        {children ?? <MermaidIcon />}
      </ToolbarButton>
    );
  },
);

MermaidButton.displayName = "MermaidButton";
