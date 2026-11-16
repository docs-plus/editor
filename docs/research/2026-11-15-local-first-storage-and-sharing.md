# Local-first by default, share to a server when you want: data and sync architecture for TinyDocy Desktop

Researcher: local-first / sync architecture. Date: 2026-11-15. Scope: storage, file manager model, sharing without accounts, first-share/unshare, schema skew, P2P, history, data-loss testing.
Repo read: `AGENTS.md`, `lib/collab-session.ts`, `lib/offline/*`, `lib/hocus-persistence.ts`, `scripts/hocus-server.ts`, `hooks/use-synced-tabs.ts`, `lib/tab-api.ts`, `lib/security/*` (doc-id validator, client-schema gate, document guard, activity store), `lib/schema-version.ts`, `lib/schema-guard.ts`, `app/api/documents/[id]/route.ts`, `components/document-editor/use-document-editor-effects.ts`, `lib/analytics.ts`, `next.config.ts`, `tests/load/*`.

Source confidence flags are inline: **[primary]** = project source code, official docs or paper; **[secondary]** = blog, aggregator or forum; **[old]** = before 2025.

---

## 0. Recommendations in one page

| Decision | Recommendation |
|---|---|
| CRDT | Stay on **Yjs 13.6.x** (13.6.33, 2026-09-23). Yjs 14 is still a release candidate (v14.0.0-rc.30, 2026-11-14) and `@y/prosemirror` is unreleased. Store everything in **update encoding v1**, the format Hocuspocus and y-tiptap use. |
| Local storage | **One SQLite database per library**, opened in the native (Bun) process, never in the webview. Tables: `docs` (index/metadata), `snapshots` (one compacted state per doc), `updates` (append-only log), `versions` (history snapshots), `sync_state` (per remote). `journal_mode=WAL`, `synchronous=FULL`, and on macOS `fullfsync=1` / `checkpoint_fullfsync=1`. Compaction uses compare-and-set. Backups use `VACUUM INTO`. This is the AFFiNE desktop design, adapted. |
| Not recommended | y-indexeddb in the webview (origin- and build-scoped and evictable; Tauri/wry has lost IndexedDB data on upgrades), y-leveldb (archived 2026-03), one binary file per doc as the primary store (you reinvent atomic writes and an index), Markdown as the storage format (loses CRDT history, marks and merge). |
| File manager | **SQLite index (local-only)**: a `folders` table plus `docs.folder_id` and `sort_key`. It is not a Yjs workspace doc in v1, because a replicated tree needs a move-safe tree CRDT and nothing syncs the library in v1. Add a "Markdown mirror"/export folder for readable, Git-friendly copies. The library is app-managed, not a user vault. |
| Sharing | **Capability URL.** Share = upload to a server under a **fresh random share ID** (not the local ID). The secret goes in the URL **fragment** and is presented as the Hocuspocus **`token`**, never in path or query. Separate **edit** and **view** capabilities (view = `connection.readOnly = true` in `onAuthenticate`). A separate **owner/delete secret** is kept only by the sharer. Revoke = rotate (new share ID, old one tombstoned). v1 is **not end-to-end encrypted**. State that plainly. |
| E2EE | v2 at the earliest, on a different relay. Encrypted payloads are incompatible with today's server guardrails (schema allowlist, root sweep, size by struct analysis, mark migration, and Hocuspocus merging plaintext Yjs). |
| P2P | **Not in v1.** The relay server is simpler, already hardened, and gives "the other person is offline" a working answer. Revisit LAN sync later. |
| History | Periodic full-state **version snapshots** stored locally (works with `gc` on). Restore = a forward edit that rewrites content, never a state replace. Undo stays local-origin only (y-undo default). |

---

## 1. Local storage of Yjs documents on desktop

### 1.1 What the reference apps do

