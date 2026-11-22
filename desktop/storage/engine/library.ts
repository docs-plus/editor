/**
 * One open library: the storage worker's whole state (architecture §5.4).
 * The worker owns exactly one `Library`; tests and the dev storage host
 * build one directly over `bun:sqlite`.
 *
 * **Open order** (architecture §5.4 `open.ts`, D-A6). Nothing that writes
 * runs before the `format_version` check, so a library made by a newer app
 * is never touched (soak T6):
 * 1. refuse a cloud-synced folder (`cloud_folder`);
 * 2. take `library.lock` (`locked_elsewhere`);
 * 3. pragmas: WAL, `synchronous=FULL`, foreign keys, and on macOS
 *    `fullfsync` and `checkpoint_fullfsync`;
 * 4. create the schema if the file is new (lineage and `library_id` from day
 *    one);
 * 5. `format_version` newer than the app → reopen read-only,
 *    `library_too_new`;
 * 6. `unclean_exit` still set → `quick_check`; a failure is read-only,
 *    `corrupt`;
 * 7. older → pre-migration copy, then the format steps (`migration_failed`
 *    is read-only);
 * 8. set `unclean_exit`; {@link Library.shutdown} clears it.
 *
 * **Registry** (architecture §5.2, §6.2): a document is open in at most one
 * window (D-A3). `load` claims it for an owner (a window id) and rejects
 * another owner with `already_open`; appends and compactions from any
 * other owner are `forbidden` (and {@link Library.claim} re-registers holds
 * after a worker restart); main's own content writes (purge, and P2.8's
 * import-into and restore) refuse an open document with `document_open`.
 */
import { cloudFolderOf } from "./cloud-folder";
import {
  type AppendInput,
  append,
  compact,
  type LoadedContent,
  load,
  pendingRows,
  stateOf,
} from "./content";
import { copyLibraryBatched } from "./copy-library";
import {
  DAILY_DIR,
  type DailyCopyJob,
  dailyCopyName,
  finishDailyCopy,
  listDailyCopies,
  localDate,
  planDailyCopy,
  sweepPartialCopies,
} from "./daily-copy";
import * as derive from "./derive";
import * as docsCopy from "./docs-copy";
import type { OpenSqlite, SqliteDriver, SqlRow } from "./driver";
import { checkpointTruncate, storageErrorFrom } from "./driver";
import { StorageError } from "./errors";
import * as folders from "./folders";
import type { StorageHost } from "./host";
import * as index from "./library-index";
import { acquireLock, releaseLock } from "./lock";
import {
  FORMAT_STEPS,
  type FormatStep,
  readFormatVersion,
  runFormatSteps,
} from "./migrations";
import * as queries from "./queries";
import * as repair from "./repair";
import { FORMAT_VERSION, SCHEMA_V1, YJS_ENCODING } from "./schema";
import { readMeta, readRev, scalar, transaction, writeMeta } from "./sql";
import * as tags from "./tags";

export const LIBRARY_FILE = "library.sqlite";
/** Idle jobs (daily copy, Trash purge) wait for this long without a write. */
export const IDLE_MS = 30_000;

export type ReadOnlyReason = "library_too_new" | "migration_failed" | "corrupt";

export type LibraryStatus = {
  readOnly: ReadOnlyReason | null;
  formatVersion: number;
  /** The previous session did not shut down cleanly. */
  uncleanExit: boolean;
  /** `quick_check`'s verdict after an unclean exit; null when it didn't run. */
  quickCheck: "ok" | string | null;
  libraryId: string;
};

/** Protocol lines for the durability soak (written to fd 1 by the worker). */
export type Trace = (line: string) => void;

export type OpenLibraryOptions = {
  dir: string;
  host: StorageHost;
  openSqlite: OpenSqlite;
  /** Default on; the T3 control turns it off. macOS only. */
  fullfsync?: boolean;
  /** Default `FULL`; the soak's atomicity control uses `OFF`. */
  synchronous?: "FULL" | "OFF";
  /** For tests: the format this "app" writes, and the steps that reach it. */
  formatVersion?: number;
  formatSteps?: readonly FormatStep[];
  trace?: Trace;
  /** How long without a write counts as idle; default {@link IDLE_MS}. Soak only. */
  idleMs?: number;
  /** Soak T24b only: called at each statement boundary of a migration. */
  migrationBoundary?: (name: string) => void;
};

