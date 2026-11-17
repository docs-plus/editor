# Selection bubble and quick insert: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved bubble, quick-insert and "/" design in six phases (P0–P5), one PR per phase.

**Architecture:**
- The bubble stops registering a ProseMirror plugin. A lazy `BubbleController` listens to editor events and positions one reused root with `@floating-ui/dom`, keeping today's DOM contract.
- Every new surface reads labels, icons, shortcuts and reasons from `lib/editor-actions`, and lives in an existing lazy chunk: bubble, menus, colour, slash or phone.
- The eager editor chunk grows only where a step says so, and only by measured bytes.

**Tech stack:** Next.js 16, React 19, Tiptap 3.33, ProseMirror, Yjs, `@floating-ui/dom` 1.8, Base UI, Bun (`bun test` with happy-dom), Playwright.

**Spec:** [`docs/superpowers/specs/2026-11-17-bubble-and-quick-insert-design.md`](../specs/2026-11-17-bubble-and-quick-insert-design.md), approved by the owner on 2026-11-17 ("Approve as recommended"). Executors read the spec section each task cites.

## Global Constraints

- **Bun only:** `bun`, `bun run …`, `bun playwright …`; never npm, npx, yarn or pnpm. Run Playwright with `CI=` against running dev servers.
- **Commits:**
  - Conventional Commits, atomic, imperative mood.
  - **No AI, tool or Co-authored-by trailers.**
  - Each PR adds its CHANGELOG entry under Unreleased.
  - **Never rebase, force-push or merge.** Open the PR and report it.
