# Smart toolbar PR A: accessibility and layout foundations, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the shared toolbar primitives so later toolbar work (PR D) builds on accessible, measurable foundations. That covers:
- focus ring, pressed state and forced colours;
- disabled-with-reason and focus repair;
- menu buttons and the highlight colour dialog;
- indent in lists;
- Focus Not Obscured;
- a toolbar update cap;
- CI gates for axe, commit count and typing latency.

**Architecture:** No new subsystems. The work edits:
- the shadcn `Button` and `ToolbarButton` primitives, the `Toolbar` container and `globals.css` tokens;
- the existing tiptap-ui dropdowns, the highlight popover and the indent button;
- the per-editor version store in `hooks/use-tiptap-editor.ts`.

Gates are Playwright specs. They read state through dev-only window hooks, the same pattern as `window.__tiptap_editor`.

**Tech Stack:** Next.js 16, React 19.3, Tiptap 3.33, Base UI 1.9, Tailwind 4, `bun test` (happy-dom), Playwright 1.65, new dev dependency `@axe-core/playwright`.

**Spec:** `docs/superpowers/specs/2026-11-12-smart-toolbar-design.md`. PR A is §8 item 1, which covers §6 and parts of §2 and §4.2. Its go criteria are §8 "Per-PR go criteria (HoE)", **A**.

## Global Constraints

**Tooling**
- Bun only: `bun`, `bun <bin>`, `bunx --bun`. Never npm, npx, yarn or pnpm. Add the dependency with `bun add -d`.
- Biome formats and lints; ESLint covers Next rules only; strict TypeScript.

**Code style**
- Named exports only. Kebab-case files.
- PascalCase components with title-case acronyms.
- Icons come from `lib/icons.tsx`.
- New UI uses shadcn components from `components/ui/`. Design tokens are shadcn CSS variables in `app/globals.css`.

**Commits**
- Conventional Commits, atomic, imperative mood.
- **No AI, tool or agent references and no trailers.** This overrides any `Co-Authored-By` reminder.
- Before every commit, show a commit review report (files, diff summary, message) and wait for explicit approval.

**Tests**
- `bun run test` for unit tests: one process, happy-dom preload. `mock.module` spreads the real module and is followed by `await import()`.
- Playwright runs with `CI=` against an already running `make dev`, for example `CI= bun playwright test tests/e2e/x.spec.ts --project=chromium`. Never test against tiny.docs.plus.
- Typing in e2e runs at full speed. Misplaced text means an app bug, not a missing wait.

**Code rules**
- Hydration: never `useState(() => readWindowOrStorage())`. Use `useEffect` with a ready flag.
- Never subscribe the editor shell to editor state, and never rebuild the extensions array or `EDITOR_PROPS` per render. Tiptap calls `setOptions`, which re-syncs the whole doc.

**Values the spec pins**
- `TOOLBAR_SETTLE_MS = 150` (exists).
- `TOOLBAR_MAX_WAIT_MS = 1000` (new).
- Focus outline 2px solid at ≥3:1. Pressed bar 2px at ≥3:1.
- Targets ≥24×24.
- `scroll-padding-top` = toolbar height (`--tt-toolbar-height`, 44px).
- Typing p95 ≤ +10%.

**Scope boundary**
PR A adds none of these:
- the action registry (`lib/editor-actions/`) or context snapshot;
- new marks or token palette;
- the context slot, sorted row, bubble or palette;
- a version gate.

**Deferred to PR D, deliberately**
- One Tab stop with roving tabindex, Alt+F10 and Esc-returns-to-editor.
- `preventDefault` on mousedown with act-on-click.
- 44×44 touch targets and mobile `scroll-padding-bottom` (they belong to the docked bar).
- §6.6 slot freeze and `hold()`; there is no slot yet. Only the generic "focus never drops to `<body>`" repair ships here.
- The TOC jump moving from `block:"center"` to `block:"start"`.
- `active:translate-y-px` and reduced-motion clean-up.
- Showing all 9 highlights; the palette arrives with tokens in PR C.

## Review Focus

1. **Read-only switch while a toolbar control has focus.** A `document_too_large` or `document_deleted` rejection runs `setEditable(false)`, and many tiptap-ui controls `return null`. Focus must land on another toolbar control, never `<body>`. Task 2 pins it with a unit test and an e2e test that calls `setEditable(false)` while Indent has focus.
2. **Mobile highlight panel inside `role="toolbar"`.** The same swatches render inside the toolbar's capture-phase arrow handling. Arrow keys must move exactly one swatch, not two. Task 4 pins it with an e2e test at 390×844.
3. **Dark theme and Windows High Contrast.** The focus ring and pressed bar must stay ≥3:1 in dark mode. In forced colours they must not vanish, because box-shadows are dropped there. Task 1 pins it with computed-style contrast tests in light, dark and `forcedColors: "active"`.
4. **Indent with a range across several list items, and in task lists.** Tab sinks the selected items, and the button must do the same. Task 5 pins it with unit tests for a two-item range and a `taskItem`.
5. **Remote typing that never pauses, and editor teardown mid-burst.** The toolbar must catch up within `TOOLBAR_MAX_WAIT_MS`. No timer may fire after the last unsubscribe. Task 7 pins it with fake-timer unit tests and the two-user e2e.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `app/globals.css` | Tokens `--focus-ring`, `--pressed-bar` (light/dark); forced-colours rules; `scroll-padding-top` on the editor scroll container | Modify |
| `components/ui/button.tsx` | Outline focus ring, `aria-disabled` styling, pressed bar | Modify |
| `components/ui/toolbar-button.tsx` | `aria-pressed` default, `data-active`, `disabledReason` + `aria-describedby`, `focusableWhenDisabled` | Modify |
| `components/ui/toolbar.tsx` | Items include `aria-disabled`; focus repair; skip nested roving groups | Modify |
| `components/tiptap-ui/heading-dropdown-menu/*` | Trigger named by visible value; radio items; `setTextStyle` | Modify |
| `components/tiptap-ui/list-dropdown-menu/*` | Trigger `aria-haspopup`; radio items incl. "No list"; `setListType` | Modify |
| `components/tiptap-ui/color-highlight-popover/color-highlight-popover.tsx` | Swatch group, names, check glyph, initial focus, `navigation` prop | Modify |
| `components/document-editor/mobile-toolbar-content.tsx` | Uses `navigation="toolbar"` | Modify |
| `components/tiptap-ui/indent-button/indent-button.tsx` | Mirror Tab chain; disabled reasons | Modify |
| `components/tiptap-ui/undo-redo-button/undo-redo-button.tsx` | Disabled reasons | Modify |
| `components/document-editor/document-editor.tsx` | `scrollMargin`/`scrollThreshold` in `EDITOR_PROPS`; Profiler; toolbar-off switch | Modify |
| `components/document-editor/toolbar-test-hooks.ts` | `countToolbarCommit`, `useToolbarOffForTests` (dev-only) | Create |
| `hooks/use-tiptap-editor.ts` | `TOOLBAR_MAX_WAIT_MS` cap | Modify |
| `types/window.d.ts` | `__toolbarCommits`, `__TOOLBAR_OFF` | Modify |
| `tests/unit/components/toolbar-button.test.tsx` | ToolbarButton states | Create |
| `tests/unit/components/toolbar.test.tsx` | Focus repair, nested groups | Create |
| `tests/unit/components/indent.test.ts` | `canApplyIndent` / `applyIndent` | Create |
| `tests/unit/components/text-style.test.ts` | `getTextStyleValue`, `setTextStyle`, `setListType` | Create |
| `tests/unit/hooks/use-tiptap-editor.test.ts` | Max-wait tests | Modify |
| `tests/e2e/helpers/a11y.ts` | `resolveRgb`, `contrastRatio`, `setTheme`, `expectNoSeriousA11yViolations` | Create |
| `tests/e2e/helpers/perf-observer.ts` | Keystroke timer, `percentile`, `median` | Modify |
| `tests/e2e/toolbar-a11y.spec.ts` | Focus/pressed/forced-colours, popover keyboard, axe sweep | Create |
| `tests/e2e/toolbar.spec.ts` | Indent in lists, menus, scroll padding, commit budget, remote typing | Create |
| `tests/e2e/performance.spec.ts` | Same-run A/B assertion | Modify |
| `CHANGELOG.md`, `tests/TESTING.md`, `AGENTS.md` | Docs | Modify |