function applyPragmas(
  db: SqliteDriver,
  host: StorageHost,
  options: OpenLibraryOptions,
) {
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`PRAGMA synchronous = ${options.synchronous ?? "FULL"}`);
  db.exec("PRAGMA foreign_keys = ON");
  // Delete forever overwrites freed pages it can (SEC-005).
  db.exec("PRAGMA secure_delete = FAST");
  if (host.platform === "darwin" && options.fullfsync !== false) {
    db.exec("PRAGMA fullfsync = 1");
    db.exec("PRAGMA checkpoint_fullfsync = 1");
  }
}

function hasTable(db: SqliteDriver, name: string): boolean {
  return (
    scalar(
      db,
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
      name,
    ) !== undefined
  );
}

/**
 * Creates a format-1 library; `open` then runs the format steps on it (with
 * no rows and no backup), so a fresh file and a migrated one are the same.
 */
function createLibrary(db: SqliteDriver, now: number) {
  const tables = Number(
    scalar(db, "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table'"),
  );
  if (tables > 0)
    throw new StorageError("corrupt", "not a TinyDocy library (no meta)");
  transaction(db, () => {
    db.exec(SCHEMA_V1);
    writeMeta(db, "format_version", "1");
    writeMeta(db, "yjs_encoding", YJS_ENCODING);
    writeMeta(db, "library_id", crypto.randomUUID());
    writeMeta(db, "created_at", String(now));
    writeMeta(db, "rev", "0");
    writeMeta(db, "unclean_exit", "0");
  });
}

/** Free pages above this share of the file trigger an incremental vacuum. */
export const SPARSE_RATIO = 0.25;

/** Clean opens before pre-migration copies are deleted (SEC-005). */
export const CLEAN_OPENS_TO_KEEP_PRE_COPIES = 7;

/**
 * Counts an open after a clean exit at this format. After the seventh, the
 * `library.pre-v<n>` copies a migration left are deleted: the new format has
 * proven itself, and they hold old content (SEC-005).
 */
function countCleanOpen(db: SqliteDriver, host: StorageHost, dir: string) {
  const key = `clean_opens_v${readFormatVersion(db)}`;
  const count = Number.parseInt(readMeta(db, key) ?? "0", 10) + 1;
  writeMeta(db, key, String(count));
  if (count < CLEAN_OPENS_TO_KEEP_PRE_COPIES) return;
  for (const file of host.list(dir))
    if (/^library\.pre-v\d+-.*\.sqlite$/.test(file))
      host.remove(host.join(dir, file));
}

/**
 * `quick_check`'s verdict. A badly damaged file makes the pragma itself
 * throw ("database disk image is malformed"): that is a verdict too, so the
 * library opens read-only as `corrupt` and the SEC-009 rebuild can start.
 */
