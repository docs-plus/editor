# TinyDocy Desktop: file manager, live sharing and offline UX proposal

Date: 2026-11-15. Author: UX lead (planning team). Status: proposal for owner decisions.
Scope: desktop app (macOS, Windows, Linux), file manager, optional live sync per document, web app changes. No accounts. This proposal covers interaction, structure and copy, not pixel mockups.

---

## 0. Ground truth from the current repo (constraints this design must respect)

These come from reading the code. Generic file-manager prior art would not surface them.

| Fact today | Where | Why it matters for the desktop design |
|---|---|---|
| **Closing a tab deletes the document.** `closeTab`/`closeAllTabs` call `DELETE /api/documents/[id]`, ⌘W triggers it, and the server tombstones the name for 90 days. | `hooks/use-synced-tabs.ts`, `components/tab-bar/tab-bar.tsx` | In a file manager, closing must never delete. A collaborator closing a shared doc's tab must never tombstone it for everyone. |
| **The tab list (`global-tabs`) goes to every sandbox visitor.** | `useSyncedTabs`, README | A live-shared document (from desktop or opened from a link on web) must **never** be added to `global-tabs`, because that would publish the "secret" link to everyone. This is a hard design rule. |
| Offline copies expire after 14 days, are capped at 30 docs and pause edits at 512 KiB. | `lib/offline/` | They are a cache, not storage, so they can't back a file manager. Desktop local docs need their own durable store that never evicts. |
| The server deletes documents after 30 idle days (`RETENTION_DAYS`) and keeps tombstones for 90 days. Production caps documents at 2 MiB (`MAX_DOC_SIZE_BYTES`). | README config | The share dialog has to state these limits up front, and the copy for each state has to account for them. A tombstoned link can't be reused, so "Share again" must create a new link. |
| Existing refusal reasons include `DOCUMENT_TOO_LARGE_REASON`, `DOCUMENT_DELETED_REASON`, `OFFLINE_BUDGET_REASON`, `SCHEMA_REJECTED_REASON` and `CLIENT_OUTDATED_REASON`. Their tone is "your changes on this device are kept". | `components/document-editor/document-notice.tsx` | Each sync state below maps to one of these reasons and keeps that tone. |
| The outdated-client Reload button calls `location.reload()`. | `document-notice.tsx` | A reload won't fetch a newer bundle inside a packaged app. On desktop the action becomes **Update and restart**. |
| The TOC sits in the left margin so the content stays centred (an owner preference), and it falls back to an overlay when there isn't room. | `components/toc-sidebar/`, AGENTS.md | A file sidebar also wants the left edge, so the layout ladder in §1.4 resolves the conflict. |
| Faces must be fixed: a fixed icon plus a fixed word, never changing abbreviated text. Details go in a popover. | Owner feedback on the Repeat face | Sync status faces follow this rule. Counts and reasons appear only in the popover. |
| Some shortcuts are already taken: ⌘B/I/U/E, ⌘K (link), ⌘\ (clear), ⌘⇧S (strike), ⌘⇧L/E/R/J (align), ⌘⇧F (filter), ⌘⇧H, ⌘⇧B, ⌘⇧I, ⌘⇧7/8/9, ⌘⌥0–6, ⌘⌥V, ⌘T, ⌘W, ⌘⇧[ ], Alt+/. | `lib/editor-actions/`, `tab-bar.tsx` | Desktop shortcuts are chosen around these (§4.2). Two existing collisions are flagged there: ⌘⇧R and ⌘⇧S. |

---

## 1. Information architecture

### 1.1 Vocabulary (use these words everywhere: UI, menus, docs)

