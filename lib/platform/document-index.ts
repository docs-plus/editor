/**
 * `DocumentIndex`: the list of documents and their metadata, apart from
 * their content (`DocStore`) and their open editing session (`DocSession`).
 *
 * Implementations:
 * - web sandbox: `GlobalTabsIndex` (`lib/platform/web/global-tabs-index.ts`),
 *   the shared `global-tabs` Y.Doc;
 * - web library (W2): `IdbDocumentIndex`, IndexedDB with a rev feed over
 *   BroadcastChannel;
 * - desktop: `IpcDocumentIndex`, the SQLite `docs` and `folders` tables;
 * - tests: `MemoryDocumentIndex` (`tests/helpers/memory-document-index.ts`).
 *
 * Contract (`tests/unit/platform/document-index-contract.ts`):
 * - `snapshot()` returns the same object until something changes, and `rev`
 *   grows with every change, so it suits `useSyncExternalStore`.
 * - Before `ready` the list is empty and every mutation is refused.
 * - `create`, `rename` and `move` apply to the snapshot before they return
 *   and notify subscribers synchronously; an index whose storage is remote
 *   (IPC, IndexedDB) applies them optimistically and persists them later.
 * - `trash` and `restore` may need a server answer, so they are async.
 * - Listeners may run inside the backing store's transaction (Yjs observers):
 *   they must not write back to the index synchronously.
 *
 * Which document is active is per-window state, never in the index.
 * Folders and pins (P2.7a), and tags, list preferences, Manual order and
 * the Trash list (P2.7b) are the `LibraryIndex` extension below; purge and
 * the large-library search fallback join with P2.8 and SR1.
 */

/** One document in the index. */
export interface DocumentEntry {
  readonly id: string;
  readonly title: string;
  readonly createdAt: number;
  /** `LibraryIndex` only: its folder; absent or null at the Library root. */
  readonly folderId?: string | null;
  /**
   * `LibraryIndex` only: set while pinned. Pinned documents sort by this
   * key (string order); it carries no other meaning.
   */
  readonly pinKey?: string;
  /** `LibraryIndex` only: when it was last opened, if ever. */
  readonly openedAt?: number;
  /**
   * `LibraryIndex` only: the last content change (`docs.modified_at`). Only
   * content edits change it (title included, since the title is the first
   * heading); moves, pins, tags and opening don't (owner decision D-O5).
   */
  readonly modifiedAt?: number;
  /**
   * `LibraryIndex` only: the start of the body as plain text, sent by the
   * renderer with each save like the title (`docs.snippet`, details §6.3).
   */
  readonly snippet?: string;
  /** `LibraryIndex` only: its tags (`doc_tags`), in no particular order. */
  readonly tagIds?: readonly string[];
  /**
   * `LibraryIndex` only: its place in its folder's Manual order
   * (`docs.sort_key`, string order). Absent: after the keyed ones, oldest
   * first (`compareManual` in `lib/library/list-rows.ts`).
   */
  readonly sortKey?: string;
}

export interface DocumentIndexSnapshot {
  /** Grows by at least one with every change and every (re)load. */
  readonly rev: number;
  /** False until the first load; the list is empty until then. */
  readonly ready: boolean;
  /** In display order. */
  readonly items: readonly DocumentEntry[];
}

/**
 * - `load`: the index (re)loaded from its source of truth (first load,
 *   reconnect, a missed rev); per-window state should be re-resolved.
 * - `change`: an entry was added, removed, renamed or moved, here or
 *   elsewhere.
 */
export type DocumentIndexEventType = "load" | "change";

export type DocumentIndexListener = (
  type: DocumentIndexEventType,
  snapshot: DocumentIndexSnapshot,
) => void;

/**
 * A document to bring back from the Trash. `index` is the position it was
 * trashed from (an implementation-defined hint, from `TrashResult`);
 * without one it is appended.
 */
export type RestorableEntry = { id: string; title: string; index?: number };

export interface TrashResult {
  /** Trashed and removed from the list, in the order asked. */
  readonly trashed: RestorableEntry[];
  /** Ids that could not be trashed; they stay listed. */
  readonly failed: string[];
}

/**
 * - `restored`: it was in the Trash and is live again.
 * - `not_closed`: it was already live (restored elsewhere first, or an
 *   earlier answer was lost).
 * - `gone`: it can no longer be restored.
 *
 * `restored` and `not_closed` both leave the document listed.
 */
export type RestoreResult = "restored" | "not_closed" | "gone";

