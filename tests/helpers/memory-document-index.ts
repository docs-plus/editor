import {
  canCreateFolderIn,
  checkMove,
  indexFolders,
} from "@/lib/library/folder-rules";
import {
  appendedManualKey,
  compareManual,
  renumberManual,
} from "@/lib/library/list-rows";
import { cleanListViewPrefs } from "@/lib/library/list-view";
import {
  cleanTagName,
  findTagByName,
  MAX_TAGS_PER_DOC,
} from "@/lib/library/tag-rules";
import type {
  DocumentEntry,
  FolderEntry,
  FolderRestoreResult,
  LibraryIndex,
  LibraryIndexListener,
  LibraryIndexSnapshot,
  LibraryItemRef,
  ListViewPrefs,
  MoveResult,
  RestorableEntry,
  RestoreResult,
  TagEntry,
  TagRenameResult,
  TrashedFolder,
  TrashedItem,
  TrashResult,
} from "@/lib/platform/document-index";

export interface MemoryDocumentIndexOptions {
  /** Listed at the start. */
  items?: readonly DocumentEntry[];
  /** Folders at the start (`LibraryIndex`). */
  folders?: readonly FolderEntry[];
  /** Tags at the start (`LibraryIndex`). */
  tags?: readonly TagEntry[];
  /** Start not ready; `load()` makes it ready. */
  deferLoad?: boolean;
  /** Ids `trash` refuses. */
  failTrash?: readonly string[];
}

/** A folder in the Trash with the subtree and documents that went with it. */
interface FolderUnit {
  readonly folders: FolderEntry[];
  readonly docs: DocumentEntry[];
  readonly trashedAt: number;
  /** The subtree's one `trash_group`. */
  readonly trashGroup: string;
}

interface TrashedDoc {
  readonly entry: DocumentEntry;
  readonly trashedAt: number;
}

const NAME_CAP = 200;

function cleanName(name: string): string {
  return name.trim().slice(0, NAME_CAP);
}

/**
 * The entry with `folderId` set (or dropped at the root) and `sortKey`,
 * its place in that folder's Manual order (or none).
 */
function inFolder(
  entry: DocumentEntry,
  folderId: string | null,
  sortKey?: string,
): DocumentEntry {
  const { folderId: _old, sortKey: _key, ...rest } = entry;
  const placed = folderId === null ? rest : { ...rest, folderId };
  return sortKey === undefined ? placed : { ...placed, sortKey };
}

function pinKeyAt(position: number): string {
  return `p${String(position).padStart(6, "0")}`;
}

/**
 * `DocumentIndex` and `LibraryIndex` in memory, for the contract suites, the
 * library harness and hosts that have no store yet. The Trash is a map;
 * restore puts an entry back at the position it was trashed from. Ids come
 * from `crypto.randomUUID()`.
 */
export class MemoryDocumentIndex implements LibraryIndex {
  private readonly listeners = new Set<LibraryIndexListener>();
  private readonly trashBin = new Map<string, TrashedDoc>();
  private readonly folderUnits = new Map<string, FolderUnit>();
  private readonly failTrash: ReadonlySet<string>;
  private items: DocumentEntry[];
  private folders: FolderEntry[];
  private tags: TagEntry[];
  private listViews: Record<string, Partial<ListViewPrefs>> = {};
  private current: LibraryIndexSnapshot;
  private destroyed = false;
  /** Trash times only grow, so the Trash list's order is stable. */
  private lastTrashedAt = 0;

  constructor(options: MemoryDocumentIndexOptions = {}) {
    this.items = [...(options.items ?? [])];
    this.folders = [...(options.folders ?? [])];
    this.tags = [...(options.tags ?? [])];
    this.failTrash = new Set(options.failTrash);
    this.current = options.deferLoad
      ? {
          rev: 0,
          ready: false,
          items: [],
          folders: [],
          trashCount: 0,
          tags: [],
          listViews: {},
          trash: [],
        }
      : this.build(1);
  }

  /** Makes a deferred index ready, or reloads it: emits `load`. */
  load(): void {
    this.publish("load");
  }

