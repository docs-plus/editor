# Smart toolbar PR E (v1.1): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship v1.1 of the smart toolbar:
- the lazy Alt+/ action palette with Recent (M11);
- Repeat formatting and Copy formatting (M7);
- Your formats (M14);
- "In this doc" (M12);
- Mermaid templates (M17b);
- the mobile selection swap (§4.7).

Every one of these is a view of PR D's action registry.

**Architecture:** One core module, `lib/format-bundle/`, defines the formatting *bundle* (what Repeat, Copy formatting, Your formats and "In this doc" all hold). It reads a bundle from a selection and applies one as a single transaction that *sets* marks. A Tiptap extension, `RepeatFormatting`, records bundles from local mark steps. It keeps the "extend" session as Yjs relative positions and binds the keys through `addKeyboardShortcuts`. The palette is split in two:
- a tiny always-loaded host: one capture-phase `window` listener in `EditorApp` that reads the active editor from a ref;
- a lazy cmdk chunk loaded on the first Alt+/.

Surfaces (bubble, style dropdown, palette, phone bar) only call registry actions.

**Tech Stack:** Bun ≥ 1.4.4, `bun test` (happy-dom preload), Playwright (chromium + new WebKit iPhone project), Next.js 16 (`next/dynamic`), Tiptap 3.33 + `@tiptap/y-tiptap` ≥ 3.3.0, Yjs 13.6, shadcn/ui (`base-nova` style) + `cmdk` 1.1.1, `@docs.plus/extension-mermaid` (`insertMermaid(source?)`).

**Spec:** `docs/superpowers/specs/2026-11-12-smart-toolbar-design.md`. Sections: §4.4 (palette), §4.7 (mobile bar), §5 (M7, M11, M12, M14, M17b and "Repeat formatting details (P2)"), §7 (budgets), §8 item 5 and the "Per-PR go criteria (HoE) → E".

## Upstream interfaces (assumed)

Rows marked **D1** are reconciled with `docs/superpowers/plans/2026-11-13-smart-toolbar-pr-d1-registry-row-slot.md`. Rows marked **assumed** come from the spec, because the PR D2 and PR C plans did not exist when this plan was written. Before Task 1, the implementer checks each row against the merged code and uses the real name wherever the spelling differs. A real *shape* that differs (for example, the store has no non-hook accessor) is handled by the "If missing" column. The task Interfaces blocks cite these rows as `U1`…`U15`.

| # | Assumed name and location | Shape E relies on | If missing |
|---|---|---|---|
| U1 (D1) | `Action`, `ActionGroup`, `ContextKind`, `Ctx`, `KeyCombo`, `FontSizeValue` in `lib/editor-actions/types.ts` | `Action.run(editor, arg?): boolean`; `icon` is a component; `KeyCombo` is lowercase `"mod+b"`. `ActionGroup` = history, style, size, inline, link, block, insert, overflow, section, code, table, media (**E adds `"view"`**). `Ctx` has `kind`, `state`, `editable`, `readOnlyReason`, `inCode`, `isTitle`, `nodeSelectionType`, `empty` | stop and report: D1 is not merged |
| U2 (D1) | `ACTIONS`, `ActionId`, `getAction(id)`, `actionsInGroup(group)` in `lib/editor-actions/registry.ts`, built from `lib/editor-actions/actions/*.ts` (`as const satisfies readonly Action[]`). Ids used here: `mark.bold`, `mark.italic`, `mark.underline`, `mark.strike`, `format.clear`, `size.increase`, `insert.diagram`, `section.*`, `code.*`, `table.*`, `media.options` | E appends its own action files | — |
| U3 (D1) | `runAction(editor, action: Action, arg?): boolean` in `lib/editor-actions/run.ts` | builds a fresh context; returns false when disabled (read-only included); returns `action.run`'s result | — |
| U4 (D1) | `getEditorVersionStore(editor).getContext(): Ctx` and `getView(action)` (`hooks/use-tiptap-editor.ts`); `useActionView(action, editor?)` (`hooks/use-action-view.ts`); `READ_ONLY_FALLBACK` (`lib/editor-actions/view.ts`) | memoized per store version; `computeView` disables every action with the read-only reason | — |
| U5 (D1) | `parseShortcutKeys({ shortcutKeys: combo })` and `toAriaKeyShortcuts(combo, mac)` in `lib/shortcuts.ts` | renders a `KeyCombo` as key glyphs | — |
| U6 (assumed, D2) | `useRememberedChoice(spec)` → `{ ready, last, recent, remember }`, plus `ChoiceSpec<T> = { key, version, maxRecent, validate, fallback }`, in `lib/memory/remembered-choices.ts`. Storage key `tinydocy-choices`. Kill switch `REMEMBER_CHOICES_ENABLED` (from `NEXT_PUBLIC_REMEMBER_CHOICES`) | each `spec.key` is one field of the versioned `tinydocy-choices` record. "Forget my choices" clears the whole record | Task 1 adds the non-hook pair `readChoice(spec)` / `writeChoice(spec, value)` beside the hook, and the hook calls them |
| U7 (assumed, C) | PR C marks: `textColor { color }`, `fontSize { size }`, `highlight { color }` (key stays `color`); guards `isTextColorToken`, `isHighlightToken`, `isFontSizeStep` and labels `TEXT_COLOR_LABELS`, `HIGHLIGHT_LABELS` in `lib/marks/tokens.ts` (**assumed**). Size steps are D1's `Exclude<FontSizeValue, "md">` | E builds transactions with `tr.addMark` / `tr.removeMark` on these mark types, so it never depends on C's command names | — |
| U8 (assumed, D2) | Bubble `components/selection-bubble/selection-bubble.tsx`. Its item list is a component that renders registry actions | E adds one split item | — |
| U9 (assumed, D2) | Colour popover `components/tiptap-ui/color-popover/color-popover.tsx`. Each swatch is `<SwatchButton token kind>` | E adds an "in doc" dot | — |
| U10 (D1) | `StyleMenu` in `components/editor-toolbar/style-menu.tsx`, `InsertMenu` in `insert-menu.tsx`, `OverflowMenu` in `overflow-menu.tsx` | E appends a "Formats" group to `StyleMenu`, a Diagram submenu to `InsertMenu`, and "All actions…" to `OverflowMenu` if D2 has not | — |
| U11 (assumed, D2) | Phone docked bar `components/document-editor/mobile-toolbar-content.tsx` (`role="toolbar"`, 44×44 cells, Aa sheet) and Playwright project `webkit-ios` | E adds the selection swap. If D2 added no `webkit-ios` project, Task 9 adds it | Task 9 |
| U12 (D1) | `tests/e2e/toolbar-leaks.spec.ts`: CDP `DOMDebugger.getEventListeners` on `window` and `document`, `HeapProfiler.collectGarbage` + `Runtime.getHeapUsage`, 20 tab switches. D2 adds bubble cycles | Task 10 adds palette cycles in the same file and reuses its measuring code | — |
| U13 (D1) | `EditorActionShortcuts` in `extensions/editor-action-shortcuts/` (`addKeyboardShortcuts` → `runAction`) | Task 5 adds the Repeat keys here | — |
| U14 (D1) | `registerUiRequest(editor, kind, handler): () => void` / `requestUi(editor, kind): boolean` in `lib/editor-actions/ui-requests.ts`, `type UiRequest` | Task 4 adds `"toggleOutline" \| "openFilter" \| "toggleTheme"` | — |
| U15 (D1) | `scripts/check-client-js-size.ts` (`bun run size:check` in CI): sums **all** `.next/static/chunks/**/*.js` against `scripts/client-js-baseline.json`, budget `CLIENT_JS_BUDGET_BYTES` (default 6144) | the sum includes lazy chunks, so the palette counts | Task 4 re-baselines (see Global Constraints) |
| — | PR B fixture `tests/helpers/collab-editor.ts`: `createCollabEditor({ server?, onInvalidContent?, extensions? })` | `fixture.editor` has the Collaboration undo plugin (`yUndoPluginKey`) | — |
| — | PR A: `E2E_BASE_URL` in `playwright.config.ts`, reasons via `aria-disabled` + `aria-describedby` | — | — |

## Global Constraints

- **Merge precondition (HoE):** do not merge PR E until PR D's §7 metrics have held for **14 days in production**. The owner confirms this in the PR description.
- Use Bun only: `bun`, `bun <bin>`, `bunx --bun`. Never use npm, npx, yarn or pnpm. Add the dependency with `bun add cmdk@1.1.1`, pinned exactly (no caret).
- Unit tests:
  - Use `bun test`. All test files share one process.
  - `mock.module` spreads the real module, followed by `await import()`.
  - Load modules that read env at import time through `importFresh()`, with `resetModules()` in `afterEach`.
