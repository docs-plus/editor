# Preferences inventory: what TinyDocy remembers today, and what the plans promise

- **Status:** research, 2026-11-16. Read-only audit; nothing here changes code.
- **Scope:** every user-facing preference and remembered choice in the web app at `main` (`e93169d`), every preference promised by the desktop planning docs, the behaviours people may expect to control but can't, and the constraints a preferences design must respect.
- **Sources read:** `AGENTS.md`; `lib/remembered-choice.ts`, `lib/theme.ts`, `hooks/use-toolbar-density.ts`, `lib/saved-formats.ts`, `lib/continue-position.ts`, `lib/user-identity.ts`, `lib/analytics*.ts`, `lib/tab-api.ts`, `lib/offline/*`, `components/smart-toolbar/*`, `components/document-editor/*`, `components/toc-sidebar/use-outline-open.ts`, `components/pwa/*`, `components/analytics/*`, `extensions/heading-*`, `lib/editor-actions/*`, `app/layout.tsx`, `app/globals.css`, `lib/security/content-security-policy.ts`, `scripts/check-editor-chunk-size.ts`; specs `2026-11-15-desktop-ux-design.md` (UX), `2026-11-15-desktop-documents-and-editor-details.md` (Details), `2026-11-15-desktop-local-first-design.md` v6 (Plan), `2026-11-15-desktop-architecture.md` (Arch), `2026-11-16-comments-design.md` (Comments), `2026-11-12-smart-toolbar-design.md` (Toolbar); research `2026-11-15-title-tags-page-preferences.md` (TTP) and `2026-11-15-editor-user-requests.md` (Requests).

**Counts at a glance**

| Group | Count |
|---|---|
| Explicit user preferences with UI (§1.1) | 5 |
| Named user data that behaves like a preference (§1.2) | 1 |
| Remembered choices in `tinydocy-choices` (§1.3) | 10 slots (plus 2 derived, never stored) |
| Local view state (§1.4) | 4 persisted, 3 session-only |
| OS media features followed (§1.5) | 4 followed, 2 not followed |
| Operator `NEXT_PUBLIC_*` behaviour flags (§1.6) | 7 |
| Distinct preferences promised in planning docs (§2.1) | 33 |
| Conflicts or duplicates between docs, or between docs and code (§2.2) | 17 |
| Hidden behaviours with no user control (§3) | 18 |

---

## 1. What exists today

**Storage keys in use** (all `localStorage`, per browser origin, unless noted): `tinydocy-theme`, `tinydocy-ui`, `tinydocy-choices`, `tinydocy-formats`, `tinydocy-user`, `tinydocy-analytics-consent`, `tinydocy-continue`, `tinydocy-folds-<docId>`, `tinydocy-tabs`; IndexedDB `tinydocy-offline`; GA cookies only after consent.

"Forget my choices" (`memory.forget`, `lib/editor-actions/surface-actions.ts:606-617`, shown in ⋯ and the phone Aa sheet) calls `forgetChoices()` (`lib/remembered-choice.ts:198-205`), which removes **only** `tinydocy-choices`. The kill switch `NEXT_PUBLIC_REMEMBER_CHOICES=0` (`lib/remembered-choice.ts:58-59`) makes `readChoice` return fallbacks and `rememberChoice` write nothing for the `choices` and `ui` keys; other modules decide for themselves (column "REMEMBER=0").

### 1.1 Explicit user preferences (have a control)

