import * as Y from "yjs";

import { highlightTokenFromValue } from "@/lib/highlight-tokens";
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

/**
 * Stored key of the highlight mark. It excludes itself, so y-tiptap never
 * writes a hashed `highlight--…` key for it; a hashed key is left alone.
 */
const HIGHLIGHT_KEY = "highlight";

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

/**
 * The highlight attrs with a legacy `var(--tt-color-highlight-X)` colour
 * rewritten to the token X, or null when there is nothing to rewrite (already
 * a token, or an unknown value, which renders unstyled either way).
 */
function tokenisedHighlight(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const attrs = value as Record<string, unknown>;
  const token = highlightTokenFromValue(attrs.color);
  return token && token !== attrs.color ? { ...attrs, color: token } : null;
}

export interface MarkMigrationOptions {
  /**
   * Also rewrite legacy highlight colours to their token. Off by default:
   * release N clients compare raw values for the popover's pressed state, so
   * Hocus turns it on (`HOCUS_REWRITE_LEGACY_HIGHLIGHTS=1`) only once N tabs
   * are gone.
   */
  rewriteHighlights?: boolean;
  fragmentName?: string;
}

function collectTextPatches(
  text: Y.XmlText,
  patches: FormatPatch[],
  rewriteHighlights: boolean,
): void {
  let index = 0;
  for (const delta of text.toDelta()) {
    const length = typeof delta.insert === "string" ? delta.insert.length : 1;
    const attributes: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(delta.attributes ?? {})) {
      if (key === HIGHLIGHT_KEY) {
        if (!rewriteHighlights) continue;
        const tokenised = tokenisedHighlight(value);
        if (tokenised) attributes[key] = tokenised;
        continue;
      }
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
  rewriteHighlights: boolean,
): void {
  for (const child of parent.toArray()) {
    if (child instanceof Y.XmlText)
      collectTextPatches(child, patches, rewriteHighlights);
    else if (child instanceof Y.XmlElement)
      collectPatches(child, patches, rewriteHighlights);
  }
}

/**
 * Renames legacy mark attributes (`link`, `code`) in a document's editor
 * fragment, keeping their attrs, and with `rewriteHighlights` rewrites legacy
 * highlight colours (`var(--tt-color-highlight-X)`) to their token X.
 * Idempotent; writes nothing when the doc has no editor fragment or nothing
 * legacy.
 *
 * @returns number of text ranges rewritten
 */
export function migrateLegacyMarks(
  doc: Y.Doc,
  {
    rewriteHighlights = false,
    fragmentName = EDITOR_FRAGMENT_NAME,
  }: MarkMigrationOptions = {},
): number {
  if (!doc.share.has(fragmentName)) return 0;

  const patches: FormatPatch[] = [];
  collectPatches(doc.getXmlFragment(fragmentName), patches, rewriteHighlights);
  if (patches.length === 0) return 0;

  doc.transact(() => {
    // Formatting never shifts indices, so patch order does not matter.
    for (const { text, index, length, attributes } of patches) {
      text.format(index, length, attributes);
    }
  }, MARK_MIGRATION_ORIGIN);

  return patches.length;
}
