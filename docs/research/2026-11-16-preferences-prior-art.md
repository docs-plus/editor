# Preferences in writing and document apps: prior art, demand, and what to offer

- **Status:** Research for owner review (2026-11-16). Nothing is built. This document changes no other file.
- **Reads with:** [Title, tags and page preferences](2026-11-15-title-tags-page-preferences.md) (§3 page preferences, §5.4 Settings › Editor), [Desktop UX spec](../superpowers/specs/2026-11-15-desktop-ux-design.md) (§7 Settings window, §8.4 text scaling).
- **Question:** What app-level and page-level preferences do the best writing and document apps offer? Which ones do people use and ask for, and which are noise? What should a lightweight local-first editor (TinyDocy) offer?
- **Method:** Web research on 2026-11-16. Sources were official help pages, HIGs, changelogs, forums, GitHub issues and essays (§7). Demand comes from three signals:
  1. **GitHub reactions** on AFFiNE and Logseq issues, from the GitHub search API on 2026-11-16.
  2. **Obsidian community-plugin downloads.** These are cumulative counts from `obsidianmd/obsidian-releases/community-plugin-stats.json`, fetched 2026-11-16. They count downloads, not users. A plugin that fills a gap in a core setting is a demand signal for that setting.
  3. **Forum threads** (Obsidian, Bear). None of the fetches could see vote counts, so threads are reported by reply count, age or the "valuable" tag, never by a vote number.
- **Known gaps (not filled from memory):**
  - **Arc:** no evidence gathered.
  - **GNOME:** only the older wiki "Configuration" pattern (marked Experimental) and mailing-list posts were reached, not the current HIG page on preferences.
  - **Apple Pages:** only the smart-quotes setting was verified.
  - **Notion feedback board:** not reached. Notion demand evidence is Notion's own FAQ, a notion-enhancer issue and third-party guides.
  - **Bear:** the main font-size thread returned 404.
  - **Craft:** page width is unverified.
  - **Defaults:** most Linear and iA Writer defaults and all Word AutoFormat defaults are not stated in their docs. They are marked "not stated" below.

---

## 0. Findings in one screen

1. **Most people never change a setting, so the defaults are the product.**
   - In Jared Spool's study of Word settings files (early PC era, self-selected sample, published 2011), "less than 5% of the users we surveyed had changed any settings at all."
   - Programmers and designers changed far more, often over 40% of the options. [UIE]
   - Apple's HIG, NN/g, Havoc Pennington (2002) and 37signals all reach the same rule from different directions: make the defaults right and keep the list short.
2. **A small core set exists in almost every app:**
   - theme (System / Light / Dark)
   - text size
   - line width
   - font, as a few presets
   - spellcheck
   - what opens on start
   - trash behaviour
   - updates

   Most other settings come from one app's niche, for example Markdown syntax style in iA Writer and link format in Obsidian.
3. **Line width is the preference people fight for most.**
   - Obsidian's "Adjustable readable line length" request has been open since October 2020 and is tagged valuable.
   - Obsidian's "Editor Width Slider" plugin has about 94k downloads.
   - Notion's FAQ answers "Not yet" when asked whether full width can be the default.
   - Confluence users asked for the same default, and Atlassian added it.
   - AFFiNE has an issue asking for per-document full width.
4. **Page options without a default are the most common complaint.**
   - Notion's per-page Font, Small text and Full width have no account-wide default. Every new page must be set by hand, and add-ons and templates exist only to work around it.
   - Google Docs ("Page setup › Set as default") and Craft ("Set as Default Style") let you set the default from the page itself.
   - **Copy that pattern.**
5. **Two settings are top demands in local-first and open apps: privacy, and where the data lives.**
   - AFFiNE's "Disable AI and Telemetry" (53 reactions) is among its five most-reacted issues.
   - So are "Select local storage path" (17) and "Encryption for local storage" (25).
   - Logseq's most-reacted settings issue is moving config to XDG paths (80).
6. **Hiding the interface is a large unmet need in Obsidian.**
   - "Hider" (about 484k downloads) and "Focus Mode" (about 77k) hide interface parts.
   - Two typewriter-scroll plugins have about 119k and 115k downloads.
   - "Remember cursor position" (about 213k) shows demand for restoring where you were.
7. **Settings search arrives when settings grow.**
   - Obsidian shipped native settings search only in 1.13 (May–July 2026), years after the request. It then deprecated the community plugin that filled the gap.
   - After the 2022 macOS redesign, reviewers recommended search as the way through System Settings.
   - A list of about 25 settings does not need search. A command palette that reaches every setting is enough.

---

## 1. Catalogue: preference categories across apps

**Columns:**
- **Offered by:** verified in the cited docs. "—" means not found in that app's docs, not that it is absent.
- **Scope:** only where a source states it. Otherwise "not stated".
- **Default:** only where stated.
- **Demand:** the strongest evidence found.

### 1.1 Appearance and typography

