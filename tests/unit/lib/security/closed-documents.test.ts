import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import * as Y from "yjs";

import { bootstrapDocumentActivityTable } from "@/lib/security/activity-store";
import {
  CLOSED_LIST_LIMIT,
  cleanClosedTitle,
  closeDocumentSoftly,
  closedCutoffMs,
  findClosedDocumentsToPurge,
  listClosedDocuments,
  purgeClosedDocuments,
  restoreClosedDocument,
  restoreClosedDocuments,
} from "@/lib/security/closed-documents";

let db: Database;

function seedDocument(name: string): void {
  db.prepare("INSERT INTO documents (name, data) VALUES (?, ?)").run(
    name,
    Buffer.from("{}"),
  );
}

function setActivity(name: string, lastPersistedAt: number): void {
  db.prepare(
    `INSERT INTO document_activity (name, last_persisted_at, last_size_bytes)
     VALUES (?, ?, 0)
     ON CONFLICT(name) DO UPDATE SET last_persisted_at = excluded.last_persisted_at`,
  ).run(name, lastPersistedAt);
}

function activityOf(name: string): number | null {
  const row = db
    .prepare("SELECT last_persisted_at FROM document_activity WHERE name = ?")
    .get(name) as { last_persisted_at: number } | null;
  return row?.last_persisted_at ?? null;
}

function hasRow(table: string, name: string): boolean {
  return Boolean(db.prepare(`SELECT 1 FROM ${table} WHERE name = ?`).get(name));
}

function tombstone(name: string, deletedAt = 1): void {
  db.prepare(
    "INSERT INTO document_tombstones (name, deleted_at) VALUES (?, ?)",
  ).run(name, deletedAt);
}

