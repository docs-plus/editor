# TinyDocy Desktop: documents, pages, organizing, review, sharing and editor details

- **Status:** Draft for owner review (2026-11-15). Nothing is built yet.
- **Decides:** the detail-level design of six features, and which release and PR each one belongs to.
  - document title
  - tags
  - page preferences
  - organizing and sorting
  - review
  - sharing

  It also covers the editor details that users ask for again and again.
- **Parent documents:**
  - [Plan v7](2026-11-15-desktop-local-first-design.md): releases, PRs, gates. By D6, "Local release" and "Live release" here name internal milestones of one combined v1 release.
  - [Architecture](2026-11-15-desktop-architecture.md)
  - [Desktop UX spec](2026-11-15-desktop-ux-design.md)
- **Built from:** four design studies and a staff feasibility review. Where they disagree, **this document wins** (see §11).
  - [Editor user requests](../../research/2026-11-15-editor-user-requests.md): 40 ranked requests, with evidence
  - [Title, tags and page preferences](../../research/2026-11-15-title-tags-page-preferences.md)
  - [Organize, sort and review](../../research/2026-11-15-organize-sort-review.md)
  - [Sharing details](../../research/2026-11-15-sharing-details.md)
- **Prototype:** [desktop-prototype.html](../../design/2026-11-15-desktop-prototype.html)
- **Amended by the v6 feature designs**, which win for their feature: [preferences](2026-11-16-preferences-design.md) (§4 here), [comments](2026-11-16-comments-design.md) (§1, §5, §7), [image store](2026-11-16-image-store-design.md) (§8, E6, E7), [web library](2026-11-16-web-library-design.md) (the web side of §3, §4 and §6).
- **Amended in plan v7 (owner decisions D23–D32, 2026-11-16):** §1 rule 5 is now the single editor-chunk ledger (D23). E9 and Quick Open search metadata only, never body text (D24; [search-linking design](2026-11-16-search-linking-design.md)). E4 ships menu-only, E1 adds Ctrl+H, and ⌥⌘T is menu-only off macOS (staff integration review). E5 / P2.13 adopt the [languages design](2026-11-16-languages-rtl-design.md) §4.7 extras (D26). P2.6 gains `link_key`, `kind` and `import_sources`.
- **Amended in plan v8 (owner decisions D33–D41, 2026-11-16):** §1 rule 5 gains D41's conditional phone line. §8.2 adopts the roadmap's S1 seam as the staff review tightened it: the client generates link secrets, tokens are derived with HKDF under versioned labels (`tinydocy-view` becomes `tinydocy/view/v1`), and the server sees only hashes (D40). E14 is decided by the [phones and tablets design](2026-11-16-phones-tablets-design.md) (PT-D6, M19; D36). `link_key` is `NOT NULL`, minted at insert (S16).

---

## 1. Rules that apply to every feature here

These came out of the staff feasibility review. Each one was checked against the code, or tested with Yjs.

1. **Never drop a Yjs update once it exists.**
   - **Evidence:** in a test, dropping one local update left every later update from that client stuck in `pendingStructs` after reload. That is silent data loss.
   - **Consequence:** read-only, view-only and reading mode are enforced *inside the editor*, before a change exists. They are never enforced in the batcher, the IPC layer or the store.
2. **`WriteGate`** is one small plugin, loaded eagerly in the shared editor:
   ```ts
   filterTransaction: (tr) => !tr.docChanged || isChangeOrigin(tr) || canWrite()
   ```
   - ProseMirror also filters appended transactions. That makes `WriteGate` cover the five plugins that write when a document opens:
     - `toc-id-plugin.ts:28`
     - `title-document.ts:30`
     - the trailing node
     - UniqueID's first-sync pass
     - FastTOC's `onCreate` dispatch at `fast-table-of-contents.ts:65-85`
   - `canWrite` reads a ref, the same way `schemaGuard` does. It must not depend on `setEditable`, because that runs in an effect after the editor is created.
   - `WriteGate` covers text only. Comment writes have their own `canComment()` gate under the same rule (comments design §6.2): view-only blocks both, and reading mode blocks text but allows comments.
3. **A save that fails is retried in order, never skipped.**
   - If an append IPC call or a worker write fails (disk full, I/O error, worker restart), the batch stays queued and is retried in order with backoff.
   - App health becomes **Can't save**: "TinyDocy can't save changes right now ([reason]). Keep this window open; your changes are kept in memory and will be saved when this is fixed."
   - A gap in the stored log is the same stranding bug as rule 1.
   - This adds to architecture §5.2.
4. **No new subscriptions in the editor shell, and no per-keystroke work** (AGENTS.md).
   - **Presence** gets its own coarse store. It emits only when the set of people or their status changes, never on caret moves. The toolbar never subscribes to it.
