---
date: 2026-03-18
topic: codebase-quality-audit
deepened: 2026-03-18
---

# Codebase Quality Audit — DRY, KISS, SOLID, Conventions

## Enhancement Summary

**Deepened on:** 2026-03-18
**Research agents used:** 9 (barrel files, component decomposition, token/DRY,
collaboration caret/naming, code simplicity reviewer, architecture strategist,
pattern recognition specialist, heading extensions audit, dropped items
re-examination)

### Key Finding

The original plan proposed ~22 items across 4 phases. After research grounded
in the actual codebase, **~55% of the plan is over-engineering**. The codebase
is already well-structured — the audit's own "Positive findings" section lists
14 areas that need no action. The proposed refactor was disproportionate to the
problems it solves.

### Revised Scope

- **Original:** 4 phases, ~22 items
- **Revised:** 2 phases, 9 items (7 original + 2 reconsidered)
- **Dropped:** 13 items flagged as YAGNI, over-decomposition, or unnecessary
  churn by multiple independent reviewers

---

## What We're Building

A targeted cleanup of the TinyDocy codebase addressing only the genuine issues:
token duplication, one DRY violation, icon library inconsistency, file
organization, and a few trivial naming fixes. The goal is a clean, professional
repo — achieved by *removing* unnecessary complexity, not adding new
abstractions.

## Why This Approach

The original brainstorm proposed a layered refactor with 4 phases. After
deepening with 9 research agents, the consensus is:

- The codebase is already consistent in naming, exports, accessibility, typing,
  and test organization
- Most proposed changes solve problems that don't exist (barrel files for a
  project with `@/*` aliases, Context for a 1-level-deep tree, hook
  decomposition for code that shares refs)
- The riskiest items (SimpleEditor decomposition, hook splitting) create more
  complexity than they remove

**Revised approach:** Two focused phases with high-value, low-risk changes only.

---

## Phase 1 — Foundation (low risk, high value)

### 1.1 Icon unification

Migrate `lib/icons.ts` from `react-icons/lu` → `lucide-react`. Remove
`react-icons` from `package.json`.

**Exact mapping (verified against lucide-react exports):**

| react-icons/lu | lucide-react | Alias |
|----------------|--------------|-------|
| LuAlignCenter | AlignCenter | AlignCenterIcon |
| LuAlignJustify | AlignJustify | AlignJustifyIcon |
| LuAlignLeft | AlignLeft | AlignLeftIcon |
| LuAlignRight | AlignRight | AlignRightIcon |
| LuArrowLeft | ArrowLeft | ArrowLeftIcon |
| LuBan | Ban | BanIcon |
| LuBold | Bold | BoldIcon |
| LuChevronDown | ChevronDown | ChevronDownIcon |
| LuChevronRight | ChevronRight | ChevronRightIcon |
| LuCloudUpload | CloudUpload | CloudUploadIcon |
| LuCode | Code | Code2Icon |
| LuCornerDownLeft | CornerDownLeft | CornerDownLeftIcon |
| LuExternalLink | ExternalLink | ExternalLinkIcon |
| LuFileText | FileText | FileTextIcon |
| LuFilter | Filter | FilterIcon |
| LuFlaskConical | FlaskConical | FlaskConicalIcon |
| LuGripVertical | GripVertical | GripVerticalIcon |
| LuHeading | Heading | HeadingIcon |
| LuHeading1 | Heading1 | HeadingOneIcon |
| LuHeading2 | Heading2 | HeadingTwoIcon |
| LuHeading3 | Heading3 | HeadingThreeIcon |
| LuHeading4 | Heading4 | HeadingFourIcon |
| LuHeading5 | Heading5 | HeadingFiveIcon |
| LuHeading6 | Heading6 | HeadingSixIcon |
| LuHighlighter | Highlighter | HighlighterIcon |
| LuImagePlus | ImagePlus | ImagePlusIcon |
| LuItalic | Italic | ItalicIcon |
| LuLink | Link | LinkIcon |
| LuList | List | ListIcon |
| LuListOrdered | ListOrdered | ListOrderedIcon |
| LuListTodo | ListTodo | ListTodoIcon |
| LuMoonStar | MoonStar | MoonStarIcon |
| LuPanelLeft | PanelLeft | PanelLeftIcon |
| LuPanelLeftClose | PanelLeftClose | PanelLeftCloseIcon |
| LuPlus | Plus | PlusIcon |
| LuRedo2 | Redo2 | Redo2Icon |
| LuRefreshCw | RefreshCw | RefreshCwIcon |
| LuSearch | Search | SearchIcon |
| LuSquareCode | SquareCode | CodeBlockIcon |
| LuStrikethrough | Strikethrough | StrikeIcon |
| LuSubscript | Subscript | SubscriptIcon |
| LuSun | Sun | SunIcon |
| LuSuperscript | Superscript | SuperscriptIcon |
| LuTextQuote | TextQuote | BlockquoteIcon |
| LuTrash2 | Trash2 | TrashIcon |
| LuUnderline | Underline | UnderlineIcon |
| LuUndo2 | Undo2 | Undo2Icon |
| LuX | X | CloseIcon |

