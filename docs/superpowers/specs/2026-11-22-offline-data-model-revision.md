# Offline data model revision: format 2, the relationship layer and the offline feature matrix

- **Status:** Proposed (2026-11-22). The owner decides §9. Nothing here is built yet.
- **Author:** head of engineering. Folds in the data-architect draft and three critiques (staff data and migrations, performance, security and privacy).
- **Goal (the owner's):** people use the desktop app, and the web library, **fully offline with every feature**. This includes long documents, links and backlinks between documents, and all metadata: folders, tags, pins, dates, properties, images, comments, templates, imports and preferences. Sync to the server is opt-in, for sharing and collaboration.
- **Amends:**
  - [Desktop local-first plan v8](2026-11-15-desktop-local-first-design.md): §3.2, §8.4 Phase 2 rows and Gate 2.
  - [Desktop architecture](2026-11-15-desktop-architecture.md): §5.3 schema, §5.4 migrations, D-A3 and D-A7.
  - [Search and links](2026-11-16-search-linking-design.md): SL-8, §5 and the LK4 row.
  - [Image store](2026-11-16-image-store-design.md): §3.2 and §3.3 field names.
  - [Web library](2026-11-16-web-library-design.md): W2, W4 and W6.
  - [Comments](2026-11-16-comments-design.md): §6 `Author.id` becomes per document (SEC-002).
  - [Preferences](2026-11-16-preferences-design.md): the prefs JSON gains `v: 1` and one shared validator.

  This document wins over those for the points it names. Where it is silent, they stand.
- **Read against:**
  - `main` at `903b5c8`;
  - the branches `origin/feat/w2-web-library-storage` (W2), `origin/claude/feat-lk1-doc-links` (LK1) and `origin/claude/feat-p2-7b-library-lists-7047ba` (P2.7b);
  - the [Phase 2 status page](../plans/2026-11-22-phase-2-status.md) (PR #144).

---

## 1. Verdict

**The design meets the offline goal. The built storage and three spec rules do not yet.**

Content, metadata, comments and preferences are all local by design. Only sharing, live sync, embeds and the update check need the network. These are the gaps, all checked against code:

| # | Gap | Where |
|---|---|---|
| G1 | **No relationship store.** Format 1 has no `links` or headings table. Search-linking §5 rules out a background backfill, so imported, restored and never-opened documents show wrong backlinks. On a real library that breaks "every feature offline". | `TABLES_V1` in `desktop/storage/engine/schema.ts`; `STORES` in W2's `library-schema.ts`; search-linking §5 |
| G2 | **Integrity depends on the caller.** `docs.folder_id`, `folders.parent_id` and `docs.trashed_from` have no FKs. `folders` has no `trash_group` or `trashed_from`. The engine has no folder trash, restore or purge, no duplicate and no tag merge. `link_key` and `lineage` have no CHECK and are not frozen. | `schema.ts` `SCHEMA_V1`; `library-index.ts` |
| G3 | **The port is ahead of storage.** P2.7b's pins, tags, tag merge, list views, Manual order and folder trash exist only in the memory fake (`tests/helpers/memory-document-index.ts`). On the real app they would not persist. | P2.7b branch, `lib/platform/document-index.ts` |
| G4 | **The title has two writers.** `renameDoc` writes `docs.title` (`library-index.ts:188`), and the next `append` overwrites it through `COALESCE(?, title)` (`content.ts:124`). | as cited |
| G5 | **Derived data has no rebuild path.** Nothing recomputes title, snippet or links from content after an import, a restore or a derive bug. (`size_bytes` is already recomputed on `compact`, at `content.ts:186-190`, so it is not a gap.) | — |
| G6 | **No size policy for long documents on desktop.** There is no cap and no notice. The largest benchmark is `doc-near-cap` (1.9 MB), and the S2 5.26 MB figure used a single padded Yjs item (`desktop/storage-harness/gen.ts:25`). | — |
| G7 | **Web lazy chunks fail offline on first use.** The service worker precaches only `/offline` and `/`. | `lib/pwa/service-worker.ts` |
| G8 | **Data leaves the device unintentionally:** <br>• `stateOf` merges rows with `Y.mergeUpdates`, which keeps deleted text, and it is the export, restore and daily-copy read path (`content.ts:198`, `library.ts:399`, `library.ts:493`, `protocol.ts:39`); <br>• Linux spellcheck fetches dictionaries from `*.gvt1.com`, as reported by the P2.5 security review (not reproduced here); <br>• `<GoogleAnalytics />` (`app/layout.tsx:84`) is opt-in: it does nothing without `NEXT_PUBLIC_GA_*` and asks for consent first (`components/analytics/google-analytics.tsx:24-30`). But it is not gated on `APP_TARGET`, so a desktop build that inherits `.env.production`'s measurement id would show the consent prompt and, once granted, load GA from the network. | as cited |

**Recommendation:**
- Do one forward migration to **format 2** now, while no user library exists (§3).
- Add a **derived relationship layer** with structural staleness and a repair job (§4).
- Set a **size policy**, with benchmarks that are measured before their marks are fixed (§5).
- Split the work into the new rows in §7, and give each in-flight session the instructions in §8.

---

## 2. Principles

1. **One source of truth per fact.**
   - The Y.Doc owns everything derived from content: title, snippet, headings, links, image refs and comment threads.
   - SQL (desktop) and IndexedDB (web) own user intent: folders, tags, pins, Trash, list views, `link_key`, `lineage` and preferences.
   - Everything else is a **cache with a rebuild function**.
2. **Staleness is structural, not a flag.** Every append raises `head_seq` in the same transaction. A document is stale when `derived_seq IS NOT head_seq`. Import, restore, remote sync and migration therefore can't forget to mark a document dirty.
3. **The schema enforces integrity, and engine bugs fail loudly.** FKs use RESTRICT where a cascade would hide a bug. CHECKs cover enumerated and fixed-format columns. Triggers freeze identity.
4. **Rebuilds happen once.** Format 2 makes every change that needs a table rebuild. Every later change must be additive (a new table, column or index).
5. **No Yjs in main** (D-A3 stands). Derivation runs in a renderer Web Worker. The storage worker validates rows and computes hashes, but never parses a document's structure. It may call `Y.mergeUpdates` and `Y.encodeStateVectorFromUpdate`, as `stateOf` already does.
6. **Nothing leaves the device from raw rows.** Every outbound path (`.tinydoc`, Send a copy, backups, the mirror, Markdown, HTML and PDF, share upload) encodes from a garbage-collected `Y.Doc`.
7. **Both adapters run one contract.** Every engine transaction has the same contract suite on SQLite (`bun:sqlite` and `node:sqlite` in Electron) and on fake-IDB.

---

## 3. Revised schema: format 2, one forward step

### 3.1 Runner change (`desktop/storage/engine/migrations.ts`)

Today `runFormatSteps` wraps each step in `transaction()`, which is `BEGIN IMMEDIATE` (`sql.ts:10`). `PRAGMA foreign_keys` is a no-op inside a transaction. So:

- `FormatStep` gains `rebuild?: boolean` and `preflight?(db): PreflightReport`.
- **Order for a rebuild step:**
  1. The existing `VACUUM INTO library.pre-v1-<utc>.sqlite` backup.
  2. `preflight`, read-only (§3.3). Any blocking row aborts with `migration_failed` and the report, and writes nothing.
  3. `PRAGMA foreign_keys = OFF` and `PRAGMA temp_store = MEMORY`, outside any transaction. The second keeps rebuild spill out of `/tmp` (SEC-010).
  4. Snapshot the `updates` invariant: `COUNT(*)`, `SUM(LENGTH(data))`, and a running hash of `seq || data` in seq order.
  5. `BEGIN IMMEDIATE`, then the step body (§3.2).
  6. `PRAGMA foreign_key_check`. If it returns any row, roll back.
  7. Re-check the `updates` invariant. If it differs, roll back.
  8. `UPDATE meta SET value='2' WHERE key='format_version'`, then `COMMIT`.
  9. In a `finally`: `PRAGMA foreign_keys = ON`, and assert it reads back 1. Then `PRAGMA wal_checkpoint(TRUNCATE)`.
- **One step, one backup.** Format 2 is a single 1→2 step, so "earlier steps stay applied" never arises. When a second step exists, each rebuild step takes its own backup.
- **Pre-migration copies age out.** Once the new format has opened cleanly 7 times, its `pre-v<n>` copies are deleted (SEC-005). `PRE_MIGRATION_KEEP` stays as the upper bound.

### 3.2 The step (`FORMAT_STEPS[0]`, `to: 2`) and `SCHEMA_V2`

`SCHEMA_V2` creates the same final shape for fresh libraries. A schema test asserts that a fresh v2 file and a migrated v1 file have identical `sqlite_master` contents, ignoring table rowid order. Three tables are rebuilt: `folders`, `docs` and `tags`. `updates` and `snapshots` are **not** rebuilt: they hold the bytes.

```sql
-- Rebuilt: folders (FKs, folder trash, cycle guard)
CREATE TABLE folders_v2 (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES folders(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  sort_key TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  modified_at INTEGER NOT NULL,
  trashed_at INTEGER,
  trash_group TEXT,
  trashed_from TEXT REFERENCES folders(id) ON DELETE SET NULL,
  sort TEXT, view TEXT, "group" TEXT,
  CHECK (trashed_at IS NOT NULL OR (trash_group IS NULL AND trashed_from IS NULL)),
  CHECK (parent_id IS NULL OR parent_id <> id)
) STRICT;

-- Rebuilt: docs (FKs, CHECKs, staleness, normalized title)
CREATE TABLE docs_v2 (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  title_key TEXT NOT NULL DEFAULT '',              -- lib/search/normalize.ts, written by the worker
  folder_id TEXT REFERENCES folders(id) ON DELETE RESTRICT,
  sort_key TEXT NOT NULL DEFAULT '',
  pin_key TEXT,
  pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  created_at INTEGER NOT NULL,
  modified_at INTEGER NOT NULL,                    -- content edits only (D-O5)
  opened_at INTEGER,
  trashed_at INTEGER,
  trash_group TEXT,
  trashed_from TEXT REFERENCES folders(id) ON DELETE SET NULL,
  schema INTEGER NOT NULL DEFAULT 0,
  lineage TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  snippet TEXT NOT NULL DEFAULT '',
  mirrored_at INTEGER,
  link_key TEXT NOT NULL UNIQUE
    CHECK (length(link_key) = 32 AND link_key NOT GLOB '*[^0-9a-f]*'),
  kind TEXT NOT NULL DEFAULT 'doc' CHECK (kind IN ('doc', 'template')),
  head_seq INTEGER NOT NULL DEFAULT 0,             -- highest seq ever written; only rises
  derived_seq INTEGER,                             -- head_seq the derived rows reflect; NULL = never
  links_hash TEXT,                                 -- worker-computed, per side (§4.3)
  headings_hash TEXT,
  CHECK (trashed_at IS NOT NULL OR (trash_group IS NULL AND trashed_from IS NULL))
) STRICT;

-- Rebuilt: tags (Unicode-aware uniqueness)
CREATE TABLE tags_v2 (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE,                   -- tagNameKey(), lib/library/tag-rules.ts (P2.7b)
  color TEXT,                                      -- validated in code and at import (P2.9b palette)
  created_at INTEGER NOT NULL DEFAULT 0
) STRICT;

-- Copy (the worker computes title_key and name_key in JS between the CREATEs and the INSERTs),
-- then:
--   DROP TABLE docs; DROP TABLE folders; DROP TABLE tags;
--   ALTER TABLE folders_v2 RENAME TO folders; ALTER TABLE docs_v2 RENAME TO docs;
--   ALTER TABLE tags_v2 RENAME TO tags;
-- head_seq = MAX(COALESCE((SELECT MAX(seq) FROM updates u WHERE u.doc_id = docs.id), 0),
--                COALESCE((SELECT upto_seq FROM snapshots s WHERE s.doc_id = docs.id), 0));
-- derived_seq = NULL for every row (nothing was derived in format 1).

-- New: the relationship layer (derived; rebuildable)
CREATE TABLE links (
  src_doc_id TEXT NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL,                            -- index in extractLinks() output
  src_toc_id TEXT NOT NULL DEFAULT '',             -- '' = before the first heading
  target_key TEXT NOT NULL,                        -- a link_key; deliberately no FK (§4.6)
  target_toc_id TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL DEFAULT '',
  context TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (src_doc_id, ord)
) STRICT, WITHOUT ROWID;

CREATE TABLE doc_headings (
  doc_id TEXT NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL,
  toc_id TEXT NOT NULL,
  level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 6),
  text TEXT NOT NULL,
  text_key TEXT NOT NULL,                          -- normalized, written by the worker
  PRIMARY KEY (doc_id, ord)
) STRICT, WITHOUT ROWID;

-- New: the image store tables (image store §3.2), created here so P2.6b adds no DDL
CREATE TABLE blobs (
  hash TEXT PRIMARY KEY CHECK (length(hash) = 64 AND hash NOT GLOB '*[^0-9a-f]*'),
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  created_at INTEGER NOT NULL,
  origin TEXT NOT NULL                             -- insert | migration | import | fetched, validated in code
) STRICT;

CREATE TABLE doc_blobs (
  doc_id TEXT NOT NULL,                            -- deliberately no FK to docs (§4.6, GC grace)
  hash TEXT NOT NULL REFERENCES blobs(hash) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('provisional', 'current', 'version')),
  dropped_at INTEGER,
  PRIMARY KEY (doc_id, hash, kind)
) STRICT, WITHOUT ROWID;

-- import_sources: additive column plus a partial unique index
ALTER TABLE import_sources ADD COLUMN root_id TEXT;
CREATE UNIQUE INDEX import_sources_root_path ON import_sources(root_id, relative_path)
  WHERE root_id IS NOT NULL;

-- Indexes (each one serves a named query; §3.5)
CREATE INDEX docs_folder_list   ON docs(folder_id, trashed_at, opened_at);      -- kept from v1
CREATE INDEX docs_trashed       ON docs(trashed_at) WHERE trashed_at IS NOT NULL;
CREATE INDEX docs_trash_group   ON docs(trash_group) WHERE trash_group IS NOT NULL;
CREATE INDEX docs_trashed_from  ON docs(trashed_from) WHERE trashed_from IS NOT NULL;
CREATE INDEX docs_stale         ON docs(id) WHERE derived_seq IS NOT head_seq;
CREATE INDEX docs_title_key     ON docs(title_key) WHERE trashed_at IS NULL;
CREATE INDEX folders_parent     ON folders(parent_id);                          -- kept from v1
CREATE INDEX folders_trashed_from ON folders(trashed_from) WHERE trashed_from IS NOT NULL;
CREATE INDEX folders_trash_group  ON folders(trash_group) WHERE trash_group IS NOT NULL;
CREATE INDEX links_target       ON links(target_key, src_doc_id);
CREATE INDEX doc_headings_toc   ON doc_headings(doc_id, toc_id);
CREATE INDEX doc_headings_text  ON doc_headings(text_key);
CREATE INDEX doc_blobs_hash     ON doc_blobs(hash);

-- Triggers
CREATE TRIGGER docs_identity_frozen BEFORE UPDATE OF link_key, lineage ON docs
WHEN NEW.link_key IS NOT OLD.link_key OR NEW.lineage IS NOT OLD.lineage
BEGIN SELECT RAISE(ABORT, 'identity is frozen'); END;

CREATE TRIGGER docs_head_seq_rises BEFORE UPDATE OF head_seq ON docs
WHEN NEW.head_seq < OLD.head_seq
BEGIN SELECT RAISE(ABORT, 'head_seq only rises'); END;

CREATE TRIGGER folders_no_cycle BEFORE UPDATE OF parent_id ON folders
WHEN NEW.parent_id IS NOT NULL AND EXISTS (
  WITH RECURSIVE up(id) AS (
    SELECT NEW.parent_id
    UNION SELECT f.parent_id FROM folders f JOIN up ON f.id = up.id WHERE f.parent_id IS NOT NULL)
  SELECT 1 FROM up WHERE id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'folder cycle'); END;
```

**`folders_no_cycle` was compiled and exercised** on `bun:sqlite` (SQLite 3.54.0): the trigger is created, a cycle is refused, and a legal move passes. P2.6d asserts the same on `node:sqlite` in Electron. If that build rejects a `WITH` clause in a trigger, the cycle check moves into the engine's move-folder transaction and I2 stays as a repair assertion.

**CHECK policy:** CHECKs only on stable enums and fixed formats (`docs.kind`, `doc_blobs.kind`, `pinned`, `link_key`, `blobs.hash`, heading `level`). Open-ended sets (`updates.origin`, `blobs.origin`, tag colours) are validated in code, so adding a value never needs a format step (principle 4).

**Normalized keys** (`title_key`, `doc_headings.text_key`, `tags.name_key`) come from one pure core, `lib/search/normalize.ts` (search-linking §3.2: Unicode case fold, NFC, accents ignored). P2.6d ships that core, and SR1 extends it. `tagNameKey` (P2.7b, `lib/library/tag-rules.ts`) calls it. `meta.normalize_version` records the core's version. A later change recomputes the keys in chunks, merging any new `name_key` collisions with the `mergeTags` rule. That is not a format step.

**Not in the step, and why:**
- **`updates.origin`:** no CHECK. `content.ts:96` already validates it against `UPDATE_ORIGINS`. `lib/platform/doc-store.ts:28` says adding a value is a compatible change, and a CHECK would turn that into a format change. A CHECK would also force a rebuild of the table that holds the bytes.
- **`doc_tags`, `snapshots` and `doc_view`:** unchanged. `doc_view` already has `place` and `remote_images`.
- **`meta`:** new keys, no DDL:
  - `derive_version`: a mismatch with the bundle's `DERIVE_VERSION` resets `derived_seq` (§4.5).
  - `clean_opens_v2`: the count for aging out pre-migration copies.
  - `prefs`, whose JSON gains `v: 1`.

**Why RESTRICT and not CASCADE on folders.** A CASCADE purge would silently delete subfolders and leave their documents at the root without trashing them. RESTRICT turns that engine bug into a loud error. `purgeFolder` deletes bottom-up in one transaction.

### 3.3 Preflight (read-only, blocks the step)

The step **never coerces silently**. Before the backup is used, preflight reports:
- docs with `pinned NOT IN (0,1)`, a malformed `link_key`, or trash columns set without `trashed_at`;
- `docs.folder_id`, `docs.trashed_from` or `folders.parent_id` pointing at a missing folder;
- folder cycles;
- rows the existing `PRAGMA foreign_key_check` flags.

Any hit aborts with `migration_failed` and the list, and the library opens read-only (D-A6). No user library exists before Gate 2. Gate 2 builds create format 2 directly. So a hit means a developer or harness file, fixed by hand.

**The one deterministic merge:** tags whose names differ under `COLLATE NOCASE` but share a `tagNameKey` (for example "Ä" and "ä"). They merge into the tag with the most documents, ties broken by `id`, using the `mergeTags` rules (§4.2). The merge is listed in the migration log.

### 3.4 Copy, restore and the pragma contract (`copy-library.ts`, `library.ts`)

- **Table order is explicit,** not `sqlite_master` rowid order, because `ALTER … RENAME` keeps the old rowid. The order is `meta, folders, docs, tags, doc_tags, doc_view, import_sources, snapshots, updates, links, doc_headings, blobs, doc_blobs`. A test fails if a table is missing from the list.
- **Triggers are created after the rows,** as today. A test asserts that the copy has every trigger and FK of the live schema: the `sqlite_master` diff must be empty.
- **`PRAGMA foreign_key_check` runs on the copy** next to `integrity_check`, and again on any file before a restore swaps it in. `integrity_check` does not check FKs.
- **Every connection that writes sets `foreign_keys = ON`:** the worker (`library.ts:108`, already), the copy worker's destination after the copy, harnesses and the restore path. One test opens each and asserts it.
- **Delete forever:** set `PRAGMA secure_delete = FAST` at open, and run `wal_checkpoint(TRUNCATE)` after a purge (SEC-005). The Delete forever dialog says how long copies remain: daily copies 7 days, the mirror's `Deleted/` 30 days, pre-migration copies until 7 clean opens.

### 3.5 Index policy

Each index names the query it serves, and an `EXPLAIN QUERY PLAN` test asserts that the query uses it:

| Index | Query |
|---|---|
| `docs_trashed` | `expiredTrash` (`library-index.ts:278`), a full scan today |
| `docs_trash_group`, `folders_trash_group` | `restoreFolder`, `purgeFolder` |
| `docs_trashed_from`, `folders_trashed_from` | the `ON DELETE SET NULL` FK action when a folder is purged |
| `docs_stale` | the derive queue's `SELECT id … LIMIT 1` |
| `docs_title_key`, `doc_headings_text` | `index.searchTitles` / `searchHeadings` prefix scans: `>= ? AND < ? \|\| char(0x10FFFF)`, `LIMIT 50`, before any substring scan |
| `links_target` | backlinks for one `link_key` |

**Dropped from the draft:**
- `docs_modified` and `docs_pinned`: `sidebarSnapshot` (`library-index.ts:333-397`) reads every live document and the renderer sorts. They would serve no query and would cost an index write on every append batch.
- A covering index for the sidebar: the sidebar's cost at 10,000 documents is payload, structured clone and render, not SQL. `snippet` leaves `sidebarSnapshot` and is fetched lazily for visible Preview rows (P2.6e).

### 3.6 Web: W2's IndexedDB v1 takes the same shape

W2 is unmerged, so these changes go straight into its version 1, and `LIBRARY_DB_VERSION` stays 1.

- **Already done on the W2 branch:** `tags.by_name_key` (unique), `folders.by_parent`, `docs.by_link_key` (unique), and `persist()` requested by the §2.7 rules (`storage-health.ts`).
- **New stores:**
  - `links`: keyPath `["src_doc_id", "ord"]`, index `by_target` on `["target_key", "src_doc_id"]`.
  - `headings`: keyPath `["doc_id", "ord"]`, indexes `by_toc` on `["doc_id", "toc_id"]` and `by_text_key`.
  - `''` replaces every nullable key part, because IndexedDB drops a record from an index when any part of its key is null. W2's own comment on `list_key` explains this.
- **`docs` fields:**
  - new: `head_seq`, `derived_seq`, `links_hash`, `headings_hash`, `title_key`, and a `by_stale` index on a `stale` sentinel (`1` when `derived_seq !== head_seq`, otherwise `0`, written with every change to either);
  - `pinned` stays a boolean in the row and is mapped in `library.json`.
- **`folders` fields:** `trash_group`, `trashed_from`.
- **`doc_blobs` uses snake_case:** `doc_id`, `dropped_at`, keyPath `["doc_id", "hash", "kind"]`. Today it is `["docId", "hash", "kind"]`, the only camelCase store. This amends image store §3.3, so that `library.json` (LJ1) maps every store one to one.
- **Platform-only fields, listed in one place** (`lib/library-format/fields.ts`, LJ1):
  - web only: `exported_at`, `md_at`, `updates.writer`, `snapshots.rev`;
  - desktop only: `mirrored_at`.

  `library.json` never carries them.
- **Version rule:** `LIBRARY_DB_VERSION` bumps only when stores or indexes change. `format_version` bumps when row shapes change. Before any step that rewrites rows, a forced copy goes to `tinydocy-library.pre-v<n>` (the web twin of `VACUUM INTO`).
- **Eviction detection (W6):**
  - a sentinel row in `meta`, plus a second marker outside IndexedDB (a `localStorage` key carrying `library_id`);
  - at boot, if the marker exists and the database is empty or has a different `library_id`, show "Your local copy was cleared by the browser";
  - this is not an eviction defence; `persist()` and the 8 MiB cap (§5) are separate measures;
  - derived stores are recoverable, but `docs`, `updates` and `snapshots` are not.

---

## 4. The relationship layer and its invariants

### 4.1 Invariants (checked by `repair.ts` and the property tests)

| # | Invariant |
|---|---|
| I1 | `PRAGMA foreign_key_check` returns no rows. Web: the same checks in code over the stores. |
| I2 | The folder graph is a forest. Depth is at most 4 (P2.7a). |
| I3 | `trashed_at IS NULL` implies `trash_group` and `trashed_from` are NULL, on `docs` and `folders`. |
| I4 | Every live document's folder chain has no trashed folder. Trashing a folder trashes its subtree with one `trash_group`. |
| I5 | `link_key` and `lineage` never change after insert. A collision on restore inserts a new row (§4.2); it never updates one. |
| I6 | `head_seq` ≥ `MAX(seq)` of the document's `updates` and ≥ `snapshots.upto_seq`. It only rises (trigger). |
| I7 | `derived_seq` ≤ `head_seq`. If `derived_seq = head_seq`, the `links` and `doc_headings` rows equal a fresh derive of the state at `head_seq`. |
| I8 | No document's derived rows are written from a state older than its stored `derived_seq`. |
| I9 | `size_bytes` = snapshot length + the sum of the remaining `updates` lengths. |
| I10 | Compaction never loses an update. The new snapshot's state vector dominates the union of the state vectors of the rows it deletes. |
| I11 | Every hash referenced by current state, an unpruned version, or a daily copy younger than 7 days has bytes present (image store §3.4, unchanged). |
| I12 | Every comment thread in a Y.Doc resolves to an anchor or is reported Detached. Threads are never deleted by repair. |

### 4.2 Engine transactions (each one is a single `transaction()`, with the same contract on both adapters)

| Operation | Contract |
|---|---|
| `mintDoc(input)` | The only way to create a document: new, duplicate, from a template, or import. It mints `id`, `link_key` and `lineage` in the worker (`randomHex32`). `head_seq = 0`, `derived_seq = NULL`. Derived columns from the caller are ignored. |
| `restoreDoc(row, state)` | Keeps `link_key` and `lineage`. If either collides with a live document, it inserts a **new** row with a new `id` and a new `link_key`, and reports the duplicate lineage. The default answer is Keep both (SEC-004). It never updates identity, so `docs_identity_frozen` holds. |
| `duplicateDoc(id)` | `mintDoc` plus the merged state as one `origin='restore'` update, the `doc_tags` and `doc_view` rows, and `doc_blobs(kind='current')` rows. It never copies `links` or `doc_headings`: the new document is stale, and the queue derives it. |
| `trashFolder(id)` | One new `trash_group` over the subtree's folders and documents. `trashed_from` = the parent at trash time. |
| `restoreFolder(id)` | Restores the group. If `trashed_from` is NULL (set NULL by a purge) or is itself trashed, the item goes to the root. Tested. |
| `purgeFolder(id)` | Deletes documents, then folders bottom-up, in one transaction. `doc_blobs` rows get `dropped_at = now` first (§4.6). |
| `purgeDoc(id)` | The same `doc_blobs` rule, then `DELETE`, which cascades to `links`, `doc_headings`, `snapshots`, `updates`, `doc_tags`, `doc_view` and `import_sources`. |
| `mergeTags(from, into)` | `INSERT OR IGNORE INTO doc_tags SELECT doc_id, :into …`, then delete `from`. |
| `renameTag(id, name)` | Refuses a `name_key` held by another tag (`TagRenameResult.exists`, P2.7b port). |
| `append(...)` | As today, plus `head_seq = :seq` from the inserted row, in the same transaction. Title and snippet from the renderer are still accepted (open documents). `title_key` is recomputed in the worker. `modified_at` changes here only. |
| `compact(docId, state, upToSeq)` | As today (`content.ts:159`). It never touches `head_seq`. New: before deleting rows, the worker checks I10 with `Y.encodeStateVectorFromUpdate` on `state` and on `Y.mergeUpdates(rows ≤ upToSeq)`, and refuses the compaction if the snapshot doesn't dominate. The cost is measured in T20. |
| `derive.put(...)` | §4.3. |

**Rename (G4).** The storage engine's `renameDoc` is removed. The port's `rename(id, title)` stays, because the web tab list uses it. On a `LibraryIndex`, its contract becomes "edit the title heading through a session":
- For an open document, the window that holds it applies the edit.
- For a closed document, a headless session claims it in main's registry for the duration, applies one `origin='local'` update, and releases it.

`docs.title` then follows from the next `append`, which leaves the title with one writer.

### 4.3 `derive.put` and the derive pipeline (LK4a)

**`derive.put(docId, atSeq, links[], headings[], title, snippet)`** is one storage-worker transaction:

1. **Authorisation (SEC-003):**
   - Main forwards the call only for a document id it handed to that renderer's derive batch, or one that renderer holds a session for.
   - Anything else is refused and logged.
2. **Shape check:**
   - `target_key` is 32 hex characters;
   - `level` is 1–6;
   - `text` is at most 160 characters and `context` at most 240;
   - at most 5,000 link rows and 5,000 heading rows per document;
   - C0, C1 and bidi controls are stripped from `title`, `text` and `context`.

   A violation is refused, and the document is marked `derive_failed` in the repair report.
3. **Freshness:** inside the transaction, `atSeq` must equal `docs.head_seq`. If it is lower, the call returns `stale` and writes nothing. The queue retries later, and if the document is open, the session's next derive covers it. If it is higher, the call is invalid.
4. **Hashes:** the worker computes `links_hash` and `headings_hash` over the canonical rows. It never trusts a renderer hash. Only a side whose hash changed is rewritten: `DELETE … WHERE doc_id = ?` plus inserts.
5. **Always advance:** `derived_seq = atSeq` even when both hashes are unchanged. Otherwise an unchanged document loops in the queue forever.
6. Title, snippet and `title_key` are refreshed.
7. If the document has been purged, the call is a no-op.

**Open documents:**
- Headings come from the outline that `extensions/table-of-contents/fast-table-of-contents.ts` already builds, with no second whole-document walk.
- Links come from `extractLinks` (LK1) over the top-level blocks changed since the last derive, merged with the previous rows.
- The derive runs on close, and at most once per 30 s of idle. Never while typing.
- **It derives only from acknowledged state.** It flushes the batcher first, then derives from the state that is fully acknowledged at `atSeq`. If an edit lands during the flush, the derive is skipped until the next idle. Claiming `atSeq` for a state that includes unacknowledged edits would break I7 after a crash, and check mode can't catch that.

**Closed documents (the queue):**
- It lives in a **dedicated renderer Web Worker** in the library window. On the web it runs in the W3 writer tab, under the same `navigator.locks` lease.
- It takes **one document per call** from `docs_stale`, skipping ids that main's registry has claimed for an open editor.
- It loads the state read-only, derives headlessly with `lib/headless/derive.ts` (P2.8a's schema module plus LK1's extractors), and calls `derive.put`.
- One `Y.applyUpdate` on an 8 MiB document is a long task, but it happens in the worker, never on a thread that handles input.
- The duty cycle is at most 1 document per 250 ms while the app is focused and unthrottled when it is idle. T22 measures it.

**Transport.** P2.5b gives the renderer a direct `MessageChannelMain` port to the storage worker. Large loads, compactions and derive writes then stop crossing main, which S5 showed is where stalls appear (8 → 11 ms, with spikes up to 664 ms). Until P2.5b lands, the queue works over the existing `client.ts` path.

**Web.** `derive.put` is one readwrite transaction over `docs`, `links` and `headings`. It compares `head_seq` inside the transaction, and only the writer-lease holder calls it.

### 4.4 Read-time rules

- **Backlinks** for document D: `SELECT … FROM links WHERE target_key = D.link_key`, joined to live, non-template source documents. Sources in Trash or that are templates are excluded.
- **A dangling `target_key`** means "not in this library" (search-linking §4.6 states).
- **Restoring a document needs no link work.** Its rows reappear when the queue derives it.
- **Backlinks from a Live source** are labelled as such (SEC-008).
- **"Use Current Title" in a Live document** asks first: "N people will see this title" (SEC-008).
- **Linked from** is excluded from print and PDF (SEC-011).

### 4.5 Repair and rebuild (P2.6f): `desktop/storage/engine/repair.ts` and `lib/platform/web/library/repair.ts`

Repair is idempotent, and running it twice changes nothing. It has two modes:

**Check (idle, at most daily, read-mostly):**
1. Raise `head_seq` to `MAX(seq)`, inside `BEGIN IMMEDIATE`. It never lowers `head_seq` (I6, enforced by the trigger).
2. Recompute `size_bytes` (I9).
3. Assert I1–I4. Report violations without fixing them silently.
4. Read the image store's recount results. Repair never deletes `doc_blobs` rows and never drops `current`. Unreferenced rows only get `dropped_at`, and GC's 30-day grace is the quarantine.
5. Report detached and orphaned comment threads from `listThreads` (P4.9). Never delete them.

**Rebuild (Settings › Storage › Rebuild index, or a `derive_version` change):**
- Set `derived_seq = NULL` in chunks of 500 rows, one transaction each, so appends interleave.
- Then let the queue drain.

This is the only path that resets derivation. Check mode never does.

**After a failed `quick_check` (SEC-009):**
- Never repair in place.
- Open the file read-only, copy it aside, and rebuild into a new file with the explicit table order of §3.4, keeping rows that read cleanly.
- Run `foreign_key_check` and `integrity_check` on the new file.
- Offer the user the rebuilt file or a daily copy. The damaged file is kept.

### 4.6 Why two relationships have no FK

- **`links.target_key`:** a link to a document that is purged, not yet restored, or in another person's library is a valid state with its own UI. An FK would either block the purge or delete the source's rows, and both are wrong.
- **`doc_blobs.doc_id`:** the image store's GC grace starts at purge (image store §3.4: "Permanently deleting a document sets `dropped_at = now` on all its rows"). A cascade would delete those rows. A blob "with no rows at all is judged by its `created_at`", so it could be collected the same day, while a 7-day daily copy can still bring the document back. That would break I11. Repair reports `doc_blobs` rows whose document is gone and whose `dropped_at` is NULL.

---

## 5. Long documents and scale

### 5.1 Policy

| | Desktop | Web library | Public sandbox (server) |
|---|---|---|---|
| Soft notice | 2 MiB: "Too large to share as one document" (the server cap) | 2 MiB | — |
| Hard cap per document | **32 MiB** (D-O3) | **8 MiB** (quota and Safari eviction) | 2 MiB on the server; offline edits pause at 512 KiB (unchanged) |
| Library target | 10,000 documents, 200,000 links, 100,000 headings | 2,000 documents | — |

At the hard cap, appends are refused with a `document_too_large` state and the editor becomes read-only. Deletions are still allowed, as on the server (`lib/security/hocus-document-guard.ts`).

**Compaction:**
- The byte trigger becomes **max(1 MiB, 25% of the current snapshot)**, up from a flat 1 MiB (`COMPACT_MAX_BYTES`, `lib/platform/batcher.ts:40`). The row trigger stays at 500.
- Because `batcher.compact` (`batcher.ts:193`) encodes in one task by design, it runs only after **2 s with no input**, or on blur or close. It never runs on a timer while typing.
- A larger compaction window keeps more deleted text in raw rows. That is acceptable only because §2 principle 6 removes raw rows from every outbound path.

### 5.2 Search budget (search-linking §3.5 stands)

- **Quick Open stays at ≤ 16 ms keystroke-to-paint** from the renderer snapshot, or the `index.searchTitles` fallback above 5,000 documents. The draft's ≤ 50 ms is rejected.
- **Headings are never in the renderer snapshot.** Cross-document heading matches (the LK2 link picker, Quick Open's headings group) come from a worker query on `doc_headings_text`. They arrive as a second, asynchronous group, and are outside the 16 ms title budget.
- **`title_key` and `text_key`** are written once by the SR1 normalizer (`lib/search/normalize.ts`), so a keystroke never re-normalizes rows.

### 5.3 Benchmarks (`desktop-storage-soak` and `library-soak`)

**First, spike B0** (half a day, before T20's marks are fixed): `generateLargeDocument` at 1, 2, 4, 8 and 32 MiB, with real headings, links and threads, measuring open, typing and compaction on the reference Mac and on Windows. The marks below marked *provisional* are replaced by B0's measurements plus 25% headroom, and recorded here.

**New fixtures** (in Q1's `scripts/fixtures/generate.ts`, which is not on `main` yet):
- `library-10k-linked`: 10,000 documents, 200,000 links, 100,000 headings;
- `long-8m`;
- `long-32m`.

| Case | Runs | Pass mark |
|---|---|---|
| **T20** long document | `long-8m`: 5,000 headings, 2,000 links, 300 threads | Open ≤ 2.0 s on Mac and ≤ 3.0 s on Windows *(provisional, B0)*. Typing: the same document with background work on vs off, ratio ≤ 1.10 with `chrome-control` reported (the S5 rule), and max input latency ≤ 50 ms. Compaction ≤ 320 ms *(provisional)*, never while typing. The I10 check in the worker is reported. |
| **T20b** at the cap | `long-32m` | Opens; the cap refusal works; deletion works; no out-of-memory crash in the renderer or the worker |
| **T21** 10,000 documents | `library-10k-linked` | Sidebar reported as three numbers (SQL, IPC, first paint), total ≤ 1.5 s Mac and ≤ 2.5 s Windows. Backlinks for one document ≤ 5 ms end to end while a `derive.put` runs. Quick Open ≤ 16 ms or the fallback. |
| **T22** derive rebuild | 1,000 stale documents from `library-10k-linked` | Mac and Windows reported separately, with the duty cycle stated. Drains in the background; typing ratio ≤ 1.10 as in T20. |
| **T23** write amplification | A simulated year of edits on `long-8m` | Live state, free pages and WAL reported separately. File minus free pages ≤ 3× live state. Incremental vacuum after compaction if free pages exceed 25%. |
| **T24** migration | 1→2 on `library-1k` (200 MB) | ≤ 10 s on Mac, Windows reported with Defender on. Backup taken. `foreign_key_check` clean. The `updates` invariant is equal. `wal_checkpoint(TRUNCATE)` done. |
| **T24b** kill during the step | A kill at every statement boundary | The v1 file is intact, or the v2 file is complete. A v1 file with seeded orphans is refused by preflight with the list. |
| **T25** web parity | Chromium | A 2 MiB document opens ≤ 1.5 s; the 2,000-document index loads ≤ 1.0 s; derive and repair run under the writer lease |

T20–T25 enter the Gate 2 streak once P2.6d merges.

### 5.4 Correctness tests (exit criteria for P2.6d, P2.6f and LK4a)

- **P1 (property):** random sequences of create, append, compact, trash, restore, purge, duplicate, merge tags, move and derive keep I1–I12, and a check-mode repair afterwards is a no-op.
- **P2:** corrupt the derived data (delete, alter and add rows; skew `derived_seq`), and rebuild restores it exactly.
- **P3:** a recorded operation log replayed on SQLite and on fake-IDB gives an identical `library.json`.
- **P4 (kill):** a kill during `derive.put`, `compact` or the migration leaves the old or the new state, never a mix. After a compaction kill, the decoded state vector is at least the one before.
- **Compaction test:** a compaction deletes the rows `MAX(seq)` would read, and `head_seq` is unchanged.
- **Race test:** `derive.put` with `atSeq < head_seq` returns `stale` and writes nothing. On the web, two tabs race and only the lease holder writes.
- **Comments:** merge two Y.Docs and every thread resolves or is Detached.
- **Pragmas:** every writing connection has `foreign_keys = 1`, the copy and restore files pass `foreign_key_check`, and the copy's trigger and FK diff is empty.
- **SEC-001:** export a document after deleting a sentence; the bytes don't contain it.

---

## 6. Offline feature matrix (after this revision)

| Feature | Offline today | After | Row |
|---|---|---|---|
| Write and read documents | Yes, unbounded | Yes, 32 MiB cap (desktop), 8 MiB (web) | P2.6d, T20 |
| Long documents (5,000 headings) | Untested above 1.9 MB | Benchmarked | B0, T20 |
| Folders, Trash, Restore, Delete forever | Docs only; no folder ops | Yes, crash-safe | P2.6d, P2.6e |
| Pins, tags, tag merge, list views, Manual order | Memory fake only | Persisted | P2.6e |
| Linked from (backlinks) | No | Yes, including never-opened documents | P2.6d tables, LK4a queue, LK4 UI |
| Heading link targets, cross-document heading search | No store | Yes | P2.6d, LK4a, SR1 |
| Metadata search, Quick Open | Titles (P2.7a) | Titles, tags, folders, headings | SR1 |
| Body search across documents | Out by D24 | D-O1 | SR5 if approved |
| Find in a document | Yes | Yes | P2.11 |
| Images | Inline data URLs | Asset store, offline | A1 → P2.6b |
| Comments | In the Y.Doc | Same; repair reports Detached | P4.9 |
| Templates, Duplicate | Not crash-safe | `mintDoc`, `duplicateDoc` | P2.6d |
| Import, restore | Links missing until opened | Derived by the queue (`head_seq`) | P2.8b, LK4a |
| Export (Markdown, `.tinydoc`), backups | `stateOf` leaks deleted text | From a garbage-collected Y.Doc | P2.8a/b, P2.9b, P2.10 |
| Preferences | Local | Local, `v: 1`, one validator | P2.9c-1 |
| Fonts | — | Bundled woff2 only | P2.9c-1/2 |
| Web lazy features, locales, fonts | After first use only | Precached | W4 |
| Linux spellcheck | Network | Bundled `.bdic` | P2.5 |
| Embeds (YouTube and others) | Network by nature | Offline placeholder | OF2 |
| Analytics | Leak risk | Off on desktop, tested | OF1 |
| Sharing, live sync, update check | Network (expected) | Network (expected, disclosed) | — |

---

## 7. Plan changes

### 7.1 New rows

| Id | Scope | Lens | Depends on | Files | Exit criteria |
|---|---|---|---|---|---|
| **P2.6d** | Format 2 (§3): rebuild runner, preflight, `SCHEMA_V2`, step 1→2, copy and restore pragma contract, `secure_delete`, aging of pre-migration copies; engine transactions (§4.2) including `head_seq`, the I10 check and `renameDoc` removal; the pure `lib/search/normalize.ts` core | SE | P2.6 (merged); `tagNameKey` from P2.7b (either merges first; the other rebases onto the shared core) | `desktop/storage/engine/{schema,migrations,content,library-index,library,copy-library,sql}.ts`, new `engine/{folders,docs-copy,derive}.ts`, `lib/search/normalize.ts` | T23, T24 and T24b green; P1 (engine ops), P4 and the pragma tests pass; the `updates` invariant asserted; EXPLAIN tests for §3.5 |
| **P2.6e** | Worker ops and RPC for the P2.7b port (`lib/platform/desktop/library-index-rpc.ts`); the `DocumentIndex` contract suite on SQLite; lazy snippet fetch; `index.searchTitles` and `searchHeadings` | SE | P2.6d, P2.7b port | `desktop/storage/protocol.ts`, `desktop/storage/worker.ts`, `lib/platform/desktop/*` | The contract suite passes on memory, SQLite and fake-IDB; T21 green |
| **P2.6f** | Repair and rebuild (§4.5), Settings › Storage › Rebuild index hook, rebuild into a new file after a failed `quick_check` | SE | P2.6d, LK4a | `desktop/storage/engine/repair.ts`, `lib/platform/web/library/repair.ts` | P1 shows repair is a no-op; P2 green; T22 green |
| **LK4a** (split from LK4) | `lib/headless/derive.ts` (title, snippet, headings, links); the derive queue Web Worker; `derive.put` IPC with authorisation and shape caps; the web op; open-document derive from the outline | SE | LK1, P2.6d, P2.8a | `lib/links/derive-queue.ts`, `lib/headless/derive.ts`, `lib/platform/desktop/derive-rpc.ts` | A restored library shows correct Linked from on never-opened documents; race and authorisation tests pass |
| **LJ1** | Shared `library.json` v1 (`lib/library-format/*`): every column, including `pin_key`, folder `sort`, `view` and `group`, tag colours, `doc_view`, `import_sources` and Trash; the platform-only field list; "too new" refusal; never imports derived columns; desktop→web→desktop identity test | SE | P2.6d, W2 | `lib/library-format/*` | The identity round trip is byte-equal on user-intent fields |
| **P2.5b** | Direct renderer↔storage-worker `MessageChannelMain` port for loads, compaction and derive | DE + SE | P2.5 | `desktop/main/*`, `desktop/storage/client.ts` | S5 runner→renderer latency re-measured with no main-thread stall in the path |
| **B0** | Long-document spike (§5.3) | SE | Q1 fixtures | `docs/research/2026-11-2x-spike-b0-long-docs.md` | Fixes T20's marks |
| **OF1** | Analytics off on desktop, asserted by a test: the `GoogleAnalytics` render in `app/layout.tsx` is gated on `APP_TARGET`, and the desktop build never reads a GA measurement id | DE | P2.4a | `app/layout.tsx`, `components/analytics*` | The desktop build contains no GA script, asserted |
| **OF2** | Offline placeholder for embeds | DE | — | the HyperMultimedia embed node view host | No request while offline; a "Connect to load" placeholder |

### 7.2 Changes to existing rows

- **Search-linking §5 and SL-8:** "No background backfill" is replaced by the LK4a queue, and the known gap is closed.
- **LK4:** loses the table and `links.put` (moved to P2.6d and LK4a) and keeps the UI. It depends on LK4a.
- **P2.6b:** uses the P2.6d tables and adds no DDL. Purge sets `dropped_at` (§4.6).
- **P2.8a/P2.8b, P2.9b, P2.10:** every outbound path encodes from a garbage-collected Y.Doc, never from `stateOf` (SEC-001). `stateOf` becomes internal to the engine (restore and the daily-copy reader).
- **P2.8b (import):** decode in the killable import worker, into a throwaway Y.Doc, with the size cap checked before decoding (SEC-004). Then run:
  - the root allowlist;
  - `findDisallowedSchemaNames`;
  - `lib/comments/validate.ts`;
  - `isAllowedUri` on hyperlink and image attributes.

  Store only the re-encoded state. Force `doc_view.remote_images = 0`. Never import derived columns. Allowlist tag colours. Strip bidi and C0/C1 controls from folder, tag and title names.
- **P2.9b (backups, mirror):**
  - run `cloudFolderOf` on `~/TinyDocy Backups` and disclose the result rather than refuse;
  - directories 0700 and files 0600, today default modes (`node-host.ts:46`);
  - a `.metadata_never_index` file;
  - Settings › Privacy says data at rest relies on FileVault or BitLocker (SEC-006, SEC-011).
- **W2:** §3.6 and §8. **W4:** a precache manifest of the lazy chunks, locales and fonts the library uses, with `STATIC_CACHE_MAX_ENTRIES` checked against it. **W6:** eviction detection (§3.6).
- **P2.10 (Download)** becomes the primary offline way to move a sandbox document into the library.
- **P4.x share and export consent (SEC-002, SEC-007):** D-O8. The consent window also counts detached and resolved comment threads and offers to leave them out.
- **Gate 2** adds: T20–T24 green for 5 nights; P2.6d, P2.6e and P2.6f merged; a desktop boot with the network blocked makes zero requests apart from the disclosed update check.

### 7.3 Order

```text
P2.6d ──┬── P2.6e (needs the P2.7b port) ── T21
        ├── LK4a (needs LK1, P2.8a) ── P2.6f ── LK4 UI
        ├── P2.6b (needs A1, P2.5)
        └── LJ1 (needs W2)
P2.5 ── P2.5b
Q1 fixtures ── B0 ── T20 marks
```

**P2.6d starts now.** Its only shared code with an in-flight PR is the normalizer: P2.6d owns `lib/search/normalize.ts`, and P2.7b's `tagNameKey` calls it. Before it starts, its exit criteria must include §3.1, §3.4, the `updates` invariant and I10.

---

## 8. Instructions for each in-flight session (apply now)

| Session (branch) | Change now |
|---|---|
| **p27b-library-lists** (`claude/feat-p2-7b-library-lists-7047ba`) | Keep the port and the memory fake, and don't touch `desktop/storage`. <br>• Make the memory fake implement folder trash with one `trash_group` per subtree and the root fallback on restore. <br>• `modified` sorting means content edits only (D-O5). <br>• Document on `rename` that on a `LibraryIndex` it edits the title heading through a session (§4.2) and never writes the title column. <br>• Extend `tests/unit/platform/document-index-contract.ts` with folder trash groups, the restore root fallback, `mergeTags` with overlapping documents, and `renameTag` refusal by `tagNameKey`, because P2.6e runs the suite on SQLite. <br>• Keep `tagNameKey` in `lib/library/tag-rules.ts` pure (no React or DOM), and build it on the shared `lib/search/normalize.ts` core. If P2.6d hasn't landed it yet, add the minimal core here, following search-linking §3.2. <br>• `lib/platform/document-index.ts` also changes on LK1: P2.7b merges first, and LK1 rebases. |
| **LK1** (`claude/feat-lk1-doc-links`, no linked session) | Keep `extractLinks(fragment: Y.XmlFragment)` pure, with no DOM. <br>• Add `toLinkRows(rows: LinkRow[])`, the mapping to the `links` columns: `ord` is the array index, `key` becomes `target_key`, and a null `srcTocId` or `tocId` becomes `''`. <br>• Add `extractHeadings(fragment)` to the same walk (`{ ord, tocId, level, text }`). <br>• Export `DERIVE_VERSION = 1`. <br>• `linksHash` stays for tests; the worker computes the stored hash. <br>• Prove it with `bun test` on a bare `Y.Doc`. <br>• Write nothing to storage. <br>• Rebase onto P2.7b's `document-index.ts` once P2.7b merges. |
| **a1-asset-core** (`claude/feat-a1-asset-core-321db5`) | Add no tables. <br>• Use exactly the §3.2 `blobs` and `doc_blobs` columns and the `kind` enum, in snake_case on both platforms. <br>• Keep `BlobStore` keyed on hash. <br>• The worker recomputes the hash (image store §3.2). <br>• `recount` only sets `dropped_at` and never deletes rows. <br>• 0 B to the editor chunk. |
| **p28a-headless-export** (#146) | Merge as is once CI is green against current `main`. <br>• Follow-up in LK4a: the title, snippet and heading derivation goes in `lib/headless/derive.ts`. <br>• Follow-up before P2.8b: Markdown export encodes from a garbage-collected Y.Doc, not `stateOf` output. Add a test that `lib/headless` loads and parses a state with no `document` global, if #146 lacks one. <br>• The export UI says "Markdown is not a backup". |
| **W2** (`feat/w2-web-library-storage`, workflow) | Before merging, into version 1: <br>• the `links` and `headings` stores; <br>• the `docs` fields `head_seq`, `derived_seq`, `links_hash`, `headings_hash`, `title_key` and `stale`, with `by_stale`; <br>• the `folders` fields `trash_group` and `trashed_from`; <br>• `doc_blobs` in snake_case (`doc_id`, `dropped_at`); <br>• `''` for nullable key parts; <br>• the platform-only field list; <br>• the version rule and the `pre-v<n>` copy rule; <br>• a skeleton test that upgrades a populated library; <br>• the eviction sentinel with its `localStorage` marker. <br>Don't add tags or parent indexes; they exist. |
| **P4.9** (`feat/p4-9-comments-core`, workflow) | Add no table. <br>• Export a pure `listThreads(ydoc)` that works on a bare `Y.Doc`. Repair reports use it, and a later additive `comment_index` derives from it. <br>• Comment roots count in `size_bytes`. <br>• Anchoring needs no network. <br>• Derive `Author.id` per document as `HMAC(deviceSecret, lineage)`, not one id across documents (SEC-002). |
| **p29c1-page-engine** (P2.9c-1) | Add `v: 1` to the prefs schema. <br>• One shared validator for `meta('prefs')` and the web store. <br>• Page fonts are bundled woff2 only, never fetched. |
| **p25-electron-shell** (#135) | Fold into the security fixes: <br>• bundled Linux `.bdic` dictionaries served from `file://`, with no `*.gvt1.com`; <br>• an Electron e2e that boots with the network blocked and asserts zero requests apart from the disclosed update check; <br>• `foreign_keys = ON` stays in the worker open path. <br>The `MessageChannelMain` port is P2.5b, not this PR. |

Sessions not listed (`p22-no-provider`, `p2-7a-library-files-side`, `rethink-the-bubble-menu`, `electron-quit-spell`, and the finished P2.1, P2.4, P2.6 and CI sessions) need no change.

---

## 9. Owner decisions

| # | Question | Options | Recommendation |
|---|---|---|---|
| **D-O1** | **Body search across documents.** This **reopens D24**, which you answered "metadata only". | (a) Keep D24: metadata plus cross-document heading search, which comes free from `doc_headings` on both platforms. (b) Add desktop FTS5 body search as **SR5** (about 3 agent-days) on the LK4a pipeline, after Gate 2, as an additive table with no rebuild. The web stays at headings. First verify that FTS5 is compiled into Electron's `node:sqlite`. | **(b), scheduled after Gate 2.** A library of long documents with no body search falls short of "every feature". The data model needs no change now, so deferring costs nothing. |
| **D-O2** | **Backlinks for documents nobody has opened** | (a) The background derive queue (LK4a). (b) The spec as written: they appear after the document is opened. | **(a).** Without it, imports and restores show wrong Linked from offline. |
| **D-O3** | **Per-document caps** | (a) Desktop 32 MiB hard cap and web 8 MiB, both with a 2 MiB share notice. (b) No hard cap on desktop. | **(a).** It bounds memory, compaction and backup times, and B0 tests at the cap. |
| **D-O4** | **Format 2 as a forward step or an in-place edit** | (a) A forward step with the rebuild runner. (b) Amend `SCHEMA_V1` in place, since no user library exists. | **(a).** It rehearses the migration path while the stakes are zero, and T24 proves it. |
| **D-O5** | **What changes "Modified"** | (a) Content edits only. (b) Any change, including rename, move and tags. | **(a).** Renames are content edits anyway (§4.2). Moves and tags are not. |
| **D-O6** | **Sibling folder names** | (a) Duplicates allowed. (b) Unique per parent. | **(a).** Imports collide less, and the mirror already de-duplicates file names. |
| **D-O7** | **Restore points for local-only documents before Live (P4.0)** | (a) The 7 daily copies for Gate 2; per-document versions revisited at Gate 3. (b) Per-document versions now. | **(a).** Custom properties likewise wait for an additive `doc_props` table. |
| **D-O8** | **Links to private documents when sharing or exporting** (SEC-002) | (a) Turn links to documents outside the share into plain text by default, and let the consent window keep them. (b) Keep links as they are. | **(a).** The same `link_key` in two shares lets the server or a collaborator tie them to one library, and link text exposes private titles. |

---

## 10. How we will know it worked

- T20–T25 are green for 5 nights.
- On SQLite and fake-IDB, P1 shows a check-mode repair is a no-op after random operation sequences.
- A library restored offline shows correct Linked from on documents nobody has opened.
- A desktop boot with the network blocked makes zero requests apart from the disclosed update check.
- An export made after deleting text doesn't contain that text.
- Migrating `library-1k` from v1 to v2 keeps every `updates` byte. `foreign_key_check` is clean on the live file, the daily copy and a restored file.

## 11. Critique dispositions

| Critique | Disposition |
|---|---|
| Migration runner (staff, Critical) | Accepted: §3.1 |
| Copy and restore pragmas (staff, Critical) | Accepted: §3.4 |
| Repair racing edits, `head_seq` lowering | Accepted: §4.3 step 3, §4.5, the trigger |
| Yjs loss in rebuild or compaction | Accepted. `updates` is not rebuilt; invariant asserted; I10 |
| FK cascade surface | Accepted. Also found: `doc_blobs → docs` must have no FK (§4.6) |
| Web multi-tab writers, eviction | Accepted: §4.3, §3.6 |
| Bad v1 values, frozen identity on restore, tag collisions, chunked reset | Accepted: §3.3, §4.2, §4.5 |
| Indexes vs real queries (performance) | Accepted: §3.5 |
| Derive on the renderer main thread | Accepted: Web Worker, one document per call, outline reuse |
| Quick Open 50 ms | Rejected as a budget change. §3.5 stands (§5.2) |
| Unmeasurable typing marks, unmeasured open marks | Accepted: on/off ratio, B0 spike, T20b at the cap |
| T24 rebuilding `updates` | Accepted: no rebuild, no CHECK (code validates) |
| `size_bytes` drift | Withdrawn: `compact` already recomputes it |
| SEC-001…SEC-011 | Accepted. Each is placed in a row (§7.2, §8) or a decision (D-O8) |
| Draft: delete provisional `doc_blobs` after 1 day | Rejected: conflicts with the image store's 30-day grace |
