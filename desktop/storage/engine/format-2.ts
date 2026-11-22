/**
 * Format 2 (offline data-model revision §3, P2.6d): one forward step that
 * rebuilds `folders`, `docs` and `tags`, and adds the relationship layer
 * (`links`, `doc_headings`) and the image-store tables (`blobs`,
 * `doc_blobs`). `updates` and `snapshots` hold the bytes and are never
 * rebuilt; the runner proves it (`migrations.ts`, the `updates` invariant).
 *
 * A fresh library is created as format 1 and runs this same step with no
 * rows, so a fresh file and a migrated one have identical `sqlite_master`
 * text by construction (SQLite stores a renamed table as `CREATE TABLE
 * "docs" (…)`).
 *
 * Rebuild order, per table: create `<t>_v2`, copy, drop `<t>`, rename
 * `<t>_v2` to `<t>`. Never rename the old table aside first: since SQLite
 * 3.26 a rename rewrites other tables' FK text to follow it.
 */
import { tagNameKey } from "@/lib/library/tag-rules";
import {
  NORMALIZER_VERSION,
  normalizeSearchText,
} from "@/lib/search/normalize";

import type { SqliteDriver } from "./driver";
import type { FormatStep, StepContext } from "./migrations";
import { writeMeta } from "./sql";

/** Folder nesting limit (`MAX_FOLDER_DEPTH`, `lib/library/folder-rules.ts`). */
export const MAX_FOLDER_DEPTH = 4;

const CREATE_V2 = `
CREATE TABLE folders_v2 (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES folders(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  sort_key TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  modified_at INTEGER NOT NULL,
  trashed_at INTEGER,
  trash_group TEXT,
  trashed_from TEXT REFERENCES folders(id) ON DELETE SET NULL,
  sort TEXT, view TEXT, "group" TEXT,
  CHECK (trashed_at IS NOT NULL OR (trash_group IS NULL AND trashed_from IS NULL)),
  CHECK (parent_id IS NULL OR parent_id <> id)
) STRICT;

CREATE TABLE docs_v2 (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  title_key TEXT NOT NULL DEFAULT '',
  folder_id TEXT REFERENCES folders(id) ON DELETE RESTRICT,
  sort_key TEXT NOT NULL DEFAULT '',
  pin_key TEXT,
  pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  created_at INTEGER NOT NULL,
  modified_at INTEGER NOT NULL,
  opened_at INTEGER,
  trashed_at INTEGER,
  trash_group TEXT,
  trashed_from TEXT REFERENCES folders(id) ON DELETE SET NULL,
  schema INTEGER NOT NULL DEFAULT 0,
  lineage TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  snippet TEXT NOT NULL DEFAULT '',
  mirrored_at INTEGER,
  link_key TEXT NOT NULL UNIQUE
    CHECK (length(link_key) = 32 AND link_key NOT GLOB '*[^0-9a-f]*'),
  kind TEXT NOT NULL DEFAULT 'doc' CHECK (kind IN ('doc', 'template')),
  head_seq INTEGER NOT NULL DEFAULT 0,
  derived_seq INTEGER,
  links_hash TEXT,
  headings_hash TEXT,
  CHECK (trashed_at IS NOT NULL OR (trash_group IS NULL AND trashed_from IS NULL))
) STRICT;

CREATE TABLE tags_v2 (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE,
  color TEXT,
  created_at INTEGER NOT NULL DEFAULT 0
) STRICT;
`;

const CREATE_NEW = `
CREATE TABLE links (
  src_doc_id TEXT NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL,
  src_toc_id TEXT NOT NULL DEFAULT '',
  target_key TEXT NOT NULL,
  target_toc_id TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL DEFAULT '',
  context TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (src_doc_id, ord)
) STRICT, WITHOUT ROWID;

CREATE TABLE doc_headings (
  doc_id TEXT NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL,
  toc_id TEXT NOT NULL,
  level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 6),
  text TEXT NOT NULL,
  text_key TEXT NOT NULL,
  PRIMARY KEY (doc_id, ord)
) STRICT, WITHOUT ROWID;

CREATE TABLE blobs (
  hash TEXT PRIMARY KEY CHECK (length(hash) = 64 AND hash NOT GLOB '*[^0-9a-f]*'),
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  created_at INTEGER NOT NULL,
  origin TEXT NOT NULL
) STRICT;

CREATE TABLE doc_blobs (
  doc_id TEXT NOT NULL,
  hash TEXT NOT NULL REFERENCES blobs(hash) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('provisional', 'current', 'version')),
  dropped_at INTEGER,
  PRIMARY KEY (doc_id, hash, kind)
) STRICT, WITHOUT ROWID;

ALTER TABLE import_sources ADD COLUMN root_id TEXT;
CREATE UNIQUE INDEX import_sources_root_path ON import_sources(root_id, relative_path)
  WHERE root_id IS NOT NULL;
`;