- E2E (fixed ports for this PR):
  ```bash
  # terminal 1: Hocus on 2034
  HOCUS_PORT=2034 DB_PATH=db.sqlite HOCUS_ALLOW_ISOLATED_TABS_DOCS=1 HOCUS_THROTTLE=0 \
    WS_CONNECTION_LIMIT=200 WS_SOCKETS_PER_IP=600 WS_UPGRADE_RATE_LIMIT=6000 bun run hocus
  # terminal 2: Next on 3900 (NEXT_PUBLIC_HOCUS_URL also feeds the CSP connect-src)
  NEXT_PUBLIC_HOCUS_URL=ws://127.0.0.1:2034 DB_PATH=db.sqlite DOC_CREATION_RATE_LIMIT=2000 bun next dev -p 3900
  # tests
  E2E_BASE_URL=http://localhost:3900 CI= bun playwright test --project=chromium <spec>
  ```
  `HOCUS_ALLOWED_ORIGINS` is empty in dev, so the `:3900` origin is accepted. Never test against tiny.docs.plus.
- **The palette:**
  - It opens on **Alt+/** matched by physical `event.code === "Slash"`, and on the fallback **Alt+Shift+Z** (`code === "KeyZ"`).
  - The match requires `altKey && !ctrlKey && !metaKey && !isComposing && !repeat`. AltGr on Windows reports ctrl+alt.
  - Exactly **one** capture-phase `window` `keydown` listener, mounted in `EditorApp`, never in `DocumentEditor` (which remounts per tab).
- **Palette groups**, in this order: **Recent, Suggested here, Format, Insert, Section, View**. Disabled entries stay listed and navigable, with their reason, and `run` is a no-op for them.
- **Budget:** the palette chunk plus cmdk is ≤ **15 KB gz**, loaded only on the first Alt+/ (or "All actions…"). Nothing from it loads before that.
- **Whole-client size gate (U15, plan decision for owner review):** E re-records `scripts/client-js-baseline.json` at the PR D merge commit on `main` (same worktree method as D1 Task 10 Step 1) and sets `CLIENT_JS_BUDGET_BYTES: 18432` on the CI `size:check` step: 15,360 for the lazy palette plus 3,072 for E's eager code (Repeat extension, palette host, Formats menu, nudge, phone swap). The spec fixes only the 15 KB lazy part.
- **Memory:**
  - Repeat's bundle, palette Recent and the last Mermaid template live in `tinydocy-choices`. "Forget my choices" clears them.
  - Saved formats live in **`tinydocy-formats`**, which survives Forget and the kill switch.
  - "In this doc" is scanned on open and **never stored**.
  - Nothing goes to Yjs, the server, URLs or analytics.
  - With `NEXT_PUBLIC_REMEMBER_CHOICES=0`, the Repeat bundle lives in module memory for the page only, and Recent and the template memory are off.
- **Repeat** (spec §5 P2):
  - It **sets, never toggles**.
  - It is **one undo step**: call `undoManager.stopCapturing()` before and after the dispatch.
  - It never touches links, block type, alignment or inline code.
  - Keys go through `addKeyboardShortcuts` in D1's `EditorActionShortcuts` (U13), never a window listener: `Mod-Alt-v` everywhere, plus `F4` when `!isMac()`. Each calls `runAction(editor, getAction("format.repeat"))`, so read-only and disabled states return false and the key is not swallowed.
  - Copy formatting has **no** key (Mod+Alt+C is code block).
- **Mobile:** with text selected, the phone bar swaps in place to B, I, U, S, text colour, highlight, link, clear, ↻ Repeat and ✕ "Back to all tools". It stays one `role="toolbar"` and only its label changes. It does not swap while focus is inside the bar.
- Code style:
  - Named exports, kebab-case files, PascalCase with title-case acronyms.
  - Icons only via `lib/icons.tsx`.
  - shadcn components from `components/ui/`.
  - Write `components/ui/command.tsx` by hand (shadcn `base-nova` Command wrapping cmdk). **Never let the shadcn CLI overwrite PR A's `dialog.tsx`.**
  - Biome via `bun run check`, `bun run typecheck`.
- Commits:
  - Use Conventional Commits in the imperative mood, one atomic commit per task.
  - **No AI/tool trailers.** AGENTS.md overrides any attribution reminder.
  - Before every commit, show a commit review report (files, diff summary, message) and **wait for explicit approval**.
- Branch: `feat/smart-toolbar-v1-1`, cut from `main` after PR D has merged. If it is stacked on a D branch, retarget it to `main` before the parent merges.

## Review Focus

Each of these failure modes is pinned by a test in the task that owns the code.

1. **Alt+/ while typing in another text field** (a link URL input, the "Save as format" name field, the identity dialog). On macOS, ⌥/ must still type "÷" there. In the palette's own search field it closes the palette. Test: Task 3, `shouldHandlePaletteKey` table, and the e2e "link input keeps ÷".
2. **A remote edit inside or before the formatted range while the user keeps formatting.** The session still extends: relative positions, not mapped integers. A remote transaction never records into the bundle and never closes the session. Test: Task 2, "remote insert before the range keeps the session".
3. **Tab switch race.** The new editor registers before the old one's cleanup runs. The palette must target the new editor, and no destroyed editor stays referenced. Test: Task 3, `setActiveEditor` release order.
4. **Tampered storage.** A hostile or old `tinydocy-choices.repeatBundle` or `tinydocy-formats` (unknown tokens, `"red;background:url(x)"`, a 10,000-character name, bidi overrides, 500 formats, wrong version) is discarded, stripped or capped. Applying it never writes an unknown token. Test: Task 1 `validateBundle`, Task 6 `readSavedFormats`.
5. **Repeat over a mixed selection** (title + paragraph + code block + table cells via CellSelection). fontSize is skipped only in headings and title, code gets nothing, every cell is formatted, and it is still one undo step. Test: Task 2, "mixed selection".

---

### Task 1: Format bundle core

**Files:**
- Create: `lib/format-bundle/bundle.ts`, `lib/format-bundle/index.ts`
- Modify (only if U6 lacks it): `lib/memory/remembered-choices.ts`. Add `readChoice` / `writeChoice`.
- Test: `tests/unit/lib/format-bundle.test.ts`

**Interfaces:**
- Consumes: U1 (`FontSizeValue`), U6, U7.
- Produces (all exported from `@/lib/format-bundle`):
  - `type FormatBundle = Partial<{ bold: boolean; italic: boolean; underline: boolean; strike: boolean; textColor: TextColorToken | null; highlight: HighlightToken | null; fontSize: Exclude<FontSizeValue, "md"> | null }>`.
    - A **missing key** leaves that class untouched.
    - `false` / `null` **clears** it.
    - `true` / a token **sets** it.
  - `BUNDLE_FIELDS: readonly (keyof FormatBundle)[]`, in the order bold, italic, underline, strike, textColor, highlight, fontSize.
  - `validateBundle(value: unknown): FormatBundle | null`. Allowlisted keys only. Booleans for the four marks. Tokens through the U7 guards, or `null`. Returns `null` if no valid key is left.
  - `bundleKey(b: FormatBundle): string`. Canonical and order-stable, for example `"bold:1|textColor:red"`.
  - `isEmptyBundle(b: FormatBundle): boolean`.
  - `readBundleAt(state: EditorState): Required<FormatBundle>`. This is the source for Copy formatting.
    - Reads the marks of the first text node inside the selection.
    - For an empty selection, reads `storedMarks ?? $from.marks()`.
    - Every field is present: a missing mark gives `false` / `null`.
  - `bundleFace(b): string`.
    - Short form. Lists only *set* entries, joined with `" · "`: `B`, `I`, `U`, `S`, the colour label (`Red`), `` `${label} highlight` ``, and the size `XS` / `S` / `L` / `XL`.
    - Returns `"Plain"` when nothing is set.
  - `bundleLabel(b): string`.
    - Accessible form, joined with `", "`.
    - Set entries: `Bold`, `Italic`, `Underline`, `Strikethrough`, `` `${label} text` ``, `` `${label} highlight` ``, and the size `Extra small` / `Small` / `Large` / `Extra large`.
    - Clears: `no bold`, `no italic`, `no underline`, `no strikethrough`, `no text colour`, `no highlight`, `default size`.
  - `REPEAT_BUNDLE_CHOICE: ChoiceSpec<FormatBundle | null>`: `{ key: "repeatBundle", version: 1, maxRecent: 0, validate: validateBundle, fallback: null }`.
  - `getRememberedBundle(): FormatBundle | null` and `rememberBundle(b: FormatBundle): void`.
    - Both go through `readChoice` / `writeChoice`.
    - When `REMEMBER_CHOICES_ENABLED` is false, they use a module variable instead.
    - Every write notifies `subscribeBundle(fn: () => void): () => void`, so surfaces re-render.

- [ ] **Step 1: Write the failing tests.** Build editors with `createTestEditor` plus the U7 marks.

| Test | Assertions |
|---|---|
| `validateBundle` keeps valid fields | `{bold:true,textColor:"red",fontSize:null}` → equal |
| `validateBundle` drops hostile input | `{textColor:"red;background:url(x)"}` → `null`; `{bold:"yes",italic:true,evil:1}` → `{italic:true}`; `"x"`, `null`, `[]` → `null` |
| `bundleKey` is order-stable | `bundleKey({textColor:"red",bold:true}) === bundleKey({bold:true,textColor:"red"})` |
| `readBundleAt` on bold red text | `{bold:true,italic:false,underline:false,strike:false,textColor:"red",highlight:null,fontSize:null}` |
| `readBundleAt` with an empty selection and stored marks | stored `italic` → `italic:true` |
| `bundleFace` | `{bold:true,textColor:"red",fontSize:"lg"}` → `"B · Red · L"`; `{bold:false}` → `"Plain"` |
| `bundleLabel` | `{bold:true,highlight:"yellow",fontSize:null}` → `"Bold, Yellow highlight, default size"` |
| remembered bundle round-trip | `rememberBundle(b)` then `getRememberedBundle()` deep-equals `b`; a raw `tinydocy-choices` with `repeatBundle:{textColor:"nope"}` reads as `null` |
| kill switch | `importFresh` with `NEXT_PUBLIC_REMEMBER_CHOICES=0`: after `rememberBundle`, `localStorage` has no `tinydocy-choices`, and `getRememberedBundle()` still returns `b` |

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test tests/unit/lib/format-bundle.test.ts`
Expected: FAIL, "Cannot find module '@/lib/format-bundle'".

- [ ] **Step 3: Implement `lib/format-bundle/bundle.ts`** with the signatures above. Map bundle fields to schema mark names once: `{ bold: "bold", italic: "italic", underline: "underline", strike: "strike", textColor: "textColor", highlight: "highlight", fontSize: "fontSize" }`. Read the token attribute (`color` / `size`) from U7.

- [ ] **Step 4: Run them to verify they pass**

Run: `bun test tests/unit/lib/format-bundle.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit** (review report, then wait for approval)

```bash
git add lib/format-bundle tests/unit/lib/format-bundle.test.ts lib/memory/remembered-choices.ts
git commit -m "feat(format): add the formatting bundle model"
```

---

### Task 2: RepeatFormatting extension (record, session, apply, keys)

This task carries the riskiest behaviour in PR E, so it comes before any UI.

**Session vs bundle (decided):**
- The **bundle** is the remembered value (Task 1). It survives selection changes, document switches and reloads.
- The **session** is per editor and in memory only (Tiptap `storage`). It decides whether the next local formatting *extends* the bundle or *replaces* it.
- The session closes on:
  - a local transaction whose selection differs from the session range;
  - editor destroy (that is, a document switch);
  - any undo or redo (`undoManager` `"stack-item-popped"`).
- Transactions carrying `ySyncPluginKey` meta (remote edits, undo replays) never record and never close.

**Files:**
- Create: `lib/format-bundle/relative-range.ts`, `lib/format-bundle/apply-bundle.ts`, `extensions/repeat-formatting/repeat-formatting.ts`, `extensions/repeat-formatting/index.ts`
- Modify: `components/document-editor/document-editor-config.ts`. Add `RepeatFormatting` after `CollaborationRenderOnce`.
- Test: `tests/unit/extensions/repeat-formatting.test.ts`

**Interfaces:**
- Consumes: Task 1; U7; PR B's `createCollabEditor`.
- Produces:
  - `type RelativeRange = { anchor: Y.RelativePosition; head: Y.RelativePosition }`
  - `toRelativeRange(state: EditorState, anchor: number, head: number): RelativeRange | null`. Uses `ySyncPluginKey.getState(state)?.binding`. Returns `null` without a binding.
  - `fromRelativeRange(state: EditorState, range: RelativeRange): { anchor: number; head: number } | null`. Returns `null` if either side no longer resolves.
  - `REPEAT_META = "repeatFormatting"`. Transaction meta; transactions that carry it are never recorded.
  - `sameRange(range: { anchor: number; head: number } | null, selection: Selection): boolean`. Compares `min`/`max` of both, so direction does not matter. `null` → `false`.
  - `bundlePatchFromSteps(tr: Transaction): FormatBundle`:
    - `AddMarkStep` sets the field: `true`, or the mark's token.
    - `RemoveMarkStep` clears it.
    - Later steps win. Other mark types are ignored.
  - `applyBundle(tr: Transaction, bundle: FormatBundle): Transaction`:
    - Iterates `tr.selection.ranges` (CellSelection safe).
    - Per field: `addMark` for set, `removeMark` for clear.
    - fontSize is added or removed only in textblocks that are not `heading`.
    - Code is skipped by the schema itself (`allowsMarkType` / inlineCode `excludes`).
  - `repeatDisabledReason(state: EditorState, bundle: FormatBundle | null): string | null`, with exact copy:
    - no bundle: `"Format some text first, or use Copy formatting"`
    - `NodeSelection` or empty selection: `"Select text to repeat formatting"`
    - selection entirely inside code (`parent.type.spec.code` or all text `inlineCode`): `"Code has no formatting"` (D1's copy)
    - bundle is only `fontSize` and every range is in headings: `"Headings scale automatically"`
  - Commands on `RepeatFormatting`:
    - `repeatFormatting(): boolean`. Does nothing when the reason is non-null. Otherwise:
      1. `undoManager?.stopCapturing()`
      2. dispatch `applyBundle(tr, bundle).setMeta(REPEAT_META, true)`
      3. `undoManager?.stopCapturing()`
      4. set the session to the new selection
    - `copyFormatting(): boolean`. Calls `rememberBundle(readBundleAt(state))` and closes the session.
    - `applyFormatBundle(bundle: FormatBundle): boolean`. Same transaction path as Repeat, used by Tasks 6–7. It also calls `rememberBundle(bundle)`.
  - The commands return `false` when `!editor.isEditable`. Keys are bound in Task 5 (U13), not here.
  - Storage: `{ session: RelativeRange | null }`. `onCreate` subscribes to `yUndoPluginKey.getState(state)?.undoManager.on("stack-item-popped", close)`; `onDestroy` unsubscribes and clears.

- [ ] **Step 1: Write the failing tests.** Use `createCollabEditor({ extensions: [U7 marks, RepeatFormatting, TableKit] })`. The `sel(text)` helper selects the first occurrence of `text`.

| Test | Steps → assertions |
|---|---|
| fixture has undo | `yUndoPluginKey.getState(f.editor.state)?.undoManager` is defined |
| formatting opens and extends | `sel("hello")`, toggle bold, set textColor red on the same selection → `getRememberedBundle()` = `{bold:true,textColor:"red"}` |
| new selection replaces | then `sel("world")`, set italic → bundle = `{italic:true}` |
| remote insert before the range keeps the session | `sel("hello")`, bold; `f.remote` inserts `"XX"` at paragraph start; still on the mapped selection, set red → bundle = `{bold:true,textColor:"red"}`; no remote transaction changed the bundle |
| undo closes | bold on "hello"; `editor.commands.undo()`; `sel("hello")`, italic → bundle = `{italic:true}` |
| redo closes | the same with `redo()` |
| sets, not toggles | "hello" already bold; bundle `{bold:true,textColor:"red"}`; `sel("hello world")`, `repeatFormatting()` → all bold and red; run it again → doc JSON unchanged |
| clears | bundle `{bold:false}` on bold text → no bold |
| one undo step, with a format before it | bold on "hello"; at once `sel("world")`, `repeatFormatting()`; `undo()` once → "world" plain, "hello" still bold |
| one undo step, with typing after it | `repeatFormatting()` on "world"; at once `insertContentAt(end, "!")`; `undo()` once → "!" gone, "world" still formatted; `undo()` again → "world" plain |
| mixed selection | doc = title, paragraph, codeBlock, 2×1 table; `AllSelection`, bundle `{bold:true,fontSize:"lg"}` → title bold without fontSize; paragraph bold + lg; code unchanged; then a CellSelection over both cells → both cells bold; one `undo()` reverts the last Repeat only |
| reasons | the exact copy above for: no bundle; empty selection; inside codeBlock; fontSize-only bundle in a heading |
| Copy formatting | on bold red text, `copyFormatting()` → bundle = the full 7-field read; `copyFormatting()` on plain text, then `repeatFormatting()` on bold red text → bold and colour removed |
| destroy unsubscribes | after `f.destroy()`, `undoManager._observers.get("stack-item-popped")?.size ?? 0` equals the count before the extension was created |

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test tests/unit/extensions/repeat-formatting.test.ts`
Expected: FAIL, "Cannot find module '@/extensions/repeat-formatting'".

- [ ] **Step 3: Implement** `relative-range.ts`, `apply-bundle.ts` and the extension with the signatures above. Record in `onTransaction({ transaction })`, with this rule:

```ts
if (tr.getMeta(ySyncPluginKey) || tr.getMeta(REPEAT_META)) return;
const patch = bundlePatchFromSteps(tr);
const { selection } = editor.state;
if (!isEmptyBundle(patch) && !selection.empty) {
  const same = session && sameRange(fromRelativeRange(editor.state, session), selection);
  rememberBundle(same ? { ...getRememberedBundle(), ...patch } : patch);
  session = toRelativeRange(editor.state, selection.anchor, selection.head);
} else if (tr.selectionSet && session && !sameRange(fromRelativeRange(editor.state, session), selection)) {
  session = null;
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `bun test tests/unit/extensions/repeat-formatting.test.ts tests/unit/schema && bun run typecheck`, then `E2E_BASE_URL=http://localhost:3900 CI= bun playwright test --project=perf --no-deps` (`onTransaction` runs on every keystroke).
Expected: PASS. The schema-snapshot test is unchanged (no new mark or node), and typing p95 stays within PR A's budget.

- [ ] **Step 5: Commit** (review report, then wait for approval)

```bash
git add lib/format-bundle extensions/repeat-formatting components/document-editor/document-editor-config.ts tests/unit/extensions/repeat-formatting.test.ts
git commit -m "feat(editor): repeat and copy formatting as one undo step"
```

---

### Task 3: Palette host: one window listener, active-editor ref, lazy chunk

**Files:**
- Create: `lib/editor-actions/active-editor.ts`, `components/command-palette/palette-hotkey.ts`, `components/command-palette/palette-requests.ts`, `components/command-palette/palette-host.tsx`, `components/command-palette/index.ts`
- Modify: `components/editor-app/editor-app.tsx` (render `<PaletteHost />` once), `components/document-editor/document-editor.tsx` (register the editor). Task 4 wires "All actions…" in the ⋯ menu.
- Test: `tests/unit/lib/active-editor.test.ts`, `tests/unit/components/palette-hotkey.test.ts`

**Interfaces:**
- Consumes: U1, U2.
- Produces:
  - `setActiveEditor(editor: Editor): () => void`. Returns a release function that clears the ref **only if it still holds this editor**.
  - `getActiveEditor(): Editor | null`.
  - `matchPaletteHotkey(e: Pick<KeyboardEvent, "code" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "isComposing" | "repeat">): boolean`.
  - `shouldHandlePaletteKey(target: EventTarget | null): boolean`.
    - `true` for: `null` or `body`; inside `.tiptap`; inside `[role="toolbar"]`; inside `[data-command-palette]`.
    - `false` inside any other `input`, `textarea`, `select` or `[contenteditable]`, and inside any other open `[role="dialog"]`.
  - `requestPalette(): void` and `subscribePaletteRequests(fn: () => void): () => void`.
  - `PaletteHost(): JSX.Element | null`. It owns:
    - `open` state;
    - `requested` state, which starts the lazy load;
    - the single capture listener;
    - `const CommandPalette = dynamic(() => import("./command-palette").then(m => m.CommandPalette), { ssr: false })`.

    The handler is a named function `onPaletteKey` (the Task 10 leak test finds it by name). On a match it calls `preventDefault()` + `stopPropagation()` and toggles `open`. It does nothing when `getActiveEditor()` is `null`.

- [ ] **Step 1: Write the failing tests**

| Test | Assertions |
|---|---|
| hotkey table | `{code:"Slash",altKey:true}` → true (macOS ⌥/ yields "÷", same code); `{code:"KeyZ",altKey:true,shiftKey:true}` → true; `{code:"Slash",altKey:true,ctrlKey:true}` (AltGr) → false; `{code:"Slash",altKey:true,metaKey:true}` → false; `{code:"Slash",altKey:true,shiftKey:true}` → false; `{code:"KeyZ",altKey:true}` → false; `isComposing:true` → false; `repeat:true` → false |
| target table | `<input>` in a link popover → false; `.tiptap` child → true; `<div role="dialog" data-command-palette><input></div>` → true (the palette's own rule wins over the dialog rule); `<div role="dialog">` → false; `document.body` → true |
| release order | `const ra = setActiveEditor(a); const rb = setActiveEditor(b); ra(); getActiveEditor() === b; rb(); getActiveEditor() === null` |

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test tests/unit/lib/active-editor.test.ts tests/unit/components/palette-hotkey.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement.** Mount the listener in `PaletteHost` with `useEffect(() => { window.addEventListener("keydown", onKey, { capture: true }); return () => window.removeEventListener("keydown", onKey, { capture: true }); }, [])`. `onKey` reads only `getActiveEditor()`, never a captured editor. In `DocumentEditor`, run `useEffect(() => (editor ? setActiveEditor(editor) : undefined), [editor])`. In this task `command-palette.tsx` is a stub (`export function CommandPalette() { return null; }`); Task 4 fills it.

- [ ] **Step 4: Run them to verify they pass**

Run: `bun test tests/unit/lib/active-editor.test.ts tests/unit/components/palette-hotkey.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit** (review report, then wait for approval)

```bash
git add lib/editor-actions/active-editor.ts components/command-palette components/editor-app/editor-app.tsx components/document-editor/document-editor.tsx tests/unit/lib/active-editor.test.ts tests/unit/components/palette-hotkey.test.ts
git commit -m "feat(palette): open the action palette on Alt+/ from one window listener"
```


---

### Task 4: Palette UI (cmdk) with groups, reasons, view actions, Recent (M11) and the budget

**Files:**
- Modify: `package.json`, `bun.lock` (`bun add cmdk@1.1.1`)
- Create: `components/ui/command.tsx` (hand-written shadcn `base-nova` Command: `Command`, `CommandInput`, `CommandList`, `CommandEmpty`, `CommandGroup`, `CommandItem`, `CommandShortcut`, wrapping cmdk), `lib/command-palette/palette-sections.ts`, `lib/command-palette/palette-recent.ts`, and the real `components/command-palette/command-palette.tsx`
- Create: `lib/editor-actions/actions/view.ts`, `tests/e2e/palette-budget.spec.ts`
- Modify: `lib/editor-actions/types.ts` (`"view"` group), `lib/editor-actions/registry.ts`, `lib/editor-actions/ui-requests.ts` (3 kinds), `components/document-editor/document-editor.tsx` and `components/document-editor/theme-toggle.tsx` (register handlers), U10 `overflow-menu.tsx`, `playwright.config.ts` (project `budget`), `scripts/client-js-baseline.json` and `.github/workflows/ci.yml` (U15 re-baseline and budget env)
- Test: `tests/unit/lib/palette-sections.test.ts`, `tests/e2e/command-palette.spec.ts`, `tests/e2e/palette-budget.spec.ts`

**Interfaces:**
- Consumes: U1–U6, U10, U14, U15, Task 3.
- Produces:
  - `type PaletteHeading = "Recent" | "Suggested here" | "Format" | "Insert" | "Section" | "View"`
  - `PALETTE_HEADINGS: readonly PaletteHeading[]`, in that order.
  - `PALETTE_GROUP_OF: Record<ActionGroup, Exclude<PaletteHeading, "Recent" | "Suggested here">>`: `insert` → Insert; `section` → Section; `view` and `overflow` → View; history, style, size, inline, link, block, code, table, media → Format. Because it is a `Record`, adding an `ActionGroup` later fails typecheck until it is mapped.
  - `SUGGESTED_GROUPS = ["section", "code", "table", "media"]`: D1's slot contents (§4.2), so Suggested holds copies of the slot.
  - View actions, new file `lib/editor-actions/actions/view.ts`, group `"view"` (added to `ActionGroup`), contexts `"any"`. Each runs `requestUi(editor, kind)` (U14) and returns its result:
    - `view.outline`: label "Toggle outline", kind `"toggleOutline"`, registered by `DocumentEditor` (flips the M6 outline state).
    - `view.filter`: label "Filter headings", kind `"openFilter"`, registered by `DocumentEditor` (focuses the heading filter input).
    - `view.theme`: label "Switch theme", kind `"toggleTheme"`, registered by `ThemeToggle`.
  - `OverflowMenu` gets "All actions…" with shortcut `alt+/`, calling `requestPalette()`, unless D2 already added it.
  - `type PaletteItem = { key: string; actionId: string; arg?: unknown; label: string; keywords: string[]; shortcut?: string; disabledReason?: string }`
  - `type PaletteExtra = PaletteItem & { heading: PaletteHeading }`. Later tasks inject items through this (Repeat, saved formats, templates, nudge).
  - `buildPaletteSections(input: { ctx: Ctx; actions: readonly Action[]; recentIds: readonly string[]; extras: readonly PaletteExtra[] }): { heading: PaletteHeading; items: PaletteItem[] }[]`:
    - Recent: up to 5 items, in `recentIds` order, skipping unknown ids.
    - Suggested here: actions in `SUGGESTED_GROUPS` whose `contexts` include `ctx.kind`, plus extras with that heading, up to 6.
    - Then every action under its group.
    - Empty sections are omitted.
    - Every `key` is unique.
  - `PALETTE_RECENT_CHOICE: ChoiceSpec<string[]>`: `{ key: "paletteRecent", version: 1, maxRecent: 5, validate: ids that exist in ACTIONS, fallback: [] }`.
  - `CommandPalette({ open, onOpenChange, editor }: { open: boolean; onOpenChange(open: boolean): void; editor: Editor }): JSX.Element`:
    - On open: snapshot `ctx` and the Recent list (frozen while open). Do **not** capture or rebuild the selection: ProseMirror keeps it while focus is in the dialog and y-tiptap remaps it across remote edits, and rebuilding it would turn a NodeSelection (media) or CellSelection (table) into a TextSelection.
    - On select: if the item is disabled, do nothing and keep the palette open. Otherwise close, `editor.commands.focus()` (no position), then `runAction(editor, getAction(actionId), arg)` (U3). On success, `remember` the id into Recent.
    - Esc: close and `editor.commands.focus()`.
    - The root has `data-command-palette`, a dialog title "All actions" (visually hidden) and a search placeholder "Search actions…".
    - Disabled items render `aria-disabled="true"` plus `aria-describedby` → the reason, shown as muted secondary text.

- [ ] **Step 1: Write the failing tests**

Unit (`palette-sections.test.ts`):

| Test | Assertions |
|---|---|
| order | headings appear in `PALETTE_HEADINGS` order |
| Recent | `recentIds:["mark.bold","nope"]` → Recent = `["mark.bold"]`; `mark.bold` also appears under Format |
| Suggested here | `ctx.kind:"heading"` → Suggested = `section.fold`, `section.moveUp`, `section.moveDown` and no `mark.bold`; `ctx.kind:"paragraph"` → no Suggested section |
| view actions | `view.outline` run with a registered `toggleOutline` handler calls it and returns true; with none, returns false |
| reasons | an action whose `enabled` returns `{reason:"X"}` → item has `disabledReason:"X"` |
| keys unique | across all sections, no duplicate `key` |
| extras | an extra with `heading:"Insert"` is appended to Insert |

E2E (`command-palette.spec.ts`, chromium):

| Test | Assertions |
|---|---|
| opens on Alt+/ and Alt+Shift+Z | `keyboard.press("Alt+Slash")` → `[data-command-palette]` visible; Esc → hidden, editor focused, selection unchanged; same for `Alt+Shift+KeyZ` |
| loads lazily | before the first press, `[data-command-palette]` is absent from the DOM; the press triggers at least one new `.js` request |
| runs and restores | select "hello", Alt+/, type "bold", Enter → "hello" is bold, focus is in the editor |
| keeps a node selection | select an image (NodeSelection), Alt+/, run "Media options…" from Suggested here → the media toolbar opens |
| view actions | Alt+/ → "Toggle outline" hides the outline; again shows it |
| disabled with reason | caret in a heading: "Larger text" (`size.increase`) is listed with `aria-disabled="true"` and the accessible description "Headings scale automatically"; Enter keeps the palette open |
| Recent | run "Bold" from the palette, reopen → the first group is "Recent" and contains "Bold" |
| link input keeps ÷ | focus the hyperlink URL input, press `Alt+Slash` → the palette stays closed |
| Forget clears Recent | ⋯ → "Forget my choices", reopen → no "Recent" group |
| kill switch | covered by Task 1's unit tests (needs a rebuild, so no e2e) |

Budget (`palette-budget.spec.ts`, project `budget`, production build). It runs here, before Tasks 5–9 build on cmdk:
- `PALETTE_BUDGET_BYTES = 15 * 1024`. Gzip is measured with `gzipSync` from `node:zlib` on each response body.
- Project: `{ name: "budget", testMatch: ["**/palette-budget.spec.ts"], workers: 1, use: { browserName: "chromium", baseURL: process.env.BUDGET_BASE_URL ?? "http://localhost:3900" } }`. Exclude the spec from `chromium`.
- Steps:
  1. Open a doc; wait for sync, `networkidle` and `.tiptap` visible (so the editor, colour popover and Mermaid chunks are not counted).
  2. Start recording `.js` responses.
  3. Press `Alt+Slash` and wait for `[data-command-palette]`.
  4. Sum `gzipSync(await res.body()).length` over the recorded responses.
