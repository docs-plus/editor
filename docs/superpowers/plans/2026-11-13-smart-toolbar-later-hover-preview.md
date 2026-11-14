# Smart toolbar, later phase: hover preview, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Refreshed 2026-11-14** after the design pass (`docs/superpowers/specs/2026-11-13-smart-toolbar-design-pass.md`, #35) and the menu trim (#36, contract A13). What changed since the first draft:
- The bubble's Repeat split button (`repeat-split-button.tsx`) and its Repeat face are gone (design pass §1, §3). The old optional Task 5 (Repeat face and size steps) is dropped.
- The bubble is now **B I U | A▾ | Link | Paint format**. Its only colour trigger is the text-colour chevron, whose popover renders the same `ColorPanel` (Recent, Text colour, Highlight).
- Menu bodies are lazy since #36. The editor chunk has **7,385 B of headroom** against the 23.5 KB budget (A13), not the 307–641 B the first draft shared out.
- Low-contrast highlight swatches are no longer dimmed. They keep a dotted border, and the note under Highlight reads "Dotted: hard to read with Red text" (design pass §11).
- Every user-visible change has a status pill (design pass §5). A preview changes nothing, so it has no pill and no `announce()`.

**Goal:** When a writer points at a text-colour or highlight swatch, or moves to one with the arrow keys, the selected text shows that colour **before** they commit. Moving away, Esc, closing the popover, applying, or a local change to the document or selection removes the preview; a collaborator's change redraws it on the moved selection. It is drawn with ProseMirror **decorations only**, so it never touches the document, Yjs, the undo stack, collaborators or the toolbar. It is off on touch (spec §8 item 6: "decorations only, also on keyboard focus, off on touch").

**Architecture:**
- **Eager, tiny:** an `ActionPreview` extension (`extensions/action-preview/`), registered once in the extensions array.
  - Its plugin state is a `DecorationSet`. Only a meta-only transaction sets it, and any doc or selection change clears it.
  - One Tiptap command, `setActionPreview(attrs | null)`. The plugin builds the decorations itself (one `Decoration.inline` per selection range).
  - So the lazy side sends plain data and imports nothing the editor chunk also imports. A new shared import would make Turbopack split modules into extra editor-group files (A8 measured 344–968 B per split).
- **Lazy:** everything else lives in the colour-panel chunk that already exists (A9).
  - `components/smart-toolbar/color/swatch-preview.ts`: the swatch → attributes mapping, the gates, the size cap and the `useSwatchPreview` hook.
  - No CSS file: the decorations carry token attributes and inline styles (Decision 7).
  - The row popover and the bubble popover both render `ColorPanel`, so one integration covers every pointer surface. The phone Aa sheet renders it too, and the touch gate keeps it off there.
- **Rendering:** an inline decoration carries the same `data-*` attribute as the real mark (`span[data-text-color]`, `mark[data-highlight]`), so the existing token CSS styles it. ProseMirror renders inline decorations inside mark elements, so the preview wins over an existing colour. Highlights, "Default text" and "No highlight" carry an inline style built from a validated token, which also outranks the blurred selection's paint (Decision 8).

**Tech Stack:** Tiptap 3.33 / ProseMirror (`Decoration.inline`, `DecorationSet`), React 19, `bun test` (happy-dom), Playwright with `@axe-core/playwright`. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-12-smart-toolbar-design.md` §4.5 (colour popover, O3, O4 keyboard), §5 (memory changes what a button offers, never what you type: a preview writes nothing), §6, §7 and §8 item 6. The design pass §1, §5 and §11. Research: Word's live preview (sources, round 2).

**Base:** `main` at `4b55ec6` (#36 merged). Confirmed on that commit:
- `git grep -n "export const loadColorPanel" components/smart-toolbar/lazy-surface.tsx`;
- `git grep -n "aria-pressed={pressed}" components/smart-toolbar/color/color-panel.tsx`;
- `git grep -n "function changesToolbarContext" hooks/use-tiptap-editor.ts` (meta-only transactions do not notify the toolbar).

**Effort:** M, about **3 engineer-days**: plugin and invariants 1, mapping and the swatch hook 0.5, CSS and nesting 0.5, e2e (hover, keyboard, bubble, collaboration, touch) 0.5–1, budgets, design review and docs 0.5.

## Global Constraints

**Tooling**
- Bun only: `bun`, `bun <bin>`, `bunx --bun`. Never npm, npx, yarn or pnpm.
- Biome formats and lints. ESLint covers Next rules only. TypeScript is strict. `bun run typecheck` covers the app and `tsconfig.sw.json`.

**Code style**
- Named exports only. Kebab-case files. PascalCase components with title-case acronyms.
- Icons come from `lib/icons.tsx`. New UI uses the shadcn components and tokens.

**Commits**
- Conventional Commits: atomic, imperative mood.
- No AI, tool or agent references and no trailers.
- Before every commit, show a commit review report (files, diff summary, message).
- `CHANGELOG.md`: one sub-block for this PR under `## [Unreleased]`.

