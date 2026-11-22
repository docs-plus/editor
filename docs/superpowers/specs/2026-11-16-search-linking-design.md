# TinyDocy: search and links between documents

> **Owner answers (plan v7, 2026-11-16)**, which this revision applies:
> - **D24 (Q1):** **search in v1 covers titles, tags, folder names and document properties (dates, Local/Live, template kind), not document body text** ("contents search is heavy"). Removed from v1: FTS5 and `search.sqlite`, the web `text` store, MiniSearch and FlexSearch, the renderer text extractor and its background pass, the "In documents" group and the separate Search view. Full-text body search moves to **Later (owner: not planned)**. §3 is rewritten to this scope; the old full-text design survives only as the probe evidence in Appendix A.
> - **D25 (Q2):** links between documents ship in v1, **LK1–LK5 as designed**; **LK3 `[[` is the first to cut** (D30).
> - **D23:** LK1's `linkHost` pass-through is a **60 B gz** line and LK3's `[[` a **120 B gz** line in the single editor-chunk ledger (details §1 rule 5). LK3 measures `slash-trigger` first.
> - **D30:** the pre-approved cut order puts LK3 first, LK4's hover preview fourth, backlinks sixth and links seventh (keeping the `link_key` seam).
> - **Staff integration review:** one P2.6/W2 schema amendment adds `docs.link_key` (UNIQUE; **`NOT NULL`, minted at insert, since plan v8: S16, D40**), `docs.kind` and `import_sources(doc_id, relative_path, source_app)`. Duplicate, New from Template and `.tinydoc` import always get a new `link_key`. Search, backlinks and the ⌘K picker skip `kind='template'`. Import keeps wikilinks as text and records relative paths; **LK5 adds a one-time "Link imported notes"** (§4.9).
> - **Plan v8 (D40, D41):** `link_key` is minted when the document is inserted, never lazily (S16), so two synced devices can't mint different keys later. Only a backup-zip or `library.json` restore keeps it (S8c). The editor-chunk ledger gains D41's conditional phone line (≈1,580–1,660 B in all); LK1 and LK3 keep their lines.
> - **Q3: call (v8):** (a), links never resolve for collaborators in v1. The owner can reverse this.

> **Proposed, pending owner approval (2026-11-22): LK1 linking-UX review.** Head of Engineering, senior staff, UI and accessibility review of LK1 (`claude/feat-lk1-doc-links`), with a clickable prototype: [`docs/design/2026-11-22-document-links-prototype.html`](../../design/2026-11-22-document-links-prototype.html), screenshots in `docs/design/2026-11-22-document-links/`. Nothing below is approved. The sections it touches keep their current text, with the proposal beside it marked **Proposed (2026-11-22)**. Owner questions **Q4–Q10** (§11) carry the decisions; the first option is the recommendation.
> - **Q4: Deleted vs Not in your library.** After a purge the resolver can't tell them apart. Recommended **(b)**: one **Not available** state, `FileQuestion`, "This links to a document that isn't in your library. It may have been deleted." [Remove Link]. No schema; leaks nothing. (a) adds a `deleted_keys` table to P2.6, trimmed after 90 days.
> - **Q5: In Trash glyph.** Recommended `FileMinus` (keeps the file shape for every state; `Trash2` mid-sentence reads as a delete button). Confirm on the screenshots.
> - **Q6: `here#` links use `Hash`**, not `FileText`.
> - **Q7: a document-link preview** for a plain click or Mod-K while editing: title, "› Heading", the folder path, [Open] [Copy Link] [Remove Link]. It never shows the href or key and has no Edit. The alternative, the stock popover, shows `tinydocy:doc/<key>`.
> - **Q8: the production link host is wired in LK2** (no PR row owns it today). Back, focus-after-follow and the arrival announcement become LK2 exit criteria.
> - **Q9: the `links` table is created in the P2.6 amendment**, not an LK4 migration. `context` (160 characters) stays as an explicit local-only exception to D24.
> - **Q10: headings of closed documents (§4.2, §4.5).** v1 links to whole closed documents and to headings of the open one; ⇥ on a closed document loads its outline lazily (`loadOutline(docId)`, 150 ms budget, a "Loading headings…" row). The alternative is whole-document links only.
> - **Not a decision, a finding (prototype probe):** a line can break between the link icon and the first word when the icon is `display: inline-block` (the package default): 18–28% of widths in headless Chromium, LTR and RTL. An inline, `white-space: nowrap` icon span with a word joiner (U+2060) after the svg, and the gap on the svg, never split in 402 widths (§4.6).

