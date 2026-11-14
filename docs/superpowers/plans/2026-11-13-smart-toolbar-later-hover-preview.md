# Smart toolbar, later phase: hover preview, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a writer points at a text-colour or highlight swatch, or moves to one with the keyboard, the selected text shows that colour **before** they commit. Moving away, Esc, closing the popover, applying, or any change to the document or selection removes the preview. It is drawn with ProseMirror **decorations only**, so it never touches the document, Yjs, the undo stack, collaborators or the toolbar. It is off on touch (spec §8 item 6: "decorations only, also on keyboard focus, off on touch").

**Architecture:**
- **Eager, tiny:** an `ActionPreview` extension, registered once in the extensions array. Its plugin keeps a `DecorationSet` that only meta-only transactions set. Any doc or selection change clears it. It exposes `showActionPreview(editor, layers)` and `clearActionPreview(editor)`.
- **Lazy:** everything else lives in the colour-panel chunk that already exists (A9): the `PreviewLayer` builders (`lib/action-preview/preview-layers.ts`), the swatch hook (`useActionPreview`) and the preview CSS. The row popover, the bubble popover and the phone sheet all render `ColorPanel`, so one integration covers every surface. Touch is switched off by a media query.
- **Rendering:** an inline decoration with the same `data-*` attribute as the real mark (`span[data-text-color]`, `mark[data-highlight]`) is styled by the existing token CSS. ProseMirror renders inline decorations inside mark elements, so the preview wins over an existing colour. "Default" and "No highlight" use preview-only classes.

**Tech Stack:** Tiptap 3.33 / ProseMirror (`Decoration.inline`, `DecorationSet`), React 19, `bun test` (happy-dom), Playwright with `@axe-core/playwright`. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-12-smart-toolbar-design.md` §4.5 (colour popover, O3 dimming, O4 keyboard), §5 (memory changes what a button offers, never what you type: a preview writes nothing), §6, §7 and §8 item 6. Research: Word's live preview (sources, round 2).

**Base:** branch `feat/smart-toolbar-hover-preview` from `main` at or after `7abadc1`. Before Task 1, confirm:
- `git grep -n "export const loadColorPanel" components/smart-toolbar/lazy-surface.tsx`;
- `git grep -n "aria-pressed={pressed}" components/smart-toolbar/color/color-panel.tsx`;
- `git grep -n "function changesToolbarContext" hooks/use-tiptap-editor.ts` (meta-only transactions do not notify the toolbar).

**Effort:** M, about **4–5 engineer-days**: plugin and invariants 1.5, layers and the swatch hook 1, CSS and nesting 0.5, e2e (hover, keyboard, bubble, collaboration, touch) 1, budgets and docs 0.5–1. Optional Task 5 (size and Repeat face) adds 1–1.5 days.

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
- Before every commit, show a commit review report (files, diff summary, message) and wait for explicit approval.
- `CHANGELOG.md`: one sub-block for this PR under `## [Unreleased]`.

**Tests**
- `bun run test`: one process, happy-dom preload. `mock.module` spreads the real module and is followed by `await import()`. Env read at import time goes through `importFresh()` with `resetModules()` in `afterEach`.
- Playwright runs against **Next 3630 + Hocus 1730**. These ports are not taken by contract §5.4, D2 or E. Never test against tiny.docs.plus. Run `lsof` first and stop only what you started.

```bash
DOC_CREATION_RATE_LIMIT=2000 WS_CONNECTION_LIMIT=200 WS_SOCKETS_PER_IP=600 WS_UPGRADE_RATE_LIMIT=6000 \
  HOCUS_THROTTLE=0 MAX_TOTAL_DOCUMENTS=1000000 HOCUS_PORT=1730 DB_PATH="$TMPDIR/tinydocy-preview.sqlite" \
  HOCUS_ALLOW_ISOLATED_TABS_DOCS=1 bun run hocus
NEXT_PUBLIC_HOCUS_URL=ws://127.0.0.1:1730 DB_PATH="$TMPDIR/tinydocy-preview.sqlite" bun next dev -p 3630
CI= E2E_BASE_URL=http://localhost:3630 E2E_HOCUS_URL=ws://127.0.0.1:1730 bun playwright test <spec> --project=chromium
```