export interface DocumentIndex {
  snapshot(): DocumentIndexSnapshot;
  /** Returns the unsubscribe function. */
  subscribe(listener: DocumentIndexListener): () => void;
  /** Lists a new, empty document; null when refused (not ready, full). */
  create(init?: { title?: string }): DocumentEntry | null;
  /**
   * Sets the title. On a `LibraryIndex` this edits the document's title
   * heading through a session (the open window's, or a headless one for a
   * closed document) and never writes the stored title column, which then
   * follows from the next save: the title has one writer (offline
   * data-model revision §4.2, gap G4). The web sandbox's tab list writes
   * its own title directly.
   */
  rename(id: string, title: string): void;
  /** Moves `id` to position `toIndex` of `snapshot().items`. */
  move(id: string, toIndex: number): void;
  /** Moves documents to the Trash; each one leaves the list once it is there. */
  trash(ids: readonly string[]): Promise<TrashResult>;
  /**
   * Brings documents back and lists the ones that are live again, at their
   * old position when known; null when the answer never arrived.
   */
  restore(
    entries: readonly RestorableEntry[],
  ): Promise<Record<string, RestoreResult> | null>;
  /** Stops listening to the store; later mutations are ignored. */
  destroy(): void;
}

/** A folder in a `LibraryIndex`. */
export interface FolderEntry {
  readonly id: string;
  readonly name: string;
  /** Null at the Library root. */
  readonly parentId: string | null;
  readonly createdAt: number;
}

/** A tag (`tags`, D7). Tags stay on this computer, never in the Y.Doc. */
export interface TagEntry {
  readonly id: string;
  /** Unique by `tagNameKey` (`lib/library/tag-rules.ts`). */
  readonly name: string;
  /** One of the 8 fixed colours (P2.9b); null: none. */
  readonly color: string | null;
}

/** What a list is sorted by (details §6.3). */
export type ListSortField =
  | "title"
  | "modified"
  | "created"
  | "opened"
  | "manual";

/**
 * A list's saved choices (details §6.3): per folder in `folders.sort`,
 * `view` and `"group"`; for the places with no folder row (the Library
 * root, Recent, Pinned, a tag) in the engine's `meta`. Unset fields take
 * the place's defaults (`lib/library/list-view.ts`).
 */
export interface ListViewPrefs {
  readonly sort: ListSortField;
  readonly descending: boolean;
  /** List: one line per document. Preview: the title plus a 2-line snippet. */
  readonly view: "list" | "preview";
  /** By folder: only in lists that span folders (Recent, Pinned, a tag). */
  readonly group: "none" | "date" | "folder";
}

/**
 * Something in the Trash, for the Trash list (`trashed_at`, `trash_group`,
 * `trashed_from`). A folder is one unit with everything that went with it.
 */
export type TrashedItem =
  | {
      readonly kind: "doc";
      readonly id: string;
      readonly title: string;
      readonly trashedAt: number;
      /** The folder it was in; null at the root. */
      readonly folderId: string | null;
    }
  | {
      readonly kind: "folder";
      readonly id: string;
      readonly name: string;
      readonly trashedAt: number;
      readonly parentId: string | null;
      readonly docCount: number;
      /** The subtree's one `trash_group` (`TrashedFolder.trashGroup`). */
      readonly trashGroup: string;
    };

export interface LibraryIndexSnapshot extends DocumentIndexSnapshot {
  /** Live folders (not in the Trash), in no particular order. */
  readonly folders: readonly FolderEntry[];
  /** Documents in the Trash, counted alone or inside trashed folders. */
  readonly trashCount: number;
  /** In no particular order. */
  readonly tags: readonly TagEntry[];
  /**
   * Saved list choices by place key (`listPlaceKey`: `library`, `recent`,
   * `pinned`, `trash`, `folder:<id>`, `tag:<id>`). Only what was set.
   */
  readonly listViews: Readonly<Record<string, Partial<ListViewPrefs>>>;
  /**
   * What the Trash list shows: documents trashed alone and trashed folders
   * (their documents are inside them), newest first.
   */
  readonly trash: readonly TrashedItem[];
}

export type LibraryIndexListener = (
  type: DocumentIndexEventType,
  snapshot: LibraryIndexSnapshot,
) => void;

/** A document or a folder, for operations that take both. */
export type LibraryItemRef =
  | { readonly kind: "doc"; readonly id: string }
  | { readonly kind: "folder"; readonly id: string };

/**
 * Why a move was refused; nothing moved.
 * - `into_itself`: a folder would go inside itself or one of its folders.
 * - `too_deep`: folders would nest deeper than `MAX_FOLDER_DEPTH`.
 * - `not_found`: an item or the destination isn't listed.
 * - `not_ready`: the index isn't loaded, or is destroyed.
 */
export type MoveRefusal =
  | "into_itself"
  | "too_deep"
  | "not_found"
  | "not_ready";

export type MoveResult =
  | {
      readonly ok: true;
      /** Each moved item's folder before the move ("doc:id" / "folder:id"). */
      readonly from: Readonly<Record<string, string | null>>;
    }
  | { readonly ok: false; readonly reason: MoveRefusal };

