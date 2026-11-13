# Smart toolbar PR D2: colour popover, selection bubble, memory, responsive ladder, outline overlay and phone bar, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the v1 toolbar on top of D1's registry and row. D2 adds:
- the colour popover with remembered split faces;
- the desktop selection bubble;
- the Insert menu's remembered face and table size grid;
- the local memory layer (M1–M6, M9, M10, M17a) with "Forget my choices";
- the width-tier ladder;
- the outline overlay below 950 px;
- the phone docked bar with its Aa (format) sheet.

**Architecture:**
- **Views of the registry.** Every new surface is a view of D1's action registry (`lib/editor-actions/`), and runs commands only through `runAction`.
- **Memory.** One local-only store (`lib/memory/remembered-choices.ts`), read through `useRememberedChoice`. It writes only after `runAction` returns `true`.
- **Layout.** CSS container queries on the fixed toolbar. Both the inline control and its collapsed trigger are in the DOM, and CSS shows one of them. Portaled menus decide their collapsed items at open time with `checkVisibility()`. There is no React tier state, and the only `ResizeObserver` repairs focus.
- **Lazy chunks.** The colour palette, the table size grid and the phone format sheet load lazily. The size check proves that they stay out of the editor chunk.

**Tech Stack:** Next.js 16 (Turbopack), React 19.3, Tiptap 3.33, `@tiptap/react/menus` `BubbleMenu` (`@tiptap/extension-bubble-menu` 3.33.1, made a direct dependency), Base UI 1.9 (Popover, Menu, Dialog), Tailwind 4 + SCSS, `bun test` (happy-dom), Playwright 1.65 with `@axe-core/playwright`.

**Spec:** `docs/superpowers/specs/2026-11-12-smart-toolbar-design.md`. D2 is the second half of §8 item 4 (D was split as HoE advised). It covers:
- §4.1 (Insert and ⋯ contents);
- §4.3, §4.5, §4.6;
- §4.7, except the selection swap (PR E);
- the §5 v1 set;
- §6 on the new surfaces;
- the D2 share of §7;
- the HoE criteria for **D**.

**Base:** branch `feat/smart-toolbar-d2-surfaces` from D1's merge commit (D1 sits on the A + C merge). Before Task 1, confirm that:
- `git grep -n "export function runAction"` finds `lib/editor-actions/run-action.ts` (D1 Task 3);
- `scripts/client-js-baseline.json` exists (D1 Task 10);
- `git grep -n '"textColor"'` finds C's mark.

## Global Constraints

**Tooling**
- Bun only: `bun`, `bun <bin>`, `bunx --bun`. Never npm, npx, yarn or pnpm. Add dependencies with `bun add`.
- Biome formats and lints. ESLint covers Next rules only. TypeScript is strict. `bun run typecheck` covers the app and `tsconfig.sw.json`.

**Code style**
- Named exports only (`React.lazy` imports map a named export to `default`). Kebab-case files. PascalCase components with title-case acronyms.
- Icons come from `lib/icons.tsx`; add new lucide icons there.
- New UI uses shadcn components in `components/ui/`.

**Commits**
- Conventional Commits: atomic, imperative mood.
- **No AI, tool or agent references and no trailers.** This overrides any `Co-Authored-By` reminder.
- Before every commit, show a commit review report (files, diff summary, message) and wait for explicit approval.
- Each task adds its own bullet to `CHANGELOG.md` under `[Unreleased]`, in the same commit.

**Tests**
- `bun run test` runs the unit tests in one process with a happy-dom preload. `mock.module` spreads the real module and is followed by `await import()`. Modules that read env at import time load through `importFresh()`, with `resetModules()` in `afterEach`.
- Playwright runs against **Next 3800 + Hocus 1934**, never tiny.docs.plus. Start them once and keep them running:

```bash
# terminal 1: Hocus
HOCUS_PORT=1934 DB_PATH="$TMPDIR/tinydocy-d2-e2e.sqlite" HOCUS_ALLOW_ISOLATED_TABS_DOCS=1 HOCUS_THROTTLE=0 \
  WS_CONNECTION_LIMIT=200 WS_SOCKETS_PER_IP=600 WS_UPGRADE_RATE_LIMIT=6000 DOC_CREATION_RATE_LIMIT=2000 bun run hocus
# terminal 2: Next. Use the same DB_PATH: the DELETE route and Hocus share tombstones.
# NEXT_PUBLIC_HOCUS_URL is needed: without it the client falls back to :1234, and CSP connect-src derives from it.
NEXT_PUBLIC_HOCUS_URL=ws://127.0.0.1:1934 DB_PATH="$TMPDIR/tinydocy-d2-e2e.sqlite" DOC_CREATION_RATE_LIMIT=2000 bun next dev -p 3800
# tests
E2E_BASE_URL=http://localhost:3800 CI= bun playwright test <spec> --project=chromium
```

- Kill-switch runs need a second Next on **3801** with `NEXT_PUBLIC_REMEMBER_CHOICES=0`, using the same Hocus and DB. `NEXT_PUBLIC_*` values are inlined at compile time.
- e2e types at full speed. Misplaced text means an app bug, not a missing wait.
- Touch e2e uses `test.use({ hasTouch: true, isMobile: true })`. Its first assertion is `matchMedia("(pointer: coarse)").matches === true`, so it can never silently re-run the mouse case.

**Code rules**
- Hydration: never `useState(() => readWindowOrStorage())`. Use a `useEffect` ready flag, or `useSyncExternalStore` with a constant server snapshot.
- Never subscribe the editor shell to editor state. Never rebuild the extensions array or `EDITOR_PROPS` per render.
- Controls never pass `tabIndex`; the `Toolbar` owns it (D1 Task 6). Popups opened from a toolbar carry `data-toolbar-popup` (D1 Decision 16). Swatch grids carry `data-roving-group`.
- A control never `return null`s because the editor is read-only. It stays in place, `aria-disabled`, with a reason.
- Memory never reaches Yjs, the server, URLs or analytics. Only a `runAction(...) === true` writes.

**Values the spec pins**
- Tiers are **toolbar container widths**: the fixed toolbar's content-box inline size, which is what `@container` measures (the toolbar's `clientWidth` minus its `px-2` padding). The minimum for each tier:

| Tier | Mouse ≥ | Touch (`pointer: coarse`) ≥ | Collapses from this tier |
|---|---|---|---|
| T1 | 1128 | 1224 | nothing |
| T2 | 1008 | 1096 | Insert label → icon; Theme → ⋯; size → "M ▾" |
| T3 | 840 | 920 | align + indent → ¶ menu; slot → one 40 px button |
| T4 | 752 | 824 | colour pair → one button; Outline + Filter → View ▾ |
| T5 | — | 768 | U, S → "Aa" menu; style shows the short value |
| Phone | viewport < 768 | | docked bar, 7–8 cells of 44×44 |

- Never collapse: Undo, Redo, Text style, Bold, Italic, Link, List, Insert, ⋯ (More formatting).
- `scrollbar-gutter: stable` on `.document-editor-wrapper`.
- No overflow at any tier: `scrollWidth <= clientWidth + 1`.
- Outline is an overlay below a 950 px viewport.
- Bubble: 140 ms in, 90 ms out. Reduced motion uses opacity only. `scrollTarget` is `.document-editor-wrapper`.
- Palette: 10 text tokens + 10 highlight tokens, plus "Default" text and "No highlight".
- Recent row: ≤ 5 entries, mixed text and highlight, newest first, frozen while the popover is open.
- Face copy: "Apply text colour: Red" / "More text colours"; "Apply highlight: Yellow" / "More highlight colours".
- Memory keys: `tinydocy-choices` (Forget clears it) and `tinydocy-ui` (outline state; survives Forget). Kill switch: `NEXT_PUBLIC_REMEMBER_CHOICES=0`.
- Targets are ≥ 24×24, and 44×44 on the phone bar and sheet. The 2 px focus outline is never clipped.
- Editor chunk ≤ +6 KB gz (6144 bytes) for all of PR D, measured against D1's recorded base. The colour palette is lazy.

**Scope boundary (not D2)**
- Out of D2:
  - the Alt+/ palette and "All actions…" (PR E): omit the entry, don't ship it disabled;
  - Repeat / Copy formatting (M7), Your formats (M14), In this doc (M12), Mermaid templates (M17b) and `tinydocy-formats` (PR E);
  - the phone selection swap and a `webkit-ios` Playwright project (PR E adds them if missing).
- Already done by D1, so not repeated here:
  - TOC jump to `block: "start"` (D1 Task 11);
  - the floating toolbar variant without `overflow-hidden` (D1 Task 6);
  - roving items filtered by `checkVisibility()` at keydown (D1 Task 6);
  - tab-switch leak and arrow p95 tests (D1 Task 10).

## Upstream interfaces

**From D1** (taken from `docs/superpowers/plans/2026-11-13-smart-toolbar-pr-d1-registry-row-slot.md`; confirm against the merged code):

| # | Name | Shape D2 relies on |
|---|---|---|
| D1-a | `Action`, `Ctx`, `ActionView`, `ContextKind`, `FontSizeValue`, `HeadingLevel` (`lib/editor-actions/types.ts`) | `Ctx` has `editor`, `state`, `kind`, `editable`, `headingLevel`, `isTitle`, `inCode`, `lazy()`. `Action.run` returns `boolean` |
| D1-b | `ACTIONS`, `getAction(id)`, `ActionId` (`lib/editor-actions/registry.ts`) | D2 appends `actions/color.ts` and `actions/memory.ts` |
| D1-c | `runAction(editor, action \| id, arg?): boolean` (`lib/editor-actions/run-action.ts`) | rechecks the live doc; `true` = dispatched |
| D1-d | `useActionView(action, editor?)`, `useSlotKind()` (`hooks/use-action-view.ts`) | per-control view |
| D1-e | `registerUiRequest(editor, kind, handler)`, `requestUi(editor, kind)` (`lib/editor-actions/ui-requests.ts`) | D2 adds the kind `"focusBubble"` |
| D1-f | `EditorActionShortcuts` `Alt-F10` → `requestUi(editor, "focusToolbar")` | D2 tries `"focusBubble"` first |
| D1-g | `ActionButton`, `ActionMenu` (`MenuOption`), `StyleMenu`, `SizeStepper`, `SIZE_TEXT`, `AlignMenu`, `ListMenu`, `InsertMenu`, `OverflowMenu`, `ContextSlot`, `SLOT_LABELS` (`components/editor-toolbar/`) | D2 adds optional props, never removes any |
| D1-h | Actions: `mark.bold/italic/underline/strike`, `link.open`, `size.set` (arg `FontSizeValue`), `style.set`, `list.set` (`"bulletList" \| "orderedList" \| "taskList" \| "none"`), `align.set`, `block.indent`, `block.outdent`, `insert.image/embed/table/quote/codeBlock/diagram/divider`, `code.setLanguage`, `CODE_LANGUAGES` | `insert.table` inserts 3×3 today |
| D1-i | Row in `components/document-editor/main-toolbar-content.tsx`: View / History / Text style / Formatting / Paragraph / slot / Insert groups. Highlight sits in Formatting | D2 replaces Highlight with A▾ ✎▾ |
| D1-j | `recordToolbarRender` Profiler sink; `tests/e2e/toolbar-leaks.spec.ts`; `scripts/check-client-js-size.ts` + `scripts/client-js-baseline.json` (`{ gzipBytes, commit }`) | D2 extends them and never re-records `gzipBytes` |

**From C** (taken from `docs/superpowers/plans/2026-11-13-smart-toolbar-pr-c-schema.md`; confirm against the merged code):

| # | Name | Used for |
|---|---|---|
| C-a | Commands `setTextColor(color: TextColorToken)` (false for anything but a token; stored mark when empty), `unsetTextColor()` (`extendEmptyMarkRange`), and `setHighlight({ color: HighlightToken })` / `unsetHighlight()` (C normalizes `color`; the key stays `color`) | colour actions |
| C-b | `TEXT_COLOR_TOKENS`, `TextColorToken` (`= HighlightToken`), `textColorTokenFromValue` (exact token only) in `lib/format-tokens.ts`; `HIGHLIGHT_TOKENS`, `HighlightToken` in `lib/highlight-tokens.ts` (PR B). Order: gray, brown, red, orange, yellow, green, teal, blue, purple, pink | validators, swatches |
| C-c | C ships **no** colour labels, so Task 3 adds `COLOR_NAMES` | swatch names |
| C-d | CSS variables `--tt-color-text-<token>` and `--tt-color-highlight-<token>` (light and dark, in `styles/_variables.scss`) | swatch fills |

**Names PR E assumes from D2** (`docs/superpowers/plans/2026-11-13-smart-toolbar-pr-e-v1-1.md`, U6/U8/U9/U11/U12). D2 adopts them so E needs no renames:
- `useRememberedChoice(spec)` returning `{ ready, last, recent, remember }`.
- `ChoiceSpec<T>` with `key`, `version`, `maxRecent`, `validate`, `fallback`.
- `readChoice` / `writeChoice` and `REMEMBER_CHOICES_ENABLED` in `lib/memory/remembered-choices.ts`.
- The bubble at `components/selection-bubble/selection-bubble.tsx`.
- `SwatchButton({ token, kind })`.
- The phone bar in `components/document-editor/mobile-toolbar-content.tsx`.
- `measureBaseline(page)` / `measureAfter(page)` in `tests/e2e/helpers/leak-metrics.ts`.

