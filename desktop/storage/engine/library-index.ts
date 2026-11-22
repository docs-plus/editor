/**
 * The library's metadata: documents, folders and tags (architecture §5.4
 * `index.ts`; named `library-index.ts` so it isn't taken for a barrel).
 * `IpcDocumentIndex` (P2.3's `DocumentIndex` port) sits on top of these
 * operations; the row shapes here are the storage side and stay neutral.
 *
 * Every metadata write goes through this module (seam S10) and bumps
 * `meta.rev` in the same transaction, so the change feed can say "changed
 * since rev N". Inserting a document mints its `lineage` and `link_key`
 * (seam S16): never lazily, so two synced devices can't mint different keys.
 */
import type { SqliteDriver, SqlRow } from "./driver";
import { StorageError } from "./errors";
import { bumpRev, randomHex32, readRev, scalar, transaction } from "./sql";

export type DocKind = "doc" | "template";

export type CreateDocInput = {
  /**
   * Minted (a UUID) when omitted. Main's IPC guard only lets UUIDs through;
   * the engine accepts any {@link SAFE_ID}, which tests and imports use.
   */
  id?: string;
  /** `docs.schema`: `DOC_SCHEMA` for a new document, the file's on import. */
  schema?: number;
  title?: string;
  folderId?: string | null;
  sortKey?: string;
  kind?: DocKind;
  /** Kept only by a backup restore (S8c); everything else gets a new one. */
  lineage?: string;
  /** Kept only by a backup zip or `library.json` restore (S8c). */
  linkKey?: string;
};

export type CreatedDoc = {
  id: string;
  lineage: string;
  linkKey: string;
  rev: number;
};

export type SidebarFolder = {
  id: string;
  parentId: string | null;
  name: string;
  sortKey: string;
  sort: string | null;
  view: string | null;
  group: string | null;
};

export type SidebarDoc = {
  id: string;
  title: string;
  folderId: string | null;
  sortKey: string;
  pinKey: string | null;
  pinned: boolean;
  createdAt: number;
  modifiedAt: number;
  openedAt: number | null;
  sizeBytes: number;
  snippet: string;
  kind: DocKind;
  tagIds: string[];
};

export type SidebarTag = { id: string; name: string; color: string | null };

/**
 * One changed row, for the change feed (architecture §7 `index.changed`):
 * a window patches that row instead of re-reading the whole library.
 */
export type IndexChange = { kind: "doc" | "folder" | "tag"; id: string };

/** Everything the files sidebar and lists paint from (P2.7a/b). */
export type SidebarSnapshot = {
  rev: number;
  folders: SidebarFolder[];
  docs: SidebarDoc[];
  tags: SidebarTag[];
};

/** Trash is emptied after this long (details spec §9). */
export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Ids that are safe in SQL, file names and logs. */
export const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const HEX32 = /^[0-9a-f]{32}$/;
export const MAX_NAME_LENGTH = 200;

function requireId(id: string, what: string) {
  if (!SAFE_ID.test(id))
    throw new StorageError("invalid_argument", `bad ${what}`);
}

function requireUuid(id: string, what: string) {
  if (!UUID.test(id)) throw new StorageError("invalid_argument", `bad ${what}`);
}

function cleanName(name: string): string {
  return name.trim().slice(0, MAX_NAME_LENGTH);
}

/** Wraps a metadata write: one transaction, `rev` bumped, new rev returned. */
function indexWrite(db: SqliteDriver, body: () => void): number {
  return transaction(db, () => {
    body();
    return bumpRev(db);
  });
}

function requireChanged(changes: number, what: string) {
  if (changes === 0) throw new StorageError("not_found", `no such ${what}`);
}

