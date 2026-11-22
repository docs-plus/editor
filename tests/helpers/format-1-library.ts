/**
 * Writes a raw format-1 library, as P2.6 shipped it, for the format-2
 * migration tests and soak T24/T24b. Bytes are deterministic.
 */
import { Database } from "bun:sqlite";
import { join } from "node:path";

import * as Y from "yjs";

import { LIBRARY_FILE } from "@/desktop/storage/engine/library";
import { SCHEMA_V1 } from "@/desktop/storage/engine/schema";

export type Format1Options = {
  docs?: number;
  /** Bytes of text per document's first update. */
  docBytes?: number;
  folders?: number;
  /** Extra rows to append per document after the snapshot. */
  rowsPerDoc?: number;
};

const hex32 = (n: number) => n.toString(16).padStart(32, "0");
const uuid = (n: number) => {
  const h = n.toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${h}`;
};

export function docId(n: number) {
  return uuid(1_000_000 + n);
}

/**
 * Creates `<dir>/library.sqlite` at format 1 with folders, documents (one
 * trashed, one pinned), tags that collide only under `tagNameKey` ("Café"
 * and "cafe"), doc_tags, snapshots and update rows.
 */
export function writeFormat1Library(dir: string, options: Format1Options = {}) {
  const docs = options.docs ?? 20;
  const folders = options.folders ?? 3;
  const rowsPerDoc = options.rowsPerDoc ?? 3;
  const docBytes = options.docBytes ?? 256;
  const db = new Database(join(dir, LIBRARY_FILE), { create: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(SCHEMA_V1);
  const meta = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
  for (const [key, value] of [
    ["format_version", "1"],
    ["yjs_encoding", "v1"],
    ["library_id", uuid(1)],
    ["created_at", "1"],
    ["rev", "0"],
    ["unclean_exit", "0"],
  ])
    meta.run(key, value);
  db.exec("BEGIN");
  for (let f = 0; f < folders; f += 1)
    db.prepare(
      "INSERT INTO folders (id, parent_id, name, created_at, modified_at) VALUES (?, ?, ?, 1, 1)",
    ).run(uuid(10 + f), f === 0 ? null : uuid(10), `Folder ${f}`);
  const insertDoc = db.prepare(
    `INSERT INTO docs (id, title, folder_id, created_at, modified_at, lineage,
       link_key, pinned, pin_key, trashed_at, trashed_from, size_bytes)
     VALUES (?, ?, ?, 1, 1, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertUpdate = db.prepare(
    "INSERT INTO updates (doc_id, data, origin, created_at) VALUES (?, ?, 'local', 1)",
  );
  const insertSnapshot = db.prepare(
    "INSERT INTO snapshots (doc_id, data, upto_seq) VALUES (?, ?, ?)",
  );
  for (let d = 0; d < docs; d += 1) {
    const folder = folders > 0 && d % 2 === 0 ? uuid(10 + (d % folders)) : null;
    const trashed = d === 1;
    const pinned = d === 2;
    const ydoc = new Y.Doc();
    ydoc.clientID = d + 1;
    ydoc.getText("t").insert(0, `Doc ${d} `.padEnd(docBytes, "x"));
    const snapshot = Y.encodeStateAsUpdate(ydoc);
    let size = snapshot.byteLength;
    insertDoc.run(
      docId(d),
      `Doc ${d}`,
      folder,
      uuid(2_000_000 + d),
      hex32(3_000_000 + d),
      pinned ? 1 : 0,
      pinned ? "a0" : null,
      trashed ? 5 : null,
      trashed ? folder : null,
      0,
    );
    // The first row is folded into a snapshot, the rest stay as rows.
    const first = insertUpdate.run(docId(d), snapshot).lastInsertRowid;
    insertSnapshot.run(docId(d), snapshot, Number(first));
    db.prepare("DELETE FROM updates WHERE seq = ?").run(Number(first));
    for (let r = 0; r < rowsPerDoc; r += 1) {
      let update: Uint8Array = new Uint8Array();
      ydoc.once("update", (u: Uint8Array) => {
        update = u;
      });
      ydoc.getText("t").insert(0, `${r};`);
      insertUpdate.run(docId(d), update);
      size += update.byteLength;
    }
    db.prepare("UPDATE docs SET size_bytes = ? WHERE id = ?").run(
      size,
      docId(d),
    );
  }
  db.prepare("INSERT INTO tags (id, name, color) VALUES (?, ?, ?)").run(
    uuid(50),
    "Café",
    "red",
  );
  db.prepare("INSERT INTO tags (id, name, color) VALUES (?, ?, ?)").run(
    uuid(51),
    "cafe",
    null,
  );
  db.prepare("INSERT INTO tags (id, name, color) VALUES (?, ?, ?)").run(
    uuid(52),
    "Work",
    null,
  );
  const insertTag = db.prepare(
    "INSERT INTO doc_tags (doc_id, tag_id) VALUES (?, ?)",
  );
  const tag = (d: number, tagId: string) => {
    if (d < docs) insertTag.run(docId(d), tagId);
  };
  // "Café" has 2 documents, "cafe" 3: "cafe" wins the merge; doc 0 has both.
  tag(0, uuid(50));
  tag(3, uuid(50));
  tag(0, uuid(51));
  tag(4, uuid(51));
  tag(5, uuid(51));
  tag(6, uuid(52));
  db.exec("COMMIT");
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.close();
  return { cafeId: uuid(50), cafeLowerId: uuid(51), workId: uuid(52) };
}