- Touch e2e: `test.use({ hasTouch: true, isMobile: true })`, first assertion `matchMedia("(pointer: coarse)").matches === true`.

**Code rules**
- **Never call `editor.registerPlugin` from a lazy chunk.** prosemirror-view's `updatePluginViews` destroys and re-creates every plugin view when the plugin set changes, including y-sync, collaboration carets, fold, the TOC and the bubble. The preview plugin is in the extensions array from the start.
- Preview transactions are **meta-only**: no steps, no `setSelection`, no stored marks, `addToHistory: false`. That is what keeps them out of Yjs (the y-sync view skips updates without a doc change), out of the undo stack, and out of the toolbar version store (`changesToolbarContext`).
- Never subscribe the editor shell to editor state. Never rebuild the extensions array or `EDITOR_PROPS`.
- A lazy chunk never imports row modules (A9 split cost).

**Contract rules**
- No frozen file is touched.
- `components/smart-toolbar/color/color-panel.tsx` is a D2 file (§5.1). The edit falls under the A6 owner grant ("tracks may edit the files their scope names") and is listed in this plan's amendment (next free A-number at merge).
- `document-editor-config.ts` is shared and append-only.
- No action id, prefix, group, `UiIntent` or memory slot is added, so `contract.test.ts` is unchanged.

## Schema and protocol

**None. This plan needs no schema change and no protocol change.**
- Decorations are view state. Nothing is written to the Y.Doc, so `lib/schema-names.ts`, `tests/fixtures/schema-snapshot.json`, the Hocus ingress guard and the gate are untouched.
- Collaborators never see another writer's preview: there is no awareness field and no message.

## Budgets

**Editor chunk (`scripts/check-editor-chunk-size.ts`, gz).** The script sums every file the editor's loader lists, **CSS included**. A production build of E's tip lists three `.css` files in the group, 14,467 B gz. The A12 budget is 24,064 B. A8 measured +23,423 B at E's tip (`4fcba67`), so about **641 B** were left. A build of `7abadc1` with uncommitted follow-up changes measured +23,757 B (307 B left), so the real figure on `main` must be measured first. The four later-phase plans share what is left:

| Plan | Eager allocation | What is eager | Lazy |
|---|---|---|---|
| M15 Continue where you left off | 150 B | one lazy loader and its idle mount | continue chunk ≤ 3 KB gz |
| "/" menu | 280 B | trigger plugin, host, one lazy loader | slash chunk ≤ 6 KB gz |
| **Hover preview (this plan)** | **160 B** | the decoration plugin plus `showActionPreview` / `clearActionPreview` | ≤ +1 KB gz on the colour-panel chunk |
| Progressive-disclosure toggle | 150 B | one registry action, the ⋯ checkbox item, one attribute, the simplified CSS rules | none |
| **Total** | **740 B** | | |

**This is more than the headroom, and Turbopack's split cost comes on top.**
- A lazy chunk that imports modules the editor chunk also uses makes Turbopack split those modules into separate, less compressible editor-group files. A8 measured about 344 B for the palette chunk and about 968 B for the split button inside the bubble chunk.
- The continue chunk (`relative-range.ts`, the fold and filter plugin keys, `remembered-choice`, `hocuspocus`) and the slash chunk (registry, snapshot, memory) both import such modules.
- The trim has landed (contract A13, menu bodies lazy): the editor chunk measured +16,512 B of the 23.5 KB budget, 7,552 B of headroom. Measure each plan against it; a new owner amendment is needed only if they outgrow it. The palette (A7) has 36 B left.
- No plan raises the constant itself. Going over this plan's 160 B needs a trim or the owner's amendment.

