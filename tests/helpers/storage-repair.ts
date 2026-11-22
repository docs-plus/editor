/**
 * Test helpers for repair and rebuild (offline revision §4.5, P2.6f): raw
 * access to a `Library`'s connection, a seeded PRNG, a deterministic stub
 * deriver (LK4a's real one is not built yet), and an independent checker
 * for invariants I1–I9 (§4.1) that doesn't share code with `repair.ts`.
 */
import * as Y from "yjs";

import type { DerivedRows } from "@/desktop/storage/engine/derive";
import type { SqliteDriver } from "@/desktop/storage/engine/driver";
import { MAX_FOLDER_DEPTH } from "@/desktop/storage/engine/format-2";
import type { Library } from "@/desktop/storage/engine/library";

/** The library's own connection (the same one its operations use). */
export function rawDb(library: Library): SqliteDriver {
  const db = (library as unknown as { db: SqliteDriver | null }).db;
  if (!db) throw new Error("library is closed");
  return db;
}

/** mulberry32: a small seeded PRNG, so a failing seed replays exactly. */
export function createRng(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (max: number) => Math.floor(next() * max),
    pick<T>(items: readonly T[]): T | undefined {
      return items.length === 0
        ? undefined
        : items[Math.floor(next() * items.length)];
    },
    hex32() {
      let out = "";
      for (let i = 0; i < 32; i += 1)
        out += Math.floor(next() * 16).toString(16);
      return out;
    },
  };
}
export type Rng = ReturnType<typeof createRng>;

// ── The stub document model and deriver ─────────────────────────────────
//
// A document's Y.Doc holds two arrays: `headings` of { tocId, level, text }
// and `links` of { targetKey, text }. The stub derives the rows from them,
// so the derived rows are a pure function of the stored state.

type StubHeading = { tocId: string; level: number; text: string };
type StubLink = { targetKey: string; text: string };

function docFromState(state: Uint8Array): Y.Doc {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return doc;
}

/** The stub deriver: rows from the state, as LK4a's will be. */
export function stubDerive(state: Uint8Array): DerivedRows {
  const doc = docFromState(state);
  const headings = doc.getArray<StubHeading>("headings").toArray();
  const links = doc.getArray<StubLink>("links").toArray();
  return {
    headings: headings.map((heading, ord) => ({
      ord,
      toc_id: heading.tocId,
      level: heading.level,
      text: heading.text,
    })),
    links: links.map((link, ord) => ({
      ord,
      src_toc_id: headings[0]?.tocId ?? "",
      target_key: link.targetKey,
      target_toc_id: "",
      text: link.text,
      context: `link ${ord}`,
    })),
    title: headings[0]?.text ?? "",
    snippet: `${headings.length} headings, ${links.length} links`,
  };
}

/**
 * One random edit on top of `state`, as an update: adds or removes a
 * heading or a link. Never empty.
 */
export function randomEdit(
  state: Uint8Array,
  rng: Rng,
  linkKeys: readonly string[],
): Uint8Array {
  const doc = docFromState(state);
  const before = Y.encodeStateVector(doc);
  const headings = doc.getArray<StubHeading>("headings");
  const links = doc.getArray<StubLink>("links");
  const roll = rng.int(4);
  if (roll === 0 && headings.length > 0)
    headings.delete(rng.int(headings.length), 1);
  else if (roll === 1 && links.length > 0)
    links.delete(rng.int(links.length), 1);
  else if (roll === 2)
    links.insert(rng.int(links.length + 1), [
      {
        targetKey: rng.pick(linkKeys) ?? rng.hex32(),
        text: `to ${rng.int(1000)}`,
      },
    ]);
  else
    headings.insert(rng.int(headings.length + 1), [
      {
        tocId: `h${rng.int(1_000_000)}`,
        level: 1 + rng.int(6),
        text: `Heading ${rng.int(1000)}`,
      },
    ]);
  return Y.encodeStateAsUpdate(doc, before);
}

/** Derives every stale document with the stub until none is left. */
export function drainWithStub(library: Library): number {
  const db = rawDb(library);
  let derived = 0;
  for (;;) {
    const id = library.nextStale();
    if (id === null) return derived;
    const row = db.prepare("SELECT head_seq FROM docs WHERE id = ?").get(id);
    const result = library.putDerived(
      id,
      Number(row?.head_seq),
      stubDerive(library.stateOf(id)),
    );
    if (result !== "ok") throw new Error(`derive of ${id} was ${result}`);
    derived += 1;
  }
}

/** Every derived row and staleness column, in a stable order. */
export function derivedSnapshot(db: SqliteDriver) {
  return {
    links: db.prepare("SELECT * FROM links ORDER BY src_doc_id, ord").all(),
    headings: db
      .prepare("SELECT * FROM doc_headings ORDER BY doc_id, ord")
      .all(),
    docs: db
      .prepare(
        `SELECT id, title, title_key, snippet, head_seq, derived_seq,
           links_hash, headings_hash FROM docs ORDER BY id`,
      )
      .all(),
  };
}

