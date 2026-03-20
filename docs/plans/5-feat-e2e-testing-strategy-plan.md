---
title: "feat: Comprehensive E2E Testing Strategy"
type: feat
status: completed
date: 2026-03-15
---

# Comprehensive E2E Testing Strategy

> Historical note: this completed plan predates the `extensions/` refactor.
> Path references to `components/tiptap-node/{heading-node,document-node}` are
> legacy locations. Current extension sources live under `extensions/`.

## Overview

Establish a three-layer testing infrastructure for TinyDocy's collaborative document editor: **Vitest** for fast headless schema/model tests and fuzzing, **Playwright** for browser-based feature E2E and performance baselines, and a **custom Yjs load harness** for 100-user concurrency simulation. All tests run against the dev server (`make dev`). CI/CD integration is deferred.

Brainstorm: `docs/brainstorms/8-e2e-testing-strategy-brainstorm.md`

## Problem Statement

TinyDocy has zero test infrastructure — no test framework, no test files, no CI/CD. The editor has a custom enforced document model (`heading block*`), four custom ProseMirror plugins (HeadingScale, HeadingDrag, HeadingFold, HeadingFilter), and real-time collaboration via Yjs/Hocuspocus. Any regression in schema enforcement, plugin interactions, or collaboration can corrupt documents silently. Production readiness requires automated verification across all these dimensions.

---

## Technical Approach

### Architecture

```
tests/
├── setup.ts                          # Vitest global setup (jsdom, mocks)
├── helpers/
│   ├── create-test-editor.ts         # Tiptap Editor factory (element: null)
│   ├── document-builders.ts          # prosemirror-test-builder wrappers
│   ├── document-generators.ts        # Random valid document generators
│   └── assert-invariants.ts          # Schema invariant assertion helpers
├── unit/                             # Vitest — Layer 1
│   ├── schema/
│   │   ├── title-document.test.ts    # TitleDocument enforcement
│   │   ├── paste-handling.test.ts    # Paste promotion, marks, flattening
│   │   └── schema-invariants.test.ts # Exhaustive schema assertions
│   ├── helpers/
│   │   ├── compute-section.test.ts
│   │   ├── can-map-decorations.test.ts
│   │   ├── match-section.test.ts
│   │   ├── fold-storage.test.ts
│   │   └── filter-url.test.ts
│   ├── plugins/
│   │   ├── heading-fold.test.ts      # Fold plugin state.apply
│   │   ├── heading-filter.test.ts    # Filter plugin state.apply
│   │   ├── heading-scale.test.ts     # Scale plugin decorations
│   │   └── heading-drag.test.ts      # Drag plugin decorations (state only)
│   └── fuzz/
│       ├── schema-fuzz.test.ts       # Structured randomization
│       └── chaos-fuzz.test.ts        # True fuzzing (malformed inputs)
├── e2e/                              # Playwright — Layer 2
│   ├── helpers/
│   │   ├── editor-page.ts            # Page Object Model for editor
│   │   └── perf-observer.ts          # PerformanceObserver injection
│   ├── fold.spec.ts
│   ├── drag.spec.ts
│   ├── filter.spec.ts
│   ├── toc-sidebar.spec.ts
│   ├── collaboration.spec.ts         # 2-3 browser contexts
│   └── performance.spec.ts           # Typing latency baselines
├── load/                             # Yjs Harness — Layer 3
│   └── yjs-load-harness.ts           # Standalone script
└── fixtures/
    ├── empty-document.json
    ├── title-only.json
    ├── deeply-nested.json            # H1>H2>H3>H4>H5>H6
    ├── wide-document.json            # 50 H1 sections
    ├── mixed-content.json            # Headings + lists + images + blockquotes + code
    └── real-world-complex.json       # Realistic complex document
```

### Dependencies to Install

```bash
# Layer 1: Vitest
bun add -D vitest @vitejs/plugin-react vite-tsconfig-paths jsdom prosemirror-test-builder

# Layer 2: Playwright
bun add -D @playwright/test

# Layer 3: Yjs harness (ws needed for Node.js WebSocket)
bun add -D ws @types/ws
```

---

## Implementation Phases

