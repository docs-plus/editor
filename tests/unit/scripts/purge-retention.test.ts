import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
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
import { closeDocumentSoftly } from "@/lib/security/closed-documents";
import {
  backupDatabase,
  consumeDeployMarker,
  DEPLOY_MARKER_NAME,
  FIRST_BACKUP_NAME,
  PURGE_BACKUP_RETENTION_DAYS,
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
  it("closed documents are tombstoned after CLOSED_RETENTION_DAYS", () => {
    db = new Database(":memory:");
    db.exec("CREATE TABLE documents (name TEXT PRIMARY KEY, data BLOB)");
    bootstrapDocumentActivityTable(db);
    const id = "44444444-4444-4444-8444-444444444444";
    const DAY = 24 * 60 * 60 * 1000;
    db.prepare("INSERT INTO documents (name, data) VALUES (?, ?)").run(
      id,
      Buffer.from("{}"),
    );
    closeDocumentSoftly(db, id, "Closed", "global-tabs", 0);
    const tombstone = () =>
      db.prepare("SELECT 1 FROM document_tombstones WHERE name = ?").get(id);

    const early = runRetentionPurge(db, { nowMs: 6 * DAY });
    expect(early.closedNames).toEqual([]);
    expect(tombstone()).toBeNull();

    const late = runRetentionPurge(db, { nowMs: 7 * DAY + 1 });
    expect(late.closedNames).toEqual([id]);
    expect(tombstone()).not.toBeNull();
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
      wouldDeleteClosedNames: [],
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

  it("previews closed documents past the window and changes nothing", () => {
    db = new Database(":memory:");
    seed(db);
    closeDocumentSoftly(db, FRESH, "Fresh", "global-tabs", 40 * DAY);
    const options = { retentionDays: 30, nowMs: 48 * DAY };

    const preview = previewRetentionPurge(db, options);

    expect(preview.wouldDeleteClosedNames).toEqual([FRESH]);
    expect(documentNames(db)).toContain(FRESH);
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM document_closures").get(),
    ).toEqual({ n: 1 });
    // The real purge deletes exactly what the preview listed.
    expect(runRetentionPurge(db, options).closedNames).toEqual([FRESH]);
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
      wouldDeleteClosedNames: [],
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

  const setupFile = () => {
    dir = mkdtempSync(path.join(tmpdir(), "purge-backup-"));
    const dbPath = path.join(dir, "db.sqlite");
    db = new Database(dbPath);
    seed(db);
    return dbPath;
  };
  const backupsIn = () => readdirSync(path.join(dir, "backups")).sort();

  it("writes the first backup to db-first.sqlite, then dated copies", () => {
    const dbPath = setupFile();

    const first = backupDatabase(db, dbPath, { nowMs: Date.UTC(2026, 10, 1) });
    const second = backupDatabase(db, dbPath, {
      nowMs: Date.UTC(2026, 10, 16, 3, 17),
    });

    expect(first).toBe(path.join(dir, "backups", FIRST_BACKUP_NAME));
    expect(second).toBe(
      path.join(dir, "backups", "db-2026-11-16T03-17-00-000Z.sqlite"),
    );
    for (const file of [first, second]) {
      const copy = new Database(file, { readonly: true });
      expect(documentNames(copy)).toEqual(documentNames(db));
      copy.close();
    }
    expect(backupsIn()).not.toContainEqual(expect.stringMatching(/partial/));
  });

  it(`deletes dated backups after ${PURGE_BACKUP_RETENTION_DAYS} days, however many there are`, () => {
    const dbPath = setupFile();
    const start = Date.UTC(2026, 10, 1);

    // The first, then 20 a day for 20 days (a busy deploy day included).
    backupDatabase(db, dbPath, { nowMs: start });
    for (let day = 0; day < 20; day++) {
      for (let run = 0; run < 20; run++) {
        backupDatabase(db, dbPath, {
          nowMs: start + day * DAY + (run + 1) * 60_000,
        });
      }
    }

    const kept = backupsIn();
    const now = start + 19 * DAY + 20 * 60_000;
    const cutoff = now - PURGE_BACKUP_RETENTION_DAYS * DAY;
    const dated = kept.filter((name) => name !== FIRST_BACKUP_NAME);
    // Every dated backup inside the window survives, every older one is gone.
    expect(dated).toHaveLength(20 * 14 + 1);
    expect(
      dated[0] >=
        `db-${new Date(cutoff).toISOString().replace(/[:.]/g, "-")}.sqlite`,
    ).toBe(true);
  });

  it("removes copies a killed run left half-written", () => {
    const dbPath = setupFile();
    mkdirSync(path.join(dir, "backups"));
    writeFileSync(
      path.join(dir, "backups", "db-2026-11-01T03-17-00-000Z.sqlite.partial"),
      "half a copy",
    );

    backupDatabase(db, dbPath, { nowMs: Date.UTC(2026, 10, 16) });

    expect(backupsIn()).toEqual([FIRST_BACKUP_NAME]);
  });

  it("never deletes db-first.sqlite", () => {
    const dbPath = setupFile();

    backupDatabase(db, dbPath, { nowMs: Date.UTC(2020, 0, 1) });
    backupDatabase(db, dbPath, { nowMs: Date.UTC(2026, 10, 16) });

    expect(backupsIn()).toEqual([
      "db-2026-11-16T00-00-00-000Z.sqlite",
      FIRST_BACKUP_NAME,
    ]);
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

describe("consumeDeployMarker", () => {
  let dir: string;
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const marker = (writtenAtSeconds: number) => {
    dir = mkdtempSync(path.join(tmpdir(), "purge-marker-"));
    writeFileSync(path.join(dir, DEPLOY_MARKER_NAME), `${writtenAtSeconds}\n`);
    return path.join(dir, "db.sqlite");
  };

  it("is true for a fresh marker next to the database, and deletes it", () => {
    const dbPath = marker(1_000);

    expect(consumeDeployMarker(dbPath, 1_005_000)).toBe(true);
    expect(existsSync(path.join(dir, DEPLOY_MARKER_NAME))).toBe(false);
    expect(consumeDeployMarker(dbPath, 1_006_000)).toBe(false);
  });

  it("ignores and deletes a stale marker", () => {
    const dbPath = marker(1_000);

    expect(consumeDeployMarker(dbPath, 1_000_000 + 11 * 60_000)).toBe(false);
    expect(existsSync(path.join(dir, DEPLOY_MARKER_NAME))).toBe(false);
  });

  it("is false without a marker", () => {
    dir = mkdtempSync(path.join(tmpdir(), "purge-marker-"));

    expect(consumeDeployMarker(path.join(dir, "db.sqlite"))).toBe(false);
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
    expect(readdirSync(path.join(dir, "backups"))).toEqual([FIRST_BACKUP_NAME]);
    expect(namesIn(path.join(dir, "backups", FIRST_BACKUP_NAME))).toContain(
      STALE,
    );
  });

  // scripts/deploy.sh writes the marker just before PM2 registers the app.
  it("exits without purging or backing up when a deploy started it", () => {
    const dbPath = setup();
    const markerFile = path.join(dir, DEPLOY_MARKER_NAME);
    writeFileSync(markerFile, `${Math.floor(Date.now() / 1000)}\n`);

    const result = run(dbPath, "on");

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("retention_purge_registered");
    expect(namesIn(dbPath)).toContain(STALE);
    expect(existsSync(path.join(dir, "backups"))).toBe(false);
    expect(existsSync(markerFile)).toBe(false);

    // The next run (the cron) purges.
    expect(run(dbPath, "on").stderr).toContain("retention_purge_completed");
    expect(namesIn(dbPath)).not.toContain(STALE);
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