/** A real SQLITE_BUSY: a second connection holds the write lock. */
function captureBusyError(): unknown {
  const dir = mkdtempSync(path.join(tmpdir(), "busy-"));
  const file = path.join(dir, "db.sqlite");
  const holder = new Database(file);
  const waiter = new Database(file);
  try {
    holder.exec("PRAGMA journal_mode = WAL; CREATE TABLE t (x)");
    waiter.exec("PRAGMA busy_timeout = 0");
    holder.exec("BEGIN IMMEDIATE");
    try {
      waiter.exec("BEGIN IMMEDIATE");
    } catch (error) {
      return error;
    } finally {
      holder.exec("ROLLBACK");
    }
    throw new Error("expected SQLITE_BUSY");
  } finally {
    holder.close();
    waiter.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

/** `db`, except that the `failAt`-th closure delete throws `error`. */
function failingClosureDelete(
  db: Database,
  failAt: number,
  error: unknown,
): Database {
  let deletes = 0;
  return new Proxy(db, {
    get(target, prop) {
      if (prop === "prepare") {
        return (sql: string) => {
          const statement = target.prepare(sql);
          if (!sql.startsWith("DELETE FROM document_closures"))
            return statement;
          return new Proxy(statement, {
            get(stmt, key) {
              if (key === "run") {
                return (...args: unknown[]) => {
                  deletes++;
                  if (deletes === failAt) throw error;
                  return (stmt.run as (...a: unknown[]) => unknown)(...args);
                };
              }
              const value = Reflect.get(stmt, key);
              return typeof value === "function" ? value.bind(stmt) : value;
            },
          });
        };
      }
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

describe("closed-documents", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    db.exec("CREATE TABLE documents (name TEXT PRIMARY KEY, data BLOB)");
    bootstrapDocumentActivityTable(db);
  });

  afterEach(() => {
    db.close();
  });

  it("closes a document without touching its stored state", () => {
    seedDocument("a");
    expect(closeDocumentSoftly(db, "a", "Notes", "global-tabs", 1000)).toBe(
      "closed",
    );
    expect(hasRow("documents", "a")).toBe(true);
    expect(listClosedDocuments(db, "global-tabs", 0)).toEqual([
      { id: "a", title: "Notes", closedAt: 1000 },
    ]);
  });

  it("closing refreshes activity", () => {
    seedDocument("a");
    setActivity("a", 0);
    closeDocumentSoftly(db, "a", "", "global-tabs", 1000);
    expect(activityOf("a")).toBe(1000);

    seedDocument("b");
    setActivity("b", 5000);
    closeDocumentSoftly(db, "b", "", "global-tabs", 1000);
    expect(activityOf("b")).toBe(5000);
  });

  it("cleans titles", () => {
    expect([...cleanClosedTitle("x".repeat(300))]).toHaveLength(200);
    expect(cleanClosedTitle("‮Plan\u0000")).toBe("Plan");
    expect(cleanClosedTitle(5)).toBe("");
  });

  it("lists newest first, at most 20, inside the window", () => {
    expect(CLOSED_LIST_LIMIT).toBe(20);
    for (let i = 1; i <= 25; i++) {
      seedDocument(`d${i}`);
      closeDocumentSoftly(db, `d${i}`, `T${i}`, "global-tabs", i);
    }
    const all = listClosedDocuments(db, "global-tabs", 0);
    expect(all).toHaveLength(20);
    expect(all[0].closedAt).toBe(25);
    const recent = listClosedDocuments(db, "global-tabs", 10);
    expect(recent.every((doc) => doc.closedAt >= 10)).toBe(true);
  });

  it("lists only the caller's tab list", () => {
    seedDocument("a");
    closeDocumentSoftly(db, "a", "A", "global-tabs-w1", 1000);
    expect(listClosedDocuments(db, "global-tabs", 0)).toEqual([]);
    expect(listClosedDocuments(db, "global-tabs-w1", 0)).toEqual([
      { id: "a", title: "A", closedAt: 1000 },
    ]);
  });

  it("hides closures without a stored document", () => {
    closeDocumentSoftly(db, "never-stored", "X", "global-tabs", 1000);
    expect(listClosedDocuments(db, "global-tabs", 0)).toEqual([]);
  });

  it("hides tombstoned names and refuses their restore", () => {
    seedDocument("a");
    closeDocumentSoftly(db, "a", "A", "global-tabs", 1000);
    tombstone("a");
    expect(listClosedDocuments(db, "global-tabs", 0)).toEqual([]);
    expect(restoreClosedDocument(db, "a", 0, 2000)).toBe("gone");
  });

  it("closing a tombstoned name writes nothing", () => {
    seedDocument("a");
    tombstone("a");
    expect(closeDocumentSoftly(db, "a", "A", "global-tabs", 1000)).toBe("gone");
    expect(hasRow("document_closures", "a")).toBe(false);
  });

  it("restore deletes the closure and refreshes activity", () => {
    seedDocument("a");
    closeDocumentSoftly(db, "a", "A", "global-tabs", 1000);
    setActivity("a", 0);
    expect(restoreClosedDocument(db, "a", 0, 5000)).toBe("restored");
    expect(activityOf("a")).toBe(5000);
    expect(hasRow("document_closures", "a")).toBe(false);
    expect(restoreClosedDocument(db, "a", 0, 6000)).toBe("not_closed");
  });

  it("restores a batch in one transaction: a busy failure on the second id changes nothing", () => {
    for (const name of ["a", "b"]) {
      seedDocument(name);
      setActivity(name, 0);
      closeDocumentSoftly(db, name, name, "global-tabs", 1000);
    }
    const busy = captureBusyError();
    expect((busy as { code?: string }).code).toBe("SQLITE_BUSY");

    expect(() =>
      restoreClosedDocuments(
        failingClosureDelete(db, 2, busy),
        ["a", "b"],
        0,
        5000,
      ),
    ).toThrow();
    expect(hasRow("document_closures", "a")).toBe(true);
    expect(hasRow("document_closures", "b")).toBe(true);
    expect(activityOf("a")).toBe(1000);

    expect(restoreClosedDocuments(db, ["a", "b"], 0, 5000)).toEqual({
      a: "restored",
      b: "restored",
    });
  });

  it("restore past the window is gone", () => {
    seedDocument("a");
    closeDocumentSoftly(db, "a", "A", "global-tabs", 1000);
    expect(restoreClosedDocument(db, "a", 2000, 3000)).toBe("gone");
    expect(hasRow("document_closures", "a")).toBe(true);
  });

  it("purge tombstones closures older than the cutoff, in batches", () => {
    for (const [name, at] of [
      ["a", 1000],
      ["b", 1100],
      ["c", 9000],
    ] as const) {
      seedDocument(name);
      setActivity(name, at);
      closeDocumentSoftly(db, name, name, "global-tabs", at);
    }
    const result = purgeClosedDocuments(db, 5000, 1, 10000);
    expect(result).toEqual({ deletedCount: 2, deletedNames: ["a", "b"] });
    for (const name of ["a", "b"]) {
      expect(hasRow("documents", name)).toBe(false);
      expect(hasRow("document_activity", name)).toBe(false);
      expect(hasRow("document_closures", name)).toBe(false);
      const row = db
        .prepare("SELECT deleted_at FROM document_tombstones WHERE name = ?")
        .get(name) as { deleted_at: number };
      expect(row.deleted_at).toBe(10000);
    }
    expect(hasRow("documents", "c")).toBe(true);
    expect(hasRow("document_closures", "c")).toBe(true);
    expect(hasRow("document_tombstones", "c")).toBe(false);
  });

  it("purge keeps a closed document that is listed again in its tab list", () => {
    // A stale title update or reorder from another visitor can put the entry
    // back after the close: the tab is in use. Its closure stays, so the
    // next purge decides again once the list no longer holds it.
    const tabs = new Y.Doc();
    const entries = tabs.getArray("tabs");
    entries.push([
      { id: "playground", title: "Playground", createdAt: 0 },
      { id: "a", title: "A", createdAt: 1 },
    ]);
    const storeTabs = () =>
      db
        .prepare(
          `INSERT INTO documents (name, data) VALUES (?, ?)
           ON CONFLICT(name) DO UPDATE SET data = excluded.data`,
        )
        .run("global-tabs", Y.encodeStateAsUpdate(tabs));
    storeTabs();
    for (const name of ["a", "b"]) {
      seedDocument(name);
      closeDocumentSoftly(db, name, name, "global-tabs", 1000);
    }

    // Batches of one: the kept row must not stall the loop.
    const first = purgeClosedDocuments(db, 5000, 1, 10000);
    expect(first.deletedNames).toEqual(["b"]);
    expect(hasRow("documents", "a")).toBe(true);
    expect(hasRow("document_closures", "a")).toBe(true);
    expect(hasRow("document_tombstones", "a")).toBe(false);
    expect(hasRow("document_tombstones", "b")).toBe(true);

    entries.delete(1, 1);
    storeTabs();
    const second = purgeClosedDocuments(db, 5000, 1, 11000);
    expect(second.deletedNames).toEqual(["a"]);
    expect(hasRow("document_tombstones", "a")).toBe(true);
  });

  it("previews the closed purge without changing anything", () => {
    const tabs = new Y.Doc();
    tabs.getArray("tabs").push([{ id: "a", title: "A", createdAt: 1 }]);
    db.prepare("INSERT INTO documents (name, data) VALUES (?, ?)").run(
      "global-tabs",
      Y.encodeStateAsUpdate(tabs),
    );
    for (const [name, at] of [
      ["a", 1000],
      ["b", 1100],
      ["c", 9000],
    ] as const) {
      seedDocument(name);
      closeDocumentSoftly(db, name, name, "global-tabs", at);
    }

    // "a" is listed again and "c" is inside the window.
    expect(findClosedDocumentsToPurge(db, 5000)).toEqual(["b"]);
    for (const name of ["a", "b", "c"]) {
      expect(hasRow("documents", name)).toBe(true);
      expect(hasRow("document_closures", name)).toBe(true);
    }
    expect(purgeClosedDocuments(db, 5000, 100, 10000).deletedNames).toEqual([
      "b",
    ]);
  });

  it("purge ignores malformed entries in the stored tab list", () => {
    const tabs = new Y.Doc();
    tabs.getArray("tabs").push([{ id: "a", title: 5, createdAt: 1 }]);
    db.prepare("INSERT INTO documents (name, data) VALUES (?, ?)").run(
      "global-tabs",
      Y.encodeStateAsUpdate(tabs),
    );
    seedDocument("a");
    closeDocumentSoftly(db, "a", "A", "global-tabs", 1000);
    expect(purgeClosedDocuments(db, 5000, 1, 10000).deletedNames).toEqual([
      "a",
    ]);
  });

  it("computes the cutoff from the retention days", () => {
    expect(closedCutoffMs(10 * 86_400_000, 7)).toBe(3 * 86_400_000);
    expect(closedCutoffMs(10 * 86_400_000)).toBe(3 * 86_400_000);
  });
});
