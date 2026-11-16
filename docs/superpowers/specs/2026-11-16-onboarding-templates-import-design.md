# TinyDocy: onboarding, templates and import

> **Phones and tablets (D36):** where this document and [the phones-tablets design §14](2026-11-16-phones-tablets-design.md) differ on phone or tablet behaviour, the phones design wins.

> **Owner answers and staff integration review (plan v7, 2026-11-16)**, which override the text below where they differ:
> - **D27 (Q1 a):** templates in v1 (TM1). **D28 (Q2 a):** Word `.docx` import in v1 (IM3), the first import format to cut. **D29 (Q3 a):** the web practice copy for new web-library users (§1.4); this amends the web library design's call.
> - **D30:** the pre-approved cut order across designs (plan §8.2) puts IM3 second and TM1 fifth. **Never cut:** Markdown and folder import with its §4.7 security controls and duplicate skip, and the schema seams.
> - **Import is split by gate** (§4.1): **Gate 3** gets Markdown files and folders (Obsidian vaults included), `.txt`, `.tinydoc` and TinyDocy backup zips. **Gate 5** gets HTML, Notion zips and TextBundle, plus `.docx` (IM3).
> - **The headless schema moves into P2.8** (§4.6). IM1's desktop path no longer depends on W7.
> - **`@tiptap/markdown` in the worker:** raw HTML tokens are handed to the renderer thread for DOMPurify and the schema parse, because workers have no `DOMParser` (§4.6).
> - **Links between notes** (§4.2): IM1 keeps `[[wikilinks]]` and `[t](Other.md)` as literal text, but stores each imported file's relative path in `import_sources`. LK5 ([search-linking design](2026-11-16-search-linking-design.md)) adds a one-time **"Link imported notes"** forward edit. The report strings are unified with the search-linking design (§5.2).
> - **Schema:** one P2.6/W2 amendment: `docs.link_key`, `docs.kind`, `import_sources(doc_id, relative_path, source_app)`. New from Template always gives the new document a new `link_key`. Templates are skipped by search, backlinks and the ⌘K picker.
> - **Merged PRs:** **OB3 = test strategy Q14** (What's New) and **OB4 = Q16** (`/download`), one PR each.
> - **Plan v8:** OB4 is re-estimated from 2 to about 3 days for the `/download` page as the [brand design](2026-11-16-brand-icon-website-design.md) §4.2 specifies it; the extra day is counted in the brand design's 12.5 agent-days, not in this document's total. The SEO and download copy say "TinyDocy, by docs.plus" (D33).
> - **Playground:** the fixed teaching document on desktop (§1.3) is accepted; `buildTeachingPlayground` takes a `locale` parameter (D26: English in v1, translations in v1.1).
> - **Editor-chunk ledger (D23):** OB2's placeholder is one 10 B gz line.

- **Status:** Draft for owner review (2026-11-16). Nothing is built yet.
- **Plan:** [Desktop local-first design, v7](2026-11-15-desktop-local-first-design.md). Where this document and the plan disagree, the plan holds until the owner accepts the amendments in §8. Plan v7 records D27–D30 for this design.
- **Builds on:**
  - [UX spec](2026-11-15-desktop-ux-design.md): first run §5.1, empty states §5.2, file-operation copy §5.4, keyboard map §4.6, feedback channels §6.1
  - [Details spec](2026-11-15-desktop-documents-and-editor-details.md): titles §2, tags §3, Markdown paste E2
  - [Preferences design](2026-11-16-preferences-design.md): storage slots §5.2, Forget and R=0 §5.7, "read-only shortcut sheet only" §2.3
  - [Web library design](2026-11-16-web-library-design.md): first run and states §9, import §6.4, Copy to My documents §5.2
  - [Image store design](2026-11-16-image-store-design.md): the insert pipeline §2.2–2.3, migration at import §5.5
- **Audience (D0):** people who want private documents on their own machine, offline first. Every choice below is checked against that: nothing here sends data anywhere, and nothing here asks for a name, an account or a consent.
- **Code read:** `components/document-editor/playground-scenarios.ts` and the Regenerate path (`tab-bar.tsx:202,264`, `editor-app.tsx:93-108`, `use-document-editor-effects.ts:56-92`), `components/site-intro/site-intro.tsx`, `components/app-skeleton/`, `lib/site-config.ts`, `lib/shortcuts.ts`, `lib/editor-actions/core/*.ts`, `lib/slash-menu/slash-items.ts`, `lib/remembered-choice.ts`, `components/document-editor/document-editor-config.ts` (placeholder copy, `@tiptap/markdown` with a per-editor `Marked`).

---

## 0. Summary

| Topic | Decision |
|---|---|
| **First run, desktop** | **One sheet, no steps.** The UX spec's sheet stays, with one copy fix (§1.1). The Playground behind it becomes a **fixed teaching document** (§1.3), not today's random filler. No name, theme or telemetry questions. |
| **First run, web library** | The empty state from web library §9 stays. Its "Try the public Playground" link becomes **"Getting started"**, a practice copy of the same teaching document that is never stored, so a privacy-minded visitor is never sent to the public sandbox to learn (§1.4, owner Q3). |
| **Returning users** | **What's new: yes, as one pill**, on desktop only, once per minor or major version, linking to a bundled offline page (§1.5). Never a modal, never at first run, never for patch releases. |
| **Sandbox → library → desktop** | Three existing doors (banner, `Public` chip, Copy to My documents) plus one sentence in `site-config.ts`, a `/download` page, and **desktop Import accepting the library's backup zip** (§1.6). |
| **In-product teaching** | No tours and no carousels. **Four one-time pills** (§2.1), a **⌘/ shortcut sheet** generated from the action registry (§2.2), a teaching placeholder "Type / for blocks" (§2.3), Help › Getting Started (§2.4), and empty states that name what to do (§2.5). |
| **Templates** | **Yes in v1, small** (owner Q1): Save as Template…, New from Template (menu, palette, picker with preview), **4 bundled starters** that are read-only, and three variables `{{date}}`, `{{date:iso}}`, `{{time}}`. Templates are local library rows (`docs.kind = 'template'`), never shared, never in another person's Y.Doc. **No new shortcut** (⌘⇧N is New Folder). **Not in the "/" menu** in v1 (§3). |
| **Import, v1** (v7: Gate 3 = Markdown files and folders, `.txt`, `.tinydoc`, backup zips; Gate 5 = HTML, Notion, TextBundle, `.docx`) | One shared engine (`lib/import/`) for desktop and the web library: **Markdown files and folders** (Obsidian vaults, Apple Notes and Google Docs Markdown exports, Bear Markdown and TextBundle), **Notion zip** (Markdown & CSV, or HTML), **HTML**, **.txt**, **`.tinydoc`** and **TinyDocy backup zips**. **Word `.docx`** is v1 but first to cut (owner Q2). |
| **Import, later** | Bear `.bear2bk`, Evernote `.enex`, OneNote, RTF, ODT, Pages, reading the Apple Notes database, comments from any source. *(v7: links between notes import as text in IM1 and become links through LK5's one-time "Link imported notes", §4.2.)* |
| **Where import runs** | Main picks and reads files (paths never come from the renderer). The renderer converts: unzip, Markdown and `.docx` in a **killable import worker**; HTML on the renderer thread in short slices, because `DOMParser` doesn't exist in workers. Main's storage worker commits in batches. The main bundle gets **no zip library** (K6). |
| **Import safety** | Zip limits checked against bytes actually inflated, never declared sizes; no names ever become paths on disk; symlinks never followed; DOMPurify on every HTML fragment; only `http`, `https` and `mailto` links survive; remote images are never fetched during import; images go through the image-store pipeline (no SVG, 20 MiB input, 40 MP decode). |
| **New PRs** | **OB1–OB4** (onboarding), **TM1** (templates), **IM1–IM4** (import): about **25.5 agent-days** and 6 design reviews (§6). |
| **Owner questions** | 3 (§7). |

---

## 1. First run and returning users

### 1.1 Desktop first run: keep one sheet

**Decision: one screen, not steps.** The UX spec's sheet (§5.1) already does the only job a first run has here: say where documents live before the person writes one. Everything else is learned in the Playground behind it, by doing.

Evidence:
- NN/g found that tutorials "interrupt users, don't necessarily improve task performance, and are quickly forgotten"; people skip them because they want to start right away ([NN/g, onboarding tutorials](https://www.nngroup.com/articles/onboarding-tutorials/)). A secondary write-up of NN/g's 2020 study of 70 participants reports no meaningful task-success difference between people who read a tutorial and people who skipped it ([summary](https://dataanddesign.substack.com/p/mobile-onboarding-looks-nice-but)) [secondary source].
- Apple's onboarding guidance asks for a flow that is brief, optional and woven into the main experience ([Apple HIG, Onboarding](https://developer.apple.com/design/human-interface-guidelines/onboarding)).
- The bar apps (UX spec header: Bear, Obsidian, Apple Notes, iA Writer) open straight into a document or a sample vault, with no multi-step wizard.

**The sheet** (amends UX spec §5.1, first row):

```text
┌──────────────────────────────────────────────────────────────┐
│  Welcome to TinyDocy                                         │
│                                                              │
│  Your documents are kept in TinyDocy's library on this       │
│  computer. A readable copy of each document you change goes  │
│  to the TinyDocy Backups folder in your home folder.         │
│  Uninstalling TinyDocy doesn't delete either.                │
│                                                              │
│  Backups: ~/TinyDocy Backups                     [Change…]   │
│                                                              │
│  Nothing you write leaves this computer unless you share it  │
│  or keep backups in a cloud folder.                          │
│  Update checks send only the app version and your system.    │
│                                                              │
│             [Explore the Playground]   [Start Writing]       │
└──────────────────────────────────────────────────────────────┘
```

- **Copy fix.** The UX spec says "A readable backup goes … every day". That is wrong: readable copies are mirrored on idle for each changed document (architecture D-A7). Only the internal library copy is daily. The plan's §5.2 wording is the right one and is used above.
- **The added line** "Nothing you write leaves this computer unless you share it or keep backups in a cloud folder" states D0 (and stays true when the person picks an iCloud, OneDrive or Dropbox folder, which the inline note under the folder line then names) in one sentence. "Update checks send only the app version and your system" is the one network request a fresh install makes without being asked (P3.3). The plan's Goal 1 says the app makes no network request the user didn't ask for. Disclosing the update check at first run is the honest minimum. Settings › Updates already has the full sentence and the switch.
- **No name prompt.** The name is asked for the first time someone shares or joins (plan §5.4, P4.4). Nothing in the Local milestone shows a name.
- **No theme, text-size or font question.** All follow the OS by default (preferences design principle 4). Settings › Page has them.
- **No Import button on the sheet.** The empty-library state right behind it offers [Import…] (§2.5). Two buttons on the sheet are enough.
- **Focus.** The sheet is a native window-modal sheet (UX spec principle 1), so the default button is **Start Writing**. Esc closes it, which is the same as Explore the Playground. Both choices set `meta('first_run_done')`. A crash before either is clicked shows the sheet again.

**Reinstall** keeps the UX spec's "Restore your documents from the 12 Nov backup?" sheet, which replaces the welcome sheet when backups are found.

### 1.2 What the two buttons do

| Button | Result |
|---|---|
| **Start Writing** (default) | Creates "Untitled" at the Library root, opens it in a new tab next to the Playground, caret in the empty title. The Playground stays open in its tab. |
| **Explore the Playground** | Closes the sheet. The Playground tab has focus, caret at the start of its first section. |

### 1.3 The Playground teaches by doing

**Today** (`playground-scenarios.ts`) the Playground is random developer prose: a random title from `DOC_TITLES`, 4–6 random sections of `PROSE` sentences, and a fixed "Extensions tour". That is right for the public sandbox, where many visitors share one document and Regenerate (⌘⇧R) fills it for collaboration testing. It is wrong for the desktop app:
- the random sentences ("WebSocket connections automatically reconnect…") describe internals, not what a person can do
- the tour invites pasting X links, which are link cards on desktop (plan §14)
- `createImage()` uses picsum images, which break the P2.9b exit criterion "with the Playground open, the app makes no network requests"
- random regeneration makes "Reset Playground…" (UX spec §5.3) meaningless, since there is no original to return to

**Decision (accepted in plan v7).** The desktop Playground is a **fixed teaching document**, built by a new pure function `buildTeachingPlayground({ platform, target, locale })` in `components/document-editor/playground-teaching.ts`. It reuses the existing builders (`createDiagramBlock`, `headingAttrs`) and changes nothing on the sandbox: the sandbox keeps `generatePlaygroundContent()` and Regenerate. The same content is the web library's practice document (§1.4) and Help › Getting Started (§2.4), so it is written once.

**`locale`** (v7) selects the content's language. v1 ships English only (D26); later languages add a translated copy of the content reviewed with the rest of that language (languages design L8.x). Reset Playground rebuilds it in the current interface language.

**Structure.** Every section is short: one sentence of what, one "Try it" line that makes the reader act. NN/g notes that tutorials work better when people perform the task rather than watch ([NN/g](https://www.nngroup.com/articles/onboarding-tutorials/)). Shortcut glyphs come from `parseShortcutKeys` for the platform, so Windows readers see Ctrl.

| # | Heading (H2) | Teaches | "Try it" line |
|---|---|---|---|
| — | **Welcome to TinyDocy** (title) | Title-first: every document starts with its title | Click the title and rename this document. Nothing here can break; Reset Playground in the Document menu puts it back. |
| 1 | Write | The "/" menu, Markdown shortcuts, Backspace undoes a conversion | Type / on an empty line and pick a block. Or type ## and a space for a heading. |
| 2 | Move around with the outline | The outline, Go to, fold | Click a heading in the outline. Fold this section with the arrow beside its heading. |
| 3 | Rearrange whole sections | Section drag in the outline, the heading filter (⌘⇧F) | Drag "Lists and tables" above this section in the outline. |
| 4 | Lists and tables | Task list, a 3 × 3 table | Tick a task. Press Tab in the table to move to the next cell. |
| 5 | Diagrams | One Mermaid flowchart (`createDiagramBlock("flowchart")`) | Change "Draft" to "Plan" in the diagram's source. |
| 6 | Images | One **bundled** image (asset in the app, no network) | Drag an image from your computer onto an empty line. |
| 7 | Make the page yours | Page… (width, text size), ⌘+ / ⌘− | Press ⌘+ twice, then ⌘0. |
| 8 | Your documents | Where they are kept, backups, Import, templates | Open the File menu and look at New from Template. |
| 9 | Keyboard shortcuts | ⌘/ | Press ⌘/ to see every shortcut. |
| 10 | Sharing *(Live milestone only; left out until P4.4 lands)* | Share makes one document live; your copy stays here | — (sharing needs a real document; the Playground can't be shared) |

**Web lines (`target: "web"`)** where the desktop line doesn't apply. On the web ⌘+ / ⌘− stay browser zoom (preferences C2) and there is no menu bar.

| # | Web "Try it" line |
|---|---|
| — (title) | Click the title and rename this document. This is a practice copy: close this tab to start fresh. |
| 7 | Open ⋯ › Page… and pick Wide. |
| 8 | Open ⋯ and look at New from Template and Import. |
| 6 | The image is referenced by its static, same-origin bundled URL (`/playground/…`), **not** through the image store, so the practice copy writes nothing. It enters the store only on **Keep a copy**, the same way a data-URL image is migrated (image store §5.5). |

- **Size.** About 1,800 words, 10 sections: it fits the existing "lean landing doc" intent and is far below any size limit.
- **One image** ships in the app bundle and enters the library through the image store at first run (`origin: 'insert'`), so it is backed up like any other image.
- **Reset Playground…** (UX spec §5.3 sheet) rebuilds it from the function. It keeps the Playground's id, so its outline and continue position stay keyed.
- **Shortcut on desktop.** ⌘⇧R no longer regenerates on desktop (P1.2 already moves it, and Align right keeps ⌘⇧R). Reset is in the Document menu only.
- **Copy rules** follow UX spec §9: "document", never "note" or "page"; "Import", never "Open" for files.

### 1.4 Web library first run

The web library's first-run state (web library §9) stays, with one change:

| | Today's design | This design |
|---|---|---|
| Empty state link | "Try the public Playground" (to tiny.docs.plus) | **"Getting started"**: opens the teaching document (§1.3, web glyphs) as a **practice copy in memory**. It is never written to IndexedDB, never sets the marker cookie, never counts toward the "3 documents" backup nudge, and disappears when the tab closes. A banner above it says so. |

**Why.** The library's audience chose it because it is private. Sending them to a public sandbox, where "anyone can see and edit these tabs", to learn the editor invites the exact mistake the `Public` chip exists to prevent (web library risk WK7). The web library's own rule ("the Playground stays in the sandbox; the library starts empty", §13 there) still holds: nothing is stored. This was owner question Q3 because it touches a call made in that design; **D29 accepts it** and amends the web library design.

**Practice copy banner** (notice slot, `role="status"`): "This is a practice copy. Changes here aren't saved. [Keep a copy]" — **Keep a copy** creates a normal library document from its current state, which is the moment the library first stores anything.

### 1.5 Returning users: What's new

**Decision: yes on desktop, one pill per minor or major release; no on the web.**

- **Why yes.** Updates install silently on quit (preferences design, Updates pane). Without a signal, a person never learns that Find and Replace or templates arrived. VS Code opens its release notes after each update and lets people turn that off from the notes themselves ([VS Code 1.75](https://code.visualstudio.com/updates/v1_75)); NN/g cites Evernote's persistent "What's New" menu as help that is easy to dismiss and to recall ([NN/g](https://www.nngroup.com/articles/onboarding-tutorials/)). A pill is lighter than either: it never takes focus and never opens a window by itself.
- **Trigger.** At the first launch where `app.getVersion()` differs from `meta('last_seen_version')` **and** the release manifest marks the release `notes: true` (set by the release runbook for minor and major releases, never for patches). Downgrades (beta → stable) show nothing.
- **When.** 10 s after the first document is editable, once, in the pill host (UX spec §6.1). Never during the first-run or restore sheets. Never if another pill is showing; it waits for the next quiet moment in that launch, then gives up until the next launch.
- **Where the notes live.** **Help › What's New** is a bundled page, generated at build time from the desktop section of `CHANGELOG.md` (P3.4 creates that section), so it works offline. The About pane's "Release notes" link opens the same page.
- **No setting.** One pill per release is below the threshold that needs an off switch (preferences principle 2).
- **The web** (sandbox and library) ships continuously, so it gets no pill. The web ⋯ › Help menu gets "What's new" linking to the CHANGELOG on GitHub.

### 1.6 The path from the sandbox to the library to the desktop app

Visitors arrive at tiny.docs.plus, the public sandbox. The path to private documents has three steps, and each step should be visible from the previous one without nagging.

```text
tiny.docs.plus (public)          my.tiny.docs.plus (this browser)       desktop app (this computer)
───────────────────────          ────────────────────────────────       ───────────────────────────
banner + Public chip  ──open──▶  empty state, storage card       ──▶   /download page
"Copy to My documents" ─W9──▶    import receives the copy               File › Import… takes the
                                 Export all… (backup zip)  ─────────▶  library backup zip
```

| Where | What (new in **bold**) | Owner |
|---|---|---|
| Sandbox banner | Unchanged: "Public sandbox: anyone can see and edit these tabs. For private documents, use My documents or the desktop app." **"the desktop app" becomes a link to `/download`.** | OB4 |
| Sandbox `Public` chip popover | Unchanged copy, [Open My documents]. **Adds a text link "Get the desktop app".** | W5 + OB4 |
| `site-config.ts` | **New `PRIVATE_OPTIONS` constant**: "For private documents, use My documents in your browser, or the TinyDocy desktop app, which keeps everything on your computer." Read by the SEO intro (`site-intro.tsx`, after `SANDBOX_NOTICE`), `/about`, `llms.txt` and the JSON-LD description, so every surface says it the same way (AGENTS: `site-config.ts` is the single source of public copy). | OB4 |
| **`/download`** (new static page on tiny.docs.plus) | Detects the OS from `userAgentData` (falls back to a list), one primary button per OS, checksums, the update-check sentence from §1.1, and "Already using My documents? Export all from there, then import the zip in the app." Not part of the desktop export (P2.4 leaves web-only pages out). | OB4 |
| Library storage card (persistent and not-persistent states) | **Adds a last line:** "Want documents that don't depend on this browser? Get the desktop app." (link) | OB4 (copy in W6's card) |
| Desktop File › Import… | **Accepts the library's `TinyDocy backup <date>.zip`** (web library §6.1 format): folders, tags and pins recreated, same-lineage dialog per document. This is the same shared archive module that desktop "Restore from backup…" reads. | IM2 |

No "Open in the desktop app" handoff for library documents: the library and the app are separate stores on purpose, and Export → Import is one zip.

---

## 2. Onboarding inside the product

### 2.1 One-time pills (hints)

**Mechanism** (`lib/hints.ts`, shared, about 40 lines, never in the editor chunk):
- `showHintOnce(id, message, action?)` calls `announce()` (the pill host, which is also the screen-reader announcement) if `id` hasn't been shown.
- Seen ids live in a new `tinydocy-ui` slot **`hints`** (`string[]`, allowlist validator of the ids below, `maxRecent: 0`), added to `CHOICE_SLOTS` so the contract test covers it. It survives "Forget my formatting choices" (it is `ui`, not `choices`). Under `NEXT_PUBLIC_REMEMBER_CHOICES=0` it is session-only, like every other `ui` slot (preferences §5.7). Desktop uses the same renderer `localStorage` (preferences §2.2 already puts `tinydocy-choices` there).
- Reads happen in the handler that fires the hint, never at render, so there is no hydration risk (AGENTS: never `useState(() => readStorage())`).
- **Rate:** at most one hint per window per 10 minutes. Never while a sheet, menu, popover or the palette is open. Never in the first 60 s after the first-run sheet closes.
- **No "show tips again".** Everything a hint says is also in Help › Getting Started and the shortcut sheet.

**The catalogue (v1).** A hint exists only where a person's action shows they may have a wrong model. Each fires on that action, which is NN/g's "pull" help at the moment of need.

| Id | Where | Trigger | Copy (pill) | Action | Owner |
|---|---|---|---|---|---|
| `save-key` | Desktop, web library | ⌘S / Ctrl+S (the key is consumed; the browser's Save Page dialog never opens on library pages) | Desktop: "TinyDocy saves as you type." Library: "Your documents save in this browser as you type." | — | P2.9a, W5 (fires through OB2) |
| `md-paste` | Everywhere | First paste that the P2.12 rule renders as Markdown | "Pasted as formatted text. ⌘⇧V pastes plain text." | [Undo] | P2.12 |
| `close-tab` | Desktop, web library | First ⌘W or tab ✕ | "Closing a tab doesn't delete anything. Find your documents in the sidebar." | — | OB2 |
| `template-vars` | Desktop, web library | First Save as Template | "Tip: type {{date}} in a template to fill in the date each time you use it." | — | TM1 |

- **`close-tab` matters most.** On the sandbox, closing a tab deletes it for everyone ("Delete tab for everyone" tooltip). People who move from the sandbox carry that model, and they would otherwise avoid closing tabs.
- **Left out on purpose:** a hint on each Markdown auto-conversion (fires mid-typing; Backspace already undoes it and Help says so, preferences §2.3), a hint on the first heading (the outline appears by itself), and anything on first launch.

### 2.2 Keyboard shortcut sheet (⌘/)

The preferences design keeps "a read-only shortcut sheet only" (§2.3 there). The UX spec's Help menu already lists Keyboard Shortcuts.

- **Opens with** ⌘/ (Ctrl+/), Help › Keyboard Shortcuts, the palette ("Keyboard shortcuts"), and the link in the Playground. Google Docs and Slack use the same key for their shortcut lists [from memory, not re-checked].
  - **Free:** no binding for `Mod-/` exists in `lib/editor-actions`, `extensions/`, `components/`, or any `@tiptap/*` or `@docs.plus/*` package (checked 2026-11-16 with `grep -rn "Mod-/"`). ⌘? (⌘⇧/) stays the macOS Help menu search.
  - **Bound by `event.code === "Slash"`** with Mod and without Shift or Alt, in the shell's existing window `keydown` listener (beside `tab-bar.tsx`'s), not in the editor. On layouts where "/" needs Shift (German: Shift+7), the key is the physical one right of the full stop. The menu item and the palette always work, so no layout is stuck.
  - **On the web** ⌘/ isn't a browser shortcut in Chrome, Safari or Firefox [verify in OB2 on each browser; if one claims it, the web keeps only the menu and palette paths].
- **Content is generated, never hand-written:**
  - editor rows from the action registry (`shortcut`, `markdownHint`, label), so the sheet can't drift from the keys
  - app rows from a new shared `APP_KEYMAP` table (`lib/app-keymap.ts`), the same table the desktop menus read for their accelerators (UX spec §2.4 "one source for labels and shortcuts")
  - a test fails if any registry action with a shortcut is missing from the sheet, or if two rows share a combo
- **Layout.** A `components/ui` Dialog, 640 px wide (full-screen sheet below 640 px), title "Keyboard shortcuts", a filter field "Filter shortcuts" with focus, then groups: **Text** · **Paragraphs and headings** · **Lists** · **Insert** · **Sections and outline** · **Documents and tabs** (desktop and library) · **Find** · **View** · **Markdown you can type** (`## `, `- `, `[ ] `, `> `, ` ``` `, `**text**`). Each row: label, then keys as `<kbd>` elements.
- **Lazy chunk**, loaded on open. Editor chunk +0 B (checked by `check-editor-chunk-size.ts`, and the import-boundary rule that the chunk imports no `components/document-editor/**` module, the same lesson as the continue chip in AGENTS).

### 2.3 The empty line teaches "/"

`PLACEHOLDER_TEXT.paragraph` is "Type something..." today (`document-editor-config.ts:76`). It becomes **"Type / for blocks"**.
- The "/" menu is the one feature nobody finds by looking at the toolbar. Notion teaches it with the same placeholder.
- The placeholder shows only on the empty paragraph that holds the caret [verify the `@docs.plus/extension-placeholder` option equivalent to Tiptap's `showOnlyCurrent`; if it shows on every empty paragraph, limit the text to the caret's paragraph in `getPlaceholderText`].
- This is shared, so the sandbox gets it too. About +10 B in the editor chunk. Tests that assert "Type something..." are updated in the same PR.

### 2.4 Help › Getting Started

- **Desktop:** Help › Getting Started opens the teaching document (§1.3) **read-only in a Help window**, with a button "Practise in the Playground", which focuses the Playground tab. Help pages ship in the app and work offline (plan §5.2).
- **Web library:** ⋯ › Help › Getting started opens the practice copy (§1.4).
- **Sandbox:** unchanged (the Playground is the sandbox's teaching surface).
- **Other Help pages this design adds** to P2.9b's bundled set: "Importing from other apps" (one section per source in §4.2, with the export steps for each app) and "Templates".

### 2.5 Empty states that teach

Amends UX spec §5.2. The rule: an empty state names the next action and the one fact that makes it safe.

| State | Title | Sentence | Actions |
|---|---|---|---|
| **Empty library** (desktop) | No documents yet | Documents you create or import appear here. You can import Markdown, Word and HTML files, or a whole folder from apps like Obsidian or Notion. | **[New Document]** · [Import…] |
| **Empty folder** | "Drafts" is empty | Drag documents here, or create one. | **[New Document]** |
| **Templates, none of your own** (in the picker, §3.4) | — | Save any document as a template with Document › Save as Template…. | — |
| **Manage Templates, empty** | No templates yet | Save any document as a template, and it appears here. Starter templates are always in New from Template. | — |
| **Quick Open, no match** | — | Row: Create "q4 plan draft". Under it: Search looks at titles, tags and folders, not inside documents. (v7, D24) | Enter creates it (unchanged) |
| **Web library first run** | (web library §9 copy, unchanged) | (unchanged) | [New document] [Import…] · link **"Getting started"** (§1.4) |

The UX spec's other empty states (Recent, Trash, Pinned) are unchanged.

---

## 3. Templates

### 3.1 Should v1 have templates?

**Recommendation: yes, the small version** (owner Q1).
- **Demand.** Obsidian's "default template for new note" request has 364 likes, and the research doc rated templates "Later: Duplicate covers most of the need" ([user requests #21](../../research/2026-11-15-editor-user-requests.md)). Since then D0 named the audience: people keeping private documents, whose most repeated documents are meeting notes, journals and weekly plans. Duplicate needs a document to copy from, a rename, and a manual date edit every time.
- **Prior art.** Obsidian's core Templates plugin is exactly this size: a templates folder, an insert command, and `{{title}}`, `{{date}}` and `{{time}}` with optional formats ([Obsidian Help, Templates](https://obsidian.md/help/plugins/templates)).
- **Cost.** About 4 agent-days (TM1), because templates are ordinary library documents with one flag. No schema change in the editor, no server, no editor-chunk bytes.
- **Cut order.** If time runs short, TM1 goes after HTML import and before Pinned in the plan's tripwire list (§6.3).

### 3.2 Model

- **A template is a library document with `kind = 'template'`.**
  - Desktop: a `kind TEXT NOT NULL DEFAULT 'doc'` column on `docs` (P2.6 amendment, §8; P2.6 isn't built, and its stated goal is that no later migration is needed).
  - Web library: the same field on the `docs` store in `tinydocy-library` v1 (W2 amendment).
  - It has its own Y.Doc, lineage, tags, page width (`doc_view`) and images, exactly like a document.
- **Where templates are not:**
  - not in Library, Recent, Pinned, Tags lists, Quick Open or title search
  - never live: the Share button on a template is disabled with the tooltip "Templates can't be shared. Create a document from it first." `ShareService` refuses `kind = 'template'` too.
  - never in another person's Y.Doc: creating from a template builds a **new** Y.Doc from the template's content (§3.5). Nothing links the two, and a collaborator on the new document never receives the template.
  - no comments: Save as Template drops the `comments` map (the same stripping as Duplicate, comments design P4.11)
- **Where templates are:**
  - **File › New from Template ▸**, the palette, the picker (§3.4), **Manage Templates** (a list view, §3.6)
  - **backups:** mirrored to `~/TinyDocy Backups/Templates/` with the same `.tinydoc` and `.md` pair
  - **Export all:** `library.json` entries carry `"kind": "template"`; import recreates them as templates
  - **Trash:** deleting a template trashes it; Restore returns it to Templates
- **Starter templates** are **bundled and read-only**, as JSON built by `lib/templates/starters.ts`. They are never written to the library, so an update can improve them, they don't inflate backups, and the web library's "first document" signals (marker cookie, the 3-document nudge) never fire from them. **Edit a Copy** (in the picker) creates a user template from a starter.

### 3.3 Starter templates (v1)

Four, chosen for D0's audience. Each title uses a variable where a date makes the document findable later.

| Starter | Title | Body |
|---|---|---|
| **Meeting notes** | Meeting notes, {{date}} | H2 Attendees (bullet list) · H2 Agenda (numbered list) · H2 Notes · H2 Decisions · H2 Action items (task list: "[ ] Owner: task") |
| **Project plan** | Project plan | H2 Goal (one paragraph) · H2 Scope (In / Out bullet lists) · H2 Milestones (table: Milestone · Date · Status) · H2 Risks · H2 Open questions |
| **Journal entry** | {{date:iso}} | H2 Today · H2 Grateful for · H2 Tomorrow (task list). The ISO title makes entries sort by date in any list. |
| **Weekly plan** | Week of {{date}} | H2 Top three (task list ×3) · H2 Schedule (table: Day · Plan) · H2 Notes · H2 Review (filled at the end of the week) |

A README starter was considered and left out: it serves developers, not D0, and the Playground already shows code blocks and diagrams.

### 3.4 New from Template

**Entry points.**

| Where | What |
|---|---|
| **File › New from Template ▸** | The 5 most recently used templates (yours and starters), a separator, **Choose Template…** (opens the picker). With no history: the 4 starters, then Choose Template…. |
| **Palette** | "New from template…" (opens the picker), plus one entry per template: "New: Meeting notes". |
| **New tab button** (`+`) | Its context menu (right-click, ⇧F10): New Document · New from Template… |
| **Empty folder state** | Unchanged (two-button limit). The picker is one menu away. |

**Shortcut: none.** ⌘⇧N is New Folder and ⌥⌘N is New Window (UX spec §4.6), and Ctrl+Alt is AltGr on Windows and Linux. A chord for a weekly action isn't worth a collision; the palette and the menu reach it in two keys.

**The picker** (a `components/ui` Dialog on both platforms; desktop opens it in the window, not as a native sheet, because it needs a live preview):

```text
┌ New from Template ───────────────────────────────────────────────────────┐
│ ⌕ Filter templates                │  Meeting notes, 16 November 2026      │
│                                   │  Attendees                            │
│ YOUR TEMPLATES                    │  •                                    │
│   Client call                     │  Agenda                               │
│   Sprint review                   │  1.                                   │
│ STARTERS                          │  …                                    │
│ ▸ Meeting notes                   │  (read-only preview, variables filled)│
│   Project plan                    │                                       │
│   Journal entry                   │                                       │
│   Weekly plan                     │                                       │
│                                   │                                       │
│ Manage Templates…   Edit a Copy   │              [Cancel]  [Create]       │
└──────────────────────────────────────────────────────────────────────────┘
```

- **Keyboard:** focus starts in the filter. ↑ ↓ move through the list (a `listbox`, `aria-activedescendant` from the filter, like Quick Open). Enter creates. Esc closes. Filtering ignores accents and case (same matcher as Quick Open, E9).
- **Preview:** a static render of the template with variables filled for today, from the same Markdown serialisation the Restore dialog uses (UX spec §5.5). No editor is mounted.
- **"Edit a Copy"** is enabled on starters only: it creates a user template "Meeting notes (my copy)" and opens it for editing.
- **Empty "Your templates":** the group shows one muted line: "Save any document as a template with Document › Save as Template…."
- **Where the new document goes:** the folder that has focus in the sidebar or list, else the Library root, the same fixed rule as New Document (preferences §2.3).

### 3.5 Creating a document from a template

1. Read the template's current state (`stateOf`), or the starter JSON.
2. Convert to ProseMirror JSON with the headless schema (the schema module P2.8 builds and W7 reuses, §4.6).
3. **Strip identity:** remove heading `id` / `data-toc-id` attributes so the TOC-id plugin assigns new ones (outline ids are per document; keeping them would collide in "Continue where you left off" only by accident, but fresh ids keep every document independent).
4. **Fill variables** (§3.7) in text nodes, skipping `codeBlock` and `inlineCode`.
5. Build a **new Y.Doc** from the JSON (`prosemirrorJSONToYDoc` into the editor's fragment), with a new id, a new lineage and a **new `link_key`** (v7; never the template's), and `kind = 'doc'`.
6. Copy the template's **tags** and **page width** (`doc_view.width`). Images are `asset:` refs already in the store; `doc_blobs` is recounted for the new document. Nothing is copied byte for byte.
7. Open it in a new tab with the caret at the end of the title. Recorded in the "recently used templates" list: a `tinydocy-ui` slot `recentTemplates` (at most 5 ids) on both platforms, in the renderer's `localStorage` like `hints`. Main reads it through the renderer's menu-state message when it rebuilds File › New from Template ▸, so it needs no `meta` row.

The new document is one creation, not an edit: there is nothing to undo inside it. Moving it to Trash (with the usual Undo pill) removes it.

### 3.6 Save as Template… and Manage Templates

**Document › Save as Template…** (desktop menu; web ⋯ on library documents; palette "Save as template…"). Disabled on the Playground, on templates and on documents in Trash.

Sheet (desktop native sheet; web Dialog):

```text
Save "Client call" as a template?
Name  [ Client call                      ]
Type {{date}} or {{time}} in a template to fill in the date or time each time you use it.
Text, images, tags and page width are copied. Comments aren't.
                                   [Cancel]  [Save Template]
```

- The name is the template's title. "Enter a name." inline if empty (UX spec §6.1 form-error rule).
- After saving: pill "Saved "Client call" as a template. [Show]" — Show opens Manage Templates with it selected.
- **Saving from a live document** copies this computer's current state. Collaborators see nothing.

**Manage Templates** is a list view (P2.7b list component, filtered to `kind = 'template'`), reached from the picker and File › New from Template ▸ Manage Templates…. Rows open a template for editing in a tab. Context menu: Open · Rename (F2) · Duplicate · Move to Trash. The tab of an open template shows a chip `LayoutTemplate` **Template** with the popover: "A template. Documents made from it don't change when you edit it." (a new row in the UX spec §5.3 chip table).

### 3.7 Variables

| Token | Becomes | Example (en-GB, 16 Nov 2026, 14:05) |
|---|---|---|
| `{{date}}` | `Intl.DateTimeFormat(undefined, { dateStyle: "long" })` | 16 November 2026 |
| `{{date:iso}}` | `YYYY-MM-DD` in local time | 2026-11-16 |
| `{{time}}` | `Intl.DateTimeFormat(undefined, { timeStyle: "short" })` | 14:05 |

- **Exactly these three.** Any other `{{…}}` stays as typed. No format strings: Obsidian's Moment tokens ([Obsidian Help](https://obsidian.md/help/plugins/templates)) are a second language to learn, and `iso` covers the one real need (titles that sort by date). `{{title}}` is pointless here, because the title *is* the template's first heading.
- **Filled once, at creation.** The document holds plain text afterwards.
- **In the preview,** filled with today's values, so people see what they'll get.

### 3.8 The "/" menu: no templates in v1

- The "/" menu inserts **blocks at the caret**; a template is a **whole document** with its own title. Inserting one mid-document would put a second title-like heading into the body and fight the title-first schema.
- `slash-items.ts` is a pure view of the action registry, and its import rule allows "types, the registry gate and icons only". Templates live in the library store, which would pull platform code into the lazy slash chunk and break that rule.
- **Later:** "Insert template body…" as a palette action that inserts a template's body (without its title) at the caret, if people ask for it.

---

## 4. Import from other apps

### 4.1 What v1 imports

The plan's v1 import is `.md`, `.html` and `.tinydoc` (plan §5.3, P2.8), and the tripwire already lists HTML import as cuttable. This design widens **what counts as Markdown** (folders, zips and app conventions) far more than it adds formats, because nearly every app below can now export Markdown.

| Source | How the person exports | What TinyDocy accepts | v1? | Notes |
|---|---|---|---|---|
| **Markdown files and folders** | — | `.md`, `.markdown`, a folder, a zip of either | **v1** | The base path. P2.8 single-file import becomes the engine's first source. |
| **Obsidian vault** | Point at the vault folder | The folder | **v1** | Wikilinks, embeds, callouts, highlights, properties, attachments by name (§4.3). `.obsidian/` and `.trash/` are skipped. |
| **Notion** | Settings › Export: Markdown & CSV, or HTML; include subpages; create folders for subpages | The zip, nested `Export-…-Part-N.zip` included | **v1** | Notion appends a 32-character id to file names ([Obsidian forum guide](https://forum.obsidian.md/t/notion-2-obsidian-migration-instructions/2728)) [community source]. Callouts arrive as HTML ([Notion Help](https://www.notion.com/help/export-your-content)). Databases arrive as CSV (§4.3). Obsidian recommends Notion's HTML export because its Markdown export "omits important data" ([Obsidian Help, Notion](https://obsidian.md/help/import/notion)), so both are accepted and Help recommends HTML. |
| **Google Docs** | File › Download › Markdown (.md), official since July 2024 ([Google Docs Help](https://support.google.com/docs/answer/12014036), [Workspace Updates](https://workspaceupdates.googleblog.com/2024/07/import-and-export-markdown-in-google-docs.html)) | `.md`; also `.docx` (if IM3 ships) and a zipped HTML download | **v1** | Help recommends Markdown. Images in Google's Markdown [verify in IM1: inline data URIs or omitted]. |
| **Word** | — | `.docx` | **v1, cut first** (owner Q2) | Through mammoth.js (§4.4). `.doc` (binary) never. |
| **Apple Notes** | macOS 26 and iOS 26: select notes, File › Export as › Markdown ([MacRumors how-to](https://www.macrumors.com/how-to/ios-import-export-markdown-apple-notes/)) | The exported `.md` files or their folder | **v1** (via Markdown) | Earlier macOS has no export. Obsidian's importer reads the Notes SQLite database directly ([Obsidian blog](https://obsidian.md/blog/apple-notes-export/)); TinyDocy **won't**: it needs Full Disk Access, which D0's audience shouldn't have to grant, and it breaks with each macOS. Help names the third-party route for older systems without endorsing an app. |
| **Bear** | File › Export: Markdown, or TextBundle ([Bear FAQ](https://bear.app/faq/export-your-notes/)) | `.md`, `.textbundle` folders, `.textpack` zips | **v1** (via Markdown and TextBundle) | Inline `#tags` and nested `#a/b` tags become TinyDocy tags. `.bear2bk` (the full backup) is **later**: its layout isn't documented, and Obsidian's importer is the only public reader ([Obsidian Help, Bear](https://obsidian.md/help/import/bear)). |
| **Plain text** | — | `.txt` | **v1** | Each line is a paragraph; runs of blank lines collapse. Title: the file name. |
| **HTML** | — | `.html`, `.htm` | **v1** (P2.8; tripwire-cuttable) | Through the sanitiser (§4.7). |
| **TinyDocy** | — | `.tinydoc`, desktop backup folders, web library backup zips | **v1** | Same-lineage dialog (plan §5.3). |
| Evernote `.enex`, OneNote, RTF, ODT, Pages, `.bear2bk` | — | — | **Later** | Each needs its own parser. Evernote and OneNote users can go through Notion or Obsidian today. |

**Split by gate (plan v7).** "v1" above now means one of two gates:

| Gate | Sources |
|---|---|
| **Gate 3** (the 10 testers bring their notes) | Markdown files and folders, which covers Obsidian vaults and the Markdown exports of Apple Notes, Google Docs and Bear; `.txt`; `.tinydoc`; desktop backup folders and web library backup zips |
| **Gate 5** | HTML (`.html`, `.htm`, and Google's zipped HTML); Notion zips (Markdown & CSV, and HTML); Bear TextBundle (`.textbundle`, `.textpack`); Word `.docx` (IM3, D28, first import format to cut) |

**Never imported in v1, from any source:** comments (Word, Google), page-level colours and fonts, embedded files other than images (PDFs, audio, video). Each is counted in the import report (§5.3), so nothing is lost silently. **Links between notes** import as text in IM1, with each file's relative path recorded in `import_sources`, so LK5's one-time "Link imported notes" can turn them into document links afterwards (§4.2).

### 4.2 Conversion: what survives

The TinyDocy schema: a title heading, then headings 1–6, paragraphs, bullet, numbered and task lists (nested), blockquotes, code blocks (validated languages), Mermaid, horizontal rules, tables (with merged cells), images and media embeds, and the marks bold, italic, underline, strike, inline code, link, highlight, text colour, font size, superscript and subscript (`document-editor-config.ts`).

| Feature | Markdown sources | HTML, Notion HTML, `.docx` | Result in TinyDocy |
|---|---|---|---|
| **Title** | Front matter `title` › a leading H1 › the file name | `<title>` / Notion page title › leading `<h1>` › the file name | The title heading. If the body's first H1 equals the title, it isn't repeated. Notion's 32-hex id suffix is removed. |
| Headings | `#`–`######` | `h1`–`h6`; Word heading styles | Kept. Extra H1s in the body stay H1 (allowed below the title). |
| Lists, nesting | ✓ | ✓ | Kept. |
| **Checklists** | GFM `- [ ]` / `- [x]` (Obsidian, Bear, Apple Notes, Notion) | `<input type=checkbox>` in a list | Task list, checked state kept. |
| **Tables** | GFM tables | `<table>`, `colspan`/`rowspan`; Word tables | Kept with merged cells. A cell from Markdown holds one paragraph (a Markdown limit, [Tiptap Markdown docs](https://tiptap.dev/docs/editor/markdown)). Nested tables are flattened into their cell's text. Table borders and widths aren't kept. |
| **Notion databases** (CSV) | — | — | A document with a table: first row as header. Above 1,000 rows or 30 columns the CSV is skipped, with the reason in the report. Its row pages import as documents in a folder named after the database. |
| Code | Fences with language | `<pre><code class="language-x">` | Code block; unknown languages become plain (`SafeCodeBlock`). ` ```mermaid ` becomes a Mermaid block. |
| **Images** | `![](rel/path.png)`, `![[x.png]]`, data URIs | `<img>` (data, relative); Word images | Through the image-store pipeline (§4.7): stored as `asset:` refs. A relative path that isn't in the import set becomes the line *Image not found: x.png* in italics. |
| Remote images | `![](https://…)` | `<img src=https…>` | Kept as remote images. **Never fetched during import.** On desktop they wait for a click (plan §5.5); in the web library they follow its existing rule. |
| Links | `[t](https://…)`, `mailto:` | `<a href>` | Kept for `http`, `https`, `mailto` only. Every other scheme (`javascript:`, `file:`, `obsidian:`, `notion:`) becomes its text. |
| **Links between notes** | `[[Note]]`, `[[Note|Alias]]`, `[t](Other.md)` | Notion internal links | **Text, upgraded later by LK5.** Wikilinks stay as the literal `[[Note]]` / `[[Note|Alias]]` text, and a Markdown link to a local file stays as its literal `[t](Other.md)` text (v7: no longer reduced to its label), so LK5 can resolve them and Obsidian users recognise them. IM1 stores each imported file's **relative path** (and the source app) in `import_sources`. **LK5** (D25, [search-linking design](2026-11-16-search-linking-design.md) §4.9) adds a one-time **"Link imported notes"** forward edit that resolves these against `import_sources` and turns them into document links. The report counts them with the shared string in §5.2. |
| Embeds of notes | `![[Note]]`, `![[Note#Heading]]` | — | The literal text, like wikilinks. |
| **Callouts** | Obsidian `> [!note] Title` | Notion `<aside>` | Blockquote whose first line is the bold title ("Note: Title"). |
| **Highlights** | `==text==` | `<mark>`; Word highlight | Highlight mark (the default colour token). |
| **Footnotes** | `[^1]` and `[^1]: text` | Word footnotes and endnotes (mammoth) | A superscript number in the text and a **Notes** section (H2) at the end with a numbered list. There is no footnote node. |
| Front matter | YAML block | — | `title`, `tags` (list or comma string), `created`/`date`, `modified`/`updated`. Read by a **restricted parser** (scalars and flat lists only; no anchors, aliases or tags, so no YAML bombs and no new dependency). Other properties are dropped and counted. |
| **Tags** | Front matter `tags`; inline `#tag` and `#a/b` outside code (Obsidian, Bear) | — | TinyDocy tags (details §3): 40 characters, 20 per document; extras dropped and counted. Inline `#tag` text stays in the document. |
| **Dates** | Front matter dates › file modification time | File modification time | `created_at` and `modified_at`, so "sort by date" means something after an import. |
| Maths | `$…$`, `$$…$$` | — | Kept as text (no maths node). |
| HTML inside Markdown | raw HTML | — | Through the same sanitiser as HTML files. |
| Comments | — | Word comments (mammoth ignores them by default, [mammoth.js](https://github.com/mwilliamson/mammoth.js)) | **Dropped, counted.** |
| Colours, fonts, alignment | — | Inline styles | Dropped, except text alignment on paragraphs and headings. Page-level settings never come from imports. |
| Line breaks, horizontal rules, sub/superscript, strike, underline | ✓ | ✓ | Kept. |

**Footnotes and highlights aren't in GFM** and `marked` doesn't parse them by default. The engine handles them as a pre-pass over the Markdown text, outside code spans and fences, before `@tiptap/markdown` parses it. The `Marked` instance stays per editor (`createMarkedInstance`), and the import engine creates its own.

### 4.3 Folder structure, names and duplicates

- **One new folder per import.** Everything lands in a new folder at the target (the focused folder, else the Library root), named after the source: the folder's name, the zip's name without `.zip`, or for single files no new folder. Cancel or "Move to Trash" is then one action on one folder.
  - Name collisions get " (2)" (web library §6.4 rule).
  - **Exception:** a TinyDocy backup zip or backup folder restores its own folder tree, tags and pins (`library.json`), as web library §6.4 specifies.
- **Structure is preserved** up to the library's 4 nesting levels (details §6.1). Deeper source folders merge into their deepest allowed ancestor; the report says "Folders deeper than 4 levels were merged into their parent folder (12 documents)."
- **Notion's two shapes:** a page with subpages arrives as `Page.md` beside a `Page/` folder. The engine keeps both: the page becomes a document **inside** the folder named after it, listed first (Manual sort), so the hierarchy reads the same.
- **Names:** folder and document names drop Notion's id suffix (`\s[0-9a-f]{32}$`), file extensions, and control characters; folder names go through `filenames.ts` rules so backups mirror them safely.
- **Attachments** are resolved inside the import set only:
  - relative paths first, against the note's own folder
  - then Obsidian's rule for `![[name]]`: the file with that name anywhere in the vault, shortest path first
  - never outside the chosen folder or zip
  - attachments that no document references are not imported (they'd be orphan blobs, and GC would remove them)
- **Skipped entries:** dot-files and dot-folders (`.obsidian/`, `.trash/`, `.git/`, `.DS_Store`), `__MACOSX/`, `Thumbs.db`, and symlinks (never followed, §4.7). Unsupported files are listed in the report by kind ("4 PDF files"), not one by one, above 20.
- **Duplicates.**
  - **`.tinydoc` and backups:** the same-lineage dialog (plan §5.3).
  - **Everything else:** a new store **`import_sources`** (desktop SQLite, P2.6 amendment; IndexedDB store in W2). **v7:** the plan's schema amendment lists `import_sources(doc_id, relative_path, source_app)`; duplicate skip (never cut, D30) also needs `source_hash`, the SHA-256 of the file's bytes, and `imported_at`. Architecture §5.3 keeps all five, keyed by `doc_id` with an index on `source_hash`, **pending owner confirmation**. When a file's hash points to a document that still exists outside Trash, the preflight (§5.2) says so and **skips it by default**: "12 of 340 files were imported before." with a checkbox "Import them again". "Import them again" creates new documents with their own rows; the duplicate check matches the newest live `doc_id` for that hash.
  - **Re-import is not sync.** Re-running an Obsidian import after editing three notes in Obsidian imports just those three, **as new documents** in the new "Vault (2)" folder. The earlier imports are unchanged; nothing is updated in place (editing Markdown folders in place is a plan non-goal). The preflight says so: "Files changed since the last import come in as new documents. Your earlier copies aren't changed."
  - Titles are never used for duplicate detection: two notes may share a title.

### 4.4 Word `.docx` (IM3, owner Q2)

- **Library:** mammoth.js. It maps Word's semantic styles to HTML (headings, lists, tables, images, footnotes, links, bold to subscript) and ignores visual formatting by design ([mammoth.js](https://github.com/mwilliamson/mammoth.js)). It runs in the browser from an array buffer.
- **Its own warning:** mammoth "performs no sanitisation" of the source, can produce `javascript:` links, can read external files if `externalFileAccess` is turned on, and can be slow on crafted files ([mammoth.js, security](https://github.com/mwilliamson/mammoth.js#security)). So:
  - it runs **in the import worker** (killable, §4.6), with `externalFileAccess` left off
  - its HTML goes through the same sanitiser and link filter as any HTML (§4.7)
  - its images (data URIs) go through the image pipeline
- **Bundle:** a lazy chunk loaded only when a `.docx` is in the import set; never in the editor chunk or the main bundle. Its size is measured in IM3 and recorded [unverified].
- **Comments:** off (mammoth's default); the report counts that Word comments weren't imported only if the file has `word/comments.xml`.
- **Why cut first:** Google Docs users have the official Markdown download, and Word users can save as HTML; IM3 is the only import PR that adds a dependency that parses untrusted binary files.

### 4.5 Large imports

- **Target:** 1,000 Markdown files of about 5 KB with 200 images import in **≤ 60 s on an M1 and ≤ 90 s on a mid-range Windows laptop**, with no renderer task over 50 ms and typing in an open document staying within the `perf` budget. Images dominate the time (decode, strip, re-encode); text alone is a few seconds.
- **Limits per import** (also the zip limits, §4.7): 10,000 entries, 2 GiB of source read on desktop and 500 MiB on the web, 5 MiB per text file (`.md`, `.html`, `.txt`), 50 MiB per `.docx`, 20 MiB per image (image store §2.2). Over a limit: the preflight refuses the whole import with the reason, or the file is skipped with its reason.
- **Memory:** files are read one at a time on request (§4.6). A zip file itself is capped at **1 GiB compressed** on desktop (500 MiB on the web) and held once as bytes, inflated per entry. Workspace-size Notion exports above that are split by Notion into `Part-N` zips, which import one at a time. If testers hit the cap, IM2's follow-up has `import.read` serve byte ranges into fflate's streaming `Unzip` instead of one transferred buffer. At most 4 documents are in flight between conversion and commit.
- **Commits** go in batches of 25 documents, one transaction each. The index updates once per batch, so the new folder's count grows without moving the sidebar (UX principle 4: the folder exists, collapsed, from the start).

### 4.6 Where it runs

**One engine, two hosts.** `lib/import/` is pure and shared by desktop and the web library (like `lib/platform/local-session.ts`). Only the source adapter and the commit target differ.

```text
            DESKTOP                                         WEB LIBRARY
 main: native dialog → path        ┐              ┌  <input type=file multiple webkitdirectory>,
 main: walk (lstat, no symlinks),  │  ImportSource │  drag and drop (FileSystemEntry)
       manifest {i, relPath, size} │     port      │  manifest from File objects
 main: import.read(job, i) → bytes ┘              └  file.arrayBuffer()
                    │                                         │
                    ▼                                         ▼
      ┌──────────── renderer (lazy import chunk) ─────────────────────────┐
      │ import worker (Web Worker, killable):                             │
      │   unzip (fflate, filter + limits), text decode, front matter,    │
      │   Markdown pre-pass + parse to JSON, .docx → HTML (mammoth)       │
      │ renderer thread, ≤ 8 ms slices (scheduler.yield):                 │
      │   HTML fragments → DOMPurify → schema parse (DOMParser is inert)  │
      │   images → prepareImageAsset → BlobStore.put                      │
      │   JSON → new Y.Doc → encodeStateAsUpdate                          │
      └───────────────────────────────────────────────────────────────────┘
                    │ import.commit(batch)                    │ IdbDocStore (W2)
                    ▼                                         ▼
 main validates → storage worker: import guard, one transaction per batch
```

- **Paths never come from the renderer** (architecture: "No path from the renderer, ever"). Main keeps the job's manifest; `import.read(jobId, index)` serves only entries in it, re-checks with `lstat` that each is still a regular file inside the chosen folder, and refuses after the job ends.
- **No zip library in main.** Main sends a zip's bytes as one transferred `ArrayBuffer`; the renderer's worker inflates it. This keeps K6 (no zip dependency in the signed main bundle) and lets the web library use the identical code (web library §6.1 already loads `fflate` lazily, about 12.5 KB gz in full, less for unzip only, [fflate](https://github.com/101arrowz/fflate)).
- **Why a worker plus the renderer thread.** `DOMParser` doesn't exist in Web Workers, and Tiptap's HTML parsing needs it. Markdown parsing and `.docx` conversion don't, so they run in the worker, where a stuck file can be killed (timeout 20 s per file → the worker is terminated and restarted, the file is reported "took too long to convert"). HTML parsing on the renderer thread is safe because a `DOMParser` document is inert (no script runs, nothing loads) and runs in ≤ 8 ms slices.
  - **To verify in IM1:** that `@tiptap/markdown`'s parser runs headless in a worker with the schema-only extension list. **Fallback:** parse Markdown on the renderer thread in slices too, with the 5 MiB cap per file.
  - **Raw HTML inside Markdown (v7).** The worker has no `DOMParser`, so it never parses HTML. When `@tiptap/markdown` meets a raw HTML token, the worker passes the token's text through to the renderer thread, which runs it through DOMPurify and the schema parse like any HTML fragment, and splices the result back in.
  - **Desktop alternative if long tasks appear:** a hidden, sandboxed `BrowserWindow` with no preload and `default-src 'none'` doing all conversion. Rejected for v1: an extra process, and the web can't share it.
- **The headless schema** is the module for Markdown export without an editor view ("the editor schema plus y-prosemirror, without a view", web library §6.1). **v7: P2.8 builds it** (desktop export needs it first); W7 reuses it. So IM1's desktop path no longer waits for W7. Import is its inverse and lives beside it. It never imports `components/document-editor/**`, and the import chunk is lazy: the editor chunk stays +0 B (checked).
- **Commit and the import guard.** `import.commit({ jobId, docs: [{ folderPath[], title, update, tags[], createdAt, modifiedAt, sourceHash, kind }] })` is validated in main (lengths, counts, `update` ≤ the import size cap) and written by the storage worker through P2.6's import guard (unknown node and mark names, size) and the migrations that run at import (legacy mark renames, editor-root sweep). Main assigns ids and lineages. The web library writes through `IdbDocStore` with the same guard functions.
- **Desktop CSP.** The import worker needs `worker-src 'self'` in the desktop CSP (S1 / P2.5 to confirm), and `blob:` only if the worker is built that way.

### 4.7 Security

Threat: a file someone was sent (a zip, a vault, a `.docx`) is hostile. Assets: the library, the bridge in the renderer, the user's disk, and the user's privacy. OWASP's file-upload guidance applies to imports as much as to servers: allowlisted types, content checks, size limits ([OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)).

| Threat | Control |
|---|---|
| **Zip bomb** | Entry count ≤ 10,000; total inflated ≤ 2 GiB desktop / 500 MiB web; per-entry caps by type (§4.5). Counted on **bytes actually inflated**, aborting mid-entry, never trusting declared sizes (fflate notes sizes "are sometimes not set", [fflate](https://github.com/101arrowz/fflate)). Ratio check: an entry over 1 MiB that inflates more than 200× is refused. Nested zips: only one level, and only Notion's `Export-…-Part-N.zip` pattern. |
| **Zip Slip / path traversal** ([Snyk research](https://github.com/snyk/zip-slip-vulnerability)) | **No entry name ever becomes a path on disk.** Names map to folder titles in the library only. Still: `\` becomes `/`; absolute paths, drive letters, `..` and `.` segments, NUL and control characters are dropped from the name; folder names then go through `filenames.ts` before backups mirror them. |
| **Symlinks and junctions** (folder import) | Main walks with `lstat` and never follows a link; re-checks at read time that the target is a regular file whose real path is inside the chosen folder. Walk depth ≤ 32. |
| **Huge or hostile images** | The image-store pipeline: magic-byte type check, no SVG, ≤ 20 MiB input, header-only dimension parse, ≤ 40 MP decode, ≤ 2 MiB / 2560 px stored, metadata stripped (image store §2.2–2.3). |
| **Malicious HTML** (HTML files, Notion HTML, raw HTML in Markdown, mammoth output) | DOMPurify with an allowlist profile (no `script`, `style`, `iframe`, `object`, `embed`, `form`, `svg`, `math`, event handlers or `style` attributes except `text-align`), then Tiptap's schema parse, which drops anything the schema doesn't know. Links: only `http`, `https`, `mailto`. Embeds: only hosts on the existing media allowlist (`content-security-policy.ts`); others become links. |
| **Tracking on import** | Remote images and embeds are never fetched during import. On desktop they need a click (plan §5.5). |
| **Crafted documents that hang the parser** | Markdown and `.docx` run in the killable worker with a 20 s per-file timeout (§4.6). |
| **YAML bombs** | The restricted front-matter parser (§4.2): no anchors, aliases or custom tags; 64 KiB cap on the block. |
| **Oversized documents** | The import guard's size cap; a converted document over it is skipped: "too large to import (14 MB; the limit is N MB)" (UX spec §5.4 copy). |
| **Unknown schema content** | The import guard rejects unknown node and mark names; the converter only emits schema names, so this is a second wall. |
| **Comments carrying hostile content** (`.tinydoc` from someone else) | The shared comments validator in the import guard (plan P4.11, P4.2f-2). |

---

## 5. States and copy, accessibility, tests

### 5.1 Import flow

1. **Choose:** File › Import… (⌥⌘O on macOS), drag onto the window or a folder (UX spec "Drop to import" overlay), Open With / the Dock icon (single files), or the web library's [Import…]. The desktop dialog allows files **and** folders (`openFile` + `openDirectory` on macOS; on Windows and Linux, File › Import Folder… is a second menu item, because their dialogs can't mix both).
2. **Preflight** (only for a folder, a zip, or more than 10 files): a scan, then a sheet.
3. **Import:** sticky pill with progress and Cancel.
4. **Result:** a pill, or a report sheet when anything was skipped or changed.

### 5.2 Every state, with copy

**Where:** as UX spec §5 (*Pill*, *Sheet*, *Banner*, *Page*). Web uses `components/ui` dialogs where desktop uses native sheets.

| State | Where | Copy | Actions |
|---|---|---|---|
| **Scanning** (> 400 ms) | Pill, sticky | Looking through "Vault"… | [Cancel] |
| **Preflight** | Sheet | **Import 340 files from "Vault"?**<br>They'll go into a new folder, "Vault". The original files aren't changed.<br>• 312 documents<br>• 28 images used by them<br>• 4 files will be skipped (PDF)<br>*(if any)* ☐ 12 of these were imported before. Import them again | [Cancel] **[Import]** |
| Preflight, Notion Markdown detected | Same sheet, one more line | Notion's HTML export keeps more formatting than its Markdown export. This one will still import. | (same) |
| **Importing** (> 400 ms, determinate) | Pill, sticky (UX spec §3.4) | Importing 37 of 340… | [Cancel] |
| **Done, nothing to report** | Pill | Imported 340 documents into "Vault". [Show] — one file: Imported "notes.md". The original file isn't changed. (UX spec §5.4) | [Show] |
| **Done with notes** | Sheet | **Imported 336 of 340 files into "Vault".**<br>Some things were changed to fit TinyDocy:<br>• 52 links between notes were kept as text, like [[Project]].<br>• 3 Word comments weren't imported.<br>• 9 properties other than title, tags and dates weren't imported.<br>• 2 tables from Notion were too large (more than 1,000 rows) and were skipped.<br>• Folders deeper than 4 levels were merged into their parent folder (12 documents).<br>Not imported:<br>• 4 PDF files: this file type isn't supported.<br>• huge.md: too large to import (14 MB; the limit is 5 MB). | [Copy Report] [Show Folder] **[OK]** |
| **Cancelled** | Sheet | **Import stopped.**<br>37 of 340 documents were imported into "Vault". | [Move Them to Trash] **[Keep Them]** |
| After Move Them to Trash | Pill | Moved "Vault" and 37 documents to Trash. [Undo] (UX spec §5.4) | [Undo] |
| **Already imported, single file** | Sheet | **"notes.md" was imported before**, as "Notes" on 12 Nov. | [Open It] [Import Again] |
| **Refused: too many files** | Sheet | **"Vault" is too large to import at once.** It has 14,200 files; TinyDocy imports up to 10,000 at a time. Import its folders one by one. | **[OK]** |
| **Refused: archive too large** | Sheet | **"Export.zip" is too large to import.** It unpacks to more than 2 GB. (web: 500 MB) | **[OK]** |
| **Refused: damaged or unsafe archive** | Sheet | **"Export.zip" can't be imported.** It's damaged, or it's built in a way TinyDocy doesn't open for safety. | **[OK]** |
| **Nothing to import** | Sheet | **Nothing in "Downloads" can be imported.** TinyDocy imports Markdown, Word, HTML, text and TinyDocy files. | **[OK]** |
| A file took too long | Report line | slow.docx: took too long to convert. | — |
| **Links between notes** (shared strings, v7; the search-linking design §8 uses these exact strings) | Report line | 52 links between notes were kept as text, like [[Project]]. | [Link Imported Notes] (LK5; shown when LK5 has shipped) |
| After Link Imported Notes | Sheet | **Linked 40 of 52 links between notes.** 12 point to notes that weren't imported. They stay as text. *(if any)* 4 links to blocks now point to their notes. *(if any)* Embedded notes became links. | **[OK]** |
| Unsupported type (single file) | Sheet (UX spec §5.4, wider list) | **"report.pages" wasn't imported.** This file type isn't supported. Use Markdown, Word, HTML, text or TinyDocy files. | **[OK]** |
| `.docx` turned off (IM3 cut) | Same, for `.docx` | **"report.docx" wasn't imported.** Word files can't be imported yet. In Word, save it as a web page (.html) and import that. | **[OK]** |
| Disk full during import | Banner (UX spec §5.1 disk full) + import stops | Import stopped: your disk is full. 37 documents were imported. | (as Cancelled) |
| Library read-only (`library_too_new`, degraded) | Sheet | **You can't import right now.** (then the banner's reason) | **[OK]** |
| Web: storage almost full during import | Banner (web library §9) + stop | Import stopped: this browser is almost out of space for TinyDocy. 37 documents were imported. | [Export all…] [OK] |

**Templates and onboarding states** are in §1–§3; collected here for test coverage:

| State | Where | Copy | Actions |
|---|---|---|---|
| First run | Sheet | §1.1 | [Explore the Playground] **[Start Writing]** |
| Reset Playground | Sheet (UX spec §5.3) | **Reset the Playground?** Your changes to it will be replaced with the original. | [Cancel] **[Reset]** |
| Practice copy (web) | Banner, `role="status"` | This is a practice copy. Changes here aren't saved. | [Keep a copy] |
| After Keep a copy | Pill | Saved a copy to My documents. [Open] | [Open] |
| What's new | Pill, 5 s | TinyDocy is updated to 1.4. | [What's New] |
| Save as Template | Sheet | §3.6 | [Cancel] **[Save Template]** |
| Saved template | Pill | Saved "Client call" as a template. | [Show] |
| Template chip | Chip + popover | Template · A template. Documents made from it don't change when you edit it. | — |
| Share on a template | Disabled button tooltip | Templates can't be shared. Create a document from it first. | — |
| Template from a newer TinyDocy | Picker row, disabled | (row note) Needs a newer TinyDocy | — |
| Picker, no match | Picker list | No templates match "retro". | — |

### 5.3 Accessibility

UX spec §8 applies throughout. Additions:
- **Picker:** the filter is a `combobox` controlling a `listbox` (`aria-activedescendant`, never moving DOM focus off the field, like Quick Open). Groups are `group` with a label ("Your templates", "Starters"). The preview is `aria-hidden` with the selected template's name and first headings as the option's `aria-describedby` text, so screen-reader users get the outline without the visual preview.
- **Shortcut sheet:** a `dialog` with a heading; groups are `h3` + `dl` (term = action, definition = keys). Keys get an `aria-label` in words ("Command Shift 7"; "Control Shift 7" off macOS). The filter announces the result count politely ("12 shortcuts").
- **Import progress:** the pill's text is the announcement; the bar is a `progressbar` with `aria-valuetext` "37 of 340". Announced at start, every 25 % and at the end, never per file.
- **Report sheet:** the list is real text, selectable; Copy Report puts it on the clipboard as plain text.
- **Hints:** polite announcements through `announce()`; never move focus; never time out while focus is inside the pill.
- **First-run sheet:** native sheet semantics; the storage text is the sheet's informative text, read by VoiceOver and Narrator with the title.
- **Teaching document:** real headings and lists, so the outline and screen-reader heading navigation work; every "Try it" line is a paragraph, never colour-only. The bundled image has alt text.
- **Contrast and forced colours** for every new surface, checked by axe in Playwright, light and dark.

### 5.4 Tests

| Layer | Test |
|---|---|
| **Unit: conversion goldens** (`tests/unit/import/`) | One fixture per source, small and hand-made (no real user data): an Obsidian vault (wikilinks with aliases, `![[img.png]]` in another folder, callout, `==hl==`, footnotes, front matter, nested tags, a `.obsidian/` folder), a Notion Markdown zip and HTML zip (id suffixes, nested `Part-1.zip`, CSV database, `<aside>`), a Google Docs `.md`, an Apple Notes export folder, a Bear `.textbundle` and `.textpack`, a `.docx` (headings, table, image, footnote, comment), `.txt`, HTML. Each asserts the ProseMirror JSON and the report counts. |
| **Unit: titles and names** | Front matter › H1 › filename order; no repeated title; Notion id stripping; folder depth merge; " (2)" collisions; hostile names (`../`, `C:\`, NUL, 300 characters). |
| **Unit: front matter parser** | Scalars, lists, comma strings, anchors and aliases refused, 64 KiB cap. |
| **Unit: zip limits** (fuzz + fixed) | A classic bomb (42.zip-style nesting), a single 10 GB-inflating entry with a false declared size, 20,000 tiny entries, traversal names, absolute names, a second nesting level, a truncated archive. Each fails with the right state and leaves no committed document. |
| **Unit: sanitiser corpus** | `<script>`, `onerror`, `javascript:` and `data:text/html` links, `<svg onload>`, `<iframe>` to a non-allowlisted host, CSS `url()`, mammoth `javascript:` hyperlinks. None survive; allowlisted embeds do. |
| **Unit: templates** | Variables in title and body, not in code; unknown `{{x}}` kept; locale formats; heading ids stripped; tags and width copied; comments never copied; Share refused for `kind = 'template'`. |
| **Unit: hints** | Once-only per id; rate limit; R=0 session-only; the `CHOICE_SLOTS` contract test covers `hints` and `recentTemplates`. |
| **Unit: shortcut sheet** | Every registry action with a shortcut appears; no duplicate combos across `APP_KEYMAP` and the registry; platform glyphs. |
| **Contract: import guard** | The same guard runs in the desktop worker and the web library; unknown nodes refused; size cap. |
| **Perf** | Synthetic 1,000-file vault with 200 images: the §4.5 targets; long-task observer finds no task over 50 ms; typing latency in an open document within the `perf` spec during import. Nightly, non-blocking at first (like the stress probe), blocking before Gate 5. |
| **e2e, desktop** (`_electron`, `local` project) | First-run sheet → Start Writing; Reset Playground; import a folder via a stubbed dialog, cancel half-way, Move Them to Trash, Undo; re-import skips duplicates; import the web library's backup zip; What's New pill with a faked version change; ⌘/ opens the sheet; Save as Template → New from Template → variables filled. **The Playground makes no network request** (request interception, P2.9b exit). |
| **e2e, web library** | Import a zip and a folder (`webkitdirectory`), duplicate skip, practice copy never writes IndexedDB and never sets the marker cookie, Keep a copy, templates round trip, the sheet on ⌘/. `chromium` and `webkit`. |
| **e2e, sandbox** | Regenerate unchanged; the placeholder reads "Type / for blocks"; the banner's `/download` link; `close-tab` hint never shows on the sandbox (it would be wrong there). |
| **Security review** | IM1 and IM2 get an SE review against §4.7, and the OWASP note in the PR. |

---

## 6. PRs

### 6.1 New PRs

Numbering avoids P1.x–P4.x, W1–W13, F1–F5, A0, A1, U1, S-A1/2 and the soak cases T1–T18. **Effort** is agent-days plus review rounds, as in the plan and the feature designs.

| # | PR | Lens | Depends on | Effort | Exit criteria |
|---|---|---|---|---|---|
| **OB1** | **Teaching Playground:** `playground-teaching.ts` (§1.3) with platform glyphs, the bundled image, Reset Playground rebuilding it, the desktop Playground using it, the sandbox unchanged. First-run sheet copy (§1.1). **Design review.** | UX | P2.4, P2.9b (bundled images, sheet), P2.6b (image store) | S: 1.5 d, 2 rounds | With the Playground open, no network request. Reset restores it exactly. Sandbox Regenerate e2e unchanged. Screenshots on three OSes. |
| **OB2** | **Hints and the shortcut sheet:** `lib/hints.ts` and the `hints` slot, the `close-tab` and `save-key` hints wired, `lib/app-keymap.ts` (shared with P2.9a's menus), the ⌘/ sheet (lazy) with Help menu and palette entries, the "Type / for blocks" placeholder. Web parts can ship before desktop. **Design review.** | UX + DE | P2.9a for the desktop menu entries (the web sheet doesn't wait) | M: 3 d, 2 rounds | Editor chunk ≤ +10 B gz (placeholder string only; its D23 ledger line). The registry-coverage test passes. ⌘/ works on chromium, webkit, firefox, and on desktop. |
| **OB3** (= test strategy **Q14**, one PR) | **What's new:** `last_seen_version`, the release manifest's `notes` flag, the pill, Help › What's New and About › Release notes from the desktop CHANGELOG section at build time. | DE | P3.3, P3.4, P2.9b | S: 1 d, 1 round | Fake upgrade shows one pill; patch, downgrade and first run show none; the page renders offline. |
| **OB4** (= test strategy **Q16**, one PR) | **The web path:** `PRIVATE_OPTIONS` in `site-config.ts` and its surfaces, the sandbox banner and `Public` chip links, the `/download` page, the storage-card line, the library's **Getting started** practice copy and its banner and Keep a copy. **Design review.** | UX + SE | W5, W6, P3.3 (download URLs), OB1 (content) | S–M: 3 d, 2 rounds (v8: +1 d counted in brand §6) | The practice copy writes nothing to IndexedDB and no cookie. `/download` is left out of the desktop export. SEO intro still server-renders (no hydration change). |
| **TM1** | **Templates:** `docs.kind` (desktop and W2), starters, Save as Template, New from Template menu and palette entries, the picker with preview, Manage Templates, variables, the Template chip, Share refusal, backups `Templates/`, Export all `kind`, `recent_templates`, the `template-vars` hint. Shared in `components/library/`. **Design review.** | UX + SE | P2.6 (with the v7 schema amendment), P2.7b, P2.8 (headless schema module), OB2 (hint) | M: 4 d, 2–3 rounds | The §5.4 template tests; keyboard-only flow; a template never appears in Recent, Quick Open or Tags; a Live share of a template is refused by `ShareService`. |
| **IM1** | **Import engine:** `lib/import/` (source port, manifest, preflight, Markdown pre-pass for footnotes and highlights, front matter, titles, tags, dates, wikilinks kept as text with relative paths recorded, callouts, `.txt`, raw HTML tokens handed to the renderer's sanitiser, images through the pipeline, JSON → Y.Doc), the import worker, desktop `import.pick` / `import.read` / `import.commit` IPC with guards, `import_sources` (relative path, source app, hash) and duplicate skip, progress, cancel, the report sheet, every §5.2 state. Extends P2.8 (single files) rather than replacing it. **Design review.** | SE + DE + UX | P2.6 (+ amendment), P2.6c, P2.7a, P2.8 (headless schema). **Not W7** on the desktop path (v7). Gate 3. | L: 6 d, 3 rounds | Golden fixtures pass; perf targets met on M1 and Windows; cancel leaves only committed documents; the security corpus is clean; editor chunk +0 B. |
| **IM2** | **Archives, folders and app conventions:** fflate unzip with limits in the worker, desktop folder walk in main (`lstat`, skips), Obsidian attachment resolution, the TinyDocy backup zip (shared archive module with W7), folder-depth merge (**Gate 3**). Then Notion zips (ids, nested parts, CSV → table, page-and-folder shape), TextBundle and `.textpack`, and the HTML file source through the sanitiser (**Gate 5**, v7 split). | SE + DE | IM1, W7 (archive module) | M: 4 d, 2 rounds | Zip fuzz and Zip Slip cases pass; a 1,000-file vault imports within target; a library backup zip restores folders, tags and pins on desktop. |
| **IM3** | **Word `.docx`** through mammoth in the worker, its sanitiser path, comments counting, the lazy chunk and its measured size. **Cut first.** | SE + DE | IM1 | S–M: 2.5 d, 2 rounds | The `.docx` fixture passes; `externalFileAccess` stays off (test); a crafted slow file is killed at 20 s. |
| **IM4** | **Web library adoption:** the same engine in the library's Import (`webkitdirectory`, drag and drop of folders, web limits), templates and import in W5's UI, the web Help pages. **Design review** (web screenshots at 1440, 820 and 375 px). | DE + UX | IM1, IM2, W5, W7 | S: 1.5 d, 1–2 rounds | The web e2e cases in §5.4 pass on `chromium` and `webkit`. |

**Totals:** about **25.5 agent-days** in 9 PRs, **6 design reviews** (OB1, OB2, OB4, TM1, IM1, IM4), and **2 SE security reviews** (IM1, IM2).

### 6.2 Order

1. **OB2's web half** can ship any time (the sheet and placeholder help the sandbox now).
2. **IM1** after P2.8 (which now builds the headless schema module); **IM2** after IM1; **IM3** last.
3. **TM1** after P2.7b; **OB1** with P2.9b; **OB3** after P3.3; **OB4** and **IM4** after W5–W7.

IM1 and IM2's Gate 3 sources sit on the Local milestone's path (Gate 2/3: the 10 testers will bring their notes). TM1, OB3, OB4, IM3, IM4 and IM2's Gate 5 sources (HTML, Notion, TextBundle) are Gate 5 work.

### 6.3 Cut order (adds to the plan's tripwire, §8.2)

**v7:** the plan's D30 order wins across designs (LK3, **IM3**, the L2 sweep, LK4, **TM1**, backlinks, links). The list below orders the cuts inside this document.

If Gate 2 slips, cut in this order:
1. **IM3** (`.docx`): the copy points Word users to HTML.
2. **Notion CSV → table** (CSVs are then listed as skipped).
3. **OB3** (What's new): Help › What's New stays, without the pill.
4. **TM1's picker preview** (the list stays).
5. **TM1** entirely, after HTML import in the plan's list (owner Q1).

Never cut: the §4.7 security controls, duplicate detection's skip on re-import (without it, re-running an Obsidian import doubles a library), the first-run storage disclosure.

---

## 7. Owner questions

**All three answered in plan v7 as recommended:** Q1 by D27, Q2 by D28, Q3 by D29. The table is kept as the record.

| # | Question | Options | Recommendation | Blocks |
|---|---|---|---|---|
| **Q1** | **Templates in v1?** | (a) Yes, the small version in §3 (4 d). (b) Later; Duplicate covers it. | **(a).** D0's audience repeats the same few documents (meetings, journals, weekly plans). It is 4 agent-days, adds no server, editor or schema-of-content work, and sits in the cut order after HTML import. | TM1 |
| **Q2** | **Word `.docx` import in v1?** | (a) Yes, through mammoth.js in the import worker, first to cut. (b) Later; Google Docs and Word users export Markdown or HTML. | **(a), first to cut.** People moving private documents off Word are squarely D0, and Google's Markdown download doesn't help them. It is the only import PR that adds a parser for untrusted binary files, so it runs killable, sanitised and lazy (§4.4). | IM3 |
| **Q3** | **The web library teaches with a practice copy** instead of linking to the public Playground (amends web library §5.1 and §9) | (a) "Getting started" opens an unsaved practice copy in the library (§1.4). (b) Keep the link to the public sandbox. | **(a).** Sending privacy-minded visitors to a public page to learn invites the mistake the `Public` chip exists to prevent (WK7). Nothing is stored, so the library still starts empty. | OB4 |

---

## 8. Amendments to other documents (one docs-only PR before OB1, TM1 and IM1)

| Document | Change |
|---|---|
| UX spec §5.1 | First-run sheet copy (§1.1): "a readable copy of each document you change"; the two added lines; button order. |
| UX spec §5.2 | Empty-library sentence; the template empty states (§2.5). |
| UX spec §5.3 | The Template chip row. Reset Playground copy says "the original". |
| UX spec §5.4 | Import copy: the wider format list, the preflight, cancelled and report states (§5.2). |
| UX spec §2.4 / §4.6 | File › New from Template ▸, File › Import Folder… (Windows, Linux), Help › What's New, Document › Save as Template…; ⌘/ Keyboard Shortcuts in the keymap. |
| Plan §5.3 | Import formats: add folders, zips, `.txt`, `.docx` (Q2), Notion, TextBundle, library backup zips. *(Done in plan v7, split by gate.)* |
| Plan §8.2 tripwire | The §6.3 cut order. *(Superseded by D30 in plan v7.)* |
| Plan §8.4b | Add OB1–OB4, TM1, IM1–IM4. *(Done in plan v7.)* |
| Plan P2.8 | Builds the headless schema module (v7). |
| Plan P2.6 / architecture D-A5 | `docs.kind` and `import_sources` in the first schema. *(Done in plan v7, with `docs.link_key`; the `import_sources` columns await confirmation, §4.3.)* |
| Web library W2 §2.2 | `kind` on `docs`; an `import_sources` store. |
| Web library §6.1 | `library.json` entries gain `kind` (`doc` or `template`); the shared archive module reads and writes it. |
| Web library §5.1 and §9 | "Getting started" practice copy replaces the Playground link (if Q3 = a). |
| Preferences §2.2 | Remembered state: `hints`, `recentTemplates` (`tinydocy-ui`, both platforms); `last_seen_version`, `first_run_done` (desktop `meta`, because main reads them before any window exists). |
| Image store §5.5 | Imports include folder and zip sources; unreferenced attachments are never stored. |

---

## Sources

**Onboarding and help**
- Nielsen Norman Group, "Onboarding Tutorials vs. Contextual Help": https://www.nngroup.com/articles/onboarding-tutorials/
- Secondary write-up of NN/g's 2020 mobile tutorial study (70 participants): https://dataanddesign.substack.com/p/mobile-onboarding-looks-nice-but [secondary]
- Apple Human Interface Guidelines, Onboarding: https://developer.apple.com/design/human-interface-guidelines/onboarding
- Visual Studio Code 1.75 release notes (opting out of release notes after updates): https://code.visualstudio.com/updates/v1_75

**Templates**
- Obsidian Help, Templates (`{{title}}`, `{{date}}`, `{{time}}`, formats, template folder): https://obsidian.md/help/plugins/templates
- TinyDocy user-request research #21 and #6: `docs/research/2026-11-15-editor-user-requests.md`

**Import sources**
- Notion Help, Export your content (Markdown & CSV, subpage folders, callouts as HTML): https://www.notion.com/help/export-your-content
- Obsidian Help, Import from Notion (HTML export recommended, nested Part zips): https://obsidian.md/help/import/notion
- Obsidian forum, Notion migration (32-character ids in names): https://forum.obsidian.md/t/notion-2-obsidian-migration-instructions/2728 [community]
- Obsidian Importer (formats it covers): https://github.com/obsidianmd/obsidian-importer
- Obsidian blog, Apple Notes import (reads the local database): https://obsidian.md/blog/apple-notes-export/
- Obsidian Help, Import from Bear (`.bear2bk`): https://obsidian.md/help/import/bear
- Bear FAQ, export formats: https://bear.app/faq/export-your-notes/
- MacRumors, Markdown import and export in Apple Notes (iOS 26, macOS 26): https://www.macrumors.com/how-to/ios-import-export-markdown-apple-notes/
- Google Docs Help, Use Markdown (File › Download › Markdown): https://support.google.com/docs/answer/12014036
- Google Workspace Updates, Markdown import and export (July 2024): https://workspaceupdates.googleblog.com/2024/07/import-and-export-markdown-in-google-docs.html
- TextBundle specification: http://textbundle.org/

**Libraries**
- mammoth.js (features, security notes, browser use): https://github.com/mwilliamson/mammoth.js
- fflate (filtered and streaming unzip, workers, sizes): https://github.com/101arrowz/fflate
- Tiptap Markdown (GFM tables and task lists, one node per table cell): https://tiptap.dev/docs/editor/markdown

**Security**
- Snyk, Zip Slip: https://github.com/snyk/zip-slip-vulnerability
- OWASP File Upload Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html
