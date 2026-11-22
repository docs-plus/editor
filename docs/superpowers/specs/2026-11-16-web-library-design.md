# TinyDocy Web: personal library in the browser

> **Phones and tablets (D36):** where this document and [the phones-tablets design §14](2026-11-16-phones-tablets-design.md) differ on phone or tablet behaviour, the phones design wins.

> **v7 notes:** new library users get an unsaved practice copy instead of a link to the public Playground (D29). ⌘W, ⌘N and ⌘⇧N are reserved by browsers, so the library reaches those commands through menus and buttons, and the close-tab hint does not appear on the web.

> **Owner answers (2026-11-16):** D11, a separate origin for the library (for example `my.tiny.docs.plus`); W4 builds on that. D12, the stop-sharing key is optional and offered after sharing (W10). These override the open questions below.

> **Plan v8 (2026-11-16):** **D36** phones and tablets are fully supported in v1 ([phones and tablets design](2026-11-16-phones-tablets-design.md), M18–M28). **D39** comments work in library documents, as on desktop. **D40** the seams: the page generates share secrets and derives the tokens itself (S1, §8.1), the `/join` fragment uses the S1b grammar, the export zip writes `TINYDOC2` only (S8, §6.1), `library.json` gains `link_key`, `kind`, `sort_key` and tag names (S8b), and only a backup-zip or `library.json` restore keeps ids (S8c). The phones review adds: W-D7 takes a host flag; the "deleting the Home Screen app deletes these documents" copy ships only after M18 verifies it.


- **Status:** Draft for owner review (2026-11-16). **W2 is in progress, not done.** Its storage engine is built (2026-11-22, dark behind `NEXT_PUBLIC_LIBRARY`): `IdbDocStore`, the schema, opening and versions, the quota path, the `persist()` and `estimate()` rules and the kill switch, verified on `fake-indexeddb` only. W2 is done when the rest of its §11 row exists: `IdbDocumentIndex`, the contract suite in three browsers, and the `perf` comparison (owners in §2.2 "Still open for W2").
- **Decision it implements:** D3 (plan §13): the web app gets a personal document library stored in the browser, as well as the public sandbox. D6 (one combined release) means it ships in v1 together with sharing.
- **Parent documents:**
  - [Plan v7](2026-11-15-desktop-local-first-design.md): releases, PRs and gates
  - [Architecture](2026-11-15-desktop-architecture.md): ports, `local-session`, batching, compaction (D-A2, D-A3)
  - [Details spec](2026-11-15-desktop-documents-and-editor-details.md): §1 rules (never drop a Yjs update, `WriteGate`, a failed save is retried in order), titles, tags, page preferences, sharing
  - [Desktop UX spec](2026-11-15-desktop-ux-design.md): sidebar, Quick Open, copy guidelines, accessibility
  - The image store design (`2026-11-16-image-store-design.md`, written in parallel) owns the `blobs` store. This document only reserves the seam.
- **Verified against the code** on 2026-11-16: `lib/offline/*`, `lib/collab-session.ts`, `hooks/use-synced-tabs.ts`, `hooks/use-yjs-document.ts`, `components/editor-app/editor-app.tsx`, `lib/pwa/*`, `lib/security/content-security-policy.ts`, `lib/analytics.ts`, `app/manifest.ts`, `app/privacy/page.tsx`.
- **Web sources** are listed in §14. Tags used in the text:
  - **[unverified]**: no primary source confirmed it.
  - **[inference]**: our reasoning from the sources, not a citation.

---

## 0. Summary

| # | Decision | Why |
|---|---|---|
| W-D1 | **IndexedDB, in a new database `tinydocy-library`.** It implements the same `DocStore` contract as desktop (a snapshot, plus append-only updates, plus compaction), and a `DocumentIndex` for folders, tags, pins and Trash. Not OPFS. | IndexedDB transactions can span the snapshot, the update log and the index. OPFS is missing in Safari private windows, has no transactions, and is evicted under the same rules. |
| W-D2 | **Every content write is `durability: "strict"`**, batched as on desktop (250 ms after the last edit, 1 s at most, flushed at once when the page is hidden). A failed write keeps its batch in memory and retries in order. App health becomes **Can't save** and the `beforeunload` guard is armed. | Details spec §1 rules 1 and 3. Chrome's default became `relaxed` in Chrome 121. |
| W-D3 | **Compaction is safe with any number of writers.** It merges into the stored snapshot inside one `readwrite` transaction and deletes **only the rows this session applied**. Web Locks decide who may edit, but correctness never depends on them. | The desktop invariant "one window per document" (D-A3) can't be enforced in a browser: tabs can be duplicated, restored from bfcache, frozen, or run with Web Locks turned off. |
| W-D4 | **One editing tab per document.** A per-document Web Lock picks the writer. Other tabs are live, read-only mirrors over BroadcastChannel, made read-only by `WriteGate`. **Edit here** hands over politely, and steals only after a timeout. | This is desktop's model, with handoff in place of "focus the other window" (browsers won't focus another tab). |
| W-D5 | **The library is honest about the browser.** It shows a storage card with the real guarantee for this browser, asks for persistent storage only from a click, reminds people to back up, and offers **Export all** (a zip of `.tinydoc` and `.md`). Chromium also gets an optional **backup folder**. | Browser storage can be deleted without warning (§3). Only a copy outside the browser is safe. |
| W-D6 | **The library and the public sandbox are labelled as different places.** "My documents: stored in this browser". "Public sandbox: everyone can see and edit these". A local document id never appears in the URL. A sandbox document moves into the library only as a **copy with a new lineage**. | A document's privacy must never depend on which tab you happen to be in. |
| W-D7 | **Reuse the desktop library UI** from a platform-neutral `components/library/`, **with a host flag** (v8, phones design §4.2–§4.3): the web docking rule and the phone list-first layout key on it; desktop keeps the 720 px overlay rule unless it adopts this one. Nothing else forks. It runs on the web adapters (`IdbDocStore`, `IdbDocumentIndex`, `BrowserShell`), lazy-loaded on the library route only. The editor chunk grows by **0 bytes** beyond P2.2's allowance. | One UI, two hosts, no fork. |
| W-D8 | **Recommended: the library lives on its own origin** (for example `my.tiny.docs.plus`), not on the sandbox origin. **Owner question Q1** (§12). | Today X's `widgets.js` runs in the sandbox's top-level document, `script-src` allows `'unsafe-inline'`, and every visitor automatically opens documents written by anonymous strangers. Any script running on the library's origin can read every document and every share secret. |

---

## 1. What exists today, and what it means for the library

| Fact (checked in code) | Where | Consequence for the library |
|---|---|---|
| The offline store is a **cache**: 14-day expiry, a 30-document cap, keys scoped to the server host, wiped on an epoch bump, swept against the tab list, and deleted when the server tombstones a document. | `lib/offline/local-doc-store.ts:7-17,192-241`, `collab-session.ts:188-195` | Library storage must ignore all of these, so it uses a separate database. `NEXT_PUBLIC_OFFLINE_CACHE=0`, `clearOfflineData()` and the "Delete offline data" control (`components/pwa/offline-data-control.tsx`) must never touch it. |
| A save writes the whole compacted state with `put` (last writer wins). | `local-doc-store.ts:157-171,288` | **Existing web bug.** Two tabs editing the same sandbox document offline overwrite each other's unsynced edits in the device copy. Each tab still holds its own edits in memory and syncs them on reconnect, unless it is closed first. Fix: merge on save (§11.1), next to P1.1. |
| The `open()` has no `onversionchange` or `onblocked` handler. | `local-doc-store.ts:365-373` | The library adds both from day one, plus a `format_version` guard (§2.4). |
| The writer already settles on the transaction's `complete`, not on request success. | `local-doc-store.ts:383-402` | Keep this pattern. A write that later aborts (for example on quota) must reject. |
| The app is "ready" only after `global-tabs` syncs with the server, and mounting `useConnectionState` opens the WebSocket. | `use-synced-tabs.ts:70-99`, `editor-app.tsx:98,124-146` | The library route needs its own root. It renders with no server and opens no socket (§5.4, §7.3). |
| `use-yjs-document` calls `acquireCollabSession` directly. | `hooks/use-yjs-document.ts:27` | Depends on P2.1 and P2.2: the hook reads `DocSession` from context, and the provider becomes optional. |
| `script-src` contains `'unsafe-inline'` and X's widget hosts. GA loads after consent. The comment says nonces are off "while the service worker stores HTML". | `lib/security/content-security-policy.ts:42-50` | Third-party and inline script can run on the origin that would hold the library. This drives W-D8. |
| Analytics sends `origin + pathname` with a fixed page title. | `lib/analytics.ts:78-79,106` | A local id in the path would leak. Ids never go in the path (§5.3). |
| The service worker serves cached HTML only for `SHELL_PATHS = ["/", "/about", "/privacy"]`. Its `KILL_SWITCH` deletes only `caches`. | `lib/pwa/sw-config.ts`, `lib/pwa/service-worker.ts:38-81` | The library's route must be added to `SHELL_PATHS`, or it won't open offline. The kill switch must never clear IndexedDB, and we never send `Clear-Site-Data`. |
| The privacy page says "Your documents are public". | `app/privacy/page.tsx:51` | Must be rewritten before launch (W6). |
| The manifest `id` is frozen at `/`. | `app/manifest.ts:14` | Installing the library under W-D8 means a second manifest on the new origin. The sandbox's install identity stays as it is. |

---

## 2. Storage engine

### 2.1 Why IndexedDB and not OPFS or SQLite-WASM

| Option | Verdict | Reason |
|---|---|---|
| **IndexedDB** | **Chosen** | One transaction can cover `snapshots`, `updates` and `docs`, so a snapshot plus title plus delete is atomic. It works in every target browser, including Safari and Firefox private windows (in memory, or encrypted on disk). It supports `durability: "strict"` (Chrome 83, Firefox 126, Safari 15). |
| OPFS (plain files) | Rejected | OPFS is "currently unavailable for Safari windows in Private Browsing mode". It has no transactions, so we would write our own journal. Its lifetime "is the same as … IndexedDB and localStorage", so the same eviction rules apply and there's no durability gain. |
| SQLite-WASM on OPFS | Rejected | It would give SQL parity with the desktop engine. But it costs a worker and roughly 400 KB of WASM [inference]. The OPFS VFS needs either `SharedArrayBuffer` (COOP/COEP headers, which break YouTube embeds) or the SAH-pool VFS, which holds an exclusive handle, so one tab at a time. And it has the same eviction rules. |
| Storage Buckets API | Not used | Chromium only (122+). Firefox and Safari have no support, and WebKit's position is still "Needs position". Each bucket can still be deleted on its own. |

**No IndexedDB wrapper library.** The adapter is about 300 lines of hand-written promise helpers, in the style of `createIndexedDbBackend`, so `minimumReleaseAge` and the bundle are untouched.

### 2.2 Schema (`tinydocy-library`, version 1)

