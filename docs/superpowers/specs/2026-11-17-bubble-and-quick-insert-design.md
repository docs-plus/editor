# Selection bubble and quick insert: design

- **Status:** **Approved by the owner, 2026-11-17** ("Approve as recommended"): every decision in §2 as recommended, including O11 a (one row), O1 a, O2 b, O4 a, O5 a + c, O6 a, O7 b, O8 a, O12 a and BQ1–BQ11. Plan: [`docs/superpowers/plans/2026-11-17-bubble-and-quick-insert.md`](../plans/2026-11-17-bubble-and-quick-insert.md).
- **Why now:** the owner shared two screenshots of another editor's selection bubble and bottom insert pill. They asked for a rethink of TinyDocy's bubble and quick-access surfaces that covers every state, edge case and platform.
- **Decides:**
  - what lives in the bubble, the Insert surfaces, the row and the page menu;
  - colour and highlight, block type and lists, links;
  - the comment and reaction entry points;
  - page-level actions;
  - placement, collision, motion and shortcut hints;
  - phone, tablet, desktop (Electron) and RTL behaviour;
  - one engineering correction: how the bubble attaches to the editor.
- **Prototype:** [`docs/design/2026-11-17-bubble-quick-insert-prototype.html`](../../design/2026-11-17-bubble-quick-insert-prototype.html). It is clickable and has switches for each owner decision, theme, RTL, reduced motion and device. It is throwaway, not app code.
- **Screenshots of today's UI:** [`docs/design/2026-11-17-bubble-quick-insert/current/`](../../design/2026-11-17-bubble-quick-insert/current/). They were taken from `main` at `f9cfc3a` on `next dev`, headless Chromium, at 2× and 3×.
- **Parent and sibling documents.** This spec ties into each of them and amends some (the list at the end of §2):
  - [Smart toolbar design](2026-11-12-smart-toolbar-design.md) and [design pass](2026-11-13-smart-toolbar-design-pass.md);
  - [v1 contract](2026-11-13-smart-toolbar-v1-contract.md) (A9–A17);
  - [Comments](2026-11-16-comments-design.md), [Preferences](2026-11-16-preferences-design.md) and [Phones and tablets](2026-11-16-phones-tablets-design.md);
  - [Desktop UX](2026-11-15-desktop-ux-design.md) and [Documents and editor details](2026-11-15-desktop-documents-and-editor-details.md) (D23 ledger, rule 6);
  - [Languages and RTL](2026-11-16-languages-rtl-design.md).
- **Evidence labels:**
  - *measured* means run here, with the method given.
  - *source* means read in the installed code.
  - *[unverified]* was not checked.

---

## 1. Summary

Most of what the owner's reference shows is already in TinyDocy. Some of it is in the wrong place, some is hidden, and some stops short of the last detail.

- **The bubble is too thin.** It has B, I, U, the colour split, Link and Paint format. Strike, inline code and the block type are absent, so changing "this heading to H3" means a trip to the row at the top of the window.
- **Quick insert is split three ways:** the row's `+ Insert`, the "/" menu, and List ▾. Only "/" sits near the caret, and "/" needs a key that some RTL phone keyboards hide.
- **Page-level and preference actions** are mixed into the row's ⋯ with superscript and "Forget my choices".

The design keeps everything that works:
- the registry as the one source of actions;
- Alt+F10 into the bubble and Esc back out;
- hiding the bubble on typing;
- the hover preview;
- the remembered choices;
- the "/" menu;
- the phone bar with no scrolling.

It then makes four moves, plus focused amendments to the "/" menu (§8.5) taken from the owner's second reference set (Notion):
1. **A fuller bubble with one fixed layout:** Style ▾ │ B I U S ‹› Tx │ Colour Link Paint │ Comment. It stays one row, not Notion's vertical panel (O11).
2. **One caret-local, non-typed way to insert on desktop:** a `+` on the empty line, which opens the same list as "/".
3. **A phone Insert sheet**, replacing today's desktop-style dropdown.
4. **The bubble attaches without registering a ProseMirror plugin.** Today's lazy `<BubbleMenu>` breaks an AGENTS.md rule and rebuilds every plugin view late, after the editor is interactive. The measurement and its real, modest impact are in §4.1.

The reference's bottom insert pill and "Make page wide" item are deliberately **not** copied on desktop. Why is in §8.4 and §9.

---

## 2. Decisions to approve

> **Approved by the owner, 2026-11-17: "Approve as recommended."** Each row below is decided as its Recommendation column says.

Each row is either a proposal (BQ*n*) or an owner choice (O*n*). Each owner choice has options and a recommendation, and the prototype lets you switch between the options.