### Phase 1: Infrastructure Setup

#### Task 1.1: Install dependencies

```bash
bun add -D vitest @vitejs/plugin-react vite-tsconfig-paths jsdom prosemirror-test-builder @playwright/test ws @types/ws
bunx playwright install chromium
```

#### Task 1.2: Create `vitest.config.ts`

```typescript
// vitest.config.ts
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/unit/**/*.test.ts"],
    exclude: ["tests/e2e/**", "tests/load/**"],
  },
  resolve: {
    conditions: ["import", "default"],
  },
});
```

**Note:** `resolve.conditions` is required for `@tiptap/pm` subpath imports. If specific imports like `@tiptap/pm/state` fail, add explicit aliases:

```typescript
resolve: {
  alias: {
    '@tiptap/pm/state': '@tiptap/pm/dist/state',
    '@tiptap/pm/model': '@tiptap/pm/dist/model',
  }
}
```

#### Task 1.3: Create `playwright.config.ts`

```typescript
// playwright.config.ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  use: {
    baseURL: "http://localhost:3000",
    headless: true,
  },
  webServer: undefined, // requires `make dev` running externally
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
  ],
});
```

#### Task 1.4: Create `tests/setup.ts`

```typescript
// tests/setup.ts
import { afterEach, vi } from "vitest";

// Mock localStorage
const store: Record<string, string> = {};
vi.stubGlobal("localStorage", {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { for (const k in store) delete store[k]; },
  get length() { return Object.keys(store).length; },
  key: (i: number) => Object.keys(store)[i] ?? null,
});

afterEach(() => {
  localStorage.clear();
});
```

#### Task 1.5: Add scripts to `package.json` and `Makefile`

**`package.json` scripts:**

```json
{
  "test": "vitest run",
  "test:watch": "vitest",
  "test:fuzz": "vitest run tests/unit/fuzz/",
  "test:e2e": "bunx playwright test",
  "test:load": "bun tests/load/yjs-load-harness.ts"
}
```

**`Makefile` additions:**

```makefile
test:
 bun test

test-watch:
 bun test:watch

test-fuzz:
 bun test:fuzz

test-e2e:
 bunx playwright test

test-load:
 bun tests/load/yjs-load-harness.ts
```

#### Task 1.6: Create test helpers

**`tests/helpers/create-test-editor.ts`** — Factory for headless Tiptap Editor:

- Creates `new Editor({ element: null, content, extensions })` with the full TinyDocy extension chain (minus Collaboration and DOM-dependent features)
- Extensions: StarterKit (document: false, horizontalRule: false), TitleDocument, HeadingScale, HeadingFold, HeadingFilter, UniqueID, Highlight, TextAlign
- Accepts optional `content` (JSON) and `extensions` override
- Exports `createTestEditor(options?)` returning an `Editor` instance

**`tests/helpers/document-builders.ts`** — `prosemirror-test-builder` wrappers:

- Uses `builders()` from `prosemirror-test-builder` with the TinyDocy schema
- Exports: `doc`, `h1`, `h2`, `h3`, `h4`, `h5`, `h6`, `p`, `blockquote`, `codeBlock`, `bulletList`, `listItem`, `hr`, `img`
- Each builder supports position tags (`<cursor>`, `<start>`, `<end>`)

**`tests/helpers/assert-invariants.ts`** — Schema invariant assertions:

- `assertFirstNodeIsH1(doc)` — first child is heading with level 1
- `assertValidSchema(doc)` — all children match `heading | block*`
- `assertHeadingLevels(doc)` — all heading levels are 1-6
- `assertUniqueIds(doc)` — all `data-toc-id` attrs are unique and non-null on headings
- `assertSectionBoundaries(doc)` — every heading's `computeSection` returns valid `{ from, to }` with `to <= doc.content.size`
- `assertMarksRoundtrip(doc, schema)` — `doc.toJSON()` → `Node.fromJSON()` → deep equals
- `assertAllInvariants(doc, schema)` — runs all of the above

**`tests/helpers/document-generators.ts`** — Random document factory:

- `generateRandomDocument(options)` — options: `{ minSections, maxSections, maxDepth, includeContent, contentTypes }`
- Generates valid documents with random heading structure and content
- Content types: paragraphs, blockquotes, lists, code blocks, images, horizontal rules
- Returns Tiptap-compatible JSON

---

### Phase 2: Vitest — Schema & Model Tests

#### Task 2.1: `tests/unit/schema/title-document.test.ts`

Test cases for TitleDocument enforcement:

- **H1 enforcement:** Create editor with H2 as first node → `appendTransaction` corrects to H1
- **Empty document:** Create empty editor → first node is H1 placeholder
- **Delete title:** Select all + delete → title H1 still exists
- **Title with empty text:** H1 with no text content → valid state
- **Set heading level on title:** Change title heading to H2 via command → reverts to H1
- **Insert before title:** Insert paragraph at position 0 → title remains first and H1
- **Multiple H1s:** Document with multiple H1 sections → all are valid, first stays title

#### Task 2.2: `tests/unit/schema/paste-handling.test.ts`

Test cases for `titlePasteHandler`:

- **Full-document paste (non-heading first block):** Paste `<p>Hello</p><p>World</p>` with selection from 0 → first block becomes H1 with "Hello" text
- **Full-document paste (heading first block):** Paste `<h2>Title</h2><p>Content</p>` → first heading promoted to H1
- **Inline marks preserved:** Paste `<p><strong>Bold</strong> text</p>` → marks survive on H1
- **Non-textblock flattening:** Paste `<blockquote><p>Quote</p></blockquote>` at pos 0 → flattened to H1 text
- **Partial paste (cursor mid-document):** Paste content in middle of doc → no H1 promotion (only full-doc paste triggers)
- **Paste with nested lists:** Complex nested structure → flattened correctly

**Note:** The `titlePasteHandler` uses ProseMirror's `handlePaste` which requires an `EditorView`. For headless Vitest tests, simulate paste by constructing a `Slice` from parsed HTML and applying `tr.replaceSelection(slice)`. Full `handlePaste` integration is best tested in Playwright (Phase 4) where a real browser clipboard is available.

#### Task 2.3: `tests/unit/schema/schema-invariants.test.ts`

- Run `assertAllInvariants` against each fixture document
- Create editor with each fixture → apply 10 random transactions → assert invariants still hold
- Test with generated documents (10 random docs) → assert invariants

#### Task 2.4: `tests/unit/helpers/compute-section.test.ts`

- H1 followed by paragraphs → section includes all until next H1
- H2 followed by H3 content then H2 → section stops at second H2
- Last heading in document → section extends to end of doc
- Single heading (title only, no body) → section is just the heading
- Heading at position 0 (title) → includes content until next heading
- `startChildIndex` optimization → same result as without it

#### Task 2.5: `tests/unit/helpers/can-map-decorations.test.ts`

- Content-only edit (insert text in paragraph) → returns `true`
- Insert new heading → returns `false`
- Delete heading → returns `false`
- Split paragraph → returns `false`
- Join paragraphs → returns `false`
- Replace selection across nodes → returns `false`
- Empty transaction (no steps) → returns `true`

#### Task 2.6: `tests/unit/helpers/match-section.test.ts`

- `findAllSections`: skips title H1 (index 0), returns correct section list
- `matchSections` with query: returns direct matches
- `matchSections` with `computeOwnRange`: no false matches from nested content
- `filterSections` OR mode: union of matches
- `filterSections` AND mode: intersection of matches
- `filterSections` hierarchy: matching child → ancestors and descendants included
- `filterSections` with empty query → empty result
- `filterSections` with whitespace-only query → empty result
- `filterSections` with query matching zero sections → empty result

#### Task 2.7: `tests/unit/helpers/fold-storage.test.ts`

- `saveFoldedIds` + `loadFoldedIds` → roundtrip `Set<string>`
- `loadFoldedIds` with no stored data → empty set
- `loadFoldedIds` with corrupted JSON → empty set (graceful fallback)
- Different document IDs → independent storage

#### Task 2.8: `tests/unit/helpers/filter-url.test.ts`