The stores mirror the desktop tables (architecture §5.3, details spec §3, §4, §6.3), so a row means the same thing on both platforms and `.tinydoc` and `library.json` round-trip between them.

| Store | Key | Value | Indexes |
|---|---|---|---|
| `meta` | `key` | `format_version`, `library_id` (UUID), `yjs_encoding = "v1"`, `created_at`, `rev` (index change counter), `last_full_export_at`, `reminder` (snooze state), `persist_asked_at`, `backup_folder` (a `FileSystemDirectoryHandle`, Chromium only) | none |
| `docs` | `id` (UUID) | `title`, `folder_id`, `sort_key`, `pin_key`, `pinned`, `created_at`, `modified_at`, `opened_at`, `trashed_at`, `trash_group`, `trashed_from`, `schema`, `lineage`, `size_bytes`, `snippet`, `exported_at`, `md_at` | `by_folder [folder_id, trashed_at]`, `by_opened`, `by_modified` |
| `snapshots` | `doc_id` | `{ data: Uint8Array, rev: string }` | none |
| `updates` | `seq` (autoIncrement) | `{ seq, doc_id, data, origin, created_at, writer }` | `by_doc [doc_id, seq]` |
| `folders` | `id` | `parent_id`, `name`, `sort_key`, `trashed_at`, `sort`, `view`, `group` | `by_parent` |
| `tags` | `id` | `name` (unique, case-folded in `name_key`), `color` | `by_name_key` (unique) |
| `doc_tags` | `[doc_id, tag_id]` | `{}` | `by_tag` |
| `doc_view` | `doc_id` | `{ width }` (the D10 per-document width override) | none |
| `md` | `doc_id` | `{ md: string, at }`: the Markdown cache for export and the backup folder (§6) | none |
| `remotes` *(Live)* | `doc_id` | `{ share_id, role, status, status_reason, owner_secret?, edit_secret?, view_secret? }` (§5) | `by_share` |
| `blobs` *(seam)* | as the image store design defines | images. This document only reserves the name and counts it in the storage card. | none |

- **Ids** come from `crypto.randomUUID()`: document, folder and tag ids, `lineage` and `library_id`.
- **No document data lives in `localStorage`.** UI preferences stay in `tinydocy-ui`.

**As built (W2, 2026-11-22),** in `lib/platform/web/library/library-schema.ts`:
- **Seams in version 1.** `docs` also has `link_key` (32 hex, unique index `by_link_key`, minted at insert, S16) and `kind`, as the desktop schema does (D-A5). `import_sources` (index `by_source_hash`), `remotes`, `blobs` and `doc_blobs` (the image store design §3.3 shapes) are created now, empty: a store added later is a version bump, and a version bump makes every older tab reload (§2.4).
- **Index keys with no nulls.** IndexedDB leaves a record out of an index when any part of its key is null or boolean. So every nullable key part is `''` (offline data-model revision §3.6): `by_folder` indexes `list_key = [folder_id ?? '', trashed_at ?? '']`, `by_parent` indexes `parent_key = parent_id ?? ''`, and `by_stale` indexes `stale`, a number. The columns themselves keep the desktop meaning (null for the root, null for not trashed). `by_opened` keeps `opened_at` as it is: it lists only documents with `opened_at` (Recent).
- **Format 2 shape in version 1** (offline data-model revision §3.2, §3.6, 2026-11-22). `links` (`["src_doc_id", "ord"]`, `by_target`) and `headings` (`["doc_id", "ord"]`, `by_toc`, `by_text_key`) exist, empty until LK4a derives. `docs` has `head_seq` (raised by every append, never by compaction), `derived_seq`, `links_hash`, `headings_hash`, `title_key` (`normalizeSearchText` of the title) and `stale`. `folders` rows carry `trash_group` and `trashed_from`. `doc_blobs` is snake_case (`["doc_id", "hash", "kind"]`, `dropped_at`). The fields `library.json` never carries are in `lib/library-format/fields.ts`. `meta.eviction_sentinel` holds the `library_id`; `eviction.ts` compares it with the `localStorage` marker `tinydocy-library-id`, for W6.
- **Versions.** `LIBRARY_DB_VERSION` bumps only when stores or indexes change, `format_version` when row shapes change. Before a step that rewrites rows, a forced copy goes to `tinydocy-library.pre-v<n>` (`preMigrationCopyName`), taken at the old version before the open at the new one, because the upgrade transaction commits at the first await that isn't IndexedDB.
- **`snapshots.upto_seq`.** Next to `rev`, the snapshot keeps the highest seq any compaction claimed to cover, so `load()` reports `maxSeq` after every row was folded in. Unlike desktop, `load()` returns every row of the document, whatever its seq: a row another tab left below `upto_seq` is still content.
- **`updates.writer`** records the tab session that appended a row, for diagnostics only.
- **Compaction also writes `docs.size_bytes`** (the snapshot plus the rows left), so its scope is `snapshots`, `updates` and `docs`.
- **Close hooks.** On `versionchange` the connection runs every registered close hook before `db.close()`, for at most `CLOSE_HOOK_TIMEOUT_MS` (5 s) together, so a drain stuck in a retry backoff can't hold the other tab's upgrade forever. `IdbDocStore` registers its own `flush()`, which waits only for transactions it already issued. Batches still queued in the batcher are not covered by it. `idb-local-session.test.ts` pins both halves: with the session drain as a hook, a queued batch is written before the close; without it, the batch stays queued and fails with `library_unavailable`.
  - **W4 must** register the session's batcher drain (`flush()`) as a close hook, so queued batches are written before the connection closes.
  - **W4 and W6 must** show `library_reload` as a blocking state: the connection is closed for good, and `IdbDocStore` has no reopen path (it holds one connection promise), so a reload is the only recovery. Until the reload, edits still queued stay visible in the editor and the `beforeunload` guard stays armed; if the drain failed, the state offers **Export** for the open document.
  - `IdbDocStore.dispose()` unregisters its hook and forgets every open document; W4 calls `close(docId)` when a tab or route lets a document go, and `dispose()` when the library root unmounts.
- **`library_upgrade_unblocked`.** `onblocked` reports `library_upgrade_blocked`; when the old tab lets go and the open succeeds, `library_upgrade_unblocked` follows, so W6 can clear the notice.
- **An append bumps `meta.rev` only when the title or snippet changes (third review round, 2026-11-22).** Index writes (`createLibraryDoc`, later every `IdbDocumentIndex` write) always bump it. An append bumps it, in the same strict transaction, only when its title or snippet, as truncated, differs from the stored row. `modified_at` and `size_bytes` change on every append and never bump it, and `compact` never does, so ordinary typing adds no `meta` write (the `perf` criterion, §2.3). So:
  - The writer still publishes title, snippet and modified-time changes as `{ changes }` on BroadcastChannel `tinydocy-library`. A tab that missed them sees the rev jump for a title or snippet change.
  - `modified_at` and `size_bytes` have no rev signal. `IdbDocumentIndex` therefore reloads `snapshot()` on `pageshow` with `persisted` true (back from bfcache) and on `visibilitychange` to visible, whatever `rev` says.
  - A unit test pins this (`idb-doc-store.test.ts`, "the index rev").
- **Coordinator decisions (2026-11-22)**, delegated by the owner:
  - **No `docs.by_title_key` or trash-group indexes in version 1.** §3.6 doesn't list them and nothing queries them yet. While the library is dark no browser has the database, so the version bump that adds them is free until the flag turns on; the PR whose query needs one adds it.
  - **Recent (`by_opened`) lists documents the user opened, created or imported.** `createLibraryDoc`, the one create path (import will use it too), sets `opened_at` to the creation time, so a new or imported document is in Recent at once. Every other write leaves `opened_at` as it is. A unit test pins it (`library-schema.test.ts`). Desktop `createDoc` (`desktop/storage/engine/library-index.ts`) still leaves `opened_at` null; the P2.6 session owns that change.
  - **`meta.rev` bumps only on a title or snippet change** (the append rule above). In a list that is already open, a "Modified" time, and an order sorted by it, can lag until the next rev bump or the re-query on `pageshow` or `visibilitychange`. Accepted as is.
- **`foreign` is apply-then-ack (§2.5).** After a compaction returns `foreign`, the session keeps its state vector. Until a later compaction's `state` covers it (the caller applied it), every compaction merges the stored snapshot again and returns it again. A caller that drops `foreign` (a destroyed doc, an apply that throws) costs a repeat merge, not the other tab's content. One gap remains: a foreign snapshot that only deletes counts as covered at once.
- **A load that settles after `close(docId)` or `dispose()`** keeps no session state.
- **`IdbDocumentIndex`** (folders, tags, pins, Trash, the rev feed) is not in this PR. W2 writes only the document row `DocumentIndex.create` will (`createLibraryDoc`) and bumps `meta.rev` with it.

**Still open for W2** (its §11 exit criteria), with owners:

| Item | Owner | State |
|---|---|---|
| `IdbDocumentIndex` with the rev feed, on the shared `LibraryIndex` contract suite | W2b, the next library storage PR | Not started |
| The `DocStore` contract suite in Chromium, Firefox and WebKit (real `durability: "strict"`, key ranges, `onblocked` and `onversionchange` timing, quota aborts) | The CI session's Q7 `browsers` job | Not started |
| The property test at 50,000 runs | Nightly `library-property` job (`.github/workflows/nightly.yml`) | Wired 2026-11-22; one local pass so far (437 s) |
| Typing latency within 5% in `perf` with strict commits | The CI session's Q7 job | Not started |

### 2.3 Transactions and durability

| Write | Stores in scope | Durability |
|---|---|---|
| **Append a batch.** INSERT the update row, then UPDATE `docs` with `title`, `modified_at`, `size_bytes` and `snippet` (the renderer sends these, as on desktop). | `updates`, `docs` | `strict` |
| Compact (§2.5) | `snapshots`, `updates` | `strict` |
| Index operations: create, rename, move, pin, tag, trash, restore, purge | the stores they touch, plus `meta` (for `rev`) | `strict` |
| `opened_at`, the `md` cache, reminder state | `docs` / `md` / `meta` | `relaxed` |

**Rules for writing:**
- Every transaction's requests are issued **synchronously** inside one task, with no `await` on anything that isn't IndexedDB. Otherwise the transaction auto-commits early, and the next request throws `TransactionInactiveError`.
- A write resolves on `complete` and rejects on `abort` or `error`.
- On browsers that ignore `durability` (Firefox before 126), strict is simply the browser's default. That is acceptable.

**Durability bound.** It is the same as desktop D-A2: a crashed or killed tab can lose about the last second of typing.
- Hiding the page (`visibilitychange` to hidden), `pagehide`, `blur` and Ctrl/⌘S flush at once.
- The `beforeunload` guard is armed while any batch is queued, in flight or failed. On the web this is correct, unlike in Electron.
- **W2's exit criterion:** typing latency in the `perf` project stays within 5% of `main` while strict commits loop.
  - **Perf note (W2, 2026-11-22):** W2 ships `IdbDocStore` dark, so no route types through it and `perf` is unchanged by construction. The comparison is deferred to the CI session's Q7 job: `performance.spec.ts` with the batcher committing strict transactions (at most about 4 a second), against the same spec on `main`. If it misses, risk WK4's fallback applies: `relaxed` durability with a flush on hide, behind an env flag.

