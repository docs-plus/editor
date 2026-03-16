---
date: 2026-03-16
topic: tab-sync-reorder-close-all
status: implemented
implemented: 2026-03-16
plan: docs/plans/2026-03-16-feat-tab-sync-reorder-close-all-plan.md
---

# Tab Sync, Reorder, Close All, and Document Deletion

## What We're Building

Four related improvements to the tab bar and document lifecycle:

1. **Cross-device/cross-user tab sync** — Single global workspace: all users see the same tab list, synced in real time
2. **Document persistence visibility** — New documents (tabs) appear in other browsers and for other users because the tab list is shared
3. **Tab reorder** — Drag-and-drop to reorder tabs using `@dnd-kit`
4. **Close all + delete from SQLite** — Button to close all tabs at once; when any tab closes, delete its document data from SQLite

## Root Cause Analysis

### Why documents don't appear in other browsers/users

- **Tab list is local-only** — `use-tabs` stores tabs in `localStorage` (`tinydocy-tabs`). No server, no sync.
- **Document content** — Document content (Yjs) syncs via Hocuspocus and persists in SQLite. But **tab metadata** (list, order) never leaves the client.
- **Result** — User A creates tab X. User B has no way to see tab X because the tab list is not shared. User A's document *is* persisted in SQLite when they connect; User B never sees it because they never get tab X in their tab list.

### Why documents might not persist

- Tab ID = document ID. When a tab is created, the editor mounts with `documentId={activeTabId}` and connects to Hocuspocus. Hocuspocus persists Y.Doc updates to SQLite.
- If the user reports "document not save to db", it may be:
  - A perception issue: the doc *is* saved, but the user can't see it elsewhere because tabs aren't synced.
  - Or: empty docs might not be persisted until there's content (Hocuspocus persists only when content exists — resolved: seed minimal doc on creation).

### Current architecture

| Concern | Storage | Sync |
|--------|---------|------|
| Tab list (metadata) | localStorage | None |
| Active tab | localStorage | None |
| Document content | Hocuspocus → SQLite | Yjs + WebSocket |
| Fold state | localStorage per doc | None |

## Approach 1: Shared Yjs Document for Tab List (Recommended)

**Description:** Store the global tab list in a single Yjs document (e.g. `documentId = "global-tabs"`). All users connect to this document via Hocuspocus. Tab list = Y.Array or Y.Map. CRDT sync, same as document content. No new API or backend.

**Implementation sketch:**

- New document: `"global-tabs"` — Y.Array of `{ id, title, createdAt }`; order = array index
- `useTabs` → `useSyncedTabs`: connect to Hocuspocus with `name: "global-tabs"`, read/write Y.Array
- `activeTabId` stays local (localStorage) — each user has their own active tab
- Playground tab: always first, immutable

**Pros:**

- Reuses existing Hocuspocus + Yjs. No new server.
- Real-time sync. CRDT handles concurrent edits.
- Persisted in SQLite automatically (same as other docs).

**Cons:**

- Tab list is a Yjs structure — requires careful handling of reorder (Y.Array move) and delete
- All users share one global list — no per-user or per-workspace isolation

**Best suited for:** Single global workspace, minimal new infrastructure.

---

## Approach 2: REST API + SQLite Table

**Description:** New `tabs` table in SQLite: `(id, title, order, createdAt)`. Next.js API routes: `GET/POST/PATCH/DELETE /api/tabs`. Client polls or uses Server-Sent Events for updates.

**Pros:**

- Full control. Easy to add auth, workspaces later.
- Simple CRUD semantics.

**Cons:**

- New API, new table, polling or SSE for real-time
- More code and deployment surface

**Best suited for:** When you need auth, workspaces, or more complex tab metadata.

---

## Approach 3: Hybrid — Yjs for Tab List + API for Delete

**Description:** Use Approach 1 for tab sync. Add a Next.js API route `DELETE /api/documents/:id` that deletes the row from the `documents` table when a tab is closed. Client calls this on `closeTab`.

**Pros:**

- Tab sync via Yjs (simple)
- Explicit delete control (no server extension needed)

**Cons:**

- Requires DB access from Next.js (e.g. `better-sqlite3`). SQLite allows multiple connections; Hocuspocus and Next.js can share the same file.

**Best suited for:** When you want explicit document deletion without customizing Hocuspocus.

---

## Recommendation: Approach 1 + 3

- **Tab sync:** Shared Yjs document `"global-tabs"` for tab list. Reuse Hocuspocus.
- **Document delete:** Next.js API route that deletes from `documents` table when tab closes. Call from `closeTab` and from "close all" handler.

---

## Tab Reorder (dnd-kit)

