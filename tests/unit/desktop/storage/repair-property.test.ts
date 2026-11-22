/**
 * Offline revision §5.4 for P2.6f:
 * - **P1:** seeded random sequences of engine operations keep I1–I9, and a
 *   check-mode repair at any point is a no-op.
 * - **P2:** damaged derived rows come back exactly after "Rebuild index"
 *   and a drain.
 * - **T22, engine half:** 1,000 stale documents drain with the stub
 *   deriver. The real T22 (renderer queue, duty cycle, typing ratio) waits
 *   for LK4a.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";

import * as Y from "yjs";

import type { SqliteDriver } from "@/desktop/storage/engine/driver";
import { MAX_FOLDER_DEPTH } from "@/desktop/storage/engine/format-2";
import type { Library } from "@/desktop/storage/engine/library";
import { checkLibrary } from "@/desktop/storage/engine/repair";
import {
  createClock,
  createTempDir,
  createTestHost,
  openTestLibrary,
  type TestClock,
} from "@/tests/helpers/storage-library";
import {
  createRng,
  derivedSnapshot,
  drainWithStub,
  type Identity,
  invariantViolations,
  type Rng,
  randomEdit,
  rawDb,
  stubDerive,
} from "@/tests/helpers/storage-repair";

let temp: ReturnType<typeof createTempDir>;
let clock: TestClock;
let host: ReturnType<typeof createTestHost>;
let library: Library;

beforeEach(() => {
  temp = createTempDir();
  clock = createClock();
  host = createTestHost(clock);
  library = openTestLibrary(join(temp.dir, "lib"), host);
});
afterEach(() => {
  library.shutdown();
  temp.cleanUp();
});

const CLEAN = {
  headSeqRaised: 0,
  sizeFixed: 0,
  violations: [],
  orphanBlobRows: 0,
};

const OWNER = "window-1";

function ids(db: SqliteDriver, sql: string): string[] {
  return db
    .prepare(sql)
    .all()
    .map((row) => String(Object.values(row)[0]));
}

function headSeq(db: SqliteDriver, id: string): number {
  return Number(
    db.prepare("SELECT head_seq FROM docs WHERE id = ?").get(id)?.head_seq,
  );
}

/** Folder depth (1 at the root) and the height of a folder's subtree. */
function folderShape(db: SqliteDriver) {
  const parent = new Map<string, string | null>();
  for (const row of db.prepare("SELECT id, parent_id FROM folders").all())
    parent.set(
      String(row.id),
      typeof row.parent_id === "string" ? row.parent_id : null,
    );
  const depth = (id: string | null): number => {
    let count = 0;
    for (let at = id; at !== null; at = parent.get(at) ?? null) count += 1;
    return count;
  };
  const height = (id: string): number =>
    1 +
    Math.max(
      0,
      ...[...parent]
        .filter(([, up]) => up === id)
        .map(([child]) => height(child)),
    );
  return { depth, height };
}

/**
 * One random engine operation on valid targets only: any throw is a
 * failure (SQLITE_CONSTRAINT reaches us as `invalid_argument`, so a broken
 * FK, CHECK or trigger must not be swallowed).
 */
