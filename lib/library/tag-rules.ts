/**
 * Tag names (details spec §3, D7): at most 40 characters, unique ignoring
 * case, and at most 20 tags per document. Every `LibraryIndex` applies
 * `tagNameKey` for uniqueness: SQLite's `COLLATE NOCASE` folds ASCII only,
 * so the desktop engine checks this key too (its NOCASE constraint is a
 * subset and never disagrees), and the web library stores it as `name_key`.
 */
import type { TagEntry } from "@/lib/platform/document-index";

export const TAG_NAME_MAX = 40;
export const MAX_TAGS_PER_DOC = 20;

/** Trimmed, inner spaces collapsed, cut to 40 characters (code points). */
export function cleanTagName(name: string): string {
  const collapsed = name.trim().replace(/\s+/gu, " ");
  const chars = Array.from(collapsed);
  return chars.length <= TAG_NAME_MAX
    ? collapsed
    : chars.slice(0, TAG_NAME_MAX).join("").trimEnd();
}

/** Two names are the same tag when their keys are equal. */
export function tagNameKey(name: string): string {
  return cleanTagName(name).normalize("NFC").toLowerCase();
}

export function findTagByName(
  tags: readonly TagEntry[],
  name: string,
): TagEntry | undefined {
  const key = tagNameKey(name);
  return tags.find((tag) => tagNameKey(tag.name) === key);
}
