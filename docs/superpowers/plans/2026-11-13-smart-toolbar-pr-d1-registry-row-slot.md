# Smart toolbar PR D1: action registry, context snapshot, sorted row and context slot, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put every toolbar command behind one action registry. Render the sorted row and the context slot from it, with a context snapshot that re-renders only the controls whose state changed, and a keyboard model of one Tab stop, Alt+F10 and Esc.

**Architecture:**
- `lib/editor-actions/` holds the plain-TypeScript `Action` objects, the O(depth) context snapshot and the section index.
- `hooks/use-tiptap-editor.ts` extends PR A's per-editor version store with:
  - `getContext()` and `getView(action)`, memoized by store version, with structural sharing;
  - `hold()` for the slot, and a read-only reason.
- Each control subscribes to its own view through `useSyncExternalStore`.
- The row and the slot are thin React views in `components/editor-toolbar/`.
- `components/ui/toolbar.tsx` drops the index-based `useMenuNavigation` roving. A DOM-owned roving tabindex replaces it, computed from focus at keydown.

**Tech Stack:** Next.js 16, React 19.3, Tiptap 3.33, `@tiptap/y-tiptap`, Base UI 1.9, Tailwind 4, `bun test` (happy-dom), Playwright 1.65 with `@axe-core/playwright` (added by PR A).

**Spec:** `docs/superpowers/specs/2026-11-12-smart-toolbar-design.md`. D1 is the first half of §8 item 4. It covers §2, §4.1, §4.2, §6 "Plus:" and the D1 share of §7. Its go criteria are §8 "Per-PR go criteria (HoE)" **D**, split as HoE advised ("registry + row, then other surfaces").