| Category | Offered by | Scope | Default | Demand evidence |
|---|---|---|---|---|
| **Theme: System / Light / Dark** | Obsidian (Adapt to system / Light / Dark); iA Writer (Light / Dark / Match system); Ulysses (each theme has light and dark; "Always Use Light Theme"); Notion (Use system setting / Light / Dark, plus Cmd/Ctrl+Shift+L); Linear (Light / Dark / system); Windows guidance says use a combo box with "Use system setting" | Notion: account preference. Others: not stated | Notion, iA, Obsidian offer "system" first | Universal. Microsoft's app-settings guidance names it as a standard setting. |
| **Accent colour / custom themes** | Obsidian (accent colour, community themes, CSS snippets); Linear (custom themes, 70+ on linear.style); Bear (themes, some Pro-only); Ulysses (themes) | not stated | not stated | Power-user demand: Obsidian "Style Settings" about 2.85M downloads, "Minimal Theme Settings" about 1.89M. Not asked for by general users in the trackers searched. |
| **Font** | Notion per page: Default / Serif / Mono. Craft page style: System / Serif / Mono / Rounded (no custom fonts). iA: Mono / Duo / Quattro. Obsidian: interface, text and monospace fonts (any installed). Bear: any installed font for text, headers and code. Ulysses: font in Settings › General. | Notion: per page, seen by all viewers. Craft: default per space. Others: not stated | Notion: Default (sans) | Most writing apps offer three or four presets, not a font picker. AFFiNE "more flexibility on appearance or custom CSS" has 4 reactions. |
| **Text size** | Obsidian (px slider, plus Ctrl/Cmd+scroll, pinch, Increase/Decrease commands); iA (slider; Editor only); Bear; Ulysses (View zoom, ⌘+/⌘−/⌘0, reset to "Default Size"); Apple Notes ("Default text size"); Linear (font size); Notion per page ("Small text") | **Obsidian: per device, not synced by Obsidian Sync.** Notion: per page | not stated | Bear users asked for the old font size back after Bear 2. Logseq "Zoom level is not persistent": 18 reactions. AFFiNE "Font size": 7. |
| **Page width / line length** | Obsidian "Readable line length" (on/off, fixed width); iA line length limit 64 / 72 / 80 characters (display only); Bear "Line width" (in 8 em steps; visible on iPad, not iPhone); Ulysses line width (Mac) and line length (iPad); Notion "Full width" per page; Google Docs Pages vs Pageless per document | Notion: per page, desktop and web only. Google Docs: per document plus "Set as default". Obsidian: app | Obsidian: width about 700 px (forum); on/off default not stated | Obsidian "Adjustable readable line length" (open since 2020-10-25, tagged valuable). "Editor Width Slider": about 94k downloads. Bear "Need finer width options". WCAG 1.4.8 (AAA) asks for a way to keep lines at 80 characters or fewer. |
| **Line spacing / paragraph spacing / indent** | Bear (line height, paragraph spacing, paragraph indentation); Ulysses (line height, paragraph spacing, first-line indent) | not stated | not stated | Bear users noticed when paragraph spacing went missing from early Bear 2 betas and it came back. AFFiNE per-heading typography: 1 reaction. WCAG 1.4.12 requires content to survive user spacing overrides. |
| **Interface zoom** | Obsidian (Zoom level, advanced); Ulysses (text zoom) | not stated | 100% | Logseq persistent zoom: 18 reactions. |

### 1.2 Editor behaviour

| Category | Offered by | Scope | Default | Demand evidence |
|---|---|---|---|---|
| **Smart quotes and dashes** | Google Docs (Tools › Preferences); Pages ("Use smart quotes and dashes", Auto-Correction); iA (Smart substitutions: Quotes, Dashes; separate "smart punctuation" for Preview and exports only); Word (AutoFormat "Straight quotes with smart quotes", "Hyphens with dash"); Bear (follows macOS Edit › Substitutions) | app | Google Docs: on (secondhand, Laptop Mag). Others: not stated | **For:** Obsidian lacks it, and "Smart Typography" has about 178k downloads. **Against:** curly quotes break pasted code. Notion is named as a source of curly quotes in `.md` files, and Bear has an FAQ on turning them off. |
| **Format as you type (Markdown shortcuts, auto-lists)** | Google Docs ("Automatically detect Markdown", **off by default**, March 2022; "Automatically detect lists", Backspace undoes it, 2014); Word AutoFormat ("Automatic bulleted lists", "Built-in Heading styles", "*Bold* and _italic_ with real formatting") | app | Google Markdown: off. Google lists: on. Word: not stated | The Word and Google Docs "turn off autocorrect" guides are some of the most-written help topics. Google's Backspace-undo is the accepted way to recover. |
| **Auto-pair brackets / Markdown syntax** | Obsidian (Auto-pair brackets; Auto-pair Markdown syntax); iA ("Insert and type-over matching brackets", "Wrap selection in typed brackets"); Typora (Auto Pair) | app | not stated | No demand found from rich-text users. It is a code-editor and Markdown-source habit. |
| **Spellcheck, grammar, autocorrect** | Obsidian (Spellcheck; languages on Windows and Linux, macOS detects); iA (check while typing, grammar, correct automatically, predictive text); Linear desktop (Spell check); Google Docs (spelling, grammar, autocorrect, substitutions list); Pages | app | Obsidian: on (community reference) | Logseq "Changing language does not update spell-checker language": 9 reactions; "spell check uses system language, no way to change it". LanguageTool (about 330k) and Harper (about 134k) plugins for Obsidian. |
| **Paste behaviour** | Obsidian ("Convert pasted HTML to Markdown"); Typora image-insert rules ("Allow copy images to given folder", "Use relative path if possible"); iA ("Copy/paste spacing adjustment") | app | not stated | Obsidian "Paste URL into selection" has about 518k downloads, a paste behaviour people expect by default. |
| **Default first block ("new notes start with")** | Apple Notes: Title / Heading / Subheading / Body | app | not stated | No demand found elsewhere. Does not apply to TinyDocy: the schema always starts a document with an H1 title. |
| **Tab / indent** | Obsidian ("Indent using tabs", "Indent visual width"); iA (a full Indentation group: tabs or spaces, Tab key behaviour, tab and indent width 2/4/8, list indentation, wrapped-line indent, **Restore Defaults**) | app | not stated | Only relevant to Markdown-source editors. |
| **Markdown syntax style** | iA (ATX/Setext headings, bullet character, emphasis characters, table padding); Obsidian (Wikilinks vs Markdown links, link path format, Strict line breaks) | app | not stated | Niche, and only for source-format files. |
| **Default view and mode** | Obsidian ("Default view for new tabs": Reading / Editing; "Default editing mode": Live preview / Source) | app | not stated | — |
| **Text direction** | Obsidian ("Right-to-left (RTL)" default direction) | app | off | AFFiNE "RTL Text Direction Support": 22 reactions, open. |
| **Vim keybindings** | Obsidian (Advanced); AFFiNE request | app | off | AFFiNE "Vim keybindings": 19 reactions. |

