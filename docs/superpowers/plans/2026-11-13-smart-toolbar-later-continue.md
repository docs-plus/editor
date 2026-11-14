# Smart toolbar, later phase: Continue where you left off (M15), implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Revised 2026-11-14 against `main` at `4b55ec6`** (after the design pass, #35, and the menu trim, #36). What changed since the first draft is listed under [Revision notes](#revision-notes-2026-11-14).

**Goal:** When a writer reopens a document, a small chip above the title offers "Continue where you left off · *Section name*". **Go** takes them back to that section, the way an outline pick does:
1. it unfolds any folded section that hides the heading;
2. it puts the caret at the end of the heading, so the block renders at its true height under `content-visibility`;
3. it focuses the editor and, one frame later, scrolls the heading to the top of the viewport (`block: "start"`).

The chip is never auto-focused, never applies anything by itself, and never shifts the page. The place is remembered locally only, as the section heading's id per document, so it survives collaborators' edits made while the writer was away.

**Architecture:**
- **Eager, in the editor chunk (small):**
  - `continue-chip-loader.tsx` mounts the lazy chip on idle once the editor exists, through `lazySurface`. It hands the chip a **navigation port** (`find`, `isFilteredOut`, `goTo`), so the lazy chunk imports no editor-chunk module (see Budgets: importing them costs +1.6 KB).
  - `lib/heading-navigation.ts`: `goToHeading(editor, id, block)` and `scrollBlockIntoView(dom, block)`. The outline uses the same function with `block: "center"`, so the two jumps cannot drift apart.
  - `HeadingFold` command `unfoldAncestors(headingId)`.
- **Lazy (`continue` chunk):** the store, the recorder and the chip.
- **Recorder:** after the writer's first input (pointer, key or text input), it records on editor blur, `visibilitychange` (hidden), `pagehide` and its own release (unmount, which a tab switch causes). It stores the `data-toc-id` of the section the caret is in. It does no work per keystroke.
- **Chip:** shown after the first **server** sync, when the saved heading still exists, is far enough down, is not hidden by a heading filter, and the writer has not acted yet.
  - It renders into a host element placed just before the ProseMirror element inside the page card, absolutely positioned over the card's 3 rem top padding. Its arrival and departure move nothing, and it comes after the toolbar and before the text in Tab order.
  - At 480 px and below, the same host is fixed above the phone bar and the connection chip.

**Tech Stack:** Next.js 16 (Turbopack), React 19, Tiptap 3.33, `bun test` (happy-dom), Playwright with `@axe-core/playwright`. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-12-smart-toolbar-design.md` §5 (memory rules; the M15 row), §9 (P7; "Continue reuses the same helper" as the outline jump), §6, §7, §8 item 6. Visual vocabulary: the status pill, `docs/superpowers/specs/2026-11-13-smart-toolbar-design-pass.md` §5.

**Base:** `main` at `4b55ec6` or later. Before Task 1, confirm:
- `git grep -n "export function findTocAnchor" extensions/table-of-contents/table-of-contents-items.ts`;
- `git grep -n "function scrollHeadingIntoView" components/toc-sidebar/toc-sidebar.tsx`;
- `git grep -n '"set"; ids' extensions/heading-fold/heading-fold-plugin.ts` (the fold plugin's no-animation meta);
- `git grep -n "export const headingFilterPluginKey" extensions/heading-filter/heading-filter-plugin.ts`;
- `git grep -n "export function lazySurface" components/smart-toolbar/lazy-surface.tsx`.

**Effort:** M, about **4 engineer-days**: store and recorder 1, the navigation helper and fold command 0.5, chip UI and placement 1, tests, budgets and docs 1–1.5.

## Global Constraints

**Tooling**
- Bun only: `bun`, `bun <bin>`, `bunx --bun`. Never npm, npx, yarn or pnpm.
- Biome formats and lints. ESLint covers Next rules only. TypeScript is strict. `bun run typecheck` covers the app and `tsconfig.sw.json`.

**Code style**
- Named exports only. Kebab-case files. PascalCase components with title-case acronyms.
- Icons come from `lib/icons.tsx`. New UI uses the shadcn components in `components/ui/` and shadcn tokens. Both are free in the lazy chunk: the app shell already loads them (measured, Budgets).

**Commits**
- Conventional Commits: atomic, imperative mood.
- No AI, tool or agent references and no trailers.
- Before every commit, show a commit review report (files, diff summary, message).
- `CHANGELOG.md`: one sub-block for this PR under `## [Unreleased]`.

