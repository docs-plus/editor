import * as Y from "yjs";

import { markNameFromKey } from "@/lib/schema-names";

/** Collaboration field the editor binds its ProseMirror document to. */
export const EDITOR_FRAGMENT_NAME = "default";

/**
 * Stored mark names that changed when the editor moved to the @docs.plus
 * Hyperlink and InlineCode marks.
 *
 * Must run before any client syncs: y-prosemirror deletes a whole text run
 * from the shared doc when it meets a mark the schema does not know.
 */
export const LEGACY_MARK_RENAMES: Readonly<Record<string, string>> = {
  link: "hyperlink",
  code: "inlineCode",
};

/** Transaction origin, so update listeners can tell migrations apart. */
export const MARK_MIGRATION_ORIGIN = "legacy-mark-migration";

interface FormatPatch {
  text: Y.XmlText;
  index: number;
  length: number;
  attributes: Record<string, unknown>;
}

function renamedAttributeKey(key: string): string | null {
  const name = markNameFromKey(key);
  const suffix = key.slice(name.length);
  const renamed = LEGACY_MARK_RENAMES[name];
  return renamed ? `${renamed}${suffix}` : null;
}

function collectTextPatches(text: Y.XmlText, patches: FormatPatch[]): void {
  let index = 0;
  for (const delta of text.toDelta()) {
    const length = typeof delta.insert === "string" ? delta.insert.length : 1;
    const attributes: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(delta.attributes ?? {})) {
      const renamed = renamedAttributeKey(key);
      if (!renamed) continue;
      attributes[key] = null;
      attributes[renamed] = value;
    }
    if (Object.keys(attributes).length > 0) {
      patches.push({ text, index, length, attributes });
    }
    index += length;
  }
}

function collectPatches(
  parent: Y.XmlFragment | Y.XmlElement,
  patches: FormatPatch[],
): void {
  for (const child of parent.toArray()) {
    if (child instanceof Y.XmlText) collectTextPatches(child, patches);
    else if (child instanceof Y.XmlElement) collectPatches(child, patches);
  }
}

/**
 * Renames legacy mark attributes (`link`, `code`) in a document's editor
 * fragment, keeping their attrs. Idempotent; writes nothing when the doc has
 * no editor fragment or no legacy marks.
 *
 * @returns number of text ranges rewritten
 */
export function migrateLegacyMarks(
  doc: Y.Doc,
  fragmentName: string = EDITOR_FRAGMENT_NAME,
): number {
  if (!doc.share.has(fragmentName)) return 0;

  const patches: FormatPatch[] = [];
  collectPatches(doc.getXmlFragment(fragmentName), patches);
  if (patches.length === 0) return 0;

  doc.transact(() => {
    // Formatting never shifts indices, so patch order does not matter.
    for (const { text, index, length, attributes } of patches) {
      text.format(index, length, attributes);
    }
  }, MARK_MIGRATION_ORIGIN);

  return patches.length;
}