function randomOperation(rng: Rng, identities: Map<string, Identity>): string {
  const db = rawDb(library);
  const liveDocs = ids(
    db,
    "SELECT id FROM docs WHERE trashed_at IS NULL ORDER BY id",
  );
  const trashedDocs = ids(
    db,
    "SELECT id FROM docs WHERE trashed_at IS NOT NULL ORDER BY id",
  );
  const allDocs = [...liveDocs, ...trashedDocs];
  const liveFolders = ids(
    db,
    "SELECT id FROM folders WHERE trashed_at IS NULL ORDER BY id",
  );
  // Trash units: a trashed folder whose parent isn't in its group.
  const trashedRoots = ids(
    db,
    `SELECT id FROM folders f WHERE trashed_at IS NOT NULL AND (parent_id IS NULL
       OR parent_id NOT IN (SELECT id FROM folders g WHERE g.trash_group = f.trash_group))
     ORDER BY id`,
  );
  const tags = ids(db, "SELECT id FROM tags ORDER BY id");
  const linkKeys = ids(db, "SELECT link_key FROM docs ORDER BY id");
  const remember = (id: string) => {
    const row = db
      .prepare("SELECT link_key, lineage FROM docs WHERE id = ?")
      .get(id);
    identities.set(id, {
      linkKey: String(row?.link_key),
      lineage: String(row?.lineage),
    });
  };
  const op = rng.int(18);
  clock.advance(1000);
  switch (op) {
    case 0:
    case 1: {
      const folderId =
        rng.next() < 0.5 ? (rng.pick(liveFolders) ?? null) : null;
      remember(
        library.createDoc({ folderId, title: `Doc ${rng.int(100)}` }).id,
      );
      return "create";
    }
    case 2:
    case 3: {
      const id = rng.pick(liveDocs);
      if (!id) return "append (none)";
      library.load(id, OWNER);
      library.append(id, OWNER, {
        origin: "local",
        update: randomEdit(library.stateOf(id), rng, linkKeys),
      });
      library.close(id, OWNER);
      return "append";
    }
    case 4: {
      const id = rng.pick(liveDocs);
      if (!id) return "compact (none)";
      const { maxSeq } = library.load(id, OWNER);
      library.compact(id, OWNER, library.stateOf(id), maxSeq);
      library.close(id, OWNER);
      return "compact";
    }
    case 5: {
      const id = rng.pick(liveDocs);
      if (!id) return "trash (none)";
      library.trashDoc(id);
      return "trash";
    }
    case 6: {
      const id = rng.pick(trashedDocs);
      if (!id) return "restore (none)";
      library.restoreDoc(id);
      return "restore";
    }
    case 7: {
      const id = rng.pick(trashedDocs);
      if (!id) return "purge (none)";
      library.purgeDoc(id);
      return "purge";
    }
    case 8: {
      const parentId =
        rng.next() < 0.7 ? (rng.pick(liveFolders) ?? null) : null;
      library.createFolder({ name: `F${rng.int(100)}`, parentId });
      return "create folder";
    }
    case 9:
    case 15:
    case 16: {
      const roll = rng.int(3);
      if (roll === 0) {
        const id = rng.pick(liveFolders);
        if (!id) return "trash folder (none)";
        library.trashFolder(id);
        return "trash folder";
      }
      const id = rng.pick(trashedRoots);
      if (!id) return "folder trash (none)";
      if (roll === 2) {
        library.purgeFolder(id);
        return "purge folder";
      }
      // restoreFolder has no depth check (repair.test.ts, the failing
      // "restoring a folder never nests deeper than 4"): skip a restore
      // that would breach I2 until folders.ts checks it.
      const from = db
        .prepare(
          `SELECT f.trashed_from FROM folders f JOIN folders p ON p.id = f.trashed_from
           WHERE f.id = ? AND p.trashed_at IS NULL`,
        )
        .get(id)?.trashed_from;
      const shape = folderShape(db);
      if (
        typeof from === "string" &&
        shape.depth(from) + shape.height(id) > MAX_FOLDER_DEPTH
      )
        return "restore folder (skipped: engine depth bug)";
      library.restoreFolder(id);
      return "restore folder";
    }
    case 10: {
      const id = rng.pick(liveDocs);
      if (!id) return "duplicate (none)";
      remember(library.duplicateDoc(id).id);
      return "duplicate";
    }
    case 11: {
      const roll = rng.int(3);
      if (roll === 0 || tags.length < 2) {
        const tag = library.createTag(`tag ${rng.int(8)}`);
        const id = rng.pick(allDocs);
        if (tag && id) library.addTag(id, tag.id);
        return "tag";
      }
      const [from, into] = [rng.pick(tags), rng.pick(tags)];
      if (from && into && from !== into) library.mergeTags(from, into);
      return "merge tags";
    }
    case 12: {
      const target = rng.next() < 0.3 ? null : (rng.pick(liveFolders) ?? null);
      const item =
        rng.next() < 0.5
          ? { kind: "doc" as const, id: rng.pick(liveDocs) }
          : { kind: "folder" as const, id: rng.pick(liveFolders) };
      if (!item.id) return "move (none)";
      library.moveItems([{ kind: item.kind, id: item.id }], target);
      return "move";
    }
    case 13:
    case 14: {
      // The derive queue's path; sometimes a stale write, which must be refused.
      const id = rng.next() < 0.7 ? library.nextStale() : rng.pick(allDocs);
      if (!id) return "derive (none)";
      const head = headSeq(db, id);
      const rows = stubDerive(library.stateOf(id));
      if (head > 0 && rng.next() < 0.2) {
        const before = derivedSnapshot(db);
        expect(library.putDerived(id, head - 1, rows)).toBe("stale");
        expect(derivedSnapshot(db)).toEqual(before);
        return "derive (stale, refused)";
      }
      expect(library.putDerived(id, head, rows)).toBe("ok");
      return "derive";
    }
    default: {
      // An image reference, as the image store (P2.6b) writes one.
      const id = rng.pick(liveDocs);
      if (!id) return "image (none)";
      const hash = Array.from({ length: 64 }, () =>
        rng.int(16).toString(16),
      ).join("");
      db.prepare(
        "INSERT OR IGNORE INTO blobs (hash, mime, size, created_at, origin) VALUES (?, 'image/png', 1, 0, 'insert')",
      ).run(hash);
      db.prepare(
        "INSERT OR IGNORE INTO doc_blobs (doc_id, hash, kind) VALUES (?, ?, 'current')",
      ).run(id, hash);
      return "image";
    }
  }
}

