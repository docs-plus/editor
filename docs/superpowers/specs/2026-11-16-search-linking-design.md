# TinyDocy: search and links between documents

> **Owner answers (plan v7, 2026-11-16)**, which this revision applies:
> - **D24 (Q1):** **search in v1 covers titles, tags, folder names and document properties (dates, Local/Live, template kind), not document body text** ("contents search is heavy"). Removed from v1: FTS5 and `search.sqlite`, the web `text` store, MiniSearch and FlexSearch, the renderer text extractor and its background pass, the "In documents" group and the separate Search view. Full-text body search moves to **Later (owner: not planned)**. §3 is rewritten to this scope; the old full-text design survives only as the probe evidence in Appendix A.
> - **D25 (Q2):** links between documents ship in v1, **LK1–LK5 as designed**; **LK3 `[[` is the first to cut** (D30).
> - **D23:** LK1's `linkHost` pass-through is a **60 B gz** line and LK3's `[[` a **120 B gz** line in the single editor-chunk ledger (details §1 rule 5). LK3 measures `slash-trigger` first.
> - **D30:** the pre-approved cut order puts LK3 first, LK4's hover preview fourth, backlinks sixth and links seventh (keeping the `link_key` seam).
> - **Staff integration review:** one P2.6/W2 schema amendment adds `docs.link_key` (UNIQUE; **`NOT NULL`, minted at insert, since plan v8: S16, D40**), `docs.kind` and `import_sources(doc_id, relative_path, source_app)`. Duplicate, New from Template and `.tinydoc` import always get a new `link_key`. Search, backlinks and the ⌘K picker skip `kind='template'`. Import keeps wikilinks as text and records relative paths; **LK5 adds a one-time "Link imported notes"** (§4.9).
> - **Plan v8 (D40, D41):** `link_key` is minted when the document is inserted, never lazily (S16), so two synced devices can't mint different keys later. Only a backup-zip or `library.json` restore keeps it (S8c). The editor-chunk ledger gains D41's conditional phone line (≈1,580–1,660 B in all); LK1 and LK3 keep their lines.
> - **Q3: call (v8):** (a), links never resolve for collaborators in v1. The owner can reverse this.

- **Status:** revised for plan v7, 2026-11-16 (was a proposal for owner review). Nothing here is built. **§4.2a Smart chips was approved by the owner on 2026-11-22 (C1–C9 as recommended).**
- **Amends:** architecture **D-A8** and UX spec §4.3, both updated in plan v7 to D24's metadata scope.
- **Builds on:**
  - [plan v7](2026-11-15-desktop-local-first-design.md) (D0–D32)
  - [architecture](2026-11-15-desktop-architecture.md): renderer owns the Y.Doc, storage worker in main, §5.3 tables, `jobs.ts`
  - [details spec](2026-11-15-desktop-documents-and-editor-details.md): Quick Open (E9), Find (E1, P2.11), tags (D7), §6.3 lists, §1 rules
  - [UX spec](2026-11-15-desktop-ux-design.md): §4.3 Quick Open, §4.6 keyboard map
  - [web library](2026-11-16-web-library-design.md): IndexedDB, one writer tab per document, the `md` cache
  - [comments](2026-11-16-comments-design.md) and [image store](2026-11-16-image-store-design.md): the `asset:` ref pattern and the copy rules
  - [onboarding, templates and import](2026-11-16-onboarding-templates-import-design.md): adopts §4.9 here, with the v7 change that IM1 keeps links as text and LK5 links them afterwards
- **Code read:**
  - `extensions/table-of-contents/` (`toc-id-plugin.ts`, `fast-table-of-contents.ts`)
  - `lib/heading-navigation.ts` (`goToHeading`)
  - `components/document-editor/document-editor-config.ts` (Hyperlink setup)
  - `@docs.plus/extension-hyperlink` 2.3.0 typings
  - `extensions/slash-trigger/`
  - `lib/shortcuts.ts`
- **Probes run for the first version of this document (2026-11-16):** Node 26.13.1, whose `node:sqlite` bundles SQLite 3.54.1 with FTS5. They measured full-text search, which D24 takes out of v1. The method and numbers are kept in Appendix A as evidence if full-text search is ever reopened; nothing in v1 depends on them.

---

## 0. Summary

| # | Decision | Why |
|---|---|---|
| SL-1 | **Search in v1 is metadata search** (D24): titles, tags, folder names and document properties (created and modified dates, Local/Live, template kind). **Never document body text.** | Owner decision: "contents search is heavy". Metadata is already in the index the renderer holds, so v1 search needs no new storage, no extractor and no background pass. |
| SL-2 | **One normalizer for every match** (`lib/search/normalize.ts`): NFC, strip diacritics (Latin accents, Arabic harakat, Hebrew points, tatweel), fold Arabic ي/ك to Persian ی/ک, and fold Persian and Arabic-Indic digits to ASCII. `Intl.Segmenter` **only if titles need it** (§3.2). | Accent- and case-insensitive matching in Quick Open, list filters and the ⌘K picker, the same on desktop and the web. |
| SL-3 | **Metadata operators:** `tag:`, `in:folder`, `is:live`. A small compiler (`lib/search/query.ts`) turns them into filters over the index snapshot. | Bear and Obsidian users expect operators. These three cover what metadata can answer. |
| SL-4 | **One search surface: Quick Open (⌘O)**, plus the list filter (⌘F when a list has focus, P2.7b). No "In documents" group, no Search view, no new key. ⌘⇧F stays the heading filter, scoped to the editor. | UX §4.3 already says "one search surface". |
| SL-5 | **Templates are never search results** (`kind='template'` is skipped), and neither are they backlink sources or ⌘K picker targets. | Templates are a separate list (onboarding §3). |
| SL-6 | **Document links are ordinary `hyperlink` marks** with `href="tinydocy:doc/<link_key>"`, plus an optional `#<data-toc-id>`. `link_key` is a **random 128-bit key per document**, stored in `docs.link_key`. It is never the local id, the lineage or a share id. Same-document heading links are `tinydocy:here#<data-toc-id>`. | The Y.Doc travels to the server and to collaborators when shared. A random key tells them nothing and can't be correlated with ids the server knows. No schema change, no new mark, and the extension already has `protocols`, `isAllowedUri`, `navigate`, `linkIcon` and `hovercard`. |
| SL-7 | **Link text is static.** Renaming a document never rewrites other documents. The hovercard shows the current title and offers **Use Current Title**. | The worker can't edit closed documents (it never parses Yjs), and rewriting a shared document would publish a private title. |
| SL-8 | **Backlinks** need a list of each document's outgoing links. With the text pass gone (D24), a **links-only pass** in the renderer (`lib/links/extract-links.ts`) emits them on idle and close, into a derived **`links` table** (desktop) or store (web), **outside any search index**. They show in a **Linked from** section after the last block, collapsed. **Unlinked mentions and a graph view: later.** | Kept for D25, not for search. It reads only `hyperlink` attributes, never body text, and has no background backfill (§5). |
| SL-9 | **Inserting a link:** ⌘K Link gains a **Documents** section (lazy popover, 0 eager bytes). Typing `[[` opens the same picker (LK3, 120 B gz ledger line, cut first). | The editor chunk is governed by the D23 ledger. |

**v1 vs later at a glance**

