/**
 * The web library's IndexedDB schema: database `tinydocy-library`, version 1
 * (web library §2.2). The stores mirror the desktop tables
 * (`desktop/storage/engine/schema.ts`), so a row means the same thing on both
 * platforms and `.tinydoc` and `library.json` round-trip between them.
 *
 * Version 1 creates every store the library will need, including the seams
 * that later PRs fill (`remotes` for Live, `blobs` and `doc_blobs` for the
 * image store, W11): adding a store later is a version bump, and a version
 * bump makes every open tab of an older bundle reload (§2.4).
 *
 * Two details differ from the SQL tables, because IndexedDB leaves a record
 * out of an index when any part of its key is null:
 * - `docs.list_key` is `[folder_id ?? "", trashed_at ?? 0]`, so documents at
 *   the root and documents not in Trash are listed by `by_folder`.
 * - `folders.parent_key` is `parent_id ?? ""`, for `by_parent`.
 * The real columns keep their desktop meaning (null for root, null for not
 * trashed); only the index keys use the sentinels.
 */

export const LIBRARY_DB_NAME = "tinydocy-library";

/** The IndexedDB version: bumps only when stores or indexes change. */
export const LIBRARY_DB_VERSION = 1;

/**
 * `meta.format_version`: the row shapes this bundle reads and writes. A
 * library with a newer one is read-only here (`library_too_new`, §2.4).
 */
export const LIBRARY_FORMAT_VERSION = 1;

/** The Yjs update encoding of every stored update (`meta.yjs_encoding`). */
export const LIBRARY_YJS_ENCODING = "v1";

export const STORES = {
  meta: "meta",
  docs: "docs",
  snapshots: "snapshots",
  updates: "updates",
  folders: "folders",
  tags: "tags",
  docTags: "doc_tags",
  docView: "doc_view",
  md: "md",
  importSources: "import_sources",
  remotes: "remotes",
  blobs: "blobs",
  docBlobs: "doc_blobs",
} as const;

export type StoreName = (typeof STORES)[keyof typeof STORES];

/** Every store version 1 creates; the schema test checks the database against it. */
export const STORE_NAMES_V1: readonly StoreName[] = Object.values(STORES);

/** A `meta` row. */
export type MetaRow = { key: string; value: unknown };

/** The meta keys version 1 writes at creation. */
export const META_KEYS = {
  formatVersion: "format_version",
  libraryId: "library_id",
  yjsEncoding: "yjs_encoding",
  createdAt: "created_at",
  /** The index change counter (the `DocumentIndex` rev feed). */
  rev: "rev",
} as const;

/** A `docs` row: the desktop `docs` table plus the index sentinel `list_key`. */
export type DocRow = {
  id: string;
  title: string;
  folder_id: string | null;
  sort_key: string;
  pin_key: string | null;
  pinned: boolean;
  created_at: number;
  modified_at: number;
  opened_at: number | null;
  trashed_at: number | null;
  trash_group: string | null;
  trashed_from: string | null;
  schema: number;
  lineage: string;
  size_bytes: number;
  snippet: string;
  exported_at: number | null;
  md_at: number | null;
  /** 32 lowercase hex characters, unique, minted at insert (v8 seam S16). */
  link_key: string;
  kind: "doc" | "template";
  /** `[folder_id ?? "", trashed_at ?? 0]`, for `by_folder`. */
  list_key: [string, number];
};

/**
 * A `snapshots` row. `rev` changes on every write, so a session can tell
 * whether the stored snapshot is the one it last loaded or wrote (§2.5).
 * `upto_seq` is the highest seq any compaction claimed to cover, so `load`
 * can report `maxSeq` after every row was folded in.
 */
export type SnapshotRow = {
  doc_id: string;
  data: Uint8Array;
  rev: string;
  upto_seq: number;
};

/** An `updates` row. `seq` comes from the key generator, which only increases. */
export type UpdateRow = {
  seq: number;
  doc_id: string;
  data: Uint8Array;
  origin: string;
  created_at: number;
  /** The tab session that appended it (for diagnostics; never read for correctness). */
  writer: string;
};

/** The index key of `docs.by_folder`. */
export function listKey(
  folderId: string | null,
  trashedAt: number | null,
): [string, number] {
  return [folderId ?? "", trashedAt ?? 0];
}

/**
 * Creates every version 1 store. Runs inside `onupgradeneeded`, whose
 * transaction IndexedDB commits atomically, so a failed upgrade leaves the
 * old database untouched.
 */
export function upgradeLibrary(
  db: IDBDatabase,
  oldVersion: number,
  libraryId: string,
  now: number,
): void {
  if (oldVersion < 1) {
    const meta = db.createObjectStore(STORES.meta, { keyPath: "key" });

    const docs = db.createObjectStore(STORES.docs, { keyPath: "id" });
    docs.createIndex("by_folder", "list_key");
    docs.createIndex("by_opened", "opened_at");
    docs.createIndex("by_modified", "modified_at");
    docs.createIndex("by_link_key", "link_key", { unique: true });

    db.createObjectStore(STORES.snapshots, { keyPath: "doc_id" });

    const updates = db.createObjectStore(STORES.updates, {
      keyPath: "seq",
      autoIncrement: true,
    });
    updates.createIndex("by_doc", ["doc_id", "seq"]);

    const folders = db.createObjectStore(STORES.folders, { keyPath: "id" });
    folders.createIndex("by_parent", "parent_key");

    const tags = db.createObjectStore(STORES.tags, { keyPath: "id" });
    tags.createIndex("by_name_key", "name_key", { unique: true });

    const docTags = db.createObjectStore(STORES.docTags, {
      keyPath: ["doc_id", "tag_id"],
    });
    docTags.createIndex("by_tag", "tag_id");

    db.createObjectStore(STORES.docView, { keyPath: "doc_id" });
    db.createObjectStore(STORES.md, { keyPath: "doc_id" });

    const importSources = db.createObjectStore(STORES.importSources, {
      keyPath: "doc_id",
    });
    importSources.createIndex("by_source_hash", "source_hash");

    const remotes = db.createObjectStore(STORES.remotes, {
      keyPath: "doc_id",
    });
    remotes.createIndex("by_share", "share_id");

    // The image store design §3.3 fixes these two shapes.
    db.createObjectStore(STORES.blobs, { keyPath: "hash" });
    const docBlobs = db.createObjectStore(STORES.docBlobs, {
      keyPath: ["docId", "hash", "kind"],
    });
    docBlobs.createIndex("by_hash", "hash");

    const rows: MetaRow[] = [
      { key: META_KEYS.formatVersion, value: LIBRARY_FORMAT_VERSION },
      { key: META_KEYS.libraryId, value: libraryId },
      { key: META_KEYS.yjsEncoding, value: LIBRARY_YJS_ENCODING },
      { key: META_KEYS.createdAt, value: now },
      { key: META_KEYS.rev, value: 0 },
    ];
    for (const row of rows) meta.put(row);
  }
  // Later versions add steps here, each guarded by `oldVersion < N`.
}
