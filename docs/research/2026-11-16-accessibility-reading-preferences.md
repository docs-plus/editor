# Accessibility and reading preferences for the page (desktop and web)

- **Status:** Research for owner review (2026-11-16). Nothing is built. This document edits no other file.
- **Question:** Which preferences make a long document comfortable for more people, and how should we offer them? "More people" means readers with low vision, dyslexia, motion sensitivity or colour-vision differences, readers of right-to-left languages, and people who write for hours.
- **Reads with:**
  - [Details spec §4 Page preferences](../superpowers/specs/2026-11-15-desktop-documents-and-editor-details.md). It lists the planned values this document checks.
  - [Title, tags and page preferences research §3](2026-11-15-title-tags-page-preferences.md). It is superseded in part, and §1.2 below corrects its line-length estimate.
- **Method:**
  - Repository facts were read in the code on 2026-11-16.
  - Line lengths were **measured, not estimated**. A local page laid out a fixed English prose sample of 2,430 characters in Chromium 156 on macOS. Fonts were Arial (system) and Inter, Source Serif 4, JetBrains Mono, Atkinson Hyperlegible Next and Lexend (from Google Fonts, loaded before measuring). The page counted rendered lines in a box of each column width and divided characters by lines. The result is real characters per line (CPL) with word wrap, which is lower than a naive width ÷ average-advance figure.
  - Contrast ratios were computed with the WCAG 2 relative-luminance formula, from colours rasterised in the same browser.
  - Sources are listed in §9. Anything we could not confirm against a primary source is marked *(unverified)*.

---

## 0. Answer in one table

