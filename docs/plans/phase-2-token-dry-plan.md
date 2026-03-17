---
date: 2026-03-18
phase: 2
parent: docs/brainstorms/12-codebase-quality-audit-brainstorm.md
depends-on: docs/plans/phase-1-foundation-plan.md
---

# Phase 2 — Token Consolidation + DRY Implementation Plan

## Overview

3 tasks. Medium risk due to CSS token changes that affect visual appearance.
Requires thorough light/dark mode visual verification.

**Brainstorm cross-reference:** Task 1 → §2.1, Task 2 → §2.2, Task 3 → §2.3.

**Prerequisite:** Phase 1 must be complete and passing.

## Pre-flight

```bash
bun run lint && bun run build && bun run test
```

---

## Task 1: Token consolidation in `styles/_variables.scss`

**Risk:** Medium (CSS changes affect visual appearance)
**Files:** ~12 (1 SCSS source + ~11 SCSS consumers)

### Step 1a: Delete unused tokens

Remove these tokens from `_variables.scss` — they're defined but never used
in any SCSS or TS file:

**In `:root` block (lines 174–191):**

- `--tt-card-bg-color` (line 188)
- `--tt-card-border-color` (line 189)

**In `.dark` block (lines 193–210):**

- `--tt-card-bg-color` (line 203)
- `--tt-card-border-color` (line 204)

**In transitions section (lines 143–154):**

- `--tt-transition-duration-long` (line 149)
- `--tt-transition-easing-quart` (line 152)
- `--tt-transition-easing-circ` (line 153)
- `--tt-transition-easing-back` (line 154)

### Step 1b: Replace duplicate tokens in SCSS consumers

For each token below, search-and-replace in all SCSS files, then remove the
token definition from `_variables.scss`.

**`--tt-bg-color` → `var(--background)`**

Consumers (6 usages):

- `components/tiptap-templates/simple/simple-editor.scss`
- `components/tab-bar/tab-bar.scss`
- `components/tiptap-node/heading-node/heading-drag.scss`

Also used in `components/tiptap-ui/color-highlight-popover/use-color-highlight.ts`
(TypeScript, not SCSS) — update there too.

After replacing all consumers, remove from `_variables.scss`:

- `:root` block: `--tt-bg-color: var(--white);` (line 180)
- `.dark` block: `--tt-bg-color: var(--black);` (line 195)

**`--tt-border-color` → `var(--border)`**

Consumers (4 usages):

- `components/tab-bar/tab-bar.scss`
- `components/tiptap-templates/simple/simple-editor.scss`
- `components/tiptap-node/heading-node/heading-drag.scss`

Note: `--tt-border-color-tint` is NOT derived from `--tt-border-color` — it's
defined as `var(--tt-gray-light-a-100)` (light) and `var(--tt-gray-dark-a-100)`
(dark). Removing `--tt-border-color` does not affect `--tt-border-color-tint`.

After replacing, remove from `_variables.scss`:

- `:root`: `--tt-border-color: var(--tt-gray-light-a-200);` (line 182)
- `.dark`: `--tt-border-color: var(--tt-gray-dark-a-200);` (line 197)

**`--tt-cursor-color` → `var(--foreground)`**

Consumer (1 usage):

- `components/tiptap-node/paragraph-node/paragraph-node.scss`

Remove from `_variables.scss`:

- `:root`: `--tt-cursor-color: var(--black);` (line 186)
- `.dark`: `--tt-cursor-color: var(--white);` (line 201)

**`--tt-theme-text` → `var(--foreground)`**

Note: `--tt-theme-text` is not defined in `_variables.scss` but is used. Search
for it in the codebase. If it's defined elsewhere (e.g., inline), replace
usages and remove the definition.

Consumers (2 usages):

- `components/tiptap-templates/simple/simple-editor.scss`

**`--tt-radius-sm` → `var(--radius-sm)`**

Consumers (2 usages):

- `components/tiptap-templates/simple/simple-editor.scss`

