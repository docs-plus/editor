# Smart toolbar, later phase: progressive-disclosure toggle, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Writers who want a calmer row can turn on **Simplified toolbar** from ⋯ (or the palette). The row then shows its compact set at every width:
- alignment and indent move behind ¶;
- the context slot becomes one button;
- the colour pair becomes one button;
- Outline and Filter move behind View ▾;
- size becomes "M ▾";
- Insert loses its label;
- Theme moves into ⋯.

Every action stays one click away through the stand-ins the responsive ladder already renders. The toggle is off by default, explicit only, never adaptive, never reorders anything, and is remembered locally in `tinydocy-ui`, so it survives "Forget my choices".

**Architecture:**
- **CSS only for the layout.** The ladder in `components/smart-toolbar/smart-toolbar.scss` hides `span[data-collapse-tier="tN"]` and shows `span[data-collapse-standin="tN"]` inside container queries. This plan factors that body into a `collapse-tier($tier)` mixin and applies the T2–T4 set under `[data-slot="toolbar"][data-toolbar-density="simple"]` at any width. Below the T4 width the ladder keeps collapsing as before; simplified mode never expands anything.
- **State:** a new `ui` slot, `toolbarDensity` (`"full" | "simple"`, fallback `"full"`), read by the shell with `useSyncExternalStore(subscribeChoices, …)`. The editor is client-only, so the first render already has the stored value and nothing flashes. The shell sets `data-toolbar-density` on `Toolbar`, which spreads div attributes (pinned API, contract §3.5).
- **Command:** one registry action, `view.simpleToolbar` (`mutates: false`). Its `run()` writes the slot, the normal memory path (contract §6). ⋯ renders it as a `menuitemcheckbox` whose checked state comes from the same hook. The palette lists it automatically.
- **Roving repair:** the toolbar's `MutationObserver` also watches `data-toolbar-density` on its root, so toggling re-normalizes the single Tab stop and hands a hidden stop to its stand-in, as a width change does.

**Tech Stack:** SCSS container queries, React 19 `useSyncExternalStore`, Base UI `Menu` (`DropdownMenuCheckboxItem`), `bun test` (happy-dom), Playwright with `@axe-core/playwright`. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-12-smart-toolbar-design.md` §1 (non-goal: usage-adaptive reordering, after Findlater & McGrenere 2004 and Gajos et al. 2006), §4.1 (⋯ contents), §4.6 (ladder and never-collapse set), §5 (memory rules and keys), §6, §7, §8 item 6. Research: Word for the web's simplified ribbon (sources, round 1).

**Contract:** `docs/superpowers/specs/2026-11-13-smart-toolbar-v1-contract.md` §3.5 (pinned `Toolbar` API), §5.3 (responsive DOM contract), §6 (memory), §10 A5 (measured ladder thresholds).

**Base:** branch `feat/smart-toolbar-density` from `main` at or after `7abadc1`. Before Task 1, confirm:
- `git grep -n "@mixin ladder" components/smart-toolbar/smart-toolbar.scss`;
- `git grep -n 'attributeFilter: \["tabindex", "hidden", "disabled"\]' components/ui/toolbar.tsx`;
- `git grep -n 'viewAction("view.theme"' lib/editor-actions/core/slot.ts`.

**Effort:** S, about **2–3 engineer-days**: SCSS refactor and simplified set 0.5, slot, action and ⋯ item 0.5, roving repair 0.5, ladder sweep, a11y and docs 1.

## Global Constraints

**Tooling**
- Bun only: `bun`, `bun <bin>`, `bunx --bun`. Never npm, npx, yarn or pnpm.
- Biome formats and lints. ESLint covers Next rules only. TypeScript is strict. `bun run typecheck` covers the app and `tsconfig.sw.json`.

**Code style**
- Named exports only. Kebab-case files. PascalCase components with title-case acronyms.
- Icons come from `lib/icons.tsx`. Reuse `ChevronsDownUpIcon` (already exported), so no new icon bytes are added.

**Commits**
- Conventional Commits: atomic, imperative mood.
- No AI, tool or agent references and no trailers.
- Before every commit, show a commit review report (files, diff summary, message) and wait for explicit approval.
- `CHANGELOG.md`: one sub-block for this PR under `## [Unreleased]`.

**Tests**
- `bun run test`: one process, happy-dom preload. `mock.module` spreads the real module and is followed by `await import()`. The kill switch is read at import time, so use `importFresh()` with `resetModules()` in `afterEach`.
- Playwright runs against **Next 3640 + Hocus 1740**. The kill-switch run uses a second Next on **3641** built with `NEXT_PUBLIC_REMEMBER_CHOICES=0`. None of these ports is taken by contract §5.4, D2 or E. Never test against tiny.docs.plus. Run `lsof` first and stop only what you started.

