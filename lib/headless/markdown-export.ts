import type { JSONContent } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import type * as Y from "yjs";

import { cleanText } from "@/lib/clean-text";

import { writeFrontMatter } from "./front-matter";
import { yDocToProseMirror } from "./headless-schema";
import { serializeMarkdownBody } from "./markdown";

/** Library metadata for the front matter; none of it lives in the Y.Doc. */
export interface MarkdownExportMeta {
  tags: readonly string[];
  /** Epoch milliseconds or a Date; left out when unknown. */
  createdAt?: number | Date | null;
  modifiedAt?: number | Date | null;
}

/** Nodes Markdown leaves out (docs/design/2026-11-22-markdown-mapping.md). */
const DROPPED_NODES = new Set(["imageUpload"]);

/**
 * The document as Markdown writes it: dropped nodes removed, and ordered
 * lists numbered with digits. Letter and roman markers (`c.`) are
 * ambiguous in Markdown: `c` reads back as the roman numeral 100.
 */
function prepareForMarkdown(node: JSONContent): JSONContent {
  const prepared =
    node.type === "orderedList"
      ? { ...node, attrs: { ...node.attrs, type: null } }
      : node;
  if (!prepared.content) return prepared;
  return {
    ...prepared,
    content: prepared.content
      .filter((child) => !DROPPED_NODES.has(child.type ?? ""))
      .map(prepareForMarkdown),
  };
}

/** The document's title: its first heading, hard breaks as spaces, cleaned. */
export function documentTitle(doc: PMNode): string {
  const title = doc.firstChild;
  if (!title) return "";
  return cleanText(title.textBetween(0, title.content.size, " ", " "));
}

/**
 * A document as Markdown with front matter (title, tags, created and
 * modified dates). Reads only the node and `meta`: comments, share secrets
 * and other shared types never reach the file.
 */
export function documentToMarkdown(
  doc: PMNode,
  meta: MarkdownExportMeta,
): string {
  const frontMatter = writeFrontMatter({
    title: documentTitle(doc),
    tags: meta.tags,
    createdAt: meta.createdAt,
    modifiedAt: meta.modifiedAt,
  });
  const body = serializeMarkdownBody(
    prepareForMarkdown(doc.toJSON() as JSONContent),
  );
  return body ? `${frontMatter}\n${body}\n` : frontMatter;
}

/**
 * The document in `ydoc` as Markdown with front matter, without an editor.
 * Throws `SchemaMismatchError` for content the schema does not know.
 */
export function exportMarkdown(ydoc: Y.Doc, meta: MarkdownExportMeta): string {
  return documentToMarkdown(yDocToProseMirror(ydoc), meta);
}