- Assertions: the sum is `<= PALETTE_BUDGET_BYTES` and `> 0`.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test tests/unit/lib/palette-sections.test.ts` and `E2E_BASE_URL=http://localhost:3900 CI= bun playwright test --project=chromium command-palette.spec.ts`
Expected: FAIL. The unit file reports module not found; e2e times out waiting for `[data-command-palette]`.

- [ ] **Step 3: Implement** the files above. Use cmdk's default filter over `label + keywords`. Render shortcuts with U5 inside `CommandShortcut`. The dialog is the existing `components/ui/dialog.tsx`; do not modify it.

- [ ] **Step 4: Run them to verify they pass**

Run the same two commands, then `bun run check && bun run typecheck`.
Expected: PASS.

Then stop the dev server on 3900 and measure on a production build: `NEXT_PUBLIC_HOCUS_URL=ws://127.0.0.1:2034 bun next build && DB_PATH=db.sqlite bun next start -p 3900`, then `CI= bun playwright test --project=budget` and `CLIENT_JS_BUDGET_BYTES=18432 bun run size:check`.
Expected: PASS. **If the palette sum is over 15 KB, stop and report the per-chunk sizes to the owner** (cmdk 1.1.1 pulls in Radix Dialog). Do not swap libraries without a decision.

- [ ] **Step 5: Commit** (review report, then wait for approval)