  /** Forgets trashed documents and folders, so restoring them answers `gone`. */
  purgeTrash(): void {
    this.trashBin.clear();
    this.folderUnits.clear();
    if (this.current.ready) this.publish("change");
  }

  snapshot(): LibraryIndexSnapshot {
    return this.current;
  }

  subscribe(listener: LibraryIndexListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  create(init?: {
    title?: string;
    folderId?: string | null;
  }): DocumentEntry | null {
    if (!this.writable()) return null;
    const folderId = init?.folderId ?? null;
    if (folderId !== null && !this.folders.some((f) => f.id === folderId)) {
      return null;
    }
    const now = Date.now();
    const entry = inFolder(
      {
        id: crypto.randomUUID(),
        title: init?.title ?? "Untitled",
        createdAt: now,
        modifiedAt: now,
      },
      folderId,
      appendedManualKey(this.siblings(folderId)),
    );
    this.items.push(entry);
    this.publish("change");
    return entry;
  }

  rename(id: string, title: string): void {
    this.updateDoc(id, (entry) => ({ ...entry, title }));
  }

  move(id: string, toIndex: number): void {
    if (!this.writable()) return;
    const from = this.items.findIndex((item) => item.id === id);
    const to = Math.min(Math.max(toIndex, 0), this.items.length - 1);
    if (from < 0 || from === to) return;
    const [moved] = this.items.splice(from, 1);
    this.items.splice(to, 0, moved);
    this.publish("change");
  }

  async trash(ids: readonly string[]): Promise<TrashResult> {
    await Promise.resolve();
    if (!this.writable()) return { trashed: [], failed: [...ids] };
    const trashed: RestorableEntry[] = [];
    const failed: string[] = [];
    for (const id of ids) {
      const index = this.items.findIndex((item) => item.id === id);
      if (index < 0 || this.failTrash.has(id)) {
        failed.push(id);
        continue;
      }
      trashed.push({ id, title: this.items[index].title, index });
    }
    if (trashed.length === 0) return { trashed, failed };
    const gone = new Set(trashed.map((entry) => entry.id));
    const trashedAt = this.trashTime();
    for (const item of this.items) {
      if (gone.has(item.id)) {
        this.trashBin.set(item.id, { entry: item, trashedAt });
      }
    }
    this.items = this.items.filter((item) => !gone.has(item.id));
    this.publish("change");
    return { trashed, failed };
  }

  async restore(
    entries: readonly RestorableEntry[],
  ): Promise<Record<string, RestoreResult> | null> {
    await Promise.resolve();
    if (!this.writable() || entries.length === 0) return null;
    const results: Record<string, RestoreResult> = {};
    const ordered = [...entries].sort(
      (a, b) => (a.index ?? Infinity) - (b.index ?? Infinity),
    );
    let changed = false;
    for (const entry of ordered) {
      const trashed = this.trashBin.get(entry.id);
      if (!trashed) {
        const listed = this.items.some((item) => item.id === entry.id);
        results[entry.id] = listed ? "not_closed" : "gone";
        continue;
      }
      this.trashBin.delete(entry.id);
      const folderId = trashed.entry.folderId ?? null;
      const home = this.folders.some((f) => f.id === folderId)
        ? folderId
        : null;
      const at = Math.min(entry.index ?? this.items.length, this.items.length);
      const restored =
        home === folderId
          ? trashed.entry
          : inFolder(
              trashed.entry,
              home,
              appendedManualKey(this.siblings(home)),
            );
      this.items.splice(at, 0, restored);
      results[entry.id] = "restored";
      changed = true;
    }
    if (changed) this.publish("change");
    return results;
  }

  createFolder(init: {
    name: string;
    parentId?: string | null;
  }): FolderEntry | null {
    if (!this.writable()) return null;
    const name = cleanName(init.name);
    const parentId = init.parentId ?? null;
    if (!name || !canCreateFolderIn(indexFolders(this.folders), parentId)) {
      return null;
    }
    const folder: FolderEntry = {
      id: crypto.randomUUID(),
      name,
      parentId,
      createdAt: Date.now(),
    };
    this.folders.push(folder);
    this.publish("change");
    return folder;
  }

  renameFolder(id: string, name: string): void {
    const clean = cleanName(name);
    if (!this.writable() || !clean) return;
    const at = this.folders.findIndex((folder) => folder.id === id);
    if (at < 0 || this.folders[at].name === clean) return;
    this.folders[at] = { ...this.folders[at], name: clean };
    this.publish("change");
  }

  moveItems(
    items: readonly LibraryItemRef[],
    folderId: string | null,
  ): MoveResult {
    if (!this.writable()) return { ok: false, reason: "not_ready" };
    const refusal = checkMove(indexFolders(this.folders), items, folderId);
    if (refusal) return { ok: false, reason: refusal };
    const from: Record<string, string | null> = {};
    for (const item of items) {
      const current =
        item.kind === "doc"
          ? this.items.find((entry) => entry.id === item.id)?.folderId
          : this.folders.find((entry) => entry.id === item.id)?.parentId;
      if (current === undefined && item.kind === "folder") {
        return { ok: false, reason: "not_found" };
      }
      if (
        item.kind === "doc" &&
        !this.items.some((entry) => entry.id === item.id)
      ) {
        return { ok: false, reason: "not_found" };
      }
      from[`${item.kind}:${item.id}`] = current ?? null;
    }
    const docs = new Set(
      items.filter((item) => item.kind === "doc").map((item) => item.id),
    );
    const dirs = new Set(
      items.filter((item) => item.kind === "folder").map((item) => item.id),
    );
    let changed = false;
    const joined: DocumentEntry[] = [...this.siblings(folderId)];
    this.items = this.items.map((entry) => {
      if (!docs.has(entry.id) || (entry.folderId ?? null) === folderId) {
        return entry;
      }
      changed = true;
      const moved = inFolder(entry, folderId, appendedManualKey(joined));
      joined.push(moved);
      return moved;
    });
    this.folders = this.folders.map((entry) => {
      if (!dirs.has(entry.id) || entry.parentId === folderId) return entry;
      changed = true;
      return { ...entry, parentId: folderId };
    });
    if (changed) this.publish("change");
    return { ok: true, from };
  }

  pin(id: string): void {
    const last = this.items.reduce(
      (max, item) =>
        item.pinKey === undefined
          ? max
          : Math.max(max, Number(item.pinKey.slice(1))),
      0,
    );
    const next = pinKeyAt(last + 1);
    this.updateDoc(id, (entry) =>
      entry.pinKey === undefined ? { ...entry, pinKey: next } : entry,
    );
  }

  unpin(id: string): void {
    this.updateDoc(id, (entry) => {
      if (entry.pinKey === undefined) return entry;
      const { pinKey: _pin, ...rest } = entry;
      return rest;
    });
  }

  movePin(id: string, toIndex: number): void {
    if (!this.writable()) return;
    const order = this.items
      .filter((item) => item.pinKey !== undefined)
      .sort((a, b) => ((a.pinKey ?? "") < (b.pinKey ?? "") ? -1 : 1))
      .map((item) => item.id);
    const from = order.indexOf(id);
    const to = Math.min(Math.max(toIndex, 0), order.length - 1);
    if (from < 0 || from === to) return;
    order.splice(to, 0, ...order.splice(from, 1));
    const keys = new Map(order.map((pinId, at) => [pinId, pinKeyAt(at + 1)]));
    this.items = this.items.map((item) => {
      const key = keys.get(item.id);
      return key === undefined ? item : { ...item, pinKey: key };
    });
    this.publish("change");
  }

  markOpened(id: string): void {
    this.updateDoc(id, (entry) => ({ ...entry, openedAt: Date.now() }));
  }

  async trashFolder(id: string): Promise<TrashedFolder | null> {
    await Promise.resolve();
    if (!this.writable()) return null;
    const root = this.folders.find((folder) => folder.id === id);
    if (!root) return null;
    const subtree = new Set([id]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const folder of this.folders) {
        if (
          folder.parentId !== null &&
          subtree.has(folder.parentId) &&
          !subtree.has(folder.id)
        ) {
          subtree.add(folder.id);
          grew = true;
        }
      }
    }
    const inside = (entry: DocumentEntry) =>
      entry.folderId != null && subtree.has(entry.folderId);
    const unit: FolderUnit = {
      folders: this.folders.filter((folder) => subtree.has(folder.id)),
      docs: this.items.filter(inside),
      trashedAt: this.trashTime(),
      trashGroup: crypto.randomUUID(),
    };
    this.folderUnits.set(id, unit);
    this.folders = this.folders.filter((folder) => !subtree.has(folder.id));
    this.items = this.items.filter((entry) => !inside(entry));
    this.publish("change");
    return {
      id,
      name: root.name,
      parentId: root.parentId,
      docCount: unit.docs.length,
      trashGroup: unit.trashGroup,
    };
  }

