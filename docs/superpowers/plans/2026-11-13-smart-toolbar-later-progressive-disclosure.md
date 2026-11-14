# Smart toolbar, later phase: progressive-disclosure toggle, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Writers who want a calmer row can turn on **Simplified toolbar** from ⋯ (or the palette, only if listing it costs the palette's first Alt+/ no bytes; A13 left it 36 B). The row then shows its compact set at every width:
- alignment and indent move behind ¶;
- the context slot becomes one button;
- the colour pair becomes one button;
- Outline and Filter move behind View ▾;
- size becomes "M ▾";
- Insert loses its label;
- Theme moves into ⋯ (already automatic: `overflow-menu.tsx`'s `rowThemeHidden()` checks the row button's `checkVisibility()` when ⋯ opens).

Every action stays one click away through the stand-ins the responsive ladder already renders. The toggle is off by default, explicit only, never adaptive, never reorders anything, and is remembered locally in `tinydocy-ui`, so it survives "Forget my choices".

**Architecture:**
- **CSS only for the layout.** The ladder in `components/smart-toolbar/smart-toolbar.scss` hides `span[data-collapse-tier="tN"]` and shows `span[data-collapse-standin="tN"]` inside container queries. This plan factors that body into a `collapse-tier($tier)` mixin and applies the T2–T4 set under `[data-slot="toolbar"][data-toolbar-density="simple"]` at any width. Below the T4 width the ladder keeps collapsing as before; simplified mode never expands anything.
- **State:** a new `ui` slot, `toolbarDensity` (`"full" | "simple"`, fallback `"full"`), read by the shell with `useSyncExternalStore(subscribeChoices, read, () => "full")`. The editor is client-only (`components/editor-app/editor-app.tsx` loads it with `next/dynamic`, `ssr: false`), so it never hydrates and the first client render already has the stored value: nothing flashes. The constant server snapshot keeps it hydration-safe by construction if that ever changes. A `useEffect` "ready" flag (AGENTS.md, `useRememberedChoice`) would paint the full row first and break Review Focus 2, so this hook is the documented exception. The shell sets `data-toolbar-density` on `Toolbar`, which spreads div attributes (pinned API, contract §3.5).
- **Command:** one registry action, `view.simpleToolbar` (`mutates: false`), written by hand in `core/slot.ts` (`viewAction()` wraps an editor UI intent; this action has none). Its `run()` writes the slot, the normal memory path (contract §6). ⋯ renders it as a `menuitemcheckbox` whose checked state comes from the same hook. The palette lists it automatically.
- **⋯ item is lazy:** since #36 (A13) the ⋯ items live in `OverflowMenuItems` in `components/smart-toolbar/row/row-menu-bodies.tsx`, a lazy menu chunk. The checkbox item goes there; `overflow-menu.tsx` needs no change.
- **Roving repair:** the toolbar's `MutationObserver` also watches `data-toolbar-density` on its root, so toggling re-normalizes the single Tab stop and hands a hidden stop to its stand-in, as a width change does.

**Tech Stack:** SCSS container queries, React 19 `useSyncExternalStore`, Base UI `Menu` (`DropdownMenuCheckboxItem`), `bun test` (happy-dom), Playwright with `@axe-core/playwright`. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-12-smart-toolbar-design.md` §1 (non-goal: usage-adaptive reordering, after Findlater & McGrenere 2004 and Gajos et al. 2006), §4.1 (⋯ contents), §4.6 (ladder and never-collapse set), §5 (memory rules and keys), §6, §7, §8 item 6. Research: Word for the web's simplified ribbon (sources, round 1).

**Contract:** `docs/superpowers/specs/2026-11-13-smart-toolbar-v1-contract.md` §3.5 (pinned `Toolbar` API), §5.3 (responsive DOM contract), §6 (memory), §10 A5 (measured ladder thresholds).

**Base:** `main` at `4b55ec6` (#36 merged: menu bodies lazy, contract A13). Before Task 1, confirm:
- `git grep -n "@mixin ladder" components/smart-toolbar/smart-toolbar.scss`;
- `git grep -n 'attributeFilter: \["tabindex", "hidden", "disabled"\]' components/ui/toolbar.tsx`;
- `git grep -n 'viewAction("view.theme"' lib/editor-actions/core/slot.ts`;
- `git grep -n "export function OverflowMenuItems" components/smart-toolbar/row/row-menu-bodies.tsx`.

**Effort:** S, about **2–3 engineer-days**: SCSS refactor and simplified set 0.5, slot, action and ⋯ item 0.5, roving repair 0.5, ladder sweep, a11y and docs 1.

## Global Constraints

**Tooling**
- Bun only: `bun`, `bun <bin>`, `bunx --bun`. Never npm, npx, yarn or pnpm.
- Biome formats and lints. ESLint covers Next rules only. TypeScript is strict. `bun run typecheck` covers the app and `tsconfig.sw.json`.

**Code style**
- Named exports only. Kebab-case files. PascalCase components with title-case acronyms.
- Icons come from `lib/icons.tsx`. No new icon: `ChevronsDownUpIcon` is Fold section's, so the design review may ask for none.

**Commits**
- Conventional Commits: atomic, imperative mood.
- No AI, tool or agent references and no trailers.
- Before every commit, show a commit review report (files, diff summary, message) and wait for explicit approval.
- `CHANGELOG.md`: one sub-block for this PR under `## [Unreleased]`.