```bash
git add package.json bun.lock playwright.config.ts scripts/client-js-baseline.json .github/workflows/ci.yml components/ui/command.tsx lib/command-palette lib/editor-actions components/command-palette components/document-editor components/editor-toolbar tests/unit/lib/palette-sections.test.ts tests/e2e/command-palette.spec.ts tests/e2e/palette-budget.spec.ts
git commit -m "feat(palette): list every action by group with reasons and recent picks"
```

---

### Task 5: Repeat surfaces: registry actions, Formats menu, bubble split, style dropdown, palette

**Files:**
- Create: `lib/editor-actions/actions/format-memory.ts` (appended to U2), `hooks/use-remembered-bundle.ts`, `components/tiptap-ui/formats-menu/formats-menu.tsx`, `components/tiptap-ui/formats-menu/index.ts`, `components/tiptap-ui/repeat-split/repeat-split.tsx`, `components/tiptap-ui/repeat-split/index.ts`
- Modify: U8 bubble (add `RepeatSplit` after the link item), U10 `style-menu.tsx` (append a Formats group), U13 `extensions/editor-action-shortcuts/` (Repeat keys), `lib/editor-actions/registry.ts`, `lib/icons.tsx` (export `RepeatIcon` = lucide `Repeat2`)
- Test: `tests/unit/lib/format-memory-actions.test.ts`, `tests/e2e/repeat-formatting.spec.ts`

