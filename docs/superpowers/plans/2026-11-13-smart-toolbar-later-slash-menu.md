# Smart toolbar, later phase: the "/" menu, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Typing "/" at the start of a paragraph, or after a space, opens a short menu of block actions under the caret: text styles, lists and Insert kinds. Typing filters it, and Enter or a click runs the pick. The pick removes the typed "/query" and applies the action as **one undo step**. The menu is one more view of the action registry (spec §2), so it adds no command of its own.

**Architecture:**
- **Eager, tiny:** a Tiptap extension, `SlashTrigger`, with one ProseMirror plugin. It watches local transactions for a typed "/" in an allowed place and keeps `{ from, query }` mapped through later transactions. While the menu is open it forwards ↑, ↓, Enter and Esc to the menu, and it sets the editor's combobox attributes through its own `props.attributes`. A small host, `SlashMenuHost`, is mounted by `EditorSurfaces`. It subscribes to the trigger's per-editor store and renders the lazy menu only while it is open.
- **Lazy:** the menu UI, item building and matching, and the pick runner. They load on the first "/" and, like the colour and Insert chunks (A9), on idle after the first server sync.
- **Focus stays in the editor.** The query is ordinary text in the document. The listbox is announced through `aria-activedescendant`, plus a polite live region for screen readers that ignore it on a contenteditable.

**Tech Stack:** Next.js 16 (Turbopack), React 19, Tiptap 3.33 + `@tiptap/y-tiptap` (`ySyncPluginKey`, `yUndoPluginKey`), `@tiptap/extension-collaboration` (`isChangeOrigin`), `@floating-ui/dom` 1.8 (already a dependency), `bun test` (happy-dom), Playwright with `@axe-core/playwright`. **No new dependency.** `@tiptap/suggestion` is not installed, and adding it would be a dependency request under contract §5.1. It is also larger than the trigger this plan needs.

**Spec:** `docs/superpowers/specs/2026-11-12-smart-toolbar-design.md` §2 ("the later '/' menu" is a view of the registry), §6 (a11y must-fixes), §7 (budgets) and §8 item 6 ("Later").

**Contract:** `docs/superpowers/specs/2026-11-13-smart-toolbar-v1-contract.md`: §3.2 (only the palette and Insert list from the registry, so this plan adds a third lister through an amendment), §3.4 (key bindings), §5.1 (frozen files), §10 A7–A12 (budgets).

**Base:** branch `feat/smart-toolbar-slash-menu` from `main` at or after `7abadc1`. Before Task 1, confirm:
- `git grep -n "export function runAction" lib/editor-actions/registry.ts` finds `runAction(editor, action, arg)`;
- `git grep -n "export function lazySurface" components/smart-toolbar/lazy-surface.tsx` finds it;
- `git grep -n "EDITOR_CHUNK_BUDGET_BYTES = 23.5" scripts/check-editor-chunk-size.ts` finds the A12 budget.

**Effort:** L, about **7–9 engineer-days**: trigger 1.5, items and pick runner 1.5, menu UI and ARIA 2.5, touch and remote edge cases 1, budgets, a11y and docs 1.5.

## Global Constraints

**Tooling**
- Bun only: `bun`, `bun <bin>`, `bunx --bun`. Never npm, npx, yarn or pnpm.
- Biome formats and lints. ESLint covers Next rules only. TypeScript is strict. `bun run typecheck` covers the app and `tsconfig.sw.json`.

**Code style**
- Named exports only (a `React.lazy` import maps a named export to `default`). Kebab-case files. PascalCase components with title-case acronyms.
- Icons come from `lib/icons.tsx`. New UI uses the shadcn components in `components/ui/` and shadcn tokens.

**Commits**
- Conventional Commits: atomic, imperative mood.
- No AI, tool or agent references and no trailers.
- Before every commit, show a commit review report (files, diff summary, message) and wait for explicit approval.
- `CHANGELOG.md`: one sub-block for this PR under `## [Unreleased]`, in the same PR.

**Tests**
- `bun run test` runs the unit tests in one process with a happy-dom preload. `mock.module` spreads the real module and is followed by `await import()`. Modules that read env at import time load through `importFresh()`, with `resetModules()` in `afterEach`.
- Playwright runs against **Next 3620 + Hocus 1720**, never tiny.docs.plus. These ports are not taken by contract §5.4, D2 (3800/1934, 3801) or E (3900/2034). Run `lsof -i :3620 -i :1720` first, and stop only the servers you started.

```bash
# terminal 1: Hocus
DOC_CREATION_RATE_LIMIT=2000 WS_CONNECTION_LIMIT=200 WS_SOCKETS_PER_IP=600 WS_UPGRADE_RATE_LIMIT=6000 \
  HOCUS_THROTTLE=0 MAX_TOTAL_DOCUMENTS=1000000 HOCUS_PORT=1720 DB_PATH="$TMPDIR/tinydocy-slash.sqlite" \
  HOCUS_ALLOW_ISOLATED_TABS_DOCS=1 bun run hocus
# terminal 2: Next (same DB_PATH: the DELETE route and Hocus share tombstones)
NEXT_PUBLIC_HOCUS_URL=ws://127.0.0.1:1720 DB_PATH="$TMPDIR/tinydocy-slash.sqlite" bun next dev -p 3620
# tests
CI= E2E_BASE_URL=http://localhost:3620 E2E_HOCUS_URL=ws://127.0.0.1:1720 bun playwright test <spec> --project=chromium
```