- `decodeFilterParams` with valid params → correct `{ slugs, mode }`
- `decodeFilterParams` with missing params → `null`
- `updateFilterUrl` → updates `window.history` without navigation
- `readFilterUrl` with `typeof window === "undefined"` → returns `null`
- `readFilterUrl` with `?filter=a,b&mode=or` → correct decode

#### Task 2.9: `tests/unit/plugins/heading-fold.test.ts`

Test fold plugin `state.apply` (no DOM, no `view()`):

- Initial state: `foldedIds` empty, `decos` empty
- Toggle fold (meta `type: "toggle"`) → `foldedIds` gains ID, decorations built
- Toggle again → `foldedIds` loses ID, decorations removed
- Set folds (meta `type: "set"`) with `persist: false` → `skipPersist` true
- End animation (meta `type: "endAnimation"`) → animating map updated
- Content-only edit with `canMapDecorations` true → decorations mapped, no rebuild
- Structural edit → full decoration rebuild
- Stale fold IDs (heading deleted) → pruned from `foldedIds`
- Fold parent, fold child, unfold parent → child fold state preserved
- Fold all sections → all content hidden by decorations

#### Task 2.10: `tests/unit/plugins/heading-filter.test.ts`

Test filter plugin `state.apply`:

- Initial state: `slugs` empty, no decorations
- Preview meta → `previewQuery` set, inline highlight decorations built, `matchedSectionIds` updated
- Commit meta → `slugs` populated, fold meta dispatched (verify meta on transaction)
- Remove slug → `slugs` reduced
- Clear meta → `slugs` empty, fold meta dispatched to unfold
- Set mode → `mode` updated (or/and)
- `canMapDecorations` fast path on typing → decorations mapped, no section recount
- Filter with hierarchy: child match → ancestors visible

#### Task 2.11: `tests/unit/plugins/heading-scale.test.ts`

- Document with H1>H2>H3 → decorations with `--hd-size` set
- Same rank count → same visual sizing (H1>H2>H4 vs H1>H3>H5)
- Content edit → decorations mapped (fast path)
- Add heading → decorations rebuilt

#### Task 2.12: `tests/unit/plugins/heading-drag.test.ts`

- `buildHandleDecos` → one decoration per heading (except title)
- Content edit → decorations mapped
- Add heading → decorations rebuilt
- Remove heading → decorations rebuilt

---

### Phase 3: Vitest — Fuzz Suite

#### Task 3.1: `tests/unit/fuzz/schema-fuzz.test.ts`

Structured randomization (5,000 operations):

```
for each iteration (500 iterations × 10 operations each):
  1. Generate random valid document (1-20 sections, depth 1-6)
  2. Create editor with document
  3. Apply 10 random valid operations:
     - Insert text at random position
     - Insert heading at random position
     - Delete random range
     - Replace random range with random content
     - Toggle fold on random heading
     - Apply filter with random query
  4. After each operation: assertAllInvariants(editor.state.doc)
```

#### Task 3.2: `tests/unit/fuzz/chaos-fuzz.test.ts`

True fuzzing (5,000 operations):

```
for each iteration (500 iterations × 10 operations each):
  1. Create editor with random or empty document
  2. Apply 10 random chaotic operations:
     - Insert random string (including special chars, HTML entities, emojis, zero-width chars)
     - Paste malformed HTML (broken tags, nested incorrectly, missing closing tags)
     - Rapid sequential transactions without settling
     - Select all + delete
     - Paste empty content
     - Insert absurdly long text (10K chars)
  3. After each: editor must not throw, assertFirstNodeIsH1, assertValidSchema
```

---

### Phase 4: Playwright — Feature E2E & Performance

#### Test Document Setup Strategy

Each Playwright test needs a document with known structure. Approach:

1. **Unique document per test:** Each test generates a unique `docId` (e.g., `test-fold-${Date.now()}`). Navigate to the editor with that ID — Hocuspocus creates a fresh empty document.
2. **Populate via keyboard:** Type the required heading structure using `page.keyboard`. For simple tests (2-5 headings), this is fast enough. Helper method: `editorPage.buildDocument([{ level: 1, text: 'Title' }, { level: 2, text: 'Section' }, ...])` types headings via `Ctrl+Alt+<level>` followed by text and Enter.
3. **Populate via editor API (for large docs):** For performance tests with 500 headings, inject content via `window.__tiptap_editor.commands.setContent(fixtureJSON)` using `page.evaluate()`. This bypasses typing and sets content instantly.
4. **Cleanup:** No cleanup needed — each test uses a unique `docId` that is never reused.

