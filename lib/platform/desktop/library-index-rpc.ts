/**
 * The desktop `LibraryIndex` (P2.7b's port, P2.6e): the SQLite library in
 * the storage worker, over request/reply calls. The renderer (P2.5) passes a
 * `call` that goes through `window.tinydocy`; tests and the dev host pass one
 * that dispatches to a `Library` in-process; the Electron soak passes one
 * that goes to a `StorageClient`. It follows `rpc-doc-store.ts`.
 *
 * **Snapshot.** It loads `sidebar`, `trashList` and `placeViews` into a
 * snapshot. Each port operation applies to the snapshot synchronously, as
 * the port requires, then persists through `call` on one serial chain, so
 * a pin and its keys, or a move and its Manual keys, never interleave with
 * anything else. Operations not yet persisted stay in `pending`; whenever
 * the snapshot is rebuilt from storage (a failed write, the Trash
 * operations, another window's change) they are applied again on top, so
 * an optimistic change never flickers. A failed write is reported to
 * `onError` and the snapshot reloads from storage.
 *
 * **Ids.** Documents, folders and tags get their ids here, so `create`,
 * `createFolder` and `createTag` can answer at once; the engine keeps the
 * caller's id (`createTag` answers the existing tag when the name is taken).
 *
 * **Change feed.** {@link RpcLibraryIndex.indexChanged} takes the worker's
 * `index_changed` (`{ rev, changes }`). Changes at or below the highest rev
 * this index's own writes returned are its own and skipped; anything else
 * reloads the whole snapshot, once per burst. Patching by `changes` comes
 * later; at 10,000 documents a reload costs one sidebar read (T21).
 *
 * **Title (G4).** The engine has no title rename: the title has one writer,
 * the content (offline data-model revision §4.2). `rename` applies the title
 * to the snapshot and calls the injected `renameTitle`, which the
 * composition root (P2.5 / LK4a) implements by editing the title heading
 * through a session (the open window's, or a headless one). The stored
 * title follows from that session's next append.
 *
 * **Not stored.** `move` (a library has no global order; every list sorts
 * itself) does nothing. A folder's `createdAt` comes from the sidebar; one
 * created here shows `Date.now()` until the next reload.
 */