**Tests**
- `bun run test`: one process, happy-dom preload. `mock.module` spreads the real module and is followed by `await import()`. The kill switch is read at import time, so use `importFresh()` with `resetModules()` in `afterEach`.
- Playwright runs against **Next 6240 + Hocus 4240** (the later-phase sessions run in parallel; 3000, 1234, 5000 and 6000 are off limits). The kill-switch run uses a second Next on **6241** built with `NEXT_PUBLIC_REMEMBER_CHOICES=0`. Never test against tiny.docs.plus. Run `lsof` first and stop only what you started.

```bash
DOC_CREATION_RATE_LIMIT=2000 WS_CONNECTION_LIMIT=200 WS_SOCKETS_PER_IP=600 WS_UPGRADE_RATE_LIMIT=6000 \
  HOCUS_THROTTLE=0 MAX_TOTAL_DOCUMENTS=1000000 HOCUS_PORT=4240 DB_PATH="$TMPDIR/tinydocy-density.sqlite" \
  HOCUS_ALLOW_ISOLATED_TABS_DOCS=1 bun run hocus
NEXT_PUBLIC_HOCUS_URL=ws://127.0.0.1:4240 DB_PATH="$TMPDIR/tinydocy-density.sqlite" bun next dev -p 6240
CI= E2E_BASE_URL=http://localhost:6240 bun playwright test <spec> --project=chromium
```

- Touch e2e: `test.use({ hasTouch: true, isMobile: true })`, first assertion `matchMedia("(pointer: coarse)").matches === true`.

**Code rules**
- Hydration: the shell reads the slot with `useSyncExternalStore` and a constant server snapshot (`"full"`). Never `useState(() => readStorage())`. The editor never hydrates (`ssr: false`), so the first client render reads storage and the row never flashes; a `useEffect` ready flag would paint the full row first (see Architecture, State).
- Never subscribe the editor shell to editor state. Never rebuild the extensions array or `EDITOR_PROPS`. The density hook re-renders the shell only when the stored value changes.
- Controls never pass `tabIndex`; the `Toolbar` owns it.
- The row never reorders (spec §1): simplified mode only hides groups behind the stand-ins that already exist.

**Contract rules**
- `tests/unit/editor-actions/contract.test.ts` is frozen and pins `CHOICE_SLOTS` with `toEqual`. Adding `toolbarDensity: "ui"` changes that case in the same commit as a contract amendment (titled "A-next" until the number is assigned in merge order), which also updates contract §6's `CHOICE_SLOTS` block.
- `lib/editor-actions/core/slot.ts`, `components/ui/toolbar.tsx` and `components/smart-toolbar/row/row-menu-bodies.tsx` (the lazy ⋯ items since A13) are D1 files. `lib/remembered-choice.ts` and `smart-toolbar.scss` are D2 files. All edits fall under the A6 grant and are listed in the amendment.
- No new prefix or group: `view.` and `view` already exist (D1).

## Schema and protocol

**None. This plan needs no schema change and no protocol change.**
- No mark, node or attribute is added, so `lib/schema-names.ts` and `tests/fixtures/schema-snapshot.json` are unchanged. No WebSocket parameter and no Hocus change.
- The setting lives in this browser only (`tinydocy-ui`). It never reaches the document, the server, URLs or analytics.