| App | Storage | Notes |
|---|---|---|
| **AFFiNE** (Electron + y-octo) | Desktop: native SQLite through `nbstore` in a helper (`utilityProcess`), with the UI in renderers. Web: IndexedDB. | **[primary]** Schema in `packages/frontend/native/schema/src/lib.rs`: tables `snapshots(doc_id PK, data, created_at, updated_at)`, `updates(doc_id, created_at, data, PK(doc_id, created_at))`, `clocks`, `blobs`, `peer_clocks(peer, doc_id, remote_clock, pulled_remote_clock, pushed_clock)`, `peer_blob_sync`, `indexer_sync`. `nbstore/src/storage.rs` opens a pool with `SqliteJournalMode::Wal` and has `checkpoint()` (`PRAGMA wal_checkpoint(FULL)`) and `vacuum_into()`. `nbstore/src/doc.rs` merges snapshot + updates with `y_octo::merge_updates_v1`, installs the new snapshot with a **compare-and-set** (`UPDATE snapshots SET data=?, updated_at=? WHERE doc_id=? AND updated_at=? AND data=?`), then deletes only the merged updates (`mark_updates_merged`). One DB per workspace ("space"; `meta(space_id)`). Process model: [AFFiNE Electron docs](https://docs.affine.pro/develop-wip/frontend/electron) **[primary]**. Some mirrors say "IndexedDB" ([mintlify mirror](https://mintlify.com/toeverything/AFFiNE/features/local-first) **[secondary]**). That describes the web build. There is no conflict. |
| **AppFlowy** (Flutter + Rust `collab` on yrs) | **RocksDB** key-value store holding yrs updates and snapshots. | **[primary]** `AppFlowy-Collab/collab/Cargo.toml` depends on `rocksdb 0.22` (zstd) and `yrs`; `collab/src/plugins/local_storage/rocksdb/rocksdb_plugin.rs` pushes each update into a write transaction (`push_update`) and has a `snapshot_plugin.rs`. Some secondary sites say SQLite. That is `flowy-sqlite` for app metadata, not documents. |
| **Anytype** (any-sync) | Local-first object store, synced through any-sync nodes. Separate sync, file and consensus nodes plus a coordinator. | Backup nodes hold only the first-layer key, so they cannot read changes ([Anytype privacy docs](https://doc.anytype.io/anytype/data/privacy-and-encryption) **[primary]**, [any-sync](https://github.com/anyproto/any-sync) **[primary]**). Shows the "relay that can't read" design, at the cost of ACL/consensus machinery. |
| **Logseq DB version** | Graph is a SQLite DB (`~/logseq/graphs/<name>/db.sqlite`) plus a `client-ops` log for sync and a search index. Pages are no longer files. Still beta. RTC sync is hosted only. A 2026 "Markdown Mirror" writes blocks to disk as Markdown. | [Logseq forum, May 2026](https://discuss.logseq.com/t/whats-new-with-logseq-db-may-16th-2026/35020) **[primary, forum]**, [promptquorum review](https://www.promptquorum.com/power-local-llm/logseq-review) **[secondary]** (says the DB directory is about 14x the vault, with client-ops at about 36%: the cost of keeping an op log). Lesson: SQLite as truth plus a Markdown mirror for readability and Git. |
| **Obsidian** | Plain Markdown files in a user vault. CRDT collaboration lives in plugins. **Relay** (System 3) keeps local `.md` files plus Yjs, with a y-sweet-fork relay server. | [Relay plugin](https://community.obsidian.md/plugins/system3-relay), [Relay README mirror](https://github.com/joelvaneenwyk/obsidian-relay) **[secondary]**. Files as truth make the external-edit reconciliation problem the main problem (see Jupyter). |
| **Jupyter RTC** (`jupyter-collaboration`) | The `.ipynb` file on disk is the truth. Yjs updates go in `SQLiteYStore` (`.jupyter_ystore.db`). Out-of-band file changes **overwrite** the room content from disk. `document_ttl` squashes the update log after X idle minutes (default None, so it grows forever). | [issue #243](https://github.com/jupyterlab/jupyter-collaboration/issues/243), [#430](https://github.com/jupyterlab/jupyter-collaboration/issues/430) **[primary]**. Lessons: (a) "file is truth + CRDT shadow" turns every external edit into a full overwrite that grows the store; (b) an update log must have compaction. |
| **Automerge-repo** (Ink & Switch) | Storage keys `[docId, "incremental"\|"snapshot", id]`. Incrementals are keyed by change hash, snapshots by heads. Compaction deletes **only the chunks this process loaded**, so concurrent processes never lose data without locks. NodeFS adapter is multi-process safe. | [Automerge storage docs](https://automerge.org/docs/reference/under-the-hood/storage/) **[primary]**, [concurrent compaction write-up](https://patternist.xyz/posts/concurrent-compaction-in-automerge-repo) **[secondary]**. Same rule as AFFiNE: never delete what you didn't merge. |

### 1.2 Library status (verified on GitHub, 2026-11-15)

- **Yjs**: stable `v13.6.33` (2026-09-23). `v14.0.0-rc.30` (2026-11-14) is still a prerelease **[primary, GitHub releases]**. A secondary source says v14 changes the API, not the data format, and that updates go both ways ([newreleases](https://newreleases.io/project/yarn/yjs/release/14.0.0-9) **[secondary]**). A Go port's notes list v14 wire changes (53-bit client IDs, Skip structs) ([ygo](https://pkg.go.dev/github.com/Deln0r/ygo@v1.25.0) **[secondary]**). The claims conflict, so treat v14 as not yet safe to mix. The new `@y/prosemirror` binding (attribution, suggestions, `renderSnapshot` diffs) was announced at FOSDEM '26 and is still in development ([Nick the Sick, 2026-04-24](https://nick-the-sick.pckt.blog/yjs-14-at-yprosemirror-wwv64pw) **[secondary, author is a BlockNote maintainer]**). Tiptap 3 uses `@tiptap/y-tiptap` on Yjs 13. Decision: **pin 13.6.x and store v1 updates**. Do not adopt v14 until Tiptap ships a binding.
- **y-indexeddb**: last push 2025-02 **[primary]**. **y-leveldb**: archived (last push 2026-03) **[primary]**. Neither belongs on desktop.
- **Hocuspocus** v4.8.0 (2026-10-28). `onLoadDocument` can return a raw `Uint8Array` in v4. `onStoreDocument` is debounced and **keeps the doc in memory and retries if the hook throws** ([hooks docs](https://tiptap.dev/docs/hocuspocus/server/hooks) **[primary]**). The repo already uses `SkipFurtherHooksError` to avoid pinning refused docs (`lib/hocus-persistence.ts`).
- **Subdocuments**: Hocuspocus does not implement Yjs subdocs and recommends multiplexing ([Tiptap docs](https://tiptap.dev/docs/hocuspocus/guides/multi-subdocuments) **[primary]**). So a "workspace Y.Doc with subdocs" model doesn't map to the existing server.

### 1.3 Options compared

| Option | Crash safety | Compaction | Index/search | Multi-window | Backup | Verdict |
|---|---|---|---|---|---|---|
| **SQLite, one DB per library, native process** | Transactions. WAL + `synchronous=FULL` (+ `fullfsync` on macOS) survives power loss; NORMAL can lose the last commits on power loss but stays consistent ([SQLite docs via agwa.name](https://www.agwa.name/blog/post/sqlite_durability), [avi.im 2025](https://avi.im/blag/2025/sqlite-fsync/) **[secondary, 2025]**) | CAS snapshot + delete merged rows (AFFiNE) | FTS5 in the same DB | One writer process serialises | `VACUUM INTO` gives a consistent copy while open | **Recommended** |
| SQLite, one DB per doc | Same | Same | Needs a separate index DB, so two sources of truth | Many handles | Per file (Git/Dropbox-friendlier) | Only worth it if docs must be individually movable files. Not v1. |
| One file per doc (snapshot + appended update log) | You must hand-roll write-temp + fsync + rename + dir fsync and torn-tail detection | Rewrite + rename | Separate index anyway | File locks are platform-specific | Easy to copy | More code, more failure modes, no gain. |
| y-indexeddb in webview | Browser-managed. IndexedDB is per origin, and Tauri/wry lost IndexedDB data on a Tauri 1→2 path change on Linux ([wry 0.45 notes](https://v2.tauri.app/release/wry/v0.45.0) **[primary]**). PowerSync reports IndexedDB/OPFS resetting across Tauri builds ([PowerSync](https://releases.powersync.com/announcements/ann_mPwGQpcccCyvL) **[secondary]**) | y-indexeddb trims on load | None | Each window its own | Not user-visible | **Reject** for the source of truth |
| y-leveldb / RocksDB | Good (AppFlowy) | Yes | No | Single-process lock | Opaque | Archived (y-leveldb), native build burden (RocksDB). Reject. |

Runtime note: `bun:sqlite` in this repo defaults to `synchronous=2` (FULL) and `fullfsync=0` (checked locally with Bun). On macOS, SQLite's FULL calls `fsync()`, which doesn't flush the drive cache. `PRAGMA fullfsync=1` (and `checkpoint_fullfsync=1`) is needed for real power-loss durability on Apple hardware. The cost is acceptable because writes are debounced. If the desktop shell runs Bun in the main process (Electrobun v1, Feb 2026 ([repo](https://github.com/blackboardsh/electrobun) **[primary]**; whether it suits this app is the shell researcher's call)), `openSqlite()`/`bun:sqlite` is reused as-is. With Electron, use `better-sqlite3` or `node:sqlite` in a utility process (AFFiNE's pattern). With Tauri, use rusqlite/sqlx in Rust.

### 1.4 Recommended schema (library DB, `library.sqlite`)

```
docs(id TEXT PK            -- local id, crypto.randomUUID(); never shown in URLs
     lineage TEXT NOT NULL  -- uuid also written into Y.Doc map "meta".lineage at creation
     title TEXT, folder_id TEXT, sort_key TEXT,
     created_at INT, modified_at INT, opened_at INT,
     trashed_at INT NULL, schema INT NOT NULL)          -- CLIENT_SCHEMA that last wrote it
snapshots(doc_id PK, data BLOB, state_vector BLOB, updated_at INT)
updates(doc_id, seq INTEGER PK AUTOINCREMENT, data BLOB, origin TEXT, created_at INT)
versions(doc_id, id, data BLOB, created_at INT, reason TEXT, label TEXT)   -- history (§6)
folders(id PK, parent_id NULL, name, sort_key, created_at, trashed_at NULL)
remotes(doc_id PK, server_url, share_id, edit_token, view_token NULL, owner_secret,
        status TEXT,            -- uploading | live | paused_refused | server_gone | revoked
        last_refusal TEXT, last_synced_sv BLOB, last_synced_at INT)
meta(key PK, value)             -- library id, format version, created_by build
```

Write path, all in the native process (single writer):
1. `doc.on('update')`: every **local and remote** update is appended to `updates` inside a transaction. Coalesce on a 250–750 ms debounce with `Y.mergeUpdates`, but never drop. This replaces the web's full `put` (§4.6).
2. Compaction (idle, or more than N rows / M bytes): read snapshot + `updates WHERE seq <= X`, rebuild with `Y.applyUpdate` into a scratch doc (that runs GC; `mergeUpdates` alone does not, per [Yjs docs](https://docs.yjs.dev/api/document-updates) **[primary]**), then in **one transaction**: CAS-replace the snapshot (`WHERE updated_at = ?`) and `DELETE FROM updates WHERE doc_id=? AND seq <= X`. Rows appended after X survive. This is the AFFiNE/Automerge rule.
3. Load = snapshot + all updates, applied with a dedicated `LOCAL_ORIGIN` (as today).
4. Backups: daily `VACUUM INTO backups/library-YYYYMMDD.sqlite`, keep 7 daily + 4 weekly, plus "Export library" (zip of `.tinydoc` snapshots + Markdown).
5. Integrity: `PRAGMA quick_check` at startup after an unclean shutdown. Keep `meta.format_version` for migrations.

The webview never touches storage. It talks to the native process over IPC: get state, apply update, subscribe. Each **open document has exactly one Y.Doc in the native process**, and windows sync with it over IPC with the y-protocols sync messages. That avoids clientID clashes across windows (§4.4) and lets the native process own the server provider too.

---

## 2. File manager data model

### 2.1 Where the tree lives

| Option | Pros | Cons |
|---|---|---|
| **SQLite index (recommended for v1)** | Atomic with doc rows. Trivial queries (recent, search, trash). No CRDT move anomalies. | Not synced. That's fine because v1 shares single docs, not libraries. |
| Yjs workspace doc (AFFiNE "root doc" style) | Ready for syncing a whole library later. | Concurrent moves in a replicated tree can create cycles or duplicates without a dedicated tree-move CRDT (Kleppmann et al.'s move op). `global-tabs` already shows the cost: `sanitizeTabs`, `deduplicateTabs`, `tabs-doc-repair`. Hocuspocus has no subdocs. |
| Real filesystem folders (vault) | User-visible, Git- and Dropbox-friendly. | Sync tools copy binary CRDT files and create conflicted copies. Renames from Finder race the app. A Markdown vault loses CRDT state (Jupyter's OOB overwrite problem). |

**Decision**: an app-managed library (`~/Library/Application Support/TinyDocy/library.sqlite` and platform equivalents) with a SQLite tree, plus:
- **Markdown mirror (opt-in)**: a user-chosen folder where each doc is written as `Folder/Title.md` (or HTML) on idle. **One-way**, app → disk, like Logseq's 2026 Markdown Mirror. It gives readable, greppable, Git-committable copies with no reconciliation. Import of `.md` is a separate explicit action that creates a new doc.
- **`.tinydoc` export/import**: a single file holding a header (format, lineage, schema, title) plus the Yjs v1 state. Used for moving a doc to another machine with its history intact. Import keeps the lineage, so two copies of the same doc can later merge without duplication (§4).
- **Doc metadata**: title (derived from the first heading, the same rule the web uses for tab titles: `isChangeOrigin`, local edits only), created, modified, opened, folder, trash, schema, sync state (from `remotes.status`). Keep metadata out of the Y.Doc, except `meta.lineage` and `meta.createdAt`, which must travel with the content.
- **Trash**: soft-delete with `trashed_at` and a 30-day purge. Permanent delete removes rows and `VACUUM`s on idle. Deleting a shared doc locally **does not** delete the server copy unless the owner chooses "Stop sharing and delete from server".

### 2.2 Trade-offs stated plainly
- Durability: SQLite with backups beats loose files, which can be truncated by sync tools and half-written.
- Sync later: when library sync arrives (v2+), add a Yjs "library doc" holding only `docId → {folderId, sortKey, title}` maps, never nested arrays. Folder moves become last-writer-wins on `folderId`, and cycles are repaired on read. That's simpler than a tree CRDT and enough for one user's devices.
- Git-friendliness comes from the Markdown mirror, not the storage. Binary Yjs in Git is meaningless to diff and conflicts on every merge.

---

## 3. Opt-in sharing without accounts

### 3.1 Today's server model (repo facts that constrain the design)
- **Document names are public bearer identifiers.** Anyone with a name can open, edit and **DELETE** it. `app/api/documents/[id]/route.ts` checks only the rate limit and ID format, not ownership. Names: `isValidUserDocumentId` = UUID or `^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$`.
- **`global-tabs` is a world-writable shared list of document IDs** (`hooks/use-synced-tabs.ts`; entries sanitised but untrusted). **Any capability scheme is void if a shared doc's ID ever lands there.** Opening a share link on the web must not add it to `global-tabs`. Keep share links in a per-device list (localStorage/IndexedDB) or a separate "shared with me" view. This is a prerequisite.
- **Guardrails that need plaintext Yjs**: `DocumentGuard` decodes every sync frame (size estimate, `addsNoItems` at the cap, schema allowlist → `schema_rejected` 4422, editor-root sweep), `afterLoadDocument` runs `migrateLegacyMarks`, tab-list repair, and the persistence `canStore` size gate. Production `MAX_DOC_SIZE_BYTES=2097152`. Creation is limited per IP and by total count (`canCreateDocument`). Tombstones block deleted names at connect and load (`document_deleted`). Throttle bans IPs that reconnect in a loop.
- **Token plumbing exists**: the provider already passes `token` (`getHocuspocusToken`, today a test hook). Hocuspocus `onAuthenticate` receives `token` and `documentName`, can set `connection.readOnly = true`, and throwing rejects the doc ([hooks docs](https://tiptap.dev/docs/hocuspocus/server/hooks) **[primary]**).
- **Analytics** sends `origin + pathname` only (`lib/analytics.ts`, no query, no hash). `Referrer-Policy: strict-origin-when-cross-origin` (`next.config.ts`). So a secret in the **fragment** never reaches GA4, `Referer`, or server logs. A secret in the **path** would reach GA4 `page_location`.

### 3.2 Recommended v1: capability URLs on plaintext Hocuspocus

Link format (web):
```
https://tiny.docs.plus/s/<shareId>#e=<editSecret>      edit link
https://tiny.docs.plus/s/<shareId>#v=<viewSecret>      view link
tinydocy://open?server=<host>&id=<shareId>#e=…         desktop deep link (same capability)
```
- `shareId` = `crypto.randomUUID()` (122 bits). It passes `SAFE_ID_REGEX`/UUID validation. Raw base64url IDs can start with `-`/`_` and fail it. The `shareId` alone is **not** enough to open the doc, so its leaking through GA4 pathnames or logs is harmless.
- Secrets: 128-bit random, base64url. The server stores **hashes**: `shares(share_id PK, edit_hash, view_hash NULL, owner_hash, created_at, created_ip_hash, size_bytes, schema)`.
- `onAuthenticate({ documentName, token })`: look up `shares`. Unknown share → `document_not_found` (treat as gone; don't create). `token` matches `edit_hash` → read/write. Matches `view_hash` → `connection.readOnly = true`. Else reject `forbidden`. Use a constant-time compare. Rate-limit failed tokens per IP (they're guesses).
- **Owner secret** (kept only in the sharer's `remotes` row): needed for `DELETE /api/shares/:id`, rotation and "make view-only". This fixes today's "anyone can delete by name".
- **Revocation = rotation**: "Reset link" creates a new `shareId` with fresh secrets, uploads the current state, and tombstones the old ID. Old link holders get `document_deleted`. The repo already turns that into read-only plus a notice, and on desktop it must not delete their local copy (§4.5). Cheaper variant for "remove edit access only": rotate the edit secret, keep the ID, and kick live connections whose token no longer matches (`closeConnections(documentName)` then re-auth).
- **View links must be read-only locally too** (desktop and web). A `readOnly` connection never acknowledges local edits. In `collab-session.ts`, `unsyncedChanges` would never reach 0, so `dirty` stays true, the session never releases, and the local copy silently diverges from the server. (Verify: whether Hocuspocus 4 drops updates from read-only connections silently or closes them. Either way the client must not produce them.) The editor opens with `editable: false` and the provider's local updates are blocked.
- **New refusal reasons must stop syncing.** `document_not_found`, `forbidden` and "token rotated" must join `DOCUMENT_DELETED_REASON` / `STOP_SYNC_CLOSE_REASONS` handling in the client (detach, keep the copy, show status). Otherwise the provider re-authenticates on every reconnect and Throttle bans the IP. Failed-token rate limits on the server make this worse, not better.
- **Creation by link only**: a share doc is created only through `POST /api/shares` (owner holds the secret). `onLoadDocument` refuses unknown names for the `s/` namespace, so nobody can mint docs by guessing names. Existing per-IP creation limits apply to `POST`.
- **Self-hosted server**: the app stores `server_url` per share. Before the first share to a custom URL, `GET <server>/api/info` returns `{ serverSchema, minClientSchema, maxDocBytes, features: ["shares-v1"] }`. Refuse to share if the server's schema is below the client's (§4.7), or if the doc is over `maxDocBytes`. Self-hosters run the same `bun run hocus` + Next API. Document `HOCUS_ALLOWED_ORIGINS` (desktop sends a custom-scheme or `null` Origin, so desktop origins must be allowed or exempted when a valid share token is presented).

**Security properties, stated plainly (v1)**
- Anyone who holds the edit link can read and edit, forever, until it is rotated. Anyone with the view link can read.
- **The server operator (us, or the self-hoster) can read and modify every shared document.** Data is encrypted in transit (wss) only, not at rest or end to end.
- Links leak through whatever they're pasted into (chat previews, browser history and sync, screenshots). The fragment keeps the secret out of HTTP requests, referrers and analytics, not out of the user's clipboard history.
- Revocation is forward-only: anyone who already opened the doc keeps their local copy.
- No identity: edits are attributed only by the self-chosen name in awareness, which is spoofable.
- The server can still enforce size caps, rate limits, IP throttles, schema allowlists, tombstones and creation limits, because it sees plaintext.

### 3.3 End-to-end encryption: what the prior art shows, and why not v1

| System | Key placement | What the server sees and enforces |
|---|---|---|
| **Excalidraw** | `#room=<roomId>,<roomKey>`. AES-GCM key generated client-side. Server relays ciphertext. (`excalidraw-app/data/index.ts`: `RE_COLLAB_LINK = /^#room=([a-zA-Z0-9_-]+),([a-zA-Z0-9_-]+)$/`) **[primary]**; [E2EE blog](https://plus.excalidraw.com/blog/end-to-end-encryption) **[old, 2020]** | Room ID, sizes, timing. Cannot validate content. |
| **Bitwarden Send** | `#<sendId>/<key>`. 128-bit secret → HKDF-SHA256 → AES-256. A Send password is an access check only. ([help](https://bitwarden.com/help/article/send-encryption/) **[primary]**) | ID, size, expiry, access count. |
| **CryptPad** | Edit key in the fragment. Derives a signing keypair, view key and channel ID. View link = derived read key. **Server verifies Ed25519 signatures**, so only edit-key holders can append. Write access can't be revoked per person without rotating. ([whitepaper](https://blueprints.cryptpad.org/document/whitepaper/), [revocation prototype](https://blueprints.cryptpad.org/prototypes/revocation/) **[primary]**) | Channel ID, signature validity, sizes. The best model for "read vs edit" without accounts. |
| **y-webrtc `password`** | Shared password encrypts signaling traffic and data. Full mesh, about 20–35 peers max. ([README](https://github.com/yjs/y-webrtc) **[primary]**) | Signaling sees room names. No storage. |
| **secsync** (Nik Graf; Serenity Notes) | Snapshot + updates, each AEAD-encrypted. Server stores ciphertext and orders updates per snapshot. ([docs](https://deploy-preview-115--secsync.netlify.app/docs/architecture-design) **[primary]**) | Ordering, sizes. **Beta. Last push 2024-09 [primary, GitHub]. Treat as unmaintained.** |
| **Proton Docs** | Yjs (Proton `WebClients` `applications/docs*/package.json` depend on `yjs` **[primary]**). Per-update encryption and signatures, client-side "squash". | Proton says it can't read content. **CCS 2026 paper "Data-strophy" shows three undetected integrity attacks (history rewriting, context manipulation, censorship), two with an honest server** ([ePrint 2026/1994](https://eprint.iacr.org/2026/1994) **[primary]**). |
| **SignalCD** (USENIX Sec 2026) | Docs over an E2EE async broadcast channel (Signal groups) plus reconciliation, with proofs. About 120 ms latency. ([USENIX](https://www.usenix.org/conference/usenixsecurity26/presentation/knabenhans) **[primary]**) | Research prototype. |
| **Keyhive / Beelay** (Ink & Switch) | Convergent capabilities plus E2EE sync. The relay can't decrypt. **Pre-alpha.** ([project](https://www.inkandswitch.com/project/keyhive/) **[primary]**) | Not production-ready. |

What a server can still enforce on ciphertext: per-update and total byte caps (ciphertext length), update rate, connection and IP limits, creation limits, tombstones, signature checks (CryptPad-style, which gives edit vs view). It **cannot** enforce: the schema allowlist (`schema_rejected`), root sweep, mark migration, `addsNoItems` at the cap (a doc at the cap could never be trimmed, so you need a raw byte cap plus client-side compaction), server-side merge and compaction (the log grows until a client snapshots, like secsync), or abuse moderation of content.

**Conclusion**: E2EE is a different server (an encrypted append-log relay with snapshots, secsync-shaped, plus CryptPad-style signing for edit vs view), not a Hocuspocus extension. Integrity is as hard as confidentiality (the Proton paper). Ship v1 plaintext with honest copy ("The server can read shared documents. Share only what you'd put on a public pastebin with an unguessable link."). Treat E2EE as a v2 project with its own threat model. Self-hosting is the v1 answer for people who need confidentiality from us.

---

## 4. First share, unshare, deletion, and version skew

### 4.1 First share (local-only → server)
1. **Pre-checks (local)**: compact the doc. Measure `Y.encodeStateAsUpdate(doc).byteLength`. If it's over the server's `maxDocBytes` (2 MiB in production), stop with "Too large to share (X MB of 2 MB)" and offer to remove media or history. **Never** connect and get `document_too_large`. The code's own comments warn that reconnect loops get IPs banned by Throttle.
2. **Server info**: `GET /api/info` (schema, limits). If `serverSchema < CLIENT_SCHEMA` (old self-hosted server), refuse: "This server is older than your app."
3. **Create**: `POST /api/shares {size, schema, lineage}` returns `{shareId, editSecret, ownerSecret}`. The server creates an **empty** doc record. The name is fresh, so no history exists to collide with.
4. **Upload**: in the native process, open a provider for `shareId` with `token=editSecret` on the **existing local Y.Doc** (no copy, same history). Sync step 2 uploads everything. Wait for `unsyncedChanges === 0` (already used in `collab-session.ts`) **and** `synced`. (Alternative: `PUT /api/shares/:id/state` with the full update, which the server validates through the same guard, then connect. That's simpler to make atomic.)
5. **Only then** show and copy the link. **Why this matters**: the web editor seeds default content into any empty fragment after a server sync (`use-document-editor-effects.ts`). If a recipient opens the link before the upload lands, they seed a title heading, the upload merges in, and the doc has **two titles**. Mitigations: (a) reveal the link only after the ack; (b) the server refuses connections to a share in `uploading` state; (c) **deterministic seed**: identical (client, clock) structs deduplicate, so two clients applying the *byte-identical* seed update converge to one copy ([Moriz Büsing](https://morizbuesing.com/blog/initializing-a-yjs-document-with-a-common-value) **[secondary]**). This is safe only under strict rules: the seed is a **precomputed byte constant** checked into the repo (never regenerated at runtime through the editor or y-prosemirror). Its clientID is **derived from the seed version or content hash**, so a changed default content gets a new clientID and never reuses (clientID, clock) pairs with different content. Otherwise Yjs drops one as a duplicate and replicas diverge silently. It is **never** used for the playground, whose content is random. Desktop docs are seeded locally at creation with the same constant. Treat (a) as the primary fix and (c) as defence in depth.
6. Record `remotes(status='live', last_synced_sv)`. From now on the native process keeps the provider attached while the doc is open (and optionally in the background for docs with unsynced edits, as `releaseCollabSession` does).

### 4.2 Two devices with copies
- **Same lineage** (doc moved by `.tinydoc` export, or both opened the same share link): Yjs updates are idempotent and commutative ([Yjs docs](https://docs.yjs.dev/api/document-updates) **[primary]**). Shared history deduplicates by (clientID, clock). Divergent edits both appear, which is correct CRDT behaviour.
- **Different lineage** (two independently created docs, or a Markdown import of the "same" doc): merging them **duplicates** content, because each has its own structs ([Yjs forum](https://discuss.yjs.dev/t/initial-offline-value-of-a-shared-document/465) **[secondary]**). **Rule**: write `meta.lineage` into every Y.Doc at creation. (Checked against `lib/security/hocus-document-guard.ts`: `findDisallowedSchemaNames` checks only `XmlElement` node names, format keys, and non-element content landing in the `default` fragment. The root sweep only touches `default`. So a top-level `Y.Map("meta")` with primitive values passes today. The tab doc already uses `getMap("meta")`. Keep it primitive-valued and add a unit test so a future allowlist tightening doesn't sweep it. The server also stores `lineage` in `shares`, so the check doesn't depend on the Y.Doc alone.) Docs created on the web before this change have no lineage. Treat a missing lineage as "legacy": allowed to attach only to the same share ID it came from, and given a lineage on first desktop open. The client refuses to attach a local doc to a server doc whose `meta.lineage` differs, and the server stores `lineage` in `shares` and rejects a mismatched first upload. "Share into an existing link" is not offered. To combine, the user opens the link as a separate doc and copies content by hand.
- Opening a share link on desktop creates a local doc with the server's lineage and `remotes` row. It never merges into an existing local doc.

### 4.3 Moving a shared doc back to local-only
- **"Stop syncing on this device"**: detach the provider and keep the local doc. `remotes.status='detached'` keeps the share ID so the user can re-attach later (same lineage, merges cleanly).
- **"Stop sharing" (owner)**: `DELETE /api/shares/:id` with the owner secret → server tombstone. Local doc stays. Other holders see `document_deleted`.
- **"Make a local copy"** (fork): `Y.encodeStateAsUpdate` into a **new Y.Doc** (new clientID per session automatically) with a **new lineage**. Rewriting lineage requires an edit, so set `meta.lineage` after applying. The copy can never be re-merged by accident.

### 4.4 Yjs clientID hazards
- Yjs: clientID "should not be reused across sessions" ([Y.Doc docs](https://docs.yjs.dev/api/y.doc) **[primary]**). The FAQ allows overriding it only if no other live Y.Doc holds it ([FAQ](https://docs.yjs.dev/api/faq) **[primary]**). Two live docs with the same clientID produce conflicting structs at the same clock. Peers drop one as a duplicate, which means silent divergence.
- Desktop rules: (1) never persist or restore `clientID`; (2) one Y.Doc per document per process, with windows as IPC views of it; (3) if two app instances could run (second launch, or a portable copy of the library), take an exclusive lock on the library (SQLite `BEGIN EXCLUSIVE` on a lock row, or an OS file lock) and make the second instance hand off; (4) the deterministic seed (§4.1) is the only fixed-clientID update. It is a frozen byte constant whose clientID is derived from its version or hash, so a new seed never reuses an old seed's (clientID, clock) range.

### 4.5 Server deletes or tombstones a doc the desktop user still has
Today (web): `authenticationFailed` with `document_deleted` → `provider.detach()` **and `removeLocalCopy(name)`** (`lib/collab-session.ts`). That's right for a 14-day browser cache. **It is data loss on desktop**, where the local copy is the user's document.

Desktop behaviour: keep the doc. Set `remotes.status='server_gone'`. Show a banner: "The shared copy was deleted or the link was reset. Your copy is safe on this device. [Keep as local] [Share again (new link)]". The same applies to retention purges (`scripts/purge-retention.ts` writes tombstones) and to rotation. Never resurrect the old name (tombstones already prevent it).

**The web offline-cache semantics must not be reused for the desktop library.** Each of these deletes or blocks user data by design: 14-day expiry (`OFFLINE_DOC_MAX_AGE_DAYS`), 30-doc cap (`OFFLINE_MAX_DOCS`), epoch-bump clear (`OFFLINE_CACHE_EPOCH`), sweep of docs not in the tab list (`sweepLocalCopies`), delete-on-tombstone, and the 512 KiB offline edit pause (`OFFLINE_EDIT_BUDGET_BYTES`). On desktop a local-only doc has no budget. A shared doc may pause **uploading** past the server cap, but never local editing.

### 4.6 An existing overwrite hazard in the web cache (worth fixing and worth not copying)
*Found by reading the code. Not reproduced. Test §6.4 #4 is the confirmation.* In `attachWithLocalCopy`, if IndexedDB doesn't answer within `HYDRATE_TIMEOUT_MS` (1 s), the session rebinds with `hydrate: false` and attaches to the server. That binding's `write()` saves `Y.encodeStateAsUpdate(doc)` through `store.save` → `backend.put`, a **full replace** of the key. If the stored copy held offline edits that never synced (written in an earlier page load), the first change after the timeout overwrites them with server-only state. The first binding was destroyed before its load resolved, so those edits were never applied. Low probability (slow IndexedDB at startup plus pending offline edits), but it's silent loss. Fix on web: in the no-hydrate path, merge rather than replace (read then `Y.mergeUpdates([stored, current])` in the same transaction), or keep waiting for the load instead of overwriting. The desktop design avoids it structurally: append-only `updates` plus CAS compaction never replaces state it hasn't read.

### 4.7 Schema and version skew (old desktop builds vs newer servers, and the reverse)
Repo mechanics: the socket URL carries `schema=CLIENT_SCHEMA` (now 2) and `build`. The server refuses gated docs below `max(HOCUS_MIN_CLIENT_SCHEMA, SCHEMA_FLOOR=2)` with `client_outdated` (an auth refusal; the client detaches and keeps its copy). `DocumentGuard` closes with `schema_rejected` (4422) on unknown node or mark names. The client `schema-guard` freezes the editor read-only (`outdated`) when the shared doc names nodes or marks this bundle doesn't know. `OFFLINE_NAMESPACE "s2"` stops older bundles reading newer copies.

Desktop implications:
- **Old desktop + new server**: `client_outdated` → status `paused_refused`. Local editing continues, but edits made while refused will be **merged on upgrade**, and those edits may delete content the old schema didn't know (the reason for `SCHEMA_FLOOR`). Rule: once a shared doc has received content the build doesn't know (`schema-guard` = `outdated`), that doc goes **read-only locally too**, until the app updates. Ship auto-update (signed) and show "Update to keep syncing". Store `docs.schema` per doc and refuse to open a doc whose stored schema is newer than the app (a downgrade after an update).
- **New desktop + old self-hosted server**: the new build writes marks the old server's allowlist rejects → `schema_rejected` → the share stops syncing. Prevent it up front with the `/api/info` check (§3.2) and per-share `serverSchema`. Show "This server needs updating" rather than looping.
- **Local library migrations**: keep `CLIENT_SCHEMA` migrations as forward edits (like `migrateLegacyMarks`), applied on load inside a transaction and recorded in `meta.format_version`. Take a `VACUUM INTO` backup before any migration.
- Never let the desktop seed or repair a shared doc while `outdated` (the repo's `schema-guard` already defers repair until writable).

---

## 5. P2P (y-webrtc, LAN) vs a relay server

| | y-webrtc / LAN | Relay (Hocuspocus) |
|---|---|---|
| Works when the sharer is offline | No, someone must be online | Yes, the server holds state |
| NAT traversal | Needs STUN/TURN. TURN is a relay anyway | Not needed |
| Scale | Full mesh, about 20–35 peers ([y-webrtc README](https://github.com/yjs/y-webrtc) **[primary]**) | Hundreds of clients per doc (load harness) |
| Abuse controls | Little: a malicious peer can send anything | All existing guardrails |
| Confidentiality | `password` encrypts signaling and data | Plaintext to server (v1) |
| Code to write | Signaling server + TURN + LAN discovery (mDNS) + new failure modes | Reuse provider, server, guardrails |

**Verdict: not for v1.** The relay covers the requested feature (share a doc so others can collaborate), keeps one tested code path, and existing guardrails apply. Consider later: LAN sync between a user's own devices (Anytype does local-network sync) once library sync exists, and only with E2EE. y-webrtc's `password` mode is an easy "private room" experiment but not a product feature.

---

## 6. Version history, undo, data-loss scenarios, testing

### 6.1 Version history
- **Recommended**: store full-state **snapshots** (`Y.encodeStateAsUpdate`) in `versions` on triggers: first open of the day, before share/unshare/rotation, before import or migration, every N minutes of active editing, and on manual "Save version". Viewing = load into a throwaway Y.Doc and render read-only. **Restore = compute the old content and apply it as a normal forward edit** to the live doc (replace the fragment content in one transaction, one undo step). Never replace the Yjs state. In a shared doc, a state replace would be undone by merge, or duplicate content.
- `Y.snapshot`/`createDocFromSnapshot` diffs need `gc: false` on every load path, **including the server** (Hocuspocus). Forum reports show it's fragile ([yjs forum](https://discuss.yjs.dev/t/gc-is-off-but-still-losing-delection-history/2704) **[secondary]**), and it makes documents grow without bound against a 2 MiB cap. Tiptap's own Snapshot/Snapshot Compare are paid Pro extensions tied to Tiptap Cloud ([Tiptap](https://tiptap.dev/docs/collaboration/documents/snapshot) **[primary]**). **Avoid gc:false.** Full-state snapshots cost space but are robust. Prune with the same daily/weekly ladder as backups.
- Future: `@y/prosemirror`'s attribution and `renderSnapshot` diffing (Yjs 14) is the likely path to "who changed what" and suggestions. Revisit when it ships.

### 6.2 Undo across sync
y-tiptap's UndoManager tracks only local-origin transactions, so collaborators' edits aren't undone by your Ctrl+Z (existing behaviour). Desktop-specific rules: updates applied from storage (`LOCAL_ORIGIN`), from the server provider, and the seed (`addToHistory: false`, as today) must never enter the undo stack. Restoring a version is one undo step. The undo stack is per window session and not persisted.

### 6.3 Top data-loss risks and mitigations

| # | Risk | Mitigation |
|---|---|---|
| 1 | Reusing web cache semantics (expiry, cap, epoch wipe, delete-on-tombstone, sweep, edit budget) on desktop | Separate desktop store with no eviction. Tombstone → `server_gone`, never delete. |
| 2 | Full-state overwrite of unsynced edits (§4.6 pattern), or compaction deleting rows it never merged | Append-only `updates` plus CAS compaction that deletes only `seq <= X`. |
| 3 | Crash or power loss mid-write | SQLite WAL + `synchronous=FULL` + macOS `fullfsync`. `quick_check` after an unclean exit. Daily `VACUUM INTO` backups. |
| 4 | Duplicate content when merging unrelated histories (wrong link, re-import), or double title from the seed race | Lineage check on attach and on server first upload. Reveal link only after ack. Deterministic seed. |
| 5 | clientID clash (multiple windows or instances, restored clientID) | One Y.Doc per doc in the native process. Exclusive library lock. Never persist clientID. |
| 6 | Old build deleting unknown content, then syncing it | `client_outdated` floor (exists). Local read-only when `outdated`. Auto-update. Per-doc stored schema. Downgrade guard. |
| 7 | Over-cap or refused share looping and getting the IP banned | Pre-check size and `/api/info`. Stop-sync close reasons (exists). Status `paused_refused`, no retry. |
| 8 | Capability leak (IDs into `global-tabs`, secret in path/query/logs) | Secret in fragment and token only, hashed at rest. Never add share links to `global-tabs`. Owner secret for delete. |
| 9 | Webview storage wiped by an update or origin change | No source of truth in the webview. Native SQLite only. |
| 10 | Library file copied by Dropbox/iCloud while open (WAL split, conflicted copies) | Store under app support, not Documents. Warn if the library path is inside a known sync folder. Backups go to a separate folder. |

### 6.4 How to test (fits `tests/load` and Playwright conventions)
Add `tests/load/desktop-durability-soak.ts` (standalone Bun script, `writeReport`, the same style as `mixed-version-soak.ts`) that runs the **native storage module headless** (no shell) against a temp library and a spawned `bun run hocus` (`HOCUS_THROTTLE=0`, `HOCUS_EXIT_ON_STDIN_EOF=1`):
1. **SIGKILL during write**: a child process edits at full speed. The parent kills it at random points ×200. Reopen and assert every update acknowledged by `onPersisted` callbacks before the kill is present (`Y.encodeStateVector` ⊇ last acked SV) and `quick_check` = ok.
2. **SIGKILL during compaction**: the same, with compaction forced every few hundred updates. Assert no loss and no duplicate snapshot rows.
3. **Two writers**: two processes on the same library. Assert the second refuses (lock), or with IPC hand-off that both windows' edits persist.
4. **Hydration slow path**: inject a delay in the storage read longer than any timeout. Assert pending offline edits survive (regression test for §4.6, and a unit test for the web `bindLocalCopy` too).
5. **Tombstone while offline**: share, go offline, edit, DELETE the share from another client, reconnect. Assert the local doc is intact with status `server_gone`.
6. **First-share race**: a web client polls the share URL while the desktop uploads. Assert exactly one title heading after convergence (seed dedupe and/or link-after-ack).
7. **Lineage mismatch**: attach an unrelated doc to an existing share and assert refusal with no server change.
8. **Over-cap share**: a 3 MiB doc. Assert the pre-check refuses, there are zero WS connections to the share, and no Throttle ban.
9. **Mixed schema vs old server**: run hocus with a lower allowlist (old self-hosted). Assert the `/api/info` refusal before upload. Force-connect and assert `schema_rejected` stops sync without a loop.
10. **Rotation**: rotate the edit secret while two clients edit. The old-token client is kicked and read-only, and its local doc is kept.
11. **Convergence**: reuse `yjs-load-harness.ts` with desktop clients that restart from their SQLite store mid-run (restart churn). Assert byte-equal state at drain.

Nightly: add 1–2 and 5–6 to `nightly.yml`. Keep unit tests for CAS compaction and lineage in `bun test`.

---

## 7. Source list

Primary (code, docs, papers)
- AFFiNE native schema: https://github.com/toeverything/AFFiNE/blob/canary/packages/frontend/native/schema/src/lib.rs
- AFFiNE nbstore storage/doc: https://github.com/toeverything/AFFiNE/tree/canary/packages/frontend/native/nbstore/src
- AFFiNE Electron process model: https://docs.affine.pro/develop-wip/frontend/electron
- AppFlowy-Collab RocksDB plugin: https://github.com/AppFlowy-IO/AppFlowy-Collab/tree/main/collab/src/plugins/local_storage
- Automerge storage: https://automerge.org/docs/reference/under-the-hood/storage/
- Yjs releases (v13.6.33 stable, v14 rc.30): https://github.com/yjs/yjs/releases
- Yjs document updates: https://docs.yjs.dev/api/document-updates ; Y.Doc: https://docs.yjs.dev/api/y.doc ; FAQ: https://docs.yjs.dev/api/faq
- Hocuspocus hooks (v4): https://tiptap.dev/docs/hocuspocus/server/hooks ; subdocuments: https://tiptap.dev/docs/hocuspocus/guides/multi-subdocuments ; releases: https://github.com/ueberdosis/hocuspocus/releases
- y-webrtc: https://github.com/yjs/y-webrtc
- secsync: https://github.com/nikgraf/secsync (last push 2024-09) ; architecture: https://deploy-preview-115--secsync.netlify.app/docs/architecture-design
- Excalidraw collab link code: https://github.com/excalidraw/excalidraw/blob/master/excalidraw-app/data/index.ts ; E2EE blog (2020): https://plus.excalidraw.com/blog/end-to-end-encryption
- Bitwarden Send encryption: https://bitwarden.com/help/article/send-encryption/
- CryptPad whitepaper: https://blueprints.cryptpad.org/document/whitepaper/ ; revocation: https://blueprints.cryptpad.org/prototypes/revocation/
- Proton Docs integrity attacks (CCS 2026): https://eprint.iacr.org/2026/1994
- E2EE collaborative documents (USENIX Security 2026): https://www.usenix.org/conference/usenixsecurity26/presentation/knabenhans
- Keyhive/Beelay: https://www.inkandswitch.com/project/keyhive/
- Anytype privacy: https://doc.anytype.io/anytype/data/privacy-and-encryption ; any-sync: https://github.com/anyproto/any-sync
- wry 0.45 IndexedDB path fix: https://v2.tauri.app/release/wry/v0.45.0
- Jupyter collaboration OOB/TTL: https://github.com/jupyterlab/jupyter-collaboration/issues/243 , https://github.com/jupyterlab/jupyter-collaboration/issues/430
- Tiptap Snapshot (Pro): https://tiptap.dev/docs/collaboration/documents/snapshot
- Electrobun: https://github.com/blackboardsh/electrobun

Secondary
- Yjs 14 / @y/prosemirror (2026-04): https://nick-the-sick.pckt.blog/yjs-14-at-yprosemirror-wwv64pw
- Yjs v14 format notes: https://newreleases.io/project/yarn/yjs/release/14.0.0-9 ; https://pkg.go.dev/github.com/Deln0r/ygo@v1.25.0
- Logseq DB May 2026: https://discuss.logseq.com/t/whats-new-with-logseq-db-may-16th-2026/35020 ; review: https://www.promptquorum.com/power-local-llm/logseq-review
- Relay for Obsidian: https://community.obsidian.md/plugins/system3-relay
- SQLite durability: https://www.agwa.name/blog/post/sqlite_durability ; https://avi.im/blag/2025/sqlite-fsync/
- PowerSync Tauri note: https://releases.powersync.com/announcements/ann_mPwGQpcccCyvL
- Deterministic initial content: https://morizbuesing.com/blog/initializing-a-yjs-document-with-a-common-value
- Concurrent compaction: https://patternist.xyz/posts/concurrent-compaction-in-automerge-repo
- Yjs forum (gc/snapshots): https://discuss.yjs.dev/t/gc-is-off-but-still-losing-delection-history/2704 ; duplicate initial content: https://discuss.yjs.dev/t/initial-offline-value-of-a-shared-document/465
