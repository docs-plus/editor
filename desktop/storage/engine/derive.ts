/**
 * `derive.put` (offline revision §4.3, P2.6d's engine half; LK4a builds the
 * renderer queue and the IPC): writes one document's derived rows, its
 * `links` and `doc_headings`, with its title and snippet, in one
 * transaction.
 *
 * - **Shape:** `target_key` is 32 hex characters, `level` 1–6, `text` at
 *   most 160 characters and `context` at most 240; at most 5,000 link rows
 *   and 5,000 heading rows. C0, C1 and bidi controls are stripped from
 *   every text. A violation is refused (`invalid_argument`).
 * - **Freshness:** inside the transaction, `atSeq` must equal `head_seq`.
 *   Lower answers `stale` and writes nothing; higher is invalid.
 * - **Hashes:** the worker hashes the canonical rows; a renderer hash is
 *   never trusted. Only a side whose hash changed is rewritten.
 * - **Always advance:** `derived_seq = atSeq` even when nothing changed, or
 *   an unchanged document would loop in the queue forever.
 * - **Purged:** a no-op, answering `gone`.
 *
 * Authorisation (SEC-003) is main's: it forwards a call only for a document
 * it gave that renderer to derive, or one that renderer holds.
 */
import type { SqliteDriver } from "./driver";
import { StorageError } from "./errors";
import { titleKey } from "./format-2";
import type { Hasher } from "./host";
import { isLinkKey, MAX_NAME_LENGTH } from "./library-index";
import { bumpRev, scalar, transaction } from "./sql";

/** One `links` row, less `src_doc_id` (LK1's `toLinkRows`). */
export type DerivedLink = {
  ord: number;
  src_toc_id: string;
  target_key: string;
  target_toc_id: string;
  text: string;
  context: string;
};

/** One `doc_headings` row, less `doc_id` and `text_key` (the worker's). */
export type DerivedHeading = {
  ord: number;
  toc_id: string;
  level: number;
  text: string;
};

export type DerivedRows = {
  links: readonly DerivedLink[];
  headings: readonly DerivedHeading[];
  title: string;
  snippet: string;
};

export type DeriveResult = "ok" | "stale" | "gone";

export const MAX_DERIVED_ROWS = 5000;
export const MAX_DERIVED_TEXT = 160;
export const MAX_DERIVED_CONTEXT = 240;
const MAX_SNIPPET = 300;

// C0 and C1 controls, and the bidi embeddings, overrides and isolates.
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
const CONTROLS = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;

export function stripControls(text: string): string {
  return text.replace(CONTROLS, "");
}

function invalid(message: string): never {
  throw new StorageError("invalid_argument", message);
}

function checkText(value: unknown, max: number, what: string): string {
  if (typeof value !== "string") invalid(`${what} is not text`);
  const clean = stripControls(value);
  if (clean.length > max) invalid(`${what} is longer than ${max}`);
  return clean;
}

function checkOrd(value: unknown, index: number, what: string) {
  if (value !== index) invalid(`${what} ord ${String(value)} is not ${index}`);
}

/** Validates and cleans the rows; throws `invalid_argument`. */
export function checkDerivedRows(rows: DerivedRows): DerivedRows {
  if (rows.links.length > MAX_DERIVED_ROWS) invalid("too many links");
  if (rows.headings.length > MAX_DERIVED_ROWS) invalid("too many headings");
  const links = rows.links.map((link, index) => {
    checkOrd(link.ord, index, "link");
    if (!isLinkKey(link.target_key)) invalid("bad target_key");
    return {
      ord: index,
      src_toc_id: checkText(link.src_toc_id, MAX_DERIVED_TEXT, "src_toc_id"),
      target_key: link.target_key,
      target_toc_id: checkText(
        link.target_toc_id,
        MAX_DERIVED_TEXT,
        "target_toc_id",
      ),
      text: checkText(link.text, MAX_DERIVED_TEXT, "link text"),
      context: checkText(link.context, MAX_DERIVED_CONTEXT, "context"),
    };
  });
  const headings = rows.headings.map((heading, index) => {
    checkOrd(heading.ord, index, "heading");
    if (
      !Number.isInteger(heading.level) ||
      heading.level < 1 ||
      heading.level > 6
    )
      invalid("bad heading level");
    const tocId = checkText(heading.toc_id, MAX_DERIVED_TEXT, "toc_id");
    if (!tocId) invalid("empty toc_id");
    return {
      ord: index,
      toc_id: tocId,
      level: heading.level,
      text: checkText(heading.text, MAX_DERIVED_TEXT, "heading text"),
    };
  });
  return {
    links,
    headings,
    title: stripControls(String(rows.title)).slice(0, MAX_NAME_LENGTH),
    snippet: stripControls(String(rows.snippet)).slice(0, MAX_SNIPPET),
  };
}