- e2e types at full speed. Misplaced text means an app bug, not a missing wait.
- Touch e2e uses `test.use({ hasTouch: true, isMobile: true })`. Its first assertion is `matchMedia("(pointer: coarse)").matches === true`.

**Code rules**
- Never subscribe the editor shell to editor state. Never rebuild the extensions array or `EDITOR_PROPS` per render: Tiptap would call `setOptions`, a full view update. Combobox attributes therefore come from the plugin's `props.attributes`, never from `EDITOR_PROPS`.
- Actions run only through `runAction(editor, action, arg)`, which rechecks the live document.
- Never call `editor.registerPlugin` from a lazy chunk. A changed plugin set makes prosemirror-view destroy and re-create **every** plugin view (`updatePluginViews`), including y-sync, carets, fold and the TOC. The trigger plugin is registered once, in the extensions array.
- A lazy chunk never imports row modules (`components/smart-toolbar/row/**`, `main-toolbar-content.tsx`). When it did (A9), Turbopack split the shared modules out of the editor group, and the lost compression cost 344 B to 1.5 KB.

**Contract rules**
- Frozen files change only through a contract amendment: `lib/editor-actions/index.ts`, `components/smart-toolbar/editor-surfaces.tsx`, `components/smart-toolbar/types.ts` and `tests/unit/editor-actions/contract.test.ts`.
- Amendments take the next free A-number at merge (A14 at the time of writing; A13 is the menu trim). Never hardcode the number in code comments.

## Schema and protocol

**None. This plan needs no schema change and no protocol change.**
- No new mark, node or attribute, and no change to `lib/schema-names.ts` (the ingress allowlist) or `tests/fixtures/schema-snapshot.json`.
- No WebSocket URL parameter, no Hocus change and no `SCHEMA_FLOOR` change.
- The only document writes are the ones the user already makes: typing "/query", which is ordinary text, and the picked action, which goes through `runAction` like every other surface. Collaborators see "/hea" while it is typed, exactly as with any other typing.

## Budgets

**Editor chunk (`scripts/check-editor-chunk-size.ts`, gz).** The script sums every file the editor's loader lists, **CSS included**. A production build of E's tip lists three `.css` files in the group, 14,467 B gz. The A12 budget is 24,064 B. A8 measured +23,423 B at E's tip (`4fcba67`), so about **641 B** were left. A build of `7abadc1` with uncommitted follow-up changes measured +23,757 B (307 B left), so the real figure on `main` must be measured first. The four later-phase plans share what is left:

| Plan | Eager allocation | What is eager | Lazy |
|---|---|---|---|
| M15 Continue where you left off | 150 B | one lazy loader (about 118 B, A9) and its call after the first server sync | continue chunk ≤ 3 KB gz |
| **"/" menu (this plan)** | **280 B** | trigger plugin, host, one lazy loader | slash chunk ≤ 6 KB gz |
| Hover preview | 160 B | the decoration plugin; show and clear calls live in lazy chunks | ≤ +1 KB gz on the colour-panel chunk |
| Progressive-disclosure toggle | 150 B | one registry action, the ⋯ checkbox item, one attribute, the simplified CSS rules | none |
| **Total** | **740 B** | | |

**This is more than the headroom, and Turbopack's split cost comes on top.**
- A lazy chunk that imports modules the editor chunk also uses makes Turbopack split those modules into separate, less compressible editor-group files. A8 measured about 344 B for the palette chunk and about 968 B for the split button inside the bubble chunk.
- The continue chunk (`relative-range.ts`, the fold and filter plugin keys, `remembered-choice`, `hocuspocus`) and the slash chunk (registry, snapshot, memory) both import such modules.
- The trim has landed (contract A13, menu bodies lazy): the editor chunk measured +16,512 B of the 23.5 KB budget, 7,552 B of headroom. Measure each plan against it; a new owner amendment is needed only if they outgrow it. The palette (A7) has 36 B left.
- No plan raises the constant itself. Going over this plan's 280 B needs a trim or the owner's amendment.

Task 0 measures this before any feature code is written.

**Slash chunk:** ≤ 6 KB gz, measured on a production build the way `palette.spec.ts` measures the palette (`PALETTE_BUDGET=1` pattern, as `SLASH_BUDGET=1`). If the chunk shares modules with the palette chunk, re-check the palette's A7 budget (20 KB gz, 499 B left).

**Performance:**
- Typing p95 with the trigger mounted stays ≤ +10% and ≤ +16 ms against the trigger off (`--project=perf`, spec §7). The trigger inspects only single-step transactions whose slice is one character, so ordinary typing costs one length check.
- ≤ 1 toolbar React commit per settle during a typing burst. Plugin-meta transactions (the active option) never notify the toolbar version store (`changesToolbarContext` in `hooks/use-tiptap-editor.ts`).
- Open (chunk cached) to first painted list: < 50 ms p95. Re-filtering on a keystroke: < 16 ms p95, for the full item list (about 25 rows with the Mermaid templates).
- Listeners and heap return to baseline after 20 tab switches and 100 open/close cycles (heap within 5%).