## Budgets

**Editor chunk (`scripts/check-editor-chunk-size.ts`, gz).** The script sums every file the editor's loader lists, **CSS included**. The budget is 23.5 KB (24,064 B, A12). After the trim (#36, contract A13, menu bodies lazy) a production build of `main` at `4b55ec6` measures **394,567 B gz, +16,679 B, 7,385 B of headroom** (re-measured by this plan before Task 1: identical). The four later-phase plans each get a cap, measured against that build:

| Plan | Eager cap | What is eager | Lazy |
|---|---|---|---|
| M15 Continue where you left off | set by its session | one lazy loader and its idle mount | continue chunk ≤ 3 KB gz |
| "/" menu | set by its session | trigger plugin, host, one lazy loader | slash chunk ≤ 6 KB gz |
| Hover preview | set by its session | the decoration plugin | ≤ +1 KB gz on the colour-panel chunk |
| **Progressive-disclosure toggle (this plan)** | **< 1,000 B** | the `view.simpleToolbar` definition, the shell hook and attribute, one `attributeFilter` entry, the stand-in hand-off, the simplified CSS rules | the ⋯ checkbox item (menu chunk) |

- A lazy chunk that imports modules the editor chunk also uses makes Turbopack split those modules into separate, less compressible editor-group files (A8 measured about 344 B for the palette chunk). This plan adds no lazy chunk; its ⋯ item joins the existing menu chunk.
- No plan raises the constant itself. Going over this plan's cap needs a trim or the owner's amendment.
- **Palette (A7, 20 KB gz on the first Alt+/):** 20,444 B, 36 B left. The action is defined in `core/slot.ts`, which the editor chunk already loads, so the palette chunk itself should not change. Compare the palette chunk files of the baseline and the new build by name (content hash) and gzip size; if they differ, measure with `PALETTE_BUDGET=1` against `next start`. If listing the action costs any palette bytes, leave the palette out (do not bypass the registry: contract §6 keeps one write path).

The simplified rules live in eager `smart-toolbar.scss`, so they count against the gate. They repeat short selectors that gzip well. Record the measured delta in the amendment and the PR, and the new headroom for the other plans.

**Performance:**
- Typing p95 is unchanged (≤ +10% and ≤ +16 ms, `--project=perf`). Nothing here runs per transaction.
- A toggle costs one style recalculation of the row and one roving normalization (< 16 ms).
- Arrow-key p95 is unchanged, and stays log-only per O2.
- Simplified mode mounts no extra subscriptions: the stand-ins are always mounted (O7 measured them) and only their visibility changes.

## Accessibility requirements (WCAG 2.2 AA)

- **One Tab stop is kept, and focus is never dropped.** Toggling from ⋯ returns focus to the ⋯ trigger, which never collapses. When the roving stop was on an item that simplified mode hides, the stop moves to that group's stand-in (as for a width change, spec §4.6, Review Focus 1). Toggling from the palette returns focus to the editor (palette behaviour).
- **State is announced:** the ⋯ item is a `menuitemcheckbox` named "Simplified toolbar", with `aria-checked`. The palette row has the same name and keywords ("compact", "fewer tools", "minimal").
- **Nothing becomes unreachable:** each hidden group has a stand-in with an accessible name (¶ "Paragraph options", View ▾ "View options", colour "Colours", slot "*Context* tools", size "Text size"). The never-collapse set stays visible: Undo, Redo, Text style, Bold, Italic, Link, List, Insert, ⋯.
- **Targets:** unchanged. Stand-ins already meet ≥ 24×24, and 44×44 on touch (spec §6.7, A5).
- **Contrast and forced colours:** unchanged components. The checkbox glyph survives forced colours (shadcn item).
- **Reflow (1.4.10):** `scrollWidth ≤ clientWidth + 1` holds at every width from 1440 to 768 in simplified mode too.
- **Predictable (3.2):** the change happens only on the writer's explicit toggle, never by itself (spec §1 non-goal).

## Upstream interfaces (as on `main` at `4b55ec6`)