| # | Decision | Recommendation |
|---|---|---|
| **BQ1** | **Bubble layout.** It is fixed and never reorders. Groups, with three separators: `Style ▾ │ B I U S ‹› Tx │ A▁▾ 🔗 🖌 │ 💬`. 💬 is present only where `canComment()` is true, at the trailing edge, so its absence never shifts anything else (§6). | Approve |
| **O1** | **Block type in the bubble.** (a) one **Style ▾** menu, also called "Turn into": Text, H1–H3, More headings ▸, Bulleted, Numbered, Task, Quote, Code block. (b) Two menus, **H ▾** and **List ▾**, as in the reference. (c) None, as today. | **(a)**: one decision, one target, and the face shows the current type |
| **O2** | **Colour menu.** (a) Today's swatch grid, plus a **live caption** naming the pointed or focused swatch, and a "Recent" row. (b) **Named rows** like the reference: Default plus five curated colours, then "More colours ▸" for the other five. Highlight the same way. | **(b) on every desktop surface**, the bubble and the row: one concept per job (dp principle 2). **Phones keep the grid**, with a caption naming the current value and a pill that names each applied colour, with Undo. Touch has no hover, so the caption can't name a swatch before it is tapped (§7.3). |
| **O3** | **Comment slot.** cm:467 says "last in the bubble"; the design pass ends with 🖌. Put 💬 after 🖌 and gate it on `canComment()`. | Approve as written. This amends dp:25. |
| **O4** | **Reactions.** (a) None in v1, as comments C12 has it. (b) A reaction is a comment thread whose first message is one emoji: no new storage, rendered as an emoji chip in the margin. (c) Dedicated `r:` keys in the `comments` map, with validator changes. | **(a) now, (b) as v1.1 candidate** |
| **O5** | **Desktop quick insert.** (a) A `+` button on the empty line under the caret (and on hover). Clicking it types the "/" for you, so it opens the ordinary "/" menu (§8.2). (b) A floating bottom pill like the reference. (c) Nothing new beyond the "Type / for blocks" placeholder (OB2). | **(a) + (c)**. (b) is rejected for desktop (§8.4). |
| **O6** | **Phone Insert.** (a) The Insert cell opens a bottom **sheet**: a two-column grid with icons and labels, built from the "/" menu's items. An optional Suggested section sits on top; the fixed sections below never move. 44 px targets. (b) Keep today's dropdown. | **(a)** |
| **O7** | **Keyboard selections.** (a) Show the bubble, as today. (b) Show it only after Shift is released and the selection has settled for 300 ms. (c) Never show it for keyboard selections; Alt+F10 still opens it. | **(b)** |
| **O8** | **Touch tablets (≥ 768 px, coarse pointer).** (a) Keep "no bubble, the row only" (ph:47), but give the row's stand-ins a fixed word: **Format**, **Layout** and **Block**. (b) A selection bar docked at the bottom, made of the phone selection cells. It needs a real-iPad spike for the iOS callout. | **(a) now; spike (b)** |
| **O9** | **Page width.** It is **not** a quick-access item. It goes in the row's ⋯ under a new "View" group and in the palette, routed to the preferences spec's `page.width` and `doc.width` (§9). "Make page wide" becomes the "Page width ▸" submenu. | Approve |
| **O10** | **Motion token.** One token for every editor popover, including the bubble: enter 120 ms (opacity, scale 0.98 → 1, `cubic-bezier(0.2,0,0,1)`); exit 80 ms (opacity, linear). Under reduced motion, no animation. This amends tb:116 (140/90 ms). | Approve |
| **BQ2** | **Engineering.** The bubble stops using Tiptap's React `<BubbleMenu>`, which calls `registerPlugin` from the lazy chunk. Instead, the lazy chunk listens to editor events and positions with `@floating-ui/dom`, which is already one shared copy in the editor chunk. The editor-chunk change is a **measured gate**, expected ≤ 0 B; the bubble chunk should shrink (§4.1, §12). | Approve. This is phase 0 and ships first, on its own. |
| **BQ3** | **Anchor to the first selected line**, never the union rectangle (§10.1). The bubble and its menus **never cover the selection**. They may cover the line above it, as any bubble does. | Approve |
| **BQ4** | **The row's ⋯ becomes three labelled groups:** Text, View, Help, with "Forget my choices…" on its own at the end (§9.2). Nothing is removed. | Approve |
| **BQ5** | **Toggle (details) and Date blocks** are **out of this design's scope.** Both are schema additions (allowlist first, schema floor). They get their own spec if wanted. | Approve |
| **O11** | **Bubble shape** (second reference set: Notion's vertical panel). (a) **One row**, as in BQ1, plus Tx (clear formatting). (b) A **vertical sectioned panel**: a "Turn into" row with a side submenu; a 5 × 2 grid of marks; a Comment row; no AI section. | **(a)**. (b) covers 8–10 lines of the writer's context and doesn't fit above a selection in a 720 px window (§7.8). The prototype has both. |
| **BQ6** | **Clear formatting (Tx, ⌘\\) joins the bubble's marks group**, after ‹›. It keeps links, as the registry's `format.clear` does today. | Approve |
| **BQ7** | **No AI or "Skills" slot,** and no reserved space for one (§7.9). | Approve |
| **BQ8** | **Chrome follows the interface direction; position follows the text.** Item order, submenu side and arrow keys follow `<html dir>`. The anchor follows the selected text's geometry, whatever its direction (§13.4). | Approve |
| **BQ10** | **Every bubble action keeps a twin in the row** (the bubble-in-row matrix test stays as it is). The row's Style ▾ gains **Quote** and **Code block** as conversions (today they are only inserts). 💬's twin is the row's **Insert › Comment** (cm:469), shown where `canComment()` is true. | Approve |
| **BQ11** | **One word per block type everywhere:** "Text" (the row's "Normal text" face becomes "Text"). Faces abbreviate headings to H1–H6 for width; menus and accessible names use the full label ("Heading 2"). | Approve |
| **O12** | **"/" menu, Suggested section.** (a) Up to 3 recent **insert kinds**, from the existing `INSERT_KIND_CHOICE`, with its `maxRecent` raised from 0 to 3. That is local only, never Yjs, and adds no new slot or write path. (b) A new `recentBlocks` slot written by every `style.*`, `list.*` and `insert.*` `run()`. (c) No Suggested section. | **(a)** (§8.5) |
| **BQ9** | **"/" menu details:** an inline "Type to search" ghost after the "/" (no search field, so focus never leaves the editor); a pinned footer with the highlighted row's Markdown tip and **Close menu · esc**; "New" badges that expire on a fixed date or on first use, with no storage (§8.5). | Approve |

**On approval, these other specs change:**

| Spec | Section | Change |
|---|---|---|
| Smart toolbar design | tb:116 | Bubble contents, timing (O10), anchor (BQ3) and attachment (BQ2) |
| Design pass | dp:25 | Bubble order: Style ▾ and S ‹› added; 💬 after 🖌 (O3) |
| Desktop UX | ux:679 | Its popover motion token now also covers the bubble, "/" and `+` (O10) |
| Phones and tablets | ph:47 | Touch tablets get stand-in words (O8 a) |
| Phones and tablets | Aa sheet | Style moves first (§13.1) |
| Phones and tablets | Insert cell | Opens a sheet (O6) |
| Comments | cm:467 | Confirmed: 💬 is last, after 🖌; a comment-only bubble in reading mode (§7.2) |
| v1 contract | §5.2, §6 | The DOM contract is unchanged (root attached on show, removed on hide). `BUBBLE_KEY` meta goes away (BQ2). `INSERT_KIND_CHOICE.maxRecent` 0 → 3 (O12). Both are recorded as amendment A18. |
| v1 contract | §5.1 (D1's row files) | The row's Style ▾ face says "Text", and the menu gains Quote and Code block as conversions (BQ10, BQ11). |
| Documents and editor details | dt:276 ("already strong, don't rebuild") | The "/" menu gains Suggested, the ghost hint, the footer and badges. These are amendments, not a rebuild (§8.5). |
| Comments | cm:469, §11 | The row's Insert › Comment is 💬's twin (BQ10). The draft card gains a "Suggest a change" toggle into P4.12's suggested replacement (§7.6). |
| Preferences | web ⋯ › Page… | Becomes ⋯ › View › Page width ▸ (O9, BQ4). |

---

## 3. Is the reference TinyDocy?

**No.** TinyDocy has no comment button, no reaction button, no H ▾ in the bubble, no list ▾ in the bubble, no floating bottom pill, no Date or Toggle block, and no "Make page wide".

The reference is most likely Claude's Docs artifact viewer. Its public UI uses the same strings: "Make page wide", "Back to default width" and "Page is wide". It also ships an emoji picker and a comment rail. This identification is *[unverified]* visually. We use it only as a reference for interaction. We copy no code and no look.

| Reference element | TinyDocy today | This design |
|---|---|---|
| 💬 comment in the bubble | none (comments not built) | 💬 trailing, `canComment()` only (O3) |
| ☺+ reaction in the bubble | none, and no spec | none in v1 (O4) |
| H3 ▾ in the bubble | row Style ▾ only | Style ▾ in the bubble (O1) |
| B I U S | B I U (S only in the row) | B I U S |
| `{}` inline code | ⋯ › Inline code | ‹› in the bubble |
| Palette ▾: Text section (Default + 5) and Highlight section (None + Yellow), named rows, ✓ on the current value | split face + a grid of 11 unlabelled swatches per section | named rows in the bubble (O2) |
| List ▾ in the bubble | row List ▾ | inside Style ▾ (O1) |
| Link | Link (opens the Hyperlink popover) | Link, with focus in the field on the first frame and a crossfade. In v1 it opens below the selection, because the package fixes the side (§7.5). |
| Bottom pill: Tt, table, image, checklist, toggle, ⋯ | phone bar: Undo, Aa, B, I, List ▾, Indent, Insert ▾ | desktop `+` on the empty line (O5); phone Insert sheet (O6) |
| ⋯: Bulleted, Numbered, Quote, Code block, Divider, Date, Make page wide | Insert: Image, Embed, Table, Quote, Code block, Diagram ▸, Divider | Insert unchanged; page width moves to ⋯ › Page (O9) |

---

### 3.1 The second reference set: Notion

The owner later added Notion's selection menu, Turn into, colour popover and "/" menu, all in dark mode over a Persian document. Notion's **interface stays LTR** while the text is RTL:
- the menu order is unchanged;
- the Turn-into submenu opens to the right;
- the "/" list aligns to the "/" at the left of the ghost.

That separates two directions that this spec keeps apart (BQ8): the **interface** direction drives chrome, and the **content** direction drives anchoring.

| Notion element | This design |
|---|---|
| Vertical sectioned panel | Considered as O11 b; one row recommended (§7.8) |
| "Normal Text ›" turn-into row with a side submenu | Style ▾ face word + menu (§7.4); the side submenu is used only in O11 b |
| Tx clear formatting, top level | Tx in the bubble (BQ6) |
| √x inline equation, ⋯ | No math in the schema; Superscript and Subscript stay in the row's ⋯ |
| Comment row + ☺+ + suggest-edit | 💬 trailing (O3); reactions O4; "Suggest a change" inside the comment card, which is comments P4.12's suggested replacement (§7.6) |
| Skills / Edit with AI | No AI slot (BQ7, §7.9) |
| Colour: Recently used, then a 5 × 2 text grid, then a 5 × 2 background grid | Recent first, then named rows in two columns (§7.3) |
| "/" ghost "Type to search", Suggested with a "New" badge, Markdown hints, "Close menu · esc" footer | §8.5 (O12, BQ9) |

## 4. Current state: audit

The screens are in `docs/design/2026-11-17-bubble-quick-insert/current/`. The file names below are relative to that folder.

### 4.1 Engineering finding: the bubble registers a plugin from a lazy chunk

**What the code does:**
- `components/smart-toolbar/bubble/selection-bubble-view.tsx` renders Tiptap's React `<BubbleMenu>`.
- That component calls `editor.registerPlugin()` when it mounts and `unregisterPlugin()` when it unmounts (`@tiptap/react` 3.33.1, `src/menus/BubbleMenu.tsx:107,116`; *source*).
- `registerPlugin` reconfigures the state, and `updatePluginViews` destroys and rebuilds every plugin view when the plugin list changes (`@tiptap/core` `Editor.ts:407-417`, `prosemirror-view` `index.ts:256-267`; *source*).
- AGENTS.md says "never `registerPlugin` from a lazy chunk (it re-creates every plugin view)".

**Measured** with a temporary Playwright probe:
- Setup: `next dev`, Chromium, a 200-paragraph document. The bubble chunk was held with `holdChunk`, then released.
- Before the release: 159 plugins and 29 plugin views.
- After it: 160 plugins and 30 views. **0 of 29 view objects were reused.**
- `view.updateState` took 0.5–0.6 ms in three runs.
- No transaction was dispatched, and the DOM was kept. y-tiptap's `_forceRerender` would replace the whole document, but this repo's `collaboration-render-once.ts:96-101` guard stops it.

**How much this matters (corrected by the staff review):**
- **Every tab switch already rebuilds all plugin views.** Tiptap's `EditorContent` registers `mobileEnterPlugin` on each mount (`EditorContent.tsx:149,176`), and tabs remount the editor (`key={activeTabId}`).
- **The bubble adds** one late rebuild when its chunk lands, and one more at unmount. Its views tear down **after** the editor is already interactive.
- **The views that hold state:**
  - heading drag;
  - heading filter;
  - heading fold (already mitigated with `keepViewOnReconfigure`);
  - the hyperlink hover card;
  - remote carets (yCursor);
  - y-undo. Its `manager.destroy()` is undone by Collaboration's restore patch (`collaboration.ts:180-200`).
- The slash trigger and the TOC have no views.
- **Severity:**
  - It is a rule violation with a small, real cost: a late rebuild while the writer may already be hovering a drag handle or a link card.
  - It is **not** a performance problem.
  - It is the cause of the `requestAnimationFrame` re-append workaround at lines 207–222 of that file.
- **The mitigations stay after BQ2:** `keepViewOnReconfigure`, the fold reschedule and the render-once guard. `mobileEnterPlugin` keeps rebuilding views on every mount, which is outside this design (§17).

**Fix:** BQ2 (§12).

### 4.2 The bubble on desktop

Screens: `desktop-*-02-bubble`, `-03-bubble-colour`, `-11-narrow-bubble`, `-12-bubble-title` and `-14-alt-f10`.

| # | Finding | Evidence | Severity |
|---|---|---|---|
| F1 | **No block type.** To make a selected line a heading or a list, the writer leaves the selection for the row, which can be far away. | 02 | High |
| F2 | **No Strike, no inline code.** Strike is in the row. Inline code sits in ⋯ beside Superscript, three clicks away. | 02, 07 | Medium |
| F3 | **The anchor is the union rectangle.** On a selection that starts mid-paragraph on its second line, the bubble centres on the union box. It covers the heading above, and its left edge sits left of the selected text. | 14 | High |
| F4 | **The colour popover is a grid of 11 + 11 "A" swatches with no visible names.** Names are only in `aria-label` and tooltips. Telling red, orange and pink apart, or a pale highlight from none, depends on seeing the colour (WCAG 1.4.1 risk). The ✓ badge sits on the swatch's corner. | 03 (both themes) | Medium |
| F5 | **The colour popover opens upward from a bubble that is already above the text.** The stack (popover, bubble) covers three lines of context above the selection and reaches the sticky row. | 03 | Low |
| F6 | **Keyboard selections open the bubble too.** Shift+Arrow shows it, and every further Shift+Arrow moves it. Word shows its mini toolbar only for mouse selections. | 14 | Low (O7) |
| F7 | **Link is a context switch.** Clicking 🔗 closes the bubble and opens the Hyperlink extension's own popover below the text, with a field and Apply. On a link, the hover card offers copy, edit and unlink, but no "open". | 15, 16 | Medium |
| F8 | **The title gets the full bubble**, which is correct. The row shows "Title" with a lock, but the bubble shows no hint that colour applies and size does not. | 12 | Low |
| F9 | **Good, and to keep:** hidden on typing, in code and in links; Alt+F10 lands on B, whose tooltip reads "Bold **text** ⌘B"; Esc returns with the selection; flips below the sticky row and remote caret labels; colour hover preview; recent colours. | 14 | — |

### 4.3 Quick insert on desktop

Screens: `desktop-light-06-insert-menu`, `-07-more-menu`, `-08-slash`, `-09-slash-query` and `-10-palette`.

| # | Finding | Severity |
|---|---|---|
| F10 | **`+ Insert` sits at the far end of the row, top right.** It is the one block-insertion control a mouse user can find, and it is the farthest from the caret. Its rows show no shortcut or "/" hint. | Medium |
| F11 | **The three insert lists overlap but differ.** Insert has 7 kinds. List ▾ has 3 lists. "/" has Text, Lists, Insert and Diagrams. A writer who learned "/" finds headings and lists there, and not in Insert. | Low |
| F12 | **"/" is strong, but has three gaps against the second reference set:** no Suggested section, no hint in the line that it filters, and no close affordance for pointer users. Beyond those, **"/" is strong.** It has sections, Markdown hints (`#`, `##`, `-`, `1.`, `[ ]`), H4–H6 for search only, combobox semantics without `aria-expanded`, a polite live region, and flips above. Keep it. It is on the "already strong" list (dt:276). Its one gap is **finding it**: the placeholder says "Type something…", not "/". | Low |
| F13 | **The row's ⋯ mixes four kinds of thing.** Marks (Superscript, Subscript, Inline code), tools (Clear formatting, Paint format), memory (Forget my choices), help (All actions… ⌥/) and preferences (Simplified toolbar, Appearance ▸). | Medium |
| F14 | **The palette is good.** Its sections, shortcuts and ✓ states all come from the registry. | — |

### 4.4 Phone (390 and 320 px, touch)

Screens: `phone-*-01-bar`, `-02-selection-cells`, `-03-format-sheet`, `-04-insert`, `-05-slash` and `phone320-dark-02-selection`.

| # | Finding | Severity |
|---|---|---|
| F15 | **Insert is a desktop dropdown anchored to the bar's last cell.** It covers the right half of the text. The presence pill's "1 use…" shows through at its left edge, which is a stacking-order bug. The rows are 44 px tall, but there are no recent items and no grid. | Medium |
| F16 | **The Aa sheet leads with 22 colour swatches.** Style (Normal text, H1…) starts below the fold of a sheet that covers about 60% of the screen. Style is used more than colour. | Medium |
| F17 | **The selection cells are good**: B I U A▁ ✎▁ 🔗 🖌 ✕, no scrolling. At 320 px, U moves to the sheet as designed. | — |
| F18 | **Two floating pills stack over the text above the bar**: presence, then Discord, GitHub and Privacy. Any phone quick-access design must not add a third. This is out of scope here; see the follow-ups (§15). | Low |
| F19 | **"/" works on phones** (44 px rows, above the bar). It has no non-typed twin near the caret, and on Arabic-101 and old Hebrew layouts "/" is not on the first keyboard page (Appendix A). | Low |

### 4.5 Touch tablet (820 px, touch)

Screen: `tablet-light-02-selection`.

| # | Finding | Severity |
|---|---|---|
| F20 | **A selection shows nothing near the text** (by design, ph:47). The row at this width uses stand-ins whose icons don't explain themselves: `T ▾` (Aa), `¶ ▾` (paragraph) and `⫶ ▾` (slot). | Medium (O8) |

### 4.6 Spec conflicts found

These are already approved, and they disagree with each other.
1. The last slot in the bubble: the comments spec says 💬 (cm:467); the design pass says 🖌 (dp:25). Resolved by O3.
2. Motion: the bubble has 140/90 ms (tb:116); desktop popovers have 120/80 ms (ux:679); the pill 150 ms; sheets 200 ms; comment cards 120 ms. Resolved by O10, for editor popovers only. Sheets keep 200 ms.
3. Comments C11, §8 and CR7 still quote "the 600 B allowance", which D23 replaced. This spec quotes D23.

---

## 5. Research summary

The full digest, with sources, is Appendix A. These are the patterns that shaped the design.

**Adopted:**
1. **The bubble holds only selection-scoped actions; block creation lives at the caret.** Notion, Craft, Linear, Medium.
2. **The block type is one control whose face shows the current type:** Notion's "Text ⌄", Coda's type tile, the reference's "H3 ⌄".
3. **One colour menu with labelled Text and Highlight sections**, an explicit Default and No highlight, and ✓ on the current value: the reference, Notion.
4. **Comment is the one collaboration verb on a selection**, with ⌥⌘M. Google Docs, Linear, Notion, Outline, Paper.
5. **No floating bubble on touch.** Phones use a bar above the keyboard, and its "+" swaps the keyboard for a block grid. Notion, Apple Notes and Pages, Bear, Paper.
6. **Every bubble action has a second route:** the row, a shortcut, the palette or a menu. Google Docs pairs its margin pill with Insert › Comment and Ctrl+Alt+M.
7. **A selection inside a code block, an IME composition or a drag hides the bubble.** Lexical; Confluence's IME bug as the counter-example.
8. **APG toolbar:** one Tab stop, arrows, Alt+F10 to enter (CKEditor precedent), Esc back.
9. **Anchor to the selected line, not the union box.** Floating UI `inline()`.

**Rejected:**
1. **A floating insert pill on desktop.** It duplicates the sticky row, collides with the presence, footer and status pills, and covers the bottom lines while typing (WCAG 2.4.11). See §8.4.
2. **Usage-adaptive ordering.** Already rejected (tb:24); fixed faces stay.
3. **AI or promo buttons in the bubble.** Confluence's "Ask Rovo" drew heavy complaints.
4. **Reactions on whole blocks only.** Linear. If reactions come, they anchor to text like comments (O4b).
5. **Medium's repeat-click cycling** (one T button that cycles H → sub → plain). It is a changing face, which conflicts with dp principle 1.

---

## 6. Principles

1. **Three surfaces, one registry.** The bubble formats *this text*. Quick insert makes *a new block here*. The row and the palette hold *everything*. Every item in the bubble and in quick insert is also in the row or the palette, and the bubble-in-row matrix test stays.
2. **Fixed layout per context kind.** Nothing reorders by usage. An item that can't run is disabled with a reason. An item that never applies in this *document kind* (💬 in the sandbox) is absent, because the kind doesn't change while the document is open (ph:323).
3. **Near the caret, not near the chrome.** The two most frequent decisions, block type and insert, get a control within reach of the text.
4. **Never cover what the writer is working on.** Don't cover the selection, the caret line, a remote caret label or the focused control (WCAG 2.4.11).
5. **Zero eager bytes.** Every new surface is lazy. Nothing calls `registerPlugin` after the editor exists. Nothing subscribes the editor shell to editor state (D23, AGENTS.md).
6. **Names over swatches.** A colour is always shown with its name, either visible or in a live caption (WCAG 1.4.1).
7. **Platform-native where the platform has a convention:** the iOS callout, Android's floating toolbar, Electron's native context menu with spellcheck and Writing Tools.

---

## 7. The selection bubble (desktop and fine pointer)

### 7.1 Anatomy (BQ1, O1 a, O2 b, O3)

```
┌──────────────────────────────────────────────────────────────────────┐
│ H2 ▾ │ B  I  U  S  ‹›  Tx │ A▁▾  🔗  🖌 │ 💬 │
└──────────────────────────────────────────────────────────────────────┘
  style   marks + clear            colour link paint  comment (canComment only)
```

| Slot | Control | Registry id | Face | Tooltip (fine pointer) |
|---|---|---|---|---|
| 1 | **Style ▾** (menu button) | `style.*`, `list.*`, `insert.quote`, `insert.codeBlock` | The current type as one fixed word: `Text`, `H1`–`H6`, `Title`, `List`, `Quote`, or `Mixed`. Width is fixed per locale, at least 64 px (§7.1 Sizes), so the face never moves the other items. | "Turn into" |
| 2 | Bold | `mark.bold` | B | Bold **text** ⌘B |
| 3 | Italic | `mark.italic` | I | Italic *text* ⌘I |
| 4 | Underline | `mark.underline` | U | Underline ⌘U |
| 5 | Strike | `mark.strike` | S | Strike ~~text~~ ⌘⇧S |
| 6 | Inline code | `mark.inlineCode` | ‹› | Inline code \`text\` ⌘E |
| 6b | Clear formatting (BQ6) | `format.clear` | Tx `RemoveFormatting` | Clear formatting ⌘\\ (keeps links) |
| 7 | **Colour** (split) | `color.text.apply`, `color.highlight.apply`, `*.unset` | A▁ shows the last text colour; ▾ opens the menu (§7.3) | Text colour: Red (the last colour, applied on click) |
| 8 | Link | `mark.link` | 🔗 | Link ⌘K |
| 9 | Paint format | `paint.*` (existing) | 🖌 | Paint format · Select text after clicking · Esc to cancel |
| 10 | Comment | `comment.add` (comments PR P4.10) | 💬 `MessageSquarePlus` | Comment ⌥⌘M (macOS) / Comment (other OSes: menu only, cm:466) |

**Sizes:**
- Buttons are 28 × 28 px with 2 px gaps.
- The colour split's ▾ is **24 px** wide. At 18 px it would fail 2.5.8's spacing exception.
- Separators are 1 px with 4 px margins.
- **Style face width** is the longest face word in the active locale, measured once at mount, with a minimum of 64 px and `padding-inline: 8px 4px`. If a translated word would make it wider than 96 px, the face shows the type's icon plus a chevron instead of the word. The face never reflows while open.
- Measured in the prototype: 433 × 38 px with 💬, 392 × 38 px without. §16 keeps these as a screenshot check, not a hard number.

**Shape and colour:**
- Radius `--radius` (0.45 rem) and `shadow-md`.
- **Light:** background `--popover`; the edge is `oklch(0.87 0 0)`, chosen on looks.
- **Dark:** a scoped `--bubble-surface: oklch(0.24 0 0)` for the bubble and its menus, with an edge of `oklch(1 0 0 / 36%)`. Today `--popover` and `--card` are both 0.205, so the bubble has no fill contrast against the page (UI review).
- **1.4.11 does not rest on the edge.** Measured: `oklch(0.80)` against the white card is only 1.87:1, and reaching 3:1 would need L ≤ 0.669, which is too heavy. Each control is identified by its own glyph. The parts 1.4.11 does cover are:
  - the **focus ring**: `--focus-ring`, 7.8:1 in light and 12.1:1 in dark, drawn **inside** each button (`outline-offset: -2px`) so it never overlaps a neighbour across the 2 px gap;
  - the **pressed bar**: `--foreground` on the surface, about 19.8:1.
- **Mixed** state is a 2 + 2 + 2 px dashed bar, never the same solid bar in grey.
- **Forced colours:** the edge is `CanvasText`, pressed is `Highlight`, and swatch chips keep their colour with `forced-color-adjust: none` (the chip only).

**What is deliberately not in the bubble:**
- Size: headings scale on their own, and the stepper stays in the row.
- Align and indent: they apply to whole blocks, not the selected text.
- Superscript and subscript: rare; they stay in ⋯ and the palette.
- Lists as a separate menu: they are in Style ▾.
- AI: there isn't any.

**Why 💬 is last** (O3):
- Its presence depends on the document kind: off in the sandbox and the Playground, on in library and desktop documents. At the end, its absence shifts nothing.
- cm:467 already asks for "last".
- Comment is about the text, not formatting, and the separator says so.

### 7.2 Context variants (fixed per kind)

| Context | What changes | Why |
|---|---|---|
| Paragraph | — | |
| Heading H1–H6 | Style face `H2`. All marks apply. | |
| **Title** (first H1) | Style face `Title`, menu disabled: "Title is always H1." Everything else as normal. | Schema title-first |
| List item | Style face `List`. The menu ✓s the current list type. | |
| Task item | Style face `List` with Task ✓. | |
| Blockquote | Style face `Quote`. | |
| **Selection across blocks of different types** | Style face `Mixed`. Choosing a type converts every selected block, as one undo step through the registry. | |
| **Selection across a list and paragraphs** | Same as Mixed. Converting to a list wraps every top-level block; Text unwraps. | `toggleList` semantics |
| Table cell (text selection) | As a paragraph. **CellSelection** spanning cells: **no bubble**, as today. The row's table slot handles cells. | |
| Inside inline code | Bubble shows. `inlineCode` has `excludes: "_"`, which excludes every mark, link and colour included. So B, I, U, S, colour, 🔗 and 🖌 are disabled with the reason "Inline code can't take other formatting." `setMark`'s `can()` already says no (`setMark.ts:60`, registry `inline.ts:217`). Tx, Style ▾ and 💬 stay enabled. | schema |
| ‹› over linked or coloured text | Applying inline code **removes** the link and colour marks in the range (`addMark` drops excluded marks). The pill says "Link and colour removed", with Undo. | schema |
| **Code block or Mermaid** | No bubble, as today. | |
| **Both ends inside one link** | No bubble. The link hover card takes over, as today. | |
| Part link, part plain text | Bubble shows. 🔗 is pressed and mixed (`aria-pressed="mixed"`). | |
| Node selection (image, embed, divider, Mermaid) | No bubble. The row's media slot handles it. | |
| **Whitespace-only selection** | No bubble. Change: today "no text" counts, so a selection of spaces shows it. | Lexical |
| **Read-only, outdated or deleted document** | No bubble. | #308 |
| **Reading mode with comments allowed** (cm:278) | A **comment-only bubble**: 💬 alone, same position rules. | cm:278 |
| View-link holder | No bubble. They read comments and never write (C5). | |
| Playground and web sandbox | No 💬. Everything else as normal. | C6 |
| During an IME composition | Never shows, moves or hides mid-composition. It re-evaluates on `compositionend`. | Confluence IME bug |
| During a pointer drag | Shows on `pointerup`, not while the drag extends. | Lexical, Word |
| Keyboard selection (O7 b) | Shows 300 ms after the last Shift keyup with a settled, non-empty selection. Never on auto-repeat. Alt+F10 still opens it at once. | Word Mini toolbar |
| Select all (⌘A) | Shows, anchored to the **first selected line that is visible** (§10.1), not to the top of the document. Style face `Mixed`. Turn into skips the title; the pill says "The title stays a heading." | |
| Selection scrolled out of view | Hidden. It comes back when any selected line is visible again. | Today's `hide` |
| Paint format armed | The bubble stays and 🖌 shows pressed. The next selection applies the format, then the bubble shows for that selection. | dp:41–63 |
| A collaborator deletes the selected text | Hidden. The selection maps to empty. | |
| A collaborator edits elsewhere | Repositions only if the anchor rectangle moved, at most once per animation frame. | |
| A collaborator converts or deletes the block while Style ▾ or Colour is open | The face and ✓ may be stale for a frame. A pick revalidates against the live doc (`runAction` does). If the selection maps to empty, the menus close and focus returns to the editor, never `body`. | contract §3.2 |
| The document turns read-only while a menu or the link field is open (`document_too_large`, the 512 KiB offline pause, deleted) | Everything closes. The pill gives the reason (#308). A typed but unapplied URL is dropped, and the pill says so. | #308 |
| Selection spans a table and paragraphs | Turn into skips the table cells. The pill says "Table cells keep their type." | |
| Turn into Code block | Marks and links in the range are removed (code holds plain text). The pill says "Formatting removed", with Undo. Comment anchors survive, because they are relative positions on the text (cm C2). | |
| Turn into Text on nested list items | The selected items become paragraphs at the top level, in order. The children of unselected items stay where they are (`toggleList` lift). | |
| Undo after Turn into | One step. The Yjs UndoManager restores the selection, and the bubble shows again. A collaborator's typing in between stays (only local steps are undone). | |
| Very long selection | The face is computed once per snapshot (`ctx.memo`), and it stops at the second distinct block type, so the cost is O(blocks until two types differ). | |
| Paint armed, then Style ▾ or Colour | They work and Paint stays armed. The Paint bundle carries marks only, never the block type (dp:41). | |
| Part-link selection, then 🔗 | The link field opens with the existing address. Apply extends the link to the whole selection; Remove removes it from the selection. *[unverified]* that the Hyperlink package supports both; phase 1 checks. | |
| Right-click on a selection (web and desktop) | The bubble hides while the context menu is open, and comes back on close if the selection is unchanged. | |

### 7.3 Colour and highlight (O2)

**Bubble (O2 b, named rows).** The colour split's ▾ opens a menu with **two columns side by side**. Stacked, the sections would be about 480 px tall; side by side they are about 290 px, which fits above or below a selection in a 720 px window.

```
Recent:  A A ▆ A ▆     ← up to 5, first row, from the existing M3 memory (MAX_RECENT_COLORS = 5), text and highlight mixed
─────────────────────┬──────────────────────
Text                 │ Highlight
⊘ Default          ✓ │ ⊘ No highlight      ✓
■ Red                │ ■ Yellow
■ Orange             │ ■ Green
■ Green              │ ■ Blue
■ Blue               │ ■ Pink
■ Purple             │   More highlights ▸   → Gray, Brown, Red, Orange, Teal, Purple
  More colours   ▸   │
```

**Chips** use one visual language on every surface:
- a **text colour** is an 18 px tile with an "A" in the token colour;
- a **highlight** is an 18 px tile filled with the highlight, with a `--foreground` "A";
- **Default** and **No highlight** use lucide `Ban`.

A solid square for a text colour would read as a highlight (UI review). **Recent** comes first, as in Notion's menu, because repeating a recent colour is the most common pick.

**Keyboard:** Up and Down move within a column. Left and Right cross to the same row in the other column, in visual order in RTL. → on "More…" opens the submenu.

**Which colours show first.** The first five per section are chosen for contrast spread and common meaning:
- Text: red (warning), orange, green (done), blue (info), purple.
- Highlight: yellow (the classic), green, blue, pink.

The token list (`TEXT_COLOR_TOKENS`) is append-only and unchanged. This is only a **display order** constant in the lazy menu chunk.

**Behaviour:**
- ✓ marks the current value. A mixed selection gets no ✓ and shows a `–` on the section label.
- The rows are `menuitemradio` inside two `group`s, so arrow keys move through both groups in order.
- The hover preview (A14) works on rows exactly as on swatches: `setActionPreview` on pointer enter and on focus.
- ⌘⇧H re-applies the last highlight (ux:501).

**The row's colour menus** use the same named rows. Its two split buttons (text, highlight) each open their own column's rows plus Recent. This replaces today's grid on desktop.

**Phone Aa sheet** keeps the grid: 44 px swatches, a 10 px gap, and six per row (6 × 44 + 5 × 10 = 314 px). Under the grid, a caption names the **current** value. Each tap shows a pill naming what was applied ("Teal text"), with Undo. A hover caption can't work on touch, because the name would arrive only after the tap applied the colour.

**Dark mode.** The swatches render with the dark palette values (Appendix A of the toolbar spec). Highlight rows show the swatch on `--popover`, so a pale highlight is visible in both themes.

### 7.4 Style ▾ ("Turn into") (O1 a)

```
Turn into
T   Text              ⌘⌥0   ✓
H1  Heading 1         ⌘⌥1
H2  Heading 2         ⌘⌥2
H3  Heading 3         ⌘⌥3
H   More headings       ▸        → H4, H5, H6
─────────
•   Bulleted list     ⌘⇧8
1.  Numbered list     ⌘⇧7
☐   Task list         ⌘⇧9
─────────
❝   Quote             ⌘⇧B
‹›  Code block        ⌘⌥C
```

**Columns:**
- Icon, then label.
- Shortcut, `kbd dir="ltr"`, then ✓, always the trailing cell: `grid-template-columns: 16px 1fr auto 16px`.
- **No Markdown chips here.** They teach in the "/" menu (§8.5), where typing is the point, and three clustered items per row read as noise (UI review).
- No hints at all on coarse pointers (dp:152).

**Behaviour:**
- **One undo step** per pick, through `runAction`.
- In the title, the menu is disabled with the reason "Title is always H1."
- In a heading, list types stay enabled. The registry decides, as `toggleList` from a heading does today.
- **Mixed selection:** no ✓.
- The menu body is in the **menus chunk** (A13), next to the row's Style menu. **Phase 1 checks** that the bubble chunk can import it without pulling the menus chunk into the editor group (A13's MenuRoot lesson).

**Why one menu (O1 a), not H ▾ plus List ▾ (O1 b):**
- A block has one type. A heading can't also be a bulleted item without a nested paragraph.
- Two menus on one block suggest you can pick one from each.
- One menu is also one target fewer. Notion's "Turn into" works this way.

### 7.5 Link (§F7)

- **🔗 with no link in the selection:** the bubble **hands off in place.**
  - **Focus moves to the field in the same frame as the click.** Otherwise a writer who clicks 🔗 and types or pastes at once would be typing into the editor, over the selection (UX review).
  - The bubble and popover **crossfade** (both 120 ms) instead of running in sequence.
  - **Placement:** the Hyperlink package hard-codes `placement: "bottom"` against the selection's rectangle (`openCreateHyperlink`, package dist), and `reposition()` can't change the side. So:
    - **v1:** the popover opens **below the selection**, as today. It never covers the selection. When the bubble was above, the handoff moves down a line, and the crossfade makes that read as one motion.
    - **Later:** ask `@docs.plus` for a `placement`/reference option. With it, the popover's edge nearest the text pins to the bubble's, which keeps it in place when the bubble was below.
  - Enter applies. Esc returns to the editor with the selection, and the bubble comes back.
  - Test: click 🔗, paste at once, and the selected text is unchanged.
  - The popover stays the extension's own (contract §4: `mark.link` is only a trigger).
  - What changes is where it opens. Today it opens below the text.
- **Pasting a URL over a selection** makes a link. `linkOnPaste` is on: the package default is true and `document-editor-config.ts:199-212` doesn't override it (staff review). Phase 1 adds e2e tests: one for a web URL, and one for a media URL, which `shouldAutoLink` vetoes. Pasting a URL alone keeps today's behaviour (autolink).
- **A selection inside a link:** the hover card (copy, edit, unlink). **Ask the package owner for an "Open" (↗) action**; it is a request to `@docs.plus`, not a change here.
- ⌘K keeps working everywhere. Later (search-linking spec, LK1) the ⌘K popover gains Documents and "In this document" sections. This design doesn't change that.

### 7.6 Comment entry (O3, comments spec §11.1)

- 💬 runs `comment.add`. It opens the draft card beside the range, tints the range as a draft, and moves focus to the card (cm:473). The bubble hides while the card has focus. Esc in the card returns focus to the editor with the selection collapsed to the end of the range (cm:476).
- The tooltip copy is the comments spec's: "Comment (⌥⌘M)" on macOS (cm:583).
- Anywhere `canComment()` is false, 💬 is **absent, not disabled**, because the document kind doesn't change while it is open. A view-link holder sees no bubble at all (C5).
- The bubble takes no comment code. 💬 is an `ActionButton` for a registry id that the comments PR registers. Before then, `editorActions.has("comment.add")` is false and the slot renders nothing (contract §3.2).
- **Ordering dependency:** comments PR P4.10 depends on "the smart toolbar bubble" (cm:635). Phase 1 here lands first.
- **Suggest a change** (Notion's suggest-edit icon) is **not a second bubble button.** It is a toggle in the comment draft card, "Suggest a change", which turns the card into the comments spec's suggested replacement (P4.12, the v1 stand-in for suggestion mode, rm:336). The card prefills the selected text for editing. That keeps one collaboration verb, 💬, in the bubble.

### 7.7 Reactions (O4)

- **Recommended: none in v1.** C12 scopes comments to "no mentions, no notifications"; reactions are new scope. The prototype shows the slot only under O4 b.
- **If O4 b is chosen later** (v1.1): ☺+ sits **inside the 💬 group** and opens an emoji picker with six quick emoji and a search.
  - The pick creates a thread whose first message is one emoji, flagged `reaction: true` in the message JSON. That is a new optional field in a `m:` value, so the comments validator must accept it before any client writes it (C9).
  - It renders as an emoji chip in the margin, not as a card.
  - The emoji picker data is its own lazy chunk (about 30–60 KB gz for emoji data, *[unverified]*), never in the bubble chunk.

---

### 7.8 One row or a vertical panel? (O11)

The owner's second reference set shows Notion's selection menu, in dark mode over a Persian document. From top to bottom it has:
- a "Normal Text ›" row, which opens Turn into to the side;
- a 5 × 2 icon grid: A, B, I, U, Tx / link, S, code, √x, ⋯;
- a "Comment" row with ☺+ and a suggest-edit icon;
- a scrolling "Skills" list (Improve writing, Proofread, Explain, Reformat…);
- a pinned "Edit with AI" row.

Its colour popover has three sections: Recently used, Text colour as a 5 × 2 grid, and Background colour as a 5 × 2 grid.

| | (a) One row (recommended) | (b) Vertical panel |
|---|---|---|
| Size | 433 × 38 px with 💬, 392 px without (measured in the prototype) | about 240 × 220 px without AI (Notion's is about 340 × 600 px with Skills) |
| Covers | One line of text above the selection | 6–9 lines, usually including the paragraph the writer is checking the change against |
| Fits above the selection in a 720 px window | Always (§10.1) | Often not. It then overlaps the selection's own block or flips far below |
| Remote carets and labels | Rarely covered; the flip rule handles them | Often covered |
| Room for words | Only the Style ▾ face word | Labelled rows (Turn into, Comment) |
| Growth | Fixed; anything new goes to the row, ⋯ or the palette | Invites new sections. Notion's Skills list is how panels grow |
| Pointer travel to B | 1 row | 2 rows |
| Keyboard | One toolbar, Left/Right | A menu with a grid inside: Up/Down between sections, 2-D arrows in the grid. Harder to learn, and a mixed APG pattern (§14) |

**Recommendation: (a).** The reasons:
- TinyDocy's bubble formats the text the writer is looking at, and a panel hides that text.
- The panel's real advantage is room for words and sections. That room is what makes AI skills and promotional rows easy to add, and §7.9 rules those out.

**What (a) borrows from the panel:**
- Tx (clear formatting) is top level (BQ6).
- Turn into shows the current type as a word (Style ▾ face).
- Comment sits in its own trailing group.
- Recently used colours come first in the colour menu (§7.3).
- The suggest-edit entry lives *inside* the comment card (§7.6), not as a second bubble button.

The prototype's "O11" switch shows (b) built from the same items, so the owner can compare.

**If (b) is chosen,** these rules apply:
- Turn into is the first row, and its submenu opens toward the interface's inline end (BQ8).
- Marks are a 5 × 2 grid with roving focus that is 2-D. Left and Right follow the visual order in RTL.
- Comment is a labelled row.
- There is no Skills section.
- The panel anchors to the first selected line, and flips with the same rules (§10.1).

### 7.9 AI and "Skills" (BQ7)

TinyDocy has no AI, and none of the v1 or post-v1 roadmap specs has any. This design:
- **Reserves no AI slot,** not even a disabled or "coming soon" one. An empty slot is a changing face, and a teaser is a promotional button. Confluence's un-dismissable "Ask Rovo" button is the cautionary example (Appendix A).
- **Says where AI would go if the owner ever decides to add it,** so nobody squeezes it into the bubble later:
  - as **registry actions** in their own group, so they appear in the palette (Alt+/) and the "/" menu with labels, shortcuts and reasons like everything else;
  - **behind a preference** that is off by default, as prefs principle 2 requires;
  - in the bubble, at most **one** trailing item ("Ask…"), after 💬, that opens a lazy panel. Never a list of skills inside the bubble.
  - Any AI feature also needs its own privacy, abuse and cost review, which is outside this design.

### 7.10 Two-level menus from the bubble: keyboard

These rules cover Style ▾ › More headings ▸ and Colour › More colours ▸. They also cover option (b)'s Turn into ▸.

| Key | In the bubble | In a menu | In a submenu |
|---|---|---|---|
| Left / Right | Previous / next item (visual order) | In the colour menu, crosses columns; elsewhere nothing | — |
| Inline-end arrow (→ LTR, ← RTL) | — | On a "▸" row: opens the submenu and focuses its ✓ item, or else its first | — |
| Inline-start arrow (← LTR, → RTL) | — | — | Closes the submenu; focus returns to its "▸" row |
| Up / Down | — | Next / previous row, wrapping | Next / previous row, wrapping |
| Enter / Space | Activates; on a menu button, opens it and focuses its ✓ item | Picks and closes everything; focus returns to the editor with the selection | Same |
| Esc | Back to the editor with the selection | Closes this menu; focus returns to its trigger in the bubble | Closes the submenu only |
| Tab | Leaves the bubble for the editor (today) | Closes the menus and leaves the bubble for the editor | Same |
| Typing a letter | — | Moves to the next row starting with it (typeahead, APG menu) | Same |

**Pointer:** a submenu opens on hover after 100 ms, or on click. A pointer moving diagonally toward an open submenu doesn't close it; Base UI's submenu safe-polygon handles that. A submenu that doesn't fit at the inline end opens at the inline start (§10.4).

## 8. Quick insert

### 8.1 Model

| Where | Entry | Opens |
|---|---|---|
| Desktop, empty line | **`+` in the start margin** (O5 a), keyboard-free | Types the "/" for you, so it is the ordinary "/" menu (§8.2) |
| Desktop, anywhere | "/" typed at a block's start or after a space (unchanged) | The "/" list at the caret |
| Desktop, row | `+ Insert ▾` (unchanged, M10 face) | Insert menu |
| Desktop, keyboard | Alt+/ palette (unchanged) | Everything |
| Phone | Insert cell in the bar (O6) | **Insert sheet** |
| Phone | "/" (unchanged, ph:49) | The "/" list above the bar |
| Electron | the menu bar's Insert menu (ux §4) | The same kinds |

The "/" list is the **one** list of block kinds, and the `+` reuses it **as is**, so there is no second mode and the lists can't drift apart. The phone Insert sheet renders the same items in a grid (§8.5). The row's Insert menu stays as M10 decided: inserts only, with lists in List ▾. Its rows gain the "/" alias as a hint, for example "Table  /table".

### 8.2 The `+` on the empty line (O5 a)

**When it shows:**
- On a fine pointer, while the caret is in an **empty paragraph** that is not the title, not in a table cell and not in a list item.
- Also on pointer hover over an empty paragraph, after a **150 ms dwell**, only on the hovered line and never animated. Documents with many spacer paragraphs then don't shimmer as the pointer passes.
- Hidden from IME `compositionstart` until `compositionend`, along with the placeholder.
- It never shows on coarse pointers; phones have the Insert cell.
- The empty list item, quote and table cell cases are open, and the default is no. They have their own Enter behaviour.

**Where it sits:**
- In the start margin, 28 × 28 px, vertically centred on the line.
- It lines up with the drag grip column on headings, so the margin has one column of controls.
- In RTL it is in the right margin.

**Behaviour:**
- **Click inserts a "/" for you.** It moves the caret into that paragraph if it isn't there, then inserts "/" with `addToHistory: false`. That is exactly what the trigger watches for (one local "/" at the block start), so the ordinary "/" menu opens with its ghost hint. Typing after a click filters, as it would after a typed "/". Only one code path exists.
  - **Esc after a `+`-opened menu** removes the "/" again, also outside the history, if the query is still empty. A pick replaces "/query" as today.
  - The `+` has `aria-haspopup="listbox"` and the name "Insert block".
- It **is not in the Tab order.** Keyboard users already have "/" and Alt+/, and a Tab stop on every empty line would be noise. It has an accessible name, "Insert block", and a tooltip: "Insert block · or type /".
- Picking runs `runSlashPick` as one undo step. Focus never leaves the editor.
- **Empty or title-only document:** the title never gets a `+`. Enter from the title makes the first paragraph, which shows the placeholder and the `+`.

**Engineering:**
- It lives in the **slash chunk**, which is already loaded on idle.
- It listens to `editor.on("transaction" | "focus" | "blur")` from that chunk. There is no plugin.
- **A little eager JSX in `SlashMenuHost`** (about 100–200 B, estimated), because the host renders chunk code only while the menu is open. It counts **inside** the existing 1,000 B slash cap. Measure it.
- It positions with `coordsAtPos`, not Floating UI: a third chunk importing Floating UI could split the editor group again.
- Pressing the `+` calls `preventDefault` on `mousedown`, so the editor keeps focus and the trigger never sees a `blur` meta.

**The placeholder** for an empty paragraph becomes "Type / for blocks" (OB2, 10 B, already in the D23 ledger).

### 8.3 Phone Insert sheet (O6 a)

```
┌ Insert ───────────────────────── Done ┐
│ Suggested            (only with recents) │
│ [▦ Table            3 × 3]             │
│ Turn into / Blocks                     │
│ [T Text]        [H1 Heading 1]          │
│ [H2 Heading 2]  [H3 Heading 3]          │
│ [• Bulleted]    [1. Numbered]           │
│ [☐ Task list]   [❝ Quote]               │
│ Media and more                          │
│ [🖼 Image]      [▶ Embed]               │
│ [▦ Table]       [‹› Code block]          │
│ [⑂ Diagram ▸]   [— Divider]             │
└────────────────────────────────────────┘
```

**Layout:**
- A bottom sheet in the existing `Sheet` component, with swipe-to-close (M7) and `--safe-area-bottom` padding.
- A two-column grid of cells 44 px tall: icon and label, start-aligned.
- **The sections are the "/" menu's sections, in its order** (§8.5), from the same item builder.
  - **Suggested** is optional and on top: up to 3 recent insert kinds (O12 a).
  - The fixed sections below it never move, so the first fixed cell is always in the same place.
  - A kind in Suggested also appears in its own section, as in the "/" menu.
- **What a Text, heading or list cell does depends on the caret's block:**
  - if the block is empty, the section is titled "Blocks" and the cell converts that block;
  - if the block has text, the section is titled "Turn into" and the cell converts the block the caret is in, exactly as the Aa sheet's Style does.
  - Insert kinds (table, image…) always insert after the caret's block, as `insert.*` does today.

**Behaviour:**
- **Picking closes the sheet.** The keyboard comes back with the caret in the new block, through the existing `actionsRef.close()` and focus return.
- **Kinds that need input:**
  - **Table and embed** open their step inside the sheet, through `lazySurface(loadInsertStep)`. They are the only `InsertStepKind`s (`insert-step.tsx:22`).
  - **Image** opens the system file picker, as it does today.
- Disabled kinds show their reason on a second line, as in the menus (dp:207).

**Shipping:**
- Its own chunk next to the phone sheet. It reuses `buildSlashItems` from the slash chunk's `lib/slash-menu/` (pure modules, no components).
- `phone.scss` is off-limits until PR #102 merges, so this ships after #102.

### 8.4 Why not a bottom insert pill on desktop (O5 b, rejected)

1. **It duplicates the sticky row**, which already has `+ Insert` and, at narrow widths, the stand-ins.
2. **It collides** at the bottom right with the presence pill and the footer pill, and the status pill moves there too when the bubble is open (dp:99).
3. **It covers the bottom lines of the page** while you type at the end of a document. Avoiding that needs `scroll-padding` changes that touch every scroll rule (`SCROLL_CLEARANCE`).
4. **Electron** puts Insert in the menu bar (ux §4), so a pill is a third copy.

**A narrow exception, recorded for later:**
- *Simplified toolbar plus focus mode* could, one day, hide the row and show a pill.
- No such mode exists.
- Under prefs principle 2 ("a new setting must replace one, or arrive with evidence", pr:62), it is not proposed.

---

### 8.5 The "/" menu (O12, BQ9)

The "/" menu is on the "already strong, don't rebuild" list (dt:276). This section **amends** it and does not rebuild it.

**What stays:**
- The eager trigger, which keeps state only and stays under 1,000 B gz with the host.
- It opens only in a paragraph, at the block start or after whitespace.
- The query stays ordinary text in the document, and focus never leaves the editor.
- Combobox attributes go on `view.dom`, never `aria-expanded`.
- Keys are captured on the window only while the menu is open.
- A pick is one undo step (`runSlashPick`).
- The polite live region.
- H4–H6 are search-only.
- Disabled items explain themselves only when the query matches nothing else.
- The flip rules.

**Reference:** Notion's "/" menu, dark mode, Persian document. It shows an inline "/ Type to search" ghost at the caret; "Suggested" (with a "New" badge) above "Basic blocks"; Markdown hints at the end of each row; and a pinned "Close menu · esc" footer.

#### Anatomy (empty query)

```
/ Type to search          ← ghost hint at the caret (empty query only)
┌──────────────────────────────────────────┐
│ Suggested                                │  ← only with recents (O12 a)
│ ▦ Table               3 × 3              │
│ ⑂ Diagram ▸                         New  │
│ Text                                     │
│ T  Text                                  │
│ H1 Heading 1                          #  │
│ H2 Heading 2                         ##  │
│ H3 Heading 3                        ###  │
│ Lists                                    │
│ •  Bulleted list                      -  │
│ 1. Numbered list                     1.  │
│ ☐  Task list                        [ ]  │
│ Insert                                   │
│ ❝  Quote                              >  │
│ ‹› Code block                       ```  │
│ ▦  Table                          3 × 3  │
│ 🖼  Image · ▶ Embed · ⑂ Diagram ▸ · — Divider │
├──────────────────────────────────────────┤
│ Type ## then space for Heading 2   esc Close │  ← pinned footer
└──────────────────────────────────────────┘
```

#### Sections and order

The order is **Suggested → Text → Lists → Insert → Diagrams** (Diagrams appears only when the templates are loaded, as today).
- **Suggested (O12 a)** holds up to 3 recent **insert kinds**, most recent first, read from `INSERT_KIND_CHOICE`.
  - The slot's `maxRecent` goes from 0 to 3. That is a **v1 contract amendment** (§6, D2's memory file), recorded as A18. Its `last` value, which the row's Insert face reads, is unchanged. The stored shape stays compatible: the plan's first task checks that `readChoice` accepts both the old and the new shape.
  - **Local only.** It lives in the existing `tinydocy-ui` memory, never in Yjs. Forget clears it, and `NEXT_PUBLIC_REMEMBER_CHOICES=0` disables it.
  - **No new write path.** The insert actions' `run()` already writes this slot (contract §6).
  - With no recents, the section is absent, so a new writer sees the same list every time.
  - An item in Suggested also stays in its own section, because positions in the sections never move (fixed faces).
- **Why not (b), recents for every block type?** Headings and lists already have Markdown shortcuts and sit at the top of the list. Recording every `style.*` run (⌘⌥2 too) would fill Suggested with "Heading 2", and it would need eager write calls in the editor chunk.
- **With a query,** Suggested is not shown. Ranking is today's `matchSlashItems`, plus a tie-break: among equal ranks, a recent kind comes first.

#### Empty-query hint (BQ9)

- **Inline ghost:** "Type to search" sits right after the "/" while the query is empty. It is **not** a search field, so focus stays in the editor and the query stays document text.
- **How it renders:**
  - The lazy menu renders it as an `aria-hidden` overlay at `coordsAtPos(head)`, in the paragraph's computed font and `--muted-foreground`.
  - It is not a decoration, so it costs no eager bytes.
- **When it shows:** only when nothing follows the caret in the block, so it never overlaps the writer's text. Mid-line, the footer carries the hint instead ("Type to filter").
- **When it hides:** on the first query character, on IME composition start, and when the menu closes.

#### Teaching Markdown shortcuts

- **Every row** keeps its Markdown hint at the inline end, as today.
- **The footer's start text** follows the highlighted row:
  - a row with a Markdown hint: "Type `##` then space for Heading 2";
  - a row without one: "↑ ↓ to move · ↵ to insert".
- **No counters, no nags, no stored state.** The tip changes as the writer arrows.
- **Coarse pointers:** the footer tip is hidden (dp:152); only Close stays.

#### "New" badges (BQ9)

- **Declared** on the menu's own item table (a lazy chunk), as `newUntil: "YYYY-MM-DD"`, with **at most two items at a time**.
- **Hidden when:**
  - the date has passed (local date), **or**
  - the kind is in `INSERT_KIND_CHOICE`'s recents, which means this writer has used it.
- **No new storage,** and no server.
- **Accessible name:** the label gets ", new" (for example "Diagram, new").
- **Ships empty.** The first feature that wants a badge sets a date at most 60 days after its release.

#### Close affordance

- **Esc** closes and leaves "/query" as text (today).
- The footer's **"Close · esc"** is a button for pointer users. It does the same, and keeps the caret where it was.
- **On phones** it is a 44 px "Close" button, the only footer item.
- **Clicking outside** closes it too (today).

#### Placement

Unchanged from today:
- below the "/" when it fits, else above if there is more room;
- the side sticks while typing;
- always inside the band between the sticky row and the phone bar or keyboard (`SCROLL_CLEARANCE`);
- never over the caret line.

Changes:
- **Width** goes from 288 to **320 px**, to fit a badge, a note and a hint.
- **Below 640 px** the list still spans the screen with a 16 px gutter.
- **The footer is outside the scrolling list,** so it is always visible. A tall list scrolls under it, ending in a half row so the cut-off shows there is more (today's rule).

#### RTL (BQ8)

- **The list's chrome follows the interface direction:** label at the start, hint at the end, and the footer's tip and Close mirrored.
- **Horizontal anchor:** the list aligns to the "/" on the **content's** start side.
  - In an RTL paragraph its right edge sits at the caret.
  - In an LTR paragraph under a Persian interface, its left edge sits at the caret.
  - It is clamped to the page column.
- **Markdown hints and the "/" stay `dir="ltr"`** (rtl:184).
- **Arabic and old-Hebrew layouts** don't have "/" on the base layer. Use the `+` (desktop) and the Insert cell (phones). No second trigger character (§13.4).

#### Phone

- "/" keeps working above the bar (ph:49), with 44 px rows.
- Suggested and the footer apply, but the footer is only Close.
- **The Insert sheet (O6) is the tap path, and it uses the same item builder.** `buildSlashItems` gains a `layout: "list" | "grid"` render mode. The sheet's sections are therefore the menu's sections, in the same order.
- The UX-review finding that "Recent first" would move the first cell is resolved the same way: Suggested is a separate, optional section at the top. The fixed sections below it never move.

#### One registry, three surfaces

Labels, icons, shortcuts, Markdown hints, keywords and disabled reasons come from `lib/editor-actions` alone. Each surface keeps only:
- which ids it shows;
- its sections and order;
- its badges;
- its display-only colour order (§7.3).

| Surface | Reads | Renders with |
|---|---|---|
| Bubble | a const id list (§7.1) + `useActionView` | `ActionButton` |
| Style ▾ / Turn into | `style.*`, `list.*`, `insert.quote`, `insert.codeBlock` | menu rows: `label`, `icon`, `formatKeyCombo(shortcut)`, `markdownHint` |
| "/" menu, `+` popover, phone Insert sheet | `buildSlashItems(ctx, editorActions.list(), …)` | one item model, two layouts |
| Row Insert | `editorActions.list({ group: "insert" })` (today) | menu rows plus the "/" alias as a hint |
| Palette | the whole registry (today) | cmdk rows |

**A new contract test** checks three things:
1. Every id any surface names exists in the registry.
2. No surface file contains a hard-coded label or shortcut string for a registry id. The check is a grep for the labels of the ids each surface names.
3. Every `markdownHint` shown in the "/" menu matches the input rule that the Markdown shortcut actually triggers. This last check is a **unit test against the real input rules** in a test editor.

## 9. Page-level actions (O9) and the row's ⋯ (BQ4)

### 9.1 Page width

- **"Make page wide" is a per-viewer view preference, never a document edit.** Prefs rows 7–8:
  - `page.width` is the app default: Narrow 30 em / Standard 33 em / Wide 46 em / Full.
  - `doc.width` is per document, per viewer and per device, and exists on desktop and in the web library only. It is never written to Yjs.
  - Below 640 px the page always fills the width.
- **So it doesn't belong in quick insert.** It goes where the preferences spec puts it: the Page popover, Settings › Page, View › Page Width on desktop, and the palette.
- On the web it goes in **the row's ⋯ › Page width ▸**:
  - Narrow, Standard, Wide, Full, with a ✓ on the current one.
  - "Use default (Standard)" when a per-document width is set, in the web library only.
  - In the sandbox, the item sets the app-wide `ui.page.width` (C7).
- The copy follows the preferences spec's labels, not the reference's "Make page wide".
- **Shortcut:** none. It is changed rarely, and every key is spoken for.

### 9.2 The row's ⋯, regrouped (BQ4)

```
Text
  Superscript        ⌘.
  Subscript          ⌘,   (⌘⇧, on desktop, ux:462)
  Inline code        ⌘E
  Clear formatting   ⌘\
  Paint format
─────────
View
  Page width       ▸      Narrow · Standard ✓ · Wide · Full
  ☐ Simplified toolbar
  Appearance       ▸
─────────
Help
  All actions…       ⌥/
─────────
Forget my choices…
```

- Nothing is added except Page width, and nothing is removed. "Forget my choices…" stands alone at the end: it is about memory, not help.
- Every row keeps a 16 px leading slot (icon or ✓/☐), so the labels line up.
- The groups are `role="group"` with `aria-label` and visible headings, matching the colour menu.
- Inline code stays in ⋯ as a second route (principle 1), even though it is now in the bubble.
- **Phone:** the Aa sheet gains a **Page** row (the preferences spec's name) (ph:77) only where width can change: at 640 px and wider, which phones never reach. So phones get no width control. That is correct, because the page always fills the width there.

---

## 10. Placement and collision

### 10.1 Anchor (BQ3)

1. **The anchor rectangle is the first selected line's rectangle.** That is the first `DOMRect` of `range.getClientRects()` with a non-zero width, clipped to the selected part of that line. It is never the union box.
   - For a forward multi-line selection, this is the top line, where the selection started.
   - For a backward selection, it is still the top line, so the bubble doesn't jump to the bottom when you drag upward.
   - Floating UI's `inline()` middleware does this.
2. **Horizontal:** centred on the anchor, then shifted to stay 8 px inside the **page column** (`.document-editor-content`), not the window. That keeps it out of the comment rail and the outline.
3. **Vertical:**
   - **Above** the anchor, 8 px gap.
   - Flip **below the last selected line** when any of these hold:
     - (a) the band above starts under the sticky row (today's `topLimit`);
     - (b) it overlaps a remote caret label (today);
     - (c) it would be less than 8 px from the top of the visual viewport, when the window is short.
   - The side, once chosen, **sticks for the life of that selection**. Typing, remote edits and scrolling never flip it back and forth. It is re-chosen only when the anchor moves more than 24 px or the band becomes blocked.

### 10.2 Layers (z-order, low to high)

`page text < remote carets < drag grip and + < status pill < bubble < bubble menus and popovers (portalled) < comment draft card < sheets and dialogs < toasts`.

- The **status pill** moves beside the bubble when the bubble is open (dp:99, unchanged).
- The **comment rail** is outside the page column, so the bubble never overlaps it (§10.1 rule 2).
- The **presence and footer pills** are below the bubble in z-order and never move. The bubble can't reach them, because it sits next to text in the page column.

### 10.3 Scrolling, resizing and zoom

- The bubble lives in the scroll container (`.document-editor-wrapper`) and scrolls with the text without repositioning, as today.
- **Window resize, Electron zoom (⌘±, desktop only) and font loading** reposition it on the next frame. Linear shipped a fix for exactly this.
- **Sticky row covering:** when the bubble goes wholly under the sticky row while scrolling, it reads as `closed` for Alt+F10, and focus moves back to the editor (today's rule, kept).

### 10.4 Menus from the bubble

- Style ▾ and Colour ▾ open **on the side away from the text**: up when the bubble is above, down when it is below (today's `popoverSide`).
- **When the preferred side has less than `min(menu height, 240 px)` of room** in the band between the sticky row and the window's bottom, the menu opens on the other side. On that side it goes **below the selection's last line**, never over the selection, and its height is capped to the room with internal scrolling.
  - The prototype shows this: on a heading near the top, Style ▾ opens under the heading.
- **Menus and submenus are bounded by the page column,** like the bubble (§10.1 rule 2), so they never land on the comment rail. A submenu that doesn't fit at the inline end opens at the inline start, over its parent menu, offset 4 px. Every menu is also clamped to the visual viewport with 8 px padding.
- While a menu is open, the bubble stays: today's `OPEN_POPOVER_TRIGGER` rule.

---

## 11. Motion, shortcuts and hints

### 11.1 Motion (O10)

| What | Enter | Exit | Reduced motion |
|---|---|---|---|
| Bubble, its menus, the "/" list (also when opened by `+`), Insert, ⋯ | 120 ms, opacity 0→1, scale 0.98→1 from the anchor side, `cubic-bezier(0.2,0,0,1)` | 80 ms, opacity only (no scale), linear | none (instant) |
| Bubble repositioning | none, it jumps | — | — |
| Link handoff (§7.5) | crossfade, both 120 ms; focus moves in frame 1 | — | instant swap |
| Phone sheets | 200 ms slide (ph:257, unchanged) | 160 ms | no slide, fade 0 |
| Hover preview | none (it is a decoration) | — | — |

**Rules:**
- **Never delay showing for an animation.** The bubble is interactive from frame 1.
- Reduced motion follows `data-motion="reduce"` **or** `prefers-reduced-motion`, through the preferences spec's one mixin (pr:773).

### 11.2 Shortcuts and hints

- **The registry is the source.** Tooltips show `label · Markdown hint · formatKeyCombo`, as the bubble does today ("Bold **text** ⌘B"). `aria-keyshortcuts` comes from `ariaKeyShortcuts`.
- **Coarse pointers:** no tooltips and no glyphs (dp:152). On an iPad, glyphs come back after the first hardware-keyboard modifier press (ph:379, `data-hardware-keyboard`).
- **`kbd dir="ltr"` always.** Glyphs are never translated (rtl:184).
- **New keys: none.** Everything in §7 already has one: ⌘B, I and U; ⌘⇧S; ⌘E; ⌘K; ⌘⌥0–6; ⌘⇧7, 8 and 9; ⌘⇧B; ⌘⌥C; ⌘⇧H; ⌥⌘M (macOS, from comments).
- **Teaching Alt+F10:** the palette's row "Focus formatting toolbar Alt+F10" already exists. Nothing new pops up.

---

## 12. Engineering (BQ2) and budgets

### 12.1 How the bubble attaches

**Today:**
- An eager host, `selection-bubble.tsx`, lazy-loads `selection-bubble-view.tsx`.
- That view renders `<BubbleMenu>`, which registers a plugin (§4.1).

**Proposed:** a `BubbleController` in the lazy bubble chunk, one per editor.

- **One `transaction` listener**, not `transaction` plus `selectionUpdate`. Both fire on every keystroke (`Editor.ts:730-740`). The handler starts with `if (!open && selection.empty) return`, which is cheaper than today's plugin `update`, whose `doc.eq` is O(top-level blocks).
- **Listeners for `focus`, `blur` and `update`.** `update` catches `setEditable`, which emits no transaction (`slash-menu-host.tsx:37`).
- **DOM listeners:**
  - a capture `mousedown` on the bubble (`preventHide`);
  - `dragstart` on `view.dom`, which hides;
  - `pointerdown`/`pointerup`, for show-on-pointerup;
  - `compositionstart`/`compositionend`.
- **What it reproduces from Tiptap's plugin** (`bubble-menu-plugin.ts`):
  - the **250 ms show debounce** for a non-empty selection (`updateDelay`, :378); hide stays immediate;
  - the `view.composing` skip and a `compositionend` re-check (:432, :589);
  - the `relatedTarget` blur rules (:464-484);
  - a `setTimeout` on focus so the selection has settled (:459);
  - hide on `dragstart` (:427).
- **`shouldShowBubble()`** (`bubble-rules.ts`) is kept as a pure function, with its unit tests. It gains `isWhitespaceOnly` and a `firstVisibleLineRect` helper.
- **Position:**
  - `@floating-ui/dom` `computePosition` with `offset(8)`, `shift({ padding: 8, boundary: page column })` and the side logic in §10.1.
  - `autoUpdate` runs only while open, with `contextElement: view.dom` and **`ancestorScroll: false`**, because the bubble scrolls with the text inside the scroll container (§10.3).
  - The **anchor comes from the viewport**, not `inline()` over the whole range. It is the first selected line rectangle that intersects the visible scroll area. `getClientRects` over a ⌘A range would lay out every `content-visibility`-skipped block, and `inline()` would anchor to an off-screen first line.
- **Caching:** while open, `textBetween`, whitespace and block-type checks are cached per `(state.doc, selection)` identity. Remote transactions are coalesced to one check per animation frame. The controller never caches DOM nodes or `Range`s, because remote Yjs steps replace whole blocks; it recomputes from positions.
- **The DOM contract is kept exactly:**
  - one reused root element with `data-smart-bubble` and `data-state`;
  - **appended to the scroll container on show and removed synchronously on hide**, as the plugin does today.
  - About 15 e2e `toHaveCount(0)` assertions depend on it, and the status pill's observer needs the root as a direct child (`status-pill.tsx:29,106-133`).
  - Removing it synchronously also ends the A9 rAF race, so lines 207–222 go.
- **No `registerPlugin`, `PluginKey` or `reconfigure`.** Nothing else uses `BUBBLE_KEY` (checked).
- **Lifecycle:**
  - one controller per editor in a `WeakMap`;
  - teardown is idempotent (editor `destroy` and the host's unmount may both run, and StrictMode runs effects twice), deletes its entry and removes the root synchronously.
  - The contract §7 gate stays: listeners and heap back at baseline after 100 bubble cycles and 20 tab switches.
- **Electron and the web:** a `contextmenu` event hides the bubble. It comes back on close if the selection is unchanged.

### 12.2 Budgets

**Editor-chunk bytes are a measurement gate, not a promise.** Turbopack groups modules by the chunks that use them. A8 measured about 968 B of editor-group files when the bubble first imported the split button. Rules:
- Pass eager helpers in as props, as the continue chip does. The bubble chunk should import only modules the editor group already has, or its own folder.
- `scripts/check-editor-chunk-size.ts` runs on every phase. Growth over noise (±16 B) needs a D23 ledger amendment, approved before merge.

| Surface | Chunk | Expected editor-chunk change |
|---|---|---|
| Bubble controller (BQ2) | bubble chunk | ≤ 0 B. The bubble chunk itself should **shrink**: `@tiptap/extension-bubble-menu` (729 lines) leaves. `@floating-ui/dom` is already one shared copy (1.8.0) in the editor chunk (`heading-drag`, the `@docs.plus` packages), so no duplicate is added. |
| Bubble v2 items: Style ▾ face, S, ‹›, Tx, 💬 slot | bubble chunk | ≤ 0 B. Measure: Style ▾ is the bubble's first use of `lazy-menu`/`action-menu`. |
| Turn-into menu body | menus chunk (A13), a new body (lists, quote, code; no Your formats) with side and anchor options (`ToolbarMenu` has neither today, `menu-items.tsx:53`) | measure |
| Colour named rows | colour chunk | 0 B |
| `+` on the empty line | slash chunk, plus **a little eager JSX in `SlashMenuHost`**, which renders chunk code only while the menu is open | about +100–200 B (estimate), **inside** the 1,000 B slash cap; measure |
| "/" Suggested, ghost hint, footer, badges | slash chunk; `INSERT_KIND_CHOICE.maxRecent` 0 → 3 is one constant | 0 to +4 B |
| Phone Insert sheet | phone chunk; the table and embed steps load only through `lazySurface(loadInsertStep)` (A9 measured +1.5 KB when phone imported menus statically) | 0 B |
| ⋯ regroup and Page width | menus chunk | 0 B |
| Comment button | comments PR's own ledger line (150 B) | — |

### 12.3 Typing performance

- **With no bubble open,** each keystroke costs one `transaction` callback and two field reads.
- **With the bubble open,** remote transactions cost one cached check per animation frame.
- **The `+`** listens only while the caret is in an empty paragraph. Typing elsewhere exits after one `parent.content.size` check.
  - It doesn't show again until 300 ms after the last keystroke, so Enter-Enter doesn't make it flicker.
  - It re-measures on `transaction` while shown, because a fold or a remote edit above moves it.
  - Hover detection reads the DOM at most once per animation frame. The Placeholder decorates only the caret's node, so hover can't rely on its class.
- **Gate:** the perf project shows typing p95 within +10% with the bubble chunk loaded (tb:183), on 50 and 500 headings.

## 13. Phone, tablet, desktop and RTL

### 13.1 Phone (< 768 px)

- **No floating bubble**, unchanged. The selection cells `B I U A▁ ✎▁ 🔗 🖌|💬 ✕` stay, with 🖌 swapped for 💬 where `canComment()` is true (ph:318).
- **Aa sheet order (amends the sheet layout, F16):**
  1. **Style** (Text, H1–H3, More ▸; Bulleted, Numbered, Task, Quote) as a two-column grid.
  2. **Colours** as the 44 px grid with the current-value caption and the applied-colour pill (§7.3).
  - The Style section shows the current type as pressed and has a **More headings ▸** row, as today's sheet does.
  - The sheet pads `calc(16px + var(--safe-area-bottom))` at the bottom and shows a 16 px fade when it scrolls.
  - Done, swipe-down and a tap on the scrim all close it.
  3. Size, Align, and the rest, as today.
- **Insert:** the sheet (O6).
- "/" is unchanged.
- **Keyboard:** the bar rides `--keyboard-inset` (M20). The sheet replaces the keyboard while open, as today.

### 13.2 Tablet (≥ 768 px)

- **Fine pointer** (iPad with trackpad, Surface with mouse): the desktop bubble. The bubble keys on `pointerType`, not width (ph:380). A trackpad selection shows the bubble; a finger selection on the same device doesn't.
- **Coarse pointer** (O8 a):
  - No bubble, unchanged.
  - **The row's stand-ins get a visible word** at 768 px and wider on coarse pointers: `Aa Format ▾`, `¶ Layout ▾`, `⋯ Block ▾`. "Text" would collide with the Style value, and "Paragraph" reads as a block type (UX review). That follows the fixed-faces rule: one icon plus at most one fixed word (ux:46).
- **O8 b spike** (not built): on a real iPad, show the phone selection cells as a bar docked at the bottom while text is selected. Measure:
  - whether the iOS callout and the WebKit r241971 avoidance stay clear of it;
  - whether the hardware keyboard's shortcut bar collides with it.
- **iPad with a hardware keyboard:** Alt+F10 isn't available (Safari's Option+F10). ⌘ shortcuts work, and glyphs come back (ph:379).

### 13.3 Desktop (Electron)

- **The bubble is identical to the web.**
- **The native context menu stays native** (ux:256): spelling suggestions, Cut, Copy, Paste, Look Up, Link…, and Comment… (cm:468).
  - The bubble **hides while the native context menu is open** (`contextmenu` event) and comes back on its close if the selection is unchanged.
  - Writing Tools and Services need `menu.popup({ frame })` (Electron 36+). That is the desktop track's work; this spec only depends on the bubble hiding.
- **The menu bar** mirrors the registry (ux:220):
  - Format: marks, Turn into ▸, Clear formatting.
  - Insert: the same kinds as "/", plus Comment.
  - View: Page Width ▸ (prefs).
- **Narrow windows** (the minimum width, ux): with a fine pointer below the phone breakpoint, the window is a phone layout with a mouse.
  - Today the bubble is disabled there (`DESKTOP_QUERY`).
  - Keep that: the phone bar is the formatting surface at that width, and with a fine pointer its cells are mouse-sized.
- **⌘, is Settings**, so Subscript is ⌘⇧, (ux:462). Labels come from the registry, so the bubble needs no change.

### 13.4 RTL

- **The bubble order reverses** through logical layout: Style ▾ at the right, 💬 at the left (rtl:290).
- **Keys:** Left and Right move visually through `visualStep()` (rtl:330); `bubble-rules.ts` is one of its six call sites.
- **Icons:**
  - ▾ chevrons and the More ▸ chevrons flip, through `flipInRtl` in `lib/icons.tsx`.
  - These don't flip: B, I, U, S, ‹›, 🔗, 🖌, 💬, and the colour A.
  - List icons in Style ▾ flip; `ListOrdered` uses `ListOrderedRtl` (rtl:312).
- **Menus** open toward the inline start, with Floating UI `start` and `end` placements (rtl:293).
- **The `+`** sits in the right margin.
- **Anchor:** with bidi runs on the first line, `getClientRects()` returns several rectangles for that line. The anchor is their union **on that line only**.
- **"/" on RTL keyboards:**
  - On Persian ISIRI 9147 it is on the same key as US (Shift gives ؟), so it works.
  - On Arabic 101 and old Hebrew SI-1452, "/" isn't on the base layer.
  - We **don't add a second trigger character.** That costs eager bytes in `slash-trigger.ts`, and LK3's `[[` already claims the next slot. Instead, the `+` on desktop and the Insert cell on phones are the non-typed paths.
- **Persian decimal "/":** the trigger opens only at a block's start or after a space (unchanged), so "۳/۵" never opens it.
- **Labels** go through `actionLabel(action)` (rtl:159). The link field is `dir="auto"`.

---

## 14. Accessibility

| Criterion | How |
|---|---|
| 2.1.1 Keyboard | Alt+F10 opens the bubble and focuses its first item (Style ▾), or the item focused last time in this bubble session (APG toolbar re-entry). Every bubble action also has a shortcut, the row or the palette. The `+` has "/" and Alt+/ as keyboard twins. |
| 2.4.3 Focus order | Inside the bubble: roving tabindex, Left/Right, Home/End, one Tab stop. Esc order: menu → its trigger in the bubble → editor with the selection kept → hide. Tab past the last item returns to the editor (today's rule). |
| 2.4.11 Focus not obscured | The bubble flips away from the sticky row and remote labels. It never covers the selected line (§10.1). The `+` popover clamps above the phone bar and keyboard (`SCROLL_CLEARANCE`, today's rule). |
| 2.5.8 Target size | 28 × 28 px on fine pointers and 44 × 44 px on coarse ones. Menu rows are 32 px fine and 44 px coarse. |
| 1.4.11 Non-text contrast | Controls carry the contrast: the 2 px `--focus-ring` (7.8:1 / 12.1:1), drawn inside each button, and the pressed bar (about 19.8:1). The container edge is not relied on (§7.1). **The focused or active menu row** gets an inset 2 px `--focus-ring` as well as the `--accent` fill, because `--accent` on `--popover` alone is only 1.07:1 in light and 1.19:1 in dark. This fixes the shared menu row style app-wide, not only in these menus. |
| 1.4.1 Use of colour | Colours are named in rows (O2 b) or a caption (O2 a). ✓ marks the current value. |
| 1.4.13 Hover or focus content | Tooltips and the hover preview close on Esc, can be hovered, and stay while hovered or focused (today). |
| 4.1.2 Name, role, value | The bubble is `role="toolbar"` with `aria-label="Selection formatting"`. Style ▾ and Colour ▾ are menu buttons (`aria-haspopup="menu"`, `aria-expanded`). Mark toggles use `aria-pressed`, including "mixed". The colour rows are `menuitemradio` with `aria-checked`. The `+` is `aria-haspopup="listbox"`, because it opens the "/" listbox. |
| 3.2.1 On focus | Focusing never applies anything. The hover preview is a decoration only (A14). |
| 4.1.3 Status messages | Picks announce through the existing polite live region, for example "Heading 2" or "Red text". |

The **phone Insert sheet** is a `dialog` labelled "Insert". It has a heading per section and `role="group"` grids. Focus starts on the first Recent cell. While it is open, the page is `inert`, as with the Aa sheet.

---

## 15. Phased plan (outline; the full plan follows `superpowers:writing-plans` after approval)

| Phase | Scope | Depends on | Visible? |
|---|---|---|---|
| **P0** | BQ2: bubble controller without `registerPlugin`; BQ3 first-line anchor; whitespace-only hide; IME and drag guards. Same items as today. | — | Yes: anchor and edge contrast. UI review gate. |
| **P1** | BQ1 bubble v2: Style ▾ (O1), S, ‹›, colour named rows (O2), link handoff (§7.5), `linkOnPaste` check, empty 💬 slot, keyboard-selection timing (O7), motion token (O10) | P0 | Yes |
| **P2** | Quick insert: `+` on the empty line (O5), the "/" menu amendments (§8.5, O12, BQ9), Insert alias hints, placeholder (OB2 if not already shipped) | slash chunk | Yes |
| **P3** | Row ⋯ regroup (BQ4), Page width ▸ (O9) wired to prefs `page.width`/`doc.width` | prefs P2.9c | Yes |
| **P4** | Phone: Insert sheet (O6), Aa sheet reorder; tablet stand-in words (O8 a) | PR #102 merged (`phone.scss`) | Yes |
| **P5** | 💬 wiring: comments PR P4.10 registers `comment.add`; reading-mode comment-only bubble | comments v1 | Yes |
| **Spike** | O8 b iPad docked selection bar | real device | — |
| **Later** | O4 b reactions | owner | — |

**Parallel tracks.** These have disjoint files:
- P2: the slash folder.
- P3: the row ⋯ files.
- P4: phone files, after #102.

They can each run in a worktree once P0 lands. P1 owns the bubble folder.

---

## 16. Tests and acceptance

- **Unit tests:**
  - `bubble-rules.ts`: whitespace-only, first-line rectangle, side stickiness, keyboard settle.
  - The display-order constant contains only valid tokens.
  - Every Style ▾ id is in the registry.
- **E2e:** extend `selection-bubble.spec.ts`. CI runs **Chromium**. WebKit is the by-hand project (`playwright.config.ts`), and these cases go on its manual list. CDP-only cases (IME through `Input.imeSetComposition`) are Chromium only.
  - **Bubble rules:**
    - no plugin is registered after the chunk loads. Assert `view.pluginViews` **identity** before and after a `holdChunk` release, as the §4.1 probe does; `plugins.length` alone can pass falsely.
    - a two-line selection anchors below the heading.
    - the existing `toHaveCount(0)` assertions still pass, because the root is removed on hide.
  - **Style ▾:** turns a paragraph into H2, a task list and back, as one undo step each; Mixed face; Title disabled.
  - **Colour:** named rows apply and preview; Recent.
  - **Link:** handoff placement; paste a URL on a selection.
  - **Keyboard and focus:** Shift-selection timing (O7); Alt+F10 lands on Style ▾; Esc ladder.
  - **No bubble:** in reading mode, read-only, a code block, a whitespace selection, during IME (CDP `Input.imeSetComposition`) and during a drag.
  - **RTL:** order and arrow keys.
  - **Dark:** edge contrast ≥ 3:1 (`resolveRgb`).
  - **Axe:** no serious violations in the bubble, its menus, the "/" menu with its footer, and the phone Insert sheet (`wcag22aa`).
- **"/" menu (§8.5):**
  - Suggested is absent for a new writer and shows the last 3 insert kinds after use.
  - Forget clears Suggested.
  - The ghost shows only with an empty query and nothing after the caret, and never during IME.
  - The footer tip follows the arrow keys.
  - Close and Esc leave "/query" as text.
  - A `+`-opened menu closed empty removes its "/" and leaves no undo step.
  - A badge disappears after the date and after first use.
  - The RTL anchor is on the content's start side.
  - The contract test checks registry labels and Markdown hints against the input rules.
- **Perf:** typing p95 within +10% with the bubble chunk loaded (perf project). Listeners and heap at baseline after 100 bubble cycles.
- **Budget:** editor chunk +0 B per phase.
- **UI review gate:** screenshots of every state in Appendix C, in light, dark, RTL and both pointers, before each visible phase merges (memory: design review before UI merge).

---

## 17. Out of scope and follow-ups

- **`EditorContent` registers `mobileEnterPlugin` on every mount,** which rebuilds all plugin views on every tab switch (§4.1). That is a Tiptap-level behaviour; a separate investigation, not this design.
- **Toggle (details) and Date blocks (BQ5).** Each needs a schema addition, with the server allowlist first and a schema-floor review. A separate spec if the owner wants them.
- **Reactions (O4 b).** Later.
- **Phones:** the presence and footer pills over the text (F18). These belong to the shell; propose a phone placement in the phones spec.
- **Phones at 320 px:** the tab strip shows the active title as one letter ("B…") (`phone320-dark-02-selection`). Shell follow-up.
- **The Hyperlink hover card has no "Open" action** (§7.5). Request to `@docs.plus`.
- **Task checkboxes are invisible on `main`**, from Tiptap 3.33 TaskItem's styler span. This was found by the icons session (sibling notes), not here; listed so P2's Insert screenshots don't mistake it for a new bug.

---

## Appendix A: Research digest

**Sources** were checked on 2026-11-17. *[O]* marks a product observation not confirmed from a source.

**Google Docs**
- There is no formatting bubble. A selection shows a pill in the right margin with Add comment, Add emoji reaction and Suggest edits ([help 65129](https://support.google.com/docs/answer/65129), [9to5google](https://9to5google.com/2022/04/05/google-docs-emoji-reactions/)).
- Every action in it also has another route:
  - Insert › Comment and Insert › Emoji reaction;
  - Ctrl+Alt+M;
  - Alt+/ tool finder ([help 179738](https://support.google.com/docs/answer/179738)).
- "@" opens one list of people, files, dates and building blocks ([help 11276813](https://support.google.com/docs/answer/11276813)).
- On Android, Add comment and Add emoji reaction sit in the overflow of the system selection toolbar.

**Apple Notes and Pages, Bear 2**
- **Notes:** an "Aa" button in the bar above the keyboard swaps the keyboard for a format panel ([iDB](https://www.idownloadblog.com/2020/10/26/format-text-quick-styles-notes-iphone/)). On a Mac there is no bubble.
- **Pages on iPhone:** a Quick Format bar above the keyboard holds styles, B/I, align, lists, date and page break. It can be turned off ([Apple](https://support.apple.com/guide/pages-iphone/tan83a228834/ios)).
- **Pages on iPad:** Comment is in the shortcut bar.
- **Bear 2:** a BIU button opens the formatting bar. Its launch had VoiceOver regressions ([podfeet](https://www.podfeet.com/blog/2023/07/bear-2/)).

**Word**
- The desktop Mini toolbar appears on **mouse** selection, with an option to turn it off. Esc dismisses it ([MS](https://support.microsoft.com/en-US/Word/use-the-mini-toolbar-to-format-text)).
- Ctrl+Alt+M adds a comment. F6 cycles between regions.

**Notion**
- **Bubble:** Ask AI · Comment · "Text ⌄" (turn into) · Link · B I U S · code · math · A⌄ · ⋯ *[O]*.
- **Colour:** one menu with Text and Background sections. ⌘⇧H re-applies the last colour; ⌘⇧M comments ([shortcuts](https://www.notion.com/help/keyboard-shortcuts)).
- **Mobile:** a bar above the keyboard. Its "+" swaps the keyboard for a grid of basic blocks; there is no "/" ([help](https://www.notion.com/help/writing-and-editing-basics)).

**Craft**
- **Bubble:** highlighter ⌄ │ B I S code link math │ @ │ comment │ style ([docs](https://craft-support.mintlify.app/en/write-and-edit/formatting.md)).
- **"/" menu:** ←/→ open submenus. Dates offer Today, Tomorrow and Now ([slash menu](https://craft-support.mintlify.app/en/introduction/slash-menu.md)).
- ⌘⇧B re-applies the last colour.

**Linear**
- **Bubble:** B I S U code link + comment (⌘⌥M). There are no colours ([editor](https://linear.app/docs/editor)).
- **"/" menu:** code, diagram, collapsible section, table, date and file.
- **Changelog fixes:** the toolbar didn't reposition on resize, was "hidden too aggressively", and opened under the side panel ([changelog](https://linear.app/changelog/2026-03-12-ui-refresh)).

**Dropbox Paper**
- **Bubble:** Bold · Strike · Highlight · Link · Large and Medium header · Bullets · To-do · Comment ([help](https://help.dropbox.com/view-edit/formatting)).
- On mobile, highlight was reachable only through Comment. That is an anti-pattern.

**Medium**
- **Bubble:** B i link │ T t quote. Clicking T again cycles header → subheader → plain. Link turns the bubble into an inline URL field ([help](https://help.medium.com/hc/en-us/articles/215194537)).

**Outline** ([source](https://github.com/outline/outline/blob/main/app/editor/menus/formatting.tsx))
- Items change with context: no marks in code, cell background in tables, indent only on touch, and Comment always.
- The highlight menu shows None only when a highlight is present, then presets, then colours already used, then Custom.

**Lexical playground** ([source](https://github.com/facebook/lexical/blob/main/packages/lexical-playground/src/plugins/FloatingTextFormatToolbarPlugin/index.tsx))
- Hidden during IME, during a drag, on a whitespace-only selection and in code.

**Confluence**
- Users choose between an inline and a fixed toolbar.
- Its un-dismissable "Ask Rovo" button drew heavy complaints ([community](https://community.atlassian.com/forums/Confluence-questions/how-can-i-get-rid-of-the-Ask-Rovo-popup/qaq-p/3150920)).
- The floating toolbar can't be reached by keyboard ([CONFCLOUD-85071](https://jira.atlassian.com/browse/CONFCLOUD-85071)).
- It pops up during Japanese IME input.

**Platform**

- **iOS Safari:**
  - The text-selection callout can't be suppressed (`-webkit-touch-callout` affects links only).
  - The avoidance heuristic (WebKit [r241971](https://trac.webkit.org/r241971)) has regressed on iOS 16, 17 and 26.
  - The selection handles cover nearby buttons ([PM forum](https://discuss.prosemirror.net/t/unreachable-menu-item-due-to-selection-handle-on-ios/4958)).
  - `interactive-widget` is unsupported (WebKit [259770](https://bugs.webkit.org/show_bug.cgi?id=259770)). Use `visualViewport`.
- **Android Chrome:** the system floating selection toolbar can't be extended by a page ([ActionMode](https://developer.android.com/reference/android/view/ActionMode)).
- **Electron:** spellcheck goes through `context-menu` params. Writing Tools and Services need `menu.popup({frame})` ([docs](https://www.electronjs.org/docs/latest/tutorial/context-menu)).
- **WAI-ARIA:**
  - [Toolbar](https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/), [menu button](https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/) and [combobox](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/) patterns.
  - On a `textbox`, `aria-activedescendant` is allowed and `aria-expanded` is not.
  - NVDA with Chromium is flaky on `aria-activedescendant` in a contenteditable, so keep the live region.
  - CKEditor uses Alt+F10 ([docs](https://ckeditor.com/docs/ckeditor5/latest/features/accessibility.html)).
- **RTL:**
  - Apple's [RTL HIG](https://developer.apple.com/design/human-interface-guidelines/right-to-left) and Wikimedia [Codex](https://doc.wikimedia.org/codex/latest/style-guide/bidirectionality.html): flip direction and list icons, never letters, checkmarks or colour.
  - Persian [ISIRI 9147](https://en.wikipedia.org/wiki/ISIRI_9147) has "/" on the US key.
  - The Arabic 101 key there types ظ *[O]*.
  - Old Hebrew SI-1452 has "/" on Q; SI-1452-2 moved it ([wiki](https://en.wikipedia.org/wiki/Hebrew_keyboard)).
- **Motion:** Base UI uses a 150 ms transition that can be cancelled ([handbook](https://base-ui.com/react/handbook/animation)). Apple: brief, and avoid motion on frequent interactions ([HIG](https://developer.apple.com/design/human-interface-guidelines/motion)).
- **Tiptap 3.33:**
  - BubbleMenu plugin defaults: `updateDelay` 250, `resizeDelay` 60. It skips during composition.
  - React `<BubbleMenu>` registers and unregisters its plugin in `useEffect`.
  - Its options effect dispatches `updateOptions` whenever the identity of `shouldShow` or `options` changes ([source](https://github.com/ueberdosis/tiptap/blob/main/packages/react/src/menus/BubbleMenu.tsx)).

## Appendix B: Screenshot index (`docs/design/2026-11-17-bubble-quick-insert/current/`)

| File | Shows |
|---|---|
| `desktop-light-02-bubble.jpg`, `desktop-dark-02-bubble.jpg` | Today's bubble on a heading selection |
| `desktop-light-03-bubble-colour.jpg`, `desktop-dark-03-bubble-colour.jpg` | Colour popover from the bubble |
| `desktop-light-14-alt-f10.jpg` | Keyboard selection on a second line, bubble over the heading, Alt+F10 focus and tooltip |
| `desktop-light-12-bubble-title.jpg` | Bubble on the title |
| `desktop-light-11-narrow-bubble.jpg` | 860 px window: row stand-ins and the bubble |
| `desktop-light-15-link-create.jpg`, `-16-link-preview.jpg` | Link popover, link hover card |
| `desktop-light-06-insert-menu.jpg`, `-07-more-menu.jpg` | Row Insert, row ⋯ |
| `desktop-light-08-slash.jpg`, `desktop-dark-09-slash-query.jpg` | "/" menu, filtered |
| `desktop-light-10-palette.jpg` | Alt+/ palette |
| `phone-light-01-bar.jpg` | Phone bar |
| `phone-*-02-selection-cells.jpg`, `phone320-dark-02-selection.jpg` | Selection cells at 390 and 320 px |
| `phone-*-03-format-sheet.jpg` | Aa sheet |
| `phone-light-04-insert.jpg` | Phone Insert dropdown (F15) |
| `phone-light-05-slash.jpg` | "/" on a phone |
| `tablet-light-02-selection.jpg` | Touch tablet selection, row stand-ins (F20) |

## Appendix B2: Prototype screenshot index (`docs/design/2026-11-17-bubble-quick-insert/proposed/`)

| File | Shows |
|---|---|
| `p01-bubble` | Proposed bubble on a heading: Style ▾ face "H2", marks with Tx, colour, link, paint, 💬 |
| `p02-style` | Turn into menu, opened under the heading because there's no room above |
| `p03-colour` | Two-column named colour menu with Recent first and the hover preview on the text |
| `p04-link` | Link handoff at the bubble's place, with focus in the field |
| `p05-plus`, `p06-plus-menu` | `+` on the empty line; after a click it is the "/" menu |
| `p07-slash` | "/" with a query |
| `p08-more-width` | Row ⋯ regrouped, with the Page width submenu |
| `p09-dark-comment` | Dark: comment draft card with the draft tint; page set to Wide |
| `p10-rtl-bubble` | RTL interface: mirrored order, unflipped mark glyphs |
| `p11-today` | Today's bubble, for comparison |
| `p12-phone-insert`, `p24-phone-insert-turninto` | Phone Insert sheet: Suggested, then "Blocks" or "Turn into" by caret, then Insert |
| `p13-phone-aa`, `p25-phone-aa-pill` | Aa sheet with Style first; the colour tap pill |
| `p14-tablet` | Touch-tablet row with the stand-in words |
| `p15-o1b-o2a-o4b` | The alternative options: H ▾ + List ▾, grid colours, reaction button |
| `p16-o5b` | The rejected bottom pill, colliding with the pills |
| `p17-altf10` | Alt+F10 then →: focus inside the bubble |
| `p18-o11b-panel`, `p19-o11b-turninto` | The O11 b vertical panel and its side submenu |
| `p20-dark-colour` | Dark colour menu on `--bubble-surface` |
| `p21-slash-suggested`, `p22-slash-tip` | "/" with the ghost, Suggested, the footer tip and Close |
| `p23-rtl-slash` | "/" in an RTL paragraph under an RTL interface |

## Appendix C: State matrix for the UI review gate

Every visible phase attaches screenshots of each cell: light and dark; LTR and RTL; fine and coarse pointer where the surface exists.

| Surface | States |
|---|---|
| Bubble | paragraph · heading · title · list · task · quote · Mixed · part-link · inline code · two-line anchor · flipped below (sticky row) · flipped below (remote label) · menu open up · menu open down · with 💬 · without 💬 · comment-only (reading mode) · Paint armed · 860 px window · keyboard-focused (Alt+F10) |
| Style ▾ | each ✓ · Mixed · title disabled · More headings ▸ |
| Colour menu | Default ✓ · a colour ✓ · mixed · More ▸ · Recent · hover preview on text |
| Link | handoff above · handoff below · error (invalid URL, the extension's own message) |
| `+` | caret on an empty line · hover (after the dwell) · after a click (it is the "/" menu) · RTL margin |
| "/" menu | empty query with the ghost · Suggested (with recents) · without recents · a query · no match (reason note) · footer tip on a Markdown row · New badge · above the caret (no room below) · RTL paragraph · LTR paragraph under an RTL interface · phone |
| O11 b panel | only if chosen: panel · Turn into submenu at the inline end · flipped to the inline start |
| Phone | Insert sheet (Recent, all kinds, a step) · Aa sheet new order · selection cells with 💬 · 320 px |
| Tablet | coarse row with stand-in words · fine-pointer bubble |
| ⋯ | grouped · Page width ▸ (library vs sandbox) |