export function quickCheck(db: SqliteDriver): string {
  let rows: SqlRow[];
  try {
    rows = db.prepare("PRAGMA quick_check").all();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  const messages = rows.map((row) => String(Object.values(row)[0]));
  return messages.length === 1 && messages[0] === "ok"
    ? "ok"
    : messages.slice(0, 5).join("; ");
}

const SYNC_LEVELS = ["OFF", "NORMAL", "FULL", "EXTRA"] as const;

/**
 * Runs `body` (one transaction) with `synchronous = NORMAL`, then puts the
 * connection's level back. For derived rows only (soak T21): they are a
 * cache, so a power cut that loses them and their `derived_seq` together
 * leaves the document stale, to be derived again, while skipping the fsync
 * (F_FULLFSYNC on macOS, FlushFileBuffers on Windows: 4–10 ms) keeps a read
 * queued behind a derive from waiting for the disk. WAL keeps the commit
 * consistent, and the next FULL commit syncs it.
 */
function withoutSync<T>(db: SqliteDriver, body: () => T): T {
  const level = SYNC_LEVELS[Number(scalar(db, "PRAGMA synchronous"))] ?? "FULL";
  if (level === "OFF" || level === "NORMAL") return body();
  db.exec("PRAGMA synchronous = NORMAL");
  try {
    return body();
  } finally {
    db.exec(`PRAGMA synchronous = ${level}`);
  }
}

export class Library {
  readonly dir: string;
  readonly path: string;
  readonly status: LibraryStatus;
  private db: SqliteDriver | null;
  private readonly host: StorageHost;
  private readonly openSqlite: OpenSqlite;
  private readonly lockPath: string;
  private readonly holders = new Map<string, string>();
  private readonly trace: Trace | undefined;
  private lastWriteAt: number;
  private changes = new Map<string, index.IndexChange>();
  private lastDailyCopyError: string | null = null;
  private lastDailyCopyMs: number | null = null;
  private copyJob: DailyCopyJob | null = null;
  private readonly idleMs: number;

  private constructor(fields: {
    dir: string;
    path: string;
    status: LibraryStatus;
    db: SqliteDriver;
    host: StorageHost;
    openSqlite: OpenSqlite;
    lockPath: string;
    trace: Trace | undefined;
    idleMs: number;
  }) {
    this.dir = fields.dir;
    this.path = fields.path;
    this.status = fields.status;
    this.db = fields.db;
    this.host = fields.host;
    this.openSqlite = fields.openSqlite;
    this.lockPath = fields.lockPath;
    this.trace = fields.trace;
    this.idleMs = fields.idleMs;
    this.lastWriteAt = fields.host.now();
  }

  static open(options: OpenLibraryOptions): Library {
    const { dir, host, openSqlite } = options;
    const target = options.formatVersion ?? FORMAT_VERSION;
    host.mkdirp(dir);
    const cloud = cloudFolderOf(dir, host);
    if (cloud) throw new StorageError("cloud_folder", cloud);
    const lockPath = acquireLock(host, dir);
    const path = host.join(dir, LIBRARY_FILE);
    let db: SqliteDriver | null = null;
    try {
      db = openSqlite(path, { readOnly: false });
      const fresh = !hasTable(db, "meta");
      // Only takes effect on an empty file, before journal_mode writes its
      // header: compaction gives freed pages back (T23).
      if (fresh) db.exec("PRAGMA auto_vacuum = INCREMENTAL");
      applyPragmas(db, host, options);
      if (fresh) createLibrary(db, host.now());
      const version = readFormatVersion(db);
      const libraryId = readMeta(db, "library_id") ?? "";
      const status: LibraryStatus = {
        readOnly: null,
        formatVersion: version,
        uncleanExit: false,
        quickCheck: null,
        libraryId,
      };
      if (version > target) {
        db.close();
        db = openSqlite(path, { readOnly: true });
        status.readOnly = "library_too_new";
      } else {
        status.uncleanExit = readMeta(db, "unclean_exit") !== "0";
        if (status.uncleanExit) {
          status.quickCheck = quickCheck(db);
          if (status.quickCheck !== "ok") status.readOnly = "corrupt";
        }
        if (!status.readOnly && version < target) {
          try {
            status.formatVersion = runFormatSteps(
              db,
              host,
              dir,
              target,
              options.formatSteps ?? FORMAT_STEPS,
              {
                fresh,
                log: (entry) => options.trace?.(`MIGRATION ${entry}`),
                boundary: options.migrationBoundary,
              },
            );
          } catch (error) {
            if (
              !(error instanceof StorageError) ||
              error.code !== "migration_failed"
            )
              throw error;
            status.readOnly = "migration_failed";
            status.formatVersion = readFormatVersion(db);
          }
        }
        if (!status.readOnly) {
          if (!status.uncleanExit) countCleanOpen(db, host, dir);
          writeMeta(db, "unclean_exit", "1");
          sweepPartialCopies(host, dir);
        }
      }
      return new Library({
        dir,
        path,
        status,
        db,
        host,
        openSqlite,
        lockPath,
        trace: options.trace,
        idleMs: options.idleMs ?? IDLE_MS,
      });
    } catch (error) {
      try {
        db?.close();
      } catch {
        // Already failing; the original error matters.
      }
      releaseLock(host, lockPath);
      throw storageErrorFrom(error);
    }
  }

  private get conn(): SqliteDriver {
    if (!this.db)
      throw new StorageError("library_unavailable", "library is closed");
    return this.db;
  }

  private assertWritable() {
    if (this.status.readOnly)
      throw new StorageError(
        this.status.readOnly === "library_too_new"
          ? "library_too_new"
          : "library_read_only",
        this.status.readOnly,
      );
  }

  /** Content writes from the renderer: refused while another owner holds the doc. */
  /**
   * Content writes from the renderer: only the window holding the document
   * may write it (architecture §7: "the registry must hold docId open for
   * this window"). Main checks this first; the worker checks again.
   */
  private assertWriter(docId: string, owner: string) {
    if (this.holders.get(docId) !== owner)
      throw new StorageError(
        "forbidden",
        "this window has not opened the document",
      );
  }

  /** Main's own content writes: refused while any window holds the doc. */
  private assertClosed(docId: string) {
    if (this.holders.has(docId))
      throw new StorageError("document_open", "document is open");
  }

  private wrote() {
    this.lastWriteAt = this.host.now();
  }

  private changed(kind: index.IndexChange["kind"], id: string) {
    this.changes.set(`${kind}:${id}`, { kind, id });
  }

  /**
   * The rows changed since the last call, with the current `rev`, or null
   * when nothing changed. The worker drains this after every request and
   * idle pass and sends `index_changed` (architecture §7, §8.1).
   */
  takeIndexChanges(): { rev: number; changes: index.IndexChange[] } | null {
    if (this.changes.size === 0 || !this.db) return null;
    const changes = [...this.changes.values()];
    this.changes.clear();
    return { rev: readRev(this.conn), changes };
  }

  // ── Content (DocStore) ────────────────────────────────────────────────

  load(docId: string, owner: string): LoadedContent {
    const holder = this.holders.get(docId);
    if (holder !== undefined && holder !== owner)
      throw new StorageError("already_open", "document is open elsewhere");
    const content = load(this.conn, docId);
    this.holders.set(docId, owner);
    if (!this.status.readOnly) {
      try {
        index.markOpened(this.conn, docId, this.host.now());
        this.changed("doc", docId);
      } catch {
        // "Opened" sorting is a nicety; opening must not fail on it.
      }
    }
    return content;
  }

  append(docId: string, owner: string, input: AppendInput): number {
    this.assertWritable();
    this.assertWriter(docId, owner);
    this.trace?.(`BATCH_BEGIN ${docId}`);
    const seq = append(this.conn, docId, input, this.host.now());
    this.trace?.(`ACK ${seq}`);
    this.wrote();
    this.changed("doc", docId);
    return seq;
  }

  compact(
    docId: string,
    owner: string,
    state: Uint8Array,
    upToSeq: number,
  ): { foreign: null } {
    this.assertWritable();
    this.assertWriter(docId, owner);
    this.trace?.(`COMPACT_BEGIN ${upToSeq} ${state.byteLength}`);
    compact(this.conn, docId, state, upToSeq);
    this.trace?.(`COMPACT_ACK ${upToSeq}`);
    this.wrote();
    this.vacuumIfSparse();
    return { foreign: null };
  }

  /**
   * Whether a document exists, without claiming it: main checks a deep
   * link with this, so a probe never holds a document a window is opening.
   */
  exists(docId: string): boolean {
    return (
      scalar(this.conn, "SELECT 1 FROM docs WHERE id = ?", docId) !== undefined
    );
  }

  /**
   * Re-registers a hold without loading: after a worker restart, main
   * replays its registry so the windows' resent batches are accepted.
   */
  claim(docId: string, owner: string): void {
    const holder = this.holders.get(docId);
    if (holder !== undefined && holder !== owner)
      throw new StorageError("already_open", "document is open elsewhere");
    if (
      scalar(this.conn, "SELECT 1 FROM docs WHERE id = ?", docId) === undefined
    )
      throw new StorageError("not_found", "no such document");
    this.holders.set(docId, owner);
  }

  close(docId: string, owner: string): void {
    if (this.holders.get(docId) === owner) this.holders.delete(docId);
  }

  /** A window closed or its renderer died: every hold it had is released. */
  releaseOwner(owner: string): void {
    for (const [docId, holder] of this.holders)
      if (holder === owner) this.holders.delete(docId);
  }

  isOpen(docId: string): boolean {
    return this.holders.has(docId);
  }

  /** The whole state of a closed document, for export (P2.8). */
  stateOf(docId: string): Uint8Array {
    return stateOf(load(this.conn, docId));
  }

  // ── Index ─────────────────────────────────────────────────────────────

  sidebar(): index.SidebarSnapshot {
    return index.sidebarSnapshot(this.conn);
  }

  createDoc(input: index.CreateDocInput = {}): index.CreatedDoc {
    this.assertWritable();
    const created = index.createDoc(this.conn, input, this.host.now());
    this.wrote();
    this.changed("doc", created.id);
    return created;
  }

  // Folders (folders.ts)

  createFolder(input: {
    id?: string;
    name: string;
    parentId?: string | null;
    sortKey?: string;
  }): { id: string; rev: number } | null {
    this.assertWritable();
    const created = folders.createFolder(this.conn, input, this.host.now());
    if (created) this.changed("folder", created.id);
    return created;
  }

  renameFolder(id: string, name: string): number {
    this.assertWritable();
    const rev = folders.renameFolder(this.conn, id, name, this.host.now());
    this.changed("folder", id);
    return rev;
  }

  setFolderView(
    id: string,
    columns: { sort: string | null; view: string | null; group: string | null },
  ): number {
    this.assertWritable();
    const rev = folders.setFolderView(this.conn, id, columns);
    this.changed("folder", id);
    return rev;
  }

  moveItems(
    items: readonly folders.FolderMoveItem[],
    folderId: string | null,
  ): folders.MoveResult {
    this.assertWritable();
    const result = folders.moveItems(this.conn, items, folderId);
    if (result.ok) for (const item of items) this.changed(item.kind, item.id);
    return result;
  }

  trashFolder(id: string) {
    this.assertWritable();
    const result = folders.trashFolder(this.conn, id, this.host.now());
    this.changed("folder", id);
    return result;
  }

  restoreFolder(id: string) {
    this.assertWritable();
    const result = folders.restoreFolder(this.conn, id);
    this.changed("folder", id);
    return result;
  }

  /** Main's own content write: refused while any document in it is open. */
  purgeFolder(id: string) {
    this.assertWritable();
    const result = folders.purgeFolder(
      this.conn,
      id,
      this.host.now(),
      (docId) => this.holders.has(docId),
    );
    this.afterPurge();
    this.changed("folder", id);
    for (const docId of result.docIds) this.changed("doc", docId);
    return result;
  }

  // Documents

  trashDoc(id: string): number {
    this.assertWritable();
    const rev = index.trashDoc(this.conn, id, this.host.now());
    this.changed("doc", id);
    return rev;
  }

  restoreDoc(id: string): { rev: number; folderId: string | null } {
    this.assertWritable();
    const result = index.restoreDoc(this.conn, id);
    this.changed("doc", id);
    return result;
  }

  purgeDoc(id: string): number {
    this.assertWritable();
    this.assertClosed(id);
    const rev = index.purgeDoc(this.conn, id, this.host.now());
    this.afterPurge();
    this.changed("doc", id);
    return rev;
  }

  duplicateDoc(id: string) {
    this.assertWritable();
    const created = docsCopy.duplicateDoc(this.conn, id, this.host.now());
    this.wrote();
    this.changed("doc", created.id);
    return created;
  }

  /** Main's own content write (P2.8b's backup restore). */
  restoreDocFromBackup(row: docsCopy.BackupDoc, state: Uint8Array) {
    this.assertWritable();
    const restored = docsCopy.restoreDocFromBackup(
      this.conn,
      row,
      state,
      this.host.now(),
    );
    this.wrote();
    this.changed("doc", restored.id);
    return restored;
  }

  /**
   * T23: when more than 25% of the file is free pages after a compaction,
   * give them back (`auto_vacuum = INCREMENTAL`, set when a library is
   * created). A no-op on a library created without it.
   */
  private vacuumIfSparse() {
    const db = this.conn;
    const pages = Number(scalar(db, "PRAGMA page_count"));
    const free = Number(scalar(db, "PRAGMA freelist_count"));
    if (pages > 0 && free / pages > SPARSE_RATIO)
      db.exec("PRAGMA incremental_vacuum");
  }

  /**
   * After a purge (SEC-005): truncate the WAL so the deleted pages don't
   * linger in it (`secure_delete` overwrites the ones in the main file).
   */
  private afterPurge() {
    this.wrote();
    checkpointTruncate(this.conn);
  }

  // Tags (tags.ts)

  createTag(name: string, color: string | null = null, id?: string) {
    this.assertWritable();
    const created = tags.createTag(this.conn, name, this.host.now(), color, id);
    if (created) this.changed("tag", created.id);
    return created;
  }

  renameTag(id: string, name: string): tags.TagRename {
    this.assertWritable();
    const result = tags.renameTag(this.conn, id, name);
    if (result.ok) this.changed("tag", id);
    return result;
  }

  mergeTags(fromId: string, intoId: string): number | false {
    this.assertWritable();
    const docIds = this.conn
      .prepare("SELECT doc_id FROM doc_tags WHERE tag_id = ?")
      .all(fromId)
      .map((row) => String(row.doc_id));
    const rev = tags.mergeTags(this.conn, fromId, intoId);
    if (rev !== false) {
      this.changed("tag", fromId);
      this.changed("tag", intoId);
      for (const docId of docIds) this.changed("doc", docId);
    }
    return rev;
  }

  addTag(docId: string, tagId: string): number | false {
    this.assertWritable();
    const rev = tags.addTag(this.conn, docId, tagId);
    if (rev !== false) this.changed("doc", docId);
    return rev;
  }

  removeTag(docId: string, tagId: string): number {
    this.assertWritable();
    const rev = tags.removeTag(this.conn, docId, tagId);
    this.changed("doc", docId);
    return rev;
  }

  setDocTags(docId: string, tagIds: readonly string[]): number {
    this.assertWritable();
    const rev = tags.setDocTags(this.conn, docId, tagIds);
    this.changed("doc", docId);
    return rev;
  }

  /** Stamps `opened_at` (`load` does this too). */
  markOpened(id: string): number {
    this.assertWritable();
    const rev = index.markOpened(this.conn, id, this.host.now());
    this.changed("doc", id);
    return rev;
  }

  // Repair (repair.ts, P2.6f)

  /** Check mode: idempotent, read-mostly; violations are reported. */
  repairCheck(): repair.RepairReport {
    this.assertWritable();
    return repair.checkLibrary(this.conn, this.host, this.host.now());
  }

  /**
   * Settings › Storage › Rebuild index: resets `derived_seq` in chunks, one
   * transaction each, so appends interleave. Returns how many were reset.
   */
  resetDerived(): number {
    this.assertWritable();
    let total = 0;
    for (;;) {
      const reset = repair.resetDerivedChunk(this.conn);
      total += reset;
      if (reset === 0) return total;
    }
  }

  // Pins, Manual order, list views, Trash list, search (queries.ts)

  pinDoc(id: string, pinKey: string): number {
    this.assertWritable();
    const rev = queries.pinDoc(this.conn, id, pinKey);
    this.changed("doc", id);
    return rev;
  }

  unpinDoc(id: string): number {
    this.assertWritable();
    const rev = queries.unpinDoc(this.conn, id);
    this.changed("doc", id);
    return rev;
  }

  setPinKeys(keys: readonly { id: string; key: string }[]): number {
    this.assertWritable();
    const rev = queries.setKeys(this.conn, "pin_key", keys);
    for (const { id } of keys) this.changed("doc", id);
    return rev;
  }

  setSortKeys(keys: readonly { id: string; key: string }[]): number {
    this.assertWritable();
    const rev = queries.setKeys(this.conn, "sort_key", keys);
    for (const { id } of keys) this.changed("doc", id);
    return rev;
  }

  setPlaceView(place: string, json: string | null): number {
    this.assertWritable();
    return queries.setPlaceView(this.conn, place, json);
  }

  placeViews(): Record<string, string> {
    return queries.placeViews(this.conn);
  }

  trashList() {
    return queries.trashList(this.conn);
  }

  snippets(ids: readonly string[]): Record<string, string> {
    return queries.snippets(this.conn, ids);
  }

  searchTitles(query: string) {
    return queries.searchTitles(this.conn, query);
  }

  searchHeadings(query: string) {
    return queries.searchHeadings(this.conn, query);
  }

  // Derived rows (derive.ts; LK4a's derive.put)

  putDerived(
    docId: string,
    atSeq: number,
    rows: derive.DerivedRows,
  ): derive.DeriveResult {
    this.assertWritable();
    const result = withoutSync(this.conn, () =>
      derive.putDerived(
        this.conn,
        () => this.host.sha256(),
        docId,
        atSeq,
        rows,
      ),
    );
    if (result === "ok") this.changed("doc", docId);
    return result;
  }

  /** The next document the derive queue should derive, or null. */
  nextStale(): string | null {
    return derive.nextStale(this.conn, (id) => this.holders.has(id));
  }

  backlinks(linkKey: string) {
    return derive.backlinks(this.conn, linkKey);
  }

  // ── Restore points ────────────────────────────────────────────────────

  listDailyCopies(): string[] {
    return listDailyCopies(this.host, this.dir).map((file) =>
      file.slice("library-".length, -".sqlite".length),
    );
  }

  /** One document's state in the daily copy of `date` (`YYYY-MM-DD`). */
  readDailyCopy(date: string, docId: string): Uint8Array {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
      throw new StorageError("invalid_argument", "bad date");
    const file = this.host.join(this.dir, DAILY_DIR, dailyCopyName(date));
    if (!this.host.exists(file))
      throw new StorageError("not_found", "no copy for that day");
    const copy = this.openSqlite(file, { readOnly: true });
    try {
      return stateOf(load(copy, docId));
    } finally {
      copy.close();
    }
  }

  // ── Jobs and lifecycle ────────────────────────────────────────────────

  private isIdle(): boolean {
    return (
      !this.status.readOnly &&
      this.db !== null &&
      this.host.now() - this.lastWriteAt >= this.idleMs
    );
  }

  /**
   * Starts today's daily copy when the library is idle and today has none:
   * the caller runs `copyLibraryBatched` on `job` (the worker, in its copy
   * thread), then calls {@link completeDailyCopy} or {@link failDailyCopy}.
   * One job at a time; null otherwise.
   */
  beginDailyCopy(): DailyCopyJob | null {
    if (this.copyJob || !this.isIdle()) return null;
    this.copyJob = planDailyCopy(
      this.conn,
      this.host,
      this.dir,
      this.path,
      this.host.now(),
    );
    if (this.copyJob) this.trace?.(`COPY_BEGIN ${this.copyJob.date}`);
    return this.copyJob;
  }

  completeDailyCopy(job: DailyCopyJob, ms: number | null = null): string {
    if (job !== this.copyJob)
      throw new StorageError("invalid_argument", "not the running copy");
    this.copyJob = null;
    const name = finishDailyCopy(this.conn, this.host, this.dir, job);
    this.lastDailyCopyError = null;
    this.lastDailyCopyMs = ms;
    this.trace?.(`COPY_DONE ${job.date}`);
    return name;
  }

  /**
   * Drops a copy that failed or was abandoned (quit): its partial file is
   * removed when it can be (the next open sweeps it otherwise), earlier
   * copies stay, and the next idle pass tries again.
   */
  failDailyCopy(job: DailyCopyJob, reason: string): void {
    if (job === this.copyJob) this.copyJob = null;
    try {
      this.host.remove(job.partial);
    } catch {
      // Still open in the copy thread (Windows); swept on the next open.
    }
    this.lastDailyCopyError = reason;
    this.trace?.(`COPY_ABANDONED ${job.date} ${reason}`);
  }

  /** Purges Trash older than 30 days, skipping open documents. */
  purgeExpiredTrash(): number {
    if (!this.isIdle()) return 0;
    const now = this.host.now();
    let purged = 0;
    for (const id of folders.expiredFolders(
      this.conn,
      now - index.TRASH_RETENTION_MS,
    )) {
      try {
        const result = folders.purgeFolder(this.conn, id, now, (docId) =>
          this.holders.has(docId),
        );
        this.changed("folder", id);
        for (const docId of result.docIds) this.changed("doc", docId);
        purged += result.docIds.length;
      } catch (error) {
        // A document in it is open: the next idle pass tries again.
        if (!(error instanceof StorageError && error.code === "document_open"))
          throw error;
      }
    }
    for (const id of index.expiredTrash(this.conn, now)) {
      if (this.holders.has(id)) continue;
      index.purgeDoc(this.conn, id, now);
      this.changed("doc", id);
      purged += 1;
    }
    if (purged > 0) checkpointTruncate(this.conn);
    return purged;
  }

  /**
   * Runs the idle jobs inline, on this thread: today's daily copy, then the
   * Trash purge. Tests, the dev host and the soak's year use it; the worker
   * runs the copy in its copy thread instead.
   */
  async runIdleJobs(): Promise<{
    dailyCopy: string | null;
    dailyCopyMs: number | null;
    purged: number;
  }> {
    const result = {
      dailyCopy: null as string | null,
      dailyCopyMs: null as number | null,
      purged: 0,
    };
    const job = this.beginDailyCopy();
    if (job) {
      const started = performance.now();
      result.dailyCopy = await this.copyInline(job);
      result.dailyCopyMs = performance.now() - started;
    }
    result.purged = this.purgeExpiredTrash();
    return result;
  }

  private async copyInline(job: DailyCopyJob): Promise<string | null> {
    const started = performance.now();
    try {
      await copyLibraryBatched(this.openSqlite, job.source, job.partial, {
        yieldNow: () => new Promise((resolve) => setTimeout(resolve, 0)),
      });
      return this.completeDailyCopy(job, performance.now() - started);
    } catch (error) {
      this.failDailyCopy(
        job,
        `daily_copy_failed: ${storageErrorFrom(error).code}`,
      );
      return null;
    }
  }

  /** Forces today's daily copy now, ignoring idle (diagnostics, tests). */
  async takeDailyCopyNow(): Promise<string | null> {
    this.assertWritable();
    if (this.copyJob) return null;
    const job = planDailyCopy(
      this.conn,
      this.host,
      this.dir,
      this.path,
      this.host.now(),
    );
    if (!job) return null;
    this.copyJob = job;
    return this.copyInline(job);
  }

  stats() {
    const db = this.conn;
    return {
      formatVersion: this.status.formatVersion,
      docs: Number(scalar(db, "SELECT COUNT(*) FROM docs")),
      pendingRows: pendingRows(db),
      bytes: Number(
        scalar(
          db,
          "SELECT page_count * page_size FROM pragma_page_count(), pragma_page_size()",
        ),
      ),
      lastDailyCopy: readMeta(db, "last_daily_copy"),
      lastDailyCopyError: this.lastDailyCopyError,
      lastDailyCopyMs: this.lastDailyCopyMs,
      dailyCopyRunning: this.copyJob !== null,
      today: localDate(this.host.now()),
      // Read back, as set (D-A6; S2 confirmed them on all three OSes).
      pragmas: {
        journalMode: scalar(db, "PRAGMA journal_mode"),
        synchronous: scalar(db, "PRAGMA synchronous"),
        fullfsync: scalar(db, "PRAGMA fullfsync"),
        checkpointFullfsync: scalar(db, "PRAGMA checkpoint_fullfsync"),
        foreignKeys: scalar(db, "PRAGMA foreign_keys"),
      },
      sqliteVersion: scalar(db, "SELECT sqlite_version()"),
      /** 2 = INCREMENTAL (new libraries); 0 on one created before it. */
      autoVacuum: scalar(db, "PRAGMA auto_vacuum"),
    };
  }

  /**
   * The quit flush's last step (architecture §8.2): every request queued
   * before this one has already committed (the worker handles one message
   * at a time), so checkpoint the WAL into the main file, clear
   * `unclean_exit`, close and release the lock. Safe to call twice.
   */
  shutdown(): void {
    const db = this.db;
    if (!db) return;
    // Quit never waits for a daily copy (its thread is the worker's to stop).
    if (this.copyJob) this.failDailyCopy(this.copyJob, "quit");
    try {
      if (!this.status.readOnly) {
        writeMeta(db, "unclean_exit", "0");
        checkpointTruncate(db);
      }
    } finally {
      this.db = null;
      db.close();
      releaseLock(this.host, this.lockPath);
    }
  }
}
