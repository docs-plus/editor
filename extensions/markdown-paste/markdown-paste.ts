import type { TiptapEditorHTMLElement } from "@tiptap/core";
import { Fragment, Slice } from "@tiptap/pm/model";
import type { EditorProps } from "@tiptap/pm/view";

import type { markdownPasteRule } from "./markdown-paste-rule";

/** Passed to the rule, so its chunk shares no module with the editor's. */
const MODEL = { Fragment, Slice };

/** The rule, once its lazy chunk has loaded; plain text pastes until then. */
let rule: typeof markdownPasteRule | undefined;

/** Fetches the rule (details spec E2) in its own chunk. */
export function loadMarkdownPaste(): Promise<void> {
  return import("./markdown-paste-rule").then(
    (module) => {
      rule = module.markdownPasteRule;
    },
    () => {},
  );
}

/**
 * Markdown paste (details spec E2, P2.12): plain text that is Markdown
 * pastes as formatting. ProseMirror asks `clipboardTextParser`
 * synchronously, so the prop is eager and the rule (`lib/markdown`) comes
 * in a lazy chunk (`loadMarkdownPaste`, when the browser is first idle).
 * Before that, and always for ⌘⇧V (`plain`), the text pastes as plain
 * text: ProseMirror types the prop as always returning a slice, but falls
 * back to plain text when it returns nothing.
 */
export const markdownTextParser = ((text: string, _context, plain, view) => {
  const { editor } = view.dom as TiptapEditorHTMLElement;
  return plain || !rule || !editor ? null : rule(text, editor, MODEL);
}) as NonNullable<EditorProps["clipboardTextParser"]>;