Measure the base (`bun run build && bun scripts/check-editor-chunk-size.ts`) before Task 1. The preview CSS is imported by the lazy colour-panel chunk, so it is not in the editor group.

**Colour-panel chunk:** grows by ≤ 1 KB gz (layers, hook and CSS). Measured on a production build before and after.

**Performance:**
- Typing p95 is unchanged (≤ +10% and ≤ +16 ms, `--project=perf`). On a typing transaction the plugin's `apply` returns `prev` at once when no preview is shown.
- Show or clear: ≤ 4 ms p95 for a 2,000-character selection in a 500-heading document (decoration build plus ProseMirror redraw of the touched nodes).
- **Cap:** no preview when the selection spans more than 200 top-level blocks or 20,000 characters. Select-all in a 500-heading document previews nothing and costs nothing.
- **Dwell:** a pointer must rest 80 ms on a swatch before its preview shows, so sweeping across the 21-swatch grid dispatches at most one preview per resting point. Keyboard focus shows at once.
- **0 toolbar commits** per preview (meta-only). **0 Yjs updates** and **0 undo entries** per preview.
- Listeners and heap return to baseline after 100 popover open, preview and close cycles (heap within 5%).

## Accessibility requirements (WCAG 2.2 AA)

- **Keyboard parity:** a preview shows when a swatch receives keyboard focus (`:focus-visible`), through the panel's 2-D roving grid (O4: arrows move without applying). Enter applies, as before.
- **No change of context (3.2.1, 3.2.2):** a preview changes neither content nor focus nor selection. `aria-pressed` keeps reflecting the **applied** colour, never the previewed one.
- **Nothing to announce:** the swatch's own name ("Red", "Low contrast" per O3) is what the screen reader hears. A preview adds no live region.
- **Dismissible:** Esc clears the preview and closes the popover with focus on its trigger (O4). Leaving the grid with the pointer or focus clears it.
- **Focus is never dropped.** The preview never moves focus. Closing the popover by any path returns focus to its trigger (bubble or row) as today.
- **Forced colours:** off. Forced colours override text and background colours, so a preview would show nothing.
- **Touch:** off (`(hover: hover) and (pointer: fine)` must match, and `pointerType` must be `"mouse"` or `"pen"`). No new targets are added, so the 44 px rule is unaffected.
- **Reduced motion:** the preview appears and disappears instantly, with no transition.
- **Contrast:** a preview shows the real token colours, which already meet spec §3 / Appendix A. Low-contrast highlight pairs (O3) preview honestly, and their swatch keeps its "Low contrast" description.

## Upstream interfaces (as on `main` at `7abadc1`)

| # | Name | Where | Used for |
|---|---|---|---|
| U1 | `ColorPanel` swatches: `<button aria-pressed onFocus onMouseDown>` in a roving grid | `components/smart-toolbar/color/color-panel.tsx` | where the hook attaches |
| U2 | `loadColorPanel`, `lazySurface` | `components/smart-toolbar/lazy-surface.tsx` | the chunk the preview code joins |
| U3 | `isCoarsePointer()` | `components/smart-toolbar/coarse-pointer.ts` | touch check at mount (plus the per-event `pointerType`) |
| U4 | `useActionView(id, editor)` → `enabled` | `hooks/use-editor-context.ts` | no preview for an action that cannot run |
| U5 | `TEXT_COLOR_ATTR`, `HIGHLIGHT_ATTR`, `FONT_SIZE_ATTR`, `isTextColorToken`, `isFontSizeToken` | `lib/text-style-tokens.ts` | layer attributes, validated tokens only |
| U6 | `.tiptap span[data-text-color=…]`, `.tiptap mark[data-highlight=…]`, `.tiptap span[data-font-size=…]` | `extensions/text-style-marks/text-style-marks.scss`, `components/document-editor/document-editor.scss` | the existing token CSS a decoration reuses |
| U7 | `changesToolbarContext` / `getEditorVersionStore` | `hooks/use-tiptap-editor.ts` | proving 0 toolbar commits |
| U8 | `createCollabEditor` | `tests/helpers/collab-editor.ts` | proving 0 Yjs updates and 0 undo entries |
| U9 | `SelectionBubbleView`, the hide rules | `components/smart-toolbar/bubble/selection-bubble-view.tsx`, `bubble/bubble-rules.ts` | the bubble stays open while previewing from its popover |
| U10 | `CHUNK_MARKERS.colorPanel`, `interceptChunk`; `listenerCounts` (inline in `palette-leaks.spec.ts`) | `tests/e2e/helpers/lazy-chunk.ts` | lazy proof; leak helper extracted to `tests/e2e/helpers/leak-metrics.ts` if missing |