### 1.3 Files, startup and safety

| Category | Offered by | Scope | Default | Demand evidence |
|---|---|---|---|---|
| **Default location for new documents** | Obsidian (vault root / same folder / chosen folder; attachments separately); iA ("New in Library" or untitled file); Apple Notes (Default account) | Obsidian: per vault | not stated | AFFiNE "Select local storage path": 17 reactions. Logseq move config to XDG paths: 80. |
| **Startup / restore** | Notion desktop ("continue where you left off" or default page); Linear ("Default home view"); iA ("Close when quitting": don't restore open files); Apple Notes ("Always resume to last Quick Note") | Notion: device (desktop app) | Linear: team's Active issues | Obsidian "Remember cursor position": about 213k downloads. |
| **Confirm on delete / where deleted files go** | Obsidian ("Confirm file deletion"; deleted files to system trash, vault `.trash` or permanent) | Obsidian: per vault | not stated | Obsidian "Trash Explorer" (about 69k): people want to *see* the trash, not configure it. |
| **Trash retention** | Notion: 30 days (Enterprise owners can change it); Apple Notes Recently Deleted: 30 days | Notion: workspace | 30 days | No demand found for user-set retention outside enterprise compliance. |
| **Save / autosave** | iA ("Files always save automatically"; "Ask to keep changes when closed"); Typora (Auto Save page) | app | iA: always saves | Spool's study: Word shipped autosave off by mistake, so about 95% of users ran without it. |
| **Backup** | Typically not a setting in these apps. Obsidian relies on plugins. | — | — | Obsidian "Git" about 3.47M downloads, "Local Backup" about 96k, "Remotely Save" about 2.38M. |

### 1.4 Sync, privacy, updates, shortcuts, locale

| Category | Offered by | Scope | Default | Demand evidence |
|---|---|---|---|---|
| **Settings sync / sharing** | VS Code Settings Sync (settings, keybindings, extensions); Obsidian (per vault `.obsidian`, synced by Obsidian Sync except font size); Craft defaults per space | VS Code: user, workspace, folder, language, profile, policy | off until enabled | Obsidian "Global settings across multiple vaults" (2022-08-13, 160+ posts, tagged valuable). |
| **Privacy / telemetry** | Notion ("Show my view history", "Profile discoverability"); Logseq ("Send diagnostics", complaint that it is on by default) | Notion: account | Logseq: on (complained about) | **AFFiNE "Disable AI and Telemetry": 53 reactions**; "disable AI / CoPilot… when?": 15. |
| **Updates** | Obsidian ("Automatic updates", "Receive early access versions") | app | not stated | — |
| **Keyboard shortcut customisation** | Obsidian (Hotkeys pane with filter); VS Code (keybindings.json, synced); Typora (`keyBinding` in JSON, Windows/Linux); Linear ("Cmd/Ctrl+Enter or Enter submits comments"); Notion: only Command Search and AI shortcuts on desktop | app | — | Obsidian "Hotkey Helper" about 98k; "Hotkeys++" about 103k. Remap requests are common on other trackers (Figma, RemNote, Anytype). No Notion thread was verified. |
| **Language / locale / dates** | Obsidian (Language); Notion (Language, "Start week on Monday", time zone manual or automatic); Linear ("First day of the week") | Notion: account | regional | Logseq "i18n support of the weekdays in Dates": 29 reactions. |
| **Open links in the desktop app** | Notion (web), Linear | device | not stated | — |

### 1.5 Accessibility

| Category | Offered by | Scope | Default | Demand evidence |
|---|---|---|---|---|
| **Reduced motion** | GitHub ("Autoplay animated images": Sync with system / Enabled / Disabled; older GitHub Enterprise docs say motion follows the system by default). Apple HIG: respect system settings and don't duplicate them. | account | **follow system** | Few tracker requests. It is mostly an OS-level setting that apps are expected to honour. |
| **Contrast** | Notion ("High contrast": Use system setting / Standard / High contrast) | **Notion: per device**, desktop and web only | system | — |
| **Dyslexia-friendly font** | No studied app offers OpenDyslexic. Google offers **Lexend** in its font menu. Brightspace removed its OpenDyslexic option. | — | — | Evidence for OpenDyslexic is weak: Wery & Diliberto (Annals of Dyslexia, online 2016, vol. 67 2017) found no improvement in reading rate or accuracy. Spacing matters more than letterform in later studies. |
| **Focus indicators** | **No studied app offers this as a setting.** WCAG 2.4.7 makes visible focus mandatory, so it is not optional. | — | always on | That is the finding: it is a requirement, not a preference. |
| **Text scaling** | Obsidian (font size and zoom); Ulysses (⌘+/−); Linear (font size); Notion (Small text, per page) | Obsidian: per device | — | WCAG 1.4.4 (resize text to 200%). Logseq persistent zoom: 18. |
| **Screen-reader mode** | Google Docs (Tools › Accessibility: screen reader, braille, magnifier; per product since 2022) | per product | off | A canvas-rendered editor needs it. A DOM editor (ProseMirror) does not need a mode. |
| **Link underlines** | Linear ("Underlined links"); GitHub ("Link underlines") | account | not stated | Colour-blind users (WCAG 1.4.1). Cheap to offer. |

### 1.6 Modes and per-document overrides

| Category | Offered by | Scope | Default | Demand evidence |
|---|---|---|---|---|
| **Focus mode (dim or hide the rest)** | iA (Focus: Sentence / Paragraph / Typewriter); Ulysses (Highlight current line, sentence or paragraph); Obsidian (mobile "Full screen" only) | session / app | off | Obsidian "Hider" about 484k, "Focus Mode" about 77k, "Fullscreen mode" about 48k, "ProZen" about 39k. |
| **Typewriter scrolling** | iA (Focus scope: Typewriter); Ulysses (Fixed Scrolling top / middle / bottom / variable, line marker) | app | off | Obsidian "Typewriter Scroll" about 119k, "Typewriter Mode" about 115k. |
| **Reading mode** | Obsidian ("Default view for new tabs": Reading); Notion "Lock page" | Obsidian: app. Notion: per page | editing | — |
| **Lock page** | Notion: per page, makes it read-only for everyone. "Unlock for me" or "Unlock for everyone". Anyone with edit access can undo it, so it guards against accidents, not access. | **per page, all viewers** | off | — |
| **Per-document full width / small text / font** | Notion (all three per page, **seen by every viewer**); Google Docs (pageless per document, with **Set as default**); Craft (style per document, with a default style per space); Obsidian (only via `cssclasses` plus plugins) | per document | page default | Notion "Full width by default" requests (notion-enhancer #139; Notion FAQ "Not yet"; an August 2025 blog says database pages can now open full width by default, secondhand). Obsidian "Readable line length in frontmatter" and "Disable readable line length on single note" threads. AFFiNE #6720 (6). Confluence added a default for full-width new pages after requests. |
| **Show word count** | iA (status); Obsidian via plugins | app | — | Obsidian "Better Word Count" about 635k, "Novel word count" about 206k. |

---

## 2. Structure patterns

| Pattern | Who does it | Evidence and notes | For TinyDocy |
|---|---|---|---|
| **Left sidebar of categories** (not top tabs) | macOS System Settings since Ventura; Windows 11 Settings (left nav, breadcrumbs, related settings at the bottom); Obsidian; Linear; Notion | Apple's HIG still describes a **toolbar of panes** for a Mac app's own settings window. Microsoft's older guidance suggests **about four or five top-level groups**. Ventura's sidebar was criticised for a fixed width and for "General" becoming a catch-all. | Keep the planned left nav (UX spec §7) with **five panes**: General, Editor, Storage, Updates, About. Don't add a catch-all. |
| **Instant apply, no OK / Apply** | GNOME (auto-apply, per a GNOME developer); Windows WinUI guidance ("apply immediately") | Agreed across platforms. | Already planned. |
| **Open with ⌘, and restore the last pane; title follows the pane** | Apple HIG | — | Already planned in part. Add **restore last pane**. |
| **Task options in context, not in Settings** | Apple HIG ("prefer letting people modify task-specific options without going to your settings area"); Notion ⋯ › Appearance & layout; Craft's Style inspector in the right sidebar; Google Docs File › Page setup | Page options live with the page in every app studied. | The ⋯ › Page… popover (11-15 doc §3.6) is right. |
| **"Set as default" from the page** | Google Docs Page setup; Craft "Set as Default Style" | This fixes Notion's top complaint (no default for per-page options). | **Copy it.** In the Page popover: "Use for all documents" when this document differs from the default (the 11-15 doc's "[Use for all]" is this pattern). |
| **Live preview** | Ulysses and Bear (the editor itself changes); Google pageless switch | — | Planned: the Settings › Editor static preview, and a live page behind the popover. |
| **Search in settings** | VS Code (search with `@modified`, `@id`, `@lang` filters); Chrome (search with highlighted matches and bubbles on controls that lead to subpages); Obsidian 1.13 (2026, after years of requests); macOS (reviewers recommend search over the sidebar); Windows 11 (an on-device AI agent in the Settings search box on Copilot+ PCs) | Search is needed when settings number in the dozens or hundreds. | **Not in v1.** About 25 settings fit five panes. Instead, every setting gets a **command-palette entry** that opens or flips it. |
| **Modified indicator and per-item reset** | VS Code (coloured bar; gear › Reset Setting; `@modified`) | Most useful when there are many settings. | **Per-section reset** is enough (iA "Restore Defaults" on its Indentation group; the planned "Reset editor settings"). |
| **Restore all defaults** | Typora ("Reset Advanced Settings", or delete the JSON); VS Code (clear `settings.json`) | — | One "Reset all settings" in About or General, with Undo. |
| **Settings as a file / JSON** | VS Code (`settings.json`, layered scopes, policies); Typora (`config.user.json` with comments, needs a restart); Obsidian (`.obsidian` per vault); Logseq (`config.edn`) | Power-user and developer apps. The Logseq XDG request (80) shows file-based config moves people to ask about *where* it lives. | **Avoid** in v1. Device-local storage in `tinydocy-ui` slots, no editable file. |
| **Import / export / sync of settings** | VS Code Settings Sync; Obsidian Sync (minus font size); Craft default per space | Obsidian users ask for global settings across vaults (160+ posts). | Not in v1. Desktop and web are separate devices. Revisit with accounts. |
| **Basic vs advanced** | Obsidian ("Advanced" sub-headings in each pane); VS Code ("Commonly Used" group); NN/g: "layer the options" | — | Put rare items last in their pane under a quiet "Advanced" heading. **No hidden advanced mode.** |
| **State the scope** ("this device" / "this document" / "everyone") | Obsidian docs say font size is per device; Notion says high contrast is per device; Notion's page options apply to all viewers | People can't tell otherwise. | Label scope in the control: "Applies to this document, on this device" for width. Everything else is "on this device". |

**Where page-level options live, across apps:**
- **⋯ menu:** Notion ("Appearance & layout", "Lock page").
- **Inspector panel:** Craft (Style tab).
- **Dialog from the File menu:** Google Docs (Page setup).
- **App settings plus front matter:** Obsidian (CSS classes, no UI).

None of them puts page options in a toolbar button. That supports the 11-15 decision: no new toolbar face, ⋯ › Page….

---

## 3. Anti-patterns and the "too many settings" debate

**The case against preferences:**
- **Havoc Pennington, "Free software and good user interfaces" (April 2002).** Each preference has a cost.
  - "Too many preferences means you can't find any of them."
  - Preferences damage QA, because bugs appear only in some combinations.
  - They mean fewer real features and more bugs, and they block behaviour that "just works".
  - A preference can stand in for fixing a bug.
  - Five clock styles confused test users so much that they could not add a clock.
  - His tests for a new preference:
    - Find out what annoyance prompted the request.
    - Fix it for everyone if possible.
    - Ask whether the annoyance is significant.
    - Treat preferences as a limited budget of slots.
- **37signals, *Getting Real*, "Avoid Preferences":** "Decide the little details so your customers don't have to." It makes the same cost argument, including untested interface states.
- **Joel Spolsky, "Choices = Headaches" (2006):** fifteen ways to shut down a Vista laptop. More choices make people less happy.
- **Apple HIG:**
  - "Minimize the number of settings you offer."
  - Choose defaults "that give the best experience to the largest number of people".
  - Don't ask for setup information you can detect.
  - **Don't duplicate system-wide settings** (accessibility, scrolling).
- **NN/g (Amy Schade, 2016):**
  - Customisation must not patch a weak design.
  - The default experience must stand on its own.
  - Layer the options: most useful first, secondary on an advanced screen.
- **Spool (UIE, 2011):** fewer than 5% changed anything in Word. Designers and programmers are the exception, so a team's own habits mislead it.
- **GNOME (Experimental wiki pattern):** a well-designed interface "does not require configuration". Only rarely changed options belong in the preferences window.

**The case for preferences** (why the list isn't zero):
- Reading comfort is physical and personal: line length, text size, contrast, spacing. WCAG 1.4.8 (AAA) and 1.4.12 (AA) exist because one value does not fit everyone.
- Line width and text size are the most requested settings in every tracker searched.
- Privacy and data location are trust settings. In local-first apps they are the most-reacted requests (AFFiNE telemetry 53; storage path 17; encryption 25).

**Anti-patterns seen:**
1. **Per-item options with no default.** Notion's per-page Full width, Small text and Font have no default, so people need templates, buttons or browser add-ons. Confluence had the same problem and fixed it.
2. **Page options that change the page for everyone.** In Notion, one reader's "Full width" is every reader's full width. A viewing preference stored in shared content is wrong for collaborative docs. TinyDocy rule 2 (11-15 doc) avoids it. **This is a deliberate difference from Notion.**
3. **Preferences that copy the OS.**
   - Smart quotes on Mac exist at system, app and Edit-menu level, and users can't tell which one wins (MacMost; Apple Community).
   - Obsidian's spellcheck language exists only on Windows and Linux, because macOS detects it.
   - Follow the OS where the OS has the setting.
4. **Substitutions that hit code.** Curly quotes in code samples break programs (Raymond Chen; developer posts naming Notion). Whatever the default, substitutions must never run inside code blocks or inline code.
5. **Autoformat you can't undo in place.** Google Docs solved it: Backspace undoes the automatic list. Word's AutoFormat list is a well-known annoyance.
6. **Wrong default on a safety feature.** Word shipped autosave off by accident, and about 95% of users ran without it (Spool).
7. **A catch-all category.** macOS Ventura's "General" made settings harder to find. A pane named "Other" or "Advanced" that holds unrelated items is the same mistake.
8. **Settings with no visible effect.** The 11-15 doc already hides the web Page item when `NEXT_PUBLIC_REMEMBER_CHOICES=0`. That is correct.
9. **Numeric controls that create untested combinations.** Separate line-height and paragraph-spacing sliders (Bear, Ulysses) allow tight lines with huge gaps. Presets avoid this (11-15 doc §3.2 "Spacing" as one control).
10. **Settings asked up front.** NN/g: let people use the product first, and ask only brief questions with a clear reason.

**Sensible-default rules for TinyDocy** (derived from the above):
- Follow the OS for theme, reduced motion, contrast, text-input substitutions on mobile and spelling language on macOS.
- Every setting must answer one real complaint, and none may patch a bug.
- Store everything per device. Never put viewing state in the Y.Doc.
- State the scope in the control.
- Each pane has one reset.

---

## 4. Ranked: the 25 preferences most worth offering

**Ranking criteria, in order:**
1. Evidence of use or demand.
2. Fit for a lightweight, collaborative, local-first editor.
3. Cost: it must be CSS or stored state, not a new code path in the editor plugins.

**Columns:**
- **Plan:** **P** = already planned (UX spec §7 or the 11-15 doc §3). **N** = new in this study. **P\*** = planned, with a change proposed here.
- **Web / Desktop:** where it should exist.

| # | Preference | Values → default | Scope | Plan | Why (evidence) |
|---|---|---|---|---|---|
| 1 | **Appearance** | System / Light / Dark → System | device | P | Every app studied. Apple and Microsoft guidance name it, with "system" first. |
| 2 | **Page width default** | Narrow / Standard / Wide / Full → Standard | device | P | The most-requested setting: Obsidian thread since 2020; Width Slider about 94k; Notion and Confluence default requests. iA's 64/72/80 characters confirms a few presets are enough. |
| 3 | **This document's width** (override) | same values; "Use for all" / "Reset" | this document, this device | P\* (desktop in plan; consider web, O6) | Notion, Google Docs, Craft and Obsidian plugins all offer it per page. The complaints are about the missing default, which #2 plus "Use for all" solves. |
| 4 | **Text size** | 13 / 15 / 17 / 19 / 22 px → 15 | device | P | Obsidian, iA, Bear, Ulysses, Apple Notes, Linear, Notion. Bear 2 font-size outcry. Obsidian stores it per device. |
| 5 | **Reopen where I left off** | Reopen windows / Recent / New → Reopen; plus "remember position in each document" | device | P | Notion "continue where you left off"; Linear default home view; Obsidian "Remember cursor position" about 213k. |
| 6 | **Check spelling while typing** | on/off → on | device | P | Obsidian, iA, Linear, Pages, Docs. |
| 7 | **Spelling language** | dictionaries → system (Win/Linux only; macOS detects) | device | P | Logseq #9602 (9) and #9990. Obsidian uses the same Win/Linux-only rule. |
| 8 | **Analytics and diagnostics** | off / on → **off** (opt-in) | device | **N** | AFFiNE "Disable AI and Telemetry" 53, a top-5 issue. Logseq default-on complaint. TinyDocy already has opt-in GA4. Make it a visible switch in General with one sentence on what is sent. |
| 9 | **Font** | Sans / Serif / Mono → Sans | device | P | Notion (3), Craft (4), iA (3) presets. No studied writing app needs an arbitrary font picker. |
| 10 | **Interface zoom** | 75–200% → 100%, kept across launches | device | P | Obsidian zoom; Logseq "zoom not persistent" 18. |
| 11 | **Spacing** | Compact / Comfortable / Airy → Compact | device | P | Bear and Ulysses expose line and paragraph spacing. WCAG 1.4.12. Presets avoid broken combinations. |
| 12 | **Format as you type** (Markdown shortcuts, auto-lists, `---` rule) | on/off → on; **Backspace right after a conversion undoes it** | device | **N** | Google Docs added it as an opt-in option. Word AutoFormat is the most-disabled feature family. One switch covers everyone who dislikes automatic formatting. Backspace-undo is the Google 2014 pattern and should exist regardless. |
| 13 | **Smart quotes and dashes** | on/off → **off** (keeps the 11-15 decision); never in code or inline code | device | P (later) | **For on:** Google Docs default on (secondhand); Obsidian Smart Typography about 178k. **For off:** TinyDocy's audience writes code and Markdown, and curly quotes break pasted code (Chen; Notion reports). Off matches today's behaviour, and changing a default silently is worse. Revisit if users ask. |
| 14 | **Simplified toolbar** | on/off → off | device | P (exists) | Obsidian "Hider" about 484k and "Editing Toolbar" about 2.2M show people want to tune chrome. |
| 15 | **Show the outline** | When there's room / Overlay / Never → When there's room | device | P | TinyDocy-specific. Obsidian "Quiet Outline" about 367k and "Dynamic Outline" about 43k. |
| 16 | **Focus mode** (hide chrome, dim other blocks) | toggle → off | session | P (later) | Hider about 484k; Focus Mode about 77k; iA and Ulysses focus. Make it a View command, not a stored setting. |
| 17 | **Automatic updates** plus channel | on/off → on; Stable / Beta → Stable | device (desktop) | P | Obsidian (automatic updates; early access). |
| 18 | **Backup folder** plus "Back up now" plus status | path → `~/TinyDocy Backups` | device (desktop) | P | AFFiNE storage path 17 and encryption 25; Logseq XDG 80; Obsidian Git about 3.5M and Local Backup about 96k. |
| 19 | **Trash: shown, not configured** | "N documents · deleted after 30 days" + Empty Trash… | device | P | Notion and Apple Notes use 30 days. Obsidian Trash Explorer about 69k (people want to see the trash). **No confirm-on-delete setting**: use Trash plus Undo. |
| 20 | **Reduce motion** | follow OS; override System / Reduce / Full → System | device | **N** | **Conflict:** Apple HIG says don't duplicate system settings, but GitHub offers "Sync with system / Enabled / Disabled". **Decision:** honour `prefers-reduced-motion` always (that is not a setting). Add the three-way override **only on the web**, where people can't change OS settings on shared or locked machines. On desktop, follow the OS only, per Apple. |
| 21 | **Contrast** | follow OS `prefers-contrast`; override System / Standard / High → System | device | **N** | Notion "High contrast" (per device). Same OS-first rule as #20. Ship the token set first. The override is cheap once tokens exist. |
| 22 | **Underline links** | on/off → off | device | **N** | Linear and GitHub offer it. Helps colour-blind readers (WCAG 1.4.1). It is one CSS rule. |
| 23 | **Typewriter scrolling** | on/off → off | device | P (later) | Obsidian plugins about 119k and 115k; iA; Ulysses. Must keep `.is-caret-block` behaviour (AGENTS.md). |
| 24 | **Read-only for me** (lock this document in my view) | toggle → off | this document, session | P\* (later) | Notion "Lock page" is a guard against accidental edits. **Unlike Notion, keep it per viewer, not for everyone.** Making a document read-only for everyone is a sharing permission (Live release), not a preference. |
| 25 | **Show word count** | on/off → off | device | **N** | Obsidian "Better Word Count" about 635k and "Novel word count" about 206k. iA shows counts. A status-line count costs one debounced doc-size read, so keep it off the typing path. |

**Not ranked but required (not settings):**
- Visible focus indicators (WCAG 2.4.7).
- `dir="auto"` on blocks for RTL text. This beats a global RTL switch (AFFiNE RTL 22).
- Paste as plain text as a **shortcut** (⌘⇧V), not a setting.
- Autosave always on.
- A command-palette entry for every setting.
- Shortcut **reference** sheet: searchable, read-only. Remapping waits for evidence from TinyDocy users. Obsidian Hotkeys and VS Code keybindings serve power users, and Notion and Google Docs ship without remapping.

### 4.1 Preferences to avoid

| Avoid | Why |
|---|---|
| Custom CSS, community themes, accent-colour pickers | Obsidian's Style Settings (about 2.85M) shows a power-user audience, but each theme multiplies the test matrix (Pennington; Getting Real). One well-tuned light and dark pair is enough. |
| Any-installed-font picker | Offline and desktop-Linux rendering differences, no bundle control, untested metrics. Three bundled presets are what Notion, Craft and iA settled on. |
| Separate numeric line-height, paragraph-spacing and indent sliders | They create broken combinations (§3 item 9). Use presets. |
| OpenDyslexic or other "dyslexia font" switch | Evidence shows no benefit (Wery & Diliberto). Spacing presets plus a choice of font serve the need. Google chose Lexend instead. |
| Vim / Emacs keymaps | AFFiNE 19 reactions, but it conflicts with ProseMirror input handling and IME, and the audience is narrow. |
| Confirm-on-delete dialogs and configurable trash retention | Use Trash plus Undo with a fixed 30 days. Retention is an enterprise-compliance setting (Notion Enterprise). |
| Markdown syntax-style options (heading style, bullet character, link format) | Only matter for source-format files. TinyDocy is WYSIWYG over Yjs, so they would only shape export. Pick one export style. |
| Auto-pair brackets in prose | A code-editor habit with no rich-text demand found. Code blocks can pair brackets without a setting. |
| Default first block ("new notes start with") | Not applicable: the schema always starts with an H1 title. |
| Settings JSON file, import/export, settings sync (v1) | Developer-tool patterns (VS Code, Typora, Logseq). Revisit when accounts exist. |
| Duplicates of OS settings on desktop (spelling language on macOS, key repeat, scrolling, desktop reduce-motion override) | Apple HIG. They confuse people about which one wins. |
| Any page option stored in the Y.Doc (Notion-style width, font or lock for everyone) | It would change other people's view of a shared document (11-15 rule 2). |
| Language and date-format settings before the UI is localised | A setting with nothing to switch is noise. Add it with the first translation. Add first day of week when calendars or dates appear (Logseq 29 reactions shows it matters then). |
| Per-heading typography rules | AFFiNE #15207 has 1 reaction. HeadingScale already decides heading size. |

---

## 5. Notes for the TinyDocy plan

**Prior-art corrections to the 11-15 doc §8 table** (now checked against sources):
- **Notion:** verified. Per-page Font (Default / Serif / Mono), Small text and Full width are visible to everyone with access. Full width and small text work only on desktop and web. No account-wide default (Notion FAQ: "Not yet").
- **Google Docs:** verified. Pageless is per document. "Set as default" applies to new documents only.
- **Craft:** *correction.* Verified style options are font (System / Serif / Mono / Rounded), text colour, document colour, cover image and backdrop. A default style is set **per space**. **Page width is not verified** in Craft's docs, so drop "width" from that row unless it is checked in the app.
- **iA Writer:** verified. Mono / Duo / Quattro; line length 64 / 72 / 80; Focus scope Sentence / Paragraph / Typewriter.
- **Ulysses:** verified. Typewriter mode with fixed scrolling options; highlight line, sentence or paragraph; line width on Mac.

**Effect of this study on the plan:**
- **Add five new items** to the Settings plan:
  - #8 analytics switch (General)
  - #12 format as you type (Editor)
  - #20 reduce motion: OS-following, with a three-way override on the web only
  - #21 contrast override (General; after the token set exists)
  - #22 underline links (Editor)
  - #25 word count (Editor; later)
- **Keep the 11-15 defaults:** smart quotes off, Spacing as one preset, width per document plus a default with "Use for all".
- **Add to the Settings window:** restore the last pane (Apple HIG), and command-palette entries for every setting.

---

## 6. Owner questions raised by this study

- **Q1.** Is format-as-you-type a switch (Recommended, with Backspace-undo regardless), or always on?
- **Q2.** Reduce-motion override: web only (Recommended), both web and desktop, or follow the OS only.
- **Q3.** Analytics switch in General, off by default (Recommended). Or keep today's opt-in path unchanged.
- **Q4.** Should the per-document width exist on the web too (11-15 O6)? This study found the Notion, Obsidian and AFFiNE demand is for *per-page plus a default*, which supports it once the default exists.

---

## 7. Sources

Fetched or searched on 2026-11-16 unless dated otherwise.

**App documentation**
- Obsidian settings: https://obsidian.md/help/settings
- Obsidian 1.13.0 (settings search, early access, 2026-05-28): https://obsidian.md/changelog/2026-05-28-desktop-v1.13.0/
- Obsidian 1.13.1: https://obsidian.md/changelog/2026-06-09-desktop-v1.13.1/
- Obsidian 1.13.4 (public; Settings Search plugin deprecated): https://obsidian.md/changelog/2026-07-30-desktop-v1.13.4/
- iA Writer Mac settings: https://ia.net/writer/support/basics/settings/settings-mac
- Bear typography options: https://bear.app/faq/typography-options/
- Bear, disable smart quotes: https://bear.app/faq/how-to-disable-smart-quotes-and-dashes
- Ulysses editor customisation: https://help.ulysses.app/dive-into-editing/editor-customization-guide
- Typora advanced settings: https://support.typora.io/Advance-Config/
- Typora images: https://support.typora.io/Images/
- Notion page styling: https://www.notion.com/help/customize-and-style-your-content
- Notion lock pages: https://www.notion.com/help/lock-pages-and-databases
- Notion account settings and preferences: https://www.notion.com/help/account-settings
- Notion delete and restore (trash, 30 days): https://www.notion.com/help/duplicate-delete-and-restore-content
- Craft default styles: https://support.craft.do/en/write-and-edit/styling/default-styles.md
- Craft styling: https://support.craft.do/en/write-and-edit/styling
- Apple Notes settings (Mac): https://support.apple.com/guide/notes/apd97da26aed/mac
- Apple Notes, delete and recover (30 days): https://support.apple.com/guide/iphone/delete-and-recover-notes-iph904eee369/ios
- Apple Pages smart quotes: https://support.apple.com/guide/pages/tanad45f9cce/mac
- Google Docs pages or pageless: https://support.google.com/docs/answer/11528737
- Google Docs autocorrect and substitutions: https://support.google.com/docs/answer/12022089
- Google, Markdown in Docs (2022-03-29): https://workspaceupdates.googleblog.com/2022/03/compose-with-markdown-in-google-docs-on.html
- Google, automated lists and Backspace to undo (2014): https://workspaceupdates.googleblog.com/2014/09/automated-lists-backspace-to-undo.html
- Google, auto-linking preferences (2010): https://workspaceupdates.googleblog.com/2010/08/auto-linking-preferences-and-more-page.html
- Google Docs accessibility settings (2019): https://workspaceupdates.googleblog.com/2019/02/accessibility-settings-editors.html
- Google Docs accessibility, per product (2022): https://workspaceupdates.googleblog.com/2022/08/docs-sheets-slides-drawings-accessibility-preferences.html
- Smart quotes in Google Docs (secondhand, default on): https://www.laptopmag.com/articles/smart-quotes-google-docs
- Word AutoFormat As You Type: https://support.microsoft.com/en-US/Word/autoformat-as-you-type
- VS Code settings: https://code.visualstudio.com/docs/configure/settings
- Linear preferences: https://linear.app/docs/account-preferences
- GitHub accessibility settings: https://docs.github.com/en/account-and-profile/how-tos/account-settings/managing-accessibility-settings

**Platform guidance**
- Apple HIG, Settings: https://developer.apple.com/design/human-interface-guidelines/settings
- Microsoft, guidelines for app settings: https://learn.microsoft.com/en-us/windows/apps/design/app-settings/guidelines-for-app-settings
- GNOME wiki, Configuration pattern (Experimental): https://wiki.gnome.org/Design/HIG/Planning/Configuration
- GNOME, auto-apply note: https://blogs.gnome.org/desrt/?p=54
- WCAG 1.4.8: https://www.w3.org/WAI/WCAG21/Understanding/visual-presentation.html
- WCAG 1.4.12: https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html
- Chromium settings search highlighting: https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/resources/settings/search_settings.ts
- Windows 11 Settings redesign (breadcrumbs, related settings): https://www.windowscentral.com/whats-new-settings-windows-11
- Windows 11 agent in Settings: https://learn.microsoft.com/en-us/windows/configuration/settings/agent

**macOS System Settings critique**
- Eclectic Light: https://eclecticlight.co/2022/09/20/system-settings-in-ventura-a-turn-for-the-worse/
- MacStories: https://www.macstories.net/stories/macos-ventura-the-macstories-review/8
- Jeff Johnson: https://lapcatsoftware.com/articles/SystemSettings.html

**Essays and research**
- Jared Spool, "Do users change their settings?" (2011): https://archive.uie.com/brainsparks/2011/09/14/do-users-change-their-settings/
- Havoc Pennington, "Free software and good user interfaces" (2002): https://ometer.com/free-software-ui.html
- 37signals, *Getting Real*, "Avoid Preferences": https://basecamp.com/gettingreal/06.4-avoid-preferences
- Joel Spolsky, "Choices = Headaches" (2006): https://www.joelonsoftware.com/2006/11/21/choices-headaches/
- NN/g, Customization vs. Personalization: https://www.nngroup.com/articles/customization-personalization/
- NN/g, 7 Tips for Successful Customization: https://www.nngroup.com/articles/customization/
- NN/g, Customization of UIs and Products: https://www.nngroup.com/articles/customization-of-uis-and-products/
- Wery & Diliberto, OpenDyslexic: https://pmc.ncbi.nlm.nih.gov/articles/PMC5629233
- Brightspace OpenDyslexic end-of-life: https://community.d2l.com/brightspace/kb/articles/1237-intent-to-end-of-life-notice-for-opendyslexic-font-option-in-account-settings
- Smart quotes and code: https://devblogs.microsoft.com/oldnewthing/20240618-00/?p=109910
- Smart quotes in documentation: https://amanhimself.dev/blog/smart-quotes-in-documentation

**Demand: forums**
- Obsidian, adjustable readable line length: https://forum.obsidian.md/t/adjustable-readable-line-length/7564
- Obsidian, readable line length in frontmatter: https://forum.obsidian.md/t/readable-line-length-in-frontmatter/51018
- Obsidian, disable readable line length on a single note: https://forum.obsidian.md/t/disable-readable-line-length-on-single-note/104655
- Obsidian, settings search: https://forum.obsidian.md/t/settings-search/457
- Obsidian, global settings across vaults: https://forum.obsidian.md/t/global-settings-same-settings-themes-and-plugins-across-multiple-vaults/41789
- Bear, need finer width options: https://community.bear.app/t/need-finer-width-options/11763
- Bear, paragraph spacing: https://community.bear.app/t/paragraph-spacing/9751
- Bear, markdown hiding: https://community.bear.app/t/markdown-hiding-syntax-highlighting-vs-rich-text/9919
- Notion full width by default (notion-enhancer #139): https://github.com/notion-enhancer/notion-enhancer/issues/139
- Database pages full width (secondhand, 2025-08): https://aiworkflowzone.blogspot.com/2025/08/you-can-now-set-database-pages-to-be.html
- Confluence full-width default: https://community.atlassian.com/t5/Confluence-discussions/Full-width-mode-is-now-available-for-the-new-editor-in/m-p/1570696

**Demand: GitHub reactions (as of 2026-11-16)**

AFFiNE:
- #6920 Disable AI and Telemetry (53): https://github.com/toeverything/AFFiNE/issues/6920
- #5491 Encryption for local storage (25)
- #8966 RTL (22)
- #3236 Vim (19)
- #4578 Select local storage path (17)
- #7511 disable AI (15)
- #7290 Font size (7)
- #6720 per-document full width (6)
- #13697 appearance and custom CSS (4)
- #15207 per-heading typography (1)

Logseq:
- #3462 XDG config (80)
- #5421 i18n weekdays (29)
- #3967 ctrl+w should not close app (23)
- #3845 zoom not persistent (18)
- #9602 spellcheck language (9)
- #10354 diagnostics on by default (3)

**Demand: Obsidian plugin downloads**
- Source: https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugin-stats.json (cumulative, fetched 2026-11-16)
- Plugins cited:
  - Style Settings 2,853,538
  - Editing Toolbar 2,182,970
  - Minimal Theme Settings 1,892,833
  - Better Word Count 634,673
  - Paste URL into selection 517,691
  - Hider 483,973
  - Quiet Outline 367,320
  - LanguageTool 330,006
  - Remember cursor position 212,767
  - Smart Typography 178,468
  - Typewriter Scroll 118,982
  - Typewriter Mode 114,582
  - Hotkeys++ 103,023
  - Hotkey Helper 98,098
  - Local Backup 96,239
  - Editor Width Slider 93,600
  - Focus Mode 77,413
  - Trash Explorer 68,802
  - Custom Note Width 24,489
  - Git 3,466,256
  - Remotely Save 2,382,018
