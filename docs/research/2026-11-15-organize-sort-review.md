> **Superseded in part.** Some of this study's advice was changed by the staff feasibility review. See [the details spec §11](../superpowers/specs/2026-11-15-desktop-documents-and-editor-details.md) before building from it.

# TinyDocy Desktop: organizing, sorting and review

- **Status:** Research and design proposal for owner review (2026-11-15). Nothing is built.
- **Brief (owner):** "The app must let users organize and sort and also review; the devil is in the details — no microwave implementation."
- **Builds on:**
  - [Plan v4](../superpowers/specs/2026-11-15-desktop-local-first-design.md): §5.1 layout, §5.3 file operations, §5.5 states, §8 PRs, §15 deferred
  - [Architecture](../superpowers/specs/2026-11-15-desktop-architecture.md): §5.3 tables, D-A3 one window per document, D-A8 title-only search
  - [Desktop UX spec](../superpowers/specs/2026-11-15-desktop-ux-design.md): §4 navigation and keyboard map, §5 states and copy, §6 feedback, §8 accessibility, §9 vocabulary
  - [File manager and sharing UX research](2026-11-15-desktop-file-manager-and-sharing-ux.md)
- **Parallel work:** tags and document properties are designed in `docs/research/2026-11-15-title-tags-page-preferences.md` (in progress when this was written). This document uses **tag** only as a filter and grouping dimension. It does not design the tag UI or decide where tags are stored.
- **Not re-decided here:** the plan v4 sidebar order, the click model (UX spec Q3), Quick Open, Trash copy, the daily-snapshot dialog. This document adds detail on top of them and flags the few places where it suggests a change (§9).
- **Marking:** "(unverified)" means I didn't confirm it against a primary source or the code during this pass.

---

## 0. Summary of recommendations

| Area | Local release | Live release | Later ("Review release" and beyond) |
|---|---|---|---|
| **Folders** | Nesting up to 4 levels below Library. Create, rename, move, and trash with contents as one undoable unit. Drag and drop with spring-loading. Multi-select drag. Move to… dialog. | — | Pinned folders. Option/Alt-drag to duplicate. |
| **Pinned** | Documents only, in manual order | — | Folders |
| **Order** | A sort setting per folder. **Manual** is one of the sort options, stored as a fractional `sort_key`. The tree defaults to **Title**, which keeps rows still while you type. | — | — |
| **Sort keys** | Manual, Title, Modified, Created, Last opened, Size | + "Changed by others" | — |
| **Views** | List and Preview (two-line snippet). Group by Date or Folder. A filter bar: title, date, folder scope. | + Status filter (Local / Live / Paused / Ended), group by Status | Saved searches (smart folders), full-text search with operators, tag filters once tags ship |
| **Smart lists** | Recent, Pinned, Trash (fixed) | + Live | User-made smart folders |
| **Reading** | Reading mode: read-only, chrome hidden, outline available | — | — |
| **Your own review** | — (Local documents change only when you change them) | "Updated" marker on live documents changed by others. **Show changes since you last opened**: insertions highlighted, deletions marked by position only. | Who changed what (names), through `Y.PermanentUserData` |
| **Versions** | Daily-snapshot restore (already planned). **Stretch:** "Show changes" in that dialog. | Version history (P4.0 table), compare with current or previous, restore a section, restore all | Branches and drafts (Patchwork/Upwelling-style) |
| **Comments** | — | — (see Q2) | Threads anchored with `Y.RelativePosition`, stored in the Y.Doc, replies, resolve and reopen, a margin rail beside the margin outline, **suggested replacement** in a comment (GitHub-style) |
| **Suggestion mode** | — | — | Only after a spike. It is the costliest item here. |
| **Mentions** | — | — | No. Without accounts there is no one to notify (§5.2). |

**Where data lives.** The rule: *organization is the reader's, review content is the document's.*
- Folders, order, pins, sort, view, filters, read state and "last seen" state are **local SQLite only**. The library is never shared; only single documents are.
- Comments are **inside the Y.Doc**, so collaborators, versions and `.tinydoc` backups carry them.

---

## 1. Prior art: what we take and what we leave