- **Status:** revised for plan v7, 2026-11-16 (was a proposal for owner review). Nothing here is built.
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

  > **Proposed (2026-11-22), pending owner approval (Q10):**
  > - Headings appear only after **⇥** (or → in a left-to-right interface, ← in a right-to-left one) on a document row, never automatically under the top match. Shift+⇥ or the opposite arrow goes back.
  > - For a closed document, ⇥ calls a lazy `loadOutline(docId)` with a **150 ms budget**. Until it answers, the list shows one row, "Loading headings…" (`role=status`). The first row of the heading step is **Whole document**.
  > - If Q10 goes the other way (whole documents only), document rows show no chevron, the footer drops "⇥ Headings", and ⇥ on a closed document shows "Headings are listed only for this document."
  > - Rows reuse Quick Open's row: the title with the match in bold, then the folder path collapsed from the start ("… › Finance", the full path in the tooltip). The input is a `combobox` with `aria-activedescendant`; rows are `option`s.

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

> **Proposed (2026-11-22), pending owner approval (Q7, Q8):**
>
> | Gesture | Action |
> |---|---|
> | A plain click while editing *(replaces the row above)* | Places the caret. The **preview popover** shows the target's title, "› Heading" and folder path (or the §4.6 state) with **[Open] [Copy Link] [Remove Link]**. It never shows the href or key, and it has no Edit for document links. Mod-K with the caret in a link opens the same popover. Web links keep the stock popover. |
> | Keyboard *(new row)* | Enter on a focused link (reading mode or read-only): this tab. ⌘⇧Enter: a new tab. Alt+Enter while editing: follow. Every path goes through `navigate`. |
>
> - **A broken link never navigates** (deleted, not in your library, newer version): every follow gesture shows its preview instead.
> - **`onFollow` payload:** the source document id and the link's position as a Yjs relative position, so Back can put the caret back in the link. It fires once for resolved, In Trash and `here#` links, never for broken ones.
> - **Arrival:** `openAtHeading` finds the heading in the live document (`findTocAnchor`). If it is missing, it retries once after the first server sync before showing "The section this link pointed to was removed.", then scrolls again on a second `requestAnimationFrame`. The heading lands at the top, below the toolbar (`block: "start"`, never hidden under it, WCAG 2.4.11). In reading mode and read-only documents the heading takes focus (`tabindex=-1`); while editing, the caret goes to the end of the heading. Focus never lands on `body`.
> - **One announcement per follow,** polite: "Opened Q4 budget, at Travel." (§8).
> - *Prototype additions, not from the review (confirm at the design review):* the same text also shows as a status pill for 3 s; `here#` follows announce "At Budget assumptions."
> - **Back** puts the caret back in the link (editing) or focuses it (reading). The Back, focus-after-follow and announcement end-to-end tests belong to the PR that wires the production host (LK2 under Q8); LK1 carries the payload and unit tests.

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

