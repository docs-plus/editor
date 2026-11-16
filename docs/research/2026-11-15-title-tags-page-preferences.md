> **Superseded in part.** Some of this study's advice was changed by the staff feasibility review. See [the details spec §11](../superpowers/specs/2026-11-15-desktop-documents-and-editor-details.md) before building from it.

# Document title, tags and properties, page preferences (desktop and web)

- **Status:** Research and design for owner review (2026-11-15). Nothing is built.
- **Reads with:** [Plan v4](../superpowers/specs/2026-11-15-desktop-local-first-design.md) (§4 D-A5, §5), [Architecture](../superpowers/specs/2026-11-15-desktop-architecture.md) (§4 ports, §5.3 tables, §7 IPC), [Desktop UX spec](../superpowers/specs/2026-11-15-desktop-ux-design.md) (§4.6 keyboard, §7 Settings).
- **Scope:** three topics. (1) The document title and everywhere it appears. (2) Tags and other document properties. (3) Page preferences: width, type, spacing and view modes. For each: what desktop gets, what the web gets, where data lives, copy, keys, a11y, performance and which PR owns it.
- **Method note.** Repository facts below were read in the code on 2026-11-15. Prior-art claims come from product knowledge; **the web search for this pass was not run**, so every prior-art link in §8 is marked *(unverified)* and must be re-checked before anyone quotes it.

---

## 0. The rules this document applies

1. **One source of truth per fact.** The title *is* the first heading. Nothing else stores a title that can disagree with it; every other copy is a cache derived from it.
2. **What changes how *I* see a document never changes it for anyone else.** Width, font, size, spacing, focus mode, outline visibility, tags, pinned: local. Only content (including the title) goes in the Y.Doc.
3. **Nothing changes layout on its own** (AGENTS.md, UX spec §1.4). Page preferences apply before first paint and change only when the person changes them. A collaborator can never change my width.
4. **Fixed faces** (owner rule, memory "No cryptic button faces"). No control face shows the current width, font or a tag count. Values live in the popover, menus and Settings.
5. **Performance rules stand.** The editor shell never subscribes to editor state; no plugin is registered from a lazy chunk; the caret block stays rendered (`.is-caret-block`); the web editor chunk does not grow beyond a stated allowance.

---

## 1. Document title

### 1.1 What exists today (checked in code)

| Fact | Where |
|---|---|
| Schema is `heading block*`; the first node is forced back to H1 by `enforceH1Title`; a full-document paste promotes the first block to H1. | `extensions/title-document/title-document.ts` |
| Empty title placeholder: "Enter document name" (CSS `::before`, unfocused). | `extensions/shared/heading-node.scss:56-58` |
| The tab title is `doc.firstChild.textContent \|\| "Untitled"`, sent only for this person's own edits (`isChangeOrigin` skips Yjs-applied transactions). | `components/document-editor/document-editor.tsx:211-219` |
| The tab list writes the title after a 300 ms debounce, cut with `title.slice(0, 200)` (`MAX_TAB_TITLE_LENGTH`). | `hooks/use-synced-tabs.ts:307-336`, `lib/tab-api.ts:63` |
| Desktop design: the renderer sends the title with each append (`title: opt(str(200))`); the worker stores it in `docs.title`. Main never parses Yjs. | Architecture §5.1, §7 |
| Window title: macOS = title (hidden, used by Mission Control / Window menu), Windows and Linux = "Q4 plan – TinyDocy". No represented file, no edited dot. | UX spec §2.1 |
| OS recents: Dock menu and Jump List (5 titles), File › Open Recent (10); `addRecentDocument` needs file paths, so not used. | UX spec §2.2 |

**Three defects found while reading, which this design fixes:**

- **D1. `textContent` drops hard breaks.** A title typed "Q4⏎plan" with Shift+Enter becomes "Q4plan" in the tab. (Hard break nodes have empty `textContent`.)
- **D2. `slice(0, 200)` cuts by UTF-16 code unit.** A title whose 200th unit is the first half of an emoji or a flag stores a lone surrogate, which renders as "�" and may fail strict JSON/IPC validation (`str(200)` behaviour on lone surrogates: *unverified*).
- **D3. On desktop the `isChangeOrigin` rule would freeze the sidebar for live documents.** The web needs it because `global-tabs` is shared: a stale offline copy must not rename the tab for everyone. On desktop the index is private, and in the Live release a collaborator's title edit arrives as a Yjs change. With the web rule, my sidebar, tabs and backups would keep the old title forever.

### 1.2 Decision: the title pipeline

```text
Y.Doc (first heading)  ──derive──▶  displayTitle(doc)  ──▶  tab, window title, sidebar row, list views,
   ▲  the only stored truth                                  Quick Open, Open Recent, Dock/Jump List,
   │                                                         backup filename, export default name,
   └── edited by: typing in the heading · Rename (F2) · Duplicate · share dialog "name it" · import
```

**`displayTitle(doc)`** — one pure function in `lib/document-title.ts` (shared, no editor import, about 30 lines), used by the web tab title and the desktop index:

1. Walk the first heading's inline content: text as-is, `hardBreak` → one space, inline atoms (emoji node, mention) → their text attribute or nothing.
2. Normalise to NFC; collapse runs of whitespace to one space; trim.
3. Remove bidi *override and embedding* controls (U+202A–U+202E, U+2066–U+2069) and zero-width characters (U+200B–U+200D, U+FEFF) for the *display* copy only. The heading itself keeps whatever the person typed. (Trojan-Source-style spoofing in sidebars, filenames and native dialogs is the risk; RLM/LRM marks U+200E/U+200F are kept because real RTL titles need them.)
4. If nothing is left → `""` (the caller shows "Untitled"; the stored cache keeps `""` so "Untitled" is never mistaken for a real title).
5. Cap at **200 grapheme clusters** with `Intl.Segmenter`, never by code unit (fixes D2).

**Who writes the cache (`docs.title`):**