| Product | What it does | Take | Leave |
|---|---|---|---|
| **Finder** | Per-folder view options with "Use as Defaults". List, icon, column and gallery views. Group by date with relative buckets. Spring-loaded folders, where Space opens the folder immediately. Option-drag copies. ([Apple: folder views](https://support.apple.com/guide/mac-help/mchldaafb302), [spring-loading](https://eshop.macsales.com/blog/88761-how-to-use-spring-loaded-folders-in-macos/)) | Per-folder sort, spring-loading with the Space shortcut, relative date buckets, folders kept on top | Four views. Two are enough for documents. |
| **Windows File Explorer** | Group-by-date buckets: Today, Yesterday, Earlier this week, Last week, Earlier this month, Last month, Earlier this year, A long time ago. They can't be customized, and users complain that "Last week" swallows days. ([MS Q&A](https://learn.microsoft.com/en-us/answers/questions/5853207/windows-file-explorer-group-by-date-modified), [complaint](https://www.elevenforum.com/t/how-do-you-get-rid-of-this-organizational-behavior-in-file-explorer.14834/latest)) | Relative buckets | "A long time ago". We use month and year names instead. |
| **Apple Notes** | Folders and nested folders. Tags. **Smart Folders** are references, not storage, and need at least one tag. A note with an unseen change shows a dot in the list. A shared note offers **Show Highlights** (who changed what, with dates) and **Show Updates** (changes since you last opened it). ([Smart Folders](https://support.apple.com/guide/notes/apd58edc7964/mac), [collaborate](https://support.apple.com/en-au/guide/notes/apd4e6e2c9a6/4.13/mac/27), [Six Colors](https://sixcolors.com/post/2026/03/how-to-view-edits-in-notes/)) | The unseen-change dot. "Since you last opened" as the default review lens. Smart folders as *references*. | Smart folders in v1. Without tags and full text they would be thin (§2.10). |
| **Bear** | Notes sorted by modification date by default. Sort is global, and users keep asking for per-tag sort. Pinning is global or per tag. ([pinning FAQ](https://bear.app/faq/pin-notes-and-tags/), [per-tag sort requests](https://community.bear.app/t/different-sorting-method-for-each-tag-not-just-a-global-one/18138)) | Evidence that sort must be **per place**, not global | — |
| **Obsidian** | The file explorer has no built-in manual order; several community plugins exist only to add it. Bookmarks can be reordered. Search operators include `file:`, `path:` and `tag:`. ([Search](https://obsidian.md/help/plugins/search), [Manual Sorting plugin](https://community.obsidian.md/plugins/manual-sorting)) | Evidence that manual order is wanted. Operator syntax for later full-text search. | — |
| **Notion** | Each view has its own sorts, filters and groups. Filters nest with AND/OR. You can save a filter for everyone or keep it for yourself. Comments can be resolved and reopened from a Resolved filter. ([views](https://www.notion.com/help/views-filters-and-sorts), [comments](https://www.notion.com/help/comments-mentions-and-reminders)) | Per-view settings. "Only for me" vs shared → for us everything is "only for me". | Nested AND/OR filter builders. Too heavy for a document library. |
| **Craft** | Manual sidebar order by drag. A forum thread suggests there are no auto-sort options (anecdotal, unverified). ([MPU thread](https://talk.macpowerusers.com/t/craft-question-sidebar-sort-order/26206)) | Manual order as a real mode | Manual as the *only* mode |
| **Google Drive** | Sort by Last modified, Last modified by me, Last opened by me. Never-opened files have no "last opened" date and sort to the bottom. ([Drive help](https://support.google.com/docs/answer/2375177), [TidBITS: sorting can hide new documents](https://tidbits.com/2020/02/28/tipbits-google-drive-sorting-can-hide-new-documents/)) | "Last opened" as a sort. A rule for empty dates (§2.1). | — |
| **Google Docs** | Comments: reply, resolve, reopen. **Suggesting** mode, with accept or reject one at a time or all. Version history highlights changes against the *previous* version only, coloured by editor. "Show editors" on a selection. ([suggest edits](https://support.google.com/docs/answer/6033474?hl=en), [Show editors](https://workspaceupdates.googleblog.com/2021/05/view-more-context-on-google-docs-edits-with-show-editors.html)) | Resolve/reopen. The version list beside a preview. | Comparing only adjacent versions. We compare any version with the current one. |
| **Word** | Display for Review: Simple Markup (a bar in the margin), All Markup, No Markup, Original. Hiding markup resolves nothing. ([Microsoft](https://support.office.com/en-us/article/Track-changes-in-Word-197BA630-0F5F-4A8E-9A77-3712475E806A)) | **Simple Markup**: a margin bar is the quietest way to say "changed here" | Four display modes |
| **Figma** | Comments: sort by unread, a "Show resolved" toggle, "Only your threads", Shift+C to hide comments, undo a resolve by unticking it. ([Figma help](https://help.figma.com/hc/en-us/articles/360041547593)) | The unread-first sort, the resolved toggle, a hide-all key | "Only your threads". It needs identity. |
| **GitHub PR review** | Mark a file **Viewed**. A "Changed since last view" badge appears when it changes after that. Pending comments are submitted as one batch. Suggested changes inside comments. ([Mark files as viewed](https://github.blog/news-insights/product-news/mark-files-as-viewed/), [reviewing](https://docs.github.com/en/enterprise-server@3.13/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/reviewing-proposed-changes-in-a-pull-request)) | "Changed since you last looked" as state. **Suggested replacement in a comment** as the cheap route to suggestion mode. | Batch review submission. Docs comments post at once. |
| **Dropbox Paper** | Doc history lists only edits that are older than 30 minutes and change more than 500 characters. Only editors can reopen resolved comments. ([Dropbox](https://help.dropbox.com/delete-restore/track-restore-changes-comments)) | Thresholds for *automatic* versions | Hiding small edits from history entirely |
| **Ink & Switch Patchwork / Upwelling** | Version control for prose: lightweight branches ("drafts"), diff visualization, history shown as a timeline you can talk to. ([Patchwork notebook](https://www.inkandswitch.com/patchwork/notebook/), [Writing prose](https://www.inkandswitch.com/patchwork/notebook/02), [Upwelling](https://inkandswitch.com/upwelling/)) | Diffs that read as prose (word-level within blocks, not raw ops). History as something you *read*. | Branches. A later direction (§5.4). |

**Editor-library facts that decide review scope**
- **Tiptap Comments, Tracked Changes and Snapshot Compare are paid.** Tracked Changes is labelled experimental, below 1.0. Snapshot Compare needs `TiptapCollabProvider` plus the paid Version History extension. ([Comments](https://tiptap.dev/docs/comments/getting-started/overview), [Tracked Changes](https://tiptap.dev/docs/tracked-changes/getting-started/install), [Snapshot Compare](https://tiptap.dev/docs/editor/extensions/functionality/snapshot-compare), [pricing](https://tiptap.dev/pricing), [Pro license](https://tiptap.dev/docs/pro-license))
  - Whether Comments works with a self-hosted Hocuspocus and no Tiptap Cloud is **(unverified)**. The docs pair it with Tiptap's collaboration platform.
  - **Conclusion:** buy-in is a recurring cost plus a private registry, which clashes with the supply-chain rules (plan §7, `minimumReleaseAge`). Build on open primitives.
- **Open alternatives:**
  - BlockNote stores threads in a `Y.Map("threads")` plus a `comment` mark ([BlockNote comments](https://www.blocknotejs.org/docs/features/collaboration/comments)). Its licence for this module is **(unverified)**. An early PR noted that Yjs handles overlapping marks badly ([PR #1376](https://github2.scsujunhua.workers.dev/TypeCellOS/BlockNote/pull/1376)).
  - `@handlewithcare/prosemirror-suggest-changes` does Google Docs-style suggestions with schema marks. Its licence is (unverified), and BlockNote reports an ID-related Yjs bug ([README](https://cdn.jsdelivr.net/npm/@handlewithcare/prosemirror-suggest-changes@0.1.8/README.md)). `tiptap-track-changes` is a community MIT package ([pkgstats](https://www.pkgstats.com/pkg:tiptap-track-changes)).
- **Yjs** gives us `Y.createRelativePositionFromTypeIndex` and `Y.createAbsolutePositionFromRelativePosition`, with an `assoc` argument and encoding to bytes or JSON ([Yjs docs](https://docs.yjs.dev/api/relative-positions)). y-prosemirror wraps these for ProseMirror positions. That `@tiptap/y-tiptap` exports the same helpers is **(unverified)**.
- **y-prosemirror snapshot diffs** (`renderSnapshot(snapshot, prevSnapshot)`) need `gc: false` and the experimental `PermanentUserData`. Users report deletions going missing after a reload ([Yjs forum](https://discuss.yjs.dev/t/issue-related-to-rendering-snapshot-version-changes-from-database/2232), [GC thread](https://discuss.yjs.dev/t/gc-is-off-but-still-losing-delection-history/2704)). We don't build version compare on it (§5.3).
- **Fractional indexing** orders items with no renumbering, the way Figma and Linear do ([Figma](https://www.figma.com/blog/realtime-editing-of-ordered-sequences/), [`fractional-indexing`](https://cdn.jsdelivr.net/npm/fractional-indexing@3.2.0/README.md)).

---

## 2. Organize

### 2.1 Places and what each one can hold

| Place | Holds | Can you drop into it? | Sort options | Default sort |
|---|---|---|---|---|
| **Library** (root) and **folders** | documents, folders | yes | Manual, Title, Modified, Created, Last opened, Size | **Title, A→Z** (see "Why Title" below) |
| **Recent** | the 50 most recently opened documents (the sidebar shows 5) | no | Last opened (fixed) | Last opened, newest first |
| **Pinned** | pinned documents | yes (drop = pin) | Manual (fixed) | Manual |
| **Live** (Live release) | documents you shared or joined | no | Modified, Title, Changed by others, Status | Changed by others, newest first |
| **Trash** | trashed documents and folders | yes (drop = Move to Trash) | Date trashed, Title | Date trashed, newest first |
| **Search results** (filter bar, Quick Open) | — | no | relevance, then Last opened | relevance |

**Why Title, not Modified, in the tree.** UX principle 4 says nothing changes layout on its own.
- `modified_at` updates on every append batch, every 250 ms to 1 s while you type. A Modified-sorted tree would move the row you're working in.
- Bear and Notes get away with it because their list is a separate pane, not your map.
- If the owner picks Modified anyway, the coalescing rule in §3.6 applies.

**Missing dates.** A document never opened on this computer (an import, or the result of a restore) has no `opened_at`.
- It sorts **after** dated rows in both directions, so it can't hide at the top or bottom of a long list (the Drive trap).
- It shows "—" in the column, with the tooltip "Not opened yet".

### 2.2 Folders

| Rule | Value | Why |
|---|---|---|
| **Maximum depth** | 4 folder levels below Library | At 240 px with 12 px of indent per level, level 4 still leaves about 150 px for a title. Deeper trees fail type-ahead and screen-reader orientation (`aria-level` beyond 4 is hard to hold in your head). Apple Notes and Bear users rarely go past 3 (unverified). |
| **Folder names** | 1–100 characters. Unique per parent after case folding and NFC. Leading and trailing spaces trimmed. `/` allowed (the name isn't a path). | Two folders called "Drafts" side by side are a usability bug. Documents may share titles, because titles come from the first heading. |
| **New Folder** | ⌘⇧N. Created inside the selected folder, or beside the selected document, as "New Folder" ("New Folder 2", …), already in inline rename. | Finder |
| **New folder at the depth limit** | The menu item is disabled. Its tooltip says "Folders can be nested 4 levels deep." | The rule says why |
| **Rename** | F2 or a slow double-click (macOS). Enter commits, Esc cancels, Tab commits and moves to the next row (UX spec §4.6). | — |
| **Empty name** | Inline: "Enter a name." The field keeps focus. | UX spec §6.1 |
| **Duplicate name** | Inline: "There's already a folder called “Drafts” here." | — |
| **Move** | Drag, Move to… (⌘⇧M, scoped), or Cut/Paste? **No.** Cut/paste of rows is a Windows-only habit and adds a hidden clipboard state. | Fewer states |
| **Move into itself or a descendant** | Refused while dragging (no-drop cursor, no highlight). In Move to…, those rows are disabled with the tooltip "Can't move a folder into itself." | — |
| **Move past the depth limit** | Refused. The pill says "“Projects” has 3 levels of folders inside, so it can't go there. Folders can be nested 4 levels deep." | Names the reason and the rule |
| **Move to Trash (folder)** | The folder, all its subfolders and all their documents go to Trash **as one unit** (a `trash_group`). Pill: "Moved “Drafts” and 12 documents to Trash. [Undo]" (UX spec §5.4). | Restoring later restores the unit, not 13 loose items |
| **Trash shows** | One row for the folder: a folder icon, "Drafts", and "12 documents" in the Kind column. Opening it lists its contents read-only. Restore or Delete Forever act on the whole unit. | Finder's Trash shows folders as folders |
| **Restore a folder** | Back to its old parent. If the parent is gone or trashed: to Library, and the pill says "Restored “Drafts” to Library. Its folder “Projects” is in Trash." | — |
| **Restore one document out of a trashed folder** | Allowed from the folder's read-only view. It goes to the nearest parent that still exists, otherwise Library. Pill: "Restored “Q4 plan” to Library." | — |
| **Trash a folder that holds a live document** (Live release) | One sheet before trashing: "“Drafts” contains 2 live documents. Also stop sharing them for everyone? [Keep links running] [Stop sharing]". Default and focus: Keep links running (it is reversible). | Plan §5.3 extended to folders |
| **Delete Forever (folder)** | Sheet: "**Delete “Drafts” and 12 documents forever?** This can't be undone. Their readable backup files are also removed. [Cancel] [Delete Forever]". Cancel has focus. | UX spec §5.4 |
| **Empty folder** | Kept. Folders are never removed automatically. | — |
| **Folder colours and icons** | **No** in the Local release. | Colour alone carries no meaning for colour-blind users or under forced colours. A chosen icon becomes a set of "faces" to manage (owner rule: fixed faces). Visual style belongs to art-director. Revisit after tags ship: tag colour is the better home for colour. |

### 2.3 Drag and drop

**Sources.** Tree rows, list rows, Pinned rows, a multi-selection, and files from the OS. Import of OS files is already in UX spec §5.4.

**Drop targets and results**

| Target | Result | Feedback while hovering |
|---|---|---|
| A folder row (tree or list) | Move into that folder | Row filled with the accent, 2 px outline. Cursor: move. |
| The gap between two rows, in a folder sorted **Manual** | Reorder (and move, if it's a different parent) | 2 px insertion line, indented to the target depth. Horizontal pointer position picks the depth (VS Code, Notion). |
| The gap between rows, in a folder **not** sorted Manual | Treated as "into the parent folder"; no insertion line | Parent folder highlighted. The first time per install, the pill says: "“Drafts” is sorted by Title. To arrange by hand, choose View › Sort By › Manual." |
| The **Library** header | Move to the root | Header highlighted |
| **Pinned** header or Pinned list | Pin (the document stays in its folder) | "Pin" badge on the drag ghost. A folder in the selection makes it a no-drop, because folders can't be pinned in v1. |
| **Trash** row | Move to Trash, with the usual pill and Undo | Trash row highlighted. No confirmation, since it can be undone. |
| **Recent**, **Live**, **Playground**, a search result list | Refused | No-drop cursor |
| The **tab bar** | Open in a new tab at that position | Insertion line between tabs |
| Another app or the desktop | **Nothing** in v1 (no drag-out export) | No-drop cursor outside the window. Electron `startDrag` needs a real file path; later it could use the backup file (unverified). |

**Mechanics**
- **Drag threshold:** 4 px, so a click with a slight tremor is not a drag.
- **Spring-loading:** hovering a collapsed folder for **700 ms** expands it in the tree, or navigates the list view into it. **Space** while hovering expands at once (Finder). On drop or cancel:
  - folders that were spring-opened collapse again
  - a folder that receives the drop stays open
- **Auto-scroll:** within 32 px of the top or bottom edge, speed proportional to depth into the zone, capped at 20 rows per second.
- **Cancel:** Esc, or dropping on an invalid target. The ghost animates back (0 ms under reduced motion), and nothing changes.
- **Multi-select drag:** the ghost shows the first title plus "and 2 more" (text, not a count badge). Moving a mixed selection keeps relative order. If the selection contains a folder and its own child, the child is dropped from the selection silently (it moves with its folder anyway).
- **Partial refusal:** if some items can't go (depth, or a folder into itself), **nothing moves**. Pill: "Couldn't move 3 items: “Projects” would be nested too deeply." All-or-nothing keeps Undo honest.
- **Live documents:** moving them is purely local. Nothing is sent to the server.
- **Undo:** one app-level undo entry per drop (UX spec §6.2). Pill: "Moved 3 documents to “Team”. [Undo]".
- **Implementation note for ui-programmer:** `@dnd-kit` is already used by the outline (`package.json`), and its keyboard sensor exists. OS file drops need native HTML5 DnD, so the app needs both paths. The design doesn't depend on which library.

**Accessible alternatives** (WCAG 2.5.7, Dragging Movements, AA: [W3C](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements))

| Drag action | Single-pointer or keyboard alternative |
|---|---|
| Move into a folder | Move to… (context menu, Document menu, ⌘⇧M scoped) |
| Reorder in Manual | Context menu Move Up / Move Down. Keys: ⌥⌘↑ / ⌥⌘↓ (Win/Linux Alt+Shift+↑ / ↓), scoped to tree and list. |
| Pin | Pin / Unpin (context menu) |
| Trash | Move to Trash (⌘⌫ / Delete) |
| Open in a tab | ⌘Enter |

Each keyboard move announces its result: "Q4 plan moved to position 3 of 8 in Drafts."

### 2.4 Pinned

- **Documents only** in the Local release. Pinning a folder ("favorite folder") comes later, because then Pinned becomes a second tree.
- **Order:** manual, with its own `pin_key` (fractional), so pinned order is independent of folder order.
- **The Pinned section** appears after the first pin (plan §5.1).
  - **Unpinning the last item:** the section disappears **only after focus leaves the sidebar**. If it vanished under the keyboard user's focus, they would lose their place, and it would be a layout change while they act.
- **Pinned documents stay in their folder** in the tree, with no extra icon (Bear marks them; we don't, since the face stays fixed). The context menu shows Pin or Unpin.
- **Trashing a pinned document** unpins it. Restoring it **re-pins** it at its old position, since `pin_key` is kept while it is in Trash.
- **Cap:** none enforced. Past 15 pins the sidebar section scrolls internally with a max height of 8 rows (unverified number, design review).

### 2.5 Manual order vs sorted order

- **Sort is a setting of the place:** `folders.sort_by` and `sort_dir`; Library root and smart lists in `view_prefs` (§7).
- **Manual** is one value of `sort_by`. Every document and folder always carries a `sort_key`, so switching to Manual never shows a random order:
  - new items get a key **after the last item** (append)
  - the **first switch to Manual** freezes the current visible order into keys, so switching from Title to Manual shows exactly the same order
- **Keys:** fractional-index strings (base-62). Ties are broken by `id`.
  - Rebalancing runs only if a key exceeds 64 characters, and then in one worker transaction.
  - Keys are **local**. Two collaborators never see each other's order, because the library is never shared.
- **Folders on top:** always, in every sort, the Finder default. Not a setting in v1.
- **Mixed order** ("documents between folders") isn't offered, even in Manual. Folders stay first. That keeps type-ahead and APG "first child" predictable.

### 2.6 Duplicate

- ⌘D (UX spec §4.6). The copy goes **directly after the original** in Manual order, and to its sort position otherwise.
- **Title:** "Q4 plan copy", then "Q4 plan copy 2", and so on (Finder). The duplicate's first heading changes too, since the title *is* the first heading.
- **Identity:** new `id`, **new lineage**. A duplicate isn't the same document (plan §14: same-lineage copies never merge).
- **Live documents:** the copy is **Local**, never shared. Pill: "Duplicated as “Q4 plan copy”. The copy is Local. [Open]".
- **Comments** (once they exist): a duplicate **leaves comments out** by default. Google Docs asks with a checkbox on "Make a copy" (unverified detail). Owner question Q5.
- **Duplicate a folder:** later. In the Local release the menu item is disabled for folders, with the tooltip "Duplicate works on documents."

### 2.7 Move to… dialog

```text
┌ Move “Q4 plan” ──────────────────────────────────────────┐
│ ⌕ Filter folders                                          │
│ ─────────────────────────────────────────────────────────│
│ Recent destinations                                       │
│   Team › Planning                                         │
│   Drafts                                                  │
│ ─────────────────────────────────────────────────────────│
│ ▾ Library                                                 │
│   ▸ Archive                                               │
│   ▾ Drafts                         (current folder)       │  ← disabled
│   ▾ Team                                                  │
│       Planning                                            │
│       Retros                                              │
│                                                           │
│ [New Folder]                          [Cancel]  [Move]    │
└───────────────────────────────────────────────────────────┘
```

- **Tree:** APG tree with type-ahead. The filter field matches folder names and shows ancestors so the path stays readable.
- **Recent destinations:** up to 3, stored locally.
- **Disabled rows:**
  - the current folder (and, for folder moves, the folder itself and its descendants)
  - folders that would break the depth limit
  - each with the reason in a tooltip and `aria-disabled` plus `aria-description`
- **New Folder** creates the folder inside the highlighted folder, in inline rename, and selects it.
- **Primary button:** **[Move]** (verb repeats the title). Disabled until a valid folder is selected. Enter activates it.
- **Several items:** the title reads "Move 3 items".

### 2.8 Smart lists (in the sidebar)

- **Recent, Pinned, Live (Live release), Trash.** Fixed. They can't be renamed or deleted.
- **User-made saved searches or smart folders: not in v1.** Recommendation, with reasoning:
  - They are only as good as the predicates. With title-only search (D-A8) and no tags yet, a "smart folder" means "title contains X" plus a date range. That is a weak promise for a whole new sidebar section, with its own management UI.
  - Apple Notes requires at least one tag for a smart folder, which shows the dependency.
  - **Ship later, together:** tags, full-text search, then saved searches, using the same filter model (§3.4), so a saved search is just a stored filter.

### 2.9 Multi-select

- **Tree and list:** click, ⌘-click to toggle, Shift-click for a range, Shift+↑↓ to extend, ⌘A selects all in the folder (UX spec §4.6).
- **Bulk actions on a selection:** Move to…, Pin (documents only), Move to Trash, Export ▸ (as separate files). Rename is disabled when more than one item is selected.
- **Selection survives** re-sorting and live index updates, because it is held by `id`, not by row index.
- **Focus and selection after a bulk trash:** the row after the last removed one.
- **Already a tripwire cut** (plan §8.2): if Gate 2 slips, bulk actions in list views go first. Single-item actions still pass the keyboard checklist.

### 2.10 Renaming a document from the sidebar (an engineering consequence)

A document's title is its first heading, **inside the Y.Doc**. Renaming a document that **isn't open** is therefore a content write, and D-A3 lets main write content only to closed documents, through the worker, **which doesn't parse Yjs**.

**Proposal:** inline rename of a closed document
1. claims it through the registry for the list's window
2. loads it into a headless `local-session` in the renderer
3. replaces the title heading's text in one transaction (origin `rename`)
4. flushes and releases it

The rename UI shows the new name optimistically. If the claim fails because the document is open in another window, that window's editor applies the rename instead, through a menu intent.

This needs **SE review in P2.7**. It is not a UX choice, but the UX depends on it being invisible.

---

## 3. Sort, filter, group and view

### 3.1 Sort keys

| Key | Column label | Source | Direction default | Notes |
|---|---|---|---|---|
| Manual | — | `sort_key` | — | Folders, Library and Pinned only |
| Title | Title | `title` | A→Z | `Intl.Collator(locale, { numeric: true, sensitivity: "base" })`, so "Plan 2" < "Plan 10". "Untitled" sorts as an empty title, last. |
| Modified | Modified | `modified_at` | newest first | Any change, including from collaborators (Live) |
| Created | Created | `created_at` | newest first | Imports keep the file's date if the format carries one (unverified per format); otherwise the import time |
| Last opened | Last opened | `opened_at` | newest first | Updated when the document becomes the active tab for at least 2 s, so tabbing past it doesn't count |
| Size | Size | `size_bytes` (new, §7) | largest first | Pays off with the "very large document" pill and the share size pre-check |
| Changed by others (Live) | Changed by others | `changed_by_others_at` (new) | newest first | — |
| Status (Live) | Status | sync state | Live, Paused, Offline, Ended, Local | — |

**Controls**
- Click a column header to sort. Clicking again reverses. `aria-sort` on the header button.
- A **Sort ▾** button in the list toolbar for Preview view, which has no columns, with the same keys plus "Ascending / Descending" radio items.
- **View › Sort By ▸** in the menu bar, the same list. There are no shortcuts: it is used rarely, and the ⌘1–9 range is taken by tabs (UX spec §4.6).

### 3.2 Persistence

| Place | Stored in | Scope |
|---|---|---|
| A folder | `folders.sort_by`, `sort_dir`, `view`, `group_by` | That folder only. Subfolders don't inherit. New folders take the **default from Settings**. |
| Library root, Recent, Pinned, Live, Trash | `view_prefs(place)` | — |
| Default for new folders | Settings › Library: "New folders sort by [Title ▾]" | Finder's "Use as Defaults", made explicit and visible |
| Filter bar contents | **not persisted**. Filters reset when you leave the place. | A hidden filter that survives a restart produces "where did my documents go?" reports. Only the *open/closed* state of the filter bar is remembered, per window. |

- Sort and view are **local only**. They are never written into a Y.Doc, a `.tinydoc` or the Markdown backup.
- They are included in **Export all**, so a move to a new computer keeps the folder setup (unverified that Export all carries folder metadata today; plan §5.2 says documents only). Flag for P2.8.

### 3.3 Views

**List (default)**
- Columns: Title · Modified · Folder (in smart lists and search only) · Status (Live release) · Size (hidden by default).
- Columns can be shown or hidden from the header's context menu. Widths can be resized and are remembered per place.
- Row height 28 px on macOS and 32 px on Windows and Linux (platform density, UX spec §2.2).

**Preview**
- Each row: title (one line), then a snippet (two lines, muted), then a meta line ("Modified 14:02 · Drafts").
- Fixed height: 72 px at 100% zoom.
- **Snippet source:** the renderer already sends the title with each append (architecture §5.1). It also sends `snippet`: the first 200 characters of body text after the title, whitespace collapsed, **computed only on blur, hide and close**, not on every batch.
  - No snippet yet (an import that was never opened): the snippet is generated at import from the same text. For documents migrated from older builds: "No preview yet".
  - Snippets are plain text and never render markup.
  - Snippets of **live** documents include collaborators' text. They are local data, like the backups.

**Compact**
- **Not a third view.** The sidebar tree *is* the compact view. A third list density would be a setting few people use, at the cost of another state in every screenshot review.

**No gallery or grid.** Documents have no thumbnails, and rendering them would mean mounting editors.

### 3.4 Filter bar

- **Opening it:** ⌘F when a **list view** has focus, or the funnel button in the list toolbar. ⌘F in the editor stays the Find bar (C7). One key, contextual, as in Finder and Notes.
- **Closing it:** Esc clears the text first, then closes the bar. Closing clears every filter.

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ ⌕ Filter by title…        [Modified: Any ▾] [In: This folder ▾] [Tags ▾] │
└──────────────────────────────────────────────────────────────────────────┘
```

| Control | Values | Release |
|---|---|---|
| Title text | substring and word-prefix, accent-folding, the same matcher as Quick Open (UX spec §4.3) | Local |
| Date | Any · Today · Last 7 days · Last 30 days · This year · Custom range… (two date fields). It applies to the *current sort's* date field (Modified, Created or Last opened). The label names the field. | Local |
| Scope | This folder · This folder and subfolders · Whole library | Local |
| Status | Any · Local · Live · Paused · Ended | Live |
| Tags | Defined by the tags design (`2026-11-15-title-tags-page-preferences.md`). Expected: any-of and all-of, a tag picker, and an "Untagged" option. | When tags ship |

- **Combining:** AND only, across chips. No nested AND/OR (§1, Notion).
- **The face rule:** a chip's face shows the field and the value ("Modified: Last 7 days"). That is a fixed label for a chosen value, which the fixed-face rule allows, because the label shows the outcome. When a filter is active, the chip uses the pressed style plus a × button **beside** it (never nested inside the chip button).
- **Result line**, under the bar: "12 of 214 documents". It is updated through `announce()` at most once per second while typing.

**Title search vs future full-text search**
- Local release: titles only, the same as Quick Open (D-A8). The filter field's placeholder says so: "Filter by title…".
- Later, when FTS5 and a text walker arrive (plan §15 alludes to them):
  - the placeholder becomes "Filter…"
  - matches in body text show a highlighted fragment in Preview view
  - operators follow Obsidian: `tag:`, `in:` (folder), `is:live`, `is:pinned`, `before:` and `after:`

### 3.5 Group by

| Group by | Buckets | Available in |
|---|---|---|
| None | — | everywhere |
| Date (follows the sort's date field) | Today · Yesterday · Previous 7 Days · Previous 30 Days · then month names for the current year ("October") · then years ("2025") | everywhere a date sort applies |
| Folder | folder path ("Team › Planning") | Recent, Live, Pinned, filter results with the Whole library scope |
| Status (Live) | Live · Paused · Offline · Ended · Local | Live list, Whole library |

- **Bucket edges** use the OS locale and the local midnight. "Previous 7 Days" means days 2–7 before today, not ISO weeks, which avoids Explorer's "Last week" surprise.
- **Group headers:**
  - sticky
  - not collapsible in v1, because collapsible groups add a second expand model next to the tree's
  - labelled with the name and count, for example "Today · 4". The count is in the header text, not on a control.
  - The header is `role="row"` with a `rowheader` cell and `aria-level` 1 inside the grid. Rows under it are level 2 (unverified pattern, a11y-specialist review).
- **Clock change:** a list left open over midnight re-buckets at the next index change or on window focus, never on a timer that moves rows under the pointer.
- **Manual sort and grouping:** Group is disabled when the sort is Manual. Its tooltip says "Grouping isn't available with manual order."

### 3.6 Live updates while a list is on screen

- **Rows inserted or removed** by index changes keep the visible rows still (scroll anchoring, UX spec §4.5).
- **Reordering caused by a sort key changing** (`modified_at`, `opened_at`, `changed_by_others_at`):
  - is **coalesced** to at most once per 5 s
  - is held while the pointer is over the list, while a drag is in progress, while an inline rename is open, or while a context menu is open
  - The row that has keyboard focus keeps focus as it moves.
  - This is how Finder and Mail behave (unverified as a documented rule, observed behaviour).
- **The tree,** when sorted by Modified: the document being edited **doesn't move** until its tab loses focus. That keeps principle 4 honest.

### 3.7 Keyboard in tree and list (additions to UX spec §4.6)

| Action | macOS | Windows / Linux | Scope | Notes |
|---|---|---|---|---|
| Type-ahead | letters | letters | tree, list, Move to… | APG ([Tree View](https://www.w3.org/WAI/ARIA/apg/patterns/treeview/)): a 500 ms buffer. Typing the same letter repeatedly cycles through matches. Accent-folding. It matches visible rows only, since collapsed children aren't searched. |
| Filter list | ⌘F | Ctrl+F | list view | The editor's ⌘F stays Find (C7) |
| Move to… | ⌘⇧M | Ctrl+Shift+M | tree, list | Scoped, so editor keymaps don't apply. Check the registry for `Mod-Shift-m` in P2.7 (unverified as free). |
| Move up / down (Manual) | ⌥⌘↑ / ⌥⌘↓ | Alt+Shift+↑ / ↓ | tree, list, Pinned | Ctrl+Alt is AltGr (plan §5.6), so Windows and Linux use Alt+Shift |
| Move out one level | ⌥⌘← | Alt+Shift+← | tree | Into the parent's parent, placed after the parent |
| Pin / Unpin | menu, context menu | same | — | No key. ⌘⇧P is the palette (UX spec §4.4). |
| Open the parent folder | ⌘↑ | Alt+↑ | list view | Finder and Explorer |
| Open a folder (list view) | ⌘↓ or Enter | Enter | list view | — |
| Expand while dragging | Space | Space | during a drag | Finder spring-loading |
| Cancel drag | Esc | Esc | during a drag | — |

Every new action is also in the command palette's App group (UX spec §4.4).

### 3.8 Counts

- **No count badges on sidebar rows.** UX principle 5: "Counts … live in popovers, tooltips and list columns, never on a face". A tree row is navigational chrome.
  - This differs from the research sketch, where "Live 2" and "Trash 3" appear in the sidebar. That sketch is superseded here.
  - A row's tooltip says "Drafts: 12 documents, 2 folders".
- **The list view header** says it in text: "Drafts — 12 documents".
- **The Trash footer** says "3 documents in Trash · deleted after 30 days".

### 3.9 Performance with 1,000+ documents

| Concern | Rule |
|---|---|
| Data in the renderer | The `index.snapshot` already holds every document row (architecture §4). At 1,000 rows of about 300 B, roughly 300 KB with snippets: fine. At 10,000, 3 MB: still fine. Sort, filter and group run **in the renderer** on that snapshot, with one cached `Intl.Collator`. No IPC round trip per keystroke. |
| Budgets | Re-sort, filter or group: ≤ 16 ms at 1,000 documents and ≤ 50 ms at 10,000 (M1). Type-ahead response ≤ 1 frame. Opening a folder of 1,000 rows: first paint ≤ 50 ms. |
| Virtualization | The tree and every list are windowed: fixed row heights, overscan 10 rows, flattened visible rows for the tree. `aria-setsize` and `aria-posinset` on every row (UX spec §8.1). No library is in `package.json` today. Hand-rolled vs `@tanstack/react-virtual` is ui-programmer's call (bundle cost unverified). |
| Expand all (`*`) | Expands siblings only (APG), never the whole library |
| Indexes (worker) | `docs(folder_id, trashed_at, sort_key)` and `docs(trashed_at, modified_at)`. The existing `docs(folder_id, trashed_at, opened_at)` stays. |
| Soak | T8 (one year of editing) adds: a library of 1,000 documents and 100 folders, 4 levels deep. Measure sidebar populate (≤ 600 ms Mac and ≤ 1.0 s Windows, architecture §10), each sort switch, and folder trash and restore of 500 documents (≤ 300 ms in one transaction). |

### 3.10 Empty and edge states (lists)

| State | Title | Sentence | Actions |
|---|---|---|---|
| Filter: no results | No matching documents | Nothing in “Drafts” matches “q4” and Last 7 days. | [Clear Filters] · [Search Whole Library] (only if the scope isn't already Whole library) |
| Filter: no results, title-only hint | — | Under the sentence, muted: "Filters look at titles only." | — |
| Empty folder | “Drafts” is empty | Drag documents here, or create one. | [New Document] (UX spec §5.2) |
| Folder trashed while open in a list view | “Drafts” is in Trash | Restore it to see its documents here. | [Restore] · [Go to Library] |
| Folder deleted forever while open | The list view navigates to Library. Pill: "“Drafts” was deleted." | — | — |
| Group with no rows | Not shown | — | — |
| Live list, nothing shared (Live release) | No live documents | Share a document to work on it with others. Documents you join from a link also appear here. | — |
| Live list, filtered to Updated, none | You're up to date | No live documents have changed since you last opened them. | [Show All] |
| Library at 10,000+ documents | — | (no message; the budgets cover it) | — |
| Sort by Last opened, never-opened rows | — | Column shows "—", with the tooltip "Not opened yet" | — |

---

## 4. Reading mode

- **What:** View › Reading Mode. A read-only presentation of the current document:
  - the toolbar row hides
  - the sidebar collapses (it is restored on exit)
  - the outline stays available: margin at ≥ 1400 px, overlay below
  - collaboration carets stay visible on live documents
  - typography is art-director's call. This design only fixes behaviour.
- **Keys:**
  - menu and palette only in v1. ⇧⌘R is Safari's Reader, but our ⌘⇧R is being freed in P1.2, and re-using it now would re-create a clash.
  - Esc exits.
  - Space / Shift+Space scroll a page. ⌘↑ / ⌘↓ go to the top or bottom.
  - The outline's ↑↓ Enter move between sections, using `goToHeading`.
- **Read-only must be truly read-only.** Plan §2 found that the TOC-id and title plugins write from `appendTransaction` even when the editor isn't editable. In Reading mode, those writes would:
  - bump `modified_at`
  - reorder Modified-sorted lists
  - mark a live document "Updated" for collaborators

  So Reading mode must **filter local writes**, the same as the view-only session filter planned for the Live release. That makes reading mode the first user of that filter. **Engineering exit check:** opening, scrolling and leaving Reading mode produces zero appends.
- **The chip** shows the document's usual state (Local or Live). There is no "Reading" chip, because the mode isn't a document state. The window title gets " — Reading".
- **Release:** **Local release, P2.9a.** It is cheap and pairs with the outline.
- **Not:** a "focus/typewriter" writing mode. That is a different feature (editing, dimmed chrome) and needs its own design.

---

## 5. Review

### 5.1 Reviewing your own documents (Live release)

**Local documents** change only when you change them, so in the Local release "review" means versions (§5.3) and reading mode (§4).

**Live documents** need "what changed while I was away" (Apple Notes Show Updates, GitHub's "Changed since last view").

**The mechanism (P4.8, new)**
- **Last seen.** On blur, hide, tab switch and close of a live document, store `seen_sv = Y.encodeStateVector(doc)` in `docs.seen_sv` (local).
- **Mine vs theirs.** Yjs client IDs change per session. Record every client ID this app used for the document in `doc_clients(doc_id, client_id)` (local).
  - "Theirs" = any struct whose `client` isn't in that set.
- **Changed by others.**
  - When the renderer applies a remote update (provider origin) to a live document, it sets `changed_by_others_at` through the append's metadata.
  - For a document that isn't open: the next time it syncs, when it is opened.
  - Live documents sync only while open (plan §6: open-only connections), so "Updated" is known **only after you open it, or while it is open in a tab**.
  - **Honest limit:** without a background sync, the sidebar can't know a closed live document changed. Recommendation: no background polling in the Live release (it would add server load and IP-limit pressure, K4 and K10). Say so in Help.

**What the user sees**

| Element | Behaviour | Copy |
|---|---|---|
| **Updated marker** | A filled dot before the title in the tree and lists, **plus** the word "Updated" in the Status column (never colour alone). Cleared when you open the document and stay for 2 s. | Tooltip: "Changed by someone else since you last opened it." |
| **Live list** | "Updated" filter chip. Default sort: Changed by others. | — |
| **On open, if others changed it** | The chip popover gets one line, and the pill shows once: | Pill: "“Q4 plan” changed since you last opened it. [Show Changes]" |
| **Show Changes** (View › Show Changes Since Last Open, also in the chip popover) | Inserted text by others since `seen_sv`: underline plus a light tint, a 3 px bar in the left gutter (Word Simple Markup). Deletions: a small caret mark where text was removed. **The removed text isn't shown**, because Yjs garbage-collects deleted content (unverified for our `gc` setting; it is the Yjs default). | Banner in the notice slot: "Showing changes since you last opened this on 12 Nov, 14:02. [Next Change] [Hide Changes]" |
| **Next / previous change** | F7 / ⇧F7 (unverified as free; Word uses F7 for spelling on Windows) or the banner buttons. Scrolls to the change and announces "Change 3 of 11, inserted text". | — |
| **Show Changes hides itself** | When you start typing (decorations off; the banner is replaced by a pill: "Hid changes so you can edit. [Show Again]"). | — |
| **Nothing to show** | — | Pill: "No changes by others since you last opened it." |

**Who changed what (names).** Not in the Live release.
- It needs `Y.PermanentUserData`, which is experimental, grows the document, and stores **self-declared** names (there are no accounts).
- A name that anyone can type is a spoofing surface in review ("Approved by Alex").
- **Later**, labelled "Name shown is what they typed".

### 5.2 Collaborative review: comments

**Recommendation:** comments ship in a **Review release after the Live release**, not in it (owner question Q2).

**Honest cost:**
- about 5 PRs, plus the usual follow-up tail (about 20 for a feature of this size, per plan §8.1)
- a server change
- a new margin layout
- a new state in every live document

**Why build our own** (from §1)
- The Tiptap Comments extension is paid and coupled to Tiptap's platform.
- BlockNote's pattern proves the shape, but it uses a **mark**, which we avoid for these reasons:
  1. **Schema.** A new mark is refused by the server allowlist (`findDisallowedSchemaNames` → `schema_rejected`, `lib/security/hocus-document-guard.ts`). It needs the schema floor and P4.6 skew handling, so older desktops can't open documents with comments.
  2. **View-only.** Adding a mark is a content edit, so a view-only reader could never comment.
  3. **Overlap.** Overlapping comment marks are fragile in Yjs (BlockNote PR).
  4. **Leaks.** Marks travel with copy and paste into other documents and into Markdown export.
- **Our approach: anchors as `Y.RelativePosition` pairs in a separate root map, `comments`.** The document text is never touched.

**Data, inside the Y.Doc (shared)**

```text
Y.Map "comments": threadId (uuid) → Y.Map {
  start:       Uint8Array   // Y.encodeRelativePosition, assoc 0: sticks to the first quoted character
  end:         Uint8Array   // assoc -1: typing right after the range doesn't extend it
  quote:       string       // ≤ 280 chars, the text when the thread was made (for orphans and the panel)
  createdAt:   number
  author:      { name ≤ 40, color }   // self-declared, the awareness identity
  resolved:    boolean; resolvedAt?: number; resolvedBy?: { name }
  suggestion?: string       // ≤ 4,000 chars: a proposed replacement for the quoted range
  replies:     Y.Array<{ id, author, text ≤ 4,000 plain text, createdAt, editedAt?, deleted?: true }>
}
```

- **Positions:** ProseMirror ↔ relative positions through the y-prosemirror helpers. Their export from `@tiptap/y-tiptap` is (unverified).
- **Decorations:** one eager plugin whose state is only a `DecorationSet`, following the `action-preview` pattern (AGENTS.md).
  - Rebuilt from the map when the map or the fragment changes, throttled to one frame.
  - O(threads). Capped at **300 open threads per document**. Past that, the "Comment" command is disabled with the tooltip "This document has too many open comments. Resolve some first."
- **Size:** comments count toward the document size cap. Text limits above.
- **Undo:** comment actions are **outside** the editor's Yjs undo. Delete has a pill with [Undo] and resolve is a toggle, so ⌘Z in the text never un-posts a comment.
- **Server (in the Review release's server PR):**
  - Today the guard checks schema names and the editor root, but **any other root map is accepted, bounded only by size**. That is a pre-existing gap worth closing on its own (flag for SE).
  - Add a root allowlist (`default`, `comments`) and a shape and length check for `comments` entries.
- **Exports:** `.md` and `.html` exports **leave comments out**. `.tinydoc` and backups keep them, since they are Yjs state. Later: "Export with comments" as footnotes.
- **Versions:** they carry comments, because they are Y.Doc state. Restoring a version restores its comments; a restore is a forward edit of the `comments` map as well.

**Anchors when text changes**

| Case | Result | Copy (panel) |
|---|---|---|
| Text inside the range edited | The range follows the edits | — |
| All anchored text deleted | start ≥ end → **orphaned**. The thread stays in the panel, not in the margin. | "The text this comment was on was deleted." plus the stored quote in muted italics |
| Anchored text moved with `moveSection()` | Delete plus insert in Yjs → orphaned. **(unverified** whether `moveSection` preserves items; most likely not) | as above. Engineering to check whether section moves can re-anchor by matching the quote inside the moved block. |
| Version restored over it | Restore is a forward edit → usually orphaned | as above |
| Two threads overlap | Both decorations draw, and the tint darkens. Clicking chooses the innermost (shortest) range, and Alt+click cycles. | — |

**UI: margin rail beside the margin outline**

```text
  sidebar 240     │ outline (left margin)│        document 720          │ comment rail (right margin) │
┌─────────────────┼──────────────────────┼──────────────────────────────┼─────────────────────────────┐
│ ▾ Library       │ Q4 plan              │ Q4 plan                      │                             │
│   ▾ Drafts      │  Goals               │ Goals                        │ ┌─────────────────────────┐ │
│     Q4 plan     │  Risks               │ Ship the ▁▁desktop app▁▁ by  │ │ Sam · 14:02             │ │
│                 │  Timeline            │ week 16, with backups…       │ │ “desktop app”           │ │
│                 │                      │                              │ │ Do we mean Local only?  │ │
│                 │                      │                              │ │  └ Ana · 14:10          │ │
│                 │                      │                              │ │    Yes, Live is P4.     │ │
│                 │                      │                              │ │ [Reply…]   [✓ Resolve]  │ │
│                 │                      │ Risks                        │ └─────────────────────────┘ │
│                 │                      │ ▁▁Signing enrolment▁▁ may…   │ ┌ Lee · Suggestion ───────┐ │
│                 │                      │                              │ │ “Signing enrolment”     │ │
│                 │                      │                              │ │ → “Apple and Azure      │ │
│                 │                      │                              │ │    enrolment”           │ │
│                 │                      │                              │ │ [Apply]  [Reply…]  [✓]  │ │
│                 │                      │                              │ └─────────────────────────┘ │
└─────────────────┴──────────────────────┴──────────────────────────────┴─────────────────────────────┘
  ▁▁text▁▁ = commented range: underline plus tint (never colour alone)
```

- **Layout rule (principle 4: nothing moves on its own).** The content column **never shifts** to make room for comments.
  - **Rail:** shown when the space right of the content is at least 260 px. At 100% zoom, with the sidebar open and the outline in the margin, that means a window of about 1,700 px (unverified arithmetic; design review).
  - **Otherwise:** a **margin marker** sits at each commented line, a small speech-bubble icon in the right gutter, one per line, never a count. Clicking it or pressing ⌥⌘⇧M (unverified) opens the **Comments panel** as an overlay from the right, the same way the outline overlays below 1400 px.
  - When a collaborator adds the first comment, a marker appears in a gutter that already exists. The text doesn't move.
- **Card placement:**
  - Cards align with their anchor's top. Collisions stack downward.
  - The **active** thread is pulled to its anchor line and the others make way (Google Docs).
  - Card movement is 120 ms, or none under reduced motion.
- **Comments panel** (any width): a list of threads in document order.
  - Controls: "Show resolved" toggle, "Unread first" sort (Figma). Unread = threads with activity since `seen_sv`, which is the same local state as §5.1.
  - The panel is a `complementary` landmark named "Comments". Each thread is an `article` labelled "Comment by Sam on “desktop app”".
- **Hide all comments:** View › Hide Comments. A key is TBD after a collision check (Figma uses ⇧C, which would type in an editor).
- **Creating a comment:**
  - Select text, then the bubble-menu Comment button, the context menu "Comment…", Insert › Comment, or ⌥⌘M (Docs and Word; collides with macOS "Minimize All" when Option is held, **check in S1**). Windows and Linux: menu, context menu and palette until a free key is confirmed.
  - The draft card opens with focus in its field. ⌘Enter posts. Esc discards an empty draft, or asks first if there's text: "Discard this comment? [Keep Editing] [Discard]".
  - No selection: Comment anchors to the **current word**. If there's no word (an empty paragraph), the command is disabled with the tooltip "Select text to comment on."
- **Resolve and reopen:**
  - Resolve hides the card and its decoration. Pill: "Resolved. [Undo]".
  - Reopen is available from Show resolved, on any card. Anyone with edit access can do either; there are no roles without accounts.
- **Delete:** your own reply only, decided by "same local author identity". That isn't security; it's a guard against accidents. A reply shows "Reply deleted". Deleting the first comment deletes the thread after confirmation: "Delete this comment and its 2 replies? [Cancel] [Delete]".
- **Edit:** your own replies, marked "(edited)".
- **Suggested replacement** (GitHub-style, the cheap form of suggestion mode):
  - The draft card has a "Suggest a change" toggle that pre-fills the quoted text for editing.
  - **[Apply]** replaces the anchored range with plain text, in one transaction **inside** the editor's undo, then resolves the thread with "Applied by Ana".
  - **Stale guard:** if the anchored text no longer equals `quote`, Apply is disabled with the tooltip "The text has changed since this suggestion. Edit it by hand."
  - Formatting inside the range is lost on Apply. The card says "Replaces formatting in this range" when the range has marks.
- **Local documents:** comments work on Local documents too, as notes to self, using the same data. That is free once built, and comments survive going live.

**Mentions without accounts: recommend no.**
- With no accounts and no delivery channel, "@Sam" can't notify anyone.
- A mention that looks like it notifies but doesn't is a broken promise.
- "@" stays plain text.
- Revisit only if identity arrives (a plan non-goal).

**View-only links**
- The view token sets `connection.readOnly`, so the server drops every write, including writes to `comments`.
- **Recommendation for the Review release:** view-only readers **see** comments and can't add them.
  - Chip popover: "You can read this live document and its comments. Ask for an edit link to comment."
  - The Comment command is disabled with the same tooltip.
- **Later option:** a third, **"can comment"** link. The server would accept updates whose structs all resolve to the `comments` root. The guard already resolves roots per struct (`createRootResolver`), so this is feasible, but it is a new auth surface needing its own OWASP pass.

**Suggestion mode / tracked changes: Later, behind a spike.**
- It needs insertion and deletion marks in the schema, so: schema floor, skew, every node view (Mermaid, media, tables), paste, Yjs undo, collaboration carets and the toolbar all change behaviour.
- Tiptap's paid version is still experimental.
- **Spike exit:** `prosemirror-suggest-changes` (licence check first) running on our schema with y-tiptap: two clients suggesting at once, accept and reject converging, and the `perf` spec within budget.
- Until then, suggested replacement covers the common "fix this wording" case.

### 5.3 Version review (Live release; P4.0 has the table)

**Versions:** 14 automatic and 20 labelled (plan Appendix A, P4.0), plus pre-restore and pre-wipe versions.
- **Automatic versions:** taken after 10 minutes of idle following edits, and at close.
  - Unlike Dropbox Paper, small edits aren't hidden: every automatic version is listed.
  - Consecutive automatic versions with no change aren't created.
- **Local documents get versions too**, once P4.0 lands. The table isn't sharing-specific, and the daily snapshots stay as the library-wide safety net.

**Document › Version History…** (menu and palette. A key is TBD; Google Docs uses ⌥⌘⇧H, which needs a collision check against `lib/editor-actions`)

```text
┌ Version history — “Q4 plan” ──────────────────────────────────────────────────────────────┐
│ Versions                     │ Compare: [Wed 12 Nov, 14:02 ▾]  with  [Current ▾]           │
│ ● Current                    │ ☑ Show changes   ◀ Prev change  3 of 11  Next change ▶      │
│ ▸ Today, 15:10   automatic   │─────────────────────────────────────────────────────────────│
│   Today, 11:02   automatic   │ Goals                                                       │
│   Wed 12 Nov, 14:02  “Sent   │ Ship the desktop app [−before Christmas−][+by week 16+],    │
│     to Ana”      labelled    │ with backups…                                               │
│   Tue 11 Nov     before      │                                                             │
│     restore                  │ ┃ Risks                              [Restore This Section] │
│   Mon 10 Nov     before      │ ┃ [+Signing enrolment may take four weeks.+]                │
│     a large deletion         │                                                             │
│                              │ Timeline   (unchanged, collapsed: 14 paragraphs)  [Show]    │
│ [Name This Version…]         │                                                             │
│                              │                     [Cancel]  [Restore This Version…]       │
└──────────────────────────────┴─────────────────────────────────────────────────────────────┘
 [−text−] = deleted: strikethrough + red tint + "deleted" in the accessible name
 [+text+] = inserted: underline + green tint + "inserted"
 ┃ = margin bar on changed blocks
```

**How the diff is computed** (not with y-prosemirror snapshots, §1)
1. Decode each version's Yjs state into a ProseMirror document (`yXmlFragmentToProseMirrorRootNode` or equivalent, unverified name in y-tiptap) in a throwaway `Y.Doc`. No editor is mounted.
2. **Align blocks** by heading `data-toc-id` sections. Headings carry stable ids (UniqueID), so a moved section is shown as **moved**, not as a delete plus an insert. Within a section, paragraphs are aligned by an LCS over block text.
3. **Word-level diff** inside changed blocks. Marks-only changes show as "Formatting changed" in the gutter, not as red and green text.
4. Render read-only and static, with unchanged runs collapsed after 3 paragraphs of context.
5. **Budget:** ≤ 300 ms for a 500 KB document (unverified, measure in P4.x). Run it in a worker if it's over.

**Actions**
- **Restore This Section:** replaces that heading's section in the current document with the version's, as a forward edit inside undo.
  - Live documents confirm first (plan §5.5 copy, scoped): "This replaces “Risks” for everyone with the link. The current version is saved first. [Cancel] [Restore Section]".
- **Copy** from the compare pane is allowed (selecting text in the static render), so you can restore a sentence by hand.
- **Restore This Version…:** the plan §5.5 sheet for live documents. For Local documents there is no sheet: the pill has [Undo] (as in the daily-snapshot design).
- **Name This Version…:** a field, 1–60 characters. It turns an automatic version into a labelled one. When 20 labels exist: "You have 20 named versions. Remove a name to add another." The ⋯ menu on a row has Remove Name.
- **The compare pickers** take any two versions, including the current one. Default: the selected version vs Current, which beats Google Docs' adjacent-only comparison.

**States**

| State | Copy |
|---|---|
| No versions yet | No versions yet. TinyDocy saves one after you stop editing for 10 minutes. |
| Versions identical | These versions are the same. |
| Version from a newer schema | This version uses features from a newer TinyDocy. Update to compare it. |
| Diff too large to show (> 5,000 changed blocks) | Too many changes to show side by side. You can still restore this version. |
| Pre-wipe version (T14) | Row label "before a large deletion". Pinned to the top for 7 days after the wipe toast. |

**Local release.** The daily-snapshot dialog (UX spec §5.5) already previews one day.
- **Stretch:** add the same "Show changes" toggle there (compare that day with Current), reusing the diff module.
- Behind the tripwire. If cut, the diff module arrives with P4.x.

### 5.4 Later: drafts and branches

Patchwork and Upwelling show the next step: a private **draft** of a live document that you edit away from collaborators and merge back, with diff review.
- Yjs can do this by forking the state and merging updates. The hard part is the UX of merging prose.
- Out of scope until comments and versions have been used.

---

## 6. Keyboard map additions (summary)

These are checked against UX spec §4.6 and the editor keys listed there. `lib/shortcuts.ts` only formats keys and holds no bindings, so the real registry is `lib/editor-actions`. Every "(unverified)" item needs a registry and OS check in P2.7 or S1.

| Action | macOS | Win / Linux | Scope | Release / PR |
|---|---|---|---|---|
| Filter list | ⌘F | Ctrl+F | list view | Local, P2.7 |
| Move to… | ⌘⇧M (unverified) | Ctrl+Shift+M | tree, list | Local, P2.7 |
| Move up / down (Manual) | ⌥⌘↑ / ↓ | Alt+Shift+↑ / ↓ | tree, list, Pinned | Local, P2.7 |
| Move out one level | ⌥⌘← | Alt+Shift+← | tree | Local, P2.7 |
| Parent folder | ⌘↑ | Alt+↑ | list | Local, P2.7 |
| Expand folder while dragging | Space | Space | drag | Local, P2.7 |
| Reading mode | menu and palette | menu and palette | app | Local, P2.9a |
| Show changes since last open | menu, chip popover | same | document | Live, P4.8 |
| Next / previous change | F7 / ⇧F7 (unverified) | F7 / Shift+F7 | document while changes show | Live, P4.8 |
| Version history | menu and palette (⌥⌘⇧H candidate, unverified) | menu and palette | document | Live, P4.7 |
| New comment | ⌥⌘M (S1 check vs Minimize All) | menu, context menu, palette | editor selection | Review release |
| Post comment | ⌘Enter | Ctrl+Enter | comment field | Review release |

---

## 7. Data model

### 7.1 Local (SQLite). Never in a Y.Doc, never shared

| Table | Change | Release / PR | Why |
|---|---|---|---|
| `docs` | `pinned` → `pin_key TEXT NULL` (null = not pinned; fractional order within Pinned) | Local, **P2.6** | Pinned needs its own order. One column, not two. |
| `docs` | `+ size_bytes INTEGER` (snapshot + update rows, kept by the worker on append and compaction) | Local, P2.6 | Size sort, the large-document pill, the share pre-check |
| `docs` | `+ snippet TEXT` (≤ 200 chars, sent by the renderer on blur, hide and close) | Local, P2.6 (column), P2.7 (UI) | Preview view |
| `docs` | `+ trash_group TEXT NULL`, `+ trashed_from TEXT NULL` (folder id) | Local, P2.6 | Folder trash as one unit. Restore to the old place. |
| `docs` | `sort_key` (exists) defined as a fractional-index string, NOT NULL | Local, P2.6 | Manual order |
| `folders` | `+ sort_by TEXT, sort_dir TEXT, view TEXT, group_by TEXT, created_at, modified_at, trash_group TEXT NULL` | Local, P2.6 | Per-folder settings. Folder dates for sorting. |
| `folders` | depth ≤ 4 and name uniqueness (case-folded, per parent) **enforced in the worker**, not just in the UI | Local, P2.6 | Imports and restores can't break the invariant |
| `view_prefs(place TEXT PRIMARY KEY, sort_by, sort_dir, view, group_by, columns JSON)` | new | Local, P2.6 | Library root and smart lists |
| `meta` | `new_folder_sort` default | Local | Settings › Library |
| `docs` | `+ seen_sv BLOB, changed_by_others_at INTEGER` | Live, **P4.0** | §5.1 |
| `doc_clients(doc_id, client_id)` | new | Live, P4.0 | Tells "mine" from "theirs" |
| `versions` | as P4.0, plus `label TEXT NULL`, `kind TEXT` (`auto`, `labelled`, `pre_restore`, `pre_wipe`) | Live, P4.0 | §5.3 |
| `move_to_recent` | 3 folder ids in `meta` | Local | Move to… |

- **Rule:** columns land in **P2.6 with the schema**, even where their UI comes later. That costs nothing now and avoids a `format_version` migration in P2.7. The plan already prefers cheap seams (D-A5).
- **IPC:** `index.move` takes a list of ids plus `{ parentId, beforeKey?, afterKey? }` and is all-or-nothing. `index.pin`, `index.setViewPrefs` and `index.reorder` are added to the contract in `desktop/shared/ipc-contract.ts`, with guards.

### 7.2 Shared (inside the Y.Doc). Every collaborator sees it

| Root | Contents | Release |
|---|---|---|
| `default` (editor fragment) | the document, unchanged | — |
| `comments` (Y.Map) | §5.2 | Review release |

**Explicitly not shared:** folders, order, pins, sort, view, filters, Updated state, `seen_sv`, Reading mode, and which comments you've read.

**Tags:** decided by the parallel design. If tags live in the Y.Doc, collaborators see them and the filter reads a local index the renderer maintains, as with `snippet`. If they're local, they're a table. This design needs one thing either way: a `doc_tags(doc_id, tag)` index the worker can query.

---

## 8. Accessibility

| Surface | Pattern | Notes |
|---|---|---|
| Library tree | APG Tree View, multi-select (UX spec §8.1) | Type-ahead per APG. On drop or keyboard move, `announce()` the new position. A collapsed folder that held focus takes focus. |
| List views | `grid` with `aria-multiselectable`. Sortable column headers as buttons with `aria-sort`. Group headers as rows with `aria-level` 1 (unverified pattern, a11y-specialist). | `aria-rowcount` = the total, not just the rendered rows (virtualised) |
| Preview view | the same grid with a single column. Each row's accessible name = title, then snippet, then meta. | — |
| Pinned and Recent inline lists | `list` (UX spec §8.1) | Reorder via keys (§3.7) |
| Move to… | a dialog containing a tree. Initial focus on the filter field. | — |
| Filter bar | `search` landmark. Chips are buttons with `aria-haspopup="listbox"`. The result count is announced. | — |
| Drag and drop | Every drag has a non-drag path (§2.3). The drag ghost is `aria-hidden`. | WCAG 2.5.7 |
| Comment highlights | Decorations add `aria-describedby` → the thread's quote and author? Not inside contenteditable (screen readers vary, unverified). Instead: a "Comments" landmark plus **Next comment** in the palette, and the highlight's underline (not colour alone). | — |
| Change marks | Inserted = underline. Deleted = strikethrough. Both have text alternatives in the diff ("inserted", "deleted"). Gutter bars are decorative. | Forced colours: `Highlight` / `Mark` system colours |
| Reading mode | `main` keeps its name ("Document"). Add `aria-readonly="true"`. | — |
| Updated dot | A dot **plus** the Status word, plus the tooltip | Never colour alone |

The accessibility checklist in the brief (keyboard only, gamepad n/a for a desktop document app, minimum font size, no colour-only meaning, no flashing, UI scaling) is met by the rules above together with UX spec §8.4–8.6.

---

## 9. Changes this suggests to plan v4 and the UX spec

| # | Change | Where |
|---|---|---|
| R1 | **Split P2.7** into **P2.7a** (tree: folders, DnD, spring-loading, Move to…, Pinned order, type-ahead, virtualization) and **P2.7b** (list views: sort, Preview view, group, filter bar, counts). Each is a design review on its own. | Plan §8.4 |
| R2 | **P2.6 adds the columns in §7.1** (pin_key, size_bytes, snippet, trash_group, folder settings, view_prefs) and the worker's depth and uniqueness rules. | Plan §8.4, architecture §5.3 |
| R3 | **P2.8 adds:** folder trash and restore as a unit, duplicate rules (§2.6), and Export all carrying folder structure. | Plan §8.4 |
| R4 | **P2.9a adds Reading mode,** with the "zero appends" exit check. | Plan §8.4 |
| R5 | **Tripwire additions** (cut first if Gate 2 slips): Preview view, Group by, multi-select drag (single-item drag stays), the daily-snapshot "Show changes" stretch. | Plan §8.2 |
| R6 | **P4.0 adds** `seen_sv`, `changed_by_others_at`, `doc_clients`, and version `label`/`kind`. | Plan §8.4 |
| R7 | **New P4.7:** Version History and compare UI (§5.3). **New P4.8:** Updated marker and Show Changes (§5.1). Both need design review. | Plan §8.4 |
| R8 | **New Review release (R-phase):** R.1 comments data and server root allowlist; R.2 rail, marker and panel UI; R.3 suggested replacement; R.4 (optional) can-comment links; R.5 suggestion-mode spike. | Plan §15 → a new phase |
| R9 | **Server, any time:** a Y.Doc root allowlist (today any root is accepted, bounded by size). A small, independent hardening PR. | `lib/security/hocus-document-guard.ts` |
| R10 | **No sidebar count badges.** The research doc's sketch is superseded (§3.8). | Research doc §1.4 |

---

## 10. Owner questions

1. **Default sort for folders: Title (recommended, rows stay still) or Modified (Bear and Notes style; rows reorder with the coalescing rule)?**
2. **Comments: after the Live release (recommended, about 5 PRs plus follow-ups and a server change), or inside it, which adds weeks to Gate 5?**
3. **View-only link holders:** read comments only (recommended for the Review release), or add a third "can comment" link (a new auth surface)?
4. **Duplicating a document with comments:** leave them out (recommended), keep them, or ask each time?
5. **Folder depth of 4:** accept, or allow deeper?
6. **Version compare in the Local release** (the stretch on the daily-snapshot dialog): worth the risk to Gate 2, or wait for P4.7?
7. **Mentions:** confirm "no" until identity exists.

---

## 11. Sources

**File managers and note apps**
- Apple: [Change how folders are displayed in the Finder](https://support.apple.com/guide/mac-help/mchldaafb302) · [Smart Folders in Notes](https://support.apple.com/guide/notes/apd58edc7964/mac) · [Share and collaborate in Notes](https://support.apple.com/en-au/guide/notes/apd4e6e2c9a6/4.13/mac/27) · [Six Colors: how to view edits in Notes](https://sixcolors.com/post/2026/03/how-to-view-edits-in-notes/)
- [Spring-loaded folders (OWC)](https://eshop.macsales.com/blog/88761-how-to-use-spring-loaded-folders-in-macos/)
- [Microsoft Q&A: Explorer group by date](https://learn.microsoft.com/en-us/answers/questions/5853207/windows-file-explorer-group-by-date-modified) · [ElevenForum: date grouping complaints](https://www.elevenforum.com/t/how-do-you-get-rid-of-this-organizational-behavior-in-file-explorer.14834/latest)
- [Bear: pin notes and tags](https://bear.app/faq/pin-notes-and-tags/) · [Bear community: per-tag sort](https://community.bear.app/t/different-sorting-method-for-each-tag-not-just-a-global-one/18138)
- [Obsidian: Search](https://obsidian.md/help/plugins/search) · [Manual Sorting plugin](https://community.obsidian.md/plugins/manual-sorting)
- [Notion: views, filters, sorts and groups](https://www.notion.com/help/views-filters-and-sorts) · [Notion: comments](https://www.notion.com/help/comments-mentions-and-reminders)
- [Craft sidebar order (MPU forum)](https://talk.macpowerusers.com/t/craft-question-sidebar-sort-order/26206)
- [Google Drive: view and reorder files](https://support.google.com/docs/answer/2375177) · [TidBITS: Drive sorting can hide new documents](https://tidbits.com/2020/02/28/tipbits-google-drive-sorting-can-hide-new-documents/)

**Review**
- [Google Docs: suggest edits](https://support.google.com/docs/answer/6033474?hl=en) · [Show editors](https://workspaceupdates.googleblog.com/2021/05/view-more-context-on-google-docs-edits-with-show-editors.html)
- [Word: track changes](https://support.office.com/en-us/article/Track-changes-in-Word-197BA630-0F5F-4A8E-9A77-3712475E806A)
- [Figma: comments](https://help.figma.com/hc/en-us/articles/360041547593)
- [GitHub: mark files as viewed](https://github.blog/news-insights/product-news/mark-files-as-viewed/) · [GitHub: reviewing proposed changes](https://docs.github.com/en/enterprise-server@3.13/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/reviewing-proposed-changes-in-a-pull-request)
- [Dropbox Paper: history and unresolving comments](https://help.dropbox.com/delete-restore/track-restore-changes-comments)
- [Ink & Switch: Patchwork notebook](https://www.inkandswitch.com/patchwork/notebook/) · [Writing prose](https://www.inkandswitch.com/patchwork/notebook/02) · [Upwelling](https://inkandswitch.com/upwelling/) · [Kleppmann on Upwelling](https://kleppmann.com/2023/03/09/upwelling-version-control-for-writers.html)

**Editor libraries**
- Tiptap: [Comments](https://tiptap.dev/docs/comments/getting-started/overview) · [Tracked Changes install](https://tiptap.dev/docs/tracked-changes/getting-started/install) · [Snapshot Compare](https://tiptap.dev/docs/editor/extensions/functionality/snapshot-compare) · [Pricing](https://tiptap.dev/pricing) · [Pro license](https://tiptap.dev/docs/pro-license)
- [BlockNote comments](https://www.blocknotejs.org/docs/features/collaboration/comments) · [BlockNote comments PR #1376](https://github2.scsujunhua.workers.dev/TypeCellOS/BlockNote/pull/1376)
- [@handlewithcare/prosemirror-suggest-changes README](https://cdn.jsdelivr.net/npm/@handlewithcare/prosemirror-suggest-changes@0.1.8/README.md) · [tiptap-track-changes](https://www.pkgstats.com/pkg:tiptap-track-changes)
- [Yjs: relative positions](https://docs.yjs.dev/api/relative-positions) · [Yjs forum: snapshot rendering issue](https://discuss.yjs.dev/t/issue-related-to-rendering-snapshot-version-changes-from-database/2232) · [Yjs forum: losing deletion history](https://discuss.yjs.dev/t/gc-is-off-but-still-losing-delection-history/2704)
- [Figma: realtime editing of ordered sequences](https://www.figma.com/blog/realtime-editing-of-ordered-sequences/) · [fractional-indexing](https://cdn.jsdelivr.net/npm/fractional-indexing@3.2.0/README.md)

**Accessibility**
- [WAI-ARIA APG: Tree View](https://www.w3.org/WAI/ARIA/apg/patterns/treeview/) · [WCAG 2.2 Understanding 2.5.7 Dragging Movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements)