| # | Name | Where | Used for |
|---|---|---|---|
| U1 | `@mixin ladder($tiers)` with `$ladder-mouse` and `$ladder-touch` | `components/smart-toolbar/smart-toolbar.scss` | factored into `collapse-tier($tier)` |
| U2 | `data-collapse-tier`, `data-collapse-standin`, `data-toolbar-group` | `components/document-editor/main-toolbar-content.tsx`, contract §5.3 | the hooks the CSS reads |
| U3 | `Toolbar` (div attributes spread last), `MutationObserver` `attributeFilter`, the resize focus hand-off | `components/ui/toolbar.tsx` | the density attribute; the roving repair |
| U4 | `viewAction(...)`, `slotActions` | `lib/editor-actions/core/slot.ts` | where `view.simpleToolbar` is defined |
| U5 | `OverflowMenuItems` (`TOGGLES`, `COMMANDS`, `ThemeMenuItem` pattern; lazy since A13), `ActionMenuItem` checkbox markup and the design-pass §10 reason line | `components/smart-toolbar/row/row-menu-bodies.tsx`, `components/smart-toolbar/row/menu-items.tsx` | the checkbox item |
| U6 | `CHOICE_SLOTS`, `ChoiceSpec`, `readChoice`, `rememberChoice`, `subscribeChoices`, `REMEMBER_CHOICES_ENABLED` | `lib/remembered-choice.ts` | the new slot and its spec |
| U7 | `toolbar-ladder.spec.ts` (overflow and one Tab stop, 1440 → 768, mouse and touch, four contexts) | `tests/e2e/toolbar-ladder.spec.ts` | extended with simplified mode |
| U8 | `ChevronsDownUpIcon` | `lib/icons.tsx` | Fold section's icon: not reused (see Code style) |

## Decisions on spec ambiguities (owner can overrule)

1. **Simplified = the T4 collapse set** (t2, t3 and t4 stand-ins), not T5. T5 also folds Underline and Strike into "Aa" and shortens the style value, which costs everyday clicks. Below the T4/T5 widths the ladder still applies, so a narrow window gets T5 as before.
2. **Off by default and never suggested.** No nudge and no "you seem to use few tools" prompt (spec §1 non-goal, research above).
3. **Remembered in `tinydocy-ui`** (slot `toolbarDensity`), like the outline (M6). "Forget my choices" keeps it: it is a layout preference, not a remembered choice.
4. **Kill switch:** with `NEXT_PUBLIC_REMEMBER_CHOICES=0`, `readChoice` returns the fallback for every slot, so the setting cannot be kept. `view.simpleToolbar` is then disabled with "Remembering choices is turned off." rather than toggling something that resets on reload. In ⋯ the reason is a visible second line and only the label dims (design pass §10), as every other disabled menu item.
5. **Phones:** below 768 px there is no row (the docked bar is already the minimal set), so the setting has no effect there. The Aa sheet does not list it.
6. **Palette label is static** ("Simplified toolbar"). An action's `value()` and `isActive()` may read only `ctx` (contract §3.1; E's two documented exceptions are the only external reads), so the palette row cannot show the current state. The ⋯ item shows it through the hook. The row's visible change confirms a palette toggle.
7. **Blocked storage:** if `localStorage` throws, `rememberChoice` drops the write and nothing toggles. This matches every other remembered control. The ⋯ item stays enabled, because the failure cannot be detected before the write.

## Not in scope

- Per-group show/hide customization (a "customize toolbar" dialog).
- Reordering, pinning or any usage-driven change (spec §1 non-goal).
- A simplified phone bar or a simplified bubble.
- Document styles (M14b); see the "/" menu plan's "Not in scope".

## Review Focus

