# TinyDocy languages and the right-to-left interface

> **Owner answers (plan v7, 2026-11-16)**, which override the open questions below:
> - **D26 (LQ1 a, LQ3 a):** **English interface in v1, translation-ready**: `t()`, pseudo-locales, RTL documents and Arabic-script and Hebrew fonts. The first languages ship in **v1.1**, each with an agent draft and a **named native reviewer**.
> - **D23 (LQ2 a):** both line items are approved inside the single editor-chunk ledger (details §1 rule 5): **L1a i18n core 400 B gz** and **P2.13 `dir`, commands, Enter and « » 350 B gz**. Real headroom is 4,385 B (24,064 − 19,679, latest CHANGELOG). If the ledger runs over, the cut order is LK3, then « » by script, then the i18n core, then P2.13 last.
> - **D30:** the **L2 string-extraction sweep** is third in the pre-approved v1 cut order. If cut, new strings are linted instead (the "new strings through `t()`" rule stays, as §9.2 already says).
> - **Staff integration review:** row 26 Language is hidden until L1b (v1.1). The `firefox` Playwright project is defined once, by test strategy **Q7**; **L7 adds the RTL specs to it** rather than creating it, and P2.13's exit depends on Q7. **L3 owns the one keymap module** (`APP_KEYMAP`, `matchShortcut` / `visualStep`, `formatKeyCombo`, `lib/shortcuts.ts`; UX spec §4.6), and `matchShortcut` also fixes ⌘⇧F, which today matches `event.key === "f"` on `window` and fails on Persian and Arabic layouts. L3 is v1.1 under D26, so whether the module and `matchShortcut` land ahead of the rest of L3 is **not decided**.

- **Status:** Draft for owner review (2026-11-16). **L0 landed (2026-11-22):** the §9.3 amendments, the UX §9.4 copy rules and the `locales/glossary.md` seed, plus L1a groundwork that nothing in the app imports yet (0 B): `lib/i18n/` (`t-core`, `format`, `locale`, `isolate`, `registry-labels`), `scripts/i18n/` (`extract`, `check`, `pseudo`), `locales/en/actions.json`, the `i18n:*` scripts and the §8.1 unit tests. L1a still owns the wiring (§9).
- **Decides:**
  - which interface languages v1 ships
  - how strings are written, stored, loaded and translated
  - how the whole interface mirrors for right-to-left (RTL) languages
  - fonts for non-Latin scripts
  - the locale preferences
  - tests and PRs
- **Parent documents:**
  - [Plan v7](2026-11-15-desktop-local-first-design.md) (D0–D32)
  - [Details spec](2026-11-15-desktop-documents-and-editor-details.md): E5 and P2.13 (RTL *blocks* in documents), §2.2 (titles with `dir="auto"`)
  - [Desktop UX spec](2026-11-15-desktop-ux-design.md): §2.4 menus, §4.6 keyboard map, §9 copy guidelines
  - [Preferences design](2026-11-16-preferences-design.md): fonts (§5.13), letter spacing (row 11), boot script (§5.3)
  - [Accessibility and reading preferences research](../../research/2026-11-16-accessibility-reading-preferences.md): the Persian letter-spacing check (§1.6, §8)
- **This document wins** for interface language, interface direction and script fonts. For RTL *blocks* inside documents, the details spec still owns E5 and P2.13; §4.7 here proposes how P2.13 should build on Tiptap's own text-direction support.
- **IDs used here:** PRs **L0–L8**, owner questions **LQ1–LQ3**, risks **LR1–LR8**. None of these collide with P, W, F, A, U, S, E, C, CR, K, T, Q or D0–D22.

---

## 0. Summary

| | |
|---|---|
| **v1 recommendation** | **English interface, i18n-ready code** (LQ1). Every string goes through one `t()` from the first desktop PR on, RTL *documents* work fully (P2.13), and Arabic-script and Hebrew text gets bundled fallback fonts. The **first translated languages ship in v1.1**, chosen by the criteria in §2.2, with one RTL language among them to prove mirroring. |
| **Strings today** | About **430–520** interface messages in the web app (about 4,000 words), measured by grep (§2.4). |
| **Strings in v1** | About **1,100–1,300** messages (10,000–13,000 words) once desktop, the library, comments, sharing and preferences land. Help pages and legal text are extra. |
| **Effort per language** | About **2 agent-days + 4–5 native-reviewer days + 1 design review** with an automated screenshot gallery. |
| **Architecture** | A small hand-rolled `t()` with an ICU MessageFormat 1 subset. **English lives in the source** as the default text, so English users download no catalog. Other languages are flat JSON catalogs per namespace, loaded lazily **in the same `Promise.all` as the surface's code chunk**. Action-registry labels are translated **at the render boundary by action id**, so the ~150 labels in the editor chunk cost no bytes each. Changing the language **reloads** the page (web) or the windows (desktop). |
| **Editor chunk** (v7: approved by D23 as two ledger lines, i18n 400 B and P2.13 350 B, in details §1 rule 5; the 600 B figure below is superseded) | Target **≤ 400 B gz** for the eager `t()` core, the registry lookup and `lang`/`dir` handling, measured in L1a (LQ2). Every editor-chunk byte this document adds is listed in §3.7.1: about **650–750 B gz** in all, against about **3.7 KB** of real headroom (CHANGELOG: +19,697 B of the 24,064 B budget, less the 600 B that details §1 rule 5 reserves). |
| **RTL interface** | Full mirroring from `<html dir="rtl">`. The files sidebar moves right, the outline docks in the right margin and the comments rail in the left. Tab, toolbar and menu order reverse. About **170 direction-dependent sites** to convert or review (§4.4). A flip set of **14 icons** lives in `lib/icons.tsx` (§4.3). Left and right arrow keys act visually. |
| **One-time effort** | About **22 agent-days** for L0–L7, plus 1.5 days added to P2.13 and about 1 day upstream in `@docs.plus/extension-*`. Of that, about **10 agent-days fall inside v1** (L0, L1a, L2, the document half of L4, P2.13 extras). |
| **Owner questions** | 3 (§10) |

---

## 1. Principles

