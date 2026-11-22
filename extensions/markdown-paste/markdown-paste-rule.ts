import type { Editor } from "@tiptap/core";
import type { Slice } from "@tiptap/pm/model";

import { type MarkdownModel, markdownPasteSlice } from "@/lib/markdown/parse";

/**
 * The lazy half of `MarkdownPaste`: the paste rule on the editor's parser.
 * It imports nothing the editor's chunk group loads (`MarkdownModel`).
 */
export function markdownPasteRule(
  text: string,
  editor: Editor,
  model: MarkdownModel,
): Slice | null {
  return editor.markdown
    ? markdownPasteSlice(editor.markdown, editor.schema, text, model)
    : null;
}
