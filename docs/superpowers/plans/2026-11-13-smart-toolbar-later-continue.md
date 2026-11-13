# Smart toolbar, later phase: Continue where you left off (M15), implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a writer reopens a document, a small chip above the title offers "Continue where you left off · *Section name*". **Go** takes them back:
1. it unfolds any folded section that hides the place;
2. it puts the caret there, so the block renders at its true height under `content-visibility`;
3. then it scrolls the block to the top of the viewport.

The chip is never auto-focused, never applies anything by itself, and never shifts the page. The position is remembered locally only, as a Yjs relative position per document, so it survives collaborators' edits made while the writer was away.

**Architecture:**
- **One lazy chunk** (`continue`) holds the store, the recorder, the eligibility check and the chip. `document-editor.tsx` mounts it through `lazySurface` on idle once the editor exists. The only eager code is the loader and that one call.
- **Recorder:** on editor blur, `visibilitychange` (hidden), `pagehide` and its own release (unmount, which a tab switch causes), it converts the selection head to a `Y.RelativePosition` through the y-sync binding. It writes `tinydocy-continue` (scoped by Hocus host and document name, capped at 30 documents, 14-day expiry). It does no work per keystroke.
- **Chip:** shown after the first **server** sync, when the saved place is far enough down, still visible (not hidden by a heading-filter URL), and the writer has not moved the caret or typed yet. It is absolutely positioned over the page card's top padding, or above the phone bar, so its arrival and departure move nothing.
- **Go** reuses the outline's scroll-and-settle helper, extracted to `lib/editor-scroll.ts` with a `block` option, and a new fold command that unfolds the target's ancestors without animation.

**Tech Stack:** Next.js 16 (Turbopack), React 19, Tiptap 3.33, Yjs 13.6 (`Y.relativePositionToJSON`, `Y.createRelativePositionFromJSON`), `@tiptap/y-tiptap` (`ySyncPluginKey`, `absolutePositionToRelativePosition`, `relativePositionToAbsolutePosition`), `bun test` (happy-dom), Playwright with `@axe-core/playwright`. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-12-smart-toolbar-design.md` §5 (memory rules; the M15 row), §9 (P7; "Continue reuses the same helper" as the outline jump), §10 (P7's original questions), §6, §7, §8 item 6.

**Base:** branch `feat/smart-toolbar-continue` from `main` at or after `7abadc1`. Before Task 1, confirm:
- `git grep -n "export function toSessionRange" extensions/repeat-formatting/relative-range.ts`;
- `git grep -n "function scrollHeadingIntoView" components/toc-sidebar/toc-sidebar.tsx`;
- `git grep -n '"set"; ids' extensions/heading-fold/heading-fold-plugin.ts` (the fold plugin's no-animation meta);
- `git grep -n "export const headingFilterPluginKey" extensions/heading-filter/heading-filter-plugin.ts`.

**Effort:** M, about **5–6 engineer-days**: store and recorder 1.5, eligibility and fold or filter rules 1, Go and the scroll helper 1, chip UI and placement 1, tests, budgets and docs 1–1.5.

## Global Constraints

**Tooling**
- Bun only: `bun`, `bun <bin>`, `bunx --bun`. Never npm, npx, yarn or pnpm.
- Biome formats and lints. ESLint covers Next rules only. TypeScript is strict. `bun run typecheck` covers the app and `tsconfig.sw.json`.

**Code style**
- Named exports only. Kebab-case files. PascalCase components with title-case acronyms.
- Icons come from `lib/icons.tsx`. New UI uses the shadcn components in `components/ui/` and shadcn tokens.

**Commits**
- Conventional Commits: atomic, imperative mood.
- No AI, tool or agent references and no trailers.
- Before every commit, show a commit review report (files, diff summary, message) and wait for explicit approval.
- `CHANGELOG.md`: one sub-block for this PR under `## [Unreleased]`.

**Tests**
- `bun run test`: one process, happy-dom preload. `mock.module` spreads the real module and is followed by `await import()`. The kill switch is read at import time, so load it through `importFresh()` with `resetModules()` in `afterEach`.
- Playwright runs against **Next 3610 + Hocus 1710**. The kill-switch run uses a second Next on **3611** built with `NEXT_PUBLIC_REMEMBER_CHOICES=0` (same Hocus and DB). None of these ports is taken by contract §5.4, D2 or E. Never test against tiny.docs.plus. Run `lsof` first and stop only what you started.

```bash
DOC_CREATION_RATE_LIMIT=2000 WS_CONNECTION_LIMIT=200 WS_SOCKETS_PER_IP=600 WS_UPGRADE_RATE_LIMIT=6000 \
  HOCUS_THROTTLE=0 MAX_TOTAL_DOCUMENTS=1000000 HOCUS_PORT=1710 DB_PATH="$TMPDIR/tinydocy-continue.sqlite" \
  HOCUS_ALLOW_ISOLATED_TABS_DOCS=1 bun run hocus
NEXT_PUBLIC_HOCUS_URL=ws://127.0.0.1:1710 DB_PATH="$TMPDIR/tinydocy-continue.sqlite" bun next dev -p 3610
CI= E2E_BASE_URL=http://localhost:3610 E2E_HOCUS_URL=ws://127.0.0.1:1710 bun playwright test <spec> --project=chromium
```