### 2.4 Opening, versions and old tabs

- `indexedDB.open("tinydocy-library", 1)` with handlers for all three events:

  | Event | Action |
  |---|---|
  | `onupgradeneeded` | Creates the stores. |
  | `onblocked` | Health becomes `library_upgrade_blocked`: "TinyDocy was updated. Close other TinyDocy tabs to continue." |
  | `db.onversionchange` | Flush (the close hooks, §2.2 As built), then `db.close()`. Health becomes `library_reload`: "TinyDocy was updated in another tab. Reload to keep editing." [Reload] |

- **`format_version` guard.** If `meta.format_version` is newer than this bundle knows (an old tab, or an old service-worker copy after a deploy), the whole library is **read-only** with `library_too_new`.
  - Upgrades stay in place. `onupgradeneeded` runs each step, and IndexedDB makes it atomic.
  - **Unlike desktop, there's no `VACUUM INTO`.** Before a format upgrade that rewrites rows, the library offers **Export all** (§6.1).
- **IndexedDB unavailable.** This covers an opaque origin, storage disabled by policy, or an `open()` that throws. The library shows `library_unavailable` (§9). It never falls back to memory silently.

### 2.5 Compaction that stays safe with any number of writers

**Why the desktop rule can't be reused.** Desktop deletes `seq ≤ X`, where X is the highest acked seq. That is safe only with one writer:
1. Tab B (stale, frozen or stolen from) appends row 101 after tab A loaded up to 100.
2. Tab A acks 102 and compacts with X = 102.
3. Row 101 is deleted, but A never applied it.

**An epoch check that rejects B's append is also wrong.** It drops B's queued edits (details spec §1 rule 1).

**The web rule:** any tab may append. A compaction deletes only rows it has applied, and merges into the stored snapshot instead of replacing it.

```text
session state (per open document, inside IdbDocStore):
  applied: Set<seq>     // keys loaded at hydrate + keys of this session's own acked appends
  snapRev: string|null  // rev of the snapshot this session last loaded or wrote

load(docId):  one readonly tx: snapshot + every updates row for doc (by_doc range)
              applied = keys read; snapRev = snapshot?.rev

compact(docId, state, upToSeq):            // port signature unchanged
  precondition (caller, as desktop §5.2): no append in flight; in ONE task:
     state = Y.encodeStateAsUpdate(doc); upToSeq = highest acked seq
  keys = [...applied].filter(k => k <= upToSeq)
  tx = readwrite [snapshots, updates], durability "strict"
    stored = snapshots.get(docId)                       // request, then in its onsuccess:
    if stored && stored.rev !== snapRev:
        data = Y.mergeUpdates([stored.data, state])     // synchronous, inside the tx
        foreign = stored.data
    else data = state
    newRev = crypto.randomUUID()
    snapshots.put({ doc_id: docId, data, rev: newRev })
    for k of keys: updates.delete(k)                    // deleting a missing key is a no-op
  on complete: snapRev = newRev; applied -= keys
               if foreign: Y.applyUpdate(doc, foreign, STORAGE_ORIGIN)   // never appended
```

**Proof sketch:**
1. IndexedDB runs `readwrite` transactions with overlapping scope one at a time, so reading the snapshot and putting it back is atomic.
2. A row in `keys` was either loaded at hydrate (so it is in `doc`) or appended from `doc` (so it is in `doc`). Both happened before `state` was encoded in the same task. So **deleted rows ⊆ `state` ⊆ the new snapshot.**
3. The old snapshot is in the new one. Either its `rev` equals `snapRev`, meaning this session loaded or wrote it and so it is in `doc`. Or it is merged explicitly. So **old snapshot ⊆ new snapshot.**
4. Rows this session never applied are never deleted. They stay for the next `load`, whoever appended them.
5. Applying `foreign` after commit, with `STORAGE_ORIGIN`, brings another writer's merged content into this `doc`. A later compaction with an unchanged `rev` therefore can't drop it. As built, the store doesn't trust the caller to apply it: until a later `state` covers `foreign`'s state vector, it merges again (§2.2 As built).
6. **Hydrate sees a consistent cut.** A readonly transaction sees every row committed before it started. The key generator only increases, so a row committed later always has a larger key.

This holds whether Web Locks work, fail, are stolen, or don't exist. Locks (§4) only decide who **edits**. The property test in §10 checks this rule against a reference document under random interleavings of two or three writers.

**Triggers** are the desktop ones: more than 500 rows since the snapshot, more than 1 MiB of rows, or release. Compaction runs in `requestIdleCallback`, except on release.

**Seam for desktop.** The same rule would let desktop drop D-A3's "one window per document" later. Architecture §12 says multi-window needs "compare-and-set first", and this is that compare-and-set, with merge in place of retry.

### 2.6 Quota and failure handling

- **`QuotaExceededError`** reaches us as an aborted transaction (`tx.error.name === "QuotaExceededError"`). Other `error` or `abort` events are handled the same way:
  1. The batch stays queued in order. Later batches queue behind it and are never skipped.
  2. App health becomes `cant_save`, and the `beforeunload` guard stays armed.
  3. Retry with backoff: 2 s doubling to 60 s, and at once after the user deletes something, empties Trash, or exports and removes documents.
  4. **Export all** keeps working. It builds the zip from memory plus storage.
- **"Storage low" is not computed from `estimate()` in Chromium.** Chrome now reports `quota` as usage + 10 GiB to stop fingerprinting (blink-dev, `StaticStorageQuota`, M133 intent). The real limit shows up only as `QuotaExceededError`.
  - Firefox and Safari report closer numbers.
  - The library shows **Storage almost full** only when `quota - usage < 100 MB` and the reported quota is under 10 GiB.
  - In every browser, Settings › Storage shows "About 12 MB used by TinyDocy in this browser" from `usage`. MDN calls this "not exact", so the copy says "About".
- `estimate()` runs at startup, after every 5 MB of growth, and at most once a minute. It is wrapped in `try`: it throws `TypeError` where storage is disabled.

### 2.7 Asking for persistent storage

`persist()` behaves differently in each browser, so we **never call it on page load**:

| Browser | What `persist()` does | When we call it |
|---|---|---|
| Chrome, Edge | Decides **silently**, from heuristics: site engagement, installed or bookmarked, notification permission. web.dev documents these; whether they are still current is [unverified]. | Once, right after the first library document is created (no prompt can appear), and again after `appinstalled`. |
| Firefox | Shows a **permission prompt** | Only from **Keep my documents** in the storage card or the first-run card, which explains it first. |
| Safari | Grants "based on heuristics like whether the website is opened as a Home Screen Web App". No prompt. | Same as Chrome. In a Safari tab, the reminders stay even if it returns `true` (§3.2). |

- Choosing the row by browser engine is the **only** use of user-agent sniffing, and it chooses **copy, never behaviour**. An unknown browser gets Firefox's path (call only from a click), which is safe everywhere.
- `persisted()` is read at every start. The result drives the storage card and how often reminders appear (§6.2).

### 2.8 Kill switch

`NEXT_PUBLIC_LIBRARY=0` hides the library's entry points and shows this on the library route: "My documents is turned off on this site for now. Your documents are still stored in this browser." with **[Export all…]**.
- It **never** deletes or wipes the library.
- There is no server switch, because the server never sees the library.

---

## 3. Eviction: what each browser guarantees

### 3.1 Guarantees by browser (as of 2026-11)

