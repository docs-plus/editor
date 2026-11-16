# TinyDocy preferences: app and page settings for desktop and web

> **Owner answers (2026-11-16)**, which override the defaults and open questions below:
> - **D19:** the default text size is 16 px.
> - **D20:** ship the smart-quotes switch.
> - **D21:** add Atkinson Hyperlegible Next and Letter spacing.
> - **D22:** contrast and motion overrides on **both** platforms. Desktop Settings › General also gets Contrast (System / Increased) and Motion (System / Reduce / Full). The OS stays the default.
>
> **Plan v7 (2026-11-16):**
> - **D23:** the smart-quotes gate is one 150 B gz line in the editor-chunk ledger (details §1 rule 5), which replaces the 600 B allowance.
> - **Update channel (staff integration review):** row 23's default is computed, never stored: Beta for prerelease builds, Stable otherwise. The default `prefs` JSON (§5.2) no longer writes `"channel"`.
> - **D26:** row 26 Language (from the languages design) is added, hidden until L1b in v1.1.
>
> **Plan v8 (2026-11-16):**
> - **D40:** the roadmap's S11 seam (a `scope` field per row in `lib/prefs/schema.ts`) is **dropped from code**. Instead this document keeps a doc-only "Syncs" column (§2.4), which a later device sync (D37) reads when it is designed.
> - **D36 / phones review:** iOS Smart Punctuation curls quotes and dashes at the keyboard and **ignores the D20 smart-quotes switch** (§5.10).


- **Status:** Design for owner review (2026-11-16). Nothing is built. This document edits no other file; §3 lists the amendments other docs need.
- **Decides:** every user preference in the combined v1 (desktop app, web library, public sandbox): what it is, its default, its scope, where it appears, where it is stored, how it is applied before first paint, and which PR owns it.
- **Wins over** (for preferences only): UX spec §7 and §8.4, Details spec §4, the title-tags-page-preferences research §3 and §5.4, and the three 2026-11-16 research docs where they disagree with this one. §3 lists each conflict and its resolution.
- **Built from:**
  - [Preferences prior art](../../research/2026-11-16-preferences-prior-art.md): ranked top 25, things to avoid, structure patterns
  - [Preferences inventory](../../research/2026-11-16-preferences-inventory.md): what the code does today, 33 promised preferences, 17 conflicts, 18 hidden behaviours, constraints
  - [Accessibility and reading preferences](../../research/2026-11-16-accessibility-reading-preferences.md): measured characters per line, em widths, the rem text-size ladder, spacing, OS settings, presets, the contrast bug
  - [Plan v7](2026-11-15-desktop-local-first-design.md) §13 owner decisions D0, D3, D6, D10
  - [Details spec](2026-11-15-desktop-documents-and-editor-details.md) §1 rules and §4
  - [Desktop UX spec](2026-11-15-desktop-ux-design.md) §2, §4, §7, §8
  - [Web library design](2026-11-16-web-library-design.md) (IndexedDB `doc_view`, the separate library origin)
  - `AGENTS.md` (hydration, `tinydocy-ui` slots, `NEXT_PUBLIC_REMEMBER_CHOICES`, the editor-chunk budget, no shell subscriptions)
- **Code facts re-checked for this design (2026-11-16, `main` at `e93169d`):**
  - `html` and `body` set no font size, so the editor inherits the browser's 16 px. Only `p:not(:first-child):not(td p):not(th p)` is 15 px (`paragraph-node.scss:39-44`). Table cells, the first paragraph of a list item and the first paragraph of a blockquote render at **16 px today**.
  - HeadingScale writes `--hd-size` in **pt** (`heading-scale.ts:41-42,101`, 20 pt → 12 pt). The fallbacks in `heading-node.scss` are pt as well.
  - The docked outline is 270 px wide (`toc-sidebar.scss:7`). It docks at a viewport of 950 px (`use-outline-open.ts:17`), which is the 648 px card, plus 270, plus a 32 px gutter.
  - The toolbar stepper is already labelled **"Font size"** (`font-size-stepper.tsx:85,91`).
  - Typography (smart quotes, dashes and arrows) is **always on** (`document-editor-config.ts:26,228`). The prior-art doc's "off matches today" is wrong.
  - Only `a span` gets an underline in the document (`paragraph-node.scss:85-87`).
  - Dark `--primary` is `#973c00`. Measured as text it is **2.78:1** on `--background`, 2.51:1 on card, popover and sidebar, and 2.12:1 on muted. It is used as text by `button` and `badge` `link` variants and by `heading-filter.tsx:116`.
  - `lib/user-identity.ts` has no try/catch, no length cap and no colour allowlist.

---

## 0. Summary

| | |
|---|---|
| **Preferences in v1** | **25** with a control (§2.1). 14 apply on both platforms, 6 on desktop only, 3 on the web only, and 2 on desktop plus the web library (per-document width, backups). 6 of them are already shipped on the web (theme, simplified toolbar, outline, identity, analytics consent, and the Continue chip as an operator flag). |
| **Not preferences** | 9 kinds of remembered view state, never shown in Settings (§2.2) |
| **Dropped** | 26 candidates, each with a reason (§2.3) |
| **Settings surfaces** | **Desktop:** a Settings window (General · Page · Writing · Storage · Updates · About). **Web:** a Settings dialog with the same panes where they apply. **Both:** a Page popover from ⋯, palette entries for every setting, and no settings search. |
| **Storage** | **Desktop:** one `meta('prefs')` row in main's SQLite, plus `doc_view`. **Web:** `tinydocy-theme`, new `tinydocy-ui` slots, `sessionStorage` for per-tab state, and `doc_view` in the library's IndexedDB. Never the Y.Doc. |
| **First paint** | One boot script sets `<html>` attributes. CSS maps them to variables. Desktop allows the script by its CSP hash and feeds it main's snapshot through the preload. |
| **Existing users** | Nothing they see changes until they choose. Browsers that used TinyDocy before keep **today's exact look** (internal state `classic`) and their explicit Light theme. New browsers and the desktop app get the new defaults. Two accessibility fixes are the only exceptions (§5.11, §5.12). |
| **Editor chunk** | **Not +0 overall.** Page, appearance, spellcheck and reading mode add +0 B. The smart-quotes switch adds **≤ 150 B gz** for one input-rule gate, paid from the existing budget headroom. Q2 asks whether to accept that, or keep Typography always on in v1 and hold +0. |
| **Owner questions** | 4 (§6) |

---

## 1. Principles

1. **The defaults are the product.** Fewer than 5 % of people change a setting (Spool). Every default must be right for someone who never opens Settings. A setting must answer a real complaint and must never stand in for a bug fix.
2. **A short list.** 25 settings across five panes, with no settings search. Every setting has a palette entry instead. A new setting must replace one, or arrive with evidence.
3. **Per viewer, never in the shared document.** No preference is ever written to the Y.Doc (Details §1 rule 6). Only the title, content and comments are shared. A collaborator never sees my width, font or text size.
4. **Follow the OS.** Theme, contrast, reduced motion, the caret, the macOS spelling language, the accent colour and the browser's default font size come from the OS or the browser.
   - On desktop we never duplicate an OS setting.
   - On the web, where people are often on shared, locked or school machines, the two that matter for comfort (contrast and motion) get **System / Always**. That only adds to the OS and never fights it.
5. **Say the scope** in every control's hint, with one of five fixed phrases:

   | Scope | Desktop wording | Web wording |
   |---|---|---|
   | App-wide | "For all documents on this computer." | "For all documents in this browser." |
   | One document | "For this document, on this computer. Others see their own width." | "For this document, in this browser. Others see their own width." |
   | Window or tab | "For this window only." | "For this tab only." |
   | Interface | "For TinyDocy on this computer." | (n/a) |
   | Not saved (kill switch) | (n/a) | "This site doesn't save settings. They reset when you reload." |
6. **Instant apply, live preview.** There is no OK or Apply button. Open documents change as you click, in every window.
7. **Presets over knobs, knobs never hidden.** Four named page styles set five knobs, and every knob stays reachable. Separate numeric line-height, gap or indent sliders are never offered.
8. **Nothing changes on its own.** Width, size and font change only when you choose them. The outline only switches between docked and overlay as the window narrows, as it does today.
9. **No visible change on upgrade.** Existing web visitors keep today's look until they pick something (§5.6).
10. **Cheap to apply.** Settings apply through CSS variables and `<html>` attributes, never by rebuilding editor plugins. No React subscription is added to the editor shell.

---

## 2. The preferences

### 2.1 The complete list

**How to read the table**
- **Scope:** **D** = app-wide, per device (per browser origin on the web). **Doc** = per document, per viewer, per device. **Win** = per window or tab, not kept after it closes.
- **Platform:** **B** = both, **Dk** = desktop, **Web** = web (sandbox and library unless marked).
- **Where:** **S** = Settings (pane), **P** = Page popover, **V** = View menu (desktop), **⋯** = the web ⋯ menu, **K** = command palette.
- **Desktop storage:**
  - `prefs.x` = a field in the `meta('prefs')` JSON row owned by main
  - `doc_view` = the SQLite table
  - `win` = main's window state
- **Web storage:**
  - `ui.x` = a `tinydocy-ui` slot
  - `theme` = `tinydocy-theme`
  - `ss` = `sessionStorage` `tinydocy-window`
  - `idb` = the library's IndexedDB `doc_view`
- **Applied:**
  - **boot** = an attribute on `<html>` set by the boot script before first paint, mapped by CSS
  - **main** = applied by Electron's main process
  - **frame** = an attribute on the document's page container
  - **gate** = a runtime check
- **R=0:** behaviour under `NEXT_PUBLIC_REMEMBER_CHOICES=0` (web only).
  - **ses** = applies for the page session, isn't saved, and shows the "not saved" hint
  - **unaff** = unaffected (stored as usual)
  - **off** = forced off
  - **—** = not applicable on the web
- **PR:** the owning PR. When several PRs share a setting, each one's part is named.

**Groups:** A = Appearance and accessibility, B = Page (how documents look to me), C = Writing, D = Opening, files and updates, E = Privacy and identity.