  async restoreFolder(id: string): Promise<FolderRestoreResult | null> {
    await Promise.resolve();
    if (!this.writable()) return null;
    const unit = this.folderUnits.get(id);
    if (!unit) return "gone";
    this.folderUnits.delete(id);
    const [root, ...rest] = unit.folders;
    const parentKept =
      root.parentId === null ||
      this.folders.some((folder) => folder.id === root.parentId);
    this.folders.push(parentKept ? root : { ...root, parentId: null }, ...rest);
    this.items.push(...unit.docs);
    this.publish("change");
    return parentKept ? "restored" : "restored_to_root";
  }

  setListView(place: string, prefs: Partial<ListViewPrefs>): void {
    if (!this.writable()) return;
    const clean = cleanListViewPrefs(prefs);
    if (Object.keys(clean).length === 0) return;
    this.listViews = {
      ...this.listViews,
      [place]: { ...this.listViews[place], ...clean },
    };
    this.publish("change");
  }

  moveInFolder(id: string, toIndex: number): void {
    if (!this.writable()) return;
    const entry = this.items.find((item) => item.id === id);
    if (!entry) return;
    const order = this.siblings(entry.folderId ?? null)
      .sort(compareManual)
      .map((item) => item.id);
    const from = order.indexOf(id);
    const to = Math.min(Math.max(toIndex, 0), order.length - 1);
    if (from === to) return;
    order.splice(to, 0, ...order.splice(from, 1));
    const keys = renumberManual(order);
    this.items = this.items.map((item) => {
      const key = keys.get(item.id);
      return key === undefined ? item : { ...item, sortKey: key };
    });
    this.publish("change");
  }

