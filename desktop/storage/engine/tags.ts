/**
 * Tag operations (offline revision §4.2, P2.6d; P2.7b's port). Names are
 * unique by `tagNameKey` (`lib/library/tag-rules.ts`: the shared search
 * normalizer), stored as `tags.name_key` with a UNIQUE index; SQLite's
 * `COLLATE NOCASE` folds ASCII only, so it can't stand in.
 */
import {
  cleanTagName,
  MAX_TAGS_PER_DOC,
  tagNameKey,
} from "@/lib/library/tag-rules";

import type { SqliteDriver } from "./driver";
import { StorageError } from "./errors";
import { indexWrite, requireChanged, requireId } from "./library-index";
import { scalar } from "./sql";

export type TagRename =
  | { ok: true; rev: number }
  | { ok: false; reason: "exists"; tagId: string }
  | { ok: false; reason: "invalid" | "not_found" };

function tagByKey(db: SqliteDriver, key: string): string | null {
  const id = scalar(db, "SELECT id FROM tags WHERE name_key = ?", key);
  return typeof id === "string" ? id : null;
}

/**
 * The tag named `name`, created when no tag has its key. Null when the
 * cleaned name is empty.
 */
export function createTag(
  db: SqliteDriver,
  name: string,
  now: number,
  color: string | null = null,
): { id: string; created: boolean; rev: number } | null {
  const clean = cleanTagName(name);
  if (!clean) return null;
  const key = tagNameKey(clean);
  let id = "";
  let created = false;
  const rev = indexWrite(db, () => {
    const existing = tagByKey(db, key);
    if (existing) {
      id = existing;
      return;
    }
    id = crypto.randomUUID();
    created = true;
    db.prepare(
      "INSERT INTO tags (id, name, name_key, color, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(id, clean, key, color, now);
  });
  return { id, created, rev };
}

/** Renames a tag everywhere; refuses a name another tag has. */
export function renameTag(
  db: SqliteDriver,
  id: string,
  name: string,
): TagRename {
  const clean = cleanTagName(name);
  if (!clean) return { ok: false, reason: "invalid" };
  const key = tagNameKey(clean);
  // A box, so TypeScript doesn't narrow the closure's writes away.
  const out: { result: TagRename } = {
    result: { ok: false, reason: "not_found" },
  };
  const rev = indexWrite(db, () => {
    if (scalar(db, "SELECT 1 FROM tags WHERE id = ?", id) === undefined) return;
    const holder = tagByKey(db, key);
    if (holder && holder !== id) {
      out.result = { ok: false, reason: "exists", tagId: holder };
      return;
    }
    db.prepare("UPDATE tags SET name = ?, name_key = ? WHERE id = ?").run(
      clean,
      key,
      id,
    );
    out.result = { ok: true, rev: 0 };
  });
  if (out.result.ok) out.result.rev = rev;
  return out.result;
}

/**
 * `mergeTags(from, into)` (§4.2): every document tagged `from` gets `into`
 * (documents that had both keep one), then `from` is deleted. False when
 * either is unknown or they are the same.
 */
export function mergeTags(
  db: SqliteDriver,
  fromId: string,
  intoId: string,
): number | false {
  if (fromId === intoId) return false;
  let merged = false;
  const rev = indexWrite(db, () => {
    const known = scalar(
      db,
      "SELECT COUNT(*) FROM tags WHERE id IN (?, ?)",
      fromId,
      intoId,
    );
    if (known !== 2) return;
    db.prepare(
      "INSERT OR IGNORE INTO doc_tags (doc_id, tag_id) SELECT doc_id, ? FROM doc_tags WHERE tag_id = ?",
    ).run(intoId, fromId);
    db.prepare("DELETE FROM tags WHERE id = ?").run(fromId);
    merged = true;
  });
  return merged ? rev : false;
}

/** Tags a document; false at {@link MAX_TAGS_PER_DOC} or when unknown. */
export function addTag(
  db: SqliteDriver,
  docId: string,
  tagId: string,
): number | false {
  let added = false;
  const rev = indexWrite(db, () => {
    if (scalar(db, "SELECT 1 FROM docs WHERE id = ?", docId) === undefined)
      return;
    if (scalar(db, "SELECT 1 FROM tags WHERE id = ?", tagId) === undefined)
      return;
    if (
      scalar(
        db,
        "SELECT 1 FROM doc_tags WHERE doc_id = ? AND tag_id = ?",
        docId,
        tagId,
      ) !== undefined
    ) {
      added = true;
      return;
    }
    const count = Number(
      scalar(db, "SELECT COUNT(*) FROM doc_tags WHERE doc_id = ?", docId),
    );
    if (count >= MAX_TAGS_PER_DOC) return;
    db.prepare("INSERT INTO doc_tags (doc_id, tag_id) VALUES (?, ?)").run(
      docId,
      tagId,
    );
    added = true;
  });
  return added ? rev : false;
}

export function removeTag(
  db: SqliteDriver,
  docId: string,
  tagId: string,
): number {
  return indexWrite(db, () => {
    db.prepare("DELETE FROM doc_tags WHERE doc_id = ? AND tag_id = ?").run(
      docId,
      tagId,
    );
  });
}

/** Replaces a document's tags (import, restore); at most 20. */
export function setDocTags(
  db: SqliteDriver,
  docId: string,
  tagIds: readonly string[],
): number {
  for (const tagId of tagIds) requireId(tagId, "tag id");
  const unique = [...new Set(tagIds)];
  if (unique.length > MAX_TAGS_PER_DOC)
    throw new StorageError("invalid_argument", "too many tags");
  return indexWrite(db, () => {
    requireChanged(
      Number(scalar(db, "SELECT COUNT(*) FROM docs WHERE id = ?", docId)),
      "document",
    );
    db.prepare("DELETE FROM doc_tags WHERE doc_id = ?").run(docId);
    const insert = db.prepare(
      "INSERT INTO doc_tags (doc_id, tag_id) VALUES (?, ?)",
    );
    for (const tagId of unique) insert.run(docId, tagId);
  });
}
