# TinyDocy: search and links between documents

> **Owner answers (plan v7, 2026-11-16)**, which this revision applies:
> - **D24 (Q1):** **search in v1 covers titles, tags, folder names and document properties (dates, Local/Live, template kind), not document body text** ("contents search is heavy"). Removed from v1: FTS5 and `search.sqlite`, the web `text` store, MiniSearch and FlexSearch, the renderer text extractor and its background pass, the "In documents" group and the separate Search view. Full-text body search moves to **Later (owner: not planned)**. §3 is rewritten to this scope; the old full-text design survives only as the probe evidence in Appendix A.
> - **D25 (Q2):** links between documents ship in v1, **LK1–LK5 as designed**; **LK3 `[[` is the first to cut** (D30).
> - **D23:** LK1's `linkHost` pass-through is a **60 B gz** line and LK3's `[[` a **120 B gz** line in the single editor-chunk ledger (details §1 rule 5). LK3 measures `slash-trigger` first.
> - **D30:** the pre-approved cut order puts LK3 first, LK4's hover preview fourth, backlinks sixth and links seventh (keeping the `link_key` seam).
> - **Staff integration review:** one P2.6/W2 schema amendment adds `docs.link_key` (UNIQUE; **`NOT NULL`, minted at insert, since plan v8: S16, D40**), `docs.kind` and `import_sources(doc_id, relative_path, source_app)`. Duplicate, New from Template and `.tinydoc` import always get a new `link_key`. Search, backlinks and the ⌘K picker skip `kind='template'`. Import keeps wikilinks as text and records relative paths; **LK5 adds a one-time "Link imported notes"** (§4.9).
> - **Plan v8 (D40, D41):** `link_key` is minted when the document is inserted, never lazily (S16), so two synced devices can't mint different keys later. Only a backup-zip or `library.json` restore keeps it (S8c). The editor-chunk ledger gains D41's conditional phone line (≈1,580–1,660 B in all); LK1 and LK3 keep their lines.
> - **Q3: call (v8):** (a), links never resolve for collaborators in v1. The owner can reverse this.

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
- **The card's design** (anatomy, states, focus, phone, RTL, motion and anti-slop acceptance criteria) is §4.5a, *proposed, pending owner approval (2026-11-22)*. Per the owner's review, its hover card and dialog show only Open, Copy Link and ⋯; the other actions above live in ⋯ (L2).

### 4.5a Link card (hover and preview)

> **Status: proposed, pending owner approval (2026-11-22), revised the same day after the owner's review.** The owner approved smart chips (§4.2a, PR #167) and the linking design (PR #163) and asked for a more mature card, without "AI slop" design. This section is the final design after three directions (Quiet utility, Native document, Editorial) were judged by a design critic, an accessibility reviewer and the Head of Engineering. Quiet utility won all three verdicts; the grafts and must-fixes from the other two are applied below.
> - **Owner feedback on the first version (2026-11-22):** "we need the icon, icons get feels better to the enduser, just ensure we do not make soo complicated with lot's of buttons and functions … we can add 3 dots menu and put those not necessery functionalities in the 3 dot menu". Applied here: the state icon leads the title row again, the actions carry icons, and the hover card and the dialog both show only **Open, Copy Link and ⋯**. Everything else is in ⋯ (decision L2).
> - **Prototype:** [`docs/design/2026-11-22-link-card-prototype.html`](../../design/2026-11-22-link-card-prototype.html). It is fully self-contained (Inter and the twelve lucide icons are inlined, from `lucide-react` 1.72.0, the app's version). It shows every state on every surface in light and dark, the ⋯ menu open, the Copy Link tooltip, right to left, a 390px phone, a 320px frame, reduced motion, a working "Try it" paragraph (hover timing, Mod-K, the ⋯ menu's keys), and two computed panels: **Anti-slop checklist** and **Accessibility** (role, name and state of each element).
> - **Screenshots:** [`docs/design/2026-11-22-link-card/`](../../design/2026-11-22-link-card/), including `compare-*.jpg` side by sides of the #163 and #167 cards and this one.
> - **Applies to** document links (`tinydocy:` marks) and smart chips (`docChip`), on the hover card, the preview dialog and the phone sheet.