  createTag(name: string): TagEntry | null {
    if (!this.writable()) return null;
    const clean = cleanTagName(name);
    if (!clean) return null;
    const existing = findTagByName(this.tags, clean);
    if (existing) return existing;
    const tag: TagEntry = { id: crypto.randomUUID(), name: clean, color: null };
    this.tags.push(tag);
    this.publish("change");
    return tag;
  }

  addTag(docId: string, tagId: string): boolean {
    if (!this.writable() || !this.tags.some((tag) => tag.id === tagId)) {
      return false;
    }
    const entry = this.items.find((item) => item.id === docId);
    if (!entry) return false;
    const own = entry.tagIds ?? [];
    if (own.includes(tagId)) return true;
    if (own.length >= MAX_TAGS_PER_DOC) return false;
    this.updateDoc(docId, (doc) => ({ ...doc, tagIds: [...own, tagId] }));
    return true;
  }

  removeTag(docId: string, tagId: string): void {
    this.updateDoc(docId, (entry) => {
      if (!entry.tagIds?.includes(tagId)) return entry;
      return { ...entry, tagIds: entry.tagIds.filter((id) => id !== tagId) };
    });
  }

  renameTag(id: string, name: string): TagRenameResult {
    if (!this.writable()) return { ok: false, reason: "not_ready" };
    const at = this.tags.findIndex((tag) => tag.id === id);
    if (at < 0) return { ok: false, reason: "not_found" };
    const clean = cleanTagName(name);
    if (!clean) return { ok: false, reason: "invalid" };
    const taken = findTagByName(this.tags, clean);
    if (taken && taken.id !== id) {
      return { ok: false, reason: "exists", tagId: taken.id };
    }
    if (this.tags[at].name !== clean) {
      this.tags[at] = { ...this.tags[at], name: clean };
      this.publish("change");
    }
    return { ok: true };
  }

