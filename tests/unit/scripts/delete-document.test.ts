import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import {
  bootstrapDocumentActivityTable,
  isTombstoned,
} from "@/lib/security/activity-store";
import { closeDocumentSoftly } from "@/lib/security/closed-documents";
import { runDeleteDocument } from "@/scripts/delete-document";

const ID = "55555555-5555-4555-8555-555555555555";
let db: Database;

describe("runDeleteDocument", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    db.exec("CREATE TABLE documents (name TEXT PRIMARY KEY, data BLOB)");
    bootstrapDocumentActivityTable(db);
  });

  afterEach(() => {
    db.close();
  });

  it("deletes, tombstones and removes the closure row", () => {
    db.prepare("INSERT INTO documents (name, data) VALUES (?, ?)").run(
      ID,
      Buffer.from("{}"),
    );
    closeDocumentSoftly(db, ID, "Abuse", "global-tabs", 1000);

    expect(runDeleteDocument(db, ID)).toBe("deleted");
    expect(isTombstoned(db, ID)).toBe(true);
    expect(
      db.prepare("SELECT 1 FROM documents WHERE name = ?").get(ID),
    ).toBeNull();
    expect(
      db.prepare("SELECT 1 FROM document_closures WHERE name = ?").get(ID),
    ).toBeNull();
  });

  it("reports a missing document and still tombstones it", () => {
    expect(runDeleteDocument(db, ID)).toBe("missing");
    expect(isTombstoned(db, ID)).toBe(true);
  });

  it("refuses invalid and system ids", () => {
    expect(runDeleteDocument(db, "../x")).toBe("invalid");
    expect(runDeleteDocument(db, "playground")).toBe("invalid");
    expect(isTombstoned(db, "playground")).toBe(false);
  });
});