1. **The interface language and the document's direction are independent.** A Persian writer may run an English interface, and an Arabic interface may edit an English document. The interface direction comes only from the interface language. Each document block takes its own direction (`dir="auto"`, or the E5 override).
2. **English costs nothing.** No catalog fetch, no extra request on the critical path, and no per-string bytes in the editor chunk (AGENTS: the editor chunk budget is very tight).
3. **No string concatenation.** Every sentence is one message with named placeholders, so translators can reorder words.
4. **Never assume casing, plural shape, digit shape or quote marks.** Plurals come from CLDR through `Intl.PluralRules`. Numbers, dates and lists come from `Intl.*`. Title Case is an English macOS rule (UX §9.1), expressed inside the message (§3.9).
5. **User content is always isolated.** Titles, names, tags and folder names are wrapped in `<bdi>` or `dir="auto"` in HTML, and in FSI…PDI (U+2068…U+2069) in plain text ([W3C, inline bidi markup](https://www.w3.org/International/articles/inline-bidi-markup/); [W3C, Unicode bidi controls](https://www.w3.org/International/questions/qa-bidi-unicode-controls.en)).
6. **Code is always LTR.** Code blocks, inline code, Mermaid source, URLs, shortcuts and file paths render left to right in every interface.
7. **No language ships without a named native reviewer** and 100 % coverage of the namespaces a person sees on every launch (§3.11).

---

## 2. Scope recommendation for v1

### 2.1 Options

| Option | What ships in v1 | Cost inside v1 | Risk |
|---|---|---|---|
| **(a) English, i18n-ready (recommended)** | English UI. All strings through `t()`. Pseudo-locales in dev and CI. RTL documents (P2.13) and script fallback fonts. | About 10 agent-days (L0 0.5, L1a 3.5, L2 3.5, document fonts in L4 1, P2.13 extras 1.5), plus about 1 day upstream (U-L) | Low. Nothing visible changes for English users. |
| (b) English plus one language in v1 | (a) plus L1b, L3, L5, L6, L7 and the language | About +14.5 agent-days (12.5 for L1b, L3, L5–L7, plus 2 for the language) and 4–5 reviewer days, and 2–3 design reviews, on a release whose Gate 5 is already 30–42 weeks out | Medium. Every v1 PR then needs translated strings and an RTL screenshot pass before it merges. |
| (c) English only, no preparation | Nothing | 0 now. Later extraction of about 1,200 strings costs about twice as much, because the strings are scattered through about 60 more files by then. | High debt. Every desktop, library and comments PR adds strings that must be found again. |

**Why (a).** D0 puts local durability and offline first, and D6 already makes v1 a large combined release. RTL *documents* (P2.13) serve right-to-left writers in v1 even with an English interface, which is how most of them use English-only editors today. The extraction rule costs almost nothing per PR once L1a exists, and it is the part that becomes expensive later.

### 2.2 How to choose the first languages (v1.1)

Do not guess the audience. Pick by evidence, in this order:

1. **A named native reviewer exists** for the language, who can give 4–5 days in the release window. Without one the language doesn't ship (principle 7).
2. **The 10 named testers' languages** (D0, K16), and the OS languages their builds report (desktop reads `app.getPreferredSystemLanguages()` locally; nothing is sent anywhere).
3. **One RTL language in the first set**, to prove mirroring end to end. Persian, Arabic or Hebrew; whichever has a reviewer. Persian and Arabic also exercise joined script, ZWNJ, Eastern Arabic digits and non-Gregorian calendars, so they test more than Hebrew does.
4. **Demand signals:** GitHub issues and discussions asking for a language, and, on the sandbox origin only, the `navigator.language` share among visitors who opted into analytics. Use these to rank, never to override 1.
5. **Reach per reviewer-day:** prefer languages with large online populations and weak coverage among comparable editors.

### 2.3 Effort per language

| Item | Effort | Notes |
|---|---|---|
| Draft translation | 0.5 agent-day | Agent-drafted from the catalog plus translator notes (§3.11), with glossary terms from UX §9.2 ("document", "Library", "Trash", "Live") fixed first |
| Native review | 4–5 reviewer-days | About 2,500–3,000 words a day of careful review for 10,000–13,000 words, done as a GitHub PR review |
| Screenshot review | 0.5 reviewer-day + 0.5 agent-day of fixes | The L7 gallery: about 40 screens × 4 widths × light and dark, generated, never hand-taken |
| Integration and fixes | 0.5–1 agent-day | Overflow, truncation, missing plural forms, script font metrics |
| Design review | 1 round | The design-review merge gate: a UI/UX review with screenshots before any visible UI merges |
| **Total** | **≈ 2 agent-days + 4–5 reviewer-days** | The first RTL language also depends on L3, L5 and L7 being merged. Each later update costs about 0.1 reviewer-day per 50 changed messages. |

Legal text (`/privacy`) stays English unless a professional or legal reviewer signs off a translation. Help pages (UX §2.4 Help menu) are long-form documents, translated separately and later.

### 2.4 How the string count was measured

Grep over `app/`, `components/`, `lib/`, `extensions/` and `hooks/` (`.ts`, `.tsx`), on `main` at `e93169d`:

| Pattern | Unique matches |
|---|---|
| Capitalized literals in UI props (`label`, `title`, `description`, `reason`, `placeholder`, `hint`, `message`, `aria-label`, …) | 180 (224 occurrences) |
| JSX text nodes | 46 |
| `announce` / toast calls with a literal | 8 |
| All capitalized multi-word string literals | 296 |
| Single-word `label:` / `title:` literals ("Bold", "Italic") | 38 |
| **All capitalized literals by area** | smart-toolbar 117, document-editor 133, tiptap-ui 58, toc-sidebar 14, tiptap-node 11, tab-bar 7, pwa 8, other components 17, app 28, lib 237, extensions 14, hooks 10 (about 650 together, with overlap) |

**Excluded:** identity word lists (about 80 adjectives and animals, §6.8), code-language names (never translated), logs and thrown errors, colour token internals, and the SEO copy in `lib/site-config.ts`. **Result: about 430–520 interface messages today.** Third-party strings in `@docs.plus/extension-*` ("Edit link", "Copy link", "Remove link", "Apply", "Copy Mermaid source", …, about 25) are counted separately (§3.10).

**Added by v1** (counted from the specs): desktop menus about 110 items (UX §2.4), states and copy about 120 (UX §5, plan §5.5), preferences about 90 (preferences §4.6 plus row labels), web library about 100, comments about 80, sharing about 70, find, word count, print and paste about 30, image store about 40, updates, About and Help menu about 40. **About 650–800 more, for 1,100–1,300 in total.**

---

## 3. String architecture

### 3.1 Libraries considered

| Option | Runtime size and fit | Verdict |
|---|---|---|
| **Lingui 5** (macros compile messages, hashed ids) | Small runtime, and English can be stripped from code. But the macro needs `@lingui/swc-plugin`, which Lingui itself calls experimental and pins to one `swc_core` version; its compatibility table stops at Next 13, and its support under Turbopack in Next 16 is unconfirmed ([Lingui SWC plugin](https://lingui.js.org/ref/swc-plugin)). | **No.** A build-chain risk on every Next upgrade. |
| **next-intl / react-intl (FormatJS)** | Bring `intl-messageformat`'s parser and runtime into every chunk that formats, which is several KB gz. next-intl is also route-first (`[locale]` segments and proxy), and the desktop static export has no proxy. | **No** for the editor chunk. |
| **i18next + react-i18next** | Large runtime, plugins and context providers; re-renders on language change. | **No.** |
| **Paraglide JS 2** (compiled, tree-shaken message functions) | No runtime parser, and unused messages drop out. But each message ships **with every locale's text**; the project says that pays off below about 20 locales ([Paraglide comparison](https://inlang.com/m/gerre34r/library-inlang-paraglideJs/scaling)), and one third-party benchmark found Next.js tree-shaking didn't work as expected on 2.17. Each added language grows the editor chunk. | **No** for the editor chunk. Revisit if per-locale splitting matures. |
| **Hand-rolled `t()` + ICU MessageFormat 1 subset (recommended)** | About 250 B gz eager (lookup and `{name}` interpolation) plus about 1 KB gz for the plural/select formatter, which only lazy chunks import. English in source, so English costs no catalog. | **Yes.** Smallest, no build plugin, works the same in Electron main, Bun tests and the browser. |

**Why ICU MessageFormat 1 and not MessageFormat 2.** MF1 (`{count, plural, one {# document} other {# documents}}`) is understood by every translation tool (Weblate, Crowdin, Lokalise, Pontoon) and by translators. MF2 is now a Unicode specification, but tool support and the `Intl.MessageFormat` proposal are not mature yet. The subset in §3.4 maps onto MF2 later without changing catalogs by hand.

### 3.2 Where messages live

```
lib/i18n/
  t-core.ts          eager: lookup, {name} interpolation, current locale, dir. No plural code.
  format.ts          lazy: the ICU subset (plural, select, #, number, date), Intl caches
  locale.ts          supported list, BCP 47 matching, dir per locale, native names
  isolate.ts         <Bdi>, fsi() for plain text, stripBidiControls() for filenames
  intl.ts            date, relative time, number, list, collator helpers (lazy)
  registry-labels.ts actionLabel(action), actionKeywords(action): the render-boundary lookup
locales/
  en/<ns>.json       GENERATED by the extractor, checked in (diffs show copy changes)
  fa/<ns>.json       translations (example)
  pseudo/            en-XA and ar-XB, generated at build time, dev and CI only
  loaders.ts         GENERATED map { locale: { ns: () => import("./fa/ns.json") } }
  glossary.md        fixed terms per language (UX §9.2)
scripts/i18n/
  extract.ts         walks sources and the action registry, writes locales/en/*.json
  check.ts           CI: stale catalogs, ICU syntax, placeholders, plural categories, banned literals
  pseudo.ts          builds en-XA and ar-XB
  draft.ts           writes agent drafts as a PR for review (never merges by itself)
```

- **Generated `loaders.ts`, not template-literal `import()`.** An explicit map of static imports gives the bundler one chunk per file, with no guessing about how Turbopack expands dynamic paths. L1a verifies the chunk names in a production build.
- **Flat keys, dotted by surface:** `library.empty.title`, `trash.emptyConfirm.body`, `action.mark.bold.label`. Keys never contain English, so fixing an English typo doesn't orphan translations; a stale-source hash does that instead (§3.11).
- **The key names its namespace (L0, a call made):** the first dotted segment is the namespace (§3.7), so `library.trash.empty` lives in `library.json` and `trash.emptyConfirm.body` above becomes `library.trash.emptyConfirm.body`. The registry boundary writes two namespaces of its own: `action.<id>.label` and `action.<id>.keywords` (comma-separated) in `actions.json`, and `reason:<English>` in `reasons.json`. The extractor refuses a key whose prefix names no namespace, so no lookup by file path is needed.
- **Entry shapes:** `locales/en/<ns>.json` maps key → English; a translation maps key → `{ "text": …, "src": … }` (§3.11).
- **Two `t()` functions, one call shape:** `t-core`'s `t` formats `{name}` only and is what the editor chunk imports; `format.ts` exports a `t` with the whole ICU subset for lazy chunks. The extractor reads both. In English neither adds bidi isolates, so English output is exactly the text in code; in another language, values are wrapped in FSI…PDI.

### 3.3 Writing a message

```ts
// Component code (any chunk). English is the default and the source of truth.
t("trash.empty.title", "Trash is empty")
t("trash.count", "{count, plural, one {# document} other {# documents}}", { count })   // lazy chunks only
t("doc.moved", "Moved “{title}” to {folder}", { title, folder })                        // title and folder are isolated automatically
```

- **Action registry** (`lib/editor-actions/*`, about 150 labels in the editor chunk): **unchanged**. `label`, `keywords` and `description` stay English data. Renderers call `actionLabel(action)`, which returns `catalog["action." + id + ".label"] ?? action.label`. There are about 6 render sites (row button, menu item, palette row, tooltip, bubble, phone cell), so this costs about 50 B in total and nothing per label. The extractor imports the registry in Bun and writes its strings into `locales/en/actions.json`.
- **`Enabled` reasons** (`{ reason: string }`, e.g. `READ_ONLY_REASON`): looked up at render by their English text in the `reasons` namespace (`catalog["reason:" + text] ?? text`). The extractor collects them from the registry module, and `check.ts` flags any reason string with no entry.
- **Palette search** matches the translated label and keywords **and** the English label, so people who learned the English names still find actions.
- **Translator notes:** a `// i18n: …` comment on the line before a `t()` call, or a `notes` map beside the registry, is extracted into `locales/en/<ns>.notes.json`. Notes never ship to the browser.

### 3.4 The ICU subset

| Supported | Example |
|---|---|
| `{name}` | `Moved “{title}”` |
| `plural` with `=0`, `=1`, the CLDR categories and `#` | `{count, plural, =0 {No matches} one {# match} other {# matches}}` |
| `select` | `{platform, select, mac {New Document} other {New document}}` |
| `number` (with `percent`, `compact` and file sizes through a unit helper) | `{size, number}` |
| `date` / `time` with `short`, `medium`, `long` | `{when, date, medium}` |
| Rich tags for links and emphasis | `Read <link>the backup guide</link>`, rendered as React elements |

**Not supported:** `selectordinal` and nested plurals (none are needed; `check.ts` rejects them).

- **Plurals use CLDR categories through `Intl.PluralRules`**, never "1 vs many". Arabic has six categories (zero, one, two, few, many, other), Hebrew three (one, two, other), Persian two (one, other), Russian four, and French, Spanish and Portuguese include "many" ([CLDR plural rules](https://www.unicode.org/cldr/charts/latest/supplemental/language_plural_rules.html)). `check.ts` reads `new Intl.PluralRules(locale).resolvedOptions().pluralCategories` and fails a catalog that leaves out a category its locale needs.
- **Gender:** the interface never addresses or describes a person by gender, so v1 needs no gender `select`. Names are the only person references ("{name} is editing"), and translators write those in a gender-neutral form. Arabic and Hebrew reviewers confirm this works for every message that names a person; if not, a `select` on a neutral value is added later.
- **Editor-chunk messages are simple.** `check.ts` rejects `plural` and `select` in the `core` namespace, so the editor chunk never needs `format.ts`.

### 3.5 Shortcuts inside messages

- Catalogs **never** contain ⌘, Ctrl or key letters. Shortcuts are placeholders filled by `formatKeyCombo(combo, isMac())` (`lib/editor-actions/key-combo.ts`): `"{shortcut} pastes plain text"` with `shortcut = "Mod-Shift-v"`. `check.ts` bans ⌘, ⌥, ⇧, ⌃ and `Ctrl+` in catalogs.
- **Displayed shortcuts are LTR islands.** They render as `<kbd dir="ltr">`, so "Ctrl+Shift+V" doesn't reorder into "V+Shift+Ctrl" inside RTL text. In plain text (native menus and dialogs) they are wrapped in LRI…PDI (U+2066…U+2069).
- Key names that can be translated ("Shift", "Ctrl", "Enter", "Esc" on Windows and Linux) **stay in English**, because keyboards print them that way in most regions. A translator note says so; a reviewer may ask for an exception per language.
- `aria-keyshortcuts` values never change (they're a spec format, not text).

### 3.6 Dates, numbers and lists

- **Only `Intl`.** `Intl.DateTimeFormat` (UX §9.1 already requires it), `Intl.RelativeTimeFormat` ("2 hours ago"), `Intl.NumberFormat` (including unit style for "5.2 MB"), `Intl.ListFormat` ("Ana, Ben and 2 others"), and `Intl.Collator` for sorting by title (with `numeric: true`).
- **Formatting locale = interface language plus OS region.** On desktop: `new Intl.Locale(uiLanguage, { region })` with the region from `app.getSystemLocale()`. On the web: the region of the first `navigator.languages` entry. An en-GB system therefore shows "12 Nov", as UX §9.1 says.
- **Digits and calendars follow the CLDR defaults** for the resolved locale. Checked with `Intl.DateTimeFormat(locale).resolvedOptions()` in Bun 1.4.4 (JavaScriptCore; L6 re-checks in Chromium's V8, which Electron uses):

  | Locale | Calendar | Digits | 16 Nov 2026, default format |
  |---|---|---|---|
  | `fa`, `fa-IR` | `persian` | `arabext` (۰–۹) | ۲۵ آبان ۱۴۰۵ |
  | `ar` | `gregory` | `latn` | 16/11/2026 |
  | `ar-EG` | `gregory` | `arab` (٠–٩) | ١٦/١١/٢٠٢٦ |
  | `ar-SA` | `islamic-umalqura` | `arab` | ٦ جمادى الآخرة ١٤٤٨ هـ |
  | `he` | `gregory` | `latn` | 16 בנוב׳ 2026 |

  This matches the W3C Arabic and Persian layout requirements, which list European digits for western Arabic-speaking countries, Arabic-Indic for Egypt, Saudi Arabia and Iraq, and Eastern Arabic-Indic for Iran and Afghanistan ([alreq §6.1](https://www.w3.org/TR/alreq/)). Hebrew uses Western digits ([Apple HIG](https://developer.apple.com/design/human-interface-guidelines/right-to-left)). Because the OS region joins the language (§3.6), an `ar` interface on an Egyptian system gets Arabic-Indic digits. Tests assert via `resolvedOptions()` and never hard-code a digit shape. The native reviewer confirms each default (a call made, §11).
- **Never in documents.** Document text, counts inside the document, code and shortcuts are not converted.

### 3.7 Loading without growing the editor chunk

- **Namespaces map to chunks.** `core` holds what the editor chunk renders (toolbar row, registry labels, status pill, read-only reasons, editor aria). Then `menus` (row and ⋯ bodies), `slash`, `palette`, `colour`, `insert`, `outline`, `tabs`, `library`, `settings`, `comments`, `sharing`, `find`, `print`, `pwa`, `consent`, `desktop` (Electron main) and `site`.
- **Eager `core` catalog.** For a non-English language, `core` starts loading from the boot script's locale at the same moment as the editor chunk (the editor is already preloaded during tab sync). The editor waits for both. English skips it.
- **Lazy surfaces.** Each lazy loader becomes `Promise.all([import(surface), loadNamespace(locale, ns)])` with **no waterfall**. The "/" menu, palette, colour panel, Page popover, Settings and comments loaders all follow this one helper, `lazyWithMessages(ns, importer)`.
- **Offline.** Catalogs are bundler-imported, so they land under `/_next/static` with hashed names. The service worker caches them cache-first (AGENTS: PWA), so a language works offline after first use, and the desktop static export bundles all of them.
- **SSR and hydration.** The server keeps rendering `lang="en" dir="ltr"` and the English skeleton (the SEO intro in the skeleton stays English, like the rest of the public SEO copy). The boot script sets `<html lang dir>` before first paint from the saved language, so a Persian interface never flashes LTR. React renders translated text only after the editor mounts (`ssr: false`), so there's no hydration mismatch. No `useState(() => load())` (AGENTS).
- **Budget.** L1a measures `t-core.ts`, `registry-labels.ts` and the `lang`/`dir` handling against the editor chunk, and the PR records the bytes. Target **≤ 400 B gz** (LQ2). The ICU formatter, `Intl` helpers and catalogs never enter the editor chunk; a unit test checks the import graph from `document-editor.tsx`.

#### 3.7.1 Every editor-chunk byte this document adds

**Headroom.** `scripts/check-editor-chunk-size.ts` allows +24,064 B gz (23.5 KB) over the `58a9d22` baseline. The latest CHANGELOG entry puts `main` at about **+19,697 B**, which leaves about **4,367 B**. Details §1 rule 5 reserves **600 B** of that for `WriteGate`, the decoration hosts, the comments hook and the smart-quotes gate (≤ 150 B), so about **3,767 B** is really free.

> **Superseded by D23 (plan v7).** The owner approved one ledger of ≈1,540 B gz in details §1 rule 5, replacing the 600 B allowance. Its numbers: real headroom **4,385 B** (24,064 − 19,679, latest CHANGELOG), with lines for P2.2 (300), P4.9 comments (150), the smart-quotes gate (150), **L1a i18n core (400)**, **P2.13 (350)**, LK1 (60), LK3 (120) and OB2 (10). The table below stays as the breakdown of the two lines this document owns; "Paid from" now means those two ledger lines. *(Plan v8, D41: the ledger gains a conditional phone line for M19, ≈1,580–1,660 B in all; L1a and P2.13 keep their lines.)*

| Item | PR | Estimate (gz) | Paid from | Status |
|---|---|---|---|---|
| `t-core.ts` (lookup, `{name}` interpolation, locale and `dir` state) | L1a | ≈ 250 B | **New i18n line item (LQ2)** | Asked in LQ2 |
| `actionLabel()` at about 6 render sites, and the `reasons` lookup | L1a | ≈ 100 B | i18n line item (LQ2) | Asked in LQ2 |
| `flipInRtl` and `matchShortcut` / `visualStep` for toolbar code in the editor chunk | L3 | ≈ 50 B | i18n line item (LQ2) | Asked in LQ2 |
| **i18n subtotal** | | **≤ 400 B** | | |
| The `dir` global attribute on text blocks and the Format › Text Direction command wiring | P2.13 | ≈ 150–250 B | **Not budgeted anywhere today.** Rule 5's 600 B doesn't cover P2.13. | Needs its own P2.13 line item; added to LQ2 |
| Enter inherits direction (`CaretBlockVisible` sets `dir` on an empty caret block) | P2.13 | ≈ 60 B | P2.13 line item | Added to LQ2 |
| Quotes by script (« » after Arabic-script text) inside the smart-quotes gate | P2.13 or L4 | ≈ 60 B | The gate's ≤ 150 B **only if its measured size leaves room**; otherwise the P2.13 line item | Measured when the gate lands |
| RTL letter-spacing rule, logical CSS, `@font-face` for script fallbacks | P2.13, L3, L4 | 0 B (CSS) | — | — |
| **Everything** | | **≈ 650–750 B** | | About a fifth of the free 3.7 KB |

The one ask for the owner is LQ2. It covers the i18n line item (≤ 400 B) and the P2.13 line item (≤ 350 B), which no document has budgeted so far.

### 3.8 Changing the language

- **The language applies on reload.** Web: Settings shows "Reload to use فارسی" with a [Reload] button. Desktop: [Restart windows] reloads every window after their pending saves flush (rule 3 of the details spec), and main rebuilds the menu at once.
- **Why not live switching.** Live switching needs every component subscribed to a locale store, which is exactly the editor-shell subscription AGENTS forbids. Reloading also resets `dir`, fonts and the boot attributes in one place. VS Code and many desktop apps also ask for a restart.

### 3.9 Desktop (Electron main) and web stay in sync

- **One catalog set.** Main bundles `locales/*/desktop.json` and `actions.json` and uses the same `format.ts` (pure TypeScript, no DOM).
- **Menus.** UX §2.4 already has the renderer send main a serialized table of action ids, labels and combos. With L5, that table carries **translated** labels, so the Format menu is localized for free. Main-only items (app menu, File, Window, Help, dialogs, notifications, updates) come from `desktop.json`.
- **Title Case vs sentence case.** UX §9.1 needs Title Case on macOS and sentence case on Windows and Linux, in one Electron label. English messages carry it as `{platform, select, mac {Move to Trash} other {Move to trash}}`. Other languages write one form; their reviewer decides casing.
- **System-supplied items** (Cut, Copy, Paste, Services, Hide, Quit, Emoji & Symbols) keep their `role`s. macOS translates them only for languages the app bundle declares (`<lang>.lproj` folders; electron-builder's `electronLanguages`). **S1 verifies** this, per language added.
- **Default language on desktop:** `app.getPreferredSystemLanguages()` matched against supported languages; `app.getLocale()` (Chromium's own UI strings) can be aligned with the `--lang` switch. **S1 verifies** whether `--lang` changes anything visible, since TinyDocy draws its own context menus.
- **Parity test.** A unit test loads the menu template builder with each catalog and checks every item has a label, no label is empty, and accelerators are unchanged across languages.

### 3.10 Third-party strings

- `@docs.plus/extension-hyperlink`, `-hypermultimedia`, `-mermaid` and `-placeholder` render their own popovers with English labels (about 25). **Upstream change (U-L, about 1 day in the docs.plus repo):** each extension accepts an optional `labels` option, and TinyDocy passes translated labels from the namespace of the surface that opens it. The daily docs.plus update workflow then picks it up.
- Mermaid's own parser errors stay English (library output, shown as code).
- Browser- and OS-supplied UI (file pickers, the native spelling menu on macOS, permission prompts) follows the browser or OS language. That's expected and not tested.

### 3.11 Translation workflow and CI

1. A PR adds or changes English in code. `bun run i18n:extract` regenerates `locales/en/*.json`; CI's `i18n:check` fails if they are stale.
2. Each translated entry stores the hash of the English it was made from (`{ "text": "…", "src": "a1b2c3" }`). When the English changes, `check.ts` marks the translation **stale**: it still ships (better than English mid-sentence), and the coverage report lists it.
3. `bun run i18n:draft fa` writes agent drafts for missing and stale messages as a PR, using the glossary and notes. **A native reviewer approves or edits in GitHub review.** Nothing reaches `main` unreviewed. The L7 screenshot gallery is attached to that PR.
4. `check.ts` also checks: valid ICU in every locale, the same placeholders as English, complete plural categories, no banned literals (⌘, `Ctrl+`, straight quotes in prose), and no key that the extractor no longer finds.
5. **Ship gate per language:** 100 % of `core`, `menus`, `desktop`, `settings` and `library`, at least 95 % overall, no stale entries in those five, and the reviewer's sign-off.
6. **Later, optional:** Weblate (free hosting for libre projects; it reads ICU JSON) for community translations, still merged through PR review.

### 3.12 Pseudo-localization

- **`en-XA`** (accented and expanded about 40 %, each message in ⟦ ⟧) and **`ar-XB`** (RTL: the text reversed and set right to left), named after [Android's pseudolocales](https://developer.android.com/guide/topics/resources/pseudolocales).
- Built by `scripts/i18n/pseudo.ts` from the English catalogs. Available only when `NEXT_PUBLIC_PSEUDO_LOCALES=1` (dev, CI and preview builds), through `?lang=en-XA` or the language row. Never in production builds.
- `en-XA` finds hard-coded strings (any chrome text without ⟦ ⟧) and truncation. `ar-XB` finds mirroring bugs without anyone needing to read an RTL language.

---

## 4. The RTL interface

### 4.1 Direction model

| Layer | Direction comes from |
|---|---|
| `<html dir>` and all chrome | The interface language (`fa`, `ar`, `he`, `ur`, `ar-XB` → `rtl`). Set by the boot script. |
| Editor root (`.ProseMirror`) | Inherits the interface direction. Tiptap's editor-wide `textDirection` option stays **unset** (§4.7). |
| Each text block | `dir="auto"` (first strong character), or the E5 override (`ltr` / `rtl`) |
| Title | `dir="auto"` everywhere it appears (details §2.2) |
| User content in chrome (tab titles, tree, outline, Quick Open, comments, presence names, tags) | Isolated: `<bdi>` / `dir="auto"`, aligned to the **interface** start (§4.6) |
| Code, URLs, shortcuts, file paths | Always `ltr` |

### 4.2 What mirrors

| Region | LTR interface | RTL interface |
|---|---|---|
| Files sidebar (desktop, library) | Left | **Right** |
| Tab strip | Tabs run left to right; "+" at the end | Tabs run right to left; "+" at the left end. Playground stays first (rightmost). |
| Toolbar row | Undo … Insert, left to right; the overflow ⋯ at the right | Reversed; ⋯ at the left. The collapse ladder (T2–T5) still collapses from the **end**. |
| Outline | Docks in the **left** margin (comments design §11.2) | Docks in the **right** margin |
| Comments rail | Right margin | **Left** margin |
| Popovers, menus, submenus | Open below and to the right; submenus to the right | Mirror: submenus open to the left. Floating UI `placement` uses logical `start`/`end` sides. |
| Sheets and the outline overlay | Slide in from the left or right edge per their region | Slide from the mirrored edge |
| Dialogs, Settings | Labels left, controls right; primary button per OS (UX §9.3) | Mirrored by CSS; native dialogs follow the OS |
| Selection bubble, colour panel, table size grid | Grid order left to right | Grid order right to left; arrow keys move visually |
| Progress, sliders, the text size stepper | Smaller on the left | Smaller on the right; "A−" on the right ([Apple HIG: flip controls that show progress](https://developer.apple.com/design/human-interface-guidelines/right-to-left)) |
| Continue chip, status pill, toasts | Bottom-left / top-right per today's design | Mirrored |

**The outline and rail follow the interface, not the document.** A Persian document in an English interface keeps the outline on the left. Chrome stays put when someone opens a document in another direction, and documents mix directions per block anyway. Outline items still align to the interface start and isolate each heading ([Apple HIG: one alignment for all items in a list](https://developer.apple.com/design/human-interface-guidelines/right-to-left)).

### 4.3 Icons that flip

Rules from [Apple HIG, Right to left](https://developer.apple.com/design/human-interface-guidelines/right-to-left) and [Material, Bidirectionality](https://m1.material.io/usability/bidirectionality.html) and [Microsoft Learn, Mirroring](https://learn.microsoft.com/en-us/globalization/input/mirroring):

- **Flip** icons that show reading direction, text, or forward and backward motion.
- **Don't flip** logos, universal marks (checkmark), real-world objects (clock), media-like controls, or anything that means a real screen direction ("align left" always points left).
- Undo and redo are mixed in Material's guidance (rotational or horizontal). Lucide's `Undo2`/`Redo2` are horizontal hooks, so they flip; the reviewer confirms.

**Today's directional icons in `lib/icons.tsx`:**

| Flip in RTL | Don't flip |
|---|---|
| `ArrowLeft` (back), `ChevronRight` (submenu and disclosure), `PanelLeft` / `PanelLeftClose` (the sidebar moves), `IndentIncrease` / `IndentDecrease`, `ListIndentIncrease` / `ListIndentDecrease`, `List`, `ListTodo`, `TextQuote`, `Undo2` / `Redo2`, `ExternalLink` | `AlignLeft` / `AlignCenter` / `AlignRight` / `AlignJustify` (physical meaning), `ArrowUp` / `ArrowDown`, `ChevronDown`, `ChevronsDownUp`, `ArrowRightLeft` (symmetric), `GripVertical`, `Link`, `Pilcrow`, `CornerDownLeft` (the Return key), checkmarks, brand SVGs (Discord, GitHub) |
| **`ListOrdered`: don't mirror.** Lucide draws the digits 1 and 2, and mirrored numerals are wrong. Add a hand-drawn `ListOrderedRtl` (numbers on the right, digits upright) to `lib/icons.tsx`. | |

- **Mechanism:** one helper in `lib/icons.tsx`, `flipInRtl(Icon)`, adds `data-flip-rtl`; one CSS rule, `[dir="rtl"] [data-flip-rtl] { transform: scaleX(-1) }`. The flip set lives only in that file, as AGENTS asks.
- **Test:** `tests/unit/i18n/icon-direction.test.ts` lists every icon export whose name contains Arrow, Chevron, Panel, Indent, List, Undo, Redo, Quote or Corner, and fails unless each is in the flip set or the explicit don't-flip list.

### 4.4 CSS logical properties audit

Grep estimate on `main` at `e93169d` (regex, so ±10 %):

| Where | Physical (needs conversion or review) | Already logical |
|---|---|---|
| 31 SCSS/CSS files, of which **18** contain physical properties | **≈ 68 declarations:** `left` 14, `translateX` 10, `right` 8, `padding-left` 6, `margin-left` 5, `margin-right` 5, `float` 4, `text-align: left/right` 3, `border-left` 3, `border-right` 2, `border-left-color` 2, `padding-right` 1, `border-right-color` 1, one corner radius | 17 (`padding-inline` 10, `inset-inline` 2, `margin-inline*` 5) |
| Tailwind classes in TSX (Tailwind **4.3**, which has `ms-`/`me-`/`ps-`/`pe-`/`start-`/`end-` and `rtl:`/`ltr:` variants) | **≈ 24** (`pl-*`, `pr-*`, `ml-auto`, `left-*`, `right-*`, `translate-x-*`) plus 14 `slide-in-from-left/right` animations | 15 |
| Inline styles in TS/TSX | **≈ 21** (`left`, `right`, `marginLeft`, `paddingRight`) | — |
| Geometry reads (`rect.left` / `rect.right`) in positioning, drag and outline code | **≈ 34** to review (most stay physical; positions on screen are physical) | — |
| Arrow-key handlers | **6 files** (`table-size-grid.tsx`, `diagram-templates.tsx`, `color-panel.tsx`, `bubble-rules.ts`, `components/ui/toolbar.tsx`, `hooks/use-menu-navigation.ts`). `lib/icons.tsx` and `slash-items.ts` matched only on icon names. | — |
| Floating and sheet sides | `side="right"` 1, `placement: "left"` 1 | — |

**About 170 sites in all (68 + 24 + 14 + 21 + 34 + 6 + 2); about 125 are mechanical conversions, and the 34 geometry reads are mostly review only.** They split into two groups:

- **Document side (inside `.tiptap`):** lists, blockquote border, indent (`@docs.plus/extension-indent`, upstream), code-block chrome, table cells, the heading gutters for fold, drag and filter, and HeadingScale. These must be logical **relative to each block's own `dir`**, because an RTL paragraph in an LTR interface needs its gutter and list marker on the right. That work belongs in **P2.13** (+1.5 days) and is needed even with an English interface.
- **Chrome side:** everything else. That is L3, needed only once an RTL interface language ships.

**Rules after L3:**

- Use `margin-inline-*`, `padding-inline-*`, `inset-inline-*`, `border-inline-*`, `text-align: start/end`, and `float: inline-start` (or keep `float` physical when the user chose "float left" on media).
- `translateX` animations take a `--dir-sign` variable (`1` or `-1`).
- **Guard:** `tests/unit/i18n/logical-css.test.ts` counts physical properties per file against an allowlist with a reason per entry ("physical on purpose: media float chosen by the author"). New ones fail. Biome has no rule for this, so a contract test is the KISS choice, in the same style as the existing CI contract tests.

### 4.5 Keyboard

- **Editor shortcuts work on Persian, Arabic and Hebrew layouts.** `prosemirror-keymap` falls back to `event.keyCode` when a modifier is held and the key produced isn't the bound name (checked in `node_modules/prosemirror-keymap`, except Ctrl+Alt on Windows, which is AltGr). **App shortcuts outside ProseMirror** (the tab bar's ⌘⇧[ ], the palette's Alt+/, F6 region keys, the desktop's ⌘1–⌘9) must do the same: match `event.code` or use the shared keymap helper, never `event.key` alone. L3 adds one `matchShortcut(event, combo)` helper and a test that dispatches `Mod-b` with `key: "ذ"`.
- **Don't take the ZWNJ key.** Shift+Space types ZWNJ on the standard Persian layout. No shortcut may bind Shift+Space; `check.ts` gets a reserved-combo list.
- **Left and right arrows act visually** in every horizontal composite: toolbar (roving tabindex in `components/ui/toolbar.tsx`), tabs, colour grid, table size grid, diagram templates and menubar-like rows. In RTL, ← moves toward the end (visually left). Tree view: in RTL, ← expands and → collapses (the mirror of UX §4.6). One helper, `visualStep(event, dir)`, replaces the arrow handling in the six files listed in §4.4.
- **Tab reorder** (⌘⌥← / ⌘⌥→) moves the tab visually in the arrow's direction.
- **Back and Forward keep their keys** (⌘[ / ⌘], Alt+← / Alt+→). They are bound to physical keys and to history, as in browsers.
- **Displayed shortcuts** are LTR islands (§3.5).
- **Tables:** `prosemirror-tables` maps ArrowLeft to a logical step (−1) and only acts at the logical edge of a cell, checked with `endOfTextblock("left")`. In RTL cells it mostly defers to the browser's visual movement. **Risk LR3:** an e2e test checks that ArrowLeft and ArrowRight cross cells the visual way in an RTL table; if not, a small keymap in our table extension swaps the direction inside RTL tables.

### 4.6 Mixed-direction documents inside an LTR or RTL interface

- **Titles** are `dir="auto"` in the tab strip, sidebar, Quick Open, window title (FSI…PDI in plain text) and outline. Each item aligns to the **interface** start, with the text isolated inside (`<bdi>`), so a list of mixed titles stays one clean column ([Apple HIG](https://developer.apple.com/design/human-interface-guidelines/right-to-left)).
- **Quoting a title in copy:** “{title}” in English; translators choose their own marks (« » in Persian and Arabic). The quote marks sit outside the isolate.
- **Collaboration carets:** the name flag anchors to the caret's inline-start side within its block's direction (logical CSS in P2.13).
- **Comments:** card text and the anchored excerpt are `dir="auto"`; the rail's connector lines mirror with the interface.
- **Lists:** markers follow each list's direction (`dir` on the list item via E5). Numbering digits follow the document, not the interface.
- **Code blocks, inline code, Mermaid, URLs:** always `dir="ltr"` with `unicode-bidi: isolate`, also inside RTL paragraphs.
- **Tables:** the table takes the direction of its first cell's text unless E5 sets one; column order mirrors with it.
- **Search and Quick Open folding** (E9 already ignores accents and case): also fold Arabic ي/ك to Persian ی/ک, drop tatweel (ـ), harakat and Hebrew niqqud, and ignore ZWNJ. Sorting uses `Intl.Collator`.
- **Exported filenames** strip bidi controls (U+200E, U+200F, U+202A–U+202E, U+2066–U+2069) so a title can't spoof an extension (`report‮fdp.exe`). This is a security rule (OWASP: untrusted input into filenames), and it holds in every interface.

### 4.7 Caret and selection with bidi in ProseMirror

**Tiptap 3.33 already ships `TextDirection` in core** (`node_modules/@tiptap/core`, `setTextDirection` / `unsetTextDirection`). When the editor's `textDirection` option is set, it:
- adds a global `dir` attribute to **every** node type, with that value as the default
- sets `dir` on the editor root

**Recommendation for P2.13 (for the details spec's owner and SE to confirm):**

1. **Don't set the editor-wide `textDirection` option.** With `"auto"` as the default, every node (title, list, table, media, Mermaid) would carry `dir="auto"`, which y-tiptap would likely store as an attribute on every element, growing documents for no gain. The root would also take `dir="auto"`, so the editor's own layout would depend on the document's first strong character. Typography's built-in RTL branch also reads only that editor-wide option.
2. **Add our own `dir` global attribute on text blocks only** (paragraph, heading, list item, task item, blockquote, table cell), with default `null`. It is rendered as `dir="auto"` when `null`, and stored only when E5 overrides it. That keeps documents unchanged until someone overrides.
3. **Reuse the core `setTextDirection` / `unsetTextDirection` commands** for Format › Text Direction, limited to text blocks.
4. **The schema bump still goes through the rollout runbook** (details E5): older clients drop an unknown `dir` attribute when they rewrite a block's attributes. **Verify in P2.13** how y-tiptap stores `null` attributes and what an old client does to a stored `dir`.

**Known quirks and mitigations:**

| Quirk | Mitigation |
|---|---|
| **An empty block has no strong character**, so a new paragraph after Enter in a Persian paragraph can resolve LTR until the first letter is typed, and the caret jumps sides. | Extend `CaretBlockVisible` (it already decorates the caret's block) so that while the caret's block is empty, it also sets `dir` to the previous block's resolved direction. Decoration only, never stored. About 60 B gz, in the P2.13 line item (§3.7.1, LQ2). |
| A Persian paragraph that starts with an English word ("Next.js در …") resolves LTR. | That's the HTML rule, and the reason E5's override exists. The palette and Format menu offer "Right to left" for the block. |
| Caret affinity at a boundary between RTL and LTR runs is ambiguous, and arrow movement there differs per engine. Firefox and WebKit have long-standing reports. | Native movement is accepted. Tests cover only what we control: our own arrow handlers, block movement (⌥⇧↑/↓), and selection round-trips. |
| Atom nodes and `contenteditable=false` widgets (inline media, Mermaid) inside RTL text can stop arrow movement. | The same e2e cases in RTL. Fix in our node views if they fail. |
| `content-visibility: auto` already mis-places the caret in skipped blocks (AGENTS) | Unchanged. Test that `.is-caret-block` still keeps the caret's block rendered in RTL. |

### 4.8 Native menus and window chrome

| OS | Behaviour | Plan |
|---|---|---|
| **macOS** | The menu bar, its menus and the traffic lights follow the **system** language direction, not the app's. Apple says the menu bar runs right to left in an RTL system ([WWDC22](https://developer.apple.com/videos/play/wwdc2022/10107/)); Firefox moved its controls with the system locale. | Accept the OS behaviour. The unified titlebar (UX §2.1) reserves traffic-light space on whichever side `process.platform` plus the system direction puts it, independent of the app's `dir`. **S1 verifies** with `-AppleLanguages (he)`. |
| **Windows** | Window layout direction is a per-window style ([Raymond Chen](https://devblogs.microsoft.com/oldnewthing/?p=106680)). An RTL display language moves caption buttons to the left, as reported for another Electron app. | Our custom titlebar uses `titleBarOverlay` and reads the safe area from `navigator.windowControlsOverlay.getTitlebarAreaRect()`, so either side works. The in-window menu (Alt / F10) is drawn by the app, so it mirrors with CSS. **S1 verifies** on a Hebrew or Arabic Windows image. |
| **Linux** | Native frame and menu bar; GTK picks direction from the process locale. | Accept GTK's direction. Smoke test on one RTL locale in L5. |
| Context menus | TinyDocy draws its own (UX §2.5), so they mirror with the app. Native spelling suggestions (E8) follow the OS. | — |

---

## 5. Fonts and typography for non-Latin scripts

### 5.1 Coverage today

| Family (preferences §5.13) | Arabic script (Persian, Arabic, Urdu) | Hebrew | Notes |
|---|---|---|---|
| Arial (Default) | Yes on Windows and macOS, but its Persian is cramped and poorly spaced | Yes | Linux falls to Liberation Sans or Arimo, which have Hebrew but **no Arabic** (system fallback, often DejaVu) |
| Inter (Sans, and the chrome via `next/font`, `subsets: ["latin"]`) | **No** | **No** | Inter has Latin, Cyrillic, Greek and Vietnamese |
| Source Serif 4 (Serif) | **No** | **No** | |
| JetBrains Mono (Mono) | **No** | **No** | |
| Atkinson Hyperlegible Next (Legible) | **No** | **No** | Latin only. There is no OFL "hyperlegible" face for Arabic script; Vazirmatn is the usual legible Persian choice. |

So RTL text falls back to whatever the OS has, which differs across Windows, macOS and Linux, and every page font choice looks the same for Persian.

### 5.2 Bundled fallbacks (L4)

| Face | Licence | Covers | Used in | Size (measure in L4) |
|---|---|---|---|---|
| **Vazirmatn** variable, Arabic subset only | OFL 1.1 ([rastikerdar/vazirmatn](https://github.com/rastikerdar/vazirmatn); `@fontsource-variable/vazirmatn`, which splits Arabic and Latin) | Persian, Arabic, Urdu letters, ZWNJ/ZWJ | Default, Sans, Legible and Mono stacks; the chrome stack for `fa`/`ar`/`ur` interfaces | Estimate 40–90 KB woff2 |
| **Noto Naskh Arabic** variable | OFL 1.1 | Arabic script, Naskh style | Serif stack | Estimate 60–120 KB |
| **Noto Sans Hebrew** variable | OFL 1.1 | Hebrew | Default, Sans, Legible and Mono stacks; the chrome stack for `he` | Estimate 15–30 KB |
| **Noto Serif Hebrew** variable | OFL 1.1 | Hebrew | Serif stack | Estimate 20–40 KB |

- **Zero cost unless used.** Each face is a `@font-face` with a `unicode-range` (Arabic U+0600–06FF, U+0750–077F, U+08A0–08FF, U+FB50–FDFF, U+FE70–FEFF; Hebrew U+0590–05FF, U+FB1D–FB4F). It is listed **after** the page font in each stack, so the browser downloads it only when such characters render. The mechanism is the same as preferences §5.13: bundler-imported, cached by the service worker, bundled on desktop, `font-src 'self'`.
- **`classic` keeps today's stack** (the preferences promise of no visible change). The fallbacks join the stacks of every new style.
- **Metrics.** Vazirmatn is taller than Arial. The fallback faces set `ascent-override` and `descent-override` so line boxes in the toolbar and lists keep their height. Persian and Arabic need room for diacritics: the default spacing (line height 1.6) is fine, and Compact must be checked with vowel marks (a11y research §1.6).
- **Size balance.** Arabic and Hebrew can look small beside Latin. Apple suggests about +2 pt beside uppercase Latin ([HIG](https://developer.apple.com/design/human-interface-guidelines/right-to-left)), but our UI is sentence case, so L4 sets `size-adjust` on the fallback faces only after the design review compares them.
- **Italic.** No bundled Arabic-script or Hebrew face has an italic, so the browser slants it. That's accepted (Italic must still do something visible), and noted for reviewers, since Persian typography usually emphasizes with weight.

### 5.3 Letter spacing must not break joined scripts

- **CSS Text 3 §7.2.1:** a browser that can't space a cursive script without breaking its joins **must not** apply the spacing, and authors **should avoid** letter-spacing on cursive scripts ([CSS Text 3](https://www.w3.org/TR/css-text-3/)). Justification must never insert gaps between joined letters (§6.4.4).
- **Our own check** (a11y research §8): Chromium 156 kept Persian joined at 0.12 em, and only word gaps grew. WebKit and Gecko were **not** checked, and the Playwright config has **no `firefox` project** today.
- **The W3C Arabic and Persian layout requirements agree:** moving two joined letters closer or further apart "creates undesirable results". Only spaces next to non-joining letters may change, and kashida (stretching the joins), not tracking, is the native way to lengthen text ([alreq §4.3.7.1, §7.2](https://www.w3.org/TR/alreq/)).
- **Rule (L4):** `.tiptap :dir(rtl) { letter-spacing: normal; }` and keep `word-spacing: var(--page-word)`. Word spacing helps, and letter spacing is unsafe and not interoperable for Arabic script. `:dir()` matches blocks that `dir="auto"` resolved to RTL. Code stays at `normal` as today.
- **Hebrew trade-off.** Hebrew isn't cursive, and Hebrew typography *does* use tracking, for emphasis ([hlreq, Text spacing](https://w3c.github.io/hlreq/)). CSS can't select by script, and documents carry no language (§6.3), so v1 turns letter spacing off for every RTL block. If the Hebrew reviewer wants tracking back, a later PR can mark Arabic-script blocks with a decoration and scope the rule to them.
- **Also never** apply `text-transform` or `font-variant: small-caps` to UI text that may be translated (no meaning in Arabic, Hebrew or Persian), and never `letter-spacing` on chrome labels in an RTL interface.

---

## 6. Locale preferences

### 6.1 Interface language (new preference row 26)

| # | Grp | Id | Label | Control | Values → **default** | Scope | Plat | Where | Desktop storage | Web storage | Applied | R=0 | PR |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 26 | A | `language` | Language | Select, each language in its own name ("English", "فارسی", "العربية", "עברית") | **System** · each shipped language | D | B | S General, K | `prefs.language` | `ui.language` | boot: `<html lang dir>` and the `core` catalog preload; applies on reload | ses | L1b (engine), L6 (rows) |

- **System** resolves `navigator.languages` (web) or `app.getPreferredSystemLanguages()` (desktop) against the shipped list by BCP 47 lookup. `fa-AF` matches `fa`, and `pt-PT` doesn't match a `pt-BR`-only catalog unless the reviewer allows it.
- **Hidden until there are two languages.** With English only, the row isn't shown; the pseudo-locales add it in dev and CI. **v7:** added to preferences §2.1 as row 26, hidden until L1b ships in v1.1 (D26).

### 6.2 Regional formats

- No separate setting in v1. Formats use the interface language plus the OS region (§3.6). A "Formats" override (like macOS's Region) is deferred.

### 6.3 Document language: deferred

- A per-document language would drive spellcheck, hyphenation, quote style, screen-reader voice and `:lang()` fonts. But it is content metadata that collaborators would share, so it would have to live in the Y.Doc, and details §1 rule 7 keeps preferences out of it. It needs its own small design (a document attribute, not a preference).
- **v1 instead:**
  - The editor content inherits `lang` from `<html>`, as today.
  - Direction is per block (E5).
  - Quote style is by script (§6.5).
  - Spellcheck follows the OS or the chosen spelling languages (§6.4).

### 6.4 Spellcheck

- macOS: the native checker detects the language automatically (preferences row 15 says so).
- Windows and Linux: Hunspell with **bundled dictionaries only** (preferences row 15). L5 checks `session.availableSpellCheckerLanguages` for `fa`, `he` and `ar`. Chromium's list is believed to include Persian and Hebrew but not Arabic; **verify in S1**. A missing dictionary is shown as "Not available for العربية" in the listbox, never silently dropped.
- The web uses the browser's own spellchecker; nothing to do.

### 6.5 Quotes (smart quotes, D20)

- Tiptap's Typography extension picks quote marks from the **editor-wide** `textDirection` only (checked in `node_modules/@tiptap/extension-typography`), and its RTL default reverses the curly quotes, which is wrong for Persian.
- **Rule in the smart-quotes gate** (preferences §5.10, which already decides on or off): when the block's first strong character is Arabic script, `"` becomes « and » (the usual Persian and Arabic convention; the W3C Arabic and Persian layout requirements don't specify quote marks, so the reviewer confirms). `'` stays ’. Otherwise “ ” ‘ ’ as today. Hebrew keeps “ ”: the W3C Hebrew layout requirements accept high marks where low marks („ ”) can't be typed ([hlreq, Quotations](https://w3c.github.io/hlreq/)).
- **Cost:** about 60 B gz. It goes inside the gate's ≤ 150 B only if the gate's measured size leaves room; otherwise it goes in the P2.13 line item (§3.7.1).
- An explicit "Quotation marks" setting (Automatic · “ ” · « » · „ “) is deferred until per-document language exists.

### 6.6 Hyphenation

- Stays off (`hyphens: manual`). `hyphens: auto` needs a correct `lang` per document, which v1 doesn't have (§6.3). Arabic script doesn't hyphenate anyway.

### 6.7 Dates in lists

- Library lists, Trash, Recent, daily snapshots, version history and comment timestamps use `intl.ts`:
  - **relative** for the last 7 days ("3 hours ago", via `Intl.RelativeTimeFormat` with `numeric: "auto"` for "yesterday")
  - **medium date** otherwise
  - the full date and time in the `title` tooltip and in `<time datetime>`
- Sorting by date sorts on stored timestamps, never on formatted text.

### 6.8 Generated identity names

- The "Adjective Animal" word lists are identity, not interface. In v1 they stay English, and a translated list is a cut-able extra per language (names are seen by collaborators in other languages anyway).

---

## 7. States and copy

| State | Surface | Copy (English source) |
|---|---|---|
| Language changed | Settings row hint, plus a button | "TinyDocy will use {language} after it reloads." [Reload] (web) / [Restart Windows] (desktop) |
| Language unavailable after an update (removed catalog) | Silent fallback; a one-time line in Settings | "{language} isn't available in this version. TinyDocy is using English." |
| A catalog fails to load (offline, first use) | Silent fallback to English for that surface; retried on the next open | — (logged; never blocks editing) |
| Partially translated surface | Never shown as a state; untranslated messages show English | — |
| Spelling dictionary missing | Settings › Writing listbox item, disabled | "Not available for {language}" |
| Pseudo-locale active (dev) | Status pill | "Pseudo-locale: {locale}" |

**Copy rules added to UX §9 (L0):**
- No sentence is built from fragments. Each message is a whole sentence.
- No message relies on word order, plural shape or casing.
- Glossary terms are fixed per language.
- Placeholders get translator notes ("{title} is a document title the user wrote; it may be in any language").
- Never put a shortcut, a brand name, or a file path inside translatable text; use placeholders.

---

## 8. Tests

### 8.1 Unit (`bun test`)

| Test | Checks |
|---|---|
| `i18n/format.test.ts` | The ICU subset; plural categories for `ar` (6), `he` (3), `fa` (2), `ru` (4) and `fr` (3) against `Intl.PluralRules`; `=0` precedence; `#` formatting with locale digits |
| `i18n/catalog-check.test.ts` | Runs `check.ts` on the real catalogs: syntax, placeholders, categories, banned literals, reserved combos, stale hashes, no `plural`/`select` in `core` |
| `i18n/editor-chunk-imports.test.ts` | Nothing reachable from `document-editor.tsx` imports `format.ts`, `intl.ts` or any catalog |
| `i18n/locale-match.test.ts` | System resolution (`fa-AF` → `fa`, `zh-TW` without a catalog → English), `dir` per locale |
| `i18n/isolate.test.ts` | FSI/PDI wrapping, `stripBidiControls` (including an RLO filename attack string), ZWNJ and ZWJ kept |
| `i18n/search-fold.test.ts` | ی/ي, ک/ك, tatweel, harakat, niqqud, ZWNJ, accents and case |
| `i18n/icon-direction.test.ts` | Every directional icon is classified (§4.3) |
| `i18n/logical-css.test.ts` | Physical properties only on the allowlist (§4.4) |
| `i18n/menu-parity.test.ts` (L5) | Every menu item has a label in every catalog, and accelerators are identical across languages |
| `key-combo` (existing) | Plus `matchShortcut` with non-Latin `event.key` |

### 8.2 End to end (Playwright)

- **New `i18n` project** (Chromium, CI on every PR, against `next dev` with `NEXT_PUBLIC_PSEUDO_LOCALES=1`):
  - **en-XA hard-coded string detector:** on about 25 surfaces (row, every menu, ⋯, palette, "/" menu, bubble, phone bar, Aa sheet, colour panel, Insert, outline, tabs, Settings panes, Page popover, consent, status pill, continue chip, library, Trash, comments, Share), collect visible text nodes outside `.tiptap` and fail on any without ⟦ ⟧, excluding an allowlist (user content, brand, code-language names, shortcuts).
  - **en-XA overflow:** the existing ladder assertion `scrollWidth ≤ clientWidth` on the row at every tier, and no clipped menu labels.
  - **ar-XB keyboard:** toolbar roving focus, tabs, tab reorder, tree (← expands), colour grid, table size grid, slash menu, F6 regions. All visual.
- **RTL documents (P2.13, extended here):** a Persian paragraph in an English interface (caret, Enter keeps RTL on the empty line, selection across a bidi boundary, copy and paste keeps `dir`, list markers on the right, gutters on the right), and an English paragraph in an `ar-XB` interface. Also tables in RTL (LR3) and inline atoms in RTL.
- **Three engines:** the RTL document spec and the letter-spacing and joining check run on the **`firefox` project** (nightly, with `webkit`) (a11y research §8; preferences §5.15 require Gecko, which isn't in the config today). **v7:** the project is defined once, by test strategy Q7; L7 only adds these specs to it.
- **RTL screenshot gallery** (`tests/e2e/rtl-screens.spec.ts`, nightly and on demand, attached to translation PRs): about 40 screens in `ar-XB` (and each shipped RTL language) at **1440, 1100 and 820 px** (the desktop review widths, details §14) plus **375 px** for the web phone bar, in light and dark. This is not pixel-diff gating. Each shot is reviewed by a designer and the language's reviewer. It does assert structure: the sidebar's x is greater than main's x, the first toolbar button is the rightmost, there's no horizontal page scroll, and the outline docks on the right.
- **Desktop smoke (L5):** the Electron build launched with `fa` and `he`. Menu labels are translated, role items are present, Settings shows the language row, and windows restart after a change.

### 8.3 Performance

- The existing `perf` project runs once with `fa` (catalog preload in parallel with the editor chunk). Gate: no added time to the first editable keystroke beyond noise, and no extra layout on load.

---

## 9. PR breakdown

| PR | Owns | Depends on | Effort (agent-days, review rounds) | Exit criteria |
|---|---|---|---|---|
| **L0** docs | Amendments (§9.3), UX §9 copy rules, glossary seed | — | 0.5 d, 1 round | Owner reads the amended sections |
| **L1a** i18n core (ledger line 400 B gz, D23) | `lib/i18n/*` (t-core, format, locale, isolate, intl, registry labels), `locales/` layout and generated loaders, `scripts/i18n/extract`, `check`, `pseudo`, `draft`, the `i18n:check` CI step, `lazyWithMessages`, dev-only `?lang=` for pseudo-locales, the registry render boundary, the PR-template rule "new strings through `t()`" | — (can land in Phase 1 or early Phase 2, before the desktop UI PRs) | M–L: 3.5 d, 2 rounds | Editor chunk **≤ +400 B gz, measured and recorded**; English bundle otherwise unchanged; `en-XA` renders the registry surfaces |
| **L1b** language preference | Row 26, boot script `lang`/`dir` and the `core` preload, reload-to-apply, `ui.language` / `prefs.language` | L1a, P2.9c-1 (boot script v2), F3 | S: 1.5 d, 1 round | No LTR flash in `ar-XB`; parity test of the boot script |
| **L2a / L2b / L2c** extraction sweep (in parallel, disjoint folders) | L2a: `components/smart-toolbar`, `lib/editor-actions` notes and reasons. L2b: `components/document-editor`, `tiptap-ui`, `tiptap-node`, `extensions`. L2c: `tab-bar`, `toc-sidebar`, `pwa`, `analytics`, the sandbox notice, `app/` chrome, the `<bdi>` isolation of tab titles and outline items | L1a | 3.5 d in total, 1 round each | `en-XA` detector green on every web surface; no behaviour change in English |
| **U-L** (docs.plus repo) | A `labels` option on hyperlink, hypermultimedia, mermaid and placeholder | — | 1 d | Published; picked up by the daily update PR |
| **P2.13** (existing, +1.5 d) | §4.7: own `dir` attribute on text blocks, core commands, Enter inherits direction via `CaretBlockVisible`, logical CSS for document-side nodes and gutters, quotes by script (§6.5) | As planned (SE review, schema rollout runbook); test strategy Q7 (`firefox`) | +1.5 d | RTL document e2e on chromium, webkit and firefox; within its 350 B gz ledger line (D23) |
| **L3** RTL chrome | Logical CSS for chrome, Tailwind logical utilities, floating placements, sheets and slides, the icon flip set and `ListOrderedRtl`, `visualStep`, `matchShortcut`, the guard tests | L1a, L2 | M: 3.5 d, 2 rounds; **design review** | `ar-XB` gallery reviewed at 4 widths, light and dark; keyboard specs green |
| **L4** script fonts | §5: Vazirmatn, Noto Naskh Arabic, Noto Sans and Serif Hebrew with `unicode-range`, metric overrides, the RTL letter-spacing rule, the chrome stack for RTL interfaces | P2.9c-2 (stacks and `@font-face` sheet) | S–M: 2 d, 2 rounds; **design review** | Fonts download only when such text renders; work offline; joining holds on three engines |
| **L5** desktop i18n | Main catalogs, translated menu table, Title/sentence case select, dialogs, notifications, `.lproj` / `electronLanguages`, `--lang`, restart windows, titlebar in RTL, spellcheck dictionary check | L1b, P2.9a, P2.9b, S1 | M: 3 d, 2 rounds | Menu parity test; desktop smoke in `fa` and `he` |
| **L6** formats, search and the language row | `intl.ts` in every list, collator sort, title-search folding, the language row in the desktop Settings window and W13, bidi-safe export filenames | L1b, P2.7a, P2.9b, W13 | S–M: 2 d, 1–2 rounds; **design review** | Unit tests in §8.1 |
| **L7** test harness | The `i18n` project, the RTL gallery, the RTL specs added to the `firefox` project that test strategy Q7 defines (nightly), the desktop smoke | L2, L3, Q7 | M: 2.5 d, 1 round | Runs nightly; the gallery is attached as a CI artifact |
| **L8.x** one per language | Catalog, review, gallery review, fixes | L3, L5, L6, L7 (the first RTL language); L1b, L6 (an LTR language) | ≈ 2 agent-days + 4–5 reviewer-days; **design review** | Ship gate (§3.11) |

**Totals:** L0–L7 about **22 agent-days**, plus 1.5 in P2.13 and about 1 upstream (U-L). Then about 2 agent-days and 4–5 reviewer-days per language.

**Inside v1 under LQ1 (a):** L0, L1a, L2a–c, U-L, the document half of L4 (the fallback faces and the letter-spacing rule, about 1 day) and the P2.13 extras. **About 10 agent-days, plus about 1 day upstream for U-L.**

### 9.1 Order

1. L0, then L1a as early as possible, so the desktop UI PRs (P2.7 onward) write strings through `t()` from the start.
2. L2a, L2b and L2c in parallel worktrees (disjoint folders), plus U-L.
3. P2.13 (with its extras) and L4 after P2.9c-2.
4. **v1.1:** L1b → L3 and L6 in parallel → L5 → L7 → the first L8.x languages.

### 9.2 Cut first, in order

**v7:** the plan's D30 order wins across designs. From this document it cuts the **L2 sweep** (third in D30), with new strings linted instead. The list below orders the cuts inside this document. **Bytes are separate:** if the editor-chunk ledger runs over, D23's order (LK3, « » by script, the i18n core, P2.13 last) can shrink L1a's eager core, which the "never cut L1a" line below did not foresee. How L1a would shrink (for example, falling back to option (c) of LQ2) is not decided.

1. Each language (L8.x). A language waits rather than shipping without its reviewer.
2. L5's `--lang` alignment and the Linux RTL smoke.
3. The gallery's 375 px width (keep 1440, 1100 and 820).
4. Translated identity word lists (§6.8).
5. Upstream labels (U-L). The four extension popovers stay English for one release.

**Never cut:** L1a and the "new strings through `t()`" rule, the bidi-safe filenames, the RTL letter-spacing rule, and the document-side logical CSS in P2.13.

### 9.3 Amendments to other docs (L0)

- **Preferences design:** §2.1 gains row **26 `language`** (§6.1). §5.13 adds the four fallback faces and the `classic` exception. §5.4 adds the `:dir(rtl)` letter-spacing rule. §5.15 adds firefox to the RTL check.
- **Details spec:** E5 / P2.13 adopt §4.7 (own `dir` attribute on text blocks, no editor-wide option, Enter inherits direction, quotes by script) and the +1.5 d. E9 adds Arabic-script and Hebrew folding. §14 adds the `ar-XB` gallery to the review checklist for any PR that changes chrome.
- **UX spec:** §4.6 gains the RTL keyboard notes (visual arrows, tree mirror, ZWNJ reserved). §9 gains the copy rules in §7. §2.4 notes the Title/sentence case `select`, and that role items need `.lproj`. §14 (S1 list) adds the macOS, Windows and Linux RTL checks of §4.8, `.lproj` and `--lang`.
- **Plan:** §8.4 adds L0–L7 and L8.x, and the v1 slice (§9). §11 adds LR1–LR8. Details §1 rule 5 notes that P2.13 has its own editor-chunk line item (§3.7.1).
- **Comments design:** §11.2 says the outline and rail sides follow the interface direction.
- **Toolbar contract and `check-editor-chunk-size.ts` comment:** the i18n and P2.13 line items (LQ2, §3.7.1).
- **AGENTS.md** (after L1a merges): one line on `lib/i18n/`, English-in-source, the registry render boundary and `lazyWithMessages`.
- **CHANGELOG:** each PR adds its own entry.

---

## 10. Owner questions

| # | Question | Options | Recommendation |
|---|---|---|---|
| **LQ1** (answered by D26: (a)) | Interface languages in v1 | (a) **English v1, i18n-ready**: strings extracted, pseudo-locales, RTL documents and script fonts; first languages in v1.1 by the §2.2 criteria. (b) English plus one language in v1 (about +14.5 agent-days, 4–5 reviewer-days and 2–3 design reviews on the v1 path). (c) English only, no preparation. | **(a).** It keeps D0's priorities and v1's schedule, and it serves RTL *writers* in v1 through P2.13 and the bundled fonts. If you can name a native reviewer for an RTL language now, that language becomes the first L8.x. |
| **LQ2** (answered by D23: (a)) | Editor chunk bytes for languages and RTL (§3.7.1) | (a) **Two new line items from the general headroom: i18n ≤ 400 B gz and P2.13 ≤ 350 B gz.** About 3.7 KB is free (about 4.37 KB on `main` per the CHANGELOG, less rule 5's reserved 600 B). (b) i18n only. P2.13's `dir` attribute, commands and Enter rule then have to fit inside rule 5's 600 B, which is already allocated. (c) 0 B for i18n: the toolbar row stays English in every language until a later budget raise. | **(a).** About a fifth of the free headroom, and each item is measured in its PR. The registry render boundary keeps the per-string cost at zero, so the i18n number doesn't grow as languages are added. |
| **LQ3** (answered by D26: (a)) | Who translates and reviews | (a) **Agent draft plus a named native reviewer per language**, reviewed in the PR with the screenshot gallery. (b) Community translations through Weblate, still merged by PR review. (c) A professional vendor (get quotes; 10,000–13,000 words per language). | **(a) for the first languages, adding (b) later.** No language ships without a named reviewer. |

---

## 11. Calls made (check these while reading)

- The language changes on **reload**, not live (§3.8).
- The outline and comments rail sides follow the **interface** direction, not the document's (§4.2).
- Shortcut key names stay English inside translations (§3.5).
- Digits and calendars follow the CLDR defaults for the interface language plus the OS region (§3.6), and the reviewer confirms. For `fa` that means Persian digits and the Persian calendar in lists.
- Letter spacing is off in every RTL block; word spacing stays (§5.3).
- `classic` keeps today's font stack; script fallbacks join the new styles (§5.2).
- Undo and Redo icons flip; `ListOrdered` gets an RTL variant instead of a mirror (§4.3).
- Per-document language is deferred (§6.3).
- Public SEO pages (`/about`, `/privacy`, `llms.txt`, metadata, the manifest) stay English in v1; there are no locale routes.

---

## 12. Risks

| # | Risk | L | I | Mitigation | Owner |
|---|---|---|---|---|---|
| LR1 | The eager i18n core overshoots 400 B gz | Low | Med | Measured in L1a; the registry boundary keeps labels at zero cost; the ICU formatter is lazy only | DE |
| LR2 | Translated strings run longer and break the toolbar ladder or menus | Med | Med | `en-XA` expansion test at every tier; the ladder already collapses by width | DE |
| LR3 | `prosemirror-tables` horizontal arrows go the wrong way in RTL tables | Med | Low | E2E in L7 and P2.13; a small swap keymap if needed | DE |
| LR4 | Engines differ on bidi caret movement and letter spacing (WebKit, Gecko unverified) | Med | Med | The `firefox` project; letter spacing off for RTL; native caret behaviour accepted | DE |
| LR5 | An old client strips a stored `dir` override | Med | Low | The schema rollout runbook and the mixed-version soak (P2.13) | SE |
| LR6 | macOS role items or native dialogs stay English | Med | Low | `.lproj` per language (S1 verifies); app-drawn dialogs where it matters | DE |
| LR7 | Translations go stale as English copy changes | High | Low | Source hashes, a coverage report, the ship gate per language | O |
| LR8 | No reviewer for a language | Med | Med | Principle 7: the language waits | O |

---

## 13. Sources

- W3C Internationalization, [Inline markup and bidirectional text in HTML](https://www.w3.org/International/articles/inline-bidi-markup/); [How to use Unicode controls for bidi text](https://www.w3.org/International/questions/qa-bidi-unicode-controls.en); [Strings and bidi](https://w3c.github.io/i18n-drafts/articles/strings-and-bidi/index.en)
- Unicode, [UAX #9: Unicode Bidirectional Algorithm](https://www.unicode.org/reports/tr9/); [CLDR language plural rules](https://www.unicode.org/cldr/charts/latest/supplemental/language_plural_rules.html)
- W3C, [CSS Text Module Level 3](https://www.w3.org/TR/css-text-3/) (§7.2.1 cursive scripts, §6.4.4 justification)
- MDN, [`Intl`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl) (PluralRules, DateTimeFormat, RelativeTimeFormat, ListFormat, Collator); [`<bdi>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/bdi)
- Apple, [Human Interface Guidelines: Right to left](https://developer.apple.com/design/human-interface-guidelines/right-to-left); [WWDC22: Get it right (to left)](https://developer.apple.com/videos/play/wwdc2022/10107/)
- Google, [Material Design (m1): Bidirectionality](https://m1.material.io/usability/bidirectionality.html); Android, [Test your app with pseudolocales](https://developer.android.com/guide/topics/resources/pseudolocales)
- Microsoft Learn, [Globalization: Mirroring](https://learn.microsoft.com/en-us/globalization/input/mirroring); [Adjust layout and fonts, and support RTL](https://learn.microsoft.com/en-us/windows/apps/design/globalizing/adjust-layout-and-fonts--and-support-rtl) (switching the Windows language does not flip a custom control by itself); [Design your app for bidirectional text](https://learn.microsoft.com/en-us/windows/apps/design/globalizing/design-for-bidi-text) (media controls stay LTR); [Text directionality](https://learn.microsoft.com/en-us/globalization/fonts-layout/text-directionality)
- W3C, [Arabic & Persian Layout Requirements (alreq)](https://www.w3.org/TR/alreq/) (§4.3.7.1 joining and spacing, §6.1 digits, §7.2 kashida); [Hebrew Layout Requirements (hlreq)](https://w3c.github.io/hlreq/) (quotations, text spacing)
- Microsoft, [The Old New Thing: how Windows decides LTR or RTL layout for a new window](https://devblogs.microsoft.com/oldnewthing/?p=106680)
- Electron, [`app` API](https://www.electronjs.org/docs/latest/api/app) (`getLocale`, `getSystemLocale`, `getPreferredSystemLanguages`); [`session` spellchecker API](https://www.electronjs.org/docs/latest/api/session)
- Next.js, [App Router internationalization guide](https://nextjs.org/docs/app/guides/internationalization)
- Tiptap, [Text direction and RTL support](https://tiptap.dev/docs/examples/basics/text-direction); local source checked: `@tiptap/core` `TextDirection`, `@tiptap/extension-typography`, `prosemirror-keymap`, `prosemirror-tables`
- Lingui, [SWC plugin](https://lingui.js.org/ref/swc-plugin); inlang, [Paraglide JS: scaling and comparison](https://inlang.com/m/gerre34r/library-inlang-paraglideJs/scaling)
- Fonts: [Vazirmatn](https://github.com/rastikerdar/vazirmatn) (OFL 1.1); Google [Noto](https://fonts.google.com/noto) (OFL 1.1)
- In-repo: [accessibility and reading preferences research](../../research/2026-11-16-accessibility-reading-preferences.md) §1.6 and §8 (the Chromium Persian letter-spacing check)