**Note:** No direct `react-icons` imports exist outside `lib/icons.ts` — the
barrel is the only consumer. `lucide-react` is already in Next.js's
`optimizePackageImports` list and tree-shakes better.

**Verified:** All 48 icon names confirmed present in `lucide-react ^0.577.0`
(the version already installed). No name mismatches — `LuFilter` maps to
`Filter`, `LuAlignCenter` maps to `AlignCenter`.

### 1.2 Biome import sorting

Add `organizeImports` to `biome.json`:

```json
{
  "assist": {
    "enabled": true,
    "actions": {
      "source": {
        "recommended": true,
        "organizeImports": {
          "level": "on",
          "options": {
            "groups": [
              ":NODE:",
              ":BLANK_LINE:",
              ":PACKAGE:",
              ":BLANK_LINE:",
              ["@/**"],
              ":BLANK_LINE:",
              ":PATH:"
            ]
          }
        }
      }
    }
  }
}
```

**Research insight — SCSS side-effect import risk:**

Files with side-effect SCSS imports:

| File | Count | Order matters? |
|------|-------|----------------|
| `app/layout.tsx` | 3 (globals.css, \_variables.scss, \_keyframe-animations.scss) | Yes — cascade |
| `simple-editor.tsx` | 11 (node SCSS files) | Possibly — cascade |
| `tab-bar.tsx` | 1 | No |
| `toc-sidebar.tsx` | 1 | No |
| `color-highlight-button.tsx` | 1 | No |
| `heading-filter.tsx` | 1 | No |
| `image-upload-node.tsx` | 1 | No |

**Guard:** Add `// biome-ignore-all assist/source/organizeImports: CSS cascade`
at the top of `app/layout.tsx`. For `simple-editor.tsx`, either add the same
guard or consolidate the 11 SCSS imports into a single SCSS entry point.

### 1.3 Remove empty `scripts/` directory

Empty directory with no files. Remove with `rmdir`.

### 1.4 Trivial renames (2 items)

- `handleOnOpenChange` → `handleOpenChange` in `list-dropdown-menu.tsx` (line
  59) and `link-popover.tsx` (line 219) — genuine naming fix, matches React
  convention
- `interface Config` → `YjsLoadHarnessConfig` in
  `tests/load/yjs-load-harness.ts` — genuinely ambiguous

### 1.5 SimpleEditor file splitting (reconsidered)

Move `MainToolbarContent`, `MobileToolbarContent`, and `EditorSkeleton` from
`simple-editor.tsx` into separate files in the same directory. No new
abstractions, no new props, no Context — just file organization.

