# Testing Infrastructure

TinyDocy uses a multi-layer testing strategy covering schema correctness, feature behavior, performance, long-running stability, and real-time collaboration at scale.

**Recent additions:** Configurable performance tests — `make test-perf` (single-user typing latency, `PERF_HEADINGS`, `PERF_SHAPE`) and `make test-perf-collab` (multi-user concurrent typing on a shared document, `PERF_COLLAB_USERS`, `PERF_COLLAB_HEADINGS`, `PERF_COLLAB_SHAPE`). See Performance Tests and Multi-User Performance Tests sections below. All test layers write reports to `test-reports/` when run via Make targets. Collaboration tests use `retries: 2` and extended waits to reduce flakiness.

**Prerequisites:** Dev servers must be running for Playwright tests.

```bash
make dev
```

## Quick Reference

| Command | What it runs | Duration |
|---------|-------------|----------|
| `make test` | Unit, fuzz, schema and plugin tests (`bun test`) | ~8s |
| `make test-fuzz` | Chaos and structured fuzz tests | ~1s |
| `make test-stress` | Headless stress probe (binary search for heading ceiling) | ~30s |
| `make test-e2e` | Playwright `chromium` E2E suite (features, collaboration), then the `perf` project (typing budget) | ~90s |
| `make test-perf` | Typing latency tests only, `perf` project without its `chromium` dependency (default 10, 50 headings; `PERF_HEADINGS=200` for custom) | ~4 min |
| `make test-perf-collab` | Multi-user typing latency on shared doc (default 2 users, 50 headings) | ~30s |
| `make test-load` | Yjs load harness (100 headless clients, convergence) | ~40s |
| `make test-soak-quick` | Single-user soak (5 min, 50 headings, rich content) | ~6 min |
| `make test-soak-collab-quick` | Multi-user soak (30s, 3 users, 10 headings) | ~50s |
| `make test-soak` | Full soak suite (single + multi-user, 30 min) | ~35 min |
| `make test-yjs-soak` | Yjs reconnection + rapid tab switch | ~20s |
| `bun run test:soak:color` | Alternating colour soak (3,000 toggles; nightly 50,000) against a running Hocuspocus | ~8s (50k: ~1 min) |
| `bun run test:soak:mixed-version` | Mixed-version soak (N+1, N and pre-N clients on one document) against a running Hocuspocus | ~7s (300 rounds: ~20s) |

## Test Architecture

```
tests/
├── setup.ts                              # `bun test` preload (happy-dom window, Bun-native fetch/timers)
├── helpers/
│   ├── create-test-editor.ts             # Headless Tiptap Editor factory
│   ├── document-builders.ts              # ProseMirror node builders (via prosemirror-test-builder)
│   ├── document-generators.ts            # Random and large document generators
│   ├── env-parsers.ts                    # Generic parseEnvNumber (?? semantics)
│   ├── perf-config.ts                    # PERF_* env parsing (parsePerfShape, parsePerfHeadings)
│   ├── report-writer.ts                 # writeReport(filename, data) → test-reports/
│   ├── import-fresh.ts                   # importFresh(): re-import a module after changing env
│   ├── soak-config.ts                    # SOAK_* env parsing (parseSoakDuration, parseSoakHeadings, etc.)
│   ├── assert-invariants.ts              # Schema invariant assertions (`bun:test`)
│   └── assert-invariants-json.ts         # Schema invariant assertions (Playwright-safe, no `bun:test` dep)
├── fixtures/                             # Static JSON document fixtures
│   └── clipboard/                        # SYNTHETIC Google Docs / Word clipboard HTML (not real captures; see below)
├── unit/
│   ├── schema/                           # TitleDocument enforcement, paste handling, schema invariants, trailing node
│   ├── plugins/                          # HeadingScale, HeadingFold, HeadingDrag, HeadingFilter state
│   ├── helpers/                          # canMapDecorations, computeSection, fold-storage, filter-url, move-section, tab-api, media-embed URL gate
│   ├── hooks/                            # useSyncedTabs bootstrap + active-tab resolution (mocked Hocuspocus provider)
│   ├── lib/                              # Security guardrails, legacy Yjs mark migration (link/code → hyperlink/inlineCode)
│   ├── extensions/                       # Render-once, CaretBlockVisible, fast TOC, incremental code highlighting, media controls kept across plugin view rebuilds
│   ├── ci/                               # Workflow rules: read-only tokens, no persisted credentials, SHA-pinned actions
│   ├── fuzz/                             # Chaos fuzz (5000 ops) + structured schema fuzz (5000 ops)
│   └── stress/                           # Headless stress probe (binary search for heading ceiling)
├── e2e/
│   ├── helpers/
│   │   ├── editor-page.ts                # Playwright Page Object Model for the editor
│   │   ├── playwright-modifier-key.ts    # Meta vs Control for keyboard shortcuts
│   │   ├── perf-observer.ts              # PerformanceObserver injection + latency stats
│   │   ├── soak-bot.ts                   # Weighted-random action generator (10 action types)
│   │   └── soak-journeys.ts              # 2 scripted critical-path sequences
│   ├── collaboration.spec.ts             # 2-user collaboration (join + real-time sync)
│   ├── drag.spec.ts                      # Heading drag handle visibility
│   ├── extensions.spec.ts                # docs.plus extensions: link popovers, inline code, indent, Mermaid, media embeds, image resize gripper
│   ├── filter.spec.ts                    # Heading filter open + query + highlight
│   ├── fold.spec.ts                      # Fold chevron + crinkle unfold
│   ├── performance.spec.ts               # Keystroke-to-paint latency (10 + 50 headings)
│   ├── toolbar-perf.spec.ts              # Toolbar catch-up render and arrow p95 on 500 headings (perf project)
│   ├── performance-collab.spec.ts        # Multi-user typing latency on shared doc
│   ├── pwa-connection.spec.ts            # Offline edits, connection status, offline banner/shell
│   ├── offline-copies.spec.ts            # IndexedDB copies: repeat visit, reload, deletion, clearing
│   ├── continue-chip.spec.ts             # "Continue where you left off" chip (reopen, Go, dismissal, phone, leaks, axe)
│   ├── toc-sidebar.spec.ts               # TOC rendering + scroll-to-heading
│   ├── toc-drag.spec.ts                  # TOC drag-and-drop reorder + level change
│   ├── tabs.spec.ts                      # Tab bar: regenerate, new tab, close-all
│   ├── security-headers.spec.ts          # Hardening headers + CSP media-embed host allowlist
│   ├── soak.spec.ts                      # Single-user soak (journeys + bot + memory tracking)
│   ├── soak-collab.spec.ts               # N-user collaboration soak (dynamic, configurable)
│   └── yjs-soak/
│       ├── reconnection.spec.ts          # Kill/restart Hocuspocus mid-session
│       └── rapid-tab-switch.spec.ts      # Mount/unmount Yjs providers via tab switching
└── load/
    ├── yjs-load-harness.ts               # Standalone Bun script: N-client Yjs convergence test
    ├── color-mark-soak.ts                # Standalone: alternating textColor/highlight/fontSize toggles
    ├── mixed-version-soak.ts             # Standalone: N+1, N and pre-N clients on one document
    ├── soak-shared.ts                    # Clients, convergence, verifier, schema check, server log scan
    └── soak-dom.ts                       # happy-dom window for scripts that run Tiptap (keeps Bun's WebSocket)
```