| Term | Meaning | Icon (lucide) |
|---|---|---|
| **Document** | One title-first page. Never "file", "pad" or "note" in the UI, except in "Show in Finder" and import/export wording. | `FileText` |
| **Local** | Stored only on this device. Nobody else can see it. | `Laptop` |
| **Live** | Shared through a link. Anyone with the link can open and edit it. Changes sync for everyone. | `Users` |
| **Public sandbox** | Web only: the shared tab list everyone sees on tiny.docs.plus (today's behaviour). | `Globe` |
| **Library** | All documents on this device (desktop). | `Library` |
| **Trash** | Deleted documents. They are kept for 30 days, then removed. | `Trash2` |

"Live" is preferred over "Cloud" or "Synced". There is no account or personal cloud, and "synced" would wrongly suggest a backup across your own devices. Prior art: Excalidraw uses "Live collaboration", and AFFiNE separates a local workspace from a cloud workspace ([AFFiNE workspaces](https://docs.affine.pro/core-concepts/elements-of-affine/workspaces)).

### 1.2 Owner decision 1: where documents live (this drives everything else)

| Option | What it is | Pros | Cons | Prior art |
|---|---|---|---|---|
| **A. App library** | Docs in the app-data directory (SQLite or IndexedDB). The tree is virtual. | Simplest. No file watching. Rename is just metadata. | Uninstall or "clear app data" can wipe everything. "Show in Finder" is meaningless. Backup needs a custom export. Users can't see their data. | Bear, Apple Notes, Craft (cloud-first; "External Locations" is the exception: [Craft](https://support.craft.do/hc/en-us/articles/6696361366813-External-Locations)) |
| **B. Visible folder of `.tinydocy` files** **(Recommended)** | `~/Documents/TinyDocy/` (Windows: `Documents\TinyDocy`) holds real folders and one `.tinydocy` file per doc. Each file carries the Yjs state plus metadata (doc id, title, share link, manage key). | Survives uninstall. Time Machine, File History and Dropbox back it up with no extra work. "Show in Finder", file association, recents and Jump Lists all work. Trust: "my documents are files I own". | Needs file watching and external-rename handling. Duplicates made in Finder or by sync services create id collisions (handled in §2.6). Folder = real directory. | Obsidian vault ([File explorer](https://obsidian.md/help/plugins/file-explorer)), Typora ([File Management](https://support.typora.io/File-Management/)), Logseq graph folder |
| **C. Markdown as source of truth** | Docs are `.md` files edited in place. | Maximum portability. | **Lossy:** Mermaid live diagrams, embeds, text-style tokens, folds and Yjs history don't round-trip. Live sync would need a Yjs sidecar, so you'd have two sources of truth. | Typora, iA Writer, Obsidian |

The recommendation is **B**. It is the only option that makes "losing docs on uninstall" structurally impossible, and it makes "Show in Finder" and backups honest. Markdown stays a first-class **export**, plus "Open With" import (§3). Logseq's forum is full of users who couldn't find where their data lived after clearing caches ([Logseq forum](https://discuss.logseq.com/t/lost-entire-graph-after-clearing-cache/34822)). The design should make the location visible at first run and in Settings.

### 1.3 Owner decision 2: file manager shape

| Option | Shape | Pros | Cons |
|---|---|---|---|
| **A. Sidebar tree only** | Left Files sidebar: sections plus a folder tree. Documents open in tabs. | Familiar (Obsidian, Notion, Typora). One click to switch. Keyboard tree works well. | Competes with the TOC on the left. Weak for bulk management. |
| **B. Library home view** | A "Home" page lists docs (Name, Status, Modified, Folder). Docs open in tabs. No persistent tree. | Good for bulk actions and sorting, and roomy. Like Google Docs home or the Figma file browser. | Two clicks to switch docs. Feels like a "launcher", not an editor. |
| **C. Hybrid (Recommended)** | The sidebar tree is the primary navigator. Clicking a section header (Recent, Live, Trash, a folder) opens a **list view in the main area** with sort, multi-select and bulk actions. | Gets both: quick switching plus a roomy place for Trash, Live and search results. Notion and Apple Notes follow this pattern of a sidebar of collections plus a content list. | Slightly more to build. Keep the list view a simple table. |

### 1.4 Desktop sidebar contents (Option C)

```
Files sidebar (top to bottom)
  [ Search documents   ⌘O ]      quick open, by title and content
  Playground                      local sample doc, pinned, regenerable
  ─────────────
  Recent                          last 10 opened, list view on click
  Pinned            (only if any) user-pinned docs
  Live                            smart list: every doc shared by link
  ─────────────
  Library                         the folder tree (real folders)
    > Project notes
    > Drafts
      Meeting 2026-11-12
      Q4 plan                ◉    (Users icon = Live)
  ─────────────
  Trash             (count)       list view, Restore / Delete now
```

- **Playground on desktop:** the sample doc (today's regenerable feature tour) becomes **local** and is pinned above the sections, so it works offline and is never shared. It can't be deleted, only regenerated (⌘⇧R today; see the collision note in §4.2). The public sandbox Playground stays web-only.
- **No "Shared with me".** Without accounts, a doc you joined through a link lands in Library at the root, carrying the Live icon. The **Live** smart list collects both docs you shared and docs you joined. One list, one concept.
- **Pinned** appears only after the first pin, the same way Notion's Favorites appears after your first favorite ([Notion sidebar](https://www.notion.com/help/navigate-with-the-sidebar)).

### 1.5 Tabs, sidebar and TOC: how they coexist

- **Tabs on desktop are per window and local:** the docs open in this window, like a browser or VS Code. They are not synced, and closing one never deletes anything. The `global-tabs` doc is not used on desktop at all.
- **Left-edge ladder** (no automatic changes the user didn't ask for, per the owner's "never changes on its own" principle):
  - **≥ 1400 px, sidebar open:** Files sidebar (240 px, resizable 200–360) | TOC in the left margin of the content area | centred content.
  - **< 1400 px, sidebar open:** the TOC uses its existing **overlay** mode (the Outline button in View opens it). The sidebar stays as the user left it.
  - **Sidebar collapsed (⌃⌘S / Ctrl+Shift+D):** today's layout exactly, with the TOC in the left margin. On macOS the traffic lights and a sidebar toggle sit in the titlebar row.
- The sidebar's open or collapsed state is remembered per window, the same way the `toolbarDensity` slot works.

#### Sketch: main window, macOS, wide, sidebar open

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ● ● ●  [≡]  │ ⚗ Playground │ Q4 plan  ◉ ✕ │ Meeting 2026-11-12 ✕ │ +           │ titlebar = tab row
├─────────────────────┬────────────────────────────────────────────────────────────┤
│ [⌕ Search    ⌘O]    │  B I U  A▾  ¶▾  ⋯             [◉ Live]  [Share]            │ toolbar + status + Share
│ ⚗ Playground        │────────────────────────────────────────────────────────────│
│ ─────────────────   │  OUTLINE          │                                        │
│ ◷ Recent            │  Q4 plan          │   Q4 plan                              │
│ ★ Pinned            │   Goals           │   ───────                              │
│ ◉ Live           2  │   Risks           │   Goals                                │
│ ─────────────────   │   Timeline        │   Ship the desktop app...              │
│ ▾ Library           │                   │                                        │
│   ▸ Project notes   │                   │                                        │
│   ▾ Drafts          │                   │                                        │
│      Meeting 11-12  │                   │                                        │
│      Q4 plan     ◉  │                   │                                        │
│ ─────────────────   │                   │                                        │
│ 🗑 Trash         3  │                   │                                        │
└─────────────────────┴───────────────────┴────────────────────────────────────────┘
```
(Glyphs in sketches are placeholders for lucide icons. The shipped UI uses lucide only, no emoji.)

#### Sketch: Windows/Linux, sidebar collapsed (today's layout plus a menu)

```
┌──────────────────────────────────────────────────────────────────── _  □  ✕ ┐
│ [≡] File Edit View Document Help │ ⚗ Playground │ Q4 plan ◉ ✕ │ +          │ Windows: custom titlebar (WCO)
├──────────────────────────────────────────────────────────────────────────────┤
│  B I U  A▾  ¶▾  ⋯                                   [◉ Live]  [Share]        │
├──────────────────────────────────────────────────────────────────────────────┤
│  OUTLINE        │            Q4 plan                                         │
│  Goals          │            Goals                                           │
│  Risks          │            ...                                             │
└─────────────────┴────────────────────────────────────────────────────────────┘
Linux: native window frame and a normal menu bar (no custom titlebar).
```

#### Sketch: list view (click "Live", "Recent", a folder or "Trash")

```
┌ Live ─────────────────────────────────────────────── [Sort: Modified ▾] ┐
│  Name                 Status        Modified       Folder                │
│  ◉ Q4 plan            Live          2 min ago      Drafts                │
│  ◉ Team retro         Paused        yesterday      Library               │
│  ◉ Trip ideas         Sharing ended 3 days ago     Library               │
│                                                                          │
│  Live documents can be opened and edited by anyone with the link.        │
└──────────────────────────────────────────────────────────────────────────┘
```

### 1.6 Owner decision 3: does the web app get the file manager?

| Option | Web app | Pros | Cons |
|---|---|---|---|
| **A. Web stays the public sandbox, plus a shared-link view (Recommended for v1)** | Today's tabs and Playground, labelled "Public sandbox". `/s/<id>` opens a **separate single-document view**, never added to `global-tabs`. A small local "Recently opened links" list (this browser only) lets people get back to a link. | Honest: browser storage can be evicted, and offline copies expire after 14 days. One codebase, small scope. The sandbox demo is preserved. | Web users don't get folders or a local library. |
| B. Web gets the same Library in browser storage | IndexedDB/OPFS library plus `navigator.storage.persist()`, labelled "Stored in this browser". | Parity with desktop. | Users trust it like files, then lose everything on "Clear site data" or eviction. Hard to explain without accounts. |
| C. Web uses the File System Access API on Chromium | Real files. | Real files. | Chromium only, permission prompts, a two-tier experience. |

Copy for the web sandbox header (fixed, small): "Public sandbox · Everyone sees these tabs. Get the desktop app for private documents."

---

## 2. Local vs Live mental model (no accounts)

### 2.1 Principles
1. **Local is the default and the quiet state.** New, imported and duplicated documents are always Local.
2. **Going Live is one deliberate act** that shows the consequences in plain words before anything leaves the device.
3. **Your copy always stays.** Every Live doc keeps a full local copy, so it works offline and survives server deletion. Every error state ends with "your copy on this device is kept".
4. **The status is always visible:** a chip next to Share with a fixed icon and a fixed word. Details live in the chip's popover.
5. **Stopping can't recall copies.** The UI says so wherever sharing ends.

### 2.2 Share flow

Entry points: the **Share** button (toolbar right, fixed icon plus the word "Share"); **File > Share Live…**; the tree context menu "Share Live…"; the action palette ("Share live").

**Step 1, consent dialog** (every time for a Local doc; the dialog is short, so there's no "don't show again"):

```
┌ Share "Q4 plan" live ──────────────────────────────────────┐
│                                                            │
│  Anyone with the link can open and edit this document.     │
│  There's no sign-in, so treat the link like a password.    │
│                                                            │
│  • A copy is stored on tiny.docs.plus.                     │
│  • It's deleted from the server after 30 days without      │
│    edits. Your copy on this device stays.                  │
│  • Don't share private or sensitive information.           │
│                                                            │
│                         [ Cancel ]  [ Create link ]        │
└────────────────────────────────────────────────────────────┘
```
- The server name comes from Settings > Sharing server (self-host friendly).
- **Size gate, before upload:** if the doc is over the cap, the primary button is disabled and the dialog says: "This document is too big to share (2.4 MB; the limit is 2 MB). Remove some images or split it into two documents."
- **Offline:** "You're offline. Connect to the internet to create a link." The button is disabled.

**Step 2, link ready** (the same popover is what the Share button opens later):

```
┌ Share "Q4 plan" ──────────────────────────── ◉ Live ┐
│  https://tiny.docs.plus/s/7Hq2…kP9w    [ Copy link ]│
│  Anyone with the link can edit.                     │
│  ────────────────────────────────────────────────── │
│  People here now: 3                                 │
│  ────────────────────────────────────────────────── │
│  Reset link…     Stop sharing…                      │
└─────────────────────────────────────────────────────┘
```
- Copy link → button reads "Copied" for 2 s. The status pill announces "Link copied". No silent auto-copy.
- **Reset link…** gives the doc a new link and stops the old one. Use it when a link leaked. Confirm with: "Make a new link? The current link stops working. People who already opened it keep their copies, but they won't get new changes. Send the new link to anyone who should keep editing."
- **Stop sharing…** (only on the device that created the link; see §2.5): "Stop sharing "Q4 plan"? The link stops working and the server copy is deleted. People who already opened it keep their own copies. Your document stays here as a Local document." Buttons: [Cancel] [Stop sharing].
- On a device that **joined** the doc, the bottom row reads **Stop syncing here…** instead: "Stop syncing "Q4 plan" on this device? You keep a Local copy. Others keep editing the shared one; you won't see their changes." That device can't delete the server copy.

### 2.3 What the link is and how it opens

- **Canonical link:** `https://<server>/s/<id>`, where `<id>` is at least 128 bits of randomness, base62 (about 22 characters). It's always https, because a bare `tinydocy://` link does nothing when the app isn't installed. Chat apps also often don't make custom schemes clickable. Microsoft's guidance recommends trying the custom protocol, then falling back to the web equivalent ([Old New Thing](https://devblogs.microsoft.com/oldnewthing/20230308-04/?p=107915)).
- **Handoff page** at `/s/<id>`: served with `Referrer-Policy: no-referrer` and `noindex`, so the capability URL doesn't leak through referrers or search engines. The W3C TAG says capability URLs leak through many routes and should be treated like passwords ([W3C TAG, Capability URLs](https://www.w3.org/2001/tag/doc/capability-urls); [Referrer Policy](https://www.w3.org/TR/referrer-policy/)).

```
┌──────────────────────────────────────────────┐
│  TinyDocy                                    │
│                                              │
│  "Q4 plan" is a live document.               │
│  Anyone with this link can edit it.          │
│                                              │
│  [ Open in TinyDocy app ]                    │
│  [ Continue in browser ]                     │
│                                              │
│  Don't have the app?  Download TinyDocy      │
│  [ ] Always open live links in the browser   │
└──────────────────────────────────────────────┘
```
- The page tries `tinydocy://open/s/<id>` once on load. If the page stays visible after about 1.5 s, the buttons remain and nothing else happens: no loops, no repeated prompts. "Always open in browser" is stored in this browser only.
- **Show the title?** The title is document content, and showing it on the handoff page means an unauthenticated fetch of content. Showing it in the **page body** is reasonable because the link already grants edit access, but the owner should confirm it (Decision 6).
- **Link previews:** whatever Decision 6 says, the page's `<title>` and Open Graph tags stay generic ("A live TinyDocy document"). Slack, iMessage and similar apps fetch links and show the preview to everyone in the channel, including people who never click.
- **Desktop app receives the deep link** (single-instance; Windows and Linux deliver it as a command-line argument to a new process, so the running instance must take it over, per [Tauri deep linking](https://v2.tauri.app/plugin/deep-linking/)):
  - Not in Library yet: download the doc, create `Library/<Title>.tinydocy`, open it in a new tab, and show a one-time banner: "You joined a live document. Anyone with the link can edit it. Your copy is saved on this device."
  - Already in Library: just focus its tab.
- **Paste a link:** File > Open Link… (⌘⇧O / Ctrl+Shift+O) takes a pasted `https://…/s/…` URL. This handles the case where the browser refuses the custom scheme.
- **Web fallback ("Continue in browser"):** a single-document view with a header strip: "Live document · Anyone with the link can edit · [Get the desktop app]". It is **not** added to the sandbox tab list. Closing it never deletes anything; the view has no delete action at all. It uses the existing 14-day offline copy for resilience.

### 2.4 Status chip and states

The **chip** (toolbar right, next to Share) has a fixed icon and a fixed word, so it never changes width with counts. Clicking it opens a popover with the full sentence and any actions. The same icon shows on the tab and in the tree **only for non-Local docs**, and a small dot is added for Pending, Paused or Ended. State changes are announced once, through the existing status pill live region. No second live region is added, matching the offline banner's rationale.

### 2.5 Who can stop sharing (no accounts)

| Option | Rule | Pros | Cons |
|---|---|---|---|
| **A. Creator's device holds a manage key (Recommended)** | Creating the link also stores a random manage key inside the `.tinydocy` file. "Stop sharing" and "Reset link" need it. Joiners can only "Stop syncing here". | A collaborator (or vandal) with the link can't **delete or unlink** the doc for everyone. The key travels with the file through backups and copies to another machine. | If you lose the file, nobody can stop it. It still expires after 30 days without edits, so say that in the popover. |

**Server change this option depends on:** `DELETE /api/documents/[id]` accepts any id from anyone today. For Live docs the route, or a new one, must require the manage key. Without that check, Option A's promise is false.

**What the manage key does not protect:** anyone with the link can still select all and delete, or deface, the content. That is an ordinary edit (the size guard even allows delete-only updates at the cap), and it syncs to every device, including the creator's file. Yjs undo only reverts your own changes. See R8 and Decision 10 (local snapshots).

**Where the manage key goes:** it never leaves through copies. Duplicate, Save a Copy…, every Export and the row-12 fork all strip both the link and the manage key. Emailing a `.tinydocy` file made with Save a Copy therefore never hands over Stop sharing power. Moving or backing up the original file keeps both.
| B. Anyone with the link can stop it | — | Simple. | One click from any recipient deletes the doc for everyone. That is today's close-tab bug, in another form. |
| C. Nobody can stop it, only expiry | — | Simplest backend. | Users have no way to react to a leaked link. |

### 2.6 State copy table

Tone matches `document-notice.tsx`: short, plain, and saying what happens to your work. "Chip" is the fixed face; "Popover / notice" is the full message. Where a state blocks or degrades editing, the notice also appears inline above the document, as today.

| # | State | Trigger (existing reason) | Chip | Popover / notice copy | Actions |
|---|---|---|---|---|---|
| 1 | **Local only** | default | `Laptop` **Local** | "Only on this device. Nobody else can see it." | [Share live…] |
| 2 | **Live, synced** | connected, nothing pending | `Users` **Live** | "Live. Anyone with the link can edit. Changes sync as you type." + People here now: N | [Copy link] [Reset link…] [Stop sharing…] / [Stop syncing here…] |
| 3 | **Live, syncing** | pending changes, connected | `Users` **Live** (subtle spinner overlay; same word) | "Saving your changes to the shared copy…" | none |
| 4 | **Live, offline, changes waiting** | offline, unsynced | `CloudOff` **Offline** | "You're offline. Your changes are saved on this device and will sync when you reconnect. Others won't see them until then." + "Changes waiting: 12" | [Try now] |
| 5 | **Offline edit budget reached** | `OFFLINE_BUDGET_REASON` | `CloudOff` **Offline** | "You've made a lot of changes offline. Editing resumes when you're back online; nothing is lost." (Desktop: raise or remove this budget for Live docs, since the local file is durable. Engineering to confirm.) | [Try now] |
| 6 | **Sync paused: too large** | `DOCUMENT_TOO_LARGE_REASON` | `PauseCircle` **Paused** | "Sync paused: this document is over the 2 MB limit for live documents. Your changes are saved on this device. Remove some content to resume, or keep it as a Local document." | [Make a Local copy] [Stop syncing here…] |
| 7 | **Sync paused: update needed** | `CLIENT_OUTDATED_REASON`, schema guard `outdated` | `PauseCircle` **Paused** | "Sync paused: a newer TinyDocy is needed to keep syncing. Your changes are saved on this device." | [Update and restart] (desktop), [Reload] (web) |
| 8 | **Sync paused: server refused changes** | `SCHEMA_REJECTED_REASON` | `PauseCircle` **Paused** | "Sync paused: the server didn't accept this document's latest changes. Your changes are saved on this device." | [Make a Local copy] [Try again] |
| 9 | **Sync paused: server busy or blocked** | throttle, origin or socket limits | `PauseCircle` **Paused** | "Sync paused: the server isn't accepting connections right now. We'll try again in a few minutes. Your changes are saved on this device." | [Try now] (rate-limited) |
| 10 | **Sharing ended** (deleted on the server: stopped by the creator, reset, or 30-day expiry) | `DOCUMENT_DELETED_REASON` / tombstone | `Unlink` **Ended** | "Sharing ended. This link no longer works, so no one can join or sync. Your copy here is kept and still editable." | [Keep as Local] (default; clears the Live icon) [Share again…] (new link) [Move to Trash] |
| 11 | **Link not found** (opening a dead link) | tombstone at connect | (handoff/web page) | "This live document doesn't exist anymore. The link may have been reset or stopped, or it expired after 30 days without edits. Ask the person who sent it for a new link." | [Open TinyDocy] |
| 12 | **Conflicting copy: duplicate Local file** (Finder copy, restored backup, Dropbox "conflicted copy" of a Local doc) | two files with one doc id, doc not Live | `Copy` **Copy** (on the newer file) | "This file is a copy of "Q4 plan", which is already in your Library. To keep both, this copy becomes a separate Local document." | [Keep as separate document] (default; new id) [Move to Trash] |
| 12b | **Duplicate of a Live doc** (the same Live file synced by Dropbox/iCloud from two machines) | two files with one Live doc id | no new chip; the doc stays **Live** | No prompt. The server already holds the merged state, so the app merges both files into the original through sync and moves the extra file to Trash, with this toast: "Merged a synced copy of "Q4 plan". The extra file is in Trash." | [Undo] in toast |
| 15 | **Not downloaded** (the file is a cloud-only placeholder: iCloud "Optimize Mac Storage", OneDrive Files On-Demand) | file read returns a placeholder | `CloudDownload` **Not here** | "This document is stored in iCloud and isn't on this Mac yet. Connect to the internet to download it." (Windows: "…stored in OneDrive and isn't on this PC yet…") | [Download now] [Keep on this device always] |
| 13 | **Conflicting copy: server doesn't match** (server copy has an unrelated history, e.g. server restored or id reused) | sync guard detects unrelated history | `PauseCircle` **Paused** | "The shared copy on the server doesn't match yours. To avoid mixing them, sync is paused. Your copy is kept." | [Keep mine as Local] [Open server copy separately] |
| 14 | **Local doc, can't be edited in this version** | schema guard `unrepairable` | `Lock` **Read-only** | "This document can't be edited in this version of TinyDocy. Update to edit it." | [Check for updates] |

Notes:
- Row 12 deliberately avoids a merge UI. Yjs merges histories from the same lineage safely, but a restored backup and the live file may be different versions the user wants to compare. "Keep both" is the safe, Dropbox-style default. A later "Combine changes" could be offered only when lineage is provably shared.
- Row 10: the old name is tombstoned for 90 days, so **Share again always creates a new link**. The copy says "new link" for exactly that reason.

---

## 3. File operations

| Operation | Desktop behaviour | Copy / notes |
|---|---|---|
| **New document** | ⌘N / Ctrl+N creates `Untitled` in the selected folder (or the Library root), opens it in a new tab and focuses the title. It's Local. | The title placeholder is today's. |
| **New folder** | ⌘⇧N / Ctrl+Shift+N creates the folder in place, with an inline rename field. | — |
| **Rename (title vs filename)** | **The title heading is the name.** Renaming in the tree edits the title (one undo step). The filename follows the title, sanitized and de-duplicated (`Q4 plan 2.tinydocy`), and it's renamed when the doc is saved or closed, not on every keystroke. | For a Live doc the rename field shows an inline hint: "Renaming changes the title for everyone." |
| **Renamed in Finder/Explorer** | The app keeps the title, since the title is content. The file shows under its title; the next title change renames the file again. | No dialog. Documented in Help. |
| **Duplicate** | File > Duplicate. The copy, "Q4 plan copy", is **always Local** with a new id and no link, and opens in a new tab. | macOS HIG prefers Duplicate over Save As ([Apple HIG, menu bar](https://developer.apple.com/design/human-interface-guidelines/the-menu-bar)). Toast: "Duplicated as a Local document." |
| **Move to folder** | Drag in the tree, or **Move to…** (a dialog with the folder tree; this is the keyboard alternative to drag). The file moves on disk. | Moving never changes Local/Live. |
| **Delete → Trash** | ⌘⌫ / Delete in the tree, or File > Move to Trash. The file goes to `TinyDocy/.trash/`, and the toast offers Undo for 8 s. | Live doc: "Move "Q4 plan" to Trash? This stops syncing on this device. Others keep editing the shared copy." If this device created the link, an extra checkbox appears: [ ] Also stop sharing for everyone. |
| **Trash** | List view with Restore, Delete now and Empty Trash. Items are removed after 30 days, matching Apple Notes' Recently Deleted ([Apple Support](https://support.apple.com/kb/PH21257)). | Footer: "Documents in Trash are deleted after 30 days." Empty confirm: "Delete 3 documents forever? This can't be undone." |
| **Restore** | Returns the doc to its original folder (or the root if that's gone). A Live doc restores as **Local** if its link was tombstoned meanwhile, with row 10 copy. | — |
| **Import** | File > Import… accepts `.md`, `.markdown`, `.txt`, `.html` and `.docx` (Beta), creating a new Local doc. Multiple files are allowed. | Toast: "Imported 3 documents." Lossy import: "Some formatting from notes.docx wasn't kept (2 text boxes, 1 comment)." |
| **Open a file from disk / drag in** | Dropping files on the window shows an overlay "Drop to import"; dropping on a tree folder imports into that folder. "Open With TinyDocy" on `.md` or `.html` imports too. `.tinydocy` files open in place (they're added to the Library if they live outside it, via a "Move into Library / Open where it is" prompt). | **Critical copy, shown once per import:** "Imported "notes.md" as a new document. The original file isn't changed." This prevents the Typora expectation of in-place editing (Decision 7). |
| **Export** | File > Export as > Markdown (`.md` plus an assets folder), HTML (single file), PDF; also File > Save a Copy… (`.tinydocy`). Export All… writes a `.zip` of Markdown. | Lossy notice in the dialog: "Diagrams export as Mermaid code, embeds as links; colours are dropped in Markdown." PDF also goes through Print (⌘P), per the HIG. |
| **Show in Finder / Explorer** | Context menu. The label is per OS: macOS "Show in Finder", Windows "Show in File Explorer", Linux "Show in Files" (Obsidian uses "Reveal in Finder" and "Show in system explorer"; [Obsidian help](https://obsidian.md/help/plugins/file-explorer)). | — |
| **Pin** | Context menu "Pin". Shows in Pinned. Stored in Library metadata. | — |
| **Copy link** | Context menu on Live docs only. | — |

### 3.1 Where data lives and backup (Settings > Storage)

```
┌ Settings ─ Storage ──────────────────────────────────────────┐
│  Your documents are ordinary files in:                       │
│  ~/Documents/TinyDocy                 [Show in Finder]        │
│                                       [Change location…]      │
│                                                              │
│  Back them up like any other files (Time Machine, File       │
│  History, or a synced folder). Uninstalling TinyDocy         │
│  doesn't delete them.                                        │
│                                                              │
│  [ Export all as Markdown… ]                                 │
│                                                              │
│  Trash: 3 documents · deleted after 30 days  [Empty Trash]   │
└──────────────────────────────────────────────────────────────┘
```
- **Change location** moves the folder (with progress) and never leaves documents in two places.
- **Default folder versus "works fully offline":** macOS "Desktop & Documents Folders" in iCloud with Optimize Mac Storage, and Windows OneDrive Known Folder Move, can turn files in Documents into cloud-only placeholders that don't open offline.
  - At first run, the app checks whether Documents is cloud-managed.
  - If it is, the welcome screen offers a local folder instead (`~/TinyDocy` on mac and Linux, `%USERPROFILE%\TinyDocy` on Windows) with this line: "Your Documents folder syncs to iCloud, so files may not be on this Mac when you're offline. Use a folder that always stays on this Mac?" [Use ~/TinyDocy] [Keep Documents].
  - Placeholders that turn up later get row 15.
- **Synced folders** (Dropbox, iCloud Drive) are allowed. Conflicted copies are handled by row 12. Craft warns that reliability then depends on the provider ([Craft](https://support.craft.do/hc/en-us/articles/6696361366813-External-Locations)), and the Help page should say the same.
- **Uninstallers:** the Windows uninstaller must not offer "delete my documents". App settings can be removed, but the Documents folder can't.

---

## 4. Desktop conventions per OS

### 4.1 Menus

macOS uses the native menu bar. Windows uses a menu in the custom titlebar (the ≡ button plus menu titles, with Alt revealing access keys). Linux uses a native menu bar. Order follows the HIG: App, File, Edit, Format, View, Window, Help ([Apple HIG](https://developer.apple.com/design/human-interface-guidelines/the-menu-bar)).

- **TinyDocy (mac app menu):** About TinyDocy · Check for Updates… · Settings… ⌘, · Hide/Quit.
- **File:** New Document ⌘N · New Folder ⌘⇧N · New Window ⌥⌘N · Open… ⌘O (quick open) · Open File… (system dialog) · Open Link… ⌘⇧O · Open Recent ▸ (with Clear Menu) · Close Tab ⌘W · Close Window ⌘⇧W · Rename… · Duplicate · Move to… · Pin · Move to Trash ⌘⌫ · Share Live… · Import… · Export as ▸ (Markdown, HTML, PDF) · Save a Copy… · Show in Finder · Print… ⌘P.
- **Edit:** Undo/Redo, Cut/Copy/Paste, Paste and Match Style, Select All, Find ⌘F, Action palette Alt+/.
- **Format:** mirrors the toolbar registry (the existing `lib/editor-actions` ids) so every toolbar action is also a menu item.
- **View:** Show/Hide Sidebar ⌃⌘S · Outline · Simplified toolbar · Zoom In/Out/Actual Size (⌘+ ⌘- ⌘0) · Enter Full Screen ⌃⌘F · Theme.
- **Window (mac):** Minimize, Zoom, Next Tab ⌘⇧], Previous Tab ⌘⇧[, Move Tab to New Window, the window list.
- **Help:** TinyDocy Help · Keyboard Shortcuts · Where are my documents? (opens the Storage settings) · Report a Problem · Release Notes.

### 4.2 Shortcuts (Cmd on mac, Ctrl on Windows/Linux)

| Action | macOS | Win/Linux | Note |
|---|---|---|---|
| Quick open (search docs) | ⌘O | Ctrl+O | Obsidian-style quick switcher (Obsidian also uses ⌘O). ⌘K is taken by link. This bends the HIG, where ⌘O opens the system dialog: the quick-open list ends with "Open file from disk…", so the HIG meaning is one step away. |
| Open file from disk | ⌥⌘O | menu only | Ctrl+Alt is AltGr on many layouts (Polish AltGr+O = ó), so it would steal characters. The repo's toolbar spec hit the same issue with Repeat. |
| Open link | ⌘⇧O | Ctrl+Shift+O | — |
| New document / folder / window | ⌘N / ⌘⇧N / ⌥⌘N | Ctrl+N / Ctrl+Shift+N / menu only | New window gets no Ctrl+Alt+N because of AltGr (Polish AltGr+N = ń). ⌘T keeps "new tab" as a new document. |
| Toggle sidebar | ⌃⌘S | Ctrl+Shift+D | ⌃⌘S is the macOS "Show Sidebar" standard. ⌘B is bold, ⌘⇧E is align centre. |
| Focus next region | F6 / ⇧F6 | F6 / Shift+F6 | Sidebar → tabs → toolbar → editor → outline. |
| Rename in tree | F2 | F2 | In the tree, Enter **opens** (as in Notion and Obsidian). F2 renames on every OS, plus a context menu item. Finder's Enter-renames is not adopted. |
| Move to Trash | ⌘⌫ | Delete | Only when the tree has focus. |
| Print / PDF | ⌘P | Ctrl+P | — |
| Settings | ⌘, | Ctrl+, | — |

**Collisions to resolve (Decision 8):**
- **⌘⇧S** is strikethrough today, but the HIG's Duplicate/Save As shortcut is ⇧⌘S. Proposal: Duplicate gets no shortcut and strikethrough stays.
- **⌘⇧R** currently does both Align right and Playground regenerate in `tab-bar.tsx`. Proposal: move regenerate to a menu or button only.

### 4.3 Window chrome

- **macOS:** hidden-inset titlebar. Traffic lights sit at the left, the sidebar toggle next to them, and the tabs share the titlebar row (Safari, Arc and Obsidian do this). Double-clicking empty titlebar space zooms. Native full screen is supported.
- **Windows:** custom titlebar with Window Controls Overlay (native min/max/close at the right) plus the ≡ menu. Snap Layouts on hovering maximize come free with native controls.
- **Linux:** native decorations and menu bar by default. GNOME, KDE and tiling WMs differ too much to be worth the risk of a custom frame.

### 4.4 Multiple windows

- Each window has its own tabs. The same doc can be open in two windows, and both are live views of the same Yjs doc, so there is nothing to reconcile.
- "Move Tab to New Window" (menu) in v1; drag a tab out to a new window later.
- On quit, windows and their tabs are restored next launch. Restore uses the "Continue where you left off" position per doc, which already exists.

### 4.5 Recent documents, file associations, deep links

- **Open Recent** menu, the macOS Dock menu and the Windows Jump List (the Jump List needs the `.tinydocy` association; [Electron Recent Documents](https://electronjs.org/docs/latest/tutorial/recent-documents)).
- **Associations:** `.tinydocy` is owned (double-click opens it). `.md` and `.html` are registered as "Open With" targets only, never as the default handler.
- **`tinydocy://` scheme:** registered at install. On macOS it can't be registered at runtime ([Tauri deep linking](https://v2.tauri.app/plugin/deep-linking/)). On Linux, `update-desktop-database` may be needed.

### 4.6 First run (one screen, no carousel)

```
┌──────────────────────────────────────────────────────┐
│                 Welcome to TinyDocy                   │
│                                                      │
│  Your documents are saved as files on this computer: │
│  ~/Documents/TinyDocy              [Change…]          │
│                                                      │
│  They're private until you choose "Share live".      │
│  It works offline. No account needed.                │
│                                                      │
│  [ Open the Playground ]     [ Start writing ]        │
│                                                      │
│  Have a link? Paste it to join a live document.       │
└──────────────────────────────────────────────────────┘
```
If the app was launched by a deep link, the welcome screen is skipped and the folder is shown in the join banner instead: "You joined a live document. Your copy is saved in ~/Documents/TinyDocy."

### 4.7 Updates

- The app checks on launch and every 24 h. Updates download in the background.
- When an update is ready, a non-modal notice appears in the status area: "TinyDocy 1.4 is ready. Restart to update." [Restart] [Later]. **Never restart automatically.** Restarting is blocked while a Live doc has unsynced changes and the device is online ("Waiting for changes to sync…"). Offline is fine, because local files are durable.
- When the server reports the client is outdated (row 7), the update check is forced and the notice gets the [Update and restart] button.
- **Linux:** AppImage can self-update. For `.deb`/`.rpm`, show "A new version is available. [Download]" instead of a restart button.
- On Windows the installer closes the app mid-install, so show "Restart to update" before installing ([Tauri updater guide, v1](https://v1.tauri.app/v1/guides/distribution/updater)).
- Settings: [x] Check for updates automatically.

### 4.8 About dialog

App name, version and build, sharing server URL, data folder ([Show]), License (MIT), Source code, Release notes (CHANGELOG), Third-party licenses, and **[Copy version info]** for bug reports. On macOS it lives in the app menu; on Windows and Linux, under Help > About.

### 4.9 Accessibility

**File tree:** implement the WAI-ARIA APG Tree View ([APG Tree View](https://www.w3.org/WAI/ARIA/apg/patterns/treeview/)).
- Roles: `tree` › `treeitem` (folders get `aria-expanded`; `aria-level`, `aria-setsize` and `aria-posinset` when virtualized), and `group` for children.
- Focus: roving tabindex, a single tab stop for the tree, and a visible focus ring.
- Keys:
  - ↓/↑ moves to the next or previous visible item.
  - → expands a closed folder, or moves to the first child of an open one.
  - ← collapses an open folder, or moves to the parent.
  - Home and End jump to the first or last item.
  - Type-ahead jumps to the next title starting with the typed characters.
  - `*` expands all siblings.
  - Enter opens the item.
  - F2 renames.
  - Shift+F10 or the Menu key opens the context menu.
  - ⌘⌫/Delete moves to Trash.
  - Shift+↑/↓ extends multi-select (`aria-multiselectable`).
- If a folder collapses while one of its children has focus, focus moves to the folder.
- **Drag alternatives:** every drag (move to folder, reorder tabs) has a menu path: Move to… and Move Tab Left/Right. This matches the existing dnd-kit keyboard sensors.
- **Region navigation:** F6/Shift+F6 cycles through the sidebar, tab bar, toolbar, editor, outline and status. Each region has an accessible name ("Files", "Open documents", "Formatting", "Document", "Outline").
- **Status:** never colour alone. The icon plus word chip, and the Paused/Ended dot, also change shape. One live region (the existing status pill) announces transitions such as "Sync paused" and "Back online, changes synced".
- **Dialogs:** focus goes to the first actionable control (Cancel, for destructive dialogs). Esc closes. Focus returns to the invoking control.
- **Scaling:** ⌘+/⌘- UI zoom from 50 % to 200 %, persisted. Layout breakpoints use CSS px after zoom, so the TOC overlay ladder kicks in correctly. Windows forced-colors (high contrast) is respected. Reduced motion is honoured.
- **Checklist per feature** (keyboard-only, gamepad N/A, minimum text size, no colour-only cues, no flashing, captions N/A, scaling at all supported resolutions): applies to the sidebar, list view, share dialog and popover, handoff page, Trash, Settings and first run.

---

## 5. Risks of confusing users, and how the UI prevents them

| # | Risk | Prevention |
|---|---|---|
| R1 | **"Close" means delete on web today.** Users carry that habit over, or a collaborator's close tombstones a Live doc for everyone. | On desktop, ⌘W only closes the tab. Delete is a separate action that goes to Trash with Undo. The shared-link web view has **no delete path at all**. Only the creator's manage key can stop sharing (§2.5). For consistency, consider relabelling the sandbox's close button tooltip to "Delete tab for everyone" (Decision 5). |
| R2 | **Two places a doc lives.** "Is this private? Did others see that?" | Local is the default, and the chip is always visible (icon plus word). Going Live requires the consent dialog, which names the server and the consequences. The Live smart list collects every shared doc. Duplicates are always Local. The rename hint warns that it applies to everyone. |
| R3 | **Link leakage with no auth.** | The dialog says "treat the link like a password". IDs carry at least 128 bits. The handoff page sends `no-referrer` and `noindex`. Live docs are **never** added to `global-tabs`. **Reset link** handles leaks. The 30-day idle expiry is stated. A self-hostable sharing server is available. We **don't** claim the URL fragment hides anything from the server, because the WebSocket sends the doc name (unlike Excalidraw's E2E key-in-fragment model: [Excalidraw E2EE](https://plus.excalidraw.com/blog/end-to-end-encryption)). E2E encryption could be a later option (Decision 9). |
| R4 | **Losing local docs** to uninstall, cache clearing or browser eviction. | Option B files live in Documents, which uninstallers don't touch. The location is shown at first run, in Settings and in Help ("Where are my documents?"). Export All is available. Trash keeps items 30 days. The web app doesn't pretend to be a library (Decision 3A), and its banner points to the desktop app for private docs. |
| R5 | **Server-side surprises:** 30-day expiry, size cap, tombstoned links, refusals. | Limits are stated in the consent dialog. The size gate runs before upload. Every error keeps the local copy editable and says so. "Sharing ended" offers Keep as Local or Share again (new link). The link-not-found page explains the possible reasons. |
| R6 | Opening a `.md` file and expecting in-place editing (the Typora/Obsidian habit). | A one-time import toast says "the original file isn't changed". Export back to Markdown is offered. Decision 7 covers whether to support in-place editing later. |
| R7 | Playground confusion: public on web, local on desktop. | On web it's labelled "Public sandbox"; on desktop it's a local sample. It never appears in the Live list. |
| R8 | **Wipe or defacement of a Live doc.** Anyone with the link can delete everything, and that syncs into every copy, including the creator's file. There is no version history. | The consent dialog says "anyone with the link can edit", and that includes deleting. Recommended: the app keeps **local snapshots** inside the `.tinydocy` file (for example, on open, hourly while edited, and before applying a large remote deletion), with File > Restore Previous Version… (Decision 10). A large remote deletion also gets a toast: "A collaborator removed most of "Q4 plan". [Restore my last version]". Restoring is a new edit that syncs to everyone. |
| R9 | Placeholder files in iCloud- or OneDrive-managed Documents don't open offline. | First-run detection offers a local-only folder. The "Not here" state (row 15) has a Download action. |

---

## 6. Owner decisions (pick one per line; recommended marked)

1. **Where documents live:** A app library · **B `~/Documents/TinyDocy` with `.tinydocy` files (Recommended)** · C Markdown in place.
2. **File manager shape:** A sidebar tree · B library home · **C hybrid tree plus list views (Recommended)**.
3. **Web app scope in v1:** **A sandbox plus a shared-link view, no web library (Recommended)** · B browser-storage library · C File System Access API.
4. **Who can stop sharing:** **A creator's manage key (Recommended)** · B anyone with the link · C nobody (expiry only).
5. **Sandbox close semantics on web:** keep "close deletes" but relabel it "Delete tab for everyone" **(Recommended)** · change it to a soft close.
6. **Show the doc title on the handoff page:** **Yes (Recommended; the link already grants edit)** · No (generic "a live document").
7. **Opening `.md` from disk:** **import as a new doc (Recommended for v1)** · edit in place (later, lossy).
8. **Shortcut collisions:** **Duplicate without a shortcut; Playground regenerate moves off ⌘⇧R (Recommended)** · remap strikethrough.
9. **End-to-end encryption for Live docs:** **later (Recommended)** · v1 (key in the fragment, the server can't read content, but no server-side size or schema checks on content).
10. **Local snapshots of Live docs** (protection against wipes): **v1, with automatic snapshots and Restore Previous Version (Recommended)** · later · none.
11. **Default library folder when Documents is cloud-managed:** **offer `~/TinyDocy` at first run (Recommended)** · always `~/Documents/TinyDocy` · always `~/TinyDocy`.

---

## 7. Sources

- AFFiNE workspaces (local vs cloud): https://docs.affine.pro/core-concepts/elements-of-affine/workspaces
- Obsidian File explorer (Reveal in Finder / Show in system explorer): https://obsidian.md/help/plugins/file-explorer
- Typora File Management (files sidebar, folder tree): https://support.typora.io/File-Management/
- iA Writer Library navigation: https://ia.net/writer/support/library/navigation ; tree view: https://ia.net/topics/faster-filing-with-tree-view-a-step-forward-for-large-writing-projects
- Notion sidebar (Favorites appear after the first one, Private and Shared sections, Trash 30 days, search ⌘K): https://www.notion.com/help/navigate-with-the-sidebar
- Craft External Locations (local docs lose collaboration; reliability depends on the provider): https://support.craft.do/hc/en-us/articles/6696361366813-External-Locations
- Apple Notes Recently Deleted (30 days): https://support.apple.com/kb/PH21257
- Google Docs offline and save-status indicator: https://support.google.com/docs/answer/6388102 ; https://workspaceupdates.googleblog.com/2020/06/new-save-status-online-offline-google-docs.html
- Figma local copies (.fig, no version history): https://help.figma.com/hc/en-us/articles/8403626871063
- Excalidraw end-to-end encryption (key in the URL fragment): https://plus.excalidraw.com/blog/end-to-end-encryption ; https://en.wikipedia.org/wiki/Excalidraw
- Logseq data-location and data-loss threads (anecdotal): https://discuss.logseq.com/t/lost-entire-graph-after-clearing-cache/34822 ; https://discuss.logseq.com/t/how-the-files-are-stored-data-loss/8195
- W3C TAG, Good Practices for Capability URLs: https://www.w3.org/2001/tag/doc/capability-urls
- W3C Referrer Policy: https://www.w3.org/TR/referrer-policy/
- Microsoft, custom protocol with web fallback: https://devblogs.microsoft.com/oldnewthing/20230308-04/?p=107915
- Tauri deep linking (single instance, macOS config-only registration): https://v2.tauri.app/plugin/deep-linking/
- Tauri updater (v1 docs; restart prompt): https://v1.tauri.app/v1/guides/distribution/updater
- Electron Recent Documents (Dock, Jump List, file association needed): https://electronjs.org/docs/latest/tutorial/recent-documents
- Apple HIG, The menu bar (File menu items, Duplicate vs Save As): https://developer.apple.com/design/human-interface-guidelines/the-menu-bar
- WAI-ARIA APG Tree View: https://www.w3.org/WAI/ARIA/apg/patterns/treeview/

Not confirmed by research, so not relied on: what Excalidraw's "Stop session" does to the drawing, and Bear's trash retention.