**Expected result:** Main file drops from ~562 lines to ~420 lines. Toolbar
components are easier to locate and read in isolation.

**Files created:**

- `components/tiptap-templates/simple/main-toolbar-content.tsx` (~100 lines)
- `components/tiptap-templates/simple/mobile-toolbar-content.tsx` (~25 lines)
- `components/tiptap-templates/simple/editor-skeleton.tsx` (~13 lines)

### 1.6 playground-scenarios relocation (reconsidered)

Move `components/playground/playground-scenarios.ts` →
`components/tiptap-templates/simple/playground-scenarios.ts`. It's consumed
only by `simple-editor.tsx`. The `components/playground/` directory has no React
components and is misleading. After the move, remove the empty `playground/`
directory.

### 1.7 Keep PM2 config

Keep `ecosystem.config.cjs` — add deployment docs later.

---

## Phase 2 — Token Consolidation + DRY (medium risk)

### 2.1 Token consolidation (aggressive)

~40% of `styles/_variables.scss` duplicates shadcn values.

**Tokens to REMOVE (grep-replace in SCSS consumers):**

| `--tt-*` token | → Replace with | Usage count | Files |
|----------------|----------------|-------------|-------|
| `--tt-bg-color` | `var(--background)` | 6 | simple-editor, tab-bar, heading-drag, use-color-highlight |
| `--tt-border-color` | `var(--border)` | 4 | _variables, tab-bar, simple-editor, heading-drag |
| `--tt-cursor-color` | `var(--foreground)` | 1 | paragraph-node |
| `--tt-theme-text` | `var(--foreground)` | 2 | simple-editor |
| `--tt-card-bg-color` | `var(--card)` | 0 | (unused — just delete) |
| `--tt-card-border-color` | `var(--border)` | 0 | (unused — just delete) |
| `--tt-radius-sm` | `var(--radius-sm)` | 2 | simple-editor |
| `--tt-radius-md` | `var(--radius-md)` | 2 | paragraph-node, image-upload-node |
| `--tt-radius-lg` | `var(--radius-lg)` | 2 | image-upload-node |
| `--tt-radius-xl` | `var(--radius-xl)` | 1 | color-highlight-button |
| `--tt-transition-duration-long` | *(delete)* | 0 | unused |
| `--tt-transition-easing-quart` | *(delete)* | 0 | unused |
| `--tt-transition-easing-circ` | *(delete)* | 0 | unused |
| `--tt-transition-easing-back` | *(delete)* | 0 | unused |

**Tokens to ALIAS (gradual migration):**

| `--tt-*` token | shadcn equivalent | Usage count | Notes |
|----------------|-------------------|-------------|-------|
| `--tt-sidebar-bg-color` | `var(--sidebar)` | 2 | tab-bar, simple-editor |
| `--tt-radius-xs` | `--radius-sm` ≈ (0.25rem vs 0.27rem) | 11 | Keep as-is or map to `calc(var(--radius) * 0.56)` |

**Tokens to KEEP (editor-specific, no shadcn equivalent):**

| Category | Tokens |
|----------|--------|
| Editor layout | `--tt-canvas-color`, `--tt-page-shadow`, `--tt-toolbar-height` |
| Editor interaction | `--tt-selection-color`, `--tt-scrollbar-color` |
| Brand palette | `--tt-brand-color-50` through `--tt-brand-color-950` |
| Alpha gray scales | `--tt-gray-light-a-*`, `--tt-gray-dark-a-*` (50–900) |
| Solid gray scales | `--tt-gray-light-*`, `--tt-gray-dark-*` |
| Notion-style palette | `--tt-color-highlight-*`, `--tt-color-highlight-*-contrast` |
| Semantic colors | `--tt-color-yellow-*`, `--tt-color-green-*`, `--tt-color-red-*` |
| Text colors | `--tt-color-text-*` (defined but unused — keep for planned features) |
| Transitions | `--tt-transition-duration-short`, `--tt-transition-duration-default`, `--tt-transition-easing-default`, `--tt-transition-easing-cubic` |
| Node-specific | `--tt-checklist-*`, `--tt-inline-code-*`, `--tt-codeblock-*`, `--tt-fold-duration` |
| Shadows | `--tt-shadow-elevated-md` |
| Border tint | `--tt-border-color-tint` (lighter variant, no shadcn match) |
| Collaboration | `--tt-collaboration-carets-label` |

