/**
 * Folder operations (offline revision §4.2, P2.6d): create, rename, move,
 * and folder Trash. Each is one transaction that bumps `rev`.
 *
 * - The folder graph is a forest at most {@link MAX_FOLDER_DEPTH} deep (I2).
 *   `folders_no_cycle` refuses a cycle in the schema; moves check it first
 *   so the caller gets `into_itself` rather than an abort.
 * - `trashFolder` gives the folder, its live subfolders and their documents
 *   one new `trash_group` (I4). The folder itself moves its parent to
 *   `trashed_from`; everything inside keeps its pointers, so the group can
 *   come back whole. Items already in the Trash keep their own group.
 * - `restoreFolder` brings back exactly that group, to `trashed_from` when it
 *   is live, otherwise to the root.
 * - `purgeFolder` deletes the group's documents, then its folders bottom-up,
 *   in one transaction (`ON DELETE RESTRICT` makes any other order fail).
 */
import type { SqliteDriver } from "./driver";
import { StorageError } from "./errors";
import { MAX_FOLDER_DEPTH } from "./format-2";
import {
  cleanName,
  indexWrite,
  purgeDocRows,
  requireChanged,
  requireId,
  requireLiveFolder,
} from "./library-index";
import { scalar } from "./sql";

export type FolderMoveItem = { kind: "doc" | "folder"; id: string };

export type MoveRefusal = "into_itself" | "too_deep" | "not_found";

export type MoveResult =
  | { ok: true; rev: number; from: Record<string, string | null> }
  | { ok: false; reason: MoveRefusal };

export type FolderRestore = "restored" | "restored_to_root";

type FolderRow = { id: string; parent: string | null; trashed: boolean };

function liveFolders(db: SqliteDriver): Map<string, FolderRow> {
  const map = new Map<string, FolderRow>();
  for (const row of db
    .prepare("SELECT id, parent_id, trashed_at FROM folders")
    .all())
    map.set(String(row.id), {
      id: String(row.id),
      parent: typeof row.parent_id === "string" ? row.parent_id : null,
      trashed: row.trashed_at !== null,
    });
  return map;
}

/** 1 for a root folder. */
function depthOf(folders: Map<string, FolderRow>, id: string | null): number {
  let depth = 0;
  for (let at = id; at !== null; at = folders.get(at)?.parent ?? null) {
    depth += 1;
    if (depth > folders.size) break; // a cycle; the trigger refuses those
  }
  return depth;
}

function childrenOf(folders: Map<string, FolderRow>) {
  const children = new Map<string, string[]>();
  for (const folder of folders.values())
    if (folder.parent !== null)
      children.set(folder.parent, [
        ...(children.get(folder.parent) ?? []),
        folder.id,
      ]);
  return children;
}

/** The folder and everything under it, depth first, `id` first. */
function subtree(folders: Map<string, FolderRow>, id: string): string[] {
  const children = childrenOf(folders);
  const out: string[] = [];
  const visit = (at: string) => {
    out.push(at);
    for (const child of children.get(at) ?? []) visit(child);
  };
  visit(id);
  return out;
}

/** Levels below `id`, counting `id` itself as 1. */
function heightOf(folders: Map<string, FolderRow>, id: string): number {
  const children = childrenOf(folders);
  const height = (at: string): number =>
    1 + Math.max(0, ...(children.get(at) ?? []).map(height));
  return height(id);
}

/**
 * Creates a folder in a live parent (or the root). Null when it would be
 * deeper than {@link MAX_FOLDER_DEPTH}.
 */