---

### Task 1: Focus ring, pressed state and forced colours

Spec §6.1 and §6.2. The current ring (`ring-ring/50`) is about 1.5:1 in light and 1.9:1 in dark, and forced colours remove it entirely. The pressed state today is a colour-only `bg-foreground/10`.

**Files:**
- Modify: `app/globals.css` (`:root`, `.dark`, `@theme inline`, new forced-colours block)
- Modify: `components/ui/button.tsx:9` (base class string)
- Modify: `components/ui/toolbar-button.tsx` (`isActive` handling)
- Create: `tests/e2e/helpers/a11y.ts`, `tests/e2e/toolbar-a11y.spec.ts`
- Test: `tests/unit/components/toolbar-button.test.tsx`

**Interfaces:**
- Produces, CSS tokens:
  - `--focus-ring`: light `oklch(0.439 0 0)`, dark `oklch(0.87 0 0)`.
  - `--pressed-bar`: `var(--foreground)` in both themes.
  - Both are exposed as `--color-focus-ring` and `--color-pressed-bar` in `@theme inline`.
- Produces, `ToolbarButton`:
  - With `isActive` defined and no explicit `aria-pressed` or `aria-haspopup`, it renders `aria-pressed={isActive}`.
  - It always renders `data-active="true"` when `isActive` (a stable test and styling hook; menu triggers keep it and lose `aria-pressed`).
  - The background tint keys on `data-active`. The 2px bar keys on `aria-pressed="true"`.
- Produces, `tests/e2e/helpers/a11y.ts`:
  - `resolveRgb(page: Page, cssColor: string): Promise<[number, number, number]>` paints the colour on a 1×1 canvas and reads it back, because Chromium returns `oklch()` from `getComputedStyle`.
  - `contrastRatio(a: [number, number, number], b: [number, number, number]): number` uses WCAG relative luminance.
  - `setTheme(page: Page, theme: "light" | "dark"): Promise<void>` sets `localStorage["tinydocy-theme"]` via `addInitScript` before `goto`.
  - `openToolbarTestDoc(page: Page): Promise<EditorPage>` calls `goto` and `waitForSync`, then focuses the title.

- [ ] **Step 1: Write the failing unit tests**

Render with `createRoot`, `act` and `createElement`, as in `tests/unit/hooks/use-synced-tabs.test.ts`. The examples below use JSX for brevity; write them with `createElement`, or keep `.tsx` only after confirming that `bun test` transpiles it under the repo tsconfig. `render(element)` is a local helper that mounts into a fresh container and returns the first `button`.

```tsx
describe("ToolbarButton pressed state", () => {
  it("derives aria-pressed and data-active from isActive", () => {
    const button = render(<ToolbarButton isActive aria-label="Bold" />);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.getAttribute("data-active")).toBe("true");
  });
  it("leaves aria-pressed off menu triggers", () => {
    const button = render(<ToolbarButton isActive aria-haspopup="menu" aria-label="List" />);
    expect(button.hasAttribute("aria-pressed")).toBe(false);
    expect(button.getAttribute("data-active")).toBe("true");
  });
  it("keeps an explicit aria-pressed", () => {
    const button = render(<ToolbarButton isActive={false} aria-pressed="mixed" aria-label="B" />);
    expect(button.getAttribute("aria-pressed")).toBe("mixed");
  });
});
```

- [ ] **Step 2: Write the failing e2e tests** in `tests/e2e/toolbar-a11y.spec.ts`

```ts
for (const theme of ["light", "dark"] as const) {
  test(`focus ring is a solid 2px outline at >=3:1 (${theme})`, async ({ page }) => {
    await setTheme(page, theme);
    await openToolbarTestDoc(page);
    const bold = page.getByRole("toolbar").getByRole("button", { name: "Bold" });
    // Keyboard modality first, then focus Bold directly. The toolbar's own
    // arrow index is not synced to focus, so arrowing from a neighbour lands elsewhere.
    await page.keyboard.press("Shift");
    await bold.focus();
    expect(await bold.evaluate((el) => el.matches(":focus-visible"))).toBe(true);
    const style = await bold.evaluate((el) => {
      const cs = getComputedStyle(el);
      const bar = getComputedStyle(el.closest("[role=toolbar]")!);
      return { outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth, outlineColor: cs.outlineColor, bg: bar.backgroundColor };
    });
    expect(style.outlineStyle).toBe("solid");
    expect(Number.parseFloat(style.outlineWidth)).toBeGreaterThanOrEqual(2);
    expect(contrastRatio(await resolveRgb(page, style.outlineColor), await resolveRgb(page, style.bg))).toBeGreaterThanOrEqual(3);
  });

  test(`pressed state has a 2px bar at >=3:1 (${theme})`, async ({ page }) => {
    // Select text in a paragraph, press Mod+B, read Bold's box-shadow:
    // it must contain an inset 0 -2px bar whose colour is >=3:1 on the button background.
  });
}

test("forced colours keep the focus outline and mark pressed with Highlight", async ({ page }, testInfo) => {
  await page.emulateMedia({ forcedColors: "active" });
  // Focus Bold as above: outline-style "solid", width >= 2px.
  // An unfocused toolbar button (Italic) has outline-style "none": no outline on every button.
  // Make Bold pressed: its background equals a probe <div style="background: Highlight"> resolved with resolveRgb.
  await testInfo.attach("toolbar-forced-colors", { body: await page.getByRole("toolbar").screenshot(), contentType: "image/png" });
});
```

Write the pressed and forced-colour bodies as the comments describe. Screenshots are attached artifacts, not `toHaveScreenshot` baselines, because CI runs Linux while development runs on darwin.

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `bun test tests/unit/components/toolbar-button.test.tsx`
Expected: FAIL. `aria-pressed` is null and there is no `data-active`.

Run: `CI= bun playwright test tests/e2e/toolbar-a11y.spec.ts --project=chromium`
Expected: FAIL. `outlineStyle` is `"none"` and no inset bar is found.

- [ ] **Step 4: Implement**

`globals.css`:
- Add the tokens.
- Add `@media (forced-colors: active)` rules for `[data-slot="button"]`:
  - `[aria-pressed="true"]`: `forced-color-adjust: none; background: Highlight; color: HighlightText`.
  - `[aria-pressed="mixed"]`: `outline: 2px dashed CanvasText; outline-offset: -2px`.
  - `[aria-disabled="true"]`: `color: GrayText`.