## Test Reports (`test-reports/`)

All test layers write reports when run via Make targets:

| Report file | Source | Contents |
|-------------|--------|----------|
| `unit-report.xml` | `make test` | JUnit XML from `bun test` (suites, tests, durations) |
| `fuzz-report.xml` | `make test-fuzz` | JUnit XML |
| `stress-report.xml` | `make test-stress` | JUnit XML |
| `e2e-report.json` | `make test-e2e` | Playwright JSON (tests, outcomes) |
| `perf-report-{ts}.json` | `make test-perf` | Latency stats per heading count |
| `perf-collab-report-{ts}.json` | `make test-perf-collab` | Multi-user latency stats |
| `load-report-{ts}.json` | `make test-load` | Clients, edits, throughput, convergence |
| `soak-report-{ts}.json` | `make test-soak-quick` | Journeys, memory, latency, verdict |
| `soak-collab-report-{ts}.json` | `make test-soak-collab-quick` | Users, actions, errors |
| `*-playwright-report.json` | soak targets | Playwright JSON for soak runs |
| `yjs-soak-report.json` | `make test-yjs-soak` | Playwright JSON for yjs-soak |
| `color-soak-report-{ts}.json` | `bun run test:soak:color` | Toggles, size samples, final and stored state size, growth per toggle, refusals, verdict |
| `mixed-version-soak-report-{ts}.json` | `bun run test:soak:mixed-version` | Per-client outcome, N freeze and updates sent, blocks, surviving marks, verdict |

## Layer 1: Unit Tests (`bun test`)

Fast, headless tests that validate the document model, ProseMirror plugin state, and utility functions without a browser. `bunfig.toml` `[test]` limits `bun test` to `tests/unit` and preloads `tests/setup.ts` (a happy-dom window).

All files share one process, so tests must not leave state behind:

- **Module mocks** — spread the real module into `mock.module()` and replace only what the test needs (other files import the same module), then load the module under test with `await import()` (static imports are hoisted above the mock).
- **Import-time state or env** — load the module with `importFresh()` (`tests/helpers/import-fresh.ts`) after setting `process.env`, and call `resetModules()` in `afterEach`.

```bash
make test          # all unit tests
make test-fuzz     # fuzz tests only
make test-stress   # stress probe only
```

### Schema Tests

Verify the `heading block*` schema (TitleDocument extension) — first node is always H1, heading levels 1-6, paste handling preserves invariants, the trailing node appended after a non-paragraph last block is a paragraph (never a heading). 10 random documents are generated and validated each run.

### Plugin Tests

Assert internal state of HeadingScale, HeadingFold, HeadingFilter, and HeadingDrag after dispatching specific transactions. Validates decoration rebuilds, fold toggling, filter matching, `canMapDecorations` fast-path behavior, and `moveSection` atomicity (reorder, level change, combined, undo).

### Fuzz Tests

- **Chaos fuzz:** 5000 random malformed operations (invalid positions, null content, out-of-range levels) — verifies the editor never crashes
- **Schema fuzz:** 5000 random valid operations (insert heading, delete, split, join) — verifies invariants hold after each

### Stress Probe

Binary search for the heading count ceiling where ProseMirror transaction time exceeds 16ms (one frame budget). Tests 5 transaction types (text insert, heading insert/delete, fold toggle, filter apply) on flat and deep document shapes. Reports the ceiling — expected minimum 200 headings.

## Layer 2: E2E Tests (Playwright)

Browser-based feature verification using Chromium. Tests interact with the real editor via the `EditorPage` page object model.

```bash
make test-e2e
```

### Feature Tests