| Name | Controls | UI | Storage key / slot | Scope | Default | Survives Forget? | REMEMBER=0 | file:line |
|---|---|---|---|---|---|---|---|---|
| Theme | Light or dark class on `<html>` plus the `theme-color` meta | Row button (`ThemeToggle`), ⋯ "Switch to dark/light mode", phone Aa sheet, palette `view.theme` | `tinydocy-theme` = `"dark"` / `"light"` (plain string, unversioned) | per browser | Light. No "System" option; `prefers-color-scheme` is ignored | Yes | **Still stored and applied** (not gated) | `lib/theme.ts:3,20,37-40`; `components/document-editor/theme-toggle.tsx:22-31`; `components/smart-toolbar/row/row-menu-bodies.tsx:120-141`; `lib/editor-actions/core/slot.ts:515` |
| Simplified toolbar (A15) | Row shows its compact T2–T4 set at every width (CSS `data-toolbar-density`) | ⋯ checkbox, palette `view.simpleToolbar` (Undo in the pill) | `tinydocy-ui` slot `toolbarDensity` (`"full"` / `"simple"`) | per browser | `full` | Yes | Disabled with reason "Remembering choices is turned off." | `lib/remembered-choice.ts:369-382`; `hooks/use-toolbar-density.ts:23-25`; `lib/editor-actions/core/slot.ts:455-487`; `row-menu-bodies.tsx:152-175` |
| Outline open (M6) | Docked outline shown or hidden (≥ 950 px only) | Row/⋯ toggle, palette `view.outline` | `tinydocy-ui` slot `outlineOpen` (boolean) | per browser | Open | Yes | Not remembered (always opens) | `lib/remembered-choice.ts:361-367`; `components/toc-sidebar/use-outline-open.ts:17,41-74` |
| Collaborator identity | Name and caret colour shown to collaborators via awareness | Bottom-right status card → "Edit identity" dialog | `tinydocy-user` = `{ name, color }` (unversioned) | per browser | Random "Adjective Animal" + one of 8 `CARET_COLORS` | Yes | Unaffected | `lib/user-identity.ts:6-15,17,73-99`; `components/tiptap-ui/user-identity-button.tsx:141-150` |
| Analytics consent | Whether GA4 loads | Banner (Allow / Decline) and `/privacy` "Turn on/off" | `tinydocy-analytics-consent` = `granted` / `denied`; GA cookies (13 months) after Allow | per browser | Off until Allow; GPC / DNT / webdriver force off | Yes | Unaffected | `lib/analytics.ts:13,42-67`; `components/analytics/google-analytics.tsx:25-28,90-97`; `components/analytics/analytics-choice.tsx`; `app/privacy/page.tsx:107` |

Related control, not a preference: **Delete offline copies** on `/privacy` (`components/pwa/offline-data-control.tsx`, `app/privacy/page.tsx:79`) deletes IndexedDB copies once (`lib/offline/offline-cache.ts:66-68`). It does not stop future caching.

### 1.2 Named user data that behaves like a preference

| Name | Controls | UI | Storage | Scope | Default | Survives Forget? | REMEMBER=0 | file:line |
|---|---|---|---|---|---|---|---|---|
| Your formats (M14) | Up to 20 named format bundles, 40-char names | Formats menu, style dropdown, palette, "Save selection as format…" | `tinydocy-formats` `{ v: 1, formats: [...] }` | per browser | none | Yes | **Still read and written** (no kill-switch check) | `lib/saved-formats.ts:1-4,29-31,78-109` |

### 1.3 Remembered choices (`tinydocy-choices`, all cleared by Forget, none stored under REMEMBER=0)

All are per browser, written only from an action's `run()` after its command returned true (plus the palette exception), allowlist-validated on every read.

| Slot | Toolbar id | What it remembers | Default (fallback) | file:line |
|---|---|---|---|---|
| `textColor` | M1 | Text-colour split-button face | `red` | `lib/remembered-choice.ts:313-318` |
| `highlight` | M2 | Highlight face | `yellow` | `lib/remembered-choice.ts:321-326` |
| `recentColors` | M3 | Mixed row of ≤ 5 recent colours | empty | `lib/remembered-choice.ts:329-334` |
| `codeLanguage` | M4 | Last code language (used only when the doc has no majority language) | plain | `lib/code-language.ts:60-65` |
| `listType` | M9 | List face | `bulletList` | `lib/remembered-choice.ts:337-342` |
| `insertKind` | M10 | Insert face / pre-highlighted kind | none ("+ Insert") | `lib/remembered-choice.ts:345-351` |
| `tableSize` | M17a | Table grid opens at last size | 3 × 3 | `lib/remembered-choice.ts:354-359` |
| `repeatBundle` | M7 | Repeat-formatting bundle | none | `extensions/repeat-formatting/bundle-memory.ts:25-30` |
| `paletteRecent` | M11 | Last 5 palette picks | empty | `components/smart-toolbar/palette/palette-recent.ts:24-29` |
| `mermaidTemplate` | M17b | Last Mermaid template | `flowchart` | `lib/mermaid-templates.ts:61-66` |

Derived, never stored: M5 heading level for new sections (from the current section), M12 "In this doc" (scanned on open).

### 1.4 Local view state

