# Smart toolbar v1: shared contract for PR C, D1, D2 and E

Status: **binding for the parallel build** · Date: 2026-11-13 · Base: `integrate/smart-toolbar-v1` (PR A and PR B merged) · Skeleton commit: see §9

This document is the interface between four tracks built at the same time by different engineers. The design lives in [the spec](2026-11-12-smart-toolbar-design.md). This document only fixes **names, signatures, file ownership and merge order**. The skeleton commit already puts every shared module in place, with stub bodies, so each track compiles against the others from the start. `tests/unit/editor-actions/contract.test.ts` pins the shapes. A track that needs to change a pinned shape changes this document and the test in the same commit, and tells the other tracks.

## 1. Tracks and merge order

| Track | Branch | Scope (spec §) |
|---|---|---|
| **C**: schema | `feat/smart-toolbar-c-schema` | `textColor`/`fontSize` marks, highlight value tokens + legacy mapping + server rewrite, render-time enforcement, paste rules, server allowlist entries, `SCHEMA_FLOOR = 2` (§3, §3.1, §8.3) |
| **D1**: registry + row | `feat/smart-toolbar-d1-registry` | action registry, context snapshot + store, sorted row, context slot (all kinds), ⋯ overflow, keyboard model (roving tabindex, Alt+F10, Esc), clear formatting, indent action, M4 code language, M5 (§2, §4.1, §4.2, §6) |
| **D2**: surfaces + memory | `feat/smart-toolbar-d2-surfaces` | colour popover + split faces (M1–M3), size stepper, selection bubble, memory layer + Forget (M6, M9, M10, M17a), responsive ladder, outline overlay < 950px, phone bar + Aa sheet, Insert menu with Table (§4.3, §4.5–4.7, §5) |
| **E**: v1.1 | `feat/smart-toolbar-e-v11` | Alt+/ palette (lazy) + M11, Repeat/Copy formatting (M7), Your formats (M14), In this doc (M12), Mermaid templates (M17b), mobile selection swap (§4.4, §5) |

**Merge order: C → D1 → D2 → E** into `integrate/smart-toolbar-v1`. Each track rebases on the previous one just before it merges, then re-runs `bun run check`, `lint`, `typecheck`, `test` and its e2e. The tracks build in parallel against the stubs, so only the shared-file hunks in §5 should conflict.

**Production order is separate and still spec §3.1.** C's server half (allowlist + `SCHEMA_FLOOR`) is deployed and Hocus is restarted **before** any Next build that writes `textColor`/`fontSize`. D1, D2 and E add no schema names.

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
Rules: token values are append-only. C adds the contrast unit test (spec §3: every text token ≥ 4.5:1 and every token ≥ 3:1 on both page backgrounds). If C changes a hex value, it changes Appendix A in the spec too.

### 2.2 Editor commands (type-only today: `extensions/text-style-marks/commands.ts`)
```ts
declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    textColor: { setTextColor: (token: TextColorToken) => ReturnType; unsetTextColor: () => ReturnType };
    fontSize:  { setFontSize: (size: FontSizeToken) => ReturnType;   unsetFontSize: () => ReturnType };
  }
}
// highlight: stock setHighlight({ color: HighlightToken }) / unsetHighlight(); attribute key stays `color` (B4)
```
Semantics C must deliver:
- Each command is one transaction.
- An empty selection sets a stored mark. The marks are inclusive, like bold.
- An invalid token returns `false` and changes nothing.
- `setFontSize` returns `false` in headings and the title. That rule lives in the command and the paste rules, never in the schema.
- Nothing grows `fontSize` beyond the ladder.

C puts the mark extensions in `extensions/text-style-marks/` (`text-color.ts`, `font-size.ts`, `index.ts`). C may move the `declare module` block into those files, but must keep the signatures. Today no mark is registered anywhere. C registers `TextColor`, `FontSize` and the token highlight in `components/document-editor/document-editor-config.ts` and in `tests/helpers/create-test-editor.ts`.