```bash
DOC_CREATION_RATE_LIMIT=2000 WS_CONNECTION_LIMIT=200 WS_SOCKETS_PER_IP=600 WS_UPGRADE_RATE_LIMIT=6000 \
  HOCUS_THROTTLE=0 MAX_TOTAL_DOCUMENTS=1000000 HOCUS_PORT=1740 DB_PATH="$TMPDIR/tinydocy-density.sqlite" \
  HOCUS_ALLOW_ISOLATED_TABS_DOCS=1 bun run hocus
NEXT_PUBLIC_HOCUS_URL=ws://127.0.0.1:1740 DB_PATH="$TMPDIR/tinydocy-density.sqlite" bun next dev -p 3640
CI= E2E_BASE_URL=http://localhost:3640 E2E_HOCUS_URL=ws://127.0.0.1:1740 bun playwright test <spec> --project=chromium
```

- Touch e2e: `test.use({ hasTouch: true, isMobile: true })`, first assertion `matchMedia("(pointer: coarse)").matches === true`.

**Code rules**
- Hydration: the shell reads the slot with `useSyncExternalStore` and a constant server snapshot (`"full"`). Never `useState(() => readStorage())`.
- Never subscribe the editor shell to editor state. Never rebuild the extensions array or `EDITOR_PROPS`. The density hook re-renders the shell only when the stored value changes.
- Controls never pass `tabIndex`; the `Toolbar` owns it.
- The row never reorders (spec §1): simplified mode only hides groups behind the stand-ins that already exist.

**Contract rules**
- `tests/unit/editor-actions/contract.test.ts` is frozen and pins `CHOICE_SLOTS` with `toEqual`. Adding `toolbarDensity: "ui"` changes that case in the same commit as a contract amendment (next free A-number at merge), which also updates contract §6's `CHOICE_SLOTS` block.
- `lib/editor-actions/core/slot.ts`, `components/ui/toolbar.tsx` and `components/smart-toolbar/row/overflow-menu.tsx` are D1 files. `lib/remembered-choice.ts` and `smart-toolbar.scss` are D2 files. All edits fall under the A6 grant and are listed in the amendment.
- No new prefix or group: `view.` and `view` already exist (D1).

## Schema and protocol

**None. This plan needs no schema change and no protocol change.**
- No mark, node or attribute is added, so `lib/schema-names.ts` and `tests/fixtures/schema-snapshot.json` are unchanged. No WebSocket parameter and no Hocus change.
- The setting lives in this browser only (`tinydocy-ui`). It never reaches the document, the server, URLs or analytics.

## Budgets

**Editor chunk (`scripts/check-editor-chunk-size.ts`, gz).** The script sums every file the editor's loader lists, **CSS included**. A production build of E's tip lists three `.css` files in the group, 14,467 B gz. The A12 budget is 24,064 B. A8 measured +23,423 B at E's tip (`4fcba67`), so about **641 B** were left. A build of `7abadc1` with uncommitted follow-up changes measured +23,757 B (307 B left), so the real figure on `main` must be measured first. The four later-phase plans share what is left:

| Plan | Eager allocation | What is eager | Lazy |
|---|---|---|---|
| M15 Continue where you left off | 150 B | one lazy loader and its idle mount | continue chunk ≤ 3 KB gz |
| "/" menu | 280 B | trigger plugin, host, one lazy loader | slash chunk ≤ 6 KB gz |
| Hover preview | 160 B | the decoration plugin | ≤ +1 KB gz on the colour-panel chunk |
| **Progressive-disclosure toggle (this plan)** | **150 B** | the `view.simpleToolbar` definition, the ⋯ checkbox item, the shell hook and attribute, one `attributeFilter` entry, the simplified CSS rules | none |
| **Total** | **740 B** | | |

**This is more than the headroom, and Turbopack's split cost comes on top.**
- A lazy chunk that imports modules the editor chunk also uses makes Turbopack split those modules into separate, less compressible editor-group files. A8 measured about 344 B for the palette chunk and about 968 B for the split button inside the bubble chunk.
- The continue chunk (`relative-range.ts`, the fold and filter plugin keys, `remembered-choice`, `hocuspocus`) and the slash chunk (registry, snapshot, memory) both import such modules.
- The trim has landed (contract A13, menu bodies lazy): the editor chunk measured +16,679 B of the 23.5 KB budget, 7,385 B of headroom. Measure each plan against it; a new owner amendment is needed only if they outgrow it. The palette (A7) has 36 B left.
- No plan raises the constant itself. Going over this plan's 150 B needs a trim or the owner's amendment.

