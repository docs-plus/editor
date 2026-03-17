---
date: 2026-03-18
phase: 1
parent: docs/brainstorms/12-codebase-quality-audit-brainstorm.md
---

# Phase 1 — Foundation Implementation Plan

## Overview

6 tasks, ordered by dependency. No behavior changes — purely structural
cleanup.

**Brainstorm cross-reference:** Tasks map to brainstorm sections as follows:
Task 1 → §1.3, Task 2 → §1.1, Task 3 → §1.2, Task 4 → §1.4,
Task 5 → §1.5, Task 6 → §1.6.

## Pre-flight

```bash
# Ensure clean state
bun run lint && bun run build && bun run test
```

---

## Task 1: Remove empty `scripts/` directory

**Risk:** Zero
**Files:** 1 directory

```bash
rmdir scripts/
```

**Verify:** `bun run build` still works (no references).

---

## Task 2: Icon migration — `react-icons/lu` → `lucide-react`

**Risk:** Low (all 48 icons verified present in lucide-react ^0.577.0)
**Files:** 2 (`lib/icons.ts`, `package.json`)

### Step 2a: Update `lib/icons.ts`

Replace the entire file. All icon names map 1:1 — drop the `Lu` prefix:

```typescript
export {
  AlignCenter as AlignCenterIcon,
  AlignJustify as AlignJustifyIcon,
  AlignLeft as AlignLeftIcon,
  AlignRight as AlignRightIcon,
  ArrowLeft as ArrowLeftIcon,
  Ban as BanIcon,
  Bold as BoldIcon,
  ChevronDown as ChevronDownIcon,
  ChevronRight as ChevronRightIcon,
  CloudUpload as CloudUploadIcon,
  Code as Code2Icon,
  CornerDownLeft as CornerDownLeftIcon,
  ExternalLink as ExternalLinkIcon,
  FileText as FileTextIcon,
  Filter as FilterIcon,
  FlaskConical as FlaskConicalIcon,
  GripVertical as GripVerticalIcon,
  Heading as HeadingIcon,
  Heading1 as HeadingOneIcon,
  Heading2 as HeadingTwoIcon,
  Heading3 as HeadingThreeIcon,
  Heading4 as HeadingFourIcon,
  Heading5 as HeadingFiveIcon,
  Heading6 as HeadingSixIcon,
  Highlighter as HighlighterIcon,
  ImagePlus as ImagePlusIcon,
  Italic as ItalicIcon,
  Link as LinkIcon,
  List as ListIcon,
  ListOrdered as ListOrderedIcon,
  ListTodo as ListTodoIcon,
  MoonStar as MoonStarIcon,
  PanelLeft as PanelLeftIcon,
  PanelLeftClose as PanelLeftCloseIcon,
  Plus as PlusIcon,
  Redo2 as Redo2Icon,
  RefreshCw as RefreshCwIcon,
  Search as SearchIcon,
  SquareCode as CodeBlockIcon,
  Strikethrough as StrikeIcon,
  Subscript as SubscriptIcon,
  Sun as SunIcon,
  Superscript as SuperscriptIcon,
  TextQuote as BlockquoteIcon,
  Trash2 as TrashIcon,
  Underline as UnderlineIcon,
  Undo2 as Undo2Icon,
  X as CloseIcon,
} from "lucide-react";
```

### Step 2b: Remove `react-icons` from `package.json`

```bash
bun remove react-icons
```

### Step 2c: Verify no direct `react-icons` imports elsewhere

Already confirmed: zero direct imports outside `lib/icons.ts`.

### Step 2d: Visual check

Open the app (`make dev`), verify all toolbar icons render. Check:

- All toolbar buttons display correct icons
- Tab bar icons (FlaskConical, FileText, GripVertical, Plus, X, RefreshCw)
- TOC sidebar icons (ChevronDown, ChevronRight, PanelLeft, PanelLeftClose)
- Filter panel icons (Filter, Search, X)
- Theme toggle (Sun, MoonStar)

---

## Task 3: Biome import sorting

**Risk:** Low (config-only, auto-fixable)
**Files:** 1 (`biome.json`), plus auto-fix across all source files

### Step 3a: Update `biome.json`

Replace the `assist` section:

```json
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
```

### Step 3b: SCSS import guard

Two files have order-sensitive SCSS imports. Before running auto-fix, add
guards so Biome doesn't reorder them.

**`app/layout.tsx`** — check if the 3 CSS imports (`globals.css`,
`_variables.scss`, `_keyframe-animations.scss`) are in cascade order. If Biome
would reorder them, add a biome-ignore comment.