| Test | Validates |
|------|-----------|
| `drag.spec.ts` | Hovering a heading shows the drag handle |
| `extensions.spec.ts` | Link preview + `Mod-K` create; backtick inline code; Tab indent; Mermaid renders; media embeds stack and unsafe URLs are rejected; the image resize gripper covers the hovered image and resizes it, and it and a running drag survive a plugin being registered and removed (each recreates every plugin view, as the lazy selection bubble's `BubbleMenu` does when its chunk lands) |
| `filter.spec.ts` | CMD+SHIFT+F opens filter; typing highlights matches; a `?filter=alpha` link opens the bar with the chip once the doc syncs, folds the unmatched sections, keeps the URL, and Clear all filters removes it |
| `fold.spec.ts` | Fold chevron hides content; crinkle click unfolds |
| `pwa-connection.spec.ts` | Text typed offline survives a tab switch and syncs to a second browser after reconnecting; reload asks only while edits are unsynced; status strip goes online / reconnecting / offline with one announcement per transition; offline banner and disabled tab create/close; calm notice instead of the red alert before the editor opens offline. Simulates offline with `context.setOffline()` plus `page.routeWebSocket()` (setOffline alone does not close an open WebSocket) |
| `offline-copies.spec.ts` | A repeat visit opens the document from the device while the collab server is unreachable; edits made while disconnected survive a reload and sync to a second browser; a document deleted while away disappears from the tab bar and its copy is removed; closing a tab removes its copy and "Delete offline copies" on `/privacy` clears the rest. Inspects IndexedDB without creating it. Needs `next dev` and hocus on one `DB_PATH` |
| `toolbar.spec.ts` | Toolbar behaviour: menus named by value with radio items, indent and outdent in lists, disabled reasons, focus kept when controls hide, headings and caret clear of the sticky toolbar, catch-up within the commit budget |
| `toolbar-row.spec.ts` | Smart toolbar row (PR D1): row order in every context, one Tab stop, Alt+F10 and Esc with the selection, context slot per kind, remote heading deletion while a slot control has focus, clear formatting keeps links, read-only keeps every control and focus, the align items in Align ▾ and T3 ¶ (icon, label, check slot before the shortcut, shortcuts ending at Outdent's and Indent's edge, Ctrl+Shift+E on one line off macOS) and Mod+Shift+L/E/R/J aligning without the browser taking them, light and dark screenshots into `.superpowers/screens-D1/` |
| `toolbar-perf.spec.ts` | Toolbar timing budgets on a 500-heading doc, in the `perf` project (one worker): catch-up render per burst (`window.__toolbarRenderMs`, dev only; report in `test-reports/toolbar-catch-up-*.json`) and arrow / Shift+Arrow p95 with the toolbar on vs off (`toolbar-arrow-p95-*.json`). Both arms open the same generated document in fresh 1280×4000 contexts (tall enough that the 60-key walk never scrolls, which the test checks: a scroll frame lays out the blocks it reveals, costs several times a normal key, and at 720 px about 5% of keys were such frames, right at the p95 rank), run one discarded warm-up round each, then 3 interleaved rounds (on/off, off/on, on/off) from the same start after the main thread is idle; each press is one sample (the modifier's own keydown is skipped) and waits for the previous one to paint, and p95 is taken over all of an arm's measured presses. `TOOLBAR_PERF_CPU_THROTTLE=4` throttles both arms to mimic a slow runner; the 50 ms ceilings are absolute, so a throttled run is informational |
| `toolbar-a11y.spec.ts` | Focus outline and pressed bar contrast in light, dark and forced colours; highlight dialog and mobile panel keyboard behaviour; axe sweep (WCAG 2.2 AA, no serious or critical violations) of the toolbar in paragraph, title, heading, list, code block, table and read-only contexts and with the style menu, list menu and highlight dialog open, in both themes; the simplified row and its ⋯ menu in both themes; in forced colours the hovered colour swatch wears the Highlight ring and focus elsewhere drops to a dashed one |
| `toolbar-density.spec.ts` | Simplified toolbar (contract A15): at 1440px the row shows the T4 set (every stand-in, the never-collapse set, Underline and Strike, Theme in ⋯); below the T4 width it shows exactly what the ladder shows; ⋯ → Simplified toolbar collapses the row with focus back on ⋯ (mouse and Enter); the setting survives reload and Forget my choices; no flash on load (the first committed row is already simplified); the palette lists and toggles it; a Tab stop on Align left moves to the ¶ stand-in; one Tab stop on touch. The kill-switch case runs only with `E2E_REMEMBER_OFF=1` against a Next built with `NEXT_PUBLIC_REMEMBER_CHOICES=0` (port 6241 in the plan). `toolbar-ladder.spec.ts` sweeps the simplified row too (fit and one Tab stop, four contexts, mouse and touch) |
| `mobile-bar-followups.spec.ts` | Phone bar follow-ups, as a touch phone: the context slot cell in heading, code and table contexts at 412, 390, 375, 360 and 320px (cells fit, 44×44, named; Redo yields to the cell below 404px, the sheet carries the cell's tools below 360px, the language as a select); its menus move a section and pick a language, Esc returns to the cell and a remote table delete with the menu open never drops focus to the page; safe areas stood in through `--safe-area-*` (bar, sheet and tab strip clear a 47px notch and a 34px home indicator, the bar drops the inset over the keyboard, desktop unchanged); swipe down on the sheet header (CDP touch: short drags snap back, long ones close and return focus to Aa, reduced motion is instant; Done, Esc and the backdrop still close); List re-taps keep the list. 360px light and dark screenshots into `PHONE_SCREENS_DIR` (default `.superpowers/screens-followups-phone/`) |
| `lazy-surfaces.spec.ts` | A colour popover, Insert step, bubble, palette or E engine chunk that 404s leaves the editor and tab strip mounted and typing working, with no uncaught page error; a popup names what did not load with Retry, which fetches the chunk again in place; the palette says "Couldn’t open actions…" on the status pill with Retry, which opens it; a brush click, the Repeat key or a palette row whose engine chunk 404s says "Couldn’t load formatting tools." on the pill, with Retry; the next colour, Insert or palette open fetches the chunk again (without the engine the palette opens; E's rows never say they are loading); a menu chunk that 404s leaves the menu closed and says "Couldn’t open the menu." on the pill, with Retry, which opens it, and the next open loads it; with the menu chunk held, Enter, ArrowDown, ArrowDown on Text style stay on the trigger and land on Heading 2 once it arrives, while Esc (focus stays on the trigger) or a click in the text cancels the open; a "/" menu chunk that 404s shows no menu and no hint, Enter stays a newline, and the next "/" loads it |
| `editor-leak.spec.ts` | 20 tab switches return to the baseline count of live `Editor` instances and heap (within 10%), against a baseline taken after 12 warm-up switches; each measurement repeats GC and reads until two readings agree (same editor count, heap within 1%); 100 bubble and colour popover open/close cycles return the `document` and `window` listener counts (per event type, CDP `DOMDebugger.getEventListeners`) to the baseline |
| `slash-menu.spec.ts` | The "/" block menu: opens under the caret, filters (`h2`, `quo`), Enter or a click applies the block as one undo step (Ctrl/⌘+Z restores "/h2"), Esc leaves "/query" as text; focus stays in the editor and the editor carries `aria-controls`, `aria-autocomplete`, `aria-haspopup` and `aria-activedescendant` only while open (never `aria-expanded`, not allowed on a textbox); ↑ wraps; "and/or", URLs, headings and the title never open it; in a list item and a quote it takes Enter first; "/" then Enter is a line break until a query or an arrow; each section heading shows once ("/b", "/c", with axe); a hidden match says why ("Quote: Already in a quote.") and a finished word with no match closes it; a pick refused since the menu opened (the line wrapped in a quote while "/quo" is listed) says why on the status pill and leaves "/quo" as typed; "No matching blocks" and Enter as a newline; a bare "/" has no active row until an arrow; the polite live region ("Block menu, 18 options.", then "Normal text, 1 of 18", "Heading 1, 2 of 18", "Table, 3 by 3, …"); Enter before the chunk lands is a newline; read-only closes it; near the bottom it flips above the caret; a collaborator deleting the "/" closes it; axe light and dark open, filtered and empty (`scrollable-region-focusable` off for the list only: axe exempts a listbox controlled by a `combobox`, and this one is controlled by the editor's `textbox`); forced colours; touch: `pointer: coarse`, 44 px rows, above the bar and a stand-in keyboard, a tap applies. `SLASH_SCREENS_DIR=<dir>` saves the design-review screenshots (open, filtered, empty, near the bottom edge, "/ta", "/dia", the list's end, "/b" and the refused pick's pill, at 1440 and 375, light and dark). With `SLASH_BUDGET=1` against a production build it instead measures the menu's chunk group (gzip, budget 6 KB) |
| `palette.spec.ts` | Alt+/ action palette (v1.1): loads lazily, opens on Alt+/ and Alt+Shift+Z, Esc restores focus and selection, other text fields keep Alt+/; listbox semantics (every option has `role="option"` and `aria-selected`, `aria-activedescendant` follows the highlight, the search field keeps focus while arrowing); shortcut glyphs `aria-hidden` with `aria-keyshortcuts` on the option; typing highlights the best match and a status region announces the result count; forced colours keep a border; axe in both themes; Repeat formatting sets marks, is one undo step and runs from Mod+Alt+V (F4 off macOS) and the palette; Paint format then Repeat; unavailable entries keep their reason; Save selection as format and Apply format (kept across reloads); diagram templates; design pass §7–§8: the Save view's preview, disabled Save, "Replaces" note and 20-format cap, and the rows' icon and chip slot, bare colour names, reason line (48 px, label at full contrast, no shortcut) and Suggested shown once; a save announced once, as a confirmation; the cap's "Remove a format" link opening the style dropdown at Remove a format; Your formats rows with the format as a chip. With `PALETTE_BUDGET=1` against a production build it instead measures the scripts the first Alt+/ loads (gzip, budget 20 KB, contract A7; nightly runs it on the `pwa` job's production build) |
| `action-preview.spec.ts` | Colour hover preview: resting on a swatch shows it on the selection (computed colour) and leaving restores it with the document unchanged; a keyboard open previews nothing, arrows preview, Esc clears and returns focus; applying replaces the preview with the real mark in one undo step; red over blue and "No highlight" over yellow show the previewed result; the bubble stays open while previewing from its popover; 0 toolbar commits across previews; read-only previews nothing; the previewed swatch wears the focus ring and focus on another swatch drops to a dashed 1px ring until an arrow takes it back (light, dark); as a touch device (`pointer: coarse` first) nothing previews, a tap marks no swatch and still applies |
| `paint-format.spec.ts` | Design pass (§1–5) on desktop: the bubble's Paint format brush by mouse (drag applies as one undo step, copy cursor while armed), by keyboard (Alt+F10, Esc back to the text, Shift+arrows, Mod+Alt+V; or the brush again), ⋯ → Paint format, Esc and a second click cancel; Repeat with nothing remembered and after use (the status pill 8px under the row, centred on the page); Your formats in the text style dropdown (previews, apply, Save selection as format… with its visible reason when disabled, its label dimmed and the reason not in its name, Remove a format with Undo); at 1440px with the bubble over the first body line, the pill moves clear of it and the brush again cancels, and a pill already shown moves clear when the bubble appears over it and back once it goes; Esc on the toolbar keeps the pill while armed, Esc in the text cancels and closes it; after a removal and the pill, Alt+/ offers "Restore ‘X’" first under Suggested here, Enter puts it back in place, and it is gone from the next open |
| `palette-leaks.spec.ts` | One capture `keydown` listener (`onPaletteKey`) on `window` across 20 tab switches; 100 palette cycles leave window/document listeners, live editors and heap (within 5%) where they were (CDP) |
| `continue-chip.spec.ts` | "Continue where you left off" (spec M15): after reopening, the chip offers the section left, is never focused and sits before the text in Tab order; Go puts the caret at the end of the heading and lands it within 24 px under the toolbar, inside a folded section too and after a collaborator inserted sections and moved it; no layout shift on Dismiss; Esc and keyboard Dismiss focus the text without moving its selection, a click in the text dismisses; no chip near the top, in Playground or before the server sync (collab socket closed); a chunk that 404s leaves the editor working; axe in both themes and a forced-colours border; at 375 px touch: inside the viewport above the presence chip, 44 px targets, "Continue · *Section*", a touch scroll keeps it and a tap on ✕ does not focus the text; listeners back to baseline after 20 tab switches. The kill-switch case needs a `next dev` started with `NEXT_PUBLIC_REMEMBER_CHOICES=0` and `E2E_REMEMBER_OFF=1` (a second `next dev` cannot share the worktree's dev directory, so swap the server) |
| `toc-sidebar.spec.ts` | TOC lists all headings; clicking scrolls to heading |
| `toc-drag.spec.ts` | TOC drag handle visibility; title H1 not draggable; drag reorder moves editor sections; folded section drag handle |

### Performance Tests

Measure keystroke-to-paint latency using the Event Timing API via `PerformanceObserver`. Reports p50/p95/mean/max. Config is via env vars; the Makefile serves as the CLI interface (e.g. `make test-perf PERF_HEADINGS=200`).

```bash
make test-perf                                    # default: 10, 50 headings, flat shape
make test-perf PERF_HEADINGS=200                  # single size
make test-perf PERF_HEADINGS=10,50,200           # multiple sizes
make test-perf PERF_SHAPE=mixed                   # random heading hierarchy (H2–H6)
make test-perf PERF_SHAPE=deep PERF_HEADINGS=50   # deep shape + 50 headings
```

| Variable | Default | Description |
|----------|---------|-------------|
| `PERF_HEADINGS` | `10,50` | Comma-separated heading counts to test |
| `PERF_SHAPE` | `flat` | Document hierarchy: `flat` (all H2), `deep` (cycling H2–H6), `mixed` (random H2–H6) |
| `PERF_ROUNDS` | `7` | A/B rounds per heading count (toolbar off vs on, alternating order); the median p95 of each arm is compared |
| `PERF_CPU_THROTTLE` | `4` | CDP `Emulation.setCPUThrottlingRate` applied before typing |
| `PERF_MAX_REGRESSION` | `0.10` | Allowed toolbar-on p95 overhead versus toolbar off in the same run |
| `TOOLBAR_PERF_CPU_THROTTLE` | `1` | CDP CPU throttle for both arms of the arrow p95 in `toolbar-perf.spec.ts` (local reproduction of a slow runner; informational, the ceilings are absolute) |

`performance.spec.ts` asserts the typing budget: p95 with the toolbar mounted must stay within `PERF_MAX_REGRESSION` of the same run with the toolbar off (`window.__TOOLBAR_OFF`, dev only). Each keystroke's synchronous handling is timed from its keydown `timeStamp` to a microtask queued by a bubble-phase `input` listener on `window`, after ProseMirror, Yjs and the toolbar's transaction listener have run; deferred renders are gated by the toolbar commit budget instead. Event Timing has a 16 ms floor, `requestAnimationFrame` quantizes to ~16.7 ms, and a task such as a `MessageChannel` message is starved under CPU throttle until typing stops, so none of them can time a keystroke. Every trial of a heading count types into the same generated document (the generator is random, and trials in different documents differed more than the two arms did). Each arm waits for its own end state (toolbar mounted, or gone), then after the click that focuses the editor waits until the main thread is idle (two `requestIdleCallback` periods of at least 40 ms in a row), so both arms start from a quiet page. There is no forced GC before typing: it put the next major GC near the same keystroke in every trial, a cluster of slow keys right at the p95 rank. One discarded warm-up trial per arm runs before the measured rounds. It types 220 keystrokes and drops the first 20 (warm-up) before taking p95 over 200, so first-use JIT and layout cost do not land in one arm; the guard still requires exactly 220 recorded keystrokes. Nightly or manual runs can pass `PERF_HEADINGS=50,500`.

The spec, and `toolbar-perf.spec.ts`, run in their own Playwright project, `perf` (one worker, `dependencies: ["chromium"]`), and the `chromium` project ignores them. Selecting both (`--project=chromium --project=perf`, as CI and `make test-e2e` do) times typing only after the parallel suite has finished, so other workers never compete for the CPU. Run it alone with `bun playwright test --project=perf --no-deps` (`make test-perf`).

### Multi-User Performance Tests (`performance-collab.spec.ts`)

Measures keystroke-to-paint latency when **multiple users type concurrently** in the same document. Each user types in a different paragraph to avoid conflicts. Reports per-user p50/p95 and aggregate stats.

```bash
make test-perf-collab                              # default: 2 users, 50 headings
make test-perf-collab PERF_COLLAB_USERS=3          # 3 concurrent users
make test-perf-collab PERF_COLLAB_HEADINGS=100      # larger document
make test-perf-collab PERF_COLLAB_SHAPE=mixed       # random heading hierarchy
```

| Variable | Default | Description |
|----------|---------|-------------|
| `PERF_COLLAB_USERS` | `2` | Number of concurrent users typing |
| `PERF_COLLAB_HEADINGS` | `50` | Document heading count |
| `PERF_COLLAB_SHAPE` | `flat` | Document hierarchy: `flat`, `deep`, `mixed` |

### Collaboration Tests

Two tests with distinct strategies:

1. **"user B sees content created by user A"** — User A types first, waits 4s for Hocuspocus persistence, then User B joins. Uses precondition `expect(.tiptap).not.toHaveText("")` before main assertion. May be flaky; `retries: 2`.
2. **"real-time sync between two connected users"** — Both users connected simultaneously. User A types; 2s wait before asserting on User B. Inherently timing-sensitive; `retries: 2`.

Each user gets a unique identity via `window.__HOCUS_TOKEN` injected through `page.addInitScript()`.

### Schema Safety Tests (`schema-safety.spec.ts`)

Covers the rollout guards in `docs/operations/schema-rollout-runbook.md`: outdated clients, ingress refusal (`4422` `schema_rejected`) and schema repair. It spawns its own Hocus with `HOCUS_MIN_CLIENT_SCHEMA=2` through `spawnHocus()` (`tests/helpers/spawn-hocus.ts`), which starts `bun run hocus` on a random port with a temp `DB_PATH`, the e2e socket limits and Throttle/Logger off, and returns `{ url, dbPath, pid, logs(), stop() }`. Unit tests use the same helper. `stop()` sends SIGTERM, SIGKILLs after 12 s and removes the temp DB (pass your own `DB_PATH` to read it afterwards). Servers never outlive the test process: they are killed on its exit, SIGINT or SIGTERM, and each exits when its stdin pipe closes (`HOCUS_EXIT_ON_STDIN_EOF=1`, set only by this helper), which covers a SIGKILLed runner.

- `window.__HOCUS_SCHEMA` (set in `page.addInitScript()`) overrides the `schema` value the client sends, to impersonate an older bundle.
- `E2E_BASE_URL` (default `http://localhost:3000`) points Playwright at a dev server on another port. `E2E_HOCUS_URL` (default `ws://127.0.0.1:1234`) is read only by `global-tabs-poison.spec.ts`, which talks to the dev Hocus directly.

### PWA Tests

Every Playwright project runs with `serviceWorkers: "block"` except `pwa`, so caches never leak into other tests.

| Test | Project | Validates |
|------|---------|-----------|
| `pwa-manifest.spec.ts` | `chromium` (`make dev`) | Manifest shape and omitted members; icon sizes and opaque/rounded corners; apple and theme-color head tags; theme-color follows the dark toggle, reloads and soft navigation; install button (synthetic `beforeinstallprompt`, pre-hydration capture, hidden when installed, iOS hint by keyboard) |
| `pwa-offline.spec.ts` | `pwa` (production build) | Registration after `load` with scope `/`; cache contents (own static files and shell pages only); `sw.js` headers; offline reload of `/` shows the stored shell, unvisited paths show `/offline`; `/api` and other bypass routes never come from the worker; repeat visits are not slower; a fully offline reload reopens the editor with the document from the device; a cold offline start still says a chunk did not load (the idle prefetch cached the announcer) |

The worker runs only on a production build. Use port 3847 and localhost only, never tiny.docs.plus:

```bash
NEXT_PUBLIC_HOCUS_URL=ws://127.0.0.1:1234 bun run build && PORT=3847 bun run start
HOCUS_THROTTLE=0 HOCUS_ALLOW_ISOLATED_TABS_DOCS=1 bun run hocus
PWA_BASE_URL=http://localhost:3847 CI= bun run test:pwa
```

Offline is simulated with `context.setOffline(true)`, which also cuts the worker's own fetches in Chromium. Unit tests for the routing rules live in `tests/unit/lib/pwa-sw-routing.test.ts`.

Manual install checklist (localhost production build):

- **Chrome desktop:** the install icon appears in the status strip and the address bar; the strip button opens the native dialog; installing opens a standalone window whose title bar follows the theme toggle, and the strip button is gone in both the window and the tab.
- **Chrome Android:** `adb reverse tcp:3847 tcp:3847`, open `http://localhost:3847`, install; the home-screen icon is the maskable "T" with no white ring.
- **iOS Simulator (Safari):** the strip's install button shows the Share → Add to Home Screen hint (Enter opens it, Escape closes it and returns focus); the home-screen icon has no black corners and is titled "TinyDocy".
- **Edge desktop:** same as Chrome desktop.
- DevTools → Application → Manifest shows no errors, App Id `/`, three icons; "Show only the minimum safe area for maskable icons" keeps the "T" inside the circle.

## Layer 3: Soak Tests (Playwright, long-running)

Sustained editing sessions that detect memory leaks, latency degradation, and schema corruption over time. Documents use realistic content (paragraphs, bullet lists, ordered lists, task lists, code blocks, blockquotes per section).

```bash
make test-soak-collab-quick   # 30s, 3 users — fast verification
make test-soak-quick           # 5 min single-user
make test-soak                 # full suite (30 min)
```

### Single-User Soak (`soak.spec.ts`)

1. Runs 2 scripted journeys (typing + structural edits, filter lifecycle)
2. Warm-up phase with stochastic bot
3. Sustained editing with memory sampling every 30s
4. Reports: JS heap growth, p50/p95 latency, action counts, error count
5. Writes JSON report to `test-reports/soak-report-{timestamp}.json`

### Multi-User Soak (`soak-collab.spec.ts`)

1. User 0 seeds a rich document, waits for rendering
2. Users 1..N-1 join sequentially (each verifies initial sync)
3. All N users run stochastic bots concurrently
4. Schema invariants checked every 60s per user
5. Final convergence assertion: all N documents must be identical

**Environment variables:**

| Variable | Default | Description |
|----------|---------|-------------|
| `SOAK_DURATION` | `1800000` (30 min) | How long bots run |
| `SOAK_HEADINGS` | `200` (single) / `20` (collab) | Document heading count |
| `SOAK_USERS` | `3` | Number of concurrent browser users |
| `SOAK_WARMUP` | auto (30s if &lt;10 min, 120s otherwise) | Warm-up duration before memory baseline |
| `SOAK_MEMORY_GROWTH_LIMIT` | `50` | Max heap growth % before fail (single-user soak) |

## Layer 4: Yjs Soak Scenarios

Targeted tests for collaboration-layer resilience.

```bash
make test-yjs-soak
```

### Reconnection Recovery (`reconnection.spec.ts`)

Spawns a dedicated Hocuspocus instance on port 1235 (`bun run hocus`), types content, kills the server, restarts it with SQLite persistence, and verifies no data loss. Uses `window.__HOCUS_URL` to redirect the editor's WebSocket.

### Rapid Tab Switch (`rapid-tab-switch.spec.ts`)

Creates multiple tabs via the tab bar UI, switches between them 20 times, types in each, and verifies content persists. Exercises the Y.Doc cache lifecycle in `useYjsDocument`.

### Schema soaks (standalone Bun scripts)

Two smart toolbar ship gates, run nightly (`color-soak` and `mixed-version`
jobs). They need no browser and no Next.js: start Hocuspocus first
(`make dev-hocus`, or `bun run hocus` on another port with
`HOCUS_ALLOW_ISOLATED_TABS_DOCS=1`), then run the script. With
`SOAK_HOCUS_LOG` pointing at the server's log, each also fails on any
`ws_unknown_schema_name`, `ws_update_too_large`, `document_store_rejected`,
`ws_throttle_ban` or `editor_root_swept` line written during the run.

```bash
make dev-hocus > hocus.log 2>&1 &
SOAK_HOCUS_LOG=hocus.log bun run test:soak:color            # 3,000 toggles
COLOR_SOAK_TOGGLES=50000 MAX_DOC_SIZE_BYTES=2097152 bun run test:soak:color
SOAK_HOCUS_LOG=hocus.log bun run test:soak:mixed-version    # 30 rounds per phase
```

**Alternating colour soak (`color-mark-soak.ts`, spec §7 abuse soak).**
Three clients toggle `textColor`, `highlight` and `fontSize` on and off
(token values only, the Yjs format calls y-prosemirror makes) on
overlapping ranges of four shared paragraphs. It fails unless every client
and a late-joining verifier (after the document unloads, so it reads the
stored copy) hold identical state; no document was refused (`4422`
`schema_rejected`, `4413` `document_too_large`); the document fits the real
editor schema and the mark allowlist; the state stays under
`MAX_DOC_SIZE_BYTES` at every checkpoint; and growth per toggle in the
second half is at most 1.5× the first half's. Yjs keeps a tombstone for each
removed format run, so the state grows linearly, about 20–23 B per toggle:
50,000 toggles reach about 1.1 MB, past the 1 MiB default cap, so the
nightly job runs server and script at production's 2 MiB
(`MAX_DOC_SIZE_BYTES=2097152`). The cap is the only bound on this growth.

| Variable | Default | Description |
|----------|---------|-------------|
| `COLOR_SOAK_TOGGLES` | `3000` | Total toggles (nightly: `50000`) |
| `COLOR_SOAK_CLIENTS` | `3` | Concurrent clients (at least 2) |
| `COLOR_SOAK_BATCH` | `5` | Toggles per Yjs transaction |
| `COLOR_SOAK_RATE` | `1000` | Toggles per second, all clients (`0` = unpaced) |
| `COLOR_SOAK_SEED` | time | PRNG seed, printed; set it to replay a run |
| `COLOR_SOAK_URL` | `ws://127.0.0.1:1234` | Hocuspocus WebSocket URL |
| `MAX_DOC_SIZE_BYTES` | `1048576` | Size cap; give the server the same value |

**Mixed-version soak (`mixed-version-soak.ts`, spec §3.1 N+1 ship gate).**
`HOCUS_MIN_CLIENT_SCHEMA` stays unset (log-only by env), but the built-in
`SCHEMA_FLOOR = 2` makes the effective minimum 2, so the script encodes the
behaviour the design specifies for that:

- **pre-N** clients (no `schema` parameter, and `schema=1`; no new marks)
  get `client_outdated` on the document while the tab list on the same
  socket still syncs. They keep typing and deleting blocks in their device
  copy; none of it may reach the server, and their socket may not be reset
  (`4205`).
- a **release N** editor (`schema=2`, schema without `textColor`/`fontSize`)
  is admitted and must stay editable through the text phase (no unexpected
  freeze), then freeze (`onInvalidContent`, schema guard `outdated`) when the
  N+1 marks arrive and send nothing more.
- the **N+1** editor types and writes colour and size, and never freezes.

The stored copy must keep every seeded block, all text typed before the
freeze and the N+1 marks, contain nothing from the pre-N or frozen N
clients, and fit the editor schema. The nightly job runs it with throttle on.

| Variable | Default | Description |
|----------|---------|-------------|
| `MIXED_SOAK_ROUNDS` | `30` | Edit rounds per phase, text then marks (nightly: `300`) |
| `MIXED_SOAK_URL` | `ws://127.0.0.1:1234` | Hocuspocus WebSocket URL |

## Layer 5: Load Harness (standalone Bun script)

Headless N-client Yjs convergence test — no browser required. Clients use Bun's built-in `WebSocket`. CLI args override env vars (industry pattern: k6 `K6_*`, Benchmark `BENCHMARK_*`).

```bash
make test-load                                              # 100 clients, 30s, distributed
make test-load LOAD_CLIENTS=50 LOAD_DURATION=10000          # env vars
bun tests/load/yjs-load-harness.ts --clients 50 --duration 10000 --scenario conflict
```

| Variable | Default | Description |
|----------|---------|-------------|
| `LOAD_CLIENTS` | `100` | Concurrent Yjs clients |
| `LOAD_DURATION` | `30000` | Steady-state duration (ms) |
| `LOAD_RATE` | `2` | Operations/second per client |
| `LOAD_SCENARIO` | `distributed` | `distributed` or `conflict` |
| `LOAD_URL` | `ws://127.0.0.1:1234` | Hocuspocus WebSocket URL |

Phases: connect → seed (realistic document with paragraphs, lists, task lists) → warm-up → steady-state editing → drain → byte-level + JSON-level convergence verification → structured report.

Each client gets a unique identity token (`load-client-{i}-{docId}`).

## CI (GitHub Actions)

`.github/workflows/ci.yml` runs on every pull request and push to `main`:

| Job | Runs |
|---|---|
| Lint, typecheck, unit tests, build | `bun run check`, `bun run lint`, `bun run typecheck`, `bun run test --exclude 'tests/unit/stress/**'`, `bun run build` |
| Playwright (Chromium) | `make dev`, a warm-up request per page, then `CI= bun playwright test --project=chromium --project=perf --retries=1` (`perf` starts after `chromium`, on one worker) |

- **Stress probe:** `bun run test:stress` runs as a separate step with
  `continue-on-error`. It measures transaction time, so a slow shared runner
  can miss its threshold without the code being wrong.
- **Retries:** a test that passes on retry is listed as "flaky" in the
  Playwright summary; treat that as a bug to fix, not a pass.
- **On failure:** `test-results/` and the dev-server log are uploaded as the
  `e2e-results` artifact.
- **Nightly, not per PR:** `.github/workflows/nightly.yml` runs the `pwa`
  project against a production build, the Yjs soak, the quick multi- and
  single-user soaks, the load harness (both scenarios) and the two schema
  soaks (50,000 colour toggles; mixed versions) every day at 03:41
  and 08:00 UTC, or from Actions → Nightly → Run workflow. Run the layer locally before
  merging a change it covers.
- **Extension update PRs:** the scheduled `@docs.plus` update workflow starts
  CI on its branch itself (`gh workflow run ci.yml`), because pull requests
  opened with the workflow token start no workflows.
- **Workflow rules:** `tests/unit/ci/workflow-permissions.test.ts` checks every
  workflow file. Each workflow needs a read-only default token, explicit
  per-job permissions, `persist-credentials: false` on checkout, and actions
  pinned to commit SHAs.

## Key Conventions

- **Rich document content** — `generateLargeDocument` produces 3-5 paragraphs + mixed structured blocks per heading section by default. Pass `{ richContent: false }` for lightweight documents. Playground content includes tables, syntax-highlighted code blocks (multi-language), and highlighted text.
- **Test editor extensions** — `create-test-editor.ts` registers `TableKit`, `CodeBlockLowlight` (lowlight with common languages), `TaskList`/`TaskItem`, `Image`, `Highlight`, `TextAlign`, and `UniqueID` alongside schema enforcement extensions.
- **User identity** — all multi-user tests inject unique `window.__HOCUS_TOKEN` per browser context. The `useYjsDocument` hook reads this and passes it to `HocuspocusProvider`.
- **Y.Doc caching** — `useYjsDocument` uses a module-level `docCache` with reference counting. Y.Doc instances persist across component unmounts (tab switches) to prevent content loss.
- **Platform-specific keys** — soak bot uses `Meta` (macOS) or `Control` (others) for keyboard shortcuts. Never use `Mod` — it is ProseMirror-only and unknown to Playwright.
- **Test isolation** — each test generates a unique `docId` with timestamp + random suffix to prevent cross-test interference on the shared Hocuspocus server. Tab state is isolated via `window.__GLOBAL_TABS_DOC` (set per test in `EditorPage.goto()`) so parallel tests use separate `global-tabs-{docId}` Yjs documents.
- **Wait for the server, then type at full speed** — `EditorPage.waitForSync()` waits for `data-server-synced` on the editor region (the editor is editable earlier, from the device copy, and a new document is seeded only after the first server sync). Tests then type without artificial waits; if typed text lands in the wrong place, look for an app bug first (the caret-after-Enter race was `content-visibility`, fixed by `CaretBlockVisible`). Use `typeInNewParagraphAtEnd(page, text)` to add text at the end of a document.
- **Toolbar dev-only hooks** — `window.__TOOLBAR_OFF` (set before load) unmounts the toolbar for the A/B typing budget; `window.__toolbarCommits` counts React Profiler commits of the toolbar's children (every React commit that re-renders them) so tests can assert the update budget. Neither exists in production builds.
- **Lazy chunks** — `helpers/lazy-chunk.ts` finds a lazy surface's chunk by a string in its body (`CHUNK_MARKERS`, dev names; chunk URLs are hashed) and lets a test fail or hold it. Dev StrictMode registers `BubbleMenu`'s plugin twice with one root, so a surface that mounts after the selection exercises paths production only hits when the editor changes; `selection-bubble.spec.ts` holds the bubble chunk past the selection to pin that case.
- **Assertion split** — `assert-invariants.ts` (imports `expect` from `bun:test`) for unit tests; `assert-invariants-json.ts` (pure `throw`) for Playwright tests.

## Related Documentation

- [E2E Testing Strategy Plan](../docs/plans/5-feat-e2e-testing-strategy-plan.md) — original infrastructure plan (completed)
- [Test Realism & Soak Plan](../docs/plans/6-feat-test-realism-soak-and-stress-plan.md) — soak, stress, and collaboration layers (completed)
- [E2E Testing Brainstorm](../docs/brainstorms/8-e2e-testing-strategy-brainstorm.md) — initial requirements exploration
- [Test Realism Brainstorm](../docs/brainstorms/9-test-realism-and-soak-brainstorm.md) — soak and performance requirements

Historical-doc note: some completed plans/brainstorms predate the `extensions/`
refactor and may reference legacy paths under
`components/tiptap-node/{heading-node,document-node}`.

## Clipboard fixtures (text style paste)

`tests/fixtures/clipboard/google-docs.html` and `word.html` are hand-written in
the shape of each app's clipboard HTML. They are **not** real captures, so
`text-style-paste.test.ts` and `tests/e2e/text-style-marks.spec.ts` prove that
foreign colour, size and background paste plain only for these samples. To
replace them with real captures, type `Red Large Marked Plain` in the app,
make "Red" red, "Large" 18 pt and "Marked" highlighted, copy the line, then on
macOS run
`osascript -e 'the clipboard as «class HTML»' | perl -ne 'print pack("H*", $1) if /«data HTML([0-9A-F]+)»/' > tests/fixtures/clipboard/<name>.html`.
Strip author names, e-mail addresses and `<xml>` metadata before committing.
Biome skips this folder.