**One body, three shells.** The hover card (pointer), the preview dialog (click, Mod-K, Alt+Enter) and the phone long-press sheet render the same card body. The hover card and the dialog also share the same footer: **Open** (icon and label), **Copy Link** (icon) and **⋯**. Only the wrapper and focus differ between them. The width never changes between hover and click. The sheet lists every action as a row.

#### Anatomy

| Slot | Content | Type | Spacing |
|---|---|---|---|
| Frame | — | Inter (`--font-sans`) | 20rem wide (`--hl-hovercard-width: 20rem`), `max-width: calc(100vw - 1rem)`; 1px `--border`; `--radius` (7.2px); `--popover` / `--popover-foreground`; **shadow-md**, the only elevation; opens 6px below the anchor, aligned to its inline start |
| Body | — | — | padding 10px top, 12px sides, 12px bottom |
| 1 Title row | the anchor's own state icon, then the current title; with a heading link, "› Heading" on the same line | icon 16px lucide, `currentColor` in `--muted-foreground`; title 14/20, weight 500. "› Heading" 14/20, weight 400, `--muted-foreground` | icon on the 12px inset, 2px down so it sits on the first line; 6px gap; the title starts the **34px text column** |
| 2 Meta | [In Trash] · folder path · Edited date | 12/16, `--muted-foreground`; "In Trash" weight 500 in `--popover-foreground` | on the 34px column, 2px above; 6px gap around each `·` |
| 3 Snippet | `docs.snippet`, 2-line clamp | 13/19, weight 400, `--popover-foreground` | full width from the 12px inset, 8px above |
| 4 Actions | **Open** (16px `ArrowUpRight` and its label), then at the inline end **Copy Link** (16px `Copy`, icon only) and **⋯** (16px `Ellipsis`) | 12/16, weight 500; Open in `--popover-foreground`, the two icon buttons `--muted-foreground`; hover `--accent` | 1px `--border` hairline above; 6px padding; 28px tall, `--radius-md` (5.76px). Open has 6px / 8px side padding and a 6px gap, so its arrow sits on the 12px inset and its label on the 34px column. The icon buttons are 28×28 |
| ⋯ menu | the secondary actions, each with its icon | 14/20; 16px icon in `--muted-foreground`, 8px gap | `DropdownMenu`: 4px padding, 32px rows, `--radius-md` rows, min-width 12rem, `--radius` and shadow-md; opens 4px below ⋯, aligned to its inline end |
| Tooltip | "Copy Link", "More link actions" | 12/16, `--background` on `--foreground` (`components/ui/tooltip`) | 6px 12px padding, `--radius-md`; below the button, so it never covers the card's text |

- **Icons are type and state markers or action labels, never decoration.** The title row's icon is the anchor's: `FileText` (a document), `Hash` (a heading in this document), `FileMinus` (In Trash), `FileQuestion` (Not available, Newer version). Action icons: `ArrowUpRight` Open and Go to Section, `Copy` Copy Link, `Ellipsis` ⋯, and in ⋯ and the sheet `SquareArrowOutUpRight` Open in New Tab, `Undo2` Restore, `ArrowRightLeft` Turn into Chip or Link, `RefreshCw` Use Current Title, `Unlink` Remove Link. At most one icon per control; no action reuses a state icon.
- **State is told by words plus the icon,** never by colour, pills or badges.
- **The raw link and the `link_key` never appear,** on any surface or in any state.

#### Content rules

- **Title.** With no heading: a 2-line clamp, `overflow-wrap: anywhere`. With a heading: one line. The title and "› Heading" share one `<bdi dir="auto">` (a flex row: the title span `min-width: 4em`, ellipsis; the heading span `flex: none; max-width: calc(100% - 4em)`), so **the title gives way first** and the heading, where the link lands, stays whole. The separator is always U+203A "›"; it is Bidi_Mirrored, so it shows as "‹" when the run resolves RTL. Never swap the glyph in code.
- **Folder path.** No "Library" root. One or two folders are shown whole; deeper paths keep the first and the last folder: "Operations › … › Q4 reviews". The path is one `<bdi dir="auto">` and the only segment that may be ellipsised; the `·` separators and the date sit outside it and are never cut. (On the 34px column a deep path with a dated year, "Operations › … › Q4 revi… · Edited 2 Oct 2025", is the case that cuts.)
- **Date.** "Edited 12 Nov"; the year only when it isn't the current one ("Edited 2 Oct 2025"); `font-variant-numeric: tabular-nums`.
- **Snippet.** Shown only for local, non-shared documents. **Never in a Live document or any shared view (D24).** Each text block takes its own direction (`dir="auto"`) but aligns to the card's start edge (`text-align: match-parent`), so an English line in an RTL card keeps its full stop at the end.

