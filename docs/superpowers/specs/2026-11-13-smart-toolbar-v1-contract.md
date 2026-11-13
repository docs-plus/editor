# Smart toolbar v1: shared contract for PR C, D1, D2 and E

Status: **binding for the parallel build** (revision 2, after the HoE and staff review) · Date: 2026-11-13 · Base: `integrate/smart-toolbar-v1`, synced with the `integrate/smart-toolbar-ab` tip `58a9d22` (PR A + PR B) · Skeleton commits: see §9

This document is the interface between four tracks that different engineers build at the same time. The design lives in [the spec](2026-11-12-smart-toolbar-design.md). This document fixes only **names, signatures, file ownership, merge order and release order**.

The skeleton commits already put every shared module in place with stub bodies, so each track compiles against the others from the start. `tests/unit/editor-actions/contract.test.ts` pins the shapes. A track that needs to change a pinned shape changes this document and the test in the same commit, and tells the other tracks.

## 1. Tracks, merge order, release order, scope

| Track | Branch | Scope (spec §) |
|---|---|---|
| **C**: schema | `feat/smart-toolbar-c-schema` | `textColor`/`fontSize` marks, highlight value tokens + legacy mapping, render-time enforcement, paste rules, server allowlist entries, `SCHEMA_FLOOR = 2` (§3, §3.1, §8.3) |
| **D1**: registry + row | `feat/smart-toolbar-d1-registry` | action registry, context snapshot + store, `ActionButton`, sorted row, context slot, ⋯ overflow, keyboard model (roving tabindex, Alt+F10, Esc), clear formatting, indent action, M5 (§2, §4.1, §4.2, §6) |
| **D2**: surfaces + memory | `feat/smart-toolbar-d2-surfaces` | memory layer + Forget, colour popover + split faces (M1–M3), size stepper, list (M9), Insert menu with Table, colours and size on phones, editor chunk-size gate (§4.3, §4.5–4.7, §5) |
| **E**: v1.1 | `feat/smart-toolbar-e-v11` | Alt+/ palette (lazy) + M11, Repeat/Copy formatting (M7), Your formats (M14), In this doc (M12), Mermaid templates (M17b), mobile selection swap (§4.4, §5). **Not merged into v1** (below). |

### 1.1 Merge order
- **C and D1 are independent.** Whichever is green first merges first into `integrate/smart-toolbar-v1`. The other rebases on it.
- **D2 rebases on both C and D1**, then merges. D2 needs C's commands and D1's row, `coreActions` and `ActionButton`. Bubble B/I/U cannot be tested end to end before D1 lands.
- **E is never merged into `integrate/smart-toolbar-v1`.** It stays on its own stacked branch and PR, based on v1. Spec §8 lets E go only after D's metrics have held for 14 days in production. Retarget E's PR to `main` before v1 merges, so it is not stranded.
- Before each merge the track rebases, then re-runs `bun run check`, `lint`, `typecheck`, `test` and its e2e (§5.4 ports). The tracks build in parallel against the stubs, so only the shared-file hunks in §5.2 should conflict.

### 1.2 Release order (spec §3.1; never collapse these steps)
1. **Release N = `integrate/smart-toolbar-ab` → `main`, as its own PR and its own deploy.** It ships with the gate log-only. v1 is not part of it.
2. **Wait for the N+1 ship gates** while N runs in production:
   - ≥ 95% of connections on `schema=2` over a trailing 24 h, held for ≥ 48 h;
   - the refused-client soak;
   - the mixed-version soak;
   - the hostile tests;
   - the staging drill (env 0, effective minimum still 2).
3. **v1 (C + D1 + D2) → `main` is a later PR.** It is not deployed until step 2 passes. When it is, the deploy follows C's Deploy note (§2.3): restart Hocus first, confirm refusals in the log, then restart Next.
4. **E** follows as its own PR, after D's metrics hold for 14 days.

`integrate/smart-toolbar-v1` contains A + B (it was synced to stay current). It must never reach `main` before `integrate/smart-toolbar-ab` has, as its own release.

### 1.3 Scope for the ~2-hour build window
**"Done" in this window means code-complete, tested and committed locally on the track branch.** It does not mean shippable, and nothing is pushed. Shippable is §1.2.

The cuts never drop safety. That covers spec §3.1, HoE B1–B4, the memory privacy rules and the typing-perf assertion.

| Track | KEEP (this window) | DEFER (later, tracked) |
|---|---|---|
| **C** | <ul><li>Allowlist entries, `SCHEMA_FLOOR` + `effectiveMinClientSchema` + gate matrix</li><li>Marks with commands</li><li>Render-time enforcement + the `red;background:url(x)` fuzz</li><li>Paste rules, tested on synthetic Docs/Word fixtures and flagged *not checked against a real clipboard*</li><li>Contrast test, snapshot update</li><li>N vs N+1 test, Deploy note (§2.3, §7)</li></ul> | <ul><li>The `afterLoadDocument` highlight-value rewrite: cleanup only, and a mutating migration, so it is safer deferred. **This deviates from spec §3.1's N+1 contents.** Rendering already maps legacy values.</li><li>The 50k colour soak, moved to nightly.</li></ul> |
| **D1** | <ul><li>Registry, snapshot (TDD), store</li><li>Read-only reasons</li><li>`ActionButton`</li><li>Sorted row; heading/title/code slot kinds</li><li>Roving + Alt+F10 + Esc</li><li>Clear formatting, indent</li></ul> | <ul><li>M4 (it waits on D2 anyway)</li><li>Table, Mermaid and media slot kinds, if time runs out</li></ul> |
| **D2** | <ul><li>Memory layer + Forget + tamper test + kill switch</li><li>Colour popover + split faces M1–M3</li><li>Size stepper</li><li>List M9</li><li>Insert menu with Table</li><li>Colours and size reachable on phones (minimum: add `ColorControls` and `FontSizeStepper` to the existing mobile bar)</li><li>Editor chunk-size gate</li></ul> | <ul><li>Selection bubble</li><li>T2–T5 collapse menus beyond what keeps `scrollWidth ≤ clientWidth`</li><li>Outline overlay < 950px</li><li>M10 face, M17a</li></ul> |
| **E** | <ul><li>Its engineer pairs with D2, or owns the bundle and perf gates (§5.1).</li><li>E's own branch work is optional in this window and never merges into v1.</li></ul> | <ul><li>All of the E scope above, until D's 14-day bake</li></ul> |

## 2. PR C: tokens, marks, commands, server

### 2.1 `lib/text-style-tokens.ts` (exists, data complete; C owns)
```ts
export { HIGHLIGHT_TOKENS, type HighlightToken };          // from lib/highlight-tokens.ts
export const TEXT_COLOR_MARK = "textColor";
export const FONT_SIZE_MARK = "fontSize";
export const HIGHLIGHT_MARK = "highlight";
export const TEXT_COLOR_ATTR = "data-text-color";
export const FONT_SIZE_ATTR = "data-font-size";
export const HIGHLIGHT_ATTR = "data-highlight";
export const TEXT_COLOR_TOKENS = HIGHLIGHT_TOKENS;        // gray brown red orange yellow green teal blue purple pink
export type TextColorToken = HighlightToken;
export const FONT_SIZE_TOKENS = ["xs", "sm", "lg", "xl"] as const;   // mark values
export type FontSizeToken = (typeof FONT_SIZE_TOKENS)[number];
export const FONT_SIZE_LADDER = ["xs", "sm", "md", "lg", "xl"] as const; // "md" = no mark
export type FontSizeStep = (typeof FONT_SIZE_LADDER)[number];
export const FONT_SIZE_EM: Readonly<Record<FontSizeStep, number>>;   // .75 .875 1 1.25 1.5
export interface ThemedColor { light: string; dark: string }
export const TEXT_COLOR_PALETTE: Readonly<Record<TextColorToken, ThemedColor>>; // Appendix A
export const HIGHLIGHT_PALETTE: Readonly<Record<HighlightToken, ThemedColor>>;  // Appendix A
export function isTextColorToken(value: unknown): value is TextColorToken;
export function isFontSizeToken(value: unknown): value is FontSizeToken;
```
Rules:
- Token values are append-only.
- C adds the contrast unit test (spec §3): every text token ≥ 4.5:1 and every token ≥ 3:1, on both page backgrounds.
- If C changes a hex value, it also changes Appendix A in the spec.

### 2.2 Mark shape and commands (frozen at first ship)
Once these marks ship, their stored shape is frozen forever under the rule "never add attrs to existing marks". C must deliver exactly this shape.

**Shape:**
- **Standalone `Mark.create` marks**, named `textColor` and `fontSize`. Not `@tiptap/extension-text-style`, `Color`, `FontSize` or `TextStyleKit`: those add global attributes to `textStyle`, emit inline `style`, and make colour and size last-writer-wins.
- **One attribute each**, holding a token:
  - `textColor { color: TextColorToken }`
  - `fontSize { size: FontSizeToken }`
- **Mark options:**
  - `inclusive: true`;
  - default `excludes`, which is self-exclusion: one colour and one size per range;
  - no `spanning` or `keepOnSplit` overrides.
- **Parsing:**
  - The mark's `parseHTML` matches `span[data-text-color]` / `span[data-font-size]`.
  - The attribute's `parseHTML` returns a valid token or `null`, never a raw string.
- **TokenHighlight:**
  - The attribute key stays `color` (B4).
  - Its attribute `parseHTML` reads `data-highlight` first, then `data-color` through `highlightTokenFromValue`.
  - It **never** reads `style.backgroundColor`.
- **Registration:** register `TextColor` and `FontSize` **after** every existing mark in `document-editor-config.ts` and `tests/helpers/create-test-editor.ts`, so existing mark ranks stay put.

**Headings:** `fontSize` can reach a heading without any command: `style.heading*` setNode on a paragraph that has size marks, remote edits, and old documents. Two guards:
- **Mandatory (C):** a render-time neutralizer in `text-style-marks.scss`: `:is(h1, h2, h3, h4, h5, h6) [data-font-size] { font-size: inherit; }`.
- **Optional (D1):** `style.heading*` also strips `fontSize` in the same transaction. This alone cannot cover remote or old documents.

**Commands:**
```ts
declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    textColor: { setTextColor: (token: TextColorToken) => ReturnType; unsetTextColor: () => ReturnType };
    fontSize:  { setFontSize: (size: FontSizeToken) => ReturnType;   unsetFontSize: () => ReturnType };
  }
}
// highlight: stock setHighlight({ color: HighlightToken }) / unsetHighlight(); attribute key stays `color` (B4)
```
Semantics:
- Each command is one transaction.
- An empty selection sets a stored mark (the marks are inclusive, like bold).
- An invalid token returns `false` and changes nothing.
- `setFontSize` returns `false` in headings and in the title. That rule lives in the command and the paste rules, never in the schema.
- Nothing grows `fontSize` beyond the ladder.

C puts the extensions in `extensions/text-style-marks/` (`text-color.ts`, `font-size.ts`, `index.ts`). It may move the `declare module` block there, but must keep the signatures. Today the skeleton registers no mark anywhere.

### 2.3 Server half, floor and deploy (C owns; none of it is in the skeleton, on purpose)
- **`lib/schema-names.ts`:**
  - Add `"textColor"` and `"fontSize"` to `SCHEMA_MARK_NAMES`.
  - Flip the contract test "keeps the pending marks out of the ingress allowlist".
  - Update `tests/unit/schema/schema-snapshot.json` and its test. Only C touches the snapshot.