const INDEXES_AND_TRIGGERS = `
CREATE INDEX docs_folder_list ON docs(folder_id, trashed_at, opened_at);
CREATE INDEX docs_trashed ON docs(trashed_at) WHERE trashed_at IS NOT NULL;
CREATE INDEX docs_trash_group ON docs(trash_group) WHERE trash_group IS NOT NULL;
CREATE INDEX docs_trashed_from ON docs(trashed_from) WHERE trashed_from IS NOT NULL;
CREATE INDEX docs_stale ON docs(id) WHERE derived_seq IS NOT head_seq;
CREATE INDEX docs_title_key ON docs(title_key) WHERE trashed_at IS NULL;
CREATE INDEX folders_parent ON folders(parent_id);
CREATE INDEX folders_trashed_from ON folders(trashed_from) WHERE trashed_from IS NOT NULL;
CREATE INDEX folders_trash_group ON folders(trash_group) WHERE trash_group IS NOT NULL;
CREATE INDEX links_target ON links(target_key, src_doc_id);
CREATE INDEX doc_headings_toc ON doc_headings(doc_id, toc_id);
CREATE INDEX doc_headings_text ON doc_headings(text_key);
CREATE INDEX doc_blobs_hash ON doc_blobs(hash);

CREATE TRIGGER docs_identity_frozen BEFORE UPDATE OF link_key, lineage ON docs
WHEN NEW.link_key IS NOT OLD.link_key OR NEW.lineage IS NOT OLD.lineage
BEGIN SELECT RAISE(ABORT, 'identity is frozen'); END;

CREATE TRIGGER docs_head_seq_rises BEFORE UPDATE OF head_seq ON docs
WHEN NEW.head_seq < OLD.head_seq
BEGIN SELECT RAISE(ABORT, 'head_seq only rises'); END;

CREATE TRIGGER folders_no_cycle BEFORE UPDATE OF parent_id ON folders
WHEN NEW.parent_id IS NOT NULL AND EXISTS (
  WITH RECURSIVE up(id) AS (
    SELECT NEW.parent_id
    UNION SELECT f.parent_id FROM folders f JOIN up ON f.id = up.id WHERE f.parent_id IS NOT NULL)
  SELECT 1 FROM up WHERE id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'folder cycle'); END;
`;

/** The normalized title key (`docs.title_key`). */
export function titleKey(title: string): string {
  return normalizeSearchText(title);
}

const HEX32 = /^[0-9a-f]{32}$/;

/**
 * Read-only checks that block the step (§3.3): it never coerces a bad v1
 * row silently. Returns one line per problem; empty means go.
 */
export function preflightFormat2(db: SqliteDriver): string[] {
  const problems: string[] = [];
  const docs = db
    .prepare(
      "SELECT id, pinned, link_key, trashed_at, trash_group, trashed_from, folder_id FROM docs",
    )
    .all();
  const folders = db.prepare("SELECT id, parent_id FROM folders").all();
  const folderIds = new Set(folders.map((f) => String(f.id)));
  for (const doc of docs) {
    const id = String(doc.id);
    if (doc.pinned !== 0 && doc.pinned !== 1)
      problems.push(`doc ${id}: pinned is ${doc.pinned}`);
    if (typeof doc.link_key !== "string" || !HEX32.test(doc.link_key))
      problems.push(`doc ${id}: malformed link_key`);
    if (
      doc.trashed_at === null &&
      (doc.trash_group !== null || doc.trashed_from !== null)
    )
      problems.push(`doc ${id}: trash columns set without trashed_at`);
    for (const column of ["folder_id", "trashed_from"] as const) {
      const ref = doc[column];
      if (typeof ref === "string" && !folderIds.has(ref))
        problems.push(`doc ${id}: ${column} ${ref} is missing`);
    }
  }
  const parentOf = new Map<string, string | null>();
  for (const folder of folders) {
    const id = String(folder.id);
    const parent =
      typeof folder.parent_id === "string" ? folder.parent_id : null;
    parentOf.set(id, parent);
    if (parent !== null && !folderIds.has(parent))
      problems.push(`folder ${id}: parent_id ${parent} is missing`);
  }
  for (const start of parentOf.keys()) {
    const seen = new Set<string>();
    let at: string | null = start;
    while (at !== null && !seen.has(at)) {
      seen.add(at);
      at = parentOf.get(at) ?? null;
    }
    if (at === start) problems.push(`folder ${start}: in a folder cycle`);
  }
  for (const row of db.prepare("PRAGMA foreign_key_check").all())
    problems.push(`foreign_key_check: ${JSON.stringify(row)}`);
  return problems;
}