| # | Recommendation | Evidence | Effort | Risk |
|---|---|---|---|---|
| C1 | **Define page widths in `em` of the document text size, not px.** Then the line length stays the same at every text size. Standard ≈ 33 em (about 66–72 CPL in the proportional fonts). | Strong (WCAG 1.4.8 limit of 80; 45–75 consensus; Dyson & Haselgrove 55 CPL) | S | Low |
| C2 | **Correct the Standard estimate.** Today's 648 px card at 15 px Arial gives **79 CPL**, not the 66 assumed on 2026-11-15. With fixed px, 13 px gives 91 CPL (Standard) and 126 (Wide). | Measured | — | — |
| C3 | **Text size ladder 14 · 16 · 18 · 20 · 24 · 28 · 32 px, default 16, stored as rem.** Then the browser's default font size is honoured. The planned 13 · 15 · 17 · 19 · 22 tops out at 147 % of the default, and 13 px is too small. | Moderate–strong (Rello et al.: larger type helps readers with dyslexia; WCAG 1.4.4) | S | Low (the web look changes by 1 px: owner call) |
| C4 | **Spacing: keep Compact 1.45 / Normal 1.6 / Relaxed 1.8.** Add paragraph gaps of 0.75 / 1 / 1.5 em. Lists and table cells follow (today they are hard-coded to 1.15). Headings stay tight (1.2). | Consensus (WCAG 1.5 floor); research mixed on line spacing | S | Low |
| C5 | **Full width keeps a text measure.** Paragraphs, lists and headings stay within about 46 em. Only tables, media, diagrams and code go full width. | Strong (line length) | M | Medium (layout of floats and alignment) |
| A1 | **Theme: System (default) / Light / Dark / Paper / High contrast.** Today there is only a manual Light/Dark toggle. | Strong for System (platform expectation); weak–moderate for Paper | S–M | Low |
| A2 | **Honour OS settings automatically** (§3): `prefers-color-scheme`, `prefers-contrast`, `forced-colors`, `prefers-reduced-motion`, `prefers-reduced-transparency`, browser default font size, caret blink rate. In Electron, also `nativeTheme` and `systemPreferences`. | Strong (WCAG, Apple HIG, Windows contrast-theme guidance) | M | Low |
| A3 | **Letter and word spacing: Normal / Wide / Wider.** Wider = 0.12 em letters and 0.16 em words, the WCAG 1.4.12 values. | Moderate for dyslexia (Zorzi 2012; McLeish via WCAG) | S | Medium (must pass the 1.4.12 layout check) |
| A4 | **A legible font: Atkinson Hyperlegible Next (OFL).** Add it as a fifth font. | Weak for the font itself; moderate for *offering a choice* (Wallace et al. 2022: about 35 % speed difference between a reader's fastest and slowest font) | S | Low |
| A5 | **Do not bundle OpenDyslexic.** On desktop, offer "Other installed font…" so readers who like it can still pick it. | Evidence against (Wery & Diliberto 2017; Kuster et al. 2018 on Dyslexie) | S | Low |
| A6 | **Reduce motion: System / Always.** | Strong for vestibular disorders (WCAG 2.3.3) | S | Low |
| A7 | **Links always underlined in the document.** Make this the default, not an option. | Strong (WCAG 1.4.1) | S | Low |
| A8 | **Focus ring: Standard / Strong** (Strong = 3 px with an offset). | Moderate (WCAG 2.4.13, AAA) | S | Low |
| A9 | **Interface text size independent of document text size** (100 / 115 / 130 %). | Moderate (Apple Dynamic Type; macOS per-app Text size) | M | Medium (decouple the two rem scales) |
| A10 | **Reader overrides for the author's choices:** "Show justified text left-aligned" and "Use document text colours" (on/off). | Strong (WCAG 1.4.8: no justification; the reader picks the colours) | S | Low |
| A11 | **Four named presets above the knobs:** Default, Comfortable reading, Compact, High legibility. Changing any knob shows "Custom". | Moderate (COGA Objective 8; Wallace 2022) | S | Low |
| — | Thick custom caret; sentence-level focus mode; typewriter scrolling | Weak to none (no controlled studies found) | L | High |

**Not recommended now:**
- **A custom-drawn thick caret.** It fights ProseMirror and the OS caret settings, so keep the native caret.
- **Focus mode and typewriter scrolling.** There is no outcome evidence. Keep them "later", as the spec says.

---

## 1. Planned values against the evidence

### 1.1 What the code does today (checked 2026-11-16)

| Property | Today | Where |
|---|---|---|
| Page card | `max-width: 648px`, padding `3rem` → **552 px text column** | `components/document-editor/document-editor.scss:101-121` |
| Body font | `Arial, sans-serif` | `document-editor.scss:44-46` |
| Paragraph | `font-size: 15px; line-height: 1.15; margin-top: 12px` (0.8 em) | `components/tiptap-node/paragraph-node/paragraph-node.scss:40-45` |
| List paragraphs | `line-height: 1.15`, hard-coded | `components/tiptap-node/list-node/list-node.scss:46-49` |
| Headings | `font-size: var(--hd-size, 20pt…10pt)`, **absolute pt**; `line-height: 1.15` | `extensions/shared/heading-node.scss`, `extensions/heading-scale/heading-scale.ts:101` |
| Alignment | `TextAlign` on headings and paragraphs, justify included (Tiptap default alignments) | `components/document-editor/document-editor-config.ts:223` |
| Text colour | `TextColor` mark: authors can colour text | `document-editor-config.ts:254` |
| Theme | Manual `.dark` class toggle. A boot script applies the stored value. **No System option and no `prefers-color-scheme` listener.** | `lib/theme.ts` |
| Reduced motion | Menus, popovers, palette, sheet, selection bubble, outline scroll | `app/globals.css:178-186`, `lib/heading-navigation.ts:44`, `components/ui/sheet.tsx:112` |
| Forced colours | Chrome controls (pressed and mixed buttons, slash menu, palette, status pill, colour panel). **None in the editor content** (highlight marks, selection, collaborator carets, tables). | `app/globals.css:188-219`, `components/smart-toolbar/**` |
| `prefers-contrast` | **Used nowhere** | grep |
| Scrollbars | `scrollbar-width: thin` on `*`, a 4 px WebKit thumb | `document-editor.scss:26-41` |
| Caret | Native, `caret-color: var(--foreground)` | `paragraph-node.scss:37` |

**What the 2026-11-16 spec would change.** Normal (1.6) becomes the default. Today's body line height of **1.15** is well below the WCAG 1.4.8 floor of 1.5 and below every reading-app default we know of. So the planned default is already the biggest accessibility gain in the plan.

To get it, three hard-coded values must move to variables:
- the paragraph `15px` and `1.15`
- the list `1.15`
- the heading pt sizes, which need `calc(var(--hd-size) * var(--doc-text-scale))`

Without the heading change, at 22 px an H6 (10 pt ≈ 13.3 px) comes out *smaller than the body*.

### 1.2 Line length: measured characters per line with the planned fixed px widths

Text column = card − 96 px padding: Narrow 456, Standard 552, Wide 768.

| Width | Size | Arial | Inter | Source Serif 4 | JetBrains Mono | Atkinson H. Next |
|---|---|---|---|---|---|---|
| Narrow | 13 | 75 | 70 | 70 | 56 | 77 |
| Narrow | 15 | 66 | 60 | 62 | 47 | 66 |
| Narrow | 17 | 57 | 53 | 55 | 42 | 58 |
| Narrow | 19 | 51 | 48 | 50 | 39 | 52 |
| Narrow | 22 | 44 | 40 | 44 | 32 | 44 |
| **Standard** | 13 | **91** | 86 | 86 | 67 | 91 |
| **Standard** | **15 (today)** | **79** | 74 | 75 | 59 | 79 |
| Standard | 17 | 70 | 64 | 67 | 51 | 70 |
| Standard | 19 | 62 | 59 | 62 | 46 | 63 |
| Standard | 22 | 53 | 50 | 53 | 39 | 54 |
| Wide | 13 | 126 | 121 | 121 | 94 | 126 |
| Wide | 15 | 112 | 104 | 104 | 82 | 112 |
| Wide | 17 | 97 | 91 | 94 | 72 | 101 |
| Wide | 19 | 86 | 82 | 86 | 64 | 86 |
| Wide | 22 | 75 | 70 | 75 | 56 | 77 |

Average advance per character, prose with spaces: Arial 0.443 em, Inter 0.474, Source Serif 4 0.402, JetBrains Mono 0.600, Atkinson Hyperlegible Next 0.440, Lexend 0.485, Verdana 0.510, Georgia 0.438.

**What the evidence says**
- **WCAG 1.4.8 (AAA):** a mechanism must let the reader keep lines to **80 characters or fewer** (40 for CJK). The mechanism may be the app or the browser (W3C Understanding 1.4.8).
- **Typographic consensus:** 45–75 characters, with about 66 ideal (Bringhurst, *The Elements of Typographic Style*; widely repeated, not an experiment).
- **Screen studies:**
  - Dyson & Haselgrove (2001): comprehension was best at **55 CPL** versus 100 CPL, and reading speed did not differ between 55 and 100 *(per secondary summaries; the full paper was not read)*.
  - Shaikh (2005, SURL): longer lines are read slightly faster, but people prefer shorter ones *(unverified)*.
  - Net reading: long lines save a little time and cost comprehension and comfort. For a document that people read and write in for hours, aim for about 55–75.

**Verdict on the planned px values**
1. **Today's Standard is at the edge.** It is 79 CPL in Arial: inside WCAG's 80 but above 75. The 2026-11-15 research assumed 0.55 em per character and estimated 66. That was wrong by 13 characters.
2. **With fixed px, the text-size control silently changes the measure.**
   - At 13 px, Standard is 91 CPL and Wide 126, both outside WCAG's 80.
   - At 22 px, Narrow drops to 44 in Arial and 40 in Inter. That is short enough that low-vision readers who pick large text pay with constant line returns.
3. **Mono is about 25 % narrower in characters per line** at the same width. That is fine at Standard and short at Narrow.

### 1.3 Correction C1: widths in `em`

Measured characters per line at 16 px (the count is the same at any size, because the column scales with the text):

| Column | Arial | Inter | Source Serif 4 | JetBrains Mono | Atkinson H. Next | Lexend |
|---|---|---|---|---|---|---|
| 30 em | 64 | 60 | 62 | 47 | 66 | 59 |
| 32 em | 69 | 64 | 67 | 50 | 70 | 63 |
| **33 em** (interpolated) | **≈ 71** | **≈ 66** | **≈ 68** | **≈ 52** | **≈ 72** | **≈ 65** |
| 34 em | 74 | 69 | 70 | 54 | 74 | 67 |
| 36 em | 77 | 72 | 74 | 57 | 77 | 70 |
| 46 em | 101 | 94 | 97 | 74 | 101 | 91 |

With the WCAG 1.4.12 spacing override (letter 0.12 em, word 0.16 em), which is what A3 "Wider" applies:

| Column | Arial | Inter | Source Serif 4 | JetBrains Mono |
|---|---|---|---|---|
| 30 em | 48 | 46 | 46 | 38 |
| 34 em | 55 | 52 | 53 | 43 |
| 46 em | 74 | 70 | 72 | 59 |

**Recommended column widths** (the card adds the 2 × 3 rem padding):

| Width | Text column | Card at 16 px | Proportional fonts | Purpose |
|---|---|---|---|---|
| Narrow | **30 em** | 576 px | about 60–66 CPL | Reading, dyslexia preset |
| Standard | **33 em** | 624 px | about 65–72 CPL | Default |
| Wide | **46 em** | 832 px | about 91–101 CPL | Tables, diagrams, side-by-side media. Above 80, so label it "for wide content". |
| Full | area width; text capped at 46 em (C5) | — | ≤ about 100 | Wide tables and dashboards |

- **Large text.** When the text is large, the card is wider than the window and simply fills it (`max-width`, as planned). That is the WCAG 1.4.10 reflow behaviour, and nothing scrolls sideways.
- **CJK.** 33 em is about 33 full-width CJK glyphs, inside the CJK limit of 40.
- **Owner decision O1:**
  - **(a) Recommended:** em widths plus a 16 px default. Standard is then a 624 px card, 24 px narrower than today, at about 71 CPL in Arial.
  - **(b)** Keep today's look exactly: Standard = 36.8 em, a 648 px card at 15 px, about 79 CPL. This passes WCAG 1.4.8 but sits above 75.
  - Even (b) should be in em. Otherwise the 13 px step breaks the 80-character limit.

**Outline docking.** The spec's fixed breakpoints (1240 / 1400 / 1640) assume px cards. With em widths, compute the breakpoint from the card's resolved width at the chosen text size. The decision stays "fixed per width × size", read from a table, so nothing changes width on its own.

### 1.4 Correction C3: text size

**Evidence**
- **Rello, Pielot & Marcos.**
  - 2013 study with readers with dyslexia ("Size matters, spacing not"): sizes 10–26 pt and line spacings 0.8–1.8. Font size had a significant effect on readability and on perceived readability. Line spacing did not. The authors recommend **18 pt** for web text for readers with dyslexia.
  - 2016 CHI study ("Make it big!") with a general population: comprehension and ratings were worst at 10 and 12 pt.
  - We read summaries and slides, not the full papers. How their "pt" maps to CSS px is *(unverified)*. If it is CSS pt, 18 pt = 24 px.
- **WCAG 1.4.4:** text can be resized to 200 %.
  - On the web, browser zoom already satisfies this, and the app must **not** `preventDefault` ⌘+ / ⌘− there.
  - On desktop the spec takes ⌘+ / ⌘− for text size, so the ladder itself must reach about 200 % of the default.
- **Platform defaults:** browsers 16 px; macOS body text 13 pt in AppKit. Reading apps sit higher: Apple Books, Kindle and Pocket open at about 16–20 px equivalents *(product knowledge, unverified)*.

**Recommendation**
- **Ladder:** 14 · **16** · 18 · 20 · 24 · 28 · 32 px (7 steps, each about 1.12–1.2×). 32 is 200 % of 16, and 24 matches Rello's 18 pt if those are CSS points.
  - If the owner keeps 15 as the default: 13 · **15** · 17 · 19 · 22 · 26 · 30.
- **Store it as a multiplier of `1rem`**, not px. Then a reader who set Chrome's or Firefox's default font size to 20 px gets 20 px at "default". Today the hard-coded `15px` ignores that setting.
- **Rem caveat.** The desktop app has no browser font-size setting. Electron's `webPreferences.defaultFontSize` is 16 unless we change it. So rem costs nothing there and helps on the web.
- **Size marks** (`xs`…`xl`) are in em and already follow. Headings need the `calc` scale (§1.1).

### 1.5 Correction C4: line height and paragraph spacing

| Preset | Body line height | Paragraph gap | Lists (between items) | Headings |
|---|---|---|---|---|
| Compact | 1.45 | 0.75 em | 0.25 em | 1.2 |
| **Normal (default)** | **1.6** | **1 em** | 0.35 em | 1.2 |
| Relaxed | 1.8 | 1.5 em | 0.5 em | 1.25 |
| (High legibility preset) | 1.8 | **2 em** (the 1.4.12 value) | 0.5 em | 1.25 |

- **Floors and evidence.**
  - WCAG 1.4.8 asks that a mechanism can reach line spacing ≥ 1.5 and paragraph spacing ≥ 1.5 × the line spacing. Normal and Relaxed provide that mechanism, so Compact at 1.45 is fine as a *choice*.
  - WCAG 1.4.12 (AA) asks that the layout survive line height 1.5, paragraph spacing 2 em, letter spacing 0.12 em and word spacing 0.16 em.
  - Research on line spacing *alone* is mixed. Rello found no significant effect for readers with dyslexia. Chung (2004) found little effect for low vision beyond standard spacing *(unverified)*. The 1.5 floor is consensus rather than strong evidence. The bigger, better-evidenced lever is size (§1.4).
- **Headings stay tight** (1.2), or multi-line headings fall apart. Today's 1.15 clips descenders in some fonts at large sizes; 1.2 is safer.
- **Arabic, Persian and other RTL scripts** need the extra leading for diacritics. Normal (1.6) is a good default for them. Compact may crowd vowel marks; check in review with Vazirmatn or the OS fallback.
- **Lists and table cells** must read the same variables. Today `list-node.scss:48` hard-codes 1.15, so lists would look broken next to 1.6 paragraphs.

### 1.6 Letter and word spacing (new, A3)

- **Evidence.**
  - **Zorzi et al. (2012, PNAS):** extra-large letter spacing improved text-reading accuracy (about double) and speed (more than 20 %) in Italian and French children with dyslexia. It did not help typical readers. Crowding is the proposed mechanism. Moderate evidence: one well-controlled study plus replications with mixed size. Galliussi et al. (2020) found that inter-word spacing matters as well.
  - **McLeish's spacing study** underlies WCAG 1.4.12. It tested 0.04–0.25 em. Speed rose up to 0.25 and levelled off near 0.20.
  - **The BDA style guide (2018 edition, via secondary sources):** letter spacing about **35 % of the average letter width**, and word spacing at least **3.5 × the letter spacing**. The 2023 guide page returned 404, so we could not confirm whether it changed.
- **Recommendation:** Normal (0) / Wide (0.06 em letters, 0.08 em words) / Wider (0.12 em, 0.16 em). Wider is exactly the 1.4.12 set, so the test we must pass anyway is the feature.
- **RTL check.** In Chromium 156, letter spacing on Persian text kept the letters joined; only word gaps widened (checked visually, §8). Firefox and Safari behaviour is not checked. It must be checked before the web ships this (CSS Text 3 tells user agents not to space cursive scripts, *as we recall; check*). If a browser breaks joining, scope letter spacing with `:lang()` or `[dir=rtl]`.
- **Risk:** wider text overflows fixed-width chrome inside the document, such as inline code chips, table cells with fixed widths, collaborator caret labels, the Continue chip and hovercards. That is the 1.4.12 audit list (§7).

### 1.7 Fonts

| Planned | Verdict |
|---|---|
| Default (Arial) | Keep. Arial is on BDA's recommended list and has a large x-height. Linux lacks it, so add `"Liberation Sans", Arimo` to the stack. |
| Sans (Inter) | Keep. Inter at text sizes benefits from `font-feature-settings: "cv05", "ss03"`-style disambiguation (`l` with a tail, open digits) *(feature names unverified for the bundled version)*. |
| Serif (Source Serif 4) | Keep. It is the narrowest per character (0.402 em), so the em measure matters most here. |
| Mono (JetBrains Mono) | Keep for writers who like it, as iA Writer's default is mono-like. It is 25 % fewer CPL, so Narrow + Mono at 30 em gives 47. Fine. |
| **Add: Legible (Atkinson Hyperlegible Next)** | Braille Institute, OFL. Released 2025-02-10 with 7 weights (variable), italics and 150+ languages (up from 27). Designed to separate confusable glyphs (`Il1`, `0O`, `B8`, `rn`/`m`). **Evidence:** the design rationale is clear, but we found no independent controlled study. In an informal 2022 crowd survey it scored about the same as Verdana. Offer it because choice itself helps (Wallace et al. 2022), not because it is proven better. Lazy, about 30–60 KB for Latin regular + bold *(estimate)*. |
| OpenDyslexic | **Do not bundle.** Wery & Diliberto (2017) found no gain in rate or accuracy, and no student preferred it. Rello & Baeza-Yates (2013) found sans, roman and mono fonts better than italic ones, with OpenDyslexic not better. Kuster et al. (2018) found the same for Dyslexie. Some readers still like it, and Kindle offers it, so **desktop "Other installed font…"** lets them choose it without us endorsing it. |

Font choice should never change code blocks (always mono) or the outline and chrome (Inter).

---

## 2. Correction C5: Full width

- With Full, a 1,600 px main area gives about 220 CPL at 15 px. Nobody reads that comfortably.
- Pageless Google Docs and Notion "Full width" both let text run long *(product knowledge, unverified)*, and both are criticised for it.
- **Recommendation:** in Full, cap `p`, `li`, `blockquote` and headings at `max-inline-size: 46em`. Tables, images, Mermaid and code blocks use the full area.
- **Alignment:** text stays at the start edge (left in LTR, right in RTL) with the column's start padding. It is not centred, so a wide table under a paragraph lines up with the paragraph.
- **Risk:** floated (wrapped) media next to capped text. Test wrap-left and wrap-right media at Full. Effort M.

---

## 3. What the app must honour automatically, and how

**Rule:** if the OS or browser already has the setting, follow it with no in-app control, or with an in-app control that only adds to it ("System / Always"). Never ask the reader to set the same thing twice.

| OS / browser setting | Web signal | Electron signal | What TinyDocy does | In-app control? |
|---|---|---|---|---|
| Light / dark appearance (macOS, Windows, Linux) | `prefers-color-scheme` | `nativeTheme.shouldUseDarkColors`, `updated` event. `nativeTheme.themeSource = 'system' \| 'light' \| 'dark'` also drives `prefers-color-scheme` in renderers. | **Theme "System" becomes the default.** The boot script reads `matchMedia('(prefers-color-scheme: dark)')` when the stored theme is `system`, and a listener follows changes live. On desktop, set `themeSource` from the in-app choice so native menus and title bar match. | Yes: System / Light / Dark / Paper / High contrast |
| Increase contrast (macOS) | `prefers-contrast: more`. Chromium maps macOS Increase Contrast to it (Blink intent to ship). | `nativeTheme.shouldUseHighContrastColors` | Switch to the **high-contrast token set** (§4): stronger borders, darker muted text, solid focus ring, no translucency. Guard with `(forced-colors: none)` so it does not stack on Windows contrast themes. | Same set reachable as the "High contrast" theme |
| Windows contrast themes | `forced-colors: active` (and `prefers-contrast` turns on too) | `nativeTheme.inForcedColorsMode` | Already done for chrome. **Add for the editor:** highlights → `Mark` / `MarkText` (or an outline, because forced colours drop backgrounds); selection → `Highlight`; collaborator carets and labels → `CanvasText` border plus the name; table borders → `CanvasText`; the page card edge → a 1 px `CanvasText` border at Full. Never `forced-color-adjust: none` on body text. | No |
| Reduce motion (macOS, Windows "Animation effects", iOS, Android) | `prefers-reduced-motion: reduce` | `systemPreferences.getAnimationSettings().prefersReducedMotion` (Chromium also passes the media query through) | Extend today's coverage to smooth `scrollIntoView` (outline, find, Continue), fold and unfold, toasts and pills, collaborator label fades, the Continue chip, and drag previews. Reduce means **cross-fade or instant, never slide or zoom**. | **Yes: "Reduce motion: System / Always"** (A6). Some readers want calm without changing the whole OS. |
| Reduce transparency (macOS, Windows "Transparency effects", iOS) | `prefers-reduced-transparency: reduce` (Chrome and Edge 118+; not in Safari; Firefox behind a flag) | `nativeTheme.prefersReducedTransparency` | Opaque popovers and sheets, no `backdrop-filter`, and no vibrancy in Electron windows. On the web, Safari users get it only through High contrast. | Folded into High contrast |
| Differentiate without colour (macOS) | none | `nativeTheme.shouldDifferentiateWithoutColor` | Tag colours, collaborator colours and diff or state colours always carry a second cue: name, initials, icon or pattern. Make it the **default everywhere**, so the signal only strengthens it (for example, patterned highlight swatches). | No |
| Accent colour (macOS, Windows) | CSS `AccentColor` system colour (Firefox and Safari support it; Chromium limits it, *unverified*) | `systemPreferences.getAccentColor()` (macOS 10.14+ per docs), `accent-color-changed` (Windows, Linux) | Optional "Accent: TinyDocy / System" (§4.4). Use it **only** for focus, selection tint and selected controls, and clamp it to ≥ 3:1 against the background. | Yes, on desktop |
| Browser default font size (Chrome, Firefox, Safari settings) | Root `font-size` | Electron `defaultFontSize` (fixed by us) | Document size in rem (§1.4) | Text size ladder |
| Windows "Text size" | Chromium scales the whole browser UI and content by the OS text scale (Blink discussion, 2025) | Same in Electron (Chromium) | Nothing to add. Test that it does not double-scale with our ladder. | No |
| macOS Accessibility › Display › Text size (per app, Sonoma+) | not exposed to web content | not exposed to Electron *(as far as we found)* | Provide A9 "Interface text size" instead | Yes (A9) |
| iOS / iPadOS Dynamic Type (web on iPad) | `font: -apple-system-body` (WebKit only) | — | Optional later: map "default" to `-apple-system-body` on iOS Safari, so Dynamic Type sets the default step | No |
| Caret blink rate (Windows; macOS defaults) | Chromium reads the OS blink rate (CSSWG issue on caret preferences) | Same | **Keep the native caret.** Never draw our own caret, or the OS setting and the Windows text-cursor indicator stop working. | No |
| Text cursor thickness (Windows 1–20 px) | No CSS feature. `prefers-caret-width` is only a proposal; Chromium honours the OS value inconsistently *(reports conflict)*. | Same | Keep the native caret. Keep `caret-color` at full foreground contrast (it is today). | No (see §5) |
| Always show scroll bars (macOS), Windows scroll bar settings | — | — | **Finding:** `scrollbar-width: thin` and the 4 px WebKit thumb on `*` override readers who need a big target. Keep thin bars only on overlay surfaces (popovers, outline). In High contrast and forced colours, use the default scroll bar. | No |
| Full keyboard access (macOS) / Tab focus | `:focus-visible` | same | Already: focus ring ≥ 3:1. A8 adds Strong. | Focus ring strength |
| Browser zoom (web) | — | `webContents.setZoomLevel` (Settings › General) | **Web:** never capture ⌘+ / ⌘− / ⌘0 (WCAG 1.4.4). Desktop: the spec gives them to text size, and interface zoom stays in Settings. | — |

**How the web and Electron differ in practice.**
- **Media queries.** Electron renderers get every media query above from Chromium, so one CSS path serves both.
- **Main-process APIs.** Electron-only signals are `shouldDifferentiateWithoutColor`, the accent colour, and `inForcedColorsMode` before first paint. They belong in the main process and are passed to renderers once at window creation (`additionalArguments` or a preload `contextBridge` value). Change events come over IPC.
- **The boot script** must apply the System theme before first paint on both. On the web, use `matchMedia` in the inline script. On desktop, use the preload value, so there is no flash.

---

## 4. Theme

### 4.1 Options

| Theme | Use | Default trigger |
|---|---|---|
| **System** (new default) | Follows the OS light/dark appearance | — |
| Light | Today's light | — |
| Dark | Today's dark, softened for long reading (§4.2) | — |
| **Paper** (new) | Warm, low-glare reading: Kindle "Sepia", Apple Books "Paper"/"Calm", Pocket "Sepia" *(product knowledge)* | — |
| **High contrast** (new) | Pure black on white (or white on black, following light/dark), solid 2 px borders, strong focus, no translucency, links underlined and bold | Automatic under `prefers-contrast: more` (when not in forced colours) |

Forced colours (Windows) overrides all of them, as it should.

### 4.2 Contrast check (computed)

| Pair | Colours | Ratio | Requirement |
|---|---|---|---|
| Light text / page | `#0a0a0a` on `#ffffff` | 19.8 | ≥ 7 (1.4.6 AAA) ✓ |
| Light muted / page | `#737373` on `#ffffff` | 4.74 | ≥ 4.5 ✓ (tight) |
| Light focus ring | `#525252` on `#ffffff` | 7.81 | ≥ 3 (1.4.11) ✓ |
| Dark text / page (today) | `#fafafa` on `#0a0a0a` | 18.97 | ✓, but near-maximum: see halation |
| Dark muted (today) | `#a1a1a1` on `#0a0a0a` | 7.66 | ✓ |
| **Dark `--primary` / page (today)** | `#973c00` on `#0a0a0a` | **2.79** | **✗ fails 3:1 and 4.5:1** wherever `text-primary` or `border-primary` is used: `heading-filter.tsx:116`, the button and badge `link` variants. A bug to fix regardless of this work. |
| Proposed dark document text | `#e2e2e2` on `#161616` | 13.97 | ≥ 7 ✓ |
| Proposed dark muted | `#a3a3a3` on `#161616` | 7.17 | ✓ |
| Proposed Paper text | `#3d3229` on `#f5ecd9` | 10.60 | ≥ 7 ✓ |
| Proposed Paper muted | `#6b5d4f` on `#f5ecd9` | 5.41 | ≥ 4.5 ✓ |
| Proposed Paper link | `#8a3b12` on `#f5ecd9` (underlined) | 6.59 | ≥ 4.5 ✓ |
| Proposed Paper focus ring | `#5a4632` on `#f5ecd9` | 7.59 | ≥ 3 ✓ |
| Paper border (decorative only) | `#b9a98c` on `#f5ecd9` | 1.96 | Not for controls. Input and control borders must use the focus-ring colour (≥ 3:1). |
| Kindle-like sepia, for comparison | `#5f4b32` on `#fbf0d9` | 7.31 | ✓ |
| High contrast | `#000` on `#fff` | 21 | ✓ |

**Requirements per theme:**
- body text ≥ 7:1 (AAA 1.4.6)
- muted text ≥ 4.5:1
- control boundaries and focus indicators ≥ 3:1 (1.4.11)
- links underlined (so 1.4.1 does not depend on the 3:1 link-to-text rule)
- selection tint keeps text ≥ 4.5:1 against it
- each of the 10 highlight tokens (`_variables.scss`) keeps text ≥ 4.5:1 on it, in every theme

Paper needs its own highlight palette, because yellow on cream disappears.

### 4.3 Dark mode and halation

- **Positive polarity** (dark on light) gave better proofreading and acuity for both younger and older adults (Piepenbrock et al. 2013; 2014 attributes it to smaller pupils). The percentages quoted around the web are *(unverified)*.
- One small 2024-era study found faster reading in negative polarity for young adults. Dark mode is often preferred in dim rooms.
- **Halation** (light text blooming on black, reported by people with astigmatism) is widely repeated but weakly sourced. The optical mechanism (a larger pupil in dark surroundings increases aberrations) is plausible.
- **Recommendation:**
  - Keep Light as the reading baseline, and make System the default so the OS decides.
  - In Dark, **soften the document**: page about `#161616`, text about `#e2e2e2` (14:1, still AAA), instead of `#fafafa` on `#0a0a0a` (19:1). This matches Material's dark-theme guidance of a dark grey surface with off-white text *(guidance known, not re-fetched)*.
  - Under `prefers-contrast: more`, restore maximum contrast.
  - Evidence: weak–moderate; risk: low.

### 4.4 Accent colour from the OS

- **Desktop only.** Accent is "TinyDocy" (today's amber) or "System".
- **Use it for:** focus ring, selection tint, checked radios and switches, the active outline item.
- **Never use it for:** body text, links, highlights or collaborator colours.
- **Clamp:** if the OS accent is under 3:1 against the current page (yellow on Light, navy on Dark), darken or lighten it in OKLCH until it reaches 3:1. When the clamp moves it more than a little, fall back to the TinyDocy accent.
- **Forced colours** ignore it (`Highlight` wins).
- Evidence: platform convention (macOS and Windows both expose an accent for this purpose). Effort S on desktop. Risk low.

---

## 5. Recommended additions in detail

| Preference | Values | Evidence strength | Effort | Risk | Notes |
|---|---|---|---|---|---|
| **Theme** (A1) | System · Light · Dark · Paper · High contrast | Strong (System), moderate (High contrast: HIG and Windows practice), weak (Paper: preference, glare) | S for System; M for Paper and High contrast (token sets, highlight palettes) | Low | Boot script gains the System branch. One stylesheet per token set, CSS only. |
| **Legible font** (A4) | + Atkinson Hyperlegible Next | Weak (font); moderate (choice) | S | Low | Lazy woff2 like the other fonts |
| **Other installed font** (A5) | Desktop: pick any installed family | Moderate (choice) | S–M (font list in main process) | Low | Lets OpenDyslexic, Lexend and similar fans use their font without us bundling or endorsing it |
| **Letter & word spacing** (A3) | Normal · Wide · Wider | Moderate (dyslexia) | S | Medium | 1.4.12 audit; RTL check (§1.6) |
| **Text size ladder** (C3) | 14 … 32 px, rem | Moderate–strong | S | Low | ⌘+ / ⌘− walk it on desktop only |
| **Spacing** (C4) | Compact · Normal · Relaxed | Consensus | S | Low | Lists, tables and headings follow |
| **Reduce motion** (A6) | System · Always | Strong (vestibular; WCAG 2.3.3) | S | Low | `html[data-motion=reduce]` mirrors the media query, so one CSS rule set serves both |
| **Underline links** (A7) | Always (no option) | Strong (1.4.1) | S | Low | Check the hyperlink package's own styles; `a span` is underlined today, and plain `a` should be too |
| **Focus ring** (A8) | Standard · Strong | Moderate (2.4.13 AAA: 2 px perimeter, 3:1 change) | S | Low | Strong = 3 px solid plus a 2 px offset, in every theme |
| **Interface text size** (A9) | 100 · 115 · 130 % | Moderate | M | Medium | Root font-size scales the Tailwind chrome. The document must divide it back out: `--doc-size: calc(var(--doc-step) * 1rem / var(--ui-scale))`. Check toolbar collapse tiers at 130 %. |
| **Justified text left-aligned** (A10) | On / Off (default Off) | Strong (1.4.8) | S | Low | Reader-side CSS (`text-align: start` for `[style*=justify]`), never written to the Y.Doc |
| **Use document text colours** (A10) | On (default) / Off | Strong (1.4.8: the reader picks the colours) | S | Low | Off renders `TextColor` marks as plain text and highlights as underline or outline. This also rescues authored colours that fail contrast in Dark or Paper. |
| **Presets** (A11) | Default · Comfortable reading · Compact · High legibility · (Custom) | Moderate | S | Low | §6 |
| Thick caret | Standard · Thick | Weak (requested by low-vision users; no studies) | L (custom caret layer over ProseMirror, IME and RTL bidi carets) | **High** | Not now. Revisit if `prefers-caret-width` or `caret-shape` ships. |
| Focus mode (dim other blocks) | On / Off | **None found** (vendor claims only) | S (reuses `.is-caret-block`) | Low–medium | Keep "later". When built, dim to ≥ 3:1, not `opacity: .4` (about 2:1), so low-vision readers keep context. |
| Typewriter scrolling | On / Off | **None found** | M–L (eager scroll plugin, fights `scroll-padding`) | Medium | Keep "later" with a perf spec |
| Line focus (1/3/5 lines, as in Immersive Reader) | — | Weak (vendor) | M | Medium | Not now |

---

## 6. Presets: yes, as a layer over the knobs

**Why presets.**
- **COGA Objective 8** ("Support adaptation and personalization") advises letting people pick from a small set of alternatives, with minimal effort.
- **Wallace et al. (2022)** show that the best setting differs per reader, and that stated preference does not predict which font is fastest. So a reader needs to *try* a few combinations quickly. That favours named presets with live preview, plus the knobs for fine-tuning.
- The owner already chose all the knobs (D10), so presets **add a fast path; they do not replace the knobs**.
- **Precedent:** Apple Books has six named themes plus "Customize" sliders (line, character and word spacing, margins), and Chrome Reading Mode has a font, size, line spacing, letter spacing and colour theme.

| Preset | Font | Size | Width | Spacing | Letter/word | Theme |
|---|---|---|---|---|---|---|
| **Default** | Arial | 16 | Standard | Normal | Normal | System |
| **Comfortable reading** | Source Serif 4 | 18 | Narrow | Relaxed | Normal | System (Paper offered beside it) |
| **Compact** | Inter | 14 | Wide | Compact | Normal | System |
| **High legibility** | Atkinson H. Next | 20 | Narrow | Relaxed + 2 em paragraphs | Wider (1.4.12) | System; links bold and underlined; Strong focus ring |

**Rules**
- Choosing a preset sets the knobs. Changing any knob afterwards shows **Custom** with the preset's name kept for "Reset to <preset>".
- Presets never change Reduce motion or Interface text size. Those are about the person, not the page.
- **Name presets by outcome, not by diagnosis.** "High legibility", not "Dyslexia mode". Everyone benefits, and nobody has to self-label.
- In the Page popover, presets are a `radiogroup` above the knobs. The knobs sit under a disclosure, "Adjust…", that remembers whether it was open.
- On the web, presets apply only the prefs the web has (width and text size, plus the rest when the web adopts them).

---

## 7. Implementation checks (for the P2.9c PR and design review)

1. **1.4.12 audit** with the spacing override applied to the whole page (the standard text-spacing bookmarklet), at Narrow, 32 px, Wider:
   - toolbar, Page popover, slash menu, palette, outline, tab strip and Continue chip
   - table cells and inline code
   - collaborator labels and hyperlink hovercards
   - Nothing may clip or overlap.
2. **Forced colours** (Windows High Contrast, or Chromium's emulation): highlights, selection, carets, tables, code blocks and Mermaid stay visible.
3. **`prefers-contrast: more` emulation:** the high-contrast token set applies and nothing translucent remains.
4. **Reduced motion emulation:** outline jump, find, fold, toasts and drag show no slide or zoom.
5. **RTL:** a Persian document at every spacing and letter-spacing step in Chromium, WebKit and Gecko (Playwright projects). Joining, diacritics and caret movement must hold.
6. **Contrast:** a unit test over the token sets computes the ratios in §4.2 for every theme and fails under the floors (body 7, muted 4.5, focus and controls 3, text on each highlight 4.5).
7. **Measure:** a Playwright check that Standard yields 60–75 CPL for the default font at every text size (the em-width regression guard).
8. **Perf:** a text-size or spacing change on the 1,000-heading fixture causes one layout and no HeadingScale rebuild (the existing `perf` project).

---

## 8. Notes on the measurements

- **Sample:** 2,430 characters of plain English prose written for this test (no quotations), wrapped normally (`overflow-wrap: break-word`, no hyphenation).
- **Line counting:** box height ÷ a fixed 20 px line height. Fonts were confirmed loaded with `document.fonts.check` before layout.
- **Persian letter-spacing check:** Chromium 156 on macOS, Arial with the OS Arabic fallback, at `letter-spacing: 0.12em; word-spacing: 0.16em` and at `0.35ch / 1.225ch`. Letters stayed joined; only inter-word gaps grew. Not tested in WebKit or Gecko.
- **Not tested:**
  - other languages (German compounds lower CPL; CJK is per glyph)
  - Windows ClearType metrics, which round Arial slightly differently
  - Linux font fallbacks

---

## 9. Owner decisions

| # | Question | Recommendation |
|---|---|---|
| O1 | Widths in em, and the default text size 16 px instead of 15 (Standard card 624 px, about 71 CPL)? Or keep 15 px and 648 px (36.8 em, about 79 CPL)? | Em widths plus 16 px |
| O2 | Text size ladder 14–32 (7 steps)? | Yes |
| O3 | Theme set: System default, plus Paper and High contrast? | Yes. Paper can follow in a later PR. |
| O4 | Add Atkinson Hyperlegible Next as a fifth font, and "Other installed font…" on desktop? | Yes. No OpenDyslexic bundle. |
| O5 | Full width caps text at 46 em while tables and media go wide? | Yes |
| O6 | Presets layered over the knobs, named by outcome? | Yes |
| O7 | Fix dark `--primary` text contrast (2.79:1) now, separately? | Yes, a small bug-fix PR |

---

## 10. Sources

**Standards and guidance**
- W3C, *Understanding SC 1.4.8 Visual Presentation*: https://www.w3.org/WAI/WCAG22/Understanding/visual-presentation.html
- W3C, *Understanding SC 1.4.12 Text Spacing* (McLeish study, Wayne Dick analysis): https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html
- W3C, *Making Content Usable for People with Cognitive and Learning Disabilities* (COGA), Objective 8 "Support Adaptation and Personalization": https://www.w3.org/TR/coga-usable/
- British Dyslexia Association, *Dyslexia Style Guide*. The 2018 figures come via secondary copies, for example https://uxdesign.smashingmagazine.com/2021/11/dyslexia-friendly-mode-website and https://ako.ac.nz/assets/Knowledge-centre/ALNACC-Resources/Dyslexia-resources/230907-Dyslexia-Friendly-Style-Guide.pdf. The BDA's own page returned 404 on 2026-11-16.
- Dyslexia Scotland, *Dyslexia-friendly typed formats*: https://dyslexiascotland.org.uk/dyslexia-friendly-typed-formats
- Microsoft Learn, *Contrast themes* (a minimum contrast of 7:1 in built-in themes; use system colours): https://learn.microsoft.com/windows/apps/design/accessibility/high-contrast-themes
- Microsoft Edge blog, *Styling for Windows high contrast with new standards for forced colors*: https://blogs.windows.com/msedgedev/2020/09/17/styling-for-windows-high-contrast-with-new-standards-for-forced-colors/
- Apple, *Human Interface Guidelines: Accessibility*: https://developer.apple.com/design/human-interface-guidelines/accessibility. The page body did not load for us, so the Dynamic Type, Reduce Motion, Reduce Transparency, Increase Contrast and Differentiate Without Color settings are cited from platform knowledge.

**Platform APIs**
- Electron, `nativeTheme`: https://www.electronjs.org/docs/latest/api/native-theme
- Electron, `systemPreferences`: https://www.electronjs.org/docs/latest/api/system-preferences
- Chrome, *CSS prefers-reduced-transparency* (Chrome 118): https://developer.chrome.com/blog/css-prefers-reduced-transparency
- Blink, *Intent to Ship: prefers-contrast* (macOS Increase Contrast → `more`; Windows forced colours): https://groups.google.com/a/chromium.org/g/blink-dev/c/Hy6ngo_cSgU
- Kilian Valkhof, *I no longer understand prefers-contrast*: https://kilianvalkhof.com/2023/css-html/i-no-longer-understand-prefers-contrast/
- Blink, *Intent to Prototype: meta name="text-scale"* (OS text scale and root font size, 2025): https://groups.google.com/a/chromium.org/g/blink-dev/c/2F5g2dqy9_Q
- W3C CSSWG issue on caret preferences (blink rate from the OS; proposed `prefers-caret-width`): https://lists.w3.org/Archives/Public/public-css-archive/2024Apr/0426.html

**Research**
- Wallace, Bylinskii, Dobres et al. (2022). Towards Individuated Reading Experiences: Different Fonts Increase Reading Speed for Different Individuals. *ACM TOCHI* 29(4):38. https://jeffhuang.com/papers/Readability_TOCHI22.pdf
- Zorzi et al. (2012). Extra-large letter spacing improves reading in dyslexia. *PNAS* 109(28):11455–11459. https://pmc.ncbi.nlm.nih.gov/articles/PMC3396504
- Wery & Diliberto (2017). The effect of a specialized dyslexia font, OpenDyslexic, on reading rate and accuracy. *Annals of Dyslexia* 67:114–127. https://pmc.ncbi.nlm.nih.gov/articles/PMC5629233
- Galliussi et al. (2020). Inter-letter spacing, inter-word spacing and font with dyslexia-friendly features. https://arts.units.it/retrieve/handle/11368/2960158/339575/Galliussi2020_Article_Inter-letterSpacingInter-wordS.pdf
- Rello & Baeza-Yates (2013). Good fonts for dyslexia. *ASSETS*. Kuster et al. (2018) on Dyslexie *(not re-fetched)*.
- Rello, Pielot & Marcos. Size matters (spacing not): 18 points for a dyslexic-friendly Wikipedia (*W4A* 2013), and Make it big! (*CHI* 2016). Slides: https://de.slideshare.net/mpielot/make-it-big-the-effect-of-font-size-and-line-spacing-on-online-readability-62004998
- Dyson & Haselgrove (2001). The influence of reading speed and line length on the effectiveness of reading from screen. *IJHCS* 54(4):585–612. https://dblp1.uni-trier.de/rec/journals/ijmms/DysonH01.html
- Piepenbrock, Mayr, Mund & Buchner (2013). Positive display polarity is advantageous for both younger and older adults. *Ergonomics*. https://documentacion.fundacionmapfre.org/documentacion/publico/pt/bib/143702.do
- Atkinson Hyperlegible Next release, 2025-02-10: https://www.ophthalmologymanagement.com/news/2025/applied-design-and-braille-institute-partner-to-launch-typeface-for-making-reading-easier. Wikipedia: https://en.wikipedia.org/wiki/Atkinson_Hyperlegible. Informal survey: https://github.com/thibaudcolas/readability-group-survey

**Products**
- Apple Books themes and Customize: https://support.apple.com/guide/books/ibks8923126d. Slider ranges *(unverified)*: https://veroniiiica.com/ereader-apps-and-low-vision-accessibility/
- Chrome Reading mode: https://support.google.com/chrome/answer/14218344
- Kindle, Pocket and iA Writer options are cited from product knowledge *(unverified)*.
- Focus and typewriter modes: no controlled studies found; vendor pages only, for example https://novela.so/en/blog/distraction-free-writing-myth