- **`SCHEMA_FLOOR = 2`:**
  - Export it from `lib/security/client-schema-gate.ts`, with `effectiveMinClientSchema(envMin: number): number` (`= Math.max(envMin, SCHEMA_FLOOR)`).
  - `scripts/hocus-server.ts` uses that function wherever it reads `HOCUS_MIN_CLIENT_SCHEMA` today. That includes the **startup log line**, which must print the effective minimum. Today it prints `min=0 (log only)`, which becomes false.
  - The floor only goes up (B3). Do not add the constant outside PR C, not even with value 0.
- **Gate test rewrite:** the log-only case in `tests/unit/scripts/hocus-client-gate.test.ts` (around lines 159–169) asserts `min=0 (log only)` and accepts everything. Rewrite it as **"env 0 → effective min 2: refuses schema < 2 (missing, invalid, `1`), accepts `2`, keeps `global-tabs-*` exempt, still logs the bucketed counts"**.
  - `tests/e2e/global-tabs-poison.spec.ts` connects without `schema=2` but targets an exempt `global-tabs-*` doc, so it needs no change.
- **Render-time enforcement:** `renderHTML` emits only a known token, as `data-*`, with no `style`. An unknown value renders as plain text. Never use ProseMirror attribute `validate`.
- **Paste (P10):**
  - Drop foreign `color`, `font-size` and `background-color`.
  - Keep our own `data-text-color`, `data-font-size` and `data-highlight`.
  - The Docs and Word samples are synthetic fixtures. Flag them in the PR as *not checked against a real clipboard*.
- **CSS:** add a new partial, `extensions/text-style-marks/text-style-marks.scss` (including the heading neutralizer in §2.2), imported once by `document-editor.tsx`. Do not grow `document-editor.scss`; the highlight rules already there stay put.
- **Highlight value rewrite in `lib/yjs-mark-migration.ts`:** DEFERRED (§1.3). It is cleanup only, because rendering already maps legacy `var(--tt-color-highlight-X)`.
- **CHANGELOG Deploy note** (spec §3.1 steps 3–4):
  1. **Build into a separate directory.** Alternatively, prove in the PR that `next build` in place does not change the bundle the still-running Next process serves. Spec §3.1 step 3 makes this a builder check.
  2. Restart **Hocus first** (`bunx pm2@6.0.14 restart … --update-env`).
  3. Confirm the `client_outdated` refusals and `min=2` in the Hocus log.
  4. Then switch to the new build and restart Next, at low traffic.
  5. Never roll back below N, and never lower the floor.

## 3. PR D1: actions, context, store, ActionButton

### 3.1 `lib/editor-actions/types.ts` (exists, complete; D1 owns)
```ts
export const CONTEXT_KINDS = ["media","mermaid","code","table","title","heading","list","paragraph"] as const; // precedence order
export type ContextKind = (typeof CONTEXT_KINDS)[number];
export const ACTION_GROUPS = ["history","style","mark","color","size","list","align","indent","insert",
  "section","table","code","media","format","view","memory"] as const;
export type ActionGroup = (typeof ACTION_GROUPS)[number];
export type KeyCombo = string;           // ProseMirror keymap notation: "Mod-b", "Mod-Alt-v", "F4", "Mod-\\"
export type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;   // from lib/icons.tsx
export type Enabled = true | { reason: string };
export const READ_ONLY_REASON = "This document is read-only.";

export interface Ctx {
  readonly kind: ContextKind; readonly state: EditorState; readonly editable: boolean;
  readonly empty: boolean; readonly parentType: string;
  readonly inTable: boolean; readonly inList: boolean; readonly inBlockquote: boolean; readonly inCodeBlock: boolean;
  readonly isTitle: boolean; readonly nodeSelectionType: string | null;
  readonly headingLevel: number | null; readonly headingId: string | null;
  readonly activeMarks: ReadonlySet<string>;
  memo<T>(key: string, compute: () => T): T;      // per snapshot (doc + selection + editable)
  docMemo<T>(key: string, compute: () => T): T;   // per state.doc identity (module WeakMap)
  can(key: string, check: (editor: Editor) => boolean): boolean;  // = memo("can:" + key), lazy
}
export interface ActionOption<Arg> { value: Arg; label: string; keywords?: readonly string[] }
export interface Action<Arg = undefined> {
  readonly id: string; readonly label: string; readonly group: ActionGroup;
  readonly contexts: readonly ContextKind[] | "any";
  readonly keywords?: readonly string[]; readonly icon?: IconComponent;
  readonly shortcut?: KeyCombo;          // display only (§3.4)
  readonly markdownHint?: string;
  readonly mutates?: boolean;            // default true; false = never changes the doc
  enabled(ctx: Ctx): Enabled;
  isActive?(ctx: Ctx): boolean; isMixed?(ctx: Ctx): boolean;
  value?(ctx: Ctx): string | null;
  options?(ctx: Ctx): readonly ActionOption<Arg>[];
  run(editor: Editor, arg: Arg): boolean;      // one transaction = one undo step; the only memory writer
}
export type AnyAction = Action<unknown>;
export interface ActionView { readonly id: string; readonly enabled: Enabled; readonly active: boolean;
  readonly mixed: boolean; readonly value: string | null }
export function defineAction<Arg = undefined>(action: Action<Arg>): Action<Arg>;
```
**Deviations from the spec's sketch:**
- `run` returns `boolean`, because only a successful run may write memory (§6).
- `Action` takes a typed `Arg`. `run` still re-validates its argument at runtime, because palette and registry callers pass `unknown`.
- `options()` serves submenus and palette rows: swatches, table sizes, templates, code languages.
- `icon` is a component, not a name.
- **No `readonly` context kind** (spec §2 lists `readonly` first in precedence). `kind` is always structural. Read-only is `ctx.editable`, gated centrally (§3.2). Copy and view actions still resolve to `code` or `mermaid` in a read-only document.