## Accessibility requirements (WCAG 2.2 AA)

- **Focus is never dropped.**
  - The editor keeps focus while the menu is open. Option rows are not focusable, and `mousedown` on them calls `preventDefault`.
  - Esc closes the menu and leaves the caret after the query.
  - A pick that opens a step (embed) moves focus into that step, which focuses itself on mount (A9).
  - When the document turns read-only while the menu is open, the menu closes and the editor keeps focus.
  - No path ends on `<body>`.
- **Roles:**
  - The list is `role="listbox"` (`id` `slash-menu-<editorKey>`) with `role="group"` sections labelled "Text", "Lists" and "Insert". Rows are `role="option"` with `aria-selected`.
  - While the menu is open, the editor carries `aria-expanded="true"`, `aria-controls`, `aria-autocomplete="list"` and `aria-activedescendant`. `aria-activedescendant` is allowed on a textbox.
  - When the menu is closed, none of these attributes are present.
- **Announcements (4.1.3):** a polite live region, present for the editor's whole life, says "Heading 2, 3 of 9" when the active option changes, and "No matching blocks" when nothing matches. It is debounced by 150 ms so fast arrows don't queue a burst. This covers screen readers that do not follow `aria-activedescendant` on a contenteditable.
- **Names (2.4.6, 2.5.3):** each option's accessible name starts with its visible label (sentence case). The Markdown hint (`## `, `> `, from `Action.markdownHint`) is visible and `aria-hidden`.
- **Targets (2.5.8):** rows are ≥ 24 px tall with a mouse and **44 px** on touch.
- **Contrast and forced colours:** text and the active row's indicator meet ≥ 4.5:1 and ≥ 3:1 in both themes. The active row has a 2 px outline, which survives forced colours (`Highlight`); its colour is never the only cue.
- **Focus not obscured (2.4.11):** the list flips above the caret when it would cover the caret line, the sticky row or the phone bar plus keyboard (`--mobile-bar-clearance`).
- **Reduced motion:** no animation beyond a 100 ms opacity fade, and none under `prefers-reduced-motion`.

## Upstream interfaces (as on `main` at `7abadc1`)

| # | Name | Where | Used for |
|---|---|---|---|
| U1 | `editorActions.list({ group })`, `.get(id)` | `lib/editor-actions/index.ts` (frozen) | the items: groups `style`, `list` and `insert` |
| U2 | `availability(action, ctx)`, `canRun`, `runAction(editor, action, arg)` | `lib/editor-actions/registry.ts` | hiding unavailable items; running the pick |
| U3 | `computeContext(editor)` | `lib/editor-context/snapshot.ts` | a fresh snapshot per open (like the palette) |
| U4 | `Action.label`, `keywords`, `icon`, `markdownHint`, `options(ctx)` | `lib/editor-actions/types.ts` | rows; `template.mermaid` expands to its templates |
| U5 | `readChoice(TABLE_SIZE_CHOICE)` | `lib/remembered-choice.ts` | `insert.table` runs at the remembered size (M17a) |
| U6 | `lazySurface`, `SurfaceBoundary`, `preloadSurfaces` | `components/smart-toolbar/lazy-surface.tsx` | the lazy menu, its failure path, the idle preload |
| U7 | `ySyncPluginKey`, `yUndoPluginKey` | `@tiptap/y-tiptap` | ignore remote steps; `undoManager.stopCapturing()` |
| U8 | `isChangeOrigin(tr)` | `@tiptap/extension-collaboration` | ignore remote steps |
| U9 | `CHUNK_MARKERS`, `interceptChunk` | `tests/e2e/helpers/lazy-chunk.ts` | the 404 and hold cases |
| U10 | `listenerCounts` and the heap reading | `tests/e2e/palette-leaks.spec.ts` (inline today) | extracted to `tests/e2e/helpers/leak-metrics.ts` if no earlier plan did it |
| U11 | `createCollabEditor` | `tests/helpers/collab-editor.ts` | undo tests with the real Yjs undo manager |
| U12 | `useKeyboardInset` | `hooks/use-keyboard-inset.ts` | placement above the phone keyboard |

## Decisions on spec ambiguities (owner can overrule)

