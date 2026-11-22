/**
 * Folder rules (details spec §6.1), one copy for every `LibraryIndex`, drag
 * and drop and Move to…: folders nest 4 levels, and a folder never goes
 * inside itself.
 */
import type {
  FolderEntry,
  LibraryItemRef,
  MoveRefusal,
} from "@/lib/platform/document-index";

export const MAX_FOLDER_DEPTH = 4;

export interface FolderIndex {
  readonly byId: ReadonlyMap<string, FolderEntry>;
  /** Children by parent id; the root's are under `null`. */
  readonly children: ReadonlyMap<string | null, readonly FolderEntry[]>;
}

export function indexFolders(folders: readonly FolderEntry[]): FolderIndex {
  const byId = new Map<string, FolderEntry>();
  const children = new Map<string | null, FolderEntry[]>();
  for (const folder of folders) {
    byId.set(folder.id, folder);
    const siblings = children.get(folder.parentId);
    if (siblings) siblings.push(folder);
    else children.set(folder.parentId, [folder]);
  }
  return { byId, children };
}

/** 0 for the root, 1 for a top-level folder. */
export function folderDepth(index: FolderIndex, id: string | null): number {
  let depth = 0;
  for (let at = id; at !== null; depth++) {
    const folder = index.byId.get(at);
    if (!folder || depth > index.byId.size) break;
    at = folder.parentId;
  }
  return depth;
}

/** Levels in a folder's subtree, itself included (1 for a leaf). */
export function subtreeHeight(index: FolderIndex, id: string): number {
  let height = 0;
  let level: readonly string[] = [id];
  while (level.length > 0 && height <= MAX_FOLDER_DEPTH + 1) {
    height++;
    level = level.flatMap((at) =>
      (index.children.get(at) ?? []).map((child) => child.id),
    );
  }
  return height;
}

/** True when `id` is `ancestor` or inside it. */
export function isInSubtree(
  index: FolderIndex,
  ancestor: string,
  id: string | null,
): boolean {
  for (let at = id, steps = 0; at !== null; steps++) {
    if (at === ancestor) return true;
    const folder = index.byId.get(at);
    if (!folder || steps > index.byId.size) return false;
    at = folder.parentId;
  }
  return false;
}

/** The folders from the root down to `id`, `id` last. */
export function folderPath(
  index: FolderIndex,
  id: string | null,
): FolderEntry[] {
  const path: FolderEntry[] = [];
  for (let at = id; at !== null && path.length <= index.byId.size; ) {
    const folder = index.byId.get(at);
    if (!folder) break;
    path.unshift(folder);
    at = folder.parentId;
  }
  return path;
}

export function canCreateFolderIn(
  index: FolderIndex,
  parentId: string | null,
): boolean {
  if (parentId !== null && !index.byId.has(parentId)) return false;
  return folderDepth(index, parentId) < MAX_FOLDER_DEPTH;
}

/** Why moving `items` into `folderId` is refused, or null when allowed. */
export function checkMove(
  index: FolderIndex,
  items: readonly LibraryItemRef[],
  folderId: string | null,
): MoveRefusal | null {
  if (folderId !== null && !index.byId.has(folderId)) return "not_found";
  const depth = folderDepth(index, folderId);
  for (const item of items) {
    if (item.kind !== "folder") continue;
    if (!index.byId.has(item.id)) return "not_found";
    if (isInSubtree(index, item.id, folderId)) return "into_itself";
    if (depth + subtreeHeight(index, item.id) > MAX_FOLDER_DEPTH) {
      return "too_deep";
    }
  }
  return null;
}

const REFUSAL_COPY: Record<MoveRefusal, string> = {
  into_itself: "A folder can't go inside itself.",
  too_deep: `Folders can be nested ${MAX_FOLDER_DEPTH} levels deep.`,
  not_found: "That item or folder is no longer in your library.",
  not_ready: "Your library isn't ready yet. Try again in a moment.",
};

export function moveRefusalMessage(reason: MoveRefusal): string {
  return REFUSAL_COPY[reason];
}