import type { StorageOps } from "@/desktop/storage/protocol";
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
import {
  cleanListViewPrefs,
  decodeListViewColumns,
  encodeListViewColumns,
} from "@/lib/library/list-view";
import {
  cleanTagName,
  findTagByName,
  MAX_TAGS_PER_DOC,
} from "@/lib/library/tag-rules";
import type {
  DocumentEntry,
  DocumentIndexEventType,
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

/** The storage ops this index sends. */
export type LibraryOp =
  | "sidebar"
  | "trashList"
  | "placeViews"
  | "createDoc"
  | "createFolder"
  | "renameFolder"
  | "setFolderView"
  | "moveItems"
  | "trashFolder"
  | "restoreFolder"
  | "purgeFolder"
  | "trashDoc"
  | "restoreDoc"
  | "purgeDoc"
  | "markOpened"
  | "createTag"
  | "renameTag"
  | "mergeTags"
  | "addTag"
  | "removeTag"
  | "pinDoc"
  | "unpinDoc"
  | "setPinKeys"
  | "setSortKeys"
  | "setPlaceView"
  | "snippets"
  | "searchTitles"
  | "searchHeadings"
  | "flush";

export type LibraryCall = <K extends LibraryOp>(
  op: K,
  args: StorageOps[K]["args"],
) => Promise<StorageOps[K]["result"]>;

/** What a (re)load reads from storage. */
export interface LibraryLoad {
  readonly sidebar: StorageOps["sidebar"]["result"];
  readonly trash: StorageOps["trashList"]["result"];
  readonly placeViews: StorageOps["placeViews"]["result"];
}

export async function fetchLibraryLoad(
  call: LibraryCall,
): Promise<LibraryLoad> {
  const sidebar = await call("sidebar", {});
  const trash = await call("trashList", {});
  const placeViews = await call("placeViews", {});
  return { sidebar, trash, placeViews };
}

export interface RpcLibraryIndexOptions {
  call: LibraryCall;
  /**
   * Edits the document's title heading through a session (G4). Resolves
   * once the edit is applied; the stored title follows from its append.
   */
  renameTitle(id: string, title: string): Promise<void>;
  /** A load already read: the index is ready at once. */
  initial?: LibraryLoad;
  /** A write that storage refused, or a reload that failed. */
  onError?(error: unknown, op: string): void;
}

interface State {
  readonly docs: readonly DocumentEntry[];
  readonly folders: readonly FolderEntry[];
  readonly tags: readonly TagEntry[];
  readonly listViews: Readonly<Record<string, Partial<ListViewPrefs>>>;
  readonly trash: readonly TrashedItem[];
  readonly trashCount: number;
  /** Documents in the Trash, alone or in a folder, with their link keys. */
  readonly trashed: readonly DocumentEntry[];
}

/** A change to a state; returns the same object when nothing changes. */
type Apply = (state: State) => State;

const EMPTY: State = {
  docs: [],
  folders: [],
  tags: [],
  listViews: {},
  trash: [],
  trashCount: 0,
  trashed: [],
};

const NAME_CAP = 200;

/** A `link_key`: 32 lowercase hex, as the engine mints it (format 2). */
function newLinkKey(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function cleanName(name: string): string {
  return name.trim().slice(0, NAME_CAP);
}

/**
 * Pin keys: `p` and a 6-digit position, as `MemoryDocumentIndex` makes
 * them. They only order the pinned list (string order).
 */
function pinKeyAt(position: number): string {
  return `p${String(position).padStart(6, "0")}`;
}

function pinPosition(key: string | undefined): number {
  const match = key ? /^p(\d+)$/.exec(key) : null;
  return match ? Number(match[1]) : 0;
}

/** The entry with `folderId` and `sortKey` set, or dropped when absent. */
function placed(
  entry: DocumentEntry,
  folderId: string | null,
  sortKey: string | undefined,
): DocumentEntry {
  const { folderId: _folder, sortKey: _key, ...rest } = entry;
  return {
    ...rest,
    ...(folderId === null ? {} : { folderId }),
    ...(sortKey ? { sortKey } : {}),
  };
}

function toEntry(row: LibraryLoad["sidebar"]["docs"][number]): DocumentEntry {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.createdAt,
    modifiedAt: row.modifiedAt,
    linkKey: row.linkKey,
    ...(row.folderId === null ? {} : { folderId: row.folderId }),
    ...(row.pinned && row.pinKey !== null ? { pinKey: row.pinKey } : {}),
    ...(row.openedAt === null ? {} : { openedAt: row.openedAt }),
    ...(row.sortKey ? { sortKey: row.sortKey } : {}),
    ...(row.tagIds.length > 0 ? { tagIds: [...row.tagIds] } : {}),
  };
}

function parseView(json: string): Partial<ListViewPrefs> {
  try {
    const value: unknown = JSON.parse(json);
    return value && typeof value === "object"
      ? cleanListViewPrefs(value as Partial<ListViewPrefs>)
      : {};
  } catch {
    return {};
  }
}

/** The snapshot state a load describes. Templates aren't listed. */
export function stateFromLoad(load: LibraryLoad): State {
  const listViews: Record<string, Partial<ListViewPrefs>> = {};
  for (const [place, json] of Object.entries(load.placeViews)) {
    const view = parseView(json);
    if (Object.keys(view).length > 0) listViews[place] = view;
  }
  const folders = load.sidebar.folders.map((row): FolderEntry => {
    const view = decodeListViewColumns(row);
    if (Object.keys(view).length > 0) listViews[`folder:${row.id}`] = view;
    return {
      id: row.id,
      name: row.name,
      parentId: row.parentId,
      createdAt: row.createdAt,
    };
  });
  return {
    docs: load.sidebar.docs.filter((row) => row.kind === "doc").map(toEntry),
    folders,
    tags: load.sidebar.tags.map((tag) => ({ ...tag })),
    listViews,
    trash: load.trash.items.map((item) => ({ ...item })),
    trashCount: load.trash.docCount,
    trashed: load.trash.trashed.map((doc) => ({ ...doc })),
  };
}

function siblings(state: State, folderId: string | null): DocumentEntry[] {
  return state.docs.filter((doc) => (doc.folderId ?? null) === folderId);
}

function updateDoc(
  state: State,
  id: string,
  change: (entry: DocumentEntry) => DocumentEntry,
): State {
  const at = state.docs.findIndex((doc) => doc.id === id);
  if (at < 0) return state;
  const next = change(state.docs[at]);
  if (next === state.docs[at]) return state;
  const docs = [...state.docs];
  docs[at] = next;
  return { ...state, docs };
}

/** Sets each listed document's key in `field`; "" or undefined drops it. */
function setKeys(
  state: State,
  field: "pinKey" | "sortKey",
  keys: ReadonlyMap<string, string | undefined>,
): State {
  let changed = false;
  const docs = state.docs.map((doc) => {
    if (!keys.has(doc.id)) return doc;
    const key = keys.get(doc.id);
    if (doc[field] === (key || undefined)) return doc;
    changed = true;
    const { [field]: _old, ...rest } = doc;
    return key ? { ...rest, [field]: key } : rest;
  });
  return changed ? { ...state, docs } : state;
}

/** The value a storage write returns, as a rev it accounts for. */
function revOf(value: unknown): number {
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && "rev" in value) {
    const rev = (value as { rev: unknown }).rev;
    if (typeof rev === "number") return rev;
  }
  return 0;
}