**Bug found:** `--tt-bg-color-contrast` used in `use-color-highlight.ts` but
never defined in `_variables.scss`. Fix: add definition or replace with
`var(--border)`.

**Expected result:** `_variables.scss` shrinks from 300 lines to ~275 lines
(~25 lines of unused and duplicate token definitions removed).

**Architectural boundary (codify):** shadcn tokens own UI chrome (backgrounds,
borders, radii, surfaces). `--tt-*` tokens own editor content rendering
(palette, canvas, page boundary, scrollbar, transitions, fold effects).

### 2.2 Tab bar DRY — TabContent extraction

Research confirmed ~65-70% duplication between Playground tab and `SortableTab`.

**TabContent component:**

```tsx
// components/tab-bar/tab-content.tsx
"use client";

import type { KeyboardEvent, MouseEvent, ReactNode } from "react";

export interface TabContentProps {
  isActive: boolean;
  title: string;
  onSwitch: () => void;
  tabClassName?: string;
  onAuxClick?: (e: MouseEvent<HTMLDivElement>) => void;
  leadingSlot?: ReactNode;
  icon: ReactNode;
  trailingSlot?: ReactNode;
}

export function TabContent({
  isActive,
  title,
  onSwitch,
  tabClassName = "",
  onAuxClick,
  leadingSlot,
  icon,
  trailingSlot,
}: TabContentProps) {
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSwitch();
    }
  };

  return (
    <div
      role="tab"
      tabIndex={isActive ? 0 : -1}
      aria-selected={isActive}
      className={`tab-bar-tab ${isActive ? "tab-bar-tab--active" : ""} ${tabClassName}`.trim()}
      onClick={onSwitch}
      onKeyDown={handleKeyDown}
      onAuxClick={onAuxClick}
    >
      {leadingSlot}
      <span className="tab-bar-tab-icon">{icon}</span>
      <span className="tab-bar-tab-title">{title}</span>
      {trailingSlot}
    </div>
  );
}
```

**Usage in Playground tab:** `<TabContent isActive={...} title="Playground"
onSwitch={...} tabClassName="tab-bar-tab--playground"
icon={<FlaskConicalIcon size={14} />} trailingSlot={regenerateButton} />`

**Usage in SortableTab:** `<TabContent isActive={...} title={tab.title || "Untitled"}
onSwitch={...} onAuxClick={middleClickClose}
leadingSlot={dragHandle} icon={<FileTextIcon size={14} />}
trailingSlot={closeButton} />`

**E2E test impact:** None — tests use `.tab-bar-tab`, `.tab-bar-tab-regenerate`,
`.tab-bar-close-all`, `[data-tab-id]` selectors, all of which remain on the
wrapper or are passed through as slots.

**dnd-kit isolation:** `SortableTab` keeps `useSortable`; TabContent is purely
presentational. dnd-kit's `ref`, `style`, `attributes`, `listeners` stay on
the wrapper and drag handle slot, not inside TabContent.

### 2.3 Extract `lib/tab-api.ts`

Move 9 pure functions from `hooks/use-synced-tabs.ts`:

| Function | Current lines | Purpose |
|----------|--------------|---------|
| `generateId` | 23–25 | `crypto.randomUUID()` |
| `ensurePlaygroundTab` | 32–36 | Insert playground tab if missing |
| `deduplicateTabs` | 38–46 | Deduplicate by ID |
| `isTab` | 48–59 | Type guard |
| `loadActiveTabIdFromStorage` | 61–75 | Read active tab from localStorage |
| `persistActiveTabId` | 77–85 | Write active tab to localStorage |
| `getMigrationTabs` | 87–104 | Legacy migration from localStorage |
| `getDefaultBootstrap` | 106–111 | Default tab set for new docs |
| `deleteDocument` | 115–128 | HTTP DELETE with abort signal |

Plus constants: `TABS_KEY`, `PLAYGROUND_TAB`, `DELETE_TIMEOUT_MS`.
Plus type: `Tab` (move canonical definition here; hook re-exports for consumers).

**Expected result:** `use-synced-tabs.ts` drops from ~405 to ~250 lines.
`lib/tab-api.ts` is ~124 lines of independently testable pure logic.

**Downstream impact:** `components/tab-bar/tab-bar.tsx` imports `Tab` — update
to `@/lib/tab-api` (or keep importing from hook if re-exported).
No E2E test changes needed.

---

## Heading Extensions Audit Findings

The heading extensions (HeadingScale, HeadingDrag, HeadingFold, HeadingFilter,
TitleDocument) were audited separately. See
`docs/brainstorms/11-heading-extensions-audit-brainstorm.md` for the checklist.

### Critical portability blockers (CRITICAL)

1. **`@/` imports in all heading-node files** — Copy-paste into another project
   fails. Fix: convert to relative imports or document the required path alias.
2. **Hardcoded `tinydocy-folds-` prefix** in `helpers/fold-storage.ts` — Add
   `storagePrefix?: string` to `HeadingFoldOptions` (default
   `"heading-folds-"`).

### Medium issues

1. **Hardcoded URL params** `filter`, `mode` in `helpers/filter-url.ts` — Add
   to `HeadingFilterOptions` as configurable.
2. **HeadingFilter → HeadingFold coupling** — Filter dispatches fold meta that
   is silently ignored without HeadingFold. Document: "For fold-on-filter, add
   HeadingFold."
3. **`data-toc-id` dependency** — Headings require `data-toc-id` attribute.
   Document as a required setup.
4. **CSS class `has-drag-handle`** breaks `heading-{feature}-{element}`
   convention — consider `heading-drag-has-handle`.

### Positive findings

- Plugin keys use `PluginKey` instances everywhere (no string literals)
- `canMapDecorations` properly shared across all 4 plugins
- `computeSection`/`computeOwnRange` not duplicated
- All plugin views have proper `destroy()` with cleanup
- Decoration mapping is efficient (`canMapDecorations` check before `map()`)
- No unused state fields, no premature configuration
- File names consistently kebab-case

---

## Dropped Items (with reasoning)

### Barrel files everywhere → DROP (confirmed by re-examination)

Next.js doesn't optimize internal barrels. The existing pattern (tiptap-ui has
barrels; internal code uses direct imports) follows a natural public/internal
boundary. `toc-sidebar/` has only 1 TS file; `tiptap-templates/simple/` has
`ThemeToggle` used only internally. Barrels add maintenance with no benefit.

### Single-letter callback params → DROP (confirmed)

Zero genuine clarity issues found. All uses are short inline lambdas.
No multi-line callbacks with ambiguous single-letter params exist.

### Hook return naming → DROP (confirmed)

Each hook has one consumer. Destructuring aliases handle the rare case of
needing two hooks in one component.

### safeTransact → DROP (confirmed)

2 guarded call sites (`if (ydoc) { transact } else { raw }`) plus 1 plain
`ydoc.transact()` in the same file, each simple (1–4 lines). Below the Rule
of Three threshold for extraction.

### React Context → DROP (confirmed)

1-level prop passing. Context causes unnecessary re-renders.

### useSyncedTabs 4 sub-hooks → DROP (confirmed; replaced by lib/tab-api.ts)

All CRUD shares refs; sub-hooks create tight coupling. Pure function
extraction to `lib/tab-api.ts` is the correct approach.