## Decisions on spec ambiguities (owner can overrule)

1. **Scope:** text-colour and highlight swatches (including Recent, "Default" and "No highlight") in every `ColorPanel`. Optional Task 5 adds font-size steps and the Repeat face, but only if the measured eager delta leaves room. The **style menu (headings) is out**: a node change reflows the page under the pointer, and heading sizes come from `heading-scale`, which decorations would have to copy.
2. **No marker on the previewed text.** A preview shows exactly what Apply will produce, as in Word. The pressed swatch and the open popover say nothing is applied yet.
3. **Clear on any change, never map.** Any doc change (local or remote) or selection change clears the preview. Mapping a preview through a collaborator's edit could leave it on the wrong text, so it is cleared and the next hover re-shows it.
4. **Caret, node and cell selections:** no preview for a caret (nothing visible to colour) or a node selection. A `CellSelection` previews each range (`selection.ranges`).
5. **Read-only and unavailable:** no preview when the editor is not editable or the swatch's action is unavailable (in code, inline code, the title for size).
6. **Kill switch:** `NEXT_PUBLIC_ACTION_PREVIEW=0` disables previews. It is read in the lazy chunk (0 eager bytes) and listed in README's env table, following AGENTS.md's discoverable `NEXT_PUBLIC_*`/`UPPER_SNAKE` rule.
7. **"Default" and "No highlight" previews:**
   - `tt-preview--text-default` sets `color: var(--foreground)`, which overrides an outer coloured span.
   - `tt-preview--highlight-none` sets `background-color: var(--background)` on the inner span, which covers an outer highlight on the page background.
   - Inside table header cells and other tinted backgrounds the cover can differ slightly. That is accepted, because the real Apply is one click away and undoable.

## Not in scope

- Previewing heading levels, alignment, lists or Insert kinds.
- Showing previews to collaborators.
- Hover previews on touch, or a long-press equivalent.
- Document styles (M14b); see the "/" menu plan's "Not in scope".

## Review Focus

