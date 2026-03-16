---
title: feat: Tab Sync, Reorder, Close All, and Document Deletion
type: feat
status: completed
date: 2026-03-16
deepened: 2026-03-16
implemented: 2026-03-16
---

# feat: Tab Sync, Reorder, Close All, and Document Deletion

## Enhancement Summary

**Deepened on:** 2026-03-16  
**Sections enhanced:** Architecture, Technical Considerations, Implementation Phases, API Guards  
**Research agents used:** best-practices-researcher, framework-docs-researcher, kieran-typescript-reviewer, performance-oracle, security-sentinel, julik-frontend-races-reviewer, code-simplicity-reviewer, architecture-strategist

### Key Improvements

1. **Y.Array patterns** — Bootstrap in `onSynced` when empty; wrap reorder in `ydoc.transact()`; use `observe` not `observeDeep`; find by `id` not index to avoid race conditions.
2. **dnd-kit** — Use `horizontalListSortingStrategy`, `activationConstraint: { distance: 8 }`, `KeyboardSensor` for accessibility; update only in `onDragEnd`; resolve dragged item by `id` at drop.
3. **DELETE API** — Parallel `Promise.allSettled` for close-all; sequential Y.Array removal by `id`; `serverExternalPackages: ['better-sqlite3']` in next.config; WAL mode; 10s per-request timeout.
4. **Race conditions** — Derive `tabs` and `validActive` together in observe; never render SimpleEditor when `documentId` not in `tabs`; use ref for `activeTabId` in observe callback.
5. **Simplifications** — Remove `use-tabs.ts` after migration; skip `lib/sqlite.ts`; merge Close Tab + Close All into one phase; seed in SimpleEditor only.

### New Considerations Discovered

- **Concurrent Y.Array reorder** — Two users reordering can produce surprising but consistent CRDT merge; document as known limitation.
- **Bootstrap race** — Two clients connecting with empty `global-tabs` simultaneously may both seed; CRDT merge handles duplicates; document as known limitation.
- **ID validation** — Reject control chars, path-like strings; allow UUID or literal `playground`; max length 64.
- **Auth** — MVP: DELETE and global-tabs are unauthenticated; document as intentional; add auth before production.

### Technical Review Findings (2026-03-16)

**Code reviewer:** Phase 1 — explicit `createTab`, `activeTabId` persist, `closeTab` active handling, `ready`. Phase 3 — playground guard, `AbortController`, close-all disabled condition. Phase 5 — empty = `ydoc.getXmlFragment('default').length === 0`; use `editor.commands.setContent(defaultContent)`.

**Data integrity:** Bootstrap marker; clear localStorage only after sync; re-resolve index per delete; batch failure alert; persist fallback to localStorage.

**Deployment:** Confirm PM2 `cwd` same for both apps; optionally use `DB_PATH` env for explicit path; `better-sqlite3` native addon must build on target platform.

---

## Overview

Implement four related improvements to the tab bar and document lifecycle: (1) cross-device/cross-user tab sync via a shared Yjs document, (2) tab reorder with dnd-kit, (3) close-all button with confirmation, and (4) document deletion from SQLite when tabs close. All users share a single global workspace.

**Source:** [docs/brainstorms/10-tab-sync-reorder-close-all-brainstorm.md](../brainstorms/10-tab-sync-reorder-close-all-brainstorm.md)

## Problem Statement

- **Tab list is local-only** — `use-tabs` stores tabs in `localStorage`; no sync across browsers or users.
- **Documents invisible elsewhere** — Document content syncs via Hocuspocus, but tab metadata never leaves the client.
- **No reorder** — Tabs are fixed in creation order.
- **No close-all** — Users must close tabs one by one.
- **No document deletion** — Closing a tab does not remove its data from SQLite.

## Proposed Solution

### Architecture

| Component | Approach |
|-----------|----------|
| Tab list | Shared Y.Doc `"global-tabs"` via Hocuspocus; Y.Array of `{ id, title, createdAt }` |
| Active tab | localStorage per user (not synced) |
| Tab reorder | `@dnd-kit/core` + `@dnd-kit/sortable`; Playground stays first |
| Document delete | `DELETE /api/documents/[id]` Next.js API route |
| Empty doc seeding | Client seeds minimal Tiptap doc on tab creation |

### Bootstrap & Migration