| Name | Controls | Storage | Scope | Default | Survives Forget? | REMEMBER=0 | file:line |
|---|---|---|---|---|---|---|---|
| Folded sections | Which headings are folded | `tinydocy-folds-<docId>` = JSON array of heading ids; **no version, cap, expiry or cleanup on document delete** | per document, per browser | none folded | Yes | **Still read and written** | `extensions/heading-fold/helpers/fold-storage.ts:1-31`; `extensions/heading-fold/heading-fold.ts:118`; `heading-fold-plugin.ts:527` |
| Continue where you left off (M15) | Section heading `data-toc-id` for the chip | `tinydocy-continue` `{ v: 1, docs }`, 30 docs, 14 days | per document, per browser | none | Yes | Cleared once and never written | `lib/continue-position.ts:20-32,56-113` |
| Active tab | Which tab opens next time | `tinydocy-tabs.activeTabId` (the key also held the pre-Yjs tab list; migration `clearMigrationStorage` removes the whole key, `hooks/use-synced-tabs.ts:82`, then the id is re-persisted) | per browser | Playground | Yes | Unaffected | `lib/tab-api.ts:10-14,100-121`; `hooks/use-synced-tabs.ts:72,97,153` |
| Heading filter | Filter words and AND/OR mode | URL `?filter=a|b&mode=and` (≤ 8 words, ≤ 64 chars) | per URL | none | n/a | n/a | `extensions/heading-filter/helpers/filter-url.ts:1-2,20-21` |
| Outline overlay open (< 950 px) | Overlay outline | React state only, reset on every mode change | per page session | Closed | n/a | n/a | `components/toc-sidebar/use-outline-open.ts:36-60` |
| Offline banner dismissed | Hides the offline banner | React state only | per page session | Shown | n/a | n/a | `components/editor-app/editor-app.tsx:100,163-164` |
| Per-selection text size | `size.*` mark (xs–xl ladder), not a preference, but named "text size" in UI | Y.Doc mark | per selection, shared | `md` | n/a | n/a | `lib/text-style-tokens.ts:31`; `components/smart-toolbar/font-size-stepper.tsx` |

### 1.5 OS settings followed (no in-app override)

| Media feature | Followed? | Where |
|---|---|---|
| `prefers-reduced-motion` | Yes | `app/globals.css:185`; `components/ui/sheet.tsx:112`; `lib/heading-navigation.ts:44-45`; `outline-panel.scss:40`; `selection-bubble.scss:47`; `app-skeleton.scss:99` |
| `forced-colors: active` | Yes (also disables hover colour previews) | `app/globals.css:199-219`; `components/smart-toolbar/color/swatch-preview.ts:119-121` |
| `pointer: coarse` / `hover: hover` | Yes (bubble, slash menu, previews, continue chip) | `components/smart-toolbar/coarse-pointer.ts:9-10`; `bubble/selection-bubble-view.tsx:63`; `slash/slash-menu.tsx:76`; `swatch-preview.ts:125`; `continue-chip.tsx:160` |
| `display-mode` (installed PWA) | Yes (install button) | `lib/pwa/install-prompt.ts:64-65` |
| `prefers-color-scheme` | **No.** Light unless the user picked dark | `lib/theme.ts:20,35` |
| `prefers-contrast` | **No** | none |

### 1.6 Operator flags (`NEXT_PUBLIC_*`, build time, not user preferences)

| Flag | Effect | file:line |
|---|---|---|
| `NEXT_PUBLIC_REMEMBER_CHOICES=0` | No `choices`/`ui` reads or writes; continue cleared; simplified toolbar disabled. Theme, folds, formats, identity, tabs unaffected | `lib/remembered-choice.ts:58-59`; `lib/continue-position.ts:32` |
| `NEXT_PUBLIC_OFFLINE_CACHE=0` | Disables and wipes offline copies | `lib/offline/offline-cache.ts:10,34` |
| `NEXT_PUBLIC_ACTION_PREVIEW=0` | No colour hover previews | `components/smart-toolbar/color/swatch-preview.ts:119` |
| `NEXT_PUBLIC_SERVICE_WORKER=0` | No service worker | `components/pwa/service-worker-registration.tsx:14` |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | Analytics exists at all | `lib/analytics-config.ts:32` |
| `NEXT_PUBLIC_MAX_EMBED_IMAGE_BYTES` | Image downscale bound | `lib/image-downscale.ts:38` |
| `NEXT_PUBLIC_MAX_TABS_PER_CLIENT` | Tab cap | `lib/security/guardrail-config.ts:215` |