## Decisions on spec ambiguities (owner can overrule)

1. **Faces with nothing remembered** (P5): a face whose outcome is unknown opens its popover or menu instead of guessing. Examples: no last colour, an Insert face with no last kind, or the kill switch on. Its label then names the control ("Text colour", "Highlight", "Insert").
2. **Bubble out-transition.** The stock plugin removes the element synchronously on hide (`extension-bubble-menu` `hide()`), so the 90 ms out-animation runs only for hides D2 starts: Esc and the keystroke dismissal. Hides caused by a selection collapse are immediate.
3. **Tablet touch tiers** use 32 px row targets. The tier widths cannot hold 44 px cells. 44×44 applies to the phone bar and the format sheet.
4. **Size gate** (reconciles D1 Decision 13 with §7/§8). D1 gates whole-client JS, which also counts lazy chunks. D2 changes the gate to the spec's measure: the editor chunk group, found from Turbopack's loader manifest. Its baseline is measured at the same D1 base commit. Whole-client stays printed for information.
5. **Outline overlay** always starts closed. Toggles in overlay mode are not remembered. M6 applies to the docked outline only. Phones keep no outline (unchanged).
6. **Colour pick keeps the popover open** (PR A's behaviour). Esc closes it and returns focus to its trigger.
7. **Kill switch** covers `tinydocy-choices` only. It also deletes that key once on load. `tinydocy-ui` (outline) keeps working.
8. **M5 suggested level:** the level of the nearest heading before the caret, ignoring the title; 1 when there is none. The style menu and the sheet show it as a "Suggested" hint with the initial highlight. It is never applied by itself.
9. **List face label** is hidden from T3 on. The face becomes icon-only, and its accessible name is unchanged.
10. **Phone bar below 352 px** (8 × 44 does not fit) drops the slot cell. Its tools move into the format sheet.

## Review Focus

1. **Colour popover opened from the bubble by keyboard.** Focus moving into the popover must not let the stock bubble `blur` handler remove the bubble, and Esc must return focus to the bubble chevron. Task 5 e2e: "keyboard colour pick inside the bubble keeps it attached".
2. **The window narrows while a collapsing control has focus.** Example: Align left is focused at T1 and the toolbar drops to T3. Focus moves to the ¶ menu button, never `<body>`; widening again focuses the align control. Task 8 e2e: "focus follows a control into its collapsed trigger and back".
3. **Tampered, blocked or full storage.** All of these give defaults, never throw and never apply anything:
   - hostile, oversized, `__proto__` or wrong-version values;
   - `localStorage` throwing on read or on write.

   Task 2 unit "tamper" table, and Task 4 e2e "hostile stored choices are ignored".
4. **The document turns read-only while the bubble, the colour popover or the format sheet is open.** The overlays close, focus lands on the editor or a toolbar control (never `<body>`), and the phone bar hides. Task 5 e2e "read-only while the bubble popover is open" and Task 10 e2e "read-only with the sheet open".
5. **Outline at 768–949 px.** A remembered "open" never opens the overlay over the page on load. Resizing across 950 with the overlay open docks it with the remembered state and keeps focus. Task 9 e2e: "overlay never opens on load" and "crossing 950 keeps focus".

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `scripts/check-client-js-size.ts`, `scripts/client-js-baseline.json` | Editor-group gate, lazy sentinels | Modify (D1's) |
| `lib/memory/remembered-choices.ts` | Versioned local store, validation, subscribe, Forget, kill switch | Create |
| `lib/memory/choice-specs.ts` | The v1 `ChoiceSpec`s and value types | Create |
| `hooks/use-remembered-choice.ts` | `useRememberedChoice` | Create |
| `lib/editor-actions/actions/memory.ts`, `actions/color.ts` | `memory.forget`; `color.*` | Create |
| `lib/editor-actions/run-remembered.ts` | `runRemembered()` | Create |
| `lib/color-swatches.ts`, `lib/grid-navigation.ts` | Names and labels; 2-D roving | Create |
| `components/editor-toolbar/color-popover/*` | `ColorPalette` (lazy), `SwatchButton`, `ColorSplitButton`, `ColorControls` | Create |
| `components/selection-bubble/*`, `lib/editor-actions/bubble.ts` | Bubble view; visibility and placement rules | Create |
| `components/editor-toolbar/insert-menu.tsx`, `table-size-picker.tsx` | M10 face, M17a grid | Modify / Create |
| `lib/editor-actions/code-language.ts`, `section-level.ts` | M4, M5 | Create |
| `components/editor-toolbar/list-split-button.tsx` | M9 | Create |
| `components/editor-toolbar/tier.tsx`, `toolbar-tiers.scss`, `collapsed/*.tsx` | Ladder | Create |
| `components/ui/toolbar-focus-repair.ts`, `hooks/use-toolbar-focus-repair.ts` | Focus repair | Create |
| `hooks/use-outline-open.ts`, `components/document-editor/outline-panel.tsx` | M6, overlay | Create |
| `components/document-editor/mobile-toolbar-content.tsx`, `format-sheet.tsx`, `hooks/use-keyboard-inset.ts`, `lib/editor-scroll-clearance.ts`, `components/ui/sheet.tsx` | Phone bar + sheet | Rewrite / Create |
| `components/tiptap-ui/color-highlight-button/`, `color-highlight-popover/` | Replaced | Delete (Task 10) |

---

### Task 1: Editor chunk gate and lazy-chunk proof

Spec §7 ("editor chunk ≤ +6 KB gz; colour popover lazy") and §8 D ("via a new manifest size check"). See Decision 4.

**Files:**
- Modify: `scripts/check-client-js-size.ts`, `scripts/client-js-baseline.json` (adds the field `editorGzipBytes`; `gzipBytes` and `commit` are untouched)
- Test: `tests/unit/scripts/check-client-js-size.test.ts`

**Interfaces:**
- Consumes: D1-j (`totalGzipBytes`, `checkBudget`, the baseline file).
- Produces, in `check-client-js-size.ts`:
  - `export const EDITOR_SENTINEL = "Main content area, start typing to enter text."`. It is the editor's `aria-label` in `EDITOR_PROPS`, and it exists on the base commit.
  - `export const LAZY_SENTINELS: Record<string, string>` starts as `{}`. Tasks 3, 6 and 10 add `colorPalette: "data-color-palette"`, `tableSizePicker: "data-table-size-picker"` and `formatSheet: "data-format-sheet"`.
  - `export function findLoaderGroups(source: string): string[][]` returns every `Promise.all([...])` array of `"static/chunks/…"` paths in a Turbopack chunk.
  - `export function findEditorGroup(nextDir: string): string[]`:
    - reads `.next/diagnostics/route-bundle-stats.json` for route `/`;
    - scans its `firstLoadChunkPaths` for loader groups;
    - returns the absolute `.js` paths of the one group whose JS contains `EDITOR_SENTINEL`;
    - throws when zero or several groups match.
  - `export function checkLazySentinels(nextDir: string, editorGroup: readonly string[]): { name: string; inEditorGroup: boolean; foundElsewhere: boolean }[]`.
  - CLI:
    - prints whole-client, first-load and editor-group gzip totals;
    - exits 1 when `editorGzip - baseline.editorGzipBytes > 6144`, or when any lazy sentinel is in the editor group or in no chunk;
    - `--record-editor --next-dir <dir>` writes only `editorGzipBytes`.

The loader shape in the current production build (from `.next/static/chunks/3_dbiibodkqb4.js`):

```js
e.v(t=>Promise.all(["static/chunks/3w_jb3-addw2b.css","static/chunks/1m53u3txc0qxi.js","static/chunks/0-m_e72hp_ndr.js"].map(t=>e.l(t))).then(()=>t(89433)))
```

- [ ] **Step 1: Write the failing tests.** Build a fixture `.next` in `mkdtempSync(join(tmpdir(), "chunks-"))` with `diagnostics/route-bundle-stats.json`, one first-load chunk holding two loader groups, and the chunk files.

```ts
it("finds loader groups in a Turbopack chunk", () => {
  const src = `e.v(t=>Promise.all(["static/chunks/a.css","static/chunks/b.js"].map(t=>e.l(t))).then(()=>t(1))),x,e.v(t=>Promise.all(["static/chunks/c.js"].map(t=>e.l(t))).then(()=>t(2)))`;
  expect(findLoaderGroups(src)).toEqual([["static/chunks/a.css", "static/chunks/b.js"], ["static/chunks/c.js"]]);
});
it("picks the group whose JS holds the editor sentinel and drops CSS", () => {
  expect(findEditorGroup(fixture).map((p) => basename(p))).toEqual(["b.js"]);
});
it("throws when no group holds the sentinel", () => { /* fixture without it */ });
it("flags a lazy sentinel inside the editor group and one found nowhere", () => {
  // LAZY_SENTINELS-like input { palette: "data-color-palette" } written into b.js -> inEditorGroup true
  // { ghost: "data-nothing" } -> foundElsewhere false
});
it("gates at baseline + 6144", () => {
  expect(checkBudget(1000 + 6144, 1000, 6144).ok).toBe(true);
  expect(checkBudget(1000 + 6145, 1000, 6144).ok).toBe(false);
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `bun test tests/unit/scripts/check-client-js-size.test.ts`
Expected: FAIL. `findLoaderGroups` is not exported.

- [ ] **Step 3: Implement**, then record the editor baseline at **D1's recorded commit**. That is the `commit` field already in the file, so this is not a re-record.

```bash
BASE=$(bun -e 'console.log((await Bun.file("scripts/client-js-baseline.json").json()).commit)')
git worktree add "$TMPDIR/tinydocy-d-base" "$BASE" && (cd "$TMPDIR/tinydocy-d-base" && bun install --frozen-lockfile && bun run build)
bun scripts/check-client-js-size.ts --record-editor --next-dir "$TMPDIR/tinydocy-d-base/.next"
git worktree remove "$TMPDIR/tinydocy-d-base"
```

- [ ] **Step 4: Run the tests and the gate on this branch**

Run: `bun test tests/unit/scripts && bun run build && bun run size:check`
Expected: PASS. The printed editor delta is D1's share. If D1 alone already exceeds 6144, stop and report the numbers.

- [ ] **Step 5: Commit** after approval (with the CHANGELOG bullet: "size gate measures the editor chunk and proves lazy chunks stay out of it")

```bash
git add scripts tests/unit/scripts CHANGELOG.md
git commit -m "ci: gate the editor chunk from the Turbopack loader manifest"
```

---

### Task 2: Memory store, `useRememberedChoice` and "Forget my choices"

Spec §5 (rules, keys, store, kill switch, only a successful `run()` writes) and §7 (memory tamper test).

**Files:**
- Create: `lib/memory/remembered-choices.ts`, `lib/memory/choice-specs.ts`, `hooks/use-remembered-choice.ts`, `lib/editor-actions/run-remembered.ts`, `lib/editor-actions/actions/memory.ts`
- Modify: `lib/editor-actions/registry.ts` (append the memory actions), `components/editor-toolbar/overflow-menu.tsx` (separator + "Forget my choices" item), `README.md` (configuration table: `NEXT_PUBLIC_REMEMBER_CHOICES`), `CHANGELOG.md`
- Test: `tests/unit/lib/memory/remembered-choices.test.ts`, `tests/unit/hooks/use-remembered-choice.test.tsx`

**Interfaces:**
- Produces, in `remembered-choices.ts`:

```ts
export const CHOICES_KEY = "tinydocy-choices";
export const UI_KEY = "tinydocy-ui";
export const RECORD_VERSION = 1;
export const MAX_RECORD_CHARS = 4096;          // a longer raw value is discarded
export const REMEMBER_CHOICES_ENABLED: boolean; // process.env.NEXT_PUBLIC_REMEMBER_CHOICES?.trim() !== "0"
export interface ChoiceSpec<T extends string> {
  key: string;               // field in the record, e.g. "color.text"
  version: number;           // per-field; a stored field with another version is ignored
  maxRecent: number;         // 0 = last only
  validate: (value: unknown) => value is T;
  fallback: T | null;
  storage?: "choices" | "ui"; // default "choices"
}
export interface ChoiceState<T extends string> { readonly last: T | null; readonly recent: readonly T[] }
export function readChoice<T extends string>(spec: ChoiceSpec<T>): ChoiceState<T>; // stable object per record change
export function writeChoice<T extends string>(spec: ChoiceSpec<T>, value: T): void;
export function subscribeChoices(storage: "choices" | "ui", listener: () => void): () => void;
export function forgetChoices(): void;          // removes CHOICES_KEY only, notifies "choices" listeners
```

- The stored record is `{ "v": 1, "c": { "<key>": { "v": <spec.version>, "l"?: string, "r"?: string[] } } }`.
- Reading is a parse that never throws:
  - `try` around `getItem` and `JSON.parse`;
  - a wrong record `v` → the key is removed and the record is empty;
  - the record and `c` must be plain objects;
  - fields are read with `Object.hasOwn` only;
  - `last` and every `recent` entry pass `validate`;
  - `recent` is deduped and cut to `maxRecent`.
- `readChoice` returns `{ last: null, recent: [] }` for an invalid field; the hook applies `fallback`.
- Writing is read-modify-write of the whole record:
  - `last = value`;
  - `recent = [value, ...recent without value].slice(0, maxRecent)`;
  - `try` around `setItem` (`QuotaExceededError`, `SecurityError`);
  - then notify that storage's listeners;
  - the parsed record is cached per storage and invalidated by write, forget and the window `storage` event (one listener, added on the first subscribe and removed on the last).
- Kill switch: with `REMEMBER_CHOICES_ENABLED` false, `"choices"` reads return empty, writes are no-ops, and the first access removes `CHOICES_KEY` once. `"ui"` is unaffected (Decision 7).
- Produces, in `choice-specs.ts`:
  - `TEXT_COLOR_CHOICE` (`"color.text"`, validate `textColorTokenFromValue(v) === v`, fallback `null`);
  - `HIGHLIGHT_CHOICE` (`"color.highlight"`, validate `HIGHLIGHT_TOKENS.includes(v)`: bare tokens only, never `var(...)`, unlike `highlightTokenFromValue`);
  - `RECENT_COLORS_CHOICE` (`"color.recent"`, `maxRecent: 5`, values `` RecentColor = `text:${TextColorToken}` | `highlight:${HighlightToken}` ``), with `isRecentColor` and `parseRecentColor(v: RecentColor): { kind: ColorKind; token: string }`;
  - `CODE_LANGUAGE_CHOICE` (`"code.language"`): valid when the value is in D1's `CODE_LANGUAGES` and is not `mermaid`;
  - `LIST_TYPE_CHOICE` (`"list.type"`, `ListType = "bulletList" | "orderedList" | "taskList"`, fallback `"bulletList"`);
  - `INSERT_KIND_CHOICE` (`"insert.kind"`, `INSERT_KINDS = ["image","embed","table","quote","codeBlock","diagram","divider"] as const`, fallback `null`);
  - `TABLE_SIZE_CHOICE` (`"table.size"`, `/^(10|[1-9])x(10|[1-9])$/`, fallback `"3x3"`), with `parseTableSize(v): { rows: number; cols: number }`;
  - `OUTLINE_OPEN_CHOICE` (`storage: "ui"`, `"outline.open"`, `"open" | "closed"`, fallback `"open"`);
  - `export type ColorKind = "text" | "highlight"`.
  - Every spec has `version: 1`.
- Produces, in `hooks/use-remembered-choice.ts`: `useRememberedChoice<T extends string>(spec: ChoiceSpec<T>): { ready: boolean; last: T | null; recent: readonly T[]; remember: (value: T) => void }`.
  - It uses `useSyncExternalStore(subscribe, () => readChoice(spec), () => EMPTY_STATE)` plus a `useEffect` ready flag.
  - Until ready, it returns `last = spec.fallback` and `recent = []`. After ready, `last = stored ?? spec.fallback`.
- Produces, in `run-remembered.ts`: `runRemembered(editor: Editor, action: Action | ActionId, arg: unknown, onSuccess: () => void): boolean`. It calls `runAction` and runs `onSuccess` only when that returns `true`.
- Produces, in `actions/memory.ts`: `memory.forget`.
  - label "Forget my choices", group `"overflow"`, contexts `"any"`;
  - `enabled` returns `{ reason: "Remembering choices is turned off" }` when the switch is off, else `true`;
  - `run` calls `forgetChoices()` and returns `true`;
  - D1's central read-only rule applies as for every action.

- [ ] **Step 1: Write the failing tests**

```ts
// remembered-choices.test.ts; load via importFresh("@/lib/memory/remembered-choices") per test
it("remembers last and recent, newest first, deduped, capped", () => {
  for (const c of ["text:red", "highlight:yellow", "text:red", "text:blue", "text:green", "text:gray", "text:pink"])
    writeChoice(RECENT_COLORS_CHOICE, c);
  expect(readChoice(RECENT_COLORS_CHOICE).recent).toEqual(["text:pink", "text:gray", "text:green", "text:blue", "text:red"]);
});
it.each([
  ["not JSON", "{oops"],
  ["wrong record version", JSON.stringify({ v: 2, c: { "color.text": { v: 1, l: "red" } } })],
  ["wrong field version", JSON.stringify({ v: 1, c: { "color.text": { v: 9, l: "red" } } })],
  ["hostile token", JSON.stringify({ v: 1, c: { "color.text": { v: 1, l: "red;background:url(x)" } } })],
  ["legacy CSS var", JSON.stringify({ v: 1, c: { "color.highlight": { v: 1, l: "var(--tt-color-highlight-red)" } } })],
  ["non-string", JSON.stringify({ v: 1, c: { "color.text": { v: 1, l: { toString: 1 } } } })],
  ["oversized", JSON.stringify({ v: 1, c: { pad: "x".repeat(5000) } })],
])("tamper: %s reads as nothing remembered", (_name, raw) => {
  localStorage.setItem(CHOICES_KEY, raw);
  expect(readChoice(TEXT_COLOR_CHOICE)).toEqual({ last: null, recent: [] });
  expect(readChoice(HIGHLIGHT_CHOICE).last).toBeNull();
});
it("ignores __proto__ and never pollutes Object.prototype", () => {
  localStorage.setItem(CHOICES_KEY, '{"v":1,"c":{"__proto__":{"v":1,"l":"red"}}}');
  readChoice(TEXT_COLOR_CHOICE); writeChoice(TEXT_COLOR_CHOICE, "red");
  expect(({} as Record<string, unknown>).l).toBeUndefined();
});
it("filters a recent list of 100 entries down to 5 valid ones", () => {});
it("survives storage that throws on read and on write", () => {
  // spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("x", "SecurityError") })
  // spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("x", "QuotaExceededError") })
  expect(() => writeChoice(TEXT_COLOR_CHOICE, "red")).not.toThrow();
  expect(readChoice(TEXT_COLOR_CHOICE).last).toBeNull();
});
it("forgetChoices clears tinydocy-choices and keeps tinydocy-ui", () => {});
it("kill switch reads nothing, writes nothing and wipes the key once", async () => {
  localStorage.setItem(CHOICES_KEY, JSON.stringify({ v: 1, c: { "color.text": { v: 1, l: "red" } } }));
  process.env.NEXT_PUBLIC_REMEMBER_CHOICES = "0";
  const m = await importFresh<typeof import("@/lib/memory/remembered-choices")>("@/lib/memory/remembered-choices");
  expect(m.readChoice(TEXT_COLOR_CHOICE).last).toBeNull();
  m.writeChoice(TEXT_COLOR_CHOICE, "blue");
  expect(localStorage.getItem(CHOICES_KEY)).toBeNull();
  m.writeChoice(OUTLINE_OPEN_CHOICE, "closed");
  expect(m.readChoice(OUTLINE_OPEN_CHOICE).last).toBe("closed");
});
it("notifies subscribers of the same storage on write and forget, not the other", () => {});
it("never imports yjs, analytics or network code", async () => {
  const src = await Bun.file("lib/memory/remembered-choices.ts").text();
  expect(src).not.toMatch(/from "yjs"|analytics|fetch\(|sendBeacon/);
});
```

```tsx
// use-remembered-choice.test.tsx (createRoot + act, as in tests/unit/hooks/use-synced-tabs.test.ts)
it("returns the fallback before ready, then the stored value", () => {});
it("remember() in one component updates another reading the same spec", () => {});
it("forgetChoices() resets both to the fallback", () => {});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `bun test tests/unit/lib/memory tests/unit/hooks/use-remembered-choice.test.tsx`
Expected: FAIL. The modules are missing.

- [ ] **Step 3: Implement** as the Interfaces block says. Add the "Forget my choices" item to `OverflowMenu`, after a separator, as a plain `DropdownMenuItem` running `memory.forget`. Add the README row: `NEXT_PUBLIC_REMEMBER_CHOICES` (build time; `0` stops remembering toolbar choices and deletes them on load; default on).

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `bun run test && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit** after approval

```bash
git add lib/memory hooks/use-remembered-choice.ts lib/editor-actions components/editor-toolbar/overflow-menu.tsx README.md CHANGELOG.md tests/unit
git commit -m "feat(toolbar): remember toolbar choices locally, with Forget my choices"
```

---

### Task 3: Colour actions and the lazy palette with Recent (M3)

Spec §4.5 (sections, recent row, named `aria-pressed` swatches in a 2-D roving grid inside `role="dialog"`, check glyph, forced-colours border), §3 (tokens, inclusive marks) and §7 (palette lazy).

**Files:**
- Create: `lib/editor-actions/actions/color.ts`, `lib/color-swatches.ts`, `lib/grid-navigation.ts`, `components/editor-toolbar/color-popover/color-palette.tsx`, `swatch-button.tsx`, `lazy-color-palette.tsx`, `color-palette.scss`
- Modify: `lib/editor-actions/registry.ts`, `components/ui/popover.tsx` (`PopoverContent` takes `container?: PopoverPrimitive.Portal.Props["container"]` and passes it to `Portal`), `scripts/check-client-js-size.ts` (`LAZY_SENTINELS.colorPalette = "data-color-palette"`), `CHANGELOG.md`
- Test: `tests/unit/lib/grid-navigation.test.ts`, `tests/unit/lib/color-swatches.test.ts`, `tests/unit/editor-actions/color-actions.test.ts`

**Interfaces:**
- Consumes: C-a…C-d, `runRemembered`, `TEXT_COLOR_CHOICE`, `HIGHLIGHT_CHOICE`, `RECENT_COLORS_CHOICE`, `parseRecentColor`, `ColorKind` (Task 2), `useActionView`, `getAction` (D1).
- Produces, the actions (one transaction each; they set, never toggle):

| id | arg | label | reasons | run |
|---|---|---|---|---|
| `color.text.apply` | `TextColorToken` | Text colour | in code: "Code has no formatting"; no `textColor` mark: "Not available in this version" | `setTextColor(color)` (stored mark when empty) |
| `color.text.clear` | — | Default text colour | same | `unsetTextColor()` |
| `color.highlight.apply` | `HighlightToken` | Highlight | same, mark `highlight` | `setHighlight({ color })`, only for a `HIGHLIGHT_TOKENS` value |
| `color.highlight.clear` | — | No highlight | same | `unsetHighlight()` |

  - `value(ctx)` comes from `selectionTokens(ctx.state, markName)` through `ctx.lazy`. It is the token when the whole selection shares one, `"mixed"` for several, and `null` for none.
  - A `run` with an invalid token returns `false`.
- Produces, in `color-swatches.ts`:
  - `COLOR_NAMES: Readonly<Record<TextColorToken, string>>` ("Gray" … "Pink") and `colorName(token): string`;
  - `swatchLabel(kind: ColorKind, token: string | null): string` → "Red text", "Red highlight", "Default text colour", "No highlight";
  - `recentColor(kind, token): RecentColor`;
  - `selectionTokens(state: EditorState, markName: "textColor" | "highlight"): ReadonlySet<string | null>`, which stops after 2 distinct values.
- Produces, in `grid-navigation.ts`:
  - `export interface GridPos { row: number; col: number }`;
  - `export function nextGridPosition(rowLengths: readonly number[], pos: GridPos, key: string, ctrlKey: boolean): GridPos | null`.
  - Right and Left wrap across row ends. Up and Down keep the column, clamped to the target row. Home and End move within the row; Ctrl+Home and Ctrl+End move within the grid. The grid edges stay put. Other keys return `null`.
- Produces, `SwatchButton({ kind, token, pressed, disabledReason, size, onApply }: { kind: ColorKind; token: string | null; pressed: boolean; disabledReason: string | null; size: "popover" | "sheet"; onApply: () => void })`:
  - a `<button>` with `aria-pressed`, `aria-label` = `swatchLabel`, `data-swatch="<kind>:<token|none>"`;
  - a 24×24 popover size or a 44×44 sheet size;
  - the fill comes from C-d; a check glyph shows when pressed;
  - in forced colours: `forced-color-adjust: none` on the fill, and a `1px solid CanvasText` border.
- Produces, `ColorPalette({ editor, initialSection, layout }: { editor: Editor; initialSection: ColorKind; layout: "popover" | "sheet" })`:
  - **Root:** `<div data-color-palette data-roving-group>`.
  - **Sections:** Recent (only when non-empty), Text, Highlight. Each is a `role="group"` labelled by its visible heading.
  - **Grid:** 6 columns, so `rowLengths` is `[recent.length?, 6, 5, 6, 5]`. There is one tab stop, and arrows move focus through `nextGridPosition` without applying.
  - **Apply:** Enter, Space or a click applies through `runRemembered`. A text or highlight apply records the kind's last (M1/M2) and `recentColor` (M3); clears record nothing. After applying, `requestAnimationFrame` refocuses the swatch (PR A pattern).
  - **Recent row:** keeps the first `ready` value of `recent` in a ref for the palette's lifetime (frozen while open).
  - **Initial focus:** the pressed swatch in `initialSection`, else that section's first swatch.
- Produces, in `lazy-color-palette.tsx`:
  - `LazyColorPalette` = `lazy(() => import("./color-palette").then((m) => ({ default: m.ColorPalette })))`, wrapped in `Suspense` with a fixed-size fallback;
  - `preloadColorPalette(): void` warms the import.

- [ ] **Step 1: Write the failing tests**

```ts
// grid-navigation.test.ts, rows [3, 6, 5, 6, 5]
const R = [3, 6, 5, 6, 5];
it.each([
  [{ row: 0, col: 2 }, "ArrowRight", false, { row: 1, col: 0 }],
  [{ row: 1, col: 0 }, "ArrowLeft", false, { row: 0, col: 2 }],
  [{ row: 0, col: 2 }, "ArrowDown", false, { row: 1, col: 2 }],
  [{ row: 1, col: 5 }, "ArrowUp", false, { row: 0, col: 2 }],
  [{ row: 1, col: 5 }, "ArrowDown", false, { row: 2, col: 4 }],
  [{ row: 2, col: 3 }, "Home", false, { row: 2, col: 0 }],
  [{ row: 2, col: 0 }, "End", false, { row: 2, col: 4 }],
  [{ row: 3, col: 3 }, "Home", true, { row: 0, col: 0 }],
  [{ row: 0, col: 0 }, "End", true, { row: 4, col: 4 }],
  [{ row: 4, col: 4 }, "ArrowRight", false, { row: 4, col: 4 }],
  [{ row: 4, col: 2 }, "ArrowDown", false, { row: 4, col: 2 }],
])("%o %s ctrl=%s -> %o", (pos, key, ctrl, expected) => expect(nextGridPosition(R, pos, key, ctrl)).toEqual(expected));
it("ignores other keys", () => expect(nextGridPosition(R, { row: 0, col: 0 }, "Enter", false)).toBeNull());

// color-swatches.test.ts
it("names swatches", () => {
  expect(swatchLabel("text", "red")).toBe("Red text");
  expect(swatchLabel("highlight", null)).toBe("No highlight");
  expect(swatchLabel("text", null)).toBe("Default text colour");
});
it("has 10 named tokens per kind", () => {});

// color-actions.test.ts (createTestEditor with C's marks)
it("color.text.apply sets red on the selection; applying red again keeps it (sets, not toggles)", () => {});
it("color.text.apply with an empty selection stores the mark for the next characters", () => {});
it("color.highlight.apply writes the token under attribute key color", () => {
  // doc JSON mark: { type: "highlight", attrs: { color: "yellow" } }
});
it("value is 'mixed' across red and blue and null on plain text", () => {});
it("is disabled in a code block with 'Code has no formatting'", () => {});
it("refuses an invalid token", () => expect(runAction(editor, "color.text.apply", "red;x")).toBe(false));
it("clear removes the mark and is one undo step", () => {});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `bun test tests/unit/lib/grid-navigation.test.ts tests/unit/lib/color-swatches.test.ts tests/unit/editor-actions/color-actions.test.ts`
Expected: FAIL. The modules are missing.

- [ ] **Step 3: Implement** as the Interfaces block says.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `bun run test && bun run typecheck && bun biome check lib components`
Expected: PASS. The palette's UI is exercised end to end in Task 4.

- [ ] **Step 5: Commit** after approval

```bash
git add lib/editor-actions lib/color-swatches.ts lib/grid-navigation.ts components/editor-toolbar/color-popover components/ui/popover.tsx scripts/check-client-js-size.ts CHANGELOG.md tests/unit
git commit -m "feat(toolbar): add colour actions and a lazy colour palette with recent colours"
```

---

### Task 4: Text and highlight split buttons with remembered faces (M1, M2)

Spec §4.5 (one popover, two split triggers, each face reapplies its own last colour), §5 P5 (Decision 1), §6.3 and §6.7 (24×24 chevrons).

**Files:**
- Create: `components/editor-toolbar/color-popover/color-split-button.tsx`, `color-controls.tsx`
- Modify: `components/document-editor/main-toolbar-content.tsx` (Formatting group: Bold, Italic, Underline, Strike, `ColorControls`, Link; PR A's highlight popover leaves the desktop row), `tests/e2e/toolbar-row.spec.ts` (`EXPECTED_ROW`: "Highlight" becomes the four colour names), `tests/e2e/toolbar-keyboard.spec.ts` ("every toolbar menu opens by mouse": Highlight → "More text colours"), `CHANGELOG.md`
- Test: `tests/e2e/color-popover.spec.ts`

**Interfaces:**
- Consumes: Task 3 (`LazyColorPalette`, `preloadColorPalette`, actions, `colorName`), Task 2 (`useRememberedChoice`, `runRemembered`, specs).
- Produces, `ColorSplitButton({ kind, editor, portalContainer }: { kind: ColorKind; editor?: Editor | null; portalContainer?: HTMLElement | null })`. It renders two roving buttons in a `ToolbarGroup` with `aria-label` "Text colour" or "Highlight".
  - **Face with memory (M1/M2):**
    - `aria-label` "Apply text colour: Red" or "Apply highlight: Yellow", with the same tooltip;
    - the glyph is the text icon or the highlighter icon over a 3 px bar in the token colour;
    - a click runs `runRemembered(…apply, last)` and records the recent entry.
  - **Face without memory, or with the kill switch on:**
    - `aria-label` "Text colour" or "Highlight", with `aria-haspopup="dialog"`;
    - a click opens the popover.
  - **Chevron:**
    - `aria-label` "More text colours" or "More highlight colours", with `aria-haspopup="dialog"` and `aria-expanded`;
    - its hit area is ≥ 24×24;
    - `onPointerEnter` and `onFocus` call `preloadColorPalette()`.
  - **Disabled:** both buttons take the apply action's view reason.
  - **Popover:**
    - a controlled Base UI `Popover` anchored to the chevron, with content `PopoverContent container={portalContainer} aria-label="Text and highlight colours" data-toolbar-popup`;
    - the content is `LazyColorPalette initialSection={kind} layout="popover"`;
    - Esc closes it and returns focus to the button that opened it.
- Produces, `ColorControls({ editor, portalContainer })`: the text and highlight `ColorSplitButton`s. Task 8 adds the collapsed single button.

- [ ] **Step 1: Write the failing e2e tests** (`color-popover.spec.ts`; select words through `window.__tiptap_editor`)

```ts
test("palette lists Default + 10 text and No highlight + 10 highlight swatches, named", async ({ page }) => {
  // open "More text colours"; dialog "Text and highlight colours"; group "Text" has 11 buttons incl. "Red text";
  // group "Highlight" has 11 incl. "No highlight"; no Recent group on a fresh profile
});
test("text face without memory opens the popover instead of guessing", async ({ page }) => {
  // face named "Text colour", aria-haspopup=dialog; click -> dialog visible; doc unchanged
});
test("picking a colour makes the face reapply it in one click", async ({ page }) => {
  // select "alpha", More text colours -> "Red text"; Esc; face is "Apply text colour: Red"
  // select "beta"; click face -> beta's span has data-text-color="red"; one undo removes it
});
test("highlight face is independent of the text face", async ({ page }) => {});
test("arrow keys move focus without applying; Enter applies; Esc returns to the chevron", async ({ page }) => {
  // doc JSON identical after ArrowRight x3 + ArrowDown; Enter -> mark applied; Esc -> focus on "More text colours"
});
test("recent row: newest first, mixed kinds, at most 5, frozen while open", async ({ page }) => {
  // apply red, highlight yellow, blue, green, gray, pink (6 picks, reopening each time)
  // reopen: Recent = Pink text, Gray text, Green text, Blue text, Yellow highlight
  // while open apply "Teal text": Recent unchanged; close + reopen: Teal text first
});
test("hostile stored choices are ignored", async ({ page }) => {
  // addInitScript: localStorage tinydocy-choices = {"v":1,"c":{"color.text":{"v":1,"l":"red;background:url(x)"},
  //   "color.recent":{"v":1,"r":["text:red\" onload=x","highlight:nope"]}}}
  // face "Text colour"; no Recent group; no console errors
});
test("Forget my choices resets the faces and the recent row", async ({ page }) => {
  // pick red; More formatting > Forget my choices; face back to "Text colour"; reload: still forgotten
});
test("the palette chunk is not loaded before the first open", async ({ page }) => {
  expect(await page.locator("[data-color-palette]").count()).toBe(0);
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `E2E_BASE_URL=http://localhost:3800 CI= bun playwright test tests/e2e/color-popover.spec.ts --project=chromium`
Expected: FAIL. There is no "More text colours" button.

- [ ] **Step 3: Implement**, and wire `ColorControls` into the Formatting group. Leave `MobileToolbarContent`'s highlighter panel alone; Task 10 replaces it.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `E2E_BASE_URL=http://localhost:3800 CI= bun playwright test tests/e2e/color-popover.spec.ts tests/e2e/toolbar-row.spec.ts tests/e2e/toolbar-keyboard.spec.ts tests/e2e/toolbar-a11y.spec.ts --project=chromium`
Expected: PASS. Check by eye in the browser pane at 1280 px, light and dark: faces, chevrons, the palette and the pressed check.

- [ ] **Step 5: Commit** after approval

```bash
git add components tests/e2e CHANGELOG.md
git commit -m "feat(toolbar): add text and highlight split buttons that reapply the last colour"
```

---

### Task 5: Selection bubble (desktop)

Spec §4.3, §6 "Plus:" (Alt+F10 to the bubble; Esc returns with the selection) and the PR A carry-over (the floating variant must not clip the 2 px outline). E's U8 path.

**Files:**
- Run: `bun add @tiptap/extension-bubble-menu@3.33.1` (it is a peer of `@tiptap/react/menus`, installed today only transitively)
- Create: `lib/editor-actions/bubble.ts`, `components/selection-bubble/selection-bubble.tsx`, `components/selection-bubble/selection-bubble.scss`, `components/selection-bubble/index.ts`, `hooks/use-coarse-pointer.ts`, `tests/e2e/helpers/outline-clip.ts`
- Modify:
  - `components/document-editor/document-editor.tsx`:
    - `.document-editor-wrapper` gets a callback ref into state (`const [wrapperEl, setWrapperEl] = useState<HTMLElement | null>(null)`). The plugin reads `scrollTarget` and `appendTo` once, in its constructor. A null target would put its scroll listeners on `window` and append the bubble to `.document-editor-content`, which has `overflow: hidden` and would clip it;
    - mount `<SelectionBubble editor={editor} scrollTarget={wrapperEl}>` once per editor, only when `wrapperEl !== null && !isMobile && !coarse && !toolbarOff`;
    - wrap it in its own `<Profiler id="bubble" onRender={recordToolbarRender}>`, so the perf "toolbar off" run also unmounts it;
  - `extensions/editor-action-shortcuts/editor-action-shortcuts.ts`: `"Alt-F10": () => requestUi(this.editor, "focusBubble") || requestUi(this.editor, "focusToolbar")`;
  - `lib/editor-actions/ui-requests.ts`: `UiRequest` gains `"focusBubble"`;
  - `CHANGELOG.md`.
- Test: `tests/unit/editor-actions/bubble.test.ts`, `tests/e2e/selection-bubble.spec.ts`

**Interfaces:**
- Produces, in `bubble.ts`:
  - `export const BUBBLE_ACTION_IDS = ["mark.bold", "mark.italic", "mark.underline", "color.text.apply", "link.open"] as const`.
  - `export function shouldShowBubble(view: Pick<EditorView, "state" | "hasFocus" | "editable">, element: HTMLElement, suppressed: boolean): boolean`. The checks run in this order:
    1. `selection.empty` → false, before reading anything else;
    2. `!view.editable`;
    3. `suppressed`;
    4. neither `view.hasFocus()` nor `element.contains(document.activeElement)`;
    5. a `NodeSelection`;
    6. a `codeBlock` ancestor (code and mermaid);
    7. both ends inside one `hyperlink` mark range;
    8. otherwise true.
  - `export function isBubbleDismissKey(event: KeyboardEvent): boolean`. It is true for Escape, and for keys that are not modifiers, not Arrow, Home, End or PageUp/PageDown, and pressed without Ctrl or Meta.
  - `export function chooseBubblePlacement(a: { selection: Rect; bubble: { width: number; height: number }; obstacles: readonly Rect[]; topLimit: number }): "top" | "bottom"`, where `Rect = { top; bottom; left; right }`.
    - The band above is `[selection.top - 8 - height, selection.top]`, centred on the selection with the bubble's width.
    - It returns `"bottom"` when the band starts above `topLimit` (the toolbar's bottom), or when any obstacle (remote `.collaboration-carets__label` rects) intersects the band. Otherwise it returns `"top"`.
- Produces, `SelectionBubble({ editor, scrollTarget }: { editor: Editor; scrollTarget: HTMLElement })`. `scrollTarget` is never null:
  - **Mount:** a `BubbleMenu` from `@tiptap/react/menus` with `pluginKey` `"selectionBubble"` and `appendTo={() => scrollTarget}`.
  - **Options:**
    - `scrollTarget`;
    - `placement` from state (default `"top"`);
    - `offset: 8`;
    - `flip: false`, because D2 decides the side;
    - `shift: { padding: 8 }`;
    - `hide: true`;
    - `onShow` and `onUpdate` recompute the placement and set state only when it changes.
  - **Stable props:** every prop other than `options.placement` is stable (module constants or refs). `shouldShow` reads a `suppressedRef`.
  - **Root:** `<Toolbar variant="floating" aria-label="Selection formatting" data-selection-bubble onEscape={…}>`. Items in order: Bold, Italic, Underline (`ActionButton`), separator, `ColorSplitButton kind="text" portalContainer={rootRef.current}`, separator, Link (`ActionButton` over `link.open`).
  - **One `keydown` listener on `editor.view.dom`**, removed on unmount, handles `isBubbleDismissKey`. It does nothing unless the bubble root is connected (shown). Typing with no bubble must dispatch nothing extra, because of the typing p95 budget:
    - for Escape while the bubble shows: set `data-closing` on the inner panel, then after 90 ms dispatch the meta `"hide"` and set suppressed;
    - for other keys: set suppressed and dispatch `"hide"` at once.
    - Suppression clears on the next selection change that the keystroke did not cause (`mouseup`, or Shift+Arrow).
  - **Esc on a bubble item** (`onEscape`): `editor.commands.focus()`, which keeps the selection, then the Escape path above.
  - **`registerUiRequest(editor, "focusBubble", …)`** focuses the first enabled bubble item when `[data-selection-bubble]` is connected, and returns false otherwise.
  - **Animation:** the panel animates in with a 140 ms opacity + 4 px rise. `[data-closing]` runs a 90 ms opacity fade. Under `prefers-reduced-motion: reduce`, both are opacity only. Both are keyframes on the inner panel, because `show()` sets inline `opacity: 1` on the root.
  - **Layering:** `z-index` stays below the sticky toolbar, so the bubble slides under it while scrolling.
- Produces, `useCoarsePointer(): boolean` (matchMedia `(pointer: coarse)`, ready flag, `change` listener).
- Produces, `expectOutlineNotClipped(button: Locator): Promise<void>`. It inflates the button's rect by `outline-width + outline-offset` and asserts that the result lies inside the client rect of every ancestor whose computed `overflow` is not `visible`, up to `body`.

- [ ] **Step 1: Write the failing tests**

```ts
// bubble.test.ts
it("checks emptiness before anything else", () => {
  const view = { state: emptySelectionState, get editable(): boolean { throw new Error("read") }, hasFocus: () => { throw new Error("read") } };
  expect(shouldShowBubble(view, document.createElement("div"), false)).toBe(false);
});
it.each([
  ["text range, focused", true], ["read-only", false], ["suppressed", false], ["not focused", false],
  ["image NodeSelection", false], ["inside a code block", false], ["inside one hyperlink", false],
  ["across a hyperlink and plain text", true],
])("%s -> %s", (_case, expected) => { /* createTestEditor state per case */ });
it.each([
  ["Escape", {}, true], ["a", {}, true], ["Backspace", {}, true], ["ArrowRight", { shiftKey: true }, false],
  ["Shift", {}, false], ["b", { metaKey: true }, false], ["Home", {}, false],
])("dismiss key %s %o -> %s", (key, mods, expected) => expect(isBubbleDismissKey(new KeyboardEvent("keydown", { key, ...mods }))).toBe(expected));
const sel = { top: 300, bottom: 320, left: 100, right: 200 };
const bubble = { width: 160, height: 36 };
it("places above by default", () => expect(chooseBubblePlacement({ selection: sel, bubble, obstacles: [], topLimit: 52 })).toBe("top"));
it("flips below under the sticky toolbar", () => expect(chooseBubblePlacement({ selection: sel, bubble, obstacles: [], topLimit: 280 })).toBe("bottom"));
it("flips below a remote caret label in the band", () =>
  expect(chooseBubblePlacement({ selection: sel, bubble, obstacles: [{ top: 270, bottom: 288, left: 120, right: 180 }], topLimit: 52 })).toBe("bottom"));
it("ignores a label elsewhere on the line", () =>
  expect(chooseBubblePlacement({ selection: sel, bubble, obstacles: [{ top: 270, bottom: 288, left: 600, right: 650 }], topLimit: 52 })).toBe("top"));
```

```ts
// selection-bubble.spec.ts (desktop 1280x720)
test("shows B, I, U, text colour and link for a mouse selection", async ({ page }) => {
  // drag-select a word; [data-selection-bubble] named "Selection formatting" with items, in order:
  // Bold, Italic, Underline, (Text colour | Apply text colour: …), More text colours, Link
});
test("stays hidden for an empty selection, an image, a code block, a link, and read-only", async ({ page }) => {});
test("typing hides it; Shift+ArrowRight keeps it; Esc fades it out", async ({ page }) => {
  // Esc: still attached at +30 ms with data-closing, gone at +200 ms
});
test("Alt+F10 focuses the bubble; Esc returns to the editor with the same selection", async ({ page }) => {
  // selection {from,to} before === after; Alt+F10 without a bubble focuses the row (D1 behaviour)
});
test("keyboard colour pick inside the bubble keeps it attached", async ({ page }) => {
  // Alt+F10, arrow to "More text colours", Enter, ArrowRight, Enter
  // [data-selection-bubble] still connected; the selection text has data-text-color; Esc -> focus on the bubble chevron
});
test("bubble-in-row matrix", async ({ page }) => {
  // for each id in BUBBLE_ACTION_IDS: the row has [data-action-id] / named control visible at 1280px;
  // running Bold, Italic, Underline and the text-colour face from the bubble and from the row on the same
  // selection (undo in between) gives identical doc JSON; Link opens the hyperlink popover from both
});
test("bubble buttons keep their 2px outline", async ({ page }) => {
  // focus each item via Alt+F10 + arrows; expectOutlineNotClipped(item)
});
test("flips below when the selection sits just under the toolbar", async ({ page }) => {
  // scroll so the selected line is 10px under the toolbar; bubble top >= selection bottom
});
test("no bubble on a coarse pointer", async ({ browser }) => {
  // newContext({ hasTouch: true, isMobile: true, viewport: { width: 1024, height: 768 } }); coarse === true; select -> none
});
test("read-only while the bubble popover is open", async ({ page }) => {
  // open the colour popover from the bubble; __tiptap_editor.setEditable(false)
  // bubble and dialog gone; document.activeElement !== document.body
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `bun test tests/unit/editor-actions/bubble.test.ts && E2E_BASE_URL=http://localhost:3800 CI= bun playwright test tests/e2e/selection-bubble.spec.ts --project=chromium`
Expected: FAIL. The module is missing, and there is no bubble.

- [ ] **Step 3: Implement** as the Interfaces block says. The popover's portal container is the bubble root, so the stock `blurHandler` sees `relatedTarget` inside `element.parentNode` and keeps the bubble. Confirm that the remote caret label class is `collaboration-carets__label` in `@tiptap/extension-collaboration-caret`.

- [ ] **Step 4: Run the tests and confirm they pass**, plus D1's keyboard spec

Run: `bun run test && E2E_BASE_URL=http://localhost:3800 CI= bun playwright test tests/e2e/selection-bubble.spec.ts tests/e2e/toolbar-keyboard.spec.ts --project=chromium --repeat-each=3`
Expected: PASS on every repeat. Screenshot the bubble above and below a selection, light and dark, and with the popover open.

- [ ] **Step 5: Commit** after approval

```bash
git add package.json bun.lock lib/editor-actions extensions/editor-action-shortcuts components/selection-bubble components/document-editor/document-editor.tsx hooks/use-coarse-pointer.ts tests CHANGELOG.md
git commit -m "feat(editor): add the desktop selection bubble"
```

---

### Task 6: Insert face (M10), table size grid (M17a) and code language default (M4)

Spec §4.1 (Insert contents incl. table), §5 M4, M10, M17a.

**Files:**
- Create: `components/editor-toolbar/table-size-picker.tsx` (lazy; root `data-table-size-picker`), `components/editor-toolbar/tier.tsx`, `components/editor-toolbar/toolbar-tiers.scss` (base rule only, see below), `lib/editor-actions/code-language.ts`
- Modify:
  - `components/editor-toolbar/insert-menu.tsx`;
  - `lib/editor-actions/actions/insert.ts`: `insert.table` takes an optional `{ rows: number; cols: number }`, default 3×3, clamped to 1–10; `insert.codeBlock` takes an optional `{ language: string | null }` passed to `toggleCodeBlock`;
  - `components/editor-toolbar/action-menu.tsx`: optional `onRan?: (value: string) => void`, called when `runAction` returns `true`;
  - `components/editor-toolbar/slot-code.tsx`: `onRan` remembers `CODE_LANGUAGE_CHOICE` unless the value is `mermaid`;
  - `components/tiptap-ui/media-embed-popover/media-embed-popover.tsx`: optional `onEmbedded?: () => void` after a successful embed;
  - `scripts/check-client-js-size.ts`: `LAZY_SENTINELS.tableSizePicker`;
  - `CHANGELOG.md`.
- Test: `tests/unit/editor-actions/code-language.test.ts`, `tests/unit/editor-actions/insert-args.test.ts`, `tests/e2e/insert-menu.spec.ts`

**Interfaces:**
- Consumes: D1 `InsertMenu`, `registerUiRequest("openEmbed")`, `insert.*`; Task 2 `INSERT_KIND_CHOICE`, `TABLE_SIZE_CHOICE`, `CODE_LANGUAGE_CHOICE`, `parseTableSize`; `nextGridPosition` (Task 3).
- Produces, `Tier({ hideFrom, showFrom, group, children }: { hideFrom?: TierName; showFrom?: TierName; group?: string; children: ReactNode })`, with `type TierName = "t2" | "t3" | "t4" | "t5"`.
  - It renders `<div className="contents" data-tier-hide={hideFrom} data-tier-show={showFrom} data-collapse-group={group}>`.
  - `toolbar-tiers.scss` ships `[data-tier-show] { display: none; }` now. Task 8 adds the container queries.
- Produces, `preferredCodeLanguage(doc: PMNode, last: string | null): string | null`:
  - counts top-level and nested `codeBlock.attrs.language` values in D1's `CODE_LANGUAGES`, excluding `mermaid` and `plaintext`;
  - returns the most used one (ties go to the first in the doc), else `last`, else `null`;
  - caches the counts in a `WeakMap<PMNode, Map<string, number>>` (§7: by `state.doc` identity).
- Produces, `InsertMenu({ variant = "auto" }: { variant?: "auto" | "plain" })` (replaces D1's body, same position and name). `"auto"` renders both `Tier` variants below. `"plain"` renders only the plain trigger, with no `Tier` wrappers, for the phone bar (Task 10): `[data-tier-show]` is hidden everywhere outside the `toolbar` container.
  - **`<Tier hideFrom="t2" group="insert">` split:**
    - Face: with a remembered kind it reads `+ <Label>` ("Quote", "Table", …), with `aria-label` "Insert <label lowercased>"; with none, it reads `+ Insert` and opens the menu (Decision 1).
    - Chevron: "More insert options", with `aria-haspopup="menu"`.
  - **`<Tier showFrom="t2" group="insert">` plain trigger:** an icon-only `+` named "Insert" that opens the same menu. When the menu opens, focus starts on the remembered kind's item.
  - **Items:** D1's seven, each with `data-insert-kind`.
  - **Kinds that need input** open their first step instead of inserting:
    - Table → `TableSizePicker` in a `Popover` anchored to the Insert group (`data-toolbar-popup`);
    - Embed → D1's `"openEmbed"` handler;
    - Image → `insert.image`, which inserts the upload node, the image's own first step.
  - **Memory:** `INSERT_KIND_CHOICE` is remembered after the kind's insert succeeds: `runRemembered` for direct kinds, `onEmbedded` for Embed, and the picker's insert for Table.
  - **Code block** runs with `{ language: preferredCodeLanguage(state.doc, codeLanguage.last) }`.
- Produces, `TableSizePicker({ initial, onPick, onCancel }: { initial: { rows: number; cols: number }; onPick: (rows: number, cols: number) => void; onCancel: () => void })`:
  - a 10×10 grid of buttons with `data-roving-group`, each named "<r> by <c> table";
  - arrows move focus through `nextGridPosition` (rowLengths `Array(10).fill(10)`);
  - every cell up to the focused or hovered one is highlighted, with a visible "<r> × <c>" caption (not a live region);
  - initial focus is the remembered size;
  - Enter or a click picks; Esc cancels and returns focus to the Insert trigger;
  - picking runs `insert.table` with the size, then remembers `TABLE_SIZE_CHOICE` and the kind.

- [ ] **Step 1: Write the failing tests**

```ts
// code-language.test.ts
it("picks the most used language, ignoring mermaid", () => {
  // doc: python, python, typescript, mermaid, mermaid, mermaid -> "python"
});
it("breaks ties by first appearance", () => {});
it("falls back to the remembered language, then null", () => {});
it("ignores languages outside CODE_LANGUAGES", () => { /* "js onerror=x" never returned */ });
// insert-args.test.ts
it("insert.table takes rows and cols and keeps the header row", () => { /* {rows:2, cols:5} -> 2 rows, 5 cells, first row tableHeader */ });
it("insert.table clamps to 1..10 and defaults to 3x3", () => {});
it("insert.codeBlock sets the given language", () => {});
```

```ts
// insert-menu.spec.ts (1280 px = T1)
test("the menu lists Image, Embed, Table, Quote, Code block, Diagram, Divider", async ({ page }) => {});
test("without memory the face reads Insert and opens the menu", async ({ page }) => {});
test("after inserting a quote the face reads Quote and inserts one in one click", async ({ page }) => {
  // face aria-label "Insert quote"; click in an empty paragraph -> blockquote
});
test("Table opens the size grid at 3x3, picks 2x5, and reopens at 2x5", async ({ page }) => {
  // focused cell named "3 by 3 table"; ArrowUp, ArrowRight x2, Enter -> table 2 rows x 5 cols with header row
  // face now "Insert table" -> click opens the grid focused on "2 by 5 table"; Esc -> focus on the face, doc unchanged
});
test("Code block uses the doc's most used language", async ({ page }) => {
  // seed 2 python + 1 typescript + 1 mermaid blocks; Insert > Code block -> language "python"
});
test("Embed remembers the kind only after a successful embed", async ({ page }) => {
  // open Embed, type an invalid URL, submit -> error; Esc -> face still "Insert"; valid YouTube URL -> face "Insert embed"
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `bun test tests/unit/editor-actions/code-language.test.ts tests/unit/editor-actions/insert-args.test.ts && E2E_BASE_URL=http://localhost:3800 CI= bun playwright test tests/e2e/insert-menu.spec.ts --project=chromium`
Expected: FAIL.

- [ ] **Step 3: Implement** as the Interfaces block says. Import `toolbar-tiers.scss` once, from `main-toolbar-content.tsx`.

- [ ] **Step 4: Run the tests and confirm they pass**, plus D1's row spec ("Insert > Table" now goes through the grid; update that test to pick 3×3)

Run: `bun run test && E2E_BASE_URL=http://localhost:3800 CI= bun playwright test tests/e2e/insert-menu.spec.ts tests/e2e/toolbar-row.spec.ts --project=chromium`
Expected: PASS.

- [ ] **Step 5: Commit** after approval

```bash
git add components lib/editor-actions scripts tests CHANGELOG.md
git commit -m "feat(toolbar): remember the insert kind, table size and code language"
```

---

### Task 7: List split face (M9) and suggested heading level (M5)

Spec §5 M5, M9 and P5 (Decisions 8 and 9).

**Files:**
- Create: `components/editor-toolbar/list-split-button.tsx`, `lib/editor-actions/section-level.ts`
- Modify:
  - `components/document-editor/main-toolbar-content.tsx`: Paragraph group, `ListMenu` → `ListSplitButton`;
  - `components/editor-toolbar/action-menu.tsx`: `MenuOption.hint?: string`, and `initialValue?: () => string | null`, evaluated when the menu opens to choose the first highlighted item;
  - `components/editor-toolbar/style-menu.tsx`: passes `initialValue` and the "Suggested" hint;
  - `CHANGELOG.md`.
- Test: `tests/unit/editor-actions/section-level.test.ts`, `tests/e2e/list-and-style-memory.spec.ts`

**Interfaces:**
- Produces, `deriveSectionLevel(state: EditorState): HeadingLevel`. It walks top-level nodes backwards from the caret's top-level index, skipping index 0 (the title), and returns the first heading's level, or 1. It runs only when the menu opens.
- Produces, `ListSplitButton({ editor })` in a `ToolbarGroup` named "List". `last` comes from `LIST_TYPE_CHOICE` (fallback `bulletList`).
  - **Face:**
    - the icon plus a label ("Bullet list", "Numbered list", "Task list"), in D1's `ListMenu` wording; the label sits in `<Tier hideFrom="t3">`;
    - `aria-label` = the label;
    - `aria-pressed` = whether the caret's list is `last`;
    - a click runs `list.set(pressed ? "none" : last)` through `runRemembered`, which remembers `last`.
  - **Chevron:** "List options", with `aria-haspopup="menu"`. Its menu is D1's `ActionMenu` over `list.set`, with options none, bullet, numbered and task; `onRan` remembers the value unless it is `none`.
- Produces, `StyleMenu` in a paragraph or list context: the option `heading-<deriveSectionLevel>` gets `hint: "Suggested"`, and `initialValue` returns it. In a heading, `initialValue` is the current value. Nothing is applied until the user picks.

- [ ] **Step 1: Write the failing tests**

```ts
it.each([
  ["paragraph under an H2", 2], ["paragraph before any section", 1], ["caret inside an H3", 3],
  ["only the title", 1], ["paragraph after H2 then H4", 4],
])("%s -> %d", (_doc, level) => {});
```

```ts
test("the list face applies the remembered type and shows its state", async ({ page }) => {
  // fresh profile: face "Bullet list"; List options > Numbered list -> orderedList; face now "Numbered list"
  // new paragraph, click face -> orderedList, aria-pressed=true; click again -> list removed
});
test("the style menu suggests the current section's level without applying it", async ({ page }) => {
  // caret in a paragraph under an H3; open Text style; highlighted item "Heading 3" with "Suggested"; Escape -> doc unchanged
  // reopen, Enter -> the paragraph becomes an H3
});
test("Forget my choices resets the list face to Bullet list", async ({ page }) => {});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `bun test tests/unit/editor-actions/section-level.test.ts && E2E_BASE_URL=http://localhost:3800 CI= bun playwright test tests/e2e/list-and-style-memory.spec.ts --project=chromium`
Expected: FAIL.

- [ ] **Step 3: Implement** as the Interfaces block says.

- [ ] **Step 4: Run the tests and confirm they pass**, plus D1's row and keyboard specs. Update `EXPECTED_ROW`: "No list" becomes "Bullet list" + "List options".

Run: `bun run test && E2E_BASE_URL=http://localhost:3800 CI= bun playwright test tests/e2e/list-and-style-memory.spec.ts tests/e2e/toolbar-row.spec.ts tests/e2e/toolbar-keyboard.spec.ts --project=chromium`
Expected: PASS.

- [ ] **Step 5: Commit** after approval

```bash
git add components lib/editor-actions tests CHANGELOG.md
git commit -m "feat(toolbar): remember the list type and suggest the section heading level"
```

---

### Task 8: Responsive ladder

Spec §4.6 (tiers, never-collapse set, `scrollbar-gutter`, `checkVisibility()`, one ResizeObserver for focus repair), §6.6 and §7 (`scrollWidth <= clientWidth` ±1 px per tier). Decisions 3 and 9.

**Files:**
- Create:
  - `components/editor-toolbar/collapsed/paragraph-menu.tsx` (¶);
  - `collapsed/view-menu.tsx` (View ▾);
  - `collapsed/text-style-overflow-menu.tsx` (Aa);
  - `collapsed/font-size-menu.tsx` (M ▾);
  - `collapsed/slot-menu-button.tsx`;
  - `components/ui/toolbar-focus-repair.ts`;
  - `hooks/use-toolbar-focus-repair.ts`;
  - `lib/editor-actions/style-labels.ts`;
  - `tests/e2e/helpers/toolbar-tiers.ts`.
- Modify:
  - `components/editor-toolbar/toolbar-tiers.scss`;
  - `components/ui/toolbar.tsx`: the fixed variant gets `[container:toolbar/inline-size]` and `overflow-visible` in place of `overflow-x-auto overscroll-x-contain scrollbar-none` from 768 px up. Below 768 px it keeps `overflow-x-auto overscroll-x-contain scrollbar-none`, because phones still show the sticky row until Task 10 replaces it; PR A's 390×844 test keeps passing. The toolbar calls `useToolbarFocusRepair`;
  - `components/document-editor/main-toolbar-content.tsx`: the `Tier` wrappers below;
  - `components/editor-toolbar/color-popover/color-controls.tsx`: the single "Colours" button;
  - `components/editor-toolbar/overflow-menu.tsx`: a Theme item at open time;
  - `components/editor-toolbar/style-menu.tsx`: the short label;
  - `lib/icons.tsx`: add `PilcrowIcon` (lucide `Pilcrow`) and `PaletteIcon` (lucide `Palette`, for "Colours");
  - `components/document-editor/theme-toggle.tsx`: extract `useThemeToggle(): { isDark: boolean; toggle(): void }`, used by both the row button and the ⋯ item;
  - `components/document-editor/document-editor.scss`: `scrollbar-gutter: stable` on `.document-editor-wrapper`;
  - `CHANGELOG.md`.
- Test: `tests/unit/components/toolbar-focus-repair.test.ts`, `tests/unit/editor-actions/style-labels.test.ts`, `tests/e2e/toolbar-tiers.spec.ts`

**Interfaces:**
- Consumes: `Tier` (Task 6), D1 components, `useThemeToggle`.
- Produces, in `toolbar-tiers.scss`, one mixin per tier. Each emits `@container toolbar (max-width: <min−0.02px>)`, with `@media not (pointer: coarse)` using the mouse value and `@media (pointer: coarse)` using the touch value. Inside it: `[data-tier-hide="tN"] { display: none }` and `[data-tier-show="tN"] { display: contents }`.
  - The breakpoints are T2 1128/1224, T3 1008/1096, T4 840/920, and T5 touch-only 824. Each below-threshold applies the next tier.
  - Under `(pointer: coarse)`, fixed-toolbar items have `min-width` and `min-height` of 32 px (Decision 3).
- Produces, the row wrappers in `main-toolbar-content.tsx`. Each pair shares a `group`:

| Group | `hideFrom` (inline) | `showFrom` (collapsed) |
|---|---|---|
| `insert` label | the "Insert" text span, `t2` | (icon stays) — done in Task 6 |
| `theme` | `ThemeToggle`, `t2` | ⋯ item at open time |
| `size` | `SizeStepper`, `t2` | `FontSizeMenu`, `t2` |
| `paragraph` | `AlignMenu`, Outdent, Indent, `t3` | `ParagraphMenu`, `t3` |
| `slot` | `ContextSlot`, `t3` | `SlotMenuButton`, `t3` |
| `color` | text + highlight split buttons, `t4` | "Colours" button, `t4` |
| `view` | Outline + Filter, `t4` | `ViewMenu`, `t4` |
| `textstyle` | Underline, Strike, `t5` | `TextStyleOverflowMenu`, `t5` |
| `style` label | long label, `t5` | short label, `t5` |
| `list` label | face label, `t3` | — (Task 7) |

- Produces, the collapsed controls. Each is a Base UI menu or popover with `data-toolbar-popup` and `aria-haspopup`:
  - **`FontSizeMenu`:**
    - the trigger reads the value (XS, S, M, L, XL or Mixed), with `aria-label` "Font size: <SIZE_TEXT>";
    - `menuitemradio` items xs…xl with `SIZE_TEXT` labels over `size.set`;
    - it takes the disabled reason from the view.
  - **`ParagraphMenu`:**
    - trigger "Paragraph options" (¶ icon, `PilcrowIcon`);
    - a radio group over `align.set` (Align left / Align center / Align right / Justify), a separator, then Outdent and Indent items.
  - **`ViewMenu`:**
    - trigger "View options";
    - `menuitemcheckbox` items "Outline" and "Filter headings", calling the same handlers as the row buttons (`onTocToggle`, `onFilterToggle`).
  - **`TextStyleOverflowMenu`:**
    - trigger "More text styles", visible text "Aa";
    - `menuitemcheckbox` items Underline and Strike over the mark actions.
  - **`SlotMenuButton`:**
    - a 40 px button named "Context tools: <SLOT_LABELS[kind]>" that opens a popover holding D1's `<ContextSlot />`;
    - for an empty slot kind (paragraph, list, readonly) it is `aria-hidden`, `inert` and invisible, and keeps its 40 px.
  - **"Colours"** (`ColorControls`): one button named "Colours" that opens the same popover with `initialSection="text"`.
  - **⋯ Theme item:** when the menu opens, it is added if `!toolbar.querySelector('[data-theme-toggle]')?.checkVisibility()`. Its label is "Switch to dark mode" or "Switch to light mode". `ThemeToggle` gets the attribute `data-theme-toggle`.
- Produces, in `style-labels.ts`: `shortStyleLabel(label: string): string`. "Normal text" → "Normal", "Heading 3" → "H3", "Title" → "Title", "Mixed" → "Mixed".
- Produces, in `toolbar-focus-repair.ts`: `findFocusRepairTarget(toolbar: HTMLElement, lost: HTMLElement): HTMLElement | null`.
  - It uses the group of `lost.closest("[data-collapse-group]")`, and returns the first visible roving item inside any element with that `data-collapse-group`.
  - Otherwise it returns the visible roving item nearest before `lost` in DOM order, else the first one.
  - Visibility is `checkVisibility?.() ?? true`.
- Produces, `useToolbarFocusRepair(toolbarRef)`:
  - On `focusin` inside the toolbar, it creates one `ResizeObserver` on the toolbar, if none exists.
  - On `focusout` to outside the toolbar and `[data-toolbar-popup]`, it disconnects it. Unmount also disconnects it.
  - On each callback, when `document.activeElement` is inside the toolbar but not visible, it focuses `findFocusRepairTarget`.
  - Layout itself never uses the observer.
- Produces, in `toolbar-tiers.ts`:
  - `setToolbarWidth(page, width)` targets the **content box**. It measures the gutter (`wrapper.offsetWidth - wrapper.clientWidth`) and the toolbar's `padding-left + padding-right`, sets `viewport.width = width + gutter + padding`, and asserts `toolbar.clientWidth - padding === width` (it corrects once by the difference);
  - `expectNoOverflow(toolbar)` asserts `scrollWidth <= clientWidth + 1`;
  - `NEVER_COLLAPSE`: the accessible names of Undo, Redo, Text style, Bold, Italic, Link, List (the face), Insert, More formatting.

- [ ] **Step 1: Write the failing tests**

```ts
// toolbar-focus-repair.test.ts (happy-dom: stub HTMLElement.prototype.checkVisibility to read a data-hidden flag)
it("moves to the visible member of the same collapse group", () => {
  // [data-collapse-group=paragraph] align (hidden) + [data-collapse-group=paragraph] ¶ (visible) -> ¶
});
it("falls back to the nearest visible item before the lost one", () => {});
it("returns null for an empty toolbar", () => {});
// style-labels.test.ts
it.each([["Normal text", "Normal"], ["Heading 3", "H3"], ["Title", "Title"], ["Mixed", "Mixed"]])("%s -> %s", (a, b) =>
  expect(shortStyleLabel(a)).toBe(b));
```

```ts
// toolbar-tiers.spec.ts
const MOUSE = [["T1", 1128], ["T2", 1008], ["T3", 840], ["T4", 752]] as const;
const TOUCH = [["T1", 1224], ["T2", 1096], ["T3", 920], ["T4", 824], ["T5", 768]] as const;
const SHOWN: Record<string, string[]> = { // accessible names that must be visible in the tier (beyond NEVER_COLLAPSE)
  T1: ["Switch to dark mode", "Font size", "Align left", "Indent", "More text colours", "Toggle outline", "Underline"],
  T2: ["Font size: Medium, 16 pixels", "Align left", "More text colours", "Toggle outline"],
  T3: ["Paragraph options", "More text colours", "Toggle outline"],
  T4: ["Paragraph options", "Colours", "View options", "Underline"],
  T5: ["Paragraph options", "Colours", "View options", "More text styles"],
};
for (const [tier, min] of MOUSE) {
  test(`mouse ${tier} at ${min}px fits and keeps the never-collapse set`, async ({ page }) => {
    // setToolbarWidth(min); expectNoOverflow; NEVER_COLLAPSE + SHOWN[tier] visible; Bold outline not clipped (expectOutlineNotClipped)
  });
  test(`mouse one pixel below ${tier}`, async ({ page }) => { /* min-1 shows the next tier's SHOWN set (T4: still T4) */ });
}
test.describe("touch", () => {
  test.use({ hasTouch: true, isMobile: true });
  for (const [tier, min] of TOUCH) test(`touch ${tier} at ${min}px`, async ({ page }) => {
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
    // as the mouse test; at T5 the style trigger reads "Normal" in a paragraph
  });
});
test("the real mouse floor fits: a 768px viewport with classic scrollbars", async ({ page }) => {
  // setViewportSize({ width: 768, height: 800 }) without setToolbarWidth; the content box is below 752 here
  // (gutter + padding), and no tier rule exists below T4: expectNoOverflow; NEVER_COLLAPSE + SHOWN.T4 visible
});
test("arrow keys skip collapsed controls", async ({ page }) => {
  // T3: focus List options, ArrowRight -> "Paragraph options"; never a hidden Align button
});
test("Theme moves into More formatting from T2", async ({ page }) => {
  // T1: More formatting has no theme item; T2: it has "Switch to dark mode" and choosing it toggles html.dark
});
test("focus follows a control into its collapsed trigger and back", async ({ page }) => {
  // T1: Alt+F10, arrow to "Align left"; setToolbarWidth(840) -> activeElement is "Paragraph options"
  // setToolbarWidth(1128) -> activeElement is "Align left"; never document.body in between (poll)
});
test("the empty slot button is hidden from AT at T3 in a paragraph and names its tools in a heading", async ({ page }) => {});
test("axe at T4 with the View, Paragraph and Font size menus open", async ({ page }) => {});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `bun test tests/unit/components/toolbar-focus-repair.test.ts tests/unit/editor-actions/style-labels.test.ts && E2E_BASE_URL=http://localhost:3800 CI= bun playwright test tests/e2e/toolbar-tiers.spec.ts --project=chromium`
Expected: FAIL. The row overflows below T1, and the collapsed controls are missing.

- [ ] **Step 3: Implement** as the Interfaces block says. When a tier overflows, tighten spacing (gaps, separators, label widths). Never move a never-collapse control, and never change the tier table without the owner's approval.

- [ ] **Step 4: Run the tests and confirm they pass**, plus the row, keyboard, slot and a11y specs

Run: `bun run test && E2E_BASE_URL=http://localhost:3800 CI= bun playwright test tests/e2e/toolbar-tiers.spec.ts tests/e2e/toolbar-row.spec.ts tests/e2e/toolbar-keyboard.spec.ts tests/e2e/toolbar-slot.spec.ts tests/e2e/toolbar-a11y.spec.ts --project=chromium`
Expected: PASS. Screenshot every tier (mouse and touch) in the browser pane, light and dark.

- [ ] **Step 5: Commit** after approval

```bash
git add components hooks lib/editor-actions tests CHANGELOG.md
git commit -m "feat(toolbar): collapse the row by width tier with container queries"
```

---

### Task 9: Outline overlay below 950 px and remembered outline state (M6)

Spec §4.6 (overlay below ~950 px: slides over the page and closes after a heading is picked), §5 M6 (persisted; not cleared by Forget) and §9. Decision 5.

**Files:**
- Create: `hooks/use-outline-open.ts`, `components/document-editor/outline-panel.tsx`, `components/document-editor/outline-panel.scss`
- Modify:
  - `components/document-editor/document-editor.tsx`: `useState(true)` for `tocVisible` → `useOutlineOpen()`, and `OutlinePanel` replaces the inline `DocumentOutline`;
  - `components/toc-sidebar/toc-sidebar.tsx`: optional `onNavigate?: () => void`, called after a heading pick has set the selection;
  - `components/editor-toolbar/collapsed/view-menu.tsx`: "Outline" toggles through the same hook;
  - `CHANGELOG.md`.
- Test: `tests/unit/hooks/use-outline-open.test.tsx`, `tests/e2e/outline-overlay.spec.ts`

**Interfaces:**
- Consumes: `OUTLINE_OPEN_CHOICE`, `useRememberedChoice` (Task 2), `useIsBreakpoint`.
- Produces, `useOutlineOpen(): { mode: "docked" | "overlay" | "hidden"; open: boolean; toggle(): void; close(): void }`:
  - **Mode:** viewport < 768 → `hidden`; < 950 → `overlay`; else `docked`.
  - **Docked:** `open` = the remembered value (`"open"` before ready). `toggle` writes `OUTLINE_OPEN_CHOICE`.
  - **Overlay:** `open` is transient state. It starts `false` and resets to `false` whenever the mode changes. `toggle` and `close` never write.
- Produces, `OutlinePanel({ mode, open, onClose, returnFocusRef, ...tocProps })`:
  - **docked:** today's sidebar, unchanged.
  - **overlay:**
    - a panel (`role="dialog"`, `aria-modal="false"`, `aria-label="Outline"`), 280 px wide (`max-width: 85vw`);
    - it sits below the sticky toolbar (`top: var(--tt-toolbar-height)`), over the page, with a scrim button named "Close outline";
    - it slides in over 200 ms with `transform`; under reduced motion it has no motion;
    - on open, it focuses the active item, else the first;
    - Esc or the scrim closes it and returns focus to `returnFocusRef`, which is the trigger that opened it (Toggle outline, or View options at T4);
    - `onNavigate` closes it first, then TocSidebar's existing deferred scroll runs (`block: "start"`, from D1). The page does not reflow, so the scroll target stays valid.

- [ ] **Step 1: Write the failing tests**

```tsx
// use-outline-open.test.tsx (stub matchMedia per width)
it("docked follows the remembered state", () => { /* stored "closed" -> open false after ready */ });
it("overlay starts closed even when 'open' is remembered", () => {});
it("overlay toggles are not remembered", () => { /* toggle twice in overlay; storage unchanged */ });
it("Forget my choices does not clear the outline state", () => {});
```

```ts
// outline-overlay.spec.ts
test("overlay never opens on load", async ({ page }) => {
  // tinydocy-ui {"v":1,"c":{"outline.open":{"v":1,"l":"open"}}}; viewport 900 -> no outline visible; content box unchanged
});
test("the overlay slides over the page and closes after picking a heading", async ({ page }) => {
  // 30-heading doc at 900px; Toggle outline -> dialog "Outline"; the editor content's left/width are the same as before
  // click item 20 -> dialog gone; heading top within [toolbar.bottom, toolbar.bottom + 24]; caret at the heading's end
});
test("Esc and the scrim close it and return focus to the toggle", async ({ page }) => {});
test("crossing 950 keeps focus", async ({ page }) => {
  // 900px: open overlay, focus an item; resize to 1200 -> docked shows the remembered state; activeElement !== body
});
test("docked outline state survives reload and Forget my choices", async ({ page }) => {
  // 1280px: Toggle outline off; reload -> off; More formatting > Forget my choices; reload -> still off
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `bun test tests/unit/hooks/use-outline-open.test.tsx && E2E_BASE_URL=http://localhost:3800 CI= bun playwright test tests/e2e/outline-overlay.spec.ts --project=chromium`
Expected: FAIL.

- [ ] **Step 3: Implement** as the Interfaces block says.

- [ ] **Step 4: Run the tests and confirm they pass**, plus `toc-sidebar.spec.ts` and `toolbar-tiers.spec.ts`

Run: `bun run test && E2E_BASE_URL=http://localhost:3800 CI= bun playwright test tests/e2e/outline-overlay.spec.ts tests/e2e/toc-sidebar.spec.ts tests/e2e/toolbar-tiers.spec.ts --project=chromium`
Expected: PASS. Screenshot the overlay at 900 px, light and dark.

- [ ] **Step 5: Commit** after approval

```bash
git add hooks/use-outline-open.ts components tests CHANGELOG.md
git commit -m "feat(outline): overlay the outline below 950px and remember whether it is open"
```

---

### Task 10: Phone docked bar with the format sheet

Spec §4.7 (constant 44 px bar docked above the keyboard; cells; Aa sheet with style, size, colours, align and ⋯ items; no bubble on touch; `focusout` reset for iOS `visualViewport` drift; `aria-pressed` #269), §2 (it hides when read-only, #308), §6.7 (44×44) and §6.8 (mobile bottom padding). Decision 10. E's U11 path.

**Files:**
- Run: `bun shadcn add sheet`. Make `components/ui/sheet.tsx` use named exports on Base UI `Dialog`, matching `components/ui/dialog.tsx`.
- Create: `components/document-editor/format-sheet.tsx` (lazy; root `data-format-sheet`), `hooks/use-keyboard-inset.ts`, `lib/editor-scroll-clearance.ts`
- Rewrite: `components/document-editor/mobile-toolbar-content.tsx` (`MobileToolbarContent` becomes the docked bar)
- Modify:
  - `components/document-editor/document-editor.tsx`:
    - on phones it renders `<MobileToolbarContent>` instead of the sticky row;
    - it removes `mobileView`, the `useCursorVisibility`-based `bottom` style (and the import if unused) and the highlighter panel;
    - `EDITOR_PROPS.scrollMargin` / `scrollThreshold` use `SCROLL_CLEARANCE`;
    - the bar mounts only when `!toolbarOff`.
  - `components/document-editor/document-editor.scss`: `--mobile-bar-inset`, `scroll-padding-bottom` and editor bottom padding on phones.
  - `components/ui/toolbar.tsx`: a `variant="docked"` (fixed bottom, full width, 44 px, `border-t`, `[container:mobile-bar/inline-size]`).
  - `scripts/check-client-js-size.ts`: `LAZY_SENTINELS.formatSheet`.
  - `tests/e2e/toolbar-a11y.spec.ts`: replace PR A's 390×844 highlight-panel test with the bar and sheet tests below.
  - `CHANGELOG.md`.
- Delete, after `git grep` finds no importer: `components/tiptap-ui/color-highlight-button/`, `components/tiptap-ui/color-highlight-popover/`.
- Test: `tests/unit/hooks/use-keyboard-inset.test.ts`, `tests/unit/lib/editor-scroll-clearance.test.ts`, `tests/e2e/mobile-bar.spec.ts`

**Interfaces:**
- Produces, `useKeyboardInset(): number`:
  - `Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop))`;
  - recomputed at most once per frame on `visualViewport` `resize` and `scroll`;
  - on a `document` `focusout` whose `relatedTarget` is not editable (not `input`, `textarea` or `[contenteditable]`), it returns 0 after one `requestAnimationFrame` (iOS drift);
  - every listener is removed on unmount.
- Produces, in `editor-scroll-clearance.ts`:
  - `export const SCROLL_CLEARANCE: { top: number; readonly bottom: number; left: number; right: number }`, with `top: 52`, and `bottom` as a getter: `8 + barClearance`;
  - `export function setMobileBarClearance(px: number): void`.
  - The object keeps one identity, so `EDITOR_PROPS` stays stable (no `setOptions`), and ProseMirror reads the live `bottom` on each scroll.
- Produces, `MobileToolbarContent({ editor })`: `<Toolbar variant="docked" aria-label="Formatting">`.
  - **Transform:** `translateY(-inset)`. It calls `setMobileBarClearance(44 + inset)` and sets `--mobile-bar-inset` on the wrapper.
  - **Cells,** each 44×44, in order:
    1. Undo (`history.undo`);
    2. "Aa", named "Text format", with `aria-haspopup="dialog"`, opening the sheet;
    3. Bold;
    4. Italic (`aria-pressed`, #269);
    5. List: the plain `ActionMenu` over `list.set`, named by its value;
    6. Indent (`block.indent`);
    7. `SlotMenuButton` (Task 8) in `<div data-mobile-slot>`;
    8. `<InsertMenu variant="plain" />`.
  - The bar uses no component that wraps itself in `Tier`, except through an explicit plain variant: `[data-tier-show]` is `display: none` outside the `toolbar` container. `SlotMenuButton` and the list `ActionMenu` carry no `Tier` wrapper; the row adds those wrappers in `main-toolbar-content.tsx`.
  - **Narrow widths:** `@container mobile-bar (max-width: 351.98px) { [data-mobile-slot] { display: none } }`.
  - **Read-only:** the bar is hidden (`hidden` attribute) when the editor is not editable, and the open sheet closes.
- Produces, `FormatSheet({ editor, open, onOpenChange, returnFocusRef })`: a bottom `Sheet` titled "Text format", with `data-toolbar-popup`. It holds these sections in order, all targets 44×44:
  - **Style:** radio rows over `style.set`, with the Task 7 suggestion and the title reason.
  - **Size:** radio rows over `size.set` with the `SIZE_TEXT` labels.
  - **Colours:** `LazyColorPalette layout="sheet" initialSection="text"`.
  - **Align:** radio rows over `align.set`.
  - **More:** Superscript, Subscript and Inline code (toggles), Clear formatting, and Forget my choices.
  - **Slot tools:** `<ContextSlot />`, only when `[data-mobile-slot]` is not visible at open time.
  - A "Done" button closes the sheet. Closing returns focus to the Aa cell.

- [ ] **Step 1: Write the failing tests**

```ts
// use-keyboard-inset.test.ts (stub window.visualViewport as an EventTarget with height/offsetTop)
it("reports the keyboard height", () => { /* innerHeight 800, vv.height 500 -> 300 */ });
it("resets to 0 after focus leaves editable content", () => {});
it("removes its listeners on unmount", () => { /* spy add/removeEventListener counts match */ });
// editor-scroll-clearance.test.ts
it("keeps one object identity and reads the live bottom", () => {
  const ref = SCROLL_CLEARANCE; setMobileBarClearance(44 + 300);
  expect(SCROLL_CLEARANCE).toBe(ref); expect(SCROLL_CLEARANCE.bottom).toBe(352);
});
```

```ts
// mobile-bar.spec.ts; test.use({ hasTouch: true, isMobile: true }); first assertion: coarse === true
for (const [w, h, cells] of [[375, 812, 8], [360, 740, 8], [320, 568, 7]] as const) {
  test(`${w}px shows ${cells} cells of at least 44x44 without overflow`, async ({ page }) => {});
}
test("no sticky row and no bubble on a phone", async ({ page }) => {});
test("Bold shows its state with aria-pressed", async ({ page }) => {});
test("the format sheet applies a colour and returns focus to Aa", async ({ page }) => {
  // select "alpha"; Text format -> sheet sections Style, Size, Colours, Align, More; "Red text" -> data-text-color=red
  // Done -> focus on "Text format"; every sheet button >= 44x44
});
test("at 320px the slot tools move into the sheet", async ({ page }) => {
  // caret in an H2 -> sheet has "Move section up"; at 375px the sheet has no slot section
});
test("read-only with the sheet open", async ({ page }) => {
  // open the sheet; setEditable(false) -> sheet closed, bar hidden, activeElement !== body
});
test("the caret stays above the bar while typing at the end of a long doc", async ({ page }) => {
  // caret rect bottom <= bar top
});
test("axe on the bar and the open sheet, light and dark", async ({ page }) => {});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `bun test tests/unit/hooks/use-keyboard-inset.test.ts tests/unit/lib/editor-scroll-clearance.test.ts && E2E_BASE_URL=http://localhost:3800 CI= bun playwright test tests/e2e/mobile-bar.spec.ts --project=chromium`
Expected: FAIL.

- [ ] **Step 3: Implement** as the Interfaces block says, then delete the replaced highlight folders.

- [ ] **Step 4: Run the tests and confirm they pass**, plus the a11y, tier and colour specs

Run: `bun run test && bun run typecheck && E2E_BASE_URL=http://localhost:3800 CI= bun playwright test tests/e2e/mobile-bar.spec.ts tests/e2e/toolbar-a11y.spec.ts tests/e2e/color-popover.spec.ts tests/e2e/toolbar-tiers.spec.ts --project=chromium`
Expected: PASS. Screenshot 375 and 320 px with the sheet open, light and dark. If the iOS Simulator is available, also check that the bar follows the keyboard and resets after the keyboard closes. Otherwise note in the PR that the iOS check is pending.

- [ ] **Step 5: Commit** after approval

```bash
git add -A components hooks lib scripts tests CHANGELOG.md
git commit -m "feat(mobile): add the docked phone bar with a text format sheet"
```

---

### Task 11: Budgets, leaks, kill switch, docs and full verification

Spec §7 (typing p95 with toolbar + bubble + slot mounted vs off; ≤1 commit per settle; listeners and heap after bubble cycles; axe; forced colours) and §8 D ("works with `NEXT_PUBLIC_REMEMBER_CHOICES=0`").

**Files:**
- Create: `tests/e2e/helpers/leak-metrics.ts` (extracted from D1's leak spec), `tests/e2e/memory-off.spec.ts`
- Modify: `tests/e2e/toolbar-leaks.spec.ts`, `tests/e2e/toolbar-a11y.spec.ts`, `tests/e2e/performance.spec.ts` (doc comment only: the "toolbar on" run now includes the bubble and slot; Task 5 and Task 10 already unmount them under `__TOOLBAR_OFF`), `CHANGELOG.md`, `tests/TESTING.md`, `AGENTS.md`, `README.md`
- Test: the files above

**Interfaces:**
- Produces, in `leak-metrics.ts`:
  - `measureBaseline(page: Page): Promise<LeakSample>` and `measureAfter(page: Page, base: LeakSample): Promise<void>`;
  - `LeakSample = { listeners: { window: number; document: number }; heapUsed: number }`;
  - both use CDP `HeapProfiler.collectGarbage`, `Runtime.getHeapUsage` and `DOMDebugger.getEventListeners` on `window` and `document`;
  - `measureAfter` asserts equal listener counts and `heapUsed <= base.heapUsed * 1.05`.
- `memory-off.spec.ts` runs only when `E2E_REMEMBER_OFF=1`, against Next on 3801 (Global Constraints).

- [ ] **Step 1: Write the failing tests**

```ts
// toolbar-leaks.spec.ts (D1's tab-switch test moves onto the helper)
test("100 bubble cycles and 20 tab switches return listeners to baseline and heap within 5%", async ({ page }) => {
  // warm-up: one bubble show/hide, one colour popover open/close, 2 tab switches; base = measureBaseline(page)
  // 100 cycles: select a word via __tiptap_editor + focus -> bubble visible; ArrowRight -> hidden;
  //   every 10th cycle open and close the colour popover from the bubble
  // 20 tab switches; return to the start tab; measureAfter(page, base)
});
// memory-off.spec.ts
test.skip(process.env.E2E_REMEMBER_OFF !== "1", "needs Next built with NEXT_PUBLIC_REMEMBER_CHOICES=0 on 3801");
test("nothing is remembered and Forget explains why", async ({ page }) => {
  // pick Red -> face stays "Text colour"; Insert a quote -> face stays "Insert"; localStorage has no tinydocy-choices
  // More formatting > Forget my choices is aria-disabled with "Remembering choices is turned off"
  // the docked outline state still survives reload (tinydocy-ui)
});
// toolbar-a11y.spec.ts: add axe sweeps (light and dark) for:
//   colour popover from the row and from the bubble; the bubble; the Insert menu; the table size grid;
//   the outline overlay at 900px; and forced-colours snapshots of the palette (pressed check + border) and the bubble
```

- [ ] **Step 2: Run them and confirm the new ones fail or are unwired**

Run: `E2E_BASE_URL=http://localhost:3800 CI= bun playwright test tests/e2e/toolbar-leaks.spec.ts tests/e2e/toolbar-a11y.spec.ts --project=chromium`
Expected: FAIL. `leak-metrics` is missing.

- [ ] **Step 3: Implement the helper, then write the docs**
  - `CHANGELOG.md`: merge the task bullets into one PR D2 entry (Added / Changed / Removed), in PR A's style. Add a Deploy note: none needed; the client-only build-time switch `NEXT_PUBLIC_REMEMBER_CHOICES=0` lives in `.env.production` if ever needed.
  - `tests/TESTING.md`:
    - the new specs;
    - the 3800 / 1934 recipe, and 3801 for `memory-off`;
    - `size:check` now gates the editor group and lazy sentinels;
    - `leak-metrics`.
  - `AGENTS.md`, Learned Workspace Facts, one line each:
    - memory: `lib/memory/`, the keys, Forget, the kill switch, writes only on a successful `runAction`;
    - the ladder: `Tier` / `data-tier-hide` / `data-tier-show` / `data-collapse-group`, open-time `checkVisibility()` for portaled menus, and one focus-repair `ResizeObserver`;
    - the bubble: E's path and popovers portaled into it;
    - the phone bar and format sheet: `SCROLL_CLEARANCE` keeps `EDITOR_PROPS` stable.
  - `README.md`: the features list (colour, bubble, remembered choices, phone bar) and the env row added in Task 2.

- [ ] **Step 4: Run the full verification**

```bash
bun audit --audit-level=high && bun biome check . && bun run lint && bun run typecheck && bun run test && bun run build && bun run size:check
E2E_BASE_URL=http://localhost:3800 CI= bun playwright test --project=chromium --project=perf
E2E_BASE_URL=http://localhost:3800 CI= bun playwright test tests/e2e/selection-bubble.spec.ts tests/e2e/toolbar-tiers.spec.ts tests/e2e/mobile-bar.spec.ts tests/e2e/color-popover.spec.ts --project=chromium --repeat-each=10 --workers=3
# kill switch: second Next on 3801 with NEXT_PUBLIC_REMEMBER_CHOICES=0 (same Hocus and DB), then
E2E_REMEMBER_OFF=1 E2E_BASE_URL=http://localhost:3801 CI= bun playwright test tests/e2e/memory-off.spec.ts --project=chromium
```

Expected: everything passes. The perf project's typing p95 stays ≤ +10% with the bubble and slot mounted, and ≤ 1 toolbar commit per settle holds. In the PR description, record:
- the editor-group delta;
- the whole-client delta;
- typing p95;
- the leak numbers;
- screenshots at T1–T5 (mouse and touch), 900 px with the overlay, and 375 / 320 px with the sheet, light and dark.

- [ ] **Step 5: Commit** after approval

```bash
git add tests CHANGELOG.md tests/TESTING.md AGENTS.md README.md
git commit -m "test(toolbar): assert bubble leaks, kill switch and accessibility for PR D2"
```

---

## Self-review

1. **Spec coverage**
   - §4.1, Insert incl. Table → Task 6. ⋯ "Forget my choices" → Task 2. "All actions…" → PR E (scope).
   - §4.3 → Task 5. Repeat in the bubble → PR E.
   - §4.5 → Tasks 3–4.
   - §4.6 → Task 8. The outline overlay → Task 9.
   - §4.7 → Task 10. The selection swap → PR E.
   - §5:
     - M1, M2 → Task 4. M3 → Task 3. M4 → Task 6. M5 → Task 7.
     - M6 → Task 9. M9 → Task 7. M10 and M17a → Task 6.
     - Keys, store, ready flag, try/catch, versions, success-only writes, Forget and the kill switch → Task 2.
   - §6: dialog grid → Task 3. Menu buttons, `aria-haspopup` and reasons → Tasks 4, 6, 8 and 10. Focus never on `<body>` → Tasks 5, 8 and 10. 24 / 44 targets → Tasks 4, 8 and 10. Mobile bottom padding → Task 10. Alt+F10 and Esc → Task 5. Forced colours → Tasks 3 and 11.
   - §7:
     - editor chunk and palette lazy → Task 1, with sentinels in Tasks 3, 6 and 10;
     - per-tier overflow → Task 8;
     - tamper → Task 2;
     - bubble cycles → Task 11;
     - typing with the bubble mounted → Tasks 5 and 11;
     - axe → Tasks 8, 10 and 11.
   - §8 D: CI assertion → Tasks 1 and 11. Kill switch → Tasks 2 and 11.
   - Floating outline carry-over → D1 fix, asserted in Task 5.
2. **Step scan:** every code step names its files, signatures and pinned values. Test bodies left as comments state their exact assertions.
3. **Type consistency:**
   - `ColorKind`, `RecentColor`, `ListType`, `INSERT_KINDS` and `parseTableSize` are defined in Task 2 and used in Tasks 3, 4, 6 and 7.
   - `Tier` and `TierName` are defined in Task 6 and used in Tasks 7–8.
   - `SlotMenuButton` is defined in Task 8 and used in Task 10.
   - `LazyColorPalette` is defined in Task 3 and used in Tasks 4, 5 and 10.
   - `ActionMenu.onRan` and `initialValue` are added in Tasks 6 and 7 and used in Tasks 6, 7 and 10.
   - `"focusBubble"` is used only in Task 5.
4. **Review Focus:** each line has a named test in its owning task: Tasks 5, 8, 2/4, 5/10 and 9.
5. **Proportion:** most code blocks are tests. Implementation steps carry signatures, copy and pinned values only.
