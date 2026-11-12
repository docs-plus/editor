# Smart toolbar — design

Status: **matured; signed off by HoE and staff engineer with their fixes folded in; awaiting owner approval** · Date: 2026-11-12 · Owner: TinyDocy maintainers

## 1. Intent

The toolbar is "not mature and not sorted", and writers ask for text colour, highlight colour, font size "and more". The owner's definition of *smart*:

> Remember what the user chose — like the last colour — so they decide less while writing, and the tools help them focus on their job.

So the toolbar must (1) be sorted and complete, (2) **remember the user** and hand back their choices as one-click defaults, and (3) stay calm: predictable, fast in large collaborative documents, accessible, and safe in a public sandbox.

### Goals
- A sorted, grouped row that never rearranges itself; a desktop selection bubble (owner-chosen layout **C**).
- Text colour, highlight and font size as safe, theme-aware tokens.
- A **memory layer**: remembered button faces, recents, derived defaults, repeat-last-formatting, personal/doc styles.
- Context-aware tools in reserved places (context slot, palette), never by moving row buttons.
- Responsive collapse by width tier; a docked phone bar.
- Every action reachable by keyboard and screen reader; one action registry behind every surface.

### Non-goals
- Free hex colour picker, px font sizes, font families.
- AI rewrite (deferred), callout block node (deferred).
- Usage-adaptive reordering of any visible control (research: Findlater & McGrenere 2004; Gajos et al. 2006).

### Anti-goals (failure even if it "works")
- The row or bar shifts while typing; typing latency regresses.
- Formatting "follows" the user into new text without an explicit action (Word/Docs sticky-format complaints).
- Any stale client (open tab, old PWA, offline copy) can delete coloured text for everyone.
- Memory leaks into the shared document, the server, URLs or analytics.