| # | Grp | Id | Label | Control | Values → **default** | Scope | Plat | Where | Desktop storage | Web storage | Applied | R=0 | PR |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | A | `appearance` | Appearance | RadioGroup | **System** · Light · Dark | D | B | S General, row button (flips Light/Dark), ⋯, K | `prefs.appearance` (main sets `nativeTheme.themeSource` and the window `backgroundColor`) | `theme`: `"system"` \| `"light"` \| `"dark"` | boot: `.dark` class + `theme-color` meta; a `matchMedia` listener while System | unaff (as today) | F3 (web), P2.9b (desktop) |
| 2 | A | `zoom` | Interface zoom | Select | 75 · 80 · 90 · **100** · 110 · 125 · 150 · 175 · 200 % | D | Dk | S General, K | `prefs.zoom` | — | main: `webContents.setZoomFactor` per window | — | P2.9b |
| 3 | A | `contrast` | Increase contrast | RadioGroup | **System** · Always | D | Web | S General, K | — (desktop follows the OS) | `ui.a11y.contrast` | boot: `data-contrast="more"`. The same token set also turns on under `@media (prefers-contrast: more) and (forced-colors: none)` on both platforms. | ses | P2.9c-1 |
| 4 | A | `motion` | Reduce motion | RadioGroup | **System** · Always | D | Web | S General, K | — (desktop follows the OS) | `ui.a11y.motion` | boot: `data-motion="reduce"`. Every reduced-motion rule also matches `@media (prefers-reduced-motion: reduce)`. | ses | P2.9c-1 |
| 5 | B | `page.style` | Style | RadioGroup with a preview | **Default** · Comfortable reading · Compact · High legibility. Shows "Custom" when a knob differs. | D | B | P, S Page, K | `prefs.page.style` | `ui.page.style` | boot: `data-page-style` | ses (fallback `classic`) | P2.9c-2 (UI), P2.9c-1 (engine) |
| 6 | B | `page.size` | Text size | Stepper A− / A+ with the value in px | 14 · **16** · 18 · 20 · 24 · 28 · 32 px, stored as 0.875–2 rem (Q1) | D | B | P, S Page, V Text Size, ⌘+ / ⌘− / ⌘0 (desktop only), K | `prefs.page.size` (only if it differs from the style) | `ui.page.size` | boot: `data-text-size` → `--page-size` | ses | P2.9c-1 |
| 7 | B | `page.width` | Width (default) | Segmented (radiogroup) | Narrow 30 em · **Standard 33 em** · Wide 46 em · Full (text kept to 46 em) | D | B | S Page, K. In the sandbox, also P. | `prefs.page.width` | `ui.page.width` | boot: `data-page-width` → `--page-measure` | ses | P2.9c-1 |
| 8 | B | `doc.width` | Width (this document) | Segmented in P, plus "Use for all documents" and "Reset" | the same four, or inherit → **inherit** | Doc | Dk + web library | P, V Page Width, K | `doc_view.width` | `idb` `doc_view` | frame: `data-doc-width` on the page container, read in `local-session.open` before mount | — (library only) | P2.9c-2 (desktop), W5 (web library) |
| 9 | B | `page.font` | Font | Select | **Default** (Arial) · Sans (Inter) · Serif (Source Serif 4) · Mono (JetBrains Mono) · Legible (Atkinson Hyperlegible Next, Q3) | D | B | P (under Adjust), S Page, V Font, K | `prefs.page.font` | `ui.page.font` | boot: `data-page-font` → `--page-font`. The font file loads only when used. | ses | P2.9c-2 |
| 10 | B | `page.spacing` | Spacing | Segmented | Compact · **Normal** · Relaxed (§5.4) | D | B | P (under Adjust), S Page, K | `prefs.page.spacing` | `ui.page.spacing` | boot: `data-spacing` → `--page-leading`, `--page-gap`, `--page-list-gap`, `--page-heading-leading` | ses | P2.9c-1 |
| 11 | B | `page.letters` | Letter spacing | Segmented | **Normal** · Wide · Wider (Wider = WCAG 1.4.12: 0.12 em letters, 0.16 em words) (Q3) | D | B | P (under Adjust), S Page, K | `prefs.page.letters` | `ui.page.letters` | boot: `data-letters` → `--page-letter`, `--page-word` | ses | P2.9c-2 |
| 12 | B | `outline` | Show the outline | Switch | **On** · Off. Docked when there's room, otherwise an overlay that starts closed. | D | B | P, S Page, V, row/⋯ toggle, K | `prefs.outline` | `ui.outlineOpen` (exists) | React (`use-outline-open`), docking computed per §5.9 | ses (today: always opens) | exists; P2.9c-1 (breakpoint) |
| 13 | B | `readingMode` | Reading mode | Switch / menu check | **Off** · On | Win | B | P, V (⌥⌘R), ⋯, K | not stored | not stored | gate: `WriteGate` `canWrite()` plus `data-reading` on the frame | n/a | P2.9c-1 |
| 14 | C | `spellcheck` | Check spelling while typing | Switch | **On** · Off | D | B | S Writing, Edit › Spelling (desktop), K | `prefs.spellcheck` | `ui.spellcheck` | boot: when Off, `<html spellcheck="false">`, which every editable element inherits. On desktop, main also calls `session.setSpellCheckerEnabled`. | ses | P2.9c-1 (shared); P2.9a (menu, context menu); P2.9b (Settings window) |
| 15 | C | `spellLanguages` | Spelling languages | Listbox, up to 3 | **The system language** if a dictionary is bundled | D | Dk (Windows, Linux) | S Writing | `prefs.spellLanguages` | — | main: `setSpellCheckerLanguages`, bundled dictionaries only, no download | — | P2.9b |
| 16 | C | `smartQuotes` | Smart quotes and dashes | Switch | **On** (today) · Off. Never inside code blocks or inline code. (Q2) | D | B | S Writing, K | `prefs.smartQuotes` | `ui.smartQuotes` | boot: `data-smart-quotes="off"`, read by the Typography gate (§5.10) | ses | P2.9c-1 |
| 17 | C | `simpleToolbar` | Simplified toolbar | Switch | **Off** · On | D | B | S Writing, ⋯, V, K | `prefs.simpleToolbar` | `ui.toolbarDensity` (exists) | CSS `data-toolbar-density` (exists) | ses (today: disabled with a reason) | exists; P2.9c-1 moves it to the shared store |
| 18 | C | `rememberPlace` | Remember my place in each document | Switch | **On** · Off. Off deletes the stored places. | D | B | S Writing, K | `prefs.rememberPlace` (desktop also restores the caret) | `ui.rememberPlace`, which gates `tinydocy-continue` | gate in `lib/continue-position.ts` | **off** (as today) | P2.9c-1 |
| 19 | D | `startup` | When TinyDocy opens | Select | **Reopen my windows** · Show Recent · New document. macOS also respects the system's "Close windows when quitting". | D | Dk | S General | `prefs.startup` | — | main | — | P2.9b |
| 20 | D | `dockRecent` | Show recent documents in the Dock / in the Jump List | Switch | **On** · Off | D | Dk | S General | `prefs.dockRecent` | — | main (`app.dock.setMenu`, `setJumpList`) | — | P2.9b |
| 21 | D | `backupFolder` | Backups | Path + [Show] [Change…] [Back up now] + status | **`~/TinyDocy Backups`**. Web library: none until chosen. | D | Dk + web library (Chromium only, W8) | S Storage | `prefs.backupFolder` | `idb` `meta.backup_folder` (W8) | main; web: W8's writer | — | P2.9b; W8 (web) |
| 22 | D | `updates.auto` | Download and install updates automatically | Switch | **On** · Off | D | Dk | S Updates | `prefs.updates.auto` | — | main | — | P3.3 |
| 23 | D | `updates.channel` | Channel | RadioGroup | **Computed, never stored:** **Beta** for a build with a prerelease suffix (`-beta.N`), **Stable** for a plain version · the user's own choice, once made, is stored and wins (plan v7, test strategy §4.1) | D | Dk | S Updates | `prefs.updates.channel` (only after the user chooses) | — | main | — | P3.3 |
| 24 | E | `usageStats` | Share anonymous usage statistics | Switch (disabled when GPC or DNT is on) | **Off** until you turn it on | D | Web, **sandbox origin only** (the library and desktop collect nothing, so they get a statement, not a switch) | S Privacy, the consent banner, `/privacy` | — | `tinydocy-analytics-consent` (exists) | GA loads or doesn't (exists) | unaff | W13 |
| 25 | E | `identity` | Your name and colour | Text field + 8 colour swatches (radiogroup) | A random "Adjective Animal" and a random caret colour | D | B, wherever collaboration exists: the sandbox now, sharing in Live (W10, P4.4) | S General, the status card's "Edit identity" (web) | `meta('identity')` (P4.0; renderer `localStorage` until then, per D-A8) | `tinydocy-user` (exists, validated per §5.12) | awareness | unaff | F2 (fix); P4.0 (desktop move); W13 (Settings row) |
| 26 | A | `language` | Language | Select, each language in its own name | **System** · each shipped language | D | B | S General, K | `prefs.language` | `ui.language` | boot: `<html lang dir>` and the `core` catalog preload; applies on reload | ses | L1b (engine, v1.1), L6 (rows) |

**Row 26 (v7, from the [languages design](2026-11-16-languages-rtl-design.md) §6.1):** **hidden until L1b ships in v1.1** (D26: English interface in v1). With English only, the row isn't shown; the pseudo-locales add it in dev and CI.

**Counted:** 25 rows in v1 (row 26 is hidden until v1.1). Desktop has 22 (all but 3, 4 and 24). The web sandbox has 17 (no 2, 8, 15, 19–23). The web library has 18 (adds 8, drops 24).

### 2.2 Remembered state that is not a setting

These are kept so the app behaves as you left it. They never appear in Settings. Forget never clears them, except where marked.

| State | Scope | Desktop | Web | Owner |
|---|---|---|---|---|
| Remembered formatting choices (colours, list type, table size, palette recents and more: 10 slots) | D | renderer `tinydocy-choices` | `tinydocy-choices` | exists. **Forget clears it.** |
| Your formats (M14) | D | `tinydocy-formats` | same | exists |
| Folded sections | Doc | `tinydocy-folds-<id>` | same | exists (cap and expiry: F4, optional) |
| Continue position (M15) | Doc | `doc_view.place` (P2.9c) | `tinydocy-continue` | exists; gated by `rememberPlace` |
| Hide comments | Win | `win` | `ss` | P4.10 (not `tinydocy-ui`, see C14) |
| Window bounds, sidebar width, tabs, history head | Win | `win` | — (the web has `activeTabId`) | P2.9a |
| Folder sort, view, group | per folder | `folders.*` | `idb` `folders` | P2.7b; W2 |
| Last Settings pane | D | `prefs.settingsPane` | `ui.settingsPane` | P2.9b; W13 |
| "Load remote images" for one document | Doc | `doc_view.remoteImages` | — | P2.9b. Not a setting, on purpose (UX §7). |

### 2.3 Considered and left out

| Candidate | Decision | Why |
|---|---|---|
| Paper theme | **Later** | Weak evidence. It needs its own palettes for the 10 highlight and 10 text colours, which means 40 more contrast pairs to test. Prior art: one well-tuned light and dark pair is enough. |
| Softer dark document surface (`#161616` / `#e2e2e2`) | **Not a preference.** A separate visual change with its own design review. | It would change dark mode for existing users. |
| Focus mode (dim other blocks) | **Later** | No outcome evidence. When built, it is a View command, not a stored setting, and dims to at least 3:1. |
| Typewriter scrolling | **Later** | No outcome evidence. An eager scroll plugin fights `scroll-padding` and the `.is-caret-block` rule (AGENTS). |
| Format as you type (Markdown shortcuts, automatic lists) | **Later, no switch in v1** | No TinyDocy complaint. Backspace right after a conversion already undoes it (Tiptap core `undoInputRule`); Help says so. If it is ever needed, the §5.10 gate makes it about 100 B. |
| Interface text size (100 / 115 / 130 %) | **Dropped** | It duplicates interface zoom on desktop and browser zoom on the web. |
| Focus-ring strength (Standard / Strong) | **Folded into Increase contrast** | One fewer control. Increase contrast gives a 3 px ring with a 2 px offset. |
| Underline links | **Not a setting: always underlined** in documents | WCAG 1.4.1 is an accessibility fix (§5.12), not a preference. |
| "Other installed font…" (desktop) | **Dropped** | An any-font picker is a prior-art "avoid" (untested metrics, Linux differences). Legible covers the need. |
| OpenDyslexic | **Dropped** | Evidence against it (Wery & Diliberto 2017). |
| Separate line-height, paragraph-gap and indent sliders | **Dropped** | They produce broken combinations. Spacing is one preset control. |
| Justified text shown left-aligned; "Use document text colours" | **Later** | Real, but beyond the slot budget. Both are reader-side CSS and can be added without migration. |
| Thick custom caret, line focus | **Dropped** | High risk with ProseMirror and IME, no evidence |
| Custom CSS, themes, accent-colour picker | **Dropped** | Each one multiplies the test matrix. Desktop follows the OS accent automatically, clamped to 3:1 (UX §2.2), with no control. |
| Desktop overrides for contrast and motion | **Dropped** (Q4) | Apple HIG: don't duplicate system settings |
| Confirm on delete, Trash retention | **Dropped** | Trash plus Undo, and a fixed 30 days. Storage *shows* the Trash. |
| Default location for new documents | **Not a setting.** A fixed rule (P2.7a): the folder that has focus in the sidebar or list, else the Library root. | No demand found. The pill offers Move to… |
| "Show the outline: Always as overlay / Never" | **Dropped**: On / Off | A three-way control for a rare need. Presentation already follows the width. |
| Word count as a setting | **Not a setting.** A command and popover (P2.12). | |
| Load remote images always | **Not a setting** (UX §7) | One switch away from silent tracking |
| Shortcut remapping, Vim keys | **Dropped** | Read-only shortcut sheet only |
| Settings file, import/export, sync | **Dropped in v1** | Desktop, sandbox and library are separate devices or origins. Revisit with accounts. |
| Language, date format, first day of week | **Later** | Nothing to switch until the UI is translated |
| Auto-pair brackets, Markdown syntax style, default first block | **Dropped** | Code-editor or source-format habits. The schema always starts with a title. |
| Per-heading typography | **Dropped** | HeadingScale decides heading size |
| Settings search | **Dropped in v1** | 25 settings fit five panes. The palette reaches every one. |

