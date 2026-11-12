import * as Y from "yjs";

import { EDITOR_FRAGMENT_NAME } from "@/lib/yjs-mark-migration";

/** Transaction origin of the server's sweep, so its own deletions are skipped. */
export const ROOT_SWEEP_ORIGIN = "editor-root-sweep";

/** What a sweep removed: top-level entries and fixed labels, never content. */
export type RootSweep = { removed: number; types: string[] };

const NOTHING_SWEPT: RootSweep = { removed: 0, types: [] };

/** Countable content the editor fragment cannot hold (it holds elements). */
export function isNonElementContent(item: Y.Item): boolean {
  const { content } = item;
  if (content instanceof Y.ContentDeleted) return false;
  if (content instanceof Y.ContentType) {
    return !(content.type instanceof Y.XmlElement);
  }
  return item.parentSub === null;
}

/** A fixed label for logs: item content is attacker-chosen. */
function contentLabel({ content }: Y.Item): string {
  if (content instanceof Y.ContentType) {
    if (content.type instanceof Y.XmlText) return "text";
    if (content.type instanceof Y.XmlHook) return "hook";
    return "type";
  }
  if (content instanceof Y.ContentString) return "string";
  if (content instanceof Y.ContentFormat) return "format";
  if (content instanceof Y.ContentEmbed) return "embed";
  if (content instanceof Y.ContentAny) return "any";
  if (content instanceof Y.ContentJSON) return "json";
  if (content instanceof Y.ContentBinary) return "binary";
  if (content instanceof Y.ContentDoc) return "doc";
  return "other";
}

/**
 * Deletes everything directly in the editor fragment that is not an element.
 * y-tiptap cannot project such content: it throws before reporting invalid
 * content, so no client could mount the document or repair it.
 *
 * Walks the top level only, never into blocks. Writes nothing (and never
 * creates the fragment) when there is nothing to remove; otherwise deletes in
 * one transaction under `ROOT_SWEEP_ORIGIN`, which Hocuspocus stores and
 * broadcasts like any other change.
 */
export function sweepEditorRoot(doc: Y.Doc): RootSweep {
  if (!doc.share.has(EDITOR_FRAGMENT_NAME)) return NOTHING_SWEPT;
  const fragment = doc.getXmlFragment(EDITOR_FRAGMENT_NAME);
  const stray: Y.Item[] = [];
  for (let item = fragment._start; item !== null; item = item.right) {
    if (!item.deleted && isNonElementContent(item)) stray.push(item);
  }
  if (stray.length === 0) return NOTHING_SWEPT;
  // Before deleting: garbage collection replaces deleted content.
  const sweep: RootSweep = {
    removed: stray.reduce((sum, item) => sum + item.length, 0),
    types: [...new Set(stray.map(contentLabel))],
  };
  doc.transact((transaction) => {
    for (const item of stray) item.delete(transaction);
  }, ROOT_SWEEP_ORIGIN);
  return sweep;
}

/**
 * Sweeps the editor fragment after every change to its top level, whatever
 * the source: a connection, Redis, or content Yjs held pending until a later
 * update released it. Typing inside a block never reaches this observer; a
 * change to the top level (a new or removed block) costs one walk of it.
 *
 * Yjs runs observers synchronously while it finishes a transaction, so the
 * sweep's deletion is emitted right after the update that added the content,
 * in the same event-loop turn: Hocuspocus merges both into one broadcast.
 * `onSwept` gets the origin of that update.
 */
export function watchEditorRoot(
  doc: Y.Doc,
  onSwept: (sweep: RootSweep, origin: unknown) => void,
): void {
  doc.getXmlFragment(EDITOR_FRAGMENT_NAME).observe((_event, transaction) => {
    if (transaction.origin === ROOT_SWEEP_ORIGIN) return;
    // A throw here would surface in the sender's applyUpdate and reset it.
    try {
      const sweep = sweepEditorRoot(doc);
      if (sweep.removed > 0) onSwept(sweep, transaction.origin);
    } catch (error) {
      console.error("[hocus] editor root sweep failed", error);
    }
  });
}