---

## 2. Preferences promised in the planning docs

### 2.1 Promised preferences

"Where stored" is what the doc says; blank means the docs don't say.

| # | Preference | Values / default | Doc § | Owning PR | Where stored (per docs) | Web? |
|---|---|---|---|---|---|---|
| P1 | Appearance | System / Light / Dark; **System** | UX §7 | P2.9b | — (main needs it for `backgroundColor`, UX §3.1 l.307) | Has Light/Dark only |
| P2 | When TinyDocy opens | Reopen windows / Show Recent / New document | UX §7 | P2.9b | — | No |
| P3 | Recent documents in Dock / Jump List | On | UX §7 | P2.9b | — | No |
| P4 | Remember where I left off | On (mapped to `NEXT_PUBLIC_REMEMBER_CHOICES`) | UX §7 | P2.9b | — | Operator flag only |
| P5 | Document text size | 14/16/18/20, default 16 (UX §7) **or** 13/15/17/19/22, default 15 (Details §4) | UX §7, §8.4; Details §4 | P2.9c | `tinydocy-ui` slot `textSize` (TTP) | Yes (⋯ menu) |
| P6 | Interface zoom | 75–200 % (UX §7) **or** 50–200 % (UX §8.4); 100 % | UX §7, §8.4 | P2.9a (View › Zoom) | Electron `setZoomFactor`, "persisted per app" | No |
| P7 | Simplified toolbar | Off | UX §7, View menu §2.4 | P2.9b | `toolbarDensity` (exists) | Exists |
| P8 | Show the outline | When there's room / Always as overlay / Never (UX §7) **or** On/Off (Details §4) | UX §7; Details §4 | P2.9b / P2.9c | `outlineOpen` (exists) | Exists (On/Off) |
| P9 | Check spelling while typing | On | UX §7, Edit › Spelling §2.4; Details §4 | P2.9a (menu, context menu), P2.9b (Settings) | Electron session | Not addressed |
| P10 | Spelling language | System language if bundled (Win/Linux) | UX §7; Details §4 | P2.9b | Electron session | Not addressed |
| P11 | Backup folder | `~/TinyDocy Backups`, Change… | UX §7; Plan §5.2 | P2.9b | main | No |
| P12 | Auto-install updates | On | UX §7 | P3.3 (UX §5.7) | main | No |
| P13 | Update channel | Stable / Beta | UX §7 | P3.3 | main | No |
| P14 | Page width (app default) | Narrow 552 / Standard 648 / Wide 864 / Full; Standard | Details §4; Plan D10 | P2.9c | `tinydocy-ui` slot `pageWidth` (TTP) | Yes (⋯ menu) |
| P15 | Page width (per-document override) | inherits default | Details §4; Plan D10 | P2.9c | `doc_view(doc_id, width)` SQLite / IndexedDB, never Y.Doc | Contradictory (§2.2 C7) |
| P16 | Document font | Default (Arial) / Sans (Inter) / Serif (Source Serif 4) / Mono (JetBrains Mono); Default | Details §4; Plan D10 | P2.9c | `tinydocy-ui` slot `docFont` (TTP) | Details: web gets width + size only |
| P17 | Spacing | Compact / Normal / Relaxed (1.45/1.6/1.8); **Normal** | Details §4; Plan D10 | P2.9c | `tinydocy-ui` slot `spacing` (TTP) | Same |
| P18 | Reading mode | Off, **per window**, ⌥⌘R | Details §4, §7 | P2.9c | — | No |
| P19 | Smart quotes | On (today) | Details §4 | P2.9c (by §4 ownership) | — | Not stated |
| P20 | Window state | Bounds, display, maximised, full screen | UX §2.2 l.176 | P2.9a | main | n/a |
| P21 | Sidebar width | 240 px (200–360), per window | UX §4.5 | P2.9a | main (window state) | n/a |
| P22 | Sidebar collapsed / expanded folders | per window | UX §2.2 l.176, §4.1 | P2.9a | main | Web library (D3) unspecified |
| P23 | Open tabs, active tab, history head | per window | UX §2.2 l.176 | P2.9a | main | Web has `activeTabId` |
| P24 | Folder sort | Title/Modified/Created/Opened/Manual ± | Details §6.3 | P2.7b | `folders.sort` SQLite | W-PRs |
| P25 | Folder view | List / Preview | Details §6.3 | P2.7b | `folders.view` | W-PRs |
| P26 | Folder group | None / By date / By folder | Details §6.3 | P2.7b | `folders.group` | W-PRs |
| P27 | Filter bar | per window, not saved | Details §6.3 | P2.7b | not stored | — |
| P28 | Load remote images | per document, "remembered for this document" | UX §5.3 l.550, §7 "not a setting" | P2.9b | — | No |
| P29 | Hide comments | per window, "remembered in `tinydocy-ui`" | Comments §11 l.499 | P4.10 | `tinydocy-ui` | Yes |
| P30 | Tag colours | 8 fixed + none | Details §3 | P2.9b | `tags.color` SQLite / IndexedDB | W-PRs |
| P31 | Identity (+ new `id`) | name, colour, 128-bit id | Arch D-A8; Plan P4.0; Comments l.247 | P4.0 (move), comments PRs (id) | web `tinydocy-user`; desktop `meta` | Yes |
| P32 | OS accent colour | follows system | UX §2.2 l.171 | P2.9a | none (live) | No |
| P33 | Subscript key on desktop | `Mod-Shift-,` (Settings takes `Mod-,`) | UX §13 Q2; Plan P1.2 | P1.2 | code | Web unchanged |