| Target | Rule |
|---|---|
| Web (`global-tabs`) | Unchanged rule (local edits only, `isChangeOrigin`), but uses `displayTitle` (fixes D1, D2). Visible change: none except the bug fixes. |
| Desktop | The renderer derives the title from **state, not origin**: after each batch flush it computes `displayTitle` and sends it with the append **only when it differs from the last sent value**. Remote (Live) changes, restores and migrations therefore update the title too (fixes D3). Cost: one walk of the first heading per flush, not per keystroke. |

### 1.3 Every surface

| Surface | Shows | Truncation | Empty title | Notes |
|---|---|---|---|---|
| **Tab** | title | CSS end ellipsis; tab max width 200 px, min 96 px; full title in the tooltip and `aria-label` | "Untitled" in muted text (weight unchanged), so it reads as a placeholder | `dir="auto"` + `unicode-bidi: isolate` on the label |
| **Window title** (`win.setTitle`) | macOS: title. Win/Linux: "title – TinyDocy" | 100 graphemes + "…" (OS window switchers truncate anyway) | "Untitled" | List views: "Recent", "Trash", the folder name. Settings: the pane name. |
| **Sidebar row** | title | single line, end ellipsis, tooltip with the full title after 500 ms | "Untitled", muted | `dir="auto"`, isolated |
| **List views** | Title column + Folder, Modified, Created | end ellipsis, full title in tooltip | "Untitled", muted; sorts **after** named documents | Sort uses `Intl.Collator(locale, { numeric: true, sensitivity: "base" })` so "Plan 2" < "Plan 10" |
| **Quick Open** | title, matches bold, folder path in muted text | end ellipsis | "Untitled" matches the query "untitled" | Accent-folding search uses the display copy |
| **Open Recent, Dock menu, Jump List** | title | **50 graphemes + "…"**; menus have no tooltip | "Untitled" | Windows menu labels treat `&` as a mnemonic: escape to `&&` (Electron behaviour on Linux `_`: *unverified*, S1 check). Duplicates: append " — Folder" only when two items in the same menu share a title. |
| **Native sheets and pills** | “title” in curly quotes | 60 graphemes + "…" inside the quotes | “Untitled” | Bidi-isolate the quoted title with FSI/PDI (U+2068/U+2069) so an RTL title doesn't reorder the sentence |
| **Backup files** (`mirror.ts`) | `<clean title>-<short id>.tinydoc` / `.md` | clean title capped at **80 characters** before the id, so paths stay under the 240 limit in `filenames.ts` | `Untitled-3f9a2c.md` | The id suffix already makes names unique: no numbering needed. On rename, the next mirror writes the new name and removes the old pair in the same job (temp file then rename, then unlink the old). |
| **Export default name** | `<clean title>.md` | 80 characters | `Untitled.md` | The native save dialog handles collisions; we never auto-number. |
| **macOS represented file / proxy icon** | **None** (UX spec §2.1 stands): there is no true file to point at, and the backup is a copy, not the document. Dragging a proxy icon would hand out a stale copy. | — | — | Revisit only if documents become files (D2 option B). |

### 1.4 Empty titles: "Untitled" rules

- **Stored:** `""`. **Shown:** “Untitled” everywhere. **Never numbered** ("Untitled 2"). Numbering would be a second source of truth that disagrees with the heading the moment the person types. Disambiguation comes from the folder path (Quick Open, menus) and the Modified column (lists). Prior art: Apple Notes and Bear show "New Note"/first line without numbering; Pages and Word number *unsaved windows*, which we don't have (unverified, §8).
- **New Document (⌘N):** creates `""`, caret in the title with the existing placeholder "Enter document name". The tab reads “Untitled” until the first character.
- **Whitespace-only or zero-width-only title** → `""` → “Untitled”.
- **Leaving a new document untouched** (no content at all) → it stays in the library as “Untitled”. *Owner question O5:* auto-discard empty untitled documents on close (Notes does; Notion keeps them). Recommendation: **keep** (simpler, nothing ever vanishes; anti-goal "a document disappears").

### 1.5 Renaming: one source of truth