### 2.3 Server half and floor (C owns; none of it is in the skeleton, on purpose)
- **`lib/schema-names.ts`**: C adds `"textColor"` and `"fontSize"` to `SCHEMA_MARK_NAMES`. C also flips the contract test "keeps the pending marks out of the ingress allowlist", and updates `tests/unit/schema/schema-snapshot.json` plus its test. Only C touches the snapshot.
- **`SCHEMA_FLOOR = 2`**: export it from `lib/security/client-schema-gate.ts`, together with `effectiveMinClientSchema(envMin: number): number` (`= Math.max(envMin, SCHEMA_FLOOR)`). `scripts/hocus-server.ts` uses that function wherever it reads `HOCUS_MIN_CLIENT_SCHEMA` today. The floor can only go up (B3). Do not add the constant, not even with the value 0, outside PR C.
- **Highlight value rewrite**: extend `lib/yjs-mark-migration.ts` so `afterLoadDocument` rewrites legacy `var(--tt-color-highlight-X)` to `X`. This is cleanup only; the mark itself already maps legacy values when it renders.
- **Render-time enforcement**: `renderHTML` emits only a known token as `data-*`, with no `style`. An unknown value renders as plain text. Never use ProseMirror attribute `validate`.
- **Paste (P10)**: drop foreign `color`, `font-size` and `background-color`. Keep our own `data-text-color`, `data-font-size` and `data-highlight`.
- **CSS**: put it in a new partial, `extensions/text-style-marks/text-style-marks.scss`, imported once by `document-editor.tsx`. Do not grow `document-editor.scss`. The highlight rules already there stay where they are.
- **CHANGELOG Deploy note**: restart Hocus first, confirm the refusals in the log, then restart Next (spec §3.1 steps 3–4).

## 3. PR D1: actions, context, store

### 3.1 `lib/editor-actions/types.ts` (exists, complete; D1 owns)
```ts
export const CONTEXT_KINDS = ["readonly","media","mermaid","code","table","title","heading","list","paragraph"] as const; // precedence order
export type ContextKind = (typeof CONTEXT_KINDS)[number];
export const ACTION_GROUPS = ["history","style","mark","color","size","list","align","indent","insert",
  "section","table","code","media","format","view","memory"] as const;
export type ActionGroup = (typeof ACTION_GROUPS)[number];
export type KeyCombo = string;           // ProseMirror keymap notation: "Mod-b", "Mod-Alt-v", "F4", "Mod-\\"
export type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;   // from lib/icons.tsx
export type Enabled = true | { reason: string };

export interface Ctx {
  readonly kind: ContextKind; readonly state: EditorState; readonly editable: boolean;
  readonly empty: boolean; readonly parentType: string;
  readonly inTable: boolean; readonly inList: boolean; readonly inBlockquote: boolean; readonly inCodeBlock: boolean;
  readonly isTitle: boolean; readonly nodeSelectionType: string | null;
  readonly headingLevel: number | null; readonly headingId: string | null;
  readonly activeMarks: ReadonlySet<string>;
  memo<T>(key: string, compute: () => T): T;   // lazy, lives as long as the snapshot
}
export interface ActionOption<Arg> { value: Arg; label: string; keywords?: readonly string[] }
export interface Action<Arg = undefined> {
  readonly id: string; readonly label: string; readonly group: ActionGroup;
  readonly contexts: readonly ContextKind[] | "any";
  readonly keywords?: readonly string[]; readonly icon?: IconComponent;
  readonly shortcut?: KeyCombo; readonly markdownHint?: string;
  enabled(ctx: Ctx): Enabled;
  isActive?(ctx: Ctx): boolean; isMixed?(ctx: Ctx): boolean;
  value?(ctx: Ctx): string | null;
  options?(ctx: Ctx): readonly ActionOption<Arg>[];
  run(editor: Editor, arg: Arg): boolean;      // one transaction = one undo step
}
export type AnyAction = Action<unknown>;
export interface ActionView { readonly id: string; readonly enabled: Enabled; readonly active: boolean;
  readonly mixed: boolean; readonly value: string | null }
export function defineAction<Arg = undefined>(action: Action<Arg>): Action<Arg>;
```
Changes from the spec's sketch:
- `run` returns `boolean`, because only a successful run may write memory.
- `Action` takes a typed `Arg`. `run` still re-validates its argument at runtime, because palette and registry callers pass `unknown`.
- `options()` serves submenus and palette rows: swatches, table sizes, templates, code languages.
- `icon` is a component, not a name.