Later (named, not promised for v1): focus mode, typewriter scrolling (Details §4, E12); `autocapitalize`/`autocorrect` on phones (Details E14, "web follow-up"); Document styles M14b (Toolbar).

### 2.2 Conflicts and duplicates

Details says it wins over UX and the research docs (Details header and §11). The list still matters because UX was only partly amended.

| # | Conflict | Sources | Notes |
|---|---|---|---|
| C1 | **Text size steps and default.** 14/16/18/20, default 16 "today's" vs 13/15/17/19/22, default 15. Today is 15 px. | UX §7 vs Details §4, TTP l.240 | Details wins, but UX §7's table is not amended in place. |
| C2 | **⌘+ / ⌘− / ⌘0.** Details §4, §11, §13 give them to document text size. UX §4.6 l.472 (P2.9a), the View menu (§2.4 l.219: Actual Size, Zoom In, Zoom Out) and the Ctrl+wheel row (§2.3 l.200, "maps to View › Zoom") still say interface zoom. | UX §2.3, §2.4, §4.6 vs Details §11 | Details §11 only amends UX §8.4. Interface zoom is then left with no key and no menu item, only Settings. On the **web**, binding ⌘+/− would take over browser page zoom (today `Mod-=`, `Mod--`, `Mod-0` are unbound in the editor; `Mod-Alt-0` is Paragraph, `lib/editor-actions/core/blocks.ts:379`). |
| C3 | **"Text size" means two things.** Per-selection size mark (xs–xl, `size.*`) vs document text size. | `lib/text-style-tokens.ts:31` vs Details §4 | Copy must separate them ("Text size" vs "Document text size"); `FONT_SIZE_EM` marks are em, so they follow the document size. |
| C4 | **Interface zoom range.** 75–200 % vs 50–200 %. | UX §7 vs UX §8.4 | Same doc. |
| C5 | **Spacing default changes today's look.** Details "Normal" = line-height 1.6; today's paragraphs are 1.15 with 12 px gaps. TTP made Compact (= today) the default, with names Compact/Comfortable/Airy. | Details §4 vs `paragraph-node.scss:41-44`, TTP l.249 | Details' own "Standard (today)" rule for width suggests the default should equal today. Needs an owner call. |
| C6 | **Font default and names.** Details: Default (Arial) + Sans/Serif/Mono. TTP: Sans default, three options; "web later". | Details §4 vs TTP l.248 | Details wins. Note Arial is missing on most Linux installs (TTP l.239). Code blocks name `JetBrains Mono NL` but it is not bundled (TTP l.233). |
| C7 | **Per-document width on the web.** Details §4 stores the override in IndexedDB "on the web", then says "the web app gets page width and text size as app-wide preferences". Plan §14 says "app-wide page width" while D10 says per-document override. | Details §4; Plan §13 D10 vs §14 | Decide whether the web library (D3) gets `doc_view`. |
| C8 | **Smart quotes.** Details §4: a Settings switch, On. Details §5: "already strong, don't rebuild". TTP: off, Later. Requests #39: "add a switch if users complain". | Details §4, §5; TTP l.256; Requests l.92 | Default differs (On vs off) and release differs (v1 vs Later). |
| C9 | **Outline control shape and breakpoint.** UX: three-way select, overlay below 1400 px. Details: On/Off plus per-width dock breakpoints (1240/1400/1640/never). Code: On/Off, overlay below 950 px. | UX §7, §4.5; Details §4; `use-outline-open.ts:17` | Details cites `document-editor.tsx:160` for the 950 px rule; it now lives at `components/toc-sidebar/use-outline-open.ts:17`. |
| C10 | **"Remember where I left off" ≠ the kill switch.** UX §7 maps the switch to `NEXT_PUBLIC_REMEMBER_CHOICES`, which also turns off every `choices` and `ui` slot (toolbar density, outline, colours). | UX §7 vs `lib/remembered-choice.ts:58` | Needs its own user setting that gates only `tinydocy-continue`. |
| C11 | **Theme default.** UX: System. Web: Light, no System, `prefers-color-scheme` ignored; boot script checks only `"dark"`. | UX §7 vs `lib/theme.ts:20` | Adding System on the web changes the boot script and `theme-color` meta logic. |
| C12 | **Plan PR row out of date.** Plan §8 P2.9c (l.678) lists width, text size, reading mode only; D10 adds fonts, spacing, per-doc width and says "P2.9c grows". | Plan §8 vs §13 | Smart quotes and spellcheck rows of Details §4 also have no PR in the Plan. |
| C13 | **Spellcheck owner and web.** Settings switch (P2.9b), Edit › Spelling (P2.9a), Details §4 Settings › Editor. The web relies on browser default spellcheck (no `spellcheck` attribute) and nothing says whether the web gets a switch. | UX §2.4, §7; Details §4 | Same setting in three places with two PRs. |
| C14 | **"Per window" stored in a per-origin key.** Comments' Hide Comments is "for this window" but "remembered in `tinydocy-ui`", which every window of the origin shares. Reading mode is also per window. | Comments l.499; Details §4 | Per-window state belongs in main's window state (desktop) or `sessionStorage` (web). |
| C15 | **Details' implementation notes cite code that differs.** "The setter writes `html.dataset`, the same way `theme.ts:38` does": `theme.ts:38` toggles `classList`, not `dataset`. | Details §4 | Harmless, but the "boot script before paint" claim also needs the desktop CSP fix (§4.2). |
| C16 | **M15 storage.** Toolbar spec says "stored as Yjs relative position per doc"; code stores the heading's `data-toc-id`. | Toolbar §5 l.161 vs `lib/continue-position.ts:5-9` | Code is right (AGENTS.md agrees); spec stale. |
| C17 | **Web library spec missing.** Plan D3 links `2026-11-16-web-library-design.md`, which isn't in `docs/superpowers/specs/`. Web-side storage for tags, folder sort/view/group and `doc_view` is therefore unspecified. | Plan §13 D3; Details §3 | |