| v1 (Gate 5) | Later |
|---|---|
| Metadata search, desktop and web library: titles, tags, folder names, properties; operators `tag:`, `in:`, `is:live`; accent-, case- and digit-insensitive | **Full-text body search (owner: not planned):** FTS5, a web text index, In documents, a Search view, `"phrases"`, `-exclude`, search in comments |
| Quick Open over metadata; the list filter (⌘F in a list) | Search and replace across documents (request #4) |
| Document and heading links: ⌘K Documents, Copy Link to Heading, `tinydocy:here#` links, hovercard, broken states | `[[` if LK3 is cut (D30); block links; embeds or transclusion |
| Linked from section, Links to This Document | Unlinked mentions (they need body search); local graph |
| Export rewriting; "Link imported notes" for imported wikilinks | Links resolving for collaborators who hold the same document (Q3) |

---

## 1. What exists today

| Fact | Where | Consequence |
|---|---|---|
| Heading ids are `crypto.randomUUID()`, kept unique, mirrored to `id`. No `getId` is configured, so they aren't slugs. Empty headings have none. | `toc-id-plugin.ts:46`, `fast-table-of-contents.ts:74`, `document-editor-config.ts:238` | A heading link survives edits to the heading's text, section moves and folding. It reveals nothing. It breaks only when the heading is deleted, or emptied and retyped. |
| `goToHeading(editor, id, block)` unfolds, places the caret, scrolls one frame later, and returns false when the heading is gone | `lib/heading-navigation.ts` | Heading-link navigation reuses it unchanged. |
| The Hyperlink mark has attributes `href, target, rel, class, title, image`, and options `protocols`, `isAllowedUri`, `navigate(href, {newTab})`, `linkIcon` (sync), `hovercard { fetchMetadata, shouldShow, render }`, and BYO popovers | extension-hyperlink `dist/index.d.ts` | Document links need no new mark and no upstream change. The hovercard is off today. |
| ⌘O is Quick Open, titles only, ≤ 16 ms from the renderer's index snapshot. ⌘⇧F is the heading filter. ⌥⌘F is Replace. ⌘K is Link. | UX §4.3, §4.6 | v7: metadata search (tags, folders, properties) joins Quick Open (D24). No separate search surface. |
| `docs.snippet` and `title` ride on appends. The `.md` mirror and the web `md` cache come from the renderer on idle and close. | architecture §5.1, §5.4; web library §2.2 | The links-only pass for backlinks (§5) follows the same rule. |
| The editor chunk is governed by one ledger (D23, ≈1,540 B gz; ≈1,580–1,660 B after D41): LK1's `linkHost` has 60 B gz and LK3's `[[` 120 B gz. `slash-trigger` must stay under 1,000 B gz with its host. | details §1 rule 5; AGENTS.md | Everything here is lazy or host-supplied, except those two measured lines. |
| `docs.lineage` is sent to the server for shares (`shares.lineage`). P2.5's deep link is `tinydocy://local/<uuid>`. | plan §6, P2.5 | Neither may appear in a document link. |

---

## 2. Prior art

| Product | Search | Links and backlinks | What we take |
|---|---|---|---|
| **Obsidian** | ⌘⇧F search pane. `file:`, `path:`, `content:`, `tag:`, `line:`, `block:`, `section:`, `task:`, `match-case:`, quotes, `-`, `OR`, `/regex/`. Sort by name or time. | `[[` autocomplete, `[[Note#Heading]]`, `[[Note#^block]]`, `[[Note\|alias]]`, links to missing notes create them, optional auto-update on rename. Backlinks pane with linked and unlinked mentions, optionally at the bottom of the note. Page preview on hover, needing ⌘ while editing. | `section:`-level hits (our rows are sections), quotes and `-`, heading links, backlinks at the end, ⌘-hover preview in the editor |
| **Notion** | ⌘K/⌘P search with filters: Title only, Created by, Teamspace, Date | `@`, `[[` or `+` to link a page. Backlinks are "created automatically every time you @-mention a page", shown under the title as "{#} backlinks". | `[[` as the trigger, filters as chips |
| **Bear** | `"phrase"`, `-word`, `OR`, `#tag`, `@title`, `@today`, `@untagged`, `@code`, `@backlinks`, `@wikilinks` | Wikilinks, backlinks | Operator style, `@title` = our title group |
| **Apple Notes** (iOS 17+) | Notes-list search | Add Link searches note titles as you type | ⌘K with a document search, not a new dialog |
| **Logseq / Roam** | Global search | Linked references at the page bottom. Unlinked references start collapsed, and users ask for a filter and a link-all action. | Collapsed Linked from section; unlinked mentions later, with a Link action |
| **Google Docs** | Drive search | The link dialog lists bookmarks in the document | Headings of this document in the ⌘K picker |

Sources in §13. **v7:** the search columns are background for later full-text search (D24); v1 takes only the operator style (`tag:`, Notion's filters as chips) for metadata.

---

## 3. Search: metadata only (D24)

### 3.1 Scope

- **Searched,** in library documents on desktop and in the web library:
  - the **title** (the first heading, as the index already stores it)
  - **tags** (D7)
  - **folder names**, and the folder path a document sits in
  - **document properties:** created and modified dates, Local or Live, and template kind
- **Not searched in v1:**
  - **document body text**, including headings below the title, table cells, code and captions (D24). Find (⌘F, P2.11) searches inside the open document.
  - comments
  - templates (`kind='template'`): they live in their own list (onboarding §3)
  - the public sandbox: it keeps Quick Open over tab titles, and nothing changes there
- **Trash:** excluded unless `in:trash` is used. A trashed document still shows in Quick Open when nothing else matches (UX §4.3).

### 3.2 The normalizer (`lib/search/normalize.ts`, shared)

One pure function, versioned as `NORMALIZER_VERSION`, applied to every indexed string and every query term:

1. `normalize("NFC")`, then lower case.
2. Strip diacritics: Latin combining marks (so "Café" matches `cafe`), Arabic harakat and Quranic marks (U+064B–U+065F, U+0670, U+06D6–U+06ED), Hebrew points and cantillation (U+0591–U+05C7), and tatweel (U+0640).
3. Fold Arabic ي → ی and ك → ک. Persian and Arabic keyboards type different code points for the same letter, so a title pasted from an Arabic source would otherwise never match a Persian query.
4. Fold Persian (U+06F0–U+06F9) and Arabic-Indic (U+0660–U+0669) digits to ASCII, so "۱۴۰۳" and "1403" match.
5. ZWNJ (U+200C) is kept inside words and treated as a separator only between query terms.

- **`Intl.Segmenter` only if titles need it.** Titles are short, and Quick Open already matches word prefixes, then substrings (UX §4.3), which finds 東京 inside 東京都の計画 without segmenting. If testers report misses in CJK or Thai titles, word segmentation joins step 5. Baseline since April 2024 (Firefox 125).
- **The matcher** stays the one in UX §4.3: word-prefix matches first, then substring, ties to the most recently opened. Matched characters are bold, mapped back to the original string, so "Café" keeps its accent on screen.
- **Right-to-left:** every row renders the title in `<bdi dir="auto">` (languages design §4.6).

### 3.3 Query operators (`lib/search/query.ts`, shared)

| Input | Meaning |
|---|---|
| `budget plan` | titles, tags or folder names containing every word, each as a prefix |
| `tag:finance`, `tag:"two words"` | has this tag (D7) |
| `in:Drafts`, `in:"Work/Q4"` | in this folder or below it |
| `in:trash` | include Trash |
| `is:live` | shared or joined documents (Live milestone) |

- **The compiler** tokenizes the string, normalizes each term (§3.2) and returns a filter over the index snapshot. It never builds SQL from user text; on desktop the `index.searchTitles` fallback binds terms as parameters.
- **Unknown operators** (`foo:bar`) are matched as plain text.
- **Only filters, no words:** lists the matching documents sorted by Modified.
- **Property test:** 50,000 random strings, including quotes, colons, parentheses and RTL marks. The compiler never throws.
- **Later, with metadata only:** `before:` / `after:` on dates, `is:pinned`. With body text: phrases and `-exclude` (not planned).

### 3.4 Where it runs

| | Desktop | Web library |
|---|---|---|
| Source | The renderer's index snapshot (`DocumentIndex`), which already holds titles, folders, tags and properties | The library's index in memory, from the IndexedDB `docs`, `folders` and `doc_tags` stores (W2) |
| Large libraries | `index.searchTitles` in the worker above 5,000 documents (UX §3.2), matching normalized `title`, folder names and tags | the same filter over the in-memory index |
| New storage | none | none |

No extractor, no background pass, no `search.sqlite` and no `text` store. Search is current the moment the index is: a rename, tag or move shows up on the next keystroke.

### 3.5 Performance targets (exit criteria for SR1)

| Measure | 1,000 docs | 10,000 docs |
|---|---|---|
| Quick Open, keystroke to paint | ≤ 16 ms (UX §3.2) | ≤ 16 ms, or the `searchTitles` fallback |
| List filter, keystroke to paint | ≤ 100 ms (P2.7b) | ≤ 100 ms |

### 3.6 UI

**Quick Open (⌘O)** keeps the UX §4.3 layout. Additions:
- A row whose match is in a **tag or folder name** rather than the title shows the matching tag or the folder path with the match bold.
- Operators show as removable chips in the field, with `tag:` autocompleting tag names.
- The no-match line reads: "Search looks at titles, tags and folders, not inside documents."
- There is no "In documents" group and no "All results" (⇧↵).

**List filter** (P2.7b): ⌘F when a list or the tree has focus opens the filter bar. It uses the same normalizer and operators, limited to the current list.

**Web library:** the same components, with no sandbox change.

### 3.7 Privacy

- Nothing new is stored: search reads the index that already exists.
- Queries are never sent anywhere and never logged; diagnostics report counts and timings only.
- Collaborators see nothing of your library's titles, tags or folders.

### 3.8 Removed from v1 by D24 (for the record)

The first version of this document designed full-text search: a renderer text extractor and a background backfill, FTS5 in a separate `search.sqlite`, a web `text` store with MiniSearch (FlexSearch as fallback), an "In documents" group in Quick Open, a Search view with snippets, phrase and exclusion operators, and FTS5 and `Intl.Segmenter` checks in the D-A12 smoke test and the S2 spike. All of it is out of v1 and listed under Later (owner: not planned). The probes that measured it are in Appendix A.

---

## 4. Links between documents

### 4.1 Storage

| Link | `href` | Resolves |
|---|---|---|
| To a document | `tinydocy:doc/<link_key>` | in your library, by `docs.link_key` |
| To a heading in another document | `tinydocy:doc/<link_key>#<data-toc-id>` | the document, then `goToHeading` |
| To a heading in this document | `tinydocy:here#<data-toc-id>` | in whatever copy you have open: duplicates, sent copies, shared and joined copies, everywhere |

**`link_key`:**
- 32 lowercase hex characters (128 random bits), created with the document.
- Stored in `docs.link_key` (UNIQUE, **`NOT NULL`**). **Added by the v7 P2.6/W2 schema amendment** (plan D-A5), next to `lineage`, so no migration is needed. **Minted at insert, never lazily** (v8, S16): every create, import and template path writes it in the same operation that inserts the row.
- **Always a new key** for Duplicate, New from Template and `.tinydoc` import (staff integration review), so a copy never answers links meant for its original.
- **Templates** (`kind='template'`) are never link targets: the ⌘K picker skips them.
- **Never derived from** `id`, `lineage` or a share id. A collaborator who sees it learns nothing, and the server can't join it to `shares.lineage`.
- **Carried by** Export all (`library.json`), so moving a library desktop → web through the backup zip keeps links working. *(v7: a single `.tinydoc` import always gets a new key, so the `TINYDOC2` header no longer needs to carry one.)*
- **Collision:** an import whose `link_key` already exists here gets a new key, and links to it then resolve to the existing document (§4.9).

**Why a mark and not a node.** Notion-style mentions are atomic nodes whose label updates from the title. We don't do that:
- The label update is a write into every linking document, which the worker can't make.
- In a shared document, that write would publish the new title to collaborators.
- A mark keeps the text editable, copy-pasteable and undoable like any link. It needs no schema bump.
- *(Approved 2026-11-22, C1: §4.2a adds a smart chip node next to the mark. It keeps both reasons above, because the chip's title is resolved only when it renders and never written.)*

**Parsing:**
- A strict regex in `lib/links/doc-link.ts`: `^tinydocy:(doc/[0-9a-f]{32}|here)(#[0-9a-f-]{36})?$`. Anything else is not a document link.
- The Hyperlink extension gets `protocols: [{ scheme: "tinydocy", optionalSlashes: true }]` and an `isAllowedUri` that accepts `tinydocy:` only when it parses.
- `navigate(href)` intercepts every document link. It is **never** passed to `window.open` or `shell.openExternal`.
- These options come from the host through one prop (`linkHost`), with a no-op default. That is a pass-through in the editor chunk, measured in LK1 against its **60 B gz ledger line** (D23), and its logic is lazy.

### 4.2 Inserting a link

**⌘K Link (LK2).** A host-supplied `createHyperlink` popover wraps the default one:

```text
┌───────────────────────────────────────────┐
│ ⌕  q4 bu                                   │  ← URL or a title
├─ Documents ───────────────────────────────┤
│ ▸ Q4 budget              Library › Finance │
│   Q4 budget › Travel                       │  ← headings of the top match
│   Q4 budget › Approvals                    │
├─ In this document ────────────────────────┤
│   Budget assumptions                       │
├───────────────────────────────────────────┤
│ ↵ Link   ⇥ Headings   esc Cancel           │
└───────────────────────────────────────────┘
```

- **Typing a URL** behaves exactly as today.
- **Typing anything else** lists documents by title, with the Quick Open matcher and the shared normalizer (§3.2), and the headings of this document. Templates are never listed.
- **⇥ on a document** lists its headings:
  - from the live outline store, for this document
  - **for closed documents: source not decided (v7).** The search index that held them is removed by D24. The options are to load that one document on ⇥ and read its outline (no stored index, a measured cost per ⇥), or to offer only whole-document links to closed documents in v1. LK2 measures the first and the owner or LK2's reviewer picks.
- **With a selection,** the selection becomes the link text. **Without one,** it inserts:
  - the document's title
  - "Title › Heading" for a heading in another document
  - "Heading" for one in this document
- **This is one undo step.**
- **The first time a document link is inserted, a one-time hint:** "Link text is part of the document. If you share it, people see the text but can't open your documents."

**`[[` (LK3, cut first).** Typing `[[` in a paragraph opens the same picker inline:
- The query is ordinary text, as in the "/" menu.
- Enter replaces `[[query` with the link.
- Esc leaves the typed text.
- Typing `]]` closes it without linking.
- `#` inside the query switches to headings. `[[#` shows headings of this document.
- It never triggers in code blocks, inline code, or titles.
- **Budget gate:** implement it as a second trigger string inside `slash-trigger.ts` (same state shape, plus a `kind`). **LK3 first measures `slash-trigger` as it is on `main`.** Ship only if the eager cost fits its **120 B gz ledger line** (D23) and `slash-trigger` + `SlashMenuHost` stays under 1,000 B gz. Otherwise ⌘K and the "/" item cover it. LK3 is first in both cut orders: the ledger's (D23) and the schedule's (D30).

**Other ways in:**
- "/" menu item **Link to Document** (opens the ⌘K picker)
- Outline context menu **Copy Link to Heading**
- Document ⋯ and the file tree's context menu **Copy Link to Document**, which copies `tinydocy:doc/<key>` for pasting into another document
- **Pasting** a `tinydocy:` href autolinks it like any URL
- Dragging a document from the sidebar into the text is **later**

### 4.2a Smart chips

> **Status: approved by the owner, 2026-11-22 ("I approve those smart-chips"): C1–C9 as recommended.** Nothing here is built yet; LK2 builds it after LK1 (#154) merges. The decisions are in the table at the end of this section.
> - **Polish round (2026-11-22):** one refinement pass on the approved design, accessibility first. C1–C9 are unchanged. It reconciles the states with the approved linking decisions Q4–Q7 (#163): one **Not available** state, `FileMinus` for In Trash, `Hash` for `here#`, and a card that is the Q7 preview. §4.6, §7 and §8 on this branch still show the text from before Q4; #163 owns those hunks, and this section follows its approved text.
> - **Chip colour and corner (2026-11-22):** the owner asked for chip colour as an app preference the user can change, and for a less round corner. The corner is `--radius-sm` (owner, 2026-11-22). The colour preference is **C10**, the coordinator's call, pending the owner's sign-off: see [Chip colour (preference)](#chip-colour-preference).
> - **Prototype:** [`docs/design/2026-11-22-smart-chips-prototype.html`](../../design/2026-11-22-smart-chips-prototype.html). It is self-contained (lucide 0.469.0 is its only dependency) and has an Accessibility panel that shows each element's role, name and state. Its default scene is 15 px at leading 1.15, the tightest line the app ships. A Chip colour control in its toolbar switches every scene live.
> - **Screenshots:** [`docs/design/2026-11-22-smart-chips/`](../../design/2026-11-22-smart-chips/): 67 numbered headless captures (01–53 and 58–67 in Chromium, 54–57 in Firefox and WebKit) and 12 before/after pairs (`p01`–`p11` from the polish round, `p12` for the corner).
>   - 01–57 and `p01`–`p11` predate C10: they show the pill corner and the Neutral fill.
>   - 58–67 and `p12-radius-after` show the `--radius-sm` corner, with Blue (the default) unless the caption names another colour.
> - **Facts checked on `main` (903b5c8) and LK1's branch:**
>   - `CLIENT_SCHEMA = 2`, `SCHEMA_FLOOR = 2`, and `DOC_MIGRATIONS` is empty, so `DOC_SCHEMA` is 0.
>   - `createSchemaGuard` sits in `document-editor.tsx`, so it covers every session type.
>   - The hyperlink extension binds `Alt-Enter` and exports `openPreviewPopover` and `focusPreviewFromKeyboard`.
>   - LK1's `LinkHost` has no `extensions` field yet, and `lib/links/` exists only on `claude/feat-lk1-doc-links` (#154).
>   - The desktop spec (its "Schema floor for shares" row and P4.2 (d)) already requires `CLIENT_SCHEMA` 3 for share documents from day one.

**What it is.** A smart chip is an inline pill, as in Google Docs. It shows a document's icon and its **current** title, and updates when the document is renamed. Broken or missing targets get their own state. You can insert one from the "/" menu, from the ⌘K picker, by pasting a `tinydocy:` link, or by converting an existing link.

**Model: an inline atom node, `docChip { href, label }`, supplied by the host chunk.**
- The title is resolved when the chip renders, from LK1's `resolve.ts` snapshot. **No code path ever writes a title into Yjs.**
- `label` is the title at insert time. It is the fallback for collaborators, unresolved chips and exports.
- **Rejected: a mark with CSS or a decoration showing the live title.** Showing a live title over stored text hides real characters. The caret, IME, Find and the accessible name would then disagree with the screen, which fails the accessibility priority.
- **Amends §4.1, SL-6 and SL-7** (decision C1) and keeps both of their reasons: renames write nothing, and nothing new is published.

**Where chips exist: library documents only** (desktop, the web library, and later `share:*`).
- The sandbox editor has no host, so it never knows `docChip`.
- The sandbox Hocus never allowlists `docChip` for sandbox names, and `SCHEMA_NODE_NAMES` stays unchanged. A hostile update therefore can't freeze `playground`: ingress refuses it with `schema_rejected`.
- Shares get `docChip` through the share schema floor at `CLIENT_SCHEMA` 3, which is already planned (desktop spec, P4.2 (d)): share documents accept only the nodes and marks that `minDesktopSchema` knows. P4.2f-1's per-kind root allowlist is unaffected, because a chip lives in the `default` root.
- **Rollout order** follows the schema rollout runbook (`textColor`, `fontSize`): clients learn the name first, and the server allows it later, here in P4.2.

**v1 scope**

| v1 | Later |
|---|---|
| Chips for whole documents and `here#` headings | Chips for headings in other documents, which wait for the open question in §4.2 |
| Inserting from ⌘K, "/" (through the picker), paste, and conversion both ways | `[[` (LK3, still first to cut), an `@` trigger, documents listed inline in "/" |
| Every §4.6 state, offline | Dragging from the sidebar |
| Library only; the sandbox renders nothing new | Web-address chips (host only, never fetched automatically), people and date chips, Find matching chip titles |

#### Node

- `docChip`: `inline`, `group: "inline"`, `atom: true`, `selectable: false`, `draggable: false`, `marks: ""` (C9).
- **Attributes:**
  - `href` must pass `parseDocLink` and is at most 256 B.
  - `label` is clamped to 200 code points at a grapheme boundary (`Intl.Segmenter`), so an emoji or a letter and its ZWNJ (U+200C) are never split. Bidi control characters are stripped; ZWNJ is kept.
- **Never allowed** in the title (blocked in `can()`, on insertion and on paste), in code blocks or in inline code.
- **`renderText` and `leafText` give the label.** Test this: the outline, the snippet and the tab title all read it.
- **Selection model: `selectable: false`.**
  - One arrow press passes the chip.
  - Typing can never replace a chip that only looked focused.
  - So there is no NodeSelection ring, no "Enter on a selected chip" rule and no Enter guard.
- **Click, tap and selection (polish M7):**
  - `.doc-chip { user-select: none; -webkit-touch-callout: none }`, so a tap or a drag never selects the title's characters.
  - A `handleClickOn` collapses the selection to the nearer side of the chip (RTL-aware), then opens the card.
  - Selection endpoints that fall inside a chip resolve to include it.
  - A long-press only selects. It never opens the card or navigates.
  - The chip plugin adds a `Decoration.node` with the class `is-in-selection` to every chip inside the selection: the selection fill, and under forced colours Highlight with HighlightText (the icon too).

#### What is displayed

- The text is `resolveDocLink(href, snapshot).title`, set with `textContent`. It falls back to `label`, then to "Document".
  - A resolved title that is empty shows the existing "Untitled". An unknown target still shows "Document".
- For `here#` chips, the text is the live heading text from the outline store. If that heading is gone, the chip shows its `label` (polish M13).
- **Renames repaint the chip's DOM only.** Never dispatch a transaction for one.
- **One registry and one index subscription per host,** coalesced with rAF.
  - Write to the DOM only when the state or the title changes.
  - Remove the chip from the registry in `destroy()`.
- Use vanilla DOM node views, never `ReactNodeViewRenderer`.

#### DOM

```html
<span class="doc-chip" role="link" contenteditable="false" data-link-state="resolves">
  <span class="doc-chip-icon" aria-hidden="true"><svg focusable="false">…</svg>&#x2060;</span><bdi dir="auto">Q4 budget</bdi><span class="doc-chip-suffix" lang="en">, document</span>
</span>
```

- **No `href` in the editor DOM,** so `tinydocy:` never reaches the browser or an OS handler.
- **The name comes from the DOM text.** There is no `aria-label` and no `title` attribute.
- **The suffix carries `lang`,** the interface language, because it is interface copy; the title keeps its own direction in `<bdi dir="auto">`.
- **Tab stops:** no `tabindex` while editing; `tabindex="0"` when not editable (reading mode or read-only).
- **Re-run `parseDocLink` on every render.** Anything that fails renders in the `unknown_form` state and never navigates.
- **Prototype findings (Chromium, headless, 2026-11-22). They change the package's markup in three places:**
  1. **The icon and U+2060 share one `aria-hidden` wrapper.** With U+2060 as a bare child of the chip, Chromium kept it in the accessible name, as a leading invisible character.
  2. **The icon is out of flow.** An in-flow `<svg>` is an atomic inline, and Chromium allows a line break after it even before U+2060. The icon was then stranded at the end of a line with its title on the next.
     - `.doc-chip-icon` is a `position: relative` inline that reserves the icon's width with `padding-inline-end: 1.25em`.
     - The `<svg>` is `position: absolute` at `inset-inline-start: 0`.
     - Measured: no stranded icon at 14, 16, 20, 24 or 32 px, in LTR or RTL, across 56 widths (Chromium, Firefox and WebKit).
  3. **The suffix is inline** (polish M6): `.doc-chip-suffix { font-size: 0; line-height: 0; white-space: nowrap }`. The name is "Q4 budget, document".
     - The polish review found that the earlier out-of-flow `.sr-only` suffix breaks IME composition after a chip in Chromium and Electron. It also made Chromium compute "Q4 budget , document".
     - Measured in the prototype: the exact name in Chromium's native accessibility tree (CDP `Accessibility.getFullAXTree`), and Playwright's computed name (`ariaSnapshot`) in all three engines. WebKit's native tree is not checked yet: if WebKit in the real editor drops a zero-size suffix from the name, fall back to an inline-block 1 px `clip-path` suffix.

#### States

LK1's `DASHED_LINK_STATES` drives both links and chips.

| State | Icon | Border | Text | Hidden suffix (the name is "Text" + suffix) |
|---|---|---|---|---|
| resolves | FileText | solid | title, or `label` | ", document" ("Q4 budget, document") |
| pending (`!snapshot.ready`) | FileText | solid | `label` | ", document" |
| `here` | Hash | solid | heading, or `label` when the heading is gone | ", section" |
| in_trash | FileMinus | solid | title | ", document, in Trash" |
| not_available (**Not available**; replaces deleted and not_in_library) | FileQuestion, `currentColor` | dashed | `label`, or "Document" | ", document, not in your library" |
| unknown_form | FileQuestion | dashed | `label` or "Link" | ", needs a newer version of TinyDocy" |

- **Not available card:** heading "Not available"; copy "This document isn't on this device. It may have been deleted."; no title, no key; [Remove Link] when editable.
- The not_available suffix matches the approved link-icon name ("Not in your library"), so a link and a chip pointing at the same target read the same.
- **A `here#` chip whose heading is gone** uses the approved "Heading gone" semantics: Hash, solid border, its `label`. A follow goes to the top of the document with the existing pill ("The section this link pointed to was removed."), announced. It is never a silent no-op, and there is no dashed state for it.
- **Pending:** a follow queues until the snapshot is ready, then opens. The pending card shows only [Copy Link] in its first group.
- None of these ever shows a `link_key`, and no state icon is red: state is never shown by colour alone.
- The pending state never flashes a dashed border, and a cold start announces nothing.
- Card copy and actions follow §8 as amended by Q4 and Q7 (#163). On a chip, **Remove Link** leaves the `label` as plain text.
- **Cascade to LK1 (outside this document):** drop `deleted` and `purgedKeys`, rename the state key to `not_available`, use `FileMinus` for `in_trash` and `Hash` for `here`.

#### Visual

- **The line box never grows.** The chip is `display: inline`.
  - The prototype measured a line with a chip, and a line with a dashed chip, against a plain line at 14, 15, 16, 20, 24 and 32 px and at leading 1.15, 1.6 and 1.8.
  - In all 18 combinations, all three lines had the same height, in Chromium, Firefox and WebKit.
- **Paint fits the line** (polish M11). Without it, at 15/1.15 a chip fragment painted 20 px on a 17.25 px line and overlapped the lines above and below.
  ```css
  @supports (text-box: trim-both cap alphabetic) {
    .doc-chip { text-box: trim-both cap alphabetic; padding-block: .06em .22em }
    .doc-chip:dir(rtl) { padding-block-end: .30em }
  }
  ```
  - Outside `@supports`, `padding-block` stays 0. Under `@media print` the trim and the padding are reset.
  - Measured: every fragment's `getClientRects()` height is at most the line height + 0.5 px at 15/1.15 in a paragraph, an h1 and a list item (16.75 px on 17.25 px), and also at 14/1.15, 24/1.15 and 16/1.6, in headings, lists, tables and quotes, in Chromium, Firefox and WebKit.
- **Sizes are in em.**
  - The icon is 1em.
  - `padding-inline` is 0.3em at the start and 0.45em at the end.
  - The border is `max(1px, .0625em)`.
- **Shape:** `border-radius: var(--radius-sm)`, the app's small radius (`calc(var(--radius) * 0.6)`, 0.27rem, about 4.3 px), not a pill (owner, 2026-11-22: the pill looked too round).
  - It is in rem, so it stays about 4.3 px at every text size: subtly rounded at 15 px, nearly square at 32 px.
  - With `box-decoration-break: slice`, a wrapped title rounds only the first fragment's start corners and the last fragment's end corners. The breaks stay square (`p12-radius-after`).
- **Colour:** an opaque fill, a border and a tinted icon and text from the chip colour preference (C10, [below](#chip-colour-preference)). Blue is the default. Neutral is the approved look: the `--secondary` fill, `--foreground` text and a `--muted-foreground` border.
- `font-weight: inherit`, so a chip in a heading is as bold as the heading.
- **Hover and active:** `--doc-chip-hover` and `--doc-chip-active` fills, and `--doc-chip-border-strong` (`--foreground`) for the open state below.
- **Wrapping:** titles wrap rather than truncate: `box-decoration-break: slice` (Firefox drew three whole pills for one chip with `clone`) and `overflow-wrap: anywhere`. `bdi { word-break: keep-all }` keeps CJK titles from breaking between every character. Only logical properties are used.
- **Two chips side by side** get `margin-inline-start: .25em` on the second, through a plugin class (`is-after-chip`). A `.doc-chip + .doc-chip` selector would also match chips with text between them, because ProseMirror's text nodes are bare text.
- **Tokens** are `--doc-chip-*` in the lazy `lib/links/doc-links.css`, never `--tt-*`.
- **Focus:** a 2 px `--focus-ring` outline with `outline-offset: 2px` on `:focus-visible`. While the chip's card is open, the chip uses `--doc-chip-border-strong` and the active fill, not a ring.
- **Selection:** `is-in-selection` (above) paints the selection fill and replaces the chip colour.
  - The text and icon go Neutral (`--muted-foreground` icon), and the border becomes `--foreground`.
  - A chip's fill differs from the selection fill by only about 1.3:1 in every colour (Neutral included; in dark, the Blue fill #1c2c41 against the selection #203b68 is 1.27:1). The strong border is what shows a selected chip.
- **Forced colours:**
  - Canvas fill, with LinkText text and border.
  - Broken states switch to dashed CanvasText.
  - The ring and the open state use Highlight.
  - A chip in the selection is Highlight with HighlightText text, border and icon.
  - Every chip colour collapses to these system colours: the colour mapping sits inside `@media (forced-colors: none)`.
- **Reduced motion:** no transitions.
- **Print:** the chip becomes plain title text.
- **Reflow at 320 px (WCAG 1.4.10, polish M10):**
  - The card is `min(22rem, 100vw - 16px)` wide, and the picker `min(460px, 100vw - 16px)`.
  - The card becomes a bottom sheet by width (`max-width: 30rem`), not by device.
  - The sheet has a 44 px Close button and `aria-modal="true"`, the editor behind it is `inert`, and it is positioned from `visualViewport`, so the on-screen keyboard never covers it.

#### Chip colour (preference)

> **C10: the coordinator's call, pending the owner's sign-off.** The owner, 2026-11-22: "for smart chips, it would be good to come up with color (but let's control the chips color in prefrence of the app and let user to change it)".

**What it is**
- **One app setting, per device: Chip colour.** The choices are Neutral, **Blue** (the default), Green, Amber, Rose and Teal.
  - There is no purple or indigo (house rule).
  - Blue is the default because a soft blue tint says "this is a link to a document". Its hue (255) is the text link's (`--link`, 258), so chips and text links read as one family.
- **Local only.**
  - It lives in the prefs store: `tinydocy-ui` slot `chipColor` on the web, `prefs.chipColor` on desktop.
  - It is never in Yjs, a `.tinydoc` or an export, and never shared, so every reader sees their own choice.
  - Under `NEXT_PUBLIC_REMEMBER_CHOICES=0` it applies for the page session only, like every page setting.
- **Only where chips exist:** desktop and the web library. The sandbox has no chips, so it never shows the setting.
- **Out of scope: a colour per chip or per document.** One global setting keeps chips simple and writes nothing to Yjs. A per-chip colour would be a stored attribute and need marks-style contrast checks (C9).

**How it applies**
- **The boot script sets `data-chip-color` on `<html>` before first paint,** and only when the choice isn't Blue.
  - No attribute means Blue, as for #161's other attributes (no attribute means the default). Blocked storage and the kill switch also give Blue.
  - Nothing flashes: chips render only after the host chunk, and its CSS carries the mapping.
- **The lazy `lib/links/doc-links.css` maps the attribute to the tokens,** in light and dark: `--doc-chip-bg`, `--doc-chip-fg`, `--doc-chip-border`, `--doc-chip-icon`, `--doc-chip-hover` and `--doc-chip-active`.
  - Blue sits on `:root` and `.dark`. Each other colour has its own `[data-chip-color]` rule, and Blue has one too.
  - The attribute selector works on any element, so each swatch in the control renders its own colour.
  - The mapping sits inside `@media (forced-colors: none)`, so forced colours always get the system colours.
- **Changing it re-applies through the prefs runtime** (`lib/prefs/runtime.ts`), in this tab and in other tabs. Chips repaint through CSS alone: no node-view work and no transaction.

```css
@media (forced-colors: none) {
  :root, [data-chip-color="blue"] { --doc-chip-bg: oklch(0.958 0.03 255); --doc-chip-fg: oklch(0.4 0.13 255); /* … */ }
  .dark, .dark[data-chip-color="blue"], .dark [data-chip-color="blue"] { --doc-chip-bg: oklch(0.29 0.045 255); /* … */ }
  [data-chip-color="green"] { /* light */ }
  .dark[data-chip-color="green"], .dark [data-chip-color="green"] { /* dark */ }
  /* neutral, amber, rose and teal the same way */
}
```

**Tokens**
- **The border keeps Neutral's lightness** (L 0.556 light, 0.708 dark), so its contrast against the page and the highlights stays close to Neutral's. The fill stays near `--secondary` (about L 0.96 light, 0.29 dark).
- **The text is lighter than Neutral's,** so it can carry the tint: L 0.4 against Neutral's 0.145 in light, and 0.92 against 0.985 in dark. The icon sits at L 0.5 and 0.76.
  - This is the one trade-off: text contrast falls from 14.74 to 6.45–7.10 in light (10.37 to 8.19–8.23 in dark). It stays above AA (4.5) and below AAA (7) for some colours in light.
  - Anyone who wants the strongest text picks Neutral, and increased contrast raises the border.
- **Measured** with WCAG 2.x contrast after `oklchToHex` (`tests/helpers/css-tokens.ts`).
  - Page is `--background`, plus `--card` where it differs: in dark, `--card` gives the lower ratio.
  - **Hl** is the worst of the 10 `HIGHLIGHT_PALETTE` entries in that theme.
  - **More** is increased contrast (`data-contrast="more"`, #161): the border and icon take the chip's own text colour, measured against the page.

| Colour | Theme | Fill (`bg`) | Text (`fg`) | Border | Icon | Hover | Active | Text on bg / hover / active (worst) ≥4.5 | Border on page ≥3 | Border on fill ≥3 | Icon on fill ≥3 | Focus ring on fill ≥3 | Border on Hl ≥3 | More: text on page ≥4.5 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Neutral | light | `oklch(0.967 0.001 286.375)` #f4f4f5 | `oklch(0.145 0 0)` #0a0a0a | `oklch(0.556 0 0)` #737373 | `oklch(0.556 0 0)` #737373 | `oklch(0.93 0.002 286)` #e8e8e9 | `oklch(0.9 0.003 286)` #dedee0 | 14.74 | 4.74 | 4.31 | 3.53 | 7.11 | 3.28 (red) | 19.80 |
| Neutral | dark | `oklch(0.274 0.006 286.033)` #27272a | `oklch(0.985 0 0)` #fafafa | `oklch(0.708 0 0)` #a1a1a1 | `oklch(0.708 0 0)` #a1a1a1 | `oklch(0.32 0.006 286)` #323236 | `oklch(0.36 0.006 286)` #3d3d40 | 10.37 | 6.94 | 5.76 | 4.19 | 10.05 | 3.21 (yellow) | 17.18 |
| **Blue** | light | `oklch(0.958 0.03 255)` #e4f3ff | `oklch(0.4 0.13 255)` #02468b | `oklch(0.556 0.12 255)` #3f75b8 | `oklch(0.5 0.12 255)` #2e64a6 | `oklch(0.93 0.042 255)` #d6eaff | `oklch(0.9 0.05 255)` #c8e0ff | 6.91 | 4.72 | 4.17 | 4.46 | 6.91 | 3.26 (red) | 9.33 |
| **Blue** | dark | `oklch(0.29 0.045 255)` #1c2c41 | `oklch(0.92 0.05 255)` #cfe7ff | `oklch(0.708 0.1 255)` #76a4de | `oklch(0.76 0.1 255)` #85b4f0 | `oklch(0.33 0.053 255)` #223650 | `oklch(0.37 0.057 255)` #2b415d | 8.19 | 6.95 | 5.47 | 4.85 | 9.53 | 3.21 (yellow) | 14.11 |
| Green | light | `oklch(0.958 0.035 152)` #e1f8e6 | `oklch(0.4 0.1 152)` #0a562b | `oklch(0.556 0.1 152)` #418456 | `oklch(0.5 0.1 152)` #2f7346 | `oklch(0.93 0.047 152)` #d2f2d9 | `oklch(0.9 0.055 152)` #c4e9cc | 6.67 | 4.51 | 4.03 | 4.34 | 6.98 | 3.12 (red) | 8.83 |
| Green | dark | `oklch(0.29 0.04 152)` #1b3121 | `oklch(0.92 0.06 152)` #c8f1d1 | `oklch(0.708 0.1 152)` #6fb382 | `oklch(0.76 0.1 152)` #7fc492 | `oklch(0.33 0.048 152)` #213d29 | `oklch(0.37 0.052 152)` #2a4832 | 8.19 | 7.21 | 5.60 | 4.93 | 9.40 | 3.34 (yellow) | 14.48 |
| Amber | light | `oklch(0.958 0.045 70)` #ffedd1 | `oklch(0.4 0.09 70)` #663d00 | `oklch(0.556 0.11 70)` #9c661b | `oklch(0.5 0.11 70)` #8a5600 | `oklch(0.93 0.057 70)` #ffe2bf | `oklch(0.9 0.065 70)` #fbd7b0 | 6.92 | 4.85 | 4.22 | 4.53 | 6.80 | 3.35 (red) | 9.41 |
| Amber | dark | `oklch(0.29 0.04 70)` #382814 | `oklch(0.92 0.06 70)` #ffdeba | `oklch(0.708 0.1 70)` #c99658 | `oklch(0.76 0.1 70)` #daa668 | `oklch(0.33 0.048 70)` #453118 | `oklch(0.37 0.052 70)` #513b20 | 8.22 | 6.82 | 5.39 | 4.83 | 9.56 | 3.15 (yellow) | 14.01 |
| Rose | light | `oklch(0.958 0.025 12)` #ffebed | `oklch(0.4 0.12 12)` #7b2436 | `oklch(0.556 0.11 12)` #a95662 | `oklch(0.5 0.11 12)` #974552 | `oklch(0.93 0.037 12)` #ffdee1 | `oklch(0.9 0.045 12)` #fad2d6 | 7.10 | 5.01 | 4.38 | 4.64 | 6.83 | 3.46 (red) | 9.78 |
| Rose | dark | `oklch(0.29 0.04 12)` #3d2326 | `oklch(0.92 0.05 12)` #ffd8dc | `oklch(0.708 0.09 12)` #d28992 | `oklch(0.76 0.09 12)` #e499a2 | `oklch(0.33 0.048 12)` #4b2b2f | `oklch(0.37 0.052 12)` #583438 | 8.20 | 6.60 | 5.27 | 4.78 | 9.66 | 3.05 (yellow) | 13.75 |
| Teal | light | `oklch(0.958 0.03 192)` #dbf8f6 | `oklch(0.4 0.09 192)` #005654 | `oklch(0.556 0.09 192)` #188481 | `oklch(0.5 0.09 192)` #007370 | `oklch(0.93 0.042 192)` #c9f1ef | `oklch(0.9 0.05 192)` #b9e9e6 | 6.45 | 4.51 | 4.03 | 4.30 | 6.98 | 3.12 (red) | 8.54 |
| Teal | dark | `oklch(0.29 0.04 192)` #0e3230 | `oklch(0.92 0.05 192)` #bff0ed | `oklch(0.708 0.08 192)` #60b1ae | `oklch(0.76 0.08 192)` #70c2be | `oklch(0.33 0.048 192)` #103d3c | `oklch(0.37 0.052 192)` #174847 | 8.23 | 7.17 | 5.53 | 4.94 | 9.34 | 3.32 (yellow) | 14.43 |

- **Pairs that don't depend on the colour:**
  - The open state's `--doc-chip-border-strong` (`--foreground`) on every active fill: at least 14.38 in light and 9.71 in dark.
  - The selection (`--tt-selection-color` over the page: #c6dafc light, #203b68 dark):
    - `--foreground` on it, which is the selected chip's text and border: 13.99 light, 10.66 dark;
    - `--muted-foreground`, the selected chip's icon: 3.35 light, 4.31 dark;
    - a chip's own fill against the selection fill: only 1.23–1.29 light and 1.24–1.34 dark, Neutral included. The fill change alone doesn't show the selection, so the selected chip also takes a `--foreground` border.
  - The focus ring on the page: 7.81 light, 13.36 dark.
- **The thinnest margins:**
  - the border on highlights, 3.05–3.46 (Rose on dark yellow is the lowest);
  - `--muted-foreground` (a selected chip's icon) on the light selection, 3.35;
  - Neutral's icon on its fill, 3.53.

  The worst text figure is 6.45 (Teal, light). LK2's test pins each pair at its floor.
- Some hex values have a 00 or ff channel: those oklch values fall just outside sRGB and are clamped. `oklchToHex` clamps the same way, so the table and the test agree.

**States in every colour** (colour is never the only state signal)
- **Document, pending and section:** the tint, with FileText or Hash and the hidden suffix. Pending looks like Document, so nothing flashes.
- **In Trash:** the tint, because it still opens. FileMinus and ", in Trash" carry the state.
- **Not available and unknown_form:** always the Neutral fill, text, icon and a dashed Neutral border, whatever the colour (`--doc-chip-broken-bg`, `-fg`, `-border` and `-hover`, theme tokens only). The tint means "a link you can follow". The dash, FileQuestion and the words carry the state.
- **Hover and open:** the colour's hover and active fills. The open chip also takes `--doc-chip-border-strong`. A broken chip uses the broken hover fill for both.
- **Focus (reading mode):** unchanged, the 2 px `--focus-ring`, offset 2 px.
- **Selection:** the selection fill, Neutral text and icon, and a `--foreground` border (above).
- **Forced colours:** every colour gives the system colours already specified. The control's swatches then look alike, and their visible names carry the choice.
- **Next to highlights:** chips take no marks (C9). Every border keeps at least 3:1 against every highlight in its theme (table), so a Blue chip beside a blue highlight still has its edge.
- **Print:** plain title text, as before.

**The control**
- **Its home is Settings › Page** (W13 on the web, P2.9b on desktop), with palette entries "Chip colour: Neutral" … "Chip colour: Teal" in the lazy `lib/editor-actions/prefs-actions.ts`.
- **Until then it lives in ⋯.** #161 has no settings surface: its own changelog says the Page popover, the palette entries and Settings arrive with P2.9c-2 and W13. The control starts in ⋯'s view-settings section, beside Appearance:
  - "Chip colour ▸" opens a submenu of six `menuitemradio` items. Each has an 18 px swatch, the name and a check on the current one; Blue reads "Blue (default)". A muted line below says "Only you see it, on this device."
  - A radiogroup can't sit inside `role="menu"`, and the menu owns the arrow keys, so ⋯ uses menu radio items, as Appearance does: ↑ ↓ move, ↵ or Space picks, ← (→ in RTL) or Esc goes back. Picking repaints every chip at once.
  - **The item is gated in code, not by intent.** The host chunk registers a `view.chipColor` action through the action registry, as it does `insert.docLink`. `OverflowMenuItems` (the lazy ⋯ chunk) renders the submenu only when `editorActions.has("view.chipColor")`, as it already does for commands. A hostless editor never registers it, so the sandbox's ⋯ is unchanged and the editor chunk adds 0 B.
- **The Settings form:**
  - A `role="radiogroup"` labelled "Chip colour" and described by "The colour of links shown as chips. Only you see it, on this device."
  - Six `role="radio"` buttons with a roving tabindex, so the group is one Tab stop. ← → ↑ ↓ move the choice and apply it at once (APG radio group, RTL-aware), and Home and End go to the first and last.
  - **Swatch:** 24 px, a mini chip (the colour's fill and border, its FileText icon, `--radius-sm`), with the visible name under it.
  - **Checked:** a 2 px `--foreground` ring outside a 2 px gap, plus the name in bold and `aria-checked`, never colour alone.
  - **Tooltip on hover and focus:** the name, "Blue (default)" or "Neutral: no tint". It is `aria-hidden`, because the name is already visible.
  - **Targets:** each option is about 56 × 48 px. At 30rem or narrower the group becomes a vertical list of 44 px rows (swatch and name) with no tooltip.
- **Live preview:** next to the group, one sentence with a live chip and a Not available chip ("Budget numbers live in [Q4 budget] and the old plan in [Vendor contracts]."). It is decorative (`aria-hidden`), because the page's own chips change too.
- **Prototype:** the scenes "Chip colours (C10)" (the grid), "Chip colour setting" and "Chip colour in ⋯ (until Settings)".

**Bytes**
- **Editor chunk: +0 B.**
  - The mapping is CSS in the lazy `doc-links.css`.
  - The schema entry is in `lib/prefs/schema.ts`. The lazy prefs runtime and the server-side boot-script generator read it; the editor chunk never imports it.
  - The ⋯ item and the Settings row are lazy chunks.
- **The inline boot script grows** in every HTML response: about 150 B raw (counted from the line below) and about 70 B gzipped (estimated). #161's PR states the measured total.
- **`doc-links.css`** grows by about 4.1 KB raw and 0.6 KB gzipped, measured on the prototype's generated mapping rewritten to the app's selectors. It loads with the host chunk.

**Amends on merge: #161 (the prefs schema).** Whichever of #161 and LK2 merges second applies these:
- **`lib/prefs/schema.ts`:**
  - Add `CHIP_COLORS = ["neutral", "blue", "green", "amber", "rose", "teal"] as const`, `type ChipColor` and `isChipColor = oneOf(CHIP_COLORS)`.
  - Add `chipColor: ChipColor` to `WebPrefs`, and `chipColor: "blue"` to `PREF_DEFAULTS`.
  - Add `"chipColor"` to `PREF_SLOTS`, and to `CHOICE_SLOTS` in `remembered-choice`.
  - `parsePrefs` reads it with `isChipColor`; anything else reads `"blue"`.
  - Add `"data-chip-color"` to `PREF_ATTRIBUTES`. `prefsAttributes` emits it only when the value isn't `"blue"`.
- **`lib/prefs/boot-script.ts`:** interpolate `CHIP_COLORS` and add `if(C.indexOf(s.chipColor)>=0&&s.chipColor!=="blue")f("data-chip-color",s.chipColor)`.
  - `PREFS_VERSION` stays 1: a new slot is additive, and an older build ignores it.
- **Desktop:** `prefs.chipColor` in `meta('prefs')`, validated in main through `parsePrefs`.
- **Tests:**
  - The `boot-script.test.ts` parity table gains rows for no slot, each colour, an invalid value and the kill switch.
  - `schema.test.ts` and `apply.test.ts` cover the attribute.
- **Preferences design §2.1:** a new row 27, and the counts.
  - Group B, `chipColor`, "Chip colour".
  - A radio group of swatches: Neutral · **Blue** · Green · Amber · Rose · Teal.
  - Scope D. Desktop and the web library only.
  - Where: S Page, ⋯ (until W13), K.
  - Storage: `prefs.chipColor` and `ui.chipColor`.
  - Applied: boot sets `data-chip-color`. R=0: ses.
  - PR: #161 (schema) and LK2 (CSS and control).

**New `token-contrast.test.ts` pairs** (each colour × light and dark, read from `doc-links.css`):
1. `--doc-chip-fg` on `--doc-chip-bg`, `--doc-chip-hover` and `--doc-chip-active`: at least 4.5.
2. `--doc-chip-border` on `--background` and `--card`: at least 3.
3. `--doc-chip-border` on `--doc-chip-bg`: at least 3.
4. `--doc-chip-icon` on `--doc-chip-bg` and `--doc-chip-active`: at least 3.
5. `--focus-ring` on `--doc-chip-bg`: at least 3.
6. `--doc-chip-border` on every `HIGHLIGHT_PALETTE` entry: at least 3. This replaces the three named highlight pairs, which covered Neutral only.
7. `--doc-chip-border-strong` on `--doc-chip-active`: at least 3.
8. Increased contrast: `--doc-chip-fg` on `--background`, `--card` and `--doc-chip-bg`: at least 4.5. Under `more`, the border is the text colour.
9. Once, for every colour: `--foreground` on the selection fill (at least 4.5; it is the selected chip's text and border) and `--muted-foreground` on it (at least 3).

Broken states use the Neutral values, which pairs 1–5 already cover for Neutral.

#### Keys and pointer

| Input | Result |
|---|---|
| ← or → | Passes the chip in one press, in LTR and RTL paragraphs. |
| ⇧ + arrow | Extends the selection over the whole chip. |
| Backspace or Delete | Removes the chip in one press. One undo step, and it is announced. |
| ⌥↵ next to the chip (the one before the caret first, then the one after), or with a selection that holds exactly one chip | Follows the link through LK1's `navigate`. On a broken chip it opens the card instead, with focus on its first action, or on the card itself (`tabindex=-1`, labelled and described) when there is no Open action. |
| ⌘K next to the chip | Opens the card, with focus on its first action, or on the card itself (`tabindex=-1`, labelled and described) when there is no Open action. |
| Plain click or tap while editing | Collapses the selection to the nearer side of the chip, then opens the card (a bottom sheet at 30rem or narrower). A long-press only selects. |
| ⌘-click | Opens in this tab. |
| ⌘⇧-click or middle click | Opens in a new tab. |
| Reading mode or read-only | A click, or Enter on the focused chip, opens it. |
| Reading mode or read-only: ⌘K, ⇧F10 or the ContextMenu key on a focused chip | Opens the preview (WCAG 2.1.1). Esc and Back return focus to that chip. |
| Esc | Closes the card and returns focus to `view.dom`, with the selection unchanged (reading mode: to the chip). |
| ⌘[ (Back) | Returns with the caret after the chip (reading mode: focus on the chip). |

- **Default focus never lands on Remove Link** (approved Q4). In particular, ⌥↵ then ↵ on a Not available chip leaves the document unchanged.
- Act on click, never on pointer-down.
- **The card is the Q7 document preview** (a custom render): it never shows the href or key and has no Edit. Its dialog names follow §7: "Link to Q4 budget", "Link to Launch checklist, in Trash", "Link not available", "Link to section Risks".
  - It takes the approved preview's layout: `min(22rem, 100vw - 16px)` wide, 6 px padding, 14/1.4 text, an 18 px state icon, the title (600) with "› Heading", the folder path and the 2-line snippet, then rows of borderless 30 px actions.
  - It meets WCAG 1.4.13: it can be hovered, dismissed with Esc, and persists.
- **Card actions:**
  - The first group holds the ways to open: Open, Open in New Tab and Copy Link. A section chip shows Go to Section instead of the Open actions, a trashed one shows Open and Restore, and a pending one shows only Copy Link.
  - A second group, editable only, holds Turn into Link and Remove Link.
  - A document link's card offers **Turn into Chip** instead. The chip's `label` is the link's text, so nothing new is written.
  - When the card re-renders (Restore, a rename), focus returns to the same action by its id, or to the first Open action if that action is gone.
  - If the chip disappears while its card is open (undo, a collaborator), the card closes, focus goes to `view.dom` at the mapped caret, and nothing is announced.
- **In a Live (shared) document,** Turn into Link asks for consent the first time, because it writes the current title into the document:
  - Title: "Write this title into the document?"
  - Body: "A text link keeps its text in the document. This document is Live, so people you share it with will see “Q4 budget”."
  - Buttons: [Cancel] [Turn into Link], with focus on Cancel.

#### Inserting

- **⌘K picker:**
  - A real `<input role="combobox" aria-expanded="true">` with `aria-activedescendant` into a listbox, grouped as Documents and In this document.
  - The footer hint (and any Insert as reason) is the combobox's `aria-describedby`. Modifier glyphs come from `lib/shortcuts.ts`, per platform.
  - The active row is `--accent` plus a 2 px inset `--focus-ring` ring, never colour alone, with no RTL-specific rule.
  - The count is announced by the picker's own polite status, debounced to 400 ms.
  - Templates and trashed documents are never listed.
  - **Insert as** (C4): a visible footer radio group, "Insert as: Chip | Link text". Each radio is at least 28 px tall (`min-block-size: 28px`).
    - With no selection it defaults to Chip; with a selection, to Link text.
    - ⇧↵ inserts the other form.
    - Chip is `aria-disabled`, with a visible reason, in three cases: in the title ("Chips can't go in the title."), for a web address ("Web addresses insert as link text."), and for a heading in another document ("Headings in other documents insert as link text.").
  - ⇥ on a document lists its headings (§4.2). In v1, those insert as link text.
  - **An inserted chip is followed by a space** in the same undo step, unless one is already there.
- **"/" Link to Document** (C6):
  - The bubble session registers `insert.docLink` through the action registry, and O12's Suggested section picks it up through `INSERT_KIND_CHOICE`.
  - It opens the picker, prefilled with any words typed after the item's name ("/link q4" prefills "q4").
  - Removing the trigger and inserting the chip are one undo step, which needs a keep-trigger option on `runSlashPick`.
  - LK2 does not edit `components/smart-toolbar/slash/`.
- **Paste** (C5):
  - A lone `tinydocy:doc/…` link pasted with a collapsed selection becomes a chip in two transactions.
    1. A link whose text is the resolved title, or "Document" when it doesn't resolve. The href is never written as text.
    2. The chip, whose `label` is step 1's text.
  - So the first ⌘Z leaves a plain link.
  - While the library is pending, the paste waits up to 1 s for the local index, so the label is not stored empty.
  - Pasting over a selection makes a link, and ⌘⇧V pastes raw text.
  - The parse rule reads only `href`, and ignores pasted titles when the target resolves.
  - The first time, a pill says "Pasted as a chip. ⌘Z keeps it as a link." and offers [Keep as Link]. The first announcement carries the same hint: "Pasted link to Q4 budget. Undo keeps it as a link."
- **Undo granularity (polish M5):** call `undoManager.stopCapturing()` between paste steps 1 and 2, after step 2, and around every picker insert, conversion, Remove Link and Backspace on a chip. Without it, Yjs merges changes made within its capture timeout (500 ms), so ⌘Z after a paste would remove the whole paste, and ⌘Z after typing right behind a new chip would take the chip with it.
- **No Tab prompt.** Tab indents in this editor.
- **First-time hint:** "Chips show a document's current title on this device. People you share with see the title it had when you added it, and can't open it."

#### Clipboard

- The `renderHTML` output is `<a data-doc-chip href>label</a>`, so the chip degrades to an ordinary link elsewhere.
- On copy, the HTML anchor text is the displayed title, as the plain text is: the title at copy time.

#### Announcements

- Use the polite region, and only for local actions (WCAG 4.1.3):
  - "Linked to X". The first time, the first-time hint is appended once: "Linked to X. Chips show a document's current title…"
  - "Pasted link to X"
  - "Deleted link to X" (Backspace or Delete)
  - "Removed link to X" (Remove Link), or "Removed link. The text is now “label”." when the label differs from the title the chip showed
  - "Changed to chip: X" and "Changed to text link: X"
  - "Restored X"
  - "Link copied"
  - the Q8 follow lines: "Opened X." or "Opened X, at Travel."; "At Risks." for a `here#` chip; and the "Heading gone" pill's text
- **Pills join the F6 cycle,** and Esc dismisses the focused pill and returns to the editor.
- Never announce on load, on a remote change or on a rename. The prototype's log shows each of these as "Not announced".

#### Exports

| Export | Chip becomes |
|---|---|
| Export all | `[Title](relative.md#slug)`, escaped. Targets not in the export become plain text. |
| Single document, Copy as Markdown, HTML | the title as escaped text, never a `tinydocy:` link |
| `.tinydoc` | the node, unchanged |
| Markdown import | hyperlink marks only, never chips |

#### Bytes and schema

- **Editor chunk** (C3):
  - Only the `...linkHost.extensions` spread is eager. Measure it with `scripts/check-editor-chunk-size.ts` on `main` and on the branch, and put both numbers in the PR.
  - It goes inside LK1's 60 B line, or that line is amended by the measured amount.
  - The node, node view, keymap, CSS, card, picker, paste handling and announcements are all in the host chunk.
  - Never call `registerPlugin` from a lazy chunk.
- **Schema:**
  - The sandbox is untouched: no change to `SCHEMA_NODE_NAMES`, `CLIENT_SCHEMA` or the floor.
  - Commit a second schema snapshot for the host editor.
  - `CLIENT_SCHEMA` 3 is redefined as "knows asset refs **and** `docChip`". The first bundle that sends 3 must render chips, and P4.2 (d) adds `docChip` to the node names the share floor accepts.
- **Offline storage:**
  - The sandbox offline cache (`~s2:`) never holds chips, so it needs no `~s3`.
  - Local documents get the `DOC_SCHEMA` handling in C8.
  - `import-guard` accepts `docChip`.
- **Headless export:** add `docChip` to `lib/headless/schema-extensions.ts` once #146 merges.
- **Kill switch:** `NEXT_PUBLIC_DOC_CHIPS=0` hides every way to insert a chip. Chips still render.
- **Chip colour (C10):** +0 B to the editor chunk. The cost is CSS in `doc-links.css`, one schema entry, and about 150 B raw in the boot script. See [Chip colour (preference)](#chip-colour-preference).

#### Required tests

- **Unit:**
  - the name and copy function for every state
  - parse and render for hostile `href` values: `javascript:` in mixed case, a control-character prefix, `data:`, `"><img onerror>`, and 100 KB
  - hostile titles, and Markdown and HTML escaping
  - the label clamp: never splits a grapheme (an emoji, a letter and its ZWNJ), keeps ZWNJ, strips bidi controls
  - `extract-links` and consent counting a document whose only links are chips (consent must not be null)
  - the token-contrast pairs in both themes and **every chip colour** (C10's nine pairs), against every `HIGHLIGHT_PALETTE` entry, plus these named pairs in `token-contrast.test.ts`:
    - the focus ring against the page, the chip and the selection
    - Neutral's border stays `--muted-foreground`. The other colours keep its lightness.
  - prefs: `chipColor` parse, defaults and the boot-script parity rows (C10, amends #161)
- **Playwright:**
  - `toHaveRole`, `toHaveAccessibleName` (the exact string, for example `"Q4 budget, document"`) and an aria snapshot per state
  - no `href` on the chip, and it is never a Tab stop while editing
  - the key map, asserted on `editor.state.selection`, in LTR and in a Persian paragraph, in Chromium, WebKit and Firefox, including Firefox's third ⇧→ case
  - IME: a CDP composition e2e at all 7 positions around a chip. *(Proposed reading, for LK2 to confirm: before and after a chip at the start, middle and end of a paragraph, and between two chips.)*
  - default focus: ⌥↵ then ↵ on a Not available chip leaves the document unchanged; no card ever opens with focus on Remove Link
  - undo (collab fixture): paste then ⌘Z leaves a hyperlink; insert a chip, type "x" within 100 ms, then ⌘Z leaves the chip
  - spies show `navigate` only: no `window.open` and no `openExternal`
  - the 1.4.13 hover checks, and the picker's combobox and `aria-activedescendant`
  - the reading-mode preview keys (⌘K, ⇧F10, ContextMenu) and focus back on the chip after Esc and Back
  - announcement text present after each action, and absent after load, a remote change or a rename
  - axe in light and dark, forced-colours and reduced-motion emulation
  - targets: overlay controls are at least 24×24 (sheet rows 44). The chip relies on the inline exception (WCAG 2.5.8).
  - line-box equality and no stranded icon, as the prototype measured
  - chip colour (C10): the attribute is on `<html>` in the first DOM snapshot, so there is no flash; a change in another tab repaints chips here with zero node-view mutations; forced colours show no tint; the ⋯ item is absent in the sandbox
  - the Settings radiogroup: one Tab stop, the arrows move and apply the choice, and the names are exact
  - each chip fragment's `getClientRects()` height is at most the line height + 0.5 px at 15/1.15, in a paragraph, an h1 and a list item
  - reflow at 320 px: the card is a sheet, the picker fits, nothing scrolls sideways
- **Privacy:** rename B, then check that the shared A's Y.Doc and `.tinydoc` hold only the key and the insert-time label.
- **Performance:**
  - 500 chips and 100 index ticks give zero mutations.
  - The registry is empty after unmount.
  - `performance.spec` typing latency is unchanged.
- **Gate:** the sandbox Hocus refuses `docChip` with `schema_rejected`, and the hostless editor never deletes a chip.
- **Design-review screenshots:**
  - text at 14, 15, 16, 20 and 32 px, and leading 1.15, 1.6 and 1.8, including 15/1.15
  - light and dark, and LTR and RTL, with Persian in the OS fallback font (the app ships no Persian font)
  - h1 and h2, a list, a table and a blockquote, and next to every highlight colour
  - forced colours × selection
  - every state, a CJK title, and Not available with its card open
  - every chip colour × light and dark × every state, and forced colours with a colour other than Neutral chosen
  - Firefox and WebKit

#### Owners

- **LK1/LK2 session:** the node, node view, CSS, picker, paste, conversion, announcements, `extract-links` and consent, the host schema snapshot, and every test above.
- **Bubble session:** `insert.docLink` through the action registry, plus a keep-trigger option on `runSlashPick` for the single undo step.
- **P2.8a export:** the chip mapping in the headless schema, the Markdown writer and HTML.
- **SE (P4.2):** `docChip` in the share schema floor and the definition of schema 3.

#### Owner decisions

| # | Decision | Options | Recommendation |
|---|---|---|---|
| **C1** | Amend §4.1, SL-6 and SL-7 to allow a chip node | Yes, with the title resolved only when it renders / No, links stay marks only | **Yes.** It keeps both reasons for the mark: renames write nothing, and nothing new is published. |
| **C2** | What the node stores | (a) `href` only / (b) `href` plus the insert-time `label` | **(b).** It exposes what link text already exposes, and the existing consent copy covers it. Under (a), shared copies fail WCAG 2.4.4 because every chip reads just "document". |
| **C3** | Where the bytes come from | (a) the node through `linkHost.extensions`, an eager spread of roughly 10–25 B (estimated, not measured) / (b) an eager node spec paid from LK3's 120 B line | **(a).** If the measured cost exceeds what is left of LK1's 60 B line, amend that line by the measured amount. It also keeps LK3's fate separate from chips. |
| **C4** | ⌘K with no selection | Insert a chip / Insert link text | **A chip,** and link text when there is a selection. Add the visible "Insert as: Chip \| Link text" control, with ⇧↵ choosing the other form. |
| **C5** | Pasting a lone `tinydocy:doc/…` link with a collapsed selection | A chip / A link | **A chip, in two transactions,** so the first ⌘Z leaves a plain link. Pasting over a selection gives a link, and ⌘⇧V pastes raw text. |
| **C6** | The "/" item | Opens the ⌘K picker with the query prefilled / Lists documents inline in "/" | **The picker,** as §4.2 already approves. The inline documents mode stays a later proposal for the bubble session. |
| **C7** | Web-address chips and fetching titles | In v1 / Later | **Not in v1, and never fetching automatically.** |
| **C8** | `DOC_SCHEMA` | A no-op step to 1, so older builds open stamped documents as `doc_too_new` (read-only) / `docChip` joins the schema-0 baseline | **The step,** if any desktop or web-library build has reached testers before chips ship. If none has, the baseline. If in doubt, the step. |
| **C9** | Marks on chips | `marks: ""` / allow colour marks | **`marks: ""` in v1.** Colour marks would break the contrast pairs, and the guard doesn't check marks on inline atoms. |
| **C10** | Chip colour (owner, 2026-11-22: a colour the user changes in preferences). *The coordinator's call, pending the owner's sign-off.* | One global, per-device preference with six colours / a colour per chip or per document / no choice | **One global, per-device preference:** Neutral, **Blue** (default), Green, Amber, Rose and Teal, with no purple or indigo. It is set by the boot script as `data-chip-color` and mapped by CSS, so it adds 0 B to the editor chunk and never writes to Yjs. Broken states stay Neutral and dashed. It lives in ⋯ until Settings › Page ships. See [Chip colour (preference)](#chip-colour-preference). |

### 4.3 Following a link

| Gesture | Action |
|---|---|
| Click in reading mode or on a read-only document, or ⌘-click while editing | Open in this tab (UX: "a click opens in the current tab"), then `goToHeading(tocId, "start")` if there is a heading id |
| ⌘⇧-click or middle click | Open in a new tab |
| A plain click while editing | Places the caret, as with web links. The preview popover's **Open** button opens it. |
| Back (⌘[) | Returns to the linking document at its position. Navigation pushes history (UX §4.2). |
| `tinydocy:here#id` | `goToHeading` in place, with no navigation entry beyond one history step |

**Implementation note.** The extension calls `navigate(href, { newTab })` with `newTab: true` when Mod is held.
- Our `navigate` therefore maps the gestures itself: Mod alone → this tab; Mod+Shift or the middle button → a new tab. It reads the modifier state from the triggering event, which the host tracks.
- For `https` links, it passes `newTab` through unchanged.

### 4.4 What happens when the target changes

| Target event | Link in your library | Collaborator who opens the linking document |
|---|---|---|
| Renamed | Resolves. The text stays. The hovercard shows the current title and **Use Current Title** when the text differs (editable documents only). | Unresolved (§4.6). Sees only the text the author wrote. |
| Moved to another folder | Resolves. The key is unchanged. | Same |
| Trashed | Hovercard: "In Trash". Opening shows the In Trash banner with [Restore]. The icon changes. | Same |
| Purged (deleted forever, or after 30 days) | Broken: "This document was deleted." The text stays. **Remove Link** is offered. | Same |
| Restored from Trash | Resolves again | — |
| Duplicated | Links still point to the original. The duplicate gets a new key. `here#` links inside the duplicate point into the duplicate. | — |
| Shared (Live) | Resolves for you. The consent window adds: "This document links to 3 of your documents. People you share with will see the link text but can't open them." | Unresolved, unless Q3 (b) |
| Heading deleted | Opens the document at the top with the pill "The section this link pointed to was removed." | — |
| Opened in the public sandbox (never by design, but possible through pasted HTML) | The `tinydocy:` scheme isn't registered there, so the mark is refused, or the text pastes plain | — |
| Imported into another library | Through Export all, resolves if the target came along (keys carried in `library.json`). A single `.tinydoc` import gets a new key (v7), so links to it don't resolve. Otherwise unresolved. | — |

### 4.5 Link previews (hovercard)

- **Only for document links.** `shouldShow` returns true only for `tinydocy:`. External links get **no** hovercard, because fetching their metadata would tell third parties what you're reading (same reasoning as remote images, plan §7).
- **Trigger:**
  - in reading mode and read-only documents: hover after the extension's delay
  - while editing: hover with ⌘ held, as Obsidian's editing view does
    - `shouldShow` receives only `{ href, link }`, with no modifier state. The host keeps a `modHeld` flag from window `keydown`/`keyup`/`blur` listeners, added by the lazy link chunk.
    - LK4 checks whether the extension's `keepsHovercardOpen` already covers "⌘ pressed after the hover started". If it doesn't, ⌘ pressed after hovering re-arms the card on the next `pointermove`.
  - from the keyboard: the existing focus-preview path
- **`fetchMetadata`** resolves locally from the index (`docs` row by `link_key`) on both platforms. It returns:
  - the title, folder path and Modified date
  - `docs.snippet` (the document's opening lines, already kept by the index)
  - **for a heading link, the target section's heading and first lines: source not decided (v7).** The search index that held them (`search.peek`, the `text` store) is removed by D24. It is the same open question as the ⌘K ⇥ step (§4.2); until it is decided, the card shows the title and `docs.snippet`.
- **D30:** LK4's hover preview is fourth in the pre-approved cut order. If it is cut, links still follow and show their state icon (§4.6).
- **No network.** It answers within a frame in practice, so the extension's 500 ms loading state rarely shows.
- **Card:**
  - the title, with "› Heading"
  - a 2-line snippet in `<bdi dir="auto">`
  - "Library › Finance · Edited 12 Nov"
  - actions: **Open**, **Open in New Tab**, **Copy Link**, and **Use Current Title** (only when it differs and the document is editable)
- **Hovercard CSS** loads with the library chunk, not the editor chunk.

### 4.6 Broken and unresolved states

The `linkIcon` resolver (sync) decides the link's icon from the renderer's index snapshot, which Quick Open already holds:

| State | Icon (lucide, via `lib/icons.tsx`) | Style | Hovercard / click copy |
|---|---|---|---|
| Resolves | `FileText` | normal link | the card in §4.5 |
| Heading gone | `FileText` | normal | Opens at the top. Pill: "The section this link pointed to was removed." |
| In Trash | `Trash2` | normal | "“Q4 budget” is in Trash." [Open] [Restore] |
| Deleted | `FileX` | dashed underline (never colour alone) | "This document was deleted." [Remove Link] |
| Not in this library (a collaborator, or a target not imported) | `FileQuestion` | dashed underline | "This links to a document that isn't in your library." No title, no key shown, no action except [Remove Link] when editable. |
| Unknown future form (`tinydocy:` that doesn't parse) | `FileQuestion` | dashed | "This link needs a newer version of TinyDocy." The node is never modified. |

### 4.7 Export

| Export | Document links become |
|---|---|
| **Export all** (desktop Export All…, web W7 zip) | Relative links to the exported file: `[Q4 budget](../Finance/Q4%20budget-1a2b3c.md#travel)`. The anchor is a GitHub-style slug of the target heading's text at export time, with `-1`, `-2` for duplicates. Targets not in the export (trashed) become plain text. |
| **Single document** (Markdown, HTML, PDF/print) and **Copy as Markdown** | The link text only. The target isn't in the file, and a `tinydocy:` URL means nothing outside the app. |
| **`.tinydoc`** (Send a copy, backups) | Unchanged hrefs. *(v7: importing a `.tinydoc` always assigns a new `link_key`, so the header needs no key.)* |
| **Backup mirror `.md`** | Unchanged `tinydocy:` hrefs. Mirror filenames change with titles, so relative links would go stale between mirror passes. The `.tinydoc` beside them is the real backup. |
| `tinydocy:here#id` | `#slug` in every Markdown and HTML export |

### 4.8 The public sandbox

- **No document links:** the sandbox has no library and no keys.
- `tinydocy:here#` heading links and the **In this document** section of ⌘K are cheap and need no index. They are **in v1 for the sandbox too, if** LK1's pass-through measures within its 60 B gz ledger line. Otherwise they are later. Flagged in §12.

### 4.9 Import contract and "Link imported notes" (LK5)

**v7 change (staff integration review).** IM1 no longer rewrites links during import. It keeps `[[wikilinks]]` and `[t](Other.md)` as **literal text** and stores each imported file's **relative path** (and source app) in `import_sources(doc_id, relative_path, source_app)` (onboarding design §4.2–§4.3). **LK5** adds a one-time **"Link imported notes"** action, offered on the import report (onboarding §5.2), which applies the table below as a **forward edit outside undo**.

1. **What it reads.** The file map comes from `import_sources` for that import's documents (relative path → `link_key`; basename, case-insensitive → `link_key`). Every target already has a `link_key`, minted at insert (v8, S16).
2. **How it writes.** The rewrite is a pure function in `lib/links/import-links.ts`. It runs in the renderer, one document at a time, never on a document open in another window (architecture D-A3), and never on templates.
3. **Resolution table:**

| Source | Becomes |
|---|---|
| `[[Note]]`, `[[Folder/Note]]` | Link to that document. The text is "Note". Ambiguous basenames go to the shortest path, as Obsidian resolves them. |
| `[[Note\|Alias]]` | Link with the text "Alias" |
| `[[Note#Heading]]`, `[[Note#H1#H2]]` | Heading link. The heading is found by text in the target, case- and accent-insensitive, **after** the target's headings get their `data-toc-id`s (the importer assigns UUIDs, the same as the plugin). If it isn't found: a document link. |
| `[[#Heading]]` | `tinydocy:here#<id>` |
| `[[Note#^block]]` | Document link. Block ids are dropped, and the summary counts them. |
| `![[Note]]` (embed) | A document link on its own line. The summary says "Embedded notes became links." |
| `![[image.png]]` | Image import through the asset store (import design) |
| `[text](Other%20note.md)`, `[text](./Other.md#heading)` (Markdown links, Notion and Bear exports) | Same resolution by relative path |
| A target not in the import | **Kept as literal text** `[[Note]]`, never as a broken link. Counted in the result sheet with the shared string (onboarding §5.2): "12 point to notes that weren't imported. They stay as text." |

4. **Re-importing** the same files creates new documents with new keys; running "Link imported notes" on the new folder links within that import only.
5. **Escape rule:** wikilinks inside code spans and code blocks are never rewritten.

---

## 5. Backlinks: Linked from

**Index (v7: kept for links, not for search).** D24 removes the text pass and `search.sqlite` that used to feed this. D25 keeps backlinks in v1 (D30 lists them sixth to cut), so the minimum they need stays:
- **A links-only pass** (`lib/links/extract-links.ts`, renderer). It walks the open document's `XmlText.toDelta()` for `hyperlink` attributes whose href parses as a document link (§4.1), and emits `{ srcTocId, key, tocId, text, context }` (context: up to 160 characters of the surrounding paragraph). It reads no other text and builds no search index. It runs on idle (2 s after the last change), on blur, hide and close, and is skipped when its hash is unchanged.
- **A derived `links` table** (desktop) or `links` store (web, indexed `by_target`), **outside any search index**. It is replaced per source document on each put. `here#` links are not stored. On desktop it is written through a `links.put` IPC on the worker's low lane.
- **Not decided in v7:** where the table is created. It isn't in the P2.6/W2 amendment (`link_key`, `kind`, `import_sources`), so LK4 adds it through the migration hook unless the owner folds it into P2.6.
- **No background backfill.** A link only comes into being in an open document (typed, pasted or added by LK5, which writes rows as it links). **Known gap:** documents that arrive with links already inside them (a `.tinydoc` import, a backup restore) have no rows until they are next opened, so Linked from can miss them until then.

**Query:**
```sql
SELECT src_doc_id, src_toc_id, text, context FROM links WHERE target_key = ?
  AND src not trashed, ordered by src opened_at DESC
```
Grouped by source document. The `here#` count is excluded.

**Where it shows.**
- A **Linked from** section **after the last block**, outside the contenteditable, inside the page card's width.
  - It is collapsed by default to one row: "Linked from 3 documents ▸".
  - Expanded, it lists each source: the title, the heading of the linking section, and the `context` with the link text bold.
  - **Enter** opens the source at that section (`goToHeading`).
  - It is hidden when the count is 0.
- **Links to This Document** in ⋯ and in the palette scrolls to the section, expands it and focuses its first item.
- **The document's ⋯ status popover** (word count, E3) gains "Linked from 3 documents" as a link to the section.
- **Not in the toolbar or chip.** Not a sidebar pane (the outline already uses the margin).

**Freshness:** re-queried on open, and on `links` change events for this key, debounced to 1 s. A new link in another open window appears within about 3 s of that window going idle.

**Unlinked mentions (later, not v1).** They need body-text search, which D24 takes out of v1 (later, not planned). The **Link** action, also, must open and edit another document through its own window (the worker can't write). That is a flow worth its own design. Logseq users also ask for filters and a "link all" action.

**Graph view: recommended against, and not on the roadmap.**
- TinyDocy documents are long, structured pages, not atomic notes. A graph of a few hundred long documents is mostly a hairball that answers no question the Linked from list doesn't.
- A canvas graph can't be used from the keyboard or a screen reader without a parallel list. Linked from already is that list.
- A force layout at 10,000 nodes costs real CPU, and a large dependency, in a chunk budget that is already tight.
- Revisit as a **local graph** (one hop) only if testers ask after v1.

---

## 6. Desktop and web parity

| Part | Desktop | Web library | Sandbox |
|---|---|---|---|
| Normalizer, metadata query compiler, link parser, links-only pass | shared `lib/search/*`, `lib/links/*` | same | — |
| Search source | the renderer's index snapshot; `index.searchTitles` above 5,000 documents | the in-memory library index | tab titles only, as today |
| Backlinks index | derived `links` table | `links` store (writer tab only, W-D3) | none |
| Quick Open over titles, tags, folders and properties; list filter | yes | yes | no (titles of tabs only, as today) |
| Document links, hovercard, Linked from | yes | yes | no |
| `here#` heading links | yes | yes | if LK1's ledger line allows (§4.8) |

---

## 7. Accessibility

- **Quick Open.**
  - cmdk listbox, as UX §4.3. A row matched by a tag or folder has the accessible name "Q4 budget, tagged finance" or "Q4 budget, in Work › Q4".
  - Matches use `<mark>` plus bold, never colour alone (UX §8.5).
  - When results settle, a polite live region says "5 documents". It is not announced per keystroke.
  - Operator chips are buttons with `aria-haspopup="listbox"` (organize review §739).
  - Titles are `<bdi dir="auto">`.
- **Document links in the editor.**
  - The icon has `aria-hidden`. The state is in the link's accessible description (`aria-describedby` on a hidden "Deleted document" or "In Trash" span, set by the lazy decorator), so a screen reader says more than "link".
  - The dashed underline covers the colour-blind case.
- **Hovercard:** reachable with the extension's keyboard focus path. Esc closes it and returns focus. Actions are buttons.
- **Linked from:**
  - a `<section aria-labelledby>` with an `h2` "Linked from", outside the editor's tab order but reachable through **Links to This Document**, and through F6 cycling (UX §8.2) as its own region when expanded
  - The expanded state is announced.
- **`[[` picker:** the same combobox pattern as the "/" menu: `aria-activedescendant` on `view.dom`, never `aria-expanded` on the textbox (AGENTS.md).
- **Reduced motion:** no animation on result insertion. Hovercard fades follow the extension's existing reduced-motion handling.

---

## 8. States and copy

| State | Where | Copy | Actions |
|---|---|---|---|
| Quick Open, match in a tag or folder | Quick Open row | Title, then the matching tag or folder path with the match bold | Enter opens |
| Quick Open, nothing matches | Quick Open | Create “q4 plan draft” · Search looks at titles, tags and folders, not inside documents. | Enter creates |
| Only filters | Quick Open, list filter | (Lists matching documents, sorted by Modified) | — |
| List filter, no results | List | No documents match “budget q4”. | [Clear Filter] |
| Result in Trash | Result row | In Trash (in the path column) | Opens read-only with the Trash banner |
| Link inserted, first time | Pill | Link text is part of the document. If you share it, people see the text but can't open your documents. | [OK] |
| Linking a document to itself (whole document) | ⌘K picker | (This document isn't listed. Its headings are under In this document.) | — |
| Heading gone | Pill after opening | The section this link pointed to was removed. | — |
| Target in Trash | Hovercard | “Q4 budget” is in Trash. | [Open] [Restore] |
| Target deleted | Hovercard | This document was deleted. | [Remove Link] |
| Not in your library | Hovercard | This links to a document that isn't in your library. | [Remove Link] (editable only) |
| Unknown link form | Hovercard | This link needs a newer version of TinyDocy. | — |
| Link text differs from the title | Hovercard action | Use Current Title | Replaces the text with the current title, one undo step |
| Share consent with links | Consent window (P4.4) | This document links to 3 of your documents. People you share with will see the link text but can't open them. | — |
| Linked from, collapsed | End of document | Linked from 3 documents | Click or Enter expands |
| Linked from, expanded | End of document | **Board notes** › Decisions: …see the **Q4 budget** for travel… | Enter opens at that section |
| Import, links kept as text | Import report (onboarding §5.2, shared string) | 52 links between notes were kept as text, like [[Project]]. | [Link Imported Notes] |
| After Link Imported Notes | Sheet (onboarding §5.2, shared strings) | **Linked 40 of 52 links between notes.** 12 point to notes that weren't imported. They stay as text. *(if any)* 4 links to blocks now point to their notes. *(if any)* Embedded notes became links. | [OK] |

---

## 9. Testing

**Unit** (`bun test`)
- **normalize:**
  - a fixture table per script: Latin (NFC and NFD), Persian with ZWNJ and Arabic yeh/kaf, pointed Arabic, Hebrew with niqqud, Persian and Arabic-Indic digits, Chinese and Japanese titles (substring match), emoji, mixed RTL and LTR
  - Idempotence: `normalize(normalize(x)) === normalize(x)`.
- **query compiler:**
  - the operator table in §3.3
  - The **property test** (50,000 runs): never throws, and never matches a template.
- **links-only pass:**
  - Yjs fixtures (no links, links with and without heading ids, `here#`, links in tables and lists, malformed hrefs ignored) → expected rows
  - it reads only `hyperlink` attributes and their paragraph context, never other text (asserted on the output shape)
- **doc-link parser:** accepts the 3 forms; refuses uppercase, wrong length, `tinydocy://local/…`, `javascript:` and extra segments.
- **import-links:** every row of §4.9's table, ambiguous basenames, code-span escape, templates skipped.

**Worker contract suite** (the P2.6 runner, `node:sqlite`)
- `index.searchTitles` over titles, tags and folder names; Trash scope; `kind='template'` excluded; ties go to `opened_at`
- `links.put`: put, replace, skip on the same hash, purge with the source document, Trash scope

**Playwright**
- **`electron` and `local` projects:**
  1. Quick Open finds a document by an accented title, by a Persian title typed with Arabic letters, by Persian digits, by a tag and by a folder name.
  2. Run each operator (`tag:`, `in:`, `in:trash`, `is:live` on the Live milestone).
  3. ⌘F in a list filters the list; ⌘F in the editor opens Find.
  4. A template never appears in Quick Open, the list filter or the ⌘K picker.
- **Links:**
  - insert via ⌘K, follow, Back
  - rename the target: the text is unchanged and the hovercard shows the new title, and Use Current Title works
  - trash, restore, purge → each state's icon and copy
  - heading deleted → pill
  - `here#` survives Duplicate; Duplicate gets a new `link_key`
  - import a fixture vault, then Link Imported Notes: the counts match the §8 strings
- **Linked from:** appears and updates across two windows.
- **Web library (`chromium`, `webkit`):** two tabs; only the writer tab writes `links` rows (asserted through an IDB spy).
- **Privacy:**
  - A seeded title and body never appear in network requests, logs or diagnostics. Search queries never appear either.
  - **Link test:**
    1. Link A to B with ⌘K, which inserts B's title as link text.
    2. Rename B to a new seeded title.
    3. Share A.
  - Assert on the server's stored Y.Doc:
    - B's `id`, `lineage` and any share id appear nowhere.
    - B's **new** title appears nowhere.
    - The only trace of B is its random `link_key` and the link text the author inserted.
- **`perf` project:** typing latency within 5% of `main` while the links-only pass runs on a document with 1,000 links.
- **Nightly:** a 10,000-document fixture measuring the §3.5 table.

**Design review:** Quick Open's tag and folder rows and operator chips, the list filter, the ⌘K Documents section, the hovercard, broken links and Linked from. Screenshots at 1440, 1100 and 820 px, light and dark, plus an RTL document and a CJK title.

---

## 10. PRs

Numbering avoids P*, W*, A*, U*, S-A*, F*: **SR** for search and **LK** for links. Effort is agent-days of implementation plus review rounds, as in the other designs. **v7:** D24 reduces search to one PR (SR1; the earlier SR2–SR4, the desktop FTS index, the full-text UI and the web text index, are removed), and the links-only pass and `links` table move into LK1 and LK4.

| # | PR | Lens | Depends on | Effort | Exit criteria | Release |
|---|---|---|---|---|---|---|
| **SR1** | **Metadata search:** `normalize` (§3.2), the operator compiler (§3.3), matching over titles, tags, folder names and properties in Quick Open and the list filter (⌘F in a list), `index.searchTitles` widened to tags and folders, operator chips, the §8 search states, a11y. **Design review.** | SE + UX | P2.7a, P2.7b | S: 1.5 days, 2 rounds | Every unit table passes. The property test runs 50,000 cases. The §3.5 targets hold at 1,000 and 10,000 documents. The keyboard checklist passes. | v1 |
| **LK1** | **Document links core:** `doc-link` parser, `linkHost` pass-through (60 B gz ledger line, D23), `protocols`/`isAllowedUri`/`navigate`/`linkIcon`, resolver from the index snapshot, `goToHeading` jumps, the §4.6 states, the links-only pass (`extract-links.ts`), the consent-window line hook for P4.4 | SE + DE | P2.6 (`link_key`), P2.7a | S–M: 3.5 days, 2 rounds | Links follow, Back works, each broken state renders. The chunk script shows the editor delta within the 60 B line. `tinydocy:` never reaches `openExternal`. | v1 |
| **LK2** | **Inserting links and smart chips:** the ⌘K Documents and In this document sections, the heading step (closed-document source per §4.2, open), Copy Link to Document and Copy Link to Heading, the "/" item, the first-time hint. *(Approved 2026-11-22, §4.2a):* the `docChip` node through `linkHost.extensions`, the node view and its registry, the card trigger, conversion both ways, chip paste, the "Insert as" control, `NEXT_PUBLIC_DOC_CHIPS`. **Design review.** | UX + DE | LK1 (#154) merged first and LK2 based on the resulting `main`, SR1 (matcher), #146 for the export mapping | M–L: about 5.5 days, 3 rounds *(was M: 3 days, 2 rounds)* | Insert from ⌘K and from paste, one undo step each. Keyboard-only flow passes. Templates never listed. Every §4.2a state has its name and aria snapshot. The editor-chunk delta is measured on `main` and the branch and fits LK1's 60 B line, or that line is amended by the measured amount. The sandbox Hocus refuses `docChip`. | v1 |
| **LK3** | **`[[` trigger** folded into `slash-trigger`. Measures `slash-trigger` on `main` first. | DE | LK2 | S: 2 days, 2 rounds | Eager cost within the 120 B gz ledger line. Never fires in code or the title. IME-safe. **Cut first** (D23, D30). | v1 unless cut |
| **LK4** | **Hovercard and Linked from:** the `links` table (migration hook, §5) and web store, `links.put` IPC, hovercard config and the card, Use Current Title, the Linked from section, Links to This Document, the ⋯ popover row. **Design review.** | UX + DE + SE | LK1 | M: 3.5–4.5 days, 2 rounds | The card opens with no network request (asserted). Linked from updates across windows. a11y checks pass. Hover preview is fourth and backlinks sixth in D30. | v1 unless cut |
| **LK5** | **Export of links and "Link imported notes":** Export all relative links and slugs, single-export plain text, `link_key` in `library.json` (never NULL: minted at insert, S16; kept only by a backup-zip or `library.json` restore, S8c), `lib/links/import-links.ts`, the one-time Link Imported Notes forward edit over `import_sources` (§4.9) | DE | P2.8, W7 (web Export all), LK1, IM1 | S–M: 3 days, 2 rounds | Round trip desktop → Export all → web keeps every link resolving. The Obsidian fixture vault links with the §8 counts. | v1 unless cut |

- **Totals:** about **16.5–17.5 agent-days** (was about 30; the owner's D24 estimate is about 15 less), 3 design reviews (SR1, LK2, LK4, plus LK3 if it ships), and no server work. *(Proposed 2026-11-22: smart chips, §4.2a, would add about 2.5 days and a round to LK2, for about 19–20 agent-days. LK3 is unchanged.)*
- **Placement:** SR1 with or after P2.7b; the LK PRs after P2.7a/b and P2.11, in parallel with Phase 4. Nothing here blocks Gate 2 or Gate 3. **Everything above must land before Gate 5**, unless D30 cuts it.
- **Seam, already in the plan (v7 schema amendment):** `docs.link_key` in **P2.6** and the W2 `docs` store, next to `lineage`. It stays even if links are cut.
- **Cut order:** the plan's D30 order: **LK3** first, then (after IM3 and the L2 sweep) **LK4's hover preview**, then (after TM1) **backlinks** (LK4's Linked from), then **links** (LK1, LK2, LK5), keeping the `link_key` seam.

---

## 11. Owner questions

| # | Question | Options | Recommendation | Blocks |
|---|---|---|---|---|
| **Q1** | **Full-text search in v1** (amends D-A8) | (a) v1, landing after Gate 3, cuttable per §10. (b) Keep titles only for v1. | *(Recommended (a).)* **Answered by D24:** neither as written. v1 searches titles, tags, folder names and document properties, never body text. Full-text search is later, not planned. | — |
| **Q2** | **Links between documents in v1** | (a) v1: LK1, LK2, LK4, LK5, with LK3 only if within budget. (b) Later: ship only the `link_key` seam. | *(Recommended (a).)* **Answered by D25: (a)**, LK1–LK5 as designed, LK3 first to cut. | — |
| **Q3** | **Should links resolve for collaborators who hold the same document?** | (a) Never in v1: an opaque per-library `link_key`. (b) By `lineage`, so a collaborator who also joined the target sees it resolve. | **(a).** (b) puts an id the server already stores (`shares.lineage`) into shared content, letting the server join "A links to B". It also resolves differently for each reader, which is hard to explain. (a) can grow into (b) later through an explicit "link target" record attached at share time. **Still Call (v7): (a), as recommended; the owner can reverse it. | LK1 (key format) |

---

## 12. Calls made here (check while reading)

- **Search never reads body text** (D24). Quick Open's no-match line says so.
- **Every query word is a prefix**, then substring, as UX §4.3.
- **Persian and Arabic-Indic digits fold to ASCII**; Arabic yeh and kaf fold to Persian.
- **`Intl.Segmenter` is not used** until titles need it.
- **Backlinks keep a links-only pass and a `links` table**, outside any search index, with no background backfill.
- **Headings of closed documents** in the ⌘K picker and the hovercard: **not decided** (§4.2, §4.5).
- A plain click on a document link while **editing places the caret**, like web links. ⌘-click opens.
- The hovercard is **document links only**. External links never get one.
- Single-document export **drops document-link URLs**, keeping the text.
- **Backup `.md` files keep `tinydocy:` hrefs.**
- Imported links stay **literal text** until Link Imported Notes runs.
- `here#` heading links in the public sandbox only if LK1's ledger line allows.
- Comments are **not searched** in v1.

---

## 13. Sources

Research done 2026-11-16. The SQLite, MiniSearch, FlexSearch and Orama sources informed the full-text design that D24 removed from v1.

- SQLite, *FTS5 Extension*: unicode61 `remove_diacritics` and `categories` (default "L\* N\* Co"), trigram tokenizer (the 3-character minimum, `remove_diacritics`, LIKE/GLOB), `snippet()` (≤ 64 tokens), `highlight()`, `bm25()` column weights, `detail` sizes (743/340/134 MiB), external content and contentless-delete (3.43.0), and the query syntax and quoting. https://www.sqlite.org/fts5.html
- Our probes, 2026-11-16: `node:sqlite` on Node 26.13.1 (SQLite 3.54.1). Tokenizer cases and sizes and latencies were in the first version's §3.3 and §3.7 (removed in v7), and the `no such column: comment` raw-MATCH failure. The method is in Appendix A.
- MDN, *Intl.Segmenter*: word granularity for Japanese, Chinese, Thai, Lao, Khmer and Myanmar; Baseline since April 2024. https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Segmenter
- MiniSearch: features (prefix, fuzzy, boosting, custom tokenize and `processTerm`), https://lucaong.github.io/minisearch/; API (`toJSON`/`loadJSON`/`loadJSONAsync`, `discard`, `discardAll`, `replace`, `vacuum`, `addAllAsync`, `combineWith: 'AND'`/`AND_NOT`), https://lucaong.github.io/minisearch/classes/MiniSearch.MiniSearch.html
- FlexSearch 0.8: persistent indexes (IndexedDB), Workers, CJK, Arabic and Hebrew charsets, highlighting, 16.3/11.4/4.5 KB gz builds. https://github.com/nextapps-de/flexsearch
- Orama data persistence (serialize to IndexedDB) and its persist-restore issues (#446, #695). https://docs.orama.com/open-source/plugins/plugin-data-persistence · https://github.com/askorama/orama/issues/446
- Obsidian:
  - Search operators and ⌘⇧F, https://obsidian.md/help/plugins/search
  - Internal links (`[[`, `#heading`, `#^block`, `|alias`, auto-update on rename, links to missing notes), https://obsidian.md/help/links
  - Backlinks (linked and unlinked mentions, in-document backlinks), https://obsidian.md/help/plugins/backlinks
  - Page preview (⌘-hover while editing), https://obsidian.md/help/plugins/page-preview
- Notion:
  - Search filters (Title only, Created by, Teamspace, Date), https://www.notion.com/help/search
  - Links and backlinks (`@`, `[[`, `+`; "{#} backlinks" under the title), https://www.notion.com/help/create-links-and-backlinks
- Bear, *How to search notes*: operators and special searches, ⌘F. https://bear.app/faq/how-to-search-notes-in-bear/
- Apple Notes, linking notes on iOS 17 (Add Link searches note titles). https://www.macrumors.com/how-to/create-links-between-apple-notes
- Logseq forum, linked and unlinked references (collapse threshold; requests for filters and link-all). https://discuss.logseq.com/t/have-you-ever-designed-for-unlinked-references/19896 · https://discuss.logseq.com/t/unlinked-references-collapsed-threshold/26613
- Google Docs Help, *Add links* (bookmarks in the link window). https://support.google.com/docs/answer/45893
- User demand: [editor user requests](../../research/2026-11-15-editor-user-requests.md) rows 4–6 (Obsidian forum /t/1655, 834 likes; /t/4395; /t/15339).

---

## Appendix A: Probe method (reproducible)

> **Evidence only (v7).** These probes measured full-text search, which D24 takes out of v1 (later, not planned). Nothing in v1 depends on them, and the D-A12 smoke test does not repeat them. They are kept so the cost can be re-checked if full-text search is ever reopened.

Run with `node` ≥ 22.13 (`node:sqlite`).

**Normalizer used in the tokenizer probes** (the §3.3 prototype):

```js
const seg = new Intl.Segmenter("und", { granularity: "word" });
const RUN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]+/gu;
const norm = (s) => s.normalize("NFC")
  .replace(/[ً-ٰٟۖ-ۭ֑-ׇـ]/g, "")
  .replace(/ي/g, "ی").replace(/ك/g, "ک")
  .replace(RUN, (r) => [...seg.segment(r)].map((x) => x.segment).join("​"));
// query: norm(q).split(/[\s​]+/).filter(Boolean).map((t) => `"${t}"*`).join(" ")
```

**Tokenizer variants compared:**
- `unicode61 remove_diacritics 2`
- `unicode61 remove_diacritics 2 categories 'L* N* Co M*'`
- `trigram remove_diacritics 1`, rejected on the documented 3-character minimum

**Benchmark schema:** exactly the first version's §3.4 `sections` + `sections_fts` (external content) with these triggers:

```sql
CREATE TRIGGER s_ai AFTER INSERT ON sections BEGIN
  INSERT INTO sections_fts(rowid, heading, body) VALUES (new.rowid, new.heading, new.body); END;
CREATE TRIGGER s_ad AFTER DELETE ON sections BEGIN
  INSERT INTO sections_fts(sections_fts, rowid, heading, body) VALUES ('delete', old.rowid, old.heading, old.body); END;
```

**Data and queries:**
- **Data:** N documents × 8 sections. Each section has a 4-word heading and a 110-word body, taken as random windows of this repository's `docs/research/*.md` and `docs/superpowers/specs/*.md` (natural English vocabulary). Each document is written in one transaction. Then: `'optimize'`, `wal_checkpoint(TRUNCATE)`, and the file size.
- **Reindex:** the mean of 20 delete-and-reinsert puts of 8 sections, followed by `'integrity-check'`.
- **Grouped query:**
  ```sql
  WITH h AS MATERIALIZED (
    SELECT s.doc_id, bm25(sections_fts, 4.0, 1.0) r
    FROM sections_fts JOIN sections s ON s.rowid = sections_fts.rowid
    WHERE sections_fts MATCH ?)
  SELECT doc_id, min(r) r FROM h GROUP BY doc_id ORDER BY r LIMIT 50
  ```
  - A plain `GROUP BY` over `bm25()` fails with "unable to use function bm25 in the requested context".
  - Snippets are taken separately for up to 150 sections.
- **Raw-MATCH failure:** `MATCH 'sync* -comment*'` raises `no such column: comment`.
