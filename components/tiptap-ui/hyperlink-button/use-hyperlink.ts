"use client";

import {
  buildPreviewOptionsFromAnchor,
  openPreviewHyperlink,
} from "@docs.plus/extension-hyperlink";
import type { Editor } from "@tiptap/react";
import { useCallback } from "react";

// --- Hooks ---
import { useTiptapEditor } from "@/hooks/use-tiptap-editor";
// --- Lib ---
import { isMarkInSchema, isNodeTypeSelected } from "@/lib/editor-utils";

export const HYPERLINK_MARK = "hyperlink";
export const HYPERLINK_SHORTCUT_KEY = "mod+k";

export interface UseHyperlinkConfig {
  /**
   * The Tiptap editor instance.
   */
  editor?: Editor | null;
}

export function isHyperlinkActive(editor: Editor | null): boolean {
  if (!editor?.isEditable) return false;
  return editor.isActive(HYPERLINK_MARK);
}

export function canOpenHyperlink(editor: Editor | null): boolean {
  if (!editor?.isEditable) return false;
  if (!isMarkInSchema(HYPERLINK_MARK, editor)) return false;
  if (isNodeTypeSelected(editor, ["image"], true)) return false;
  if (isHyperlinkActive(editor)) return true;
  try {
    return editor.can().setMark(HYPERLINK_MARK);
  } catch {
    return false;
  }
}

function findAnchorAtSelection(editor: Editor): HTMLAnchorElement | null {
  const { node } = editor.view.domAtPos(editor.state.selection.from);
  const element = node instanceof Element ? node : node.parentElement;
  return element?.closest("a") ?? null;
}

/**
 * Mirrors the extension's `Mod-k`: inside a link, open its preview popover
 * (copy / edit / remove); anywhere else, open the create-link form.
 */
export function openHyperlink(editor: Editor | null): boolean {
  if (!editor || !canOpenHyperlink(editor)) return false;

  if (isHyperlinkActive(editor)) {
    const link = findAnchorAtSelection(editor);
    if (link) {
      return openPreviewHyperlink(
        buildPreviewOptionsFromAnchor({ editor, link }),
      );
    }
  }

  return editor.chain().focus().openCreateHyperlinkPopover().run();
}

/**
 * Toolbar state and action for the @docs.plus Hyperlink mark. The popovers
 * themselves are rendered by the extension.
 */
export function useHyperlink(config: UseHyperlinkConfig = {}) {
  const { editor } = useTiptapEditor(config.editor);

  const handleOpen = useCallback(() => openHyperlink(editor), [editor]);

  return {
    isVisible: Boolean(editor?.isEditable),
    isActive: isHyperlinkActive(editor),
    canOpen: canOpenHyperlink(editor),
    handleOpen,
    label: "Link",
    shortcutKeys: HYPERLINK_SHORTCUT_KEY,
  };
}