---

## 3. Hidden behaviours users may expect to control

| # | Behaviour | Today | file:line | Promised? |
|---|---|---|---|---|
| H1 | Smart quotes, em-dash, ellipsis, arrows, fractions, © etc. (Tiptap `Typography`, all rules) | Always on | `components/document-editor/document-editor-config.ts:26,228` | Details §4 (switch); C8 |
| H2 | `autocapitalize="off"`, `autocorrect="off"`, `autocomplete="off"` on the editor | Always; hurts prose on phone keyboards | `components/document-editor/document-editor.tsx:128-130` | Later (Details E14) |
| H3 | Spellcheck | Browser default; no in-app switch or language | `document-editor.tsx:127-134` (no `spellcheck` attr) | Desktop only (P9, P10) |
| H4 | Follow system dark mode | Not possible; light unless toggled | `lib/theme.ts:20,35` | Desktop P1 |
| H5 | Heading scale: sizes by rank in each H1 section, 20 pt → 12 pt | Fixed bounds | `extensions/heading-scale/heading-scale.ts:41-42` | No (text size scales it via CSS) |
| H6 | Document font Arial, 15 px, line-height 1.15, 12 px paragraph gap | Fixed | `components/document-editor/document-editor.scss:45`; `components/tiptap-node/paragraph-node/paragraph-node.scss:41-44` | P2.9c |
| H7 | Page width 648 px (also hard-coded in the skeleton) | Fixed | `document-editor.scss:103`; `components/app-skeleton/app-skeleton.scss:70` | P2.9c |
| H8 | Fold persistence | Always on; unversioned, uncapped, no expiry, not cleared on delete or Forget, ignores the kill switch | `extensions/heading-fold/helpers/fold-storage.ts:1-31` | No |
| H9 | Continue chip | Only an operator flag turns it off | `lib/continue-position.ts:32`; `components/document-editor/continue-chip-loader.tsx` | Desktop P4 (C10) |
| H10 | Outline below 950 px always starts closed and is never remembered | Fixed | `components/toc-sidebar/use-outline-open.ts:17,36-60` | Partly (C9) |
| H11 | Selection bubble on desktop widths (≥ 768 px) | Always | `components/smart-toolbar/lazy-surface.tsx:41`; `components/smart-toolbar/selection-bubble.tsx:32-33` | No |
| H12 | "/" opens the block menu at block start or after whitespace | Always | `extensions/slash-trigger/slash-trigger.ts` | No |
| H13 | Colour hover previews | Operator flag only; auto-off on touch and forced colours | `components/smart-toolbar/color/swatch-preview.ts:119-125` | No |
| H14 | Offline copies of every opened doc (14 days, 30 docs) | On; users can delete but not opt out | `lib/offline/local-doc-store.ts:15-17`; `lib/offline/offline-cache.ts:66-68` | No |
| H15 | Remembered code language prefers the doc's majority language over "your last" | Fixed | `lib/code-language.ts:67-80` | No |
| H16 | Reduced motion and contrast only from the OS | Fixed | §1.5 | UX §8.6 adds `prefers-contrast` |
| H17 | Forget doesn't touch theme, identity, outline, density, formats, folds, continue, active tab | By design (view state), but undocumented in the UI | `lib/remembered-choice.ts:26-34` | No |
| H18 | Keyboard shortcuts are fixed (no remapping) | Fixed | `lib/shortcuts.ts` | No |

