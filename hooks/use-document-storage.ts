import type { JSONContent } from "@tiptap/react";

const LEGACY_KEY = "tinydocy-document";
const PER_TAB_PREFIX = "tinydocy-doc-";

/**
 * Migrates the legacy single-document localStorage key to a per-tab key.
 * Called once during tab initialization (before Y.js existed).
 */
export function migrateLegacyDocument(targetDocId: string): boolean {
  if (typeof window === "undefined") return false;
  const raw = localStorage.getItem(LEGACY_KEY);
  if (!raw) return false;

  try {
    localStorage.setItem(`${PER_TAB_PREFIX}${targetDocId}`, raw);
    localStorage.removeItem(LEGACY_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks localStorage for content from before the Y.js migration.
 * Returns the content if found and removes the localStorage key.
 * Returns null if nothing to migrate.
 */
export function migrateLegacyLocalStorage(
  documentId: string,
): JSONContent | null {
  if (typeof window === "undefined") return null;

  const perTabKey = `${PER_TAB_PREFIX}${documentId}`;

  for (const key of [perTabKey, LEGACY_KEY]) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw) as JSONContent;
        localStorage.removeItem(key);
        return parsed;
      }
    } catch {
      localStorage.removeItem(key);
    }
  }

  return null;
}