1. **The roving stop on a newly hidden item.** Put the stop on "Align left" (arrow there, then Esc to the editor), toggle simplified from the palette, then Tab into the toolbar. Focus must land on a visible item (the ¶ stand-in), never skip the toolbar or reach `<body>`. Task 3 e2e.
2. **No flash on load.** With simplified stored, the first painted row is already simplified (no frame of the full row). Task 2 e2e with a `layout-shift` observer and a screenshot at first paint.
3. **No overflow at any width in either mode.** Task 4 extends `toolbar-ladder.spec.ts`.
4. **`contract.test.ts` changes only its `CHOICE_SLOTS` case**, in the amendment commit. Task 2.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `components/smart-toolbar/smart-toolbar.scss` | `collapse-tier($tier)` mixin; ladder uses it; simplified rules under `[data-toolbar-density="simple"]` | Modify (D2 file, A6 grant) |
| `lib/remembered-choice.ts` | `CHOICE_SLOTS.toolbarDensity = "ui"`; `TOOLBAR_DENSITY_CHOICE`; `ToolbarDensity` type | Modify (D2 file, A6 grant) |
| `lib/editor-actions/core/slot.ts` | `view.simpleToolbar` (`mutates: false`, `run` writes the slot) | Modify (D1 file, A6 grant) |
| `hooks/use-toolbar-density.ts` | `useToolbarDensity(): ToolbarDensity` (`useSyncExternalStore`) | Create |
| `components/document-editor/document-editor.tsx` | `data-toolbar-density` on the row's `Toolbar` | Modify (shared §5.2 hunk) |
| `components/smart-toolbar/row/row-menu-bodies.tsx` | `DensityMenuItem` (`menuitemcheckbox`) in the lazy `OverflowMenuItems` | Modify (D1 file, A6 grant) |
| `components/ui/toolbar.tsx` | Watch `data-toolbar-density` on the root; reuse the hidden-stop hand-off | Modify (D1 file, A6 grant) |
| `tests/unit/editor-actions/contract.test.ts` | `CHOICE_SLOTS` case gains `toolbarDensity: "ui"` | Modify (frozen: amendment) |
| `tests/unit/lib/remembered-choice.test.ts`, `tests/unit/editor-actions/core-actions.test.ts`, `tests/unit/components/toolbar.test.tsx`, `tests/unit/hooks/use-toolbar-density.test.tsx` | Unit tests | Modify / Modify / Modify / Create |
| `tests/e2e/toolbar-density.spec.ts`, `tests/e2e/toolbar-ladder.spec.ts` | e2e | Create / Modify |
| `docs/superpowers/specs/2026-11-13-smart-toolbar-v1-contract.md` | Amendment: the slot, the action, the file hunks; §6 block updated | Modify |
| `CHANGELOG.md`, `README.md`, `tests/TESTING.md`, `AGENTS.md` | Docs | Modify |

---

### Task 1: The simplified collapse set in CSS

**Files:**
- Modify: `components/smart-toolbar/smart-toolbar.scss`
- Test: `tests/e2e/toolbar-density.spec.ts` (CSS-only cases, with the attribute set by the test)

**Interfaces:**
- `@mixin collapse-tier($tier)` holds today's per-tier body: hide `span[data-collapse-tier="#{$tier}"]`, show `span[data-collapse-standin="#{$tier}"]`, plus the t2 Insert-label rules and the t3 slot-separator rule. The t5-only rules (short style value, no separators) stay in the ladder only.
- `@mixin ladder($tiers)` calls `collapse-tier` inside each container query, and the compiled ladder rules are unchanged (compare the built CSS before and after).
- `[data-slot="toolbar"][data-variant="fixed"][data-toolbar-density="simple"] { @include collapse-tier(t2); @include collapse-tier(t3); @include collapse-tier(t4); }`.
- **Selector root:** today's t2 rule writes `[data-slot="toolbar"] .st-insert-trigger--split .st-insert-plus` (the prefix gives it specificity over the later base rule). Included under the density selector it would nest as a descendant of the toolbar and never match, so the mixin takes the toolbar root as a parameter (or uses `&`) and both call sites keep the needed specificity.
- **Ladder unchanged:** compile `smart-toolbar.scss` with the `sass` package before and after the refactor and diff the ladder rules (deterministic); the e2e then checks the visible set at a few widths only.

- [ ] **Step 1: Write the failing tests**

```ts
// toolbar-density.spec.ts (sets data-toolbar-density on the row by hand for this task)
test("simplified at 1440px shows exactly the T4 set and every stand-in", async ({ page }) => {
  // align, indent, slot contents, colour pair, Outline, Filter, size stepper, Insert label, Theme: not visible
  // ¶, slot stand-in, colour stand-in, View ▾, M ▾: visible; Undo..⋯ never-collapse set visible
});
test("simplified never shows more than the ladder at a narrow width", async ({ page }) => {
  // 900px: same visible set as without the attribute (T4/T5 ladder wins)
});
// "compiled ladder CSS is unchanged": a sass compile diff before and after (see Interfaces), not an e2e.
```