| Context | Default mode | Can it be made persistent? | What can delete the library without the user asking | Installing changes… |
|---|---|---|---|---|
| **Chrome / Edge tab** (desktop, Android) | Best-effort | `persist()`, decided silently (§2.7) | **Storage pressure:** whole origins are evicted, least recently used first, when the browser passes its total limit (about 80% of disk). Persistent origins are excluded. | **Nothing about storage.** An installed app shares the profile's storage, locks and channels with tabs [inference]. Being installed counts toward `persist()` being granted. |
| **Chrome incognito** | Temporary. The quota is a share of RAM (Chromium source; web.dev's "about 5% of disk" conflicts) | No | **Everything** when the last incognito window closes | n/a |
| **Firefox tab** | Best-effort. Limit: the smaller of 10% of disk or 10 GiB per site group | Yes, after a permission prompt. Then up to 50% of disk. | Storage pressure, least recently used first, for best-effort sites | Firefox desktop has no install for this purpose |
| **Firefox private** | IndexedDB works (Firefox 115+), encrypted on disk with keys in memory | No | **Everything** when the private session ends | n/a |
| **Safari tab** (macOS, iOS) | Up to 60% of disk per origin. The Safari 17 policy evicts least recently used first. | `persist()` is granted mostly to Home Screen web apps | **The 7-day cap (ITP):** after **7 days of Safari use without a click, tap or key press on the site**, Safari deletes all script-writable storage: IndexedDB, localStorage, service worker registrations and cache, and OPFS. Scrolling doesn't count. Whether `persist()` exempts a site from this is **unresolved**. Storage pressure also applies. | **Installing starts a separate, empty library** (§3.3) |
| **Safari Home Screen web app** (iOS, iPadOS) | Its own storage, isolated from Safari | Likely granted (Home Screen is the named heuristic) | WebKit: ITP never removes a Home Screen web app's first-party data. Storage pressure still applies. | It is the installed context |
| **Safari "Add to Dock" web app** (macOS Sonoma+) | Its own storage. It "shares no … website data … with Safari". | [unverified] | Exemption from the 7-day cap: **[unverified]**. Only the Home Screen exemption is documented. | It is the installed context |
| **Safari private** | In memory | No | **Everything** when the window closes | n/a |
| **Any browser** | none | none | **The user clears site data**, or "cookies and site data". Persistent storage is deleted too, by design. | none |

**Two facts that shape all the copy:**
1. **Eviction removes the whole origin at once.** The library, the sandbox's offline copies, the service-worker cache and the share secrets all go together (MDN: eviction is per origin, all or nothing).
2. **Private windows can't be detected reliably**, and Chrome deliberately hides the quota signal. So the library doesn't try. The storage card always has a line about private windows (§9).

### 3.2 What the interface promises

- **It never says "saved permanently" or "safe".** It says "Saved in this browser".
- **The library chip** (in place of desktop's "Local") reads **This browser**. Its popover depends on the state:

  | State | Popover |
  |---|---|
  | Persistent | "Stored only in this browser on this device. Your browser has agreed to keep it unless you clear site data." |
  | Not persistent | "Stored only in this browser on this device. Your browser can delete it to free up space. Keep a backup." [Back up…] |
  | Safari tab | "Stored only in Safari on this device. Safari deletes it if you don't open TinyDocy for 7 days of browsing. Keep a backup." [Back up…] |

- **Reminders** (§6.2) depend on the guarantee: Safari tab every 3 days, best-effort every 7, persistent every 14, backup folder healthy never.

### 3.3 Does installing the app change the guarantee?

| Browser | Effect of installing | What we show |
|---|---|---|
| Chrome, Edge | Same storage. Usually improves the chance that `persist()` is granted. | After `appinstalled`, we call `persist()` again. If the card changes to persistent, it says so. |
| Safari macOS (Add to Dock) and iOS (Home Screen) | **A separate, empty library.** Safari copies cookies but "does not copy over any other kind of local storage". | Before installing, when this tab's library has documents (on the existing iOS install hint and the macOS help text): **"The installed app starts with an empty library. Export your documents here first, then import them in the app."** [Export all…]. In the installed app's empty state: "This app has its own library, separate from Safari. To bring documents over, export them in Safari and import them here." [Import…] |

- **Detecting installed mode:** `display-mode: standalone` or `window-controls-overlay`. `lib/pwa/install-prompt.ts` already checks this.
- **No automatic copy between the two:** they don't share storage, and a server relay would break "the server never sees it".

### 3.4 Knowing the library was deleted (marker cookie, an owner call)

When the library is evicted, so is everything a script wrote. MDN notes that ITP's cap exempts "Cookies set by server". So **only a cookie set by the server survives**.

**Option, recommended:**
- When the library first holds a document, the page calls `POST /api/library/marker`. The response sets `tdy_lib=1; Max-Age=34560000; Path=/; Secure; SameSite=Lax`. It is not `HttpOnly`, because the static page reads it.
- The server learns one bit, "this browser has a library", and no ids.
- **Delete my library** calls `DELETE /api/library/marker`.
- **Marker present, IndexedDB empty:** state `library_removed` (§9): "Your browser removed the documents stored here."
- **No marker:** the neutral empty state. It always ends with "Had documents here before? Your browser may have removed them. [Import a backup…]".
- **If the owner declines:** no cookie. Only the neutral empty state. The privacy policy mentions the cookie if it ships.

---

## 4. Several tabs on the same document

### 4.1 Model

| Role | Who | What it does |
|---|---|---|
| **Writer** | The tab holding the Web Lock `tinydocy-lib/doc/<id>` (exclusive) | Owns the editable Y.Doc. Appends, compacts, writes the `md` cache. Broadcasts **every** update its doc receives on BroadcastChannel `tinydocy-lib/doc/<id>`. |
| **Mirror** | Any other tab that opens the same document | Loads from storage, then asks the writer for the rest (`hello { sv }` → `diff { update }`), then applies broadcast updates live. It never appends. `WriteGate.canWrite()` is false, with `readOnlyReason = "open_elsewhere"`, so the five plugins that write on open (details spec §1 rule 2) make no change either. Shows a banner (§9). |
| **Index writer** | Any tab | Index transactions are small and serialized by IndexedDB. Each bumps `meta.rev` and posts `{ rev, changes }` on `tinydocy-library`. A tab that sees a jump in `rev` (it missed messages, for example while in bfcache) reloads `DocumentIndex.snapshot()`. |
| **Maintenance** | The holder of `tinydocy-lib/maintenance`, taken with `ifAvailable` | Purges Trash after 30 days and writes the backup folder. Purging a document also needs that document's lock (`ifAvailable`), and is skipped if the document is open anywhere. This is the web form of desktop §6.2's "content writes only in Closed". |

**Why one writer and not many.**
- With several writers, every tab would edit at once and send its updates to a leader that persists them. That needs an ack protocol, and leadership changes while updates are pending.
- A `SharedWorker` that owns the Y.Doc would be simpler, but Chrome for Android doesn't support SharedWorker [unverified as of 2026].
- Desktop is also one writer per document, and plan §15 defers multi-window editing. W-D3 already makes storage safe for many writers, so this can change later without touching storage.

### 4.2 Handoff: **Edit here**

```mermaid
sequenceDiagram
  participant M as Mirror tab (user clicks Edit here)
  participant W as Writer tab
  M->>W: "handoff-request { tab }" (BroadcastChannel)
  W->>W: "WriteGate off (read-only), flush batcher, await acks"
  W-->>M: "handoff-ready { sv }"
  W->>W: "release lock, become mirror"
  M->>M: "its already-queued lock request is granted (Edit here never adds a second request)"
  M->>M: "load from storage (HYDRATE), append diff of doc vs stored state"
  M->>M: "readOnlyReason = null; editable; focus editor at caret"
  Note over M,W: "No answer in 3 s: 'The other tab isn't responding.' [Edit here anyway] uses { steal: true }"
```

- **Steal only after the timeout, and only when the user clicks.**
  - A tab whose lock was stolen sees its lock promise reject with `AbortError`.
  - It turns on `WriteGate` at once. It still **appends whatever it had queued**, which is safe under W-D3. It posts its final `diff` to the new writer, which applies it and appends it (idempotent). Then it becomes a mirror.
  - Nothing is dropped.
- **Automatic promotion.**
  - A mirror tab queues a lock request only while it is **visible**. The request is aborted through `signal` when the tab is hidden.
  - When the writer closes, crashes or is discarded, the browser releases its lock, and the first visible mirror in the queue is promoted:
    1. It loads from storage.
    2. It **appends `Y.encodeStateAsUpdate(doc, storedStateVector)`**: the edits it received live from the writer that never reached disk. This rescues up to the writer's last second.
    3. It becomes editable, with a polite status: "You can edit here now."
  - Two visible mirrors (windows side by side) are granted the lock in queue order. That is acceptable, and the other banner updates.
- **Rename from the sidebar** follows details spec §2.3:
  - document open in this tab: rename in this tab
  - open as writer in another tab: send `rename { title }` on the channel, and the writer runs `setTitleText`
  - closed: take the document's lock with `ifAvailable`, run the real `local-session.open`, `setTitleText`, flush, release
- **Export and backup of an open document:** post `flush-request` and wait up to 1 s for `flushed`, then read storage. A document whose writer doesn't answer is exported from storage, which is at most about 1 s behind. The export summary says so.

### 4.3 Lifecycle facts this relies on

| Fact | Source | Design consequence |
|---|---|---|
| Locks are per storage bucket. They are released when the page unloads or the agent terminates. Each private session is a separate agent. | W3C Web Locks spec | A crash or discard frees the document. Private windows never block normal ones. |
| **A page holding a Web Lock isn't eligible for bfcache** (reported as `"lock"`), unless it releases the lock in `pagehide` | MDN NotRestoredReasons; blink-dev; the WPT test `performance-navigation-timing-lock` | The writer flushes and **releases in `pagehide`**. On `pageshow` with `persisted`, it retries with `ifAvailable`: if it gets the lock it reloads and becomes the writer, otherwise it becomes a mirror. |
| Chrome's Energy Saver freezing (Chrome 133+) does not freeze tabs holding a Web Lock or a blocking IndexedDB connection | Chrome for Developers, Jan 2025 | Handoff normally gets an answer on desktop Chrome. |
| iOS can suspend a background tab that still holds a lock [inference] | none | This is why there is a 3 s timeout and **Edit here anyway**. |
| Lockdown Mode in Safari removes Web Locks. Locks need Safari 15.4+. | WebKit, Safari 17 | **No `navigator.locks`:** every tab is a writer. Storage stays correct (W-D3). The library shows "Editing in more than one tab at once isn't supported in this browser. Use one tab per document." Mirrors aren't available. **Maintenance is disabled** (Trash purge, backup-folder writes), so a purge can never run beside a writer; Trash then empties only by hand. |
| A Safari app on the Dock or Home Screen and a Safari tab share **no** website data | Apple support 104996 [inference: so no locks or channels either] | They are two libraries. They can't conflict. |
| A Chrome app window and a tab share storage, locks and channels | [inference] | They are one library. Handoff works between them. |

### 4.4 Sandbox tabs

- Sandbox documents stay on `collab-session`, synced through the server. Several tabs on one sandbox document are fine **while online**.
- **The offline overwrite bug is real** (§1), and the fix in §11.1 is small. It is **not** a library dependency.
- **Sandbox and library documents never share a Y.Doc or a lock namespace.** Library documents never enter `global-tabs`, and sandbox ids never enter the library.

---

## 5. Coexisting with the public sandbox

### 5.1 Information architecture

```text
my.tiny.docs.plus  (W-D8; or /library on the same origin, §5.5)
┌ Sidebar ─────────────────────┐
│ ⌕ Search                     │
│ MY DOCUMENTS                 │  ← heading; under it, muted: "Stored in this browser"
│   Recent                     │
│   Pinned                     │
│   Library ▸ folders…         │
│   Tags                       │
│ ──────────────────────────── │
│ PUBLIC SANDBOX ↗             │  ← link to tiny.docs.plus; muted: "Everyone can see and edit these"
│ ──────────────────────────── │
│ 🗑 Trash          ⛁ Storage   │  ← footer: Trash, and the storage card (§9)
└──────────────────────────────┘
Header: [This browser ▾] chip · Share · ⋯

tiny.docs.plus  (sandbox, unchanged layout)
Tab bar: [Playground] [doc] [doc] …  +  ·  chip [Public ▾] · "My documents" link
```

- **Sandbox chip `Public`** (new, W5). Its popover says: "Everyone who visits tiny.docs.plus can see, edit and delete the documents here. For private documents, use My documents." with **[Open My documents]**.
- **Library chip `This browser`** (§3.2).
- **Two words only.** The interface uses "My documents" and "Public sandbox" everywhere. It never says "local tab" or "cloud".
- **The Playground stays in the sandbox.** A new library starts empty (§9 empty state), with a link to the Playground.

### 5.2 Moving a sandbox document into the library

**"Copy to My documents"** appears in the sandbox tab's context menu and in ⋯.

1. The sandbox tab already holds the Y.Doc. It encodes a `.tinydoc` (the P2.10 writer: header + `stateOf`) **in the page**. No server request.
2. **Across origins (W-D8):**
   - The sandbox tab calls `window.open("https://my.tiny.docs.plus/receive")` from the click.
   - It waits for `ready` from exactly that origin.
   - It sends `postMessage({ kind: "tinydoc", bytes, title }, "https://my.tiny.docs.plus")`, with the bytes transferred.
   - The receiving page accepts one message, only from the sandbox origin and only when `window.opener` exists. Then it closes the channel.
3. The library asks: **"Add "Q4 plan" to My documents? It becomes a private copy in this browser. Later changes in the sandbox won't reach it."** [Add] [Cancel]
   - It asks because the content comes from another origin, and a click isn't consent to store it.
4. **Import runs the `.tinydoc` import path** (P2.8 / P2.10): size guard, schema check, and the migrations that run at import (legacy mark renames, editor-root sweep).
5. The copy gets a **new `lineage`** and a new id. It never links back. The sandbox document is untouched.
   - Toast: "Copied to My documents." [Open]

**COOP.** The flow needs `window.opener`. Today `next.config.ts` sets no `Cross-Origin-Opener-Policy`. If either origin ever sets `same-origin`, the opener is cut and this flow falls back to Download, then Import. A test in W9 asserts the header stays absent or `same-origin-allow-popups`.

**Fallback, and the path for desktop users:** **Download** (P2.10) saves `.tinydoc` or `.md`, which **Import…** in the library accepts.

**Never offered:**
- "Move" (which would delete the sandbox document for everyone)
- "Copy from My documents to the sandbox". Publishing goes through **Share** (§5.4) or **Send a copy**.

### 5.3 URLs and what the server never sees

**Local ids never appear in a URL.**
- The library's address is always `/` (W-D8) or `/library` (same origin).
- The open document lives in `history.state = { doc: <uuid> }`. Reload, Back and Forward work. Duplicating a tab copies the state and opens a mirror (§4).
- **Copy the address bar** gives only the library home. There is no "Copy link" for a library document. The Share menu offers **Send a copy** and, in the Live milestone, **Invite to edit**, which makes an `/s/` link.
- **Why not `/d/<id>` or `#doc=<id>`:** a pasted link would look shareable, and it would fail for the recipient.
- **A malformed `history.state` id** (for example, typed in devtools) shows "This document isn't in this browser."

**What the server never sees**, until the user shares:
- document content
- titles, snippets, folder and tag names
- document ids and lineage
- counts and sizes
- backup reminders and export events

**What the server does see:**
- requests for the static app shell and `/_next/static`
- the optional one-bit marker cookie (§3.4)
- for **shared** documents only, what plan §6 lists

**Analytics:** recommended **none on the library origin**. GA isn't loaded there, and the consent banner isn't shown. This keeps the CSP tight (§5.5) and the privacy story one sentence long. If the owner wants usage numbers, a later PR can send counts only (never titles or ids) with the same consent.

### 5.4 The library and its socket

- A library document opens with `provider: null` (P2.2), so `CollabStatusGroup` doesn't render and no socket is opened.
- `@hocuspocus/provider` is `import()`ed only when a **Live** document opens (W10).
- **The library route never imports `collab-session`, `use-synced-tabs` or `useConnectionState`**, enforced by the import-boundary test (§7.3).

### 5.5 Origin and CSP (W-D8, owner question Q1)

| | **Own origin (recommended)** | Same origin, `/library` |
|---|---|---|
| Who can read the library | Only code served by the library origin | Also X's `widgets.js` and GA on the sandbox pages. Also any script injected through a sandbox document every visitor auto-opens (a self-spreading surface). |
| CSP | **No third-party script hosts**: no X, no GA. X posts render as **link cards**, as on desktop. Goal: `script-src 'self' 'sha256-…'` with no `'unsafe-inline'`. Hashes work with service-worker-cached HTML, unlike nonces (`content-security-policy.ts:44`). **Not yet verified:** how many inline scripts the App Router puts into the prerendered page, and whether they stay the same between builds. W4 checks this (§11). | The whole site must drop X's widget script before the library ships (and `'unsafe-inline'`, if W4 shows that is possible), and GA stays a residual risk |
| Cost | Traefik route and certificate, a second manifest (`id: "/"` on the new origin), CORS for share endpoints (P4.2c), postMessage for "Copy to My documents", `HOCUS_ALLOWED_ORIGINS` gains the origin (for Live documents only) | One route, one install |
| Safari 7-day clock | Interaction is probably counted per registrable domain (`docs.plus`), so visiting the sandbox may also count [unverified] | Same site |
| Existing installs | Keep the sandbox. The library is a separate install. | One app with both |

**Both options need:**
- The library route in `SHELL_PATHS`.
- `noindex`, plus `robots` and `sitemap` exclusions.
- `Referrer-Policy: no-referrer`.
- `frame-ancestors 'none'`, as today.

---

## 6. Backups, export and import

### 6.1 Export all

**Where it appears:** Settings › Storage, the storage card, reminders, the Library ⋯ menu, and every danger state in §9.

**Format:** a zip, `TinyDocy backup <YYYY-MM-DD>.zip`:

```text
library.json         { format: 1, library_id, exported_at, folders[], tags[], docs[{ id, title, folder_id, pinned, tags[] (names, not ids), created_at, modified_at, lineage, link_key, kind, sort_key, file }] }
Documents/<folder path>/<clean title>-<short id>.tinydoc   (TINYDOC2: magic + JSON header with v, minReader, enc: null, lineage + state, as P2.8; v8, S8)
Documents/<folder path>/<clean title>-<short id>.md        (front matter: tags, created, modified)
```

- **File names** go through desktop's `filenames.ts` rules: separators, `..`, reserved names, trailing dots, and paths of at most 240 characters.
- **Format rules (v8, S8, S8b, D40):** readers of `library.json` ignore unknown keys and refuse a higher `format` major; `.tinydoc` readers refuse a `minReader` above their own and any `enc` other than `null` with "made with a newer TinyDocy". Nothing writes or reads `TINYDOC1`. `library.json` never carries `device_id`, identity or secrets (D5).
- **Restore keeps ids (S8c):** restoring a backup zip or `library.json` into an empty library keeps document, folder and link ids and lineage; importing into a non-empty library keeps lineage and mints a new id only on collision. A single `.tinydoc` import still gets a new `link_key`, and its header carries no id.
- **Shared code:** the cleaning rules and the `library.json` schema live in a pure, shared module, so the desktop **Export all…** and **Restore from backup…** read and write the same archive.
- **Zip library:** `fflate`, **lazy-loaded** when export starts (about 8 KB gz [unverified size]). It runs streaming, per file, so memory stays near the largest document.
  - Chromium streams to `showSaveFilePicker()` when available.
  - Elsewhere it builds a `Blob` and downloads through `<a download>`. iOS saves this to Files.
- **Markdown:**
  - comes from the `md` cache, written by the writer tab on idle and on release, with the shared Tiptap serializer (lazy)
  - a document whose cache is missing or older than `modified_at` is serialized headless during export (the editor schema plus y-prosemirror, without a view)
  - export never mounts editors
- **Progress:** a pill: "Exporting 34 of 120…" [Cancel]. Done: "Exported 120 documents. 2 documents open in other tabs were exported from their last save." (that second sentence appears only when it's true)
- **On success:** sets `meta.last_full_export_at` and each document's `exported_at`.
- **Never in the zip** (D5): share secrets, the backup-folder handle, or blobs that the image-store design doesn't add to `.tinydoc`.

### 6.2 Reminders

| Condition | Reminder interval |
|---|---|
| Backup folder connected and healthy (§6.3) | none |
| `persisted()` is true, not Safari | 14 days |
| Best-effort (`persisted()` false), not Safari | 7 days |
| Safari tab (any `persisted()` value) | 3 days, which leaves margin under the 7-day cap |

- **When:** a reminder shows only if at least one document changed since the last full export, and the interval has passed since that export (or since the library was created).
- **Where:** a pill in the sidebar footer, **"Back up your documents"**. Clicking it opens the storage card. It never opens a modal or steals focus, and it is announced politely once per session.
- **Card actions:** [Export all…] [Remind me in a week]. When persisted or a folder is connected, the card also offers [Don't remind me again].
- **One-time first-run nudge:** when the library first holds 3 documents, or 30 minutes of total editing, the storage card opens once, inline.

### 6.3 Backup folder (Chromium only, optional, W8)

- **Settings › Storage › Back up to a folder…** appears only when `showDirectoryPicker` exists. Chrome, Edge and other Chromium browsers have it. Firefox and Safari don't, and their positions are negative or none.
- **Behaviour:**
  - Mirrors changed documents as `.tinydoc` and `.md`, with the same layout and rules as desktop `mirror.ts`. It runs on idle, under the maintenance lock.
  - `createWritable()` writes to a swap file and replaces the target on `close()`, so a crash leaves the previous copy.
- **Permission:**
  - The handle is stored in `meta`. On each start, `queryPermission({ mode: "readwrite" })` runs.
  - `granted`: back up silently.
  - `prompt`: shows the `backup_folder_needs_permission` state with **[Reconnect]**. `requestPermission` needs a click.
  - Chrome 122+ offers "Allow on every visit", and installed apps keep the permission by default.
- **Survives eviction.** The files are outside the browser. When the library is removed, the handle goes with it, but **Import…** of that folder (§6.4) restores everything.
- **Conflict guard:**
  - Writes `.tinydocy-backup.json { library_id }` in the folder.
  - If it finds another `library_id` (for example, a desktop backup folder or another browser): "This folder holds backups from another library. Choose an empty folder, or a folder used only by this browser."

### 6.4 Import

**Accepts:** `.tinydoc`, `.md`, `.html`, a TinyDocy backup zip, or a **folder**.
- A folder means a desktop `TinyDocy Backups` folder or the backup folder from §6.3.
- It uses `<input type=file multiple>` and `webkitdirectory`, which work in all target browsers, plus drag and drop.

**Rules:**
- **Same `lineage` as a document already here.** Desktop plan §5.3's dialog, with web words: "This is a backup of "Q4 plan" from 12 Nov. [Open current] [Restore this version…] [Keep as separate copy]". Restoring is one forward edit through `updateYFragment`, so it can be undone.
- **A zip with `library.json`:** folders, tags and pins are recreated. Name collisions get " (2)".
- **Size, schema and migrations:** the import guard from P2.8.
- **Summary:** "Imported 118 documents. 2 files couldn't be read." [Show details]

### 6.5 Delete my library

**Settings › Storage › Delete my library from this browser…**

"Delete all 120 documents stored in this browser? This can't be undone. Export a backup first if you might need them. [Export all…] [Delete everything] [Cancel]"

- The dialog doesn't need a typed confirmation, because Export is offered right there.
- **[Delete everything]** stays disabled for 2 s.
- Deleting also clears the marker cookie.

---

## 7. Code sharing with desktop

### 7.1 Reused unchanged

| Desktop piece | Web use | Required change in the desktop plan |
|---|---|---|
| `local-session` (architecture §5.1): load, hydrate, migration hook, batcher wiring, deferred release | **The same file**, given an `IdbDocStore` | Move it from `lib/platform/desktop/` to **`lib/platform/local-session.ts`** (P2.1). It imports only `ports.ts`. |
| The batcher and compaction trigger (architecture §5.2) | Same | Extract it as **`lib/platform/batcher.ts`** (P2.1 / P2.6) |
| `DocSession`, `DocStore`, `DocumentIndex`, `AppShell` ports | Same types | `DocStore` gains one thing: `compact` resolves with `{ foreign }`, the stored snapshot it merged in, which `local-session` applies with `STORAGE_ORIGIN` (P2.1; desktop always returns null). The web adapter keeps `applied` internally (§2.5). |
| `WriteGate`, the stable Awareness, provider optional | Same | none (P2.2) |
| Files sidebar tree, Pinned, Move to…, drag and drop, Quick Open | Same components | **Place them in `components/library/`, not `components/desktop/`** (P2.7a). The import-boundary rules (architecture §3.3) would otherwise forbid the web from importing them. Desktop-only chrome stays in `components/desktop/`: titlebar, native menus, Settings window, first run. |
| List views, sort, group, filter, tag filter, virtualization | Same | `components/library/` (P2.7b) |
| Tag row, tag colours, rename and merge dialogs | Same | `components/library/` (P2.9b) |
| Page preferences, `doc_view` override, Page popover | Same. The web reads `doc_view` in `local-session.open` before mount. | none (P2.9c already ships width and text size to the web) |
| `displayTitle`, `setTitleText`, filename rules, `.tinydoc` reader and writer, import migrations | Same pure modules | none |
| Sync reducer and chip table (`lib/sync/doc-sync-state.ts`) | Same, plus the web-only rows in §9 | Add `open_elsewhere` to editability, and `cant_save`, `library_removed` and `library_reload` to app health |

**Menus.** The library's ⋯ menu and the command palette's App group list the same commands as the desktop menu table. Desktop-only items are hidden, such as Show in Finder and Window.

### 7.2 Web adapters

| Port | Web adapter | Notes |
|---|---|---|
| `DocSession` | `web-doc-session.ts` | Writer role: `local-session` over `IdbDocStore`. Mirror role: storage load plus the BroadcastChannel feed, with `readOnlyReason = "open_elsewhere"`. |
| `DocStore` | `IdbDocStore` (W2) | §2.3–§2.6. One instance per tab. Keeps `applied` and `snapRev` per open document. |
| `DocumentIndex` | `IdbDocumentIndex` (W2) | The `snapshot()` / `subscribe()` / `rev` feed over BroadcastChannel |
| `DocumentIndex` (sandbox) | `GlobalTabsIndex`: today's `use-synced-tabs` internals (P2.3) | Unchanged, except W1's soft delete |
| `AppShell` | `BrowserShell` | `onFlushRequested` comes from `visibilitychange`, `pagehide` and `blur`. The `beforeunload` guard is armed while batches are unacked or failed. `openExternal` is `window.open(…, "noopener")`. `reveal` is absent. |
| Lease (web only) | `web-lease.ts` | Web Locks with `ifAvailable`, the visible-only queue, `steal` after timeout, and the no-locks fallback. Desktop's equivalent is main's registry inside `doc.open`. |
| (Live) `SecretStore` | `IdbSecretStore` | The `remotes` store, **unencrypted** (§8.2) |
| (Live) `ShareService` | `fetch` to the share endpoints | CORS for the library origin (P4.2c) |
| (Live) `SyncAttachment` | `HocuspocusProvider` over the shared socket, `import()`ed when needed | |
| Blobs (image store) | `IdbBlobStore` in the `blobs` store | Defined by the image store design |

### 7.3 Routing, shell and `use-synced-tabs`

- **Sandbox (`tiny.docs.plus/`)**
  - `app/page.tsx` and `EditorApp` are unchanged, apart from:
    - P2.3 (the index port)
    - W1 (soft delete)
    - W5: the `Public` chip, the "My documents" link and "Copy to My documents"
  - **`use-synced-tabs` doesn't learn about the library.**
- **Library**
  - **Under W-D8:** host-based routing in `proxy.ts` / middleware rewrites the library host's `/` to `app/(library)/library/page.tsx`. The sandbox host answers `/library` with a 308 redirect to the library origin.
  - **On the same origin:** the same page is served at `/library`.
  - **The page** server-renders only a static library skeleton with the sidebar's frame, so nothing paints before JS. It then dynamically imports `LibraryRoot` with `ssr: false`.
  - **`LibraryRoot`** is the composition root, like desktop's `DesktopRoot`. It creates `IdbDocStore`, `IdbDocumentIndex`, `BrowserShell` and the lease inside the component, and provides `DocSessionContext`. It prefetches the editor chunk at mount, as `EditorApp` does today.
- **Import boundaries** (an addition to `tests/unit/ci/import-boundaries.test.ts`):

  | From | Must not import |
  |---|---|
  | `app/(library)/**`, `components/library/**`, `lib/platform/web/library/**` | `lib/collab-session.ts`, `hooks/use-synced-tabs.ts`, `hooks/use-connection-state.ts`, `lib/offline/**`, `lib/analytics*.ts` |

- **Bundle**
  - **Editor chunk:** +0 B beyond P2.2's 600 B gz allowance. All library code is outside the editor's chunk group, and `check-editor-chunk-size.ts` proves it.
  - **Library route:** a new `scripts/check-library-chunk-size.ts`. Its budget is set from W4's measurement and held like the editor chunk's, with growth needing an amendment. `fflate`, import, tags dialogs, Settings › Storage and the backup folder are lazy.
  - **Sandbox `/`:** at most +0.5 KB gz for the chip, the link and the menu item. "Copy to My documents" lazy-loads the `.tinydoc` writer.

---

## 8. Sharing from the web (the Live milestone, in the combined v1, D6)

### 8.1 Flow

- **The same as desktop plan §5.4.** The difference: the consent dialog is a `components/ui` `Dialog` in the page, because there's no main process.
- **Joining:** the `/s/<id>` handoff page (P4.3) keeps the secret **in memory only**. Its **Continue in browser** action:
  - **Under W-D8:** navigates to `https://my.tiny.docs.plus/join#id=<share id>&e=<secret>` (or `v=` for a view link; the S1b grammar, parsed by the shared `lib/sharing/link.ts`, v8). The library page reads the fragment, clears it at once with `history.replaceState`, and asks: "Add "Q4 plan" to My documents as a live document? Anyone with the link can edit it." [Add] [Cancel]
  - After **[Add]**, the joined document and its secret (`e` or `view`) are stored in `docs` + `remotes`. The page derives the auth tokens itself (S1, details §8.2); they're never stored or sent in a URL.
- **Sharing from the library (v8, S1):** the page generates `e` and the owner secret with `crypto.getRandomValues`, derives the tokens with WebCrypto `deriveBits`, and sends only the three hashes to `POST /api/shares`. Reset does the same with new secrets and gets a new `share_id`.
  - **"Just look, don't add"** keeps today's single-document view on `/s/`, with nothing stored.

### 8.2 Secrets in IndexedDB: the risks

| Risk | Consequence | Mitigation |
|---|---|---|
| **Eviction** (Safari 7-day cap, storage pressure, clear site data, private window closed) | The **owner secret is lost**, so the user can't stop, reset or make view-only. The share keeps running until 30 days after the last edit (plan §6). This is K17. | Honest copy (§8.3). The Report link plus `share-admin` let the operator end abusive shares. **Owner question Q2.** |
| **Script on the origin** (XSS, a third-party script) | Every edit, view and owner secret is readable, along with all content | W-D8 (own origin, strict CSP). Secrets aren't "encrypted at rest": any key would sit in the same origin, so encrypting would be theatre. `CryptoKey` with `extractable: false` can't serve as a bearer token. |
| **Devtools or a shared computer** | Anyone at the keyboard can read secrets | The same as desktop on Linux without a keyring. Help says: "Anyone who can use this browser profile can open your shared documents." |

**Why "Export a backup first" is not required.**
- D5 keeps share secrets **out** of backups. So an export saves the content, but **not** the ability to stop the share.
- Making export a precondition would look like protection without giving any.
- **Instead:** the share consent dialog shows the storage guarantee, and the first share sets the backup reminder's clock to "due" so content is protected.

### 8.3 Copy

| Where | Copy |
|---|---|
| Share consent (web, added to plan §5.4's list) | "This browser keeps the only key that can stop or reset this link. If your browser deletes this site's data, you won't be able to stop it; the link then ends 30 days after the last edit." |
| Same, extra line in a Safari tab | "Safari deletes this site's data if you don't open TinyDocy for 7 days of browsing." |
| Manage sharing panel, footer | "Stopping this link works only from this browser." |
| (If Q2 = option a) Manage sharing › **Save a stop-sharing key…** | "Anyone with this key can stop or reset the link for everyone. Keep it private, like a password." [Copy key] [Download key file] |
| After **Reset link** (v8, D12) | Manage sharing offers **Save a stop-sharing key…** again, because the old key no longer works: "The old stop-sharing key no longer works. Save the new one?" [Save a stop-sharing key…] [Not now] |
| A Live document in the library after eviction and re-import from a backup | "This document was shared before. Its link may still work for others, but this copy is no longer connected." [Keep as Local] |

---

## 9. States and exact copy

**How states appear:**
- **Banners** use `role="status"`, except errors that block saving, which use `role="alert"`.
- **Pills** follow the existing pill host.
- The tone follows the UX spec §9: say what happens to the person's work.

| State | Trigger | Where | Copy | Actions |
|---|---|---|---|---|
| **First run** | Library empty, no marker | Main area, empty state | **"My documents"** · "Documents you create here are saved in this browser on this device. They aren't shared and aren't sent to our server." · "Had documents here before? Your browser may have removed them." | [New document] [Import…] · link: "Try the public Playground" |
| **Storage card: persistent** | `persisted()` true | Storage card, Settings › Storage | "Your browser has agreed to keep these documents unless you clear this site's data. A backup still protects you if this device is lost." · "About 12 MB used." · "In a private window, everything here is deleted when you close the window." | [Export all…] [Back up to a folder…]¹ |
| **Storage card: not persistent** | `persisted()` false | Same | "Your browser may delete these documents to free up space, without asking. Keep a backup." (same usage and private-window lines) | [Keep my documents] [Export all…] [Back up to a folder…]¹ |
| After [Keep my documents], refused | `persist()` false | Card | "Your browser didn't agree. It decides on its own; installing TinyDocy or bookmarking it often helps. Keep a backup either way." | [Export all…] |
| **Safari tab** | WebKit and not standalone | Card, chip popover | "Safari deletes this site's data if you don't open TinyDocy for 7 days of browsing. Back up regularly, or add TinyDocy to your Dock or Home Screen. The installed app starts with an empty library." | [Export all…] [How to install] |
| **Installed Safari app, empty** | Standalone, WebKit, empty | Empty state | "This app has its own library, separate from Safari. To bring documents over, export them in Safari and import them here." | [Import…] |
| **Backup reminder** | §6.2 | Sidebar footer pill | "Back up your documents" · card: "You changed 4 documents since your last backup on 2 Nov." | [Export all…] [Remind me in a week] ([Don't remind me again]²) |
| **Storage almost full** | §2.6 rule | Banner | "This browser is almost out of space for TinyDocy (about 40 MB left). Export a backup and remove documents you don't need." | [Export all…] [Open Trash] |
| **Can't save** | Write failed (quota or I/O) | Banner (`alert`), chip ⚠ | "Can't save changes in this browser right now (storage is full). Keep this tab open; your changes are kept here and will be saved when space is freed." For other errors: "(the browser refused to save)". | [Export all…] [Empty Trash] [Try again] |
| **Open in another tab** | Mirror role | Banner above the document, `aria-readonly` on the editor | "This document is open for editing in another tab. You're seeing live changes, read-only." | [Edit here] |
| Handoff not answered | 3 s timeout | Same banner | "The other tab isn't responding. If you edit here, that tab stops editing and keeps nothing unsaved." | [Edit here anyway] [Cancel] |
| Promoted | The writer closed | Status (polite) | "You can edit here now." | none |
| Lost the writer role | Stolen | Banner | "Editing moved to another tab. Your changes from this tab were saved." | [Edit here] |
| **No Web Locks** | `navigator.locks` missing | One-time banner | "Editing in more than one tab at once isn't supported in this browser. Use one tab per document." | [OK] |
| **Library removed** | Marker present, library empty | Main area | "Your browser removed the documents stored here. This happens when it needs space, or after a period without visits in Safari. If you have a backup, you can bring them back." | [Import a backup…] [Start empty] |
| **Library unavailable** | `open()` fails or storage disabled | Main area | "This browser isn't letting TinyDocy store documents. Check that site data is allowed for this site, or use another browser. The public sandbox still works." | [Open the public sandbox] |
| **Updated in another tab** | `versionchange` | Banner (`alert`) | "TinyDocy was updated in another tab. Reload to keep editing. Your changes are saved." | [Reload] |
| **Upgrade blocked** | `onblocked` | Banner | "TinyDocy was updated. Close other TinyDocy tabs to continue." | none |
| **Library too new** | `format_version` is newer | Banner, read-only | "These documents were saved by a newer version of TinyDocy. Reload to update." | [Reload] |
| **Not in this browser** | Unknown id in `history.state` or in an imported link | Main area | "This document isn't in this browser. Documents in My documents are stored only in the browser that created them." | [Go to My documents] |
| **Backup folder needs permission** | `queryPermission` = prompt | Card, Settings | "Reconnect your backup folder to keep backing up." | [Reconnect] |
| **Backup folder failing** | Write error | Chip ⚠, Settings | "Backups aren't being written to "TinyDocy Backups". Your documents are still in this browser." | [Choose another folder] |
| **Library turned off** | `NEXT_PUBLIC_LIBRARY=0` | Main area | "My documents is turned off on this site for now. Your documents are still stored in this browser." | [Export all…] |
| **Copy received** (§5.2) | `postMessage` | Dialog | "Add "Q4 plan" to My documents? It becomes a private copy in this browser. Later changes in the sandbox won't reach it." | [Add] [Cancel] |

¹ Chromium only. ² Only when persisted or a folder is connected.

**Accessibility** (UX spec §8 applies):
- **Landmarks:** sidebar `nav aria-label="My documents"`. Its "Public sandbox" link says that it opens another site.
- **Headings:** the storage card is a `region` with a heading.
- **Focus:**
  - **Edit here:** focus moves to the editor at the caret, with a polite announcement "Editing here."
  - **Mirror banner:** focus never moves on its own.
  - **Dialogs** are `components/ui` dialogs with focus trap and return. Destructive buttons aren't the default.
  - **The 2 s disable** on "Delete everything" is announced ("Available in 2 seconds").
- **Progress and colour:** export progress is a `progressbar` with text. Colour is never the only signal; the ⚠ has a text label.
- **Contrast:** every state passes contrast in light, dark and `forced-colors`. The axe check runs on each state in Playwright.

---

## 10. Testing

| Layer | Test | Runs on |
|---|---|---|
| `DocStore` contract (architecture §11): load, append, origins, idempotent resend, compaction, flush | **The same suite** as desktop, given an `IdbDocStore` | `bun test` with **`fake-indexeddb`** (new dev dependency; established, so `minimumReleaseAge` isn't an issue). Also in Playwright `chromium`, `webkit` and `firefox`, through a test page, because happy-dom has no IndexedDB. |
| **Compaction with several writers** (§2.5) | Property test: 2–3 `IdbDocStore` sessions on one database with random appends, compactions, reloads, a stale writer appending late and a stolen lock. After each step, `load()` must equal the union of every update ever acked. | `fake-indexeddb`, 2,000 runs per PR, 50,000 nightly |
| Quota and failure | Make `put` abort with `QuotaExceededError` (fault injection): the batch stays queued, health `cant_save`, `beforeunload` armed, no gap after recovery | unit |
| `DocumentIndex` | rev feed, Trash groups, tag merge, 4-level folders | unit + Playwright |
| **Fresh storage** | Every Playwright context starts with cleared storage: first-run copy, no socket and no GA request (checked against the network log) | `chromium`, `webkit` |
| Persistence | Type, reload, and the content is there. Type, then `page.close({ runBeforeUnload: false })` within 1 s: at most the last batch is lost. | `chromium`, `webkit`, `firefox` (new project, library specs only) |
| **Crash** | CDP `Page.crash` during append and during compaction, then reopen: no committed row is lost | `chromium` |
| **Multiple tabs** | Two pages in one context: the second is a mirror (read-only, live). Edit here hands over. Closing the writer promotes the mirror and **rescues unflushed edits** (block the writer's IndexedDB writes with a test hook, type, close). Unresponsive writer: a hook ignores handoff, Edit here anyway steals, and nothing is lost. Duplicate tab opens a mirror. A bfcache round trip releases and re-takes the lock. | `chromium`, `webkit` |
| No Web Locks | `addInitScript(() => delete Navigator.prototype.locks)`: both tabs edit, both sets of edits survive reload, and the banner shows | `chromium` |
| **Quota** | CDP **`Storage.overrideQuotaForOrigin`** sets a small quota, which produces a real `QuotaExceededError`, then the Can't save state, then raising the quota saves everything | `chromium` |
| `estimate()` / `persist()` / `persisted()` | `addInitScript` stubs for each storage-card variant, and for refusal after Keep my documents | `chromium`, `webkit` |
| **Eviction** | CDP `Storage.clearDataForOrigin` (types `indexeddb`) leaves the marker cookie → "Library removed". Clearing cookies too → neutral first run. | `chromium` |
| Versions | Open the database at version N+1 in a second page, then the first page shows "Updated in another tab". A newer `format_version` gives a read-only library. | `chromium` |
| Export and import | Download → unzip in the test → compare `.tinydoc` state and `.md` text with the source. Import the desktop backup fixtures (folder and zip), and a same-lineage dialog. | `chromium`, `webkit` |
| Backup folder | A test hook passes an **OPFS** `FileSystemDirectoryHandle` (from `navigator.storage.getDirectory()`) as the chosen folder. Files are written atomically, and a folder from another `library_id` is refused. | `chromium` |
| Copy from the sandbox | A sandbox page plus a library page on two origins (two hosts on localhost). The `postMessage` flow, the dialog, new lineage, migrations applied. | `chromium` |
| Privacy | Seed a known title, run every flow, and assert it never appears in any network request, URL or analytics call | `chromium` |
| Accessibility | axe on every state in §9, plus the keyboard checklist (UX spec §8.3) on the library sidebar | `chromium` |
| Performance | Typing latency with strict commits (W2). Sidebar with 1,000 documents in ≤ 600 ms from IndexedDB. Export of 1,000 documents. | `perf` |

**Nightly:** a `library-soak` that runs 30 minutes of random typing in 3 tabs with random handoffs, reloads, crashes and compactions. The reference state is checked after every reload.

---

## 11. PRs

**Numbering:** W1 is taken (soft delete, D8). **Effort** is agent-days of implementation plus review rounds. The owner's hours are design reviews and deploys.

| # | PR | Lens | Depends on | Effort | Exit criteria |
|---|---|---|---|---|---|
| **W2** | **Library storage core:** the `tinydocy-library` schema, `IdbDocStore` (strict appends, multi-writer-safe compaction, the quota path), `IdbDocumentIndex` with the rev feed, the `format_version` guard, `onversionchange` and `onblocked`, `fake-indexeddb`, the contract suite and the property test | SE | P2.1 (ports, `MemoryDocStore` suite, shared `local-session` and batcher), P2.6 (row shapes) | L: 6–8 days, 3 rounds | The contract suite passes on `fake-indexeddb` and in three browsers. The property test passes 50,000 runs. Strict commits keep typing latency within 5% in `perf`. |
| **W3** | **Writer lease and several tabs:** Web Locks, mirror over BroadcastChannel, Edit here, steal after timeout, automatic promotion with rescue, bfcache release, the no-locks fallback, maintenance lock | SE | W2, P2.2 (`WriteGate`) | M–L: 5 days, 3 rounds | Every multi-tab test in §10 passes on `chromium` and `webkit`. Steal and the no-locks fallback lose nothing. |
| **W4** | **Library route and shell:** origin or route (Q1), `LibraryRoot`, static skeleton, `BrowserShell`, `SHELL_PATHS`, `noindex`, strict CSP with hashes, import boundaries, library chunk budget, `NEXT_PUBLIC_LIBRARY`, a basic document list. **Deploy note** under W-D8 (Traefik, certificate, `HOCUS_ALLOWED_ORIGINS`). | DE + SE | W2, W3, P2.1, P2.2, **Q1** | M: 4 days, 2 rounds | It opens offline after one visit. No socket and no GA on the library route. Editor chunk +0 B. `script-src` lists no third-party host. **Inline scripts:** count the inline scripts on the prerendered library page. If they are static (Next flight scripts included), compute their hashes at build time from the HTML and drop `'unsafe-inline'`. Otherwise keep `'unsafe-inline'` on the library origin only, and record why. |
| **W5** | **Library UI:** `components/library/` (sidebar, Quick Open, lists, Trash, tags, page preferences) on the web adapters. "My documents / Public sandbox" IA. The `This browser` chip. The sandbox `Public` chip and "My documents" link. **Design review.** | UX + DE | W4, P2.7a, P2.7b, P2.9b, P2.9c, plus the relocation to `components/library/` | M: 4 days of integration, 2–3 rounds | The keyboard checklist passes. 1,000 documents in ≤ 600 ms. Screenshots at 1440, 1100, 820 and 375 px, light and dark. |
| **W6** | **Storage honesty:** storage card, `persist()` flows, per-browser copy, quota states, Can't save, library-removed (marker cookie if Q3 says yes), Safari install copy, privacy page rewrite, Help page "Where are my documents?". **Design review.** | UX + SE | W4 | M: 4 days, 2–3 rounds | Every §9 state has an e2e test and a screenshot. The privacy page no longer says "Your documents are public" without qualification. |
| **W7** | **Export all, import and reminders:** the shared archive module, lazy `fflate`, the `md` cache and headless serializer, import of files, zips and folders with the lineage dialog, reminder rules | DE + UX | W2, W5, P2.8, P2.10 | M–L: 5 days, 2 rounds | Round trip web → zip → web is identical. Desktop backup fixtures import. Reminders follow the §6.2 table (with a fake clock). |
| **W8** | **Backup folder** (Chromium) | DE | W7 | S–M: 2–3 days | The OPFS-handle e2e passes. Reconnect works after a permission reset. **Cut first** if needed. |
| **W9** | **Copy to My documents** from the sandbox: `postMessage` across origins, consent dialog, new lineage | SE + UX | W7, P2.10, W4 | S: 2 days | Cross-origin e2e passes. Messages from any other origin, or with no opener, are ignored. |
| **W10** | **Web sharing:** share from the library (secrets from `getRandomValues`, tokens derived in the page, hashes only to the server; S1, v8), join into the library (the S1b `/join` grammar through `lib/sharing/link.ts`), `IdbSecretStore`, Manage sharing, every Live state from plan §5.5, the §8.3 copy, stop-sharing key (if Q2 = a). **Retry contract (plan §6, as built):** `share_unavailable` is never terminal; the library retries it with backoff, because a valid token gets it for up to a minute while its share is over the failed-token limit. Only the end reasons (`sharing_stopped`, `link_reset`, `expired`, `removed`) are terminal. `HocuspocusProvider` stops after `authenticationFailed`, so the library reconnects itself. | SE + UX | P4.0, P4.2a–e (with CORS for the library origin), P4.3, P4.4, W3, **Q2** | L: 6 days, 3 rounds | Share → join on a second browser, then stop sharing. Eviction followed by re-import shows the disconnected copy. A token refused as `share_unavailable` keeps its link and reconnects after a backoff. |
| **W11** | **Image store, web adapter** (`blobs`) | SE | The image store design, W2 | Defined by that design | none |
| **W12** | **Library soak and the `firefox` project** in nightly | QA | W3, W7 | S: 2 days | 7 green nights before release |
| **P1.1b** | Sandbox merge-on-save (§11.1), next to P1.1 | SE | P1.1 | S: 1 day | A two-tab offline test loses no edits |

### 11.1 Sandbox merge-on-save (P1.1b)

`LocalDocStore.save` becomes a read-merge-write in one `readwrite` transaction:
1. `get(key)`
2. `Y.mergeUpdates([stored, state])`, synchronously in `onsuccess`
3. `put`

Two tabs writing the same sandbox document offline then keep each other's edits. The cost is one extra read per save, 750 ms debounced.

### 11.2 Totals and order

- **Critical path:** W2 → W3 → W4 → W5, then W6 and W7 in parallel. That is about 6 calendar weeks at the plan's pace, after P2.1, P2.2, P2.7a and P2.7b land.
- **Sharing:** W10 waits for the Phase 4 server work, like desktop.
- **Owner time:** 3 design reviews (W5, W6, W10), 1 deploy (W4), and the answers to Q1–Q3.
- **Tripwire.** Cut these first, in order:
  1. W8 (backup folder)
  2. the live mirror in W3 (mirrors become static read-only plus Edit here)
  3. reminder snooze options

### 11.3 Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| WK1 | Safari's 7-day cap deletes a library whose owner trusted it | High (for Safari users) | High | Honest chip and card, 3-day reminders, the install recommendation, the marker cookie for detection |
| WK2 | XSS or a third-party script reads every library and share secret | Med | High | W-D8, no third-party script on the library origin (X as link cards, no GA), and CSP hashes where W4 shows Next's inline scripts are static |
| WK3 | A multi-tab edge (iOS suspension, bfcache) leaves two writers | Med | Low | W-D3 keeps storage correct anyway. The property test and the soak prove it. |
| WK4 | Strict commits slow typing on slow disks or Android | Low–Med | Med | Batching (at most about 4 fsyncs a second). The `perf` gate in W2. If needed, fall back to `relaxed` with flush on hide, behind an env flag. |
| WK5 | Lost owner secret orphans a share | Med | Med | Q2, the 30-day expiry, Report and `share-admin` |
| WK6 | P2.7a/b ship in `components/desktop/` and the web forks the UI | Med | Med | The relocation is a stated dependency (§7.1). The import-boundary test fails if it's skipped. |
| WK7 | Users confuse the sandbox and the library and put private text in the sandbox | Med | High | The `Public` chip, two-place labels, "Copy to My documents" |
| WK8 | Chrome changes `persist()` heuristics or the quota reporting again | Med | Low | The copy never promises more than "your browser has agreed". Quota errors are handled where they occur. |

---

## 12. Owner questions

| # | Question | Options | Recommendation | Blocks |
|---|---|---|---|---|
| **Q1** | **Where does the library live?** D3 says "at tiny.docs.plus", and (a) departs from that literally, which is why this is the owner's call. | (a) Its own origin, for example `my.tiny.docs.plus`. (b) `tiny.docs.plus/library`, the same origin as the sandbox. | **(a).** On the same origin, X's `widgets.js`, GA and any script injected through a document every visitor auto-opens can read every private document and share secret. (b) needs a site-wide CSP change (no `'unsafe-inline'`, no X script) and still leaves GA on the origin. | **W4 onward** (route, CSP, PWA, deploy) |
| **Q2** | **A lost owner secret** on the web (D5 keeps secrets out of backups, so export doesn't help) | (a) Offer an opt-in **stop-sharing key** to save in Manage sharing. (b) Accept orphaned shares (K17): the 30-day expiry plus Report. (c) Allow web sharing only when storage is persistent or the app is installed. | **(a), opt-in.** D5 was about backups; a separate, explicit key the user chooses to save doesn't contradict it. (c) would quietly exclude every Safari tab. | **W10 only** |
| Q3 | **The marker cookie** (§3.4): the server learns one bit, "this browser has a library" | Yes / no | Yes: it is the only way to say "your browser removed your documents" instead of showing a blank page | W6 (copy only). Not blocking. |
| Q4 | Analytics on the library origin | None / counts only with consent | None in v1 | Not blocking |
| Q5 | `start_url` of the sandbox PWA | Keep `/` | Keep. Under (a) the library has its own install. | Not blocking |

---

## 13. Calls made here (check while reading)

- **Storage:** IndexedDB, not OPFS or SQLite-WASM. Strict durability for content and the index. No wrapper library. `fflate` is lazy, for export only.
- **Compaction:** merges and deletes only rows this session applied. Desktop can adopt the same rule to lift D-A3.
- **Several tabs:** one writer per document with live mirrors. Steal only after 3 s and a click. Locks are released on `pagehide` to keep bfcache.
- **`persist()`:** silent in Chromium and Safari after the first document, from a click in Firefox and in unknown browsers. Sniffing chooses copy only.
- **Quota:** "Storage almost full" is never shown from Chrome's masked `estimate()`. The real limit is handled as `QuotaExceededError`.
- **Safari reminders** stay on even when `persisted()` is true.
- **URLs:** no local ids. The document lives in `history.state`.
- **The Playground** stays in the sandbox. The library starts empty.
- **Export is not required before sharing.**
- **The library kill switch** hides the library and never wipes it. The service-worker kill switch never touches IndexedDB. We never send `Clear-Site-Data`.

---

## 14. Sources

Research done 2026-11-16. Dates are the pages' own where they give one.

**Safari / WebKit**
- WebKit, "Full Third-Party Cookie Blocking and More" (24 Mar 2020): the 7-day cap on script-writable storage, the Home Screen counter. https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/
- WebKit, Tracking Prevention (what counts as interaction, Home Screen exemption). https://webkit.org/tracking-prevention/
- WebKit, "Updates to Storage Policy" (10 Aug 2023): quotas of 60%/80% (browser apps) and 15%/20% (other apps), LRU eviction, `persist()` heuristics, `estimate()`. https://webkit.org/blog/14403/updates-to-storage-policy/
- WebKit, "News from WWDC23" (Safari 17): no quota prompt, Lockdown Mode disables Web Locks, Add to Dock storage. https://webkit.org/blog/14205/news-from-wwdc23-webkit-features-in-safari-17-beta/
- WebKit bug 276998 (OPFS under ITP; 2024-11-29). https://bugs.webkit.org/show_bug.cgi?id=276998
- WebKit, OPFS unavailable in private browsing (Feb 2022). https://webkit.org/blog/12257/
- Apple Support 104996: Dock web apps share no website data with Safari. https://support.apple.com/en-us/104996
- firt.dev, iOS PWA notes (updated 13 Oct 2026): storage not shared with the browser; iOS 26 opens sites as web apps by default. https://firt.dev/notes/pwa-ios/

**MDN and specifications**
- MDN, Storage quotas and eviction criteria (modified 5 Jan 2026). https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- MDN, `IDBDatabase.transaction()` (`durability`). https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase/transaction
- MDN, `IDBTransaction.commit()`. https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction/commit
- MDN, `Clear-Site-Data`. https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Clear-Site-Data
- MDN, `NotRestoredReasonDetails.reason` (the `"lock"` reason). https://developer.mozilla.org/en-US/docs/Web/API/NotRestoredReasonDetails/reason
- W3C Web Locks API (one lock manager per storage bucket, release on termination). https://w3c.github.io/web-locks/

**Chrome / Chromium**
- web.dev, Storage for the web. https://web.dev/articles/storage-for-the-web
- web.dev, Persistent storage (silent heuristics). https://web.dev/articles/persistent-storage
- Chrome, "IndexedDB durability mode now defaults to relaxed" (Chrome 121). https://developer.chrome.com/blog/indexeddb-durability-mode-now-defaults-to-relaxed
- blink-dev, `StaticStorageQuota` PSA (6 Dec 2024, M133). https://groups.google.com/a/chromium.org/g/blink-dev/c/7q0YGQNVkjs
- blink-dev, Incognito static quota (5 May 2026, M151 target). https://groups.google.com/a/chromium.org/g/blink-dev/c/00aHBCiUGzo
- Chromium `quota_settings.cc`. https://chromium.googlesource.com/chromium/src/+/main/storage/browser/quota/quota_settings.cc
- Chrome, Storage Buckets. https://developer.chrome.com/docs/web-platform/storage-buckets
- Chrome, Persistent permissions for the File System Access API (Chrome 122). https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api
- Chrome, Freezing on Energy Saver (20 Jan 2025): tabs holding Web Locks or blocking IndexedDB connections aren't frozen. https://developer.chrome.com/blog/freezing-on-energy-saver
- Chrome, bfcache `notRestoredReasons`. https://developer.chrome.com/docs/web-platform/bfcache-notrestoredreasons
- blink-dev, bfcache NotRestoredReasons intent (releasing locks in `pagehide`). https://groups.google.com/a/chromium.org/g/blink-dev/c/os3qUVtqyWo
- Privacy Sandbox, storage partitioning (third-party contexts only). https://privacysandbox.google.com/cookies/storage-partitioning

**Firefox**
- Firefox 115 release notes: IndexedDB in private browsing. https://www.mozilla.org/firefox/115.0/releasenotes/
- WPT, `performance-navigation-timing-lock` (lock blocks bfcache). https://arai.searchfox.org/firefox-main/source/testing/web-platform/tests/performance-timeline/not-restored-reasons/performance-navigation-timing-lock.https.tentative.window.js