1. **Zero writes.** A preview cycle produces 0 Yjs updates, 0 undo entries and 0 toolbar commits, and copying while previewing copies no preview. Task 1 unit tests.
2. **The bubble survives previewing from its own popover.** Meta-only transactions must not trip `bubble-rules.ts`'s hide rules or the bubble's `shouldShow`. Task 3 e2e "bubble stays open while previewing".
3. **Remote edits while previewing.** A collaborator typing inside the previewed range clears the preview, and nothing is left on the wrong text. Task 1 unit test and Task 3 e2e.
4. **Nesting over existing marks.** Previewing red over blue text, and "No highlight" over yellow, show the previewed result. Task 2 unit test and Task 3 e2e computed-style checks.
5. **Select-all in a large document.** No preview above the cap, and no jank while the pointer sweeps the grid. Task 4 perf assertion.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `extensions/action-preview/action-preview.ts`, `extensions/action-preview/index.ts` | Plugin (meta-only state, clear on change), `showActionPreview`, `clearActionPreview`, `PreviewLayer` type | Create |
| `lib/action-preview/preview-layers.ts` | Pure: layers for `color.text.*`, `color.highlight.*` (and `size.set` in Task 5); caps | Create (lazy) |
| `components/smart-toolbar/color/use-action-preview.ts`, `components/smart-toolbar/color/action-preview.scss` | Swatch handlers (dwell, focus-visible, media gates, kill switch); preview classes | Create (lazy) |
| `components/smart-toolbar/color/color-panel.tsx` | Attach the handlers to each swatch; clear on unmount | Modify (D2 file, A6 grant) |
| `components/document-editor/document-editor-config.ts` | Append `ActionPreview` | Modify (append-only) |
| `components/smart-toolbar/repeat-split-button.tsx`, `font-size-stepper.tsx` | Optional Task 5 | Modify (E and D2 files, A6 grant) |
| `tests/unit/extensions/action-preview.test.ts`, `tests/unit/lib/preview-layers.test.ts`, `tests/unit/components/use-action-preview.test.tsx` | Unit tests | Create |
| `tests/e2e/action-preview.spec.ts`, `tests/e2e/helpers/leak-metrics.ts` | e2e; leak helper if missing | Create |
| `docs/superpowers/specs/2026-11-13-smart-toolbar-v1-contract.md` | Amendment: the D2 file hunk, the new extension, measured bytes | Modify |
| `CHANGELOG.md`, `README.md` (feature line and env row), `tests/TESTING.md`, `AGENTS.md` | Docs | Modify |

---

### Task 1: The preview plugin and its invariants

**Files:**
- Create: `extensions/action-preview/action-preview.ts`, `extensions/action-preview/index.ts`
- Modify: `components/document-editor/document-editor-config.ts` (append `ActionPreview`)
- Test: `tests/unit/extensions/action-preview.test.ts`

**Interfaces:**
- Produces:
  ```ts
  /** One wrapping layer: attributes for one Decoration.inline (nodeName allowed: "span" | "mark"). */
  export type PreviewLayer = Readonly<Record<string, string>>;
  export const actionPreviewKey: PluginKey<DecorationSet>;
  export const ActionPreview: Extension;
  /** Meta-only; no-op when not editable, for a caret or a node selection, or above the cap. Returns whether it showed. */
  export function showActionPreview(editor: Editor, layers: readonly PreviewLayer[]): boolean;
  export function clearActionPreview(editor: Editor): void;   // no dispatch when nothing is shown
  export const PREVIEW_MAX_BLOCKS = 200;
  export const PREVIEW_MAX_CHARS = 20_000;
  ```
- **`apply`:**
  - The meta `{ show: DecorationSet }` replaces the set, and `{ clear: true }` empties it.
  - Otherwise, `tr.docChanged || tr.selectionSet` empties it.
  - Otherwise it returns `prev` (the same object).
- **`props.decorations`** returns the set.
- Every layer gets `class` `tt-preview` added. A `nodeName` other than `span` or `mark` is refused.

- [ ] **Step 1: Write the failing tests**

```ts
it("shows one inline decoration per layer over each selection range", () => {});
it("is meta-only: 0 Yjs updates and 0 undo entries for show and clear", () => {
  // createCollabEditor; ydoc.on("update", spy); undoManager.undoStack.length unchanged
});
it("does not bump the toolbar version store", () => { /* getEditorVersionStore(editor).subscribe(spy) */ });
it("clears on a local doc change, a remote doc change and a selection change", () => {});
it("refuses a caret, a node selection, a read-only editor, and selections above the cap", () => {});
it("previews each range of a CellSelection", () => {});
it("copy while previewing serializes no preview attributes", () => {
  // view.serializeForClipboard(selection.content()) has no data-* from the preview
});
it("refuses unknown nodeName values", () => {});
it("apply returns the same state object for a typing transaction with nothing shown", () => {});
```