- [ ] **Step 2: Run them and confirm they fail.** Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run them, plus `toolbar-ladder.spec.ts`.** Expected: PASS.

- [ ] **Step 5: Commit** after approval: `style(toolbar): add a simplified collapse set to the ladder`

---

### Task 2: The setting, the action and the ⋯ item

**Files:**
- Modify: `lib/remembered-choice.ts`, `lib/editor-actions/core/slot.ts`, `components/smart-toolbar/row/row-menu-bodies.tsx`, `components/document-editor/document-editor.tsx`, `tests/unit/editor-actions/contract.test.ts`, `docs/superpowers/specs/2026-11-13-smart-toolbar-v1-contract.md`
- Create: `hooks/use-toolbar-density.ts`
- Test: `tests/unit/lib/remembered-choice.test.ts`, `tests/unit/editor-actions/core-actions.test.ts`, `tests/unit/hooks/use-toolbar-density.test.tsx`, `tests/e2e/toolbar-density.spec.ts`

**Interfaces:**
- **In `lib/remembered-choice.ts`:**
  ```ts
  export const TOOLBAR_DENSITIES = ["full", "simple"] as const;
  export type ToolbarDensity = (typeof TOOLBAR_DENSITIES)[number];
  export const TOOLBAR_DENSITY_CHOICE: ChoiceSpec<ToolbarDensity>;   // slot "toolbarDensity" ("ui"), maxRecent 0, fallback "full"
  ```
- **`view.simpleToolbar`:**
  - label "Simplified toolbar", group `view`, contexts `"any"`, `mutates: false`, no icon (Fold section owns `ChevronsDownUpIcon`);
  - keywords `["compact", "fewer tools", "minimal", "density", "show all tools"]`;
  - `enabled` returns `{ reason: "Remembering choices is turned off." }` when `!REMEMBER_CHOICES_ENABLED`, else `true`;
  - `run` flips `readChoice(TOOLBAR_DENSITY_CHOICE).last` through `rememberChoice` and returns true.
- **`useToolbarDensity()`:** `useSyncExternalStore(subscribeChoices, () => readChoice(TOOLBAR_DENSITY_CHOICE).last, () => "full")`.
- **`DensityMenuItem`** (in `row-menu-bodies.tsx`, the lazy menu chunk): a `DropdownMenuCheckboxItem` with `checked={density === "simple"}`, mirroring `ActionMenuItem`'s checkbox markup without editing `menu-items.tsx`. It runs the action through `runAction` and closes the menu on click (`closeOnClick`), so the row never collapses under an open menu. Like Theme it does not call `onPicked` (which sends focus to the editor), so focus returns to the ⋯ trigger. Under the kill switch it is disabled with the reason as a visible line (design pass §10). It sits after the `COMMANDS` items and before Theme.
- **`document-editor.tsx`:** `<Toolbar … data-toolbar-density={density}>` on the desktop row only.
- **The amendment records:**
  - the slot;
  - the action;
  - the file hunks (`remembered-choice.ts`, `core/slot.ts`, `row-menu-bodies.tsx`, `document-editor.tsx`, `toolbar.tsx`, `smart-toolbar.scss`);
  - the `contract.test.ts` `CHOICE_SLOTS` case;
  - the measured eager bytes.

- [ ] **Step 1: Write the failing tests**

```ts
// remembered-choice.test.ts
it("toolbarDensity lives in tinydocy-ui and survives Forget my choices", () => {});
it("tamper: any value other than full/simple reads as full", () => {});
// core-actions.test.ts (also extends the pinned mutates:false list, amendment A1's test)
it("view.simpleToolbar flips the setting, never changes the doc, and runs in read-only", () => {});
it("view.simpleToolbar is disabled with a reason under the kill switch", async () => { /* importFresh */ });
// use-toolbar-density.test.tsx
it("reads the stored value at first render on the client and follows in-tab and cross-tab writes", () => {});
// contract.test.ts: CHOICE_SLOTS toEqual gains toolbarDensity: "ui" (amendment commit)
```

```ts
// toolbar-density.spec.ts
test("⋯ > Simplified toolbar collapses the row, is checked, and focus returns to ⋯", async ({ page }) => {});
test("the setting survives reload and Forget my choices", async ({ page }) => {});
test("no flash on load: the first painted row is already simplified", async ({ page }) => {
  // addInitScript seeds tinydocy-ui; layout-shift total 0; screenshot at first editor paint
});
test("the palette lists Simplified toolbar and toggles it", async ({ page }) => {});
```