> **Proposed (2026-11-22), pending owner approval:**
> - **The hovercard is pointer-only.** Its keyboard equivalent is the Q7 preview popover (Mod-K on a focused link or with the caret in one), with the same actions as buttons. This replaces "from the keyboard: the existing focus-preview path" above.
> - **Card layout (prototype):** 20rem (`--hl-hovercard-width`); title with "› Heading"; the 2-line snippet; "… › Finance · Edited 12 Nov"; a footer with **Use Current Title** on the start side and Open, Open in New Tab and Copy Link as icon buttons on the end side. The card is a custom `render` with no native `tinydocy:` anchor inside it.
> - **State cards:** In Trash shows "“Q4 budget” is in Trash." with [Open] [Restore]; broken states show their §4.6 copy with [Remove Link] when editable; the newer-version state shows its copy only.
> - **Motion:** the package's 0.96 scale, 120 ms in and 80 ms out; none under reduced motion. Icon state swaps (for example after Restore) are instant.
> - **Heading source for a closed document** follows Q10: until the card can read the target's outline, it shows the title and `docs.snippet`.
> - **WCAG 1.4.13** tests (hoverable, persistent, dismissible) are LK4 exit criteria.

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

> **Proposed (2026-11-22), pending owner approval (Q4, Q5, Q6):**
>
> | State | Icon | Style | Preview / hovercard copy | Icon accessible name |
> |---|---|---|---|---|
> | Resolves | `FileText` | normal | the card in §4.5; the Q7 preview | hidden (`aria-hidden`) |
> | Section of this document (`here#`) *(new row)* | `Hash` (Q6) | normal | the heading name, "In this document" | hidden |
> | Heading gone | `FileText` | normal | opens at the top with the pill | hidden |
> | In Trash | `FileMinus` (Q5) | normal | "“Q4 budget” is in Trash." [Open] [Restore] | "In Trash" |
> | **Not available** *(replaces Deleted and Not in this library, Q4 (b))* | `FileQuestion` | dashed underline | "This links to a document that isn't in your library. It may have been deleted." No title, no key. [Remove Link] when editable. | "Not in your library" |
> | Unknown future form | `FileQuestion` | dashed | "This link needs a newer version of TinyDocy." | "Needs a newer version" |
>
> - **Icons are `currentColor`;** the state is never shown by colour alone. Size and gap match the package (a 1em icon, a 0.25em gap; `doc-links.css` sets no size or margin of its own), so the icon follows coloured and resized link text and sits inside a highlight. The one exception is the glue below: if it survives the WebKit and caret checks, it overrides the package's `display` and moves the gap onto the svg; otherwise the package box stays as it is.
> - **The dashed rule covers inner spans** (coloured or resized text inside the link), with `text-decoration-thickness: max(1px, 0.07em)` for broken states.
> - **The icon never wraps away from the first word.** Prototype probe (headless Chromium, 201 widths, LTR and RTL): with the package's `display: inline-block` icon, a line broke between the icon and the link's first word at 18–28% of widths; a word joiner alone or `nowrap` alone did not help. An **inline** icon span with `white-space: nowrap`, a **word joiner (U+2060) after the svg**, and the 0.25em gap on the svg (so it stays between icon and text when bidi reorders an English title inside right-to-left text) split at 0 of 402 widths. **LK1 must check before adopting it:** WebKit; the caret-movement test; and the real DOM. The probe tested one span level. If the extension wraps the resolver's node in its own inline-block `.hyperlink-icon`, that outer box is the atomic one and is the element that has to become inline.
> - **RTL:** test first. If the icon drifts, add `unicode-bidi: isolate` on the anchor (never `plaintext`), only if the caret-movement test still passes. The prototype has a switch for it.
> - **The resolver refreshes icons** from a debounced snapshot listener, only when a key is added or removed or `trashed` or `kind` changes. `refreshLinkIcons` sets and clears `role`, `aria-label` and `aria-hidden` with `data-link-state`.
> - If Q4 goes to (a), the two states keep their rows above (`FileX` "Deleted" and `FileQuestion` "Not in your library"), and P2.6 gains a `deleted_keys` table trimmed after 90 days.

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