Remove from `_variables.scss`:

- `--tt-radius-sm: 0.375rem;` (line 138)

**`--tt-radius-md` → `var(--radius-md)`**

Consumers (2 usages):

- `components/tiptap-node/paragraph-node/paragraph-node.scss`
- `components/tiptap-node/image-upload-node/image-upload-node.scss`

Remove from `_variables.scss`:

- `--tt-radius-md: 0.5rem;` (line 139)

**`--tt-radius-lg` → `var(--radius-lg)`**

Consumers (2 usages):

- `components/tiptap-node/image-upload-node/image-upload-node.scss`

Remove from `_variables.scss`:

- `--tt-radius-lg: 0.75rem;` (line 140)

**`--tt-radius-xl` → `var(--radius-xl)`**

Consumer (1 usage):

- `components/tiptap-ui/color-highlight-button/color-highlight-button.scss`

Remove from `_variables.scss`:

- `--tt-radius-xl: 1rem;` (line 141)

### Step 1c: Handle `--tt-sidebar-bg-color`

This maps to shadcn's `--sidebar`. Alias for now:

In `_variables.scss`:

```scss
// :root
--tt-sidebar-bg-color: var(--sidebar);
// .dark
--tt-sidebar-bg-color: var(--sidebar);
```

This is a soft migration — consumers keep using `var(--tt-sidebar-bg-color)`
and it resolves to shadcn's value. Full removal in a future pass when sidebar
styles are consolidated.

### Step 1d: Handle `--tt-radius-xs`

This is `0.25rem` while shadcn's `--radius-sm` is `calc(var(--radius) - 4px)`
(≈0.27rem with default `--radius: 0.45rem`). They're close but not identical.

**Decision:** Keep `--tt-radius-xs` for now (used in 11 places). Mark in a
comment that it's a candidate for shadcn mapping once radius values are
reviewed.

### Step 1e: Fix `--tt-bg-color-contrast` bug

`use-color-highlight.ts` references `var(--tt-bg-color-contrast)` but it's
never defined. Either:

- Add to `_variables.scss` with appropriate light/dark values, or
- Replace with `var(--border)` if that matches the intended appearance

Search for the usage, determine the visual context, and fix accordingly.

### Step 1f: Visual verification

```bash
bun run build
```

Open the app in both light and dark mode. Check these surfaces:

- Editor background and borders
- Tab bar background and borders
- Sidebar background
- Drag handle appearance
- Code block borders
- Image upload borders
- Color highlight button radius
- Cursor color
- Selection highlight color

Compare screenshots before/after if possible.

### Expected result

`_variables.scss` drops from 300 lines to ~275 lines. Removed:

- 8 unused token definitions (4 transition + 4 card, single `:root` block)
- 10 duplicate token definitions (5 tokens × 2 blocks: `:root` + `.dark`)
- - associated section comments

Total: ~25 lines of dead or duplicate CSS removed.

---

## Task 2: Tab bar DRY — Extract `TabContent`

**Risk:** Low (presentational extraction, no logic changes)
**Files:** 2 (1 new, 1 modified)

### Step 2a: Create `components/tab-bar/tab-content.tsx`