function assertInvariants(identities: Map<string, Identity>, step: string) {
  const violations = invariantViolations(rawDb(library), identities, (id) =>
    library.stateOf(id),
  );
  expect({ step, violations }).toEqual({ step, violations: [] });
}

function check() {
  return checkLibrary(rawDb(library), host, clock.now);
}

describe("P1: random operations keep I1–I9, and check mode is a no-op", () => {
  for (const seed of [1, 2, 3, 5, 8, 13]) {
    test(`seed ${seed}`, () => {
      const rng = createRng(seed);
      const identities = new Map<string, Identity>();
      const counts = new Map<string, number>();
      for (let step = 0; step < 220; step += 1) {
        const name = randomOperation(rng, identities);
        counts.set(name, (counts.get(name) ?? 0) + 1);
        if (step % 10 === 9) {
          assertInvariants(identities, `${step} ${name}`);
          expect(check()).toEqual(CLEAN);
        }
      }
      assertInvariants(identities, "end");
      expect(check()).toEqual(CLEAN);
      drainWithStub(library);
      assertInvariants(identities, "drained");
      expect(check()).toEqual(CLEAN);
      expect(check()).toEqual(CLEAN);
      // The run exercised what it claims to.
      for (const name of [
        "create",
        "append",
        "compact",
        "trash",
        "restore",
        "purge",
        "create folder",
        "trash folder",
        "restore folder",
        "purge folder",
        "duplicate",
        "merge tags",
        "move",
        "derive",
        "image",
      ])
        expect({ name, ran: (counts.get(name) ?? 0) > 0 }).toEqual({
          name,
          ran: true,
        });
    }, 30_000);
  }
});