> **Proposed (2026-11-22), pending owner approval (Q9):**
> - **Rows:** `{srcDocId, ordinal, srcTocId, key, tocId, text ≤ 200, context ≤ 160}`. `text` is capped at about 200 characters with an ellipsis. Links with the same href in one run merge (pinned by a test). `docs.links_hash` NULL means never scanned.
> - **`context` is a local-only exception to D24:** it never leaves the device and is never searched.
> - **Where the table lives:** created in the **P2.6 amendment** with `link_key`, `kind` and `import_sources` (cheaper there than an LK4 migration).
> - **The pass is skipped** when no Y.Doc transaction since the last run touched a `hyperlink` attribute (a dirty flag), and its budget is under 8 ms blocking at 500 headings / 2 MiB.
> - **Layout (LK4, prototype):** the section after the last block, inside the page card; the toggle is `button[aria-expanded]` inside the `h2`, in the normal Tab order; expanded rows are links: the source title in bold, "› Heading", then up to two lines of `context` with the link text bold. Expanding is instant (no animation).
> - **Freshness across windows:** `BroadcastChannel('tinydocy-links')`. Duplicate copies the source's `links` rows.

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

> **Proposed (2026-11-22), pending owner approval:**
> - **Document links in the editor** *(replaces the icon bullet above)*: broken and In Trash icons are `role=img` with an `aria-label` ("In Trash", "Not in your library", "Needs a newer version"), so the state prefixes the link's accessible name ("In Trash Hiring plan"). Resolved and `here#` icons stay `aria-hidden`. The `aria-describedby` decorator is dropped.
> - **Hovercard** *(replaces the hovercard bullet)*: pointer-only. The keyboard equivalent is the preview dialog (Mod-K), with the same actions as buttons. Esc returns the caret to the link (editing) or focus to it (reading).
> - **Linked from** *(amends its bullet)*: an F6 region whenever it is rendered (collapsed or expanded), and its toggle is in the normal Tab order.
> - **Roles:**
>
> | Element | Role |
> |---|---|
> | A document link | `a[href]` (with the state icon's `role=img` inside when not resolving) |
> | Preview popover | `dialog`, labelled "Link to Q4 budget"; its actions are `button`s |
> | Hovercard actions | `button` |
> | Linked from section | `region` labelled by its `h2` |
> | Linked from toggle | `button[aria-expanded]` |
> | Linked from row | link |
> | ⌘K picker | `combobox` input with `aria-activedescendant`; rows `option` in a `listbox` |
> | After a follow | one polite live-region message |
>
> - **Contrast:** the icon and link text reach at least 4.5:1 on every highlight colour in light and dark; LK1's visual matrix asserts it.

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

> **Proposed (2026-11-22), pending owner approval (Q4, Q7, Q10):** the "Target deleted" and "Not in your library" rows merge into one, and four rows are added. All strings live in the one central copy table that `consent.ts` and the link chunk read.
>
> | State | Where | Copy | Actions |
> |---|---|---|---|
> | Not available *(replaces Target deleted and Not in your library)* | Preview, hovercard | This links to a document that isn't in your library. It may have been deleted. | [Remove Link] (editable only) |
> | Resolving link, preview | Preview popover (click while editing, Mod-K) | **Q4 budget** › Travel · … › Finance · Edited 12 Nov | [Open] [Copy Link] [Remove Link] |
> | After a follow | Live region | Opened Q4 budget, at Travel. | — |
> | After a `here#` follow *(prototype addition, not from the review)* | Live region | At Budget assumptions. | — |
> | Closed document, heading step | ⌘K picker | Loading headings… | — |

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
| **LK2** | **Inserting links:** the ⌘K Documents and In this document sections, the heading step (closed-document source per §4.2, open), Copy Link to Document and Copy Link to Heading, the "/" item, the first-time hint. **Design review.** | UX + DE | LK1, SR1 (matcher) | M: 3 days, 2 rounds | Insert from ⌘K and from paste, one undo step each. Keyboard-only flow passes. Templates never listed. | v1 |
| **LK3** | **`[[` trigger** folded into `slash-trigger`. Measures `slash-trigger` on `main` first. | DE | LK2 | S: 2 days, 2 rounds | Eager cost within the 120 B gz ledger line. Never fires in code or the title. IME-safe. **Cut first** (D23, D30). | v1 unless cut |
| **LK4** | **Hovercard and Linked from:** the `links` table (migration hook, §5) and web store, `links.put` IPC, hovercard config and the card, Use Current Title, the Linked from section, Links to This Document, the ⋯ popover row. **Design review.** | UX + DE + SE | LK1 | M: 3.5–4.5 days, 2 rounds | The card opens with no network request (asserted). Linked from updates across windows. a11y checks pass. Hover preview is fourth and backlinks sixth in D30. | v1 unless cut |
| **LK5** | **Export of links and "Link imported notes":** Export all relative links and slugs, single-export plain text, `link_key` in `library.json` (never NULL: minted at insert, S16; kept only by a backup-zip or `library.json` restore, S8c), `lib/links/import-links.ts`, the one-time Link Imported Notes forward edit over `import_sources` (§4.9) | DE | P2.8, W7 (web Export all), LK1, IM1 | S–M: 3 days, 2 rounds | Round trip desktop → Export all → web keeps every link resolving. The Obsidian fixture vault links with the §8 counts. | v1 unless cut |

- **Totals:** about **16.5–17.5 agent-days** (was about 30; the owner's D24 estimate is about 15 less), 3 design reviews (SR1, LK2, LK4, plus LK3 if it ships), and no server work.
- **Placement:** SR1 with or after P2.7b; the LK PRs after P2.7a/b and P2.11, in parallel with Phase 4. Nothing here blocks Gate 2 or Gate 3. **Everything above must land before Gate 5**, unless D30 cuts it.
- **Seam, already in the plan (v7 schema amendment):** `docs.link_key` in **P2.6** and the W2 `docs` store, next to `lineage`. It stays even if links are cut.
- **Cut order:** the plan's D30 order: **LK3** first, then (after IM3 and the L2 sweep) **LK4's hover preview**, then (after TM1) **backlinks** (LK4's Linked from), then **links** (LK1, LK2, LK5), keeping the `link_key` seam.

> **Proposed (2026-11-22), pending owner approval (Q8):**
> - **LK1** adds to its exit criteria: the editor-chunk delta measured before and after on the same base and recorded in `scripts/check-editor-chunk-size.ts` and the commit; a `tinydocy:` mark from Yjs, paste or with no host present is never opened (`window.open` spy); `tinydocy` registers once across two editors and a remount, and typing `tinydocy:…` never autolinks; the gesture table (click, ⌘-click, ⌘⇧-click, middle click, Enter, Alt+Enter, ⌘⇧Enter, read-only and editing) makes no `tinydocy:` request or frame navigation; two create/dispose cycles leave no window listeners; the visual matrix (states × paragraph, heading, list, table, styled text × light and dark, plus Persian in a left-to-right document and English in a right-to-left one) with screenshots for the design review.
> - **LK2 owns the production host** (web library and desktop shell). Its exit criteria gain: Back restores the caret or focuses the link; focus after a follow is never `body` and never under the sticky toolbar; one arrival announcement; Copy Link to Heading is disabled on empty headings and reads the id from Yjs (two-client id-stability test); `here#` links become `doc/<key>#` when copied out of their document.
> - **Byte plan:** inside LK1's 60 B line, only the `linkHost` prop and the `...linkHost` spread. `popovers` in the host and LK4's `hovercard` ride the same spread (0 B in the editor chunk) — but the spread is shallow, so the host passes all three popovers. If importing the package popovers into the host chunk splits the editor group (about +1.6 KB), the fallback is `previewHyperlink: linkHost?.wrapPreview?.(previewHyperlinkPopover) ?? previewHyperlinkPopover` (about 20 B) inside the 60 B line. If neither fits, LK2's host wiring is blocked; LK1 still merges, since it has no production host.

---

## 11. Owner questions

| # | Question | Options | Recommendation | Blocks |
|---|---|---|---|---|
| **Q1** | **Full-text search in v1** (amends D-A8) | (a) v1, landing after Gate 3, cuttable per §10. (b) Keep titles only for v1. | *(Recommended (a).)* **Answered by D24:** neither as written. v1 searches titles, tags, folder names and document properties, never body text. Full-text search is later, not planned. | — |
| **Q2** | **Links between documents in v1** | (a) v1: LK1, LK2, LK4, LK5, with LK3 only if within budget. (b) Later: ship only the `link_key` seam. | *(Recommended (a).)* **Answered by D25: (a)**, LK1–LK5 as designed, LK3 first to cut. | — |
| **Q3** | **Should links resolve for collaborators who hold the same document?** | (a) Never in v1: an opaque per-library `link_key`. (b) By `lineage`, so a collaborator who also joined the target sees it resolve. | **(a).** (b) puts an id the server already stores (`shares.lineage`) into shared content, letting the server join "A links to B". It also resolves differently for each reader, which is hard to explain. (a) can grow into (b) later through an explicit "link target" record attached at share time. **Still Call (v7): (a), as recommended; the owner can reverse it. | LK1 (key format) |
| **Q4** *(proposed 2026-11-22)* | **Deleted vs Not in your library** after a purge | (a) A `deleted_keys` table in the P2.6 amendment, trimmed after 90 days; two states. (b) One **Not available** state, `FileQuestion`, merged copy. | **(b).** Both states offer the same action, (b) needs no schema and leaks nothing. | LK1 (§4.6, §8) |
| **Q5** *(proposed)* | **In Trash glyph in running text** | (a) `FileMinus`. (b) `Trash2`. | **(a).** Keeps the file shape for every state; `Trash2` mid-sentence reads as a delete button. Confirm on the screenshots. | LK1 |
| **Q6** *(proposed)* | **`here#` icon** | (a) `Hash`. (b) `FileText`, shared with links to other documents. | **(a).** | LK1 |
| **Q7** *(proposed)* | **Preview for a document link** (plain click or Mod-K while editing) | (a) A document preview: title, "› Heading", path, [Open] [Copy Link] [Remove Link]; never the href or key; no Edit. (b) The stock popover, which shows `tinydocy:doc/<key>`. | **(a).** | LK1 (host `popovers`; bytes per §10) |
| **Q8** *(proposed)* | **Which PR wires the production link host** | (a) LK2 (web library and desktop shell), with Back, focus and announcement end-to-end tests as its exit criteria. (b) A separate PR. | **(a).** | LK2 |
| **Q9** *(proposed)* | **Where the `links` table is created** | (a) The P2.6 amendment. (b) An LK4 migration. | **(a).** Cheaper there. `context` stays a local-only exception to D24. | P2.6, LK4 |
| **Q10** *(proposed)* | **Headings of closed documents** (§4.2, §4.5) | (a) Lazy `loadOutline(docId)` on ⇥, 150 ms budget, "Loading headings…" row. (b) Whole-document links only for closed documents in v1. | **(a).** | LK2, LK4 |

---

## 12. Calls made here (check while reading)

- **Search never reads body text** (D24). Quick Open's no-match line says so.
- **Every query word is a prefix**, then substring, as UX §4.3.
- **Persian and Arabic-Indic digits fold to ASCII**; Arabic yeh and kaf fold to Persian.
- **`Intl.Segmenter` is not used** until titles need it.
- **Backlinks keep a links-only pass and a `links` table**, outside any search index, with no background backfill.
- **Headings of closed documents** in the ⌘K picker and the hovercard: **not decided** (§4.2, §4.5).
  - *Proposed (2026-11-22), Q10:* lazy `loadOutline` on ⇥ with a "Loading headings…" row.
- *Proposed (2026-11-22):* a document link's click preview never shows its href or key (Q7); the hovercard is pointer-only and Mod-K is its keyboard path.
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