`button.tsx` base classes:
- Replace `outline-none … focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50` with `outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring`.
- **Do not use `outline-hidden`.** In Tailwind 4.3 it sets `--tw-outline-style: none`, so `outline-2` resolves to no style. Under `forced-colors: active` it also adds a 2px transparent outline that High Contrast paints on every button. `outline-solid` must be explicit for the same reason.
- Add `aria-pressed:shadow-[inset_0_-2px_0_0_var(--pressed-bar)]`.
- Leave the `destructive` and `aria-invalid` ring variants alone. They are not toolbar states.

`toolbar-button.tsx`:
- Apply `isActive && "bg-foreground/10 text-foreground"` via `data-active:` classes.
- Compute the `aria-pressed` default as the Interfaces block says.

- [ ] **Step 5: Run the tests and confirm they pass**

Run both commands from Step 3.
Expected: PASS. Run Biome on the touched files: `bun biome check app/globals.css components/ui tests/e2e/helpers/a11y.ts tests/e2e/toolbar-a11y.spec.ts tests/unit/components`.

- [ ] **Step 6: Commit** after the review report is approved

```bash
git add app/globals.css components/ui/button.tsx components/ui/toolbar-button.tsx tests/e2e/helpers/a11y.ts tests/e2e/toolbar-a11y.spec.ts tests/unit/components/toolbar-button.test.tsx
git commit -m "fix(ui): give toolbar buttons a visible focus outline and pressed bar"
```

---

### Task 2: Disabled-with-reason and focus repair

Spec §6.5, and the generic part of §6.6: focus never drops to `<body>`.

**Files:**
- Modify: `components/ui/toolbar-button.tsx`, `components/ui/button.tsx` (disabled classes), `components/ui/toolbar.tsx`
- Modify: `components/tiptap-ui/undo-redo-button/undo-redo-button.tsx` (pass reasons)
- Modify: `components/tiptap-ui/heading-dropdown-menu/heading-dropdown-menu.tsx`, `components/tiptap-ui/list-dropdown-menu/list-dropdown-menu.tsx`, `components/tiptap-ui/color-highlight-popover/color-highlight-popover.tsx` (`disabled` on the trigger primitive)
- Test: `tests/unit/components/toolbar-button.test.tsx`, `tests/unit/components/toolbar.test.tsx`, `tests/e2e/toolbar.spec.ts`

**Interfaces:**
- Consumes: the `ToolbarButton` from Task 1.
- Produces, `ToolbarButtonProps`:
  - New prop `disabledReason?: string`.
  - `ToolbarButton` always passes `focusableWhenDisabled` to Base UI `Button`. That renders `aria-disabled="true"` instead of `disabled`, keeps the control focusable, and swallows `onClick`, so a disabled action is a no-op.
  - When `disabled && disabledReason`, it renders `<span id={useId()} hidden>{disabledReason}</span>` and `aria-describedby` pointing to it. The tooltip content becomes `disabledReason` and the tooltip still opens on focus and hover.
- Produces, disabled triggers: `focusableWhenDisabled` only swallows the button's `onClick`. The menu or popover trigger's own pointer and key handlers can still open it, so the triggers pass `disabled` to `DropdownMenuTrigger` and `PopoverTrigger` themselves, not only to the rendered `ToolbarButton`. Today only the heading dropdown guards in `onOpenChange`; the list dropdown and highlight popover need this.
- Produces, `button.tsx`: `disabled:pointer-events-none disabled:opacity-50` becomes `aria-disabled:opacity-50 disabled:opacity-50`. No pointer-events rule, so hover still shows the tooltip.
- Produces, `Toolbar`:
  - The item selector is `button, [role="button"], [tabindex="0"]`. `aria-disabled` items stay navigable, as APG requires.
  - Items inside `[data-roving-group]` are excluded, and the toolbar ignores keydown whose target is inside one (used by Task 4).
  - New behaviour: if the element that last had focus in the toolbar is removed, and focus is not inside the toolbar (`document.activeElement` is `<body>`, `null` or disconnected; happy-dom may leave it pointing at the removed node), focus moves to the item at the same index, clamped to the last item.

- [ ] **Step 1: Write the failing tests**

```tsx
describe("ToolbarButton disabled with a reason", () => {
  it("stays focusable, explains itself and ignores clicks", () => {
    const onClick = vi.fn();
    const button = render(<ToolbarButton disabled disabledReason="Nothing to undo" aria-label="Undo" onClick={onClick} />);
    expect(button.hasAttribute("disabled")).toBe(false);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    const reason = document.getElementById(button.getAttribute("aria-describedby")!);
    expect(reason?.textContent).toBe("Nothing to undo");
    button.focus();
    expect(document.activeElement).toBe(button);
    act(() => button.click());
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("Toolbar focus repair", () => {
  it("moves focus to a neighbour when the focused control unmounts", async () => {
    // Render <Toolbar><ToolbarButton aria-label="A"/>{showB && <ToolbarButton aria-label="B"/>}<ToolbarButton aria-label="C"/></Toolbar>,
    // focus B, re-render with showB=false, await a microtask (MutationObserver).
    expect(document.activeElement?.getAttribute("aria-label")).toBe("C");
  });
  it("leaves focus alone when the user moved it out of the toolbar", async () => {
    // Focus B, then focus an outside <input>, then unmount B: activeElement stays the input.
  });
});
```

Add two e2e twins to `tests/e2e/toolbar.spec.ts`:

```ts
test("focus stays in the toolbar when the document turns read-only", async ({ page }) => {
  // Keyboard-focus the Indent button (Shift, then .focus()), then:
  await page.evaluate(() => window.__tiptap_editor?.setEditable(false));
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('[role="toolbar"]'))).toBe(true);
});
test("an aria-disabled menu trigger stays closed", async ({ page }) => {
  // Caret in a code block (lists cannot apply there), so the List trigger is aria-disabled.
  // Click it, then focus it and press Enter and ArrowDown: page.getByRole("menu") has count 0 after each.
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `bun test tests/unit/components`
Expected: FAIL. The `disabled` attribute is present, there is no `aria-describedby`, and focus ends on `<body>`.

Run: `CI= bun playwright test tests/e2e/toolbar.spec.ts --project=chromium -g "read-only|stays closed"`
Expected: the read-only test FAILS (`activeElement` is `<body>`). The menu test passes today, because native `disabled` blocks it; it guards the change.

- [ ] **Step 3: Implement the props and the repair** as the Interfaces block says.

The repair lives in the existing `MutationObserver` callback in `useToolbarNavigation`:
- On `focusin` inside the toolbar, store the element and its index.
- On `focusout`, clear them only when `relatedTarget` is a node outside the toolbar.

In `UndoRedoButton`, pass `disabledReason`: `"Nothing to undo"` or `"Nothing to redo"`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `bun test tests/unit/components && bun run typecheck && CI= bun playwright test tests/e2e/toolbar.spec.ts --project=chromium -g "read-only|stays closed"`
Expected: PASS, 0 type errors.

- [ ] **Step 5: Commit** after approval

```bash
git add components/ui tests/unit/components components/tiptap-ui/undo-redo-button/undo-redo-button.tsx
git commit -m "fix(ui): keep disabled toolbar controls focusable with a reason"
```

---

### Task 3: Menu buttons named by value, items as `menuitemradio`

Spec §6.4. Today the heading trigger is named "Format text as heading" and carries `aria-pressed`. Its items are toggle buttons inside the menu, so clicking the checked one removes it, which contradicts `aria-checked`.

**Decision:** items are radio items. Picking the checked item does nothing. Picking another value sets it. The heading menu gains "Normal text", and the list menu gains "No list", so every state can be picked.

**Files:**
- Modify: `components/tiptap-ui/heading-dropdown-menu/heading-dropdown-menu.tsx`, `use-heading-dropdown-menu.ts`
- Modify: `components/tiptap-ui/list-dropdown-menu/list-dropdown-menu.tsx`, `use-list-dropdown-menu.ts`
- Test: `tests/unit/components/text-style.test.ts`, `tests/e2e/toolbar.spec.ts`

**Interfaces:**
- Consumes: `canToggleHeading`, `toggleHeading`, `isHeadingActive` (`heading-button/use-heading.ts`); `canToggleList`, `toggleList`, `isListActive`, `listLabels` (`list-button/use-list.ts`); `DropdownMenuRadioGroup` and `DropdownMenuRadioItem` (`components/ui/dropdown-menu.tsx`).
- Produces, in `use-heading-dropdown-menu.ts`:
  - `type TextStyleValue = "title" | "paragraph" | \`heading-${Level}\``.
  - `getTextStyleValue(editor: Editor | null): TextStyleValue`. It returns `"title"` when the selection's `$from.index(0) === 0`.
  - `TEXT_STYLE_LABELS: Record<TextStyleValue, string>`, for example `"Title"`, `"Normal text"`, `"Heading 2"`.
  - `setTextStyle(editor: Editor | null, value: Exclude<TextStyleValue, "title">): boolean`. Sets, never toggles; `false` and no transaction when the value is already current or not allowed.