/** A canonical hash of rows: field order fixed, values length-prefixed. */
export function hashRows(
  hasher: Hasher,
  rows: readonly Record<string, string | number>[],
): string {
  for (const row of rows)
    for (const value of Object.values(row)) {
      const text = String(value);
      hasher.update(`${text.length}:${text}|`);
    }
  return hasher.digest();
}

export function putDerived(
  db: SqliteDriver,
  sha256: () => Hasher,
  docId: string,
  atSeq: number,
  input: DerivedRows,
): DeriveResult {
  if (!Number.isInteger(atSeq) || atSeq < 0) invalid("bad atSeq");
  const rows = checkDerivedRows(input);
  const linksHash = hashRows(sha256(), rows.links);
  const headingsHash = hashRows(sha256(), rows.headings);
  return transaction(db, () => {
    const doc = db
      .prepare(
        "SELECT head_seq, links_hash, headings_hash FROM docs WHERE id = ?",
      )
      .get(docId);
    if (!doc) return "gone";
    const head = Number(doc.head_seq);
    if (atSeq < head) return "stale";
    if (atSeq > head) invalid("atSeq is ahead of head_seq");
    if (doc.links_hash !== linksHash) {
      db.prepare("DELETE FROM links WHERE src_doc_id = ?").run(docId);
      const insert = db.prepare(
        `INSERT INTO links (src_doc_id, ord, src_toc_id, target_key, target_toc_id, text, context)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const link of rows.links)
        insert.run(
          docId,
          link.ord,
          link.src_toc_id,
          link.target_key,
          link.target_toc_id,
          link.text,
          link.context,
        );
    }
    if (doc.headings_hash !== headingsHash) {
      db.prepare("DELETE FROM doc_headings WHERE doc_id = ?").run(docId);
      const insert = db.prepare(
        `INSERT INTO doc_headings (doc_id, ord, toc_id, level, text, text_key)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const heading of rows.headings)
        insert.run(
          docId,
          heading.ord,
          heading.toc_id,
          heading.level,
          heading.text,
          titleKey(heading.text),
        );
    }
    db.prepare(
      `UPDATE docs SET derived_seq = ?, links_hash = ?, headings_hash = ?,
         title = ?, title_key = ?, snippet = ? WHERE id = ?`,
    ).run(
      atSeq,
      linksHash,
      headingsHash,
      rows.title,
      titleKey(rows.title),
      rows.snippet,
      docId,
    );
    bumpRev(db);
    return "ok";
  });
}

/** The next stale document for the derive queue (`docs_stale`), or null. */
export function nextStale(
  db: SqliteDriver,
  skip: (docId: string) => boolean = () => false,
): string | null {
  for (const row of db
    .prepare("SELECT id FROM docs WHERE derived_seq IS NOT head_seq LIMIT 64")
    .all()) {
    const id = String(row.id);
    if (!skip(id)) return id;
  }
  return null;
}

/** Documents linking to `linkKey`: live, non-template sources (§4.4). */
export function backlinks(db: SqliteDriver, linkKey: string) {
  return db
    .prepare(
      `SELECT l.src_doc_id, l.ord, l.src_toc_id, l.target_toc_id, l.text, l.context
       FROM links l JOIN docs d ON d.id = l.src_doc_id
       WHERE l.target_key = ? AND d.trashed_at IS NULL AND d.kind = 'doc'
       ORDER BY l.src_doc_id, l.ord`,
    )
    .all(linkKey);
}

/** How many documents still need deriving (diagnostics, T22). */
export function staleCount(db: SqliteDriver): number {
  return Number(
    scalar(db, "SELECT COUNT(*) FROM docs WHERE derived_seq IS NOT head_seq"),
  );
}
