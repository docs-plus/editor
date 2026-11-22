/**
 * Duplicating and restoring documents (offline revision §4.2, P2.6d). Both
 * create rows through `insertDoc` and write the content as one
 * `origin='restore'` update, so `head_seq` rises and the new document is
 * stale until the derive queue derives it. Derived rows (`links`,
 * `doc_headings`) are never copied.
 */
import * as Y from "yjs";

import { DOC_CAP_BYTES, load, stateOf } from "./content";
import type { SqliteDriver } from "./driver";
import { StorageError } from "./errors";
import {
  type DocKind,
  indexWrite,
  insertDoc,
  isLinkKey,
  requireId,
  requireUuid,
} from "./library-index";
import { randomHex32, scalar } from "./sql";

function writeState(
  db: SqliteDriver,
  docId: string,
  state: Uint8Array,
  now: number,
) {
  if (state.byteLength > DOC_CAP_BYTES)
    throw new StorageError("document_too_large", "over the 32 MiB cap");
  const seq = db
    .prepare(
      "INSERT INTO updates (doc_id, data, origin, created_at) VALUES (?, ?, 'restore', ?)",
    )
    .run(docId, state, now).lastInsertRowid;
  db.prepare("UPDATE docs SET head_seq = ?, size_bytes = ? WHERE id = ?").run(
    seq,
    state.byteLength,
    docId,
  );
}

/**
 * `duplicateDoc` (§4.2): a new document (new id, `link_key` and `lineage`)
 * in the same folder, with the merged state, the tags, the view row and
 * the `current` image rows.
 */
export function duplicateDoc(
  db: SqliteDriver,
  sourceId: string,
  now: number,
): { id: string; linkKey: string; rev: number } {
  const id = crypto.randomUUID();
  const linkKey = randomHex32();
  const rev = indexWrite(db, () => {
    const source = db
      .prepare(
        "SELECT title, folder_id, sort_key, kind, schema, trashed_at FROM docs WHERE id = ?",
      )
      .get(sourceId);
    if (!source) throw new StorageError("not_found", "no such document");
    if (source.trashed_at !== null)
      throw new StorageError("invalid_argument", "document is in the Trash");
    insertDoc(
      db,
      {
        id,
        title: String(source.title),
        folderId:
          typeof source.folder_id === "string" ? source.folder_id : null,
        sortKey: String(source.sort_key),
        kind: source.kind as DocKind,
        schema: Number(source.schema),
        lineage: crypto.randomUUID(),
        linkKey,
      },
      now,
    );
    writeState(db, id, stateOf(load(db, sourceId)), now);
    db.prepare(
      "INSERT INTO doc_tags (doc_id, tag_id) SELECT ?, tag_id FROM doc_tags WHERE doc_id = ?",
    ).run(id, sourceId);
    db.prepare(
      `INSERT INTO doc_view (doc_id, width, place, remote_images)
       SELECT ?, width, place, remote_images FROM doc_view WHERE doc_id = ?`,
    ).run(id, sourceId);
    db.prepare(
      `INSERT INTO doc_blobs (doc_id, hash, kind, dropped_at)
       SELECT ?, hash, 'current', NULL FROM doc_blobs
       WHERE doc_id = ? AND kind = 'current' AND dropped_at IS NULL`,
    ).run(id, sourceId);
  });
  return { id, linkKey, rev };
}

/** A document as a backup carries it (a backup zip or `library.json`). */
export type BackupDoc = {
  id: string;
  title: string;
  kind: DocKind;
  schema: number;
  lineage: string;
  linkKey: string;
  folderId: string | null;
};

/**
 * `restoreDoc(row, state)` of §4.2, for a backup restore (S8c): keeps
 * `link_key` and `lineage`. If the id, `link_key` or `lineage` collides
 * with a document already here, it inserts a **new** row with a new id and
 * a new `link_key` (keeping the lineage) and reports the duplicate. It
 * never updates identity (`docs_identity_frozen`, I5). The state is
 * written as one `restore` update; the document is stale until derived.
 */
export function restoreDocFromBackup(
  db: SqliteDriver,
  row: BackupDoc,
  state: Uint8Array,
  now: number,
): { id: string; linkKey: string; duplicateOf: string | null; rev: number } {
  requireId(row.id, "document id");
  requireUuid(row.lineage, "lineage");
  if (!isLinkKey(row.linkKey))
    throw new StorageError("invalid_argument", "bad link key");
  if (state.byteLength === 0)
    throw new StorageError("invalid_argument", "empty state");
  // A state that doesn't apply cleanly is refused before anything is written.
  try {
    const scratch = new Y.Doc();
    Y.applyUpdate(scratch, state);
    scratch.destroy();
  } catch {
    throw new StorageError(
      "invalid_argument",
      "the backup state doesn't apply",
    );
  }
  let id = row.id;
  let linkKey = row.linkKey;
  let duplicateOf: string | null = null;
  const rev = indexWrite(db, () => {
    const clash = db
      .prepare(
        "SELECT id FROM docs WHERE id = ? OR link_key = ? OR lineage = ? LIMIT 1",
      )
      .get(row.id, row.linkKey, row.lineage);
    if (clash) {
      duplicateOf = String(clash.id);
      id = crypto.randomUUID();
      linkKey = randomHex32();
    }
    const folderLive =
      row.folderId !== null &&
      scalar(
        db,
        "SELECT 1 FROM folders WHERE id = ? AND trashed_at IS NULL",
        row.folderId,
      ) !== undefined;
    insertDoc(
      db,
      {
        id,
        title: row.title,
        folderId: folderLive ? row.folderId : null,
        sortKey: "",
        kind: row.kind,
        schema: row.schema,
        lineage: row.lineage,
        linkKey,
      },
      now,
    );
    writeState(db, id, state, now);
    // A purged document with this id left image rows marked dropped; the
    // restored one references the same images, so the GC grace must not
    // run out on them (I11). The image recount settles them later.
    db.prepare(
      "UPDATE doc_blobs SET dropped_at = NULL WHERE doc_id = ? AND kind <> 'version'",
    ).run(id);
  });
  return { id, linkKey, duplicateOf, rev };
}