- [ ] **Step 2: Run them and confirm they fail.** Run: `bun test tests/unit/extensions/action-preview.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run them and confirm they pass.** Expected: PASS.

- [ ] **Step 5: Commit** after approval: `feat(editor): add a decoration-only action preview`

---

### Task 2: Layers and preview CSS

**Files:**
- Create: `lib/action-preview/preview-layers.ts`, `components/smart-toolbar/color/action-preview.scss`
- Test: `tests/unit/lib/preview-layers.test.ts`

**Interfaces:**
- Produces: `previewLayers(actionId: string, arg: unknown): readonly PreviewLayer[] | null`
  - `color.text.apply` + a valid token → `[{ "data-text-color": token }]`.
  - `color.highlight.apply` + a valid token → `[{ nodeName: "mark", "data-highlight": token }]`.
  - `color.text.unset` → `[{ class: "tt-preview--text-default" }]`.
  - `color.highlight.unset` → `[{ class: "tt-preview--highlight-none" }]`.
  - An invalid token or an unknown id → `null`.
- **CSS:** `.tiptap .tt-preview--text-default { color: var(--foreground); }` and `.tiptap .tt-preview--highlight-none { background-color: var(--background); }`. `.tt-preview` has no transition and no outline (Decision 2).

- [ ] **Step 1: Write the failing tests**

```ts
it("maps each colour action to the real mark's data attribute", () => {});
it("returns null for invalid tokens and unknown ids (render-time enforcement, spec §3)", () => {});
it("nests inside an existing mark: the decoration span renders inside span[data-text-color='blue']", () => {
  // createTestEditor, blue text, showActionPreview(red) -> innermost element of the text has data-text-color="red"
});
```

- [ ] **Step 2: Run them and confirm they fail.** Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run them and confirm they pass.** Expected: PASS.

- [ ] **Step 5: Commit** after approval: `feat(color): build preview layers for colour actions`

---

### Task 3: Swatch integration

**Files:**
- Create: `components/smart-toolbar/color/use-action-preview.ts`
- Modify: `components/smart-toolbar/color/color-panel.tsx`
- Test: `tests/unit/components/use-action-preview.test.tsx`, `tests/e2e/action-preview.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export function useActionPreview(editor: Editor | null): {
    enabled: boolean;                        // media gates, not forced colours, kill switch, editable
    bind(actionId: string, arg: unknown): {   // spread onto a swatch <button>
      onPointerEnter(e: PointerEvent): void; onPointerLeave(): void;
      onFocus(e: FocusEvent): void; onBlur(): void;
    };
  };
  ```
- **Pointer:** only `pointerType` `mouse` or `pen`; show after `PREVIEW_DWELL_MS = 80`; leaving clears unless another swatch takes over within the same frame.
- **Focus:** shows at once when the swatch matches `:focus-visible`. Blur to outside the grid clears.
- **The panel:**
  - It clears on unmount and on Esc.
  - It skips swatches whose action view is not enabled.
  - Its existing `onFocus` (roving `setActive`) and `onMouseDown` (`preventDefault`) stay first.
- The media queries are read once at mount, as `isCoarsePointer()` already is.

- [ ] **Step 1: Write the failing tests**

```ts
// use-action-preview.test.tsx (importFresh for the env)
it("NEXT_PUBLIC_ACTION_PREVIEW=0 disables it", async () => {});
it("disabled without (hover: hover) and (pointer: fine), in forced colours, or read-only", () => {});
it("touch pointerType never shows; mouse shows after 80 ms; focus-visible shows at once", () => {});
```

```ts
// action-preview.spec.ts
test("hovering Red previews it on the selection; leaving restores the text", async ({ page }) => {
  // computed color of the selected text === the red token, then back to the original; doc JSON unchanged
});
test("arrow keys preview the focused swatch; Esc clears and returns focus to the trigger", async ({ page }) => {});
test("applying replaces the preview with the real mark: one undo step, as before", async ({ page }) => {});
test("previewing red over blue and 'No highlight' over yellow shows the previewed result", async ({ page }) => {});
test("bubble stays open while previewing from its popover", async ({ page }) => {});
test("a collaborator typing inside the range clears the preview; they never see it", async ({ browser }) => {});
test("no preview in read-only, inside code, for a caret, or in forced colours", async ({ page }) => {});
test("touch: no preview", async ({ browser }) => { /* pointer: coarse first; tap Red applies as before */ });
test("the toolbar does not re-render while previewing", async ({ page }) => {
  // countToolbarCommit hook (toolbar-test-hooks.ts): 0 commits across 10 previews
});
```

- [ ] **Step 2: Run them and confirm they fail.** Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run them, plus `toolbar-surfaces.spec.ts`, `selection-bubble.spec.ts` and `mobile-bar.spec.ts`.** Expected: PASS.

- [ ] **Step 5: Commit** after approval: `feat(color): preview colours on hover and keyboard focus`

---

### Task 4: Budgets, leaks, accessibility, kill switch, amendment and docs

**Files:**
- Modify: `tests/e2e/action-preview.spec.ts` (perf cap, leaks, axe), `docs/superpowers/specs/2026-11-13-smart-toolbar-v1-contract.md` (amendment), `CHANGELOG.md`, `README.md` (feature line; env row `NEXT_PUBLIC_ACTION_PREVIEW`), `tests/TESTING.md` (spec, ports 3630/1730), `AGENTS.md` (one line: the decoration-only preview, meta-only invariants, never `registerPlugin` lazily)
- Create: `tests/e2e/helpers/leak-metrics.ts` (if missing)

- [ ] **Step 1: Write the failing tests**

```ts
test("select-all in a 500-heading doc: no preview, and sweeping the grid keeps p95 frame time < 16 ms", async ({ page }) => {});
test("100 open/preview/close cycles return listeners to baseline and heap within 5%", async ({ page }) => {});
test("axe 0 serious with a preview shown, light and dark", async ({ page }) => {});
```

- [ ] **Step 2: Run them and confirm the new ones fail or are unwired.**

- [ ] **Step 3: Write the amendment and docs.** The CHANGELOG says "no schema or protocol change" and needs no Deploy note. A kill-switch build is only needed if the owner asks: the env is read in the lazy chunk, and Task 3's `use-action-preview.test.tsx` covers it through `importFresh()`.

- [ ] **Step 4: Run the full verification**

```bash
bun audit --audit-level=high && bun biome check . && bun run lint && bun run typecheck && bun run test && bun run build
bun scripts/check-editor-chunk-size.ts        # eager delta against this plan's 160 B; colour chunk delta from the build output
CI= E2E_BASE_URL=http://localhost:3630 bun playwright test --project=chromium --project=perf
CI= E2E_BASE_URL=http://localhost:3630 bun playwright test tests/e2e/action-preview.spec.ts --project=chromium --repeat-each=10 --workers=3
```

Expected: everything passes. Record the eager delta, the colour-chunk delta, typing p95, the show/clear timings and the leak numbers.

- [ ] **Step 5: Commit** after approval: `test(color): assert preview budgets, leaks and accessibility`

---

### Task 5 (optional, only if the measured eager delta leaves room): size steps and the Repeat face

**Files:**
- Modify: `lib/action-preview/preview-layers.ts` (`size.set` → `{ "data-font-size": step }`; `md` → `tt-preview--size-md`, the editor's base size), `components/smart-toolbar/font-size-stepper.tsx` (− and + preview the next step), `components/smart-toolbar/repeat-split-button.tsx` (the face previews the bundle: `strong`/`em`/`u`/`s` layers plus colour and size, read through `getV11Engine()` so the engine is not copied into another chunk, A8)
- Test: `tests/unit/lib/preview-layers.test.ts`, `tests/e2e/action-preview.spec.ts`

Run this task only if Task 4's measurement shows the stepper's handlers fit the remaining shared headroom. The Repeat face lives in the lazy bubble chunk and adds no eager code of its own. Re-measure anyway, because a module it shares with the editor can split (A8). A font-size preview reflows lines under the pointer, so check that the stepper stays put (the stepper is in the row, not the text).

- [ ] **Step 1: Write the failing tests** ("+ previews the next size", "the Repeat face previews its bundle; leaving restores").
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them, re-measure the eager delta, and confirm both pass.**
- [ ] **Step 5: Commit** after approval: `feat(toolbar): preview size steps and the Repeat face`

---

## Test plan (summary)

| Layer | What | Where |
|---|---|---|
| Unit | Meta-only invariants (0 Yjs updates, 0 undo, no toolbar notify), clearing rules, refusals, cap, CellSelection, clipboard, nodeName allowlist | `action-preview.test.ts` |
| Unit | Layer mapping, token validation, nesting inside existing marks | `preview-layers.test.ts` |
| Unit | Kill switch, media and forced-colours gates, pointer type, dwell, focus-visible | `use-action-preview.test.tsx` |
| e2e | Hover, keyboard, Esc, apply, nesting, bubble survival, remote clear, read-only/code/caret/forced colours, 0 toolbar commits | `action-preview.spec.ts` |
| e2e touch | `pointer: coarse` first, no preview, tap still applies | `action-preview.spec.ts` |
| e2e | Leaks after 100 cycles; axe light and dark | `action-preview.spec.ts` |
| perf | Typing p95 ≤ +10% and ≤ +16 ms; show/clear ≤ 4 ms; select-all cap | `--project=perf`, `action-preview.spec.ts` |
| size | Eager ≤ 160 B; colour chunk ≤ +1 KB gz | `check-editor-chunk-size.ts`, production build |

## Acceptance criteria

- Hovering or keyboard-focusing a colour or highlight swatch previews it on the selection with a mouse or keyboard. Touch, forced colours, read-only, caret and node selections show nothing.
- A preview never writes: 0 Yjs updates, 0 undo entries, 0 toolbar commits, and the clipboard is clean. It clears on any doc or selection change, Esc, close and unmount.
- The bubble stays open while previewing from its popover. Focus is never dropped. axe reports 0 serious issues.
- No schema or protocol change: `tests/fixtures/schema-snapshot.json`, `lib/schema-names.ts`, Hocus and `contract.test.ts` are unchanged.
- The eager delta is ≤ 160 B (or the owner recorded an amendment), the colour chunk grows ≤ 1 KB gz, and typing and leak budgets hold.
- The amendment, CHANGELOG, README (feature and env row), TESTING and AGENTS entries are written.

## Risks

| Risk | Mitigation |
|---|---|
| A meta-only transaction trips the bubble's hide rules | Review Focus 2 and its e2e. `bubble-rules.ts` keys its hides off keystrokes and selection changes, not meta transactions. Verified in Task 3. |
| Decoration nesting differs for text that already has decorations (fold, filter, caret block) | Those are node decorations; the preview is inline. The nesting test in Task 2 covers mark nesting. Spot-check a folded heading's neighbours. |
| Users mistake the preview for an applied change in a shared document | Decision 2 (overrulable: a dotted outline). The popover stays open while previewing, and closing it clears the preview. |
| A large selection redraws slowly | The 200-block and 20,000-character caps, plus the 80 ms dwell. Task 4 perf assertion. |
| Eager allocation overrun (shared 740 B against a headroom of 307–641 B, plus split costs) | Measure at Tasks 1 and 4. Task 5 runs only if bytes remain. |

## Self-review

1. **Spec coverage:** "decorations only" → Task 1 invariants. "Also on keyboard focus" → Task 3 focus-visible. "Off on touch" → Task 3 media and `pointerType` gates. §4.5 O3/O4 behaviours preserved → Task 3 e2e. §6 focus and forced colours → Tasks 3 and 4. §7 typing, leaks and bundle → Task 4.
2. **Schema and protocol:** none, stated.
3. **Type consistency:** `PreviewLayer` (Task 1) is used in Tasks 2, 3 and 5. `previewLayers` (Task 2) is used in Tasks 3 and 5.
4. **Review Focus:** each item names its test, in Tasks 1–4.