```tsx
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

### Step 2b: Refactor `SortableTab` (lines 45–125 in `tab-bar.tsx`)

Replace the inner `<div role="tab">` block with `<TabContent>`:

```tsx
function SortableTab({
  tab,
  isActive,
  tabsLength,
  onSwitch,
  onClose,
}: {
  tab: Tab;
  isActive: boolean;
  tabsLength: number;
  onSwitch: (id: string) => void;
  onClose: (id: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tab.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`tab-bar-tab-wrapper ${isDragging ? "tab-bar-tab-wrapper--dragging" : ""}`}
      data-tab-id={tab.id}
    >
      <TabContent
        isActive={isActive}
        title={tab.title || "Untitled"}
        onSwitch={() => onSwitch(tab.id)}
        onAuxClick={(e) => {
          if (e.button === 1 && tabsLength > 1) {
            e.preventDefault();
            onClose(tab.id);
          }
        }}
        leadingSlot={
          <span
            className="tab-bar-tab-drag-handle"
            {...attributes}
            {...listeners}
            aria-hidden
          >
            <GripVerticalIcon size={12} />
          </span>
        }
        icon={<FileTextIcon size={14} />}
        trailingSlot={
          tabsLength > 1 ? (
            <button
              type="button"
              tabIndex={-1}
              aria-label={`Close ${tab.title || "Untitled"}`}
              className="tab-bar-tab-close"
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.id);
              }}
            >
              <CloseIcon size={12} />
            </button>
          ) : undefined
        }
      />
    </div>
  );
}
```

### Step 2c: Refactor Playground tab (lines 218–252 in `tab-bar.tsx`)

Replace the inner `<div role="tab">` block with `<TabContent>`:

```tsx
<div className="tab-bar-tab-wrapper" data-tab-id={PLAYGROUND_ID}>
  <TabContent
    isActive={activeTabId === PLAYGROUND_ID}
    title={playgroundTab.title || "Playground"}
    onSwitch={() => onSwitch(PLAYGROUND_ID)}
    tabClassName="tab-bar-tab--playground"
    icon={<FlaskConicalIcon size={14} />}
    trailingSlot={
      onPlaygroundRegenerate ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Regenerate content (⌘⇧R)"
          title="Regenerate content (⌘⇧R)"
          className="tab-bar-tab-regenerate"
          onClick={(e) => {
            e.stopPropagation();
            onPlaygroundRegenerate();
          }}
        >
          <RefreshCwIcon size={12} />
        </button>
      ) : undefined
    }
  />
</div>
```

### Step 2d: Add import to `tab-bar.tsx`

```typescript
import { TabContent } from "@/components/tab-bar/tab-content";
```

### Step 2e: Verify

```bash
bun run lint && bun run build
```

Open the app:

- Tab switching works (click + keyboard Enter/Space)
- Playground tab: icon, title, regenerate button
- Document tabs: drag handle, icon, title, close button
- Middle-click close on document tabs
- Drag reorder still works
- Active tab highlighting

Run E2E:

```bash
bun run test:e2e -- --grep "tab"
```

---

## Task 3: Extract `lib/tab-api.ts` from `hooks/use-synced-tabs.ts`

**Risk:** Low (moving pure functions, no behavior changes)
**Files:** 3 (1 new, 1 modified, 1 import update)

### Step 3a: Create `lib/tab-api.ts`

Move these functions/constants from `hooks/use-synced-tabs.ts`:

```typescript
import { PLAYGROUND_ID } from "@/lib/constants";

export type Tab = {
  id: string;
  title: string;
  createdAt: number;
};

const TABS_KEY = "tinydocy-tabs";

const PLAYGROUND_TAB: Tab = {
  id: PLAYGROUND_ID,
  title: "Playground",
  createdAt: 0,
};

export const DELETE_TIMEOUT_MS = 10_000;

export function generateId(): string {
  return crypto.randomUUID();
}

export function ensurePlaygroundTab(tabs: Tab[]): Tab[] {
  if (tabs.some((t) => t.id === PLAYGROUND_ID)) return tabs;
  return [PLAYGROUND_TAB, ...tabs];
}

/** Deduplicate by id, keeping first occurrence. Fixes duplicate key errors from sync. */
export function deduplicateTabs(tabs: Tab[]): Tab[] {
  const seen = new Set<string>();
  return tabs.filter((t) => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
}

export function isTab(value: unknown): value is Tab {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof (value as Tab).id === "string" &&
    "title" in value &&
    typeof (value as Tab).title === "string" &&
    "createdAt" in value &&
    typeof (value as Tab).createdAt === "number"
  );
}