- [ ] **Step 2: Run them and confirm they fail.** Expected: FAIL.

- [ ] **Step 3: Implement**, then write the amendment, including contract §6's `CHOICE_SLOTS` block.

- [ ] **Step 4: Run them, plus `contract.test.ts`, `toolbar-memory.spec.ts` and `palette.spec.ts`.** Expected: PASS.

- [ ] **Step 5: Commit** after approval: `feat(toolbar): add a remembered simplified toolbar toggle`

---

### Task 3: Roving repair on toggle

**Files:**
- Modify: `components/ui/toolbar.tsx`
- Test: `tests/unit/components/toolbar.test.tsx`, `tests/e2e/toolbar-density.spec.ts`

**Interfaces:**
- The toolbar's `MutationObserver` also observes the root's `data-toolbar-density` (`attributeFilter` gains it). The record targets the root, so `needsFullPass` is true and `normalize()` re-picks a visible stop.
- The resize callback's hidden-stop hand-off (stop or `lastFocus` hidden → that group's `[data-collapse-standin]` item, else the nearest index) moves into a named function. `normalize()` uses it when the old stop is no longer visible (today it falls back to the nearest index, which lands on the wrong item when Align left hides), and the `ResizeObserver` focus repair reuses it.
- No new public API (contract §3.5 primitives unchanged).

- [ ] **Step 1: Write the failing tests**

```ts
// toolbar.test.tsx
it("a density change re-picks a visible Tab stop and hands a hidden stop to its stand-in", () => {});
```

```ts
// toolbar-density.spec.ts
test("stop on Align left, toggle from the palette, Tab lands on the ¶ stand-in", async ({ page }) => {});
test("one Tab stop before and after toggling, mouse and touch", async ({ browser }) => { /* touch: pointer: coarse first */ });
```

- [ ] **Step 2: Run them and confirm they fail.** Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run them, plus `toolbar-row.spec.ts` and `toolbar-a11y.spec.ts`.** Expected: PASS.

- [ ] **Step 5: Commit** after approval: `fix(toolbar): keep one visible tab stop when the density changes`

---

### Task 4: Ladder sweep, accessibility, kill switch, budgets and docs

**Files:**
- Modify: `tests/e2e/toolbar-ladder.spec.ts` (simplified sweep), `tests/e2e/toolbar-a11y.spec.ts` (axe in simplified mode), `tests/e2e/toolbar-density.spec.ts` (kill switch), `CHANGELOG.md`, `README.md` (feature line; the `NEXT_PUBLIC_REMEMBER_CHOICES` row mentions the setting), `tests/TESTING.md` (spec, ports 6240/4240 and 6241), `AGENTS.md` (one line: simplified = T4 collapse set by attribute, `tinydocy-ui` slot, CSS only)

- [ ] **Step 1: Write the failing tests**

```ts
// toolbar-ladder.spec.ts
test("simplified: scrollWidth <= clientWidth + 1 and one Tab stop from 1440 to 768, four contexts, mouse and touch", async ({ page }) => {});
// toolbar-a11y.spec.ts
test("simplified row: axe 0 serious, light and dark", async ({ page }) => {});
// toolbar-density.spec.ts
test.skip(process.env.E2E_REMEMBER_OFF !== "1", "needs Next on 6241 built with NEXT_PUBLIC_REMEMBER_CHOICES=0");
test("kill switch: the ⋯ item is aria-disabled with its reason; the row stays full", async ({ page }) => {});
```

- [ ] **Step 2: Run them and confirm the new ones fail or are unwired.**

- [ ] **Step 3: Write the docs.** The CHANGELOG says "no schema or protocol change" and needs no Deploy note.

- [ ] **Step 4: Run the full verification**

```bash
bun audit --audit-level=high && bun biome check . && bun run lint && bun run typecheck && bun run test && bun run build
bun scripts/check-editor-chunk-size.ts        # eager delta (CSS included) against this plan's < 1,000 B cap; record the new headroom for the other plans
CI= E2E_BASE_URL=http://localhost:6240 bun playwright test --project=chromium --project=perf
CI= E2E_BASE_URL=http://localhost:6240 bun playwright test tests/e2e/toolbar-density.spec.ts tests/e2e/toolbar-ladder.spec.ts --project=chromium --repeat-each=5 --workers=3
E2E_REMEMBER_OFF=1 CI= E2E_BASE_URL=http://localhost:6241 bun playwright test tests/e2e/toolbar-density.spec.ts --project=chromium
```

