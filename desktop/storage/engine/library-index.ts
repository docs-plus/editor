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
 *
 * Format 2 (offline revision §4.2): `createDoc` is `mintDoc`, the only way
 * to create a document (a backup restore that keeps identity is
 * `restoreDocFromBackup`, `docs-copy.ts`). The title has one writer: the
 * content (`append` and `derive.put`); there is no rename here (G4).
 * Folders are in `folders.ts`, tags in `tags.ts`.
 *
 * Trash pointers: a document trashed on its own keeps its folder only in
 * `trashed_from` (`folder_id` becomes NULL), so a later purge of that
 * folder isn't blocked by `ON DELETE RESTRICT`. Documents inside a trashed
 * folder keep `folder_id`: the folder's `trash_group` carries them.
 */
import type { SqliteDriver, SqlRow } from "./driver";
import { StorageError } from "./errors";
import { titleKey } from "./format-2";
import { bumpRev, randomHex32, readRev, scalar, transaction } from "./sql";

export type DocKind = "doc" | "template";

export type CreateDocInput = {
  /**
   * Minted (a UUID) when omitted. Main's IPC guard only lets UUIDs through;
   * the engine accepts any {@link SAFE_ID}, which tests and imports use.
   */
  id?: string;
  /**
   * `docs.link_key`, 32 lowercase hex: minted when omitted. A caller that
   * must answer before the write lands (`RpcLibraryIndex.create`) mints it.
   */
  linkKey?: string;
  /** `docs.schema`: `DOC_SCHEMA` for a new document, the file's on import. */
  schema?: number;
  /** The title until the content's first append says otherwise. */
  title?: string;
  /** A live folder, or the root when absent. */
  folderId?: string | null;
  sortKey?: string;
  kind?: DocKind;
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
  createdAt: number;
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
  linkKey: string;
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

export function requireId(id: string, what: string) {
  if (!SAFE_ID.test(id))
    throw new StorageError("invalid_argument", `bad ${what}`);
}

export function requireUuid(id: string, what: string) {
  if (!UUID.test(id)) throw new StorageError("invalid_argument", `bad ${what}`);
}

export function isLinkKey(value: string): boolean {
  return HEX32.test(value);
}

export function cleanName(name: string): string {
  return name.trim().slice(0, MAX_NAME_LENGTH);
}

/** Wraps a metadata write: one transaction, `rev` bumped, new rev returned. */
export function indexWrite(db: SqliteDriver, body: () => void): number {
  return transaction(db, () => {
    body();
    return bumpRev(db);
  });
}

export function requireChanged(changes: number, what: string) {
  if (changes === 0) throw new StorageError("not_found", `no such ${what}`);
}

/** Throws unless `folderId` is a folder that isn't in the Trash. */
export function requireLiveFolder(db: SqliteDriver, folderId: string) {
  const trashed = scalar(
    db,
    "SELECT trashed_at IS NOT NULL FROM folders WHERE id = ?",
    folderId,
  );
  if (trashed === undefined)
    throw new StorageError("not_found", "no such folder");
  if (trashed === 1)
    throw new StorageError("invalid_argument", "folder is in the Trash");
}

/** Inserts a minted row; the caller's transaction. */
export function insertDoc(
  db: SqliteDriver,
  row: {
    id: string;
    title: string;
    folderId: string | null;
    sortKey: string;
    kind: DocKind;
    schema: number;
    lineage: string;
    linkKey: string;
    /** Set for a new or imported document, so it lists in Recent at once. */
    openedAt?: number | null;
  },
  now: number,
) {
  db.prepare(
    `INSERT INTO docs (id, title, title_key, folder_id, sort_key, created_at,
       modified_at, opened_at, lineage, link_key, kind, schema)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.title,
    titleKey(row.title),
    row.folderId,
    row.sortKey,
    now,
    now,
    row.openedAt ?? null,
    row.lineage,
    row.linkKey,
    row.kind,
    row.schema,
  );
}

/**
 * `mintDoc` (§4.2): the only way to create a document (new, duplicate, from
 * a template, or import). Mints `id` when absent, and always `link_key` and
 * `lineage`; `head_seq` 0, `derived_seq` NULL.
 */
export function createDoc(
  db: SqliteDriver,
  input: CreateDocInput,
  now: number,
): CreatedDoc {
  const id = input.id ?? crypto.randomUUID();
  requireId(id, "document id");
  const schema = input.schema ?? 0;
  if (!Number.isInteger(schema) || schema < 0)
    throw new StorageError("invalid_argument", "bad schema");
  if (input.folderId) requireId(input.folderId, "folder id");
  const kind = input.kind ?? "doc";
  if (kind !== "doc" && kind !== "template")
    throw new StorageError("invalid_argument", "bad kind");
  const lineage = crypto.randomUUID();
  const linkKey = input.linkKey ?? randomHex32();
  if (!isLinkKey(linkKey))
    throw new StorageError("invalid_argument", "bad link key");
  const rev = indexWrite(db, () => {
    if (input.folderId) requireLiveFolder(db, input.folderId);
    insertDoc(
      db,
      {
        id,
        title: cleanName(input.title ?? ""),
        folderId: input.folderId ?? null,
        sortKey: input.sortKey ?? "",
        kind,
        schema,
        lineage,
        linkKey,
        // New and imported documents list in Recent right away (web parity);
        // duplicate and restore stay "opened only".
        openedAt: now,
      },
      now,
    );
  });
  return { id, lineage, linkKey, rev };
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

/**
 * Moves a document to the Trash on its own, under a new `trash_group`. Its
 * folder moves to `trashed_from` (see the file comment).
 */
export function trashDoc(
  db: SqliteDriver,
  id: string,
  now: number,
  group: string = crypto.randomUUID(),
): number {
  return indexWrite(db, () => {
    requireChanged(
      db
        .prepare(
          `UPDATE docs SET trashed_at = ?, trash_group = ?,
             trashed_from = folder_id, folder_id = NULL
           WHERE id = ? AND trashed_at IS NULL`,
        )
        .run(now, group, id).changes,
      "document",
    );
  });
}

/**
 * Brings one document back from the Trash: to its folder when that folder
 * is live, otherwise to the root. Returns where it went.
 */
export function restoreDoc(
  db: SqliteDriver,
  id: string,
): { rev: number; folderId: string | null } {
  let folderId: string | null = null;
  const rev = indexWrite(db, () => {
    const row = db
      .prepare(
        "SELECT COALESCE(folder_id, trashed_from) AS home FROM docs WHERE id = ? AND trashed_at IS NOT NULL",
      )
      .get(id);
    if (!row) throw new StorageError("not_found", "no such trashed document");
    const home = typeof row.home === "string" ? row.home : null;
    const live =
      home !== null &&
      scalar(
        db,
        "SELECT 1 FROM folders WHERE id = ? AND trashed_at IS NULL",
        home,
      ) !== undefined;
    folderId = live ? home : null;
    db.prepare(
      `UPDATE docs SET trashed_at = NULL, trash_group = NULL, trashed_from = NULL,
         folder_id = ? WHERE id = ?`,
    ).run(folderId, id);
  });
  return { rev, folderId };
}

/**
 * `purgeDoc` (§4.2): its `doc_blobs` rows get `dropped_at = now` where they
 * have none (the image store's 30-day GC grace starts here, §4.6; an
 * earlier drop time is never moved), then the row is deleted, which
 * cascades to `links`, `doc_headings`, `snapshots`, `updates`, `doc_tags`,
 * `doc_view` and `import_sources`. The caller (`Library`) refuses a
 * document that is open (`document_open`).
 */
export function purgeDocRows(db: SqliteDriver, id: string, now: number) {
  db.prepare(
    "UPDATE doc_blobs SET dropped_at = ? WHERE doc_id = ? AND dropped_at IS NULL",
  ).run(now, id);
  requireChanged(
    db.prepare("DELETE FROM docs WHERE id = ?").run(id).changes,
    "document",
  );
}

export function purgeDoc(db: SqliteDriver, id: string, now: number): number {
  return indexWrite(db, () => purgeDocRows(db, id, now));
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
         modified_at, opened_at, size_bytes, kind, link_key
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
        linkKey: row.link_key as string,
        kind: row.kind as DocKind,
        tagIds: tagsByDoc.get(row.id as string) ?? [],
      }),
    );
  const folders = db
    .prepare(
      `SELECT id, parent_id, name, created_at, sort_key, sort, view, "group"
       FROM folders WHERE trashed_at IS NULL`,
    )
    .all()
    .map(
      (row): SidebarFolder => ({
        id: row.id as string,
        parentId: nullableString(row.parent_id),
        name: row.name as string,
        createdAt: row.created_at as number,
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
