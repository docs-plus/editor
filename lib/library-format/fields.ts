/**
 * Fields `library.json` (LJ1) never carries, listed in one place (offline
 * data-model revision §3.6). Every other column of every store maps one to
 * one between the desktop tables and the web library's IndexedDB stores.
 *
 * - **Platform-only:** meaningful on one platform only.
 * - **Index sentinels (web):** copies of nullable columns that IndexedDB
 *   can index (`''` for null, `stale` as a number); rebuilt from the real
 *   columns on import.
 * - **Derived:** recomputed by the library itself (the derive queue,
 *   `normalizeSearchText`); an import never takes them from the file.
 *
 * Keys are table names as desktop spells them; the web `headings` store is
 * desktop's `doc_headings`.
 */
export const PLATFORM_ONLY_FIELDS = {
  web: {
    docs: ["exported_at", "md_at"],
    updates: ["writer"],
    snapshots: ["rev"],
  },
  desktop: {
    docs: ["mirrored_at"],
  },
} as const;

export const WEB_INDEX_SENTINELS = {
  docs: ["list_key", "stale"],
  folders: ["parent_key"],
} as const;

export const DERIVED_FIELDS = {
  docs: ["title_key", "head_seq", "derived_seq", "links_hash", "headings_hash"],
  tags: ["name_key"],
  links: "*",
  doc_headings: "*",
} as const;