| Decision | Resolution |
|----------|------------|
| **Bootstrap** | First client to connect with empty Y.Array seeds `[Playground, Untitled]` (same as current `getInitialState`). |
| **Playground in Y.Array** | Playground is stored in Y.Array at index 0, immutable. |
| **Migration** | One-time merge: on first load of `useSyncedTabs`, if `global-tabs` is empty, seed from localStorage `tinydocy-tabs` if present; otherwise use default bootstrap. |
| **activeTabId fallback** | When active tab is removed by another user, switch to playground (or first remaining tab). |

### Empty Document Seeding

- **When:** Client seeds only when `ydoc` is empty after first sync.
- **Where:** Client-side in `SimpleEditor` — when synced and `ydoc.getXmlFragment('default').length === 0`, call `editor.commands.setContent(defaultContent)`.
- **What:** Use existing `content.json` (H1 + paragraph) — minimal valid doc per schema.
- **Idempotency:** Only seed when doc is truly empty; Collaboration extension handles merge.

### API Guards

- **Delete playground:** Reject `DELETE /api/documents/playground` with 400.
- **ID validation:** Reject if empty, length > 64, control chars, path-like (`../`, `..\\`), or invalid format (must be UUID or literal `playground`). Use parameterized queries only.
- **404:** Treat as success (doc already gone).
- **Auth:** MVP unauthenticated; document as intentional; add auth before production.

### Error Handling

- **Delete failure:** Show `alert()`, keep tab in list.
- **Delete timeout:** 10s timeout; treat as failure.
- **Hocuspocus offline:** Show last known tabs; queue changes (or show offline message) — MVP: show last known, no queue.
- **activeTabId invalid:** Switch to playground when active tab is removed remotely.

## Technical Considerations

- **SQLite:** Multiple connections allowed; Hocuspocus and Next.js API share `db.sqlite` in project root.
- **Y.Array reorder:** Use `arr.delete(index, 1)` then `arr.insert(newIndex, [item])` inside `ydoc.transact()` for a single observer callback.
- **better-sqlite3:** Add `serverExternalPackages: ['better-sqlite3']` in `next.config.ts`; use WAL mode (`db.pragma('journal_mode = WAL')`); `timeout: 5000` for SQLITE_BUSY.

### Research Insights

**Y.Array:**

- Bootstrap in `onSynced` when `yarray.length === 0`; seed inside `ydoc.transact()`.
- Migration: one-time merge from localStorage when empty; clear localStorage after.
- `insert` expects array: `arr.insert(i, [item])` not `arr.insert(i, item)`.
- Use `observe` not `observeDeep` (tabs are plain objects).

**dnd-kit:**

- `horizontalListSortingStrategy` for tab bar; `sortableKeyboardCoordinates` with `KeyboardSensor`.
- `activationConstraint: { distance: 8 }` to avoid accidental drags on click.
- Resolve dragged item by `id` at drop; re-find index in current array (dnd-kit indices can be stale).

**Race conditions:**

- Derive `tabs` and `validActive` together in observe; use ref for `activeTabId` in callback.
- Close-all: parallel `Promise.allSettled` for DELETE; sequential Y.Array removal by `id` (find index immediately before delete).

## Acceptance Criteria

### Tab Sync

- [x] All users see the same tab list; changes visible within ~2 seconds.
- [x] First user to connect with empty `global-tabs` seeds Playground + Untitled.
- [x] User A creates tab → User B sees it and can open it.
- [x] Migration from localStorage to Y.Array on first load.

### Tab Reorder

- [x] User tabs are draggable; Playground stays first.
- [x] Reorder persists for other users.
- [x] dnd-kit keyboard: arrow keys move focus; Space/Enter pick/drop; Escape cancels.

### Close All

- [x] Icon-only button right of +; always visible; disabled when only playground.
- [x] Tooltip "Close all tabs".
- [x] `confirm("Close all X tabs?")` before closing.
- [x] On confirm: parallel DELETE; remove on success; on failure: batch `alert("Could not close: Tab A, Tab B")`, keep failed tabs.
- [x] After close-all: active tab switches to playground.

### Document Delete

- [x] Single tab close: call DELETE before removing from Y.Array; on failure: `alert()`, keep tab.
- [x] `DELETE /api/documents/playground` returns 400.
- [x] `DELETE /api/documents/[id]` deletes from SQLite `documents` table.

### Empty Doc Seeding

- [x] New tab creates minimal doc in Y.Doc so Hocuspocus persists it; other users can open within ~5s of creation, before typing.

## Success Metrics

- Tab sync works across two browser contexts (E2E).
- Close all and single close both succeed and fail as specified.
- Reorder persists across users.