**Base:** D1 branches from the **merge of PR A** (`feat/smart-toolbar-a11y`, docs-plus/editor#27) **and PR C** (schema, plan `docs/superpowers/plans/2026-11-13-smart-toolbar-pr-c-schema.md`). Create the branch `feat/smart-toolbar-d1-registry` from that merge commit. Before Task 1, confirm that `git grep -n '"fontSize"'` finds C's mark and that `components/ui/toolbar.tsx` contains PR A's `ROVING_GROUP_SELECTOR`.

## Global Constraints

**Tooling**
- Bun only: `bun`, `bun <bin>`, `bunx --bun`. Never npm, npx, yarn or pnpm.
- Biome formats and lints. ESLint covers Next rules only. TypeScript is strict.
- `bun run typecheck` covers the app and `tsconfig.sw.json`.

**Code style**
- Named exports only. Kebab-case files.
- PascalCase components with title-case acronyms.
- Icons come from `lib/icons.tsx`. Add the missing lucide icons there (Task 7 lists them).
- New UI uses shadcn components from `components/ui/`.

**Commits**
- Conventional Commits: atomic, imperative mood.
- **No AI, tool or agent references and no trailers.** This overrides any `Co-Authored-By` reminder.
- Before every commit, show a commit review report (files, diff summary, message) and wait for explicit approval.

**Tests**
- `bun run test` runs the unit tests: one process with a happy-dom preload. `mock.module` spreads the real module and is followed by `await import()`.
- Playwright runs against servers on **Next 3700 + Hocus 1834**, never against tiny.docs.plus. Start them once and keep them running:

```bash
# terminal 1: Hocus
HOCUS_PORT=1834 DB_PATH="$TMPDIR/tinydocy-d1-e2e.sqlite" HOCUS_ALLOW_ISOLATED_TABS_DOCS=1 HOCUS_THROTTLE=0 \
  WS_CONNECTION_LIMIT=200 WS_SOCKETS_PER_IP=600 WS_UPGRADE_RATE_LIMIT=6000 DOC_CREATION_RATE_LIMIT=2000 bun run hocus
# terminal 2: Next (same DB_PATH: the DELETE route and Hocus share tombstones)
NEXT_PUBLIC_HOCUS_URL=ws://127.0.0.1:1834 DB_PATH="$TMPDIR/tinydocy-d1-e2e.sqlite" DOC_CREATION_RATE_LIMIT=2000 bun next dev -p 3700
# tests
E2E_BASE_URL=http://localhost:3700 CI= bun playwright test <spec> --project=chromium
```

- e2e types at full speed. Misplaced text means an app bug, not a missing wait.

**Code rules**
- Hydration: never `useState(() => readWindowOrStorage())`.
- Never subscribe the editor shell to editor state. Never rebuild the extensions array or `EDITOR_PROPS` per render.
- New controls never pass `tabIndex`. The `Toolbar` owns that attribute (Task 6).
- A toolbar control never `return null`s because the editor is read-only. It stays in place, `aria-disabled`, with a reason. The row never reorders.

**Values the spec pins**
- `TOOLBAR_SETTLE_MS = 150` and `TOOLBAR_MAX_WAIT_MS = 1000` (both exist).
- `kind` precedence: readonly > media / mermaid (mermaid tested before code) > code > table > title > heading > list > paragraph.
- Typing p95 ≤ +10% (PR A asserts this; the slot sits inside the measured toolbar).
- Arrow / Shift+Arrow p95 < 16 ms in a 500-heading doc.
- ≤ 1 toolbar commit per settle during a burst.
- Client JS ≤ +6 KB gz for all of PR D (D1 and D2 share it).
- Clear formatting: `Mod-\`. It removes every inline mark except `hyperlink`, leaves block type, alignment and indent alone, and is disabled in code.
- Disabled-size reason: "Headings scale automatically".
- `aria-valuetext` example: "Large, about 20 pixels".
- Slot: `role="group"` with a changing `aria-label` and no live region. Empty contexts are hidden from AT.

**Scope boundary (D2 owns these; D1 must not start them)**
- Colour popover and the text-colour split button A▾.
- Selection bubble and the Alt+F10-to-bubble route.
- Palette and the "All actions…" entry.
- Memory layer M1–M6, M9, M10, M17a, `NEXT_PUBLIC_REMEMBER_CHOICES` and the "Forget my choices" entry.
- Responsive ladder, its ResizeObserver focus repair, and the outline overlay below 950px.
- Phone docked bar and the Aa sheet, and 44×44 touch targets.

## Decisions on spec ambiguities

1. **PR C commands.** The C plan was not present when this was written. D1 assumes only the **mark and attribute names** from spec §3:
   - `textColor { color }`;
   - `fontSize { size: "xs" | "sm" | "lg" | "xl" }`;
   - `highlight { color }` with token values.

   D1 calls the generic `setMark("fontSize", { size })` and `unsetMark("fontSize")`. Clear formatting iterates `schema.marks`. No C command name is used.
2. **A▾ in D1:** omitted. The current highlight popover stays at the ✎ position, unchanged. D2 replaces both with the colour popover.
3. **Size stepper:** functional, because C is in the base. If `schema.marks.fontSize` is missing, it is disabled with "Not available in this version".
   - From *Mixed*, + sets L and − sets S.
   - The size is disabled when the selection touches any heading (the title included).
4. **`getView` takes the `Action` object**, not an id. That avoids a store → registry import cycle and lets tests use fake actions. **`run` returns `boolean`** (true when a transaction was dispatched), which D2's "only a successful run() writes" rule needs. **`icon` is a component** from `lib/icons.tsx`, not a name.
5. **Cache keys:**
   - The snapshot and every `ctx.lazy()` result (all `can()` checks, including list and indent, which depend on the selection) are keyed by **store version**.
   - Only selection-independent data is keyed by **`state.doc` identity** in a `WeakMap`: the section index, here; the code-language count, in D2.
6. **Mermaid "diagram language ▾"** is the code-language menu, named by its value "Mermaid diagram". Picking a code language turns the diagram into a code block. In a code block, picking "Mermaid diagram" turns the block into a diagram.
7. **Insert → Table** inserts 3×3 with a header row. The size grid and M17a come in D2.
8. **Section move** swaps with the adjacent sibling section of the same level inside the same parent:
   - Up finds the nearest earlier heading of level ≤ L. It moves only if that heading's level is exactly L.
   - Down looks at the heading at this section's end. It moves only if that heading's level is exactly L.
   - The title is not a section and never moves.
   - Reasons: "Already first at this level", "Already last at this level", "This heading is gone".
9. **Held target.** `hold()` pins the heading id at the caret. While held, section actions are disabled with "This heading is gone" when the caret's heading id differs, so a remote deletion that maps the caret into another heading never moves the wrong section. Code, table and media actions act on the live node and are disabled when it is gone.
10. **Media slot guarantee.**
    - "Media options…" opens the kit's toolbar through `openMediaToolbar` and focuses its first focusable control, if any.
    - Esc inside the kit toolbar closes it (`closeMediaToolbar`) and returns focus to the slot button.
    - Full keyboard use inside the kit toolbar stays an upstream ask.
11. **Outline, Filter and Theme** stay app controls in the row, not registry actions. Their `view.*` actions arrive with the palette (PR E).
12. **Mobile until D2:** the same sorted row scrolls horizontally, and the highlighter panel swap is unchanged.
13. **Size gate:** D1 adds a whole-client JS gzip check against a baseline recorded at the D1 base. Whole-client is stricter than "editor chunk" and does not depend on Turbopack chunk names. It is enforced only on `feat/smart-toolbar-d*` PRs and advisory elsewhere. D2 uses the rest of the same 6 KB budget and re-records the baseline after it merges (Task 10).
14. **Slot width:** fixed at `168px` (`--context-slot-width`). Long values truncate with an ellipsis.
15. **Labels:** PR A's accessible names stay (Undo, Redo, Bold, Italic, Underline, Strike, Inline code, Superscript, Subscript, Link, Indent, Outdent), so PR A's e2e selectors keep working.
16. **Hold scope:** focus inside a popup opened from the toolbar (marked `data-toolbar-popup`) counts as focus in the toolbar.

## Review Focus

1. **A collaborator deletes the heading while Move section up has focus.** Focus stays on the button, which turns `aria-disabled` with "This heading is gone", and pressing Enter moves nothing. Task 9 e2e: "remote heading deletion while the slot is focused".
2. **The document turns read-only while a toolbar control has focus.** Every control stays in place with the read-only reason, and focus stays on the same control. Task 8 updates PR A's read-only e2e to assert the same element.
3. **NodeSelection and CellSelection.** An image NodeSelection resolves to `media`. A multi-cell CellSelection resolves to `table`, with Merge enabled. Task 1 unit: "kind for NodeSelection and CellSelection".
4. **A selection across a heading and a paragraph.** The style menu reads "Mixed". The size stepper is disabled with "Headings scale automatically" and its `aria-valuetext` is "Mixed". Task 7 unit: "mixed heading and paragraph selection".
5. **Mouse users after mousedown `preventDefault`.** Every row and slot menu and popover still opens on click, and the editor keeps its selection. Task 6 e2e: "every toolbar menu opens by mouse and the editor keeps its selection".

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `lib/editor-actions/types.ts` | `Action`, `Ctx`, `ContextKind`, `ActionGroup`, `KeyCombo`, `ActionView`, `Enabled`, value types | Create |
| `lib/editor-actions/context.ts` | `computeContext()`, kind precedence, `MEDIA_NODE_TYPES` | Create |
| `lib/editor-actions/sections.ts` | Doc-keyed section index, `sectionMoveTarget()` | Create |
| `lib/editor-actions/view.ts` | `computeView()`, `sameView()`, the central read-only rule | Create |
| `lib/editor-actions/run-action.ts` | `runAction()`, which rechecks the live doc | Create |
| `lib/editor-actions/index.ts` | Barrel: types, registry, `runAction`, `computeContext` | Create |
| `lib/editor-actions/ui-requests.ts` | Per-editor UI handlers (`focusToolbar`, `openEmbed`) | Create |
| `lib/editor-actions/actions/*.ts` | `history`, `inline`, `size`, `link`, `text-style`, `list`, `align`, `indent`, `insert`, `section`, `code`, `table`, `media` | Create |
| `lib/editor-actions/registry.ts` | `ACTIONS`, `ActionId`, `getAction()`, `actionsInGroup()` | Create |
| `lib/shortcuts.ts` | `toAriaKeyShortcuts()` | Modify |
| `hooks/use-tiptap-editor.ts` | Store gains `getContext`, `getView`, `getSlotKind`, `hold`, `setReadOnlyReason`; late max-wait fix; clear on destroy | Modify |
| `hooks/use-action-view.ts` | `useActionView()`, `useSlotKind()` | Create |
| `extensions/editor-action-shortcuts/` | `Mod-\` clear formatting, `Alt-F10` focus toolbar | Create |
| `components/ui/toolbar.tsx` | DOM roving tabindex, `onEscape`, mousedown `preventDefault`, `focusRovingItem()`, floating overflow fix | Modify |
| `components/editor-toolbar/*` | `ActionButton`, `ActionMenu`, `StyleMenu`, `SizeStepper`, `AlignMenu`, `ListMenu`, `InsertMenu`, `OverflowMenu`, `ContextSlot` + slot parts, `useToolbarHold` | Create |
| `components/document-editor/main-toolbar-content.tsx` | Sorted row | Modify |
| `components/document-editor/document-editor.tsx` | `onEscape`, UI-request registration, hold, read-only reason, Profiler sink | Modify |
| `components/document-editor/document-editor-config.ts` | Adds `EditorActionShortcuts` | Modify |
| `components/document-editor/toolbar-test-hooks.ts` | `recordToolbarRender()` (dev-only) | Modify |
| `components/tiptap-ui/media-embed-popover/media-embed-popover.tsx` | Controlled mode (`open`, `onOpenChange`, `anchor`) | Modify |
| `components/tiptap-ui/{mark-button,heading-button,heading-dropdown-menu,list-button,list-dropdown-menu,text-align-button,indent-button,undo-redo-button,blockquote-button,code-block-button,mermaid-button,image-upload-button,hyperlink-button,shortcut-badge}` | Replaced by registry entries | Delete (Task 8) |
| `components/toc-sidebar/toc-sidebar.tsx` | `block: "start"` | Modify |
| `scripts/check-client-js-size.ts`, `scripts/client-js-baseline.json` | Gzip size gate | Create |
| `.github/workflows/ci.yml`, `package.json` | `size:check` after build | Modify |
| `tests/unit/editor-actions/*.test.ts` | Context, sections, registry, action groups | Create |
| `tests/unit/components/editor-toolbar/*.test.tsx` | Button, menus, stepper, slot | Create |
| `tests/e2e/toolbar-keyboard.spec.ts`, `toolbar-row.spec.ts`, `toolbar-slot.spec.ts`, `toolbar-leaks.spec.ts` | Keyboard, row, slot, leaks | Create |
| `tests/e2e/performance.spec.ts`, `helpers/perf-observer.ts`, `toc-sidebar.spec.ts`, `toolbar.spec.ts`, `toolbar-a11y.spec.ts` | Budgets, TOC, PR A selector updates | Modify |
| `CHANGELOG.md`, `tests/TESTING.md`, `AGENTS.md` | Docs | Modify |

---

### Task 1: Action types and the context snapshot

Spec §2 (the `Action` interface and the context snapshot) and §7 (O(depth), doc-identity caches).

**Files:**
- Create: `lib/editor-actions/types.ts`, `lib/editor-actions/context.ts`, `lib/editor-actions/sections.ts`
- Test: `tests/unit/editor-actions/context.test.ts`, `tests/unit/editor-actions/sections.test.ts`

**Interfaces:**
- Produces, in `types.ts`:

```ts
export type ContextKind = "readonly" | "media" | "mermaid" | "code" | "table" | "title" | "heading" | "list" | "paragraph";
export type ActionGroup = "history" | "style" | "size" | "inline" | "link" | "block" | "insert" | "overflow" | "section" | "code" | "table" | "media";
export type KeyCombo = string; // "mod+b", "mod+shift+z", "mod+\\", "alt+f10": the format parseShortcutKeys reads
export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
export type TextStyleValue = "title" | "paragraph" | `heading-${HeadingLevel}`;
export type FontSizeValue = "xs" | "sm" | "md" | "lg" | "xl"; // "md" = no mark
export type Enabled = true | { reason: string };
export type IconComponent = React.ComponentType<{ className?: string }>;
export interface Ctx {
  readonly kind: ContextKind;
  readonly editor: Editor;
  readonly state: EditorState;
  readonly editable: boolean;
  readonly readOnlyReason: string | null;
  readonly parentType: string;
  readonly inTable: boolean; readonly inList: boolean;
  readonly inBlockquote: boolean; readonly inCode: boolean;
  readonly isTitle: boolean;
  readonly nodeSelectionType: string | null;
  readonly empty: boolean;
  readonly headingId: string | null;   // top-level heading at the caret
  readonly headingPos: number | null;
  readonly headingLevel: HeadingLevel | null;
  readonly heldHeadingId: string | null; // from hold(); null when not held
  readonly codeLanguage: string | null;  // sanitized; code and mermaid only
  readonly blockStyle: TextStyleValue | "mixed";
  readonly marks: ReadonlySet<string>;   // mark names at $from (stored marks when set); O(marks)
  lazy<T>(key: string, compute: () => T): T; // memo for this snapshot only
}
export interface Action<A = unknown> {
  id: string; label: string; keywords?: readonly string[]; icon: IconComponent;
  shortcut?: KeyCombo; markdownHint?: string;
  group: ActionGroup; contexts: readonly ContextKind[] | "any";
  enabled(ctx: Ctx): Enabled;
  isActive?(ctx: Ctx): boolean; isMixed?(ctx: Ctx): boolean; value?(ctx: Ctx): string | null;
  run(editor: Editor, arg?: A): boolean; // one transaction = one undo step
}
export interface ActionView {
  readonly enabled: boolean; readonly reason: string | null;
  readonly active: boolean; readonly mixed: boolean; readonly value: string | null;
}
```

- Produces, in `context.ts`:
  - `export const MEDIA_NODE_TYPES: ReadonlySet<string>`: image, video, audio, youtube, vimeo, soundcloud, spotify, loom, x (the kit's `MediaNodeType`).
  - `export function computeContext(editor: Editor, opts: { readOnlyReason: string | null; heldHeadingId: string | null }): Ctx`. It reads `editor.state` and `editor.isEditable`. Work is O(depth), plus the `blockStyle` scan, which stops at the first block that differs.
  - `mermaid` means a `codeBlock` parent with `language === "mermaid"`. `table` means a `table` ancestor or a `CellSelection`. `title` means `$from.index(0) === 0`. `heading` and `headingId` cover depth-1 headings only.
- Produces, in `sections.ts`:
  - `export interface SectionEntry { pos: number; level: HeadingLevel; childIndex: number; id: string | null }`
  - `export function getSectionIndex(doc: PMNode): readonly SectionEntry[]` returns top-level headings without the title, cached in a `WeakMap<PMNode, …>`.
  - `export function sectionMoveTarget(doc: PMNode, headingPos: number, direction: "up" | "down"): { from: number; to: number; target: number } | null` applies Decision 8, using `computeSection` from `extensions/shared/compute-section.ts` and a binary search over the index.

- [ ] **Step 1: Write the failing tests.** Build editors with `createTestEditor` from `tests/helpers/create-test-editor.ts`.

```ts
describe("computeContext kind", () => {
  it.each([
    ["paragraph", "<p>a|</p>"], ["list", "bullet list item"], ["heading", "H2 after the title"],
    ["title", "first heading"], ["code", "codeBlock language ts"], ["mermaid", "codeBlock language mermaid"],
    ["table", "caret in a cell"],
  ])("is %s", (kind, _where) => { /* set selection, expect(computeContext(editor, NO_HOLD).kind).toBe(kind) */ });
  it("is readonly first when the editor is not editable, even on an image", () => {});
  it("kind for NodeSelection and CellSelection", () => {
    // NodeSelection on an image -> "media", nodeSelectionType "image"
    // CellSelection over 2x1 cells -> "table"
  });
  it("tests mermaid before code and code before table", () => { /* code block inside a cell -> "code" */ });
  it("reads blockStyle 'mixed' across a heading and a paragraph and 'heading-2' inside one", () => {});
  it("memoizes lazy() per snapshot", () => { /* compute spy called once for two lazy("x") calls */ });
  it("reads marks at the caret, and stored marks win", () => {
    // caret in bold text -> marks has "bold"; after setStoredMarks([italic]) -> marks is {"italic"}
  });
});
describe("sections", () => {
  it("returns the same index for the same doc and a new one after a change", () => {});
  it("moves up past a deeper subsection to the previous same-level heading", () => {
    // title, H2 A, H3 a1, H2 B(caret) -> target === pos(A)
  });
  it("refuses up under a parent heading and down at the end of a parent", () => {}); // null
  it("never targets the title", () => { /* first H1 section up -> null */ });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `bun test tests/unit/editor-actions`
Expected: FAIL. The modules are not found.

- [ ] **Step 3: Implement the three files** as the Interfaces block says. `lazy` uses one `Map<string, unknown>` per `Ctx` object.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `bun test tests/unit/editor-actions && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit** after the review report is approved

```bash
git add lib/editor-actions tests/unit/editor-actions
git commit -m "feat(editor-actions): add the action types and context snapshot"
```

---

### Task 2: Snapshot, views and hold on the version store

Spec §2 (memo key = store version; per-control subscriptions), §4.2 (timing, `hold()`, `TOOLBAR_MAX_WAIT_MS`), §7 (WeakMap; clear the max-wait timer on destroy) and PR A carry-over "`TOOLBAR_MAX_WAIT_MS` can fire late under load".

**Files:**
- Modify: `hooks/use-tiptap-editor.ts`
- Create: `lib/editor-actions/view.ts`, `hooks/use-action-view.ts`
- Test: `tests/unit/hooks/use-tiptap-editor.test.ts`, `tests/unit/hooks/use-action-view.test.tsx`

**Interfaces:**
- Consumes: `computeContext`, `Ctx`, `Action`, `ActionView` (Task 1).
- Produces, in `view.ts`:
  - `export const READ_ONLY_FALLBACK = "Document is read-only"`.
  - `export function computeView(action: Action, ctx: Ctx): ActionView`. When `!ctx.editable`, it returns `enabled: false` with `reason: ctx.readOnlyReason ?? READ_ONLY_FALLBACK` before calling `action.enabled`. `active`, `mixed` and `value` are still read.
  - `export function sameView(a: ActionView, b: ActionView): boolean` compares the five fields.
- Produces, in `EditorVersionStore` (still `getEditorVersionStore(editor)`, `WeakMap`-cached):

```ts
getContext(): Ctx;                         // recomputed only when the version moved
getView(action: Action): ActionView;       // per-version; returns the previous object when sameView()
getSlotKind(): ContextKind;                // live kind, or the kind captured at the first hold()
hold(): () => void;                        // ref-counted; release is idempotent; 0->1 and 1->0 notify
setReadOnlyReason(reason: string | null): void; // notifies only when it changes
```

- Produces, the deadline rule. `notify()` also resets `burstStartedAt`, and `editor.on("destroy")` clears both timers.

```ts
// on a doc-changing transaction
const now = Date.now();
burstStartedAt ??= now;
if (now - burstStartedAt >= TOOLBAR_MAX_WAIT_MS) return notify(); // a late timer can no longer starve the toolbar
clearTimeout(settleTimer); settleTimer = setTimeout(notify, TOOLBAR_SETTLE_MS);
maxWaitTimer ??= setTimeout(notify, TOOLBAR_MAX_WAIT_MS - (now - burstStartedAt));
```

- Produces, a dev-only notify timer. React calls every subscriber's `getSnapshot` (and so `getView`, with its `can()` checks) inside `notify()`, outside render, where the Profiler cannot see it. So `notify()` times its listener loop with `performance.now()` and, when `process.env.NODE_ENV !== "production"` and `window` exists, pushes the result to `window.__toolbarNotifyMs: number[]`. Task 10 bounds it.
- Produces, in `hooks/use-action-view.ts`:
  - `useActionView(action: Action, providedEditor?: Editor | null): ActionView`. It uses `useSyncExternalStore(store.subscribe, () => store.getView(action), () => DISABLED_VIEW)`, where `DISABLED_VIEW` is a frozen module constant.
  - `useSlotKind(providedEditor?: Editor | null): ContextKind`.

- [ ] **Step 1: Write the failing tests.** Add to the existing fake-timer `setup()` in `use-tiptap-editor.test.ts`. `fakeBold` is an inline `Action` whose `isActive` reads `ctx.state.doc.rangeHasMark`. All unit files share one process, so add `setSystemTime()` (no argument: reset) to the file's `afterEach`.

```ts
it("memoizes the context per version", () => {
  expect(store.getContext()).toBe(store.getContext());
  editor.commands.setTextSelection(3);
  expect(store.getContext()).not.toBe(before);
});
it("returns the same view object while a view is unchanged", () => {
  const v1 = store.getView(fakeBold);
  editor.commands.setTextSelection(4); // still inside the plain paragraph
  expect(store.getView(fakeBold)).toBe(v1);
});
it("hold freezes the slot kind and release catches up", () => {
  const release = store.hold();
  // move the caret into an H2
  expect(store.getContext().kind).toBe("heading");
  expect(store.getSlotKind()).toBe("paragraph");
  listener.mockClear(); release(); release();
  expect(listener).toHaveBeenCalledTimes(1);
  expect(store.getSlotKind()).toBe("heading");
});
it("is ref-counted", () => { /* two holds, one release -> still frozen */ });
it("pins the held heading id in the context", () => { /* hold in H2 -> getContext().heldHeadingId === its id */ });
it("sets the read-only reason once", () => {
  store.setReadOnlyReason("Document was deleted"); store.setReadOnlyReason("Document was deleted");
  expect(listener).toHaveBeenCalledTimes(1);
  editor.setEditable(false);
  expect(computeView(fakeBold, store.getContext()).reason).toBe("Document was deleted");
});
it("max wait fires on the next change when its timer is late", () => {
  editor.commands.insertContent("a"); listener.mockClear();
  setSystemTime(new Date(Date.now() + TOOLBAR_MAX_WAIT_MS + 5)); // timers not advanced: the timer is "late"
  editor.commands.insertContent("b");
  expect(listener).toHaveBeenCalledTimes(1);
});
it("notifies nothing after the editor is destroyed mid-burst", () => {
  editor.commands.insertContent("a"); editor.destroy(); vi.runAllTimers();
  expect(listener).not.toHaveBeenCalled();
});
```

In `use-action-view.test.tsx`, mount two probes with `createRoot` + `act`, in the same way as `tests/unit/hooks/use-synced-tabs.test.ts`.

```ts
it("a selection move inside one paragraph does not re-render Bold", () => {
  // renders counted per probe; move the caret within the paragraph, run timers
  expect(boldRenders).toBe(1);
});
it("a probe re-renders when its own view changes", () => { /* toggle bold -> 2 renders */ });
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `bun test tests/unit/hooks`
Expected: FAIL. `getContext` is not a function, and the late-timer test sees 0 calls.

- [ ] **Step 3: Implement** as the Interfaces block says.
  - The store keeps three fields:
    - `ctx: { version: number; value: Ctx } | null`;
    - `views: Map<Action, { version: number; value: ActionView }>`;
    - `holdCount` plus `held: { kind: ContextKind; headingId: string | null } | null`.
  - `getContext()` passes `heldHeadingId: held?.headingId ?? null`.
  - `useTiptapEditor` stays unchanged for the controls that are not migrated.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `bun test tests/unit/hooks && bun run typecheck`
Expected: PASS, including PR A's existing max-wait tests.

- [ ] **Step 5: Commit** after approval

```bash
git add hooks/use-tiptap-editor.ts hooks/use-action-view.ts lib/editor-actions/view.ts tests/unit/hooks
git commit -m "perf(toolbar): memoize the context and per-control views on the version store"
```

---

### Task 3: History, inline, size and link actions, the registry and `runAction`

Spec §2 (undo and redo read the UndoManager; clear formatting #392; `aria-keyshortcuts` #612; read-only reasons) and §4.1 (size `spinbutton`).

**Files:**
- Create:
  - `lib/editor-actions/actions/history.ts`, `inline.ts`, `size.ts`, `link.ts`;
  - `lib/editor-actions/registry.ts`, `lib/editor-actions/run-action.ts`, `lib/editor-actions/index.ts`;
  - `extensions/editor-action-shortcuts/{index.ts,editor-action-shortcuts.ts}`.
- Modify: `lib/shortcuts.ts`, `components/document-editor/document-editor-config.ts` (add `EditorActionShortcuts`), and `tests/helpers/create-test-editor.ts` if C's `textColor`/`fontSize` extensions are missing from `DEFAULT_EXTENSIONS` (import them from where `git grep -n 'name: "fontSize"'` finds them).
- Test: `tests/unit/editor-actions/inline-actions.test.ts`, `tests/unit/editor-actions/registry.test.ts`, `tests/unit/lib/shortcuts.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces, the actions. Copy is exact; "—" means none.

| id | label | shortcut | markdownHint | enabled reasons (besides read-only) | active / value |
|---|---|---|---|---|---|
| `history.undo` | Undo | `mod+z` | — | "Nothing to undo" | — |
| `history.redo` | Redo | `mod+shift+z` | — | "Nothing to redo" | — |
| `mark.bold` | Bold | `mod+b` | `**text**` | in code: "Code has no formatting" | active = whole range; mixed = `rangeHasMark && !active` |
| `mark.italic` | Italic | `mod+i` | `*text*` | same | same |
| `mark.underline` | Underline | `mod+u` | — | same | same |
| `mark.strike` | Strike | `mod+shift+s` | `~~text~~` | same | same |
| `mark.superscript` | Superscript | `mod+.` | — | same | same |
| `mark.subscript` | Subscript | `mod+,` | — | same | same |
| `mark.inlineCode` | Inline code | `mod+e` | `` `code` `` | same | same |
| `format.clear` | Clear formatting | `mod+\` | — | in code: "Code has no formatting" | — |
| `size.set` (arg `FontSizeValue`) | Font size | — | — | "Headings scale automatically" if the range touches a heading; in code: "Code keeps one size"; no `fontSize` mark: "Not available in this version" | value `xs`…`xl`, `md` when unmarked, `mixed` |
| `size.increase` / `size.decrease` | Larger text / Smaller text | — | — | as `size.set`, plus "Already the largest size" / "Already the smallest size" | — |
| `link.open` | Link | `mod+k` | — | "Links can't go here" | active = hyperlink at the caret |

- Produces, the run semantics:
  - **Undo and redo** are enabled from `yUndoPluginKey.getState(state)?.undoManager.undoStack.length` (or `redoStack`). They fall back to `editor.can().undo()` when the plugin is absent, as in tests.
  - **Mark** runs use `toggleMark` in one chain.
  - **`format.clear`** is one transaction. It calls `tr.removeMark(from, to, type)` for every `schema.marks` type except `hyperlink`, over each selection range. With an empty selection, it keeps only the stored hyperlink marks instead.
  - **`size.set("md")`** calls `unsetMark("fontSize")`. Other values call `setMark("fontSize", { size })`; an empty selection gets a stored mark.
  - **`size.increase` / `size.decrease`** step through `["xs","sm","md","lg","xl"]`. From `mixed`, they step from `md` (Decision 3).
  - **`link.open`** runs the moved body of `openHyperlink` from `components/tiptap-ui/hyperlink-button/use-hyperlink.ts`.
- Produces, `registry.ts`:
  - `export const ACTIONS = [...historyActions, ...inlineActions, …] as const`. Leave it unannotated: each module declares its array `as const satisfies readonly Action[]`, so the ids stay literal;
  - `export type ActionId = (typeof ACTIONS)[number]["id"]`;
  - `export function getAction(id: ActionId): Action`;
  - `export function actionsInGroup(group: ActionGroup): readonly Action[]`.
- Produces, `run-action.ts`: `export function runAction(editor: Editor, action: Action | ActionId, arg?: unknown): boolean`. A string id resolves through `getAction`, so PR E's palette can call it with ids. It builds a **fresh** `computeContext` from the live state, never the memoized snapshot, and uses the store's reason and held id. If `computeView` says disabled it returns false; otherwise it returns `action.run(editor, arg)`.
- Produces, `lib/shortcuts.ts`: `export function toAriaKeyShortcuts(combo: KeyCombo, mac: boolean): string`, for example `mod+shift+z` → `Meta+Shift+Z` on macOS and `Control+Shift+Z` elsewhere; `alt+f10` → `Alt+F10`; `mod+\` → `Control+\`.
- Produces, `EditorActionShortcuts`, an `Extension` named `editorActionShortcuts` with `addKeyboardShortcuts` `{ "Mod-\\": () => runAction(this.editor, getAction("format.clear")) }`. Task 6 adds `Alt-F10`.

- [ ] **Step 1: Write the failing tests**

```ts
describe("format.clear", () => {
  it("removes every inline mark but keeps the link, block type, alignment and indent", () => {
    // centred, indented H2 with bold+italic+inlineCode+hyperlink+fontSize text; select all of it; run
    // marks left on the text === ["hyperlink"]; heading level, textAlign, indent attrs unchanged
  });
  it("is disabled in code with 'Code has no formatting'", () => {});
  it("runs from Mod-\\ as one undo step", () => {});
});
describe("size", () => {
  it("mixed heading and paragraph selection disables size with 'Headings scale automatically'", () => {});
  it("steps md -> lg and xl -> disabled 'Already the largest size'", () => {});
  it("md removes the mark; an empty selection stores it", () => {});
});
describe("marks", () => {
  it("reports mixed when part of the range is bold", () => {});
  it("undo reads the UndoManager stack, not editor.can()", () => { /* collab test editor: spy can(), expect not called */ });
});
describe("registry", () => {
  it("has unique ids, a label and icon each, and valid contexts", () => {});
  it("gives every shortcut an aria form", () => { /* toAriaKeyShortcuts(non-empty) for mac and not */ });
  it("binds every displayed shortcut (#612)", () => {
    // for each action with a shortcut: put the editor in a context where it is enabled, then
    // expect(editor.commands.keyboardShortcut(toProseMirrorKey(action.shortcut))).toBe(true)
    // (toProseMirrorKey: "mod+shift+z" -> "Mod-Shift-z"; a test-local helper). Drop any hint that fails rather than binding a new key.
  });
  it("returns the read-only reason for every action when not editable", () => {
    // setReadOnlyReason("Document is over the size limit"); setEditable(false)
    // every ACTIONS view: enabled false, reason "Document is over the size limit"
  });
});
it("runAction rechecks the live doc, not a stale view", () => { /* view enabled, then doc changes; runAction returns false */ });
```

`shortcuts.test.ts`: `it.each` over the examples in the Interfaces block.

- [ ] **Step 2: Run them and confirm they fail**

Run: `bun test tests/unit/editor-actions tests/unit/lib/shortcuts.test.ts`
Expected: FAIL. The modules are missing.

- [ ] **Step 3: Implement** as the Interfaces block says. Reuse `isMarkInSchema` from `lib/editor-utils.ts`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `bun test tests/unit && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit** after approval

```bash
git add lib/editor-actions lib/shortcuts.ts extensions/editor-action-shortcuts components/document-editor/document-editor-config.ts tests
git commit -m "feat(editor-actions): register history, inline, size and link actions"
```

---

### Task 4: Text style, list, alignment, indent and insert actions

Spec §2 (indent mirrors Tab), §4.1 (style dropdown with Title and *Mixed*; List with task #104; Insert with image, embed, table, quote, code, diagram, divider).

**Files:**
- Create: `lib/editor-actions/actions/text-style.ts`, `list.ts`, `align.ts`, `indent.ts`, `insert.ts`, `lib/editor-actions/ui-requests.ts`
- Move pure helpers out of the tiptap-ui hooks (their folders are deleted in Task 8):
  - `getTextStyleValue` and `setTextStyle` (from `heading-dropdown-menu/use-heading-dropdown-menu.ts`);
  - `toggleList`, `setListTypeInPlace`, `canToggleList` and `isListActive` (from `list-button/use-list.ts`);
  - `getListValue` and `setListType` (from `list-dropdown-menu/use-list-dropdown-menu.ts`);
  - `listItemTypes`, `canApplyIndent` and `applyIndent` (from `indent-button/indent-button.tsx`);
  - `insertImage` (from `image-upload-button/use-image-upload.ts`).
- Test: move `tests/unit/components/indent.test.ts` → `tests/unit/editor-actions/indent.test.ts` and `tests/unit/components/text-style.test.ts` → `tests/unit/editor-actions/text-style.test.ts`, updating their imports. Create `tests/unit/editor-actions/block-actions.test.ts`.

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces, the actions:

| id | arg | label | shortcut | reasons | value |
|---|---|---|---|---|---|
| `style.set` | `Exclude<TextStyleValue,"title">` | Text style | — | in title: "Title is always H1"; otherwise: "Not available here" | `ctx.blockStyle` |
| `list.set` | `"bulletList" \| "orderedList" \| "taskList" \| "none"` | List | — | "Lists can't go here" | current list or `none` |
| `align.set` | `"left" \| "center" \| "right" \| "justify"` | Alignment | — | "Alignment works in paragraphs and headings" | current `textAlign`, default `left` |
| `block.indent` | — | Indent | `tab` | "Indent works in paragraphs, quotes and list items" | — |
| `block.outdent` | — | Outdent | `shift+tab` | "Nothing to outdent here" | — |
| `insert.image` | — | Image | — (today's `mod+shift+i` hint is unbound, so it is dropped) | "Images can't go here" | — |
| `insert.embed` | — | Embed | — | "Embeds can't go here" | — |
| `insert.table` | — | Table | — | inside a table: "Tables can't go inside tables"; otherwise: "Tables can't go here" | — |
| `insert.quote` | — | Quote | `mod+shift+b` | "Quotes can't go here" | active when inside a blockquote |
| `insert.codeBlock` | — | Code block | `mod+alt+c` | "Code blocks can't go here" | active in code |
| `insert.diagram` | — | Diagram | — | "Diagrams can't go here" | — |
| `insert.divider` | — | Divider | — | "Dividers can't go here" | — |

- Produces, the run semantics:
  - **List and indent** `can()` checks use `ctx.lazy`.
  - **`insert.table`** runs `insertTable({ rows: 3, cols: 3, withHeaderRow: true })`.
  - **`insert.diagram`** runs `insertMermaid()`; **`insert.divider`** runs `setHorizontalRule()`.
  - **Quote and code block** toggle the current block.
  - **`insert.embed`** runs `requestUi(editor, "openEmbed")`.
- Produces, `ui-requests.ts`:
  - `export type UiRequest = "focusToolbar" | "openEmbed"`;
  - `export function registerUiRequest(editor: Editor, kind: UiRequest, handler: () => boolean): () => void`, backed by `WeakMap<Editor, Map<UiRequest, handler>>`; unregister removes only its own handler;
  - `export function requestUi(editor: Editor, kind: UiRequest): boolean`, which returns false when no handler is registered.

- [ ] **Step 1: Write the failing tests** (`block-actions.test.ts`; the moved tests keep their bodies)

```ts
it("style.set value is 'mixed' across a heading and a paragraph", () => {});
it("style.set is disabled in the title with 'Title is always H1'", () => {});
it("indent mirrors Tab in a bullet list, a task list and a two-item range", () => {}); // reuse indent.test cases via runAction
it("align.set sets and reads alignment", () => {});
it("insert.table inserts a 3x3 table with a header row and puts the caret in the first cell", () => {
  // table.childCount === 3; first row cells are tableHeader; ctx kind === "table"
});
it("insert.table is disabled inside a table with 'Tables can't go inside tables'", () => {});
it("insert.divider inserts a horizontal rule", () => {});
it("insert.embed asks the registered handler and returns false without one", () => {});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `bun test tests/unit/editor-actions`
Expected: FAIL. `block-actions` cannot find the actions.

- [ ] **Step 3: Implement.** Move the helpers instead of copying them. The tiptap-ui hooks import from the new location until Task 8 deletes them.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `bun test tests/unit && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit** after approval

```bash
git add lib/editor-actions components/tiptap-ui tests/unit
git commit -m "feat(editor-actions): register text style, list, align, indent and insert actions"
```

---

### Task 5: Section, code, table and media actions (slot contents)

Spec §4.2 (the slot table; `section.*` shared with TOC and the drag handle; vanished targets) and §7 (section lists cached by doc identity).

**Files:**
- Create: `lib/editor-actions/actions/section.ts`, `code.ts`, `table.ts`, `media.ts`
- Test: `tests/unit/editor-actions/slot-actions.test.ts`

**Interfaces:**
- Consumes: `getSectionIndex`, `sectionMoveTarget` (Task 1), `moveSection` from `lib/editor-utils.ts`, `sanitizeCodeLanguage` from `components/document-editor/safe-code-block.ts`, and `openMediaToolbar` / `closeMediaToolbar` from `@docs.plus/extension-hypermultimedia`.
- Produces, the actions:

| id | label | contexts | reasons | active / value / run |
|---|---|---|---|---|
| `section.fold` | Fold section | heading | gone: "This heading is gone" | active = `headingFoldPluginKey` state `foldedIds.has(id)`; run `toggleFold(id)` |
| `section.moveUp` | Move section up | heading | "This heading is gone", "Already first at this level" | run `moveSection(view, from, to, target)` |
| `section.moveDown` | Move section down | heading | "This heading is gone", "Already last at this level" | same |
| `code.setLanguage` | Code language | code, mermaid | "No code block here" | value `ctx.codeLanguage ?? "plaintext"`; run `updateAttributes("codeBlock", { language })` only if `sanitizeCodeLanguage(arg)` returns it |
| `code.copy` | Copy code (mermaid: Copy source) | code, mermaid | "No code block here"; no clipboard: "Copying isn't available here" | run `navigator.clipboard.writeText(node.textContent)` and returns true |
| `table.addRowBefore` / `addRowAfter` / `deleteRow` | Insert row above / Insert row below / Delete row | table | "Not available here" | TableKit commands |
| `table.addColumnBefore` / `addColumnAfter` / `deleteColumn` | Insert column left / Insert column right / Delete column | table | same | same |
| `table.toggleHeaderRow` | Header row | table | same | active = first row cells are `tableHeader` |
| `table.mergeOrSplit` | Merge cells / Split cell (label from `value`) | table | "Select cells to merge" | value `"merge"` or `"split"`; run `mergeOrSplit()` |
| `media.options` | Media options… | media | "No media selected" | run `openMediaToolbar({ target: view.nodeDOM(pos), editor, nodeType, nodePos: pos })`; returns whether an element came back |

- Section `enabled()` order:
  1. `ctx.headingId === null` or `ctx.heldHeadingId !== null && ctx.heldHeadingId !== ctx.headingId` → "This heading is gone" (Decision 9);
  2. no move target → the edge reason.
- Code languages, exported as `CODE_LANGUAGES: readonly { value: string; label: string }[]` (all in lowlight `common`):
  - plaintext "Plain text", bash "Bash", c "C", cpp "C++", csharp "C#", css "CSS", diff "Diff", go "Go", java "Java", javascript "JavaScript", json "JSON", kotlin "Kotlin", markdown "Markdown", php "PHP", python "Python", ruby "Ruby", rust "Rust", sql "SQL", swift "Swift", typescript "TypeScript", xml "HTML / XML", yaml "YAML";
  - plus mermaid "Mermaid diagram" (Decision 6).

- [ ] **Step 1: Write the failing tests**

```ts
it("section.moveUp swaps with the previous same-level section in one undo step", () => {
  // title, H2 A + p, H2 B(caret) + p -> run -> order is title, B, A; one undo restores
});
it("section.moveUp under a parent heading is disabled with 'Already first at this level'", () => {});
it("section.moveDown at the last section is disabled with 'Already last at this level'", () => {});
it("section actions say 'This heading is gone' when the held heading differs", () => {
  // hold() in H2 B; delete B with a transaction; the caret maps into A -> view reason; runAction -> false, doc unchanged
});
it("code.setLanguage ignores unsafe names", () => { /* "js onerror=x" -> language unchanged */ });
it("code.setLanguage turns a diagram into code and back", () => {}); // kind mermaid <-> code
it("table.mergeOrSplit reads merge for a 2-cell CellSelection and split for a merged cell", () => {});
it("table.toggleHeaderRow is active in a table with a header row", () => {});
it("media.options calls openMediaToolbar with the selected node", async () => {
  // mock.module("@docs.plus/extension-hypermultimedia", () => ({ ...real, openMediaToolbar: spy })); then await import()
  // NodeSelection on an image -> spy called with { nodeType: "image", nodePos: pos }
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `bun test tests/unit/editor-actions/slot-actions.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**, and add the four modules to `ACTIONS`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `bun test tests/unit && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit** after approval

```bash
git add lib/editor-actions tests/unit/editor-actions
git commit -m "feat(editor-actions): register section, code, table and media actions"
```

---

### Task 6: Keyboard model: one Tab stop, Alt+F10, Esc and act on click

Spec §6 "Plus:" (deferred from PR A), §4.6 (items collected at keydown, filtered by `checkVisibility()`), and two PR A carry-overs: "stale arrow index can move focus inside the toolbar" and "floating variant clips the 2px outline".

**Files:**
- Modify: `components/ui/toolbar.tsx`, `extensions/editor-action-shortcuts/editor-action-shortcuts.ts` (`Alt-F10`), `components/document-editor/document-editor.tsx`
- Test: `tests/unit/components/toolbar.test.tsx`, `tests/e2e/toolbar-keyboard.spec.ts`

**Interfaces:**
- Consumes: `registerUiRequest`, `requestUi` (Task 4).
- Produces, `Toolbar` props: `onEscape?: () => void`. It is called on an Esc keydown whose target is a roving item, when the event is not `defaultPrevented`.
- Produces, the `Toolbar` DOM contract:
  - Items are `button, [role="button"], [role="spinbutton"], [data-toolbar-item]`, excluding descendants of `[data-roving-group]`, elements with `[data-roving-skip]`, and anything inside `[hidden]`. They are then filtered by `el.checkVisibility?.() ?? true`. Items are collected **at keydown**.
  - The toolbar writes `tabindex` on every item: exactly one `"0"` (the tab stop) and the rest `"-1"`.
  - A `MutationObserver` re-normalizes on `childList`, `subtree` and `attributes: ["tabindex", "hidden"]`. It writes only when a value differs, so it never loops.
  - The tab stop follows `focusin`.
  - A removed tab stop passes to the item at the same index, clamped. PR A's focus repair is kept.
- Produces, the toolbar's `onMouseDown`: `preventDefault()` when the target is inside an item and not inside `input, textarea, [contenteditable]`. Actions still run on `click`.
- Produces: `export function focusRovingItem(toolbar: HTMLElement | null): boolean` focuses the tab stop, or the first item when there is none.
- Produces, `EditorActionShortcuts` gains `"Alt-F10": () => requestUi(this.editor, "focusToolbar")`.
- Produces, in `document-editor.tsx`:
  - `registerUiRequest(editor, "focusToolbar", () => focusRovingItem(toolbarRef.current))` in an effect, unregistered on cleanup;
  - `<Toolbar onEscape={() => editor?.commands.focus()}>`, which restores the ProseMirror selection.
- Produces: the floating variant uses `overflow-visible` instead of `overflow-hidden`.
- Note: PR A's `[tabindex="0"]` clause is dropped. Once the toolbar writes `-1`, an item matched only by that clause would fall out of the next collection. A non-button item opts in with `data-toolbar-item`.
- Removes: `useMenuNavigation` from `toolbar.tsx`, and the effect that focused `items[selectedIndex]`. `hooks/use-menu-navigation.ts` stays for menus.

The keydown algorithm. It is the fix for the stale index: the index comes from focus now, never from state.

```ts
const list = collectItems();
const current = list.findIndex((el) => el.contains(document.activeElement));
const next = { ArrowRight: current + 1, ArrowLeft: current - 1, Home: 0, End: list.length - 1 }[event.key];
if (next === undefined || list.length === 0) return;
event.preventDefault();
list[(next + list.length) % list.length].focus();
```

- [ ] **Step 1: Write the failing tests**

Unit (`toolbar.test.tsx`; PR A's focus-repair and nested-group tests stay):

```ts
it("exactly one item is tabbable", () => { /* [A,B,C] tabindex ["0","-1","-1"] */ });
it("arrow keys move from the focused item, not a stale index", () => {
  // focus C programmatically (no arrow), dispatch ArrowRight -> A (wraps); focus B, remove A, ArrowRight -> C
});
it("the tab stop follows focus and survives a re-render", () => {});
it("a removed tab stop passes to its neighbour", () => {});
it("skips hidden and data-roving-skip items", () => {});
it("Escape on an item calls onEscape; inside a roving group it does not", () => {});
it("mousedown on an item is default-prevented; on an input it is not", () => {});
it("the floating variant does not clip outlines", () => { /* no overflow-hidden class */ });
```

e2e (`toolbar-keyboard.spec.ts`; reuse `openToolbarTestDoc` from PR A's `helpers/a11y.ts`):

```ts
test("the toolbar is one Tab stop", async ({ page }) => {
  // Alt+F10 -> focus in toolbar; Tab -> activeElement outside the toolbar; Shift+Tab -> back on the same item
});
test("Alt+F10 moves focus to the toolbar and Esc returns with the selection", async ({ page }) => {
  // type "hello world", select "world" (Shift+ArrowLeft x5), Alt+F10, ArrowRight x2, Escape
  // editor focused; window.getSelection().toString() === "world"
});
test("Esc inside an open menu closes it and focus returns to its trigger", async ({ page }) => {});
test("every toolbar menu opens by mouse and the editor keeps its selection", async ({ page }) => {
  // for Text style, List, Alignment, Insert, More formatting, Highlight: click -> role menu/dialog visible,
  // Escape; the editor selection text is unchanged after each
});
test("arrowing after a toolbar re-render moves one step from the focused item", async ({ page }) => {
  // Alt+F10, focus Italic via arrows; a doc change via __tiptap_editor (focus stays in toolbar);
  // wait TOOLBAR_SETTLE_MS + 100; ArrowRight -> the item right of Italic is focused
});
test("a focused first and last item keep their 2px outline inside the toolbar", async ({ page }) => {
  // outline box = button rect inflated by 4px lies within the toolbar's rect (fixed variant)
});
```

Task 8 lands the menus that the "by mouse" test names. Until then, run it against the menus that exist and finish it in Task 8.

- [ ] **Step 2: Run them and confirm they fail**

Run: `bun test tests/unit/components/toolbar.test.tsx`
Expected: FAIL. Every item has `tabindex="-1"`, and the stale-index case focuses B.

Run: `E2E_BASE_URL=http://localhost:3700 CI= bun playwright test tests/e2e/toolbar-keyboard.spec.ts --project=chromium`
Expected: FAIL. Alt+F10 does nothing.

- [ ] **Step 3: Implement** as the Interfaces block says. Remove `tabIndex={-1}` from the remaining toolbar controls in `components/tiptap-ui` and `components/document-editor`. Leave the elements inside `[data-roving-group]` alone: PR A's highlight swatch grid manages its own tabindex.

- [ ] **Step 4: Run the tests and confirm they pass**, plus PR A's `toolbar.spec.ts` and `toolbar-a11y.spec.ts`

Run: `bun test tests/unit/components && E2E_BASE_URL=http://localhost:3700 CI= bun playwright test tests/e2e/toolbar-keyboard.spec.ts tests/e2e/toolbar.spec.ts tests/e2e/toolbar-a11y.spec.ts --project=chromium`
Expected: PASS.

- [ ] **Step 5: Commit** after approval

```bash
git add components/ui/toolbar.tsx extensions/editor-action-shortcuts components/document-editor components/tiptap-ui tests
git commit -m "feat(toolbar): one Tab stop with roving focus, Alt+F10 and Esc to the editor"
```

---

### Task 7: Row control primitives, the style menu and the size stepper

Spec §4.1 (the style dropdown previews each style, shows Title disabled with a reason and *Mixed*; the size `spinbutton` with `aria-valuetext`) and §6.4 (menu buttons named by value, `aria-haspopup="menu"`, no `aria-pressed`, `menuitemradio`).

**Files:**
- Create: `components/editor-toolbar/action-button.tsx`, `action-menu.tsx`, `style-menu.tsx`, `size-stepper.tsx`, `index.ts`
- Modify: `lib/icons.tsx`. Add `MoreHorizontalIcon`, `LockIcon`, `CopyIcon`, `MinusIcon`, `TableIcon`, `ArrowUpIcon`, `ArrowDownIcon`, `ChevronsDownUpIcon` (fold), `RemoveFormattingIcon`, `ImageIcon`, `SeparatorHorizontalIcon`, `Rows3Icon`, `Columns3Icon`, `TableCellsMergeIcon`, `SlidersHorizontalIcon` (media options), all from `lucide-react`.
- Test: `tests/unit/components/editor-toolbar/action-button.test.tsx`, `action-menu.test.tsx`, `size-stepper.test.tsx`

**Interfaces:**
- Consumes: `useActionView`, `runAction`, `toAriaKeyShortcuts`, `isMac`, and PR A's `ToolbarButton` (`isActive`, `disabledReason`, `aria-pressed`).
- Produces, `ActionButton`:
  - Props: `{ action: Action; editor?: Editor | null; arg?: unknown; label?: string; children?: React.ReactNode } & Omit<ToolbarButtonProps, "onClick" | "disabled" | "tabIndex">`.
  - It renders a `ToolbarButton` with:
    - `aria-label = label ?? action.label`;
    - the tooltip `label`, plus `ShortcutDisplay`, plus `markdownHint` in muted text;
    - `aria-keyshortcuts` from `toAriaKeyShortcuts`;
    - `aria-pressed = mixed ? "mixed" : active` when the action has `isActive`;
    - `disabled = !view.enabled` with `disabledReason = view.reason`;
    - `onClick` → `runAction(editor, action, arg)`.
- Produces, `ActionMenu`:
  - Props: `{ action: Action; options: readonly MenuOption[]; triggerLabel: (value: string | null) => string; triggerIcon?: (value: string | null) => IconComponent; tooltip: string; showLabel?: boolean; editor?: Editor | null }`, where `MenuOption = { value: string; label: string; icon?: IconComponent; className?: string; disabledReason?: string }`.
  - It is a Base UI `DropdownMenu`. The trigger carries `aria-haspopup="menu"`, no `aria-pressed`, and is named by `triggerLabel(view.value)`.
  - Options are `DropdownMenuRadioItem closeOnClick` inside a `DropdownMenuRadioGroup` with the value `view.value`.
  - The content carries `data-toolbar-popup`.
  - Picking runs `runAction(editor, action, value)`.
  - PR A's `picked` / `finalFocus` pattern (`heading-dropdown-menu.tsx`) moves here. After a pick, focus goes to the editor; after Esc or an outside click, it goes to the trigger.
- Produces, `StyleMenu`, an `ActionMenu` over `style.set`:
  - Options are Normal text and Heading 1–6. Each carries `className` `text-style-preview-<value>`, a font size and weight from the editor's heading scale.
  - The trigger reads "Mixed" for `mixed` and "Title" for `title`.
  - In the title, every option is disabled, and a first non-interactive row says "Title is always H1", referenced by `aria-describedby` (PR A copy).
- Produces, `SizeStepper`:
  - It renders `[−][spinbutton][+]`.
  - The spinbutton is a `div role="spinbutton" aria-label="Font size" aria-valuemin={0} aria-valuemax={4}`, with `aria-valuenow` set to the index (omitted for mixed) and `aria-valuetext` from `SIZE_TEXT`.
  - Its visible text is `XS`, `S`, `M`, `L`, `XL` or `Mixed`.
  - ArrowUp and ArrowDown run `size.increase` / `size.decrease`; Home and End run `size.set("xs")` / `size.set("xl")`.
  - When disabled, it has `aria-disabled` and an `aria-describedby` reason.
  - − and + are 24×24 `ToolbarButton`s with `data-roving-skip`, `tabIndex={-1}` and `aria-hidden="true"`. They are mouse affordances; the spinbutton is the keyboard and AT control.
  - `SIZE_TEXT`: xs "Extra small, about 12 pixels", sm "Small, about 14 pixels", md "Medium, 16 pixels", lg "Large, about 20 pixels", xl "Extra large, about 24 pixels", mixed "Mixed".

- [ ] **Step 1: Write the failing tests**

```ts
it("ActionButton renders aria-keyshortcuts Control+B off macOS and Meta+B on macOS", () => {});
it("ActionButton is aria-pressed mixed when part of the selection is bold", () => {});
it("ActionButton takes its disabled reason from the view and ignores clicks", () => {});
it("ActionButton re-renders only when its view changes", () => {}); // render counter, caret move in paragraph
it("ActionMenu trigger is named by its value with aria-haspopup=menu and no aria-pressed", () => {});
it("StyleMenu reads Mixed across a heading and a paragraph and Title in the title", () => {});
it("SizeStepper reads 'Large, about 20 pixels' and steps with ArrowUp", () => {});
it("mixed heading and paragraph selection disables size with 'Headings scale automatically' and valuetext Mixed", () => {});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `bun test tests/unit/components/editor-toolbar`
Expected: FAIL. The modules are missing.

- [ ] **Step 3: Implement** as the Interfaces block says.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `bun test tests/unit/components && bun run typecheck && bun biome check components/editor-toolbar lib/icons.tsx`
Expected: PASS.

- [ ] **Step 5: Commit** after approval

```bash
git add components/editor-toolbar lib/icons.tsx tests/unit/components/editor-toolbar
git commit -m "feat(toolbar): add action buttons, menus, the style menu and the size stepper"
```

---

### Task 8: The sorted row on the registry

Spec §4.1 (row anatomy and order; List with task; Insert; ⋯) and §2 ("every command is one Action"; read-only reasons).

**Files:**
- Create: `components/editor-toolbar/align-menu.tsx`, `list-menu.tsx`, `insert-menu.tsx`, `overflow-menu.tsx`
- Modify: `components/document-editor/main-toolbar-content.tsx`, `components/tiptap-ui/media-embed-popover/media-embed-popover.tsx`, `components/document-editor/document-editor.tsx`, `components/tiptap-ui/color-highlight-popover/color-highlight-popover.tsx`, `components/tiptap-ui/color-highlight-button/use-color-highlight.ts`, `hooks/use-action-view.ts`
- Delete, after `git grep` shows no importer outside the deleted set: `components/tiptap-ui/{mark-button,heading-button,heading-dropdown-menu,list-button,list-dropdown-menu,text-align-button,indent-button,undo-redo-button,blockquote-button,code-block-button,mermaid-button,image-upload-button,hyperlink-button,shortcut-badge}`, and `shouldShowEditorButton` in `lib/editor-utils.ts` if nothing else uses it.
- Test: `tests/e2e/toolbar-row.spec.ts`. Modify `tests/e2e/toolbar.spec.ts` and `toolbar-a11y.spec.ts` for the new menus and the read-only behaviour.

**Interfaces:**
- Consumes: Tasks 3–7.
- Produces, the row order (│ = `ToolbarSeparator`; each bracket is a `ToolbarGroup` with the `aria-label` shown):

```
[Outline, Filter]{View, desktop only} <Spacer>
│ [Undo, Redo]{History}
│ [StyleMenu, SizeStepper]{Text style}
│ [Bold, Italic, Underline, Strike, Highlight (existing popover / mobile panel button), Link]{Formatting}
│ [AlignMenu, ListMenu, Outdent, Indent]{Paragraph}
│ [ContextSlot]                       (Task 9; render an empty 168px placeholder until then)
│ [InsertMenu, OverflowMenu]{Insert}
<Spacer> [ThemeToggle]
```

- Produces, the menus:
  - **`AlignMenu`:** an `ActionMenu` over `align.set`. Options: left "Align left", center "Align center", right "Align right", justify "Justify". The trigger is icon-only, named by the value label, with the tooltip "Alignment".
  - **`ListMenu`:** an `ActionMenu` over `list.set`. Options: none "No list", bulletList "Bullet list", orderedList "Numbered list", taskList "Task list". The trigger is named by the value label.
  - **`InsertMenu`:** a plain menu (`DropdownMenuItem`, not radio), with the trigger "Insert" plus `PlusIcon`. Items in order: Image, Embed, Table, Quote, Code block, Diagram, Divider. Each item takes its label, icon and reason from its action. A disabled item is `aria-disabled` with an `aria-describedby` reason. Embed closes the menu and opens `MediaEmbedPopover` anchored to the Insert trigger, through the `"openEmbed"` handler this component registers.
  - **`OverflowMenu`:** trigger "More formatting" with `MoreHorizontalIcon`. Superscript, Subscript and Inline code are `DropdownMenuCheckboxItem`s (checked = active); then a separator; then Clear formatting (`DropdownMenuItem`, showing `⌘\` / `Ctrl+\`).
- Produces, `MediaEmbedPopover`: optional `open`, `onOpenChange` and `anchor: HTMLElement | null`. Without them it keeps its own trigger (used nowhere after this task, so drop the trigger branch if `git grep` confirms).
- Produces, the highlight popover. `components/tiptap-ui/color-highlight-popover/color-highlight-popover.tsx` and `color-highlight-button/use-color-highlight.ts` no longer `return null` when the editor is not editable, because that would reorder the row. The trigger stays rendered, `disabled`, with `disabledReason` from `useReadOnlyReason()`.
- Produces, `useReadOnlyReason(providedEditor?: Editor | null): string | null` in `hooks/use-action-view.ts`. It returns null while editable, else `ctx.readOnlyReason ?? READ_ONLY_FALLBACK`, through `useSyncExternalStore` on the store.
- Keep `shouldShowEditorButton` while anything still imports it.
- Produces, in `document-editor.tsx`: an effect that calls `getEditorVersionStore(editor).setReadOnlyReason(SHORT_REASONS[rejectedReason] ?? null)` **before** `setEditable`. `SHORT_REASONS`:
  - `DOCUMENT_TOO_LARGE_REASON`: "Document is over the size limit";
  - `DOCUMENT_DELETED_REASON`: "Document was deleted";
  - `OFFLINE_BUDGET_REASON`: "Editing resumes when you're back online".

- [ ] **Step 1: Write the failing e2e tests** (`toolbar-row.spec.ts`)

```ts
test("the row order is the same in a paragraph, a heading and a code block", async ({ page }) => {
  // accessible names of roving items outside [data-slot=context-slot], in DOM order, are identical
  // in all three contexts and equal EXPECTED_ROW (Toggle outline, Filter…, Undo, Redo, Normal text, Font size,
  // Bold, Italic, Underline, Strike, Highlight, Link, Align left, No list, Outdent, Indent, Insert, More formatting, theme)
});
test("read-only keeps every control in place, says why, and keeps focus on the same control", async ({ page }) => {
  // focus Indent via Alt+F10 + arrows; set __tiptap_editor.setEditable(false)
  // same names as before; every registry control and the Highlight trigger is aria-disabled
  // (Toggle outline, Filter and the theme toggle stay enabled); Indent's description is
  // "Document is read-only"; activeElement is the same Indent element
});
test("Insert > Table inserts a table", async ({ page }) => {});
test("Insert > Embed opens the embed popover anchored to Insert", async ({ page }) => {});
test("More formatting > Clear formatting keeps the link", async ({ page }) => {});
test("List offers bullet, numbered and task lists and switches in place", async ({ page }) => {});
test("the size stepper sets Large and the spinbutton announces it", async ({ page }) => {});
```

Update PR A's "focus stays in the toolbar when the document turns read-only" e2e to assert the **same element**, as Review Focus 2 says.

- [ ] **Step 2: Run them and confirm they fail**

Run: `E2E_BASE_URL=http://localhost:3700 CI= bun playwright test tests/e2e/toolbar-row.spec.ts --project=chromium`
Expected: FAIL. The order differs, and controls disappear in read-only.

- [ ] **Step 3: Implement the row, then delete the replaced folders.** Run `git grep -n "tiptap-ui/(mark-button|heading-dropdown-menu|…)" -E` first, to confirm that nothing outside them imports them.

- [ ] **Step 4: Run every check and confirm it passes**

Run: `bun run test && bun run typecheck && bun run lint && bun biome check . && E2E_BASE_URL=http://localhost:3700 CI= bun playwright test --project=chromium`
Expected: PASS, including Task 6's "every toolbar menu opens by mouse" with all six menus. Take light and dark screenshots of the row in a paragraph and in a heading, and attach them to the PR.

- [ ] **Step 5: Commit** after approval

```bash
git add -A components lib hooks tests
git commit -m "feat(toolbar): sort the row and move every control onto the action registry"
```

---

### Task 9: The context slot

Spec §4.2 (contents per context; fixed width; `role="group"` with a changing `aria-label`; no live region; empty = hidden from AT; immediate on selection; `hold()`; vanished targets) and §6.6 (slot changes under focus never drop focus).

**Files:**
- Create: `components/editor-toolbar/context-slot.tsx`, `slot-heading.tsx`, `slot-code.tsx`, `slot-table.tsx`, `slot-media.tsx`, `use-toolbar-hold.ts`
- Modify: `components/document-editor/main-toolbar-content.tsx` (replace the placeholder), `components/document-editor/document-editor.tsx` (`useToolbarHold(editor, toolbarRef)`), `app/globals.css` (`--context-slot-width: 168px`)
- Test: `tests/unit/components/editor-toolbar/context-slot.test.tsx`, `tests/e2e/toolbar-slot.spec.ts`

**Interfaces:**
- Consumes: `useSlotKind`, `getEditorVersionStore(editor).hold`, `ActionButton`, `ActionMenu`, and the Task 5 actions.
- Produces, `ContextSlot({ editor? })`, which reads `useSlotKind()`:
  - **paragraph, list, readonly:** `<div data-slot="context-slot" aria-hidden="true">`, with no role, at the fixed width.
  - **Other kinds:** `<div data-slot="context-slot" role="group" aria-label={SLOT_LABELS[kind]}>`, where `SLOT_LABELS`:
    - heading "Section tools", title "Title", code "Code block tools", mermaid "Diagram tools", table "Table tools", media "Media tools".
  - **heading:** `ActionButton`s for `section.fold`, `section.moveUp` and `section.moveDown`.
  - **title:** a `LockIcon` (`aria-hidden`) plus the visually hidden text "Title is always H1".
  - **code and mermaid:** an `ActionMenu` over `code.setLanguage` (options `CODE_LANGUAGES`, label truncated) and an `ActionButton` for `code.copy`. Its label is "Copy source" in mermaid. After a successful copy it shows `CheckIcon` for 1500 ms; the timer is cleared on unmount.
  - **table:** a "Row" menu (`addRowBefore`, `addRowAfter`, `deleteRow`), a "Column" menu (`addColumnBefore`, `addColumnAfter`, `deleteColumn`), and `ActionButton`s for `table.toggleHeaderRow` and `table.mergeOrSplit`. The Row and Column triggers are named "Row" and "Column", with `aria-haspopup="menu"`, and their items are plain `DropdownMenuItem`s.
  - **media:** an `ActionButton` for `media.options`. After `runAction` returns true, it finds the kit toolbar inside `view.nodeDOM(pos)`, focuses its first `button`, and adds one `keydown` listener for Escape. That listener calls `closeMediaToolbar(wrapper)` and focuses the slot button. The listener is removed on close and on unmount (Decision 10).
- Produces, `useToolbarHold(editor: Editor | null, toolbarRef: RefObject<HTMLElement | null>): void`:
  - `focusin` inside the toolbar takes a hold if none is held.
  - `focusout` whose `relatedTarget` is outside both the toolbar and `[data-toolbar-popup]` releases it.
  - Cleanup and an editor change also release it (§7: `focusout` is not guaranteed).

- [ ] **Step 1: Write the failing tests**

Unit:

```ts
it("an empty slot is aria-hidden with no role and keeps its width", () => {});
it("a heading slot is a group named 'Section tools' with Fold section, Move section up, Move section down", () => {});
it("unmounting the toolbar releases the hold", () => {
  // focus a slot button (hold taken), unmount; move the caret -> store.getSlotKind() follows the live kind
});
it("the copied check icon timer is cleared on unmount", () => { /* fake timers; no setState warning */ });
```

e2e (`toolbar-slot.spec.ts`):

```ts
for (const ctx of ["paragraph", "list", "heading", "title", "code", "mermaid", "table", "media"] as const) {
  test(`slot contents and axe in ${ctx}`, async ({ page }) => {
    // place the caret / NodeSelection; expect the SLOT_LABELS group (or aria-hidden) and its named controls
    // expectNoSeriousA11yViolations(page) from PR A's helpers/a11y.ts, light and dark
  });
}
test("the slot follows a selection change without waiting for the settle window", async ({ page }) => {
  // click into a heading then into a code block; the label changes within 100 ms
});
test("Move section up moves the section and keeps focus on the button", async ({ page }) => {});
test("remote heading deletion while the slot is focused", async ({ browser }) => {
  // two contexts on one doc; page A: caret in H2 "Beta", Alt+F10, arrow to "Move section up"
  // page B deletes "Beta" via __tiptap_editor; on A, poll: the focused element is the same button,
  // aria-disabled="true", description "This heading is gone"; Enter -> the doc order on B is unchanged
});
test("Media options opens the media toolbar and Esc returns to the slot", async ({ page }) => {});
test("Copy code writes the block text to the clipboard", async ({ page, context }) => {
  // context.grantPermissions(["clipboard-read", "clipboard-write"])
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `bun test tests/unit/components/editor-toolbar/context-slot.test.tsx && E2E_BASE_URL=http://localhost:3700 CI= bun playwright test tests/e2e/toolbar-slot.spec.ts --project=chromium`
Expected: FAIL. There is no slot.

- [ ] **Step 3: Implement** as the Interfaces block says.

- [ ] **Step 4: Run the tests and confirm they pass**

Run the same commands, then the slot spec with `--repeat-each=5 --workers=3`.
Expected: PASS on every repeat.

- [ ] **Step 5: Commit** after approval

```bash
git add components/editor-toolbar components/document-editor app/globals.css tests
git commit -m "feat(toolbar): add the context slot"
```

---

### Task 10: Budgets: catch-up render, arrow latency, leaks and client JS size

Spec §7 (the D1 share), §8 D ("§7 asserted in CI; ≤ +6 KB gz via a new manifest size check"), and PR A carry-over "toolbar catch-up render ~90 ms per burst is not measured".

**Files:**
- Modify: `components/document-editor/toolbar-test-hooks.ts`, `components/document-editor/document-editor.tsx` (Profiler `onRender={recordToolbarRender}`), `types/window.d.ts` (`__toolbarRenderMs`, `__toolbarMountMs`, `__toolbarNotifyMs`), `tests/e2e/helpers/perf-observer.ts`, `tests/e2e/performance.spec.ts`, `.github/workflows/ci.yml`, `package.json`
- Create: `tests/e2e/toolbar-leaks.spec.ts`, `scripts/check-client-js-size.ts`, `scripts/client-js-baseline.json`, `tests/unit/scripts/check-client-js-size.test.ts`

**Interfaces:**
- Produces, `recordToolbarRender(id: string, phase: "mount" | "update" | "nested-update", actualDuration: number): void`. It is dev-only and a no-op in production.
  - It keeps incrementing `window.__toolbarCommits`.
  - It pushes update durations to `window.__toolbarRenderMs: number[]`.
  - It stores the largest mount duration in `window.__toolbarMountMs`.
  - Remove `countToolbarCommit` and update its callers.
- Produces, in `perf-observer.ts`: `injectSelectionTimer(page: Page): Promise<void>` and `collectSelectionLatencies(page: Page): Promise<number[]>`.
  - A capture `keydown` on `window` records `timeStamp` for arrow keys.
  - A `selectionchange` listener on `document` then posts a `MessageChannel` message. Its handler pushes `performance.now() - ts`, so a sample covers ProseMirror's selection dispatch, the snapshot and React's sync render.
  - Presses are sequential, so messages do not pile up.
- Produces, `scripts/check-client-js-size.ts`:
  - `export function totalGzipBytes(files: readonly string[]): number` uses `Bun.gzipSync` at level 9.
  - `export function checkBudget(total: number, baseline: number, budget: number): { ok: boolean; delta: number }`.
  - The CLI sums `.next/static/chunks/**/*.js`. `--record` writes `{ "gzipBytes": n, "commit": "<sha>" }` to `scripts/client-js-baseline.json`. Otherwise it fails when `delta > Number(process.env.CLIENT_JS_BUDGET_BYTES ?? 6144)`.
- Produces: the `package.json` script `"size:check": "bun scripts/check-client-js-size.ts"`, and a `ci.yml` checks-job step `bun run size:check` right after the build step.
- Produces, the gate lifecycle. A frozen whole-client baseline would otherwise fail unrelated PRs: PR E's lazy palette chunk and the daily docs.plus extension-refresh bot.
  - `CLIENT_JS_SIZE_GATE=enforce` makes an over-budget delta exit 1. Any other value prints the delta and exits 0 (advisory).
  - The CI step sets `CLIENT_JS_SIZE_GATE: ${{ startsWith(github.head_ref, 'feat/smart-toolbar-d') && 'enforce' || 'advisory' }}`, so the gate is enforced on D1 and D2 PRs only.
  - D2's last task re-records the baseline after D2 merges, which closes D's budget. The step stays advisory for everyone else.

- [ ] **Step 1: Record the baselines on the D1 base.** In a worktree at the A+C merge commit:

```bash
git worktree add ../editor-d1-base <A+C merge sha> && cd ../editor-d1-base && bun install && bun run build && bun scripts/check-client-js-size.ts --record
```

Copy the JSON into this branch. On that base, also log today's catch-up render once (temporarily sum `actualDuration` per burst in the console) and paste the number into the PR description.

- [ ] **Step 2: Write the failing tests**

```ts
// tests/unit/scripts/check-client-js-size.test.ts
it("passes at baseline + 6144 and fails at baseline + 6145", () => {});
it("is advisory unless CLIENT_JS_SIZE_GATE is 'enforce'", () => {});
// tests/e2e/performance.spec.ts (perf project)
test("the toolbar catch-up render per burst is bounded (500 headings, 4x CPU)", async ({ page }) => {
  // after load read __toolbarMountMs; reset __toolbarRenderMs and __toolbarNotifyMs; type 150 chars with delay 20; wait settle + 100
  // log both arrays' max and sum; expect(max render).toBeLessThanOrEqual(16); expect(max notify).toBeLessThanOrEqual(16)
  // expect(sum render + sum notify).toBeLessThanOrEqual(0.25 * mountMs)
});
test("arrow and shift+arrow p95 < 16 ms in a 500-heading doc", async ({ page }) => {
  // 1x CPU, toolbar mounted; 100 ArrowDown then 50 Shift+ArrowDown; p95 of collectSelectionLatencies < 16
});
// tests/e2e/toolbar-leaks.spec.ts
test("20 tab switches return listeners to baseline and heap within 5%", async ({ page }) => {
  // CDP DOMDebugger.getEventListeners on window and document; HeapProfiler.collectGarbage + Runtime.getHeapUsage
  // one warm-up round, baseline, 20 switches between the doc tab and Playground, collect again
  // listener counts equal; usedSize <= baseline * 1.05
});
```

- [ ] **Step 3: Run them and confirm the new assertions fail or are unwired**

Run: `bun test tests/unit/scripts && E2E_BASE_URL=http://localhost:3700 CI= bun playwright test --project=perf --no-deps && E2E_BASE_URL=http://localhost:3700 CI= bun playwright test tests/e2e/toolbar-leaks.spec.ts --project=chromium`
Expected: FAIL. `__toolbarRenderMs` is undefined and the script is missing.

- [ ] **Step 4: Implement**, then run the same commands, plus `bun run build && bun run size:check`.
Expected: PASS. If the render bound or the arrow p95 fails, stop and report the measured numbers. Do not relax a budget without the owner's approval.

- [ ] **Step 5: Commit** after approval

```bash
git add components/document-editor types tests scripts .github/workflows/ci.yml package.json
git commit -m "test(perf): bound toolbar catch-up render, arrow latency, leaks and client JS size"
```

`tests/unit/ci/workflow-permissions.test.ts` must still pass: the new step adds no permissions and no actions.

---

### Task 11: Outline jump scrolls the heading to the top

Spec §9 ("Outline jump scrolls to `block: "start"` per AGENTS.md"), AGENTS.md (caret at the heading's end, scroll deferred by `requestAnimationFrame`, which already holds), and the PR A carry-over.

**Files:**
- Modify: `components/toc-sidebar/toc-sidebar.tsx` (both `scrollIntoView` calls in `scrollHeadingIntoView`, the main one and the settle pass, become `block: "start"`; update the docstring)
- Test: `tests/e2e/toc-sidebar.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
test("clicking an outline item puts the heading at the top below the toolbar with the caret at its end", async ({ page }) => {
  // 50-heading doc; click item 30; poll after scrollend:
  // heading.top >= toolbar.bottom && heading.top <= toolbar.bottom + 24
  // selection is collapsed at the heading's last text position
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `E2E_BASE_URL=http://localhost:3700 CI= bun playwright test tests/e2e/toc-sidebar.spec.ts --project=chromium`
Expected: FAIL. The heading sits near the middle of the viewport.

- [ ] **Step 3: Implement** the two-word change.

- [ ] **Step 4: Run it and confirm it passes**, with the rest of the TOC spec.

- [ ] **Step 5: Commit** after approval

```bash
git add components/toc-sidebar/toc-sidebar.tsx tests/e2e/toc-sidebar.spec.ts
git commit -m "fix(outline): scroll a picked heading to the top of the page"
```

---

### Task 12: Docs and full verification

**Files:**
- Modify: `CHANGELOG.md`, `tests/TESTING.md`, `AGENTS.md`

- [ ] **Step 1: Write the docs**
  - `CHANGELOG.md`, under `[Unreleased]`: an "Added / Changed / Fixed" entry for PR D1, in PR A's style. Cover the sorted row, the context slot, one Tab stop + Alt+F10 + Esc, clear formatting `Mod-\` keeping links (#392), the task list in List (#104), shortcut hints with `aria-keyshortcuts` (#612), the size stepper, the TOC jump to the top, and the size gate. No Deploy note is needed: it is client-only and needs no env change.
  - `tests/TESTING.md`: the new specs, `__toolbarRenderMs` / `__toolbarMountMs`, the selection timer, `size:check` with `--record` (record only at a D base), and the 3700 / 1834 recipe.
  - `AGENTS.md`, Learned Workspace Facts: one line on `lib/editor-actions/` and the store's `getContext` / `getView` / `hold`; one line on the toolbar owning `tabindex` (controls never pass it; `data-roving-skip`, `data-roving-group`, `data-toolbar-popup`); one line on the CI `size:check` step.

- [ ] **Step 2: Run the full verification**

```bash
bun audit --audit-level=high && bun biome check . && bun run lint && bun run typecheck && bun run test && bun run build && bun run size:check
E2E_BASE_URL=http://localhost:3700 CI= bun playwright test --project=chromium --project=perf
E2E_BASE_URL=http://localhost:3700 CI= bun playwright test tests/e2e/toolbar-*.spec.ts --project=chromium --repeat-each=10 --workers=3
```

Expected: all PASS. Attach screenshots of the row and slot in paragraph, heading, code and table, light and dark, and record the measured budgets (render max/sum, arrow p95, size delta) in the PR description.

- [ ] **Step 3: Commit** after approval

```bash
git add CHANGELOG.md tests/TESTING.md AGENTS.md
git commit -m "docs: record the toolbar action registry, sorted row and context slot"
```

---

## Interfaces D2 consumes

- **Types:** `Action`, `Ctx`, `ActionView`, `ContextKind`, `ActionGroup`, `FontSizeValue`, `TextStyleValue` (`lib/editor-actions/types.ts`).
- **Registry:** `ACTIONS`, `ActionId`, `getAction`, `actionsInGroup`, and `runAction` (it returns `boolean`; D2's memory writes only on `true`).
- **Store:** `getEditorVersionStore(editor)` with `getContext`, `getView(action)`, `getSlotKind`, `hold`, `setReadOnlyReason`. Hooks: `useActionView`, `useSlotKind`, `useReadOnlyReason`.
- **UI requests:** `registerUiRequest` / `requestUi` (D2 adds `"focusBubble"` and `"openColorPopover"` kinds).
- **Components:** `ActionButton`, `ActionMenu`, `StyleMenu`, `SizeStepper`, `InsertMenu` (M10 face), `OverflowMenu` (D2 adds "Forget my choices"), `ContextSlot`, `useToolbarHold`.
- **Toolbar contract:** DOM-owned roving, `data-roving-skip`, `data-roving-group`, `data-toolbar-popup`, `focusRovingItem`, `onEscape`, and the floating variant without clipping (for the bubble).
- **Budgets:** `recordToolbarRender`, `__toolbarNotifyMs`, `injectSelectionTimer`, and `scripts/client-js-baseline.json`. D2 spends the rest of the 6144 bytes and re-records the baseline only after D2 merges.

## Self-review notes

- **Spec coverage:**
  - §2 → Tasks 1–5.
  - §4.1 → Tasks 7–8; A▾ is D2 (Decision 2).
  - §4.2 → Tasks 5 and 9.
  - §6 "Plus:" → Task 6.
  - §7, D1 share → Tasks 2, 9 and 10; bubble and palette cycles are D2.
  - §8 D → Task 10 (size gate, asserted budgets).
  - §9 outline jump → Task 11.
  - PR A carry-overs: catch-up render → Task 10; stale arrow index → Task 6; late max-wait → Task 2; floating outline → Task 6; TOC → Task 11.
- **Deferred with owner (D2):** §4.3–4.7, §5 memory, `scrollWidth <= clientWidth` per tier, memory tamper test, `NEXT_PUBLIC_REMEMBER_CHOICES=0`.
- **Type consistency:** `getView(action)`, `runAction(editor, action | id, arg)`, `useActionView(action, editor?)` and `requestUi(editor, kind)` are used with the same signatures in Tasks 2–10.