Expected: everything passes. Record the eager delta, the remaining headroom, and screenshots of the row in both modes at 1440, 1024, 768 and 375 px, light and dark, plus the ⋯ toggle. A UI designer and a UX designer review them before merge (owner rule).

- [ ] **Step 5: Commit** after approval: `test(toolbar): sweep the simplified row across widths and contexts`

---

## Test plan (summary)

| Layer | What | Where |
|---|---|---|
| Unit | Slot key and Forget survival, tamper, action flip and read-only, kill switch, hook first render and change feed, roving re-pick | `remembered-choice.test.ts`, `core-actions.test.ts`, `use-toolbar-density.test.tsx`, `toolbar.test.tsx` |
| Unit | `CHOICE_SLOTS` pinned with the new slot | `contract.test.ts` (amendment) |
| e2e | Visible set at 1440, narrow widths unchanged, ladder unchanged without the attribute, ⋯ toggle and focus, reload and Forget, no flash, palette | `toolbar-density.spec.ts` |
| e2e | Hidden stop hand-off, one Tab stop, mouse and touch (`pointer: coarse` first) | `toolbar-density.spec.ts` |
| e2e | Overflow and one Tab stop 1440 → 768 in simplified mode, four contexts | `toolbar-ladder.spec.ts` |
| e2e | axe light and dark; kill switch (6241) | `toolbar-a11y.spec.ts`, `toolbar-density.spec.ts` |
| perf | Typing p95 ≤ +10% and ≤ +16 ms | `--project=perf` |
| size | Eager < 1,000 B, CSS included; palette first Alt+/ unchanged | `check-editor-chunk-size.ts`, chunk diff or `PALETTE_BUDGET=1` |

## Acceptance criteria

- ⋯ > Simplified toolbar (and the palette row) toggles the T4 collapse set at every width, keeps every action reachable through a stand-in, and keeps the never-collapse set visible.
- The setting survives reload and "Forget my choices", never flashes on load, and is disabled with a reason under the kill switch.
- One Tab stop, focus never dropped, `scrollWidth ≤ clientWidth + 1` from 1440 to 768 in both modes, axe reports 0 serious issues.
- No schema or protocol change. `contract.test.ts` changes only its `CHOICE_SLOTS` case, recorded in the amendment.
- The eager delta (CSS included) is < 1,000 B (or the owner recorded an amendment), and typing p95 holds.

## Risks

| Risk | Mitigation |
|---|---|
| The SCSS refactor changes a ladder rule by accident | Task 1's "compiled ladder CSS is unchanged" e2e at every A5 boundary ±1 px, plus `toolbar-ladder.spec.ts`. |
| The action, hook and CSS cost more than the cap | The ⋯ item is in the lazy menu chunk; add no icon. If still over, trim the CSS (fewer repeated selectors) or ask the owner. |
| Writers lose a tool in simplified mode and do not find it | Every hidden group keeps a named stand-in, and the ⋯ item shows the checked state. The README feature line explains it. |
| A later tier change (a new A5 measurement) drifts from the simplified set | The simplified set is defined by tier names (t2–t4), not widths, so a threshold change needs no edit. |

## Self-review

1. **Spec coverage:**
   - "progressive-disclosure toggle" (§8 item 6) → Tasks 1–2.
   - Never adaptive, never reorders (§1) → Decisions 1–2 and the CSS-only design.
   - ⋯ contents (§4.1) → Task 2.
   - Never-collapse set and focus repair (§4.6) → Tasks 1 and 3.
   - Memory keys and rules (§5) → Task 2.
   - §6 and §7 → Tasks 3 and 4.
2. **Schema and protocol:** none, stated.
3. **Type consistency:** `ToolbarDensity` and `TOOLBAR_DENSITY_CHOICE` (Task 2) are used by the hook, the action and the ⋯ item. `collapse-tier` (Task 1) is used by the ladder and the simplified rules.
4. **Review Focus:** each item names its test, in Tasks 1–4.