The simplified rules live in eager `smart-toolbar.scss`, so they count against the gate. They repeat short selectors that gzip well, and they are included in this plan's 150 B. This plan is the cheapest of the four and a good first one to land; its measurement (taken before Task 1) sets the real headroom for the others.

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

## Upstream interfaces (as on `main` at `7abadc1`)

| # | Name | Where | Used for |
|---|---|---|---|
| U1 | `@mixin ladder($tiers)` with `$ladder-mouse` and `$ladder-touch` | `components/smart-toolbar/smart-toolbar.scss` | factored into `collapse-tier($tier)` |
| U2 | `data-collapse-tier`, `data-collapse-standin`, `data-toolbar-group` | `components/document-editor/main-toolbar-content.tsx`, contract §5.3 | the hooks the CSS reads |
| U3 | `Toolbar` (div attributes spread last), `MutationObserver` `attributeFilter`, the resize focus hand-off | `components/ui/toolbar.tsx` | the density attribute; the roving repair |
| U4 | `viewAction(...)`, `slotActions` | `lib/editor-actions/core/slot.ts` | where `view.simpleToolbar` is defined |
| U5 | `OverflowMenu` (`TOGGLES`, `COMMANDS`, `ThemeMenuItem` pattern) | `components/smart-toolbar/row/overflow-menu.tsx` | the checkbox item |
| U6 | `CHOICE_SLOTS`, `ChoiceSpec`, `readChoice`, `rememberChoice`, `subscribeChoices`, `REMEMBER_CHOICES_ENABLED` | `lib/remembered-choice.ts` | the new slot and its spec |
| U7 | `toolbar-ladder.spec.ts` (overflow and one Tab stop, 1440 → 768, mouse and touch, four contexts) | `tests/e2e/toolbar-ladder.spec.ts` | extended with simplified mode |
| U8 | `ChevronsDownUpIcon` | `lib/icons.tsx` | the action icon (reused) |

## Decisions on spec ambiguities (owner can overrule)

