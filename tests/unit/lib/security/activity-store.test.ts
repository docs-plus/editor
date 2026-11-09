import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  bootstrapDocumentActivityTable,
  countNonSystemDocuments,
  deleteDocumentPermanently,
  documentExists,
  isTombstoned,
  purgeStaleDocuments,
  purgeTombstones,
  upsertDocumentActivity,
} from "@/lib/security/activity-store";

let db: Database.Database;
function seedDocumentsTable(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      name TEXT PRIMARY KEY,
      data BLOB
    )
  `);
}

describe("activity-store", () => {
  afterEach(() => {
    db?.close();
  });

  it("bootstraps and upserts activity rows", () => {
    db = new Database(":memory:");
    bootstrapDocumentActivityTable(db);
    upsertDocumentActivity(db, "doc-a", 128, 1000);
    upsertDocumentActivity(db, "doc-a", 256, 2000);

    const row = db
      .prepare(
        "SELECT last_persisted_at, last_size_bytes FROM document_activity WHERE name = ?",
      )
      .get("doc-a") as { last_persisted_at: number; last_size_bytes: number };

    expect(row.last_persisted_at).toBe(2000);
    expect(row.last_size_bytes).toBe(256);
  });

  it("counts non-system documents only", () => {
    db = new Database(":memory:");
    seedDocumentsTable();
    db.prepare("INSERT INTO documents (name, data) VALUES (?, ?)").run(
      "playground",
      Buffer.from("{}"),
    );
    db.prepare("INSERT INTO documents (name, data) VALUES (?, ?)").run(
      "global-tabs",
      Buffer.from("{}"),
    );
    // Per-test tab lists count like any document (SEC-01), so they expire.
    db.prepare("INSERT INTO documents (name, data) VALUES (?, ?)").run(
      "global-tabs-abc",
      Buffer.from("{}"),
    );
    db.prepare("INSERT INTO documents (name, data) VALUES (?, ?)").run(
      "11111111-1111-1111-1111-111111111111",
      Buffer.from("{}"),
    );

    expect(countNonSystemDocuments(db)).toBe(2);
    expect(documentExists(db, "11111111-1111-1111-1111-111111111111")).toBe(
      true,
    );
  });

  it("purges stale docs and matching activity rows while skipping system docs", () => {
    db = new Database(":memory:");
    seedDocumentsTable();
    bootstrapDocumentActivityTable(db);

    const insertDoc = db.prepare(
      "INSERT INTO documents (name, data) VALUES (?, ?)",
    );
    insertDoc.run("playground", Buffer.from("{}"));
    insertDoc.run("global-tabs", Buffer.from("{}"));
    insertDoc.run("11111111-1111-1111-1111-111111111111", Buffer.from("{}"));
    insertDoc.run("22222222-2222-2222-2222-222222222222", Buffer.from("{}"));

    upsertDocumentActivity(db, "playground", 10, 100);
    upsertDocumentActivity(db, "global-tabs", 10, 100);
    upsertDocumentActivity(db, "11111111-1111-1111-1111-111111111111", 10, 100);
    upsertDocumentActivity(
      db,
      "22222222-2222-2222-2222-222222222222",
      10,
      9_000,
    );

    const result = purgeStaleDocuments(db, 1_000);

    expect(result.deletedCount).toBe(1);
    expect(result.deletedNames).toEqual([
      "11111111-1111-1111-1111-111111111111",
    ]);
    expect(documentExists(db, "11111111-1111-1111-1111-111111111111")).toBe(
      false,
    );
    expect(documentExists(db, "playground")).toBe(true);
    expect(documentExists(db, "global-tabs")).toBe(true);
  });

  it("tombstones deleted documents so they cannot be stored again (A01-4)", () => {
    db = new Database(":memory:");
    seedDocumentsTable();
    bootstrapDocumentActivityTable(db);
    const id = "11111111-1111-1111-1111-111111111111";
    db.prepare("INSERT INTO documents (name, data) VALUES (?, ?)").run(
      id,
      Buffer.from("{}"),
    );
    upsertDocumentActivity(db, id, 2, 1000);

    expect(deleteDocumentPermanently(db, id, 5000)).toBe(true);
    expect(documentExists(db, id)).toBe(false);
    expect(isTombstoned(db, id)).toBe(true);
    expect(
      db.prepare("SELECT 1 FROM document_activity WHERE name = ?").get(id),
    ).toBeUndefined();
    // A second delete is idempotent and reports nothing was stored.
    expect(deleteDocumentPermanently(db, id, 6000)).toBe(false);

    expect(purgeTombstones(db, 5999)).toBe(0);
    expect(purgeTombstones(db, 6001)).toBe(1);
    expect(isTombstoned(db, id)).toBe(false);
  });
});