// ── The independent invariant checker (I1–I9) ───────────────────────────

export type Identity = { linkKey: string; lineage: string };

type FolderRow = {
  id: string;
  parent: string | null;
  trashed: boolean;
};

/**
 * One line per broken invariant. `identities` holds every document's
 * identity as first seen (I5); `stateOf` reads a document's whole state
 * without claiming it (I7).
 */
export function invariantViolations(
  db: SqliteDriver,
  identities: ReadonlyMap<string, Identity>,
  stateOf: (docId: string) => Uint8Array,
): string[] {
  const out: string[] = [];
  // I1
  for (const row of db.prepare("PRAGMA foreign_key_check").all())
    out.push(`I1 ${JSON.stringify(row)}`);
  // I2, I4
  const folders = new Map<string, FolderRow>();
  for (const row of db
    .prepare("SELECT id, parent_id, trashed_at FROM folders")
    .all())
    folders.set(String(row.id), {
      id: String(row.id),
      parent: typeof row.parent_id === "string" ? row.parent_id : null,
      trashed: row.trashed_at !== null,
    });
  const chain = (start: string | null): string[] | null => {
    const seen: string[] = [];
    for (let at = start; at !== null; at = folders.get(at)?.parent ?? null) {
      if (seen.includes(at)) return null;
      seen.push(at);
    }
    return seen;
  };
  for (const folder of folders.values()) {
    const up = chain(folder.id);
    if (up === null) out.push(`I2 folder ${folder.id} is in a cycle`);
    else if (up.length > MAX_FOLDER_DEPTH)
      out.push(`I2 folder ${folder.id} is at depth ${up.length}`);
    if (
      !folder.trashed &&
      (up ?? []).some((id) => folders.get(id)?.trashed === true)
    )
      out.push(`I4 live folder ${folder.id} has a trashed ancestor`);
  }
  for (const row of db
    .prepare("SELECT id, folder_id FROM docs WHERE trashed_at IS NULL")
    .all()) {
    const up =
      chain(typeof row.folder_id === "string" ? row.folder_id : null) ?? [];
    if (up.some((id) => folders.get(id)?.trashed === true))
      out.push(`I4 live doc ${row.id} has a trashed ancestor`);
  }
  // I3
  for (const table of ["docs", "folders"])
    for (const row of db
      .prepare(
        `SELECT id FROM ${table} WHERE trashed_at IS NULL
           AND (trash_group IS NOT NULL OR trashed_from IS NOT NULL)`,
      )
      .all())
      out.push(`I3 ${table} ${row.id}`);
  // I5–I9, per document
  for (const doc of db
    .prepare(
      `SELECT d.id, d.link_key, d.lineage, d.head_seq, d.derived_seq, d.size_bytes,
         (SELECT MAX(seq) FROM updates u WHERE u.doc_id = d.id) AS max_seq,
         (SELECT upto_seq FROM snapshots s WHERE s.doc_id = d.id) AS upto,
         COALESCE((SELECT LENGTH(data) FROM snapshots s WHERE s.doc_id = d.id), 0)
           + COALESCE((SELECT SUM(LENGTH(data)) FROM updates u WHERE u.doc_id = d.id), 0)
           AS stored
       FROM docs d ORDER BY d.id`,
    )
    .all()) {
    const id = String(doc.id);
    const identity = identities.get(id);
    if (
      identity &&
      (identity.linkKey !== doc.link_key || identity.lineage !== doc.lineage)
    )
      out.push(`I5 doc ${id} changed identity`);
    const head = Number(doc.head_seq);
    if (head < Number(doc.max_seq ?? 0) || head < Number(doc.upto ?? 0))
      out.push(`I6 doc ${id} head_seq ${head} is behind its rows`);
    if (doc.derived_seq !== null) {
      const derivedSeq = Number(doc.derived_seq);
      if (derivedSeq > head)
        out.push(`I7 doc ${id} derived_seq ${derivedSeq} > head_seq ${head}`);
      if (derivedSeq === head) {
        const fresh = stubDerive(stateOf(id));
        const links = db
          .prepare(
            `SELECT ord, src_toc_id, target_key, target_toc_id, text, context
             FROM links WHERE src_doc_id = ? ORDER BY ord`,
          )
          .all(id);
        const headings = db
          .prepare(
            "SELECT ord, toc_id, level, text FROM doc_headings WHERE doc_id = ? ORDER BY ord",
          )
          .all(id);
        if (
          JSON.stringify(links) !== JSON.stringify(fresh.links) ||
          JSON.stringify(headings) !== JSON.stringify(fresh.headings)
        )
          out.push(`I7 doc ${id} derived rows differ from a fresh derive`);
      }
    }
    if (Number(doc.size_bytes) !== Number(doc.stored))
      out.push(
        `I9 doc ${id} size_bytes ${doc.size_bytes} is not ${doc.stored}`,
      );
  }
  return out;
}