- Produces, in `use-list-dropdown-menu.ts`:
  - `type ListValue = ListType | "none"`.
  - `getListValue(editor: Editor | null): ListValue`.
  - `setListType(editor: Editor | null, value: ListValue): boolean`. Same set-not-toggle contract.
- Produces, the triggers:
  - The heading trigger renders `<Icon/> {TEXT_STYLE_LABELS[value]} <ChevronDownIcon/>` with **no `aria-label`**, so the visible value is the name. It also gets `aria-haspopup="menu"`, no `aria-pressed`, and `tooltip="Text style"`.
  - The list trigger keeps `aria-label="List"`, which is icon-only so label-in-name does not apply. It gets `aria-haspopup="menu"` and no `aria-pressed`.
  - Both pass `isActive` only for `data-active`.

- [ ] **Step 1: Write the failing unit tests** with `createTestEditor`

```ts
it("reads Title in the first block and Heading 2 in a level-2 heading", () => {
  editor = createTestEditor({ content: doc(h1("Title"), h2("Section"), p("Body")) });
  editor.commands.setTextSelection(2);
  expect(getTextStyleValue(editor)).toBe("title");
  editor.commands.setTextSelection(posInside(editor, "Section"));
  expect(getTextStyleValue(editor)).toBe("heading-2");
});
it("sets, never toggles, the text style", () => {
  editor.commands.setTextSelection(posInside(editor, "Section"));
  expect(setTextStyle(editor, "heading-2")).toBe(false); // already current: no-op
  expect(setTextStyle(editor, "paragraph")).toBe(true);
  expect(getTextStyleValue(editor)).toBe("paragraph");
});
it("switches and removes lists without toggling", () => {
  editor.commands.setTextSelection(posInside(editor, "Body"));
  expect(setListType(editor, "bulletList")).toBe(true);
  expect(setListType(editor, "bulletList")).toBe(false);
  expect(setListType(editor, "orderedList")).toBe(true);
  expect(getListValue(editor)).toBe("orderedList");
  expect(setListType(editor, "none")).toBe(true);
  expect(getListValue(editor)).toBe("none");
});
```

`doc`, `h1`, `h2`, `p` and `posInside` come from `tests/helpers/document-builders.ts`. Add `posInside` there if it is missing.

- [ ] **Step 2: Write the failing e2e test** in `tests/e2e/toolbar.spec.ts`

```ts
test("text style menu is a menu button named by its value with radio items", async ({ page }) => {
  // Caret in a level-2 heading (build with editorPage.buildDocument).
  const trigger = page.getByRole("toolbar").getByRole("button", { name: "Heading 2" });
  await expect(trigger).toHaveAttribute("aria-haspopup", "menu");
  await expect(trigger).not.toHaveAttribute("aria-pressed", /.*/);
  await trigger.click();
  await expect(page.getByRole("menuitemradio", { name: "Heading 2" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("menuitemradio", { name: "Heading 2" }).click();
  // Still a heading: picking the checked item is a no-op.
  await expect(page.getByRole("toolbar").getByRole("button", { name: "Heading 2" })).toBeVisible();
});
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `bun test tests/unit/components/text-style.test.ts`
Expected: FAIL, the exports are missing.

Run: `CI= bun playwright test tests/e2e/toolbar.spec.ts --project=chromium -g "text style"`
Expected: FAIL. No button is named "Heading 2".

Add to the same file:

```ts
test("picking a text style returns focus to the editor", async ({ page }) => {
  // Caret in a paragraph "Body"; open the text style menu with the mouse; pick "Heading 2"; type "X".
  await expect(page.locator(".tiptap h2")).toContainText("BodyX");
});
```

- [ ] **Step 4: Implement** the helpers and the menus.

Pin focus on close through `DropdownMenuContent`'s `finalFocus`:
- after an item is picked, focus goes to the editor (`editor.view.dom`; the selection is already in place);
- on Esc or a click outside, focus goes back to the trigger (Base UI's default).

Base UI otherwise returns focus to the trigger after `toggleHeading` has focused the editor, and a user who keeps typing types into nothing.

Each menu renders a `DropdownMenuRadioGroup` with `value={getXValue(editor)}` and `onValueChange={(v) => setX(editor, v)}`. Each `DropdownMenuRadioItem` carries `disabled` from `canToggleHeading` or `canToggleList`.

The `HeadingButton` and `ListButton` components themselves are unchanged. They are no longer used inside the menus.

- [ ] **Step 5: Run the tests and confirm they pass**

Run both commands from Step 3, then the existing suites that drive headings: `CI= bun playwright test tests/e2e/extensions.spec.ts tests/e2e/toc-sidebar.spec.ts --project=chromium`.
Expected: PASS.

- [ ] **Step 6: Commit** after approval

```bash
git add components/tiptap-ui/heading-dropdown-menu components/tiptap-ui/list-dropdown-menu tests/unit/components/text-style.test.ts tests/e2e/toolbar.spec.ts tests/helpers/document-builders.ts
git commit -m "fix(toolbar): name style and list menus by value and use radio items"
```

---

### Task 4: Highlight swatches as named pressed buttons in a dialog

Spec §6.3. Today the popover has a `tabIndex=0` container, a stray `role="menuitem"`, and names like "Green background highlight color". It only uses arrows for focus.

**Files:**
- Modify: `components/tiptap-ui/color-highlight-popover/color-highlight-popover.tsx`
- Modify: `components/document-editor/mobile-toolbar-content.tsx`
- Test: `tests/e2e/toolbar-a11y.spec.ts`

**Interfaces:**
- Consumes: `data-roving-group` support from Task 2 (`Toolbar` ignores those keys and items); `ToolbarButton` `aria-pressed`; `CheckIcon` (add it to `lib/icons.tsx` if absent).
- Produces, `ColorHighlightPopoverContent`:
  - New prop `navigation?: "grid" | "toolbar"`, default `"grid"`.
  - Root: `<div role="group" aria-label="Highlight colours">`. With `"grid"` it also has `data-roving-group`, and swatches get a roving tabindex through `useMenuNavigation({ orientation: "both" })`, with the initial index on the pressed swatch, else 0.
  - With `"toolbar"` the root has no roving: the swatches are plain toolbar items.
- Produces, swatch names: `` `${colour} highlight` ``, where `colour` is the label without " background" (for example "Green highlight"). The remove button is "No highlight". Neither has `role="menuitem"`.
  - The pressed swatch shows a `CheckIcon` overlay (1.4.1).
  - Swatch dots use `forced-color-adjust: none` with a `CanvasText` 1px border.
- Produces, `PopoverContent` for highlight: `aria-label="Highlight colours"`. Base UI Popover's popup is `role="dialog"`. `initialFocus` resolves to the pressed swatch, else the first.
- Produces, the trigger: `aria-haspopup="dialog"` and no `aria-pressed`, consistent with Task 3. Esc closes the popover and focus returns to the trigger, which is Base UI's default `finalFocus`.
- Produces, the mobile panel: `<ColorHighlightPopoverContent navigation="toolbar" />`.

- [ ] **Step 1: Write the failing e2e tests**

```ts
test("highlight dialog: named swatches, focus on open, arrows move focus only", async ({ page }) => {
  // Select a word; open "Highlight" trigger.
  const dialog = page.getByRole("dialog", { name: "Highlight colours" });
  await expect(dialog.getByRole("group", { name: "Highlight colours" })).toBeVisible();
  await expect(dialog.locator('[role="menuitem"], [tabindex="0"]:not(button)')).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Green highlight" })).toBeFocused();
  const before = await page.evaluate(() => window.__tiptap_editor?.getJSON());
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByRole("button", { name: "Blue highlight" })).toBeFocused();
  expect(await page.evaluate(() => window.__tiptap_editor?.getJSON())).toEqual(before); // arrow applied nothing
  await page.keyboard.press("Enter");
  // Reopen: Blue is aria-pressed=true and focused, and has a check glyph.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("toolbar").getByRole("button", { name: /highlight/i }).first()).toBeFocused();
});

