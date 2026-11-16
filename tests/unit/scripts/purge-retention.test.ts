import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  bootstrapDocumentActivityTable,
  upsertDocumentActivity,
} from "@/lib/security/activity-store";
import {
  backupDatabase,
  PURGE_BACKUPS_KEPT,
  parsePurgeMode,
  previewRetentionPurge,
  runRetentionPurge,
} from "@/scripts/purge-retention";

const DAY = 24 * 60 * 60 * 1000;
const STALE = "44444444-4444-4444-4444-444444444444";
const FRESH = "55555555-5555-5555-5555-555555555555";

/** A database with one stale document, one fresh one and the playground. */
function seed(target: Database): void {
  target.exec("CREATE TABLE documents (name TEXT PRIMARY KEY, data BLOB)");
  bootstrapDocumentActivityTable(target);
  const insert = target.prepare(
    "INSERT INTO documents (name, data) VALUES (?, ?)",
  );
  for (const name of ["playground", STALE, FRESH]) {
    insert.run(name, Buffer.from("{}"));
  }
  upsertDocumentActivity(target, "playground", 10, 0);
  upsertDocumentActivity(target, STALE, 10, 0);
  upsertDocumentActivity(target, FRESH, 10, 40 * DAY);
}

const documentNames = (target: Database) =>
  (
    target.prepare("SELECT name FROM documents ORDER BY name").all() as Array<{
      name: string;
    }>
  ).map((row) => row.name);

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

describe("parsePurgeMode", () => {
  it("defaults to dry-run", () => {
    expect(parsePurgeMode(undefined)).toBe("dry-run");
    expect(parsePurgeMode("")).toBe("dry-run");
  });

  it.each(["off", "dry-run", "on"] as const)("accepts %p", (mode) => {
    expect(parsePurgeMode(mode)).toBe(mode);
  });

  it.each(["yes", "true", "ON", "dryrun"])("refuses %p", (value) => {
    expect(() => parsePurgeMode(value)).toThrow("PURGE_MODE");
  });
});

describe("previewRetentionPurge", () => {
  afterEach(() => {
    db?.close();
  });

  it("reports what a purge would delete and changes nothing", () => {
    db = new Database(":memory:");
    seed(db);
    db.prepare(
      "INSERT INTO document_tombstones (name, deleted_at) VALUES (?, ?)",
    ).run("66666666-6666-6666-6666-666666666666", -50 * DAY);
    // Cutoffs: documents idle since before day 20, tombstones before day -40.
    const options = { retentionDays: 30, nowMs: 50 * DAY };

    const preview = previewRetentionPurge(db, options);

    expect(preview).toEqual({
      wouldDeleteCount: 1,
      wouldDeleteNames: [STALE],
      staleTotal: 1,
      expiredTombstoneCount: 1,
    });
    expect(documentNames(db)).toEqual([STALE, FRESH, "playground"].sort());
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM document_tombstones").get(),
    ).toEqual({ n: 1 });

    // The real purge deletes exactly what the preview listed.
    expect(runRetentionPurge(db, options).deletedNames).toEqual(
      preview.wouldDeleteNames,
    );
  });

  it("counts the whole backlog but lists only one batch", () => {
    db = new Database(":memory:");
    seed(db);
    upsertDocumentActivity(db, FRESH, 10, 0);
    // A system document in the batch would take its slot (the purge skips it).
    upsertDocumentActivity(db, "playground", 10, 50 * DAY);

    const preview = previewRetentionPurge(db, {
      retentionDays: 30,
      nowMs: 50 * DAY,
      batchSize: 1,
    });

    expect(preview.wouldDeleteCount).toBe(1);
    expect(preview.staleTotal).toBe(2);
  });

  it("creates no tables in a database that has none", () => {
    db = new Database(":memory:");

    expect(previewRetentionPurge(db)).toEqual({
      wouldDeleteCount: 0,
      wouldDeleteNames: [],
      staleTotal: 0,
      expiredTombstoneCount: 0,
    });
    expect(db.prepare("SELECT name FROM sqlite_master").all()).toEqual([]);
  });
});