**`simple-editor.tsx`** — has 11 SCSS side-effect imports. Check if auto-sort
changes their order. If it does, add a biome-ignore comment block.

### Step 3c: Run auto-fix

```bash
bunx biome check --write .
```

### Step 3d: Verify

```bash
bun run lint && bun run build
```

Review `git diff` to confirm only import reordering (no logic changes).

---

## Task 4: Trivial renames

**Risk:** Zero
**Files:** 3

### Step 4a: `handleOnOpenChange` → `handleOpenChange`

**`components/tiptap-ui/list-dropdown-menu/list-dropdown-menu.tsx`**

- Line 59: rename function declaration
- Line 72: rename usage in `onOpenChange={handleOnOpenChange}`

**`components/tiptap-ui/link-popover/link-popover.tsx`**

- Line 219: rename function declaration
- Line 252: rename usage in `onOpenChange={handleOnOpenChange}`

### Step 4b: `Config` → `YjsLoadHarnessConfig`

**`tests/load/yjs-load-harness.ts`**

- Line 32: rename interface
- Update all usages of `Config` type in the same file

---

## Task 5: SimpleEditor file splitting

**Risk:** Low (no logic changes, just moving code to separate files)
**Files:** 4 (1 modified, 3 created)

### Step 5a: Extract `MainToolbarContent`

Create `components/tiptap-templates/simple/main-toolbar-content.tsx`:

- Move the `MainToolbarContent` component (lines 131-230) to a new file
- Add the necessary imports (ToolbarGroup, ToolbarSeparator, Spacer,
  ToolbarButton, all tiptap-ui button components, icons)
- Export as named export

### Step 5b: Extract `MobileToolbarContent`

Create `components/tiptap-templates/simple/mobile-toolbar-content.tsx`:

- Move the `MobileToolbarContent` component (lines 232-255) to a new file
- Add necessary imports (ToolbarGroup, ToolbarSeparator, ArrowLeftIcon,
  HighlighterIcon, LinkIcon, ColorHighlightPopoverContent, LinkContent,
  ToolbarButton)
- Export as named export

### Step 5c: Extract `EditorSkeleton`

Create `components/tiptap-templates/simple/editor-skeleton.tsx`:

- Move the `EditorSkeleton` component (lines 257-270) to a new file
- No imports needed (pure HTML/CSS)
- Export as named export

### Step 5d: Update `simple-editor.tsx`

- Remove the 3 component definitions
- Add imports:

  ```typescript
  import { MainToolbarContent } from "@/components/tiptap-templates/simple/main-toolbar-content";
  import { MobileToolbarContent } from "@/components/tiptap-templates/simple/mobile-toolbar-content";
  import { EditorSkeleton } from "@/components/tiptap-templates/simple/editor-skeleton";
  ```

- All usages remain the same (component names unchanged)

### Step 5e: Verify

```bash
bun run lint && bun run build
```

Open the app — toolbar must render identically in desktop and mobile views.

---

## Task 6: Relocate `playground-scenarios.ts`

**Risk:** Zero
**Files:** 3 (1 moved, 1 import updated, 1 directory deleted)

### Step 6a: Move the file

```bash
mv components/playground/playground-scenarios.ts \
   components/tiptap-templates/simple/playground-scenarios.ts
```

### Step 6b: Update import in `simple-editor.tsx`

```typescript
// Before
import { generatePlaygroundContent } from "@/components/playground/playground-scenarios";
// After
import { generatePlaygroundContent } from "@/components/tiptap-templates/simple/playground-scenarios";
```

### Step 6c: Remove empty directory

```bash
rmdir components/playground/
```

### Step 6d: Check for other references

Verify no other file imports from `@/components/playground/`. Already confirmed:
only `simple-editor.tsx` imports it.

---

## Post-flight

```bash
# Full verification
bun run lint && bun run build && bun run test

# If dev servers are running:
# Visual check: toolbar icons, tab bar, TOC sidebar, filter panel
# Import ordering in git diff looks clean
```

## Commit Strategy

6 atomic commits (one per task), all on the same branch:

1. `chore: remove empty scripts directory`
2. `refactor: migrate icons from react-icons to lucide-react`
3. `style: add Biome import sorting with custom groups`
4. `refactor: rename handleOnOpenChange and Config interface`
5. `refactor: split SimpleEditor toolbar components to separate files`
6. `refactor: relocate playground-scenarios to simple editor directory`

Or collapse into 2 commits by logical grouping:

- `refactor: Phase 1a structural cleanup (icons, imports, file org)`
- `refactor: Phase 1b trivial renames and file splitting`
