/**
 * Tag names (details spec §3, D7): at most 40 characters, unique by
 * `tagNameKey`, and at most 20 tags per document. Pure (no React, no DOM).
 *
 * `tagNameKey` is the shared search normalizer (`lib/search/normalize.ts`,
 * search-linking §3.2: case, accents, Arabic→Persian letters and digit
 * shapes ignored), so "Café", "cafe" and "CAFE" are one tag. Every
 * `LibraryIndex` enforces it: the desktop engine stores it as
 * `tags.name_key` (offline data-model revision §3), and the web library
 * likewise. SQLite's `COLLATE NOCASE` folds ASCII only, so it can't stand in.
 * A change to the normalizer (`NORMALIZER_VERSION`) recomputes the keys and
 * merges any new collisions with the `mergeTags` rule.
 */
import type { TagEntry } from "@/lib/platform/document-index";
import { normalizeSearchText } from "@/lib/search/normalize";

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
  return normalizeSearchText(cleanTagName(name));
}

export function findTagByName(
  tags: readonly TagEntry[],
  name: string,
): TagEntry | undefined {
  const key = tagNameKey(name);
  return tags.find((tag) => tagNameKey(tag.name) === key);
}
