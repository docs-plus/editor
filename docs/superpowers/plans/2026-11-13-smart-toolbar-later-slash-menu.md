# Smart toolbar, later phase: the "/" menu, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Typing "/" at the start of a paragraph, or after a space, opens a short menu of block actions under the caret: text styles, lists and Insert kinds. Typing filters it, and Enter or a click runs the pick. The pick removes the typed "/query" and applies the action as **one undo step**. The menu is one more view of the action registry (spec §2), so it adds no command of its own.

**Architecture:**
- **Eager, tiny:** a Tiptap extension, `SlashTrigger`, with one ProseMirror plugin and no props. It watches local transactions for a typed "/" in an allowed place and keeps `{ from, query }` mapped through later transactions. A small host, `SlashMenuHost`, is mounted by `EditorSurfaces`. It follows the editor's `transaction` and `update` events (`useSyncExternalStore`; `update` is how a `setEditable` reaches it) and renders the lazy menu only while the state is open.
- **Keys and attributes live in the lazy menu** (as built, for the eager budget; see "As built" below): while mounted it takes ↑, ↓, Enter and Esc aimed at the editor in a `window` capture-phase `keydown` listener (the palette's pattern), before ProseMirror and its keymaps, and sets the combobox attributes directly on `view.dom`.
- **Lazy:** the menu UI, item building and matching, and the pick runner. They load on the first "/" and, once per page, when the browser is idle. Like the menu bodies (A13), the host renders the loaded menu directly once its chunk is in (a module-level `loaded`), not through `lazy()`, whose first render suspends even for a cached chunk: at full typing speed "/h2" + Enter would otherwise reach the editor before the menu's key handler exists. Until the chunk lands nothing shows (Enter is still a line break); a failed load shows nothing and the next "/" retries.
- **Focus stays in the editor.** The query is ordinary text in the document. The listbox is announced through `aria-activedescendant`, plus a polite live region for screen readers that ignore it on a contenteditable.

## As built (2026-11-14)

This plan was carried out on `4b55ec6`. Where the build differs from the tasks below, this section wins; the task blocks are kept as the record of the plan.

- **Eager budget.** The first build, with keys (`handleKeyDown`, `priority` 1000), attributes (`props.attributes`), an active-option meta and a per-editor listener store in the trigger, measured **+1,398 B** eager, over the < 1,000 B cap. Keys, attributes, the active option and the listbox id moved into the lazy menu; the host follows the editor's own events; the menu chunk no longer waits for E's engine (before it lands, Diagram is one synchronous row). Final: **+923 B** (see the PR and contract amendment for the figures on the merged base).
- **The trigger's API** is `SlashTrigger`, `slashTriggerKey`, `getSlashState(editor)`, `closeSlash(editor)` and `SLASH_MAX_QUERY`, imported from `extensions/slash-trigger/slash-trigger.ts` (no index module). The open state is `{ open: true, from, query }`; the close meta is `true`. A pick needs no meta: deleting the "/" closes it.
- **Combobox attributes** (`aria-haspopup="listbox"`, `aria-autocomplete="list"`, `aria-controls`, `aria-activedescendant`) are set on `view.dom` by the menu in layout effects and removed on unmount. ProseMirror's `patchAttributes` removes only attributes it set, and its DOM observer ignores attribute mutations on the root, so this dispatches nothing and never calls `setOptions`.
- **Design review** (UI and UX designers, against screenshots at 1440 and 375, light and dark) changed:
  - an empty query lists Heading 1–3 only (H4–H6 are `searchOnly`; "/h4" and "/####" find them), and a list taller than its room ends halfway through a row, so the cut row shows there is more;
  - matches are grouped by the section of their best match, so each heading shows once and ↑ ↓ follow the drawn order;
  - a bare "/" has no active row (no `aria-activedescendant`; only "Block menu, N options." is announced) until an arrow or the pointer picks one, so "/" then Enter is a line break (a line may end in " /"); the first ↓ picks row 1, the first ↑ the last;
  - templates match on their own name ("Sequence"), and the last used one leads ties, so "/dia" puts it first (§9);
  - the list always stays inside the band between the sticky row and the phone bar plus keyboard, and is hidden while the caret is outside it; after a change of layout (first placement, a resize, the keyboard, content reflowing above), ProseMirror scrolls the caret back with `SCROLL_CLEARANCE`, never after the writer's own scroll; while open, a frame loop watches the "/"'s position in document coordinates and re-places the list in the same frame when content above the caret changes size (a diagram rendering, an image loading; in a short document the editor root keeps its minimum height, so a `ResizeObserver` on it misses these); the band ends at the lowest of the shared clearance, the docked bar's own top and the keyboard edge (`visualViewport` minus the bar), so a clearance not yet updated never lets the list over the bar, and a change of the bar's clearance style on the wrapper re-places it; after a reflow it follows the caret only while the list was in view (a collaborator's edit never pulls back a writer who scrolled away), and a hidden list takes only Esc;
  - `MAX_HEIGHT` is 340 px, so the first desktop view shows Text, Lists and the start of Insert;
  - a query with no match closes once it ends in whitespace (the writer moved on);
  - the first announcement of an open is "Block menu, N options." (with the active row after it once a query is typed), and a row's note is spoken ("Table, 3 by 3, …");
  - "—" in the query matches as "--" (Typography turns "/---" into "/—-");
  - Markdown hints are key caps; below 640 px the list spans the screen with 16 px gutters; the side chosen at open is kept while it fits;
  - Decision 6's template labels stay "Sequence diagram" and "State diagram" (a bare "Sequence" says too little when spoken or filtered), and Markdown hints stay on touch: design pass §6 hides key combos a phone cannot press, while hints are syntax a phone keyboard can type.
- **axe:** `scrollable-region-focusable` is off for the list alone. axe exempts a scrolling listbox only when a `role="combobox"` controls it; this one is controlled by the editor's `textbox`, and a focusable list would take focus out of the editor and close it.
- **Ports:** Next 6230, Hocus 4230.

**Tech Stack:** Next.js 16 (Turbopack), React 19, Tiptap 3.33 + `@tiptap/y-tiptap` (`ySyncPluginKey`, `yUndoPluginKey`), `@tiptap/extension-collaboration` (`isChangeOrigin`), `@floating-ui/dom` 1.8 (already a dependency), `bun test` (happy-dom), Playwright with `@axe-core/playwright`. **No new dependency.** `@tiptap/suggestion` is not installed, and adding it would be a dependency request under contract §5.1. It is also larger than the trigger this plan needs.

**Spec:** `docs/superpowers/specs/2026-11-12-smart-toolbar-design.md` §2 ("the later '/' menu" is a view of the registry), §6 (a11y must-fixes), §7 (budgets) and §8 item 6 ("Later").

**Contract:** `docs/superpowers/specs/2026-11-13-smart-toolbar-v1-contract.md`: §3.2 (only the palette and Insert list from the registry, so this plan adds a third lister through an amendment), §3.4 (key bindings), §5.1 (frozen files), §10 A7–A12 (budgets).

**Base:** `main` at or after `4b55ec6` (#36, the menu trim, contract A13; the design pass #35 is in too). Before Task 1, confirm:
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
- Playwright runs against **Next 6230 + Hocus 4230**, never tiny.docs.plus. The later-phase sessions run in parallel, each on its own ports; 3000, 1234, 5000 and 6000 are off limits. Run `lsof -i :6230 -i :4230` first, and stop only the servers you started.

```bash
# terminal 1: Hocus
DOC_CREATION_RATE_LIMIT=2000 WS_CONNECTION_LIMIT=200 WS_SOCKETS_PER_IP=600 WS_UPGRADE_RATE_LIMIT=6000 \
  HOCUS_THROTTLE=0 MAX_TOTAL_DOCUMENTS=1000000 HOCUS_PORT=4230 DB_PATH="$TMPDIR/tinydocy-slash.sqlite" \
  HOCUS_ALLOW_ISOLATED_TABS_DOCS=1 bun run hocus
# terminal 2: Next (same DB_PATH: the DELETE route and Hocus share tombstones)
NEXT_PUBLIC_HOCUS_URL=ws://127.0.0.1:4230 DB_PATH="$TMPDIR/tinydocy-slash.sqlite" bun next dev -p 6230
# tests
CI= E2E_BASE_URL=http://localhost:6230 E2E_HOCUS_URL=ws://127.0.0.1:4230 bun playwright test <spec> --project=chromium
```

- e2e types at full speed. Misplaced text means an app bug, not a missing wait.
- Touch e2e uses `test.use({ hasTouch: true, isMobile: true })`. Its first assertion is `matchMedia("(pointer: coarse)").matches === true`.

**Code rules**
- Never subscribe the editor shell to editor state. Never rebuild the extensions array or `EDITOR_PROPS` per render: Tiptap would call `setOptions`, a full view update. Combobox attributes therefore come from the plugin's `props.attributes`, never from `EDITOR_PROPS`.
- Actions run only through `runAction(editor, action, arg)`, which rechecks the live document.
- Never call `editor.registerPlugin` from a lazy chunk. A changed plugin set makes prosemirror-view destroy and re-create **every** plugin view (`updatePluginViews`), including y-sync, carets, fold and the TOC. The trigger plugin is registered once, in the extensions array.
- A lazy chunk never imports row modules (`components/smart-toolbar/row/**`, `main-toolbar-content.tsx`). When it did (A9), Turbopack split the shared modules out of the editor group, and the lost compression cost 344 B to 1.5 KB.
- The slash chunk imports only modules the editor chunk already has, its own files and `@floating-ui/dom`. Never `components/smart-toolbar/palette/**` (not even its ranking), the menu chunk's `components/ui/dropdown-menu.tsx`, or `insert/diagram-templates.tsx`: Turbopack copies a module that only lazy chunks share into each of them, or splits it out, and either could move the palette's first Alt+/ (A7, 36 B left).
- The menu's window capture listener runs before the list item, task item, table and StarterKit keymaps, so the trigger needs no `priority` and no `handleKeyDown`. `SlashTrigger` goes after `RepeatFormatting`, away from the array's tail, where other later-phase plans append.
- While an IME composition is open (`view.composing`, `event.isComposing` or key code 229) the menu takes no key (`slashKey()`, `lib/slash-menu/slash-keys.ts`): Enter commits the candidate and the arrows move through candidates.

**Contract rules**
- Frozen files change only through a contract amendment: `lib/editor-actions/index.ts`, `components/smart-toolbar/editor-surfaces.tsx`, `components/smart-toolbar/types.ts` and `tests/unit/editor-actions/contract.test.ts`.
- Amendments take the next free A-number at merge (A14 at the time of writing; A13 is the menu trim; the hover-preview plan may claim it first, so the merger renumbers). Never hardcode the number in code comments.

## Schema and protocol

**None. This plan needs no schema change and no protocol change.**
- No new mark, node or attribute, and no change to `lib/schema-names.ts` (the ingress allowlist) or `tests/fixtures/schema-snapshot.json`.
- No WebSocket URL parameter, no Hocus change and no `SCHEMA_FLOOR` change.
- The only document writes are the ones the user already makes: typing "/query", which is ordinary text, and the picked action, which goes through `runAction` like every other surface. Collaborators see "/hea" while it is typed, exactly as with any other typing.

## Budgets

**Editor chunk (`scripts/check-editor-chunk-size.ts`, gz).** The script sums every file the editor's loader lists, CSS included. The figures this section first held (A12: 641 B, then 307 B left) are history: the menu trim (A13, #36) made every menu body lazy. Measured on `4b55ec6` (`bun run build`, then the script): **394,567 B gz, +16,679 B, 7,385 B under the 23.5 KB budget.** The later-phase plans run in parallel and share that headroom; the manager session merges them in order and re-measures.

| Plan | Eager allocation | What is eager | Lazy |
|---|---|---|---|
| **"/" menu (this plan)** | **< 1,000 B** (report the exact figure) | trigger plugin, host, one lazy loader | slash chunk ≤ 6 KB gz |

- A lazy chunk that imports modules the editor chunk also uses can make Turbopack split those modules into separate, less compressible editor-group files (A8: about 344 B for the palette chunk, about 968 B for the split button). The eager figure is measured with that cost included.
- No plan raises the constant itself.

**Palette (A7):** the first Alt+/ loads 20,444 B gz (402 B loader + 20,042 B chunk) against 20,480 B: **36 B left, reserved for another session. This plan must not change the palette's first Alt+/ at all.** Prove it file by file: run `palette.spec.ts` with `PALETTE_BUDGET=1` against `next start` on the base build and on this branch's build (same `NEXT_PUBLIC_*` values), and compare the logged per-file sizes.

**Slash chunk:** ≤ 6 KB gz, measured on a production build the way `palette.spec.ts` measures the palette (`PALETTE_BUDGET=1` pattern, as `SLASH_BUDGET=1`).

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
  - The list is `role="listbox"` (`id` `slash-menu-<editorKey>`) with `role="group"` sections labelled "Text", "Lists", "Insert" and "Diagrams". Rows are `role="option"` with `aria-selected`.
  - While the menu is open, the editor carries `aria-haspopup="listbox"`, `aria-controls`, `aria-autocomplete="list"` and `aria-activedescendant`, all allowed on a `textbox`. **Not `aria-expanded`:** ARIA 1.2 does not allow it on `textbox` (axe `aria-allowed-attr`), and the editor's role never flips to `combobox` mid-edit.
  - When the menu is closed, none of these attributes are present.
- **Announcements (4.1.3):** a polite live region, present for the editor's whole life, says "Heading 2, 3 of 9" when the active option changes, and "No matching blocks" when nothing matches. It is debounced by 150 ms so fast arrows don't queue a burst. This covers screen readers that do not follow `aria-activedescendant` on a contenteditable.
- **Names (2.4.6, 2.5.3):** each option's accessible name starts with its visible label (sentence case). The Markdown hint (`## `, `> `, from `Action.markdownHint`) is visible and `aria-hidden`.
- **Targets (2.5.8):** rows are ≥ 24 px tall with a mouse and **44 px** on touch.
- **Contrast and forced colours:** text and the active row's indicator meet ≥ 4.5:1 and ≥ 3:1 in both themes. The active row has a 2 px outline, which survives forced colours (`Highlight`); its colour is never the only cue.
- **Focus not obscured (2.4.11):** the list flips above the caret when it would cover the caret line, the sticky row or the phone bar plus keyboard (`--mobile-bar-clearance`).
- **Reduced motion:** no animation beyond a 100 ms opacity fade, and none under `prefers-reduced-motion`.

## Upstream interfaces (as on `main` at `4b55ec6`)

| # | Name | Where | Used for |
|---|---|---|---|
| U1 | `editorActions.list({ group })`, `.get(id)` | `lib/editor-actions/index.ts` (frozen) | the items: groups `style`, `list` and `insert` |
| U2 | `availability(action, ctx)`, `canRun`, `runAction(editor, action, arg)` | `lib/editor-actions/registry.ts` | hiding unavailable items; running the pick |
| U3 | `computeContext(editor)` | `lib/editor-context/snapshot.ts` | a fresh snapshot per open (like the palette) |
| U4 | `Action.label`, `keywords`, `icon`, `markdownHint`, `options(ctx)` | `lib/editor-actions/types.ts` | rows; `template.mermaid` expands to its templates |
| U5 | `readChoice(TABLE_SIZE_CHOICE)` | `lib/remembered-choice.ts` | `insert.table` runs at the remembered size (M17a) |
| U6 | `lazySurface`, `SurfaceBoundary` | `components/smart-toolbar/lazy-surface.tsx` | the lazy menu's first load and its failure path |
| U7 | `ySyncPluginKey`, `yUndoPluginKey` | `@tiptap/y-tiptap` | ignore remote steps; `undoManager.stopCapturing()` |
| U8 | `isChangeOrigin(tr)` | `@tiptap/extension-collaboration` | ignore remote steps |
| U9 | `CHUNK_MARKERS`, `interceptChunk` | `tests/e2e/helpers/lazy-chunk.ts` | the 404 and hold cases |
| U10 | `listenerCounts` and the heap reading | `tests/e2e/palette-leaks.spec.ts` (inline today) | extracted to `tests/e2e/helpers/leak-metrics.ts` if no earlier plan did it |
| U11 | `createCollabEditor` | `tests/helpers/collab-editor.ts` | undo tests with the real Yjs undo manager |
| U12 | `useKeyboardInset` | `hooks/use-keyboard-inset.ts` | placement above the phone keyboard |

## Decisions on spec ambiguities (owner can overrule)

1. **Where "/" opens:** in a `paragraph` (including inside list items, quotes and table cells), with an empty selection, when the character before it is the block start or whitespace. Never in the title, a heading, a code block, Mermaid, inline code, or a read-only document. So "and/or" and URLs never open it.
2. **Only an ASCII "/" in a local transaction opens it.** That is one `ReplaceStep` whose slice is the text "/", with no `ySyncPluginKey` meta and not `isChangeOrigin`. A collaborator's "/" never opens your menu, and a full-width "／" from an IME never opens it. The trigger reads the transaction, not `handleTextInput` or physical key codes ("/" is Shift+7 on German layouts, and Android composition input does not reliably reach `handleTextInput`). A "/" that arrives through an IME still opens the menu, but while a composition is open the trigger forwards no key (Enter commits the candidate). On Android the list is operated by touch.
3. **The query stays in the document** (Notion's model), and focus stays in the editor. A separate input would move focus on a keystroke (3.2.2) and close the phone keyboard.
4. **Undo:** a pick is exactly one undo step. `stopCapturing()` runs, then one transaction deletes "/query", then `runAction` runs, then `stopCapturing()` runs again. Undo restores the "/query" text and the block as it was. If `runAction` returns false after the deletion, the runner puts the text back in the same capture group, and nothing else changes.
5. **Unavailable items are hidden**, not listed with a reason (the palette lists them). The menu is position-bound and short. Everything stays reachable with its reason in the palette and the row. When a query matches only hidden items, the empty state says why for the best of them ("Quote: Already in a quote.", `slashEmptyNote`; UX review).
6. **Items:** Text (`style.paragraph`, `style.heading1`–`6`), Lists (`list.bullet`, `list.ordered`, `list.task`), Insert (every `insert.*` action in registry order) and Diagrams. As in the Insert menu's one Diagram ▸ submenu (design pass §9), `insert.mermaid` and `template.mermaid` never both show: once E's engine is in, Diagram's place is a "Diagrams" section with the five templates (Flowchart, Sequence, State, Mind map, Pie chart, with the submenu's icons and its "Last used" note), labelled by template name with no repeated noun (design pass §8). Before the engine lands it is one "Diagram" row (`insert.mermaid`, synchronous); the menu chunk does not wait for the engine (eager budget, see "As built"), and the engine loads when the editor is created, so template rows, whose runs are synchronous once it is in, are the usual case. `insert.table` runs with the remembered size (M17a; 3 × 3 when nothing is remembered), with no grid step. `insert.embed` deletes the query and then opens the Insert button's embed step (`insert.open`); cancelling that step leaves the paragraph empty, and undo restores the text.
7. **Matching:** case-insensitive word-prefix over label, keywords and the Markdown hint (`/h2`, `/##` and `/quote` all work). Ranked label prefix > word prefix > keyword > hint, ties in registry order.
8. **Closing:** Esc, blur, a pick, the caret leaving the query, a deleted "/", a query that starts with a space ("1 / 2") or contains "/" or two spaces, a query over 24 characters, or a read-only switch. With no match the menu stays open with "No matching blocks" until one of these happens, so typing "/usr/bin" just continues.
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
| `components/smart-toolbar/slash-menu-host.tsx` | Also owns `loadSlashMenu` and its idle preload (once per page), so `lazy-surface.tsx`, which the small-fixes session changes, stays untouched | — |
| `components/document-editor/document-editor-config.ts` | Adds `SlashTrigger` after `RepeatFormatting` | Modify (shared: one import line, one array line) |
| `tests/e2e/helpers/lazy-chunk.ts` | `CHUNK_MARKERS.slashMenu` | Modify |
| `tests/e2e/helpers/leak-metrics.ts` | Listener and heap helpers, extracted from `palette-leaks.spec.ts` | Create if missing |
| `tests/unit/extensions/slash-trigger.test.ts`, `tests/unit/lib/slash-items.test.ts`, `tests/unit/lib/run-slash-pick.test.ts` | Unit tests | Create |
| `tests/e2e/slash-menu.spec.ts`, `tests/e2e/slash-menu-leaks.spec.ts`, `tests/e2e/lazy-surfaces.spec.ts` | e2e | Create / Create / Modify |
| `docs/superpowers/specs/2026-11-13-smart-toolbar-v1-contract.md` | Amendment: frozen `EditorSurfaces` hunk, third registry lister | Modify |
| `CHANGELOG.md`, `README.md`, `tests/TESTING.md`, `AGENTS.md` | Docs | Modify |

---

### Task 0: Measure the base (done before any feature code)

Headroom is no longer the bottleneck (A13), so the spike chunk is dropped. On a clean build of the base, record the editor chunk (394,567 B gz, +16,679 B) and the palette's first Alt+/ file by file (`PALETTE_BUDGET=1` against `next start`: 402 B + 20,042 B = 20,444 B). Task 6 measures the same two things on the branch.

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
  - On a local transaction, `from` maps through `tr.mapping` (association −1, so text typed after "/" stays in the query).
  - On a remote one (`ySyncPluginKey` meta), mapping is useless: the binding replaces each changed top-level block whole and restores the caret from Yjs relative positions. `from` is re-derived from the restored caret instead (`head − 1 − query.length` must still hold the "/" in the same textblock), else the menu closes.
  - `setEditable(false)` dispatches no transaction, so the plugin view's `update` closes the menu (a deferred meta-only transaction), and `attributes` treat `!view.editable` as closed.
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
it("forwards no key while an IME composition is open", () => {});
it("remote '/' never opens", () => { /* second client types '/' into the same paragraph */ });
it("tracks the query and maps 'from' through remote inserts before it", () => {});
it("remote deletion of the '/' closes", () => {});
it("closes on Esc, blur, a '/' or two spaces in the query, > 24 chars, and when the caret leaves the query", () => {});
it("Esc without a handler closes; Enter without a handler is not consumed", () => {});
it("attributes come and go with the plugin state", () => {
  // open -> view.dom has aria-haspopup, aria-controls, aria-autocomplete, aria-activedescendant; close -> none of them
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
- The module imports only types, `registry.ts` helpers and `remembered-choice.ts` types. It never imports `components/**` or the palette (the first Alt+/ has 36 B left, A7).

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
- Modify: `tests/e2e/helpers/lazy-chunk.ts` (`slashMenu: "function SlashMenu("`)
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
  // activeElement is .ProseMirror throughout; aria-controls and aria-activedescendant while open, absent after Esc
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

- [ ] **Step 2: Run them and confirm they fail.** Run: `CI= E2E_BASE_URL=http://localhost:6230 bun playwright test tests/e2e/slash-menu.spec.ts --project=chromium`. Expected: FAIL.

- [ ] **Step 3: Implement.** Screenshot the menu in light and dark, at 1440 px and 375 px: open, filtered, no match, and near the bottom edge (flipped above the caret). A UI designer and a UX designer review them before merge.

- [ ] **Step 4: Run them and confirm they pass.** Expected: PASS.

- [ ] **Step 5: Commit** after approval: `feat(slash-menu): show the block menu under the caret`

---

### Task 5: Mount, failure path and the contract amendment

**Files:**
- Modify: `components/smart-toolbar/editor-surfaces.tsx` (one line: `<SlashMenuHost editor={editor} />`), `components/document-editor/document-editor-config.ts` (`SlashTrigger` after `RepeatFormatting`), `docs/superpowers/specs/2026-11-13-smart-toolbar-v1-contract.md` (§10 amendment), `tests/e2e/lazy-surfaces.spec.ts`
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
- Modify: `tests/e2e/toolbar-a11y.spec.ts`, `CHANGELOG.md`, `README.md` (features), `tests/TESTING.md` (new specs, ports 6230/4230, `SLASH_BUDGET=1`), `AGENTS.md` (one Learned Workspace Facts line: the trigger plugin, the lazy menu, and that the query stays in the doc)

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
bun scripts/check-editor-chunk-size.ts      # record the eager delta (< 1,000 B for this plan)
CI= E2E_BASE_URL=http://localhost:6230 bun playwright test --project=chromium --project=perf
CI= E2E_BASE_URL=http://localhost:6230 bun playwright test tests/e2e/slash-menu.spec.ts --project=chromium --repeat-each=10 --workers=3
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
| size | Eager < 1,000 B; slash chunk ≤ 6 KB gz; palette's first Alt+/ unchanged file by file | `check-editor-chunk-size.ts`, `SLASH_BUDGET=1`, `PALETTE_BUDGET=1` |

## Acceptance criteria

- "/" in an allowed place opens the menu within one frame once the chunk is cached. It never opens in a refused place, from a collaborator's input, or in a read-only document.
- Every pick is one undo step that restores "/query", and every item runs through `runAction`.
- Focus is never dropped. axe reports 0 serious issues in both themes. The live region announces the active option. Touch rows are 44 px.
- No schema or protocol change: `tests/fixtures/schema-snapshot.json`, `lib/schema-names.ts`, the Hocus gate and `contract.test.ts` are unchanged.
- The eager delta is < 1,000 B, the slash chunk is ≤ 6 KB gz, the palette's first Alt+/ is unchanged, and the typing and leak budgets hold.
- The contract amendment, CHANGELOG, README, TESTING and AGENTS entries are written.

## Risks

| Risk | Mitigation |
|---|---|
| `aria-activedescendant` on a contenteditable is unevenly supported (NVDA and JAWS in browse mode) | The polite live region announces the active option. Manual pass with VoiceOver and NVDA recorded in the PR. |
| Android IME delivers "/" inside a composition, or never sends Enter as a keydown | Detection reads the transaction, not key events. The list is operated by touch on Android. Manual check on a real Android device recorded in the PR. |
| Embed pick leaves an empty paragraph when the step is cancelled | Decision 6. Undo restores the text, and the e2e covers it. |
| Eager allocation overrun (< 1,000 B of the 7,385 B the later-phase plans share, plus split costs) | Measure at Task 0 and Task 6. Trim, never raise the constant silently. |
| A shared module splits out of the palette chunk and moves its first Alt+/ (36 B left) | The slash chunk imports nothing only lazy chunks share, and `PALETTE_BUDGET=1` runs on the base and the branch, compared file by file. |
| The trigger fires on a programmatic insert of "/" (paste, Markdown import, playground generator) | Only a single one-character `ReplaceStep` matching the selection opens it. The paste and Markdown cases are in the unit matrix. |

## Self-review

1. **Spec coverage:** §2 view of the registry → Tasks 2 and 3. §6 must-fixes (focus, names, targets, forced colours) → Tasks 4 and 6. §7 typing, leaks and bundle → Task 6. §8 item 6 → this plan. M14b → "Not in scope", first paragraph.
2. **Schema and protocol:** none, stated, with the files that prove it.
3. **Type consistency:** `SlashState` and `SlashKeyHandler` (Task 1) are used in Tasks 3 and 4. `SlashItem` (Task 2) is used in Tasks 3 and 4.
4. **Review Focus:** each item names its test, in Tasks 1, 3 and 4.