/** Merges v1 tags whose names share a `tagNameKey` (§3.3), into `tags_v2`. */
function copyTags(db: SqliteDriver, context: StepContext) {
  const tags = db
    .prepare(
      `SELECT t.id, t.name, t.color,
         (SELECT COUNT(*) FROM doc_tags dt WHERE dt.tag_id = t.id) AS docs
       FROM tags t ORDER BY t.id`,
    )
    .all();
  const byKey = new Map<string, typeof tags>();
  for (const tag of tags) {
    const key = tagNameKey(String(tag.name));
    byKey.set(key, [...(byKey.get(key) ?? []), tag]);
  }
  const insert = db.prepare(
    "INSERT INTO tags_v2 (id, name, name_key, color, created_at) VALUES (?, ?, ?, ?, 0)",
  );
  const moveRows = db.prepare(
    "INSERT OR IGNORE INTO doc_tags (doc_id, tag_id) SELECT doc_id, ? FROM doc_tags WHERE tag_id = ?",
  );
  const dropRows = db.prepare("DELETE FROM doc_tags WHERE tag_id = ?");
  for (const [key, group] of byKey) {
    // The tag with the most documents wins; ties go to the lowest id.
    const [keep, ...merged] = [...group].sort(
      (a, b) =>
        Number(b.docs) - Number(a.docs) ||
        String(a.id).localeCompare(String(b.id)),
    );
    if (!keep) continue;
    insert.run(String(keep.id), String(keep.name), key, keep.color ?? null);
    for (const tag of merged) {
      moveRows.run(String(keep.id), String(tag.id));
      dropRows.run(String(tag.id));
      context.log(`merged tag ${tag.id} into ${keep.id}`);
    }
  }
}

function upFormat2(db: SqliteDriver, context: StepContext) {
  db.exec(CREATE_V2);
  context.boundary("created v2 tables");
  db.exec(
    `INSERT INTO folders_v2 (id, parent_id, name, sort_key, created_at, modified_at,
       trashed_at, trash_group, trashed_from, sort, view, "group")
     SELECT id, parent_id, name, sort_key, created_at, modified_at,
       trashed_at, NULL, NULL, sort, view, "group" FROM folders`,
  );
  context.boundary("copied folders");
  // A document trashed alone keeps its folder only in trashed_from, so a
  // later purge of that folder isn't blocked by RESTRICT.
  db.exec(
    `INSERT INTO docs_v2 (id, title, title_key, folder_id, sort_key, pin_key, pinned,
       created_at, modified_at, opened_at, trashed_at, trash_group, trashed_from,
       schema, lineage, size_bytes, snippet, mirrored_at, link_key, kind,
       head_seq, derived_seq, links_hash, headings_hash)
     SELECT id, title, '', CASE WHEN trashed_at IS NULL THEN folder_id ELSE NULL END,
       sort_key, pin_key, pinned, created_at, modified_at, opened_at, trashed_at,
       trash_group, CASE WHEN trashed_at IS NULL THEN NULL
         ELSE COALESCE(trashed_from, folder_id) END,
       schema, lineage, size_bytes, snippet, mirrored_at, link_key, kind,
       MAX(COALESCE((SELECT MAX(seq) FROM updates u WHERE u.doc_id = docs.id), 0),
           COALESCE((SELECT upto_seq FROM snapshots s WHERE s.doc_id = docs.id), 0)),
       NULL, NULL, NULL
     FROM docs`,
  );
  const setKey = db.prepare("UPDATE docs_v2 SET title_key = ? WHERE id = ?");
  for (const row of db.prepare("SELECT id, title FROM docs_v2").all())
    setKey.run(titleKey(String(row.title)), String(row.id));
  context.boundary("copied docs");
  copyTags(db, context);
  context.boundary("copied tags");
  db.exec("DROP TABLE docs");
  db.exec("DROP TABLE folders");
  db.exec("DROP TABLE tags");
  context.boundary("dropped v1 tables");
  db.exec("ALTER TABLE folders_v2 RENAME TO folders");
  db.exec("ALTER TABLE docs_v2 RENAME TO docs");
  db.exec("ALTER TABLE tags_v2 RENAME TO tags");
  context.boundary("renamed v2 tables");
  db.exec(CREATE_NEW);
  db.exec(INDEXES_AND_TRIGGERS);
  writeMeta(db, "normalize_version", String(NORMALIZER_VERSION));
  writeMeta(db, "clean_opens_v2", "0");
  context.boundary("created relationship tables");
}

export const FORMAT_2_STEP: FormatStep = {
  to: 2,
  rebuild: true,
  preflight: preflightFormat2,
  up: upFormat2,
};

/** Every table of format 2, in the copy's explicit order (§3.4). */
export const TABLES_V2 = [
  "meta",
  "folders",
  "docs",
  "tags",
  "doc_tags",
  "doc_view",
  "import_sources",
  "snapshots",
  "updates",
  "links",
  "doc_headings",
  "blobs",
  "doc_blobs",
] as const;