**Read-only (#308, `document_too_large` / `document_deleted`):**
- Every action with `mutates !== false` is refused centrally, with the one `READ_ONLY_REASON`. Its `enabled()` need not check `editable`.
- `mutates: false` is only for actions that never change the doc: `view.*`, `code.copy`, `mermaid.copySource`, `section.fold` (amendment A1), `palette.open`.
- This gate, not each author, keeps read-only safe, because Tiptap commands still dispatch on a non-editable editor.

**Cache tiers (spec §7):**
- **`memo` / `can`: per snapshot.** Use it for anything selection- or history-dependent: `can()` of lists, tables, indent and section move, and undo/redo (the Yjs UndoManager stack).
- **`docMemo`: per `state.doc` identity**, shared by every snapshot of that doc. Use it only for values that depend on the doc alone: section lists, code-language counts. Arrow keys in a 500-heading doc then reuse them.
- **Never cache `can()` by doc identity.**
- `ctx.can(key, check)` runs `check(editor)` against the live editor on first use. It is then fixed for that snapshot. One key always names one check.

**Every action:**
- reads only `ctx` in `enabled`, `isActive`, `isMixed`, `value` and `options`;
- reaches the editor only through `ctx.can`;
- never reads the DOM.

**Amendment (PR E review): two documented external reads.** `repeat.apply` (`enabled`, `value`) reads the remembered bundle (`getRememberedBundle()`), and `formats.apply` (`enabled`, `options`) reads the saved formats (`readSavedFormats()`). Neither is part of the snapshot key, so a cached `getView` can lag a change that leaves the doc and selection alone (Copy formatting, a format saved from the palette, another tab's write) until the next selection change. Until D1 decides on an invalidation hook (preferred long term: `store.invalidate()` or an external-version input to the snapshot key, called from `subscribeBundle` / `subscribeSavedFormats`):
- no other action may read module state;
- a surface that renders `repeat.apply` subscribes to the bundle itself (`useRememberedBundle`) and computes `availability()` from the live snapshot at render. E's phone Repeat cell and `RepeatSplitButton` do this; a plain `ActionButton` for `repeat.apply` does not, so D1/D2 surfaces render E's components rather than `ActionButton id="repeat.apply"`;
- the palette is unaffected (it takes a fresh snapshot on every open).

### 3.2 `lib/editor-actions/registry.ts` (exists, complete; D1 owns)
```ts
export interface ActionFilter { group?: ActionGroup; context?: ContextKind }
export interface ActionRegistry { get(id: string): AnyAction | undefined; has(id: string): boolean;
  list(filter?: ActionFilter): readonly AnyAction[] }        // registration order
export function createRegistry(actions: readonly AnyAction[]): ActionRegistry;   // throws on duplicate id
export function isOfferedIn(action: AnyAction, kind: ContextKind): boolean;
export function availability(action: AnyAction, ctx: Ctx): Enabled;  // read-only → not offered → enabled()
export function canRun(action: AnyAction, ctx: Ctx): boolean;         // availability(...) === true
export function runAction(editor: Editor, action: AnyAction, arg?: unknown): boolean;  // rechecks the LIVE doc
```
- `availability` is the one gate shared by `getView` and `runAction`. Its order is fixed: `READ_ONLY_REASON` (mutating actions only), then "Not available here." (not offered in this kind), then `enabled(ctx)`.
- The registry is immutable and composed in `lib/editor-actions/index.ts` (frozen):
  ```ts
  export const editorActions = createRegistry([...coreActions, ...surfaceActions, ...v11Actions]);
  ```
- Nothing registers on import. That keeps it safe under HMR and under `bun test`'s shared process.
- Duplicate ids throw at build time. The contract test checks that ids are unique and stay inside each track's prefixes.
- **Surfaces never take their layout from the registry.**
  - The row, slot, bubble, phone bar, Aa sheet and ⋯ each keep a const array of action ids or component slots.
  - Only the **palette** and **Insert** (`list({ group: "insert" })`) list from the registry.
  - A surface skips any id that `editorActions.has()` does not know, so D1's ⋯ can name `memory.forget` before D2 lands.

### 3.3 Context snapshot and store (exist; D1 may rewrite the bodies; the rules below are pinned)
```ts
// lib/editor-context/snapshot.ts
export function computeContext(editor: Editor): Ctx;     // O(depth); kind by CONTEXT_KINDS precedence
// lib/editor-context/store.ts
export interface EditorContextStore {
  subscribe(listener: () => void): () => void;  // the store's OWN listener set over the version store
  getVersion(): number;
  getContext(): Ctx;                // see freshness below
  getSlotContext(): Ctx;            // frozen while any hold() is open; drives slot CONTENTS only
  getView(id: string): ActionView | null;   // once per snapshot; same object while fields are equal
  hold(): () => void;               // ref-counted; release idempotent; also release on unmount
}
export function getEditorContextStore(editor: Editor): EditorContextStore;  // WeakMap per editor
// hooks/use-editor-context.ts
export function useActionView(id: string, editor?: Editor | null): ActionView | null;
export function useEditorContext(editor?: Editor | null): Ctx | null;
```
**Deviation from spec §2:** the spec puts `getContext`/`getView` on `getEditorVersionStore`. The contract puts them in `lib/editor-context/store.ts`, which wraps that store with the same versions and timing:
- `TOOLBAR_SETTLE_MS` for doc changes;
- immediate for selection, marks and focus;
- the `TOOLBAR_MAX_WAIT_MS` cap for **remote changes only**, never during local typing (`622e0a2`, now in the base).

This keeps `hooks/use-tiptap-editor.ts` stable for every existing control. D1 owns both files and may change the version store's internals, but the API and these rules are fixed.

Pinned rules (each has a contract-test case):
- **Freshness.**
  - With ≥ 1 subscriber, `getContext()` is keyed by store version. It deliberately lags doc changes by the settle window.
  - With **no** subscriber the version does not move, so it is keyed by `(editor.state, editor.isEditable)` identity. `setEditable` makes no new state, so `isEditable` is part of the key.
  - The first subscriber starts a new epoch, so no version-keyed entry from before is trusted.
  - Imperative readers are never stale: the palette on open, `hold()` before the slot mounts, any surface under `__TOOLBAR_OFF`.
- **Views.**
  - `getView(id)` computes `enabled/isActive/isMixed/value` once per snapshot, cached by `getContext()` identity. Repeated `getSnapshot` calls (every render, twice in StrictMode, every notify) are a map read and cannot drift.
  - The returned object keeps its identity across snapshots while its fields are equal.
- **Hold.** The final release notifies subscribers when the slot snapshot changed. Without that, focus leaving to somewhere other than the editor would leave the slot frozen.
- **Hygiene.**
  - Keep the per-editor caches in the WeakMap.
  - Clear the max-wait timer on destroy.
  - Test injection: the identity test injects its action by reassigning `editorActions.get`. D1 may replace that mechanism (for example, a store factory that takes a registry) as long as the assertions stay.

### 3.4 Keys and UI intents (exist; D1 owns)
```ts
// lib/editor-actions/key-combo.ts      (stubs; D1 implements on lib/shortcuts.ts)
export function formatKeyCombo(combo: KeyCombo, mac: boolean): string;   // "⌘B" / "Ctrl+B"
export function ariaKeyShortcuts(combo: KeyCombo, mac: boolean): string; // "Meta+B" / "Control+B"
// lib/editor-actions/ui-intents.ts     (complete)
export type UiIntent =
  | { type: "outline.toggle" } | { type: "filter.toggle" } | { type: "theme.toggle" }
  | { type: "palette.open" } | { type: "colors.open"; kind: "text" | "highlight" }
  | { type: "insert.open"; kind: "table" | "image" | "embed" }
  | { type: "toolbar.focus" };   // A2: media.options removed, toolbar.focus added
export type UiIntentListener = (intent: UiIntent) => boolean;   // true ONLY for an intent it handled
export function onUiIntent(editor: Editor, listener: UiIntentListener): () => void;
export function emitUiIntent(editor: Editor, intent: UiIntent): boolean;  // true iff some listener returned === true
```
**UI intents:**
- Some actions need the shell: view toggles, opening the palette, or an Insert kind that needs input first (M10: table, image, embed). They call `emitUiIntent` and return its result.
- D1, D2 and E all listen on one editor. A listener returns `false` for every intent it does not own, including from the `default` of a `switch`.
- D2 and E may append variants to the union (append-only).
- The shell subscribes in `document-editor.tsx`: D1 adds the subscription; D2 and E handle their own variants.

**Shortcuts:**
- **`Action.shortcut` is display-only.** It feeds the hint text and `aria-keyshortcuts`, and is never bound from the registry.
- **Each key is bound by exactly one Tiptap extension** (`addKeyboardShortcuts`, never a window listener):
  - stock extensions bind their own (`Mod-b`…);
  - D1 binds `Mod-\` and any new D1 key;
  - E's `extensions/repeat-formatting` binds `Mod-Alt-v` and `F4`.
- The contract test asserts that no `KeyCombo` appears on two actions, so Repeat cannot run twice and break "one undo step".
- The one non-extension binding is the palette's capture-phase Alt+/ listener (E, spec §4.4).

### 3.5 `ActionButton` and the toolbar primitives (D1 owns; signatures frozen)
```ts
// components/smart-toolbar/action-button.tsx (exported from @/components/smart-toolbar)
export type ActionButtonVariant = "row" | "menu" | "bubble" | "phone";
export interface ActionButtonProps { id: string; editor?: Editor | null; variant?: ActionButtonVariant;
  showLabel?: boolean; arg?: unknown }
export function ActionButton(props: ActionButtonProps): JSX.Element | null;  // null for an unknown id
```
**Who renders through it:** `ActionButton` is the one way to render a registry action by id. That covers D1's row, slot and ⋯, D2's bubble, phone bar and Aa sheet, and E's phone selection cells.
- E's cmdk palette rows are `Command.Item`s, not buttons. They use `useActionView` + `runAction` directly and show the same label and `formatKeyCombo` hint.

**What it does (D1 implements):**
- label + icon;
- `formatKeyCombo` hint and `aria-keyshortcuts`;
- `aria-pressed` (including `"mixed"`);
- disabled-with-reason: `aria-disabled` + `aria-describedby` + tooltip, and it stays focusable;
- mousedown `preventDefault`, which keeps the editor selection;
- `runAction(editor, action, arg)`.

The skeleton is a plain `ToolbarButton` that runs the action. It has no key hint and no `aria-keyshortcuts` yet.

**Rule:** D2 and E render actions only through `ActionButton` (or the palette-row pattern above) and never edit D1's `tiptap-ui` files. If D1 changes the props of a `tiptap-ui` control that a D2-owned file still uses (`mobile-toolbar-content.tsx`), D1 updates those call sites as an allowed hunk.

**Pinned primitive APIs** (D1 may add props, never remove or rename these):
- **`Toolbar`** (`components/ui/toolbar.tsx`):
  - `variant?: "floating" | "fixed"` plus `div` attributes, spread last, so a caller's `aria-label` overrides the default "Formatting";
  - `role="toolbar"`, roving tabindex over `button, [role="button"], [tabindex="0"]`;
  - descendants under `[data-roving-group]` are excluded from the roving set;
  - `ToolbarGroup` and `ToolbarSeparator` are unchanged.
- **`ToolbarButton`** (`components/ui/toolbar-button.tsx`): `tooltip`, `showTooltip`, `shortcutKeys`, `isActive`, `disabledReason`, an explicit `aria-pressed` override, and the `Button` `variant`/`size` props.

## 4. Action ids and ownership

Each track adds actions **only** to its own file. Ids are `<prefix>.<name>`, and the prefixes do not overlap; the contract test enforces this.

**`lib/editor-actions/core-actions.ts`: D1.**
- Prefixes: `history.` `style.` `mark.` `format.` `list.` `align.` `indent.` `section.` `table.` `code.` `mermaid.` `media.` `view.`
- Ids (v1 target list; add, do not rename):
  - **history:** `history.undo` `history.redo`
  - **style:** `style.paragraph` `style.heading1`…`style.heading6`
  - **marks:** `mark.bold` `mark.italic` `mark.underline` `mark.strike` `mark.superscript` `mark.subscript` `mark.inlineCode`
  - **link:** `mark.link` is only a trigger; the link popover stays the Hyperlink extension's own.
  - **format:** `format.clear` (`Mod-\`; keeps `hyperlink`; disabled in code)
  - **list:** `list.bullet` `list.ordered` `list.task`
  - **align:** `align.left` `align.center` `align.right` `align.justify`
  - **indent:** `indent.indent` `indent.outdent` (mirrors Tab: `sinkListItem` → `indent`)
  - **section:** `section.fold`* `section.moveUp` `section.moveDown`
  - **table:** `table.addRowBefore` `table.addRowAfter` `table.deleteRow` `table.addColumnBefore` `table.addColumnAfter` `table.deleteColumn` `table.toggleHeaderRow` `table.mergeOrSplit`
  - **code and mermaid:** `code.language` `code.copy`* `mermaid.language` `mermaid.copySource`*
  - **media:** `media.options`
  - **view:** `view.outline`* `view.filter`* `view.theme`*

**`lib/editor-actions/surface-actions.ts`: D2.**
- Prefixes: `color.` `size.` `insert.` `memory.`
- Ids:
  - **colour:** `color.text.apply` (arg `TextColorToken`) `color.text.unset` `color.highlight.apply` (arg `HighlightToken`) `color.highlight.unset`
  - **size:** `size.increase` `size.decrease` `size.set` (arg `FontSizeStep`; disabled in headings with "Headings scale automatically.")
  - **insert:** `insert.image` `insert.embed` `insert.table` (arg `TableSize`) `insert.quote` `insert.codeBlock` `insert.mermaid` `insert.divider`
  - **memory:** `memory.forget`*

**`lib/editor-actions/v11-actions.ts`: E.**
- Prefixes: `palette.` `repeat.` `formats.` `template.`
- Ids:
  - **palette:** `palette.open`* (Alt+/, fallback Alt+Shift+Z)
  - **repeat:** `repeat.apply` (`Mod-Alt-v`, `F4`) `repeat.copy` (no key)
  - **formats:** `formats.save` `formats.apply` (arg format id)
  - **template:** `template.mermaid` (group `insert`, arg template id, so it appears in D2's Insert menu)

\* `mutates: false`. These ids stay available in a read-only document.

Rules:
- **Import rule:** `core-actions.ts`, `surface-actions.ts` and `v11-actions.ts` never import `@/lib/editor-actions` (the index) or `lib/editor-context/store.ts`. Both import the action files, and a top-level use would leave `editorActions` undefined. Action files import only types, `registry.ts` helpers, `snapshot.ts`, `ui-intents.ts`, tokens and `remembered-choice.ts`, plus the extension modules listed in amendment A3. They never import `components/**`.
- **M4 depends on D2:** D1 wires code-language memory through `readChoice`/`rememberChoice`, which stay no-ops until D2 merges. M4 is deferred in this window (§1.3).
- Labels use sentence case. Disabled reasons are full sentences ending in a period.
- Memory is written only as §6 says: inside `run()`, after the command returned true.
- Repeat uses `undoManager.stopCapturing()` before and after its dispatch (spec §5).

## 5. File ownership

### 5.1 Owned files (only the owner edits them; others open a request)

**C**
- Tokens and marks: `lib/text-style-tokens.ts`, `lib/highlight-tokens.ts`, `extensions/text-style-marks/**`, `extensions/token-highlight/**`.
- Schema and server: `lib/schema-names.ts`, `tests/unit/schema/schema-snapshot.*`, `lib/yjs-mark-migration.ts`, `lib/security/client-schema-gate.ts`, `lib/security/guardrail-config.ts`, `scripts/hocus-server.ts` (gate and log hunks).
- Docs, paste and tests: `docs/operations/schema-rollout-runbook.md`, the paste rules, `tests/unit/scripts/hocus-client-gate.test.ts` (log-only case), and C's own tests (`tests/unit/schema/**`, `tests/unit/extensions/text-style-*`, the render fuzz, the N vs N+1 test).

**D1**
- Actions and context: `lib/editor-actions/{types,registry,core-actions,key-combo,ui-intents}.ts`, `lib/editor-context/**`, `hooks/use-editor-context.ts`, `hooks/use-tiptap-editor.ts`.
- Toolbar components:
  - `components/smart-toolbar/action-button.tsx`;
  - `components/document-editor/main-toolbar-content.tsx` (the sorted row);
  - new `components/smart-toolbar/row/**` (style dropdown, mark buttons, ⋯ overflow) and `components/smart-toolbar/context-slot/**`;
  - `components/ui/toolbar.tsx` and `components/ui/toolbar-button.tsx`: roving tabindex, Alt+F10, disabled-with-reason.
- Existing controls:
  - `components/tiptap-ui/{undo-redo-button,heading-dropdown-menu,heading-button,mark-button,text-align-button,indent-button,hyperlink-button,heading-filter,shortcut-badge}/**`;
  - `components/document-editor/theme-toggle.tsx` (moves into ⋯ at T2).

**D2**
- Actions and memory: `lib/editor-actions/surface-actions.ts`, `lib/remembered-choice.ts`.
- Smart-toolbar components:
  - `components/smart-toolbar/{color-controls,font-size-stepper,list-control,insert-menu,collapse-menus,selection-bubble,phone-bar}.tsx`;
  - new files under `components/smart-toolbar/{color,bubble,phone,insert}/**`;
  - `components/smart-toolbar/smart-toolbar.scss` (the container-query ladder, imported once by `main-toolbar-content.tsx`).
- Existing controls:
  - `components/tiptap-ui/{color-highlight-popover,color-highlight-button,list-dropdown-menu,list-button,blockquote-button,code-block-button,mermaid-button,image-upload-button,media-embed-popover}/**`;
  - `components/document-editor/mobile-toolbar-content.tsx`;
  - `components/toc-sidebar/**`.
- **Bundle gate:** `scripts/check-editor-chunk-size.ts` plus its hunk in `.github/workflows/ci.yml` (editor chunk ≤ +6 KB gz; +18.5 KB gz since A9). The baseline is measured on `58a9d22`, the ab tip, before any track merges. E's engineer may own this file instead (§1.3).

**E**
- `lib/editor-actions/v11-actions.ts`.
- `components/smart-toolbar/{command-palette-host,repeat-split-button,phone-selection-cells}.tsx` and new `components/smart-toolbar/palette/**` (lazy chunk).
- `extensions/repeat-formatting/**`, `lib/saved-formats.ts` (`tinydocy-formats`), `lib/doc-format-scan.ts` (M12; capped, never stored), `lib/mermaid-templates.ts`.
- `components/ui/command.tsx` (shadcn `Command` + `cmdk`).
- **`package.json` and `bun.lock`:** E adds `cmdk` only, on its own branch. The skeleton deliberately leaves `cmdk` out, because v1 must not ship an unused dependency. Any other track that needs a dependency asks first. A lockfile conflict is never union-resolved: re-run `bun install` on the rebased tree.

**Nobody**
- `components/tiptap-ui/{connection-status,user-identity-button,user-identity-dialog}.tsx` (not toolbar).
- `components/ui/*` other than `toolbar*`: shadcn primitives, additive only; resolve conflicts by union.

**Frozen** (skeleton; changed only by a contract amendment)
- `lib/editor-actions/index.ts`.
- `components/smart-toolbar/editor-surfaces.tsx` and `components/smart-toolbar/types.ts`.
- `components/smart-toolbar/index.ts` (append exports only).
- `tests/unit/editor-actions/contract.test.ts` (C flips only its allowlist case).

### 5.2 Shared files (hunk-level ownership; resolve conflicts by union)

**`components/document-editor/document-editor.tsx`**
- **Outline state is pinned:** `const [outlineOpen, setOutlineOpen] = …`, where `setOutlineOpen: (next: boolean | ((open: boolean) => boolean)) => void`. It is already in the skeleton.
- **C:** one import of `text-style-marks.scss`.
- **D1:**
  - the `onUiIntent` subscription; `view.outline` calls `setOutlineOpen((open) => !open)`;
  - the Alt+F10 handler: focus `[data-smart-bubble][data-state="open"] [role="toolbar"]` when it is present, else the row.
- **D2:**
  - changes only the *implementation* of that one line to M6 memory (`useRememberedChoice({ slot: "outlineOpen" })` plus a writer), keeping the name and signature;
  - the `isMobile` branch (phone bar);
  - the outline overlay (deferred).
- **E:** nothing; it mounts through `EditorSurfaces`.

**Selection bubble DOM contract (D2, for D1's Alt+F10):** the bubble root carries `data-smart-bubble` and `data-state="open" | "closed"`, with one `role="toolbar"` element inside.

**`components/document-editor/document-editor-config.ts`:** each track adds its own lines in the `extensions` array.
- **C:** registers `TextColor`, `FontSize` and the paste rules, after the existing marks.
- **D1:** a keymap extension for `Mod-\`.
- **E:** registers `RepeatFormatting`.

**`tests/helpers/create-test-editor.ts`:** **C** adds its marks, after the existing marks. Others append.

**`components/document-editor/main-toolbar-content.tsx`:** **D1** owns it. **D2** may only import `smart-toolbar.scss` there and add the `data-collapse-tier` attributes it needs, after rebasing on D1.

**`components/document-editor/mobile-toolbar-content.tsx`:** **D2** owns it. **D1** may update its `tiptap-ui` call sites (§3.5).

**`.github/workflows/ci.yml`:** **D2** adds the chunk-size step (§5.1). Nobody else edits it in v1.

**`lib/icons.tsx`:** append-only, alphabetical inside the `export { … }` block. Resolve conflicts by union.

**`CHANGELOG.md`:** one sub-block per PR under `## Unreleased`, newest on top. C's block carries the Deploy note.

**`tests/e2e/**`:** new spec files per track (`toolbar-row.spec.ts` D1, `toolbar-surfaces.spec.ts` D2, `palette.spec.ts` E). Edit an existing spec only for the hunk your change breaks.

**`README.md`, `docs/operations/*.md`, `.env.example`:** append your own rows. `NEXT_PUBLIC_REMEMBER_CHOICES` is D2's; the `SCHEMA_FLOOR` runbook text is C's.

### 5.3 How D2 and E plug into D1's row and shell
**The sorted row:**
- D1's row renders, at fixed places, `ColorControls`, `FontSizeStepper`, `ListControl` and `InsertMenu`.
- Next to the groups they replace, it renders the collapse stand-ins: `ParagraphCollapseMenu`, `SlotCollapseButton`, `ColorCollapseButton`, `ViewCollapseMenu` and `AaCollapseMenu`.
- All of these come from `@/components/smart-toolbar`. The stubs render today's controls or nothing, so the app stays whole at every merge point.

**Responsive DOM contract:**
- D1 marks each row group root `data-toolbar-group="<history|style|size|marks|color|link|paragraph|list|slot|insert|more|view|theme>"`.
- D1 marks each collapsible item `data-collapse-tier="t2|t3|t4|t5"`, the tier at which it hides.
- D2's container-query CSS reads only these attributes.
- The roving model collects items at keydown with `checkVisibility()`, so hidden items drop out without JS.

**Floating and phone surfaces:**
- `EditorSurfaces` (frozen) is mounted once inside `EditorContext`. It renders `SelectionBubble` (D2) and `CommandPaletteHost` (E).
- D2's bubble renders `RepeatSplitButton` (E).
- D2's phone bar renders `PhoneSelectionCells` (E, with `onBack`) in place of its own cells while text is selected and VoiceOver focus is not in the bar. The mode comes from `nextMobileBarMode`; ✕ sets `dismissedForSelection`, which overrides the focus guard (an explicit Back). D2 resets it on a new selection and keeps the bar one `role="toolbar"` element, so ✕ can move focus to the bar's first enabled cell once the normal cells are back (spec §6.6).
- E's components render `null` until E lands, so D2 needs nothing from E to ship.

### 5.4 Ports (e2e and dev servers)
Never use 3000, 1234, 3100, 1334, 3200, 1434, 3400 or 1534 (the owner's preview and other tracks).

| Track | Next | Hocus |
|---|---|---|
| C | 3510 | 1610 |
| D1 | 3520 | 1620 |
| D2 | 3530 | 1630 |
| E | 3540 | 1640 |
| Integration | 3550 | 1650 |

Each track runs `lsof -i :<port>` before starting and stops only the servers it started. Start commands, with the track's ports:
```sh
DOC_CREATION_RATE_LIMIT=2000 WS_CONNECTION_LIMIT=200 WS_SOCKETS_PER_IP=600 WS_UPGRADE_RATE_LIMIT=6000 \
  HOCUS_THROTTLE=0 MAX_TOTAL_DOCUMENTS=1000000 HOCUS_PORT=<hocus> DB_PATH=db.sqlite \
  HOCUS_ALLOW_ISOLATED_TABS_DOCS=1 bun run hocus
NEXT_PUBLIC_HOCUS_URL=ws://127.0.0.1:<hocus> bun next dev -p <next>
CI= E2E_BASE_URL=http://localhost:<next> E2E_HOCUS_URL=ws://127.0.0.1:<hocus> bun playwright test <spec>
```

## 6. Memory layer (`lib/remembered-choice.ts`; D2 owns, E writes its slots)
```ts
export const STORAGE_KEYS = { choices: "tinydocy-choices", ui: "tinydocy-ui", formats: "tinydocy-formats" } as const;
export const STORAGE_VERSION = 1;
export const CHOICE_SLOTS = {
  textColor: "choices", highlight: "choices", recentColors: "choices", codeLanguage: "choices",
  listType: "choices", insertKind: "choices", tableSize: "choices",
  repeatBundle: "choices", paletteRecent: "choices", mermaidTemplate: "choices",   // E's slots
  outlineOpen: "ui",
} as const;
export type ChoiceSlot = keyof typeof CHOICE_SLOTS;
export const REMEMBER_CHOICES_ENABLED: boolean;     // NEXT_PUBLIC_REMEMBER_CHOICES !== "0"
export interface ChoiceSpec<T> { slot: ChoiceSlot; maxRecent: number;
  validate: (value: unknown) => value is T; fallback: T }
export interface RememberedChoice<T> { ready: boolean; last: T; recent: readonly T[] }   // read only
export type RecentColor = { kind: "text"; token: TextColorToken } | { kind: "highlight"; token: HighlightToken };
export interface TableSize { rows: number; cols: number }
export type TextColorChoice = TextColorToken | "default";
export type HighlightChoice = HighlightToken | "none";
export function readChoice<T>(spec: ChoiceSpec<T>): { last: T; recent: readonly T[] };  // sync
export function rememberChoice<T>(spec: ChoiceSpec<T>, value: T): void;               // sync; see write rule
export function forgetChoices(): void;                // clears tinydocy-choices only; notifies
export function subscribeChoices(listener: () => void): () => void;   // in-tab writes + cross-tab storage events
export function useRememberedChoice<T>(spec: ChoiceSpec<T>): RememberedChoice<T>;
```
**One write path.** Memory is written **only inside an action's `run()`, after its command returned true.** The row, slot, bubble, phone bar, Aa sheet, palette and keyboard shortcuts therefore all remember the same way, exactly once.
- Surfaces only read. `RememberedChoice` has no `remember`.
- A `run()` that only emits a UI intent (M10 inputs) writes nothing. The run that applies the argument writes.
- **Exception 1:** `outlineOpen` is shell state, written by the shell's `setOutlineOpen` (§5.2).
- **Exception 2:** `paletteRecent` is written by the palette host after `runAction` returned true.
- **Exception 3 (PR E review):** `repeatBundle` is recorded by the `RepeatFormatting` extension from local **mark-only** transactions (spec M7): every step is an `AddMarkStep` or `RemoveMarkStep`. A transaction that also holds a `ReplaceStep`, `ReplaceAroundStep` or `AttrStep` (a heading change or block conversion that strips marks) records nothing. `repeat.copy` and `formats.apply` write the bundle in their `run()`, after the command returned true; the commands themselves write no memory.

**Change feed.** The `storage` event never fires in the tab that wrote. `rememberChoice` and `forgetChoices` therefore notify an in-module listener set (`subscribeChoices`), which also forwards the cross-tab `storage` event. `useRememberedChoice` reads through it in the `useSyncExternalStore` style, so an M1/M2 face updates as soon as its action runs.

**Requirements on D2's implementation (spec §5):**
- **Payload and versioning:**
  - The payload is `{ v: STORAGE_VERSION, slots: { [slot]: { last, recent } } }`. Any other version is discarded.
  - Every storage call sits inside try/catch.
  - Every write re-reads, merges its own slot, then writes, because several hooks and tracks share one key.
- **Reads:**
  - Reads happen in `useEffect` behind `ready`, so there is no hydration mismatch.
  - The validator runs on read. Values that fail are dropped.
- **Kill switch:** reads the fallbacks and writes nothing.
- **Privacy:** nothing reaches Yjs, the server, URLs or analytics.
- **Tamper test:** covers hostile JSON, a wrong version and an oversized `recent`. It also covers **both** notify paths: an in-tab write updates a mounted hook, and a `storage` event from another tab does too.
- **Forget:** `tinydocy-ui` and `tinydocy-formats` survive "Forget my choices".

E keeps saved formats in `lib/saved-formats.ts` under `STORAGE_KEYS.formats`, with the same safety rules. Each format is a bundle of tokens and mark names only. The one piece of free text is a name of at most 40 characters, with control and bidi characters stripped.

## 7. Track test and verification duties (spec §7, §8, trimmed by §1.3)

**C**
- **Render fuzz:** `red;background:url(x)` emits no `style`. Unknown values render as plain text.
- **Yjs survival** of the new marks (N+1 ↔ N+1).
- **N vs N+1 on one Y.Doc (safety-critical; this is the anti-goal case).** The test runs in process:
  - an N-schema editor (marks unknown) and an N+1 editor share one Y.Doc;
  - the N+1 editor writes `textColor` and `fontSize`;
  - the N editor must freeze read-only, and there must be **0 deleted blocks** in the shared doc.
- **Ingress test:** an update with an unknown mark name is refused.
- **Paste:** tab-to-tab paste keeps tokens. The synthetic Docs and Word fixtures paste plain (flagged *not checked against a real clipboard*).
- **Palette contrast** test.
- **`SCHEMA_FLOOR` gate matrix:** env 0 still gives an effective minimum of 2. The startup log prints the effective minimum. The log-only test is rewritten as in §2.3.
- **Heading size:** the neutralizer CSS keeps a heading's size when it has `fontSize` content.
- **Snapshot update**, and the **Deploy note** (§2.3).

**D1**
- Registry per context.
- Snapshot kind precedence (TDD), with `kind` structural and read-only gated centrally.
- `getView`: identity, and computed once per snapshot.
- Context freshness without subscribers.
- `hold`: released on unmount, and notifies on the final release.
- **Keyboard e2e:**
  - one Tab stop;
  - Alt+F10 to the bubble if open, else the row;
  - Esc;
  - remote heading deletion while the slot is focused.
- ≤ 1 toolbar commit per settle, and the typing-perf assertion still passes.
- Indent in lists.
- Clear formatting keeps links.

**D2**
- **Memory:** the tamper test (including in-tab and cross-tab notify) and `NEXT_PUBLIC_REMEMBER_CHOICES=0`.
- **Layout:** `scrollWidth <= clientWidth` ±1px per tier that ships.
- **Colour grid a11y:** named `aria-pressed` buttons in a dialog.
- **Phones:** colours and size reachable on phones; targets are 44×44.
- **Bundle:** editor chunk ≤ +6 KB gz against the `58a9d22` baseline (+18.5 KB gz since A9).
- **Bubble-in-row matrix:** when the bubble lands (deferred).

**E** (on its own branch)
- Palette + cmdk ≤ 20 KB gz (A7), loaded on the first Alt+/.
- Repeat:
  - is one undo step;
  - sets marks rather than toggling them;
  - F4 works;
  - is bound only once (no duplicate combo).
- Listeners and heap return to baseline after 20 tab switches and 100 palette/bubble cycles.
- The mobile swap passes on WebKit.

**All tracks**
- `bun run check`, `lint`, `typecheck` and `test`.
- E2e against the track's own ports (§5.4).
- A CHANGELOG entry under Unreleased.
- Commit locally with Conventional Commits and no tool trailers. Never push.

## 8. What the skeleton deliberately does not do
- **No schema changes.** It does not register `textColor` or `fontSize`, add them to `SCHEMA_MARK_NAMES`, or define `SCHEMA_FLOOR`. All three are C's, under spec §3.1.
- **No dependency changes.** It does not add `cmdk` or any other dependency (§5.1).
- **No row changes.** `main-toolbar-content.tsx` is untouched. The shell changes are:
  - mounting `EditorSurfaces`, which renders nothing yet;
  - renaming the outline state to the pinned `outlineOpen` / `setOutlineOpen`.
- **Stubs for real bodies.** These return safe fallbacks:
  - the snapshot walk: `heading` or `paragraph` kinds only, list/table flags false;
  - key-combo formatting: the combo text unchanged;
  - the memory layer: fallback values, no writes, a no-op `subscribeChoices`;
  - `ActionButton`: a plain button with no key hint or `aria-keyshortcuts`.
- **Real bodies already in the skeleton** (pinned by the test):
  - the store's freshness, view caching and hold notify;
  - the `availability` gate;
  - `emitUiIntent`.

## 9. Skeleton and base
- **`510b144`:** merges `integrate/smart-toolbar-ab` at `58a9d22` into `integrate/smart-toolbar-v1`. It brings in `622e0a2` (max-wait cap only for remote changes), `ad22f17`, `419ce52`/`b9945fc` (pressed underline), and `cada849`/`71bad93` (offline saves dropped after a copy's removal).
- **`ba6e3de`:** the original skeleton.
- **`7ed1362`:** the revised skeleton for this revision.
  - store freshness, view cache and hold notify;
  - `docMemo` and `can`;
  - `mutates` + `availability`;
  - strict intents;
  - the read-only memory API + `subscribeChoices`;
  - `ActionButton`;
  - `setOutlineOpen`.

**Every track starts from the tip of `integrate/smart-toolbar-v1`.** The four track branches were fast-forwarded to it. A track that started earlier runs `git rebase integrate/smart-toolbar-v1`. When `integrate/smart-toolbar-ab` moves again, the integration owner merges it into v1 first, then the tracks rebase.

## 10. Amendments

Recorded by the owner of the files they touch. Each one names what changed and why.

- **A1 (D1): `section.fold` is `mutates: false`.** `toggleFold` only sets fold-plugin meta (per-viewer view state, persisted locally) and never changes the doc, so folding keeps working in a read-only document like the other view actions. `tests/unit/editor-actions/core-actions.test.ts` pins the exact `mutates: false` list of the core actions (`contract.test.ts` stays frozen).
- **A2 (D1): `{ type: "media.options" }` removed from `UiIntent`; `{ type: "toolbar.focus" }` added (Alt+F10).** `media.options` runs in the action itself: it opens the kit toolbar through `openMediaToolbar`, focuses its first control and wires Esc back to the slot button. No other track used the variant.
- **A3 (D1): extension imports allowed in D1's action bodies (`lib/editor-actions/core/*`).** Pure modules only, never `components/**`:
  - `@/extensions/heading-fold/heading-fold-plugin` (`headingFoldPluginKey`; the plugin file, not the extension index);
  - `@/extensions/shared/compute-section`;
  - `@docs.plus/extension-hyperlink` (`openPreviewHyperlink`, `buildPreviewOptionsFromAnchor`);
  - `@docs.plus/extension-hypermultimedia` (`openMediaToolbar`, `closeMediaToolbar`);
  - `@/lib/code-language` (`sanitizeCodeLanguage`, moved out of `components/document-editor/safe-code-block.ts`).

  The editor chunk already contains all of them. Any registry consumer outside it (E's palette chunk, unit tests) loads them too. D2 measures the editor-chunk delta against the `58a9d22` baseline before its +6 KB gz gate lands.
- **A4 (integration): PR E backed out of v1.** The integration had merged `feat/smart-toolbar-e-v11` (8fdb1b6) against §1.1. It is reverted, with E's parts of the follow-up commits. E stays on its stacked branch; retarget its PR to `main` before v1 merges.
- **A5 (D2, integration): responsive ladder thresholds are measured, not spec §4.6's estimates.** The real T1 row is 1230px wide (spec assumed ≤ 1128), so each tier starts where the row above it stops fitting, with room for a slot stand-in from T3 on. Mouse: T2 < 1232, T3 < 1128, T4 < 950, T5 < 866. Touch (44px targets, no row gaps): T2 < 1560, T3 < 1388, T4 < 1180, T5 < 1012. T5 also applies to mouse (spec: touch only) and adds a short style value and no separators. `toolbar-ladder.spec.ts` asserts `scrollWidth ≤ clientWidth + 1` and one Tab stop from 1440 to 768 in paragraph, heading, code and table contexts, mouse and touch. Below 768 the phone row still scrolls (now with a visible scrollbar) until the docked bar lands.
- **A6 (owner grant): tracks may edit the files their scope names, even when §5 assigns them to D1 or D2.** Changes stay minimal and each one is listed here (other tracks add their own sub-bullets; merge by union).
  - Bubble, `components/document-editor/document-editor.tsx` (D1): the `toolbar.focus` intent returns `focusRovingItem(bubble) || focusRovingItem(toolbarRef.current)`, so a bubble that cannot take focus falls back to the row (§5.2: "bubble when present, else the row").
  - Bubble, `components/smart-toolbar/color-controls.tsx` (D2): `ColorSplit` takes an optional `popoverSide` and `ColorPopoverButton` an optional `side`, passed to `PopoverContent`. The bubble passes its placement (`top` above the selection, `bottom` below), so the colour popover opens away from the selected text; the row keeps the default `bottom`.
  - Bubble, spec §4.3 deviation: the colour popover is portalled to `body`, not rendered inside the bubble. The bubble treats focus in `[data-slot="popover-content"]` (and Base UI's focus guards) as its own while its trigger is expanded.
  - Bubble, DOM contract §5.2: `data-state="open"` now also means usable. The root reads `closed` while the plugin hides it (`visibility: hidden` when the selection scrolls out) or while it sits wholly under the sticky row; focus inside it moves back to the editor first. The root is no longer focusable (no `tabindex`).
  - Overlay track (outline overlay, M4, M9, M10 face, M17a proof):
    - **Outline (D2's shell files):** `useOutlineOpen()` returns `[outlineOpen, setOutlineOpen, { mode, close }]`. The first two keep the pinned name and signature (§5.2); in overlay mode (viewport < 950px) the setter changes transient state and never writes (§6 exception 1 still covers the docked writes). New `components/toc-sidebar/outline-panel.tsx`; `TocSidebar` gains `onNavigate`; `ViewCollapseMenu` and `MainToolbarContent` gain `outlineOverlay` so opening the overlay from View ▾ keeps focus in it.
    - **M9 (D1's `lib/editor-actions/core/blocks.ts`):** the `list.*` actions run `toggleList` and write `LIST_TYPE_CHOICE` on success. `toggleList`, `setListTypeInPlace` and `canToggleList` move from `components/tiptap-ui/list-button/use-list.ts` to `lib/list-commands.ts` (re-exported from `use-list.ts`), so the registry imports no component. `toggleList` now returns true only when the document changed. The actions' `enabled` uses `canToggleList` and refuses the title. The list menu sends list picks through `runAction`; "No list" keeps `setListType(editor, "none")` and writes nothing.
    - **M4 (D1's `lib/editor-actions/core/slot.ts`, D2's `surface-actions.ts`):** `CODE_LANGUAGES` moves to `lib/code-language.ts` with `CODE_LANGUAGE_CHOICE` (slot `codeLanguage`, allowlist without Mermaid, fallback null), `mostUsedCodeLanguage(doc)` and `suggestedCodeLanguage(doc)`. `code.language` / `mermaid.language` write on success; `insert.codeBlock` applies the suggestion. The doc walk runs only inside `run()`.
    - **M10 (D2's `lib/remembered-choice.ts`, `insert-menu.tsx`, `smart-toolbar.scss`):** `INSERT_KIND_CHOICE` is `ChoiceSpec<InsertKind | null>` with fallback null (no remembered kind keeps "+ Insert", D2 Decision 1). The T1 face is `ActionButton` with its label, wrapped in `data-collapse-tier="t2"`. **A5 update:** mouse T2 is < 1264 (was < 1232), because the widest face ("Code block") overflowed the T1 row by 31px where T1 started; touch T1 fits unchanged. `toolbar-memory.spec.ts` checks the widest face at the exact T2 boundary, mouse and touch, and `toolbar-ladder.spec.ts` sweeps with it remembered.
    - **Size (O1 input):** the editor chunk group measures 386.3 KB gz with this track against 385.1 KB on `integrate/smart-toolbar-v1` at `f133508` (both production builds, `scripts/check-editor-chunk-size.ts`): **+1.2 KB gz**, all eager (the outline frame, the M10 face, the M4 helpers and the moved list commands). Nothing was lazy-loaded for it.
  - Integration (O1 lazy split, A9): D2's `insert-menu.tsx` loads its table and embed steps from the new `insert/insert-step.tsx`. Exports and signatures are unchanged.
  - Phone track (docked bar and Aa sheet, spec §4.7; owner: "Build the phone docked bar and Aa sheet now"; merged into `integrate/smart-toolbar-v1-r2` from `feat/smart-toolbar-r2-phone`). Supersedes A5's last sentence: below 768px there is no row. As built:
    - **Where it lives:** the bar is `MobileToolbarContent({ editor, ref, onEscape, menuCells })` in `components/document-editor/mobile-toolbar-content.tsx` (the path PR E's plan names), rewritten in place of the old size-and-colour panel, which is gone. `menuCells` is `PhoneMenuCells({ editor })` from `components/smart-toolbar/phone/phone-menu-cells.tsx` (List ▾, Indent, Insert ▾), rendered by `document-editor.tsx` (see A9 for why). List ▾ is a radio menu like the row's: "No list" and the three `list.*` actions as `menuitemradio`, the current one checked. The `PhoneBar` skeleton in `components/smart-toolbar/phone-bar.tsx` stays a null stub; `phone-selection-cells.tsx` (E) is untouched and not mounted yet. The sheet body is `components/smart-toolbar/phone/format-sheet.tsx` (root `data-format-sheet`, popup `data-toolbar-popup`); the bar and sheet styles are `components/smart-toolbar/phone/phone.scss`. The bar, the sheet and `phone.scss` are one lazy chunk (A9).
    - **`document-editor.tsx` (`isMobile` branch):** below 768px it renders `MobileToolbarContent` (with `toolbarRef`, so Alt+F10 still finds a toolbar) instead of the sticky row, so there is exactly one `role="toolbar"`. `mobileView`, the `useCursorVisibility` `bottom` style and `useToolbarHeight` are removed, with the hooks only that path used (`use-cursor-visibility`, `use-window-size`, `use-element-rect`, `use-throttled-callback`). `SCROLL_CLEARANCE` moves to `lib/editor-scroll-clearance.ts`: one object with live getters (`top` 52, or 8 while the bar is mounted; `bottom` 8 + bar + keyboard inset), so `EDITOR_PROPS` keeps its identity. The bar is a `React.lazy` import rendered only when `isMobile`, inside its own `<Suspense fallback={null}>`. Both toolbars take `useToolbarFocusHandoff(toolbarRef)`'s callback ref (`components/document-editor/use-toolbar-focus-handoff.ts`): crossing 768px with focus in one toolbar moves it to the other, on the same `data-action-id` when that toolbar shows it, else on its tab stop (it only acts while focus is on `body`). `MainToolbarContent` (D1) loses its dead phone path at the integration: `PhoneTextStyleButton`, `onHighlighterClick` and the `isMobile` prop are removed, so the row renders the same at every width from 768px up.
    - **`components/ui/toolbar.tsx` (D1):** `variant` gains `"docked"`: fixed to the bottom, full width, a constant 44px (`h-11`), `border-t`, `[container:mobile-bar/inline-size]`. Roving, Esc and `onEscape` are unchanged.
    - **New `components/ui/sheet.tsx`:** a bottom sheet on Base UI `Dialog`, named exports, hand-written to match `dialog.tsx` (no `shadcn add`, no new dependency). The popup carries `aria-modal="true"` and wraps Tab and Shift+Tab itself (Base UI's focus guards sit outside the portalled popup and let Tab reach them and `body`); reduced motion stops both the open and the close animation.
    - **Cells (44×44, with or without touch):** Undo (`history.undo`), Redo (`history.redo`, from 360px; below it the sheet's More section carries it, and from 360px the sheet hides its copy), Aa ("Text format", `aria-haspopup="dialog"`, no `aria-pressed`), Bold, Italic, List (one `ToolbarMenu` over `list.bullet`/`list.ordered`/`list.task`), Indent (`indent.indent`), Insert (`InsertMenu`, label hidden). The bar is `hidden` when the document is read-only (read from `mark.bold`'s `READ_ONLY_REASON`), which also closes the sheet and sends focus to the document (#308).
    - **Sheet sections**, in this order so the swatches show without scrolling: Colours (`ColorPanel`, `focusKind="text"`, no initial focus, Recent from the bar's M3 read), Style (`style.paragraph`, `style.heading1`–`6`; the title's "Title is always H1." locks them), Size (`FontSizeStepper` over `size.*`), Align (`align.*`), More (`history.redo` below 360px, `indent.outdent`, `mark.underline`, `mark.strike`, `mark.superscript`, `mark.subscript`, `mark.inlineCode`, `format.clear`, `memory.forget`, `mark.link`, theme, its name shown from its `aria-label` by `phone.scss`). Underline, strikethrough and outdent are added because the bar has no cell for them. Link closes the sheet first (the page is `inert` while it is open), so the Hyperlink create popover opens over the page, and that close returns no focus (`finalFocus` is false), so the popover's input keeps it. Picks keep the sheet open; Done returns focus to Aa. While the sheet is open `.app-shell` is `inert` (the sheet is portalled to `body`, outside it), so Tab and screen readers stay in the sheet and the actions' own `chain().focus()` cannot pull focus out of it (which on a phone would raise the keyboard over it); commands still apply. Every target is 44×44.
    - **Keyboard and scroll:** `hooks/use-keyboard-inset.ts` reads `visualViewport` (`innerHeight − height − offsetTop`, once per frame on `resize`/`scroll`) and resets to 0 one frame after focus leaves editable content (iOS drift). The bar is lifted with `translateY(-inset)` and writes `--mobile-bar-clearance` (44 + inset) on `.document-editor-wrapper`, which drives `scroll-padding-bottom`, the editor's bottom padding and the connection chip's offset (`data-collab-status` hook added to `components/tiptap-ui/user-identity-button.tsx`).
    - **Integration notes:** r2-popover removed `ColorPanel`'s `onApplied` prop; the merge drops the sheet's no-op `onApplied`. Nothing in `ColorPanel` closes its container, so a pick still keeps the sheet open (O4), and O3's low-contrast dimming reaches the sheet through `ColorPanel` with no other change.
    - **Not built (follow-ups):** ~~the context slot cell (and the < 352px rule that moves its tools into the sheet)~~ (built, below), ~~the phone selection swap (`PhoneSelectionCells`, PR E)~~ (built by PR E), ~~`env(safe-area-inset-bottom)` under the bar (the sheet already pads by it)~~ (built, below), and a check of keyboard docking on a real iOS device or the WebKit project (Chromium has no on-screen keyboard; the e2e stubs `visualViewport`), which is still open.
    - **Follow-ups built** (`fix/toolbar-followups-phone`, changelog "Smart toolbar follow-ups"):
      - **Slot cell:** `SlotCell` in `phone/phone-menu-cells.tsx` renders the row's T3 stand-in `SlotCollapseButton` between Indent and Insert, so the cell adds no module to the editor chunk (it already holds the stand-in), only the call site. In a media context the cell is a direct `ActionButton id="media.options"`, as in the row's slot: through the one-item menu, the menu's close handed focus back to the editor and away from the kit toolbar that Media options focuses. Phones never mount `ContextSlot`, so the cell calls `useToolbarHold` from an always-rendered `display: contents` wrapper (`data-phone-slot`); focus in the bar or the cell's menu holds the slot. Width rules (`phone.scss`; the bar's cells get the viewport less its 8px padding, so eight 44px cells need 360px and nine need 404px): from 404px every cell shows; from 360 to 403px Redo yields to the slot cell while it shows (`:has()` scoped to the bar) and the sheet shows its Redo; below 360px (the contract's "< 352px" of bar) the cell is hidden and the sheet carries its tools in a section after Colours named like the cell, with the language as a native `<select>` and Media options closing the sheet first, like Link. The sheet keeps its own copy of the tool ids and labels: importing `context-slot.tsx` from the lazy bar chunk split the row's slot modules into a shared chunk and cost the editor group 966 B gz.
      - **Safe areas (M6):** `viewportFit: "cover"` in `app/layout.tsx`; `--safe-area-top/right/bottom/left` on `:root` read `env(safe-area-inset-*)` (one token each, so the e2e stands in a notch where Chromium reports 0). The tab strip and `.skeleton-tab-bar` grow by the top inset; `.app-shell` and `.app-skeleton` pad the side insets; the bar grows by the bottom inset unless `data-keyboard` (set while the keyboard inset is non-zero); the sheet and `.site-page` (/about, /privacy, /offline) pad by the insets. The scroll clearance reads the bar's measured border-box height (ResizeObserver) instead of the 44px constant.
      - **Swipe to close (M7):** `components/ui/sheet.tsx`. `Sheet` passes an `actionsRef` through context; `SheetHeader` handles pointer drags (not on its buttons): captured after 6px, closes past 80px or on a 0.5 px/ms flick through `actions.close()`, else snaps back; reduced motion makes the snap and the close instant. A drag handle (`before:`) and `touch-action: none` on the header.
      - **List re-tap:** the checked list type renders as a plain radio item that only closes the menu (the row's radio group reports changes only).
      - **Size:** editor chunk group 401,485 B gz against 401,387 B on `main` at `7abadc1`: **+98 B**, 467 B under the 23.5 KB budget.
  - PR E (rebuilt on `integrate/smart-toolbar-v1-r2` as `feat/smart-toolbar-e-v11-r2`; on `feat/smart-toolbar-e-v11` this grant was recorded as E's own A6, before the r2 tracks took the number). E's edits outside §5.1/§5.2:
    - `.github/workflows/nightly.yml`: one `Palette budget` step after the `pwa` tests (and `id: servers` on `Start servers`), which runs `PALETTE_BUDGET=1` against the job's production build (A7). §5.2 assigns only `ci.yml` (to D2) and leaves `nightly.yml` unassigned.
    - `package.json`: besides `cmdk` (§5.1 allows "cmdk only"), a `patchedDependencies` entry for `patches/cmdk@1.1.1.patch` (new file), which keeps `aria-activedescendant` on cmdk's highlighted option. `tests/unit/ci/cmdk-patch.test.ts` (new) fails when cmdk's version moves or the installed dist lacks the patch, so any cmdk upgrade drops or re-makes it.
    - `components/smart-toolbar/index.ts` (frozen, append-only): the `PhoneSelectionCells` and `RepeatSplitButton` re-exports are **removed**. The barrel's one consumer, `main-toolbar-content.tsx`, otherwise pulled the split button and its menu into the editor chunk (950 B gz measured); their consumers, the lazy bubble and phone bar, import them by path.
    - Phone bar (`components/document-editor/mobile-toolbar-content.tsx`, `components/smart-toolbar/phone/phone.scss`): mounts `PhoneSelectionCells`, which supersedes the phone track's "not mounted yet" and the swap in its follow-up list. While text is selected (not a caret or node selection) the bar renders the selection cells in its one `role="toolbar"`, labelled "Selection formatting" (`data-bar-mode="selection"`). It never swaps while focus is in the bar (`focusin`/`focusout` on the bar) or while the Aa sheet is open. ✕ ("Back to all tools") keeps the normal cells until the selection collapses (`dismissedForSelection` resets on a caret, not on every remap, so a remote edit cannot bring the cells back under the user). In selection mode the bar scrolls sideways (no scrollbar in its 44px) with `scroll-padding-inline-end: 44px` under the sticky ✕ (§5.3, WCAG 2.4.11). The colour cells pass the remembered colour (M3) as `ActionButton`'s `arg`, with the `label` prop naming it ("Apply text colour: Red"); without an argument they ran nothing.
    - `tests/TESTING.md` rows for `palette.spec.ts` and `palette-leaks.spec.ts`; tests in `mobile-bar.spec.ts` (selection cells; the existing cases select text and go Back first), `toolbar-surfaces.spec.ts` and `toolbar-a11y.spec.ts` (their phone-sheet cases go Back first too), `lazy-surfaces.spec.ts` and `helpers/lazy-chunk.ts` (palette and engine chunk markers; the restore now waits for handlers in flight before it unroutes, which fixed a "Route is already handled" flake in the colour case as well).
- **A7 (E): palette budget is 20 KB gz.** Owner decision O5 of 2026-11-13 (spec §7 said 15 KB): the palette chunk plus cmdk, as the first Alt+/ loads it from a production build, stays within 20 KB gz. `palette.spec.ts` asserts it with `PALETTE_BUDGET=1`; the nightly `pwa` job runs it on its production build, since PR CI has no production server. Measured 2026-11-13 on `feat/smart-toolbar-e-v11-r2` (`next start`, chromium): **19,981 B** (two scripts, 171 + 19,810 B), 499 B under the budget (on `feat/smart-toolbar-e-v11`: 19,979 B). The palette reads E's bundle code through the engine (A8) and imports none of it: when it did, its first load carried a second copy of the engine and measured 25,087 B.
- **A8 (E): PR E's editor-chunk growth, and a lazy engine.** Same method as A9 and A11 (`bun run build` with no `NEXT_PUBLIC_*` overrides, then `scripts/check-editor-chunk-size.ts`).
  - **Measured on r2:** `integrate/smart-toolbar-v1-r2` (24a6526) is **397,234 B gz, +19,346 B**, 1,134 B under A11's 20,480 B. E as it was on `feat/smart-toolbar-e-v11` (every module eager), cherry-picked onto it: 406,138 B, +28,250 B, **7,770 B over**. E on this branch: **401,311 B gz, +23,423 B (+22.87 KB), 2,943 B over A11's budget**, +4,077 B over r2. **`check-editor-chunk-size.ts` fails on this branch**; the budget is not raised here (A11: only a new amendment raises it). The owner decides between raising it for E, more lazy splitting (below), or holding E.
  - **Lazy engine:** the action bodies (`enabled`, `value`, `options`, `run`), the Repeat commands, the bundle recorder, saved formats, the doc scan and the Mermaid templates move to `lib/editor-actions/v11-engine.ts`, which evaluating installs (`installV11Engine`). `v11-actions.ts` keeps the six definitions (id, label, group, contexts, keywords, shortcut) and the loader. `RepeatFormatting` is an eager shell: it binds Mod-Alt-v/F4 through `runAction`, delegates the commands, starts `loadV11Engine()` in `onCreate`, and hands every transaction to the engine. From the 406,138 B of the cherry-picked branch: dropping the barrel re-exports saved 950 B (405,188 B), the lazy engine about 3.9 KB more (401,287 B), and the palette and phone fixes that followed add 24 B (401,311 B).
  - **Behaviour until the engine lands** (milliseconds after an editor is created; or never, offline with an uncached chunk): E's five engine actions are unavailable with "Formatting tools are still loading." (`ENGINE_LOADING_REASON`); Mod-Alt-v and F4 return false and pass through; the commands return false; the extension buffers up to 50 transactions (with their states) and records them in order once the engine is installed, by whichever importer lands first. A failed engine fetch clears its promise, and each palette open retries it; the palette opens without the engine (E's rows then show the reason) and rebuilds its rows when it arrives. §3.1's "registry `run` is synchronous" still holds: nothing awaits inside `run()`.
  - **Where the remaining 4,077 B go:** an ablation build with the palette and split button removed (engine lazy) measured 399,627 B, so E's eager shell (definitions, extension shell, palette host, store and hotkey) is about **2,393 B**; the rest is chunking, which Turbopack does by consumer set: the palette chunk costs about 344 B and the split button inside the bubble chunk about 968 B of editor-group files (modules they share with the editor get split into separate, less compressible files). Removing every one of those still leaves the shell 1,259 B over the headroom, so E cannot fit 1,134 B without moving the palette listener and store lazy as well, which saves only part of it.
  - **Known cost outside the budget:** the bubble and phone chunks carry their own copies of the engine (about 5.4 KB gz each, on first show) instead of reusing the engine chunk; Turbopack keys chunks by group, and the runtime registers a module once, so the engine still evaluates once. Routing those surfaces' bundle reads through `getV11Engine()` (as the palette does) would remove the copies.
- **A9 (integration): owner decision O1, lazy surfaces and a measured editor-chunk budget.** (A7 and A8 are taken by E on `feat/smart-toolbar-e-v11`; this number avoids them.)
  - **Lazy:** the colour popover body and the selection bubble (already, from D2 and the bubble track), and now the Insert menu's table grid and embed form (`insert/insert-step.tsx`, which takes `TableSizeGrid` and `MediaEmbedForm` out of the editor chunk). The step chunk is fetched on the Insert button's hover or focus, or as soon as an `insert.open` intent arrives, and both steps focus themselves on mount, so the keyboard path is unchanged. The phone bar and the Aa sheet (A6, phone track) are one lazy chunk with their styles (`phone.scss`): `document-editor.tsx` imports `MobileToolbarContent` with `React.lazy` and renders it only below 768px, so desktop never fetches it; the sheet body is a static import inside that chunk, ready when Aa is first pressed. The bar's List ▾, Indent and Insert ▾ cells (`PhoneMenuCells`) are rendered by `document-editor.tsx` and passed in as `menuCells`: when the bar's chunk imported the row's menus itself, Turbopack split every module the editor and the bar share into a separate chunk of the editor group, and the lost compression cost the group about 1.5 KB gz (measured: 397,757 B with the bar importing its cells and the sheet as a second lazy chunk, 397,378 B with the sheet folded in, 396,600 B with the cells passed in).
  - **Tried and not kept:** (1) the context slot's controls as a lazy chunk. They are on screen at first paint whenever the caret is in a heading, code block, table or media, and `toolbar-row.spec.ts` ("never reached Fold section / Mermaid diagram") failed on both attempts because the row could be arrowed through before the chunk arrived. (2) Every `ToolbarMenu` body (`ActionMenuItem`, `ActionRadioItem`) and the Insert items as lazy chunks, with idle-time preloads. Under the three-worker dev e2e load `selection-bubble.spec.ts` went from 0–2 failures per run (no splits) to 4–6; the bubble's root was removed without its `onHide` firing. Together these saved 0.4 KB gz, so they were reverted rather than chased. **Cause found 2026-11-13** (`feat/smart-toolbar-r2-fixes`): `BubbleMenu` keeps one root `div` for its lifetime, and its effect cleanup unregisters the plugin and then removes that root one frame later (`requestAnimationFrame`) if it has a parent. Dev StrictMode runs the effect twice, so the second plugin registers with the same root. When a selection already exists at mount (the bubble chunk landed after it, which more lazy chunks under three workers make likely), the second plugin shows the root at once, and the first cleanup's frame then detaches the shown bubble without `onHide`; the plugin keeps `isVisible` and never shows it again until a hide. `SelectionBubbleView` now re-appends the root in a frame queued after that one when it is detached but open. `selection-bubble.spec.ts` ("shows for a selection made before its chunk arrived") holds the bubble chunk until after the selection and failed 3 of 4 runs before the fix. The same re-registration happens in production when the editor prop changes.
  - **Eager by design:** triggers, `ActionButton`, the registry and action bodies, the snapshot store and keyboard shortcuts, so every shortcut works before any chunk loads. The editor is a client-only `next/dynamic` import, so nothing here can mismatch on hydration.
  - **Measured** (`bun run build`, then `scripts/check-editor-chunk-size.ts`, no `NEXT_PUBLIC_*` overrides, same as CI) on `integrate/smart-toolbar-v1-r2` after the five r2 merges and the step split: 396,756 B gz, **+18,868 B (+18.43 KB)** over the 377,888 B baseline. `EDITOR_CHUNK_BUDGET_BYTES` is therefore **18.5 × 1024 = 18,944 B** (the growth rounded up to the next 0.5 KB; 76 B of headroom), enforced by the existing CI step. Raising it again needs a new amendment. A source-map comparison with `58a9d22` puts the remainder in eager code: the action registry and bodies (`surface-actions`, `core/slot`, `core/blocks`, `core/inline`), the context snapshot and store, `remembered-choice`, `list-commands`, `code-language`, text-style tokens and marks, about 7.8 KB raw of extra `lucide-react` icons for registry actions, the T2–T5 stand-ins (`collapse-menus.tsx`, on screen at first paint below 1264px) and the row primitives; it drops the old toolbar's `react-hotkeys-hook` and colour popover.
  - **Measured after the phone track** (same method, `integrate/smart-toolbar-v1-r2` after merging `feat/smart-toolbar-r2-phone` and the lazy split above): 396,600 B gz, +18,712 B (+18.27 KB). The a11y fixes that followed (focus handoff across 768px, the radio List menu) are eager and bring it to **396,816 B gz, +18,928 B (+18.48 KB), 16 B under the 18,944 B budget**, which is unchanged. Without the split (bar eager, sheet lazy) the merge measured about +19.8 KB, over budget. To fit, the List menu reuses `ActionRadioItem` (so picking the checked list type toggles it off, where the row's menu does nothing) and the theme row's label is CSS in the lazy `phone.scss` rather than a `ThemeToggle` prop. The next eager addition will need a trim or a new amendment.
  - **Load failures (r2 fixes, `feat/smart-toolbar-r2-fixes`):** a lazy chunk that fails to load (offline, or a deploy replaced it) no longer takes the page down. `components/smart-toolbar/lazy-surface.tsx` holds `SurfaceBoundary` (Suspense plus an error boundary that renders nothing on failure) and `lazySurface(load, fallback?)`, which renders the lazy component inside its own boundary. React keeps a rejected `lazy()` for good, so the boundary's `componentDidCatch` swaps in a fresh one and the next open fetches again; swapping earlier (in the rejection) would make React's retry render refetch in a loop. The colour panel, the Insert step and the bubble view are `lazySurface`s; a failed colour or Insert chunk leaves an empty popover, a failed bubble chunk leaves no bubble until the next editor mounts it. Hover and focus preloads swallow their rejection, and after the first server sync both the colour and Insert chunks are fetched when the browser is idle, so the service worker has them for offline use. `lazy-surfaces.spec.ts` 404s each chunk under `next dev` and checks that the editor and tab strip stay mounted, typing works, and (colour, Insert) the next open loads the chunk. Measured (same method): on `f4067b8` plus every r2-fixes commit, including the a11y items I3, I9 and M4, 396,825 B gz, +18,937 B, 7 B under the 18,944 B budget (+225 B over `f4067b8`: about 160 B for the boundary, loader and idle preload, about 65 B for I9 and M4). Rebased on `c502a4c`, whose phone a11y fixes added 216 B: 397,036 B gz, +19,148 B, 204 B over the 18.5 KB budget; with the heading-fold timer fix that followed, **397,058 B gz, +19,170 B (+18.72 KB)**. The owner then set the budget to 20 KB (A11, on the integration branch), which this fits with 1,310 B to spare; the constant is not changed on this branch. One lead: item (2) under "Tried and not kept" (menu bodies as lazy chunks) was reverted only for the bubble flake, whose cause is now fixed; its own saving was never measured apart from the context slot's, and each new lazy chunk costs about 118 B of loader. `ActionButton` gained an optional `label` (accessible name and tooltip; the visible text stays the action's label) for the Insert face (I9); existing callers are unchanged.
- **A10 (soaks track): the 50k colour soak and the mixed-version soak are nightly jobs** (§1.2 step 2, §1.3 C's deferred soak). Standalone Bun scripts against a running Hocus (`make dev-hocus`), in the style of the load harness; `nightly.yml` jobs `color-soak` and `mixed-version`; details in `tests/TESTING.md` (Schema soaks). Scheduled nightlies run on `main` only, where these scripts' v1 modules do not exist yet, so before v1 → `main` the owner starts them by hand (Actions → Nightly → Run workflow) on `integrate/smart-toolbar-v1` once this lands there.
  - **Colour** (`tests/load/color-mark-soak.ts`, `COLOR_SOAK_TOGGLES`, 3,000 locally, 50,000 nightly): 3 clients toggle `textColor`, `highlight` and `fontSize` on overlapping ranges; fails on divergence (clients and a late verifier reading the stored copy), any `4422`/`4413` refusal or schema/size event in the server log, a schema misfit, the size cap, or super-linear growth. **Finding:** Yjs keeps a tombstone per removed format run, so the state grows linearly, about 20–23 B per toggle. 50,000 toggles reach about 1.1 MB (1,149,103 B in the local run), so against the 1 MiB default cap the run was refused with `document_too_large` after about 34k toggles (the guard's estimate adds updates not yet stored to the stored size). The nightly job therefore runs at production's 2 MiB cap (`MAX_DOC_SIZE_BYTES=2097152`, `ecosystem.config.cjs`). The cap is the only bound, as with any edit churn: each toggle costs about 20 B and shows nothing, so a client toggling formats can grow a document to its cap and make it read-only for everyone. Accepting 2 MiB as the soak cap is an owner call.
  - **Mixed version** (`tests/load/mixed-version-soak.ts`, `MIXED_SOAK_ROUNDS`, 30 locally, 300 nightly, throttle on, `HOCUS_MIN_CLIENT_SCHEMA` unset): the env default is log-only, but on v1 the built-in floor makes the effective minimum 2, so pre-N clients (no `schema`, `schema=1`) are **refused** (`client_outdated`, tab list still synced, no `4205`), not admitted. A release N editor (`schema=2`, no new marks) stays editable through text-only edits, then freezes (`outdated`) when colour and size arrive and sends nothing more; the N+1 editor never freezes. The stored copy keeps every block, all text typed before the freeze and the N+1 marks. This is the "0 deleted blocks, 0 unexpected freezes" gate.
- **A11 (owner, 2026-11-13): editor-chunk budget raised from 18.5 KB to 20 KB** (`EDITOR_CHUNK_BUDGET_BYTES = 20 * 1024`). After the phone track and its a11y fixes the growth was +18,928 B against 18,944 B (16 B left), and the lazy-chunk error boundaries, idle preloads and a11y review fixes still to merge are eager. The owner chose 20 KB, the same figure approved for PR E's palette (E's A7), over cutting more surfaces lazy, which A9 showed breaks keyboard reach at first paint and makes the bubble flakier. Raising it again needs a new amendment.
- **A12 (owner, 2026-11-13): editor-chunk budget raised from 20 KB to 23.5 KB for PR E, and E merges now.** E on `main` after v1 (#32) measured +22.9 KB (A8's figure, 2,943 B over 20 KB): E's eager shell (action definitions, Repeat shell, palette host, store and hotkey) is about 2.4 KB and Turbopack splitting adds about 1.3 KB; the engine, palette and Formats menu stay lazy. The owner chose to raise the budget ("raise the E budget and merge it") over more lazy splits or holding E, rounded up to the next 0.5 KB as in A9 and A11 (`EDITOR_CHUNK_BUDGET_BYTES = 23.5 * 1024`). The same instruction waives §8's hold (E after 14 days of v1 metrics in production) under O10: E ships with v1's first deploy. Raising the budget again needs a new amendment.

### Open owner decisions (v1 → `main` blockers)
Not decided by any track. Each needs the owner's call recorded here before v1 opens against `main`. O1, O2, O3, O4, O6, O8, O9 and O10 are decided; O7 is closed by measurement. O5 is the owner's palette budget, which E records as A7 on `feat/smart-toolbar-e-v11`; it is not a v1 item.

- **O1: editor chunk over budget.** **Decided 2026-11-13 (owner): lazy-load the surfaces that are not on screen at first paint, then set the budget to the measured remainder and enforce it in CI. Done in A9 (+18.5 KB gz budget, +18.43 KB measured).** Original note: Measured on the integration build after E's back-out and the ladder: **+16.1 KB gz** over the 377,888 B baseline against a +6 KB budget (the existing builds in the D1 and D2 worktrees read +6.9 and +10.9; those builds were not refreshed and may be stale), so CI's checks job is red. A trial lazy split of the Insert menu body and steps saved only 0.2 KB, so it was not kept: the growth is the action registry, snapshot and row framework, which are eager by design (keyboard shortcuts and the row need them at first paint). Options: split the registry so slot and surface action bodies load on first use, or amend §5.1/§7 with the measured number. The budget is not raised in code.
- **O2: arrow-key budget.** **Decided 2026-11-13 (owner): log-only in v1.** `toolbar-row.spec.ts` keeps logging the arrow and Shift+Arrow p95 with and without the toolbar and asserts neither; a budget (a delta, or a base-performance fix) is a follow-up after v1. Original note: Spec §7 asks for arrow and Shift+Arrow p95 < 16 ms in a 500-heading document. Reported: 87.8 ms with the toolbar, 91.4 ms without; measured on the integration (dev build): 86.6 ms with, 92.1 ms without; the toolbar is not the regression, and `toolbar-row.spec.ts` only logs it. Either restate it as a delta (toolbar on ≤ off +10% / +16 ms, which holds today) and assert that, or open a base-performance investigation (TOC, fold, `content-visibility`).
- **O3: text colour on a highlight** (spec Appendix A). **Decided 2026-11-13 (owner): (a), dim. Highlight swatches that would put the current text colour below 4.5:1 are dimmed and described "Low contrast" but stay selectable; text swatches never dim (`lib/text-style-contrast.ts`, `feat/smart-toolbar-r2-popover`).** Original note: 77 of 100 light and 49 of 100 dark palette pairs are below 4.5:1 and D2's popover combines them freely. (a) dim or warn on low-contrast swatches, (b) a scoped darker variant, or (c) accept as author-chosen content. Pinned in `tests/unit/extensions/text-style-palette.test.ts`.
- **O5: palette budget.** The owner's O5 is the command palette's budget. It belongs to PR E, which is not in v1, and E records it as A7 on `feat/smart-toolbar-e-v11`. This list used to call the typing-budget item below O5; it is now O7.
- **O7 (listed as O5 until 2026-11-13): perf typing budget in the CI configuration.** After the ladder, `--project=chromium --project=perf` failed once on 50 headings: toolbar on 6.1 ms vs off 4.9 ms p95 (budget +10%); the perf project alone passed. Not yet re-measured in the combined run. First suspect: the tier stand-ins are always mounted while hidden, adding about six `useActionView`/`useSlotTarget` subscriptions to the row. A5's thresholds also need the owner's acceptance. **Closed 2026-11-13 by measurement:** the combined run of `--project=chromium --project=perf` on `integrate/smart-toolbar-v1-r2` after the r2 fix merges (40a5fb4) passed 241/241 with no flaky tests; the per-run medians were 10 headings off 4.8 ms / on 4.6 ms and 50 headings off 5.8 ms / on 5.4 ms, so the toolbar adds no measurable typing cost and the +10% budget stays as it is.
- **O4: colour popover keyboard behaviour changed from PR A's assertions.** **Decided 2026-11-13 (owner): restore PR A / spec §4.5. Enter or a click applies the swatch and keeps the popover open with focus on it; Esc returns focus to the trigger (`feat/smart-toolbar-r2-popover`).** Original note: With D2's popover, Enter on a swatch applies it and closes the popover (PR A: stayed open); initial focus is the pressed swatch, so "No highlight" when nothing is applied (PR A: Green); arrows follow the token order; the check glyph sits on its own badge. PR A's per-swatch forced-colours border check is restored against D2's swatch. Accept, or restore PR A's behaviour.
- **O6: `marked` declared as a direct dependency (leak fix, `fix/editor-tab-leak`).** §5.1 says any track other than E asks before adding a dependency, and the A6 file grant does not cover `package.json` or `bun.lock`. The leak fix imports `Marked` to give each editor its own instance (the shared one kept every destroyed editor reachable), so `marked` is now declared at `^17.0.6`. It adds no package: `bun.lock` gains only the root line and still resolves the one `marked@17.0.6` that `@tiptap/markdown` already installs. Leaving it undeclared would import a transitive package. **Decided 2026-11-13: the owner approved declaring `marked` as a direct dependency**, and asked for the fix to ship in its own PR to `main` as well as in v1.
- **O8: collab typing-latency comparison (toolbar on vs off with a remote editor).** The HoE final review asked for this measurement or an owner waiver before `main`. **Waived 2026-11-13 (owner).** Local typing p95 stays gated by the `perf` project; remote changes coalesce through `TOOLBAR_MAX_WAIT_MS`, and the 50k colour soak (A10) covers multi-client convergence.
- **O9: format-toggle growth fills the document size cap.** The colour soak (A10) shows Yjs keeps a tombstone per removed format run, about 23 B per toggle, so repeated toggling can push any document to its cap and leave it read-only (the 1 MiB default is reached after about 34k toggles; highlight already behaved this way before v1). **Decided 2026-11-13 (owner): accept production's 2 MiB cap (`MAX_DOC_SIZE_BYTES=2097152`) as the limit for v1**; no extra toggle guard or compaction. The nightly colour soak runs at 2 MiB.
- **O10: v1 merges to `main` before release N is deployed and before the N+1 adoption reading.** **Decided 2026-11-13 (owner):** "just finish all jobs and tasks, when I come back I want to see all those features we worked and planned in the prod. just do it." The release-order gate (§1.2: N deployed, ≥ 95% `schema=2` for 24 h held 48 h) is waived. Safety rests on the server floor (`SCHEMA_FLOOR = 2`) and the ingress allowlist, which ship with this release: pre-N tabs are refused per document (`client_outdated`) until they reload, and the mixed-version soak (A10) shows no content lost, no `schema_rejected` and no throttle bans. The next deploy runs PR B's and PR C's Deploy notes together, Hocus first. The ladder thresholds (A5) ship as measured.