**Robustness findings recorded, not fixed:**
- `lib/user-identity.ts:78,93,98` calls `localStorage` with no try/catch (every other module wraps it), so blocked storage throws in `getUserIdentity()`. It also accepts any stored `color` string with no allowlist against `CARET_COLORS`, and that value is broadcast through awareness.
- The theme write is duplicated in `components/document-editor/theme-toggle.tsx:22-31` and `components/smart-toolbar/row/row-menu-bodies.tsx:128-135`. A shared `setTheme()` in `lib/theme.ts` would be the place to add System.
- Fold keys (`tinydocy-folds-*`) grow without bound: one key per document ever folded.

---

## 4. Technical constraints for adding preferences

### 4.1 Web storage pattern

1. **Hydration.** Never `useState(() => readStorage())`. Either read in `useEffect` behind a `ready` flag (`useRememberedChoice`, `lib/remembered-choice.ts:232-255`) or use `useSyncExternalStore` with a constant server snapshot (`useToolbarDensity`, `hooks/use-toolbar-density.ts:12-25`). The second is right only inside the `ssr: false` editor, where a ready effect would flash the default for a frame.
2. **Before-paint values use a boot script.** `THEME_BOOT_SCRIPT` (`lib/theme.ts:20`) is an inline string run from `<body>` in `app/layout.tsx:65-70` on `<html suppressHydrationWarning>`. Anything that changes layout (width, text size, font, spacing) must be applied the same way, or the server-rendered skeleton (`app-skeleton.scss:70`) and first paint jump. The boot script is a string, so it cannot import `readChoice`: it must parse `{ v: 1, slots }` itself, check the version and allowlist each value, and stay inside try/catch.
3. **`tinydocy-ui` slot rules.** A new slot is added to `CHOICE_SLOTS` (pinned by the contract test) with a `ChoiceSpec`: allowlist validator, fallback, `maxRecent: 0`. Payload is versioned (`STORAGE_VERSION`), capped at 64 KiB, merged per slot on write, and re-validated on read. Writes go through `rememberChoice` from an action's `run()` (or a named exception). `subscribeChoices` gives same-tab and cross-tab updates via the `storage` event. `ui` slots survive Forget; `choices` slots don't.
4. **Kill switch.** `REMEMBER_CHOICES_ENABLED=false` makes `ui` slots read fallbacks and refuse writes, so new `ui` preferences are inert under it. Details §4 says the web's page controls are hidden then; the existing pattern is to disable with a reason (`slot.ts:483-486`). Theme, folds and formats currently ignore the switch; any new design should say which side each preference is on.
5. **Forget.** Clears only `tinydocy-choices`. Preferences belong in `ui` (or their own key), never in `choices`.
6. **Apply through CSS, not plugins.** Width, text size, font and spacing should be CSS variables or `html` data attributes. HeadingScale only sets `--hd-size`, and size marks are em, so no plugin rebuild is needed (Details §4, TTP l.278).
7. **No React subscription in the editor shell.** The shell must not subscribe to editor state, and extensions must not be rebuilt per render (Tiptap calls `setOptions`, a full re-sync to Yjs; `document-editor.tsx:189-191`). A preference read in the shell must be stable or applied outside React (DOM attribute). Toolbar controls read through `useTiptapEditor`'s shared store. Smart-quote or spellcheck toggles must not rebuild the extensions array: use a plugin that checks a module-level flag, or a DOM attribute.
8. **Editor-chunk budget.** `scripts/check-editor-chunk-size.ts:22,31`: baseline 377,888 B gz, budget +23.5 KB, and raising it needs a contract amendment. Details rule 5 sets the desktop work allowance at 600 B gz for `WriteGate` plus decoration hosts. Preference UI (Page popover, Settings) must be lazy chunks that import nothing new from the editor chunk (`continue-chip` and `swatch-preview` precedent). Bundled fonts load lazily (`font-display: swap`) and add nothing to the chunk.
9. **Web CSP allows the inline boot script** only because `script-src` includes `'unsafe-inline'` (`lib/security/content-security-policy.ts:44-46`).
10. **Hosts.** Per-browser keys are per origin: `tiny.docs.plus` and `localhost` keep separate preferences.