describe("backupDatabase", () => {
  let dir: string;
  afterEach(() => {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes a readable copy to backups/ next to the database", () => {
    dir = mkdtempSync(path.join(tmpdir(), "purge-backup-"));
    const dbPath = path.join(dir, "db.sqlite");
    db = new Database(dbPath);
    seed(db);

    const file = backupDatabase(db, dbPath, {
      nowMs: Date.UTC(2026, 10, 16, 3, 17),
    });

    expect(file).toBe(
      path.join(dir, "backups", "db-2026-11-16T03-17-00-000Z.sqlite"),
    );
    const copy = new Database(file, { readonly: true });
    expect(documentNames(copy)).toEqual(documentNames(db));
    copy.close();
  });

  it(`keeps the newest ${PURGE_BACKUPS_KEPT} backups`, () => {
    dir = mkdtempSync(path.join(tmpdir(), "purge-backup-"));
    const dbPath = path.join(dir, "db.sqlite");
    db = new Database(dbPath);
    seed(db);

    for (let day = 1; day <= PURGE_BACKUPS_KEPT + 2; day++) {
      backupDatabase(db, dbPath, { nowMs: Date.UTC(2026, 10, day) });
    }

    const kept = readdirSync(path.join(dir, "backups")).sort();
    expect(kept).toHaveLength(PURGE_BACKUPS_KEPT);
    expect(kept[0]).toBe("db-2026-11-03T00-00-00-000Z.sqlite");
  });

  it("throws when the backup cannot be written", () => {
    dir = mkdtempSync(path.join(tmpdir(), "purge-backup-"));
    const dbPath = path.join(dir, "db.sqlite");
    db = new Database(dbPath);
    seed(db);
    writeFileSync(path.join(dir, "backups"), "not a directory");

    expect(() => backupDatabase(db, dbPath)).toThrow();
  });
});

describe("purge-retention CLI", () => {
  const SCRIPT = path.resolve(process.cwd(), "scripts/purge-retention.ts");
  let dir: string;
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** A file database whose stale document is past the 30-day default. */
  const setup = () => {
    dir = mkdtempSync(path.join(tmpdir(), "purge-cli-"));
    const dbPath = path.join(dir, "db.sqlite");
    const target = new Database(dbPath);
    seed(target);
    upsertDocumentActivity(target, FRESH, 10, Date.now());
    target.close();
    return dbPath;
  };

  const run = (dbPath: string, mode: string | undefined) => {
    const env: Record<string, string> = {
      PATH: process.env.PATH ?? "",
      DB_PATH: dbPath,
    };
    if (mode !== undefined) env.PURGE_MODE = mode;
    const result = Bun.spawnSync(["bun", SCRIPT], { env });
    return { ...result, stderr: result.stderr.toString() };
  };

  const namesIn = (dbPath: string) => {
    const target = new Database(dbPath);
    const names = documentNames(target);
    target.close();
    return names;
  };

  it.each([
    ["unset", undefined, "retention_purge_dry_run"],
    ["dry-run", "dry-run", "retention_purge_dry_run"],
    ["off", "off", "retention_purge_skipped"],
  ])("deletes nothing when PURGE_MODE is %s", (_label, mode, event) => {
    const dbPath = setup();

    const result = run(dbPath, mode);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain(event);
    expect(namesIn(dbPath)).toContain(STALE);
    expect(existsSync(path.join(dir, "backups"))).toBe(false);
  });

  it("lists the documents a dry run would delete", () => {
    const dbPath = setup();

    const { stderr } = run(dbPath, "dry-run");

    const entry = JSON.parse(stderr.trim().split("\n").at(-1) ?? "{}");
    expect(entry.wouldDeleteNames).toEqual([STALE]);
  });

  it("backs up, then purges, when PURGE_MODE is on", () => {
    const dbPath = setup();

    const result = run(dbPath, "on");

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("retention_purge_backup_written");
    expect(result.stderr).toContain("retention_purge_completed");
    expect(namesIn(dbPath)).not.toContain(STALE);
    const [backup] = readdirSync(path.join(dir, "backups"));
    expect(namesIn(path.join(dir, "backups", backup))).toContain(STALE);
  });

  it("deletes nothing when the backup fails", () => {
    const dbPath = setup();
    writeFileSync(path.join(dir, "backups"), "not a directory");

    const result = run(dbPath, "on");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("retention_purge_backup_failed");
    expect(namesIn(dbPath)).toContain(STALE);
  });

  it("refuses an unknown PURGE_MODE", () => {
    const dbPath = setup();

    const result = run(dbPath, "yes");

    expect(result.exitCode).not.toBe(0);
    expect(namesIn(dbPath)).toContain(STALE);
  });
});