**Description:** Add `@dnd-kit/core`, `@dnd-kit/sortable`, and `@dnd-kit/modifiers`. Wrap tab list in `DndContext` and `SortableContext`; use `restrictToHorizontalAxis` so tabs reorder only horizontally. Playground tab is not draggable (stays first); only user tabs use `useSortable`. On `onDragEnd`, update `tabs` order in the Y.Array (or shared state).

**Pros:**

- Well-maintained, accessible, keyboard support
- Fits existing tab bar structure

**Cons:**

- New dependency (~15–20 KB)

**Best suited for:** Standard DnD UX; user explicitly requested dnd-kit.

---

## Close All + Delete from SQLite

**Description:**

- **Close all button:** Icon-only button to the right of + button; always visible, disabled when only playground exists; tooltip "Close all tabs". Shows `confirm("Close all X tabs?")` before closing. On confirm, new `closeAllTabs` handler: for each non-playground tab, call delete API; on success remove from Y.Array; on failure keep tab and show `alert()`. Process all tabs (continue on failure).
- **Delete on close:** When tab closes (individual or via close all), call `DELETE /api/documents/:id` before removing from tab list. If API fails, show `alert()` and keep tab in list.

**SQLite schema (existing):**

```sql
CREATE TABLE IF NOT EXISTS "documents" (
  "name" varchar(255) NOT NULL,
  "data" blob NOT NULL,
  UNIQUE(name)
)
```

Delete: `DELETE FROM documents WHERE name = ?`

**Edge cases:**

- Playground tab: never closed, never deleted
- Last user tab: closing all leaves only playground
- Concurrent close: two users close same tab — both call delete; second is no-op

---

## Key Decisions

### Tab Sync

- **Storage:** Y.Doc `"global-tabs"` via Hocuspocus
- **Structure:** Y.Array of `{ id, title, createdAt }` — order is array index (no separate order field)
- **Active tab:** localStorage per user (not synced)
- **Playground:** Always first, immutable, cannot be closed

### Reorder

- **Library:** `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/modifiers`
- **Constraint:** Horizontal only (`restrictToHorizontalAxis`)
- **Update:** On drag end, reorder Y.Array (move item to new index)

### Close All + Delete

- **Close all:** Button shows confirmation dialog, then closes all non-playground tabs
- **Delete:** API route `DELETE /api/documents/:id` deletes from SQLite
- **Delete failure:** Show `alert()` and keep tab in list; do not remove tab from UI if delete fails

### Document Persistence

- **New documents:** When user creates tab, `createTab` adds to Y.Array. Editor mounts, connects to Hocuspocus with `name: tab.id`. Hocuspocus persists when content is added.
- **Empty docs:** Hocuspocus persists only when content exists. Seed minimal empty document (e.g. default Tiptap doc structure) on tab creation so the doc exists in SQLite for other users to open before any typing.

---

## Open Questions

None — all questions resolved.

---

## Resolved Questions

1. **Sync scope:** Cross-device and cross-user (not just same-device tabs)
2. **Workspace model:** Single global workspace — everyone shares one tab list
3. **Empty document persistence:** Hocuspocus persists only when content is added — seed minimal empty document on tab creation so doc exists in SQLite for other users to open
4. **Close all behavior:** Show confirmation dialog (e.g. "Close all X tabs?") before closing
5. **Delete failure:** Show `alert()` and keep tab in list if delete API fails
6. **Close-all confirmation UI:** Use browser `confirm()` — simple, no extra components
7. **Close-all partial failure:** Continue closing others; for each failed delete, keep that tab and show one `alert()` per failure
8. **Close-all button placement:** Right of the + (new tab) button
9. **Close-all visibility:** Always visible; disabled when only playground tab exists
10. **Close-all shortcut:** No keyboard shortcut — button only
11. **Tab reorder scope:** Playground stays first; only user tabs are draggable/reorderable
12. **Close-all button:** Icon only with tooltip (e.g. "Close all tabs")

---

## File Structure (Proposed)

```
hooks/
  use-synced-tabs.ts          # Yjs-backed tab list (use-tabs.ts removed)

app/
  api/
    documents/
      [id]/
        route.ts             # DELETE handler; reads db.sqlite from project root (same cwd as Hocuspocus)

components/
  tab-bar/
    tab-bar.tsx              # DndContext, SortableContext, SortableTab, close-all button
    tab-bar.scss

lib/
  icons.ts                   # PanelLeftCloseIcon for close-all
```

---

## Implementation Status

**Implemented 2026-03-16.** See [docs/plans/2026-03-16-feat-tab-sync-reorder-close-all-plan.md](../plans/2026-03-16-feat-tab-sync-reorder-close-all-plan.md). DB logic inlined in DELETE route; no `lib/sqlite.ts`.