function codeOf(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}

/** A write storage refused although the snapshot allowed it. */
class RefusedError extends Error {
  readonly code = "refused";
}

export class RpcLibraryIndex implements LibraryIndex {
  private readonly listeners = new Set<LibraryIndexListener>();
  private readonly options: RpcLibraryIndexOptions;
  /** What storage holds, as far as this index knows. */
  private confirmed: State = EMPTY;
  /** `confirmed` with `pending` applied: what the snapshot shows. */
  private view: State = EMPTY;
  /** Applied to the snapshot, not yet persisted, in order. */
  private pending: Apply[] = [];
  private current: LibraryIndexSnapshot;
  private ready = false;
  private destroyed = false;
  private chain: Promise<void> = Promise.resolve();
  /** The highest rev this index's own calls returned. */
  private ownRev = 0;
  private reloadQueued = false;

  constructor(options: RpcLibraryIndexOptions) {
    this.options = options;
    this.current = this.build(0);
    if (options.initial) this.hydrate(options.initial);
  }

  // ── Loading and the change feed ─────────────────────────────────────

  /** Reads the library and makes the index ready (or reloads it). */
  async load(): Promise<void> {
    await this.run(() => this.reload("load"));
  }

  /** Applies a load read elsewhere: ready at once, emits `load`. */
  hydrate(load: LibraryLoad): void {
    if (this.destroyed) return;
    this.ownRev = Math.max(this.ownRev, load.sidebar.rev);
    this.confirmed = stateFromLoad(load);
    this.ready = true;
    this.rebuild("load");
  }

  /** The worker's `index_changed`: reloads unless the change is this index's. */
  indexChanged(rev: number, _changes: readonly unknown[] = []): void {
    if (!this.ready || this.destroyed || rev <= this.ownRev) return;
    if (this.reloadQueued) return;
    this.reloadQueued = true;
    void this.run(async () => {
      this.reloadQueued = false;
      await this.reload("change");
    });
  }

  /** Resolves once every accepted write is persisted and flushed. */
  async settle(): Promise<void> {
    await this.chain;
    await this.options.call("flush", {});
  }

  // ── Reads that go to storage ────────────────────────────────────────

  /** Snippets for the rows a Preview list shows (fetched lazily, §3.5). */
  snippets(ids: readonly string[]): Promise<Record<string, string>> {
    return this.options.call("snippets", { ids: [...ids] });
  }

  /** Quick Open's fallback above 5,000 documents (§5.2). */
  searchTitles(query: string) {
    return this.options.call("searchTitles", { query });
  }