- **Editor chunk:**
  - `bun run build && bun scripts/check-editor-chunk-size.ts` after merging `origin/main` (P2.2, #123, moves the fence by about +294 B).
  - Growth over ±16 B needs a D23 ledger amendment approved before merge.
  - Every new surface is lazy.
  - Never `registerPlugin` from a lazy chunk.
  - Never subscribe the editor shell to editor state. Toolbar re-renders go through `useTiptapEditor`'s shared store.
- **Off-limits until their PRs land:**
  - `components/document-editor/**` and the P2.2 area (#123);
  - `lib/platform/**`;
  - `hooks/use-yjs-document.ts` and `hooks/use-synced-tabs.ts`.
  - The highlight and link colour tokens (#114, merged) are fine now. Check `phone.scss` ownership with `git log -1 -- components/smart-toolbar/phone/phone.scss` before P4.
- **UI:**
  - shadcn/ui components and `lucide-react` icons through `lib/icons.tsx`, with RTL flips via `flipInRtl` there;
  - named exports; title-case acronyms in PascalCase names.
  - Targets are 28 px on a fine pointer and 44 px on a coarse one.
- **Copy:** one word per block type, "Text" (BQ11). Faces use H1–H6; menus and accessible names use "Heading 2".
- **Motion token (O10):** enter 120 ms (opacity, scale 0.98 → 1, `cubic-bezier(0.2,0,0,1)`); exit 80 ms (opacity only, linear); no animation under `prefers-reduced-motion` or `data-motion="reduce"`.
- **Verification:**
  - screenshots from headless Playwright (no visible windows on the owner's Mac), light and dark, LTR and RTL where the surface exists;
  - each visible phase gets the owner session's design review before merge.
- **Dev servers** for e2e: CI-like limits, `DOC_CREATION_RATE_LIMIT=2000 WS_CONNECTION_LIMIT=200 WS_SOCKETS_PER_IP=600 WS_UPGRADE_RATE_LIMIT=6000 HOCUS_THROTTLE=0`. Use ports other sessions don't hold (check with `lsof`). Next and Hocus share one `DB_PATH`.

## Review Focus

1. **Tab switch while the bubble is open.** The editor remounts (`key={activeTabId}`). The old controller must tear down once (StrictMode runs effects twice), and no root may stay in the old scroll container. **Test:** P0 Task 3, "tab switch with the bubble open leaves no root and no listeners".
2. **⌘A on a 500-heading document.** The anchor must be the first *visible* selected line, computed without laying out every `content-visibility`-skipped block, and the bubble must appear within one frame of the show delay. **Test:** P0 Task 3, "select all anchors to the first visible line".
3. **A remote edit deletes the selected text while the bubble or its colour menu is open.** It hides, and focus returns to the editor, never `body`. **Test:** P0 Task 3, "a collaborator deleting the selection hides the bubble" (it extends the existing collaboration helpers).
4. **IME composition.** No show, move or hide mid-composition; a re-check on `compositionend`. **Test:** P0 Task 2 (controller unit test with `view.composing` stubbed).
5. **Clicking 🔗 and pasting at once.** The selected text must survive. **Test:** P1 Task 6.

---

# Phase P0: the bubble without `registerPlugin` (BQ2, BQ3)

**Branch:** `feat/bubble-controller` from `origin/main`. **Visible change:** the anchor (BQ3) and whitespace-only hiding. Items are unchanged. A design review is needed.

### Task 1: Pure anchor helpers and the whitespace rule

**Files:**
- Modify: `components/smart-toolbar/bubble/bubble-rules.ts`
- Test: `tests/unit/components/selection-bubble-rules.test.ts`

**Interfaces:**
- Produces:
  - `firstLineRect(rects: readonly BubbleRect[], band: { top: number; bottom: number }): BubbleRect | null`;
  - `lastLineRect(rects: readonly BubbleRect[], band: { top: number; bottom: number }): BubbleRect | null`;
  - the `BUBBLE_LINE_SLACK = 2` export.
- `shouldShowBubble` now also returns `false` for a whitespace-only selection.

- [ ] **Step 1: Write the failing tests**

```ts
const r = (top: number, left: number, right: number, h = 20) => ({ top, bottom: top + h, left, right });
test("firstLineRect unions the rects on the first visible line", () => {
  const band = { top: 0, bottom: 1000 };
  expect(firstLineRect([r(100, 300, 500), r(101, 500, 520), r(130, 50, 400)], band))
    .toEqual({ top: 100, bottom: 121, left: 300, right: 520 });
});
test("firstLineRect skips lines above the band and zero-width rects", () => {
  expect(firstLineRect([r(-40, 0, 300), r(10, 40, 40), r(30, 60, 90)], { top: 0, bottom: 800 }))
    .toEqual({ top: 30, bottom: 50, left: 60, right: 90 });
});
test("firstLineRect is null when no line is in the band", () => {
  expect(firstLineRect([r(900, 0, 10)], { top: 0, bottom: 800 })).toBeNull();
});
test("lastLineRect unions the rects on the last visible line", () => {
  expect(lastLineRect([r(100, 300, 500), r(130, 50, 400), r(131, 400, 420)], { top: 0, bottom: 1000 }))
    .toEqual({ top: 130, bottom: 151, left: 50, right: 420 });
});
test("hidden for a whitespace-only selection", () => {
  // editor with "<p>a   b</p>", select the three spaces
  expect(shouldShowBubble(viewOf(editor), root, false)).toBe(false);
});
```

- [ ] **Step 2: Run the tests**

Run: `bun test tests/unit/components/selection-bubble-rules.test.ts`. Expected: FAIL, because `firstLineRect` is not exported.

- [ ] **Step 3: Implement the helpers in `bubble-rules.ts`**

- **Same line:** two rects are on one line when their tops differ by at most `BUBBLE_LINE_SLACK`.
- **Which rects count:** ignore rects with `right - left < 1`, and rects that don't intersect the band.
- **The result** is the bounding box of that line's rects.
- **In `shouldShowBubble`:** replace `doc.textBetween(from, to).length === 0` with `doc.textBetween(from, to).trim().length === 0`.

- [ ] **Step 4: Run the tests**

Run: `bun test tests/unit/components/selection-bubble-rules.test.ts`. Expected: PASS, including the existing cases.

- [ ] **Step 5: Commit**

```bash
git add components/smart-toolbar/bubble/bubble-rules.ts tests/unit/components/selection-bubble-rules.test.ts
git commit -m "feat(bubble): anchor helpers and hide on whitespace-only selections"
```

### Task 2: `BubbleController` (show, hide, position) and the anchor

**Files:**
- Create: `components/smart-toolbar/bubble/bubble-controller.ts`
- Create: `components/smart-toolbar/bubble/bubble-anchor.ts`
- Test: `tests/unit/components/bubble-controller.test.ts`

**Interfaces:**
- Consumes: `firstLineRect`, `lastLineRect` and `BubblePlacement` from Task 1.
- Produces:

```ts
// bubble-controller.ts
export const BUBBLE_SHOW_DELAY_MS = 250;   // Tiptap's updateDelay, kept
export const BUBBLE_RESIZE_DELAY_MS = 60;  // Tiptap's resizeDelay, kept
export interface BubbleHost {
  readonly root: HTMLElement;              // reused; appended on show, removed on hide
  shouldShow(): boolean;                   // the view's shouldShowBubble + suppression
  getReferenceRect(placement: BubblePlacement): DOMRect;
  onShow(): void; onHide(): void; onPosition(): void;
}
export interface BubbleController {
  readonly visible: boolean;
  update(): void;              // re-evaluate now (no delay)
  updatePosition(): void;
  hide(): void;
  setPlacement(placement: BubblePlacement): void;
  destroy(): void;             // idempotent
}
export function createBubbleController(editor: Editor, scrollTarget: HTMLElement, host: BubbleHost): BubbleController;

// bubble-anchor.ts
export function bubbleReferenceRect(view: EditorView, scrollTarget: HTMLElement, placement: BubblePlacement): DOMRect;
```

- [ ] **Step 1: Write the failing controller tests**

They use `createTestEditor` (`tests/helpers/create-test-editor.ts`), a `div` scroll target in `document.body`, a stub host whose `getReferenceRect` returns `new DOMRect(10, 10, 50, 20)`, and real timers with `await Bun.sleep(BUBBLE_SHOW_DELAY_MS + 50)`.

```ts
test("shows after the delay for a non-empty selection and appends the root", async () => { /* select 1..4 */
  expect(host.root.isConnected).toBe(false);
  await Bun.sleep(BUBBLE_SHOW_DELAY_MS + 50);
  expect(host.root.parentElement).toBe(scrollTarget); expect(onShow).toHaveBeenCalledTimes(1); });
test("hides synchronously on an empty selection and removes the root", async () => {
  /* shown, then setTextSelection(2) */ expect(host.root.isConnected).toBe(false); expect(onHide).toHaveBeenCalledTimes(1); });
test("typing with an empty selection never asks shouldShow", () => {
  editor.commands.insertContent("abc"); expect(shouldShow).not.toHaveBeenCalled(); });
test("no show while composing; shows after compositionend", async () => {
  Object.defineProperty(editor.view, "composing", { configurable: true, get: () => true });
  /* select; sleep */ expect(host.root.isConnected).toBe(false);
  Object.defineProperty(editor.view, "composing", { configurable: true, get: () => false });
  editor.view.dom.dispatchEvent(new Event("compositionend")); await Bun.sleep(BUBBLE_SHOW_DELAY_MS + 50);
  expect(host.root.isConnected).toBe(true); });
test("dragstart and contextmenu on the editor hide it", ...);
test("a pointer drag shows only after pointerup", ...);   // pointerdown on view.dom, select, sleep: hidden; pointerup: shows after delay
test("blur to outside hides; a mousedown inside the root keeps it", ...);
test("setEditable(false) hides it (update event)", ...);
test("destroy is idempotent and detaches every listener", () => {
  controller.destroy(); controller.destroy();
  /* select + sleep */ expect(host.root.isConnected).toBe(false); expect(onShow).not.toHaveBeenCalled(); });
```

- [ ] **Step 2: Run the tests**

Run: `bun test tests/unit/components/bubble-controller.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement `createBubbleController`**

These behaviours copy `node_modules/@tiptap/extension-bubble-menu/src/bubble-menu-plugin.ts`. Cite its line numbers in comments.

- **Transactions:** one `editor.on("transaction")` handler. It begins with `if (!visible && editor.state.selection.empty) return`.
  - A non-empty selection that changed (`!prev.selection.eq` or `!prev.doc.eq`) shows after `BUBBLE_SHOW_DELAY_MS`, with the timer reset on each change.
  - An empty selection, or `!host.shouldShow()`, hides **at once**.
  - It returns while `view.composing`.
- **Editor events:**
  - `editor.on("focus")`: re-evaluate in a `setTimeout` (plugin :459).
  - `editor.on("blur", { event })`: hide unless `preventHide` was set by a capture `mousedown` on `host.root`, `relatedTarget` is inside `host.root`, or it is `view.dom` (plugin :464-484).
  - `editor.on("update")`: hide when `!editor.isEditable`.
- **DOM events on `view.dom`:**
  - `dragstart` and `contextmenu` hide;
  - `compositionend` re-evaluates in a `setTimeout`;
  - `pointerdown` sets `dragging`, and `pointerup` clears it and re-evaluates. While `dragging`, never show.
- **Window:** `resize` repositions, debounced by `BUBBLE_RESIZE_DELAY_MS`.
- **`show()`:**
  - `scrollTarget.appendChild(host.root)`, then `host.onShow()`;
  - then `autoUpdate(reference, host.root, updatePosition, { ancestorScroll: false, elementResize: true })`, where `reference = { getBoundingClientRect: () => host.getReferenceRect(placement), contextElement: editor.view.dom }`.
- **`hide()`:** stop `autoUpdate`, `host.root.remove()` **synchronously**, then `host.onHide()`.
- **`updatePosition()`:**
  - `computePosition(reference, host.root, { strategy: "absolute", placement: placement === "top" ? "top" : "bottom", middleware: [offset(BUBBLE_OFFSET), shift({ padding: 8 }), hide()] })`;
  - on `hide.referenceHidden || hide.escaped`, set `style.visibility = "hidden"`; otherwise `visible`, `position`, `left`, `top`;
  - then `host.onPosition()`.
  - Ignore results after `destroy()` or when hidden.
- **Lifecycle:** keep controllers in a module `WeakMap<Editor, BubbleController>`. `destroy()` removes every listener and timer, calls `hide()`, and deletes its entry. A second call does nothing.

- [ ] **Step 4: Implement `bubbleReferenceRect` in `bubble-anchor.ts` (DOM; Task 3's e2e covers it)**

1. **The band:**
   - top: the sticky row's `getBoundingClientRect().bottom` (`':scope > [data-slot="toolbar"]'`), else the scroll target's top;
   - bottom: the scroll target's bottom.
2. **The start position:** `a = from`.
   - If `view.coordsAtPos(from).bottom < band.top`, use `view.posAtCoords({ left: view.dom.getBoundingClientRect().left + 1, top: band.top + 1 })?.pos`, clamped to `[from, to]`.
3. **The DOM range:** from `view.domAtPos(a)` to `view.domAtPos(Math.min(to, a + 300))`, then `firstLineRect([...range.getClientRects()], band)`.
4. **For `placement === "bottom"`:** use the range `[Math.max(from, b - 300), b]`, where `b` is `to`, or `view.posAtCoords` at `band.bottom - 1` when `to` is below the band. Then apply `lastLineRect`.
5. **Fallback:** if the helper returns null, or any step throws, return `posToDOMRect(view, from, to)` (`@tiptap/core`).

- [ ] **Step 5: Run the tests**

Run: `bun test tests/unit/components/bubble-controller.test.ts tests/unit/components/selection-bubble-rules.test.ts`. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/smart-toolbar/bubble/bubble-controller.ts components/smart-toolbar/bubble/bubble-anchor.ts tests/unit/components/bubble-controller.test.ts
git commit -m "feat(bubble): add a plugin-free bubble controller and line anchor"
```

### Task 3: Switch `SelectionBubbleView` to the controller

**Files:**
- Modify: `components/smart-toolbar/bubble/selection-bubble-view.tsx`
- Modify: `components/smart-toolbar/bubble/selection-bubble.scss`, only if the root's class or position rules move
- Test: `tests/e2e/selection-bubble.spec.ts` (new cases; every existing case must still pass)
- Modify: `docs/superpowers/specs/2026-11-13-smart-toolbar-v1-contract.md` §10 (amendment A18), `CHANGELOG.md`

**Interfaces:**
- Consumes: `createBubbleController`, `BubbleHost` and `bubbleReferenceRect` from Task 2.
- The DOM contract is unchanged:
  - the root has `className="st-bubble"`, `data-smart-bubble`, `data-state` and `data-placement`, and one `role="toolbar"` inside;
  - the root is a direct child of `.document-editor-wrapper` while shown, and absent otherwise.

- [ ] **Step 1: Write the failing e2e tests** (Chromium)

- **"mounting the bubble chunk registers no plugin":**
  - `holdChunk(page, CHUNK_MARKERS.bubble)`, then open the document.
  - Record `editor.state.plugins.length` and mark every `editor.view.pluginViews` entry in a `WeakSet`.
  - Release the chunk, `dragSelect`, and expect the bubble to be visible.
  - Then expect the plugin count to be unchanged and every current plugin view to be in the set.
- **"a selection starting on a wrapped second line anchors to that line":**
  - Use a heading followed by a long paragraph. Select from the start of the paragraph's **second visual line** for 12 characters.
  - Expect the bubble's horizontal centre within 2 px of that selection's centre, or clamped by 8 px to the page column.
  - Expect `bubble.bottom <= lineTop` and `bubble.bottom >= lineTop - 8 - bubble.height - 1`.
- **"select all anchors to the first visible line":** a 300-paragraph document scrolled to the middle, then ⌘A. Expect the bubble inside the viewport, within 60 px under the sticky row.
- **"a whitespace-only selection shows no bubble":** expect a count of 0.
- **"dragstart hides it":** `dispatchEvent('dragstart')` on `.tiptap`, then expect a count of 0.
- **"tab switch with the bubble open leaves no root and no listeners":**
  - Open the bubble, switch to Playground and back 5 times.
  - Expect `.document-editor-wrapper > [data-smart-bubble]` to have a count of 0 with an empty selection.
  - Expect the listener counts back at baseline, using the `editor-leak.spec.ts` helpers.
- **"a collaborator deleting the selection hides the bubble":**
  - A second page on the same document (`collaboration.spec.ts` helpers) deletes the selected paragraph.
  - Expect a count of 0, and `document.activeElement` is not `body`.

- [ ] **Step 2: Run the tests**

Run: `CI= bun playwright test tests/e2e/selection-bubble.spec.ts --project=chromium`. Expected: the new cases FAIL (the plugin is registered, and the anchor is the union rect); the old ones pass.

- [ ] **Step 3: Rewrite `BubbleView` on the controller**

1. **Remove** the `BubbleMenu` import, `BUBBLE_KEY`, `dispatchMeta` and the `requestAnimationFrame` re-append effect (lines 207–222).
2. **Create the root once:** `useState(() => { const el = document.createElement("div"); el.className = "st-bubble"; el.dataset.smartBubble = ""; el.dataset.state = "closed"; return el; })`. This chunk is client-only, so there is no hydration concern.
3. **Effect:** `const c = createBubbleController(editor, scrollTarget, host); return () => c.destroy();`. The `host` maps today's code:
   - `shouldShow` → `shouldShowBubble(view, root, suppressedRef.current)`;
   - `getReferenceRect` → `bubbleReferenceRect(view, scrollTarget, placementRef.current)`;
   - `onShow` and `onHide` → today's bodies;
   - `onPosition` → today's `place()`, which calls `controller.setPlacement(next)` instead of `updateOptions`.
4. **Replace** each `dispatchMeta("hide")` with `controller.hide()`, and each `dispatchMeta("updatePosition")` with `controller.updatePosition()`.
5. **`chooseBubblePlacement`** receives the **first-line** rect, from `bubbleReferenceRect(view, scrollTarget, "top")`, as `selection`.
6. **Render:** `createPortal(shown ? <Toolbar …/> : null, root)`. The children are exactly today's.
7. **Remove the old focus-out guard.** It reads `root.style.opacity === "0"` because of the plugin's hide; it is now unneeded, because `hide()` removes the root first and calls `onHide` after.
8. **Check** with `grep -rn "@tiptap/react/menus\|extension-bubble-menu" components lib extensions` that nothing else imports either module. If nothing does, the dependency stays installed, unused, and unimported.

- [ ] **Step 4: Run the bubble suites**

Run: `CI= bun playwright test tests/e2e/selection-bubble.spec.ts tests/e2e/lazy-surfaces.spec.ts tests/e2e/paint-format.spec.ts tests/e2e/toolbar-focus-guards.spec.ts tests/e2e/editor-leak.spec.ts --project=chromium`. Expected: all PASS.

Then run `bun run test`, `bun run typecheck`, `bun run check` and `bun run lint`. Expected: clean.

- [ ] **Step 5: Measure**

Merge `origin/main` first (no rebase). Then run `bun run build && bun scripts/check-editor-chunk-size.ts`. Expected: within the budget, and ≤ +16 B against `origin/main` built the same way.

For the bubble chunk: `for f in $(grep -l "st-bubble-panel" .next/static/chunks/*.js); do gzip -c $f | wc -c; done`, before and after. Expected: smaller. Record both in the PR.

- [ ] **Step 6: Screenshots and docs**

- **Screenshots:** headless Playwright, light and dark, of a two-line selection on (1) `main` and (2) the branch, plus RTL.
- **Contract:** add amendment A18 to the v1 contract §10. `BUBBLE_KEY` meta and the plugin are gone; the DOM contract is unchanged; the root is appended on show and removed on hide.
- **CHANGELOG:** add the entry.

- [ ] **Step 7: Commit, push, open the PR** (`feat(bubble): …`), and report it. Don't merge.

---

# Phase P1: bubble v2 (BQ1, BQ6, BQ10, BQ11, O1, O2, O3 slot, O7, O10)

**Branch:** `feat/bubble-v2` from `main` after P0 merges. Visible; needs a design review.

### Task 1: Block-type face

**Files:** create `components/smart-toolbar/bubble/style-face.ts`; test `tests/unit/components/style-face.test.ts`.

**Interfaces:**
- Produces: `type StyleFace = "Text" | "H1" | "H2" | "H3" | "H4" | "H5" | "H6" | "Title" | "List" | "Quote" | "Code" | "Mixed"`.
- Produces: `styleFace(state: EditorState): StyleFace`, which walks the top-level blocks the selection touches and **returns at the second distinct type**.

**Tests:**
- paragraph → `"Text"`; H2 → `"H2"`; first H1 → `"Title"`;
- a bullet, ordered or task item → `"List"`; a blockquote → `"Quote"`;
- paragraph + H2 → `"Mixed"`;
- ⌘A including the title → `"Mixed"`;
- a 2,000-paragraph selection that changes type at block 2 visits ≤ 2 blocks (count with a spied `nodesBetween` callback).

Commit: `feat(bubble): compute the Style face`.

### Task 2: Turn-into menu body, shared by the bubble and the row (BQ10, BQ11)

**Files:**
- create `components/smart-toolbar/row/turn-into-menu-items.tsx`, exported through `menu-bodies.ts`;
- modify `components/smart-toolbar/row/style-menu.tsx` (the face says "Text"; the items come from the shared body);
- modify `components/smart-toolbar/row/menu-items.tsx` (`ToolbarMenuContent` takes `side?: "top" | "bottom"` and `align?: "start" | "center" | "end"`);
- test `tests/e2e/toolbar-row.spec.ts`, `tests/unit/editor-actions/contract.test.ts`.

**Interfaces:**
- Produces: `TURN_INTO_IDS = ["style.paragraph","style.heading1","style.heading2","style.heading3",/* More headings ▸ */"list.bullet","list.ordered","list.task","insert.quote","insert.codeBlock"] as const`.
- Produces: `<TurnIntoMenuItems editor />`.
- Each row shows icon, label, `formatKeyCombo(shortcut)` (`kbd dir="ltr"`) and a trailing ✓ cell, in `grid-template-columns: 16px 1fr auto 16px`, with **no Markdown chips**.
- H4–H6 sit under "More headings ▸".
- The title disables every row with "Title is always H1."
- Your formats stays in the row's Style ▾ only, below a separator.

**Tests:**
- the row face reads "Text" in a paragraph;
- Quote and Code block convert a paragraph, one undo step each;
- every id in `TURN_INTO_IDS` exists in `editorActions` (contract test).

Commit: `feat(toolbar): turn-into menu shared by the bubble and the row`.

### Task 3: Bubble layout v2

**Files:** modify `selection-bubble-view.tsx`, `bubble-rules.ts` (`BUBBLE_ACTION_IDS`), `selection-bubble.scss`, `color-controls.tsx` (the split chevron is 24 px); test `selection-bubble.spec.ts` (update "shows B, I, U…" and the bubble-in-row matrix).

**Interfaces:**
- Produces: `BUBBLE_ACTION_IDS = ["mark.bold","mark.italic","mark.underline","mark.strike","mark.inlineCode","format.clear","color.text.apply","mark.link"]`.
- Layout: `StyleMenu face │ B I U S ‹› Tx │ A▁▾ 🔗 🖌 │ [comment slot]`.
- The comment slot is `ActionButton id="comment.add"`, which renders `null` until the comments PR registers the id.
- The Style face's width is measured once at mount, from the longest face word in `actionLabel` output, with a minimum of 64 px. If that is more than 96 px, the face is the icon plus a chevron.

**CSS** (spec §7.1):
- light edge `oklch(0.87 0 0)`;
- dark `--bubble-surface: oklch(0.24 0 0)` and edge `oklch(1 0 0 / 36%)`;
- focus ring `outline-offset: -2px` inside the bubble;
- a dashed mixed bar;
- forced colours: a `CanvasText` edge.

**Tests:**
- order and accessible names;
- inside inline code, B, I, U, S, colour, link and paint are `aria-disabled` and their described reason includes "Inline code";
- the matrix covers every id in the row;
- forced colours keep the edge.

Commit: `feat(bubble): fuller bubble with style, strike, code and clear`.

### Task 4: Named colour rows on desktop (O2)

**Files:** modify `components/smart-toolbar/color/color-panel.tsx` and `color-panel.scss`; create `components/smart-toolbar/color/color-order.ts`; tests `action-preview.spec.ts`, `toolbar-surfaces.spec.ts`.

**Interfaces:**
- Produces: `ColorPanel` prop `layout: "rows" | "grid"`.
  - The bubble and the row pass `"rows"`.
  - The phone sheet passes `"grid"`, plus `caption="current"`.
- Produces: `FIRST_TEXT_COLORS = ["red","orange","green","blue","purple"]` and `FIRST_HIGHLIGHTS = ["yellow","green","blue","pink"]`.
- **Rows layout:**
  - Recent first: up to 5 from `RECENT_COLORS_CHOICE`.
  - Then two columns, Text | Highlight, as `role="group"` with `menuitemradio`.
  - Default and No highlight use `Ban`. Text chips are 18 px "A" tiles in the token colour; highlight tiles are filled.
  - "More colours ▸" and "More highlights ▸" hold the rest.
  - Arrow keys: Up/Down within a column; Left/Right across columns, visual order in RTL (`visualStep` if P2.13 has landed, else `dir` from `getComputedStyle`).
  - The hover preview calls `setActionPreview` on pointer enter and on focus.

**Tests:**
- naming: the row named "Teal text" exists under More;
- a hover preview decorates the selection;
- Left/Right crosses columns;
- the phone sheet still shows the grid, and a tap shows the pill "Teal text" with Undo.

Commit: `feat(color): named colour rows on desktop surfaces`.

### Task 5: Keyboard-selection timing (O7) and motion (O10)

**Files:** `bubble-controller.ts` (with an option), `selection-bubble-view.tsx`, `selection-bubble.scss`; tests `selection-bubble.spec.ts`.

**Interfaces:**
- `BubbleHost.keyboardSettleMs = 300`.
- After a selection change caused by a `keydown` with Shift held, show only after `keyup` of Shift **and** 300 ms with no further selection change. Never show on auto-repeat.
- Alt+F10 (the `toolbar.focus` intent) calls `controller.update()` and shows at once.
- Motion follows the global constraint.

**Tests:**
- Shift+Arrow ×5: no bubble while Shift is held, and a bubble 300–450 ms after Shift is released;
- Alt+F10 shows it at once;
- with reduced motion, `getAnimations()` is empty.

Commit: `feat(bubble): settle keyboard selections before showing`.

### Task 6: Link handoff and the pill reasons

**Files:** `selection-bubble-view.tsx`; test `selection-bubble.spec.ts`.

**Behaviour:**
- Clicking 🔗 runs `mark.link`, then `controller.hide()` in the **same task**.
- The Hyperlink popover takes focus on its first frame, and it opens below the selection (the package's fixed placement, spec §7.5).
- Applying ‹› over linked or coloured text announces "Link and colour removed" with Undo, through the status pill.

**Tests:**
- **"click link and paste at once keeps the selected text":** click 🔗, then `page.keyboard.insertText("https://e.com")` with no wait. The document still contains the selected words, and they now carry the link.
- a URL pasted over a selection links it;
- a media URL pasted over a selection doesn't (`shouldAutoLink`).

Commit: `feat(bubble): hand off to the link field without a gap`.

Then: screenshots (spec Appendix C, bubble rows), CHANGELOG, PR. Report it; don't merge.

---

# Phase P2: quick insert and the "/" amendments (O5, O12, BQ9, OB2)

**Branch:** `feat/quick-insert` from `main` after P1. Visible.

### Task 1: Suggested from recent insert kinds (O12 a)

**Files:**
- `lib/remembered-choice.ts`: `INSERT_KIND_CHOICE.maxRecent` 0 → 3;
- `lib/slash-menu/slash-items.ts`;
- the v1 contract A18, extended;
- tests `tests/unit/lib/remembered-choice.test.ts`, `tests/unit/lib/slash-items.test.ts`.

**Interfaces:**
- `SlashSection` gains `"Suggested"`.
- `buildSlashItems(ctx, actions, tableSize, recentKinds: readonly InsertKind[])` prepends up to 3 Suggested items when `recentKinds` is non-empty. Each also stays in its own section.
- `matchSlashItems` drops Suggested for a non-empty query, and breaks rank ties in favour of recent kinds.

**Tests:**
- an old stored entry `{ last: "table", recent: [] }` reads as last "table" and recent [];
- after inserting table, image, divider, `recent` is `["divider","image","table"]`;
- a new writer sees no Suggested section;
- Forget clears it.

Commit: `feat(slash): suggest recent insert kinds`.

### Task 2: Ghost hint, footer and badges (BQ9)

**Files:** `components/smart-toolbar/slash/slash-menu.tsx`; create `components/smart-toolbar/slash/slash-footer.tsx` and `lib/slash-menu/slash-badges.ts`; test `tests/e2e/slash-menu.spec.ts`.

**Interfaces:**
- Produces: `NEW_UNTIL: Readonly<Record<string, string>> = {}` (it ships empty).
- Produces: `isNewItem(item: SlashItem, today: string, recentKinds: readonly string[]): boolean`.
- The menu is 320 px wide.
- **Ghost:** an `aria-hidden` element at `coordsAtPos(head)`, in the paragraph's computed `font`, coloured `--muted-foreground`. It shows only while the query is empty, nothing follows the caret in the block, and no composition is active.
- **Footer:** sticky, outside the scrolling list.
  - Start: "Type `##` then space for Heading 2" for the active row's `hint`, else "↑ ↓ to move · ↵ to insert". Hidden on a coarse pointer.
  - End: a button "Close" with `<kbd>esc</kbd>`.

**Tests:**
- the ghost shows at an empty line and not mid-line;
- the tip follows ArrowDown;
- the Close button leaves "/" as text;
- a badge shows before the date and not after first use (inject `today`);
- RTL: the list's right edge is within 2 px of the "/" caret.

Commit: `feat(slash): inline hint, footer tip and close button`.

### Task 3: `+` on the empty line (O5 a)

**Files:**
- create `components/smart-toolbar/slash/empty-line-plus.tsx`, exported from `slash-menu.tsx`'s module;
- modify `components/smart-toolbar/slash-menu-host.tsx`: when the module is loaded, render `<loaded.EmptyLinePlus editor={editor} />`, eager, **measured inside the 1,000 B slash cap**;
- test `tests/e2e/slash-menu.spec.ts`.

**Interfaces:** `EmptyLinePlus({ editor }: SurfaceProps)`.
- It shows on a fine pointer while the caret is in an empty paragraph (not the title, a list, a quote or a table cell), 300 ms after the last keystroke.
- It also shows on hover over an empty paragraph after a 150 ms dwell, detected from the DOM at most once per frame.
- It re-measures on `transaction` while shown, and hides from `compositionstart` to `compositionend`.
- `mousedown` → `preventDefault`. A click moves the caret into the paragraph and dispatches `tr.insertText("/")` with `addToHistory: false`. That is the trigger's own path.
- Esc with an empty query after a `+`-opened menu deletes the "/" (`addToHistory: false`). The host passes `origin: "plus"` through a module flag that the menu reads once.
- It has `aria-haspopup="listbox"`, `aria-label="Insert block"` and `tabIndex={-1}`.

**Tests:**
- the `+` appears beside an empty paragraph and not beside the title;
- a click opens the "/" menu with the ghost;
- Esc leaves the paragraph empty and `editor.can().undo()` unchanged;
- a pick is one undo step;
- no `+` on a coarse pointer;
- the `+` hides during IME composition (CDP).

Commit: `feat(slash): plus button on empty lines`.

### Task 4: Insert alias hints, the placeholder, and the registry contract test

**Files:**
- `insert/insert-menu-body.tsx`: the "/" alias as an end hint;
- `components/document-editor/document-editor-config.ts:94`: "Type / for blocks". **Only after #123 merges; else leave it for a follow-up and say so in the PR**;
- create `tests/unit/editor-actions/surface-labels.test.ts`.

**Contract test:**
1. Every id named by the bubble, Turn-into, slash, Insert and phone surfaces exists in the registry.
2. Those surface files contain no hard-coded registry labels: grep for each of their ids' labels.
3. Every `markdownHint` shown in "/" triggers its block through the real input rules in `createTestEditor`. For example, typing `## ` makes `heading level 2`.

Commit: `feat(slash): alias hints and a label contract test`.

Then: screenshots, CHANGELOG, PR.

---

# Phase P3: the row's ⋯ regroup (BQ4) and Page width (O9)

**Branch:** `feat/overflow-groups`.

### Task 1: Groups

**Files:** `components/smart-toolbar/row/overflow-menu.tsx` and its body in `row/row-menu-bodies.tsx`; tests `toolbar-row.spec.ts`, `toolbar-a11y*.spec.ts`.

- **Groups:**
  - Text: Superscript, Subscript, Inline code, Clear formatting, Paint format;
  - View: Simplified toolbar ☐, Appearance ▸;
  - Help: All actions… ⌥/;
  - then "Forget my choices…" alone.
- Each group is `role="group"` with `aria-label` and a visible heading.
- Every row has a 16 px leading slot.

**Tests:** the group order and names; "Forget my choices…" is last.

Commit: `feat(toolbar): group the row's more menu`.

### Task 2: Page width ▸ (gated)

**Gate:** start only when the preferences work (P2.9c) has merged `page.width` / `doc.width` (check the preferences spec rows 7–8 in the code). Until then, record "blocked on P2.9c" in the PR and skip this task.

Then: View › Page width ▸ (Narrow, Standard, Wide, Full, with a ✓). In the web library, add "Use default (Standard)". In the sandbox, write the app-wide `ui.page.width`. Test each value's `data-page-width` and `data-doc-width`.

Then: CHANGELOG, PR.

---

# Phase P4: phone and tablet (O6, O8 a, §13.1)

**Branch:** `feat/phone-insert-sheet`. **Gate:** phone file ownership is clear (Global Constraints).

### Task 1: Insert sheet

**Files:** create `components/smart-toolbar/phone/insert-sheet.tsx`; modify `phone/phone-menu-cells.tsx` (the Insert cell opens the sheet) and `lib/slash-menu/slash-items.ts` (export `groupSlashItems(items)` for grid rendering); test `tests/e2e/mobile-bar.spec.ts`.

**Interfaces:** `InsertSheet({ editor, open, onOpenChange })` uses the `Sheet` component with swipe-to-close, `--safe-area-bottom` padding and a 16 px scroll fade.
- **Sections:** Suggested (optional), then "Blocks" or "Turn into" (by whether the caret's block is empty), then Insert.
- **Cells:** 44 px, two columns.
- **Steps:** table and embed open through `lazySurface(loadInsertStep)`; image opens the file picker.

**Tests:**
- the section titles for an empty block and a non-empty block;
- a pick closes the sheet and the keyboard caret lands in the new block;
- axe is clean;
- 320 px fits with no horizontal scroll.

Commit: `feat(phone): insert sheet`.

### Task 2: Aa sheet order and the tablet stand-in words

**Files:** `phone/format-sheet.tsx` (Style first, with a pressed current style and More headings ▸; colours as a 44 px grid with the current-value caption and the applied pill with Undo); the row's stand-ins (`collapse-menus.tsx`: words "Format", "Layout", "Block" at ≥ 768 px on a coarse pointer, CSS only); tests `mobile-bar*.spec.ts`, `toolbar-ladder.spec.ts`.

Commit: `feat(phone): style first in the format sheet; words on tablet stand-ins`.

Then: screenshots (390, 320, 820 px), CHANGELOG, PR.

---

# Phase P5: comment wiring (O3, BQ10, §7.6)

**Branch:** after the comments UI (P4.10) registers `comment.add`.

### Task 1

**Files:** `bubble-rules.ts` (`BUBBLE_ACTION_IDS` gains `"comment.add"`), `insert/insert-menu-body.tsx` (Insert › Comment where `canComment()`), and the reading-mode comment-only bubble in `selection-bubble-view.tsx` (shown while `!editor.isEditable && canComment()`).

**Tests:**
- 💬 is last, and absent in the Playground and the sandbox;
- the bubble-in-row matrix finds Insert › Comment;
- reading mode shows only 💬;
- ⌥⌘M opens the draft card (macOS).

Commit and PR.

---

## Self-review notes

- **Spec coverage:**
  - §7.1–7.6 → P1;
  - §7.7 and §7.9 → nothing to build (decided "none");
  - §7.8 → P1, the row layout;
  - §7.10 → P1 Tasks 2 and 4 (keyboard);
  - §8.2, §8.5 → P2;
  - §8.3, §13.1, §13.2 → P4;
  - §9 → P3;
  - §10 → P0 and P1;
  - §11 → P1 Task 5;
  - §12 → P0;
  - §13.3 (contextmenu hide) → P0 Task 2;
  - §13.4 RTL → P1 Task 4 and P2 Task 2;
  - §14 → the tests per task;
  - §16 → the per-phase tests.
- **Gated items,** each named in its task: Page width (P2.9c), the placeholder (#123), phone files (ownership), 💬 (P4.10).
