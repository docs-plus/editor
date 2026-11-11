import { Database } from "bun:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import {
  bootstrapDocumentActivityTable,
  upsertDocumentActivity,
} from "@/lib/security/activity-store";
import { runRetentionPurge } from "@/scripts/purge-retention";

let db: Database;
describe("runRetentionPurge", () => {
  afterEach(() => {
    db?.close();
  });

  it("purges stale non-system documents based on cutoff", () => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE documents (
        name TEXT PRIMARY KEY,
        data BLOB
      )
    `);
    bootstrapDocumentActivityTable(db);

    const insertDoc = db.prepare(
      "INSERT INTO documents (name, data) VALUES (?, ?)",
    );
    insertDoc.run("playground", Buffer.from("{}"));
    insertDoc.run("11111111-1111-1111-1111-111111111111", Buffer.from("{}"));
    insertDoc.run("22222222-2222-2222-2222-222222222222", Buffer.from("{}"));

    upsertDocumentActivity(db, "playground", 10, 1_000);
    upsertDocumentActivity(
      db,
      "11111111-1111-1111-1111-111111111111",
      10,
      1_000,
    );
    upsertDocumentActivity(
      db,
      "22222222-2222-2222-2222-222222222222",
      10,
      100_000,
    );

    const result = runRetentionPurge(db, {
      retentionDays: 1,
      // cutoff = nowMs - 1 day = 100_000 → only the 1_000 row is stale
      nowMs: 100_000 + 24 * 60 * 60 * 1000,
      batchSize: 50,
    });

    expect(result.deletedNames).toEqual([
      "11111111-1111-1111-1111-111111111111",
    ]);
    const remaining = db.prepare("SELECT name FROM documents").all() as Array<{
      name: string;
    }>;
    expect(remaining.map((row) => row.name).sort()).toEqual([
      "22222222-2222-2222-2222-222222222222",
      "playground",
    ]);
  });

  it("tombstones purged documents and keeps tombstones past the retention cutoff", () => {
    db = new Database(":memory:");
    db.exec("CREATE TABLE documents (name TEXT PRIMARY KEY, data BLOB)");
    bootstrapDocumentActivityTable(db);
    const id = "33333333-3333-3333-3333-333333333333";
    db.prepare("INSERT INTO documents (name, data) VALUES (?, ?)").run(
      id,
      Buffer.from("{}"),
    );
    upsertDocumentActivity(db, id, 10, 0);
    const DAY = 24 * 60 * 60 * 1000;
    const tombstone = () =>
      db
        .prepare("SELECT deleted_at FROM document_tombstones WHERE name = ?")
        .get(id);

    runRetentionPurge(db, { retentionDays: 30, nowMs: 31 * DAY });
    expect(tombstone()).toEqual({ deleted_at: 31 * DAY });

    // A later purge past the 30-day document cutoff keeps the tombstone...
    runRetentionPurge(db, { retentionDays: 30, nowMs: 31 * DAY + 60 * DAY });
    expect(tombstone()).not.toBeNull();
    // ...until TOMBSTONE_RETENTION_DAYS (default 90) have passed.
    runRetentionPurge(db, { retentionDays: 30, nowMs: 31 * DAY + 91 * DAY });
    expect(tombstone()).toBeNull();
  });
});