  mergeTags(fromId: string, intoId: string): boolean {
    if (!this.writable() || fromId === intoId) return false;
    const known = (tagId: string) => this.tags.some((tag) => tag.id === tagId);
    if (!known(fromId) || !known(intoId)) return false;
    this.tags = this.tags.filter((tag) => tag.id !== fromId);
    this.items = this.items.map((entry) => {
      if (!entry.tagIds?.includes(fromId)) return entry;
      const rest = entry.tagIds.filter((tagId) => tagId !== fromId);
      return {
        ...entry,
        tagIds: rest.includes(intoId) ? rest : [...rest, intoId],
      };
    });
    this.publish("change");
    return true;
  }

  /**
   * A second, loaded instance with this one's state, standing in for
   * "reopen over the same backend" in the contract's durability cases. It
   * shares nothing afterwards (there is no backend to share).
   */
  reopen(): MemoryDocumentIndex {
    const copy = new MemoryDocumentIndex({
      items: this.items,
      folders: this.folders,
      tags: this.tags,
    });
    copy.listViews = { ...this.listViews };
    for (const [id, trashed] of this.trashBin) copy.trashBin.set(id, trashed);
    for (const [id, unit] of this.folderUnits) copy.folderUnits.set(id, unit);
    copy.lastTrashedAt = this.lastTrashedAt;
    copy.load();
    return copy;
  }

  destroy(): void {
    this.destroyed = true;
    this.listeners.clear();
  }

  private trashTime(): number {
    this.lastTrashedAt = Math.max(Date.now(), this.lastTrashedAt + 1);
    return this.lastTrashedAt;
  }

  private siblings(folderId: string | null): DocumentEntry[] {
    return this.items.filter((item) => (item.folderId ?? null) === folderId);
  }

  private updateDoc(
    id: string,
    change: (entry: DocumentEntry) => DocumentEntry,
  ): void {
    if (!this.writable()) return;
    const at = this.items.findIndex((item) => item.id === id);
    if (at < 0) return;
    const next = change(this.items[at]);
    if (next === this.items[at]) return;
    this.items[at] = next;
    this.publish("change");
  }

  private writable(): boolean {
    return this.current.ready && !this.destroyed;
  }

  private trashCount(): number {
    let count = this.trashBin.size;
    for (const unit of this.folderUnits.values()) count += unit.docs.length;
    return count;
  }

  private trashList(): TrashedItem[] {
    const list: TrashedItem[] = [];
    for (const { entry, trashedAt } of this.trashBin.values()) {
      list.push({
        kind: "doc",
        id: entry.id,
        title: entry.title,
        trashedAt,
        folderId: entry.folderId ?? null,
      });
    }
    for (const [id, unit] of this.folderUnits) {
      const root = unit.folders[0];
      list.push({
        kind: "folder",
        id,
        name: root.name,
        trashedAt: unit.trashedAt,
        parentId: root.parentId,
        docCount: unit.docs.length,
        trashGroup: unit.trashGroup,
      });
    }
    return list.sort((a, b) => b.trashedAt - a.trashedAt);
  }

  private build(rev: number): LibraryIndexSnapshot {
    return {
      rev,
      ready: true,
      items: [...this.items],
      folders: [...this.folders],
      trashCount: this.trashCount(),
      tags: [...this.tags],
      listViews: this.listViews,
      trash: this.trashList(),
    };
  }

  private publish(type: "load" | "change"): void {
    this.current = this.build(this.current.rev + 1);
    const snapshot = this.current;
    for (const listener of [...this.listeners]) listener(type, snapshot);
  }
}