## Dependencies & Risks

- **better-sqlite3:** Add for API route; add `serverExternalPackages: ['better-sqlite3']` in next.config.
- **@dnd-kit:** Add `@dnd-kit/core` and `@dnd-kit/sortable`.
- **E2E:** Tests may need updates for synced tabs (e.g. `EditorPage` helper).
- **global-tabs auth:** Hocuspocus accepts all connections; `global-tabs` writable by anyone. Acceptable for MVP; add `onAuthenticate` before production.
- **Deployment:** Confirm PM2 `cwd` same for both apps; `DB_PATH` env for explicit path; retry 2–3x on SQLITE_BUSY.

## Implementation Phases

### Phase 1: Synced Tabs

- [x] Add `use-synced-tabs.ts` — connect to `"global-tabs"` via Hocuspocus.
- [x] Y.Array: `{ id, title, createdAt }`; Playground at index 0.
- [x] Bootstrap in `onSynced` when empty; use `ydoc.getMap('meta').get('bootstrapped')` marker so only one client seeds; migration from localStorage when empty; clear localStorage only after sync confirmed.
- [x] Observe: derive `tabs` and `validActive` together; `validActive = tabs.some(t => t.id === activeTabId) ? activeTabId : (tabs[0]?.id ?? PLAYGROUND_ID)`.
- [x] Never render SimpleEditor when `documentId` not in `tabs`; use ref for `activeTabId` in observe callback.
- [x] `createTab`: push `{ id, title, createdAt }` to Y.Array; `id = crypto.randomUUID()`.
- [x] Persist `activeTabId` in localStorage; read on init, write on `switchTab` and when fallback applies.
- [x] `closeTab`: when closing active tab, set `activeTabId` to next tab or playground.
- [x] Expose `ready` (false until first sync); do not render SimpleEditor until ready and `documentId` in tabs.
- [x] Replace `useTabs` with `useSyncedTabs` in `app/page.tsx`; remove `use-tabs.ts` after migration.
- [x] Debounce title updates (300–500ms) before writing to Y.Array.

### Phase 2: Document Delete API

- [x] Add `better-sqlite3`; add `serverExternalPackages: ['better-sqlite3']` in `next.config.ts`.
- [x] Create `app/api/documents/[id]/route.ts` — DELETE handler.
- [x] Guard: reject `playground`; validate `id` (UUID or playground, no control chars, no path-like).
- [x] Path: `process.env.DB_PATH ?? path.join(process.cwd(), 'db.sqlite')`; WAL mode; `timeout: 5000`; retry 2–3 times on SQLITE_BUSY.
- [x] Parameterized query only: `db.prepare('DELETE FROM documents WHERE name = ?').run(id)`.

### Phase 3: Close Tab + Close All + Delete

- [x] Extend `closeTab` to call DELETE API before removing from Y.Array; if `id === PLAYGROUND_ID` return early; on failure: `alert()`, keep tab.
- [x] Add `closeAllTabs`: `confirm("Close all X tabs?")`; use `Promise.allSettled` for parallel DELETE; per-request timeout via `AbortController` (10s); on success remove from Y.Array by `id` (re-resolve index immediately before each delete); on failure keep tab; treat timeout as failure; batch failure alert: single `alert("Could not close: Tab A, Tab B")` for all failures.
- [x] Add close-all icon to `lib/icons.ts` (e.g. `LuPanelLeftClose` or `LuSquareX`); extend `TabBarProps` with `onCloseAll`; button right of +; always visible; disabled when `tabs.length <= 1`; tooltip "Close all tabs".
- [x] Skip `lib/sqlite.ts`; inline DB logic in route.

### Phase 4: Tab Reorder (dnd-kit)

- [x] Add `@dnd-kit/core` and `@dnd-kit/sortable`.
- [x] Wrap tab list in `DndContext` and `SortableContext`; use `horizontalListSortingStrategy`.
- [x] Sensors: `PointerSensor` with `activationConstraint: { distance: 8 }`, `KeyboardSensor` with `sortableKeyboardCoordinates`.
- [x] Playground: not draggable; user tabs: `useSortable`.
- [x] `onDragEnd`: resolve dragged item by `id`; `currentIndex = arr.toArray().findIndex(t => t.id === item.id)`; if -1 abort; compute target index from current array; wrap delete+insert in `ydoc.transact()`.

### Phase 5: Empty Doc Seeding