- Touch e2e: `test.use({ hasTouch: true, isMobile: true })`, first assertion `matchMedia("(pointer: coarse)").matches === true`.
- e2e types at full speed.

**Code rules**
- Hydration: storage is read in effects or inside the lazy chunk only. The editor is a client-only `next/dynamic` import, and the chip renders only after the first server sync.
- Never subscribe the editor shell to editor state. Never rebuild the extensions array or `EDITOR_PROPS`.
- Memory is local only: never Yjs, the server, URLs or analytics. The stored value holds a relative position and a timestamp, never document text.
- A lazy chunk never imports row modules (A9 split cost).
- Never `registerPlugin` from the lazy chunk: every plugin view would be re-created.

**Contract rules**
- No frozen file is touched. `document-editor.tsx` is a §5.2 shared file, so its new hunk is recorded as a contract amendment (next free A-number at merge).
- `STORAGE_KEYS` and `CHOICE_SLOTS` are pinned by `contract.test.ts` (`toEqual`), so `tinydocy-continue` is a separate constant in `lib/continue-position.ts`, like `tinydocy-folds-<id>` in `extensions/heading-fold/helpers/fold-storage.ts`.

## Schema and protocol

**None. This plan needs no schema change and no protocol change.**
- No mark, node or attribute is added, so `lib/schema-names.ts` and `tests/fixtures/schema-snapshot.json` are unchanged.
- No WebSocket parameter, no Hocus change and no awareness field.
- The position never enters the Y.Doc. Go writes **nothing** to the document: it dispatches a fold-plugin meta (per-viewer view state, persisted locally, as A1 already treats `section.fold`) and a selection change.

## Budgets

**Editor chunk (`scripts/check-editor-chunk-size.ts`, gz).** The script sums every file the editor's loader lists, **CSS included**. A production build of E's tip lists three `.css` files in the group, 14,467 B gz. The A12 budget is 24,064 B. A8 measured +23,423 B at E's tip (`4fcba67`), so about **641 B** were left. A build of `7abadc1` with uncommitted follow-up changes measured +23,757 B (307 B left), so the real figure on `main` must be measured first. The four later-phase plans share what is left:

| Plan | Eager allocation | What is eager | Lazy |
|---|---|---|---|
| **M15 Continue (this plan)** | **150 B** | one lazy loader (about 118 B, A9) and its idle mount | continue chunk ≤ 3 KB gz |
| "/" menu | 280 B | trigger plugin, host, one lazy loader | slash chunk ≤ 6 KB gz |
| Hover preview | 160 B | the decoration plugin | ≤ +1 KB gz on the colour-panel chunk |
| Progressive-disclosure toggle | 150 B | one registry action, the ⋯ checkbox item, one attribute, the simplified CSS rules | none |
| **Total** | **740 B** | | |

**This is more than the headroom, and Turbopack's split cost comes on top.**
- A lazy chunk that imports modules the editor chunk also uses makes Turbopack split those modules into separate, less compressible editor-group files. A8 measured about 344 B for the palette chunk and about 968 B for the split button inside the bubble chunk.
- The continue chunk (`relative-range.ts`, the fold and filter plugin keys, `remembered-choice`, `hocuspocus`) and the slash chunk (registry, snapshot, memory) both import such modules.
- Expect the four plans together to need a new owner amendment, unless a trim lands first. The candidate is A9's untested "menu bodies lazy" lead, now unblocked.
- No plan raises the constant itself. Going over this plan's 150 B needs a trim or the owner's amendment.

Task 0 measures this before any feature code is written.

The fold command and the scroll-helper extraction are eager by nature, because they live in the editor and TOC modules. Both are small. Their bytes count against this plan's 150 B.

**Performance:**
- Typing p95 is unchanged within noise (≤ +10% and ≤ +16 ms, `--project=perf`). The recorder has no transaction listener. The chip listens to transactions only while it is shown, and removes the listener at the first local transaction, which dismisses it.
- A recorder write is one `localStorage.setItem` of ≤ 30 entries (≤ 8 KB), and only when the head changed since the last write.
- Go in a 500-heading document: unfold, select and the first scroll call fit in one frame (< 16 ms) before the smooth scroll. After it settles, the target block's top is within [toolbar bottom, toolbar bottom + 24 px].
- Layout shift: the CLS contribution of the chip's appearance and dismissal is **0** (PerformanceObserver `layout-shift`).
- Listeners return to baseline after 20 tab switches: the recorder removes its `visibilitychange`, `pagehide` and editor listeners on unmount.