export function createFolder(
  db: SqliteDriver,
  input: {
    id?: string;
    name: string;
    parentId?: string | null;
    sortKey?: string;
  },
  now: number,
): { id: string; rev: number } | null {
  const id = input.id ?? crypto.randomUUID();
  requireId(id, "folder id");
  const parentId = input.parentId ?? null;
  if (parentId) requireId(parentId, "parent id");
  let refused = false;
  const rev = indexWrite(db, () => {
    if (parentId) {
      requireLiveFolder(db, parentId);
      if (depthOf(liveFolders(db), parentId) + 1 > MAX_FOLDER_DEPTH) {
        refused = true;
        return;
      }
    }
    db.prepare(
      `INSERT INTO folders (id, parent_id, name, sort_key, created_at, modified_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, parentId, cleanName(input.name), input.sortKey ?? "", now, now);
  });
  return refused ? null : { id, rev };
}

export function renameFolder(
  db: SqliteDriver,
  id: string,
  name: string,
  now: number,
): number {
  return indexWrite(db, () => {
    requireChanged(
      db
        .prepare(
          "UPDATE folders SET name = ?, modified_at = ? WHERE id = ? AND trashed_at IS NULL",
        )
        .run(cleanName(name), now, id).changes,
      "folder",
    );
  });
}

/** Sets a folder's saved list view columns (P2.7b's `encodeListViewColumns`). */
export function setFolderView(
  db: SqliteDriver,
  id: string,
  columns: { sort: string | null; view: string | null; group: string | null },
): number {
  return indexWrite(db, () => {
    requireChanged(
      db
        .prepare(
          `UPDATE folders SET sort = ?, view = ?, "group" = ? WHERE id = ?`,
        )
        .run(columns.sort, columns.view, columns.group, id).changes,
      "folder",
    );
  });
}

/**
 * Moves live documents and folders into a live folder (or the root), all
 * or none. Refuses a folder into its own subtree and any move that would
 * nest deeper than {@link MAX_FOLDER_DEPTH}.
 */
export function moveItems(
  db: SqliteDriver,
  items: readonly FolderMoveItem[],
  folderId: string | null,
): MoveResult {
  // A box, so TypeScript doesn't narrow the closure's writes away.
  const out: { result: MoveResult } = {
    result: { ok: false, reason: "not_found" },
  };
  const rev = indexWrite(db, () => {
    const folders = liveFolders(db);
    if (folderId !== null) {
      const target = folders.get(folderId);
      if (!target || target.trashed) return;
    }
    const targetDepth = depthOf(folders, folderId);
    const from: Record<string, string | null> = {};
    for (const item of items) {
      if (item.kind === "folder") {
        const folder = folders.get(item.id);
        if (!folder || folder.trashed) return;
        if (folderId !== null && subtree(folders, item.id).includes(folderId)) {
          out.result = { ok: false, reason: "into_itself" };
          return;
        }
        if (targetDepth + heightOf(folders, item.id) > MAX_FOLDER_DEPTH) {
          out.result = { ok: false, reason: "too_deep" };
          return;
        }
        from[`folder:${item.id}`] = folder.parent;
      } else {
        const doc = db
          .prepare(
            "SELECT folder_id FROM docs WHERE id = ? AND trashed_at IS NULL",
          )
          .get(item.id);
        if (!doc) return;
        from[`doc:${item.id}`] =
          typeof doc.folder_id === "string" ? doc.folder_id : null;
      }
    }
    const moveFolder = db.prepare(
      "UPDATE folders SET parent_id = ? WHERE id = ?",
    );
    const moveDoc = db.prepare("UPDATE docs SET folder_id = ? WHERE id = ?");
    for (const item of items)
      (item.kind === "folder" ? moveFolder : moveDoc).run(folderId, item.id);
    out.result = { ok: true, rev: 0, from };
  });
  if (out.result.ok) out.result.rev = rev;
  return out.result;
}

/**
 * Trashes a folder with its live subtree under one new `trash_group`.
 * Returns the group and how many documents went with it.
 */
export function trashFolder(
  db: SqliteDriver,
  id: string,
  now: number,
): {
  rev: number;
  trashGroup: string;
  docCount: number;
  parentId: string | null;
} {
  const trashGroup = crypto.randomUUID();
  let docCount = 0;
  let parentId: string | null = null;
  const rev = indexWrite(db, () => {
    const folders = liveFolders(db);
    const folder = folders.get(id);
    if (!folder || folder.trashed)
      throw new StorageError("not_found", "no such folder");
    parentId = folder.parent;
    const live = subtree(folders, id).filter((f) => !folders.get(f)?.trashed);
    const marks = live.map(() => "?").join(", ");
    db.prepare(
      `UPDATE folders SET trashed_at = ?, trash_group = ? WHERE id IN (${marks})`,
    ).run(now, trashGroup, ...live);
    db.prepare(
      "UPDATE folders SET trashed_from = parent_id, parent_id = NULL WHERE id = ?",
    ).run(id);
    docCount = db
      .prepare(
        `UPDATE docs SET trashed_at = ?, trash_group = ?
         WHERE trashed_at IS NULL AND folder_id IN (${marks})`,
      )
      .run(now, trashGroup, ...live).changes;
  });
  return { rev, trashGroup, docCount, parentId };
}

/**
 * Restores a trashed folder's whole group: to `trashed_from` when that
 * folder is live, otherwise to the root.
 */
export function restoreFolder(
  db: SqliteDriver,
  id: string,
): { rev: number; result: FolderRestore } {
  let result: FolderRestore = "restored";
  const rev = indexWrite(db, () => {
    const row = db
      .prepare(
        "SELECT trash_group, trashed_from FROM folders WHERE id = ? AND trashed_at IS NOT NULL",
      )
      .get(id);
    if (!row) throw new StorageError("not_found", "no such trashed folder");
    const group = String(row.trash_group);
    const from = typeof row.trashed_from === "string" ? row.trashed_from : null;
    const live =
      from !== null &&
      scalar(
        db,
        "SELECT 1 FROM folders WHERE id = ? AND trashed_at IS NULL",
        from,
      ) !== undefined;
    if (from !== null && !live) result = "restored_to_root";
    db.prepare(
      `UPDATE folders SET parent_id = ?, trashed_at = NULL, trash_group = NULL,
         trashed_from = NULL WHERE id = ?`,
    ).run(live ? from : null, id);
    db.prepare(
      `UPDATE folders SET trashed_at = NULL, trash_group = NULL, trashed_from = NULL
       WHERE trash_group = ?`,
    ).run(group);
    db.prepare(
      `UPDATE docs SET trashed_at = NULL, trash_group = NULL, trashed_from = NULL
       WHERE trash_group = ?`,
    ).run(group);
  });
  return { rev, result };
}

/**
 * Deletes a trashed folder's group forever: its documents first (their
 * `doc_blobs` rows marked dropped), then its folders bottom-up. Returns the
 * purged document ids. The caller refuses while any of them is open.
 */
export function purgeFolder(
  db: SqliteDriver,
  id: string,
  now: number,
  isOpen: (docId: string) => boolean = () => false,
): { rev: number; docIds: string[] } {
  const docIds: string[] = [];
  const rev = indexWrite(db, () => {
    const group = scalar(
      db,
      "SELECT trash_group FROM folders WHERE id = ? AND trashed_at IS NOT NULL",
      id,
    );
    if (typeof group !== "string")
      throw new StorageError("not_found", "no such trashed folder");
    for (const row of db
      .prepare("SELECT id FROM docs WHERE trash_group = ?")
      .all(group))
      docIds.push(String(row.id));
    for (const docId of docIds)
      if (isOpen(docId))
        throw new StorageError("document_open", "a document is open");
    for (const docId of docIds) purgeDocRows(db, docId, now);
    // Bottom-up: children before parents, so RESTRICT never fires.
    const folders = liveFolders(db);
    const members = subtree(folders, id).filter(
      (f) =>
        scalar(db, "SELECT trash_group FROM folders WHERE id = ?", f) === group,
    );
    for (const folder of members.reverse())
      db.prepare("DELETE FROM folders WHERE id = ?").run(folder);
  });
  return { rev, docIds };
}

/** Roots of trashed folder groups older than `cutoff` (the 30-day purge). */
export function expiredFolders(db: SqliteDriver, cutoff: number): string[] {
  return db
    .prepare(
      `SELECT id FROM folders WHERE trashed_at IS NOT NULL AND trashed_at <= ?
         AND (parent_id IS NULL OR parent_id NOT IN
           (SELECT id FROM folders f2 WHERE f2.trash_group = folders.trash_group))`,
    )
    .all(cutoff)
    .map((row) => String(row.id));
}