export function loadActiveTabIdFromStorage(): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = localStorage.getItem(TABS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { tabs: Tab[]; activeTabId: string };
      if (parsed.activeTabId && typeof parsed.activeTabId === "string") {
        return parsed.activeTabId;
      }
    }
  } catch {
    // ignore
  }
  return "";
}

export function persistActiveTabId(activeTabId: string): void {
  try {
    const raw = localStorage.getItem(TABS_KEY);
    const parsed = raw ? (JSON.parse(raw) as { tabs: Tab[] }) : { tabs: [] };
    localStorage.setItem(TABS_KEY, JSON.stringify({ ...parsed, activeTabId }));
  } catch {
    // quota exceeded
  }
}

export function getMigrationTabs(): Tab[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(TABS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { tabs: unknown[] };
      if (Array.isArray(parsed.tabs) && parsed.tabs.length > 0) {
        const valid = parsed.tabs.filter(isTab);
        if (valid.length === parsed.tabs.length) {
          return ensurePlaygroundTab(deduplicateTabs(valid));
        }
      }
    }
  } catch {
    localStorage.removeItem(TABS_KEY);
  }
  return null;
}

export function getDefaultBootstrap(): Tab[] {
  return [
    PLAYGROUND_TAB,
    { id: generateId(), title: "Untitled", createdAt: Date.now() },
  ];
}

export async function deleteDocument(
  id: string,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    const res = await fetch(`/api/documents/${encodeURIComponent(id)}`, {
      method: "DELETE",
      signal,
    });
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}
```

### Step 3b: Update `hooks/use-synced-tabs.ts`

Remove lines 15–128 (all constants, types, and pure functions).

Replace with imports:

```typescript
import {
  DELETE_TIMEOUT_MS,
  deleteDocument,
  deduplicateTabs,
  ensurePlaygroundTab,
  generateId,
  getDefaultBootstrap,
  getMigrationTabs,
  loadActiveTabIdFromStorage,
  persistActiveTabId,
  type Tab,
} from "@/lib/tab-api";
```

Add re-export for consumers that import `Tab` from the hook:

```typescript
export type { Tab } from "@/lib/tab-api";
```

Remove the existing `export type Tab = { ... }` definition.

### Step 3c: Update `components/tab-bar/tab-bar.tsx` import

Current:

```typescript
import type { Tab } from "@/hooks/use-synced-tabs";
```

Change to:

```typescript
import type { Tab } from "@/lib/tab-api";
```

Or leave as-is if the hook re-exports `Tab`.

### Step 3d: Check for other `Tab` type imports

Search for `from "@/hooks/use-synced-tabs"` across the codebase. Update any
that import `Tab` to use `@/lib/tab-api` instead.

### Step 3e: Verify

```bash
bun run lint && bun run build && bun run test
```

Open the app:

- Create, rename, reorder, close tabs
- Switch between tabs
- Close all tabs
- Playground tab regeneration
- Refresh page — active tab persists

Run E2E:

```bash
bun run test:e2e -- --grep "tab"
```

---

## Post-flight

```bash
# Full verification
bun run lint && bun run build && bun run test

# Visual check (both light and dark mode):
# - Editor background, borders, shadows
# - Tab bar appearance and behavior
# - Sidebar background
# - Code block styling
# - Image upload area styling
# - Color highlight button radius
# - All heading drag handles
```

## Commit Strategy

3 atomic commits:

1. `refactor: consolidate CSS tokens — remove shadcn duplicates from _variables.scss`
2. `refactor: extract TabContent component to DRY up tab bar rendering`
3. `refactor: extract pure tab functions to lib/tab-api.ts`

## Expected Metrics

| Metric | Before | After |
|--------|--------|-------|
| `_variables.scss` lines | 300 | ~275 |
| `tab-bar.tsx` DRY | ~65-70% duplication | Shared via `TabContent` |
| `use-synced-tabs.ts` lines | ~405 | ~250 |
| New `lib/tab-api.ts` | 0 | ~124 lines (independently testable) |
| New `tab-content.tsx` | 0 | ~50 lines |