/** A folder brought to the Trash with everything in it. */
export interface TrashedFolder {
  readonly id: string;
  readonly name: string;
  /** Where it was (`trashed_from`); restore falls back to the root. */
  readonly parentId: string | null;
  /** Documents that went with it, at any depth. */
  readonly docCount: number;
  /**
   * One new `trash_group` shared by the folder, its live subfolders and
   * their documents; restoring the folder restores exactly that group.
   * Items trashed earlier on their own keep their own group.
   */
  readonly trashGroup: string;
}

/**
 * - `restored`: back where it was.
 * - `restored_to_root`: its parent folder is gone, so it is at the root.
 * - `gone`: it can no longer be restored.
 */
export type FolderRestoreResult = "restored" | "restored_to_root" | "gone";

/**
 * - `exists`: another tag has that name (`tagNameKey`); nothing changed.
 *   The caller may offer to merge into `tagId` (details §3).
 * - `invalid`: the name is empty once cleaned.
 * - `not_found`, `not_ready`: as for moves.
 */
export type TagRenameResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "exists"; readonly tagId: string }
  | {
      readonly ok: false;
      readonly reason: "invalid" | "not_found" | "not_ready";
    };

/**
 * The document library (desktop and the web library, D3): a `DocumentIndex`
 * with folders and pins. The web sandbox's `GlobalTabsIndex` is not one;
 * the library components take only a `LibraryIndex`.
 *
 * Contract additions (`describeLibraryIndexContract`):
 * - Folder and pin operations apply to the snapshot before they return and
 *   notify synchronously, like `rename`.
 * - `moveItems` moves all the items or none, and refuses a folder into its
 *   own subtree or deeper than `MAX_FOLDER_DEPTH` levels
 *   (`lib/library/folder-rules.ts`).
 * - A trashed folder takes its subfolders and documents with it; they leave
 *   `items` and `folders` and count in `trashCount`.
 * - `restore` brings a document back to its folder, or to the root when
 *   that folder is gone or in the Trash. `restoreFolder` does the same
 *   for a folder, and brings back its whole `trash_group` and nothing else.
 * - Tag names are unique by `tagNameKey`, at most `TAG_NAME_MAX` characters,
 *   and a document has at most `MAX_TAGS_PER_DOC` tags
 *   (`lib/library/tag-rules.ts`; the engine checks the same key, not only
 *   `COLLATE NOCASE`, which folds ASCII alone).
 * - Tag, list-preference and Manual-order operations apply to the snapshot
 *   before they return and notify synchronously.
 */
export interface LibraryIndex extends DocumentIndex {
  snapshot(): LibraryIndexSnapshot;
  subscribe(listener: LibraryIndexListener): () => void;
  /** Lists a new document in `folderId` (the root when absent or null). */
  create(init?: {
    title?: string;
    folderId?: string | null;
  }): DocumentEntry | null;
  /**
   * Null when refused: not ready, unknown parent, or too deep. Sibling
   * folders may share a name (owner decision D-O6): no operation refuses
   * a folder name.
   */
  createFolder(init: {
    name: string;
    parentId?: string | null;
  }): FolderEntry | null;
  renameFolder(id: string, name: string): void;
  /** Moves documents and folders into `folderId` (null: the root). */
  moveItems(
    items: readonly LibraryItemRef[],
    folderId: string | null,
  ): MoveResult;
  /** Pins at the end of the pinned list; no-op if pinned. */
  pin(id: string): void;
  unpin(id: string): void;
  /** Moves a pinned document to `toIndex` among the pinned ones. */
  movePin(id: string, toIndex: number): void;
  /** Stamps `openedAt` (the store does this when a document loads). */
  markOpened(id: string): void;
  trashFolder(id: string): Promise<TrashedFolder | null>;
  restoreFolder(id: string): Promise<FolderRestoreResult | null>;
  /**
   * Saves list choices for a place (`listPlaceKey`), merged into what was
   * saved. Desktop: a folder's go to its `folders` row, the rest to `meta`.
   */
  setListView(place: string, prefs: Partial<ListViewPrefs>): void;
  /**
   * Moves a document to `toIndex` in its folder's Manual order
   * (`docs.sort_key`); the tree keeps sorting by title.
   */
  moveInFolder(id: string, toIndex: number): void;
  /**
   * The tag with this name, created when none has it (`tagNameKey`); null
   * when the cleaned name is empty or the index isn't ready.
   */
  createTag(name: string): TagEntry | null;
  /** False when refused: unknown, or the document has `MAX_TAGS_PER_DOC`. */
  addTag(docId: string, tagId: string): boolean;
  removeTag(docId: string, tagId: string): void;
  /** Renames everywhere at once; refuses a name another tag has. */
  renameTag(id: string, name: string): TagRenameResult;
  /**
   * Gives every document tagged `fromId` the tag `intoId` and deletes
   * `fromId`; false when either is unknown or they are the same.
   */
  mergeTags(fromId: string, intoId: string): boolean;
}