**Tests**
- `bun run test`: one process, happy-dom preload. `mock.module` spreads the real module and is followed by `await import()`. The kill switch is read at import time, so load it through `importFresh()` with `resetModules()` in `afterEach`.
- Playwright runs against **Next 6220 + Hocus 4220** (ports 3000, 1234, 5000 and 6000 are off limits). The kill-switch run uses a second `next dev` on **6221** started with `NEXT_PUBLIC_REMEMBER_CHOICES=0` (same Hocus and DB). Never test against tiny.docs.plus. Run `lsof` first and stop only what you started.

```bash
DOC_CREATION_RATE_LIMIT=2000 WS_CONNECTION_LIMIT=200 WS_SOCKETS_PER_IP=600 WS_UPGRADE_RATE_LIMIT=6000 \
  HOCUS_THROTTLE=0 MAX_TOTAL_DOCUMENTS=1000000 HOCUS_PORT=4220 DB_PATH="$TMPDIR/tinydocy-continue.sqlite" \
  HOCUS_ALLOW_ISOLATED_TABS_DOCS=1 bun run hocus
NEXT_PUBLIC_HOCUS_URL=ws://127.0.0.1:4220 DB_PATH="$TMPDIR/tinydocy-continue.sqlite" bun next dev -p 6220
CI= E2E_BASE_URL=http://localhost:6220 bun playwright test <spec> --project=chromium
```

- Touch e2e: `test.use({ hasTouch: true, isMobile: true })`, first assertion `matchMedia("(pointer: coarse)").matches === true`.
- e2e types at full speed.

**Code rules**
- Hydration: storage is read in effects or inside the lazy chunk only. The editor is a client-only `next/dynamic` import, and the chip renders only after the first server sync.
- Never subscribe the editor shell to editor state. Never rebuild the extensions array or `EDITOR_PROPS`.
- Memory is local only: never Yjs, the server, URLs or analytics. The stored value holds a heading id (a random UUID the document already carries) and a timestamp, never document text.
- **The lazy chunk imports no module of the editor chunk** (extensions, `lib/editor-*`, `remembered-choice`). It gets what it needs from the loader's navigation port. Type-only imports are fine.
- Never `registerPlugin` from the lazy chunk: every plugin view would be re-created.
- TOC rules (AGENTS.md): caret at the end of the heading, scroll deferred with `requestAnimationFrame` after selection and focus settle, headings looked up by id with `findTocAnchor`, never by a stored position.

**Contract rules**
- No frozen file is touched. `document-editor.tsx` is a §5.2 shared file, so its hunk is recorded as a contract amendment: **A-next** (the coordinator assigns the number in merge order). The simplified-toolbar session also edits `document-editor.tsx`, so the change there is one import and one JSX line.
- `STORAGE_KEYS` and `CHOICE_SLOTS` are pinned by `contract.test.ts` (`toEqual`), so `tinydocy-continue` is a separate constant in `lib/continue-position.ts`, like `tinydocy-folds-<id>` in `extensions/heading-fold/helpers/fold-storage.ts`.

## Schema and protocol

**None. This plan needs no schema change and no protocol change.**
- No mark, node or attribute is added, so `lib/schema-names.ts` and `tests/fixtures/schema-snapshot.json` are unchanged.
- No WebSocket parameter, no Hocus change and no awareness field.
- The place never enters the Y.Doc. Go writes **nothing** to the document: it dispatches a fold-plugin meta (per-viewer view state, persisted locally, as A1 already treats `section.fold`) and a selection change.