export function createDoc(
  db: SqliteDriver,
  input: CreateDocInput,
  now: number,
): CreatedDoc {
  const id = input.id ?? crypto.randomUUID();
  requireId(id, "document id");
  const lineage = input.lineage ?? crypto.randomUUID();
  requireUuid(lineage, "lineage");
  const schema = input.schema ?? 0;
  if (!Number.isInteger(schema) || schema < 0)
    throw new StorageError("invalid_argument", "bad schema");
  const linkKey = input.linkKey ?? randomHex32();
  if (!HEX32.test(linkKey))
    throw new StorageError("invalid_argument", "bad link key");
  if (input.folderId) requireId(input.folderId, "folder id");
  const kind = input.kind ?? "doc";
  if (kind !== "doc" && kind !== "template")
    throw new StorageError("invalid_argument", "bad kind");
  const rev = indexWrite(db, () => {
    db.prepare(
      `INSERT INTO docs (id, title, folder_id, sort_key, created_at, modified_at,
         lineage, link_key, kind, schema)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      cleanName(input.title ?? ""),
      input.folderId ?? null,
      input.sortKey ?? "",
      now,
      now,
      lineage,
      linkKey,
      kind,
      schema,
    );
  });
  return { id, lineage, linkKey, rev };
}

export function createFolder(
  db: SqliteDriver,
  input: {
    id?: string;
    name: string;
    parentId?: string | null;
    sortKey?: string;
  },
  now: number,
): { id: string; rev: number } {
  const id = input.id ?? crypto.randomUUID();
  requireId(id, "folder id");
  if (input.parentId) requireId(input.parentId, "parent id");
  const rev = indexWrite(db, () => {
    db.prepare(
      `INSERT INTO folders (id, parent_id, name, sort_key, created_at, modified_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.parentId ?? null,
      cleanName(input.name),
      input.sortKey ?? "",
      now,
      now,
    );
  });
  return { id, rev };
}

export function renameDoc(db: SqliteDriver, id: string, title: string): number {
  return indexWrite(db, () => {
    requireChanged(
      db
        .prepare("UPDATE docs SET title = ? WHERE id = ?")
        .run(cleanName(title), id).changes,
      "document",
    );
  });
}

export function moveDoc(
  db: SqliteDriver,
  id: string,
  folderId: string | null,
  sortKey: string,
): number {
  if (folderId) requireId(folderId, "folder id");
  return indexWrite(db, () => {
    requireChanged(
      db
        .prepare("UPDATE docs SET folder_id = ?, sort_key = ? WHERE id = ?")
        .run(folderId, sortKey, id).changes,
      "document",
    );
  });
}

export function markOpened(db: SqliteDriver, id: string, now: number): number {
  return indexWrite(db, () => {
    requireChanged(
      db.prepare("UPDATE docs SET opened_at = ? WHERE id = ?").run(now, id)
        .changes,
      "document",
    );
  });
}

export function trashDoc(
  db: SqliteDriver,
  id: string,
  now: number,
  group: string | null = null,
): number {
  return indexWrite(db, () => {
    requireChanged(
      db
        .prepare(
          `UPDATE docs SET trashed_at = ?, trash_group = ?, trashed_from = folder_id
           WHERE id = ? AND trashed_at IS NULL`,
        )
        .run(now, group, id).changes,
      "document",
    );
  });
}

export function restoreDoc(db: SqliteDriver, id: string): number {
  return indexWrite(db, () => {
    requireChanged(
      db
        .prepare(
          `UPDATE docs SET trashed_at = NULL, trash_group = NULL,
             folder_id = CASE WHEN trashed_from IS NULL
               OR EXISTS (SELECT 1 FROM folders WHERE id = docs.trashed_from AND trashed_at IS NULL)
               THEN trashed_from ELSE NULL END,
             trashed_from = NULL
           WHERE id = ? AND trashed_at IS NOT NULL`,
        )
        .run(id).changes,
      "trashed document",
    );
  });
}

/**
 * Deletes a document and everything that cascades from it: rows, snapshot,
 * tags, view and import source. The caller (`Library`) refuses a document
 * that is open (`document_open`).
 */
export function purgeDoc(db: SqliteDriver, id: string): number {
  return indexWrite(db, () => {
    requireChanged(
      db.prepare("DELETE FROM docs WHERE id = ?").run(id).changes,
      "document",
    );
  });
}

/** Ids of documents in Trash for longer than {@link TRASH_RETENTION_MS}. */
export function expiredTrash(db: SqliteDriver, now: number): string[] {
  return db
    .prepare(
      "SELECT id FROM docs WHERE trashed_at IS NOT NULL AND trashed_at <= ?",
    )
    .all(now - TRASH_RETENTION_MS)
    .map((row) => row.id as string);
}

export function createTag(
  db: SqliteDriver,
  name: string,
  color: string | null = null,
): { id: string; rev: number } {
  const clean = cleanName(name);
  if (!clean) throw new StorageError("invalid_argument", "empty tag name");
  const id = crypto.randomUUID();
  const rev = indexWrite(db, () => {
    db.prepare("INSERT INTO tags (id, name, color) VALUES (?, ?, ?)").run(
      id,
      clean,
      color,
    );
  });
  return { id, rev };
}

export function setDocTags(
  db: SqliteDriver,
  docId: string,
  tagIds: readonly string[],
): number {
  for (const tagId of tagIds) requireId(tagId, "tag id");
  return indexWrite(db, () => {
    if (scalar(db, "SELECT 1 FROM docs WHERE id = ?", docId) === undefined)
      throw new StorageError("not_found", "no such document");
    db.prepare("DELETE FROM doc_tags WHERE doc_id = ?").run(docId);
    const insert = db.prepare(
      "INSERT INTO doc_tags (doc_id, tag_id) VALUES (?, ?)",
    );
    for (const tagId of new Set(tagIds)) insert.run(docId, tagId);
  });
}

const nullableString = (value: SqlRow[string]) =>
  typeof value === "string" ? value : null;
const nullableNumber = (value: SqlRow[string]) =>
  typeof value === "number" ? value : null;

/**
 * The files sidebar's whole picture in one read: every live (untrashed)
 * folder and document, and the tags. Reads no BLOB column. P2.6's exit
 * budget (architecture §10): populated within 600 ms on an M1 and 1.0 s on
 * Windows with 1,000 documents.
 */
export function sidebarSnapshot(db: SqliteDriver): SidebarSnapshot {
  const tagsByDoc = new Map<string, string[]>();
  for (const row of db
    .prepare(
      `SELECT doc_tags.doc_id, doc_tags.tag_id FROM doc_tags
       JOIN docs ON docs.id = doc_tags.doc_id WHERE docs.trashed_at IS NULL`,
    )
    .all()) {
    const docId = row.doc_id as string;
    const list = tagsByDoc.get(docId);
    if (list) list.push(row.tag_id as string);
    else tagsByDoc.set(docId, [row.tag_id as string]);
  }
  const docs = db
    .prepare(
      `SELECT id, title, folder_id, sort_key, pin_key, pinned, created_at,
         modified_at, opened_at, size_bytes, snippet, kind
       FROM docs WHERE trashed_at IS NULL`,
    )
    .all()
    .map(
      (row): SidebarDoc => ({
        id: row.id as string,
        title: row.title as string,
        folderId: nullableString(row.folder_id),
        sortKey: row.sort_key as string,
        pinKey: nullableString(row.pin_key),
        pinned: row.pinned === 1,
        createdAt: row.created_at as number,
        modifiedAt: row.modified_at as number,
        openedAt: nullableNumber(row.opened_at),
        sizeBytes: row.size_bytes as number,
        snippet: row.snippet as string,
        kind: row.kind as DocKind,
        tagIds: tagsByDoc.get(row.id as string) ?? [],
      }),
    );
  const folders = db
    .prepare(
      `SELECT id, parent_id, name, sort_key, sort, view, "group"
       FROM folders WHERE trashed_at IS NULL`,
    )
    .all()
    .map(
      (row): SidebarFolder => ({
        id: row.id as string,
        parentId: nullableString(row.parent_id),
        name: row.name as string,
        sortKey: row.sort_key as string,
        sort: nullableString(row.sort),
        view: nullableString(row.view),
        group: nullableString(row.group),
      }),
    );
  const tags = db
    .prepare("SELECT id, name, color FROM tags")
    .all()
    .map(
      (row): SidebarTag => ({
        id: row.id as string,
        name: row.name as string,
        color: nullableString(row.color),
      }),
    );
  return { rev: readRev(db), folders, docs, tags };
}