describe("P2: rebuild restores damaged derived rows exactly", () => {
  /** Documents linking to each other, edited, compacted and derived. */
  function buildLinkedLibrary(rng: Rng, count: number) {
    const created: string[] = [];
    for (let i = 0; i < count; i += 1)
      created.push(library.createDoc({ title: `Doc ${i}` }).id);
    const keys = ids(rawDb(library), "SELECT link_key FROM docs ORDER BY id");
    for (const id of created) {
      library.load(id, OWNER);
      for (let edit = 0; edit < 6; edit += 1)
        library.append(id, OWNER, {
          origin: "local",
          update: randomEdit(library.stateOf(id), rng, keys),
        });
      if (rng.next() < 0.5) {
        const { maxSeq } = library.load(id, OWNER);
        library.compact(id, OWNER, library.stateOf(id), maxSeq);
      }
      library.close(id, OWNER);
    }
    drainWithStub(library);
    return created;
  }

  function damage(db: SqliteDriver, rng: Rng, docs: readonly string[]) {
    const pickDoc = () => rng.pick(docs) as string;
    // Delete rows.
    db.prepare(
      "DELETE FROM links WHERE src_doc_id = ? AND ord = (SELECT MIN(ord) FROM links WHERE src_doc_id = ?)",
    ).run(pickDoc(), pickDoc());
    db.prepare("DELETE FROM doc_headings WHERE doc_id = ?").run(pickDoc());
    // Alter rows.
    db.prepare("UPDATE links SET target_key = ? WHERE src_doc_id = ?").run(
      rng.hex32(),
      pickDoc(),
    );
    db.prepare(
      "UPDATE doc_headings SET text = 'tampered', text_key = 'tampered', level = 6 WHERE doc_id = ?",
    ).run(pickDoc());
    // Add rows.
    db.prepare(
      `INSERT INTO links (src_doc_id, ord, target_key, text) VALUES (?, 900, ?, 'extra')`,
    ).run(pickDoc(), rng.hex32());
    db.prepare(
      `INSERT INTO doc_headings (doc_id, ord, toc_id, level, text, text_key)
       VALUES (?, 900, 'extra', 2, 'extra', 'extra')`,
    ).run(pickDoc());
    // Skew derived_seq and the hashes.
    db.prepare("UPDATE docs SET derived_seq = NULL WHERE id = ?").run(
      pickDoc(),
    );
    db.prepare(
      "UPDATE docs SET derived_seq = head_seq - 1 WHERE id = ? AND head_seq > 0",
    ).run(pickDoc());
    db.prepare("UPDATE docs SET links_hash = 'skewed' WHERE id = ?").run(
      pickDoc(),
    );
  }

  for (const seed of [21, 34, 55]) {
    test(`seed ${seed}`, () => {
      const rng = createRng(seed);
      const docs = buildLinkedLibrary(rng, 12);
      const db = rawDb(library);
      const healthy = derivedSnapshot(db);
      expect(healthy.links.length).toBeGreaterThan(0);
      expect(healthy.headings.length).toBeGreaterThan(0);

      damage(db, rng, docs);
      expect(derivedSnapshot(db)).not.toEqual(healthy);

      expect(library.resetDerived()).toBe(docs.length);
      expect(drainWithStub(library)).toBe(docs.length);
      expect(derivedSnapshot(db)).toEqual(healthy);
      // Idempotent: a second rebuild changes nothing in the end.
      expect(library.resetDerived()).toBe(docs.length);
      drainWithStub(library);
      expect(derivedSnapshot(db)).toEqual(healthy);
      expect(check()).toEqual(CLEAN);
    });
  }
});

describe("T22, engine half: the derive drain", () => {
  test("1,000 stale documents drain with the stub deriver", () => {
    const db = rawDb(library);
    const rng = createRng(1000);
    const insertDoc = db.prepare(
      `INSERT INTO docs (id, created_at, modified_at, lineage, link_key)
         VALUES (?, 0, 0, ?, ?)`,
    );
    const insertRow = db.prepare(
      "INSERT INTO updates (doc_id, data, origin, created_at) VALUES (?, ?, 'local', 0)",
    );
    const setHead = db.prepare(
      "UPDATE docs SET head_seq = ?, size_bytes = ? WHERE id = ?",
    );
    const empty = Y.encodeStateAsUpdate(new Y.Doc());
    db.exec("BEGIN");
    for (let i = 0; i < 1000; i += 1) {
      const id = `doc-${String(i).padStart(4, "0")}`;
      insertDoc.run(id, crypto.randomUUID(), rng.hex32());
      let state = empty;
      let size = 0;
      let seq = 0;
      for (let edit = 0; edit < 8; edit += 1) {
        const update = randomEdit(state, rng, []);
        state = Y.mergeUpdates([state, update]);
        seq = insertRow.run(id, update).lastInsertRowid;
        size += update.byteLength;
      }
      setHead.run(seq, size, id);
    }
    db.exec("COMMIT");

    const started = performance.now();
    const drained = drainWithStub(library);
    const ms = performance.now() - started;
    expect(drained).toBe(1000);
    expect(library.nextStale()).toBeNull();
    expect(check()).toEqual(CLEAN);
    console.info(
      `T22 engine drain: 1000 documents in ${ms.toFixed(0)} ms (${(ms / 1000).toFixed(2)} ms each); the renderer queue is LK4a`,
    );
  }, 60_000);
});