## Budgets

**Editor chunk (`scripts/check-editor-chunk-size.ts`, gz).** The script sums every file the editor's loader lists, CSS included. On `4b55ec6` it measures **394,567 B, +16,679 B** of the 23.5 KB budget (A13): 7,385 B of headroom, shared with the hover preview, "/" menu and simplified-toolbar plans.

- **This plan: eager growth under 1,000 B**, reported to the byte. The palette's first Alt+/ (A7, 36 B left) gets **nothing**.
- **Measured split cost (Task 0 spike, 2026-11-14, production builds of `4b55ec6` plus a throwaway chunk):**

| Lazy chunk imports | Editor group | Growth |
|---|---|---|
| nothing but React and types | 10 files | **+128 B** (the loader) |
| `Button` and an icon from `lib/icons.tsx` | 10 files | +129 B |
| `findTocAnchor`, `headingFoldPluginKey`, `headingFilterPluginKey` | 12 files | **+1,708 B** |

  Turbopack splits any module that both the editor group and a lazy chunk import into a separate, less compressible group file. The app shell already loads `components/ui` and the icons, so those cost nothing. Hence the navigation port: the extension code stays in the editor chunk, and the lazy chunk reaches it through props.
- Eager code: the loader and its idle mount, the port, `goToHeading`, the fold command. The outline's scroll helper moves to `lib/heading-navigation.ts` (net zero).

**Performance:**
- Typing p95 is unchanged within noise (≤ +10% and ≤ +16 ms, `--project=perf`). The recorder has no transaction listener. Its input listeners are removed at the writer's first input.
- A recorder write is one `localStorage.setItem` of ≤ 30 entries (≤ 4 KB), and only when the section changed since the last write.
- Layout shift: the CLS contribution of the chip's appearance and dismissal is **0** (PerformanceObserver `layout-shift`).
- Listeners return to baseline after 20 tab switches: the recorder removes its `visibilitychange`, `pagehide` and editor listeners on unmount.

## Accessibility requirements (WCAG 2.2 AA)

- **Never auto-focused** (spec M15). The chip enters the Tab order after the toolbar's single stop and before the editor (DOM order). It makes no live-region announcement (Decision 6).
- **Structure:** `<div role="group" aria-label="Continue where you left off">` holds:
  - the text "Continue where you left off · *Section name*";
  - a **Go** button whose accessible name is "Go to *Section name*". It starts with the visible label "Go" (2.5.3);
  - a **Dismiss** button (✕, `aria-label="Dismiss"`).

  The section name renders inside `<bdi>`, truncated to 40 characters with an ellipsis, so a heading with bidi controls cannot reorder the chip's text.
- **Focus is never dropped:**
  - Go moves focus into the editor with the caret at the end of the heading.
  - Dismiss and Esc (on either button) move focus into the editor without moving its selection.
  - A chip that disappears because of the writer's input had no focus (the input happened elsewhere).