#### Task 4.1: `tests/e2e/helpers/editor-page.ts`

Page Object Model for the editor:

- `goto(docId?)` — navigate to editor with optional unique doc ID, wait for `.tiptap` visible. If no `docId`, generates `test-${uuid}`.
- `waitForSync()` — wait for Yjs sync (skeleton disappears)
- `typeText(text, options?)` — `page.keyboard.type()` with optional delay
- `pressKey(key)` — `page.keyboard.press()`
- `getEditorJSON()` — evaluate `window.__tiptap_editor?.getJSON()`
- `getHeadingByTocId(id)` — locate `[data-toc-id="${id}"]`
- `clickFoldChevron(tocId)` — click the fold chevron for a heading
- `isSectionFolded(tocId)` — check for `heading-section-folded` class
- `getCrinkleElement(tocId)` — locate `.heading-fold-crinkle` after heading
- `dragHeading(fromTocId, toTocId)` — simulate drag via mouse events
- `openFilter()` — press CMD+SHIFT+F
- `typeFilter(query)` — type in filter input
- `commitFilter()` — press Enter in filter
- `clearFilter()` — click clear button
- `getTocItems()` — list all TOC sidebar items with text and active state
- `clickTocItem(text)` — click a TOC sidebar item
- `buildDocument(headings)` — type heading structure via keyboard shortcuts (for small/medium docs)
- `setContent(json)` — inject content via `window.__tiptap_editor.commands.setContent()` (for large docs, performance tests)

**Editor exposure for testing:** Add to `components/document-editor/use-document-editor-effects.ts` (dev only). `process.env.NODE_ENV` is inlined by Next.js at build time, so this code is dead-code-eliminated in production builds:

```typescript
useEffect(() => {
  if (process.env.NODE_ENV !== "production" && editor) {
    (window as any).__tiptap_editor = editor;
  }
}, [editor]);
```

#### Task 4.2: `tests/e2e/helpers/perf-observer.ts`

PerformanceObserver injection (must run via `addInitScript` before page loads):

- Inject `PerformanceObserver` listening for `"event"` entries with `durationThreshold: 16`
- Collect keystroke events (keydown/keypress) with `startTime`, `processingStart`, `processingEnd`, `duration`
- Export `injectPerfObserver(page)` and `collectPerfEntries(page)`
- Calculate: input delay, processing time, presentation delay, total latency

#### Task 4.3: `tests/e2e/fold.spec.ts`

- Click fold chevron on H2 section → section content hidden, crinkle visible
- Click crinkle → section unfolds, content visible
- Fold parent H1 → nested H2/H3 sections hidden
- Unfold parent → nested sections restored to their previous fold state
- Fold all body sections → all content hidden, crinkles visible
- Fold section with mixed content (lists, images, blockquotes) → all hidden
- Arrow key navigation → skips folded content
- Keyboard shortcut (if applicable) → toggles fold

#### Task 4.4: `tests/e2e/drag.spec.ts`

- Hover heading → drag handle appears
- Drag H1 section down → section moves, drop indicator visible, content follows
- Drag H2 section within parent H1 → reorder works
- Drag to same position → no change (no-op)
- Drag first body section (after title) → works correctly
- Drag last section → works correctly
- Verify fold state preserved after drag

#### Task 4.5: `tests/e2e/filter.spec.ts`

- CMD+SHIFT+F → filter panel opens
- Type query → matching headings highlighted (inline decoration)
- Match count updates as typing progresses
- Press Enter → non-matching sections fold, matching sections + ancestors + descendants visible
- Clear filter → all sections unfold
- OR mode with two queries → union of matches
- AND mode → intersection
- Filter with query matching zero sections → all sections fold (or message shown)
- Filter with empty/whitespace query → no effect
- Load page with `?filter=foo&mode=or` in URL → filter applied on mount
- Switch document tab → filter dismissed, URL params cleared