## Accessibility requirements (WCAG 2.2 AA)

- **Never auto-focused** (spec M15). The chip enters the Tab order after the toolbar's single stop and before the editor (DOM order). It makes no live-region announcement (Decision 6).
- **Structure:** `<div role="group" aria-label="Continue reading">` holds:
  - the text "Continue where you left off · *Section name*";
  - a **Go** button whose accessible name is "Go to *Section name*". It starts with the visible label "Go" (2.5.3);
  - a **Dismiss** button (✕, `aria-label="Dismiss"`).

  The section name renders inside `<bdi>`, truncated to 40 characters with an ellipsis, so a heading with bidi controls cannot reorder the chip's text.
- **Focus is never dropped:**
  - Go moves focus into the editor with the caret at the target.
  - Dismiss and Esc (on either button) move focus into the editor without moving its selection.
  - A chip that disappears because of an edit or a remote change had no focus, or hands it to the editor first.
- **Targets:** ≥ 24×24 with a mouse. 44×44 on touch and on the phone layout.
- **Contrast:** text ≥ 4.5:1 and the border ≥ 3:1 in both themes (shadcn `secondary` tokens). Forced colours: `ButtonText` on `ButtonFace` with a visible border.
- **Focus not obscured (2.4.11):** the chip never covers the caret line (it sits in the card's top padding, or above the phone bar, and is gone after the first edit). Go's scroll target clears the sticky row (`scroll-padding-top`) or the phone bar (`--mobile-bar-clearance`).
- **Reduced motion:** Go scrolls with `behavior: "auto"` under `prefers-reduced-motion`.
- **Zoom and reflow (1.4.10):** at 320 CSS px the chip wraps onto two lines inside `max-width: calc(100% - 32px)` and never scrolls sideways.

## Upstream interfaces (as on `main` at `7abadc1`)

| # | Name | Where | Used for |
|---|---|---|---|
| U1 | `toSessionRange`, `fromSessionRange` (binding vs absolute) | `extensions/repeat-formatting/relative-range.ts` (pure module) | head ↔ `Y.RelativePosition`. Import it as is; do not copy |
| U2 | `ySyncPluginKey` binding `{ doc, type, mapping }` | `@tiptap/y-tiptap` | resolving after the server sync |
| U3 | `headingFoldPluginKey`; meta `{ type: "set", ids, persist? }` | `extensions/heading-fold/heading-fold-plugin.ts` | unfold without animation |
| U4 | `computeSection(doc, headingPos, level)` | `extensions/shared/compute-section.ts` | which folded headings contain the target |
| U5 | `headingFilterPluginKey` state `{ slugs, matchedSectionIds }` | `extensions/heading-filter/heading-filter-plugin.ts` | no chip when a filter hides the target |
| U6 | `scrollHeadingIntoView(dom)` (private, `block: "center"`, smooth with a settle pass) | `components/toc-sidebar/toc-sidebar.tsx` | extracted to `lib/editor-scroll.ts` |
| U7 | `CARET_BLOCK_CLASS` (`is-caret-block`) | `extensions/render-once/caret-block-visible.ts` | why the selection is set before the scroll |
| U8 | `getHocuspocusWsUrl()` | `lib/hocuspocus.ts` | host scope, the same host `storeKey` uses (`lib/offline/offline-cache.ts`) |
| U9 | `REMEMBER_CHOICES_ENABLED` | `lib/remembered-choice.ts` | kill switch |
| U10 | `lazySurface` | `components/smart-toolbar/lazy-surface.tsx` | the lazy chunk and its failure path |
| U11 | `useYjsDocument()` → `{ synced, serverSynced, rejectedReason }` | `hooks/use-yjs-document.ts` | wait for the server sync; drop the entry on `document_deleted` |
| U12 | `PLAYGROUND_ID` | `lib/constants.ts` | excluded |
| U13 | `CHUNK_MARKERS`, `interceptChunk`; `listenerCounts` (inline in `palette-leaks.spec.ts`) | `tests/e2e/helpers/lazy-chunk.ts` | 404 case; leak helper extracted to `tests/e2e/helpers/leak-metrics.ts` if missing |

## Decisions on spec ambiguities (owner can overrule)

1. **Storage:** its own key, `tinydocy-continue`: `{ v: 1, docs: { "<host>~<name>": { pos: RelativePositionJSON, at: epochMs } } }`.
   - It is scoped like the offline copies (`storeKey`), because a relative position resolved against another server's copy of the same name is wrong.
   - Newest 30 kept, 14-day expiry, matching `OFFLINE_MAX_DOCS` and `OFFLINE_DOC_MAX_AGE_DAYS`.
   - The payload is capped at 32 KB. Hostile, oversized or wrong-version payloads are discarded, and an own-property check drops `__proto__`.
2. **"Forget my choices" does not clear it.** It is view state, like the outline (M6, `tinydocy-ui`) and the folds (`tinydocy-folds-<id>`), and spec §5's Forget list does not name M15. If the owner wants Forget to clear it, `memory.forget`'s `run()` adds one call (a D2-file hunk).
3. **The kill switch turns M15 off.** With `NEXT_PUBLIC_REMEMBER_CHOICES=0` it reads nothing, writes nothing, and removes the key once on load.
4. **Record on leave, never per keystroke:** editor blur, `visibilitychange` → hidden, `pagehide`, and the recorder's release (tab switch). The editor's own `destroy` event cannot be relied on: `useEditor` defers `editor.destroy()` by a tick (`scheduleDestroy` in `@tiptap/react`), so the chip's effect cleanup has already removed its listener by then. Only local selections count. A head in the first three top-level blocks **deletes** the entry: there is nothing to continue.
5. **When the chip shows:** after the first **server** sync only. All of these must hold:
   - the entry resolves;
   - the target's top-level index is ≥ 3 (`CONTINUE_MIN_BLOCK`);
   - no local selection change or edit has happened since load;
   - no heading-filter URL hides the target's section;
   - the document is not `playground` (regenerated content).

   **Offline, no chip appears.** The device copy would resolve, but a server sync could still move content under a Go already taken. Recording still works offline.
6. **No announcement.** The chip is an offer, not news. A polite live region on every document open would be noise. This matches the context slot's no-live-region rule (§4.2).
7. **Dismissal:** Go, Dismiss, Esc on the chip, the first local edit, the first local selection change, a heading filter that starts hiding the target, a document switch, or a refusal (read-only stays: Go is navigation and still works). A dismissed chip returns only on the next open.
8. **Scroll alignment: `block: "start"`**, per spec §9 and AGENTS.md. The outline on `main` scrolls to `center`, on purpose (`d92c64a`), with a settle pass. This plan extracts that helper with a `block` option and keeps the outline at `center`. **Owner question:** should the outline move to `start` as AGENTS.md says? That change is out of scope here.
9. **Unfold without animation, and persist it.** Go dispatches the fold plugin's `set` meta with the target's folded ancestors removed (`persist: true`), so the target has its true height before the scroll. `toggleFold` animates for 350 ms and would measure the wrong height. Leaving those sections unfolded is the honest state after the writer asked to go inside them.
10. **A deleted target** resolves where Yjs puts it: the nearest surviving position. Go still lands near where the writer was. No special case.
11. **Deleted documents:** the entry is removed when the chip sees `rejectedReason === "document_deleted"`. A closed tab's entry is left to expiry and the cap, which needs no eager code in the tab-close path. The entry holds no text.

## Not in scope

- Syncing the position across devices (the spec says local only).
- Remembering scroll offset without a caret (only the selection head is stored).
- Changing the outline's scroll alignment (Decision 8 asks the owner).
- Document styles (M14b); see the "/" menu plan's "Not in scope".

## Review Focus

1. **Collaborators' edits while away.** Ten paragraphs inserted above the target by another client still land Go on the same text. Task 2 unit test "survives remote inserts" (two Y.Docs) and the Task 4 e2e.
2. **Folded and filtered targets.** A target inside a folded section is revealed with no animation and lands at the right height. A filter URL hiding it means no chip. Tasks 2, 3 and 4.
3. **No layout shift and no focus theft.** CLS is 0, and `activeElement` is never a chip button unless the writer tabbed there. Task 4 e2e.
4. **Tamper and storage failure.** Hostile payloads and a `localStorage` that throws give no chip and no exception. Task 1 unit table.
5. **Listener hygiene across tab switches.** The recorder's window listeners are removed on unmount. Task 6 leak test.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `lib/continue-position.ts` | Store (scope, cap, expiry, validation, kill switch), recorder, resolve | Create (lazy) |
| `lib/continue-eligibility.ts` | Pure: should a chip show for this state and entry; the section label | Create (lazy) |
| `lib/editor-scroll.ts` | `scrollBlockIntoView(dom, { block, smooth })`, extracted from the outline | Create |
| `components/toc-sidebar/toc-sidebar.tsx` | Uses the extracted helper with `block: "center"` (behaviour unchanged) | Modify |
| `extensions/heading-fold/heading-fold.ts` | Command `unfoldToPosition(pos)` (the `set` meta, `persist: true`) | Modify |
| `components/document-editor/continue-chip.tsx`, `continue-chip.scss` | Lazy chip: recorder effect, eligibility, Go, Dismiss | Create (lazy) |
| `components/document-editor/document-editor.tsx` | Mounts the lazy chip on idle once the editor exists | Modify (shared §5.2 hunk: amendment) |
| `tests/e2e/helpers/lazy-chunk.ts` | `CHUNK_MARKERS.continueChip` | Modify |
| `tests/e2e/helpers/leak-metrics.ts` | Listener and heap helpers | Create if missing |
| `tests/unit/lib/continue-position.test.ts`, `tests/unit/lib/continue-eligibility.test.ts`, `tests/unit/extensions/heading-fold-unfold.test.ts`, `tests/unit/lib/editor-scroll.test.ts` | Unit tests | Create |
| `tests/e2e/continue-chip.spec.ts`, `tests/e2e/lazy-surfaces.spec.ts` | e2e | Create / Modify |
| `docs/superpowers/specs/2026-11-13-smart-toolbar-v1-contract.md` | Amendment: the `document-editor.tsx` hunk, the separate storage key | Modify |
| `CHANGELOG.md`, `README.md`, `tests/TESTING.md`, `AGENTS.md` | Docs | Modify |

---

### Task 0: Measure the headroom and the split cost (spike, not committed)

**Files:** a throwaway `components/document-editor/continue-spike.tsx`. It renders nothing, but imports what the continue chunk will import: `toSessionRange`/`fromSessionRange`, `headingFoldPluginKey`, `headingFilterPluginKey`, `computeSection`, `readChoice`/`REMEMBER_CHOICES_ENABLED` and `getHocuspocusWsUrl`. `document-editor.tsx` mounts it through `lazySurface` on idle, as Task 5 will. Revert everything after measuring.

- [ ] **Step 1:** On a clean checkout of the base, run `bun run build && bun scripts/check-editor-chunk-size.ts`. Record the growth and the headroom.
- [ ] **Step 2:** Add the spike chunk and its mount. Rebuild and measure again. The delta is the loader and the split cost, before the fold command and the scroll helper.
- [ ] **Step 3:** If the delta already exceeds this plan's 150 B, or what is left of the shared headroom, **stop**. Report the numbers to the owner, with the trims you see (for example, resolving positions with plain `yjs` calls instead of importing `relative-range.ts`), and wait for a decision or an amendment before Task 1.
- [ ] **Step 4:** Revert the spike. Put the numbers in the PR description.

---

### Task 1: Store and recorder

**Files:**
- Create: `lib/continue-position.ts`
- Test: `tests/unit/lib/continue-position.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const CONTINUE_STORAGE_KEY = "tinydocy-continue";
  export const CONTINUE_MAX_DOCS = 30;
  export const CONTINUE_MAX_AGE_DAYS = 14;
  export const CONTINUE_MIN_BLOCK = 3;
  export interface ContinueEntry { pos: Y.RelativePosition; at: number }
  export function continueScope(documentName: string): string;          // `${new URL(getHocuspocusWsUrl()).host}~${name}`
  export function readContinueEntry(scope: string, now?: number): ContinueEntry | null;
  export function writeContinueEntry(scope: string, pos: Y.RelativePosition, now?: number): void;
  export function deleteContinueEntry(scope: string): void;
  export function installContinueRecorder(editor: Editor, scope: string): () => void;  // idempotent release
  ```
- **Writes:** every write re-reads the key, prunes expired entries, keeps the newest 30 and wraps each storage call in try/catch. Nothing is written under the kill switch.
- **Recorder:**
  - It reads `editor.state.selection.head`.
  - If the head's top-level index is below `CONTINUE_MIN_BLOCK`, it deletes the entry.
  - Otherwise, when there is a y-sync binding, it writes `toSessionRange(...)`'s relative `head`. Without a binding it writes nothing: an absolute position cannot survive remote edits.
  - It skips the write when the encoded position equals the last one written.
  - **Release records first:** the release function records the head once more, then removes its listeners. A tab switch unmounts the chip before the deferred `editor.destroy()`, so this is what saves the place on a tab switch.

- [ ] **Step 1: Write the failing tests**

```ts
it("round-trips a relative position per scope", () => {});
it("scopes by Hocus host: the same name on another host is a different entry", () => {});
it("keeps the newest 30 and drops entries older than 14 days", () => {});
it("tamper: hostile JSON, wrong version, oversized payload, __proto__ keys, non-objects -> null, no throw", () => {});
it("storage that throws on read or write -> null / no-op", () => {});
it("kill switch: reads null, writes nothing, removes the key once", async () => { /* importFresh */ });
it("recorder: blur, visibilitychange hidden and pagehide record the head", () => {});
it("recorder: release records the head before it removes its listeners", () => {});
it("recorder: a head in the first three blocks deletes the entry", () => {});
it("recorder: no binding -> nothing written; unchanged head -> no second write", () => {});
it("recorder: release removes every listener and is idempotent", () => {});
```

- [ ] **Step 2: Run them and confirm they fail.** Run: `bun test tests/unit/lib/continue-position.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run them and confirm they pass.** Expected: PASS.

- [ ] **Step 5: Commit** after approval: `feat(continue): remember where you left off, locally per document`

---

### Task 2: Eligibility (pure)

**Files:**
- Create: `lib/continue-eligibility.ts`
- Test: `tests/unit/lib/continue-eligibility.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ContinueOffer = { pos: number; label: string | null } | null;
  export function continueOffer(input: {
    state: EditorState; entry: ContinueEntry | null; documentName: string;
    userMoved: boolean; serverSynced: boolean;
  }): ContinueOffer;
  ```
- It returns `null` unless every condition in Decision 5 holds. It resolves through `fromSessionRange`.
- `label` is the text of the nearest heading before `pos` that is not the title, trimmed to 40 characters. It is `null` when there is none.
- **Filter-hidden:** the filter state has slugs, and the heading id of the target's enclosing section is not in `matchedSectionIds`.

- [ ] **Step 1: Write the failing tests**

```ts
it("survives remote inserts: ten paragraphs added above by another Y.Doc still resolve to the same text", () => {});
it("no offer before the server sync, for playground, for the first three blocks, or after the user moved", () => {});
it("no offer when a filter URL hides the target's section; an offer when it matches", () => {});
it("label: nearest non-title heading, 40 chars max; null with only a title", () => {});
it("a remotely deleted target resolves to the nearest surviving position", () => {});
```

- [ ] **Step 2: Run them and confirm they fail.** Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run them and confirm they pass.** Expected: PASS.

- [ ] **Step 5: Commit** after approval: `feat(continue): decide when to offer the way back`

---

### Task 3: Unfold to a position, and the shared scroll helper

**Files:**
- Modify: `extensions/heading-fold/heading-fold.ts` (command), `components/toc-sidebar/toc-sidebar.tsx` (use the helper)
- Create: `lib/editor-scroll.ts`
- Test: `tests/unit/extensions/heading-fold-unfold.test.ts`, `tests/unit/lib/editor-scroll.test.ts`

**Interfaces:**
- `unfoldToPosition: (pos: number) => ReturnType` (Tiptap command):
  - It collects every folded heading id whose section (`computeSection`) contains `pos`.
  - If there is none, it returns true and dispatches nothing.
  - Otherwise it dispatches `{ type: "set", ids: foldedIds minus those, persist: true }`, with no `animating` entries and no doc change.
- `scrollBlockIntoView(dom: HTMLElement, options: { block: "start" | "center"; smooth?: boolean }): void` is the outline's helper with its settle pass, cancel-on-takeover events and 5 s timeout. `smooth` defaults to true and is forced off under `prefers-reduced-motion`.
- The outline calls it with `{ block: "center" }` and keeps today's behaviour.

- [ ] **Step 1: Write the failing tests**

```ts
it("unfolds only the folded ancestors of the position, without animation, and persists", () => {});
it("leaves unrelated folds alone and dispatches nothing when no ancestor is folded", () => {});
it("is not a doc change: no Yjs update and no undo entry", () => {});
it("scrollBlockIntoView settles once on scrollend and cancels on wheel, touchstart, keydown, pointerdown", () => {});
it("reduced motion -> behavior auto", () => {});
```

- [ ] **Step 2: Run them and confirm they fail.** Expected: FAIL.

- [ ] **Step 3: Implement.** Run `toc-sidebar.spec.ts` to prove the outline is unchanged.

- [ ] **Step 4: Run them and confirm they pass**, plus `CI= E2E_BASE_URL=http://localhost:3610 bun playwright test tests/e2e/toc-sidebar.spec.ts tests/e2e/fold.spec.ts --project=chromium`. Expected: PASS.

- [ ] **Step 5: Commit** after approval: `refactor(editor): share the outline scroll helper and unfold to a position`

---

### Task 4: The chip

**Files:**
- Create: `components/document-editor/continue-chip.tsx`, `components/document-editor/continue-chip.scss`
- Modify: `tests/e2e/helpers/lazy-chunk.ts` (`continueChip: "function ContinueChip("`)
- Test: `tests/e2e/continue-chip.spec.ts`

**Interfaces:**
- `ContinueChip({ editor, documentName, serverSynced, rejectedReason })` (lazy):
  - **Effects:**
    - `installContinueRecorder` on mount, released on unmount;
    - it tracks `userMoved` from the first local transaction that sets a selection or changes the doc (`!isChangeOrigin(tr)`, no `ySyncPluginKey` meta);
    - `deleteContinueEntry` on `document_deleted`.
  - **Render:** it computes `continueOffer(...)` once `serverSynced` turns true, then only until it is dismissed (Decision 7).
  - **Go:**
    1. resolve again;
    2. `editor.commands.unfoldToPosition(pos)`;
    3. dispatch `TextSelection.near(doc.resolve(pos))` without `scrollIntoView`;
    4. `editor.view.focus()`;
    5. in `requestAnimationFrame`, `scrollBlockIntoView(view.nodeDOM(topLevelStart(pos)), { block: "start" })`;
    6. dismiss.
  - **Dismiss and Esc:** `editor.view.focus()`, then dismiss.
- **Placement:**
  - Above 480 px: `position: absolute` inside `.editor-with-toc`, over the page card's 3 rem top padding, aligned to the card's inline start.
  - At 480 px and below (the card's padding is 1 rem): `position: fixed`, centred, `bottom: calc(var(--mobile-bar-clearance, 0px) + 8px)`.
  - Neither changes layout.

- [ ] **Step 1: Write the failing tests**

```ts
test("offers the way back after reopening, never focused, and Go lands at the place", async ({ page }) => {
  // 30-section doc; caret in section 20; switch tab and back (release records); reload
  // after sync: chip visible, activeElement is not inside it; Go -> caret at the saved text,
  // block top within [toolbar.bottom, toolbar.bottom + 24], chip gone, activeElement is .ProseMirror
});
test("a target inside a folded section is unfolded and lands at its true height", async ({ page }) => {});
test("a filter URL that hides the target shows no chip", async ({ page }) => {});
test("edits by a collaborator while away still land Go on the same text", async ({ browser }) => {});
test("no layout shift when the chip appears or goes", async ({ page }) => {
  // PerformanceObserver layout-shift total === 0 across appear, Dismiss, and a reload + first edit
});
test("the first edit or caret move dismisses it; Dismiss and Esc put focus in the editor", async ({ page }) => {});
test("no chip near the top, in playground, or offline", async ({ page, context }) => {});
test("touch 375px: above the bar, 44px targets", async ({ browser }) => { /* pointer: coarse first */ });
```

- [ ] **Step 2: Run them and confirm they fail.** Expected: FAIL.

- [ ] **Step 3: Implement.** Screenshot the chip at 1280 px and 375 px, light and dark.

- [ ] **Step 4: Run them and confirm they pass.** Expected: PASS.

- [ ] **Step 5: Commit** after approval: `feat(continue): offer a chip back to where you left off`

---

### Task 5: Mount, failure path and the contract amendment

**Files:**
- Modify: `components/document-editor/document-editor.tsx`, `tests/e2e/lazy-surfaces.spec.ts`, `docs/superpowers/specs/2026-11-13-smart-toolbar-v1-contract.md`

**The mount:**
- `const ContinueChip = lazySurface(() => import("./continue-chip").then((m) => m.ContinueChip))` at module level.
- It renders `{editor && idleReady && <ContinueChip … />}` inside `.editor-with-toc`, before `EditorContent`.
- `idleReady` turns true in an effect through `requestIdleCallback` (fallback `setTimeout(…, 1000)`) once the editor exists.
- It is not rendered under `__TOOLBAR_OFF`. The perf project compares like with like.

**The amendment records:**
- the `document-editor.tsx` hunk;
- the separate `tinydocy-continue` key (not in `STORAGE_KEYS`, so `contract.test.ts` is unchanged);
- the new fold command;
- the extracted scroll helper;
- the measured eager and lazy bytes.

- [ ] **Step 1: Write the failing test**

```ts
test("a continue chunk that fails to load leaves the editor and tabs working", async ({ page }) => {});
```

- [ ] **Step 2: Run it and confirm it fails.**

- [ ] **Step 3: Implement**, then write the amendment.

- [ ] **Step 4: Run** `lazy-surfaces.spec.ts`, `continue-chip.spec.ts`, `tabs.spec.ts` and `offline-copies.spec.ts`. Expected: PASS.

- [ ] **Step 5: Commit** after approval: `feat(continue): mount the chip lazily and record its amendment`

---

### Task 6: Leaks, accessibility, kill switch, budgets, docs and full verification

**Files:**
- Create: `tests/e2e/helpers/leak-metrics.ts` (if missing)
- Modify: `tests/e2e/continue-chip.spec.ts` (leaks, axe, kill switch), `CHANGELOG.md`, `README.md`, `tests/TESTING.md` (spec, ports 3610/1710 and 3611), `AGENTS.md` (one line: M15 key, scope, recorder events, never in Yjs)

- [ ] **Step 1: Write the failing tests**

```ts
test("20 tab switches with the chip mounted return window/document listeners to baseline", async ({ page }) => {});
test("axe 0 serious, light and dark; forced-colours border visible", async ({ page }) => {});
test.skip(process.env.E2E_REMEMBER_OFF !== "1", "needs Next on 3611 built with NEXT_PUBLIC_REMEMBER_CHOICES=0");
test("kill switch: no chip, no tinydocy-continue key", async ({ page }) => {});
```

- [ ] **Step 2: Run them and confirm the new ones fail or are unwired.**

- [ ] **Step 3: Write the docs.** The CHANGELOG says "no schema or protocol change" and needs no Deploy note.

- [ ] **Step 4: Run the full verification**

```bash
bun audit --audit-level=high && bun biome check . && bun run lint && bun run typecheck && bun run test && bun run build
bun scripts/check-editor-chunk-size.ts        # eager delta against this plan's 150 B
CI= E2E_BASE_URL=http://localhost:3610 bun playwright test --project=chromium --project=perf
CI= E2E_BASE_URL=http://localhost:3610 bun playwright test tests/e2e/continue-chip.spec.ts --project=chromium --repeat-each=10 --workers=3
E2E_REMEMBER_OFF=1 CI= E2E_BASE_URL=http://localhost:3611 bun playwright test tests/e2e/continue-chip.spec.ts --project=chromium
```

Expected: everything passes. The PR description records the eager delta, the chunk size, typing p95, CLS, leak numbers and screenshots.

- [ ] **Step 5: Commit** after approval: `test(continue): assert leaks, accessibility and the kill switch`

---

## Test plan (summary)

| Layer | What | Where |
|---|---|---|
| Unit | Store round-trip, host scope, cap, expiry, tamper, throwing storage, kill switch; recorder events, top-of-doc delete, no binding, release | `continue-position.test.ts` |
| Unit | Remote inserts, all Decision 5 conditions, filter-hidden, label, deleted target | `continue-eligibility.test.ts` |
| Unit | Unfold only ancestors, no animation, persist, no doc change; scroll settle and reduced motion | `heading-fold-unfold.test.ts`, `editor-scroll.test.ts` |
| e2e | Offer, never focused, Go lands, fold, filter, collaborator edits, CLS 0, dismissal and focus, top, playground, offline | `continue-chip.spec.ts` |
| e2e touch | `pointer: coarse` first, above the bar, 44 px | `continue-chip.spec.ts` |
| e2e | 404 chunk; outline unchanged; folds | `lazy-surfaces.spec.ts`, `toc-sidebar.spec.ts`, `fold.spec.ts` |
| e2e | Leaks after 20 tab switches; axe; forced colours; kill switch (3611) | `continue-chip.spec.ts` |
| perf | Typing p95 ≤ +10% and ≤ +16 ms | `--project=perf` |
| size | Eager ≤ 150 B; continue chunk ≤ 3 KB gz | `check-editor-chunk-size.ts` and the production build |

## Acceptance criteria

- Reopening a document after leaving it below the third block offers the chip after the server sync. Go lands the caret on the same text, even after collaborators' edits and inside folded sections, with the block top within 24 px under the toolbar.
- The chip is never auto-focused, never shifts the page (CLS 0) and never appears offline, near the top, in playground or when a filter hides the target.
- Focus is never dropped. axe reports 0 serious issues in both themes. Touch targets are 44 px.
- Nothing reaches Yjs, the server, URLs or analytics. `tests/fixtures/schema-snapshot.json`, `lib/schema-names.ts`, Hocus and `contract.test.ts` are unchanged.
- The eager delta is ≤ 150 B (or the owner recorded an amendment), the chunk is ≤ 3 KB gz, and typing and leak budgets hold.
- The outline behaves as before (`toc-sidebar.spec.ts` green), and Decision 8's question is in the PR description.

## Risks

| Risk | Mitigation |
|---|---|
| `pagehide` and `visibilitychange` do not fire when iOS kills a background tab | Editor blur also records, so the last caret before switching apps is usually saved. Documented as best effort. |
| The relative position's item is garbage-collected after a large remote rewrite | `relativePositionToAbsolutePosition` returns null and no chip shows. Covered by Decision 10's test. |
| The chip covers the title on a narrow desktop window | Above 480 px the card keeps 3 rem of top padding and the chip is one line ≤ 32 px tall. The 481–767 px range is checked in the Task 4 screenshots. |
| Unfolding persists folds the writer wanted closed | Decision 9 (overrulable). Only the target's ancestors open. |
| Eager allocation overrun (shared 740 B against a headroom of 307–641 B, plus split costs) | Measure at Tasks 0 and 6. Trim or ask for the owner's amendment. |
| `fromSessionRange` lives in E's extension folder | It is a pure module already imported by `v11-actions.ts`. If E moves it, the import moves with it (A6 precedent for `list-commands`). |

## Self-review

1. **Spec coverage:**
   - M15 row: offer chip above the title, never auto-focused → Task 4.
   - Go unfolds ancestors, selects first, then scrolls → Tasks 3 and 4.
   - No chip when a filter URL hides the target → Task 2.
   - Stored as a Yjs relative position per document → Task 1.
   - §9 shared helper → Task 3 (alignment question, Decision 8).
   - §5 local-only rules → Global Constraints and Task 1.
   - §6 and §7 → Tasks 4–6.
2. **Schema and protocol:** none, stated. Go writes no document content.
3. **Type consistency:** `ContinueEntry` (Task 1) is used in Tasks 2 and 4. `ContinueOffer` (Task 2) is used in Task 4. `unfoldToPosition` and `scrollBlockIntoView` (Task 3) are used in Task 4.
4. **Review Focus:** each item names its test, in Tasks 1, 2, 3, 4 and 6.
