/**
 * The library schema at `format_version` 1 (desktop architecture §5.3), the
 * starting point every library is created from.
 *
 * Everything the Local release needs is created here, so no later migration
 * is needed for it: `tags`, `doc_tags` and `doc_view` (D7, D10), the details
 * spec §6.3 list columns, and the v7/v8 seams `docs.link_key` (NOT NULL,
 * minted at insert), `docs.kind` and `import_sources`. `blobs` and
 * `doc_blobs` arrive with P2.6b, and the Live release adds `remotes` and
 * `versions`; each comes with a `format_version` step.
 *
 * `updates.seq` is `AUTOINCREMENT`, so a seq is never reused after
 * compaction deletes the newest rows: a reused seq at or below a snapshot's
 * `upto_seq` would be skipped on load.
 */
/**
 * The format this build writes. Format 2 (`format-2.ts`) is reached from
 * format 1 by one rebuild step; a new library is created as format 1 and
 * runs it, so `SCHEMA_V1` stays the starting point.
 */
export const FORMAT_VERSION = 2;

/** The Yjs update encoding of every stored BLOB (`meta.yjs_encoding`). */
export const YJS_ENCODING = "v1";

export const SCHEMA_V1 = `
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  parent_id TEXT,
  name TEXT NOT NULL,
  sort_key TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  modified_at INTEGER NOT NULL,
  trashed_at INTEGER,
  sort TEXT,
  view TEXT,
  "group" TEXT
) STRICT;

CREATE TABLE docs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  folder_id TEXT,
  sort_key TEXT NOT NULL DEFAULT '',
  pin_key TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  modified_at INTEGER NOT NULL,
  opened_at INTEGER,
  trashed_at INTEGER,
  trash_group TEXT,
  trashed_from TEXT,
  schema INTEGER NOT NULL DEFAULT 0,
  lineage TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  snippet TEXT NOT NULL DEFAULT '',
  mirrored_at INTEGER,
  link_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'doc' CHECK (kind IN ('doc', 'template'))
) STRICT;

CREATE TABLE import_sources (
  doc_id TEXT PRIMARY KEY REFERENCES docs(id) ON DELETE CASCADE,
  relative_path TEXT,
  source_app TEXT,
  source_hash TEXT,
  imported_at INTEGER
) STRICT;

CREATE TABLE snapshots (
  doc_id TEXT PRIMARY KEY REFERENCES docs(id) ON DELETE CASCADE,
  data BLOB NOT NULL,
  upto_seq INTEGER NOT NULL
) STRICT;

CREATE TABLE updates (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id TEXT NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  data BLOB NOT NULL,
  origin TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  color TEXT
) STRICT;

CREATE TABLE doc_tags (
  doc_id TEXT NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (doc_id, tag_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE doc_view (
  doc_id TEXT PRIMARY KEY REFERENCES docs(id) ON DELETE CASCADE,
  width TEXT CHECK (width IS NULL OR width IN ('narrow', 'standard', 'wide', 'full')),
  place TEXT,
  remote_images INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE INDEX updates_doc_seq ON updates(doc_id, seq);
CREATE INDEX docs_folder_list ON docs(folder_id, trashed_at, opened_at);
CREATE INDEX folders_parent ON folders(parent_id);
CREATE INDEX doc_tags_tag ON doc_tags(tag_id);
CREATE INDEX import_sources_hash ON import_sources(source_hash);
`;

/** Every table format 1 creates; the schema test checks the file against it. */
export const TABLES_V1 = [
  "doc_tags",
  "doc_view",
  "docs",
  "folders",
  "import_sources",
  "meta",
  "snapshots",
  "tags",
  "updates",
] as const;