#### Task 4.6: `tests/e2e/toc-sidebar.spec.ts`

- TOC shows all headings with correct hierarchy
- Click TOC item → editor scrolls to heading
- Active heading tracks scroll position
- Fold section → TOC hides folded children
- Unfold → TOC restores children
- Filter preview → TOC highlights matching items via `previewMatchIds`
- Filter committed → TOC dims non-matching items
- H1 items have visual separator styling
- Heading level typography hierarchy visible (H1 bolder than H2 than H3)

#### Task 4.7: `tests/e2e/collaboration.spec.ts`

2-3 Playwright browser contexts on the same document:

- User A types text → User B sees it appear
- User A folds section → both editors show fold
- User A and User B type simultaneously → both edits merge correctly
- Verify `getJSON()` is identical across all contexts after settling
- User A adds heading → User B's TOC updates

#### Task 4.8: `tests/e2e/performance.spec.ts`

Establish baselines (no hard thresholds initially):

- Create document with 10 headings → type 100 characters → record p50/p95 latency
- Create document with 50 headings → same measurement
- Create document with 100 headings → same measurement
- Create document with 500 headings → same measurement
- Report keystroke-to-paint latency breakdown: input delay, processing time, presentation delay
- Record JS heap size before and after typing sessions
- Output baselines to stdout/JSON for future threshold setting

---

### Phase 5: Custom Yjs Load Harness

#### Task 5.1: `tests/load/yjs-load-harness.ts`

Standalone Bun script (not a Vitest test). Invoked via `bun tests/load/yjs-load-harness.ts`.

**CLI interface:**

```
Usage: bun tests/load/yjs-load-harness.ts [options]

Options:
  --clients <n>       Number of concurrent clients (default: 100)
  --duration <ms>     Test duration in milliseconds (default: 30000)
  --rate <ops/s>      Operations per second per client (default: 2)
  --scenario <name>   "distributed" or "conflict" (default: distributed)
  --url <ws-url>      Hocuspocus WebSocket URL (default: ws://127.0.0.1:1234)
  --doc <name>        Document name (default: load-test-{timestamp})
```

**Implementation outline (~250-350 lines):**

1. **Setup:** Parse CLI args. Create N `Y.Doc` + `HocuspocusProvider` instances, each with its own WebSocket connection (do NOT share `HocuspocusProviderWebsocket` — multiplexing race condition in v3).
2. **Wait for sync:** All clients report `onSynced` before starting edits.
3. **Seed document:** First client creates the initial document structure (title H1 + 10 sections with H2 headings and paragraph content).
4. **Run edits:** For `duration` ms, each client performs random operations at `rate` ops/s:
   - **Distributed scenario:** Each client is assigned a section range (round-robin). Operations: insert text in own section, add paragraph, modify heading text.
   - **Conflict scenario:** All clients target the same paragraph (first non-title paragraph, position derived from doc structure). Operations: insert text at random offset within paragraph, delete small ranges, replace words.
5. **Settle:** After duration, stop edits. Wait 5 seconds for sync.
6. **Verify convergence:** Encode each `Y.Doc` state via `Y.encodeStateAsUpdate(doc)` and compare byte-level equality across all clients. Alternatively, serialize via the Yjs XML fragment used by `@tiptap/extension-collaboration` (verify the fragment name during implementation — likely `'default'` or configured by the provider) and deep-compare JSON. Report pass/fail.
7. **Report metrics:**
   - Total edits performed
   - Convergence: pass/fail + time to converge
   - Memory: `process.memoryUsage()` before and after
   - Throughput: edits/second achieved
   - Document size: final byte size of encoded state

**Output format (stdout):**

```
=== Yjs Load Test Report ===
Scenario:     distributed
Clients:      100
Duration:     30s
Rate:         2 ops/s/client
---
Total edits:  6,000
Convergence:  PASS (settled in 2.3s)
Memory delta: +42 MB (RSS)
Throughput:   198 ops/s
Doc size:     1.2 MB (encoded state)
```

---

## Test Fixture Documents

Create these as JSON files in `tests/fixtures/`:

| Fixture | Structure | Purpose |
|---------|-----------|---------|
| `empty-document.json` | H1 title only, no text | Minimal valid document |
| `title-only.json` | H1 "My Document" with text | Title with content, no sections |
| `deeply-nested.json` | H1 > H2 > H3 > H4 > H5 > H6, each with paragraph content | Maximum nesting depth |
| `wide-document.json` | 50 H1 sections, each with 2-3 paragraphs | Wide/flat structure |
| `mixed-content.json` | Headings + bullet lists + blockquotes + code blocks + images + horizontal rules | All node types |
| `real-world-complex.json` | 5 H1 chapters, each with 3-5 H2 sections, some with H3 subsections, varied content | Realistic document structure |

---

## Acceptance Criteria

### Functional Requirements

- [ ] `bun test` runs all Vitest unit tests and passes
- [ ] `bun test:fuzz` runs 5,000+ randomized operations without crashes or invariant violations
- [ ] `bun test:e2e` runs all Playwright specs against running dev server and passes
- [ ] `bun test:load` runs 100-client concurrency test and reports convergence PASS
- [ ] All fixture documents load correctly and pass invariant checks

### Non-Functional Requirements

- [ ] Vitest unit tests complete in <5 seconds (excluding fuzz suite)
- [ ] Fuzz suite completes in <60 seconds
- [ ] Playwright specs complete in <3 minutes
- [ ] Load harness completes in <60 seconds (30s test + 30s settle/report)

### Quality Gates

- [ ] Zero linter errors in test files (Biome)
- [ ] TypeScript strict mode — no `any` casts in test helpers
- [ ] Test helpers are reusable across layers (builders, invariant checkers)

---

## Dependencies & Prerequisites

- **Runtime:** Bun 1.3.10+ (already pinned)
- **Dev server:** `make dev` must be running for Playwright and load tests
- **Playwright browsers:** Chromium installed via `bunx playwright install chromium`
- **No new production dependencies** — all packages are dev-only

---

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `@tiptap/pm` module resolution fails in Vitest | Medium | High | Add resolve aliases in `vitest.config.ts`; test early |
| Tiptap `Editor` with `element: null` fails for some extensions | Medium | Medium | Exclude DOM-dependent extensions (HeadingDrag view) from headless tests |
| Hocuspocus WebSocket multiplexing race condition | Known | High | Each load test client gets its own WebSocket connection |
| Fuzz tests find real bugs | Likely | Positive | Fix them — this is the point |
| ProseMirror re-renders cause Playwright element detachment | Medium | Medium | Always re-query selectors; use CSS pseudo-selectors not `.first()` |
| 100 concurrent WebSocket connections overwhelm dev Hocuspocus | Low | Medium | Start with 20 clients, scale up; monitor Hocuspocus memory |

---

## References & Research

### Internal References

- Brainstorm: `docs/brainstorms/8-e2e-testing-strategy-brainstorm.md`
- Document model: `components/tiptap-node/document-node/document-node-extension.ts`
- Editor setup: `components/document-editor/document-editor.tsx` and `components/document-editor/document-editor-config.ts`
- Fold plugin: `components/tiptap-node/heading-node/heading-fold-plugin.ts`
- Filter plugin: `components/tiptap-node/heading-node/heading-filter-plugin.ts`
- Headless-safe helpers: `compute-section.ts`, `can-map-decorations.ts`, `match-section.ts`, `fold-storage.ts`, `filter-url.ts`

### External References

- Vitest docs: <https://vitest.dev>
- Playwright docs: <https://playwright.dev>
- `prosemirror-test-builder`: <https://github.com/ProseMirror/prosemirror-test-builder>
- Yjs testing utilities: `yjs/testHelper` (built into yjs package)
- ProseMirror performance comparison (Playwright stress test reference): <https://github.com/emergence-engineering/prosemirror-vs-lexical-performance-comparison>
- Hocuspocus WebSocket multiplexing issue: <https://github.com/ueberdosis/hocuspocus/issues/964>
- Tiptap Vitest RFC (closed, useful context): <https://github.com/ueberdosis/tiptap/pull/6089>