### 4.2 Desktop vs web storage

| Concern | Web | Desktop |
|---|---|---|
| Boot-before-paint | Inline script (CSP `'unsafe-inline'`) | The desktop CSP forbids `'unsafe-inline'` (Plan S1, l.637). Use a hashed or static script, or have main pass values in (UX §3.1 already passes window state through the URL hash or `additionalArguments`). |
| `localStorage` lifetime | Per origin | Per app origin, decided by S1 (Arch D-A11: `app://tinydocy` or an https-style origin). Changing the origin later loses every `tinydocy-*` key, so pick before anything is stored. |
| Values main needs before a renderer exists | n/a | Appearance (`backgroundColor` / `nativeTheme.themeSource`), zoom factor, spellcheck on/off and languages (session-wide), window state, sidebar width, "When TinyDocy opens", update channel and auto-install, backup folder. These live in main: SQLite `meta(key, value)` (Arch l.227) or a main-owned settings file. The renderer reads and writes them through typed IPC. |
| Page-preference defaults | `tinydocy-ui` | `tinydocy-ui` in the renderer is fine (Details §4), but Settings is a separate window: it must write through the same `rememberChoice` path so the `storage` event reaches document windows, or route through main. |
| Per-document view (width override, remote images, maybe folds and continue) | IndexedDB (`doc_view`), never Y.Doc | SQLite `doc_view`, read in `local-session.open` before the editor mounts (Details §4) |
| Per-window state (reading mode, hide comments, filter bar) | `sessionStorage` or memory | main's window state, never `tinydocy-ui` (C14) |
| Identity | `tinydocy-user` | `localStorage` until P4.0, then `meta` (Arch D-A8, Plan l.983) |
| Rule for all | Preferences that change how *I* see a document never go in the Y.Doc (Details §1 rule 6). Only title, content and comments are shared. | Same |

**Suggested split for a preferences design:** (a) **app preferences owned by main** on desktop (one schema, allowlisted, persisted in `meta`, mirrored to renderers); (b) **app preferences owned by the renderer** in `tinydocy-ui` slots, shared by web and desktop; (c) **per-document view state** in `doc_view` (and a decision on whether folds and continue move there); (d) **per-window state** in main or `sessionStorage`. Each preference needs one row stating its tier, its kill-switch side, whether Forget clears it, and its boot-time path.