5. **One editor-chunk ledger (D23, approved at ≈1,540 B gz; ≈1,580–1,660 B with D41's conditional phone line, v8).** This replaces the 600 B allowance. It is the **single** list of everything the desktop, library and v1 feature work adds to the shared editor chunk. Every line is measured in its PR, and the PR records the real number.

   | Line | PR (owner) | Cap (gz) |
   |---|---|---|
   | No provider, `WriteGate` and the decoration host | P2.2 | 300 B (measured 294 B) |
   | Sandbox `DocSession` adapter, context and hook: `use-yjs-document` reads `DocSession` (K14's P2.1 allowance; added 2026-11-22 by coordinator decision) | P2.1c | 275 B (measured 275 B) |
   | Status chip from the composition root: `DocumentEditor` takes `statusChip` and the web root passes `CollabStatusGroup`, so the editor folder never reaches `collab-session` (architecture §3.3, the P2.2 import boundary; about 100 B of code, the rest the minifier re-ranking names in the hoisted editor module; a lazy `import()` instead cost +1.3 KB on first load) | #134 (P2.2 follow-up) | 198 B (measured 198 B) |
   | Comments hook | P4.9 | 150 B |
   | Smart-quotes gate | P2.9c-1 | 150 B |
   | i18n core (`t()`, registry labels, `lang`/`dir`; also pays L3's `matchShortcut` / `visualStep` bytes, languages §3.7.1) | L1a | 400 B |
   | `dir` attribute, direction commands, Enter inherits direction, « » by script | P2.13 | 350 B |
   | `linkHost` pass-through | LK1 | 60 B |
   | `[[` trigger | LK3 | 120 B |
   | "Type / for blocks" placeholder | OB2 | 10 B |
   | Phone keyboards: prose and code `autocorrect` / `autocapitalize` / `spellcheck` attributes (D41, v8) | M19 | 40 B |
   | Undo-gesture handler, **only if spike M18 shows native undo mutates the DOM** (D41, v8) | M19 | 80 B, conditional |
   | **Total** | | **2,053 B, or 2,133 B with the undo handler** |

   - **Headroom:** 4,385 B real when D23 was decided (the 24,064 B budget less `main` at 19,679 B). By P2.2, `main` had shrunk to +15,284 B (08b7663), so P2.2 set the fence at +16,864 B (15,284 + 1,580) in `scripts/check-editor-chunk-size.ts`; after P2.2 1,286 B remain for the other lines. P2.1c added its 275 B line and raised the fence by exactly that, to +17,139 B (15,284 + 1,855); its bytes sit with the lazy editor chunk so that first load stays flat (−32 B). #134 added its 198 B status-chip line and raised the fence by exactly that, to +17,337 B (15,284 + 2,053); first load +1 B.
   - **Phones (D41):** M27's hardware-keyboard listener (shortcut glyphs) stays **out** of the editor chunk.
   - **Fencing:** P2.2 lowers `EDITOR_CHUNK_BUDGET_BYTES` to the size on `main` plus the ledger total, so unrelated work can't spend these bytes. Raising it needs an amendment to this rule. While D41's conditional 80 B undo line is unconfirmed, the fence is `main` + 2,053 B (1,580 B, plus P2.1c's 275 B line and #134's 198 B line). If spike M18 confirms the line, the fence rises to `main` + 2,133 B with no further approval (pre-approved by D41).
   - **A PR that would go over its line** stops for a budget review. A line's unused bytes don't move to another line without an amendment.
   - **Cut order if the ledger is over:** LK3, then « » by script, then the i18n core, then P2.13 last.
   - **LK3 measures `slash-trigger` first** (with `SlashMenuHost` it must stay under 1,000 B gz, AGENTS.md) before adding its own bytes.
6. **Decoration hosts follow the `action-preview` stub pattern.** That covers comment highlights, "Updated" highlights and Find hits (P2.11).
   - The eager plugin holds only a `DecorationSet` plus a meta command.
   - All logic lives in a lazy chunk, which never calls `registerPlugin`.
   - A layer can opt into `map: true`, so its decorations are mapped through document changes (`DecorationSet.map`) instead of cleared. Comments use it (comments design §8).
   - `WriteGate`, the no-provider change and these hosts share one 300 B gz line in the rule 5 ledger (D23), measured in P2.2.
7. **Preferences that change how *I* see a document never change it for collaborators.** Only the title, the content and comments (D9) live in the Y.Doc. No preference is ever written to it.

---

## 2. Document title

**The first heading is the only real title.** There is no separate title field and no rename that bypasses the heading.

### 2.1 One helper everywhere

`displayTitle(fragment)` is a pure function. It reads Yjs through `toDelta`, so the desktop batcher can use it without ProseMirror.

| Step | What it does |
|---|---|
| Hard breaks | Become spaces. Today `textContent` drops them, so words run together (`document-editor.tsx:215`). |
| Whitespace | Collapsed, then trimmed. |
| Empty title | Shows "Untitled". The *stored* title stays empty. On the web it is still written as "Untitled" for old cached clients. |
| Length cap | 200 UTF-16 code units, cut back to the last grapheme boundary (`Intl.Segmenter`), so an emoji is never split. Today `use-synced-tabs.ts:327` and `tab-api.ts:88` slice in the middle of surrogate pairs, and a Yjs round trip turns half an emoji into U+FFFD. The IPC guard `title: opt(str(200))` holds this cap. |
| Per-surface cuts | Tab 40, window title 80, sidebar row CSS ellipsis, OS recent list 60, file name 80 after cleaning. Each is a grapheme-safe ellipsis. |

**Surfaces that use it:**
- the tab and window title
- the sidebar
- Quick Open
- Open Recent
- the Dock menu and Jump List
- backup and export file names
- the share dialog
- the handoff page, which shows nothing before the click

### 2.2 When the title updates

- **On desktop, the title comes from the document itself, whoever edited it.** On the web it updates only on local edits.
  - The web rule (`isChangeOrigin`) would never retitle a document after a collaborator's edit, or after a snapshot restore through `updateYFragment`.
  - The batcher sends `title` with the append whenever `displayTitle` changes.
- **Duplicate titles are allowed.**
  - Quick Open and lists show the folder path to tell them apart.
  - File names get a short id suffix.
- **Right-to-left and mixed-direction titles** render with `dir="auto"` on every surface.

### 2.3 Renaming from the sidebar (F2)

Renaming edits the first heading.

| Where the document is | How the rename runs |
|---|---|
| Open in this window | Through its editor, as one undoable transaction. |
| Open in another window | Sent to that window, which runs it through its editor. |
| Closed | The requesting window claims it in main's registry, then runs the real `local-session.open`, which applies migrations and refuses if the document is read-only. It calls `setTitleText`, flushes, and releases. While the claim is held, opening the document from another window waits until it is released. |

`setTitleText`:
- replaces every child of the heading (hard breaks are separate elements)
- keeps `level` and the id attributes
- creates the heading if the document was never opened
- uses the new origin `rename`

Renaming a live document renames it for everyone. The rename field says: "Renames it for everyone with the link."

### 2.4 Untitled documents

- ⌘N creates a document with an empty title and puts the caret in the heading.
- An untitled document that is still empty when you close it is **kept**. Deleting things on close is surprising.
- Trash shows it as "Untitled", with its creation date.

---

## 3. Tags

**Owner decision D7: full tags in v1.** Tags are kept on this computer only, never in the Y.Doc, so collaborators don't see them.

| Feature | Details |
|---|---|
| Add and remove | A tag row under the title, Document › Tags…, ⌥⌘T on macOS (menu-only on Windows and Linux: Ctrl+Alt+T is AltGr+T on many layouts and opens a terminal on GNOME). Autocomplete from existing tags; a new name creates the tag. |
| Sidebar | A Tags section, collapsed by default, with no counts. Clicking a tag opens a list of its documents. |
| Filter | Any list view filters by tag. Several tags combine as AND. |
| Rename | F2 on a tag in the sidebar, or Tags › Rename…. The rename applies everywhere at once. |
| Merge | Renaming a tag to an existing tag's name asks: "Merge "plans" into "planning"? 12 documents will have "planning". [Merge] [Cancel]". |
| Colours | 8 fixed colours. Each colour pairs with a text label, never colour alone, and passes contrast in light and dark. Default: none. |
| Delete | "Delete tag "planning"? It will be removed from 12 documents. The documents are not deleted. [Delete tag] [Cancel]". Undo is available for 5 s. |
| In files | Written as front matter in Markdown backups and exports. Read back on import. |

**Data**
- `tags(id, name UNIQUE NOCASE, color NULL)` and `doc_tags(doc_id, tag_id)` in SQLite on desktop.
- The same stores in IndexedDB on the web.
- Limits: 40 characters per tag, 20 tags per document.

**Later:**
- tags shared with collaborators
- nested tags

**Owner PRs:**
- P2.6: the `tags` and `doc_tags` tables
- P2.7b: list filter, sidebar section, rename and merge
- P2.9b: tag row and colours
- W2 (IndexedDB stores) and W5 (the shared `components/library/` UI): the same features on the web library

## 4. Page preferences

**Owner decision D10: all page preferences in v1.** The [preferences design](2026-11-16-preferences-design.md) defines every setting (its default, scope, storage, first-paint path and PR) and wins over this section. This is the summary.

- **Defaults are app-wide and per viewer.** Desktop keeps them in main's `meta('prefs')` row. The web keeps them in `tinydocy-ui` slots, per origin, so the sandbox and the web library each have their own. They never go in the Y.Doc.
- **A document can override its width wherever a library exists:** on desktop (`doc_view(doc_id, width, place, remote_images)` in SQLite, created by P2.6) and in the web library (IndexedDB `doc_view`). **The public sandbox has app-wide width only.** Its documents are public and shared, so a per-document view key adds nothing there.
- The override is read during `local-session.open`, before the editor mounts, so there is no jump. The skeleton shows the app default.
- On a library host, the Page popover's Width sets **this document**. When it differs from the default, the popover offers **Use for all documents** and **Reset**.
- **Styles.** Four named styles set five knobs (font, text size, width, spacing, letter spacing): **Default**, Comfortable reading, Compact and High legibility. Changing a knob keeps the style and shows "· Custom" (preferences design §4.4).

| Preference | Values | Default | Where |
|---|---|---|---|
| Style | Default · Comfortable reading · Compact · High legibility | Default | Page popover, Settings › Page, palette |
| Page width | Narrow 30 em · Standard 33 em · Wide 46 em · Full (text kept to 46 em) | Standard | View › Page Width (this document), Page popover, Settings › Page (the default), palette |
| Text size | 14 · 16 · 18 · 20 · 24 · 28 · 32 px, stored in rem | 16 (owner Q1; if 15 is kept, the ladder is 13 · 15 · 17 · 19 · 22 · 26 · 30) | View › Text Size, Page popover, Settings › Page, palette. On desktop only, ⌘+ / ⌘− / ⌘0 and Ctrl+wheel change it, never page zoom. The web never captures those keys. |
| Font | Default (Arial) · Sans (Inter) · Serif (Source Serif 4) · Mono (JetBrains Mono) · Legible (Atkinson Hyperlegible Next, Q3) | Default | View › Font, Page popover (under Adjust), Settings › Page |
| Spacing | Compact · Normal · Relaxed (line height 1.45 / 1.6 / 1.8, paragraph gaps to match) | Normal | Page popover (under Adjust), Settings › Page |
| Letter spacing (Q3) | Normal · Wide · Wider (Wider = WCAG 1.4.12) | Normal | Page popover (under Adjust), Settings › Page |
| Show the outline | On / Off | On | View, Page popover, Settings › Page |
| Reading mode | On / Off, per window, never stored | Off | View › Reading Mode (⌥⌘R), Page popover, ⋯ |
| Spellcheck | On / Off, plus up to 3 languages on Windows and Linux | On, the system language | Settings › Writing; Edit › Spelling |
| Smart quotes and dashes | On / Off, never inside code (Q2) | On (today) | Settings › Writing |

**Existing sandbox browsers keep today's exact look** (the `classic` state: 15 px paragraphs, 1.15 line height, a 648 px card) until they choose a style or change a setting. New browsers, the web library and desktop get the new defaults (preferences design §5.6).

**Facts that shape the implementation:**
- The default document font stays **Arial** (`document-editor.scss:45`), now named "Default (Arial)", with `"Liberation Sans", Arimo` added for Linux. The interface uses Inter. Code keeps its own monospace stack whatever the page font.
- **Bundled fonts work offline.** Fonts are subset to Latin plus Latin Extended, and loaded only when chosen, through `font-display: swap` in a small global stylesheet. They add no weight to the editor chunk. The web build serves them from `/_next/static`.
- Focus mode and typewriter scrolling are later work.

**How preferences apply**
- **CSS only.** The prefs applier writes `data-*` attributes on `<html>` (the theme stays the `.dark` class that Tailwind needs), and CSS maps them to variables. HeadingScale emits `--hd-size` in em, so headings follow text size, and size marks are in em. No plugin rebuilds.
- **Before first paint.** One boot script applies the saved values, safe on `<html suppressHydrationWarning>`. On desktop it runs by CSP hash, with values from main's preload snapshot.
- **Skeleton.** `app-skeleton.scss:70` hard-codes 648 px, so it reads the same variables. Otherwise the page would jump.
- **Outline docking** replaces the single 950 px media query (`document-editor.tsx:160`) with one rule: the outline docks when the **main area** beside the files sidebar is at least the card width + 302 px (the 270 px outline plus a 32 px gutter). Card width is `measure × text size + 96` px, computed from preferences, never measured, so nothing changes on its own. Full never docks. `classic` keeps today's 950 px. Below the threshold the outline is the overlay, closed by default.

  | Text size → | 14 | 16 | 18 | 20 | 24 | 28 | 32 |
  |---|---|---|---|---|---|---|---|
  | Narrow (30 em) | 818 | 878 | 938 | 998 | 1118 | 1238 | 1358 |
  | Standard (33 em) | 860 | 926 | 992 | 1058 | 1190 | 1322 | 1454 |
  | Wide (46 em) | 1042 | 1134 | 1226 | 1318 | 1502 | 1686 | 1870 |
  | Full | never | | | | | | |

- **Keeping your place.** After a width change, native `overflow-anchor` keeps the reading position. There is no JS anchoring on top.
- **Off-screen block heights.** `contain-intrinsic-block-size: auto` may keep stale heights. These are measured on a 1,000-heading document in the `perf` project.
- **Nothing changes width on its own.** Width changes only when you pick it.

**The web app gets** every page preference above. The sandbox has app-wide width only; the web library adds the per-document width. The web reaches them from ⋯ › Page…, the palette and a Settings dialog (W13). Under `NEXT_PUBLIC_REMEMBER_CHOICES=0` they apply for the session only, with the line "This site doesn't save settings. They reset when you reload.", and pages fall back to `classic`.

**Page popover** (library host: desktop and the web library). The sandbox's popover has no "This document" section, and its Width sets the default.

```
┌ Page ─────────────────────────────┐
│ THIS DOCUMENT                      │
│ Width (Narrow)(Standard)(Wide)(Full)│
│ Wider than your default.           │
│ [Use for all documents] [Reset]    │
│ ────────────────────────────────── │
│ ALL DOCUMENTS                      │
│ For all documents on this computer.│
│ Style  ◉ Default                    │
│        ○ Comfortable reading       │
│        ○ Compact                   │
│        ○ High legibility           │
│ Text size  [A−]  16 px  [A+]   ⌘+  │
│ ▸ Adjust font and spacing          │
│ ────────────────────────────────── │
│ ☑ Show the outline                 │
│ ☐ Reading mode               ⌥⌘R   │
│ Page settings…                     │
└────────────────────────────────────┘
```

**Owner:** P2.9c-1 (the page engine: shared, web-visible) and P2.9c-2 (choices, fonts, styles, the popover and the per-document width), both before P2.9b. The web fixes F1 (dark `--primary` contrast), F3 (System theme on the web) and F5 (link underlines) ship alongside, and W13 is the web Settings dialog. Each changes editor styles on the web too, so each needs a design review, and the engine needs a `perf` check.

---

## 5. Editor details users always ask for

These come from the request research, filtered by the staff review. Each row names its release and PR. "Shared" means the change lands in shared editor code, so the web gets it too.

| # | Detail | Today | Release | PR |
|---|---|---|---|---|
| E1 | **Find and replace** in the document: ⌘F, ⌘G and ⌘⇧G step through matches, ⌥⌘F replaces (Ctrl+H on Windows and Linux desktop; on the web, Replace is reached from the find bar only), Esc closes. Options: match case, whole word. Hits are highlighted with a decoration (rule 6). Never counts sidebar text. | Missing (the heading filter can't step or replace) | Local release, shared | **P2.11** (new) |
| E2 | **Pasted Markdown renders as formatting** when the clipboard has only plain text that parses as Markdown. ⌘⇧V still pastes plain text. A one-time hint: "Pasted as formatted text. ⌘⇧V pastes plain text." | Missing (the parser is already loaded) | Local release, shared | **P2.12** (new) |
| E3 | **Word and character count** in a status popover from ⋯ and View › Word Count. It counts the selection when there is one. Computed lazily, never on each keystroke. | Missing | Local release, shared | P2.12 |
| E4 | **Move a block** and **duplicate a block.** **Keys (v7 staff review):** the first proposal, ⌥⇧↑ / ⌥⇧↓ and ⌥⇧D, conflicts on macOS (⌥⇧↑/↓ extend the selection to the paragraph edge, and ⌥⇧D types "Î" on the US layout). It was "checked against `lib/shortcuts.ts`", but that file only formats keys and binds nothing, so the check proved nothing. **v1 call: menu-only** (Format › Move Block Up, Move Block Down, Duplicate Block). Keys can be added later, once the keymap module's duplicate-combo test (UX spec §4.6) can prove them conflict-free. | Only whole sections move | Local release, shared | P2.12 |
| E5 | **Right-to-left text:** `dir="auto"` on text blocks, plus Format › Text Direction to override (stored as a `dir` attribute; a schema bump runs through the schema rollout runbook). | Missing | Local release, shared | **P2.13** (new; SE review) |
| E6 | **Print and Save as PDF** through the OS print dialog, using a print stylesheet that hides the chrome, keeps headings with their content and expands folded sections. | No print styles | Local release, shared | P2.12 |
| E7 | **Export Markdown and HTML, and Copy as Markdown.** Images in Markdown export go to a folder next to the file. | Export missing on the web | Local release, shared | P2.8, plus P2.10 on the web |
| E8 | **Spelling suggestions** in the editor's context menu, with Add to Dictionary. | Missing on desktop | Local release | P2.9a |
| E9 | **Quick Open ignores accents and case**, and shows the folder path. It searches metadata only (D24): titles, tags, folder names and document properties, through the shared normalizer (diacritics, Arabic→Persian letter folding, Persian/Arabic-Indic digits → ASCII). Never body text. | Missing | Local release | P2.7a |
| E10 | **Make plain-text paste easier to find:** Edit › Paste as Plain Text (⌘⇧V). | Hidden | Local release | P2.9a |
| E11 | Sticky header rows in tables | Missing | Later | — |
| E12 | Focus mode and typewriter scrolling | Missing | Later | — |
| E13 | Comments | Missing | v1, with sharing (D9) | See [comments design](2026-11-16-comments-design.md) |
| E14 | Phone keyboards: revisit `autocapitalize="off"` and `autocorrect="off"` | Web issue | **Decided (v8, D36):** prose autocorrect on and `autocapitalize="sentences"`, code opts out, scoped by build target (the web library and sandbox on touch; desktop unchanged unless decided otherwise), never per render ([phones design](2026-11-16-phones-tablets-design.md) PT-D6) | M19 |

**P2.12 status (2026-11-22): part 1 merged, the row stays open.** P2.12 has no line in the rule 5 ledger, so everything it adds stays out of the editor chunk (0 B, measured against `main` at `903b5c8`: every editor JS and CSS chunk identical). The engines and the print stylesheet are built; the entry points are not yet wired:

- **E4, built (`extensions/block-move/`):** `moveBlock(editor, "up" | "down")` and `duplicateBlock(editor)`, with `canMoveBlock` / `canDuplicateBlock` for menu state. A "block" is every top-level block the selection touches (a list or table moves whole). Each run re-reads the live document and is one Yjs undo step (`stopCapturing()` before and after). The title never moves, nothing moves above it, and the title is never duplicated ("The title stays first.", "The title can't be duplicated."). Given the fold state, a folded section is one unit: a block moves past it whole, and a folded heading moves or is copied with its hidden body. A duplicated heading loses its ids, so the id plugins mint new ones. **Concurrent edits:** Yjs 13 has no move, so one side of a move is deleted and re-created, and a collaborator's typing in that side meanwhile is lost (section moves behave the same). Block move re-creates the smaller side; on a tie, the passed block, so the moved blocks keep their edits. The smaller side is re-created whole, so typing anywhere inside it (a list item, a table cell) is lost too, and typing inside the larger side is kept. Tests pin each case, nested lists and tables included.
- **E2, built (`lib/markdown/parse.ts`, shared with IM1):** `markdownPasteSlice(parser, schema, text, model)` returns a slice only when the plain text has explicit Markdown syntax (indentation alone is not) *and* parses to formatting (a bare URL is not: the link and embed rules keep it). It takes `editor.markdown` or a headless `MarkdownManager` (it lexes with its `instance` first), so it has no DOM or editor dependency. **It gives nothing an HTML paste of the same content would not** (pinned against the production extensions): inline HTML keeps only what the schema's rules keep (no script, handlers or iframes, listed embed hosts included); `![alt](url)` is the same `image` node an `<img>` HTML paste makes, from any https host, as the web already allows (`img-src https:`; desktop's remote-image handling in the image-store design applies to both paths alike); a link whose href the link extension empties (`javascript:`, `data:`) keeps its text without the link, as in an HTML paste. It returns null (plain text, as before) for Markdown with a raw HTML block, because the parser reads one against the title-first schema and makes it a level-1 heading (`<div>x</div>` → heading "x", a lone `<img>` → an empty heading), and for text over 256 KiB (`MARKDOWN_PASTE_MAX_CHARS`: it runs on the main thread). The syntax check is linear on long lines. IM1 should handle HTML blocks the same way, since `parseMarkdownFragment` has the same parser behaviour. Both take `model` (`MarkdownModel`: `Fragment` and `Slice` from `@tiptap/pm/model`) instead of importing it, so the rule can be a lazy chunk of the editor: a lazy chunk that imports a module the editor's chunk group also loads splits that group (+1,092 B gz, measured).
- **E3, built (`lib/word-count.ts`):** `countWords(doc, range?)` returns words, characters and characters without spaces for the document, or for the selection when the surface passes one. It segments with `Intl.Segmenter` (a ZWNJ stays inside a Persian word, CJK splits by dictionary, an emoji sequence is one character; engines without it count runs of non-space and code points). Block breaks separate words and are not characters. Pure and on demand: the surface calls it when it opens, never per keystroke.
- **E6, built (`styles/_print.scss`, loaded by the root layout):** hides the chrome, prints folded sections open, keeps headings with their text and unclips the scroll container. Pages without the editor (About, Privacy) print as they are. `watchPrintTheme` (`lib/print-theme.ts`, mounted by `ThemeRuntime`) removes the `dark` class on `beforeprint` and restores it on `afterprint` (a second `beforeprint` first, as Chromium sends when it rebuilds the preview, still restores it), so every token, code and highlights included, prints its light value. Electron's `webContents.print()` fires the same events. The stored preference is never touched. Folded blocks print with `display: revert`, the user-agent value. It matches each block's own display because every top-level node view's outer element is `block`: measured for paragraphs, lists, tables, images (a captioned one, whose inner figure is `display: table`, too) and Mermaid, and the media kit's layout presets all set `display: block`. The print e2e pins print against screen for those blocks; a node view with a flex or grid outer element would need its own print rule. A screen-only fold rule would not depend on that, but costs 12 B gz of editor CSS.
- **Not wired yet:**
  - **The paste hook.** The right hook is ProseMirror's `clipboardTextParser`, which receives a `plain` flag for ⌘⇧V. ProseMirror calls it synchronously, so the prop must be in the editor chunk, which needs a ledger line and therefore a budget review. **Built and measured** on `feat/p2-12-markdown-paste-hook`: the prop (`EDITOR_PROPS.clipboardTextParser`) returns nothing for ⌘⇧V, or until the rule's lazy chunk has loaded (fetched in the existing post-sync idle callback, so desktop too, where hydrating a local document counts as synced), and the text then pastes as plain text, as today. It costs **+152 B gz** of editor chunk (393,820 → 393,972 B). Alternatives measured: the same as a Tiptap extension, +160 B; the rule loaded eagerly, +636 B; the rule lazy but importing `@tiptap/pm/model` itself, +1,092 B (the group split). On desktop, Edit › Paste as Plain Text (P2.9a) must reach that `plain` path: Electron's `pasteAndMatchStyle()` sends no Shift key. Returned from `clipboardTextParser`, the slice then goes through the same `transformPasted` and `handlePaste` props as an HTML paste (UniqueID, font-size stripping, the title paste handler); no extension here defines `transformPastedHTML`, the one HTML-only step. **Open item: the owner's decision on a 152 B ledger line** (requested in #156); P2.12 cannot close without it. The one-time hint ("Pasted as formatted text. ⌘⇧V pastes plain text.") waits on the hook, and its status pill is in `components/smart-toolbar/**`.
  - **The surfaces.** Word count's ⋯ popover (and phone sheet), the ⋯ › Block items (tablet) and the Aa sheet's Block section (M22) belong to the smart-toolbar owner. Format › Move Block Up / Down and Duplicate Block belong to the desktop menu (after P2.5). Each surface loads `extensions/block-move` and `lib/word-count` lazily, and passes the fold state (block move) or the selection (word count). An import-boundary test keeps them, and `lib/markdown`, out of the editor's static graph.

**Already strong. Don't rebuild:**
- offline editing
- speed on long documents
- the outline, folding and section drag
- tables
- images
- Mermaid
- dark mode
- the first heading as title
- "Continue where you left off"
- smart quotes
- the "/" menu

---

## 6. Organizing and sorting (Local release)

### 6.1 Folders

- **Nesting:** up to 4 levels. Past that: "Folders can be nested 4 levels deep."
- **Folder actions:** New Folder (⇧⌘N in the sidebar), Rename (F2), Move to…, Move to Trash.
- **Trash:** a folder and everything in it go to Trash as one unit. Undo or Restore brings them back together, into the folder they came from. If that folder is gone, they go to the Library root, with this note: "Restored to Library because its folder was deleted."
- **Drag and drop:**
  - Folders open when you hover over them while dragging (700 ms), or at once with Space.
  - Dragging several items moves all of them or none.
  - Dropping onto the same folder does nothing.
  - Dropping a folder into its own descendant is refused: "A folder can't go inside itself."
- **Keyboard alternatives** for every drag:
  - Move to…, which lists recent destinations first.
  - Move Up and Move Down (⌥⌘↑ / ⌥⌘↓), only in a Manual-sorted folder.
- **Not in v1:** folder colours, folder icons, sidebar count badges.

### 6.2 Pinned

Documents only, in your own order (`pin_key`). Pinned is shown inline under its header, like Recent.

### 6.3 Sort, view, group, filter

| Control | Options | Default | Persistence |
|---|---|---|---|
| Sort | Title · Modified · Created · Opened · Manual, ascending or descending | Title in the tree, so rows don't jump while you type. Modified in Recent. | Per folder, local |
| View | List · Preview (title plus a 2-line snippet) | List | Per folder |
| Group | None · By date (Today, Yesterday, This week, This month, Earlier) · By folder (in Recent and Live) | None (By date in Recent) | Per folder |
| Filter bar | Title text, tag (§3), Local or Live, date range | Empty | Per window, not saved |

- **Type-to-select** works in the tree and in lists.
- **Lists are virtualized.** Targets:

  | Library size | Target |
  |---|---|
  | 1,000 documents | first paint ≤ 100 ms |
  | 10,000 documents | first paint ≤ 300 ms |

- **Search** matches metadata only (D24): titles, tags, folder names and document properties, never body text. It ignores accents, case and digit shape (the shared normalizer, search-linking design §3.2).

**Data, added in P2.6:**
- `docs` gets `pin_key`, `size_bytes`, `snippet`, `trash_group` and `trashed_from`.
- `folders` gets `sort`, `view` and `group`.
- `snippet` comes from the renderer with the append, the same way as `title`. The worker never parses Yjs.

**Owner:**
- P2.7 is split into **P2.7a** (tree, Pinned, Move to…, drag and drop) and **P2.7b** (list views, sort, view, group, filter, tags filter).

---

## 7. Review

What ships when:

| Release | Review features |
|---|---|
| **Local** | **Reading mode** (⌥⌘R, per window, never stored): a read-only view with the outline. It works through `WriteGate`, so opening a document in reading mode makes no text writes and doesn't change Modified. Comments are the one exception: reviewing while reading is the point (comments design §6.2). The editor's `view.dom` gets `aria-readonly`. **Restore from a daily snapshot** (P2.9b). |
| **Live** | An **Updated** marker on live documents someone else changed since you last opened them (in the sidebar and lists). **Version history** with a preview and a whole-version restore, in a new PR P4.8. A version is saved before a large batch of someone else's offline changes is applied; it is built in the worker from the stored update rows. |
| **v1, with sharing (D9)** | **Comments**, anchored with `Y.RelativePosition` in their own `comments` Y.Map. Full design: [comments design](2026-11-16-comments-design.md). |
| **Later** | **Show changes since you last opened**: needs a stored `Y.encodeSnapshot`, not a state vector, and deleted blocks can't be placed. **Version compare**, with Restore This Section. **Suggestion mode**, after a spike: Tiptap's own extensions are paid, and Tracked Changes is experimental. |

**Server hardening, a v1 release blocker since comments ship with sharing:**
- an allowlist of Y.Doc root maps (today every root except `default` is accepted, `hocus-document-guard.ts:262-280`)
- root checks on delete sets (today delete-only frames pass, `:422`)

---

## 8. Sharing

### 8.1 One Share button, two sections

| Section | What it does | Release |
|---|---|---|
| **Send a copy** | Export Markdown, HTML or TinyDocy document. Print or save as PDF. Copy as Markdown. The macOS Share menu (Mail, Messages, AirDrop). Note in the menu: "A copy won't get your later changes." Images travel with the copy (image store §5.4). Comments are stripped by default; "Include comments" is offered for TinyDocy documents only (comments C7). | **Local release.** The Share button exists from the start, with this section only. |
| **Invite to edit** | Makes the document live (§8.2) | Live release |

- Windows Share is deferred; it needs a native add-on in the signed app.
- There is no mailto "email a copy", because mailto can't attach files.
- The Playground can be sent as a copy, but never shared live.

### 8.2 Invite to edit (Live release)

**Consent**
- Consent happens in a **small modal window owned by main**, not a message box. A message box can't hold a name field, a terms link or inline errors.
- The document's window can't publish anything without this window.
- The size shown comes from the worker's `size_bytes` plus the document's images. The server's caps are the real check.
- If the document has comments, the window says: "Everyone with the link will see this document and its 12 comments."

**Links**
- **Two roles:** edit and view. There is no Comment role, and no expiry you can set.
- The panel shows: "Ends 30 days after the last edit (last edit: 12 Nov)."
- **The client generates the secrets (v8, S1; D40).** The 128-bit edit secret `e` and the 128-bit owner secret come from a CSPRNG: `randomBytes` in main on desktop, `crypto.getRandomValues` in the library page on the web, **never on the `/s/` handoff page**. The owner secret is generated independently and never derived from `e`. The server mints only `share_id`.
- **Derivation** (HKDF-SHA-256, empty salt, the label as `info`, 32-byte output, base64url):
  - `view = HKDF(e, "tinydocy/view/v1")` (the v5 label `tinydocy-view` is renamed before anything ships)
  - `auth_edit = HKDF(e, "tinydocy/auth/edit/v1")`
  - `auth_view = HKDF(view, "tinydocy/auth/view/v1")`
  - The server receives only `SHA-256(auth_edit)`, `SHA-256(auth_view)` and `SHA-256(owner)`; it never receives `e` or `view`. Unsalted SHA-256 is right for these high-entropy tokens. It looks a share up by `share_id` and compares with `timingSafeEqual` (plan §6).
  - Tokens are bearer tokens, sent only over TLS in a header or in the WebSocket auth message, never in a URL or a log. The fragment carries `e` (edit link) or `v` (view link), parsed by one `lib/sharing/link.ts` (S1b).
- **Label registry** (S1c): `lib/crypto/labels.ts` lists every label, with a test that labels are unique and never reused, and test vectors that Node `hkdfSync` (main) and WebCrypto `deriveBits` (web) agree on.

  | Label | Input → output | Used by |
  |---|---|---|
  | `tinydocy/view/v1` | `e` → `view` | the view link |
  | `tinydocy/auth/edit/v1` | `e` → `auth_edit` | edit connections, asset `PUT`, `missing` |
  | `tinydocy/auth/view/v1` | `view` → `auth_view` | view connections, asset `GET` |
  | (reserved) `tinydocy/sync/*`, `tinydocy/private/*` | — | device sync (D37) and private links, later (roadmap) |

- **The view secret is derived from the edit secret** (the label above).
  - Anyone holding the edit link can therefore show the view link, which matters for people who joined.
  - The server stores both hashes.
  - **Make view-only for everyone** turns off the edit hash and leaves the view secret valid.
  - **Reset link** makes new client secrets and gets a new share id: the old owner secret plus three new hashes go to `…/reset`. Both links change, and every token rotates, as intended.
- Links are shown cut short, with the secret hidden: `tiny.docs.plus/s/7f3a…`. They are copied with an explicit **Copy** button only.

**Managing the share**
- The sharer gets **Reset link…**, **Make view-only for everyone…** and **Stop sharing…**. People who joined get **Stop syncing here**.
- "Allow editing again" is cut: Reset link covers it.
- When the server has sharing turned off, Share stays visible but disabled, with the reason: "Sharing is turned off on the server right now. You can still send a copy."
- Stopping a share while offline is refused: "Connect to stop sharing. Nobody can reach your copy here, but the link still works for others."

**Handoff page**
- Nothing loads before the click, and the app is never launched automatically. Mail link scanners run scripts.
- The secret is kept **in memory only**, not in `sessionStorage`. Reopen-closed-tab and duplicated tabs would restore it, and the page shares an origin with the public sandbox.
- The link preview in chat apps is generic ("A live document on TinyDocy"). It never says edit or view.

**Presence** (new PR **P4.7**)
- An avatar row shows up to 4 people, then "+N".
- The People list says "Names aren't verified." Each person has **Go to** their cursor. Two people with the same name show as "Sam (2)".
- **Viewers are marked by the server:** P4.2b strips their cursor and sets `viewer: true` in `beforeHandleAwareness`. Today awareness has no read-only check, so viewers can broadcast cursors.
- Joins and leaves are not announced, unless the user turns that on.
- Follow mode and editing or idle statuses are later work.

---

## 9. Web app (decision D8)

**Finding:** on tiny.docs.plus, clicking ✕ on a tab permanently deletes that document for every visitor, with no confirm and no undo. The name is then blocked for 90 days (`hooks/use-synced-tabs.ts:156-175`). Data loss is the top reason people leave an editor in every source the research read.

**Recommendation:** make closing a tab a soft delete, with an Undo pill (8 s). The server keeps the document for 7 days before it is tombstoned, so it can be restored from a "Recently closed" list in the ⋯ menu.

- This is a web product change, separate from the desktop plan and from P1.1.
- If approved it becomes **W1**: one PR touching the delete route, `use-synced-tabs` and a small UI, with a Deploy note.

---

## 10. New and changed PRs (plan §8)

| PR | Change |
|---|---|
| P2.2 | Also adds `WriteGate` and the decoration-host stub, measured against its 300 B gz line in the D23 ledger (§1 rule 5), and lowers `EDITOR_CHUNK_BUDGET_BYTES` to `main` plus the ledger. |
| P2.6 | New columns (§6.3), `tags` and `doc_tags` (D7), `doc_view(doc_id, width, place, remote_images)` (D10), and the save-failure path (rule 3). **v7 amendment:** `docs.link_key` (UNIQUE; **`NOT NULL`, minted at insert since v8**, seam S16), `docs.kind` (`'doc'` or `'template'`) and `import_sources(doc_id, relative_path, source_app)` (plan D-A5). |
| P2.7a / P2.7b | Split as described in §6. |
| P2.8 | Copy as Markdown, image folders in Markdown export, front matter for tags. |
| P2.9a | The Share button with the **Send a copy** section, the macOS Share menu, spelling suggestions, Paste as Plain Text. View › Text Size, Page Width, Font, Page… and Reading Mode, with ⌘+ / ⌘− / ⌘0 stepping text size (§4). |
| P2.9b | The tag row (D7), the Can't save health state, and the Settings window's six panes (General, Page, Writing, Storage, Updates, About) with the main prefs store. |
| **P2.9c-1** (new) | The page engine (§4): preference schema and stores, boot script, CSS variables, text size, width, spacing, outline docking, reading mode, spellcheck and smart-quotes settings, `classic`. Changes web styles: design review plus the `perf` check. Lands before P2.9b. |
| **P2.9c-2** (new) | Page choices and UI (§4): fonts, letter spacing, styles, the Page popover, the per-document width. Design review. |
| **P2.11** (new) | Find and replace (E1). Shared. |
| **P2.12** (new) | Markdown paste, word count, block move and duplicate, print stylesheet (E2, E3, E4, E6). Shared. |
| **P2.13** (new) | Right-to-left blocks (E5), through the schema rollout runbook, with the languages design §4.7 extras (direction commands, Enter inherits direction, « » by script) on its 350 B gz ledger line (D23). Shared. SE review. Its exit includes the RTL specs on the `firefox` project (test strategy Q7). |
| P4.2b | Viewer awareness marked by the server. |
| P4.4 | Consent in a modal window owned by main, links with a derived view secret, the disabled state. Images upload before the link appears (image store §5.1). |
| **P4.9–P4.12** (new) | Comments: core, UI, sharing and copies, suggested replacement ([comments design](2026-11-16-comments-design.md) §12). |
| **P4.7** (new) | Presence (§8.2). |
| **P4.8** (new) | The Updated marker, and version history with preview and whole-version restore (§7). |

**Tripwire additions.** Cut these first if Gate 2 slips:
1. ~~P2.13 (right-to-left)~~ Removed from the tripwire: D26 commits right-to-left documents to v1 (call, v7).
2. Preview view and grouping in P2.7b
3. Tag colours (D7 keeps the rest of tags)
4. Block duplicate in P2.12

---

## 11. Superseded advice in the research docs

| Research doc | Superseded advice | Now |
|---|---|---|
| title-tags-page-preferences | Tags after the Live release | D7: full local tags in v1 (§3) |
| title-tags-page-preferences | Outline docking from a formula | A formula again, now on the main area beside the files sidebar: card width + 302 px, with the card width computed from width × text size (preferences design C9, §4). This replaces the fixed 1240 / 1400 / 1640 px breakpoints this spec first chose. Per-document width, fonts and spacing are back by D10 (§4). |
| title-tags-page-preferences | Title cap of 200 graphemes | 200 code units, cut back to a grapheme boundary |
| organize-sort-review | `seen_sv` for "show changes"; filtering view-only writes at the store | A stored snapshot, later; `WriteGate` in the editor |
| organize-sort-review | Show Changes in the Live release; compare with Restore This Section | Updated marker plus version history in v1; comments in v1 (D9); show changes and compare later |
| sharing-details | Secret in `sessionStorage`; view secret created separately; "Allow editing again"; presence Follow | Secret in memory only; derived view secret; Reset link instead; Follow later |
| sharing-details G5 | The server mints edit, view and owner secrets at creation | v8 (S1, D40): the client generates them; the server mints only `share_id` and stores hashes of derived tokens (§8.2) |
| desktop-ux-design §2.2 | Document body in Inter at 16 px | Default (Arial) at 16 px in rem for new users (owner Q1); existing sandbox browsers keep today's 15 px through `classic` (§4) |
| architecture §6.1 | `view_only`: "local writes filtered" | `WriteGate` (§1) |
| desktop-ux-design §8 | View › Zoom on ⌘+ / ⌘− / ⌘0 scales the whole interface | On desktop, ⌘+ / ⌘− / ⌘0 and Ctrl+wheel change document text size (§4). Interface zoom (75–200%) is in Settings › General and the palette only, with no key. The web never captures these keys. |
| this spec, first draft of §4 | Text size 13–22 px at 15; widths 552 / 648 / 864 px; Settings › Editor | Preferences design: 14–32 px at 16 in rem (owner Q1); widths 30 / 33 / 46 em; Settings › Page and Writing |

---

## 12. Owner decisions (answered 2026-11-16)

| # | Decision | Owner's answer |
|---|---|---|
| D7 | Tags | **Full tags in v1**: rename, merge and colours included (§3) |
| D8 | Web tab close | **Soft delete with Undo** (W1) |
| D9 | Comments | **Ship with sharing** ([comments design](2026-11-16-comments-design.md)) |
| D10 | Page preferences | **All of them**: fonts, spacing and a per-document width override (§4) |

Related answers from the plan:
- **D3:** the web gets a library ([web library design](2026-11-16-web-library-design.md)).
- **D4:** an image store now ([image store design](2026-11-16-image-store-design.md)).
- **D6:** one combined release.
- **D23:** the editor-chunk ledger (§1 rule 5). **D24:** metadata-only search (E9). **D25:** links between documents in v1. **D26:** English interface, translation-ready; RTL documents through P2.13. **D30:** the pre-approved cut order (plan §8.2).
- **v8:** **D36** phones and tablets fully in v1 (E14 decided). **D39** comments also in web library documents. **D40** the trimmed seams, including S1 (§8.2) and S16. **D41** the conditional phone line in §1 rule 5 and the cut-first items ahead of D30.

## 13. Calls made (recommended defaults)

**Folders and organizing**
- Folders sort by Title.
- Nesting stops at 4 levels.
- Duplicating a document leaves comments out.

**Titles and documents**
- Empty untitled documents are kept.
- The handoff page shows no title before the click.

**Sharing**
- The Share button appears in the Local release, with "Send a copy" only.
- The terms are a sentence with a link, not a checkbox.
- Only the computer that created a share can manage it.
- Stopping a share while offline is refused.
- Copies don't mention a live link.

**Review and presence**
- View-only links can read comments but not add them (comments ship with sharing, D9).
- No mentions until there are accounts.
- People are not told when they are followed (Follow is later).

**Editor**
- On desktop, the ⌘ +/−/0 keys change text size, not page zoom. The web never captures them; they stay browser zoom.
- Page and writing preferences live in Settings › Page and Settings › Writing (preferences design §4.1), not in an "Editor" pane.

---

## 14. Verification

**Prototype**
- [desktop-prototype.html](../../design/2026-11-15-desktop-prototype.html) shows every Local-release screen in §2–§8.
- Live-release screens sit behind its "Live release" toggle, and later screens behind "Later".

**Before each PR merges**
- design review with screenshots at 1440, 1100 and 820 px, in light and dark
- the keyboard checklist
- the `perf` project for anything in the shared editor