1. **Where "/" opens:** in a `paragraph` (including inside list items, quotes and table cells), with an empty selection, when the character before it is the block start or whitespace. Never in the title, a heading, a code block, Mermaid, inline code, or a read-only document. So "and/or" and URLs never open it.
2. **Only a committed ASCII "/" in a local transaction opens it.** That is one `ReplaceStep` whose slice is the text "/", with no `ySyncPluginKey` meta and not `isChangeOrigin`. A collaborator's "/" never opens your menu, and a full-width "／" from an IME never opens it. The trigger reads the transaction, not `handleTextInput` or physical key codes ("/" is Shift+7 on German layouts, and Android composition input does not reliably reach `handleTextInput`). An open composition does not block the menu. On Android the list is operated by touch.
3. **The query stays in the document** (Notion's model), and focus stays in the editor. A separate input would move focus on a keystroke (3.2.2) and close the phone keyboard.
4. **Undo:** a pick is exactly one undo step. `stopCapturing()` runs, then one transaction deletes "/query", then `runAction` runs, then `stopCapturing()` runs again. Undo restores the "/query" text and the block as it was. If `runAction` returns false after the deletion, the runner puts the text back in the same capture group, and nothing else changes.
5. **Unavailable items are hidden**, not listed with a reason (the palette lists them). The menu is position-bound and short. Everything stays reachable with its reason in the palette and the row.
6. **Items:** Text (`style.paragraph`, `style.heading1`–`6`), Lists (`list.bullet`, `list.ordered`, `list.task`), Insert (every `insert`-group action in registry order, `template.mermaid` expanded to its options). `insert.table` runs with the remembered size (M17a), with no grid step. `insert.embed` deletes the query and then opens the row's embed step (`insert.open`); cancelling that step leaves the paragraph empty, and undo restores the text.
7. **Matching:** case-insensitive word-prefix over label, keywords and the Markdown hint (`/h2`, `/##` and `/quote` all work). Ranked label prefix > word prefix > keyword > hint, ties in registry order.
8. **Closing:** Esc, blur, a pick, the caret leaving the query, a deleted "/", a query containing "/" or two spaces, a query over 24 characters, or a read-only switch. With no match the menu stays open with "No matching blocks" until one of these happens, so typing "/usr/bin" just continues.
9. **No memory.** The menu adds no Recent and writes nothing. Item actions write their own memory as usual: the list type, the table size and the Insert kind.
10. **No placeholder hint.** Discoverability comes from the Markdown hints shown in the menu and a line in the README. A "Type / for blocks" placeholder would change the docs.plus Placeholder copy for every empty line.

## Not in scope

**Document styles (M14b) gets no plan in this phase.** Its linked `styleRef` mark is a new schema name. Spec §3.1's allowlist rule says the server ingress allowlist (`lib/schema-names.ts`) must ship in a deploy *earlier than* any client that writes the mark (or in the same Hocus restart that precedes it). Nothing has been deployed yet: owner decision O10 merged v1 to `main` before release N went out. There is therefore no earlier deploy to carry the allowlist entry, and the first deploy must prove the PR B/C Deploy notes first. M14b is planned only after that first deploy, as a two-release plan: the allowlist entry in release *k*, and the mark, the shared `Y.Map` and the UI in release *k + 1*. None of the four later-phase plans (this one, M15, hover preview and the progressive-disclosure toggle) depends on it.

Also out of scope:
- slash items beyond the three groups: marks, colours, section moves and view toggles stay in the row, the bubble and the palette;
- "/" inside headings or the title (Decision 1);
- link suggestions (M16, parked);
- a registry action for opening the menu: "/" is typed text, not a command, so the palette does not list it.

## Review Focus

1. **A remote "/" or a remote deletion of the local "/".** A collaborator typing "/" never opens your menu. A collaborator deleting your "/" closes it. Task 1 unit tests: "remote '/' never opens" and "remote deletion closes".
2. **Undo is one step and restores the text** with the real Yjs undo manager, including after an embed pick and a failed `runAction`. Task 3 unit test "one undo step".
3. **Enter before the chunk lands.** Typing "/h" and Enter faster than the chunk loads must split the line normally and close the menu, never swallow the key. Task 4 e2e "Enter before the chunk lands is a newline".
4. **Combobox attributes never touch `EDITOR_PROPS`** (so no `setOptions`), and they disappear on close. Task 4 unit test "attributes come and go with the plugin state".
5. **Phone keyboard and the docked bar.** On touch the list stays above the keyboard and the bar, and a tap runs the pick without closing the keyboard. Task 4 touch e2e.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `extensions/slash-trigger/slash-trigger.ts`, `extensions/slash-trigger/index.ts` | `SlashTrigger` extension: plugin state, detection, key forwarding, attributes, per-editor store | Create |
| `lib/slash-menu/slash-items.ts` | Pure: build items from the registry for a `Ctx`; match and rank | Create (lazy) |
| `lib/slash-menu/run-slash-pick.ts` | Delete "/query" and run the action as one undo step | Create (lazy) |
| `components/smart-toolbar/slash-menu-host.tsx` | Eager host: subscribes to the store, renders the lazy menu while open | Create |
| `components/smart-toolbar/slash/slash-menu.tsx`, `slash/slash-menu.scss` | Lazy listbox UI, placement, live region | Create (lazy) |
| `components/smart-toolbar/editor-surfaces.tsx` | Mounts `SlashMenuHost` | Modify (frozen: amendment) |
| `components/smart-toolbar/lazy-surface.tsx` | `loadSlashMenu`, added to `preloadSurfaces` | Modify (allowed hunk under the amendment) |
| `components/document-editor/document-editor-config.ts` | Appends `SlashTrigger` to the extensions array | Modify (shared, append-only) |
| `tests/e2e/helpers/lazy-chunk.ts` | `CHUNK_MARKERS.slashMenu` | Modify |
| `tests/e2e/helpers/leak-metrics.ts` | Listener and heap helpers, extracted from `palette-leaks.spec.ts` | Create if missing |
| `tests/unit/extensions/slash-trigger.test.ts`, `tests/unit/lib/slash-items.test.ts`, `tests/unit/lib/run-slash-pick.test.ts` | Unit tests | Create |
| `tests/e2e/slash-menu.spec.ts`, `tests/e2e/slash-menu-leaks.spec.ts`, `tests/e2e/lazy-surfaces.spec.ts` | e2e | Create / Create / Modify |
| `docs/superpowers/specs/2026-11-13-smart-toolbar-v1-contract.md` | Amendment: frozen `EditorSurfaces` hunk, third registry lister | Modify |
| `CHANGELOG.md`, `README.md`, `tests/TESTING.md`, `AGENTS.md` | Docs | Modify |

---

### Task 0: Measure the headroom and the split cost (spike, not committed)

**Files:** a throwaway `components/smart-toolbar/slash/spike.tsx`. It renders nothing, but imports what the slash chunk will import: `editorActions`, `availability`, `computeContext`, `readChoice`, `yUndoPluginKey` and `@floating-ui/dom`. A `lazySurface` in `SlashMenuHost`'s future place mounts it. Revert everything after measuring.

- [ ] **Step 1:** On a clean checkout of the base, run `bun run build && bun scripts/check-editor-chunk-size.ts`. Record the growth and the headroom.
- [ ] **Step 2:** Add the spike chunk, an empty `SlashTrigger` extension and the host. Rebuild and measure again. The delta is the loader, the host and the split cost, before any feature code.
- [ ] **Step 3:** If the delta already exceeds this plan's 280 B, or what is left of the shared headroom, **stop**. Report the numbers to the owner, with the trims you see (for example, moving `@floating-ui/dom` usage behind the chunk only), and wait for a decision or an amendment before Task 1.
- [ ] **Step 4:** Revert the spike (`git checkout -- . && git clean -fd components/smart-toolbar/slash`). Put the numbers in the PR description.

---

### Task 1: The trigger plugin

**Files:**
- Create: `extensions/slash-trigger/slash-trigger.ts`, `extensions/slash-trigger/index.ts`
- Test: `tests/unit/extensions/slash-trigger.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type SlashState =
    | { readonly open: false }
    | { readonly open: true; readonly from: number; readonly query: string; readonly activeId: string | null };
  export const slashTriggerKey: PluginKey<SlashState>;
  export const SlashTrigger: Extension;
  export function getSlashState(editor: Editor): SlashState;
  export function subscribeSlash(editor: Editor, listener: () => void): () => void;   // WeakMap per editor
  export function closeSlash(editor: Editor): void;                                   // meta-only transaction
  export function setSlashActive(editor: Editor, optionId: string | null): void;      // meta-only transaction
  export type SlashKeyHandler = (key: "ArrowUp" | "ArrowDown" | "Enter" | "Escape") => boolean;
  export function setSlashKeyHandler(editor: Editor, handler: SlashKeyHandler | null): void;
  export const SLASH_MAX_QUERY = 24;
  ```
- **Opening:**
  - The previous state is closed, and the transaction is local: no `ySyncPluginKey` meta and not `isChangeOrigin`.
  - It has exactly one `ReplaceStep` inserting the text "/", and the selection is empty right after it.
  - The context check passes: the parent is a `paragraph`; the title is not the top-level block 0 (`isTitle`); the position is not in a `codeBlock` or inside an `inlineCode` mark; the character before is the block start or `/\s/`; the editor is editable.
- **While open:**
  - `from` maps through `tr.mapping` (association −1, so text typed after "/" stays in the query).
  - `query = doc.textBetween(from + 1, selection.head)`.
  - It closes per Decision 8, or on the `{ close: true }` meta.
- **Keys:** `handleKeyDown` forwards ↑, ↓, Enter and Esc only while open **and** a handler is registered. Without a handler, Esc closes and every other key falls through, so Enter splits the line.
- **Attributes:** `props.attributes(state)` returns the four combobox attributes while open, else `{}`.
- **Store:** the plugin view's `update` notifies `subscribeSlash` listeners only when `open`, `from`, `query` or `activeId` changed. The view's `destroy` clears the editor's listener set and key handler.

- [ ] **Step 1: Write the failing tests**

```ts
// slash-trigger.test.ts (createTestEditor + SlashTrigger; createCollabEditor for the remote cases)
it("opens on '/' at the start of a paragraph and after a space", () => {});
it("never opens mid-word ('and/or'), in the title, a heading, a code block, inline code or read-only", () => {});
it("never opens on a full-width '／' or on a pasted '/abc'", () => {});
it("remote '/' never opens", () => { /* second client types '/' into the same paragraph */ });
it("tracks the query and maps 'from' through remote inserts before it", () => {});
it("remote deletion of the '/' closes", () => {});
it("closes on Esc, blur, a '/' or two spaces in the query, > 24 chars, and when the caret leaves the query", () => {});
it("Esc without a handler closes; Enter without a handler is not consumed", () => {});
it("attributes come and go with the plugin state", () => {
  // open -> view.dom has aria-expanded, aria-controls, aria-autocomplete; close -> none of them
  // editor.options.editorProps is the same object before and after (no setOptions)
});
it("meta-only transactions do not bump the toolbar version store", () => {
  // getEditorVersionStore(editor).subscribe(spy); setSlashActive(editor, "x") -> spy not called
});
it("notifies subscribers only when the visible state changes", () => {});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `bun test tests/unit/extensions/slash-trigger.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement** as the Interfaces block says. Keep the per-transaction cost O(1) when the transaction is not a one-character insert, so check `tr.steps.length === 1` and the slice size first.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `bun test tests/unit/extensions/slash-trigger.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** after approval

```bash
git add extensions/slash-trigger tests/unit/extensions/slash-trigger.test.ts
git commit -m "feat(editor): detect a typed slash for the block menu"
```

---

### Task 2: Items and matching (pure)

**Files:**
- Create: `lib/slash-menu/slash-items.ts`
- Test: `tests/unit/lib/slash-items.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type SlashSection = "Text" | "Lists" | "Insert";
  export interface SlashItem { key: string; actionId: string; arg?: unknown; label: string;
    keywords: readonly string[]; hint?: string; section: SlashSection }
  export function buildSlashItems(ctx: Ctx, actions: readonly AnyAction[], tableSize: TableSize): SlashItem[];
  export function matchSlashItems(items: readonly SlashItem[], query: string): SlashItem[];
  ```
- `buildSlashItems` keeps only actions whose `availability(action, ctx) === true` (Decision 5). It expands `options(ctx)` into one row each, labelled `"<label>: <option label>"` like the palette's rows, and gives `insert.table` the `tableSize` argument. Keys are `actionId` or `actionId:<option value>`.
- `matchSlashItems("")` returns all items. Otherwise it ranks per Decision 7.
- The module imports only types, `registry.ts` helpers and `remembered-choice.ts` types. It never imports `components/**` or the palette (the palette chunk has 499 B left, A7).

- [ ] **Step 1: Write the failing tests**

```ts
it("lists Text, Lists and Insert in registry order", () => {});
it("hides unavailable actions (table inside a table, image without the node)", () => {});
it("expands template.mermaid into its templates once the engine is installed", () => {});
it("passes the remembered table size to insert.table", () => {});
it("matches word prefixes of labels, keywords and markdown hints", () => {
  // "h2" -> Heading 2 first; "##" -> Heading 2; "quo" -> Quote; "pic" -> Image (keyword)
});
it("ranks label prefix > word prefix > keyword > hint, ties in registry order", () => {});
it("returns nothing for a query with no match", () => {});
```

- [ ] **Step 2: Run them and confirm they fail.** Run: `bun test tests/unit/lib/slash-items.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run them and confirm they pass.** Expected: PASS.

- [ ] **Step 5: Commit** after approval: `feat(slash-menu): build block items from the action registry`

---

### Task 3: The pick runner (one undo step)

**Files:**
- Create: `lib/slash-menu/run-slash-pick.ts`
- Test: `tests/unit/lib/run-slash-pick.test.ts`

**Interfaces:**
- Produces: `runSlashPick(editor: Editor, item: SlashItem): boolean`
  1. Read the open `SlashState`. If it is closed, return false.
  2. Re-check `canRun(action, computeContext(editor))` against the live document. If it fails, close and return false.
  3. `undoManager?.stopCapturing()` (from `yUndoPluginKey.getState(state)`, as `v11-engine.ts` does).
  4. Dispatch one transaction that deletes `[from, from + 1 + query.length]` and sets the `{ close: true }` meta.
  5. `const ok = runAction(editor, action, item.arg)`.
  6. If `!ok`, insert the deleted text back at the same position (same capture group).
  7. `stopCapturing()`, then return `ok`.

- [ ] **Step 1: Write the failing tests**

```ts
// createCollabEditor (real Collaboration undo plugin)
it("one undo step: heading pick, then undo restores '/hea' and the paragraph", () => {});
it("redo re-applies the pick", () => {});
it("typing before the '/' stays its own undo step", () => {});
it("embed pick deletes the query and emits insert.open; undo restores the text", () => {});
it("a run that returns false puts the text back and changes nothing else", () => {});
it("refuses when the document became read-only after the menu opened", () => {});
it("table pick inserts at the remembered size and remembers it", () => {});
```

- [ ] **Step 2: Run them and confirm they fail.** Run: `bun test tests/unit/lib/run-slash-pick.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run them and confirm they pass.** Expected: PASS.

- [ ] **Step 5: Commit** after approval: `feat(slash-menu): run a pick as one undo step`

---

### Task 4: The host and the lazy menu

**Files:**
- Create: `components/smart-toolbar/slash-menu-host.tsx`, `components/smart-toolbar/slash/slash-menu.tsx`, `components/smart-toolbar/slash/slash-menu.scss`
- Modify: `components/smart-toolbar/lazy-surface.tsx` (`loadSlashMenu`, added to `preloadSurfaces`), `tests/e2e/helpers/lazy-chunk.ts` (`slashMenu: "function SlashMenu("`)
- Test: `tests/e2e/slash-menu.spec.ts`

**Interfaces:**
- `SlashMenuHost({ editor }: SurfaceProps)`:
  - It subscribes with `useSyncExternalStore(subscribe, () => getSlashState(editor), () => CLOSED)`.
  - While open it renders `LazySlashMenu`, built with `lazySurface(loadSlashMenu)`. It renders nothing otherwise.
  - It mounts no listeners while closed.
- `SlashMenu({ editor, state })` (lazy):
  - It builds items once per open from `computeContext(editor)` and filters them per query.
  - It registers `setSlashKeyHandler` on mount and clears it on unmount. ↑ and ↓ wrap. Enter calls `runSlashPick` on the active item. Esc calls `closeSlash`.
  - It calls `setSlashActive(editor, id)` when the active row changes.
  - It renders through a portal to `body`. Placement uses `@floating-ui/dom` `computePosition` with `flip`, `shift` and `size`, against a virtual reference at `view.coordsAtPos(from)`. It is recomputed on query change and on `scroll` of `.document-editor-wrapper` and window `resize`, one listener each, all removed on unmount.
  - On touch, the available height subtracts `useKeyboardInset()` and the bar clearance.
  - Rows: `onMouseDown` calls `preventDefault`, and `onClick` runs the pick.
  - The live region is rendered by the host (always mounted, empty while closed), so its first announcement is read (palette precedent, `ResultStatus`).

- [ ] **Step 1: Write the failing tests**

```ts
// slash-menu.spec.ts
test("'/' opens the menu at the caret; typing filters; Enter applies Heading 2", async ({ page }) => {
  // new paragraph, type "/h2", Enter -> the block is an h2 with no "/h2" text; one Ctrl+Z restores "/h2"
});
test("focus never leaves the editor, and the combobox attributes follow the menu", async ({ page }) => {
  // activeElement is .ProseMirror throughout; aria-expanded true while open, absent after Esc
});
test("Esc leaves '/query' as typed text and the caret after it", async ({ page }) => {});
test("'and/or' and a URL never open it; a heading or the title never opens it", async ({ page }) => {});
test("Enter before the chunk lands is a newline", async ({ page }) => {
  // hold the slashMenu chunk with interceptChunk; type "/h" Enter -> two paragraphs, menu closed
});
test("a collaborator deleting the '/' closes the menu", async ({ browser }) => {});
test("the live region announces the active option and 'No matching blocks'", async ({ page }) => {});
test("touch: rows are 44px, the list stays above the bar and keyboard, a tap applies", async ({ browser }) => {
  // first assertion: matchMedia("(pointer: coarse)").matches === true; stub visualViewport like mobile-bar.spec.ts
});
test("read-only while open closes the menu and keeps focus in the editor", async ({ page }) => {});
```

- [ ] **Step 2: Run them and confirm they fail.** Run: `CI= E2E_BASE_URL=http://localhost:3620 bun playwright test tests/e2e/slash-menu.spec.ts --project=chromium`. Expected: FAIL.

- [ ] **Step 3: Implement.** Screenshot the menu in light and dark, at 1280 px and 375 px.

- [ ] **Step 4: Run them and confirm they pass.** Expected: PASS.

- [ ] **Step 5: Commit** after approval: `feat(slash-menu): show the block menu under the caret`

---

### Task 5: Mount, failure path and the contract amendment

**Files:**
- Modify: `components/smart-toolbar/editor-surfaces.tsx` (one line: `<SlashMenuHost editor={editor} />`), `components/document-editor/document-editor-config.ts` (append `SlashTrigger`), `docs/superpowers/specs/2026-11-13-smart-toolbar-v1-contract.md` (§10 amendment), `tests/e2e/lazy-surfaces.spec.ts`
- Test: `tests/e2e/lazy-surfaces.spec.ts`

**The amendment records:**
- the frozen `EditorSurfaces` hunk;
- that the "/" menu is a third registry lister, next to the palette and Insert (§3.2);
- the measured eager and lazy bytes;
- that no `UiIntent` variant, action id, prefix, group or memory slot was added, so `contract.test.ts` is unchanged.

- [ ] **Step 1: Write the failing test**

```ts
// lazy-surfaces.spec.ts
test("a slash chunk that fails to load leaves the editor working and retries on the next '/'", async ({ page }) => {
  // 404 the slashMenu chunk; type "/" -> no menu, typing continues, the tab strip stays;
  // unroute; Esc, type " /" -> the menu opens
});
```

- [ ] **Step 2: Run it and confirm it fails.** Expected: FAIL.

- [ ] **Step 3: Implement**, then write the amendment.

- [ ] **Step 4: Run** `lazy-surfaces.spec.ts`, `slash-menu.spec.ts`, `palette.spec.ts` and `toolbar-row.spec.ts`. Expected: PASS.

- [ ] **Step 5: Commit** after approval: `feat(slash-menu): mount the block menu and record its amendment`

---

### Task 6: Budgets, leaks, accessibility, docs and full verification

**Files:**
- Create: `tests/e2e/slash-menu-leaks.spec.ts`, `tests/e2e/helpers/leak-metrics.ts` (if missing)
- Modify: `tests/e2e/toolbar-a11y.spec.ts`, `CHANGELOG.md`, `README.md` (features), `tests/TESTING.md` (new specs, ports 3620/1720, `SLASH_BUDGET=1`), `AGENTS.md` (one Learned Workspace Facts line: the trigger plugin, the lazy menu, and that the query stays in the doc)

- [ ] **Step 1: Write the failing tests**

```ts
// slash-menu-leaks.spec.ts
test("100 open/close cycles and 20 tab switches return listeners to baseline and heap within 5%", async ({ page }) => {});
// toolbar-a11y.spec.ts
test("slash menu: axe 0 serious, light and dark; forced-colours active-row outline", async ({ page }) => {});
// slash-menu.spec.ts, behind SLASH_BUDGET=1 on a production build
test("the slash chunk is at most 6 KB gz on the first '/'", async ({ page }) => {});
```

- [ ] **Step 2: Run them and confirm the new ones fail or are unwired.**

- [ ] **Step 3: Write the docs.** The CHANGELOG sub-block says "no schema or protocol change" and needs no Deploy note.

- [ ] **Step 4: Run the full verification**

```bash
bun audit --audit-level=high && bun biome check . && bun run lint && bun run typecheck && bun run test && bun run build
bun scripts/check-editor-chunk-size.ts      # record the eager delta against this plan's 280 B
CI= E2E_BASE_URL=http://localhost:3620 bun playwright test --project=chromium --project=perf
CI= E2E_BASE_URL=http://localhost:3620 bun playwright test tests/e2e/slash-menu.spec.ts --project=chromium --repeat-each=10 --workers=3
```

Expected: everything passes. Record these in the PR description: the eager delta, the slash chunk size, the palette chunk size (unchanged or within A7), typing p95 on and off, the leak numbers, and screenshots.

- [ ] **Step 5: Commit** after approval: `test(slash-menu): assert leaks, accessibility and budgets`

---

## Test plan (summary)

| Layer | What | Where |
|---|---|---|
| Unit | Detection matrix (allowed and refused places, remote "/", full-width, paste), query mapping, closing rules, attributes, no toolbar notify | `slash-trigger.test.ts` |
| Unit | Item building, availability filter, option expansion, ranking | `slash-items.test.ts` |
| Unit | One undo step, redo, failed run, read-only, table size, embed | `run-slash-pick.test.ts` |
| e2e | Open, filter, apply, Esc, focus, attributes, refused places, early Enter, remote delete, live region, read-only | `slash-menu.spec.ts` |
| e2e touch | `pointer: coarse` first, 44 px rows, keyboard and bar clearance, tap applies | `slash-menu.spec.ts` |
| e2e | 404 chunk and retry | `lazy-surfaces.spec.ts` |
| e2e | Listeners and heap after 100 cycles and 20 tab switches | `slash-menu-leaks.spec.ts` |
| e2e | axe light and dark, forced colours | `toolbar-a11y.spec.ts` |
| perf | Typing p95 ≤ +10% and ≤ +16 ms; ≤ 1 toolbar commit per settle | `--project=perf` |
| size | Eager ≤ 280 B; slash chunk ≤ 6 KB gz; palette within A7 | `check-editor-chunk-size.ts`, `SLASH_BUDGET=1` |

## Acceptance criteria

- "/" in an allowed place opens the menu within one frame once the chunk is cached. It never opens in a refused place, from a collaborator's input, or in a read-only document.
- Every pick is one undo step that restores "/query", and every item runs through `runAction`.
- Focus is never dropped. axe reports 0 serious issues in both themes. The live region announces the active option. Touch rows are 44 px.
- No schema or protocol change: `tests/fixtures/schema-snapshot.json`, `lib/schema-names.ts`, the Hocus gate and `contract.test.ts` are unchanged.
- The eager delta is ≤ 280 B (or the owner recorded an amendment), the slash chunk is ≤ 6 KB gz, and the typing and leak budgets hold.
- The contract amendment, CHANGELOG, README, TESTING and AGENTS entries are written.

## Risks

| Risk | Mitigation |
|---|---|
| `aria-activedescendant` on a contenteditable is unevenly supported (NVDA and JAWS in browse mode) | The polite live region announces the active option. Manual pass with VoiceOver and NVDA recorded in the PR. |
| Android IME delivers "/" inside a composition, or never sends Enter as a keydown | Detection reads the transaction, not key events. The list is operated by touch on Android. Manual check on a real Android device recorded in the PR. |
| Embed pick leaves an empty paragraph when the step is cancelled | Decision 6. Undo restores the text, and the e2e covers it. |
| Eager allocation overrun (the shared 740 B against a headroom of 307–641 B, plus split costs) | Measure at Task 0 and Task 6. Trim or ask for the owner's amendment, never raise the constant silently. |
| A shared module splits out of the palette chunk and pushes it over A7 | The items module imports nothing from the palette, and `PALETTE_BUDGET=1` runs in Task 6. |
| The trigger fires on a programmatic insert of "/" (paste, Markdown import, playground generator) | Only a single one-character `ReplaceStep` matching the selection opens it. The paste and Markdown cases are in the unit matrix. |

## Self-review

1. **Spec coverage:** §2 view of the registry → Tasks 2 and 3. §6 must-fixes (focus, names, targets, forced colours) → Tasks 4 and 6. §7 typing, leaks and bundle → Task 6. §8 item 6 → this plan. M14b → "Not in scope", first paragraph.
2. **Schema and protocol:** none, stated, with the files that prove it.
3. **Type consistency:** `SlashState` and `SlashKeyHandler` (Task 1) are used in Tasks 3 and 4. `SlashItem` (Task 2) is used in Tasks 3 and 4.
4. **Review Focus:** each item names its test, in Tasks 1, 3 and 4.