- [x] In `SimpleEditor`: when `synced && editor && !isPlayground` and `ydoc.getXmlFragment('default').length === 0`, call `editor.commands.setContent(defaultContent)` (uses existing `content.json`; Collaboration syncs to Y.Doc). Fragment name `'default'` matches Collaboration extension default; verify in implementation.
- [x] No new hooks; keep logic in SimpleEditor.

## File Structure

```
hooks/
  use-synced-tabs.ts          # Yjs-backed tab list; replaces use-tabs (remove use-tabs.ts)

app/
  api/
    documents/
      [id]/
        route.ts              # DELETE handler; inline DB, no lib/sqlite

components/
  tab-bar/
    tab-bar.tsx               # DndContext, SortableContext, close-all button
    tab-bar.scss

lib/
  icons.ts                    # Add close-all icon
```

## TypeScript Considerations

- **Y.Array<Tab>:** Use shared `Tab` type; validate migrated localStorage data with `isTab()` guard.
- **useSyncedTabs:** Explicit `UseSyncedTabsReturn`; match `useTabs` shape for TabBar compatibility.
- **DELETE route:** `params` as `Promise<{ id: string }>` (Next 15+); typed `validateDocumentId()`.
- **dnd-kit:** `DragEndEvent`; `SortableContext` items = `string[]` (tab ids); only user tabs sortable.

## Recommended Test Scenarios

### E2E (Playwright)

| Scenario | Priority |
|----------|----------|
| Tab sync two users: User A creates tab, User B sees it and can open it | Critical |
| Close single tab: DELETE succeeds, tab removed | Critical |
| Close single tab failure: mock DELETE failure, tab stays, alert shown | Important |
| Close all: multiple tabs, confirm, all removed | Critical |
| Close all partial failure: some DELETE fail, those tabs stay, alerts shown | Important |
| Close all cancel: user cancels confirm, no tabs closed | Important |
| Reorder tab: drag tab, order persists for other user | Important |
| Playground never closed: close-all disabled when only playground; single close of playground blocked | Critical |
| activeTabId fallback: User A closes User B's active tab, User B's activeTabId updates | Important |
| activeTabId fallback under load: User A closes User B's active tab while B typing; B switches to playground within one render, no phantom editor | Important |

### Unit / Integration

| Scenario | Priority |
|----------|----------|
| useSyncedTabs bootstrap: empty Y.Array → seeded with Playground + Untitled | Critical |
| Y.Array reorder: move item, indices correct | Important |
| DELETE API: success, 404, 500, timeout | Important |
| DELETE playground guard: reject `playground` | Critical |

## Architectural Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Tab list storage | Y.Doc `global-tabs` | Reuses Hocuspocus; real-time sync; matches document content pattern |
| Document delete trigger | Client-side on close | Explicit user intent; clear failure handling; disconnect ≠ delete |
| Empty doc seeding | Client-side in SimpleEditor | Matches `initialContent` pattern; avoids custom Hocuspocus extension |
| Orphan docs on crash | Accept for MVP | Client may crash before DELETE; optional cleanup job later |

## References & Research

- **Brainstorm:** [docs/brainstorms/10-tab-sync-reorder-close-all-brainstorm.md](../brainstorms/10-tab-sync-reorder-close-all-brainstorm.md)
- **Existing patterns:** `hooks/use-synced-tabs.ts`, `hooks/use-yjs-document.ts`, `components/tab-bar/tab-bar.tsx`
- **Minimal doc:** `components/tiptap-templates/simple/data/content.json`
- **Hocuspocus SQLite schema:** `documents` table `(name, data)`; delete with `DELETE FROM documents WHERE name = ?`
- **Y.Array API:** <https://docs.yjs.dev/api/shared-types/y.array>
- **dnd-kit Sortable:** <https://docs.dndkit.com/presets/sortable>
- **better-sqlite3 + Next.js:** `serverExternalPackages: ['better-sqlite3']`

## Post-Implementation (2026-03-16)

**Implemented:** All five phases complete. `use-tabs.ts` removed; `useSyncedTabs` in `app/page.tsx`.

**Code review fixes applied:**

- Debounce cleanup on unmount in `useSyncedTabs`
- `updateTabTitle` wrapped in `ydoc.transact()` for single observer callback
- Button order: + (new tab) then close-all (right of +)
- Close-all disabled: `tabs.length <= 1`

**Known limitations:**

- Close-all uses single 10s AbortController for all DELETE requests (batch-wide timeout)
- Bootstrap race: concurrent empty connects may both seed; CRDT merge handles
