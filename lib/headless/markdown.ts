import type { JSONContent } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Marked, type marked } from "marked";

import { buildHeadlessSchemaExtensions } from "./schema-extensions";

let manager: MarkdownManager | null = null;

/** The manager's text escaper: a private method of @tiptap/markdown 3.x. */
interface TextEscaper {
  escapeMarkdownSyntax(text: string): string;
}

/**
 * Adds `=` runs to the characters the manager escapes in text: `==x==` is
 * the highlight syntax, so literal text would come back highlighted. The
 * round-trip tests fail if an upgrade renames the method.
 */
function escapeHighlightSyntax(target: MarkdownManager): void {
  const escaper = target as unknown as TextEscaper;
  const escapeText = escaper.escapeMarkdownSyntax.bind(target);
  escaper.escapeMarkdownSyntax = (text) =>
    escapeText(text).replace(/={2,}/g, (run) => run.replace(/=/g, "\\="));
}

/**
 * One Markdown manager over the headless extensions, with its own `marked`
 * instance (the module-wide default would collect every caller's
 * tokenizers). The manager keeps no per-call state between `parse` calls.
 */
function getMarkdownManager(): MarkdownManager {
  if (!manager) {
    manager = new MarkdownManager({
      marked: new Marked() as unknown as typeof marked,
      extensions: buildHeadlessSchemaExtensions(),
    });
    escapeHighlightSyntax(manager);
  }
  return manager;
}

/** Markdown for a document, with no front matter. */
export function serializeMarkdownBody(doc: PMNode | JSONContent): string {
  const json = "toJSON" in doc ? (doc.toJSON() as JSONContent) : doc;
  return getMarkdownManager().serialize(json);
}

/**
 * ProseMirror JSON for a Markdown body. Raw HTML (`<u>`, `<sup>`, `<sub>`)
 * becomes formatting only where a `DOMParser` exists (the renderer); in a
 * worker it stays literal text, and the import path hands it to the
 * renderer (onboarding design §4.6).
 */
export function parseMarkdownBody(markdown: string): JSONContent {
  return getMarkdownManager().parse(markdown);
}
