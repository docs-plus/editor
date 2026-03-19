import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  bootstrapDocumentActivityTable,
  upsertDocumentActivity,
} from "@/lib/security/activity-store";
import { runRetentionPurge } from "@/scripts/purge-retention";

let db: Database.Database;
let sqliteAvailable = true;

try {
  const probe = new Database(":memory:");
  probe.close();
} catch {
  sqliteAvailable = false;
}

describe("runRetentionPurge", () => {
  afterEach(() => {
    db?.close();
  });

  (sqliteAvailable ? it : it.skip)(
    "purges stale non-system documents based on cutoff",
    () => {
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
        nowMs: 100_000,
        batchSize: 50,
      });

      expect(result.deletedNames).toEqual([
        "11111111-1111-1111-1111-111111111111",
      ]);
      const remaining = db
        .prepare("SELECT name FROM documents")
        .all() as Array<{ name: string }>;
      expect(remaining.map((row) => row.name).sort()).toEqual([
        "22222222-2222-2222-2222-222222222222",
        "playground",
      ]);
    },
  );
});
