import {
  canCreateFolderIn,
  checkMove,
  indexFolders,
} from "@/lib/library/folder-rules";
import type {
  DocumentEntry,
  FolderEntry,
  FolderRestoreResult,
  LibraryIndex,
  LibraryIndexListener,
  LibraryIndexSnapshot,
  LibraryItemRef,
  MoveResult,
  RestorableEntry,
  RestoreResult,
  TrashedFolder,
  TrashResult,
} from "@/lib/platform/document-index";

export interface MemoryDocumentIndexOptions {
  /** Listed at the start. */
  items?: readonly DocumentEntry[];
  /** Folders at the start (`LibraryIndex`). */
  folders?: readonly FolderEntry[];
  /** Start not ready; `load()` makes it ready. */
  deferLoad?: boolean;
  /** Ids `trash` refuses. */
  failTrash?: readonly string[];
}

/** A folder in the Trash with the subtree and documents that went with it. */
interface FolderUnit {
  readonly folders: FolderEntry[];
  readonly docs: DocumentEntry[];
}

const NAME_CAP = 200;

function cleanName(name: string): string {
  return name.trim().slice(0, NAME_CAP);
}

/** The entry with `folderId` set, or dropped at the root. */
function inFolder(
  entry: DocumentEntry,
  folderId: string | null,
): DocumentEntry {
  const { folderId: _old, ...rest } = entry;
  return folderId === null ? rest : { ...rest, folderId };
}

/** 128 random bits as 32 lowercase hex, like the engine's `link_key`. */
function newLinkKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
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
  private readonly trashBin = new Map<string, DocumentEntry>();
  private readonly folderUnits = new Map<string, FolderUnit>();
  private readonly failTrash: ReadonlySet<string>;
  private items: DocumentEntry[];
  private folders: FolderEntry[];
  private current: LibraryIndexSnapshot;
  private destroyed = false;

  constructor(options: MemoryDocumentIndexOptions = {}) {
    this.items = [...(options.items ?? [])];
    this.folders = [...(options.folders ?? [])];
    this.failTrash = new Set(options.failTrash);
    this.current = options.deferLoad
      ? { rev: 0, ready: false, items: [], folders: [], trashCount: 0 }
      : {
          rev: 1,
          ready: true,
          items: [...this.items],
          folders: [...this.folders],
          trashCount: 0,
        };
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
    const entry = inFolder(
      {
        id: crypto.randomUUID(),
        title: init?.title ?? "Untitled",
        createdAt: Date.now(),
        linkKey: newLinkKey(),
      },
      folderId,
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
    for (const item of this.items) {
      if (gone.has(item.id)) this.trashBin.set(item.id, item);
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
      const folderId = trashed.folderId ?? null;
      const home = this.folders.some((f) => f.id === folderId)
        ? folderId
        : null;
      const at = Math.min(entry.index ?? this.items.length, this.items.length);
      this.items.splice(at, 0, inFolder(trashed, home));
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
    this.items = this.items.map((entry) => {
      if (!docs.has(entry.id) || (entry.folderId ?? null) === folderId) {
        return entry;
      }
      changed = true;
      return inFolder(entry, folderId);
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

  destroy(): void {
    this.destroyed = true;
    this.listeners.clear();
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

  private trashedEntries(): DocumentEntry[] {
    const entries = [...this.trashBin.values()];
    for (const unit of this.folderUnits.values()) entries.push(...unit.docs);
    return entries;
  }

  private publish(type: "load" | "change"): void {
    const trashed = this.trashedEntries();
    this.current = {
      rev: this.current.rev + 1,
      ready: true,
      items: [...this.items],
      folders: [...this.folders],
      trashCount: trashed.length,
      trashed,
    };
    const snapshot = this.current;
    for (const listener of [...this.listeners]) listener(type, snapshot);
  }
}