**Tests**
- `bun run test`: one process, happy-dom preload. `mock.module` spreads the real module and is followed by `await import()`. Env read at import time goes through `importFresh()` with `resetModules()` in `afterEach`.
- Playwright runs against **Next 6210 + Hocus 4210** (this track's ports; 3000, 1234, 5000 and 6000 are off limits). Never test against tiny.docs.plus. Run `lsof` first and stop only what you started.

```bash
DOC_CREATION_RATE_LIMIT=2000 WS_CONNECTION_LIMIT=200 WS_SOCKETS_PER_IP=600 WS_UPGRADE_RATE_LIMIT=6000 \
  HOCUS_THROTTLE=0 MAX_TOTAL_DOCUMENTS=1000000 HOCUS_PORT=4210 DB_PATH="$TMPDIR/tinydocy-preview.sqlite" \
  HOCUS_ALLOW_ISOLATED_TABS_DOCS=1 bun run hocus
NEXT_PUBLIC_HOCUS_URL=ws://127.0.0.1:4210 DB_PATH="$TMPDIR/tinydocy-preview.sqlite" bun next dev -p 6210
CI= E2E_BASE_URL=http://localhost:6210 E2E_HOCUS_URL=ws://127.0.0.1:4210 bun playwright test <spec> --project=chromium
```

- Touch e2e: `test.use({ hasTouch: true, isMobile: true })`, first assertion `matchMedia("(pointer: coarse)").matches === true`.

**Code rules**
- **Never call `editor.registerPlugin` from a lazy chunk.** prosemirror-view's `updatePluginViews` destroys and re-creates every plugin view when the plugin set changes, including y-sync, collaboration carets, fold, the TOC and the bubble. The preview plugin is in the extensions array from the start.
- Preview transactions are **meta-only**: no steps, no `setSelection`, no stored marks, `addToHistory: false`. That keeps them out of Yjs (the y-sync view skips updates without a doc change), out of the undo stack, and out of the toolbar version store (`changesToolbarContext`).
- The lazy chunk imports nothing new that the editor chunk also imports (no `@tiptap/pm/view`, no `extensions/action-preview`). It calls `editor.commands.setActionPreview`, typed through the extension's module augmentation.
- Never subscribe the editor shell to editor state. Never rebuild the extensions array or `EDITOR_PROPS`.
- A lazy chunk never imports row modules (A9 split cost).

**Contract rules**
- No frozen file is touched.
- `components/smart-toolbar/color/color-panel.tsx` is a D2 file (§5.1). The edit falls under the A6 owner grant ("tracks may edit the files their scope names") and is listed in this plan's amendment (**A14**, renumbered at merge if another track takes it first).
- `document-editor-config.ts` is shared: each track adds its own lines. This track adds one import and one array entry. The slash-menu track also registers an extension there, so the change stays one small, self-contained hunk.
- No action id, prefix, group, `UiIntent` or memory slot is added, so `contract.test.ts` is unchanged.

## Schema and protocol

**None. This plan needs no schema change and no protocol change.**
- Decorations are view state. Nothing is written to the Y.Doc, so `lib/schema-names.ts`, `tests/fixtures/schema-snapshot.json`, the Hocus ingress guard and the gate are untouched.
- Collaborators never see another writer's preview: there is no awareness field and no message.

## Budgets

**Editor chunk (`scripts/check-editor-chunk-size.ts`, gz).** The script sums every file the editor's loader lists, CSS included. The base on `4b55ec6` measures **394,567 B gz, +16,679 B, 7,385 B under the 23.5 KB budget** (A13, 10 files in the group).
- **This plan's eager cap is < 1,000 B**: the extension, its plugin and its command. Report the exact delta.
- The other later-phase plans (continue chip, "/" menu, simplified toolbar) share the same headroom. Each measures against the base and re-measures after a rebase.
- **The editor group's file list must not change**, only the size of its files. A new file in the group is a Turbopack split and must be removed, not accepted.
- No plan raises the budget constant.

**Palette chunk (A7):** 36 B left. This plan puts **nothing** in it: the palette's chunks must be byte-identical before and after.

**Colour-panel chunk:** grows by ≤ 1 KB gz (mapping, hook and CSS), measured on a production build before and after.

**Performance:**
- Typing p95 is unchanged (≤ +10% and ≤ +16 ms, `--project=perf`). On a typing transaction with no preview shown, the plugin's `apply` returns `prev` at once.
- **Cap:** no preview when the selection spans more than 200 top-level blocks or 20,000 positions. Both are O(1) (`$to.index(0) - $from.index(0)`, `to - from`); the selection's text is never read. Select-all in a 500-heading document previews nothing and costs nothing.
- **Dwell:** a pointer must rest 80 ms on a swatch before its preview shows, so sweeping across the grid dispatches at most one preview per resting point. Leaving a swatch clears after the same delay, unless another swatch takes over first, so moving between neighbours does not flicker. Arrow keys show at once.
- **0 toolbar commits** per preview (meta-only). **0 Yjs updates** and **0 undo entries** per preview.
- The hook's only resource is one timer, cleared on unmount. No listener is added to `window` or `document`, so no leak test beyond the unit test is needed.

## Accessibility requirements (WCAG 2.2 AA)

- **Keyboard parity:** a preview follows the panel's 2-D roving grid (O4: arrows move without applying). Enter applies, as before.
- **No preview on open:** the focus the popover puts on a swatch when it opens does not preview. With no colour or a mixed one, that swatch is "Default text", and recolouring the text just because the popover opened would be a surprise. The first arrow key previews.
- **No change of context (3.2.1, 3.2.2):** a preview changes neither content nor focus nor selection. `aria-pressed`, the dotted low-contrast state and the low-contrast note keep following the **applied** colour, never the previewed one.
- **Nothing to announce:** the swatch's own name ("Red text", "Yellow highlight") is what the screen reader hears. A preview adds no live region, no `announce()` and no status pill.
- **Dismissible:** Esc closes the popover with focus on its trigger (O4), and closing clears the preview. Leaving the grid with the pointer or focus clears it.
- **Focus is never dropped.** The preview never moves focus.
- **Forced colours:** off. Forced colours override text and background colours, so a preview would show nothing.
- **Touch:** off. `(hover: hover) and (pointer: fine)` must match at mount, and the event's `pointerType` must be `"mouse"` or `"pen"`. No new targets are added, so the 44 px rule is unaffected.
- **Reduced motion:** the preview appears and disappears instantly, with no transition.
- **Contrast:** a preview shows the real token colours, which already meet spec §3 / Appendix A. Low-contrast highlight pairs (O3) preview honestly, and their swatch keeps its dotted border and "Low contrast" description.

## Upstream interfaces (as on `main` at `4b55ec6`)

| # | Name | Where | Used for |
|---|---|---|---|
| U1 | `ColorPanel` swatches: `<button aria-pressed onFocus onMouseDown>` in a roving grid with `onKeyDown` | `components/smart-toolbar/color/color-panel.tsx` | where the hook attaches |
| U2 | `loadColorPanel`, `lazySurface` | `components/smart-toolbar/lazy-surface.tsx` | the chunk the preview code joins |
| U3 | `isCoarsePointer()` | `components/smart-toolbar/coarse-pointer.ts` | the pattern for a media check at mount |
| U4 | `useActionView(id, editor)` → `enabled` (the panel's `reasons`) | `hooks/use-editor-context.ts` | no preview for a swatch that cannot apply |
| U5 | `TEXT_COLOR_ATTR`, `HIGHLIGHT_ATTR`, `isTextColorToken` | `lib/text-style-tokens.ts` | decoration attributes, validated tokens only |
| U6 | `.tiptap span[data-text-color=…]`, `.tiptap mark[data-highlight=…]` | `extensions/text-style-marks/text-style-marks.scss`, `components/document-editor/document-editor.scss` | the existing token CSS a decoration reuses |
| U7 | `changesToolbarContext` / `getEditorVersionStore` | `hooks/use-tiptap-editor.ts` | proving 0 toolbar commits |
| U8 | `createCollabEditor` | `tests/helpers/collab-editor.ts` | proving 0 Yjs updates and 0 undo entries |
| U9 | `SelectionBubbleView`, `bubble-rules.ts` (B I U, A▾, Link, Paint format) | `components/smart-toolbar/bubble/` | the bubble stays open while previewing from its popover |
| U10 | `CHUNK_MARKERS.colorPanel`, `countToolbarCommit` | `tests/e2e/helpers/lazy-chunk.ts`, `components/document-editor/toolbar-test-hooks.ts` | lazy proof; 0 toolbar commits in e2e |
| U11 | `Selection` (`@tiptap/extensions`) and `.selection` | `paragraph-node.scss` | the blurred editor's selection paint, which a preview sits on |

## Decisions on spec ambiguities (owner can overrule)

1. **Scope:** text-colour and highlight swatches (including Recent, "Default text" and "No highlight") in every `ColorPanel`. Out:
   - the style menu (headings): a node change reflows the page under the pointer, and heading sizes come from `heading-scale`;
   - the font-size stepper: it is eager row code, and a size preview reflows the line under the pointer;
   - the colour split faces: they are eager row code, and they apply the remembered colour in one click;
   - Paint format and Repeat formatting (design pass §2, §3): no face shows a bundle.
2. **No marker on the previewed text.** A preview shows exactly what Apply will produce, as in Word. The pressed swatch and the open popover say nothing is applied yet.
3. **Never map; redraw after a collaborator's change.** A local doc or selection change clears the preview. Mapping the old ranges through a collaborator's edit could leave it on the wrong text, so after a remote change (`isChangeOrigin`) the plugin rebuilds it from the selection y-sync moved, with the same attributes. Clearing there instead (the first draft) made the preview vanish for good in a busy shared document, because the pointer resting on the swatch fires no new `pointerenter` (UX review).
4. **Caret, node and cell selections:** no preview for a caret (nothing visible to colour) or a node selection. A `CellSelection` previews each range (`selection.ranges`).
5. **Read-only and unavailable:** no preview when the editor is not editable or the swatch's kind cannot apply (inside code, for example).
6. **Kill switch:** `NEXT_PUBLIC_ACTION_PREVIEW=0` disables previews. It is read in the lazy chunk (0 eager bytes) and listed in README's env table, following AGENTS.md's discoverable `NEXT_PUBLIC_*` rule.
7. **"Default text" and "No highlight" previews:**
   - "Default text" sets `color: var(--foreground)` inline, which overrides an outer coloured span.
   - "No highlight" sets `background-color: var(--background)` inline on the inner span, which covers an outer highlight on the page background.
   - Inside table header cells and other tinted backgrounds the cover can differ slightly. That is accepted, because the real Apply is one click away and undoable.
8. **The blurred selection.** While the popover has focus, `Selection` paints the selected text with `--tt-selection-color`, and its `selection` class lands on the preview element itself (measured: `<mark class="tt-preview selection">`), where `.tiptap.ProseMirror .selection` outranks the token CSS. So every preview sets its own background inline: the highlight's token, the page background for "No highlight", and transparent for text colours. The previewed words show without the tint, exactly as applying leaves them (blue text on the blue tint was unreadable in dark mode). The tint returns when the preview goes.

## Not in scope

- Previewing heading levels, alignment, lists, sizes or Insert kinds.
- Showing previews to collaborators.
- Hover previews on touch, or a long-press equivalent.
- Document styles (M14b); see the "/" menu plan's "Not in scope".

## Review Focus

1. **Zero writes.** A preview cycle produces 0 Yjs updates, 0 undo entries and 0 toolbar commits, and copying while previewing copies no preview. Task 1 unit tests.
2. **The bubble survives previewing from its own popover.** Meta-only transactions must not trip `bubble-rules.ts`'s hide rules or the bubble's `shouldShow`. Task 3 e2e "bubble stays open while previewing".
3. **Remote edits while previewing.** A collaborator's edit clears the preview, and nothing is left on the wrong text. Task 1 unit test.
4. **Nesting over existing marks.** Previewing red over blue text, and "No highlight" over yellow, show the previewed result. Task 1 unit test and Task 3 e2e computed-style checks.
5. **Select-all in a large document.** No preview above the cap. Task 2 unit test.
6. **Eager bytes.** The editor group's file list is unchanged and its delta is reported. Task 4.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `extensions/action-preview/action-preview.ts`, `extensions/action-preview/index.ts` | Plugin (meta-only state, clear on change), the `setActionPreview` command, `PreviewAttrs` type | Create (eager) |
| `components/smart-toolbar/color/swatch-preview.ts` | Pure: `swatchPreviewAttrs`, `canPreview` (caret, node, read-only, cap); the `useSwatchPreview` hook (dwell, media gates, kill switch) | Create (lazy) |
| `components/smart-toolbar/color/color-panel.tsx` | Attach the hook to each swatch and to arrow keys; clear on unmount and when focus leaves the grid | Modify (D2 file, A6 grant) |
| `components/document-editor/document-editor-config.ts` | Register `ActionPreview` | Modify (one import, one entry) |
| `tests/unit/extensions/action-preview.test.ts`, `tests/unit/components/swatch-preview.test.tsx` | Unit tests | Create |
| `tests/e2e/action-preview.spec.ts` | e2e | Create |
| `docs/superpowers/specs/2026-11-13-smart-toolbar-v1-contract.md` | Amendment A14: the D2 file hunk, the new extension, measured bytes | Modify |
| `CHANGELOG.md`, `README.md` (feature line and env row), `tests/TESTING.md`, `AGENTS.md` | Docs | Modify |

---

### Task 1: The preview plugin and its invariants

**Files:**
- Create: `extensions/action-preview/action-preview.ts`, `extensions/action-preview/index.ts`
- Modify: `components/document-editor/document-editor-config.ts`
- Test: `tests/unit/extensions/action-preview.test.ts`

**Interfaces:**
- Produces:
  ```ts
  /** Attributes for one Decoration.inline over each selection range. */
  export type PreviewAttrs = Readonly<Record<string, string>>;
  export const actionPreviewKey: PluginKey<DecorationSet>;
  export const ActionPreview: Extension;
  // Command (module augmentation): attrs show, null clears; meta-only,
  // addToHistory false; no dispatch when clearing with nothing shown.
  editor.commands.setActionPreview(attrs: PreviewAttrs | null): boolean;
  ```
- **`apply`:**
  - The meta replaces the set: attributes build one inline decoration per selection range, and `null` empties it.
  - Otherwise, when nothing is shown, it returns `prev` at once.
  - Otherwise, `tr.docChanged || tr.selectionSet` empties it, and anything else returns `prev`.
- **`props.decorations`** returns the set.

- [ ] **Step 1: Write the failing tests**

```ts
it("decorates each selection range with the attributes", () => {});
it("is meta-only: 0 Yjs updates and 0 undo entries for show and clear", () => {});
it("does not bump the toolbar version store", () => {});
it("clears on a local doc change and a selection change", () => {});
it("redraws on the new selection after a remote doc change", () => {});
it("keeps the preview across a transaction that changes neither", () => {});
it("previews each range of a CellSelection", () => {});
it("nests inside an existing mark: the preview renders inside span[data-text-color='blue']", () => {});
it("copy while previewing serializes no preview attributes", () => {});
it("apply returns the same state object for a typing transaction with nothing shown", () => {});
it("clearing with nothing shown dispatches nothing", () => {});
```

- [ ] **Step 2: Run them and confirm they fail.** `bun test tests/unit/extensions/action-preview.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and confirm they pass.**
- [ ] **Step 5: Commit:** `feat(editor): add a decoration-only action preview`

---

### Task 2: Swatch mapping, gates and the hook

**Files:**
- Create: `components/smart-toolbar/color/swatch-preview.ts`
- Test: `tests/unit/components/swatch-preview.test.tsx`

**Interfaces:**
- `swatchPreviewAttrs(swatch: Swatch): PreviewAttrs | null`
  - text + token → `{ "data-text-color": token, class: "tt-preview", style: "background-color: transparent" }` (rendered as a `span`).
  - highlight + token → `{ nodeName: "mark", "data-highlight": token, class: "tt-preview", style: "background-color: var(--tt-color-highlight-<token>)" }`.
  - text, no token → `{ class: "tt-preview", style: "color: var(--foreground); background-color: transparent" }`.
  - highlight, no token → `{ class: "tt-preview", style: "background-color: var(--background)" }`.
  - An invalid token → `null` (render-time enforcement, spec §3).
- `canPreview(editor): boolean`: editable, a non-empty selection that is not a node selection, at most `PREVIEW_MAX_BLOCKS = 200` top-level blocks and `PREVIEW_MAX_POSITIONS = 20_000` positions.
- `useSwatchPreview(editor): { hover(event, swatch | null), leave(), show(swatch | null), clear() }`
  - Off when `NEXT_PUBLIC_ACTION_PREVIEW=0`, without `(hover: hover) and (pointer: fine)`, or in forced colours. All read once at mount.
  - `hover`: only `pointerType` `mouse` or `pen`; shows after `PREVIEW_DWELL_MS = 80`.
  - `leave`: clears after the same delay, unless a hover or show takes over.
  - `show` (arrow keys): at once, or after the dwell for a repeated key (`event.repeat`), so holding an arrow does not flash a large selection (WCAG 2.3.1, UX review). `clear`: at once. Unmount clears and cancels the timer.
  - A `null` swatch (the kind cannot apply here) clears instead.

- [ ] **Step 1: Write the failing tests**

```ts
it("maps each swatch to the real mark's data attribute", () => {});
it("returns null for invalid tokens", () => {});
it("refuses a caret, a node selection, a read-only editor and selections above the cap", () => {});
it("NEXT_PUBLIC_ACTION_PREVIEW=0 disables it", async () => {}); // importFresh
it("is off without a fine hovering pointer and in forced colours", () => {});
it("touch pointerType never shows; mouse shows after 80 ms; show is immediate", () => {});
it("leaving clears after the dwell unless another swatch takes over", () => {});
it("unmount clears the preview and cancels the timer", () => {});
```

- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and confirm they pass.**
- [ ] **Step 5: Commit:** `feat(color): preview colour swatches on hover and arrow keys` (with Task 3)

---

### Task 3: Swatch integration

**Files:**
- Modify: `components/smart-toolbar/color/color-panel.tsx`
- Test: `tests/e2e/action-preview.spec.ts`

**Integration:**
- Each swatch gets `onPointerEnter` → `hover(event, applicable)` and `onPointerLeave` → `leave()`. The existing `onFocus` (roving `setActive`) and `onMouseDown` (`preventDefault`) stay as they are.
- `onKeyDown`: after an arrow, Home or End moves focus, `show(next swatch)`.
- The grid's `onBlur`: focus leaving the grid clears.
- A swatch whose kind has a reason passes `null`.
- No CSS: no transition and no outline (Decision 2).

- [ ] **Step 1: Write the failing e2e**

```ts
test("hovering Red previews it on the selection; leaving restores the text; the doc is unchanged", async ({ page }) => {});
test("opening with the keyboard previews nothing; arrows preview; Esc clears and returns focus", async ({ page }) => {});
test("applying replaces the preview with the real mark: one undo step, as before", async ({ page }) => {});
test("red over blue and 'No highlight' over yellow show the previewed result", async ({ page }) => {});
test("the bubble stays open while previewing from its popover", async ({ page }) => {});
test("the toolbar does not re-render while previewing", async ({ page }) => {}); // countToolbarCommit
test("touch: no preview; a tap applies as before", async ({ browser }) => {}); // pointer: coarse first
```

- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them, plus `toolbar*.spec.ts`, `text-style-marks.spec.ts`, `selection-bubble.spec.ts`, `lazy-surfaces.spec.ts` and the axe specs (`toolbar-a11y*.spec.ts`).**
- [ ] **Step 5: Commit** with Task 2.

---

### Task 4: Budgets, design review, amendment and docs

- [ ] **Step 1: Measure.** `bun run build && bun scripts/check-editor-chunk-size.ts`. Record the eager delta against 394,567 B, confirm the group's file list is the base's ten files, the palette chunks are byte-identical, and the colour-panel chunk delta.
- [ ] **Step 2: Design gate.** Screenshots at 1440 and 375 px, light and dark: a preview on text, keyboard focus on a swatch, the popover. A UI designer and a UX designer review them; fix their blockers.
- [ ] **Step 3: Write the amendment and docs.** The CHANGELOG says "no schema or protocol change" and needs no Deploy note.
- [ ] **Step 4: Run the full verification**

```bash
bun audit --audit-level=high && bun run check && bun run lint && bun run typecheck && bun run test && bun run build
bun scripts/check-editor-chunk-size.ts
CI= E2E_BASE_URL=http://localhost:6210 bun playwright test tests/e2e/action-preview.spec.ts tests/e2e/toolbar*.spec.ts tests/e2e/text-style-marks.spec.ts tests/e2e/selection-bubble.spec.ts tests/e2e/lazy-surfaces.spec.ts --project=chromium
```

- [ ] **Step 5: Commit:** `docs: record the hover preview as contract amendment A14`

---

## Test plan (summary)

| Layer | What | Where |
|---|---|---|
| Unit | Meta-only invariants (0 Yjs updates, 0 undo, no toolbar notify), clearing rules, CellSelection, nesting, clipboard, hot path | `action-preview.test.ts` |
| Unit | Mapping, token validation, refusals and cap, kill switch, media and forced-colours gates, pointer type, dwell, unmount | `swatch-preview.test.tsx` |
| e2e | Hover, keyboard (no preview on open), Esc, apply, nesting, bubble survival, 0 toolbar commits | `action-preview.spec.ts` |
| e2e touch | `pointer: coarse` first, no preview, tap still applies | `action-preview.spec.ts` |
| e2e | axe with the popover open (existing specs) | `toolbar-a11y*.spec.ts` |
| size | Eager < 1,000 B, file list unchanged; palette unchanged; colour chunk ≤ +1 KB gz | `check-editor-chunk-size.ts`, production build |

## Acceptance criteria

- Hovering a colour or highlight swatch with a mouse, or arrowing to one, previews it on the selection. Touch, forced colours, read-only, caret and node selections show nothing, and opening the popover shows nothing.
- A preview never writes: 0 Yjs updates, 0 undo entries, 0 toolbar commits, and the clipboard is clean. It clears on any doc or selection change, Esc, close and unmount.
- The bubble stays open while previewing from its popover. Focus is never dropped. axe reports 0 serious issues.
- No schema or protocol change: `tests/fixtures/schema-snapshot.json`, `lib/schema-names.ts`, Hocus and `contract.test.ts` are unchanged.
- The eager delta is < 1,000 B and reported, the group's file list is unchanged, the palette is unchanged, and the colour chunk grows ≤ 1 KB gz.
- The UI and UX design reviews passed on screenshots at 1440 and 375 px, light and dark.
- The amendment, CHANGELOG, README (feature and env row), TESTING and AGENTS entries are written.

## Risks

| Risk | Mitigation |
|---|---|
| A meta-only transaction trips the bubble's hide rules | Review Focus 2 and its e2e. `bubble-rules.ts` keys its hides off keystrokes and selection changes, not meta transactions. |
| A lazy import splits a shared module into the editor group | The lazy side calls a command and imports nothing new that is shared. Task 4 checks the file list, not just the size. |
| Decoration nesting differs for text that already has decorations (fold, filter, caret block, the blurred selection) | Those are node decorations, except `Selection`'s inline one (Decision 8). The Task 1 nesting test covers marks; screenshots cover the selection. |
| Users mistake the preview for an applied change in a shared document | Decision 2 (overrulable: a dotted outline). The popover stays open while previewing, and closing it clears the preview. |
| A large selection redraws slowly | The 200-block and 20,000-position caps, plus the 80 ms dwell. |

## Self-review

1. **Spec coverage:** "decorations only" → Task 1 invariants. "Also on keyboard focus" → Task 3 arrow keys. "Off on touch" → Task 2 media and `pointerType` gates. §4.5 O3/O4 behaviours preserved → Task 3 e2e. §6 focus and forced colours → Tasks 2 and 3. §7 typing and bundle → Task 4. Design pass §1 (bubble), §5 (no pill), §11 (low contrast) → the refresh notes and the accessibility section.
2. **Schema and protocol:** none, stated.
3. **Type consistency:** `PreviewAttrs` (Task 1) is used in Task 2.
4. **Review Focus:** each item names its test, in Tasks 1–4.
