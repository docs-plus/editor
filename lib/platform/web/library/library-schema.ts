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
 * It also takes the desktop's format 2 shape (offline data-model revision
 * §3.2, §3.6): the derived `links` and `headings` stores, the `docs`
 * staleness and search columns, folder trash groups, and snake_case
 * `doc_blobs`.
 *
 * IndexedDB keys can't be null or boolean: a record whose index key has
 * such a part is left out of that index, and such a primary key throws
 * `DataError`. So every nullable key part is `''` (`NO_KEY`):
 * - `docs.list_key` is `[folder_id ?? '', trashed_at ?? '']`, so documents
 *   at the root and documents not in Trash are listed by `by_folder`.
 * - `folders.parent_key` is `parent_id ?? ''`, for `by_parent`.
 * - `docs.stale` is a number, `1` or `0`, for `by_stale`.
 * - `links.src_toc_id` and `target_toc_id` are `''` before the first
 *   heading or for a whole-document link, as on desktop.
 * The real columns keep their desktop meaning (null for root, null for not
 * trashed); only the index keys use the sentinels. One index has no
 * sentinel on purpose: `by_opened` lists only documents with `opened_at`
 * (Recent). Creating or importing a document sets it; a row with
 * `opened_at` null is left out.
 *
 * Versions (§3.6):
 * - {@link LIBRARY_DB_VERSION} bumps only when stores or indexes change.
 * - {@link LIBRARY_FORMAT_VERSION} bumps when row shapes change.
 * - Before any step that rewrites rows, a forced copy of the whole library
 *   goes to `tinydocy-library.pre-v<n>` ({@link preMigrationCopyName}), the
 *   web twin of desktop's `VACUUM INTO`. The copy can't be taken inside
 *   `onupgradeneeded`: its transaction commits as soon as the task awaits
 *   anything but IndexedDB. So it is taken at the old version, before the
 *   open at the new one.
 */

export const LIBRARY_DB_NAME = "tinydocy-library";

/** The IndexedDB version: bumps only when stores or indexes change. */
export const LIBRARY_DB_VERSION = 1;

/**
 * `meta.format_version`: the row shapes this bundle reads and writes. A
 * library with a newer one is read-only here (`library_too_new`, §2.4).
 */
export const LIBRARY_FORMAT_VERSION = 1;

/**
 * The name of the forced copy taken before a format step from `fromFormat`
 * rewrites rows (offline data-model revision §3.6).
 */
export function preMigrationCopyName(fromFormat: number): string {
  return `${LIBRARY_DB_NAME}.pre-v${fromFormat}`;
}

/** The index key part that stands for null (IndexedDB keys can't be null). */
export const NO_KEY = "";

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
  links: "links",
  headings: "headings",
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
  /**
   * Eviction detection (§3.6, W6): the `library_id` again, written once at
   * creation. With the `localStorage` marker (`eviction.ts`) it tells a
   * library the browser cleared from one that never existed.
   */
  evictionSentinel: "eviction_sentinel",
} as const;

/**
 * A `docs` row: the desktop `docs` table (format 2) plus the index
 * sentinels `list_key` and `stale`.
 */
export type DocRow = {
  id: string;
  title: string;
  /** `normalizeSearchText(title)` (`lib/search/normalize.ts`). */
  title_key: string;
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
  /** The highest seq ever written to the document; only rises. */
  head_seq: number;
  /** The `head_seq` the derived rows reflect; null means never derived. */
  derived_seq: number | null;
  /** Computed by the writer over the canonical rows (§4.3), per side. */
  links_hash: string | null;
  headings_hash: string | null;
  /** `1` when `derived_seq !== head_seq`, else `0`, for `by_stale`. */
  stale: 0 | 1;
  /** `[folder_id ?? '', trashed_at ?? '']`, for `by_folder`. */
  list_key: [string, number | typeof NO_KEY];
};

/** A `folders` row: the desktop `folders` table plus `parent_key`. */
export type FolderRow = {
  id: string;
  parent_id: string | null;
  name: string;
  sort_key: string;
  created_at: number;
  modified_at: number;
  trashed_at: number | null;
  /** One id per trashed subtree (§4.2 `trashFolder`). */
  trash_group: string | null;
  /** The parent at trash time; null after that folder is purged. */
  trashed_from: string | null;
  sort: string | null;
  view: string | null;
  group: string | null;
  /** `parent_id ?? ''`, for `by_parent`. */
  parent_key: string;
};

/** A `links` row (derived, rebuildable; §3.2 `links`). */
export type LinkRow = {
  src_doc_id: string;
  /** The index in `extractLinks()` output. */
  ord: number;
  /** `''` before the first heading. */
  src_toc_id: string;
  /** A `link_key`; deliberately not checked against `docs` (§4.6). */
  target_key: string;
  /** `''` for a link to the whole document. */
  target_toc_id: string;
  text: string;
  context: string;
};

/** A `headings` row (derived, rebuildable; §3.2 `doc_headings`). */
export type HeadingRow = {
  doc_id: string;
  ord: number;
  toc_id: string;
  level: number;
  text: string;
  /** `normalizeSearchText(text)`. */
  text_key: string;
};

/** A `doc_blobs` row (§3.2; snake_case, as on desktop). */
export type DocBlobRow = {
  doc_id: string;
  hash: string;
  kind: "provisional" | "current" | "version";
  dropped_at: number | null;
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
): DocRow["list_key"] {
  return [folderId ?? NO_KEY, trashedAt ?? NO_KEY];
}

/** The `docs.stale` sentinel for `by_stale`. */
export function staleFlag(headSeq: number, derivedSeq: number | null): 0 | 1 {
  return derivedSeq === headSeq ? 0 : 1;
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
    docs.createIndex("by_stale", "stale");

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

    // The image store tables (offline data-model revision §3.2).
    db.createObjectStore(STORES.blobs, { keyPath: "hash" });
    const docBlobs = db.createObjectStore(STORES.docBlobs, {
      keyPath: ["doc_id", "hash", "kind"],
    });
    docBlobs.createIndex("by_hash", "hash");

    // The relationship layer: derived, rebuildable (§3.2, §4).
    const links = db.createObjectStore(STORES.links, {
      keyPath: ["src_doc_id", "ord"],
    });
    links.createIndex("by_target", ["target_key", "src_doc_id"]);
    const headings = db.createObjectStore(STORES.headings, {
      keyPath: ["doc_id", "ord"],
    });
    headings.createIndex("by_toc", ["doc_id", "toc_id"]);
    headings.createIndex("by_text_key", "text_key");

    const rows: MetaRow[] = [
      { key: META_KEYS.formatVersion, value: LIBRARY_FORMAT_VERSION },
      { key: META_KEYS.libraryId, value: libraryId },
      { key: META_KEYS.yjsEncoding, value: LIBRARY_YJS_ENCODING },
      { key: META_KEYS.createdAt, value: now },
      { key: META_KEYS.rev, value: 0 },
      { key: META_KEYS.evictionSentinel, value: libraryId },
    ];
    for (const row of rows) meta.put(row);
  }
  // Later versions add steps here, each guarded by `oldVersion < N`.
}