**Interfaces:**
- Consumes: U1–U3, U8, U10, U13; Tasks 1–4.
- Produces:
  - `FORMAT_MEMORY_ACTIONS: Action[]` with these entries:
    - `format.repeat`: label "Repeat formatting", group `inline`, contexts `"any"`, keywords `["format painter","again","f4"]`, shortcut `mod+alt+v`. `enabled` comes from `repeatDisabledReason`. `run` calls `repeatFormatting()`.
    - `format.copy`: label "Copy formatting", group `inline`, no shortcut. Disabled in code with "Code has no formatting".
  - U13 keys: `"Mod-Alt-v"` and, when `!isMac()`, `"F4"`, each `() => runAction(this.editor, getAction("format.repeat"))`.
  - `useRememberedBundle(): FormatBundle | null`, via `useSyncExternalStore(subscribeBundle, getRememberedBundle, () => null)`.
  - `RepeatSplit({ editor }: { editor: Editor }): JSX.Element | null`:
    - Renders nothing when there is no bundle.
    - Face button: text `↻ ${bundleFace(b)}`, `aria-label` `` `Repeat formatting: ${bundleLabel(b)}` ``.
    - Chevron: `aria-label` "More formatting options", `aria-haspopup="menu"`, opens `FormatsMenu`.
    - Both are ≥24×24.
  - `FormatsMenu({ editor, sections }: { editor: Editor; sections: FormatsMenuSection[] })`, where `type FormatsMenuSection = "repeat" | "copy" | "save" | "yours" | "in-doc"`:
    - It is a shadcn `DropdownMenuContent` body.
    - Here it renders "repeat" and "copy". Tasks 6 and 7 fill the others.
    - The bubble passes all five.
  - The style dropdown appends a `DropdownMenuGroup` labelled "Formats": "Repeat formatting: <face>" and "Copy formatting" (Task 6 adds Your formats and "Save as format…").
  - Palette extra: when a bundle exists, Repeat also appears under "Suggested here" with label `` `Repeat formatting: ${bundleFace(b)}` ``.