- **Targets:** ≥ 24×24 with a mouse. 44×44 on touch and on the phone layout.
- **Contrast:** text ≥ 4.5:1 and the border ≥ 3:1 in both themes (the status pill's `popover` tokens). Forced colours: system colours with a visible border.
- **Focus not obscured (2.4.11):** the chip never covers the caret line (it sits in the card's top padding, or above the phone bar, and is gone after the first input). Go's scroll target clears the sticky row (`scroll-padding-top`) or the phone bar.
- **Reduced motion:** Go scrolls with `behavior: "auto"` under `prefers-reduced-motion`.
- **Zoom and reflow (1.4.10):** at 320 CSS px the chip wraps inside the viewport and never scrolls sideways.

## Upstream interfaces (as on `main` at `4b55ec6`)

| # | Name | Where | Used for |
|---|---|---|---|
| U1 | `findTocAnchor(doc, id)` | `extensions/table-of-contents/table-of-contents-items.ts` | the heading as it is now (never a stored position) |
| U2 | `headingFoldPluginKey`; meta `{ type: "set", ids, persist? }` | `extensions/heading-fold/heading-fold-plugin.ts` | unfold without animation |
| U3 | `computeSection(doc, headingPos, level)` | `extensions/shared/compute-section.ts` | which folded headings contain the target |
| U4 | `headingFilterPluginKey` state `{ slugs, matchedSectionIds }` | `extensions/heading-filter/heading-filter-plugin.ts` | no chip when a filter hides the target |
| U5 | `scrollHeadingIntoView(dom)` (private, `block: "center"`, smooth with a settle pass) | `components/toc-sidebar/toc-sidebar.tsx` | moved to `lib/heading-navigation.ts` with a `block` argument |
| U6 | `CARET_BLOCK_CLASS` (`is-caret-block`) | `extensions/render-once/caret-block-visible.ts` | why the selection is set before the scroll |
| U7 | `REMEMBER_CHOICES_ENABLED` semantics | `lib/remembered-choice.ts` | kill switch, read inline (`process.env.NEXT_PUBLIC_REMEMBER_CHOICES !== "0"`) so the lazy chunk does not import the module |
| U8 | `lazySurface` | `components/smart-toolbar/lazy-surface.tsx` | the lazy chunk and its failure path |
| U9 | `useYjsDocument()` → `{ serverSynced, rejectedReason }` (props of `DocumentEditorContent`) | `hooks/use-yjs-document.ts` | wait for the server sync; drop the entry on `document_deleted` |
| U10 | `PLAYGROUND_ID` | `lib/constants.ts` | excluded (app-shell module, free) |
| U11 | `CHUNK_MARKERS`, `interceptChunk` | `tests/e2e/helpers/lazy-chunk.ts` | 404 case |
| U12 | `[data-collab-status]`, `--mobile-bar-clearance` | `components/tiptap-ui/user-identity-button.tsx`, `mobile-toolbar-content.tsx` | phone placement above the connection chip |

## Decisions on spec ambiguities (owner can overrule)

1. **What is stored: the section, not the caret.** The section heading's `data-toc-id` (the nearest non-title heading at or before the caret). Go lands where an outline pick lands, so it reuses the outline's code. Heading ids are already persisted in the document and survive reloads and remote edits (`toc-id-plugin` reassigns one only on a collision or a missing id).
2. **Storage:** its own key, `tinydocy-continue`: `{ v: 1, docs: { "<document name>": { id: string, at: epochMs } } }`.
   - Scoped by document name, like the folds. Another server's copy of the same name has other heading ids, so its entry simply does not resolve.
   - Newest 30 kept, 14-day expiry, matching `OFFLINE_MAX_DOCS` and `OFFLINE_DOC_MAX_AGE_DAYS`.
   - The payload is capped at 16 KB. Hostile, oversized or wrong-version payloads are discarded, ids longer than 64 characters are dropped, and an own-property check drops `__proto__`.
3. **"Forget my choices" does not clear it.** It is view state, like the outline (M6, `tinydocy-ui`) and the folds (`tinydocy-folds-<id>`), and spec §5's Forget list does not name M15.
4. **The kill switch turns M15 off.** With `NEXT_PUBLIC_REMEMBER_CHOICES=0` it reads nothing, writes nothing, and removes the key once on load.
5. **Record on leave, and only after the writer acted.** The recorder arms on the writer's first `pointerdown` in the document area, or `keydown` / `beforeinput` in the editor, then records on editor blur, `visibilitychange` → hidden, `pagehide`, and its release (tab switch). Opening a document and leaving without touching it keeps the old entry. A caret in the title, before the first non-title heading, or in a section whose heading is among the first three top-level blocks (`CONTINUE_MIN_BLOCK`) **deletes** the entry: there is nothing to continue. The editor's own `destroy` event cannot be relied on: `useEditor` defers `editor.destroy()` by a tick, after the chip's cleanup.
6. **No announcement.** The chip is an offer, not news. A polite live region on every document open would be noise. This matches the context slot's no-live-region rule (§4.2).
7. **When the chip shows:** after the first **server** sync only, and while all of these hold:
   - the stored heading still exists (`findTocAnchor`);
   - its top-level index is ≥ 3;
   - the writer has not acted since load (Decision 5's inputs);
   - no heading filter hides its section;
   - the document is not `playground` (regenerated content).

   **Offline, no chip appears.** Recording still works offline.
8. **Dismissal:** Go, Dismiss, Esc on the chip, the writer's first input anywhere else in the document area, a document switch, or `document_deleted` (which also removes the entry). Transactions nobody typed (id assignment, schema repair, seeding, a filter URL's own selection) never dismiss it. A refusal other than `document_deleted` keeps it: Go is navigation and still works read-only. A dismissed chip returns only on the next open.
9. **Scroll alignment: `block: "start"`** for Go, per spec §9 and AGENTS.md. The outline on `main` scrolls to `center`, on purpose (`d92c64a`); it keeps `center` through the same helper. **Owner question:** should the outline move to `start` as AGENTS.md says? Out of scope here.
10. **Unfold without animation, and persist it.** Go dispatches the fold plugin's `set` meta with the heading's folded ancestors removed (`persist: true`), so the heading has its true position before the scroll. `toggleFold` animates for 350 ms and would measure the wrong height. Leaving those sections unfolded is the honest state after the writer asked to go inside them. The heading's own fold is left alone (the heading itself is visible).
11. **A deleted heading** means no chip, and Go on a heading deleted while the chip showed just focuses the editor and dismisses.
12. **Deleted documents:** the entry is removed when the chip sees `rejectedReason === "document_deleted"`. A closed tab's entry is left to expiry and the cap, which needs no eager code in the tab-close path. The entry holds no text.

## Not in scope

- Syncing the position across devices (the spec says local only).
- Returning to the exact caret offset inside a long section (the section heading is the unit, as in the outline).
- Changing the outline's scroll alignment (Decision 9 asks the owner).
- Document styles (M14b); see the "/" menu plan's "Not in scope".

## Review Focus

1. **Collaborators' edits while away.** Sections inserted above the target, or the target section moved, by another client: Go still lands on the same heading (looked up by id). Task 4 e2e.
2. **Folded and filtered targets.** A heading inside a folded section is revealed with no animation and lands at the top. A filter URL hiding it means no chip. Tasks 3 and 4.
3. **No layout shift and no focus theft.** CLS is 0, and `activeElement` is never a chip button unless the writer tabbed there. Task 4 e2e.
4. **No false dismissal.** Id assignment, a filter URL and seeding at load never dismiss the chip. Task 4 e2e.
5. **Tamper and storage failure.** Hostile payloads and a `localStorage` that throws give no chip and no exception. Task 1 unit table.
6. **Listener hygiene across tab switches.** The recorder's listeners are removed on unmount. Task 1 unit test and Task 5 e2e.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `lib/continue-position.ts` | Store (cap, expiry, validation, kill switch), section lookup, recorder | Create (lazy) |
| `lib/heading-navigation.ts` | `scrollBlockIntoView(dom, block)` (moved from the outline) and `goToHeading(editor, id, block)` | Create (eager) |
| `components/toc-sidebar/toc-sidebar.tsx` | Calls `goToHeading(editor, id, "center")` (behaviour unchanged) | Modify |
| `extensions/heading-fold/heading-fold.ts` | Command `unfoldAncestors(headingId)` (the `set` meta, `persist: true`) | Modify |
| `components/document-editor/continue-chip-loader.tsx` | Idle mount through `lazySurface`, the navigation port | Create (eager) |
| `components/document-editor/continue-chip.tsx` | Lazy chip: recorder effect, eligibility, placement host, Go, Dismiss | Create (lazy) |
| `components/document-editor/document-editor.tsx` | One import and one JSX line | Modify (shared §5.2 hunk: amendment) |
| `tests/e2e/helpers/lazy-chunk.ts` | `CHUNK_MARKERS.continueChip` | Modify |
| `tests/unit/lib/continue-position.test.ts`, `tests/unit/lib/heading-navigation.test.ts`, `tests/unit/extensions/heading-fold-unfold.test.ts` | Unit tests | Create |
| `tests/e2e/continue-chip.spec.ts`, `tests/e2e/lazy-surfaces.spec.ts` | e2e | Create / Modify |
| `docs/superpowers/specs/2026-11-13-smart-toolbar-v1-contract.md` | Amendment A-next | Modify |
| `CHANGELOG.md`, `README.md`, `tests/TESTING.md`, `AGENTS.md` | Docs | Modify |

---

### Task 0: Measure the headroom and the split cost (done, not committed)

Done on 2026-11-14; the numbers are in Budgets. Re-measure after any rebase.

---

### Task 1: Store and recorder

**Files:** Create `lib/continue-position.ts`; test `tests/unit/lib/continue-position.test.ts`.

**Interfaces:**
```ts
export const CONTINUE_STORAGE_KEY = "tinydocy-continue";
export const CONTINUE_MAX_DOCS = 30;
export const CONTINUE_MAX_AGE_DAYS = 14;
export const CONTINUE_MIN_BLOCK = 3;
export interface ContinueEntry { id: string; at: number }
export function readContinueEntry(documentName: string, now?: number): ContinueEntry | null;
export function writeContinueEntry(documentName: string, id: string, now?: number): void;
export function deleteContinueEntry(documentName: string): void;
/** The section heading the position is in, or null when there is nothing to continue. */
export function sectionHeadingAt(doc: PMNode, pos: number): { id: string; index: number } | null;
export function installContinueRecorder(editor: Editor, documentName: string, onFirstInput: () => void): () => void;
```
- Every write re-reads the key, prunes expired entries, keeps the newest 30 and wraps each storage call in try/catch. Nothing is read or written under the kill switch.
- The recorder skips a write when the id equals the last one it wrote. Its release records once more (when armed), then removes every listener; it is idempotent.

Tests: round-trip; cap and expiry; tamper table (hostile JSON, wrong version, oversized payload, `__proto__`, non-objects, long ids); throwing storage; kill switch (importFresh); `sectionHeadingAt` (title, before the first heading, first three blocks, nested content); recorder (no write before the first input; blur, hidden and pagehide record; release records then removes listeners; same section writes once; caret near the top deletes).

Commit: `feat(continue): remember the section you left, locally per document`

### Task 2: Unfold ancestors and the shared heading jump

**Files:** Modify `extensions/heading-fold/heading-fold.ts`, `components/toc-sidebar/toc-sidebar.tsx`; create `lib/heading-navigation.ts`; tests `tests/unit/extensions/heading-fold-unfold.test.ts`, `tests/unit/lib/heading-navigation.test.ts`.

- `unfoldAncestors(headingId)` collects every folded heading whose section (`computeSection`) contains the heading, other than itself. None: returns true, dispatches nothing. Otherwise it dispatches `{ type: "set", ids: folded minus those, persist: true }`: no animation, no doc change.
- `scrollBlockIntoView(dom, block)` is the outline's helper with its settle pass, cancel-on-takeover events and 5 s timeout; smooth unless `prefers-reduced-motion`.
- `goToHeading(editor, id, block)`: `findTocAnchor`; `unfoldAncestors`; caret at the end of the heading; `focus()`; `requestAnimationFrame` → `scrollBlockIntoView(view.nodeDOM(pos), block)`. Returns false when the heading is gone.
- The outline calls `goToHeading(editor, item.id, "center")`. `toc-sidebar.spec.ts`, `outline-overlay.spec.ts` and `fold.spec.ts` prove it unchanged.

Commit: `refactor(editor): share the outline's heading jump and unfold ancestors`

### Task 3: The chip and its mount

**Files:** Create `components/document-editor/continue-chip.tsx`, `continue-chip-loader.tsx`; modify `document-editor.tsx`, `tests/e2e/helpers/lazy-chunk.ts`; test `tests/e2e/continue-chip.spec.ts`, `tests/e2e/lazy-surfaces.spec.ts`.

- **Loader:** `idle` turns true through `requestIdleCallback` (fallback `setTimeout`) once mounted; renders `<LazyContinueChip editor documentName serverSynced rejectedReason nav />`. Not rendered under `__TOOLBAR_OFF` (the perf project compares like with like).
- **Chip:** installs the recorder on mount; computes the offer once `serverSynced` turns true; inserts its host before `view.dom` in the card and portals into it; removes the host on unmount.
- **Go:** `nav.goTo(editor, id, "start")`, then dismiss. **Dismiss and Esc:** `editor.view.focus()`, then dismiss.
- **Style:** the status pill's vocabulary: `rounded-lg border border-border bg-popover text-popover-foreground shadow-md text-sm`, Go as a small secondary button, Dismiss as a ghost icon button. No entry animation under reduced motion.
- **Placement:** above 480 px, `position: absolute` at its static position (the card's top-left), inset to the text column and centred in the 3 rem padding. At 480 px and below, `position: fixed`, inset 8 px, above the connection chip and the phone bar.

e2e: offer after reopen, never focused, Go lands (caret at the heading's end, heading top within 24 px under the toolbar, chip gone, focus in the editor); folded target; filter URL hides; collaborator inserts and a moved section; CLS 0; no false dismissal at load; first input, Dismiss and Esc; no chip near the top, in playground, offline; touch 375 px (pointer: coarse first, 44 px targets, inside the viewport); a chunk that fails to load leaves the editor working.

Commit: `feat(continue): offer a chip back to the section you left`

### Task 4: Leaks, accessibility, kill switch, amendment, docs and full verification

- e2e: 20 tab switches return listeners to baseline; axe 0 serious or critical, light and dark; forced colours keep a border; kill switch (`E2E_REMEMBER_OFF=1` against 6221): no chip, no key.
- Contract amendment A-next: the `document-editor.tsx` hunk, the separate `tinydocy-continue` key, the fold command, the shared heading jump, the navigation port and the measured bytes.
- Docs: CHANGELOG (no schema or protocol change, no Deploy note), README feature line, `tests/TESTING.md` (spec row, ports), AGENTS.md (one line: M15 key, scope, recorder events, never in Yjs, lazy chunk imports no editor module).
- Full verification:

```bash
bun audit --audit-level=high && bun run check && bun run lint && bun run typecheck && bun run test && bun run build
bun scripts/check-editor-chunk-size.ts
CI= E2E_BASE_URL=http://localhost:6220 bun playwright test continue-chip toc fold toolbar outline-overlay lazy-surfaces --project=chromium
```

- Design gate: screenshots at 1440 and 375 px, light and dark (the chip on reopen, after Go, after Dismiss); UI designer and UX designer reviews; fix their blockers.

Commit: `test(continue): assert leaks, accessibility and the kill switch`, `docs(continue): record the continue amendment and the continue chip`

## Acceptance criteria

- Reopening a document after leaving it in a section whose heading is at least the fourth block offers the chip after the server sync. Go puts the caret at the end of that heading, even after collaborators' edits and inside folded sections, with the heading top within 24 px under the toolbar.
- The chip is never auto-focused, never shifts the page (CLS 0) and never appears offline, near the top, in playground or when a filter hides the target. Load-time transactions never dismiss it.
- Focus is never dropped. axe reports 0 serious issues in both themes. Touch targets are 44 px.
- Nothing reaches Yjs, the server, URLs or analytics. `tests/fixtures/schema-snapshot.json`, `lib/schema-names.ts`, Hocus and `contract.test.ts` are unchanged.
- Eager growth is under 1,000 B, the palette chunk is unchanged, and typing and leak budgets hold.
- The outline behaves as before (`toc-sidebar.spec.ts` green), and Decision 9's question is in the PR description.

## Risks

| Risk | Mitigation |
|---|---|
| `pagehide` and `visibilitychange` do not fire when iOS kills a background tab | Editor blur also records, so the last section before switching apps is usually saved. Best effort. |
| A collaborator deletes the heading | No chip (Decision 11). |
| The chip covers the title on a narrow desktop window | Above 480 px the card keeps 3 rem of top padding and the chip is one line, 32 px tall. The 481–767 px range is checked in the screenshots. |
| Unfolding persists folds the writer wanted closed | Decision 10 (overrulable). Only the heading's ancestors open. |
| A later change makes the lazy chunk import an editor module | The split cost shows in `check-editor-chunk-size.ts`; the rule is in Code rules and AGENTS.md. |

## Revision notes (2026-11-14)

- **Section instead of caret.** The first draft stored the caret as a Yjs relative position (`relative-range.ts`, the y-sync binding). The task brief asks for the outline's behaviour: back to the section, caret at the end of the heading, headings looked up by id. Storing the heading id is simpler, needs no y-tiptap import, and survives remote edits by construction. Decision 10 of the draft (deleted target resolves nearby) became Decision 11 (no chip); Review Focus 1 and the acceptance criteria changed to match; the minimum-block rule applies to the heading.
- **Host scope dropped.** Heading ids are unique UUIDs, so a same-named document on another server cannot resolve an entry; scoping by document name alone, like the folds, is enough.
- **Budgets restated.** The 150 B allocation and the 307–641 B headroom predate the menu trim (#36, A13): +16,679 B of 23.5 KB on `4b55ec6`. The brief allows < 1,000 B eager and nothing in the palette chunk. The spike measured the split cost; hence the navigation port and the inline kill-switch read.
- **Dismissal by input, not by transaction.** Load-time transactions (`toc-id-plugin`, schema repair, seeding, a filter URL's own selection) are local and would have dismissed the chip at once.
- **Placement.** The host goes before the ProseMirror element inside the card (Tab order, no layout shift). On phones it sits above the connection chip, which the draft's `bottom: clearance + 8px` would have covered. The style follows the design pass's status pill.
- **Ports and names.** 3610/1710 became 6220/4220 (3611 → 6221); `fold.spec.ts`, `toc-sidebar.spec.ts`, `outline-overlay.spec.ts` and the `toolbar-a11y*` axe specs are the real names; screenshots at 1440 and 375 px; base `4b55ec6`; the amendment is A-next (numbered at merge).
- **Design review (UI and UX designers, 2026-11-14).** Phones show "Continue · *Section*" so only the name truncates; the dismissing input in the document area is a `click`, not `pointerdown`, so a touch scroll keeps the chip; a tap on ✕ does not focus the text (no keyboard for nothing), while Esc, a keyboard press and a fine pointer still do; any coarse pointer (touch tablets too) uses the fixed bottom placement, centred at its own width above 480 px; fine pointers get 24 px buttons (`xs`, `icon-xs`) so the chip fits the card's top padding.
- **Recorder arming.** Focus alone does not count (Dismiss focuses the text where it was): the recorder arms on the writer's first local selection or edit, ignoring remote, appended and history-less transactions, or at install when the text already has focus.
- **Filter URLs.** On `main`, `useHeadingFilter` rewrites the URL with no filters on its first render, before the editor reads `?filter=`, so a filter link does not apply on load. The chip's filter rule is unit-tested through the navigation port; its e2e case waits for that bug's fix (follow-up).