#### States and actions

The footer is the same on the hover card and the dialog. ⋯ holds three groups in this order, separated by hairlines, and drops empty groups: **ways to open** (Open in New Tab; Restore when the target is in Trash) | **edits** (Turn into Chip on a text link or Turn into Link on a chip; Use Current Title) | **Remove Link**, last and alone.

| State | Title row | Meta | Snippet | Footer (hover card and dialog) | ⋯ holds (editable) | Dialog initial focus |
|---|---|---|---|---|---|---|
| Resolves | `FileText` title | path · date | yes | Open, Copy Link, ⋯ | Open in New Tab \| Turn into … , Use Current Title \| Remove Link | Open |
| Heading link | `FileText` title › Heading | path · date | yes (`docs.snippet` until §4.5's heading-source question is decided) | same | same | Open |
| `here#` | `Hash` the heading | "In this document" | no | Go to Section, Copy Link, ⋯ | Turn into … , Use Current Title \| Remove Link (no Open in New Tab: §4.2a, a section shows Go to Section instead of the Open actions) | Go to Section |
| In Trash | `FileMinus` title | **In Trash** · path · date | yes | Open, Copy Link, ⋯ | Open in New Tab, **Restore** (editable only) \| Turn into … , Use Current Title \| Remove Link | Open |
| Not available | `FileQuestion` "This document isn't on this device." (14/20, 500) | "It may have been deleted." (12/16 muted) | no | ⋯ only, when editable; nothing when read-only | Remove Link | **the dialog itself** |
| Loading (cold start) | `FileText` the stored `label` | one static skeleton bar (8px, `--border`, radius 4px) plus a visually hidden "Loading details" | no | Open, Copy Link, ⋯ | Open in New Tab \| Turn into … \| Remove Link | Open |
| Newer version | `FileQuestion` "This link needs a newer version of TinyDocy." | — | no | none | — | the dialog itself |
| Your Live document | `FileText` title | path · date | **no** | Open, Copy Link, ⋯ | as Resolves | Open |
| Reading mode or read-only | `FileText` title | path · date | yes | Open, Copy Link, ⋯ | **only** Open in New Tab | Open |
| Shared view (exists only if Q3 is reversed; today collaborators see Not available) | `FileText` title | path · date | **no** | Open, Copy Link, ⋯ | **only** Open in New Tab | Open |

- **⋯ exists only when it holds something.** Read-only and shared views keep ⋯ only for Open in New Tab; a read-only `here#` has none, so its footer is Go to Section and Copy Link.
- **Use Current Title** shows only on a **text link** whose text differs from the target's current title (or heading). A chip always shows the live title, so it never offers it. It is hidden while loading.
- **Remove Link is never the primary action, never red** (the default `DropdownMenuItem` variant, not `destructive`), never takes focus by default, and is always the last item, after its own hairline (unless it is the only item, as on Not available).
- **Not available:** no Open and no Copy Link. When editable, ⋯ holds only Remove Link. The dialog opens with focus on its container; reaching Remove Link takes Tab to ⋯, then Enter (the menu opens on its only item), then Enter again. That is three deliberate steps, never a default.
- **The trade-off, stated:** keyboard users now reach Turn into … and Remove Link through ⋯ (Tab, Tab, Enter, then arrows) instead of a visible second row. The owner chose fewer visible buttons (L2); the sheet still lists every action.
- **Loading:** Open is enabled and **deferred**, not disabled and not `aria-disabled`. A press is queued and runs once the target resolves (or the card swaps to Not available). The card has `aria-busy="true"` until the metadata arrives. Dialog focus lands on Open, as in every other state.
- **Turn into Link in your Live document** opens §4.2a's consent dialog the first time ("Write this title into the document?", [Cancel] [Turn into Link], focus on Cancel). It is reached from ⋯ (or the sheet row); being in ⋯ never skips consent.
- **Restore and Go to Section** come from §4.5 and §8; they are not new actions.

#### Keyboard, pointer and timing (WCAG 1.4.13)

- **One hovercard system: the extension's.** The card body is rendered through `@docs.plus/extension-hyperlink`'s `hovercard.render`, `openPreviewPopover` and `focusPreviewFromKeyboard` (§4.2a, §4.5). No second base-ui PreviewCard. The extension owns hover, persistence, Esc and the hover bridge.
- **Timing.** Target: open after 300 ms on the anchor; close 200 ms after the pointer has left both the anchor and the card. Extension 2.3.0 hard-codes its own values (fetch after a 150 ms dwell, open no sooner than 500 ms, close 300 ms after leaving), which also meet 1.4.13. LK4 either uses an upstream timing option, if the extension adds one, or keeps 2.3.0's values; it never adds a second timer in the app. See owner decision L4.
- **Hoverable:** crossing the 6px gap never closes the card. In 2.3.0 the bridge is the close grace: the 300 ms timer that starts when the pointer leaves the anchor is cancelled when it enters the card. A pseudo-element on the frame cannot do it, because `.hyperlink-hovercard` clips with `overflow: hidden`. If the 200 ms target ships, its grace must still cover crossing the gap. **The open ⋯ menu counts as part of the card:** the pointer on the menu keeps the card open (see Implementation). **Persistent:** it stays while the pointer is on the anchor, the card or its menu. **Dismissible:** Esc closes it without moving the pointer or focus. It **never opens on focus.**
- **The hover card is in the accessibility tree but out of the tab order** (its buttons have `tabindex="-1"`). It is never `aria-hidden`, so voice-control users can click its buttons by name ("Open", "Copy Link", "More link actions"). The keyboard path is the preview dialog.
- **Preview dialog:** click, Mod-K or Alt+Enter on the anchor. Focus goes to Open (Go to Section on `here#`), or to the dialog container (`tabIndex=-1`) for Not available and Newer version. The ring shows only on `:focus-visible`, so a mouse click shows none. **Tab order: Open → Copy Link → ⋯.**
- **⋯ is a menu button** (the app's `DropdownMenu`):
  - Enter, Space or ↓ opens the menu with focus on the first item; ↑ opens it on the last item. A pointer click opens it without highlighting an item.
  - ↑ and ↓ move and wrap, skipping separators; Home and End jump to the first and last item; Enter or Space runs the item.
  - **Esc closes only the menu and returns focus to ⋯;** the card stays. The next Esc closes the card.
  - **Tab closes the menu and moves on from ⋯** (Shift+Tab back to Copy Link); it never traps focus.
- **Tooltips** on the two icon-only buttons show on pointer hover and on keyboard focus (`:focus-visible`), never when focus returns from the menu, and hide while the menu is open. Esc hides a visible tooltip first, without moving focus (1.4.13). They are visual only: the name comes from `aria-label`, so it is never read twice.
- **Esc peels one layer at a time:** tooltip, then menu, then card. Closing the dialog **returns focus to `view.dom` with the selection unchanged** (reading mode: to the anchor).
- **Not available focus:** the extension and base-ui both focus the first tabbable element by default, which here is ⋯. Set initial focus to the popup container on the desktop dialog (`focusPreviewFromKeyboard` path) and on the phone sheet (base-ui `initialFocus`).

#### ARIA

| Element | Role | Accessible name | State |
|---|---|---|---|
| Text link anchor | `link` | its text | `aria-haspopup="dialog"`, `aria-expanded` (true while the dialog is open); the state suffix from §4.6 via `aria-describedby` |
| Chip anchor | as §4.2a | label plus the hidden suffix (", document", ", document, in Trash", …) | `aria-haspopup="dialog"`, `aria-expanded` |
| Hover card | `group` | `aria-labelledby` the title (or the message) | buttons `tabindex="-1"` |
| Preview dialog | `dialog` | `aria-labelledby` the title (or the message) | `aria-modal="false"` (anchored, non-blocking); `aria-busy="true"` while loading |
| Footer | `group` | "Link actions" | — |
| Open, Go to Section | `button` | its label (the icon is `aria-hidden`) | — |
| Copy Link | `button` | `aria-label="Copy Link"` | tooltip is visual only, no `aria-describedby` |
| ⋯ | `button` | "More link actions" | `aria-haspopup="menu"`, `aria-expanded`, `aria-controls` the menu while open |
| ⋯ menu | `menu` / `menuitem` / `separator` | "More link actions" / the action | shadcn `DropdownMenu`; items' icons `aria-hidden` |
| Phone sheet | `dialog` | `aria-labelledby` the title | `aria-modal="true"`, background `inert`, focus contained, returned to the anchor on close; actions in a `group` "Link actions" |
| Live consent | `alertdialog` | "Write this title into the document?" | `aria-modal="true"`, focus on Cancel |

- **The open anchor gets its own treatment, not the focus ring.** While the dialog is open a chip uses the `--doc-chip-hover` fill and a text link a 2px underline, both from `aria-expanded="true"`. `--focus-ring` is reserved for the element that has focus, so two identical rings never show at once.
- **Separators** (`·`, the "›" glyph) and every icon are `aria-hidden`; the heading is read after a hidden ", ".
- **Targets:** footer controls are 28px tall with 6px gaps; Copy Link and ⋯ are 28×28 (WCAG 2.5.8 asks for 24); menu rows are 32px. Phone rows are 44px.

#### Phone

- A long-press on a chip or link opens the **same body** as a bottom sheet (`components/ui/sheet`): `--radius-xl` (10.08px) top corners, shadow-lg (the app's sheet token), 1px top border, a flat scrim (`oklch(0 0 0 / 0.2)` light, `/ 0.5` dark, **no blur**), no grip.
- Type steps up one size: title 16/24, meta 13/18, snippet 15/21, message 16/24. The title row's state icon is 18px with a 12px gap.
- **Every action is a 44px full-width row with its 18px icon and label** (16/24; icon `--muted-foreground`, 12px gap), so the title and every label share one 46px column. There is no ⋯ on the phone. Rows, in order: Open (or Go to Section), Copy Link, Open in New Tab, Restore | Turn into …, Use Current Title | Remove Link, with one inset hairline between groups. **Remove Link is last, after its hairline.** No per-row hairlines. Rings only on `:focus-visible`, so a touch never shows one.
- Initial focus: the first row; the sheet itself for Not available, whose only row is Remove Link.
- Bottom padding 20px plus `env(safe-area-inset-bottom)`.

#### Right to left

- The card follows the **document's** direction and mirrors: the state icon, text, meta and Open start at the right edge; Copy Link and ⋯ sit at the left, and the ⋯ menu opens aligned to ⋯. Labels stay in the interface language (see L5).
- **Directional icons mirror** (`ArrowUpRight`, `SquareArrowOutUpRight`); document, hash, copy, swap, refresh, undo, unlink and ⋯ icons do not.
- Every user string (title, heading, folders, snippet) is isolated; the title and heading share one isolate, so an English title in an RTL document reads "Q4 budget › Approval limits", and a Persian one reads with the mirrored "‹".

#### Narrow screens (320px)

- At a 320px viewport the card is `calc(100vw - 1rem)` = 304px wide and keeps 8px from each edge; the ⋯ menu stays inside the viewport. The footer never wraps: Open, Copy Link and ⋯ need about 130px. The prototype checks this in a 320px container.

#### Motion

- The extension's popover motion, unchanged: 120 ms ease-out, opacity 0 → 1 with a 2px shift. `prefers-reduced-motion: reduce`: no transition, the card appears at once. The ⋯ menu and the tooltip use the app's `DropdownMenu` and `Tooltip` motion.
- The loading bar is static. No shimmer, no scale, no spring.

#### Implementation (LK4)

- `components/document-editor/document-editor.scss`: map `--hl-shadow` to the shadow-md value (`0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)`) beside the existing `--hl-radius` mapping. Today the extension's 20px two-layer default would still draw. This is a CSS line for every hyperlink popover and no JavaScript; if the CSS ledger objects, scope it to `.hyperlink-hovercard` in the lazy links CSS instead.
- Draw the edge once: the shell's `--hl-border` (→ `--border`) or PopoverContent's `ring-1 ring-foreground/10`, never both.
- **Frames the extension owns.** `hovercard.render` and `openPreviewPopover` own the hover card and preview frames. LK4 first checks which of the ARIA table's frame attributes (`role`, `aria-labelledby`, `aria-modal`, `aria-busy`) 2.3.0 already sets or lets the host set, and upstreams the rest instead of patching the frame from the app.
- **⋯ inside the hover card.** The app's `DropdownMenu` portals its popup, and `.hyperlink-hovercard` clips with `overflow: hidden`, so the menu cannot be a DOM child of the frame. The extension's close grace must treat the open menu as part of the card (no close while the menu is open or the pointer is on it), or 1.4.13's "persistent" breaks. Upstream a hook for this if 2.3.0 has none; never add a second timer in the app.
- **Icons** come from `lib/icons.tsx`. `FileText`, `Copy`, `Ellipsis` (`MoreHorizontalIcon`), `SquareArrowOutUpRight` (`OpenInNewTabIcon`), `Undo2`, `ArrowRightLeft` and `RefreshCw` are already there; add `ArrowUpRight`, `Unlink`, `Hash`, `FileMinus` and `FileQuestionMark` (`FileQuestion`) if §4.2a's work has not.
- The card's JavaScript and CSS, and the extension's `hovercard.css`, live in the lazy links or library chunk. **0 B change to the editor chunk group** (size check), and opening the card makes **no network request**.

#### Acceptance criteria

**Anti-slop (design review fails the PR on any one):**
1. No gradients.
2. No glassmorphism, `backdrop-filter`, blur or frosted panels; the phone scrim is flat.
3. No purple or indigo accent; only the app's tokens (greys, `--link-text-color`, the approved `--doc-chip-*`). Remove Link is never red.
4. No emoji.
5. Icons only as type or state markers or action labels, max one per control, none decorative.
6. One subtle elevation token per surface (shadow-md on the card and menu, shadow-lg on the sheet); no coloured or stacked glow.
7. Radius matches the app: 7.2px card and menu, 5.76px buttons, rows and tooltip, 10.08px sheet top.
8. No filler or marketing copy, no "✨", no exclamation marks; every string is in §8 or this section.
9. Nothing centred: icons, Open's arrow and the snippet start on the 12px inset; the title, meta and Open's label share the 34px column.
10. No padding bloat: body 10/12/12px, footer 6px; a resolved hover card measures 149px tall at 320px wide.
11. No hero-card look: no banner, image well or nested boxes; the only icon in the body is the 16px state marker on the title line.
12. No status pills: In Trash is a word in weight 500.
13. No animated shimmer.
14. Typography carries the hierarchy: 14/20 500 title, 12/16 muted meta, 13/19 snippet, 12/16 500 actions.
15. Pro-tool density: at most three controls in a footer; compare GitHub and Linear hovercards and Quick Look.
16. Every pixel justified: each hairline separates a group, the footer padding holds the focus ring.

**Behaviour and tests:**
- A regression test (desktop and phone) asserts that `document.activeElement` is never Remove Link when a Not available card opens, by keyboard, click or long-press.
- Loading: Open is focusable and not `aria-disabled`; pressing it before the metadata arrives opens the target once it resolves; `aria-busy` clears when the metadata arrives.
- Hover: no card before the open delay; the card survives crossing the gap; it stays while the pointer is on its open ⋯ menu; it closes after leaving both; Esc closes it; focus never opens it.
- Mod-K and Alt+Enter focus Open; Tab reaches Copy Link, then ⋯; the menu opens with Enter, Space and ↓ (↑ on the last item), moves with ↑ ↓ Home End and wraps; Esc closes only the menu and focuses ⋯; Tab leaves it; Esc on the card returns focus to `view.dom` with the selection unchanged.
- The hover card and the dialog render the same footer (Open, Copy Link, ⋯) in every state; there is no second row.
- Live and shared views never render the snippet; shared and read-only views render ⋯ with only Open in New Tab, and no Restore, edit or remove items.
- **Design-review gate before merge:** in-app screenshots at 1440, 1100 and 820 px, light and dark, an RTL document and a CJK title, covering hover, dialog, the ⋯ menu open, sheet (a real long-press on a touch viewport) and every state above, checked against the prototype.

#### Amends on merge

These sections on `main` predate the approved #163 and #167 text. When this section is approved, update them to match (they are not edited here, to avoid a three-way conflict with those PRs):
- **§4.5 Card:** drop the "Library ›" root; the action list becomes the table above (Open in New Tab and Use Current Title in ⋯, per L2).
- **§4.6 and §8:** In Trash uses `FileMinus`, not `Trash2` (approved Q5). Deleted and Not in this library are one **Not available** state, `FileQuestion`, "This document isn't on this device. It may have been deleted." (approved Q4 (b)). The In Trash card shows "In Trash" in the meta line instead of "“Q4 budget” is in Trash." (L3), and Restore moves into ⋯ (L2).
- **§4.2a Visual and Keys:** the anchor's open state uses `aria-expanded` with the chip hover fill (text link: 2px underline) instead of the 2px `--focus-ring` outline, and anchors carry `aria-haspopup="dialog"` and `aria-expanded`.
- **§4.2a Card actions (L2):** this supersedes "the first group holds the ways to open: Open, Open in New Tab and Copy Link" and "a second group, editable only, holds Turn into Link and Remove Link" (the edit group visible in the dialog). The hover card and the dialog show Open, Copy Link and ⋯; Open in New Tab, Restore, Turn into …, Use Current Title and Remove Link live in ⋯; the phone sheet lists them all. §4.2a's card layout line (22rem, 18px icon, title 600, 30px actions) becomes this section's Anatomy.
- **§7 Hovercard bullet:** replace with the Keyboard and ARIA rules above.

#### Owner decisions

| # | Decision | Recommendation |
|---|---|---|
| **L1** | Approve this card for links and chips | **Yes.** |
| **L2** | Where the secondary actions live | **Decided by the owner, 2026-11-22: secondary actions live in ⋯ on every surface (hover card, dialog); the sheet lists all.** The hover card and the dialog show only Open, Copy Link and ⋯. This supersedes §4.2a's "edit group visible in the dialog" line (see Amends on merge). ⌘⇧-click and middle click still open a new tab directly. |
| **L3** | In Trash as a meta-line word ("In Trash · Product · Edited 3 Nov") instead of the sentence "“Q4 budget” is in Trash." | **The meta line.** The title stays the title, and the state reads without a second headline. |
| **L4** | Hover timing | **300 ms open, 200 ms close, as an upstream option of the extension;** until it exists, the extension's 500 / 300 ms. Never a second timer in the app. |
| **L5** | Card direction in an RTL document with an English interface | **Mirror the card with the document,** labels in the interface language. The alternative, following the interface direction, puts the card's start edge away from the anchor. |
| **L6** | Snippet colour | **`--popover-foreground`** (accessibility review). The muted alternative reads quieter at about 4.7:1 on the light popover; choose it only if, at real size in the app, the snippet competes with the title. |


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
| **LK2** | **Inserting links:** the ⌘K Documents and In this document sections, the heading step (closed-document source per §4.2, open), Copy Link to Document and Copy Link to Heading, the "/" item, the first-time hint. **Design review.** | UX + DE | LK1, SR1 (matcher) | M: 3 days, 2 rounds | Insert from ⌘K and from paste, one undo step each. Keyboard-only flow passes. Templates never listed. | v1 |
| **LK3** | **`[[` trigger** folded into `slash-trigger`. Measures `slash-trigger` on `main` first. | DE | LK2 | S: 2 days, 2 rounds | Eager cost within the 120 B gz ledger line. Never fires in code or the title. IME-safe. **Cut first** (D23, D30). | v1 unless cut |
| **LK4** | **Hovercard and Linked from:** the `links` table (migration hook, §5) and web store, `links.put` IPC, hovercard config and the card, Use Current Title, the Linked from section, Links to This Document, the ⋯ popover row. **Design review.** | UX + DE + SE | LK1 | M: 3.5–4.5 days, 2 rounds | The card opens with no network request (asserted). Linked from updates across windows. a11y checks pass. Hover preview is fourth and backlinks sixth in D30. | v1 unless cut |
| **LK5** | **Export of links and "Link imported notes":** Export all relative links and slugs, single-export plain text, `link_key` in `library.json` (never NULL: minted at insert, S16; kept only by a backup-zip or `library.json` restore, S8c), `lib/links/import-links.ts`, the one-time Link Imported Notes forward edit over `import_sources` (§4.9) | DE | P2.8, W7 (web Export all), LK1, IM1 | S–M: 3 days, 2 rounds | Round trip desktop → Export all → web keeps every link resolving. The Obsidian fixture vault links with the §8 counts. | v1 unless cut |

- **Totals:** about **16.5–17.5 agent-days** (was about 30; the owner's D24 estimate is about 15 less), 3 design reviews (SR1, LK2, LK4, plus LK3 if it ships), and no server work.
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