- [ ] **Step 1: Write the failing tests**

Unit: `format.repeat.enabled(ctx)` returns each Task 2 reason; `ACTIONS` contains both ids exactly once.

E2E (`repeat-formatting.spec.ts`, chromium). `repeatKey` is `process.platform === "darwin" ? "Meta+Alt+KeyV" : "F4"`, because F4 is bound only off macOS:

| Test | Assertions |
|---|---|
| repeat key works | select "alpha", Mod+B, choose Red in the colour popover; select "beta", press `repeatKey` → "beta" has `<strong>` and `data-text-color="red"` |
| Ctrl+Alt+V repeats (Linux/Windows) | `test.skip(process.platform === "darwin")`; select "gamma", press `Control+Alt+KeyV` → formatted |
| sets, not toggles | "beta" already bold; `repeatKey` again → still bold |
| one undo step | right after `repeatKey`, `ControlOrMeta+Z` once → "beta" plain, "alpha" still formatted |
| bubble face | select "delta" → bubble button named `Repeat formatting: Bold, Red text`, text `↻ B · Red`; click → formatted |
| chevron opens the Formats menu | the chevron opens a `menu` with "Repeat formatting: B · Red" and "Copy formatting" |
| Copy formatting | Formats menu → Copy formatting on "alpha"; select plain "zeta", `repeatKey` → "zeta" bold + red |
| style dropdown | the style dropdown contains "Repeat formatting: B · Red" |
| palette | Alt+/, type "repeat", Enter → formatted; in code the entry says "Code has no formatting" |
| read-only | after the document turns read-only (PR B's refusal hook), `repeatKey` changes nothing |
| F4 not swallowed | `test.skip(process.platform === "darwin")`; no bundle (fresh context): F4 in the editor does nothing and the page still receives the keydown (`defaultPrevented === false`) |

Manual check (record the result in the PR): on macOS Chrome and Safari, ⌘⌥V repeats. On Windows with the Czech layout, AltGr+V types "@" and F4 repeats.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test tests/unit/lib/format-memory-actions.test.ts` and `E2E_BASE_URL=http://localhost:3900 CI= bun playwright test --project=chromium repeat-formatting.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** the files above.

- [ ] **Step 4: Run them to verify they pass**

Run the same two commands, plus D's bubble-in-row and axe specs (`--project=chromium a11y toolbar`).
Expected: PASS, with axe still reporting 0 serious.

- [ ] **Step 5: Commit** (review report, then wait for approval)

```bash
git add lib/editor-actions extensions/editor-action-shortcuts components/editor-toolbar hooks/use-remembered-bundle.ts components/tiptap-ui/formats-menu components/tiptap-ui/repeat-split lib/icons.tsx tests/unit/lib/format-memory-actions.test.ts tests/e2e/repeat-formatting.spec.ts
git commit -m "feat(toolbar): offer repeat and copy formatting in the bubble, style menu and palette"
```

(Also stage the U8 bubble file by its real path.)

---

### Task 6: Your formats (M14): store, Save as format…, nudge, apply

**Files:**
- Create: `lib/memory/saved-formats.ts`, `lib/memory/format-nudge.ts`, `components/tiptap-ui/formats-menu/save-format-dialog.tsx`, `components/tiptap-ui/formats-menu/format-nudge.tsx`
- Modify: `extensions/repeat-formatting/repeat-formatting.ts` (call `noteRepeat` after a successful Repeat), `components/tiptap-ui/formats-menu/formats-menu.tsx` ("save" and "yours" sections), U10 `style-menu.tsx`, `lib/editor-actions/actions/format-memory.ts` (`format.save`), `components/tiptap-ui/repeat-split/repeat-split.tsx` (renders `FormatNudge`), `components/command-palette/command-palette.tsx` (extras)
- Test: `tests/unit/lib/saved-formats.test.ts`, `tests/e2e/your-formats.spec.ts`

**Interfaces:**
- Consumes: Tasks 1, 2 (`applyFormatBundle`), 4 (`PaletteExtra`), 5.
- Produces:
  - `type SavedFormat = { id: string; name: string; bundle: FormatBundle }`
  - `FORMATS_STORAGE_KEY = "tinydocy-formats"`, `FORMATS_VERSION = 1`, `MAX_SAVED_FORMATS = 20`, `MAX_FORMAT_NAME = 40`
  - `sanitizeFormatName(raw: string): string`. Strips `/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g`, collapses whitespace, trims, and cuts to 40 code points.
  - `readSavedFormats(): SavedFormat[]`:
    - Wraps the read in try/catch.
    - Discards a wrong version.
    - Drops entries whose bundle fails `validateBundle` or whose sanitized name is empty.
    - Removes duplicate names (first wins) and caps at 20.
  - `saveFormat(name: string, bundle: FormatBundle): { ok: true; format: SavedFormat } | { ok: false; reason: string }`:
    - A name that already exists replaces that entry, keeping its id.
    - Reasons: `"Use 1–40 characters"`; `"You can keep up to 20 formats. Remove one first."`
  - `removeFormat(id: string): void` and `subscribeSavedFormats(fn): () => void`.
  - "Forget my choices" does **not** touch this key, and the kill switch does not disable it.
  - Nudge, per page session, in memory only:
    - `noteRepeat(bundle: FormatBundle): void` counts by `bundleKey`.
    - `pendingNudge(): FormatBundle | null`. Set on the **3rd** Repeat of the same key, unless that key was dismissed or saved.
    - `dismissNudge(key: string): void` and `subscribeNudge(fn): () => void`.
    - This task adds the `noteRepeat(bundle)` call to Task 2's `repeatFormatting()`, after a successful dispatch.
  - `FormatNudge` copy, verbatim:
    - text `` `Save “${bundleFace(b)}” as a format?` ``
    - buttons "Save as format…" and "Not now"
    - The container has `role="status"`. It never takes focus.
    - It renders inside `RepeatSplit` (bubble) and as a "Suggested here" palette extra.
  - `SaveFormatDialog`:
    - shadcn `Dialog` titled "Save as format".
    - Field label "Name", prefilled with `bundleFace(readBundleAt(state))`.
    - Button "Save". It saves the **set entries only** of the selection's formatting: `readBundleAt` minus every `false` / `null` field. A saved format only adds marks; it never strips italic from its target. From the nudge, Save stores the **nudged bundle** (its set entries), not a fresh read of the selection.
    - An all-plain selection gives an empty bundle; Save then shows "Select formatted text to save it as a format".
    - An error shows inline under the field.
    - On close, `editor.commands.focus()` (no position); the selection is the one ProseMirror kept.
  - `format.save`: "Save as format…", always enabled except in read-only and code.
  - Apply surfaces:
    - Formats menu "Your formats" lists each `name` as an item that calls `applyFormatBundle(bundle)`.
    - A "Remove a format" submenu lists the names.
    - The style dropdown "Formats" group lists the same items plus "Save as format…".
    - The palette adds an extra `` `Apply format: ${name}` `` under Format for each saved format, plus "Save as format…".

- [ ] **Step 1: Write the failing tests**

Unit (`saved-formats.test.ts`):

| Test | Assertions |
|---|---|
| round-trip | `saveFormat("Warning", {bold:true,textColor:"red"})` → `readSavedFormats()` has one entry with that bundle |
| sanitizing | `sanitizeFormatName("\u202Eevil\u0007 name ")` → `"evil name"`; a 10,000-character name → 40 code points; `"   "` → `saveFormat` returns `{ok:false, reason:"Use 1–40 characters"}` |
| cap | 20 saves succeed, the 21st returns the cap reason; a raw store with 500 entries reads as 20 |
| tamper | raw `{v:1,formats:[{id:"a",name:"x",bundle:{textColor:"red;background:url(x)"}}]}` → `[]`; `{v:9,...}` → `[]`; non-JSON → `[]`, no throw |
| same name replaces | saving "Warning" twice keeps one entry with the second bundle and the same id |
| Forget leaves it | after U6's forget function, `readSavedFormats()` is unchanged |
| nudge on the 3rd repeat | `noteRepeat(b)` twice → `pendingNudge() === null`; third → deep-equals `b`; `dismissNudge(bundleKey(b))` then a 4th → `null` |

E2E (`your-formats.spec.ts`): select "alpha" (bold + red), bubble chevron → "Save as format…" → name "Warning" → Save. Then select "beta" → Formats menu → "Warning" → "beta" bold + red, and one undo reverts it. Reload → "Warning" is still listed. Repeat 3× by clicking the bubble's ↻ face on three new selections (the bubble hides on keystrokes, so keyboard repeats show the nudge only at the next selection) → the bubble shows the "Save “B · Red” as a format?" status, and focus stays in the editor. "Not now" hides it for the session.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test tests/unit/lib/saved-formats.test.ts` and `E2E_BASE_URL=http://localhost:3900 CI= bun playwright test --project=chromium your-formats.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** the files above.

- [ ] **Step 4: Run them to verify they pass**

Run the same commands.
Expected: PASS.

- [ ] **Step 5: Commit** (review report, then wait for approval)

```bash
git add lib/memory/saved-formats.ts lib/memory/format-nudge.ts extensions/repeat-formatting components/editor-toolbar components/tiptap-ui/formats-menu components/tiptap-ui/repeat-split lib/editor-actions/actions/format-memory.ts components/command-palette tests/unit/lib/saved-formats.test.ts tests/e2e/your-formats.spec.ts
git commit -m "feat(toolbar): save personal formats and suggest saving a repeated one"
```

---

### Task 7: "In this doc" (M12): swatch dots and Formats menu section

**Files:**
- Create: `lib/format-bundle/scan-doc-formats.ts`
- Modify: U9 colour popover (dots), `components/tiptap-ui/formats-menu/formats-menu.tsx` ("in-doc" section)
- Test: `tests/unit/lib/scan-doc-formats.test.ts`, `tests/e2e/in-this-doc.spec.ts`

**Interfaces:**
- Consumes: Task 1, Task 2 (`applyFormatBundle`), U7, U9.
- Produces:
  - `DOC_SCAN_MAX_TEXT_NODES = 5000` and `DOC_SCAN_MAX_ENTRIES = 8`.
  - `scanDocFormats(doc: Node, limits?: { maxTextNodes?: number; maxEntries?: number }): { textColors: Set<TextColorToken>; highlights: Set<HighlightToken>; bundles: FormatBundle[]; truncated: boolean }`:
    - It walks text nodes with `doc.descendants` and stops (returns `false`) once the cap is reached.
    - A text node qualifies for `bundles` only if it carries `textColor`, `highlight` or `fontSize`.
    - Its bundle holds only the *set* entries.
    - Bundles are ranked by total characters, descending, with ties going to the first occurrence. At most 8 are kept.
  - Colour popover: on open (not on render), it calls `scanDocFormats(editor.state.doc)` once.
    - Each swatch whose token is used gets a 6px dot (`aria-hidden`).
    - Its accessible name gains the suffix ", used in this document".
  - Formats menu "In this doc" group: scanned when the menu opens. One item per bundle, labelled `bundleFace(b)`, which calls `applyFormatBundle(b)`. The group is hidden when the scan finds nothing.
  - Nothing from the scan is written to any storage.

- [ ] **Step 1: Write the failing tests**

| Test | Assertions |
|---|---|
| sets | doc with red text and a yellow highlight → `textColors` = {red}, `highlights` = {yellow} |
| bundles ranked | 30 chars of bold+red and 5 chars of `lg` → `bundles[0]` = `{bold:true,textColor:"red"}`, `bundles[1]` = `{fontSize:"lg"}` |
| plain bold excluded | bold-only text → `bundles` = `[]` |
| caps | 6,000 text nodes each with a distinct colour/size combination → `truncated === true`; `bundles.length <= 8`; finishes in < 50 ms |
| never stored | `localStorage.length` is unchanged after a scan |

E2E: a doc with red text → the colour popover's Red swatch is named "Red, used in this document". The Formats menu shows "In this doc" with "Red"; applying it to "beta" makes it red.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test tests/unit/lib/scan-doc-formats.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** the scan and the two UI hooks above.

- [ ] **Step 4: Run them to verify they pass**

Run: `bun test tests/unit/lib/scan-doc-formats.test.ts` and `E2E_BASE_URL=http://localhost:3900 CI= bun playwright test --project=chromium in-this-doc.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit** (review report, then wait for approval)

```bash
git add lib/format-bundle/scan-doc-formats.ts components/tiptap-ui/formats-menu tests/unit/lib/scan-doc-formats.test.ts tests/e2e/in-this-doc.spec.ts
git commit -m "feat(toolbar): mark colours used in this document and list its formats"
```

(Also stage the U9 colour popover file by its real path.)

---

### Task 8: Mermaid templates (M17b)

**Files:**
- Create: `lib/mermaid-templates.ts`
- Modify: `lib/editor-actions/actions/insert.ts` (`insert.diagram`), U10 `insert-menu.tsx` (Diagram item → submenu), `components/command-palette/command-palette.tsx` (5 extras under Insert)
- Test: `tests/unit/lib/mermaid-templates.test.ts`, `tests/e2e/mermaid-templates.spec.ts`

**Interfaces:**
- Consumes: U1–U3, U6, Task 4.
- Produces:
  - `type MermaidTemplateId = "flowchart" | "sequence" | "state" | "mindmap" | "pie"`
  - `MERMAID_TEMPLATES: readonly { id: MermaidTemplateId; label: string; source: string }[]`, in this order.
  - `MERMAID_TEMPLATE_CHOICE: ChoiceSpec<MermaidTemplateId>`: `{ key: "mermaidTemplate", version: 1, maxRecent: 0, validate: id ∈ MERMAID_TEMPLATES, fallback: "flowchart" }`.
  - `insert.diagram.run(editor, arg?: MermaidTemplateId)`:
    - Inserts with `editor.chain().focus().insertMermaid(template.source).run()`.
    - `arg` defaults to the remembered template.
    - On success it remembers `arg`.
  - The Insert dropdown "Diagram" becomes a `DropdownMenuSub` with the 5 labels. The remembered one gets the description "Last used" and is focused first when the submenu opens.
  - Palette extras: `` `Insert diagram: ${label}` `` × 5 under Insert.

Template copy (verbatim):

```ts
export const MERMAID_TEMPLATES = [
  { id: "flowchart", label: "Flowchart", source: "flowchart LR\n  Start([Start]) --> Step[Do the work]\n  Step --> Check{Done?}\n  Check -->|Yes| Finish([Finish])\n  Check -->|No| Step" },
  { id: "sequence", label: "Sequence", source: "sequenceDiagram\n  participant A as Alice\n  participant B as Bob\n  A->>B: Hello Bob\n  B-->>A: Hi Alice" },
  { id: "state", label: "State", source: "stateDiagram-v2\n  [*] --> Draft\n  Draft --> Review\n  Review --> Draft: changes requested\n  Review --> Published\n  Published --> [*]" },
  { id: "mindmap", label: "Mind map", source: "mindmap\n  root((Topic))\n    Idea one\n    Idea two\n    Idea three" },
  { id: "pie", label: "Pie chart", source: "pie title Share of time\n  \"Writing\" : 50\n  \"Reviewing\" : 30\n  \"Meetings\" : 20" },
] as const;
```

- [ ] **Step 1: Write the failing tests**

Unit:
- There are 5 unique ids.
- Each source starts with its diagram keyword: `flowchart`, `sequenceDiagram`, `stateDiagram-v2`, `mindmap`, `pie`.
- Each source is shorter than the extension's max-source option.
- `validate("evil")` fails, so a tampered choice falls back to `"flowchart"`.

E2E:
- For each label: Insert ▾ → Diagram ▸ → label. A mermaid block appears and renders an `svg` within 10 s.
- After picking "Sequence", reopening the submenu focuses "Sequence" with "Last used".
- Alt+/ → "Insert diagram: Pie chart" inserts a pie.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test tests/unit/lib/mermaid-templates.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** the files above.

- [ ] **Step 4: Run them to verify they pass**

Run: `bun test tests/unit/lib/mermaid-templates.test.ts` and `E2E_BASE_URL=http://localhost:3900 CI= bun playwright test --project=chromium mermaid-templates.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit** (review report, then wait for approval)

```bash
git add lib/mermaid-templates.ts lib/editor-actions components/editor-toolbar components/command-palette tests/unit/lib/mermaid-templates.test.ts tests/e2e/mermaid-templates.spec.ts
git commit -m "feat(toolbar): insert diagrams from five templates and remember the last"
```

(Also stage `components/editor-toolbar/insert-menu.tsx`.)

---

### Task 9: Mobile selection swap (§4.7) and the WebKit iPhone project

**Files:**
- Create: `components/document-editor/mobile-selection-tools.tsx`, `components/document-editor/use-mobile-bar-mode.ts`
- Modify: U11 `components/document-editor/mobile-toolbar-content.tsx`, `components/document-editor/document-editor.scss`, `playwright.config.ts` (only if U11's project is missing), `.github/workflows/ci.yml` (only if D2 did not already install WebKit and run `webkit-ios`)
- Test: `tests/unit/components/use-mobile-bar-mode.test.ts`, `tests/e2e/mobile-selection-swap.spec.ts`

**Interfaces:**
- Consumes: U1–U3, U11; Task 5 (`format.repeat`).
- Produces:
  - `type MobileBarMode = "all" | "selection"`.
  - `nextMobileBarMode(input: { hasTextSelection: boolean; focusInBar: boolean; dismissedForSelection: boolean; current: MobileBarMode }): MobileBarMode`:
    - When `focusInBar` is true, return `current` (no swap under focus).
    - Otherwise return `"selection"` iff `hasTextSelection && !dismissedForSelection`.
  - `useMobileBarMode(editor: Editor, barRef: RefObject<HTMLElement>): { mode: MobileBarMode; dismiss(): void }`:
    - `hasTextSelection` = non-empty `TextSelection` (or CellSelection) from the version store (U4).
    - `dismiss()` holds `"all"` until the selection's from/to changes.
    - On `focusout` from the bar, it re-evaluates.
  - `MobileSelectionTools`: the cells are registry views, in order: `mark.bold`, `mark.italic`, `mark.underline`, `mark.strike`, text colour, highlight, `link.open`, `format.clear`, `format.repeat`, then ✕.
    - ✕ is a button named "Back to all tools" that calls `dismiss()`.
    - The same `role="toolbar"` element keeps U11's existing label (written "Formatting" below) and changes it to "Selection formatting" while swapped.
    - The cell list scrolls horizontally inside the bar (`overflow-x: auto`, `overscroll-behavior-x: contain`). ✕ is `position: sticky; inset-inline-end: 0` so it is always visible. The page never scrolls sideways.
    - Each cell is 44×44, and active states use `aria-pressed`.
  - Playwright project, if missing: `{ name: "webkit-ios", testMatch: ["**/mobile-*.spec.ts"], use: { ...devices["iPhone 13"] } }`. Exclude `**/mobile-*.spec.ts` from `chromium` only if D2 did. Setup: `bun playwright install webkit`.

- [ ] **Step 1: Write the failing tests**

Unit (`nextMobileBarMode` table):
- `{true,false,false,"all"}` → `"selection"`
- `{true,true,false,"all"}` → `"all"`
- `{false,true,false,"selection"}` → `"selection"`
- `{false,false,false,"selection"}` → `"all"`
- `{true,false,true,"all"}` → `"all"`

E2E (`mobile-selection-swap.spec.ts`, project `webkit-ios`):

| Test | Assertions |
|---|---|
| swaps on selection | select "hello" (`__tiptap_editor.commands.setTextSelection`) → the toolbar's `aria-label` is "Selection formatting"; buttons Bold … "Back to all tools" visible; tap Bold → "hello" bold; Bold has `aria-pressed="true"` |
| one toolbar | `getByRole("toolbar")` inside the bar has count 1 in both modes |
| ✕ returns | tap "Back to all tools" → label "Formatting", selection unchanged; select other text → swaps again |
| collapsing returns | collapse the selection → "Formatting" |
| no swap under focus | focus the bar's Undo cell (`.focus()`), then set a text selection → still "Formatting"; blur the bar → "Selection formatting" |
| no sideways scroll | in both modes `document.documentElement.scrollWidth <= clientWidth`; "Back to all tools" lies inside the viewport |
| Repeat cell | with a bundle, the "Repeat formatting: …" cell formats the selection |

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test tests/unit/components/use-mobile-bar-mode.test.ts` and `E2E_BASE_URL=http://localhost:3900 CI= bun playwright test --project=webkit-ios mobile-selection-swap.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** the files above. If CI lacks WebKit, add `chromium webkit` to the e2e job's `bun playwright install --with-deps` step and `--project=webkit-ios` to its run step, keeping SHA pins and read-only permissions.

- [ ] **Step 4: Run them to verify they pass**

Run the same commands, plus `bun test tests/unit/ci/workflow-permissions.test.ts`.
Expected: PASS.

- [ ] **Step 5: Commit** (review report, then wait for approval)

```bash
git add components/document-editor tests/unit/components/use-mobile-bar-mode.test.ts tests/e2e/mobile-selection-swap.spec.ts playwright.config.ts .github/workflows/ci.yml
git commit -m "feat(mobile): swap the phone bar to selection tools in place"
```

---

### Task 10: HoE gates (leaks, nightly budget), docs and CHANGELOG

**Files:**
- Modify: `.github/workflows/nightly.yml` (run the Task 4 `budget` project in the existing production-build job), U12 `tests/e2e/toolbar-leaks.spec.ts`, `README.md` (features + shortcuts), `tests/TESTING.md` (`budget` and `webkit-ios` projects, ports), `CHANGELOG.md` (Unreleased)
- Test: the leak spec; the Task 4 budget spec in nightly

**Interfaces:**
- Consumes: Tasks 3–9; U12.
- Produces:
  - Nightly: the production-build job also runs `--project=budget` with `BUDGET_BASE_URL` pointing at its server.
  - Leak test: reuses U12's measuring code (listener counts on `window` and `document`, heap after `collectGarbage`).

- [ ] **Step 1: Write the specs**

New leak test in `toolbar-leaks.spec.ts` (chromium), "20 tab switches and 100 palette and bubble cycles return to baseline":
1. Warm up: one palette open/close, one bubble show/hide, 2 tab switches.
2. Take a baseline with `measure`.
3. Run 20 tab switches (click `[data-tab-id]` alternately, `waitForSync`).
4. Run 100 cycles. Each cycle: `Alt+Slash`, `Escape`, select "hello" (the bubble shows), `ArrowRight` (the bubble hides).

Assertions:
- listener counts on `window` and `document` equal the baseline;
- heap `usedSize <= baseline * 1.05`;
- exactly 1 capture `keydown` listener on `window` owned by the palette host (by function name `onPaletteKey`), before and after.

- [ ] **Step 2: Wire the budget into nightly**

Add `--project=budget` to the nightly production-build job, then run `bun test tests/unit/ci/workflow-permissions.test.ts`.
Expected: PASS.

- [ ] **Step 3: Run the leak spec on dev**

Run: `E2E_BASE_URL=http://localhost:3900 CI= bun playwright test --project=chromium toolbar-leaks.spec.ts`
Expected: PASS. If it fails, look for what each cycle leaves behind. Likely sources: the undo `stack-item-popped` listener, the version-store subscriptions, the cmdk instance, and `setActiveEditor` releases.

- [ ] **Step 4: Update docs.** Add these, then run the full suites below:
  - README: the feature line "Action palette (Alt+/, or Alt+Shift+Z)", "Repeat formatting (⌘⌥V / Ctrl+Alt+V / F4)", "Your formats".
  - TESTING.md: the `budget` and `webkit-ios` projects, and the 3900/2034 commands.
  - CHANGELOG, under **Unreleased**, a PR group with Added entries for the palette, Repeat/Copy formatting, Your formats, In this doc, Mermaid templates and the mobile selection swap. No Deploy note: there is no schema or env change, and `NEXT_PUBLIC_REMEMBER_CHOICES` already exists.

Run: `bun run test && bun run check && bun run lint && bun run typecheck && bun run build`, then `E2E_BASE_URL=http://localhost:3900 CI= bun playwright test --project=chromium --project=webkit-ios` and `E2E_BASE_URL=http://localhost:3900 CI= bun playwright test --project=perf --no-deps`
Expected: everything passes. Open the app at 1280 px and at the iPhone 13 size, take screenshots of the palette, the bubble with ↻ and the nudge, the Formats menu, and the phone selection bar, and check them.

- [ ] **Step 5: Commit** (review report, then wait for approval). Use two atomic commits:

```bash
git add tests/e2e/toolbar-leaks.spec.ts .github/workflows/nightly.yml
git commit -m "test(toolbar): assert no leaks across tab and palette cycles and run the palette budget nightly"
git add README.md tests/TESTING.md CHANGELOG.md
git commit -m "docs: record the v1.1 toolbar palette and formatting memory"
```

---

## Go checklist (HoE → E), mapped to tasks

| Criterion | Where |
|---|---|
| D's metrics held 14 days in production | Global Constraints (merge precondition, owner) |
| palette + cmdk ≤ 15 KB gz on first Alt+/ | Task 4 `budget` project; nightly from Task 10 |
| listeners and heap back to baseline after 20 tab switches + 100 palette/bubble cycles | Task 10 leak test |
| Repeat is one undo step; sets, not toggles; F4 works | Task 2 unit tests, Task 5 e2e |
| mobile swap passes the WebKit/iOS project | Task 9 (`webkit-ios`) |
