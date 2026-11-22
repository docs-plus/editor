/**
 * The rest of P2.7b's `LibraryIndex` on storage (offline revision §3.5,
 * §4.2; P2.6e builds the RPC adapter on these): pins and Manual order (the
 * adapter computes keys with `lib/library/library-keys.ts` and sends them),
 * list views for places that aren't folders, the Trash list, lazy snippets,
 * and prefix search on `title_key` and `doc_headings.text_key`.
 */
import { normalizeSearchText } from "@/lib/search/normalize";

import type { SqliteDriver } from "./driver";
import { StorageError } from "./errors";
import { indexWrite, requireChanged } from "./library-index";
import { writeMeta } from "./sql";

export function pinDoc(db: SqliteDriver, id: string, pinKey: string): number {
  return indexWrite(db, () => {
    requireChanged(
      db
        .prepare(
          "UPDATE docs SET pinned = 1, pin_key = ? WHERE id = ? AND trashed_at IS NULL",
        )
        .run(pinKey, id).changes,
      "document",
    );
  });
}

export function unpinDoc(db: SqliteDriver, id: string): number {
  return indexWrite(db, () => {
    requireChanged(
      db
        .prepare("UPDATE docs SET pinned = 0, pin_key = NULL WHERE id = ?")
        .run(id).changes,
      "document",
    );
  });
}

/** Rewrites pin keys (`movePin`) or Manual-order keys (`moveInFolder`). */
export function setKeys(
  db: SqliteDriver,
  column: "pin_key" | "sort_key",
  keys: readonly { id: string; key: string }[],
): number {
  return indexWrite(db, () => {
    const update = db.prepare(`UPDATE docs SET ${column} = ? WHERE id = ?`);
    for (const { id, key } of keys)
      requireChanged(update.run(key, id).changes, "document");
  });
}

const PLACE = /^(library|recent|pinned|trash|tag:[A-Za-z0-9_-]{1,64})$/;
const VIEW_PREFIX = "list_view:";

/**
 * Saved list choices for a place that isn't a folder (`listPlaceKey`):
 * stored as JSON in `meta('list_view:<place>')`; null clears it. A
 * folder's go to its own columns (`setFolderView`).
 */
export function setPlaceView(
  db: SqliteDriver,
  place: string,
  json: string | null,
): number {
  if (!PLACE.test(place))
    throw new StorageError("invalid_argument", "bad list place");
  if (json !== null && json.length > 1000)
    throw new StorageError("invalid_argument", "list view is too long");
  return indexWrite(db, () => {
    if (json === null)
      db.prepare("DELETE FROM meta WHERE key = ?").run(VIEW_PREFIX + place);
    else writeMeta(db, VIEW_PREFIX + place, json);
  });
}

export function placeViews(db: SqliteDriver): Record<string, string> {
  const views: Record<string, string> = {};
  for (const row of db
    .prepare("SELECT key, value FROM meta WHERE key LIKE 'list_view:%'")
    .all())
    views[String(row.key).slice(VIEW_PREFIX.length)] = String(row.value);
  return views;
}

export type TrashedDoc = {
  kind: "doc";
  id: string;
  title: string;
  trashedAt: number;
  folderId: string | null;
};

export type TrashedFolderRow = {
  kind: "folder";
  id: string;
  name: string;
  trashedAt: number;
  parentId: string | null;
  docCount: number;
  trashGroup: string;
};

/**
 * What the Trash list shows, newest first: documents trashed alone, and
 * each trashed folder group as one unit (its documents are inside it).
 */
export function trashList(db: SqliteDriver): {
  items: (TrashedDoc | TrashedFolderRow)[];
  docCount: number;
} {
  const folderGroups = new Set<string>();
  const folders: TrashedFolderRow[] = [];
  for (const row of db
    .prepare(
      `SELECT f.id, f.name, f.trashed_at, f.trashed_from, f.trash_group,
         (SELECT COUNT(*) FROM docs d WHERE d.trash_group = f.trash_group) AS docs
       FROM folders f
       WHERE f.trashed_at IS NOT NULL AND f.parent_id IS NULL`,
    )
    .all()) {
    folderGroups.add(String(row.trash_group));
    folders.push({
      kind: "folder",
      id: String(row.id),
      name: String(row.name),
      trashedAt: Number(row.trashed_at),
      parentId: typeof row.trashed_from === "string" ? row.trashed_from : null,
      docCount: Number(row.docs),
      trashGroup: String(row.trash_group),
    });
  }
  const docs: TrashedDoc[] = [];
  let docCount = 0;
  for (const row of db
    .prepare(
      "SELECT id, title, trashed_at, trash_group, trashed_from FROM docs WHERE trashed_at IS NOT NULL",
    )
    .all()) {
    docCount += 1;
    if (folderGroups.has(String(row.trash_group))) continue;
    docs.push({
      kind: "doc",
      id: String(row.id),
      title: String(row.title),
      trashedAt: Number(row.trashed_at),
      folderId: typeof row.trashed_from === "string" ? row.trashed_from : null,
    });
  }
  const items = [...folders, ...docs].sort(
    (a, b) => b.trashedAt - a.trashedAt || a.id.localeCompare(b.id),
  );
  return { items, docCount };
}

/** Snippets for the rows a Preview list shows (fetched lazily, §3.5). */
export function snippets(
  db: SqliteDriver,
  ids: readonly string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  const read = db.prepare("SELECT snippet FROM docs WHERE id = ?");
  for (const id of ids.slice(0, 500)) {
    const row = read.get(id);
    if (row) out[id] = String(row.snippet);
  }
  return out;
}

/** The exclusive upper bound of a prefix range on a normalized key. */
const PREFIX_END = String.fromCodePoint(0x10ffff);
export const SEARCH_LIMIT = 50;

/**
 * Live, non-template documents whose title starts with `query` (normalized,
 * `docs_title_key`): the Quick Open fallback above 5,000 documents (§5.2).
 */
export function searchTitles(
  db: SqliteDriver,
  query: string,
): { id: string; title: string }[] {
  const key = normalizeSearchText(query);
  if (!key) return [];
  return db
    .prepare(
      `SELECT id, title FROM docs
       WHERE title_key >= ? AND title_key < ? AND trashed_at IS NULL AND kind = 'doc'
       ORDER BY title_key LIMIT ?`,
    )
    .all(key, key + PREFIX_END, SEARCH_LIMIT)
    .map((row) => ({ id: String(row.id), title: String(row.title) }));
}

/** Headings across documents starting with `query` (`doc_headings_text`). */
export function searchHeadings(
  db: SqliteDriver,
  query: string,
): { docId: string; tocId: string; level: number; text: string }[] {
  const key = normalizeSearchText(query);
  if (!key) return [];
  return db
    .prepare(
      `SELECT h.doc_id, h.toc_id, h.level, h.text FROM doc_headings h
       JOIN docs d ON d.id = h.doc_id
       WHERE h.text_key >= ? AND h.text_key < ? AND d.trashed_at IS NULL AND d.kind = 'doc'
       ORDER BY h.text_key LIMIT ?`,
    )
    .all(key, key + PREFIX_END, SEARCH_LIMIT)
    .map((row) => ({
      docId: String(row.doc_id),
      tocId: String(row.toc_id),
      level: Number(row.level),
      text: String(row.text),
    }));
}
