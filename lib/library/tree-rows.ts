/**
 * The Library tree's visible rows, flat (APG Tree View with `aria-level`,
 * `aria-setsize` and `aria-posinset`), so drag and drop and P2.7b's
 * virtualized lists work on one array. Folders first, then documents, each
 * by name (details spec §6.3: Title in the tree, so rows don't jump).
 */
import type {
  DocumentEntry,
  FolderEntry,
  LibraryItemRef,
} from "@/lib/platform/document-index";

export interface TreeRow {
  /** `folder:<id>` or `doc:<id>` (`itemKey`). */
  readonly key: string;
  readonly kind: "folder" | "doc";
  readonly id: string;
  readonly label: string;
  readonly level: number;
  readonly posInSet: number;
  readonly setSize: number;
  /** The folder it is in; null at the root. */
  readonly parentId: string | null;
  /** Folders only. */
  readonly expanded?: boolean;
  /** Folders only: no folders or documents inside. */
  readonly empty?: boolean;
}

export const UNTITLED = "Untitled";

export function entryTitle(entry: { title: string }): string {
  return entry.title.trim() || UNTITLED;
}

export function itemKey(ref: LibraryItemRef): string {
  return `${ref.kind}:${ref.id}`;
}

export function parseItemKey(key: string): LibraryItemRef | null {
  const colon = key.indexOf(":");
  const kind = key.slice(0, colon);
  const id = key.slice(colon + 1);
  if (colon < 0 || !id) return null;
  if (kind === "doc" || kind === "folder") return { kind, id };
  return null;
}

/** Sorts names as people read them: case, accents and numbers. */
export const nameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

export function buildTreeRows(
  library: {
    readonly items: readonly DocumentEntry[];
    readonly folders: readonly FolderEntry[];
  },
  expanded: ReadonlySet<string>,
): TreeRow[] {
  const folderKids = new Map<string | null, FolderEntry[]>();
  for (const folder of library.folders) {
    const list = folderKids.get(folder.parentId) ?? [];
    list.push(folder);
    folderKids.set(folder.parentId, list);
  }
  const docKids = new Map<string | null, DocumentEntry[]>();
  for (const doc of library.items) {
    const parent = doc.folderId ?? null;
    const list = docKids.get(parent) ?? [];
    list.push(doc);
    docKids.set(parent, list);
  }
  for (const list of folderKids.values()) {
    list.sort((a, b) => nameCollator.compare(a.name, b.name));
  }
  for (const list of docKids.values()) {
    list.sort((a, b) => nameCollator.compare(entryTitle(a), entryTitle(b)));
  }

  const rows: TreeRow[] = [];
  const walk = (parentId: string | null, level: number) => {
    const folders = folderKids.get(parentId) ?? [];
    const docs = docKids.get(parentId) ?? [];
    const setSize = folders.length + docs.length;
    let position = 0;
    for (const folder of folders) {
      const open = expanded.has(folder.id);
      rows.push({
        key: itemKey({ kind: "folder", id: folder.id }),
        kind: "folder",
        id: folder.id,
        label: folder.name,
        level,
        posInSet: ++position,
        setSize,
        parentId,
        expanded: open,
        empty: !folderKids.has(folder.id) && !docKids.has(folder.id),
      });
      if (open) walk(folder.id, level + 1);
    }
    for (const doc of docs) {
      rows.push({
        key: itemKey({ kind: "doc", id: doc.id }),
        kind: "doc",
        id: doc.id,
        label: entryTitle(doc),
        level,
        posInSet: ++position,
        setSize,
        parentId,
      });
    }
  };
  walk(null, 1);
  return rows;
}