test("mobile highlight panel: one arrow press moves one swatch", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // Open the panel via the toolbar highlighter button, focus "Green highlight", ArrowRight -> "Blue highlight" focused.
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `CI= bun playwright test tests/e2e/toolbar-a11y.spec.ts --project=chromium -g "highlight"`
Expected: FAIL. There is no group named "Highlight colours", and the swatch name is "Green background highlight color".

- [ ] **Step 3: Implement** as the Interfaces block says.

Keep the five colours the popover already shows. The token palette is PR C.

- [ ] **Step 4: Run the tests and confirm they pass**

Same command as Step 2.
Expected: PASS.

- [ ] **Step 5: Commit** after approval

```bash
git add components/tiptap-ui/color-highlight-popover components/document-editor/mobile-toolbar-content.tsx lib/icons.tsx tests/e2e/toolbar-a11y.spec.ts
git commit -m "fix(toolbar): make highlight swatches named pressed buttons in a dialog"
```

---

### Task 5: Indent and outdent work in lists

Spec §2 "Indent fix". `canApplyIndent` only asks `indent()`, which allows a paragraph only in `doc` or `blockquote`, so ⇥ is disabled in lists while Tab works.

Tab's chain, in `@docs.plus/extension-indent`, is:
1. `sinkListItem`, trying `listItem` then `taskItem`;
2. then `goToNextCell`;
3. then `indent()`.

Shift+Tab is `liftListItem`, then `goToPreviousCell`, then `outdent()`. The buttons mirror this chain without the cell moves.

**Files:**
- Modify: `components/tiptap-ui/indent-button/indent-button.tsx`
- Test: `tests/unit/components/indent.test.ts`, `tests/e2e/toolbar.spec.ts`

**Interfaces:**
- Produces:
  - `canApplyIndent(editor: Editor | null, action: IndentAction): boolean` and `applyIndent(editor: Editor | null, action: IndentAction): boolean` keep their signatures.
  - `listItemTypes(editor: Editor): string[]` returns `["listItem", "taskItem"]` filtered by the schema.
  - `applyIndent` runs `editor.chain().focus().sinkListItem(t).run()` or `liftListItem(t)` for the first type whose `can()` passes, and falls back to `indent()` or `outdent()`.
  - `IndentButton` passes `disabledReason`: `"Indent works in paragraphs, quotes and list items"` or `"Nothing to outdent here"`.

- [ ] **Step 1: Write the failing unit tests**

```ts
const list = (...items: string[]) => ({ type: "bulletList", content: items.map((t) => ({ type: "listItem", content: [p(t)] })) });

it("indents the second list item like Tab", () => {
  editor = createTestEditor({ content: doc(h1("T"), list("one", "two")) });
  editor.commands.setTextSelection(posInside(editor, "two"));
  expect(canApplyIndent(editor, "indent")).toBe(true);
  expect(applyIndent(editor, "indent")).toBe(true);
  expect(editor.getJSON().content?.[1].content?.[0].content?.[1].type).toBe("bulletList"); // nested
});
it("cannot indent the first list item", () => { /* caret in "one": canApplyIndent false */ });
it("outdents a nested item like Shift+Tab", () => { /* after the indent above: canApplyIndent(outdent) true, applyIndent lifts it back */ });
it("sinks every item in a range", () => { /* list("one","two","three"), select from "two" to "three": both nested under "one" */ });
it("indents task items", () => { /* taskList with two taskItems: second sinks */ });
it("still indents a plain paragraph", () => { /* doc(h1, p("x")): canApplyIndent true; applyIndent inserts two spaces */ });
it("never moves between table cells", () => { /* caret in a table cell paragraph: canApplyIndent false; selection unchanged after applyIndent */ });
```

- [ ] **Step 2: Write the failing e2e test**

```ts
test("indent button nests a list item", async ({ page }) => {
  // Type "- one", Enter, "two" (input rule makes a bullet list); click toolbar "Indent".
  await expect(page.locator(".tiptap ul ul li")).toHaveText("two");
  await page.getByRole("toolbar").getByRole("button", { name: "Outdent" }).click();
  await expect(page.locator(".tiptap ul ul")).toHaveCount(0);
});
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `bun test tests/unit/components/indent.test.ts`
Expected: FAIL. `canApplyIndent(…, "indent")` is `false` in the list.

Run: `CI= bun playwright test tests/e2e/toolbar.spec.ts --project=chromium -g "indent"`
Expected: FAIL. Before Task 2 the Indent button is disabled; after it, it is `aria-disabled` and the click is swallowed.

- [ ] **Step 4: Implement** as the Interfaces block says.

- [ ] **Step 5: Run the tests and confirm they pass**

Run both commands from Step 3.
Expected: PASS.

- [ ] **Step 6: Commit** after approval

```bash
git add components/tiptap-ui/indent-button tests/unit/components/indent.test.ts tests/e2e/toolbar.spec.ts
git commit -m "fix(toolbar): let indent and outdent buttons nest list items like Tab"
```

---

### Task 6: Focus Not Obscured under the sticky toolbar

Spec §6.8. The toolbar is `sticky` inside `.document-editor-wrapper`, which is the scroll container, not `html`. Nothing sets scroll padding.

Two separate paths need the fix:
- **CSS scroll-into-view** (outline jump, `scrollIntoView`): needs `scroll-padding-top`.
- **ProseMirror's caret scrolling**: ignores CSS scroll padding and uses `editorProps.scrollMargin` and `scrollThreshold`.

The `FilterBar` is a zero-height sticky overlay and is not counted.

**Files:**
- Modify: `components/document-editor/document-editor.scss` (`.document-editor-wrapper`)
- Modify: `components/document-editor/document-editor.tsx` (`EDITOR_PROPS`, which stays a module constant)
- Test: `tests/e2e/toolbar.spec.ts`

**Interfaces:**
- Produces:
  - `.document-editor-wrapper { scroll-padding-top: var(--tt-toolbar-height); }`. The var already exists: `44px` in `document-editor.scss:2`.
  - `EDITOR_PROPS.scrollMargin = { top: 52, bottom: 8, left: 0, right: 0 }` and `EDITOR_PROPS.scrollThreshold = { top: 52, bottom: 8, left: 0, right: 0 }`. 52 is the 44px toolbar plus 8px of air. Add a comment tying it to `--tt-toolbar-height`.

- [ ] **Step 1: Write the failing e2e tests**

```ts
test("scrollIntoView keeps a heading below the toolbar", async ({ page }) => {
  // setContent(generateLargeDocument(30)); scroll the wrapper to the bottom.
  const heading = page.locator(".tiptap h2").nth(10);
  await heading.evaluate((el) => el.scrollIntoView({ block: "start" }));
  const toolbarBottom = (await page.getByRole("toolbar").boundingBox())!.y + 44;
  expect((await heading.boundingBox())!.y).toBeGreaterThanOrEqual(toolbarBottom - 1);
});
test("the caret is never hidden behind the toolbar", async ({ page }) => {
  // Scroll the wrapper so paragraph 20 sits under the toolbar, then let ProseMirror
  // scroll the selection (native ArrowUp is scrolled by the browser and is not deterministic):
  await page.evaluate((pos) => window.__tiptap_editor?.chain().setTextSelection(pos).scrollIntoView().run(), posOfParagraph20);
  const caretTop = await page.evaluate(() => {
    const ed = window.__tiptap_editor!;
    return ed.view.coordsAtPos(ed.state.selection.from).top;
  });
  expect(caretTop).toBeGreaterThanOrEqual(toolbarBottom);
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `CI= bun playwright test tests/e2e/toolbar.spec.ts --project=chromium -g "below the toolbar|behind the toolbar"`
Expected: FAIL. The heading's y is about 44px less than the toolbar bottom, and the caret top is under the toolbar.

- [ ] **Step 3: Implement** as the Interfaces block says.

- [ ] **Step 4: Run the tests and confirm they pass**

Run the Step 2 command plus `CI= bun playwright test tests/e2e/toc-sidebar.spec.ts tests/e2e/fold.spec.ts --project=chromium`, the suites that scroll.
Expected: PASS.

- [ ] **Step 5: Commit** after approval

```bash
git add components/document-editor/document-editor.scss components/document-editor/document-editor.tsx tests/e2e/toolbar.spec.ts
git commit -m "fix(editor): keep headings and the caret clear of the sticky toolbar"
```

---

### Task 7: Toolbar update cap and commit budget

Spec §4.2 timing (P6) and HoE criteria A:
- "kind updates within 1 s under 5 s of remote typing";
- "≤1 toolbar commit per settle".

Today's trailing debounce restarts on every document change, so continuous remote typing starves the toolbar until it stops.

**Files:**
- Modify: `hooks/use-tiptap-editor.ts`
- Create: `components/document-editor/toolbar-test-hooks.ts`
- Modify: `components/document-editor/document-editor.tsx` (wrap toolbar children in `<Profiler id="toolbar" onRender={countToolbarCommit}>`)
- Modify: `types/window.d.ts`
- Test: `tests/unit/hooks/use-tiptap-editor.test.ts`, `tests/e2e/toolbar.spec.ts`

**Interfaces:**
- Produces, `export const TOOLBAR_MAX_WAIT_MS = 1000`.
  - The first document change of a burst starts a max-wait timer. Every change restarts the settle timer.
  - `notify` clears both timers. The last unsubscribe clears both.
- Produces, in `toolbar-test-hooks.ts`:
  - `countToolbarCommit(): void` increments `window.__toolbarCommits` when `process.env.NODE_ENV !== "production"`.

- Produces, `types/window.d.ts`: `__toolbarCommits?: number; __TOOLBAR_OFF?: boolean;`, documented as dev-only Playwright hooks.

- [ ] **Step 1: Write the failing unit tests** (extend the existing `describe`, reusing `setup()`)

```ts
it("notifies at least every TOOLBAR_MAX_WAIT_MS while changes never pause", () => {
  const { editor: instance, listener } = setup();
  for (let t = 0; t < 2 * TOOLBAR_MAX_WAIT_MS; t += 100) {
    instance.commands.insertContentAt(9, "x");
    vi.advanceTimersByTime(100);
  }
  // Max-wait fires at 1000 and 2000. The 2000 notify also clears the settle
  // timer from the insert at 1900, so no third call follows.
  expect(listener).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(TOOLBAR_SETTLE_MS);
  expect(listener).toHaveBeenCalledTimes(2);
});
it("starts a fresh max-wait window after a notify", () => {
  // One change, advance TOOLBAR_SETTLE_MS: 1 call; then changes every 100 ms for 900 ms: still 1 call.
});
it("leaves no timer behind when the last subscriber leaves mid-burst", () => {
  const { editor: instance, listener, unsubscribe } = setup();
  instance.commands.insertContentAt(9, "x");
  unsubscribe();
  vi.advanceTimersByTime(TOOLBAR_MAX_WAIT_MS);
  expect(listener).not.toHaveBeenCalled();
});
```

The existing "waits for document changes to pause" test (3 × 149 ms) must keep passing.

- [ ] **Step 2: Write the failing e2e tests**

```ts
test("toolbar follows a remote block change within 1 s while the collaborator keeps typing", async ({ browser }) => {
  // Two contexts on one docId, each with window.__HOCUS_TOKEN set as in performance-collab.spec.ts.
  // A: setContent(title + p("Target paragraph") + p("Typing here")); B: wait for the text, click into "Target paragraph".
  // A: click the end of "Typing here"; start page.keyboard.type("x".repeat(100), { delay: 50 }) without awaiting (5 s).
  // After 1000 ms, A dispatches tr.setNodeMarkup(posOf("Target paragraph"), heading, { level: 2 }) without moving its selection.
  const changedAt = Date.now();
  // Worst case: the max-wait window, plus a keystroke gap, sync and render. The
  // unit test proves the exact 1 s cap; this separates it from ~4 s of starvation.
  await expect(b.getByRole("toolbar").getByRole("button", { name: "Heading 2" })).toBeVisible({ timeout: TOOLBAR_MAX_WAIT_MS + 500 });
  expect(Date.now() - changedAt).toBeLessThan(TOOLBAR_MAX_WAIT_MS + 500);
  expect(typingDone).toBe(false); // A was still typing when B caught up
});

test("a typing burst commits the toolbar at most once per settle window", async ({ page }) => {
  // Caret in a paragraph; wait 300 ms; page.evaluate(() => { window.__toolbarCommits = 0 }).
  const start = Date.now();
  await page.keyboard.type("a".repeat(150), { delay: 20 });
  const burstMs = Date.now() - start;
  await page.waitForTimeout(TOOLBAR_SETTLE_MS + 100);
  const commits = await page.evaluate(() => window.__toolbarCommits ?? 0);
  expect(commits).toBeGreaterThanOrEqual(1); // the counter is wired
  expect(commits).toBeLessThanOrEqual(Math.floor(burstMs / TOOLBAR_MAX_WAIT_MS) + 1);
});
```

Import `TOOLBAR_SETTLE_MS` and `TOOLBAR_MAX_WAIT_MS` from `@/hooks/use-tiptap-editor`. If Playwright cannot load that module (it imports `@tiptap/react` and starts with `"use client"`), move both constants to a dependency-free `lib/toolbar-timing.ts`, re-export them from the hook, and import that file in the spec.

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `bun test tests/unit/hooks/use-tiptap-editor.test.ts`
Expected: FAIL. `TOOLBAR_MAX_WAIT_MS` is undefined, and the listener is called once, not twice.

Run: `CI= bun playwright test tests/e2e/toolbar.spec.ts --project=chromium -g "remote|burst"`
Expected: FAIL. The remote test times out, and the burst test reads 0 commits because there is no counter.

- [ ] **Step 4: Implement** the cap, the hooks module and the Profiler wrapper.

- [ ] **Step 5: Run the tests and confirm they pass**

Run both commands from Step 3.
Expected: PASS.

If the burst test fails with commits close to the keystroke count, something re-renders the toolbar per keystroke. Candidates:
- `DocumentEditorContent` state set on every keystroke, such as `useCursorVisibility`'s rect. It would re-render `MainToolbarContent`, whose props are inline arrows. Fix with `memo(MainToolbarContent)` and `useCallback` props.
- A tiptap-ui hook whose `editor.on("selectionUpdate" | "transaction")` handler sets a changing state. Derive that value in render instead; the version store already re-renders it.

Fix the cause in its own commit before continuing.

- [ ] **Step 6: Commit** after approval

```bash
git add hooks/use-tiptap-editor.ts components/document-editor/toolbar-test-hooks.ts components/document-editor/document-editor.tsx types/window.d.ts tests/unit/hooks/use-tiptap-editor.test.ts tests/e2e/toolbar.spec.ts
git commit -m "perf(toolbar): cap toolbar update delay at 1 s under continuous edits"
```

---

### Task 8: `performance.spec.ts` asserts the typing budget

HoE criterion A is typing p95 ≤ +10%; today the spec only logs. The plan uses §7's same-run A/B: toolbar off against toolbar on, in the same run, on the same machine.

This bounds the regression against `main`. `main` also mounts a toolbar, so `main` ≥ off, and therefore on ≤ 1.10 × off ≤ 1.10 × main.

The Event Timing observer can't be the metric. Its `durationThreshold` floor is 16 ms, so fast keystrokes are never reported and p95 over the reported ones is biased.

Input-to-next-frame via `requestAnimationFrame` doesn't work either. It is quantized to about 16.7 ms, and one keystroke crossing a frame moves the p95 ratio far past ±10%.

The spec measures each keystroke's synchronous handling instead: from the keydown `timeStamp` to a `MessageChannel` message posted from a capture-phase `input` listener. That covers ProseMirror, Yjs and toolbar work done in the event. Deferred React renders are gated by Task 7's commit budget.

**Files:**
- Modify: `tests/e2e/helpers/perf-observer.ts`
- Modify: `tests/e2e/performance.spec.ts`
- Modify: `components/document-editor/toolbar-test-hooks.ts` (add `useToolbarOffForTests`)
- Modify: `components/document-editor/document-editor.tsx`: render the `<Toolbar>` only when `!useToolbarOffForTests()`.
- Test: `tests/e2e/performance.spec.ts` itself.

**Interfaces:**
- Consumes: `components/document-editor/toolbar-test-hooks.ts` and `window.__TOOLBAR_OFF` (declared in Task 7).
- Produces, in `toolbar-test-hooks.ts`: `useToolbarOffForTests(): boolean`. It follows the ready-flag pattern: `useState(false)`, then a `useEffect` reads `window.__TOOLBAR_OFF === true`, outside production only.
- Produces, in `perf-observer.ts`:
  - `injectKeystrokeTimer(page: Page): Promise<void>`. An init script stores the last keydown `timeStamp` from a capture-phase `keydown` listener on `window`. A capture-phase `input` listener posts a `MessageChannel` message, and that callback pushes `performance.now() - keydownTimeStamp` to `window.__keystroke_latencies`.
  - `collectKeystrokeLatencies(page: Page): Promise<number[]>` reads and clears the samples.
  - `percentile(values: number[], p: number): number` and `median(values: number[]): number`.
- Produces, env knobs, documented in `tests/TESTING.md`:
  - `PERF_ROUNDS`, default 3.
  - `PERF_CPU_THROTTLE`, default 4, applied via CDP `Emulation.setCPUThrottlingRate`.
  - `PERF_MAX_REGRESSION`, default `0.10`.
  - `PERF_HEADINGS` stays `[10, 50]` by default. Nightly or manual runs pass `PERF_HEADINGS=50,500`.

- [ ] **Step 1: Rewrite the spec so it asserts**

```ts
for (const n of PERF_HEADINGS) {
  test(`typing p95 with the toolbar stays within budget (${n} headings, ${PERF_SHAPE})`, async ({ browser }) => {
    test.setTimeout(180_000);
    const p95 = { off: [] as number[], on: [] as number[] };
    for (let round = 0; round < PERF_ROUNDS; round++) {
      const order = round % 2 === 0 ? (["off", "on"] as const) : (["on", "off"] as const);
      for (const arm of order) p95[arm].push(await runTrial(browser, { toolbar: arm === "on", headings: n, shape: PERF_SHAPE }));
    }
    const off = median(p95.off), on = median(p95.on);
    perfResults.push({ label: `${n} headings (${PERF_SHAPE})`, headingCount: n, shape: PERF_SHAPE, off, on, rounds: p95 });
    expect(on, `toolbar-on p95 ${on.toFixed(1)} ms vs off ${off.toFixed(1)} ms`).toBeLessThanOrEqual(off * (1 + PERF_MAX_REGRESSION));
  });
}
```

`runTrial(browser, opts): Promise<number>`:
- Create a new context.
- Add `window.__TOOLBAR_OFF = true` via `addInitScript` when `!opts.toolbar`.
- Run `injectKeystrokeTimer`, then `EditorPage.goto` and `waitForSync`, then `setContent(generateLargeDocument(n, { shape }))`.
- When `opts.toolbar` is false, assert that `page.getByRole("toolbar")` has count 0.
- Apply the CPU throttle, click `.tiptap p`, and type 100 × `a` with `delay: 10`.
- Return `percentile(samples, 95)` and close the context.

Keep `writeReport` in `afterAll`.

- [ ] **Step 2: Run it and confirm it fails without the switch**

Run: `CI= bun playwright test tests/e2e/performance.spec.ts --project=chromium`
Expected: FAIL in `runTrial`. The toolbar count is 1 in the off arm because `__TOOLBAR_OFF` is not wired yet.

- [ ] **Step 3: Add `useToolbarOffForTests()` and wire it into `document-editor.tsx`**

- [ ] **Step 4: Run it and confirm it passes**

Run: `CI= bun playwright test tests/e2e/performance.spec.ts --project=chromium`
Expected: PASS. The report JSON under `test-reports/` holds both arms.

It stays in the CI chromium job, the HoE gate, and runs with `test.describe.configure({ mode: "serial" })` so its trials don't compete with each other.

Check stability under CI conditions: run the full `CI= bun playwright test --project=chromium` (3 workers) three times. If the assertion fails in any run, raise `PERF_ROUNDS` to 5 before considering other changes, and report the observed spread in the commit review report.

- [ ] **Step 5: Commit** after approval

```bash
git add tests/e2e/performance.spec.ts tests/e2e/helpers/perf-observer.ts components/document-editor/document-editor.tsx components/document-editor/toolbar-test-hooks.ts
git commit -m "test(perf): assert typing p95 with the toolbar within 10% of toolbar off"
```

---

### Task 9: axe sweep, CHANGELOG and full verification

HoE criterion A: "axe 0 serious per context; forced-colours snapshots".

**Files:**
- Modify: `package.json` and `bun.lock` (via `bun add -d @axe-core/playwright`)
- Modify: `tests/e2e/helpers/a11y.ts`, `tests/e2e/toolbar-a11y.spec.ts`
- Modify: `CHANGELOG.md` (Unreleased), `tests/TESTING.md`, `AGENTS.md` (the "Typing performance" fact)

**Interfaces:**
- Produces: `expectNoSeriousA11yViolations(page: Page, include: string[]): Promise<void>`.
  - It runs `new AxeBuilder({ page }).include(sel)` for each selector.
  - Tags: `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`. `wcag22aa` includes `target-size`, which covers 2.5.8.
  - It fails listing `id`, `impact` and targets for every violation with impact `serious` or `critical`.

- [ ] **Step 1: Add the dependency**

Run: `bun add -d @axe-core/playwright`
Expected: `package.json` `devDependencies` gains it and `bun.lock` changes. `bunfig.toml`'s 3-day minimum release age applies.

- [ ] **Step 2: Write the sweep**

```ts
const CONTEXTS = ["paragraph", "title", "heading", "bullet list", "code block", "table", "read-only"] as const;
for (const theme of ["light", "dark"] as const) {
  for (const context of CONTEXTS) {
    test(`toolbar has no serious axe violations: ${context}, ${theme}`, async ({ page }) => {
      await setTheme(page, theme);
      await placeCaretIn(page, context); // read-only: window.__tiptap_editor.setEditable(false)
      await expectNoSeriousA11yViolations(page, ['[role="toolbar"]']);
    });
  }
  for (const popup of ["text style menu", "list menu", "highlight dialog"] as const) {
    test(`open ${popup} has no serious axe violations (${theme})`, async ({ page }) => {
      await setTheme(page, theme);
      await openPopup(page, popup);
      await expectNoSeriousA11yViolations(page, ['[role="toolbar"]', '[role="menu"], [role="dialog"]']);
    });
  }
}
```

`placeCaretIn` and `openPopup` are local helpers in the spec. They build content with `setContent`, using `generateLargeDocument` fragments or explicit JSON.

- [ ] **Step 3: Run the sweep and fix what it finds**

Run: `CI= bun playwright test tests/e2e/toolbar-a11y.spec.ts --project=chromium`
Expected: PASS.

If a serious violation appears, fix it in the component that owns it, in its own commit with a `fix(…)` message naming the axe rule. Do not disable the rule.

- [ ] **Step 4: Update the docs**

`CHANGELOG.md` under `## [Unreleased]`, in the `### Fixed`, `### Changed` and `### Added` sections:
- **Fixed:**
  - toolbar focus outline and pressed bar, visible in dark mode and Windows High Contrast;
  - disabled toolbar controls stay focusable and say why;
  - style and list menus are named by value and use radio items;
  - highlight swatches are named pressed buttons in a dialog;
  - indent and outdent buttons work in lists;
  - headings and the caret stay clear of the sticky toolbar;
  - focus no longer drops to the page when a control disappears.
- **Changed:** the toolbar catches up within `TOOLBAR_MAX_WAIT_MS` (1 s) during continuous edits.
- **Added:**
  - `@axe-core/playwright`;
  - the toolbar a11y and behaviour specs;
  - the typing-budget assertion in `performance.spec.ts`.
- No Deploy note: client-only, no env.

`tests/TESTING.md`:
- add `toolbar.spec.ts` and `toolbar-a11y.spec.ts` under Feature Tests;
- describe the A/B method and env knobs under Performance Tests;
- list the dev-only hooks `__TOOLBAR_OFF` and `__toolbarCommits` under Key Conventions.

`AGENTS.md` "Typing performance": add "capped at `TOOLBAR_MAX_WAIT_MS` 1 s during continuous changes".

- [ ] **Step 5: Run full verification** against `make dev`, already running in a terminal

Run: `bun run typecheck`. Expected: exit 0.

Run: `bun biome check .`. Expected: no errors.

Run: `bun run lint`. Expected: no errors.

Run: `bun run test`. Expected: all pass.

Run: `CI= bun playwright test tests/e2e/toolbar.spec.ts tests/e2e/toolbar-a11y.spec.ts tests/e2e/performance.spec.ts tests/e2e/extensions.spec.ts tests/e2e/toc-sidebar.spec.ts tests/e2e/fold.spec.ts tests/e2e/collaboration.spec.ts --project=chromium`. Expected: all pass.

Run: `CI= bun playwright test --project=chromium`. Expected: the full chromium project passes. It is the CI e2e job.

- [ ] **Step 6: Check the screenshots in a browser**

Open `http://localhost:3000` in the browser pane and capture these states:
1. Light: Tab into the toolbar, arrow to Bold. Screenshot the focus outline.
2. Light: select text, press Mod+B. Screenshot Bold with the pressed bar.
3. Dark: toggle the theme and repeat 1 and 2.
4. Open the highlight dialog. Screenshot the pressed swatch with its check glyph.

Check each by eye:
- the outline is clearly visible and offset from the button;
- the bar sits at the bottom edge;
- nothing is clipped by the toolbar's `overflow-x-auto`. An outline offset inside a scroll container can clip; if it does, add `py-1` to the fixed toolbar or use `outline-offset: -2px` for toolbar buttons, and re-run Task 1's tests.

- [ ] **Step 7: Commit** after approval

```bash
git add package.json bun.lock tests/e2e/helpers/a11y.ts tests/e2e/toolbar-a11y.spec.ts CHANGELOG.md tests/TESTING.md AGENTS.md
git commit -m "test(a11y): add an axe sweep of the toolbar in every context"
```

---

## Self-review

1. **Spec coverage**
   - §6.1 → Task 1. §6.2 → Task 1. §6.3 → Task 4. §6.4 → Task 3. §6.5 → Task 2.
   - §6.6 → Task 2. Only the generic "focus never drops to `<body>`" part ships; the slot freeze is deferred.
   - §6.7: targets ≥24×24 are checked by axe `target-size` in Task 9. The 44×44 touch targets are deferred.
   - §6.8 → Task 6. The bottom padding is deferred.
   - §2 indent → Task 5. §4.2 `TOOLBAR_MAX_WAIT_MS` → Task 7.
   - HoE criterion A:
     - axe per context → Task 9;
     - forced colours → Task 1;
     - indent e2e → Task 5;
     - 1 s under remote typing → Task 7;
     - ≤1 commit per settle → Task 7;
     - p95 assertion → Task 8.
   - Every §6 "Plus:" item is listed as deferred in Global Constraints.
2. **Step scan:** every code step names its file, signature and pinned values. Test bodies left as comments state their exact assertions.
3. **Type consistency:**
   - `disabledReason` is used in Tasks 2 and 5.
   - `data-roving-group` is produced in Task 2 and consumed in Task 4.
   - `useToolbarOffForTests` is produced and consumed in Task 8. `toolbar-test-hooks.ts` is created in Task 7.
   - `TOOLBAR_MAX_WAIT_MS` is imported by both tests.
   - `TextStyleValue` and `ListValue` stay within Task 3.
4. **Review Focus:** each of the five lines has a test in its owning task: Tasks 2, 4, 1, 5 and 7.
5. **Proportion:** the plan is longer than the spec's PR A share, but most code blocks are tests. Implementation steps state signatures and values only.