### Collaboration caret → SEPARATE FEATURE BRANCH (confirmed)

Feature work should not be bundled with cleanup.

### CSS class prefix renames → DROP (confirmed)

Heading SCSS uses `heading-fold-*`, `heading-section-*`,
`heading-filter-highlight` — all follow feature boundaries. Filter panel uses
`filter-*` prefix correctly. Only `tiptap-image-upload-*` is a genuine outlier
(rename if touching that component).

### Export inline PluginKeys → DROP (confirmed)

`headingFoldPluginKey` and `headingFilterPluginKey` are already exported where
needed. Document-node keys have no external consumers.

---

## Verification Strategy

Each phase must pass before proceeding:

- **Phase 1:** `bun run lint` clean, `bun run build` succeeds, all imports
  resolve, `bun run test` passes, visual spot-check of icon rendering, toolbar
  components render identically after file split
- **Phase 2:** Same as Phase 1 + verify no visual regressions in editor theme
  (light and dark mode), tab bar renders identically, run E2E tests
  (`bun run test:e2e`)

---

## Resolved Questions

- **Zustand:** Skip. Props + `React.memo` are sufficient for the shallow
  component tree. Revisit only if the tree deepens to 3+ levels.
- **SCSS-only dirs in tiptap-node/:** Keep colocated, skip barrels
- **PM2 config:** Keep, document deployment later
- **Import ordering:** Enforce via Biome with SCSS side-effect import guard
- **UI boundary migration:** Rejected. Heading drag/fold/scale are ProseMirror
  widgets, not React — they belong in `tiptap-node/`
- **Barrel files:** Keep existing pattern. Do not add barrels everywhere.
- **Hook return naming:** Already consistent per hook purpose. No rename needed.
- **Single-letter params:** Idiomatic in short lambdas. No rename needed.
- **SimpleEditor decomposition:** File-split existing sub-components (no new
  abstractions). Full decomposition into hooks + Context is over-engineering.
- **Collaboration caret:** Ship as separate feature branch
- **Heading extensions portability:** Fix `@/` imports and hardcoded prefixes
  in a future portability pass (not part of this quality audit scope)

---

## Audit Findings Reference

### Issues NOT addressed (by user choice)

- **Test coverage gaps** — no unit tests for `lib/url-utils.ts`,
  `lib/hocuspocus.ts`, hooks, or the API route (deferred)
- **Public docs** — no screenshots/demo GIF, no `CONTRIBUTING.md` (deferred)
- **Heading extension portability** — `@/` imports and hardcoded prefixes
  (see heading audit; deferred to portability pass)

### Positive findings (no action needed)

- File naming (kebab-case): strictly followed, zero violations
- Component naming (PascalCase, title-case acronyms): consistent
- Hook naming (camelCase, `use` prefix): consistent
- Export style: named exports only; 6 `export default` are all
  framework-required
- TypeScript strict mode: enabled, minimal `any` usage
- React patterns: no hydration mismatches, stable callbacks, proper refs
- ProseMirror/Tiptap: clean plugin architecture, shared helpers extracted
  (`canMapDecorations`, `computeSection`, `findAllSections`)
- Accessibility: aria labels on all interactive elements
- README: comprehensive, well-structured
- Error handling: localStorage try/catch, SQLite retry logic, abort signals
- Test organization: comprehensive (unit, fuzz, stress, e2e, soak, load)
- Barrel file pattern: intentional public/internal boundary
- Hook return values: consistent per purpose
- Heading extension plugin views: proper `destroy()` with cleanup
- Heading extension decoration handling: efficient mapping with
  `canMapDecorations`

---

## Next Steps

Implementation plans exist:

- **Phase 1:** `docs/plans/phase-1-foundation-plan.md` (6 tasks, low risk)
- **Phase 2:** `docs/plans/phase-2-token-dry-plan.md` (3 tasks, medium risk)