Every action:
- returns a reason from `enabled()` when `!ctx.editable`, which covers global read-only (#308);
- reads only `ctx` in `enabled`, `isActive`, `isMixed`, `value` and `options`, caching doc-derived values with `ctx.memo`;
- never reads the DOM.

### 3.2 `lib/editor-actions/registry.ts` (exists, complete; D1 owns)
```ts
export interface ActionFilter { group?: ActionGroup; context?: ContextKind }
export interface ActionRegistry { get(id: string): AnyAction | undefined; has(id: string): boolean;
  list(filter?: ActionFilter): readonly AnyAction[] }        // registration order
export function createRegistry(actions: readonly AnyAction[]): ActionRegistry;   // throws on duplicate id
export function isOfferedIn(action: AnyAction, kind: ContextKind): boolean;
export function canRun(action: AnyAction, ctx: Ctx): boolean;
export function runAction(editor: Editor, action: AnyAction, arg?: unknown): boolean;  // rechecks the LIVE doc
```
The registry is immutable and composed in `lib/editor-actions/index.ts` (frozen file):
```ts
export const editorActions = createRegistry([...coreActions, ...surfaceActions, ...v11Actions]);
```
Nothing registers on import. That keeps it safe under HMR and under `bun test`'s shared process. Duplicate ids throw at build time, and the contract test checks that ids are unique and stay inside each track's prefixes.

**Surfaces never take their layout from the registry.** The row, slot, bubble, phone bar, Aa sheet and ⋯ each keep a const array of action ids or component slots. Only the **palette** and **Insert** (`list({ group: "insert" })`) list from the registry. A surface skips an id that `editorActions.has()` does not know, so D1's ⋯ can name `memory.forget` before D2 lands.

### 3.3 Context snapshot and store (exist; D1 replaces the bodies)
```ts
// lib/editor-context/snapshot.ts
export function computeContext(editor: Editor): Ctx;     // O(depth); kind by CONTEXT_KINDS precedence
// lib/editor-context/store.ts
export interface EditorContextStore {
  subscribe(listener: () => void): () => void;  // = getEditorVersionStore(editor).subscribe
  getVersion(): number;
  getContext(): Ctx;                // live, memoized by store version
  getSlotContext(): Ctx;            // frozen while any hold() is open; drives slot CONTENTS only
  getView(id: string): ActionView | null;   // same object while fields are equal; null for unknown ids
  hold(): () => void;               // ref-counted; release idempotent; also release on unmount
}
export function getEditorContextStore(editor: Editor): EditorContextStore;  // WeakMap per editor
// hooks/use-editor-context.ts
export function useActionView(id: string, editor?: Editor | null): ActionView | null;
export function useEditorContext(editor?: Editor | null): Ctx | null;
```
**Deviation from spec §2:** the spec puts `getContext`/`getView` on `getEditorVersionStore`. The contract puts them in `lib/editor-context/store.ts`, which wraps that store with the same versions and timing (`TOOLBAR_SETTLE_MS`, `TOOLBAR_MAX_WAIT_MS`). This keeps `hooks/use-tiptap-editor.ts` stable for every existing control. D1 owns both files and may change the version store's internals, but the API above is fixed.

D1 obligations from spec §7:
- keep the `getView` caches per editor;
- clear the max-wait timer on destroy;
- cache `can()`, section lists and code-language counts by `state.doc` identity;
- `getView` must keep its identity across versions. The contract test pins this, even against the stub. The test injects its action by reassigning `editorActions.get`; D1 may replace that mechanism (for example a store factory that takes a registry) as long as the identity assertion stays.

### 3.4 Keys and UI intents (exist; D1 owns)
```ts
// lib/editor-actions/key-combo.ts      (stubs; D1 implements on lib/shortcuts.ts)
export function formatKeyCombo(combo: KeyCombo, mac: boolean): string;   // "⌘B" / "Ctrl+B"
export function ariaKeyShortcuts(combo: KeyCombo, mac: boolean): string; // "Meta+B" / "Control+B"
// lib/editor-actions/ui-intents.ts     (complete)
export type UiIntent =
  | { type: "outline.toggle" } | { type: "filter.toggle" } | { type: "theme.toggle" }
  | { type: "palette.open" } | { type: "colors.open"; kind: "text" | "highlight" }
  | { type: "insert.open"; kind: "table" | "image" | "embed" } | { type: "media.options" };
export function onUiIntent(editor: Editor, listener: (i: UiIntent) => boolean | undefined): () => void;
export function emitUiIntent(editor: Editor, intent: UiIntent): boolean;  // true if handled
```
Some actions need the shell: view toggles, opening the palette, or an Insert kind that needs input first (M10: table, image, embed). They `emitUiIntent` and return its result. D2 and E may append variants to the union (append-only). The shell subscribes in `document-editor.tsx` (D1 adds the subscription; D2 and E handle their own variants).

Shortcuts are bound through Tiptap `addKeyboardShortcuts`, never a window listener. The one exception is the palette's capture-phase Alt+/ listener (E), which follows spec §4.4.

## 4. Action ids and ownership

Each track adds actions **only** to its own file. Ids are `<prefix>.<name>`, and the prefixes do not overlap (the contract test enforces this):

| File | Track | Prefixes | Ids (v1 target list; add, do not rename) |
|---|---|---|---|
| `lib/editor-actions/core-actions.ts` | D1 | `history. style. mark. format. list. align. indent. section. table. code. mermaid. media. view.` | `history.undo` `history.redo` · `style.paragraph` `style.heading1`…`style.heading6` · `mark.bold` `mark.italic` `mark.underline` `mark.strike` `mark.superscript` `mark.subscript` `mark.inlineCode` · `format.clear` (`Mod-\`, keeps `hyperlink`, disabled in code) · `list.bullet` `list.ordered` `list.task` · `align.left` `align.center` `align.right` `align.justify` · `indent.indent` `indent.outdent` (mirrors Tab: `sinkListItem` → `indent`) · `section.fold` `section.moveUp` `section.moveDown` · `table.addRowBefore` `table.addRowAfter` `table.deleteRow` `table.addColumnBefore` `table.addColumnAfter` `table.deleteColumn` `table.toggleHeaderRow` `table.mergeOrSplit` · `code.language` `code.copy` · `mermaid.language` `mermaid.copySource` · `media.options` · `view.outline` `view.filter` `view.theme` · `link` stays the Hyperlink extension's own popover; D1 adds `mark.link` as a trigger |
| `lib/editor-actions/surface-actions.ts` | D2 | `color. size. insert. memory.` | `color.text.apply` (arg `TextColorToken`) `color.text.unset` `color.highlight.apply` (arg `HighlightToken`) `color.highlight.unset` · `size.increase` `size.decrease` `size.set` (arg `FontSizeStep`; disabled in headings: "Headings scale automatically") · `insert.image` `insert.embed` `insert.table` (arg `TableSize`) `insert.quote` `insert.codeBlock` `insert.mermaid` `insert.divider` · `memory.forget` |
| `lib/editor-actions/v11-actions.ts` | E | `palette. repeat. formats. template.` | `palette.open` (Alt+/, fallback Alt+Shift+Z) · `repeat.apply` (`Mod-Alt-v`, `F4`) `repeat.copy` (no key) · `formats.save` `formats.apply` (arg format id) · `template.mermaid` (group `insert`, arg template id, so it appears in D2's Insert menu) |

Rules:
- **Import rule:** `core-actions.ts`, `surface-actions.ts` and `v11-actions.ts` never import `@/lib/editor-actions` (the index) or `lib/editor-context/store.ts`, because both import the action files and a top-level use leaves `editorActions` undefined. Action files import only types, `registry.ts` helpers, `snapshot.ts`, `ui-intents.ts`, tokens and `remembered-choice.ts`.
- **M4 depends on D2:** D1 wires code-language memory through `readChoice`/`rememberChoice`, which stay no-ops until D2 merges. M4 persistence is checked at the D2 merge, not as a D1 go criterion.
- Labels use sentence case. Disabled reasons are full sentences.
- No action reads or writes memory except through §6.
- Repeat uses `undoManager.stopCapturing()` before and after its dispatch (spec §5).

## 5. File ownership

### 5.1 Owned files (only the owner edits them; others open a request)
| Track | Files |
|---|---|
| **C** | `lib/text-style-tokens.ts`, `lib/highlight-tokens.ts`, `extensions/text-style-marks/**`, `extensions/token-highlight/**`, `lib/schema-names.ts`, `tests/unit/schema/schema-snapshot.*`, `lib/yjs-mark-migration.ts`, `lib/security/client-schema-gate.ts`, `lib/security/guardrail-config.ts`, `scripts/hocus-server.ts` (gate hunks), `docs/operations/schema-rollout-runbook.md`, paste rules, C's tests (`tests/unit/schema/**`, `tests/unit/extensions/text-style-*`, render fuzz) |
| **D1** | `lib/editor-actions/{types,registry,core-actions,key-combo,ui-intents}.ts`, `lib/editor-context/**`, `hooks/use-editor-context.ts`, `hooks/use-tiptap-editor.ts`, `components/document-editor/main-toolbar-content.tsx` (the sorted row), new `components/smart-toolbar/row/**` (style dropdown, mark buttons, ⋯ overflow), `components/smart-toolbar/context-slot/**`, `components/ui/toolbar.tsx` + `components/ui/toolbar-button.tsx` (roving tabindex, Alt+F10, disabled-with-reason), `components/tiptap-ui/{undo-redo-button,heading-dropdown-menu,heading-button,mark-button,text-align-button,indent-button,hyperlink-button,heading-filter,shortcut-badge}/**`, `components/document-editor/theme-toggle.tsx` (moves into ⋯ at T2) |
| **D2** | `lib/editor-actions/surface-actions.ts`, `lib/remembered-choice.ts`, `components/smart-toolbar/{color-controls,font-size-stepper,list-control,insert-menu,collapse-menus,selection-bubble,phone-bar}.tsx` and new files under `components/smart-toolbar/{color,bubble,phone,insert}/**`, `components/smart-toolbar/smart-toolbar.scss` (container-query ladder, imported once by `main-toolbar-content.tsx`), `components/tiptap-ui/{color-highlight-popover,color-highlight-button,list-dropdown-menu,list-button,blockquote-button,code-block-button,mermaid-button,image-upload-button,media-embed-popover}/**`, `components/document-editor/mobile-toolbar-content.tsx` (replaced by the phone bar), `components/toc-sidebar/**` (overlay < 950px, `block: "start"` jump) |
| **E** | `lib/editor-actions/v11-actions.ts`, `components/smart-toolbar/{command-palette-host,repeat-split-button,phone-selection-cells}.tsx` and new `components/smart-toolbar/palette/**` (lazy chunk), `extensions/repeat-formatting/**`, `lib/saved-formats.ts` (`tinydocy-formats`), `lib/doc-format-scan.ts` (M12, capped, never stored), `lib/mermaid-templates.ts`, `components/ui/command.tsx` (shadcn `Command` + `cmdk`) |
| **Nobody** | `components/tiptap-ui/{connection-status,user-identity-button,user-identity-dialog}.tsx` (not toolbar). `components/ui/*` other than `toolbar*`: shadcn primitives, additive only, resolve conflicts by union. |
| **Frozen** (skeleton; change only by contract amendment) | `lib/editor-actions/index.ts`, `components/smart-toolbar/editor-surfaces.tsx`, `components/smart-toolbar/types.ts`, `components/smart-toolbar/index.ts` (append exports only), `tests/unit/editor-actions/contract.test.ts` (C flips only its allowlist case) |

### 5.2 Shared files (hunk-level ownership; resolve conflicts by union)
| File | Who edits what |
|---|---|
| `components/document-editor/document-editor.tsx` | **C**: one import of `text-style-marks.scss`. **D1**: `onUiIntent` subscription for `view.*`. **D2**: the `isMobile` branch (`PhoneBar` replaces `MobileToolbarContent`), `tocVisible` → M6 (`useRememberedChoice({ slot: "outlineOpen" })`), outline overlay. **E**: nothing; it mounts through `EditorSurfaces`. |
| `components/document-editor/document-editor-config.ts` | **C**: register `TextColor`, `FontSize`, paste rules. **D1**: a keymap extension for `Mod-\` if it is not done in an action-keymap extension. **E**: register `RepeatFormatting`. Each adds its own lines in the `extensions` array. |
| `tests/helpers/create-test-editor.ts` | **C** adds its marks. Others append. |
| `components/document-editor/main-toolbar-content.tsx` | **D1** owns. **D2** may only import `smart-toolbar.scss` there and add `data-collapse-tier` attributes it needs, after rebasing on D1. |
| `lib/icons.tsx` | Append-only, alphabetical inside the `export { … }` block. Resolve conflicts by union. |
| `CHANGELOG.md` | One sub-block per PR under `## Unreleased`, newest on top. C's block carries the Deploy note. |
| `tests/e2e/**` | New spec files per track (`toolbar-row.spec.ts` D1, `toolbar-surfaces.spec.ts` D2, `palette.spec.ts` E). Edit an existing spec only for the hunk your change breaks. |
| `README.md`, `docs/operations/*.md`, `.env.example` | Append your own rows: `NEXT_PUBLIC_REMEMBER_CHOICES` is D2's, `SCHEMA_FLOOR` runbook text is C's. |

### 5.3 How D2 and E plug into D1's row and shell
- D1's sorted row renders, at fixed places, `ColorControls`, `FontSizeStepper`, `ListControl` and `InsertMenu`, plus the collapse stand-ins `ParagraphCollapseMenu`, `SlotCollapseButton`, `ColorCollapseButton`, `ViewCollapseMenu` and `AaCollapseMenu` next to the groups they replace. All come from `@/components/smart-toolbar`.
- The stubs render today's controls (`ColorHighlightPopover`, `ListDropdownMenu`, the quote/code/diagram/image/embed buttons) or nothing, so the app stays whole at every merge point.
- Responsive DOM contract: D1 marks each row group root `data-toolbar-group="<history|style|size|marks|color|link|paragraph|list|slot|insert|more|view|theme>"`. D1 marks each collapsible item `data-collapse-tier="t2|t3|t4|t5"` (the tier at which it hides). D2's container-query CSS reads only these attributes.
- The roving model collects items at keydown with `checkVisibility()`, so hidden items drop out without JS.
- `EditorSurfaces` (frozen) is mounted once inside `EditorContext` and renders `SelectionBubble` (D2) and `CommandPaletteHost` (E).
- D2's bubble renders `RepeatSplitButton` (E). D2's phone bar renders `PhoneSelectionCells` (E, with `onBack`) in place of its cells while text is selected and VoiceOver focus is not in the bar.
- Before E lands, these E components render `null`, so D2 needs nothing from E to ship.

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
export interface RememberedChoice<T> { ready: boolean; last: T; recent: readonly T[]; remember(value: T): void }
export type RecentColor = { kind: "text"; token: TextColorToken } | { kind: "highlight"; token: HighlightToken };
export interface TableSize { rows: number; cols: number }
export type TextColorChoice = TextColorToken | "default";
export type HighlightChoice = HighlightToken | "none";
export function readChoice<T>(spec: ChoiceSpec<T>): { last: T; recent: readonly T[] };  // sync, for actions
export function rememberChoice<T>(spec: ChoiceSpec<T>, value: T): void;               // sync, after run() === true
export function forgetChoices(): void;                // clears tinydocy-choices only
export function useRememberedChoice<T>(spec: ChoiceSpec<T>): RememberedChoice<T>;
```
Requirements on D2's implementation (spec §5):
- Payload is `{ v: STORAGE_VERSION, slots: { [slot]: { last, recent } } }`. Any other version is discarded.
- Every storage call sits inside try/catch.
- Every write re-reads, merges its own slot and then writes, because several hooks and tracks share one key.
- Reads happen in `useEffect` behind `ready` (no hydration mismatch). Hooks re-sync on the `storage` event.
- The validator runs on read. Values that fail are dropped.
- The kill switch reads the fallbacks and writes nothing.
- Nothing reaches Yjs, the server, URLs or analytics.
- A tamper test covers hostile JSON, a wrong version, and oversized `recent`.
- `tinydocy-ui` and `tinydocy-formats` survive "Forget my choices".

E keeps saved formats in `lib/saved-formats.ts` under `STORAGE_KEYS.formats`, with the same safety rules. Each format is a bundle of tokens and mark names only, never free text except a name of at most 40 characters with control and bidi characters stripped.

## 7. Track test and verification duties (summary of spec §7, §8)
- **C**:
  - render fuzz: `red;background:url(x)` emits no `style`;
  - Yjs survival of the new marks;
  - tab-to-tab paste keeps tokens; Docs and Word samples paste plain;
  - palette contrast;
  - the highlight migration;
  - `SCHEMA_FLOOR` gate matrix: env 0 still gives an effective minimum of 2;
  - snapshot update.
- **D1**:
  - registry per context;
  - snapshot kind precedence (TDD);
  - `getView` identity;
  - `hold` released on unmount;
  - keyboard e2e: one Tab stop, Alt+F10, Esc, remote heading deletion while the slot is focused;
  - ≤1 toolbar commit per settle;
  - indent in lists;
  - clear formatting keeps links.
- **D2**:
  - memory tamper test;
  - `NEXT_PUBLIC_REMEMBER_CHOICES=0`;
  - the bubble-in-row matrix;
  - `scrollWidth <= clientWidth` ±1px per tier;
  - colour grid a11y (named `aria-pressed` buttons in a dialog);
  - phone bar 44×44;
  - editor chunk ≤ +6 KB gz.
- **E**:
  - palette + cmdk ≤ 15 KB gz loaded on first Alt+/;
  - Repeat is one undo step, sets marks rather than toggling them, and F4 works;
  - listeners and heap return to baseline after 20 tab switches and 100 palette/bubble cycles;
  - the mobile swap passes on WebKit.
- **All tracks**:
  - `bun run check`, `lint`, `typecheck`, `test`;
  - e2e per AGENTS.md against its own ports (never 3000/1234/3100/1334/3200/1434/3400/1534);
  - a CHANGELOG entry under Unreleased.

## 8. What the skeleton deliberately does not do
- It does not register `textColor` or `fontSize`, add them to `SCHEMA_MARK_NAMES`, or define `SCHEMA_FLOOR`. All three are C's, under spec §3.1.
- It does not change the row: `main-toolbar-content.tsx` is untouched. The one shell change mounts `EditorSurfaces`, which renders nothing yet.
- It gives no real bodies for the snapshot walk, key-combo formatting or the memory layer. Those stubs return safe fallbacks: `paragraph`/`heading`/`readonly` kinds, the combo text unchanged, the fallback value with no writes.

## 9. Skeleton
Commit `ba6e3de` on `integrate/smart-toolbar-v1`, `feat(toolbar): add shared contract skeleton for smart toolbar v1`. Rebase each track branch onto it before starting: `git rebase integrate/smart-toolbar-v1`.