| Where the person renames | What happens |
|---|---|
| **Typing in the heading** | Normal edit. Tab and sidebar follow after the flush (≤ 1 s), the tab within 300 ms (renderer-local, before the flush). |
| **F2 in the sidebar / list, Document › Rename, context menu Rename** | Inline field prefilled with the display title, all selected. Enter commits, Esc cancels, Tab commits and moves on (UX spec §4.6). Empty → inline error “Enter a title.” (UX spec §6.1). To make a title empty, edit the heading. |
| — document open **in this window** | The commit runs one editor transaction replacing the first heading's content with plain text: one undo step, appended like typing. |
| — open **in another window** | Main forwards `app.menuIntent { actionId: "doc.rename", docId, text }` to the owning window, which runs the same transaction. |
| — **not open** | The renderer takes a registry claim for its window (as `doc.open` does), hydrates a Y.Doc with **no editor**, applies `setTitleText(ydoc, text)` (pure, `lib/document-title.ts`: edits the first `XmlElement`'s `XmlText` inside one `transact`), appends, releases. Main never touches Yjs (D-A3 holds). If the claim fails because the document is open elsewhere, it falls back to the row above. |
| **Duplicate** | New document whose heading text is “<title> copy” (UX spec §5.4). For an empty title: “Untitled copy”. |
| **Share dialog (Live)** | “Name this document before sharing” writes the heading the same way. |
| **Import** | `.md`: the first `# H1`, else the file name without extension. `.html`: `<h1>`, else `<title>`, else the file name. |

- **Formatting in the title** (bold, colour, inline code): a rename from the sidebar replaces the text and **drops the title's marks**. The rename field shows plain text, so this is what the person sees. Flag for review: acceptable, because title marks are rare and the heading still accepts them afterwards.
- **Optimistic UI:** the row and tab update in the click frame; if the append fails, both revert and the pill says “Couldn't rename “Q4 plan”. [Try again]”.
- **Undo:** in the sidebar, ⌘Z undoes the rename through the app undo stack (UX spec §6.2) by writing the old text the same way.

### 1.6 Long, emoji, RTL and duplicate titles

- **Very long titles:** the heading is unlimited. Every surface truncates at its own cap (table above); the full text is always reachable by tooltip, the window title or the heading itself. Screen readers get the full title from `aria-label`, never the ellipsis.
- **Emoji, flags, ZWJ sequences:** grapheme-safe caps (Intl.Segmenter); no emoji is ever cut in half. Filenames keep emoji (all three OSes allow them); `filenames.ts` already strips reserved characters.
- **RTL titles** (Arabic, Hebrew, Persian): `dir="auto"` on every title element, isolated from surrounding UI text; end-ellipsis follows the text direction. Native strings use FSI…PDI. Mixed titles like “گزارش Q4” render correctly in isolation. Owner's team should screenshot one RTL title in tab, sidebar, Quick Open and a sheet at design review.
- **Duplicate titles:** allowed, never blocked or auto-renamed. Disambiguated by folder path (Quick Open, menus) and dates (lists). Two windows with the same title on macOS look the same in the Window menu; accepted.

### 1.7 Collaborators editing the title (Live release)

- A collaborator's title edit updates my tab, window title and sidebar within one flush (≤ 1 s), **without moving focus, selection or scroll**, and without a pill. The sidebar row may re-sort only in a list sorted by title, and only if it is not focused or being renamed (the rename field wins; the incoming change shows after Esc or commit).
- If I am renaming from the sidebar while a collaborator edits the heading, my commit replaces the title text (last writer wins at the Yjs level). This is ordinary concurrent editing; no conflict UI.
- Backups follow the new title on the next mirror run.

### 1.8 Web gets

- `displayTitle` (fixes D1, D2) for tab titles. `dir="auto"` on tab labels. No other change.

---

## 2. Tags and other document properties

### 2.1 Should v1 have tags?

Plan v4 already gives the Local release **folders, Pinned, Recent and title search** (D-A8), and lists Pinned as a tripwire cut. Tags add a second organising system, a sidebar section, a property UI on the page, rename/merge flows and a schema seam.

| Option | For | Against |
|---|---|---|
| **A. No tags in the Local or Live release; designed now, built after Live (Recommended)** | Keeps the Local release to one organising model (folders) that the tree, Move to… and backups already cover. Nothing is lost: the tables below are an additive migration. | Bear and Obsidian users will ask for them. |
| B. Local-only tags in the Local release | Cheap-ish (two tables, one section, one row) | Adds about 2–3 PRs of design review before Gate 2; competes with tripwire items. |
| C. Tags inside the Y.Doc | Collaborators see them; they travel with the content | Breaks rule 2: my taxonomy appears in your document. Also lands outside the ProseMirror fragment, which the server size guard and schema floor were not designed for. |

**Recommendation: A**, with the data-model decision fixed now so it can't drift: **tags are local, never in the Y.Doc.** Reasons: they are personal organisation like folders and pins (which are local in `docs`/`folders`); a shared document's collaborators each organise it their own way (Obsidian and Bear tags are per-vault, not per-collaborator, and Notion's database properties are shared because they're a team database, which we are not; unverified, §8); and nothing outside the fragment needs a server change.

### 2.2 Per-property decisions

| Property | v1? | Stored where | Why |
|---|---|---|---|
| **Title** | Local release | Y.Doc (first heading); cache in `docs.title` | It is content; collaborators must see it. |
| **Pinned** | Local release (tripwire-cuttable) | `docs.pinned` (exists in §5.3) | Personal. |
| **Folder** | Local release | `docs.folder_id` | Personal. |
| **Created, modified, last opened** | Local release | `docs.created_at / modified_at / opened_at` (exist) | Shown in list columns and Document Info. `modified_at` changes on any content append, including a collaborator's (Live). |
| **Word and character count** | Local release (cuttable) | **Not stored.** Computed when Document Info opens | One O(n) `textBetween` per open, never per keystroke. Avoids a stored number going stale. |
| **Size** | Local release | computed from snapshot + rows in the worker on request | Shown in Document Info; links to the "very large" state (UX spec §5.3). |
| **Tags** | After Live (Option A) | `tags`, `doc_tags` (local) | §2.1 |
| **Icon / emoji** | Later | Would be content (Y.Doc), because it is part of how a document presents itself to everyone | Requires a schema change and the share schema floor. Not worth it before tags. Today a person can put an emoji at the start of the title, which already flows everywhere. |
| **Status** (Draft, Final…) | Later, probably never | — | Workflow property of team tools; no accounts, no workflow. |
| **Page width override** | Local release | `doc_view` (local, §3.4) | Rule 2. |

### 2.3 Document Info (Local release, P2.9a)

Document › Info… (menu and palette; no shortcut) opens a popover anchored to the chip on desktop:

```text
┌ “Q4 plan” ────────────────────────────┐
│ 1,284 words · 7,912 characters        │
│ Created   12 Nov 2026, 09:14          │
│ Modified  Today, 16:02                │
│ Location  Library › Drafts            │
│ Size      184 KB                      │
│ Backup    ~/TinyDocy Backups/Q4 plan… │  [Show in Finder]
└───────────────────────────────────────┘
```

- Read-only; dates via `Intl.DateTimeFormat`; numbers via `Intl.NumberFormat`.
- Counting rule: words by `Intl.Segmenter(locale, { granularity: "word" })` with `isWordLike`, so CJK text counts sensibly; code blocks and Mermaid source **are** counted (*owner can change*).

### 2.4 Tags design (for the post-Live PR)

**Data model** (additive migration, `format_version + 1`, `VACUUM INTO` first as D-A6 requires):

```text
tags(id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE, created_at, sort_key)
doc_tags(doc_id TEXT NOT NULL, tag_id TEXT NOT NULL, added_at, PRIMARY KEY (doc_id, tag_id))
INDEX doc_tags(tag_id)
```

- `name_key` = NFC + case-fold + trimmed: “Plan” and “plan” are one tag; the display keeps the first spelling.
- Limits: name 1–40 graphemes; no leading `#` (stripped if typed); no `/` nesting in v1 (Bear's nested tags are a later idea); **20 tags per document**, **500 tags per library**. At a cap, the field shows “A document can have up to 20 tags.” inline.
- Index API (`DocumentIndex`): `tags.list`, `tags.add(docId, name)`, `tags.remove(docId, tagId)`, `tags.rename(tagId, name)`, `tags.merge(fromId, intoId)`, `tags.delete(tagId)`; all on the change feed; all in the app undo stack.
- **Backups and export:** `.md` backups and Markdown export write YAML front matter `tags: [planning, q4]` so the readable copy keeps them (Obsidian convention; unverified). `.tinydoc` carries tags in its header next to lineage. Restore and import read them back. Markdown import of front-matter tags is the only way tags enter from outside.
- **Live:** tags never leave the device. A joined document arrives untagged.

**Tag row** (inside the page card, above the title, outside the editable content):

```text
┌───────────────────────── page card ─────────────────────────┐
│  # planning ×   # q4 ×   [+ Tag]                       ⓘ    │  ← 28 px row, only when the doc has tags
│                                                             │     or after "Add Tag…"
│  Q4 plan                                                    │  ← the title heading
│  Goals                                                      │
```

- The row exists only when the document has at least one tag, or when the person chose Add Tag…. That is a person-initiated layout change, so rule 3 holds. Removing the last tag leaves the row until the document is reopened (no jump while focus is in it).
- `ⓘ` tooltip: “Tags are only on this computer. People you share with don't see them.” (the honesty line; it matters in the Live release).
- **[+ Tag]** opens a combobox: type to filter existing tags (prefix first), Enter adds the highlighted tag or creates “Create tag “q5””, Backspace in an empty field focuses the last chip, Esc closes and returns focus to the button.
- Chips: `#` glyph + name + remove button (`aria-label="Remove tag planning"`). No colour (rule 5 and "never colour alone"); *owner question O4* if colours are wanted later: 8 fixed tokens from `--tt-color-text-*` with the name always visible.
- **Keyboard:** Document › Add Tag… = **⌥⌘T on macOS**, menu-only on Windows/Linux (Ctrl+Alt is AltGr). **Not ⌘⇧T**: that is Reopen Closed Tab (UX spec §4.6). `Mod-Alt-t` is not bound in `lib/editor-actions` (checked; headings are `Mod-Alt-0…6`, code block `Mod-Alt-c`, Repeat `Mod-Alt-v`); third-party keymaps: *unverified*.
- **a11y:** the row is a `list` labelled “Tags”; chips are list items with a remove button (no nested buttons). F6 order is unchanged (the row is part of the Document region, before the title).

**Sidebar Tags section** (after Pinned, before Library; hidden until the first tag exists, like Pinned):

```text
│  ★ Pinned            │
│  ▾ Tags              │
│     # planning    12 │   ← count in a muted right column (a column, not a face)
│     # q4           3 │
│     # someday      1 │
│  ▾ Library           │
```

- Click a tag → the list view filtered by that tag (“Tagged “planning”” as the view title, columns as in other lists). One tag at a time from the sidebar; combining tags is a later filter bar.
- Context menu on a tag: **Rename… · Delete Tag…**. Rename to an existing tag's name → sheet **Merge “plans” into “planning”?** “12 documents will have the tag “planning”.” [Cancel] **[Merge]**. Delete → no sheet, pill “Deleted tag “q4” from 3 documents. [Undo]” (documents are never deleted).
- Quick Open: typing `#` lists tags; Enter opens the tag's list (later; keep D-A8 title-only matching for documents).
- **Vocabulary collision:** the heading filter's chips are called "filters" in its UI (`aria-label="Remove filter: …"`). Keep it that way; never call them tags in copy.

---

## 3. Page preferences

### 3.1 Baseline today (checked in code)

| Property | Today | Where |
|---|---|---|
| Page card width | `max-width: 648px`, padding `3rem` (1rem 1.5rem ≤ 480 px) → **~550 px text column** | `document-editor.scss:102-134` |
| Body font | **`Arial, sans-serif`** on `.tiptap.ProseMirror` (the chrome is Inter via `next/font`) | `document-editor.scss:44-46`, `app/layout.tsx:24` |
| Paragraph | **15 px**, line-height **1.15**, `margin-top: 12px` | `paragraph-node.scss:40-45` |
| Headings | `font-size: var(--hd-size, 20pt…10pt)`; HeadingScale sets `--hd-size` 20 pt → 12 pt by rank per H1 section, as a node decoration | `extensions/shared/heading-node.scss`, `extensions/heading-scale/heading-scale.ts` |
| Inline size marks | `xs/sm/lg/xl` in **em** (scale with the body) | `extensions/text-style-marks/text-style-marks.scss`, `lib/text-style-tokens.ts` |
| Code font | `"JetBrains Mono NL", monospace` — named, **not bundled** as far as found (falls back to the OS monospace; unverified) | `code-block-node.scss:28` |
| Outline | 270 px sticky column; overlay below 950 px | `toc-sidebar.scss:7`, `outline-panel.scss:10` |
| Off-screen blocks | `content-visibility: auto` with `contain-intrinsic-block-size: auto <estimate>`; caret block stays visible | `document-editor.scss:136-184` |
| Stored UI prefs | `tinydocy-ui` slots `outlineOpen`, `toolbarDensity` (survive Forget); theme in `tinydocy-theme` with a boot script before paint | `lib/remembered-choice.ts`, `lib/theme.ts` |

**Two corrections to the UX spec** (for the owner to accept; this document edits nothing else):
- UX spec §2.2 says the document font is "Inter, as on the web". It is **Arial** (the chrome is Inter). Arial is not on most Linux installs, so desktop Linux renders the document in whatever `sans-serif` resolves to.
- UX spec §7 says "Document text size 14 / 16 / 18 / 20 px, default 16 px (today's)". Today's body is **15 px**. The ladder below replaces it.

### 3.2 The preference set: decisions

| Preference | Values | Default | Scope | Stored | Release |
|---|---|---|---|---|---|
| **Page width** | Narrow · Standard · Wide · Full | Standard | Global default **plus per-document override (desktop)**; global only (web) | default: `tinydocy-ui` slot `pageWidth`; override: desktop `doc_view` table | Local |
| **Text size** | 13 · **15** · 17 · 19 · 22 px | 15 | Global | `tinydocy-ui` slot `textSize` | Local (desktop + web) |
| **Font** | Sans · Serif · Mono | Sans | Global | `tinydocy-ui` slot `docFont` | Local (desktop); web later |
| **Spacing** (line height + paragraph gap as one control) | Compact · Comfortable · Airy | Compact (today) | Global | `tinydocy-ui` slot `spacing` | Local (desktop); web later |
| **Show the outline** | When there's room · Always as overlay · Never | When there's room | Global | existing `outlineOpen` + new slot `outlineMode` | Local (UX spec §7, unchanged) |
| **Heading sizes** | Scaled by section (today) · Fixed by level | Scaled | Global | slot `headingSizes` | Later |
| **Focus mode** | on/off | off | Per window, not stored across launches | none (session) | Later (cheap; see O3) |
| **Typewriter scrolling** | on/off | off | Global | slot | Later |
| **Reading mode** (read-only for me) | on/off | off | Per document, session | none | Later |
| **Spelling language** | OS dictionaries | system | Global | Settings (UX spec §7) | Local (unchanged) |
| **Smart quotes** | on/off | off | Global | slot | Later |
| **Interface zoom** | 75–200 % | 100 % | Global | Electron zoom (UX spec §8.4) | Local (unchanged) |

Why one **Spacing** control instead of separate line-height and paragraph-spacing: two numeric controls create combinations nobody tests and pages that look broken (tight lines with huge gaps). Google Docs exposes custom spacing; Notion, Bear, iA Writer and Craft expose a small set of styles (unverified, §8). Fewer decisions is the owner's stated goal.

### 3.3 Exact values

**Page width.** Defined as the page card's `max-width` at the default 15 px text size, then **scaled with text size** so the line length in characters stays the same when text gets bigger (measure is a typographic property, not a pixel one):

`--page-max: calc(<base px> * var(--doc-text-size) / 15px)` (implemented as a unitless ratio `--doc-text-scale`).

| Width | Card max-width @15 px | Text column (minus 2 × 48 px padding) | ≈ characters per line (Arial, 15 px) | Use |
|---|---|---|---|---|
| Narrow | 552 px | 456 px | ~55 | Prose, reading |
| **Standard** | **648 px (today)** | 552 px | ~66 | Default; identical to today, so the web sees no change |
| Wide | 864 px | 768 px | ~92 | Tables, diagrams, side-by-side media |
| Full | `none` (fills the main area) | main area − 2 × max(48 px, 4vw) | unlimited | Dashboards, wide tables. Card border and shadow drop (the page *is* the area), like Google Docs pageless. |

- Character counts assume Arial's average advance of ~0.55 em (*estimate*). 45–75 characters is the usual readable range (Bringhurst; unverified), which Narrow and Standard sit in, and Wide intentionally exceeds.
- When the window is narrower than the chosen width, the card simply fills it (`max-width`, not `width`). The choice is kept; nothing is rewritten.
- Images and Mermaid diagrams are `max-width: 100%` of the column (hypermultimedia's own sizing with px widths at Narrow: *unverified*, check in design review); tables keep their horizontal scroll wrapper.

**Text size ladder:** 13 / **15** / 17 / 19 / 22 px. Applied as `--doc-text-size` on the editor root; paragraphs use it instead of the hard-coded 15 px. Size marks are em, so they follow. Headings: `font-size: calc(var(--hd-size, 20pt) * var(--doc-text-scale, 1))` — a CSS-only change; **HeadingScale's decorations are not rebuilt** when the size changes.

**Fonts (all bundled as woff2, OFL-licensed, Latin + Latin Extended subsets; CJK, Arabic and Hebrew fall back to OS fonts):**

| Choice | Desktop stack | Bundle cost (estimate) |
|---|---|---|
| Sans | `Arial, "Liberation Sans", Inter, sans-serif` — keeps today's look on macOS/Windows; Linux gets Liberation Sans (metric-compatible, *unverified* presence) then bundled Inter | 0 (Inter already shipped for chrome) |
| Serif | a bundled text serif (candidates: Source Serif 4, Literata; owner/art-director pick, O2) | ~150–250 KB for 4 styles |
| Mono | JetBrains Mono (already named by code blocks; bundling it also fixes code blocks offline) | ~120 KB for 4 styles |

- Fonts load with `document.fonts.load()` **before** the preference is applied, so text reflows once, not twice (no flash of fallback text).
- Font choice does not change code blocks (always Mono) or the title's weight.
- Sans default on desktop = today's web look; *owner question O2*: switch the desktop default to Inter so every OS renders identically.

**Spacing presets:**

| Preset | Paragraph line-height | Paragraph gap | Lists |
|---|---|---|---|
| **Compact (today)** | 1.15 | 12 px (scaled: 0.8 em) | today's |
| Comfortable | 1.5 | 0.9 em | line-height 1.4 |
| Airy | 1.75 | 1.2 em | line-height 1.6 |

Headings keep line-height 1.15 in every preset.

### 3.4 Storage, and why

- **Global defaults: `tinydocy-ui` slots** (`pageWidth`, `textSize`, `docFont`, `spacing`, `outlineMode`) through `ChoiceSpec` with allowlist validators and `maxRecent: 0`. They survive "Forget my choices" (layout preferences, as A15 decided for `toolbarDensity`). On desktop the Settings window shares the origin's localStorage, so a change there reaches every window through the existing `storage` listener in `subscribeChoices`. `remembered-choice.ts` gains these slots and one more **named exception** to the "write only from an action's `run()`" rule: the Page popover and Settings › Editor.
- **Per-document width (desktop): `doc_view(doc_id TEXT PRIMARY KEY, width TEXT)`** in the library, **not** a `docs` column, so the Local release schema (D-A5) stays as planned and the table can be added in the same migration as nothing else. It is read with the index snapshot, so the width is known before the editor mounts. Never in backups or exports (it's how I view, not what the document is). Deleted with the document on purge.
- **Never in the Y.Doc.** This deliberately differs from Notion, where "Full width" and "Small text" are page properties every viewer sees, and from Google Docs, where pageless is a document setting (unverified, §8). Our rule 2 wins: on a live document, my Wide must not make your page Wide.
- **Kill switch:** with `NEXT_PUBLIC_REMEMBER_CHOICES=0` writes are dropped. A control that visibly does nothing is worse than no control, so the web hides the Page item in that mode. Desktop does not use that flag for Settings.

### 3.5 Applying before paint (no layout jumps)

- Extend `THEME_BOOT_SCRIPT` into a `PAGE_BOOT_SCRIPT` sibling (same try/catch pattern) that reads the `tinydocy-ui` slots and sets `data-page-width`, `data-doc-font`, `data-spacing` and `--doc-text-size` on `<html>` before first paint. Without it the card would paint at 648 px and then jump to Wide, which breaks rule 3. Desktop: the CSP allows the boot script by hash (plan §7), so the script's hash changes with this PR.
- The per-document override is set on the editor root in the same render that mounts the document (data from the index), never in an effect after paint.

### 3.6 Where the controls live

| Place | Desktop | Web |
|---|---|---|
| **View menu** | Page Width ▸ Narrow / Standard / Wide / Full (✓ on current; applies to **this document**) · Text Size ▸ (13…22, ✓) · Font ▸ Sans / Serif / Mono · Spacing ▸ · Show/Hide Outline · Simplified Toolbar ✓ | — (no app menu) |
| **⋯ overflow menu** in the toolbar row | “Page…” opens the Page popover | “Page…” opens the Page popover (width + text size only) |
| **Command palette** | “Page width: Wide”, “Text size: Larger”, … (one entry per value, from the same table) | same, for the two web prefs |
| **Settings › Editor** | All defaults (sketch §5.4) | — |

No new toolbar button: the row is already dense, and a face showing "Wide" would break the fixed-faces rule.

**Page popover behaviour:**
- **Live preview:** every change applies immediately to the page behind the popover; the popover is anchored to ⋯ and never covers the column centre.
- **Scope (desktop):** Width applies to **this document** (stored in `doc_view`). Text size, font and spacing apply to **all documents**, and say so in the popover. When this document's width differs from the default, the popover shows a one-line note with two actions: “Q4 plan uses Wide. Default is Standard. [Use for all] [Reset]”. That is the Notion/Docs habit (width per page) without a second scope control.
- **Web:** width and text size are global; no note.
- **Reset:** “Reset page settings” at the bottom returns all four to the defaults and clears this document's override; pill “Page settings reset.” with no Undo (one click restores any value).
- Esc closes and returns focus to ⋯ (or to the editor caret when opened from the menu or palette).

### 3.7 Outline and toolbar at each width

- **Toolbar:** unaffected. The sticky row spans the main area, not the card; its collapse ladder keys off the row's width. Page width never collapses or expands toolbar controls.
- **Outline "when there's room"** becomes a derived rule instead of the fixed 950 px / 1400 px breakpoints, so the page stays centred (AGENTS.md: margin layout keeps content centred):

  `docked  ⇔  mainAreaWidth ≥ pageCardWidth + 2 × (270 px outline + 16 px gap)`

  | Width | Docks when the main area is at least | ≈ window width with a 240 px sidebar |
  |---|---|---|
  | Narrow | 1,124 px | 1,364 px |
  | Standard | 1,220 px | 1,460 px (≈ plan §5.1's 1,400 px rule) |
  | Wide | 1,436 px | 1,676 px |
  | Full | never | outline is always the overlay |

  Otherwise the outline uses its existing overlay. Changing the width is a person's toggle, so the outline switching between docked and overlay at that moment is allowed by rule 3; it never switches because of anything else.
- The web keeps today's 950 px rule until it adopts widths other than Standard; with Standard the formula gives a different number from 950, so **the web applies the formula only when its width is not Standard** (no visible web change by default).
- The Continue chip (max 34.5 rem, positioned in the card's top padding) must be re-checked at Narrow and Full at design review (*unverified*).

### 3.8 Focus mode, typewriter, reading mode (later, designed so they stay cheap)

- **Focus mode** = `[data-focus-mode] .tiptap > :not(.is-caret-block) { opacity: .4 }` plus hiding the sidebar and outline (restored on exit). It reuses `CaretBlockVisible`, so it costs no new plugin. Granularity is the top-level block (a whole list dims or lights as one), which is coarser than iA Writer's sentence focus (unverified, §8); sentence focus would need a decoration plugin and is out. Toggle: **View › Focus Mode, menu and palette only** (no shortcut; `Mod-.` is Superscript); Esc also exits. Reduced motion: no fade. Forced colours: opacity is ignored by some forced palettes, so focus mode simply shows everything there (acceptable).
- **Typewriter scrolling** keeps the caret line at ~40 % of the viewport. It needs a selection-driven scroll in the view layer, which must be an eager extension (a lazy `registerPlugin` re-creates every plugin view; AGENTS.md) and must never put the shell on editor state. It also fights `scroll-padding-top` and the 30 vh bottom padding. Later, with a perf spec.
- **Reading mode** adds a lowest-priority editability reason `reading` to the reducer (architecture §6.1). Later.
- **Smart quotes** change what I type into shared content, which is fine (it's authoring), but they surprise code and Markdown users. Later, off by default.

### 3.9 Performance

| Risk | Mitigation | Check |
|---|---|---|
| Width, size, font or spacing change re-lays out the document | Only rendered blocks lay out (`content-visibility: auto`). Never animate width: a transition would lay out every frame. | `perf` spec: toggle Standard → Wide on the 1 MB fixture; target ≤ 100 ms to next frame on M1 (*target, unmeasured*) |
| Skipped blocks keep **stale remembered heights** (`contain-intrinsic-block-size: auto`) from the old width, so the scrollbar and scroll position jump | Anchor the scroll: before the change, record the first visible top-level block and its offset; after the change, restore that offset in the next frame (no selection change, no `scrollIntoView` center). | e2e: the heading at the top of the viewport is still at the top after each toggle |
| HeadingScale rebuild | None needed: sizes scale in CSS (`calc`) | unit: no decoration rebuild on pref change |
| Caret misplacement in skipped blocks | `.is-caret-block` rule unchanged; the anchor restore must not move the caret | existing caret-block e2e on all widths |
| Font load reflows twice | `document.fonts.load()` before applying | visual check |
| Web chunk growth | Prefs are CSS variables plus a boot script; the Page popover lives in the lazy ⋯ menu chunk | chunk script: editor chunk +0 B; boot script ≤ 400 B |
| Shell re-renders | Prefs read through `useSyncExternalStore` (as `useToolbarDensity`), only in the shell's root, never editor state | React profiler: typing causes no shell render |

---

## 4. States, copy, keyboard and accessibility

### 4.1 Copy deck

| Where | Copy |
|---|---|
| Empty title, everywhere in chrome | Untitled |
| Title placeholder (in the heading) | Enter document name *(unchanged)* |
| Rename error | Enter a title. |
| Rename failed (pill) | Couldn't rename “Q4 plan”. [Try again] |
| Page popover heading | Page |
| Width labels | Narrow · Standard · Wide · Full |
| Width scope line (desktop) | Width applies to this document. |
| Other prefs scope line (desktop) | Text size, font and spacing apply to all documents. |
| Override note | “Q4 plan” uses Wide. Default is Standard. [Use for all] [Reset] |
| Reset | Reset page settings → pill: Page settings reset. |
| Settings › Editor note under Font | Fonts are built into TinyDocy and work offline. |
| Info popover | (§2.3) |
| Tag row tooltip *(later)* | Tags are only on this computer. People you share with don't see them. |
| Tag limit *(later)* | A document can have up to 20 tags. |
| Merge sheet *(later)* | **Merge “plans” into “planning”?** 12 documents will have the tag “planning”. [Cancel] **[Merge]** |
| Delete tag pill *(later)* | Deleted tag “q4” from 3 documents. [Undo] |

### 4.2 Keyboard map additions

| Action | macOS | Win/Linux | Conflict check |
|---|---|---|---|
| Page width, text size, font, spacing | menu + palette only | menu + palette only | Every candidate is taken: ⌘1–9 tabs, `Mod-Alt-0…6` paragraph/headings, ⌘= ⌘- ⌘0 interface zoom, `Mod-.`/`Mod-,` super/subscript. Interface zoom already covers "bigger text" by keyboard. |
| Document › Info… | menu + palette | menu + palette | — |
| Document › Add Tag… *(later)* | ⌥⌘T | menu only (AltGr) | ⌘⇧T is Reopen Closed Tab; `Mod-Alt-t` unbound in `lib/editor-actions` (checked); `lib/shortcuts.ts` holds only display helpers, not bindings |
| Focus mode *(later)* | menu + palette | menu + palette | — |

**Net: the Local release adds no new shortcuts.**

### 4.3 Accessibility

- **Popover controls:** Width, Font and Spacing are `radiogroup`s (arrow keys move and apply; the selected item has a check icon *and* a filled background, never colour alone). Text size is a `radiogroup` of five sizes labelled “13 pixels”… (a stepper hides the range). Each group has a visible label.
- **Text scaling:** `--doc-text-size` is expressed in rem against the root, so OS text-size settings (if Chromium honours them; UX spec §8.4 S1 check) and interface zoom both apply. At 200 % zoom with Wide, the card fills the area; nothing truncates without a tooltip.
- **Reduced motion:** no width or font transitions at all, for anyone (perf rule), so nothing to reduce. Focus-mode dimming is instant.
- **Forced colours:** card borders use `CanvasText`; selected radios use `Highlight`/`HighlightText`; Full width keeps a 1 px `CanvasText` column edge so the text area is findable.
- **Screen readers:** title surfaces expose the full title (`aria-label`), never the ellipsis; a width change is announced through `announce()` only when made from the menu or palette (“Page width: Wide”), because the popover's radios already speak.
- **RTL documents:** `dir="auto"` per block already lets RTL paragraphs flow; the page padding is symmetric, so widths behave identically.

---

## 5. Sketches

### 5.1 Page popover (desktop)

```text
                                   ┌ Page ────────────────────────────────┐
                                   │ Width                                │
                                   │ ( Narrow )(•Standard)( Wide )( Full )│
                                   │ Width applies to this document.      │
                                   │ ─────────────────────────────────────│
                                   │ Text size                            │
                                   │ ( 13 )( •15 )( 17 )( 19 )( 22 )      │
                                   │ Font                                 │
                                   │ ( •Ag Sans )( Ag Serif )( Ag Mono )  │
                                   │ Spacing                              │
                                   │ ( •Compact )( Comfortable )( Airy )  │
                                   │ Text size, font and spacing apply to │
                                   │ all documents.                       │
                                   │ ─────────────────────────────────────│
                                   │ “Q4 plan” uses Wide. Default is      │  ← only when overridden
                                   │ Standard.    [Use for all] [Reset]   │
                                   │                 Reset page settings  │
                                   └──────────────────────────────────────┘
```

Web: the Width and Text size groups only, no scope lines, no override note.

### 5.2 Tag row *(later)*

```text
┌───────────────────────── page card ─────────────────────────┐
│  # planning ×   # q4 ×   [+ Tag]                       ⓘ    │
│  ┌──────────────────────┐                                   │
│  │ q5▏                  │  ← combobox after [+ Tag]         │
│  │ ▸ Create tag “q5”    │                                   │
│  │   q4                 │                                   │
│  └──────────────────────┘                                   │
│  Q4 plan                                                    │
```

### 5.3 Sidebar with Tags *(later)*

```text
│ [⌕ Search      ⌘O]   │
│  ⚗ Playground        │
│  ◷ Recent            │
│  ★ Pinned            │
│  ▾ Tags              │
│     # planning    12 │
│     # q4           3 │
│  ▾ Library           │
│    ▸ Project notes   │
│ ───────────────────  │
│  🗑 Trash        [⚠] │
```

### 5.4 Settings › Editor (replaces the Editor rows of UX spec §7)

```text
┌ Editor ─────────────────────────────────────────────────────────────┐
│ General            │  Page width for new and unadjusted documents     │
│ Editor        ◀    │  ( Narrow )(•Standard)( Wide )( Full )           │
│ Storage            │  You can change one document's width from         │
│ Updates            │  View › Page Width.                               │
│ About              │                                                   │
│                    │  Text size          [ 15 px            ▾ ]       │
│                    │  Font               ( •Sans )( Serif )( Mono )   │
│                    │                     Fonts are built into TinyDocy │
│                    │                     and work offline.             │
│                    │  Spacing            [ Compact          ▾ ]       │
│                    │  ┌ preview ──────────────────────────────────┐   │
│                    │  │ Q4 plan                                   │   │
│                    │  │ Ship the desktop app before the end of…   │   │
│                    │  └───────────────────────────────────────────┘   │
│                    │  ───────────────────────────────────────────────  │
│                    │  Interface zoom     [ 100%             ▾ ]       │
│                    │  Simplified toolbar                    [  ○]     │
│                    │  Show the outline   [ When there's room ▾ ]      │
│                    │  Check spelling while typing           [● ]      │
│                    │  Spelling language  [ English (UK)     ▾ ]       │
│                    │                          [Reset editor settings]  │
└─────────────────────────────────────────────────────────────────────┘
```

- The preview is static HTML styled by the same variables (no editor mounted in Settings).
- Changes apply live in every open window (storage event).

---

## 6. Release and PR ownership

| Item | Release | PR |
|---|---|---|
| `displayTitle` / `setTitleText` (`lib/document-title.ts`), web D1/D2 fixes, `dir="auto"` on tabs | Local (web benefits immediately) | **P2.3** (`DocumentIndex` port touches tab titles) or a small standalone web PR before it |
| Desktop title cache from state (D3), sidebar/list/Quick Open title display, Untitled rules, inline rename (open, other window, closed), sorting | Local | **P2.7** |
| Backup and export filenames from titles, import title rules | Local | **P2.8** |
| Window title, Open Recent, Dock menu, Jump List labels and escaping, Document › Info | Local | **P2.9a** |
| Settings › Editor (defaults), Page popover, `doc_view` table, boot script, bundled Serif and Mono fonts, outline derived rule | Local | **P2.9b** for Settings and fonts; propose **P2.9c "Page preferences"** for the shared CSS-variable refactor (paragraph size, heading `calc`, width vars, scroll anchoring) because it touches the web editor styles and needs its own design review and perf check |
| Web: width + text size in ⋯ › Page… | Local (ships with P2.9c) | **P2.9c** |
| Collaborator title updates, share-dialog naming | Live | **P4.4** |
| Tags (tables, row, sidebar section, rename/merge/delete, front matter) | After Live (Option A) | new PR series after P4.6 |
| Focus mode, typewriter, reading mode, smart quotes, heading-size toggle, per-doc spelling language, icon/emoji | Later | unassigned |

Tripwire order if Gate 2 slips: cut Document › Info first, then Spacing and Font (keep Width and Text size).

---

## 7. Owner questions

- **O1. Tags:** after the Live release, local-only (Recommended) · in the Local release, local-only · never.
- **O2. Default document font on desktop:** keep today's Arial look (Recommended, web parity) · switch to bundled Inter for identical rendering on every OS. And which bundled serif (art director).
- **O3. Focus mode in the Local release** (nearly free via `.is-caret-block`, menu-only) · later (Recommended, keeps scope).
- **O4. Tag colours** when tags ship: none (Recommended) · 8 fixed tokens with the name always shown.
- **O5. Empty untitled documents:** keep them (Recommended) · discard on close when nothing was typed.
- **O6. Per-document width:** desktop only, web global (Recommended) · global only everywhere · per-document on the web too (localStorage map, 30 documents).
- **O7. Accept the two UX spec corrections** (document font is Arial, today's text size is 15 px) and the new **P2.9c**.

---

## 8. Prior art *(all unverified in this pass; re-check before quoting)*

| Product | What it does that informed this | Link *(unverified)* |
|---|---|---|
| Notion | Per-page "Full width", "Small text" and three font styles (Default, Serif, Mono), visible to everyone with access | https://www.notion.com/help/customize-and-style-your-content |
| Google Docs | Pageless format per document; page setup per document | https://support.google.com/docs/answer/11528737 |
| Bear | Tags typed inline as `#tag`, nested with `/`, sidebar tag list | https://bear.app/faq/ |
| Obsidian | Properties as YAML front matter above the note; `tags` property; tags pane | https://help.obsidian.md/properties |
| Craft | Page styles (width, fonts) per document | https://support.craft.do/ |
| iA Writer | Sans/Mono/Duo fonts; focus mode by sentence or paragraph; typewriter mode | https://ia.net/writer/support |
| Ulysses | Typewriter mode, editor themes, line width settings | https://help.ulysses.app/ |
| Typora | Themes as CSS, focus and typewriter modes | https://theme.typora.io/ |
| Apple Pages | Document setup per document; "Untitled" naming for unsaved documents | https://support.apple.com/guide/pages/welcome/mac |
| Microsoft Word | Focus mode, Immersive Reader line width/spacing, per-document page setup | https://support.microsoft.com/word |
| Electron | `setTitle`, represented file, recent documents (files only), menu label mnemonics | https://www.electronjs.org/docs/latest/tutorial/represented-file , https://www.electronjs.org/docs/latest/tutorial/recent-documents |

**Repository facts** (read 2026-11-15): `extensions/title-document/title-document.ts`; `extensions/heading-scale/heading-scale.ts`; `extensions/shared/heading-node.scss`; `components/document-editor/document-editor.tsx:211-219`; `components/document-editor/document-editor.scss`; `components/tiptap-node/paragraph-node/paragraph-node.scss:40-45`; `components/tiptap-node/code-block-node/code-block-node.scss:28`; `components/toc-sidebar/toc-sidebar.scss`, `outline-panel.scss`; `hooks/use-synced-tabs.ts:307-336`; `lib/tab-api.ts:63`; `lib/remembered-choice.ts`; `hooks/use-toolbar-density.ts`; `lib/theme.ts`; `lib/editor-actions/core/{inline,blocks}.ts`; `extensions/text-style-marks/*`; `components/tiptap-ui/heading-filter/heading-filter.tsx`; `app/layout.tsx:24`.