### 2.4 Syncs (doc-only, v8, D40)

A later device sync (roadmap T1: end-to-end encrypted only, D37; v2.0, D38) needs to know which settings travel with the library and which stay on one device. **Nothing in v1 code reads or stores this** (D40 dropped S11's `scope` field). It is recorded here so sync doesn't re-decide every row.

| Syncs | Rows (examples from the roadmap) | Rule |
|---|---|---|
| **Device** (never syncs) | interface zoom, the backup folder, update channel and checks | Anything tied to this machine's screen, file system or install |
| **Library** (syncs) | page style, smart quotes, spelling languages | Anything about how documents read and are written |

The remaining rows in §2.1 get a value when T1 is designed; this is **a call T1 revisits**, not a v1 decision.

---

## 3. Conflict resolutions

**Rule:** every change below is made to the named doc in the PR that implements it, or in a docs-only PR before P2.9c starts. That PR is listed in §7.3.

| # | Conflict | Decision | Docs to amend |
|---|---|---|---|
| C1 | Text size steps and default (14/16/18/20 at 16, against 13/15/17/19/22 at 15; today 15) | **14 · 16 · 18 · 20 · 24 · 28 · 32 px, default 16, stored in rem** (32 = 200 %, WCAG 1.4.4). This is owner question Q1. If the owner keeps 15, the ladder is 13 · 15 · 17 · 19 · 22 · 26 · 30. Existing web browsers keep today's look either way (§5.6). | UX §7, §8.4; Details §4 table; TTP §3 (superseded) |
| C2 | ⌘+ / ⌘− / ⌘0: document text size or interface zoom; the web; Ctrl+wheel | **Desktop: ⌘+ / ⌘− / ⌘0 change Text size** (Details wins). View › **Text Size** ▸ shows Larger Text ⌘+, Smaller Text ⌘−, Actual Size ⌘0. The items "Actual Size / Zoom In / Zoom Out" are removed. **Ctrl/⌘ + wheel and pinch** step Text size too, throttled to one step per 150 ms. Interface zoom has **no key and no menu item**: Settings › General and the palette only. **Web: the app never captures ⌘+ / ⌘− / ⌘0**, which stay browser zoom (WCAG 1.4.4). The web reaches Text size from the Page popover and the palette. | UX §2.3 (Ctrl+wheel row), §2.4 (View menu), §4.6 (zoom row), §8.4; Details §4 |
| C3 | "Text size" means two things | The page setting is **"Text size"**. The per-selection toolbar control is already "Font size" and stays so. The Page popover hint says: "To make selected words bigger, use Font size in the toolbar." | none (code already right) |
| C4 | Interface zoom 75–200 % against 50–200 % | **75–200 %** in Chromium's own steps (75, 80, 90, 100, 110, 125, 150, 175, 200). At 50 %, chrome text drops below 7 px. | UX §8.4 |
| C5 | The spacing default (Normal 1.6) changes today's 1.15 | **New default Normal** (1.6, 1 em gaps) for the desktop app, the web library and new sandbox browsers. **Existing sandbox browsers keep today's 1.15** in the `classic` state until they choose (§5.6). Lists, table cells and headings now read the same variables. | Details §4; TTP §3 (Compact-as-default superseded) |
| C6 | Font default and names | **Default (Arial)** · Sans (Inter) · Serif (Source Serif 4) · Mono (JetBrains Mono) · Legible (Atkinson Hyperlegible Next, Q3). Default's stack gains `"Liberation Sans", Arimo` for Linux. Code blocks keep their own monospace stack whatever the page font. | Details §4; TTP l.248 |
| C7 | Per-document width on the web | **A per-document width exists wherever a library exists:** desktop (`doc_view`) and the web library (IndexedDB `doc_view`, already in its schema). **The public sandbox has app-wide width only.** Its documents are public and shared, so a per-document view key adds no value there. | Details §4 ("the web app gets … as app-wide"); Plan §14 ("app-wide page width") |
| C8 | Smart quotes: on or off, v1 or later | **On (today's behaviour), with a switch in v1** (P2.9c). Never inside code, with a test. The prior-art claim that "off matches today" is a factual error: Typography is always on. | Prior art #13; TTP l.256; Requests #39; Plan §8 |
| C9 | Outline control shape and breakpoint (three-way select at 1400 px; On/Off with 1240/1400/1640; code at 950) | **On / Off.** It docks when the **main area** (not the viewport: the files sidebar takes width) is at least card width + 270 + 32 px. Card width is computed from width × text size (§5.9). That keeps today's 950 px exactly for the `classic` state and makes a fixed table for everything else. Full never docks. | UX §7, §4.5; Details §4 table and §11 ("fixed breakpoints per width") |
| C10 | "Remember where I left off" against `NEXT_PUBLIC_REMEMBER_CHOICES` | **A user setting, `rememberPlace`, that gates only the continue position** (web `tinydocy-continue`, desktop `doc_view.place`). The operator flag stays a separate deployment switch. When it is 0, `rememberPlace` is forced off, as today. | UX §7 row |
| C11 | Theme default System; the web has no System option | **The web gets System.** New browsers default to System. Browsers that used TinyDocy before keep **Light**, written explicitly on first load, or keep the "dark" they already chose (§5.6). The boot script resolves System with `matchMedia` and writes the matching `theme-color`. A listener follows OS changes while System is chosen. One shared `setTheme()` replaces the two duplicated writers. | UX §7; inventory H4 |
| C12 | The Plan's P2.9c row is out of date; smart quotes and spellcheck have no PR | **P2.9c is split into P2.9c-1 (engine) and P2.9c-2 (choices and UI)** (§7). Smart quotes and the shared spellcheck setting are in P2.9c-1. The spellcheck menu items are in P2.9a, and the desktop Settings rows in P2.9b. | Plan §8 table, §13 D10 note |
| C13 | Spellcheck: three places, two PRs, the web silent | **One setting, `spellcheck`, on both platforms.** The web gets the switch: `<html spellcheck="false">` is inherited by every editable element, so the editor needs no code. Desktop also drives Electron's session spellchecker. Edit › Spelling › Check Spelling While Typing is the same setting. | UX §2.4, §7; Details §4 |
| C14 | Per-window state stored in a per-origin key (Hide Comments, reading mode) | **Per-window state never goes in `tinydocy-ui`.** Hide Comments: main's window state (desktop), `sessionStorage` (web). Reading mode: not stored at all. It resets when the window or tab closes. | Comments §11 (l.499) |
| C15 | Details cites `theme.ts:38` writing `html.dataset` | The prefs applier writes **`data-*` attributes on `<html>`**, mapped by CSS. Theme stays the `.dark` class that Tailwind needs. On desktop the boot script runs by **CSP hash** with values from main's preload snapshot (§5.3). | Details §4 "How preferences apply" |
| C16 | M15 storage: the Toolbar spec says a Yjs relative position | **The code is right.** It stores the section heading's `data-toc-id`. On desktop it moves to `doc_view.place` (still a `data-toc-id`). | Toolbar spec §5 l.161 |
| C17 | The web library spec is missing | **Resolved.** [`2026-11-16-web-library-design.md`](2026-11-16-web-library-design.md) exists and defines `doc_view`, `folders.sort/view/group` and `tags` in IndexedDB. This doc adds the Page popover and W13 to its PR list. | Inventory C17 (stale); web library §11 (adds W13) |
| C18 | *(new)* UX §7 pane list (General, Editor, Storage, Updates, About) | **General · Page · Writing · Storage · Updates · About.** "Editor" is split because page and writing settings together made a 13-row pane, and "Page" names its scope. | UX §7 |
| C19 | *(new)* Details §4 widths in px (552 / 648 / 864), and its "Standard (today)" label | **Widths in em of the text size** (30 / 33 / 46 em, plus Full with text kept to 46 em). Standard at 16 px is a 624 px card at about 71 characters per line in Arial. Today's 648 px card is 79. Measured in the a11y research §1.3. | Details §4; a11y research O1 answered |
| C20 | *(new)* A11y research A6/A8/A9/A10/A4-other-font and prior art #20/#21/#22/#25 | Resolved by §2.3. Reduce motion and contrast overrides are on the web only. Focus ring is folded into contrast. Interface text size is dropped. Underlined links are always on. Word count is a command. Other installed font is dropped. | none (research docs are records) |

---

## 4. Settings UI

### 4.1 Desktop Settings window

- **Window.**
  - 680 × 520, resizable in height only, one instance.
  - Opened by ⌘, (Ctrl+, on Windows and Linux; UX Q2 moves Subscript to `Mod-Shift-,` on desktop), by TinyDocy › Settings… or File › Settings…, by "Page settings…" in the Page popover, and from the palette.
  - A second ⌘, focuses the open window. ⌘W or Esc closes it.
- **Last pane.** It opens on the last pane used (`prefs.settingsPane`), or on a pane named by the opener: "Page settings…" opens Page.
- **Title.** The window title is the pane name ("Page").
- **Layout.**
  - Left navigation (168 px) on every OS.
  - Each pane is a single column 440 px wide, with label above the control and a muted hint under it.
  - Rare items sit last, under a quiet "Advanced" heading. No pane has one in v1.
- **Instant apply.** Each change goes to main over IPC (`prefs.set`). Main validates against the shared schema, stores it, and broadcasts `prefs.changed` to every window, so documents update live.
- **Reset.**
  - The three panes that hold preferences (General, Page, Writing) end with **[Reset to defaults]**.
  - It resets only that pane, applies at once, and shows a pill that names the scope, with Undo (§4.6). There is no dialog, because nothing is destroyed.
  - Identity, per-document widths and the backup folder are never reset by it.
  - Storage, Updates and About have no reset: their rows are a location, an update policy or information.
- **Separate renderer.** The window is its own page in the desktop export (`/settings`). It never loads the editor chunk.

```
┌ Page ──────────────────────────────────────────────────────────────┐
│ ┌──────────┐                                                         │
│ │ General  │  Page                                                   │
│ │▌Page     │  For all documents on this computer.                    │
│ │ Writing  │                                                         │
│ │ Storage  │  Style                                                  │
│ │ Updates  │  ┌───────────────┐┌───────────────┐                     │
│ │ About    │  │◉ Default      ││○ Comfortable  │                     │
│ └──────────┘  │ The quick fox…││  reading      │                     │
│               └───────────────┘└───────────────┘                     │
│               ┌───────────────┐┌───────────────┐                     │
│               │○ Compact      ││○ High         │                     │
│               │               ││  legibility   │                     │
│               └───────────────┘└───────────────┘                     │
│                                                                      │
│               Text size        [ A− ]  16 px  [ A+ ]     ⌘− ⌘+       │
│               Width            (Narrow)(Standard)(Wide)(Full)        │
│               3 documents have their own width.  [Reset them]        │
│               Font             [ Default (Arial)        ▾ ]          │
│               Spacing          (Compact)(Normal)(Relaxed)            │
│               Letter spacing   (Normal)(Wide)(Wider)                 │
│               Show the outline                               [●   ]  │
│               It docks beside the page when the window has room.     │
│                                                                      │
│                                              [ Reset to defaults ]   │
└──────────────────────────────────────────────────────────────────────┘
```

```
┌ General ─────────────────────────────────────────────────────────────┐
│  General        Appearance                                            │
│  Page           (•) System   ( ) Light   ( ) Dark                     │
│  Writing        Follows your Mac's light or dark setting.             │
│  Storage                                                              │
│  Updates        Interface zoom            [ 100 %          ▾ ]        │
│  About          Makes menus, the sidebar and the toolbar bigger. To   │
│                 make only document text bigger, use Text size (⌘+).   │
│                                                                       │
│                 When TinyDocy opens       [ Reopen my windows ▾ ]     │
│                 Show recent documents in the Dock            [●   ]   │
│                 Titles appear when you right-click the Dock icon.     │
│                                                                       │
│                 Your name   (Live release)                            │
│                 [ Quick Otter                    ]                    │
│                 ● ● ● ● ● ● ● ●   Your colour                         │
│                 Shown to people you share documents with.             │
│                                              [ Reset to defaults ]    │
└───────────────────────────────────────────────────────────────────────┘
```

```
┌ Writing ─────────────────────────────────────────────────────────────┐
│  …              Check spelling while typing                  [●   ]   │
│                 Spelling languages   (Windows and Linux)              │
│                 [ English (United States)  ▾ ]   [+ Add language]     │
│                 macOS: "macOS picks the language as you type."        │
│                                                                       │
│                 Smart quotes and dashes                      [●   ]   │
│                 Turns "straight" quotes into curly ones and -- into   │
│                 a dash as you type. Never in code.                    │
│                                                                       │
│                 Simplified toolbar                           [    ]   │
│                 Shows the most-used buttons. The rest are in ⋯.       │
│                                                                       │
│                 Remember my place in each document           [●   ]   │
│                 Opens each document at the section you were reading.  │
│                 Kept on this computer only.                           │
│                                                                       │
│                 [ Forget my formatting choices… ]                     │
│                 Clears remembered colours, list style, table size     │
│                 and recent commands. Your settings stay.              │
│                                              [ Reset to defaults ]    │
└───────────────────────────────────────────────────────────────────────┘
```

**Storage, Updates, About.** These keep the UX spec §7 rows, with the copy below.

```
┌ Storage ─────────────────────────────────────────────────────────────┐
│  …              Library                                               │
│                 ~/Library/Application Support/TinyDocy  [Show in Finder]│
│                 Cleaner apps that remove app data will delete the     │
│                 library. Your backups stay.                           │
│                                                                       │
│                 Backups                                               │
│                 ~/TinyDocy Backups          [Show]  [Change…]         │
│                 Last backup: today, 09:12.  [Back up now]             │
│                 Daily snapshots: 7 kept · last taken today, 09:02.    │
│                 [Restore from backup…]   [Export all…]                │
│                                                                       │
│                 Trash                                                 │
│                 3 documents. Each is deleted 30 days after you move   │
│                 it to Trash.                       [Empty Trash…]     │
└───────────────────────────────────────────────────────────────────────┘
```

**Empty Trash.** A native sheet: "Delete 3 documents forever? This can't be undone." [Cancel] [Delete Forever]. Cancel has focus.

```
┌ Updates ─────────────────────────────────────────────────────────────┐
│  …              Download and install updates automatically   [●   ]   │
│                 Updates install when you quit TinyDocy.               │
│                                                                       │
│                 Channel        (•) Stable   ( ) Beta                  │
│                 Beta gets new features first and may have more bugs. │
│                                                                       │
│                 TinyDocy 1.3.2 is up to date. Checked today at 09:14. │
│                 [Check Now]                                           │
│                 Checking for updates sends only the app version and   │
│                 your operating system. TinyDocy sends no usage data.  │
└───────────────────────────────────────────────────────────────────────┘
```

```
┌ About ───────────────────────────────────────────────────────────────┐
│  …              TinyDocy 1.3.2 (build 412) · Stable                   │
│                 Library format 1 · Electron 39 · Chrome 142 · Node 22 │
│                 [Copy Version Info]                                   │
│                                                                       │
│                 Licence (MIT) · Third-party notices · Source code ·   │
│                 Release notes · Privacy policy                        │
└───────────────────────────────────────────────────────────────────────┘
```

The versions shown in the About sketch are placeholders.

### 4.2 Web Settings dialog (W13)

- **Opening.** A modal `Dialog` (`components/ui/dialog.tsx`), opened by ⋯ › **Settings…**, the palette, and "Page settings…" in the Page popover. There is no keyboard shortcut on the web: ⌘, stays Subscript.
- **Layout.**
  - **≥ 640 px:** 640 × min(560 px, 90 vh), with left navigation, as on desktop.
  - **< 640 px:** a full-height `Sheet` that opens on the pane list. Choosing a pane drills in, and a back button returns.
- **Panes by host.**

  | Pane | Sandbox (`tiny.docs.plus`) | Library origin |
  |---|---|---|
  | General | Appearance, Increase contrast, Reduce motion, Your name and colour | Appearance, Increase contrast, Reduce motion (name and colour arrive with W10) |
  | Page | the §4.1 Page pane, without "3 documents have their own width" | the same, with it |
  | Writing | the §4.1 Writing pane, without spelling languages | same |
  | Privacy (sandbox) / Storage (library) | Share anonymous usage statistics; Delete offline copies… | W6's Storage pane (card, Export all, backup folder, Delete my library…), plus "TinyDocy collects no usage data here." |
- **No About pane.** The footer links About, Privacy and Licences.
- **Kill switch.** Under `NEXT_PUBLIC_REMEMBER_CHOICES=0`, a muted line shows under every pane title: "This site doesn't save settings. They reset when you reload." Controls still work for the session.
- **Origins.** Sandbox and library are separate origins (W-D8), so each keeps its own settings. The library's General pane says so once: "Settings here are separate from the public sandbox's."
- **Chunk.** The dialog is a lazy chunk, loaded on first open. It imports nothing new from the editor chunk.

```
Web, General pane (sandbox)
┌ Settings ──────────────────────────────────────────────── ✕ ┐
│ General   │ Appearance                                        │
│ Page      │ (•) System  ( ) Light  ( ) Dark                   │
│ Writing   │ Follows your device's light or dark setting.      │
│ Privacy   │                                                   │
│           │ Increase contrast      (•) System  ( ) Always     │
│           │ Stronger borders, text and focus rings.           │
│           │ "System" follows your device's contrast setting.  │
│           │                                                   │
│           │ Reduce motion          (•) System  ( ) Always     │
│           │ Menus and scrolling appear without animation.     │
│           │                                                   │
│           │ Your name  [ Quick Otter          ]               │
│           │ ● ● ● ● ● ● ● ●   Your colour                     │
│           │ Shown next to your cursor to people editing the   │
│           │ same document.                                    │
│           │                              [ Reset to defaults ]│
└───────────┴───────────────────────────────────────────────────┘
```

```
Web, Privacy pane (sandbox only)
┌ Settings ──────────────────────────────────────────────── ✕ ┐
│ General   │ Share anonymous usage statistics          [    ]  │
│ Page      │ Counts pages visited, without document names or   │
│ Writing   │ content. Off until you turn it on.                │
│ Privacy   │                                                   │
│           │ Offline copies                                    │
│           │ Documents you open are kept in this browser for   │
│           │ 14 days so they work offline.                     │
│           │ [Delete offline copies…]                          │
│           │                                                   │
│           │ Privacy policy ↗                                  │
└───────────┴───────────────────────────────────────────────────┘
```

The library's fourth pane is W6's Storage pane (storage card, Export all, Back up to a folder…, Delete my library…), with the line "TinyDocy collects no usage data here."

### 4.3 Page popover

- **Opening.**
  - Desktop: View › Page… and ⋯ › Page….
  - Web: ⋯ › Page….
  - Phones: the Aa sheet gets a **Page** row that opens the same content as a sheet.
  - Palette: "Page settings".
- **Content.**
  - One section for **this document** (library hosts only).
  - Then the app-wide section, with its scope line.
  - Font, Spacing and Letter spacing sit under an **Adjust font and spacing** disclosure. It remembers whether it was open, in `ui.pageAdjustOpen` (web) or `prefs.pageAdjustOpen` (desktop).
- **Chunk.** A lazy chunk (the `continue-chip` and `swatch-preview` pattern). It reads and writes through the prefs store and never through the editor.

```
Library host (desktop, web library)        Sandbox
┌ Page ─────────────────────────────┐      ┌ Page ─────────────────────────────┐
│ THIS DOCUMENT                      │      │ For all documents in this browser.│
│ Width (Narrow)(Standard)(Wide)(Full)│     │ Style  ◉ Default                  │
│ Wider than your default.           │      │        ○ Comfortable reading      │
│ [Use for all documents] [Reset]    │      │        ○ Compact                  │
│ ────────────────────────────────── │      │        ○ High legibility          │
│ ALL DOCUMENTS                      │      │ Text size  [A−]  16 px  [A+]      │
│ For all documents on this computer.│      │ Width (Narrow)(Standard)(Wide)(Full)│
│ Style  ◉ Default                    │      │ ▸ Adjust font and spacing         │
│        ○ Comfortable reading       │      │ ──────────────────────────────── │
│        ○ Compact                   │      │ ☑ Show the outline                │
│        ○ High legibility           │      │ ☐ Reading mode                    │
│ Text size  [A−]  16 px  [A+]   ⌘+  │      │ Page settings…                    │
│ ▸ Adjust font and spacing          │      └───────────────────────────────────┘
│ ────────────────────────────────── │
│ ☑ Show the outline                 │
│ ☐ Reading mode               ⌥⌘R   │
│ Page settings…                     │
└────────────────────────────────────┘
```

**Width semantics.**
- **On a library host**, the popover's Width sets **this document**.
  - When the document's width differs from the default, two buttons appear: **Use for all documents** (the default becomes this width, and this document's override is removed) and **Reset** (the override is removed).
  - Other documents with their own width keep it. Settings › Page lists how many there are, with [Reset them].
- **On the sandbox**, Width sets the app default, so the popover shows it in the app-wide section.
- **Presets set the default width.** A document's own width wins over the preset.

### 4.4 Presets (page styles)

| Style | Font | Text size | Width | Spacing | Letter spacing | Copy (hint under the radio) |
|---|---|---|---|---|---|---|
| **Default** | Default (Arial) | 16 | Standard | Normal | Normal | "Balanced for reading and writing." |
| **Comfortable reading** | Serif | 18 | Narrow | Relaxed | Normal | "Larger text, shorter lines, more space." |
| **Compact** | Sans | 14 | Wide | Compact | Normal | "More on screen. Good for tables and long lists." |
| **High legibility** | Legible (or Default if Q3 is no) | 20 | Narrow | Relaxed | Wider (or Normal if Q3 is no) | "Clear letter shapes, large text and extra spacing." |

**Rules**
- Choosing a style sets all five knobs and drops every override.
- Changing a knob keeps the style's radio selected and adds "· Custom" to its label, with **[Reset to <style>]** beside it. Stored: the style name plus only the knobs that differ (§5.2).
- Styles never change Appearance, contrast, motion or interface zoom. Those are about the person, not the page.
- Styles are named by outcome, never by diagnosis. It is "High legibility", not "Dyslexia mode".
- **The `classic` state** applies only to sandbox browsers that used TinyDocy before (§5.6).
  - It is **not a fifth style**. No radio is checked, and a line above the styles reads: **"You're using the previous look. Choose a style or change a setting to switch."**
  - The Text size stepper shows 15 px (A+ goes to 16, A− to 14).
  - Width shows nothing selected.
  - The first change leaves `classic` for **Default plus that change**, with the pill "Pages now use the new look. [Undo]". There is no way back except Undo: `classic` exists only to avoid a surprise on upgrade, not as a style to keep.
- **The preview tile** in Settings renders two lines of sample text in that style's font, size and spacing at 60 % scale. It is decorative (`aria-hidden`). The radio's label and hint carry the meaning.

### 4.5 Menus, ⋯ and palette entries

Every setting is reachable from the palette (`K` in §2.1). Entries are actions in a **lazy** `lib/editor-actions/prefs-actions.ts` that the palette host and the ⋯ menu import on open, never in `core/`. That keeps the editor chunk at +0. Each action's `run()` writes through the prefs store.

| Palette entry | Effect |
|---|---|
| Appearance: System / Light / Dark | sets `appearance` |
| Larger text / Smaller text / Reset text size | steps `page.size`; desktop shows ⌘+ / ⌘− / ⌘0 |
| Page style: Default / Comfortable reading / Compact / High legibility | sets `page.style` |
| Page width: Narrow / Standard / Wide / Full | this document on library hosts, the default on the sandbox |
| Default page width: … | the default (library hosts) |
| Font: … · Spacing: … · Letter spacing: … | the knobs |
| Show outline / Hide outline | `outline` |
| Reading mode | `readingMode` (this window) |
| Simplified toolbar | `simpleToolbar` |
| Check spelling while typing · Smart quotes and dashes · Remember my place in each document | switches |
| Increase contrast · Reduce motion (web) | toggles between System and Always |
| Interface zoom: Larger / Smaller / 100 % (desktop) | `zoom` |
| Settings · Settings: Page · Settings: Writing · … | opens the pane |

**Desktop View menu** (amends UX §2.4):
- Show/Hide Sidebar
- Show/Hide Outline
- Simplified Toolbar ✓
- separator
- **Page Width ▸** Narrow / Standard / Wide / Full (radio items, this document)
- **Text Size ▸** Larger Text ⌘+ / Smaller Text ⌘− / Actual Size ⌘0
- **Font ▸** Default / Sans / Serif / Mono / Legible
- **Page…** (opens the popover)
- **Reading Mode** ⌥⌘R ✓
- Hide Comments (Live)
- separator
- Enter Full Screen

**Web ⋯ menu:** adds **Page…** and **Settings…**. The existing theme item stays. The existing simplified-toolbar checkbox stays.

### 4.6 Copy (every label, hint and confirmation)

| Where | Text |
|---|---|
| Appearance hint (desktop mac / Windows / Linux) | "Follows your Mac's light or dark setting." / "Follows your Windows colour mode." / "Follows your system's light or dark style." |
| Appearance hint (web) | "Follows your device's light or dark setting." |
| Interface zoom hint | "Makes menus, the sidebar and the toolbar bigger. To make only document text bigger, use Text size (⌘+)." |
| Increase contrast hint | "Stronger borders, text and focus rings. "System" follows your device's contrast setting." |
| Reduce motion hint | "Menus and scrolling appear without animation. "System" follows your device's setting." |
| Page pane scope | "For all documents on this computer." / "For all documents in this browser." |
| Text size stepper buttons (accessible names) | "Smaller text" / "Larger text". At the limits: "Smallest text size" / "Largest text size" (disabled). |
| Text size hint (popover) | "To make selected words bigger, use Font size in the toolbar." |
| Width option hints (tooltips) | Narrow "About 60 characters per line" · Standard "About 70 characters per line" · Wide "For tables and wide images" · Full "Tables and images use the whole window. Text keeps a readable width." |
| Per-document width line | "Wider than your default." / "Narrower than your default." / "Full width for this document." |
| Per-document buttons | "Use for all documents" · "Reset" |
| Settings line for overrides | "3 documents have their own width." [Reset them] → pill "3 documents now use your default width. [Undo]" |
| Font option labels | "Default (Arial)" · "Sans (Inter)" · "Serif (Source Serif)" · "Mono (JetBrains Mono)" · "Legible (Atkinson Hyperlegible)" |
| Spacing hint | "Space between lines and paragraphs." |
| Letter spacing hint | "Space between letters and words. Wider can help some readers with dyslexia." |
| Show the outline hint | "It docks beside the page when the window has room." |
| Reading mode hint (popover, tooltip) | "Read without changing anything. For this window only." (web: "this tab only") |
| Spellcheck hint (web) | "Uses your browser's spelling dictionary." |
| Spelling languages hint (Windows, Linux) | "Up to 3. Dictionaries are part of TinyDocy, so nothing is downloaded." |
| Spelling note (macOS) | "macOS picks the language as you type." |
| Smart quotes hint | "Turns "straight" quotes into curly ones and -- into a dash as you type. Never in code." |
| Simplified toolbar hint | "Shows the most-used buttons. The rest are in ⋯." |
| Remember my place hint | "Opens each document at the section you were reading. Kept on this computer only." (web: "in this browser only") |
| Turning Remember my place off | pill "Places forgotten. Documents now open at the top." |
| Forget my formatting choices | button "Forget my formatting choices…" → pill "Formatting choices forgotten. Your settings stay. [Undo]" |
| Usage statistics hint | "Counts pages visited, without document names or content. Off until you turn it on." When GPC or DNT is on (disabled): "Your browser asks sites not to track you, so this stays off." |
| Delete offline copies (sandbox) | "Delete offline copies…" → existing confirm copy (`offline-data-control.tsx`) |
| Name field errors | "Enter a name." · "Use 32 characters or fewer." |
| Name hint (sandbox / Live) | "Shown next to your cursor to people editing the same document." / "Shown to people you share documents with." |
| Classic line | "You're using the previous look. Choose a style or change a setting to switch." |
| Leaving classic | pill "Pages now use the new look. [Undo]" |
| Reset, General | button "Reset to defaults" → pill "General settings reset on this computer. [Undo]" (web: "…in this browser. [Undo]"). Your name and colour are kept. |
| Reset, Page | pill "Page settings reset for all documents on this computer. Documents with their own width keep it. [Undo]" (web: "…for all documents in this browser. [Undo]"; the sandbox has no per-document widths, so it drops the second sentence) |
| Reset, Writing | pill "Writing settings reset on this computer. [Undo]" (web: "…in this browser. [Undo]") |
| Not saved (R=0) | "This site doesn't save settings. They reset when you reload." |
| Library origin note | "Settings here are separate from the public sandbox's." |
| ⌘+ feedback (desktop) | pill "Text size 18 px" (no action). At the limit: "Largest text size" |

### 4.7 Keyboard and accessibility

- **Navigation.**
  - The pane list is a vertical `tablist` (`aria-orientation="vertical"`) with automatic activation: ↑ ↓ choose a pane, Home and End jump.
  - Tab moves into the `tabpanel`. F6 and Shift+F6 move between list and pane on desktop.
  - Opening Settings focuses the selected tab.
  - Desktop: ⌘W or Esc closes the window. Web: Esc closes the dialog and focus returns to the opener.
- **Labels.** Every control has a visible `<label>`. Every hint is linked by `aria-describedby`.
- **Groups.** Radio groups and segmented controls are `radiogroup`s with roving tabindex and arrow keys. Switches are `role="switch"`. Selects are Base UI `Select` (new in P2.9b, shared with W13).
- **Text size stepper.**
  - A `group` named "Text size", with two buttons and an `<output>` holding "16 px".
  - The value is announced through `announce()`, not an `aria-live` region inside the popover, to avoid double reading.
- **Style tiles.** Style tiles are `radio`s. The preview inside is `aria-hidden`. "· Custom" is part of the accessible name. [Reset to <style>] follows the group.
- **Popover.** It traps focus like other popovers and returns focus to ⋯ (or the View menu, which needs no return). The disclosure is a `button` with `aria-expanded`.
- **Feedback.** Every change is announced only where it isn't visible at the focus point, for example ⌘+ in the document ("Text size 18 px").
- **Layout under stress.** The whole UI must pass the WCAG 1.4.12 text-spacing check and 200 % interface zoom with no clipping (§5.15).
- **Motion.** The Settings window and dialog use no animation under reduced motion. Panes switch instantly.

---

## 5. Engineering

### 5.1 Modules

| Module | Holds | Imported by |
|---|---|---|
| `lib/prefs/schema.ts` | Ids, allowlists, defaults, style tables, the text-size ladder, width and spacing tables, `resolvePage(stored)`, `resolveBoot(stored, media)` → attributes. Pure TypeScript with no DOM, so main can import it. | main (validation), both stores, Settings, the popover, tests |
| `lib/prefs/store-web.ts` | `PrefsStore` over `tinydocy-theme` and `tinydocy-ui` slots. Memory-only under R=0. `subscribe` covers same-tab and `storage` events. | web lazy chunks, `PrefsRuntime` |
| `lib/prefs/store-desktop.ts` | `PrefsStore` over IPC (`prefs.get` / `prefs.set` / `prefs.changed`) | desktop renderer |
| `lib/prefs/apply.ts` | `applyPrefs(attrs)`: writes `<html>` attributes and `theme-color`. Shared by the runtime and the boot parity test. | `PrefsRuntime` |
| `lib/prefs/boot-script.ts` | The inline boot string (§5.3) and its SHA-256, computed at build | `app/layout.tsx`, desktop CSP, W4's library CSP |
| `components/prefs/prefs-runtime.tsx` | A leaf that renders nothing. It subscribes to the store, re-applies attributes, and runs the System theme `matchMedia` listener. Mounted once in the root layout, **never inside the editor shell**. | layout |
| `components/prefs/page-frame.tsx` | Wraps the page container and owns `data-doc-width` and `data-reading`. It subscribes to that document's `doc_view` entry. Its `children` element is stable, so a width change re-renders only the frame, never the editor. | document page |
| `components/prefs/page-popover/*`, `components/settings/panes/*` | UI. Lazy chunks, shared by the desktop Settings window and W13. | ⋯, View menu, Settings |

### 5.2 Storage and payloads

**Desktop** (main's SQLite, written only by main's storage worker):

```sql
-- meta row, JSON validated by lib/prefs/schema.ts on read and write
meta('prefs', '{"v":1,"appearance":"system","zoom":100,"startup":"reopen","dockRecent":true,
  "page":{"style":"default","size":null,"width":null,"font":null,"spacing":null,"letters":null},
  "outline":true,"spellcheck":true,"spellLanguages":["en-US"],"smartQuotes":true,
  "simpleToolbar":false,"rememberPlace":true,"backupFolder":"~/TinyDocy Backups",
  "updates":{"auto":true},"settingsPane":"general","pageAdjustOpen":false}')
-- v7: no "channel" key by default. The channel default is computed from the build's version
-- (prerelease → beta, plain → stable) and written only when the user picks one (row 23).

CREATE TABLE doc_view (
  doc_id   TEXT PRIMARY KEY REFERENCES docs(id) ON DELETE CASCADE,
  width    TEXT CHECK (width IN ('narrow','standard','wide','full')),  -- NULL = inherit
  place    TEXT,              -- continue position: a data-toc-id, ≤ 64 chars
  remote_images INTEGER NOT NULL DEFAULT 0
);
```

- **Reads.** A missing field reads its default. An unknown field is ignored. An invalid value reads its default and is logged once.
- **Versions.**
  - `v` greater than this build's: read the known fields, and write nothing until the user changes a setting. A downgraded app never silently drops a newer build's values.
  - `v` lower: run the migration chain.
- **Window state.** `win` (window state, P2.9a) holds per-window `hideComments`. Reading mode is never stored.
- **Identity.** `meta('identity')` arrives in P4.0. Until then the renderer keeps `tinydocy-user`.
- **Removed folders.** The `doc_view` rows of a document purged from Trash cascade away.

**Web** (per origin):

| Key | Payload | Notes |
|---|---|---|
| `tinydocy-theme` | `"system"` \| `"light"` \| `"dark"` | Kept unversioned so old builds still read `"dark"`. A value outside the allowlist reads as the §5.6 fallback. Never gated by R=0 (unchanged). |
| `tinydocy-ui` (`{ v: 1, slots }`, existing) | New slots: `page` `{ style, size?, width?, font?, spacing?, letters? }`, `a11y` `{ contrast, motion }`, `spellcheck` (bool), `smartQuotes` (bool), `rememberPlace` (bool), `settingsPane` (string), `pageAdjustOpen` (bool). Existing slots: `outlineOpen`, `toolbarDensity`. | Each new slot is added to `CHOICE_SLOTS` (contract test) with an allowlist validator and `maxRecent: 0`. `page` is **one slot**, so a style change is one write, one `storage` event and one layout. |
| `sessionStorage` `tinydocy-window` | `{ v: 1, hideComments }` | per tab (P4.10) |
| IndexedDB `tinydocy-library.doc_view` | `{ width?, place? }` | Library only. W2's schema already reserves the store. `place` moves the library's continue position out of `tinydocy-continue`. The sandbox keeps `tinydocy-continue`. |
| `tinydocy-user` | `{ name, color }` (legacy shape, now validated) | §5.12 |
| `tinydocy-continue` | unchanged | Written only when `rememberPlace` is on. Turning it off deletes the key. |

- **The `page` slot stores a style name plus overrides.**
  - The effective value is `STYLES[style]` with the overrides merged over it.
  - "Custom" is derived: there is at least one override.
  - "Reset to <style>" drops the overrides.
  - A future build can improve a style's values without rewriting anyone's storage.

### 5.3 The boot script

One inline script string serves both platforms. It runs first in `<body>`, as today, on `<html suppressHydrationWarning>`.

1. **Read.**
   - **Desktop:** `window.__tinydocyBoot`, a frozen object exposed by the preload with `contextBridge`. Main passes it in `additionalArguments` (JSON, ≤ 4 KB). It holds the prefs plus the OS signals main knows before paint: `shouldUseDarkColors`, `shouldUseHighContrastColors`, `prefersReducedMotion`.
   - **Web:** `tinydocy-theme` and `tinydocy-ui` (`v === 1`), each parsed inside try/catch.
2. **Validate** every value against inline allowlists. These are generated from `schema.ts` at build time and interpolated into the string, so the allowlists can't drift.
3. **Resolve.**
   - The theme. System uses `matchMedia("(prefers-color-scheme: dark)")`.
   - The page style and overrides.
   - The §5.6 migration fallbacks.
   - `REMEMBER_CHOICES`, inlined at build time. When it is 0 the `ui` slots are ignored and the page falls back to `classic`.
4. **Write.**
   - The `.dark` class and the `theme-color` meta (as today).
   - `data-page-style`, plus `data-text-size`, `data-page-width`, `data-page-font`, `data-spacing` and `data-letters` (overrides only).
   - `data-contrast="more"`, `data-motion="reduce"`, `data-smart-quotes="off"`.
   - `spellcheck="false"` (only when Off).
   - `data-prefs="1"`.
   - On the sandbox only, the missing theme and `tinydocy-look` marker (§5.6).
  - **If feasible**, a `<link rel="preload" as="font" type="font/woff2" crossorigin>` for the chosen bundled font's Latin file. That needs the bundler's hashed URL inside `boot-script.ts`. P2.9c-2 checks whether Turbopack exposes it to a server module. If it doesn't, there is no preload, and the `size-adjust` fallbacks (§5.13) keep the swap reflow small.

- **Size.** About 1.3 KB minified, inline in every HTML response. Today's script is about 0.4 KB.
- **Desktop CSP.** `script-src 'self' 'sha256-<boot>'`, plus the hashes main computes per response for the export's other inline scripts (S1). The boot hash is computed at build from the exact string, and a build test asserts that the hash in the CSP matches the script. W4's strict library CSP uses the same hash.
- **One applier only.**
  - **S1 result: the preload wins, through a `MutationObserver`.** When the sandboxed preload runs, `document.documentElement` is still `null`, so it can't set attributes directly. A `MutationObserver` on `document`, installed by the preload, sets them as the parser inserts `<html>`. In S1, the first inline `<head>` script already saw the attribute on macOS, Windows and Linux.
  - So on desktop the preload applies the attributes and sets `data-prefs="1"`, and the inline script returns at once when it sees `data-prefs`.
  - On the web, the inline script does the work.
  - Either way there is one applier per load.
- **Parity test.** `bun test` evaluates the string in happy-dom against a table of about 40 stored payloads and media states. It asserts the attributes equal `resolveBoot()` from `schema.ts`. That is the guard against the string and the module drifting.

### 5.4 CSS mapping

All values are custom properties on `:root`, chosen by attributes. They are unregistered (never `@property`), so an `em` resolves where the property is used.

```scss
:root {                                   // Default style
  --page-size: 1rem;                      // honours the browser's default font size
  --page-measure: 33;                     // unitless, × --page-size
  --page-leading: 1.6;  --page-gap: 1em;  --page-list-gap: .35em;  --page-heading-leading: 1.2;
  --page-letter: 0;     --page-word: 0;
  --page-font: Arial, "Liberation Sans", Arimo, sans-serif;
}
:root[data-page-style="comfortable"] { --page-size: 1.125rem; --page-measure: 30; --page-leading: 1.8; --page-gap: 1.5em; --page-list-gap: .5em; --page-heading-leading: 1.25; --page-font: var(--font-serif-stack); }
:root[data-page-style="compact"]     { --page-size: .875rem;  --page-measure: 46; --page-leading: 1.45; --page-gap: .75em; --page-list-gap: .25em; --page-font: var(--font-sans-stack); }
:root[data-page-style="legible"]     { --page-size: 1.25rem;  --page-measure: 30; --page-leading: 1.8; --page-gap: 1.5em; --page-list-gap: .5em; --page-heading-leading: 1.25; --page-letter: .12em; --page-word: .16em; --page-font: var(--font-legible-stack); }
// knob overrides come later in the file, at the same specificity, so they win
:root[data-text-size="14"] { --page-size: .875rem; }  /* … 16 18 20 24 28 32 → 1 … 2rem */
:root[data-page-width="narrow"] { --page-measure: 30; }  /* standard 33, wide 46, full: none */
:root[data-spacing="compact"] { … }  /* normal, relaxed */
:root[data-letters="wide"] { --page-letter: .06em; --page-word: .08em; }  /* wider .12/.16 */
:root[data-page-font="serif"] { --page-font: var(--font-serif-stack); }  /* sans, mono, legible */
```

**Where the variables land**
- **Card and skeleton:**
  - `.document-editor-content` and `.skeleton-page` get `font-size: var(--page-size)` and `max-width: calc(var(--page-measure) * var(--page-size) + 6rem)`.
  - The 6 rem is the 3 rem padding on each side, unchanged.
  - Full: `max-width: none`.
  - The skeleton now reads the same variables, so the page never jumps on load (`app-skeleton.scss:70` stops hard-coding 648 px).
- **Per document:**
  - `.page-frame[data-doc-width="…"]` sets `--page-measure` on the frame. That overrides `:root`, because custom properties inherit.
  - Every document in a window carries its own width.
- **Body text:**
  - `.tiptap.ProseMirror` gets `font-size: var(--page-size); font-family: var(--page-font); letter-spacing: var(--page-letter); word-spacing: var(--page-word)`.
  - `p` loses its own `font-size: 15px` and takes `line-height: var(--page-leading); margin-top: var(--page-gap)`.
  - **Every** paragraph, in lists, cells and blockquotes too, now renders at one size, which fixes today's 15/16 px mix.
- **Lists and tables:**
  - `li p { line-height: var(--page-leading) }`, and `li + li { margin-top: var(--page-list-gap) }`.
  - `td p, th p { line-height: var(--page-leading) }`.
  - This replaces the hard-coded 1.15 at `list-node.scss:48`.
- **Headings:**
  - HeadingScale emits `--hd-size` in **em on a 16 px base** (pt ÷ 12): `MAX_SIZE = 1.6667` (20 pt), `MIN_SIZE = 1` (12 pt), unit `em`.
  - The `heading-node.scss` fallbacks become 1.6667, 1.3333, 1.1667, 1, 0.9167 and 0.8333 em.
  - `line-height: var(--page-heading-leading)`.
  - Headings now follow Text size. At the 16 px root, and in `classic` (where `.tiptap` stays 16 px), they render at exactly today's px. The smallest heading never drops below body size.
  - This changes only the extension's output unit, not its plugin logic. The extension's README notes that headings now scale with the host's font size.
- **Other sizes in the document:**
  - Every other fixed `px` or `rem` font size inside `.tiptap` becomes `em`, so it follows Text size. The P2.9c checklist covers `document-editor.scss:221`, `paragraph-node.scss:121`, the code-block, inline-code, table, image-caption and Mermaid SCSS.
  - `classic` keeps their current values.
- **Code:**
  - `.tiptap code, .tiptap pre { letter-spacing: normal; word-spacing: normal; font-family: <code stack> }`.
  - Code never takes the page font or extra letter spacing.
- **Full width:**
  - Text blocks (`p`, `ul`, `ol`, `blockquote`, `h1`–`h6`, task lists) get `max-inline-size: calc(46 * var(--page-size))`, aligned to the start edge.
  - Tables, images, Mermaid and code blocks use the full width.
  - Wrapped (floated) media next to capped text is a named design-review case.
- **The `classic` state:** `:root[data-page-style="classic"]` restores today exactly:
  - `--page-size` unset on `.tiptap` (it inherits 16 px)
  - the old `p:not(:first-child):not(td p):not(th p) { font-size: 15px; line-height: 1.15; margin-top: 12px }`
  - `li p` at 1.15
  - heading leading 1.15
  - `max-width: 648px` on card and skeleton
  - Arial

  These are today's rules moved under one selector, so they are already tested.
- **Contrast** (`data-contrast="more"`, or `prefers-contrast: more` without forced colours): one SCSS mixin emits the high-contrast token set for both triggers:
  - text `#000` / `#fff`
  - `--muted-foreground` ≥ 7:1
  - borders ≥ 3:1 at 2 px
  - focus ring 3 px with a 2 px offset
  - no translucent fills or `backdrop-filter`
  - default scroll bars (no `scrollbar-width: thin`)
  - thicker link underlines
- **Motion:** the `reduced-motion` mixin emits each rule under `@media (prefers-reduced-motion: reduce)` and under `:root[data-motion="reduce"]`. JS checks (for example `lib/heading-navigation.ts:44`) use one `prefersReducedMotion()` helper that reads both.

### 5.5 Hydration-safe reading

- The server never renders a preference value. The server-rendered skeleton and shell take every page value from CSS variables that the boot script set before paint. Nothing React renders depends on a preference before mount.
- **Inside the `ssr: false` editor** (Page popover, `PageFrame`, toolbar): `useSyncExternalStore(store.subscribe, store.get, () => DEFAULTS)`. There is no ready flag, since a ready effect would flash the default. This is the `useToolbarDensity` pattern.
- **In SSR'd chrome** (the web Settings dialog trigger, the theme row button): read in `useEffect` behind a ready flag (the `useRememberedChoice` pattern). The dialog itself is lazy and client-only.
- **Never** `useState(() => readStorage())`.
- `PrefsRuntime` re-applies attributes on store changes. The store fires for same-tab writes, for `storage` events and for desktop `prefs.changed`. Because the boot script and `applyPrefs` produce identical attributes (the parity test), the first re-apply is a no-op, and no layout happens on hydration.

### 5.6 Migration: no visible change unless you choose

Desktop and the web library are new installs on new storage, so they get the new defaults. Only the **sandbox origin** has existing users.

| Signal (sandbox) | Theme | Page |
|---|---|---|
| `tinydocy-theme` is valid | as stored | — |
| No theme key, and any legacy key exists (`tinydocy-user`, `-ui`, `-choices`, `-tabs`, `-continue`) | **light** (today's default) | — |
| No theme key, and no legacy key | **system** | — |
| `ui.page` is valid | — | as stored |
| No `ui.page`; marker `tinydocy-look` = `"classic"`, or no marker and any legacy key (including `tinydocy-theme`) exists | — | **`classic`** |
| No `ui.page`; marker = `"new"`, or no marker and no legacy key | — | **`default`** |
| `NEXT_PUBLIC_REMEMBER_CHOICES=0` | (theme logic unchanged) | **`classic`** every load. The operator turned remembering off, so the site looks as before. Changes apply for the session only. |

- **Settling happens in the boot script, in the same task as the decision.**
  - If waiting for idle, a new visitor could reload before the write while `tinydocy-user` (written when the editor mounts) already exists. Their second load would then be misread as a legacy browser.
  - So when `tinydocy-theme` is missing, the boot script writes the resolved theme at once.
  - When the marker key `tinydocy-look` is missing, it writes `"classic"` or `"new"` from the legacy-key test.
  - On later loads, the page fallback reads the marker, not the legacy keys: `"classic"` → `classic`, `"new"` → `default`.
  - A `ui.page` slot written by the user's own choice always wins over the marker.
  - This is the boot script's only write and a named exception to the "writes only from an action's `run()`" rule.
  - Both writes sit in try/catch. If storage is blocked, the decision is recomputed each load from the same keys, which is stable because nothing else can be written either.
  - Under R=0, `tinydocy-look` is not needed (the page is always `classic`), but the theme is still written, as today.
  - The parity test (§5.3) asserts the writes as well as the attributes, including the "new visitor reloads immediately" case.
- **What existing sandbox users see after upgrading:**
  - pixel-identical pages
  - their old theme
  - a Settings dialog and a Page… item they can ignore
- **Visible changes on upgrade.** Exactly two, both accessibility fixes, shipped in their own PRs with a design review:
  - dark `--primary` text (§5.11)
  - link underlines (§5.12)
- **Screenshot test:** a fixture with title, paragraphs, lists, a table, a blockquote, code and six heading ranks, in light and dark. `classic` must equal `main` pixel for pixel. Default must equal the approved design-review screenshots.

### 5.7 Forget and the kill switch

| Preference group | "Forget my formatting choices" | `NEXT_PUBLIC_REMEMBER_CHOICES=0` |
|---|---|---|
| `tinydocy-choices` (10 remembered choices) | **cleared** | not read, not written (today) |
| `appearance` (`tinydocy-theme`) | kept | **stored** (today) |
| Page settings, `a11y`, `spellcheck`, `smartQuotes`, `outline`, `simpleToolbar` (`tinydocy-ui`) | kept | **session only**, with the "not saved" line. `simpleToolbar` changes from "disabled with a reason" to session-only, so all settings behave the same way. |
| `rememberPlace` / `tinydocy-continue` | kept | forced off (today) |
| `identity`, `usageStats`, formats, folds, `activeTabId` | kept | unaffected (today) |
| Library `doc_view` | kept | the library origin is expected to keep R = 1. If 0, per-document width is session-only too. |

- Desktop builds don't carry the flag. Desktop "Forget my formatting choices" clears the renderer's `tinydocy-choices` exactly as on the web.

### 5.8 Per-document width

- **Read before mount.** `local-session.open(docId)` reads `doc_view` (SQLite on desktop, IndexedDB on the web library) together with the document. It returns `{ width, place }`. `PageFrame` renders with `data-doc-width` already set, so there is no jump. The skeleton shows the app default, as Details §4 accepts.
- **Write.** `setDocWidth(docId, width | null)` writes the row (SQLite through main's worker; IndexedDB `put`) and notifies `PageFrame` through a per-document listener.
- **"Use for all documents."** One action:
  - set the `page.width` override (or drop it, if it equals the style's width)
  - clear this document's row
- **"Reset them"** (Settings) clears every `doc_view.width` in one statement or transaction. The pill offers Undo, which restores the previous rows from memory.
- **Never written by default.** A row exists only when a document differs from the default. Choosing the default's value in the popover deletes the row.

### 5.9 Outline docking

- **The rule.** The outline docks when **main-area width ≥ card width + 302 px** (the 270 px outline + a 32 px gutter, read from `toc-sidebar.scss`, not derived).
  - **Card width** = `measure × size + 96` px, computed from preferences, never measured, so nothing changes on its own.
  - **Main area** = the element beside the files sidebar. A `ResizeObserver` on it flips one boolean only when the threshold is crossed. It never fires during typing.
- **Special cases.**
  - Full never docks.
  - `classic` = 648 + 302 = **950 px**, which is today.
  - Below the threshold the outline is the overlay, closed by default, as today.
- **Generated table** (written into the Details §4 amendment; the code uses the formula):

| Text size → | 14 | 16 | 18 | 20 | 24 | 28 | 32 |
|---|---|---|---|---|---|---|---|
| Narrow (30 em) | 818 | 878 | 938 | 998 | 1118 | 1238 | 1358 |
| Standard (33 em) | 860 | **926** | 992 | 1058 | 1190 | 1322 | 1454 |
| Wide (46 em) | 1042 | 1134 | 1226 | 1318 | 1502 | 1686 | 1870 |
| Full | never | | | | | | |

- **Per document.** A per-document width changes that document's threshold only. Interface zoom works in CSS px, so it is already included.

### 5.10 Smart quotes and spellcheck without rebuilding the editor

- **Smart quotes.** In `document-editor-config.ts`, Typography becomes `Typography.extend({ addInputRules })`.
  - Each parent rule is wrapped in a new `InputRule` with the same `find`. Its `handler` returns `null` when `document.documentElement.dataset.smartQuotes === "off"`.
  - Tiptap's input-rules runner treats `null` as "no match", so the typed character is inserted as is. Verified in `@tiptap/core` `InputRule.ts`: `if (handler === null || !tr.steps.length) return false`.
  - It reads a DOM attribute, so it imports nothing. The extensions array keeps its identity, with no `setOptions` (AGENTS).
  - **Cost:** ≤ 150 B gz in the editor chunk, measured by `check-editor-chunk-size` and paid from the existing +23.5 KB headroom. No contract amendment is needed.
  - **Code is excluded.** Tiptap's input rules already skip code nodes and marks whose spec has `code: true` (`InputRule.ts:229-232`).
    - `@docs.plus/extension-inline-code` sets `code: !0` on its mark (checked in `dist/index.js`).
    - Tests guard it anyway: typing `"`, `--` and `->` inside a code block and inside inline code leaves them straight, with the setting on.
  - **iOS Smart Punctuation** (v8, phones design §5.7) curls quotes and dashes in the keyboard itself, before TinyDocy sees them. It **ignores this switch**, and possibly `autocorrect="off"` inside code (M18 checks). The Writing pane's hint doesn't promise otherwise; Help › "Using TinyDocy on a phone" says to turn off Smart Punctuation in iOS Settings for straight quotes.
- **Spellcheck.**
  - The `spellcheck` attribute is inherited, so the boot script and `applyPrefs` set `spellcheck="false"` on `<html>`, and every editable element follows. When On, the attribute is absent and the browser default applies, which is today. **0 bytes in the editor chunk.**
  - Desktop also sets `session.setSpellCheckerEnabled` and, on Windows and Linux, `setSpellCheckerLanguages` from bundled dictionaries. The dictionary download URL points at the app bundle, so spelling makes no network requests (Plan §14).
- **Reading mode.**
  - Uses `WriteGate`'s `canWrite()` ref (P2.2): `canWrite = () => !readingMode && …`.
  - `PageFrame` sets `data-reading`, which hides the toolbar row through CSS.
  - Nothing is stored. "Reading mode writes nothing" (Plan exit criterion) is tested by asserting that no Yjs update is emitted while toggling and scrolling.

### 5.11 Dark `--primary` contrast fix (F1, before P2.9c)

- **The bug.** `text-primary` and `border-primary` with dark `--primary` `#973c00` measure 2.78:1 on `--background`, 2.51:1 on card, popover and sidebar, and 2.12:1 on muted. That fails both 4.5:1 and 3:1.
- **The fix: a separate ink token.**
  - Add `--primary-ink`: light = `var(--primary)` (`#bb4d00`, 5.05:1 on white); dark = `oklch(0.769 0.188 70.08)` (`#fe9a00`, today's dark `--sidebar-primary`).
  - Measured in the dark theme: 9.23:1 on background, 8.35:1 on card, popover and sidebar, 7.05:1 on muted, 6.94:1 on secondary.
- **Usage.** Map `--color-primary-ink` in `@theme`. Switch the `link` variants of `button.tsx` and `badge.tsx` and `heading-filter.tsx:116` to `text-primary-ink` / `border-primary-ink`.
- **Fills unchanged.** `--primary` as a fill with `--primary-foreground` (6.88:1) stays as it is.
- **Test.** The token contrast unit test (§5.15) covers `--primary-ink` on every surface in both themes and in both contrast sets.
- **Size.** S: 0.5 day, design review with screenshots of the heading filter and link buttons.

### 5.12 Identity validation (F2) and link underlines (F5)

**Identity**, in `lib/user-identity.ts`:
- **Storage.**
  - Every `localStorage` call is wrapped in try/catch. On failure an in-memory identity is used for the session, so blocked storage never throws.
  - The payload is parsed with a validator, not a cast.
- **Name.** Normalised in this order:
  1. NFC
  2. trim
  3. collapse runs of whitespace to one space
  4. remove C0 and C1 control characters and the bidi embedding, override and isolate controls (U+202A–U+202E, U+2066–U+2069)
  5. **keep** ZWNJ and ZWJ (U+200C and U+200D), which Persian names and emoji need
  6. 1–32 graphemes (`Intl.Segmenter`)
- **Invalid names.**
  - In the dialog: inline errors ("Enter a name." / "Use 32 characters or fewer."), and the field keeps focus.
  - From storage: regenerate.
- **Colour.** Must be one of `CARET_COLORS` (case-insensitive). Anything else from storage is replaced by a random allowed colour.
- **Receiving side.** Awareness names from other clients are clamped and stripped the same way at render (P4.7 adopts the function). This is the OWASP item, because names are broadcast.
- **Size.** S: 0.5 day, with unit tests for each rule (including a Persian name with ZWNJ and an RTL-override attack string).

**Links (F5):**
- Add `.tiptap a { text-decoration: underline; text-underline-offset: .15em }`.
- Check that `@docs.plus/extension-hyperlink`'s `text-decoration: none` (`styles.css:324`) targets only its popover, and override it if it hits document links.
- This is WCAG 1.4.1, not a setting. S, with screenshots in the design review.

### 5.13 Bundled fonts

| Family | Licence | Source | Weights | Estimated woff2, Latin + Latin Ext (measure in P2.9c-2) |
|---|---|---|---|---|
| Arial (Default) | system | not bundled; stack adds `"Liberation Sans", Arimo` | — | 0 |
| Inter (Sans) | OFL 1.1 | already self-hosted by `next/font` for the chrome | — | 0 |
| Source Serif 4 | OFL 1.1 | `@fontsource-variable/source-serif-4` | variable, roman and italic | about 60–90 KB each |
| JetBrains Mono | OFL 1.1 | `@fontsource-variable/jetbrains-mono` | variable, roman and italic | about 40–60 KB each |
| Atkinson Hyperlegible Next (Q3) | OFL 1.1 (Braille Institute) | `@fontsource-variable/atkinson-hyperlegible-next` (P2.9c-2 verifies the package exists and passes `minimumReleaseAge`; otherwise use the upstream release with the same `@font-face`) | variable, roman and italic | about 30–60 KB each |

- **Lazy with no JS.**
  - `@font-face` rules (with `font-display: swap` and fontsource's `unicode-range` split) live in a small global stylesheet, outside the editor chunk.
  - A browser downloads a face only when rendered text uses that family and range, so people who never pick a font download nothing.
  - The boot script's `preload` link removes the swap flash for the chosen font.
- **Offline.**
  - Files are imported through the bundler, so they land in `/_next/static/media` with hashed names.
  - The service worker caches `/_next/static` cache-first, so a chosen font works offline after its first use. Files in `public/` would not be cached.
  - The desktop static export bundles them. Desktop CSP `font-src 'self'` covers them.
- **Fallback metrics.** Each family gets a fallback `@font-face` with `size-adjust` and `ascent-override` tuned against its stack, so swapping causes little reflow.
- **Licences.** OFL texts are added to About › Third-party notices (desktop) and the web licences page, generated from the packages.

### 5.14 Bundle impact

| Chunk | Change | Budget |
|---|---|---|
| Editor (eager) | **+0 B** for page, appearance, spellcheck and reading mode (CSS, the boot script and `WriteGate`, which P2.2 already pays for). HeadingScale's unit change is about ±0 B. Smart-quotes gate ≤ 150 B gz. | Existing +23.5 KB headroom. P2.9c records the measured bytes in the PR. |
| Page popover | new lazy chunk, target ≤ 6 KB gz | Fetched on idle after the editor, like the slash menu |
| Settings panes | new lazy chunk, shared by the desktop window and W13, target ≤ 14 KB gz (adds Switch, Select, RadioGroup from P2.9b) | Desktop: its own window. Web: on first open. |
| Prefs palette actions | lazy, with the palette | Palette budget (A7, 20 KB gz) |
| Global CSS | about +3 KB gz (variables, styles, `classic`, high-contrast set, `@font-face`) | — |
| HTML | boot script about +0.9 KB per response | — |
| Fonts | 0 until chosen | — |

### 5.15 Tests

- **Unit** (`bun test`):
  - schema allowlists and defaults
  - `resolvePage` (style + overrides → effective; Custom detection; Use for all; Reset)
  - the migration matrix (§5.6 rows × R=0)
  - boot-script parity (§5.3)
  - theme System with a mocked `matchMedia`, including the listener
  - `CHOICE_SLOTS` contract update
  - identity validation (§5.12)
  - the smart-quotes gate (on, off, code block, inline code)
  - the **token contrast test**: every theme × contrast set, body ≥ 7, muted ≥ 4.5, focus and controls ≥ 3, `--primary-ink` ≥ 4.5 on every surface, text on each highlight token ≥ 4.5
  - desktop `prefs` JSON round-trip, downgrade (higher `v`), invalid values
  - `doc_view` cascade on purge
- **Playwright `chromium`** (and `local` / Electron where marked):
  1. **No jump on load:** for each style and width, the skeleton card and the editor card have the same width, and no layout shift is recorded on the card.
  2. **Classic pixel test:** identical to `main` on the §5.6 fixture.
  3. **Measure guard:** Standard gives 60–75 characters per line in the default font at every text size.
  4. **WCAG 1.4.12 audit** at Narrow, 32 px, Wider, with the text-spacing override injected: toolbar, Page popover, Settings, slash menu, palette, outline, tab strip, Continue chip, table cells, inline code, collaborator labels and hover cards. Nothing clips or overlaps.
  5. **Browser zoom stays the browser's:** on the web, ⌘+ / ⌘− / ⌘0 events are not `defaultPrevented`.
  6. **Desktop (`local` / Electron):** ⌘+ changes Text size, ⌘0 resets it, and Ctrl+wheel steps it.
  7. **Per-document width:** set in the popover, survives reload, Use for all, Reset, and another document keeps the default. Library: W5; desktop: `local`.
  8. **Cross-tab and cross-window:** a change in one tab or window applies in the other without reload.
  9. **R=0 build:** settings apply for the session, nothing is written to `localStorage`, `classic` is the fallback, and the "not saved" line shows.
  10. **Emulation:** forced colours, `prefers-contrast: more`, reduced motion and `data-motion`.
  11. **Outline docking** at the table's thresholds ± 1 px, with the files sidebar open.
  12. **Spellcheck off:** `spellcheck` is false on `.ProseMirror`.
  13. **Reading mode:** no Yjs update is emitted while toggling and scrolling.
- **Cross-browser:** a Persian document at every spacing and letter-spacing step on `chromium`, `webkit` and `firefox`, checking joining, diacritics and caret movement. If a browser breaks joining, letter spacing is scoped with `:lang()`.
- **`perf`:**
  - Text size and spacing changes on the 1,000-heading fixture cause one layout and zero HeadingScale decoration rebuilds.
  - Typing latency is unchanged.
  - `check-editor-chunk-size` passes.
- **Electron:**
  - no white or dark flash at launch in either theme
  - the CSP hash matches the boot script (a build test)
  - changing Appearance in Settings retints every window and the native titlebar

---

## 6. Owner questions

| # | Question | Options | Recommendation |
|---|---|---|---|
| **Q1** | Default text size for new users and desktop | (a) **16 px**, ladder 14–32 (Standard card 624 px, about 71 characters per line). (b) 15 px, ladder 13–30 (today's size). | **(a).** It matches the browser default, so `1rem` honours each reader's own browser setting. 13 px is too small for long reading. Existing sandbox users don't see it change, because of `classic`. |
| **Q2** | Smart quotes switch in v1, which costs ≤ 150 B gz in the editor chunk (against an editor-chunk target of +0) | (a) **Ship the switch** (default On, as today) and pay the bytes from the existing headroom. (b) Keep Typography always on in v1 (+0 B) and add the switch later. | **(a).** Curly quotes in pasted code are the known complaint against smart substitutions. The audience writes code and Markdown. The cost is one gate and no extension rebuild. |
| **Q3** | High legibility beyond D10: a fifth bundled font, **Atkinson Hyperlegible Next** (OFL), and **Letter spacing** (Normal / Wide / Wider) | Yes to both / font only / spacing only / neither (High legibility then uses Arial and Normal letters) | **Yes to both.** Both are lazy and CSS only. Wider is exactly the WCAG 1.4.12 set we must pass anyway. The evidence is moderate for spacing and for *offering* a font choice, not for the font itself. Cut first if P2.9c slips. |
| **Q4** | Increase contrast and Reduce motion overrides ("System / Always") | (a) **Web only**, desktop follows the OS. (b) Both platforms. (c) Neither: follow the OS everywhere. | **(a).** Apple's HIG says don't duplicate system settings on desktop. On the web, people on shared or locked machines can't change the OS. |

---

## 7. PR mapping

### 7.1 PRs

| PR | Owns | Depends on | Effort (agent-days, review rounds) | Exit criteria |
|---|---|---|---|---|
| **F1** dark `--primary-ink` (web fix) | §5.11 | — | S: 0.5 d, 1 round | Contrast unit test green; heading filter and link buttons ≥ 4.5:1 in dark; design review |
| **F2** identity validation (web fix) | §5.12 identity | — | S: 0.5 d, 1 round | Blocked storage doesn't throw; every rule tested |
| **F3** theme System on the web (web fix) | `appearance` (web), shared `setTheme()`, boot System branch, `theme-color`, live listener, the theme half of §5.6 | — | S–M: 1.5 d, 2 rounds | Existing browsers stay Light; new browsers follow the OS with no flash; one writer |
| **F5** link underlines (web fix) | §5.12 links | — | S: 0.5 d | Every document link is underlined; design review |
| **P2.9c-1** page engine (shared; web-visible) | `lib/prefs/*` schema, web store, boot script v2 + parity test, CSS variables (§5.4), HeadingScale em, the paragraph/list/table/heading fixes, `classic` and the §5.6 page migration, `page.size`, `page.width`, `page.spacing`, the Full cap, skeleton, `PageFrame`, outline docking (§5.9), `spellcheck`, `smartQuotes` gate, `rememberPlace`, `readingMode`, `a11y` (`contrast`, `motion`), the high-contrast token set, the `prefersReducedMotion` helper | P2.2 (`WriteGate`), F3 | L: 5 d, 3 rounds | No jump on load; `classic` pixel-identical; measure guard; `perf` shows one layout and no regression; editor chunk ≤ +150 B gz |
| **P2.9c-2** page choices and UI (shared) | `page.font` + bundled fonts (§5.13), `page.letters` (Q3), styles and Custom, the Page popover (lazy), `doc.width` on desktop (`doc_view`, `local-session.open`), the shared `components/settings/panes/page` and `writing`, prefs palette actions, the web ⋯ Page… item, the desktop View menu items | P2.9c-1, P2.6 (creates `doc_view` per the §7.3 amendment; if P2.6 has already merged, P2.9c-2 adds the table through the migration hook) | M–L: 4 d, 2–3 rounds; **design review** | 1.4.12 audit passes; RTL check on three engines; fonts load only when chosen and work offline |
| **P2.9a** (existing) | View › Text Size / Page Width / Font / Reading Mode, ⌘+ / ⌘− / ⌘0 → text size, Ctrl+wheel, Edit › Spelling reading `spellcheck`, removal of the zoom items | P2.9c-1 | +0.5 d inside P2.9a | UX §11 checklist |
| **P2.9b** (existing) | The Settings window (General, Page and Writing panes mounted from P2.9c-2; Storage, Updates, About), Switch/Select/RadioGroup, the main prefs store (`meta('prefs')`, IPC, validation, broadcast), preload boot snapshot + CSP hash, `appearance` via `nativeTheme`, `zoom`, `startup`, `dockRecent`, `spellLanguages`, `backupFolder`, the Trash line, reset with Undo, last pane | P2.9c-2 | +2 d on top of P2.9b's own scope | Every pane is keyboard-only operable; a change applies live in every window; no flash at launch |
| **P3.3** (existing) | `updates.auto`, `updates.channel` rows | P2.9b | in scope | — |
| **P4.0 / P4.4 / P4.7 / P4.10** (existing) | identity into `meta`, the identity prompt and General row, awareness-name sanitising on receive, Hide Comments per window | F2 | in scope | — |
| **W5** (existing) | The library mounts the Page popover with `doc.width` on IndexedDB `doc_view` and `place` | P2.9c-2, W2 | +0.5 d | Per-document width e2e on the library |
| **W13** (new) web Settings dialog | Dialog and sheet shell, General (appearance, contrast, motion, identity), Page and Writing (from P2.9c-2), Privacy (sandbox: `usageStats`, offline copies), Storage slot for W6 (library), R=0 line, origin note, `ui.settingsPane` | P2.9c-2, F2, F3 | M: 2.5 d, 2 rounds; **design review** | Keyboard checklist; screenshots at 1440, 820 and 375 px, light and dark |
| **F4** (optional) fold storage hygiene | version, cap (100 documents), 30-day expiry, cleanup on document delete for `tinydocy-folds-*` | — | S: 0.5 d | Not a preference; listed because the inventory found it |

**Order:**
1. F1, F2 and F5 at any time.
2. F3 before P2.9c-1.
3. P2.9c-1 → P2.9c-2 → P2.9a / P2.9b / W13 in parallel.
4. W5 after W2.

This moves P2.9c ahead of P2.9b in Plan §8, because Settings mounts P2.9c's panes.

**Totals:** about 17.5 agent-days (F4 excluded):
- 14 days in 7 PRs of their own: F1, F2, F3, F5, P2.9c-1, P2.9c-2 and W13
- 3.5 days added to existing PRs: P2.9a, P2.9b and W5

**Design reviews.** Every PR with a visible change has one. That is 7: F1, F3, F5, P2.9c-1, P2.9c-2, P2.9b and W13.

### 7.2 Cut first, in order

1. **Letter spacing** (`page.letters`). High legibility keeps size, width and spacing.
2. **The Legible font.** High legibility uses Default (Arial).
3. **Style tiles with a preview.** They become a plain radiogroup without previews.
4. **Web contrast and motion overrides** (Q4). Both platforms then follow the OS only. The high-contrast token set stays, triggered by `prefers-contrast`.
5. **Mono font.**
6. **F4.**

**Never cut:** `classic` and the theme migration (the no-surprise promise), em widths, the paragraph/list/heading variable fixes, the skeleton fix, F1, F2.

### 7.3 Amendments to other docs (one docs-only PR before P2.9c-1)

- **UX spec:**
  - §2.3 Ctrl+wheel row (C2)
  - §2.4 View menu (§4.5)
  - §4.6 Zoom row (C2)
  - §7 table and panes (C1, C4, C10, C18; rows from §2.1)
  - §8.4 (C2, C4)
- **Details spec:**
  - §4 table, popover sketch, outline table and the "web gets" sentence (C1, C5, C6, C7, C9, C19; §4.3 here)
  - §11 rows on outline docking and ⌘+/− (C9)
  - §13 "Editor" call
- **Plan:**
  - §8 P2.9c row split into P2.9c-1 and P2.9c-2, and the order before P2.9b (C12)
  - §8 P2.6 row: the schema adds `doc_view(doc_id, width, place, remote_images)` (§5.2), so no later migration is needed
  - §14 "app-wide page width" (C7)
- **Architecture:** D-A5's Local-release tables gain `doc_view`, and `meta` gains the `prefs` row (§5.2)
- **Comments design:** §11 l.499 (C14)
- **Toolbar spec:** §5 l.161 (C16)
- **Web library design:** §7.1 Page popover row (already says "Same"; add `place`), §11 adds W13, §2.2 `doc_view` gains `place`
- **AGENTS.md:** after P2.9c-1 merges, the "Learned Workspace Facts" gain one line on `lib/prefs/`, the boot script, the `classic` state and `PageFrame`
- **CHANGELOG:** each PR adds its own entry (AGENTS)