### Evidence base
Cited links: [sources](2026-11-12-smart-toolbar-sources.md). Rollout experiments: [experiments](2026-11-12-smart-toolbar-experiments.md). Research and reviews behind this doc (summarized here): round-1 researcher/UX/UI/engineering reports, round-2 research (docs.plus issues #104, #392, #612, #621, #399, #208, #269, #308; WAI-ARIA APG toolbar; shortcut survey; mobile; live preview), round-2 concept, HoE, staff engineer and accessibility reviews, responsive research, memory level 1 and 2, skeptic review. Recorded user demand (docs.plus): task list button (#104), clear formatting keeps links and block (#392), correct shortcut hints + `aria-keyshortcuts` (#612), one action list for menus and palette (#621). Colour and size come from the owner's brief.

## 2. Architecture backbone: one action registry

Every command is one `Action` in `lib/editor-actions/`. The row, context slot, ⋯ overflow, bubble, palette, mobile bar, TOC/drag handle and the later "/" menu are **views** of the registry.

```ts
interface Action {
  id: string;                 // "mark.bold", "color.text.apply", "section.moveUp"
  label: string; keywords?: string[]; icon: IconName;
  shortcut?: KeyCombo;        // renders ⌘B / Ctrl+B and aria-keyshortcuts
  markdownHint?: string;      // "**text**", "## " (#346)
  group: ActionGroup;
  contexts: ContextKind[] | "any";
  enabled(ctx: Ctx): true | { reason: string };
  isActive?(ctx: Ctx): boolean; isMixed?(ctx: Ctx): boolean; value?(ctx: Ctx): string;
  run(editor: Editor, arg?: unknown): void;   // one transaction = one undo step
}
```

- **Context snapshot** (O(depth)): parent type, ancestor flags (table, listItem, blockquote, codeBlock), isTitle, NodeSelection type, empty, marks, headingId, editable; `kind` precedence readonly > media/mermaid > code > table > title > heading > list > paragraph. Lives on `getEditorVersionStore` (`hooks/use-tiptap-editor.ts`) as `getContext()` / `getView(id)`; **memo key = store version** (staff: `setEditable` creates no new state). Each control subscribes to its own view via `useSyncExternalStore`, so a selection change re-renders only changed controls (today all ~25 re-render).
- `can()`: undo/redo read the Yjs UndoManager stack length; lists, tables, indent and section move compute a real `can()` lazily and cache it in the snapshot.
- **Indent fix:** the registry `indent` action mirrors Tab's chain (`sinkListItem` → `indent`, no cell move); today the button is disabled in lists while Tab works (`indent-button.tsx:25-36`).
- **Clear formatting (#392):** removes every inline mark except `hyperlink`; never touches block type/alignment/indent; disabled in code; `Mod-\`.
- Global read-only (`document_too_large`, `document_deleted`) → every `enabled()` returns a reason; mobile bar hides (#308).

## 3. Data model and safety

- **Marks:** `textColor { color: TextColorToken }` → `<span data-text-color>`; `fontSize { size: "xs"|"sm"|"lg"|"xl" }` → `data-font-size` as em steps (XS .75, S .875, M default = no mark, L 1.25, XL 1.5). Not `TextStyleKit`: one textStyle mark makes concurrent colour + size last-writer-wins and parses arbitrary span styles.
- **Highlight:** moves to the same token scheme (`data-highlight`); legacy `var(--tt-color-highlight-X)` maps to token X in the mark itself; server `afterLoadDocument` migration (`lib/yjs-mark-migration.ts`, extended to rewrite attribute values) is cleanup only.
- **Render-time enforcement:** the server has no schema, so `renderHTML` re-checks tokens; unknown values render as plain text (no `style`, no unknown class). Never use ProseMirror attribute `validate` (a token added later would become invalid content).
- **Paste (P10, decided):** drop foreign `color`, `font-size`, `background-color`; keep our own `data-*` tokens so copy/paste between TinyDocy tabs round-trips (`renderHTML` must emit the `data-*` attributes, not only classes). *Builder verifies with a real Google Docs/Word clipboard sample.*
- **Schema evolution rule:** only add new marks, nodes or token values; never add an attribute to an existing mark **or node** (an old client strips it on its next edit), and never loosen a content expression or `marks` spec (y-tiptap builds nested nodes unchecked, so nested violations never reach `onInvalidContent`). A **schema-snapshot unit test** fails on any change, because the daily docs.plus extension refresh can change attributes unnoticed. (Precision: an unknown mark deletes the block's whole `Y.XmlText`; an unknown node deletes the element.)
- **Typing continues the formatting (builder-check call):** `textColor`, `fontSize` and `highlight` are inclusive like bold — typing at the end of red text stays red, and applying a colour with an empty selection sets a stored mark for the next characters (Word/Docs convention). The anti-goal is about *memory* never applying itself, not about normal mark continuation.
- **fontSize stays out of headings/title** via commands and paste rules, never schema restrictions (rejected content = the same deletion path).
- **Palette:** 10 text + 10 highlight tokens with light/dark values, all text ≥4.5:1 on both page backgrounds, highlights AAA under default text (table in Appendix A). Unit test: every token ≥3:1 on both themes.
### 3.1 Rollout safety (P1, decided — replaces the 14-day bake)
Unknown marks make y-prosemirror delete the whole block and upload the deletion (verified in a scratch experiment); an old offline bundle can also save a damaged device copy that a new bundle later uploads. Three guards, verified by experiment:
1. **Version gate.** Client puts `schema=<n>` in the WebSocket URL (`searchParams` in `getSharedHocuspocusSocket`; provider 4.8 has no `parameters` option). Server `onConnect`: tombstone check first, then refuse with `client_outdated` when below `HOCUS_MIN_CLIENT_SCHEMA` (default 0 = log only). `global-tabs` / `global-tabs-*` exempt; playground gated. Refused old bundles keep their copy and never upload (server drops queued sync). Server also drops further messages for documents already refused (prevents the 1,000-message socket reset). Log an aggregated per-minute count, never via `reject()` (abuse alert path).
2. **New offline namespace** `1:${host}~s2:${name}`; old bundles never load it and their prune skips it. On load, merge the legacy copy before connecting, save, delete the legacy key only after a successful save; every removal path deletes both. Never bump the epoch.
3. **`ySyncOptions.onInvalidContent`** (passed through `CollaborationRenderOnce`): read-only + "Reload to update" banner, stay connected, keep saving the copy (shared doc is intact, writes frozen). From protection level 2 on, every bundle is immune, so **later additive marks need no gate change — only an allowlist update shipped first** (see the rule below).
New bundles refused with `client_outdated`: detach, keep copy, read-only, banner whose button saves pending copies then reloads (this is the PWA update prompt).
**Release order (staff blocking fix a), four steps:**
1. **Deploy release N (PR B)** — client + server; gate log-only; server ingress allowlist already includes `textColor` and `fontSize` (N clients that meet them freeze, never delete).
2. **Wait** for the N+1 ship gates below.
3. **Server-only step: deploy PR C's server half and restart Hocus *before* Next.** PR C sets `SCHEMA_FLOOR = 2` in code, so the gate turns on with the Hocus restart regardless of env. The owner runs it (CHANGELOG Deploy note gives the exact `bunx pm2@6.0.14 restart … --update-env` order: Hocus first, confirm refusals in the log, then Next). *Builder verifies the build step does not change the client bundle served by the still-running Next process before its restart; if it does, build into a separate directory.*
4. **Restart Next** to serve the N+1 client with the marks.
Never serve the N+1 client before step 3 completes, and never roll back below N.
**Allowlist rule (every future mark or node):** the server ingress allowlist ships in an earlier deploy than (or the same server restart that precedes) any client that writes the new name.
**Gate check (staff blocking fix b):** refuse unless `schema` parses as an integer ≥ the effective minimum (`Number(x) < min` lets `NaN` through). Count `client_schema` in fixed buckets (missing, low, ok, invalid); never log raw values. The per-socket refused set is keyed by the frame's `rawKey` (document + session) and cleared on socket close.
**Freeze mechanics (staff):** y-tiptap ≥ 3.3.0 already freezes on invalid content (no editor→Yjs writes, local doc changes filtered, `editable` false, guarded undo), so staying connected is correct. Pin y-tiptap ≥ 3.3.0 and test the freeze. `onInvalidContent` fires during plugin-view init (`collaboration-render-once.ts:99`): it only records the reason; the UI reacts later, never calling editor APIs from the handler. Legacy offline key deletion runs in the same IndexedDB transaction as a check against what was merged.
**Releases:** N = URL param + refusal handler + `onInvalidContent` with the B1 repair handler + namespace merge + gate log-only + B2 ingress allowlist (incl. the new names) + token-aware highlight *rendering* (reads both legacy `var(--tt-color-highlight-X)` and token `X`), no mark-creating UI. N+1 = marks + `SCHEMA_FLOOR = 2` + server rewrite of stored highlight values, deployed in steps 3–4. Wait ≈2 days until ≥95% of connections send `schema=2`, read from the per-minute aggregate in the Hocus (PM2) log (UX only; data already safe).
**HoE blocking fixes (required for PR B/C):**
- **B1 — freeze only on unknown names.** y-tiptap reports invalid content for *any* schema misfit (`ProsemirrorBinding.ts:194`), e.g. a paragraph before the title or an emptied fragment; freezing on those would let one raw Yjs call lock any doc. The handler walks the fragment: unknown node/mark names → freeze + "Reload to update"; known names only → targeted Yjs repair under its own origin (insert empty title at 0, or seed an empty fragment); `projectionError` resets per projection (`:174`), so a repair unfreezes — **an experiment must prove this before PR B merges**. Failed repair → "This document can't be edited in this version" banner + counter.
- **B2 — refuse unknown names at ingress.** `lib/security/hocus-document-guard.ts` already decodes updates (`:89`); refuse updates whose element names or format keys are not in a shared `lib/schema-names.ts` (legacy `link`/`code` allowed). Close with a non-reconnecting reason + abuse-log entry. New names follow the allowlist rule above.
- **B3 — the floor can only go up.** Effective minimum = `max(HOCUS_MIN_CLIENT_SCHEMA, SCHEMA_FLOOR)` with `SCHEMA_FLOOR = 2` in code. Runbook in `docs/operations/`: reverting the client is safe; never lower the floor.
- **B4 — highlight keeps its attribute key `color`** (stock mark, `multicolor: true`); only the *values* become tokens. `data-highlight` is a render attribute only.

**N+1 ship gates:** ≥95% of connections send `schema=2` over a trailing 24 h, held ≥48 h (count per schema value, excluding refused retries); refused-client soak (3,000 typed chars → 0 `4205` resets, 0 `ws_throttle_ban`); mixed-version nightly soak N + N+1 → 0 deleted blocks, 0 unexpected freezes; hostile tests (unknown name refused at ingress; delete-all and paragraph-before-title repair instead of freezing); staging drill (env 0 → effective min still 2); CHANGELOG Deploy note: Hocus restart first, then Next, at low traffic.

**What the number means (builder-check call):** `schema` = the client's protection level, not its mark set. Release N **sends 2** (it is immune: has `onInvalidContent` + the new namespace), so N clients pass the gate after N+1 and go read-only with the banner if they meet marks they don't know. Pre-N bundles send nothing (treated as 0) and are refused. `HOCUS_MIN_CLIENT_SCHEMA` stays 2 for later additive marks (e.g. Document styles); it is raised only if a future release needs a new kind of protection. Each release still sends its own build number in a separate `build` parameter for the adoption log.

## 4. Surfaces

### 4.1 Row (never reorders)
`[Outline] [Filter] │ ↶ ↷ │ Normal text ▾ · − M + │ B I U S · A▾ · ✎▾ · 🔗 │ Align ▾ · List ▾ · ⇤ ⇥ │ [SLOT] │ + Insert ▾ · ⋯ │ … Theme`
- Style dropdown previews each style, shows "Title" (disabled, reason) in the title, *Mixed* for mixed selections; size stepper is a `spinbutton` with `aria-valuetext` ("Large, about 20 pixels"), disabled in headings ("Headings scale automatically").
- List dropdown: bullet, numbered, **task** (#104). Insert: image, embed, **table**, quote, code, diagram, divider.
- ⋯: superscript, subscript, inline code, clear formatting, Forget my choices, All actions… (Alt+/).

### 4.2 Context slot (fixed width, before Insert, `role="group"` with changing `aria-label`, no live region)
| Context | Contents |
|---|---|
| paragraph, list | empty reserved space, hidden from AT |
| heading | fold · move section ↑ · ↓ (registry `section.*`, shared with TOC and drag handle) |
| title | lock glyph; style dropdown reads "Title" |
| code | language ▾ · copy |
| mermaid (tested before code) | diagram language ▾ · copy source ("Hide source" after an upstream command exists) |
| table | Row ▾ · Column ▾ · Header row · Merge/split (TableKit ships no UI; today only Tab in the last cell adds a row) |
| media / image | "Media options…" → calls the kit's public `openMediaToolbar` (today reachable only on mouseenter, so this fixes keyboard access); Esc returns |
Slot never duplicates a row control. **Timing (P6, decided):** `getContext()` lazy and memoized by store version; recompute immediately on selection change, after `TOOLBAR_SETTLE_MS` for doc changes (input rules, remote edits), with a new `TOOLBAR_MAX_WAIT_MS = 1000` cap (today's trailing debounce can starve under continuous remote typing). `hold()` (ref-counted) freezes slot contents while focus is in the toolbar; enabled states keep updating; `run()` always rechecks the live doc. Vanished targets become `aria-disabled` with a reason.

### 4.3 Selection bubble (desktop only)
B · I · U │ text colour split │ link (+ Repeat, P2). Every bubble action is also in the row. `shouldShow` exits first on empty selection; stable props; mounted once per editor; `scrollTarget` `.document-editor-wrapper`; hidden on keystroke, node selection, code, Mermaid, inside a hyperlink; flips below to avoid covering the focused line and remote caret labels; colour popover renders inside it. 140 ms in / 90 ms out; reduced motion = opacity only.

### 4.4 Palette (Alt+/, fallback Alt+Shift+Z)
shadcn `Command`, lazy chunk. Groups: Recent (memory), Suggested here (context copies), Format, Insert, Section, View. Disabled entries listed with reason. Match physical Slash + Alt in capture phase (macOS ⌥/ = "÷"); one window listener reading the active editor from a ref (no leaked editors).

### 4.5 Colour popover
One popover, two split triggers (text **A**, highlight ✎); each face reapplies its own last colour ("Apply text colour: Red" / "More text colours"). Sections: Recent (P4, decided: one mixed row of ≤5 text and highlight colours, newest first, frozen while open), Text (default + 10), Highlight (none + 10). Today's popover shows only 5 of 9 highlights and has no text colour. Swatches are named `aria-pressed` buttons in a 2-D roving grid inside `role="dialog"` (not a radiogroup: arrow keys must not apply colours), check glyph on selected, forced-colours border.

### 4.6 Responsive ladder (CSS container queries on the toolbar; ResizeObserver only for focus repair)
| Tier | Mouse ≥ | Touch ≥ | Collapses |
|---|---|---|---|
| T1 | 1128 | 1224 | full row |
| T2 | 1008 | 1096 | Insert label → icon; Theme into ⋯; size → "M ▾" |
| T3 | 840 | 920 | align + indent → ¶ menu; slot → one 40px button |
| T4 | 752 | 824 | colour pair → one button; Outline + Filter → View ▾ |
| T5 | — | 768 | U, S → "Aa" menu; style shows short value |
| Phone | < 768 viewport | | docked bar, 7–8 cells of 44×44 |
Never collapse: undo/redo, style, B, I, link, list, Insert, ⋯. `scrollbar-gutter: stable` on `.document-editor-wrapper`. Roving items collected at keydown filtered by `checkVisibility()`; focused control hidden by resize → focus its group's collapse button, detected by **one ResizeObserver used only for focus repair** while focus is inside the toolbar (layout itself is pure container queries). Outline below ~950px: **my call — overlay** (slides over the page, closes after picking a heading); owner can overrule.

### 4.7 Mobile bar
Constant 44px, docked above the keyboard; normal: undo, Aa sheet (style, size, colours, align, ⋯ items), B, I, list, indent, slot, Insert. With text selected it swaps in place to B I U S, colour, highlight, link, clear, ✕ "Back to all tools" (one `role="toolbar"`, label changes; no swap while VoiceOver focus is in the bar). No floating bubble on touch. `focusout` reset for iOS `visualViewport` drift; active states via `aria-pressed` (#269).

## 5. Memory layer ("it remembers you")

Rules: the row never reorders; memory changes **what a button offers, never what you type**; nothing applies without an explicit action; recent rows are copies, frozen while open; if the document already knows the answer, derive it and store nothing; local only (never Yjs, server, URLs, analytics).

Keys: `tinydocy-choices` (M1–M5, M7, M9–M11, M17) is what "Forget my choices" clears; `tinydocy-ui` (M6 outline state) and `tinydocy-formats` (M14 saved formats) are separate and survive Forget. Store: each key versioned, accessed via `useRememberedChoice(spec)` (key, maxRecent, allowlist validator, fallback → `ready`, `last`, `recent`, `remember()`); reads in `useEffect` behind a ready flag; try/catch around storage; unknown versions discarded; only a successful `run()` writes. "Forget my choices" in ⋯ clears only this key. Kill switch `NEXT_PUBLIC_REMEMBER_CHOICES=0`.

Principle for faces (P5): a remembered face appears only where its visible label shows the outcome, so a click never surprises.

| # | Memory | Form | Phase |
|---|---|---|---|
| M1 | Last text colour | split-button face ("Apply text colour: Red") | v1 |
| M2 | Last highlight | split-button face | v1 |
| M3 | Recent colours | one mixed row ≤5, frozen while open | v1 |
| M4 | Code language | most used in this doc (excluding `mermaid`), else your last | v1 |
| M5 | Heading level for new sections | derived from current section, stores nothing | v1 |
| M6 | Outline open state | persisted (`document-editor.tsx:139` is `useState(true)`); not cleared by Forget | v1 |
| M7 | **Repeat formatting** (merges the format painter) | one remembered bundle, filled by formatting text or by "Copy formatting"; Repeat **sets** (never toggles) marks in one transaction | v1.1 |
| M9 | List-type face | split face with icon + label | v1 |
| M10 | Insert face | labelled split face at tier T1 only; from T2 a plain menu with the last kind pre-highlighted; kinds needing input (table, image, embed) open their first step instead of inserting | v1 |
| M11 | Palette Recent | top group | v1.1 (with palette) |
| M12 | "In this doc" | dots on used swatches + an "In this doc" section in the Formats menu (scanned on open, capped, never stored) | v1.1 |
| M14 | **Your formats** (personal, unlinked) | always-available "Save as format…" + nudge after the same bundle is repeated 3× in a session; shown in the Formats menu, style dropdown and palette; applying writes plain marks | v1.1 |
| M14b | **Document styles** (linked, shared) | `styleRef` mark (no gate change; allowlist update shipped first per §3.1) + shared `Y.Map` of definitions; generated CSS from validated tokens only; ≤24 styles, names ≤40 chars with control/bidi chars stripped; deleted style renders plain | later (L, 2–3 weeks) |
| M15 | Continue where you left off | offer chip above the title, never auto-focused; Go unfolds the target's folded ancestors, sets the selection first (target renders at true height under `content-visibility`), then scrolls; no chip when a filter URL hides the target; stored as Yjs relative position per doc | later |
| M16 | Link suggestions from this doc | **parked**: needs a custom link popover (M), and in a public doc would resurface planted links. If revived: package `isSafeHref`/`validateURL`, http(s) only, punycode host, capped scan, ≤5 | parked |
| M17a | Table size | grid opens at your last size | v1 |
| M17b | Mermaid template | 5-template submenu remembers last | v1.1 (M) |
| M17c | Media size | cut (overrule option: remember last placement per media family) | cut |

**Repeat formatting details (P2, decided).** Bundle = inline marks (B, I, U, S), text colour, highlight, font size; never links, block type, alignment, inline code. Opens when the user formats a selection; extends while they keep formatting the same selection (range stored as **Yjs relative positions**, since remote edits arrive as `replaceChangedChildren` and collapse mapped positions); closes on a new selection (only transactions without `ySyncPluginKey` meta count), document switch, or **any undo or redo**. Call `undoManager.stopCapturing()` **before and after** the dispatch so the replay is its own undo step (y-tiptap merges within 500 ms and the Yjs write happens synchronously inside the dispatch). Disabled in headings for font size, in code. **Keys:** ⌘⌥V on macOS (works via keyCode fallback); Ctrl+Alt+V plus **F4** alias on Windows/Linux (AltGr+V types "@" on Czech, Slovak, Hungarian, Slovenian, Polish-214, Serbian Latin, so the shortcut cannot fire there); Alt+/ → "Repeat formatting" works on every layout. Bind through Tiptap `addKeyboardShortcuts`, never a window listener. "Copy formatting" has no key (Mod+Alt+C is code block). Surfaces: ↻ split in the bubble (face names the bundle, e.g. "↻ B · Red · L"; chevron opens the Formats menu), palette, mobile cell, style dropdown.

Not remembered: heading filter, alignment, URLs, diagram source, typed text, context-split memory, a learned paste default.

## 6. Accessibility must-fixes (shared components, ship first)
1. Focus ring: solid outline ≥3:1, survives forced colours (`components/ui/button.tsx`).
2. Pressed state not colour-only: 2px bar ≥3:1; `Highlight` in forced colours.
3. Colour grid as named `aria-pressed` buttons in a dialog (not radiogroup); remove stray `menuitem` / `tabIndex=0` container.
4. Menu buttons named by visible value, `aria-haspopup="menu"`, no `aria-pressed`; items `menuitemradio`.
5. Disabled-with-reason: `aria-disabled` + `aria-describedby`, focusable, tooltip on focus, `run()` no-op; remove `disabled:pointer-events-none`.
6. Slot changes under focus never drop focus to `<body>`.
7. Every target ≥24×24 (split chevrons, stepper); 44×44 on touch.
8. `scroll-padding-top` = toolbar height; mobile bottom padding = bar + keyboard inset.
Plus: one Tab stop + roving tabindex, Alt+F10 to bubble/row, Esc returns with selection, act on click (prevent default on mousedown).

## 7. Performance and test budgets
- Typing p95 (4× CPU, 50 and 500 headings, toolbar+bubble+slot mounted vs off, same run): ≤ +10% and ≤ +16 ms; ≤1 toolbar React commit per settle during a burst; arrow / shift+arrow p95 < 16 ms; after 20 tab switches + 100 palette/bubble cycles listeners back to baseline and heap within 5%; collab p95 within 10% while others type.
- Bundle: editor chunk ≤ +6 KB gz; colour popover lazy; palette + cmdk ≤ 15 KB gz loaded on first Alt+/.
- Abuse soak: 50k alternating colour runs, typing latency within budget.
- Leak and cost hygiene (staff): release `hold()` on unmount (`focusout` is not guaranteed); keep `getView`/snapshot caches in a WeakMap keyed by editor and clear the max-wait timer on destroy; cache document-derived fields (`can()`, section lists, code-language count) by `state.doc` identity so arrow keys in a 500-heading doc stay O(depth).
- Tests: schema round-trip + render fuzz (`red;background:url(x)` emits no style), Yjs survival of new marks, old-client gate, offline namespace merge, highlight migration, registry per context, bubble-in-row matrix, keyboard e2e (one Tab stop, Alt+F10, Esc, remote heading deletion while slot focused), axe per context, forced colours, responsive `scrollWidth <= clientWidth` at each tier ±1px, memory store tamper test.

## 8. Phasing (one PR each, sequenced; each with a CHANGELOG entry under Unreleased)
1. **PR A — a11y + layout foundations:** §6 must-fixes in shared components, scroll-padding, indent-in-lists fix, `TOOLBAR_MAX_WAIT_MS`.
2. **PR B — release N, safety:** schema URL param (sends 2) + `build` param, `client_outdated` refusal + banner, gate log-only with bucketed counts, `onInvalidContent` record-only + B1 repair handler (with the `projectionError` reset experiment as a test), B2 ingress allowlist in `lib/schema-names.ts` (incl. `textColor`, `fontSize`), offline namespace + transactional merge, token-aware highlight rendering, schema-snapshot test, y-tiptap ≥ 3.3.0 pin, runbook in `docs/operations/`. No mark-creating UI.
3. **PR C — release N+1, schema:** `textColor`, `fontSize`, highlight value tokens (key stays `color`) + legacy mapping + server rewrite, render-time enforcement, paste rules, `SCHEMA_FLOOR = 2`. Deployed via §3.1 steps 3–4 after the N+1 ship gates pass.
4. **PR D — v1 toolbar:** registry + snapshot, sorted row, context slot (all contexts), colour popover, bubble, Insert (+ Table), responsive ladder, outline overlay < 950px, memory M1–M6, M9, M10, M17a, `NEXT_PUBLIC_REMEMBER_CHOICES`, and the **phone docked bar with the Aa sheet** (style, size, colours, align, ⋯ items) so phones can reach the new marks from day one (builder-check call).
5. **PR E — v1.1:** Alt+/ palette (lazy) + M11, Repeat/Copy formatting (M7), Your formats (M14), In this doc (M12), Mermaid templates (M17b), mobile selection swap.
6. **Later:** Document styles (M14b), Continue where you left off (M15), "/" menu, hover preview (decorations only, also on keyboard focus, off on touch), progressive-disclosure toggle; link suggestions parked (M16).
**Per-PR go criteria (HoE):**
- **A:** axe 0 serious per context; forced-colours snapshots; indent in lists e2e; `kind` updates within 1 s under 5 s of remote typing; ≤1 toolbar commit per settle; `performance.spec.ts` *asserts* typing p95 ≤ +10% vs `main` (today it only logs).
- **B:** gate matrix (tombstone first, `global-tabs(-*)` exempt); legacy offline key deleted only after a successful save; e2e banner + read-only + IndexedDB copy kept + server doc unchanged; no new `ws_guardrail_rejected` volume; B1/B2 done.
- **C:** B3/B4 + N+1 gates; render fuzz emits no `style`; palette contrast unit test; tab-to-tab paste keeps tokens, Docs/Word samples paste plain; 50k alternating colour runs within budget.
- **D:** §7 asserted in CI; editor chunk ≤ +6 KB gz via a new manifest size check; `scrollWidth <= clientWidth` ±1px per tier; memory tamper test; works with `NEXT_PUBLIC_REMEMBER_CHOICES=0`. Splitting D (registry + row, then other surfaces) advised.
- **E:** after D's metrics hold 14 days in production; palette + cmdk ≤ 15 KB gz on first Alt+/; listeners/heap back to baseline after 20 tab switches + 100 palette/bubble cycles; Repeat is one undo step, sets not toggles, F4 works; mobile swap passes the WebKit/iOS project.

Upstream asks (docs.plus extensions): keyboard-focusable media toolbar with Esc return; public Mermaid hide-source command.

## 9. Decisions log
All open problems were matured by a platform team (staff engineer + researcher, with scratch experiments on Y.Doc + y-prosemirror) and a product team (UX researcher + designer). Calls the owner can overrule:
- **P1** version gate + offline namespace + `onInvalidContent` replace the 14-day bake (§3.1).
- **P2** Repeat merges the format painter; F4 restored as alias (§5).
- **P3** personal "formats" in v1.1, linked Document styles later.
- **P4** one mixed Recent row ≤5.
- **P5** faces kept where the label shows the outcome; media size cut.
- **P6** lazy memoized snapshot + max-wait cap + `hold()`.
- **P7** Continue chip specified, phase later.
- **P8** link suggestions parked.
- **P9** table, media, Mermaid slot contexts restored.
- **P10** drop foreign paste colours, keep own tokens.
- **Outline < 950px** becomes an overlay (my call).
- **Outline jump** scrolls to `block: "start"` per AGENTS.md (today `toc-sidebar.tsx` uses `center`); Continue reuses the same helper (my call).

## 10. Original open problems (archived)
- **P1 Gate vs bake.** Does an old bundle refused with `client_outdated` hit the non-final `authenticationFailed` branch (`lib/collab-session.ts:162-165`) and keep its copy? If yes, is the version gate the general mechanism (every later schema addition = version bump), making a 14-day bake unnecessary? Define the exact protocol, the offline namespace migration, `onInvalidContent` behaviour and the ship gates.
- **P2 Repeat formatting.** What is "the last bundle" (marks + colour + size? highlight?), when does it close (selection change, undo, remote edit), interaction with the Yjs UndoManager, set-not-toggle semantics. Shortcut that survives AltGr layouts (Czech AltGr+V = "@") and macOS; Painter vs Repeat — keep both, merge, or drop one.
- **P3 Styles.** Linked (schema element + Y.Map of definitions, inherits P1) vs unlinked personal. Abuse: names are user text in a public doc. Discovery: always-available "Save selection as style" vs the 3-in-7-days nudge (won't fire in a sandbox). Combo chips' role.
- **P4 Recents count.** The skeptic's cap of 3 and cut of highlight recents assumed ~7 / ~4 tokens; the design has 10 / 10. Check the real palette and decide.
- **P5 Faces with shared-doc misclick risk.** List-type and Insert faces; table size, Mermaid template, media size. Design out the misclick (labelled split, one-step undo) or justify cutting.
- **P6 Snapshot timing.** Exact recompute triggers (selection, settle after doc change, input rules, remote edits) without per-keystroke cost; freezing while focus is in the toolbar.
- **P7 Continue where you left off.** Storage, interaction with folds, heading filter, `content-visibility`, the caret-block class; offer UX.
- **P8 Link suggestions.** Spam-URL validation, caps, host display in a public sandbox.
- **P9 Slot contexts** for table, media, Mermaid: restore (with what contents) or drop.
- **P10 Paste colour mapping.** Drop pasted colours (HoE) vs map to nearest token.

## Appendix A — palette
Text (light / dark): gray #57534e / #a8a29e · brown #8a4b2a / #d0a284 · red #dc2626 / #f87171 · orange #c2410c / #fb923c · yellow #a16207 / #facc15 · green #15803d / #4ade80 · teal #0f766e / #2dd4bf · blue #2563eb / #60a5fa · purple #9333ea / #c084fc · pink #db2777 / #f472b6.
Highlight (light / dark): gray #e7e5e4 / #3f3f46 · brown #eddcd0 / #4a3228 · red #fecaca / #5c2a2e · orange #fed7aa / #5c3b23 · yellow #fef08a / #574f12 · green #bbf7d0 / #1f4a30 · teal #99f6e4 / #174542 · blue #bfdbfe / #1e3a5f · purple #e9d5ff / #45305e · pink #fbcfe8 / #5a2945.