1. **Simplified = the T4 collapse set** (t2, t3 and t4 stand-ins), not T5. T5 also folds Underline and Strike into "Aa" and shortens the style value, which costs everyday clicks. Below the T4/T5 widths the ladder still applies, so a narrow window gets T5 as before.
2. **Off by default and never suggested.** No nudge and no "you seem to use few tools" prompt (spec §1 non-goal, research above).
3. **Remembered in `tinydocy-ui`** (slot `toolbarDensity`), like the outline (M6). "Forget my choices" keeps it: it is a layout preference, not a remembered choice.
4. **Kill switch:** with `NEXT_PUBLIC_REMEMBER_CHOICES=0`, `readChoice` returns the fallback for every slot, so the setting cannot be kept. `view.simpleToolbar` is then `aria-disabled` with "Remembering choices is turned off." rather than toggling something that resets on reload.
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
| `components/smart-toolbar/row/overflow-menu.tsx` | `DensityMenuItem` (`menuitemcheckbox`) | Modify (D1 file, A6 grant) |
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
test("compiled ladder CSS is unchanged without the attribute", async ({ page }) => {
  // at each A5 boundary ±1px, the visible-item set equals main's (snapshot of data-toolbar-group visibility)
});
```

- [ ] **Step 2: Run them and confirm they fail.** Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run them, plus `toolbar-ladder.spec.ts`.** Expected: PASS.

- [ ] **Step 5: Commit** after approval: `style(toolbar): add a simplified collapse set to the ladder`

---

### Task 2: The setting, the action and the ⋯ item

**Files:**
- Modify: `lib/remembered-choice.ts`, `lib/editor-actions/core/slot.ts`, `components/smart-toolbar/row/overflow-menu.tsx`, `components/document-editor/document-editor.tsx`, `tests/unit/editor-actions/contract.test.ts`, `docs/superpowers/specs/2026-11-13-smart-toolbar-v1-contract.md`
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
  - label "Simplified toolbar", group `view`, contexts `"any"`, `mutates: false`, icon `ChevronsDownUpIcon`;
  - keywords `["compact", "fewer tools", "minimal", "density", "show all tools"]`;
  - `enabled` returns `{ reason: "Remembering choices is turned off." }` when `!REMEMBER_CHOICES_ENABLED`, else `true`;
  - `run` flips `readChoice(TOOLBAR_DENSITY_CHOICE).last` through `rememberChoice` and returns true.
- **`useToolbarDensity()`:** `useSyncExternalStore(subscribeChoices, () => readChoice(TOOLBAR_DENSITY_CHOICE).last, () => "full")`.
- **`DensityMenuItem`:** a `DropdownMenuCheckboxItem` with `checked={density === "simple"}`. It runs the action through `runAction`, and is `aria-disabled` with the reason under the kill switch. It sits after the `COMMANDS` items and before Theme.
- **`document-editor.tsx`:** `<Toolbar … data-toolbar-density={density}>` on the desktop row only.
- **The amendment records:**
  - the slot;
  - the action;
  - the five file hunks (`remembered-choice.ts`, `core/slot.ts`, `overflow-menu.tsx`, `document-editor.tsx`, `toolbar.tsx`);
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
- The resize callback's hidden-stop hand-off (stop or `lastFocus` hidden → that group's `[data-collapse-standin]` item, else the nearest index) moves into a named function. Both the `ResizeObserver` and this mutation path call it.
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
- Modify: `tests/e2e/toolbar-ladder.spec.ts` (simplified sweep), `tests/e2e/toolbar-a11y.spec.ts` (axe in simplified mode), `tests/e2e/toolbar-density.spec.ts` (kill switch), `CHANGELOG.md`, `README.md` (feature line; the `NEXT_PUBLIC_REMEMBER_CHOICES` row mentions the setting), `tests/TESTING.md` (spec, ports 3640/1740 and 3641), `AGENTS.md` (one line: simplified = T4 collapse set by attribute, `tinydocy-ui` slot, CSS only)

- [ ] **Step 1: Write the failing tests**

```ts
// toolbar-ladder.spec.ts
test("simplified: scrollWidth <= clientWidth + 1 and one Tab stop from 1440 to 768, four contexts, mouse and touch", async ({ page }) => {});
// toolbar-a11y.spec.ts
test("simplified row: axe 0 serious, light and dark", async ({ page }) => {});
// toolbar-density.spec.ts
test.skip(process.env.E2E_REMEMBER_OFF !== "1", "needs Next on 3641 built with NEXT_PUBLIC_REMEMBER_CHOICES=0");
test("kill switch: the ⋯ item is aria-disabled with its reason; the row stays full", async ({ page }) => {});
```

- [ ] **Step 2: Run them and confirm the new ones fail or are unwired.**

- [ ] **Step 3: Write the docs.** The CHANGELOG says "no schema or protocol change" and needs no Deploy note.

- [ ] **Step 4: Run the full verification**

```bash
bun audit --audit-level=high && bun biome check . && bun run lint && bun run typecheck && bun run test && bun run build
bun scripts/check-editor-chunk-size.ts        # eager delta (CSS included) against this plan's 150 B; record the new headroom for the other plans
CI= E2E_BASE_URL=http://localhost:3640 bun playwright test --project=chromium --project=perf
CI= E2E_BASE_URL=http://localhost:3640 bun playwright test tests/e2e/toolbar-density.spec.ts tests/e2e/toolbar-ladder.spec.ts --project=chromium --repeat-each=5 --workers=3
E2E_REMEMBER_OFF=1 CI= E2E_BASE_URL=http://localhost:3641 bun playwright test tests/e2e/toolbar-density.spec.ts --project=chromium
```

Expected: everything passes. Record the eager delta, the remaining headroom, and screenshots of the simplified row at 1440 and 1024 px (mouse and touch), light and dark.

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
| e2e | axe light and dark; kill switch (3641) | `toolbar-a11y.spec.ts`, `toolbar-density.spec.ts` |
| perf | Typing p95 ≤ +10% and ≤ +16 ms | `--project=perf` |
| size | Eager ≤ 150 B, CSS included | `check-editor-chunk-size.ts` |

## Acceptance criteria

- ⋯ > Simplified toolbar (and the palette row) toggles the T4 collapse set at every width, keeps every action reachable through a stand-in, and keeps the never-collapse set visible.
- The setting survives reload and "Forget my choices", never flashes on load, and is disabled with a reason under the kill switch.
- One Tab stop, focus never dropped, `scrollWidth ≤ clientWidth + 1` from 1440 to 768 in both modes, axe reports 0 serious issues.
- No schema or protocol change. `contract.test.ts` changes only its `CHOICE_SLOTS` case, recorded in the amendment.
- The eager delta (CSS included) is ≤ 150 B (or the owner recorded an amendment), and typing p95 holds.

## Risks

| Risk | Mitigation |
|---|---|
| The SCSS refactor changes a ladder rule by accident | Task 1's "compiled ladder CSS is unchanged" e2e at every A5 boundary ±1 px, plus `toolbar-ladder.spec.ts`. |
| The ⋯ checkbox item, hook and CSS cost more than 150 B | Reuse the existing icon and `DropdownMenuCheckboxItem`. If it is still over, move the item body into `ActionMenuItem` with a `checked` prop (shared code), or ask the owner. |
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