  /** Cross-document heading matches, Quick Open's second group (§5.2). */
  searchHeadings(query: string) {
    return this.options.call("searchHeadings", { query });
  }

  // ── DocumentIndex ───────────────────────────────────────────────────

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
    if (folderId !== null && !this.view.folders.some((f) => f.id === folderId))
      return null;
    const now = Date.now();
    const sortKey = appendedManualKey(siblings(this.view, folderId));
    const entry = placed(
      {
        id: crypto.randomUUID(),
        title: init?.title ?? "Untitled",
        createdAt: now,
        modifiedAt: now,
        linkKey: newLinkKey(),
      },
      folderId,
      sortKey,
    );
    this.commit(
      (state) => ({ ...state, docs: [...state.docs, entry] }),
      "createDoc",
      () =>
        this.options.call("createDoc", {
          id: entry.id,
          linkKey: entry.linkKey,
          title: entry.title,
          folderId,
          sortKey: sortKey ?? "",
        }),
    );
    return entry;
  }

  rename(id: string, title: string): void {
    this.mutate(
      (state) =>
        updateDoc(state, id, (doc) =>
          doc.title === title ? doc : { ...doc, title },
        ),
      "rename",
      () => this.options.renameTitle(id, title),
    );
  }

  /** A library has no global order (every list sorts itself): nothing. */
  move(_id: string, _toIndex: number): void {}

  async trash(ids: readonly string[]): Promise<TrashResult> {
    if (!this.writable()) return { trashed: [], failed: [...ids] };
    return this.run(async () => {
      const trashed: RestorableEntry[] = [];
      const failed: string[] = [];
      for (const id of ids) {
        const index = this.view.docs.findIndex((doc) => doc.id === id);
        if (index < 0) {
          failed.push(id);
          continue;
        }
        const { title } = this.view.docs[index];
        try {
          await this.send("trashDoc", { id });
          trashed.push({ id, title, index });
        } catch (error) {
          this.report(error, "trashDoc");
          failed.push(id);
        }
      }
      if (trashed.length > 0) await this.reload("change");
      return { trashed, failed };
    });
  }

  async restore(
    entries: readonly RestorableEntry[],
  ): Promise<Record<string, RestoreResult> | null> {
    if (!this.writable() || entries.length === 0) return null;
    return this.run(async () => {
      const results: Record<string, RestoreResult> = {};
      let changed = false;
      for (const entry of entries) {
        if (this.view.docs.some((doc) => doc.id === entry.id)) {
          results[entry.id] = "not_closed";
          continue;
        }
        const trashed = this.view.trash.find(
          (item) => item.kind === "doc" && item.id === entry.id,
        );
        try {
          const { folderId } = await this.send("restoreDoc", { id: entry.id });
          changed = true;
          results[entry.id] = "restored";
          // Back at the root because its folder is gone: last in Manual order.
          const from = trashed?.kind === "doc" ? trashed.folderId : null;
          if (folderId !== from) {
            const key = appendedManualKey(siblings(this.confirmed, folderId));
            await this.send("setSortKeys", {
              keys: [{ id: entry.id, key: key ?? "" }],
            });
          }
        } catch (error) {
          if (codeOf(error) === "not_found") results[entry.id] = "gone";
          else {
            this.report(error, "restoreDoc");
            if (changed) await this.reload("change");
            return null;
          }
        }
      }
      if (changed) await this.reload("change");
      return results;
    });
  }

  destroy(): void {
    this.destroyed = true;
    this.listeners.clear();
  }

  // ── Folders ─────────────────────────────────────────────────────────

  createFolder(init: {
    name: string;
    parentId?: string | null;
  }): FolderEntry | null {
    if (!this.writable()) return null;
    const name = cleanName(init.name);
    const parentId = init.parentId ?? null;
    if (!name || !canCreateFolderIn(indexFolders(this.view.folders), parentId))
      return null;
    const folder: FolderEntry = {
      id: crypto.randomUUID(),
      name,
      parentId,
      createdAt: Date.now(),
    };
    this.commit(
      (state) => ({ ...state, folders: [...state.folders, folder] }),
      "createFolder",
      async () => {
        const created = await this.options.call("createFolder", {
          id: folder.id,
          name,
          parentId,
        });
        if (created?.id !== folder.id) throw new RefusedError("createFolder");
        return created;
      },
    );
    return folder;
  }

  renameFolder(id: string, name: string): void {
    const clean = cleanName(name);
    if (!clean) return;
    this.mutate(
      (state) => {
        const at = state.folders.findIndex((folder) => folder.id === id);
        if (at < 0 || state.folders[at].name === clean) return state;
        const folders = [...state.folders];
        folders[at] = { ...folders[at], name: clean };
        return { ...state, folders };
      },
      "renameFolder",
      () => this.options.call("renameFolder", { id, name: clean }),
    );
  }

  moveItems(
    items: readonly LibraryItemRef[],
    folderId: string | null,
  ): MoveResult {
    if (!this.writable()) return { ok: false, reason: "not_ready" };
    const state = this.view;
    const refusal = checkMove(indexFolders(state.folders), items, folderId);
    if (refusal) return { ok: false, reason: refusal };
    const from: Record<string, string | null> = {};
    const docIds = new Set<string>();
    const folderIds = new Set<string>();
    for (const item of items) {
      if (item.kind === "doc") {
        const doc = state.docs.find((entry) => entry.id === item.id);
        if (!doc) return { ok: false, reason: "not_found" };
        from[`doc:${item.id}`] = doc.folderId ?? null;
        if ((doc.folderId ?? null) !== folderId) docIds.add(item.id);
      } else {
        const folder = state.folders.find((entry) => entry.id === item.id);
        if (!folder) return { ok: false, reason: "not_found" };
        from[`folder:${item.id}`] = folder.parentId;
        if (folder.parentId !== folderId) folderIds.add(item.id);
      }
    }
    if (docIds.size === 0 && folderIds.size === 0) return { ok: true, from };
    // Documents that join a folder go last in its Manual order.
    const joined = siblings(state, folderId);
    const keys = new Map<string, string | undefined>();
    for (const doc of state.docs) {
      if (!docIds.has(doc.id)) continue;
      const key = appendedManualKey(joined);
      keys.set(doc.id, key);
      joined.push(placed(doc, folderId, key));
    }
    const moved: LibraryItemRef[] = [
      ...[...docIds].map((id) => ({ kind: "doc" as const, id })),
      ...[...folderIds].map((id) => ({ kind: "folder" as const, id })),
    ];
    this.commit(
      (base) => {
        let changed = false;
        const docs = base.docs.map((doc) => {
          if (!keys.has(doc.id)) return doc;
          changed = true;
          return placed(doc, folderId, keys.get(doc.id));
        });
        const folders = base.folders.map((folder) => {
          if (!folderIds.has(folder.id) || folder.parentId === folderId)
            return folder;
          changed = true;
          return { ...folder, parentId: folderId };
        });
        return changed ? { ...base, docs, folders } : base;
      },
      "moveItems",
      async () => {
        const result = await this.options.call("moveItems", {
          items: moved,
          folderId,
        });
        if (!result.ok) throw new RefusedError(`moveItems: ${result.reason}`);
        this.ownRev = Math.max(this.ownRev, result.rev);
        if (keys.size > 0)
          return this.options.call("setSortKeys", {
            keys: [...keys].map(([id, key]) => ({ id, key: key ?? "" })),
          });
        return result;
      },
    );
    return { ok: true, from };
  }

  async trashFolder(id: string): Promise<TrashedFolder | null> {
    if (!this.writable()) return null;
    return this.run(async () => {
      const folder = this.view.folders.find((entry) => entry.id === id);
      if (!folder) return null;
      try {
        const result = await this.send("trashFolder", { id });
        await this.reload("change");
        return {
          id,
          name: folder.name,
          parentId: result.parentId,
          docCount: result.docCount,
          trashGroup: result.trashGroup,
        };
      } catch (error) {
        this.report(error, "trashFolder");
        await this.reload("load");
        return null;
      }
    });
  }

  async restoreFolder(id: string): Promise<FolderRestoreResult | null> {
    if (!this.writable()) return null;
    return this.run(async () => {
      try {
        const { result } = await this.send("restoreFolder", { id });
        await this.reload("change");
        return result;
      } catch (error) {
        if (codeOf(error) === "not_found") return "gone";
        this.report(error, "restoreFolder");
        return null;
      }
    });
  }

  /**
   * Empties the Trash: deletes every trashed document and folder forever.
   * Ahead of P2.8's purge in the port; the contract's `purge` uses it.
   */
  purgeTrash(): void {
    const items = this.view.trash;
    this.mutate(
      (state) =>
        state.trash.length === 0 && state.trashCount === 0
          ? state
          : { ...state, trash: [], trashCount: 0, trashed: [] },
      "purgeTrash",
      async () => {
        for (const item of items) {
          if (item.kind === "folder")
            await this.send("purgeFolder", { id: item.id });
          else await this.send("purgeDoc", { id: item.id });
        }
      },
    );
  }

  // ── Pins, opening, list choices, Manual order ───────────────────────

  pin(id: string): void {
    const doc = this.view.docs.find((entry) => entry.id === id);
    if (!doc || doc.pinKey !== undefined) return;
    const last = Math.max(
      0,
      ...this.view.docs.map((entry) => pinPosition(entry.pinKey)),
    );
    const pinKey = pinKeyAt(last + 1);
    this.mutate(
      (state) => setKeys(state, "pinKey", new Map([[id, pinKey]])),
      "pinDoc",
      () => this.options.call("pinDoc", { id, pinKey }),
    );
  }

  unpin(id: string): void {
    this.mutate(
      (state) => setKeys(state, "pinKey", new Map([[id, undefined]])),
      "unpinDoc",
      () => this.options.call("unpinDoc", { id }),
    );
  }

  movePin(id: string, toIndex: number): void {
    const order = this.view.docs
      .filter((doc) => doc.pinKey !== undefined)
      .sort((a, b) => ((a.pinKey ?? "") < (b.pinKey ?? "") ? -1 : 1))
      .map((doc) => doc.id);
    const from = order.indexOf(id);
    const to = Math.min(Math.max(toIndex, 0), order.length - 1);
    if (from < 0 || from === to) return;
    order.splice(to, 0, ...order.splice(from, 1));
    const keys = new Map(order.map((pinId, at) => [pinId, pinKeyAt(at + 1)]));
    this.mutate(
      (state) => setKeys(state, "pinKey", keys),
      "setPinKeys",
      () =>
        this.options.call("setPinKeys", {
          keys: [...keys].map(([docId, key]) => ({ id: docId, key })),
        }),
    );
  }

  markOpened(id: string): void {
    const openedAt = Date.now();
    this.mutate(
      (state) => updateDoc(state, id, (doc) => ({ ...doc, openedAt })),
      "markOpened",
      () => this.options.call("markOpened", { id }),
    );
  }

  setListView(place: string, prefs: Partial<ListViewPrefs>): void {
    const clean = cleanListViewPrefs(prefs);
    if (Object.keys(clean).length === 0) return;
    const merged = { ...this.view.listViews[place], ...clean };
    const folderId = place.startsWith("folder:")
      ? place.slice("folder:".length)
      : null;
    if (folderId !== null) {
      if (!this.view.folders.some((folder) => folder.id === folderId)) return;
      // What the folder's columns hold, so a reload shows the same.
      const columns = encodeListViewColumns(merged);
      const stored = decodeListViewColumns(columns);
      this.mutate(
        (state) => withListView(state, place, stored),
        "setFolderView",
        () => this.options.call("setFolderView", { id: folderId, columns }),
      );
      return;
    }
    this.mutate(
      (state) => withListView(state, place, merged),
      "setPlaceView",
      () =>
        this.options.call("setPlaceView", {
          place,
          json: JSON.stringify(merged),
        }),
    );
  }

  moveInFolder(id: string, toIndex: number): void {
    const entry = this.view.docs.find((doc) => doc.id === id);
    if (!entry) return;
    const order = siblings(this.view, entry.folderId ?? null)
      .sort(compareManual)
      .map((doc) => doc.id);
    const from = order.indexOf(id);
    const to = Math.min(Math.max(toIndex, 0), order.length - 1);
    if (from === to) return;
    order.splice(to, 0, ...order.splice(from, 1));
    const keys = renumberManual(order);
    this.mutate(
      (state) => setKeys(state, "sortKey", keys),
      "setSortKeys",
      () =>
        this.options.call("setSortKeys", {
          keys: [...keys].map(([docId, key]) => ({ id: docId, key })),
        }),
    );
  }

  // ── Tags ────────────────────────────────────────────────────────────

  createTag(name: string): TagEntry | null {
    if (!this.writable()) return null;
    const clean = cleanTagName(name);
    if (!clean) return null;
    const existing = findTagByName(this.view.tags, clean);
    if (existing) return existing;
    const tag: TagEntry = { id: crypto.randomUUID(), name: clean, color: null };
    this.commit(
      (state) => ({ ...state, tags: [...state.tags, tag] }),
      "createTag",
      async () => {
        const created = await this.options.call("createTag", {
          name: clean,
          id: tag.id,
        });
        // Another window took the name first: storage has its tag.
        if (created?.id !== tag.id) throw new RefusedError("createTag");
        return created;
      },
    );
    return tag;
  }

  addTag(docId: string, tagId: string): boolean {
    if (!this.writable() || !this.view.tags.some((tag) => tag.id === tagId))
      return false;
    const doc = this.view.docs.find((entry) => entry.id === docId);
    if (!doc) return false;
    const own = doc.tagIds ?? [];
    if (own.includes(tagId)) return true;
    if (own.length >= MAX_TAGS_PER_DOC) return false;
    this.mutate(
      (state) =>
        updateDoc(state, docId, (entry) =>
          entry.tagIds?.includes(tagId)
            ? entry
            : { ...entry, tagIds: [...(entry.tagIds ?? []), tagId] },
        ),
      "addTag",
      async () => {
        const rev = await this.options.call("addTag", { docId, tagId });
        if (rev === false) throw new RefusedError("addTag");
        return rev;
      },
    );
    return true;
  }

  removeTag(docId: string, tagId: string): void {
    this.mutate(
      (state) =>
        updateDoc(state, docId, (entry) => {
          if (!entry.tagIds?.includes(tagId)) return entry;
          const rest = entry.tagIds.filter((id) => id !== tagId);
          const { tagIds: _old, ...base } = entry;
          return rest.length > 0 ? { ...base, tagIds: rest } : base;
        }),
      "removeTag",
      () => this.options.call("removeTag", { docId, tagId }),
    );
  }

  renameTag(id: string, name: string): TagRenameResult {
    if (!this.writable()) return { ok: false, reason: "not_ready" };
    const at = this.view.tags.findIndex((tag) => tag.id === id);
    if (at < 0) return { ok: false, reason: "not_found" };
    const clean = cleanTagName(name);
    if (!clean) return { ok: false, reason: "invalid" };
    const taken = findTagByName(this.view.tags, clean);
    if (taken && taken.id !== id)
      return { ok: false, reason: "exists", tagId: taken.id };
    this.mutate(
      (state) => {
        const index = state.tags.findIndex((tag) => tag.id === id);
        if (index < 0 || state.tags[index].name === clean) return state;
        const tags = [...state.tags];
        tags[index] = { ...tags[index], name: clean };
        return { ...state, tags };
      },
      "renameTag",
      async () => {
        const result = await this.options.call("renameTag", {
          id,
          name: clean,
        });
        if (!result.ok) throw new RefusedError(`renameTag: ${result.reason}`);
        return result;
      },
    );
    return { ok: true };
  }

  mergeTags(fromId: string, intoId: string): boolean {
    if (!this.writable() || fromId === intoId) return false;
    const known = (tagId: string) =>
      this.view.tags.some((tag) => tag.id === tagId);
    if (!known(fromId) || !known(intoId)) return false;
    this.mutate(
      (state) => {
        if (!state.tags.some((tag) => tag.id === fromId)) return state;
        return {
          ...state,
          tags: state.tags.filter((tag) => tag.id !== fromId),
          docs: state.docs.map((doc) => {
            if (!doc.tagIds?.includes(fromId)) return doc;
            const rest = doc.tagIds.filter((tagId) => tagId !== fromId);
            return {
              ...doc,
              tagIds: rest.includes(intoId) ? rest : [...rest, intoId],
            };
          }),
        };
      },
      "mergeTags",
      async () => {
        const rev = await this.options.call("mergeTags", { fromId, intoId });
        if (rev === false) throw new RefusedError("mergeTags");
        return rev;
      },
    );
    return true;
  }

  // ── Internals ───────────────────────────────────────────────────────

  private writable(): boolean {
    return this.ready && !this.destroyed;
  }

  /** Runs `task` after everything already queued; failures don't break the chain. */
  private run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.chain.then(task);
    this.chain = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  /** One storage call; its rev counts as this index's own. */
  private async send<K extends LibraryOp>(
    op: K,
    args: StorageOps[K]["args"],
  ): Promise<StorageOps[K]["result"]> {
    const result = await this.options.call(op, args);
    this.ownRev = Math.max(this.ownRev, revOf(result));
    return result;
  }

  private report(error: unknown, op: string): void {
    this.options.onError?.(error, op);
  }

  /** {@link commit} when `apply` changes the snapshot and the index is writable. */
  private mutate(
    apply: Apply,
    op: string,
    persist: () => Promise<unknown>,
  ): void {
    if (!this.writable() || apply(this.view) === this.view) return;
    this.commit(apply, op, persist);
  }

  /**
   * Applies `apply` to the snapshot now, notifies, and persists it on the
   * chain. Success folds it into `confirmed`; a refusal reloads.
   */
  private commit(
    apply: Apply,
    op: string,
    persist: () => Promise<unknown>,
  ): void {
    this.pending.push(apply);
    this.view = apply(this.view);
    this.publish("change");
    void this.run(async () => {
      let failed = false;
      try {
        this.ownRev = Math.max(this.ownRev, revOf(await persist()));
        this.confirmed = apply(this.confirmed);
      } catch (error) {
        failed = true;
        this.report(error, op);
      } finally {
        this.pending.splice(this.pending.indexOf(apply), 1);
      }
      if (failed) await this.reload("load");
    });
  }

  /** Reads storage into `confirmed` and rebuilds the snapshot; on the chain. */
  private async reload(type: DocumentIndexEventType): Promise<void> {
    if (this.destroyed) return;
    try {
      const load = await fetchLibraryLoad((op, args) => this.send(op, args));
      if (this.destroyed) return;
      this.confirmed = stateFromLoad(load);
      this.ready = true;
    } catch (error) {
      this.report(error, "reload");
      if (!this.ready) return;
    }
    this.rebuild(type);
  }

  private rebuild(type: DocumentIndexEventType): void {
    this.view = this.pending.reduce(
      (state, apply) => apply(state),
      this.confirmed,
    );
    this.publish(type);
  }

  private build(rev: number): LibraryIndexSnapshot {
    const { view } = this;
    return {
      rev,
      ready: this.ready,
      items: view.docs,
      folders: view.folders,
      trashCount: view.trashCount,
      tags: view.tags,
      listViews: view.listViews,
      trash: view.trash,
      trashed: view.trashed,
    };
  }

  private publish(type: DocumentIndexEventType): void {
    if (this.destroyed) return;
    this.current = this.build(this.current.rev + 1);
    const snapshot = this.current;
    for (const listener of [...this.listeners]) listener(type, snapshot);
  }
}

function withListView(
  state: State,
  place: string,
  prefs: Partial<ListViewPrefs>,
): State {
  const saved = state.listViews[place];
  if (saved && JSON.stringify(saved) === JSON.stringify(prefs)) return state;
  const listViews = { ...state.listViews };
  if (Object.keys(prefs).length === 0) delete listViews[place];
  else listViews[place] = prefs;
  return { ...state, listViews };
}
