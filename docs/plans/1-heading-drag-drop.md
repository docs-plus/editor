# Heading Section Drag-and-Drop Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the existing custom heading drag-and-drop with a forked `@tiptap/extension-drag-handle` architecture — floating handle outside contenteditable, `@floating-ui/dom` positioning, custom mouse events for section-level dragging, Notion-style visual feedback.

**Architecture:** Fork the Tiptap drag-handle extension's handle rendering, floating-ui positioning, and rAF-throttled mousemove detection. Replace its HTML5 DnD drag engine with custom mouse events (mousedown/mousemove/mouseup). Add section-level computation, drag ghost, drop indicator, and auto-scroll. Keep the same `HeadingDrag` extension name and import path — the editor wiring in `document-editor.tsx` stays unchanged.

**Tech Stack:** Tiptap 3, ProseMirror, `@floating-ui/dom`, TypeScript, SCSS

**Brainstorm:** `docs/brainstorms/2-heading-drag-drop-brainstorm.md`

---

## Task 1: Dependencies

**Files:**

- Modify: `package.json`

**Step 1: Install `@floating-ui/dom` as direct dependency**

```bash
bun add @floating-ui/dom
```

This must be a direct dependency, not relied on as transitive via `@floating-ui/react`.

**Step 2: Remove unused drag-and-drop packages**

```bash
bun remove @atlaskit/pragmatic-drag-and-drop @atlaskit/pragmatic-drag-and-drop-auto-scroll @tiptap/extension-drag-handle @tiptap/extension-node-range
```

Note: some of these may not be installed (they were exploratory). `bun remove` will skip missing packages without error.

**Step 3: Verify**

```bash
bun install
bunx tsc --noEmit
```

Expected: clean install, no type errors (the old `heading-drag-extension.ts` doesn't import any of the removed packages).

**Step 4: Commit**

```
chore: add @floating-ui/dom, remove unused drag-and-drop deps
```

---

## Task 2: Extract shared `computeFingerprint` helper

**Files:**

- Create: `components/tiptap-node/heading-node/helpers/compute-fingerprint.ts`
- Modify: `components/tiptap-node/heading-node/heading-scale-extension.ts`
- Modify: `components/tiptap-node/heading-node/heading-drag-extension.ts`

**Step 1: Create the shared helper**

Create `components/tiptap-node/heading-node/helpers/compute-fingerprint.ts`:

```typescript
import type { Node as PMNode } from "@tiptap/pm/model";

/**
 * Structural fingerprint: comma-joined sequence of top-level heading levels.
 * Two docs with identical fingerprints have the same heading structure and
 * can reuse mapped decorations without a full rebuild.
 */
export function computeFingerprint(doc: PMNode): string {
  const levels: number[] = [];
  doc.forEach((node) => {
    if (node.type.name === "heading") {
      levels.push(node.attrs.level as number);
    }
  });
  return levels.join(",");
}
```

**Step 2: Update `heading-scale-extension.ts`**

Remove the local `computeFingerprint` function (lines 56-64). Add import:

```typescript
import { computeFingerprint } from "@/components/tiptap-node/heading-node/helpers/compute-fingerprint";
```

Remove the old inline function and its JSDoc comment (the block starting with `/** Produces a string like...` through the closing `}`).

**Step 3: Update `heading-drag-extension.ts`**

Remove the local `computeFingerprint` function (lines 70-78). Add import:

```typescript
import { computeFingerprint } from "@/components/tiptap-node/heading-node/helpers/compute-fingerprint";
```

Remove the old inline function and its JSDoc comment.

**Step 4: Verify**

```bash
bunx tsc --noEmit
```

Expected: no type errors. Behavior unchanged — same function, just imported from shared location.

**Step 5: Commit**

```
refactor: extract computeFingerprint to shared helper
```

---

## Task 3: Create `compute-section.ts` helper

**Files:**

- Create: `components/tiptap-node/heading-node/helpers/compute-section.ts`

**Step 1: Create the helper**

This is extracted from the existing `heading-drag-extension.ts` (lines 101-119) with no changes:

```typescript
import type { Node as PMNode } from "@tiptap/pm/model";

/**
 * Compute the section range for a heading: from headingPos to the start of
 * the next top-level heading with level <= headingLevel, or end of document.
 *
 * Section = heading + everything until next same-or-higher level.
 * Standard outliner behavior (Notion, Logseq, Roam).
 */
export function computeSection(
  doc: PMNode,
  headingPos: number,
  headingLevel: number,
): { from: number; to: number } {
  let to = doc.content.size;
  let found = false;
  doc.forEach((node, pos) => {
    if (found || pos <= headingPos) return;
    if (
      node.type.name === "heading" &&
      (node.attrs.level as number) <= headingLevel
    ) {
      to = pos;
      found = true;
    }
  });
  return { from: headingPos, to };
}
```

**Step 2: Verify**

```bash
bunx tsc --noEmit
```

**Step 3: Commit**

```
feat: add computeSection helper for heading section ranges
```

---

## Task 4: Create `find-heading-from-cursor.ts` helper

**Files:**

- Create: `components/tiptap-node/heading-node/helpers/find-heading-from-cursor.ts`

**Step 1: Create the helper**

Adapted from upstream `findNextElementFromCursor.ts`. Simplified to heading-only detection:

```typescript
import type { EditorView } from "@tiptap/pm/view";

/**
 * Find the nearest top-level heading DOM element to the given cursor
 * coordinates. Returns null if no heading is near the cursor.
 *
 * Iterates top-level children of the editor DOM and checks proximity
 * by bounding rect. Only considers heading elements (H1-H6) that are
 * not the title (first child).
 *
 * Forked from @tiptap/extension-drag-handle v3.20.1 findNextElementFromCursor.ts
 * Modified: heading-only filter, simplified proximity check
 */
export function findHeadingFromCursor(
  view: EditorView,
  coords: { x: number; y: number },
): { element: HTMLElement; pos: number } | null {
  const editorDom = view.dom;
  const children = editorDom.children;
  let bestMatch: { element: HTMLElement; pos: number; distance: number } | null =
    null;

  let offset = 0;

  for (let i = 0; i < view.state.doc.content.childCount; i++) {
    const child = view.state.doc.content.child(i);
    const nodePos = offset;
    offset += child.nodeSize;

    if (i === 0) continue;
    if (child.type.name !== "heading") continue;

    const dom = children[i];
    if (!(dom instanceof HTMLElement)) continue;

    const rect = dom.getBoundingClientRect();

    if (coords.y >= rect.top && coords.y <= rect.bottom) {
      return { element: dom, pos: nodePos };
    }

    const distTop = Math.abs(coords.y - rect.top);
    const distBottom = Math.abs(coords.y - rect.bottom);
    const distance = Math.min(distTop, distBottom);

    if (!bestMatch || distance < bestMatch.distance) {
      bestMatch = { element: dom, pos: nodePos, distance };
    }
  }

  if (bestMatch && bestMatch.distance < 20) {
    return { element: bestMatch.element, pos: bestMatch.pos };
  }

  return null;
}
```

**Step 2: Verify**

```bash
bunx tsc --noEmit
```

**Step 3: Commit**

```
feat: add findHeadingFromCursor helper for cursor-based heading detection
```

---

## Task 5: Create `reposition-handle.ts` helper

**Files:**

- Create: `components/tiptap-node/heading-node/helpers/reposition-handle.ts`

**Step 1: Create the helper**

Wraps `@floating-ui/dom`'s `computePosition()`:

```typescript
import { computePosition, offset, shift } from "@floating-ui/dom";

/**
 * Position the drag handle element relative to a heading DOM element
 * using floating-ui. Places the handle to the left of the heading,
 * vertically centered.
 *
 * Forked from @tiptap/extension-drag-handle v3.20.1 drag-handle-plugin.ts repositionDragHandle
 * Modified: simplified options, heading-specific placement
 */
export async function repositionHandle(
  handleEl: HTMLElement,
  referenceEl: HTMLElement,
): Promise<void> {
  const { x, y } = await computePosition(referenceEl, handleEl, {
    placement: "left",
    middleware: [offset(4), shift({ padding: 8 })],
  });

  Object.assign(handleEl.style, {
    left: `${x}px`,
    top: `${y}px`,
  });
}
```

**Step 2: Verify**

```bash
bunx tsc --noEmit
```

**Step 3: Commit**

```
feat: add repositionHandle helper using @floating-ui/dom
```

---

## Task 6: Rewrite `heading-drag-plugin.ts` — the core ProseMirror plugin

This is the largest task. It creates the ProseMirror plugin that handles all drag behavior.

**Files:**

- Create: `components/tiptap-node/heading-node/heading-drag-plugin.ts`

**Step 1: Create the plugin file**

```typescript
/**
 * ProseMirror plugin for heading section drag-and-drop.
 *
 * Forked from @tiptap/extension-drag-handle v3.20.1 drag-handle-plugin.ts
 * Modified:
 *   - Heading-only detection (no general block drag)
 *   - Section-level dragging via computeSection
 *   - Custom mouse events instead of HTML5 DnD
 *   - Notion-style drag ghost + drop indicator
 *   - Auto-scroll during drag
 *   - Fingerprint-optimized node decorations
 */

import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { computeFingerprint } from "@/components/tiptap-node/heading-node/helpers/compute-fingerprint";
import { computeSection } from "@/components/tiptap-node/heading-node/helpers/compute-section";
import { findHeadingFromCursor } from "@/components/tiptap-node/heading-node/helpers/find-heading-from-cursor";
import { repositionHandle } from "@/components/tiptap-node/heading-node/helpers/reposition-handle";

export const headingDragPluginKey = new PluginKey("headingDrag");

const DRAG_THRESHOLD = 4;
const AUTO_SCROLL_ZONE = 50;
const AUTO_SCROLL_SPEED = 15;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DecoState {
  fingerprint: string;
  decoSet: DecorationSet;
}

interface DragInfo {
  headingPos: number;
  headingLevel: number;
  sectionFrom: number;
  sectionTo: number;
  ghostEl: HTMLElement | null;
  indicatorEl: HTMLElement | null;
  scrollInterval: number | null;
  onDocMouseMove: ((e: MouseEvent) => void) | null;
  onDocMouseUp: ((e: MouseEvent) => void) | null;
  onBlur: (() => void) | null;
  rafId: number;
}

// ---------------------------------------------------------------------------
// Per-EditorView state (WeakMap — GC-safe, no cross-instance leaks)
// ---------------------------------------------------------------------------

const dragStates = new WeakMap<EditorView, DragInfo>();

// ---------------------------------------------------------------------------
// Decoration builders
// ---------------------------------------------------------------------------

function buildHandleDecos(doc: PMNode): DecorationSet {
  const decos: Decoration[] = [];
  doc.forEach((node, pos) => {
    if (node.type.name === "heading" && pos > 0) {
      decos.push(
        Decoration.node(pos, pos + node.nodeSize, {
          class: "has-drag-handle",
        }),
      );
    }
  });
  return decos.length > 0
    ? DecorationSet.create(doc, decos)
    : DecorationSet.empty;
}

// ---------------------------------------------------------------------------
// Drag helpers
// ---------------------------------------------------------------------------

function findDropTarget(
  view: EditorView,
  clientY: number,
  sectionFrom: number,
  sectionTo: number,
): { pos: number; y: number } | null {
  const { doc } = view.state;
  const domChildren = view.dom.children;
  let result: { pos: number; y: number } | null = null;
  let offset = 0;

  for (let i = 0; i < doc.content.childCount; i++) {
    const child = doc.content.child(i);
    const nodePos = offset;
    offset += child.nodeSize;

    // Skip title H1
    if (i === 0) continue;
    // Skip nodes within the section being dragged
    if (nodePos >= sectionFrom && nodePos < sectionTo) continue;

    const dom = domChildren[i];
    if (!(dom instanceof HTMLElement)) continue;

    const rect = dom.getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) {
      return { pos: nodePos, y: rect.top };
    }

    result = { pos: offset, y: rect.bottom };
  }

  return result;
}

function applySectionFeedback(
  view: EditorView,
  from: number,
  to: number,
): void {
  const { doc } = view.state;
  const domChildren = view.dom.children;
  let offset = 0;

  for (let i = 0; i < doc.content.childCount; i++) {
    const child = doc.content.child(i);
    const nodePos = offset;
    offset += child.nodeSize;

    if (nodePos >= from && nodePos < to) {
      const dom = domChildren[i];
      if (dom instanceof HTMLElement) {
        dom.classList.add("heading-section-dragging");
      }
    }
  }
}

function createGhostElement(text: string): HTMLElement {
  const ghost = document.createElement("div");
  ghost.className = "heading-drag-ghost";
  ghost.textContent = text || "Untitled";
  document.body.appendChild(ghost);
  return ghost;
}

function positionGhost(ghost: HTMLElement, x: number, y: number): void {
  ghost.style.left = `${x + 12}px`;
  ghost.style.top = `${y - 16}px`;
}

function getScrollParent(el: HTMLElement): HTMLElement {
  let current: HTMLElement | null = el.parentElement;
  while (current) {
    const { overflowY } = getComputedStyle(current);
    if (overflowY === "auto" || overflowY === "scroll") return current;
    current = current.parentElement;
  }
  return document.documentElement;
}

function startAutoScroll(
  scrollParent: HTMLElement,
  clientY: number,
): number | null {
  const rect = scrollParent.getBoundingClientRect();
  const distTop = clientY - rect.top;
  const distBottom = rect.bottom - clientY;

  if (distTop < AUTO_SCROLL_ZONE) {
    const speed = AUTO_SCROLL_SPEED * (1 - distTop / AUTO_SCROLL_ZONE);
    return window.setInterval(() => scrollParent.scrollBy(0, -speed), 16);
  }

  if (distBottom < AUTO_SCROLL_ZONE) {
    const speed = AUTO_SCROLL_SPEED * (1 - distBottom / AUTO_SCROLL_ZONE);
    return window.setInterval(() => scrollParent.scrollBy(0, speed), 16);
  }

  return null;
}

function cleanupDrag(view: EditorView): void {
  const info = dragStates.get(view);
  if (!info) return;

  info.ghostEl?.remove();
  info.indicatorEl?.remove();
  cancelAnimationFrame(info.rafId);

  if (info.scrollInterval !== null) {
    clearInterval(info.scrollInterval);
  }

  if (info.onDocMouseMove) {
    document.removeEventListener("mousemove", info.onDocMouseMove);
  }
  if (info.onDocMouseUp) {
    document.removeEventListener("mouseup", info.onDocMouseUp);
  }
  if (info.onBlur) {
    view.dom.removeEventListener("blur", info.onBlur);
  }

  document.documentElement.classList.remove("heading-dragging");

  for (const el of view.dom.querySelectorAll(".heading-section-dragging")) {
    el.classList.remove("heading-section-dragging");
  }

  dragStates.delete(view);
}

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

export function createHeadingDragPlugin(): Plugin<DecoState> {
  let wrapperEl: HTMLElement | null = null;
  let handleEl: HTMLElement | null = null;
  let pendingMouseCoords: { x: number; y: number } | null = null;
  let mouseMoveRafId = 0;
  let currentHeadingEl: HTMLElement | null = null;

  function showHandle(): void {
    if (!handleEl) return;
    handleEl.style.visibility = "";
    handleEl.style.pointerEvents = "auto";
  }

  function hideHandle(): void {
    if (!handleEl) return;
    handleEl.style.visibility = "hidden";
    handleEl.style.pointerEvents = "none";
    currentHeadingEl = null;
  }

  function createHandleDOM(): { wrapper: HTMLElement; handle: HTMLElement } {
    const wrapper = document.createElement("div");
    wrapper.className = "heading-drag-wrapper";

    const handle = document.createElement("div");
    handle.className = "heading-drag-handle";
    handle.setAttribute("aria-label", "Drag to reorder section");

    wrapper.appendChild(handle);
    return { wrapper, handle };
  }

  return new Plugin<DecoState>({
    key: headingDragPluginKey,

    state: {
      init(_, state) {
        return {
          fingerprint: computeFingerprint(state.doc),
          decoSet: buildHandleDecos(state.doc),
        };
      },

      apply(tr, prev, _oldState, newState) {
        if (!tr.docChanged) return prev;

        const fp = computeFingerprint(newState.doc);
        if (fp === prev.fingerprint) {
          return {
            fingerprint: fp,
            decoSet: prev.decoSet.map(tr.mapping, tr.doc),
          };
        }

        return {
          fingerprint: fp,
          decoSet: buildHandleDecos(newState.doc),
        };
      },
    },

    props: {
      decorations(state) {
        return headingDragPluginKey.getState(state)?.decoSet ?? DecorationSet.empty;
      },

      handleDOMEvents: {
        mousemove(view, event) {
          // Don't reposition handle while dragging
          if (dragStates.has(view)) return false;

          pendingMouseCoords = {
            x: (event as MouseEvent).clientX,
            y: (event as MouseEvent).clientY,
          };

          cancelAnimationFrame(mouseMoveRafId);
          mouseMoveRafId = requestAnimationFrame(() => {
            if (!pendingMouseCoords || !handleEl) return;

            const match = findHeadingFromCursor(view, pendingMouseCoords);
            pendingMouseCoords = null;

            if (!match) {
              hideHandle();
              return;
            }

            currentHeadingEl = match.element;
            showHandle();
            repositionHandle(handleEl, match.element);
          });

          return false;
        },

        keydown(_view) {
          hideHandle();
          return false;
        },
      },
    },

    view(editorView) {
      const { wrapper, handle } = createHandleDOM();
      wrapperEl = wrapper;
      handleEl = handle;
      hideHandle();

      const parentEl = editorView.dom.parentElement;
      if (parentEl) {
        parentEl.style.position = "relative";
        parentEl.appendChild(wrapper);
      }

      // Hide handle when mouse leaves the editor area
      const onMouseLeave = () => hideHandle();
      parentEl?.addEventListener("mouseleave", onMouseLeave);

      // Handle mousedown on the drag handle — start drag sequence
      const onHandleMouseDown = (e: MouseEvent) => {
        if (e.button !== 0) return;
        if (!currentHeadingEl) return;

        cleanupDrag(editorView);

        const pos = editorView.posAtDOM(currentHeadingEl, 0) - 1;
        if (pos <= 0) return;

        const { doc } = editorView.state;
        const headingNode = doc.nodeAt(pos);
        if (!headingNode || headingNode.type.name !== "heading") return;

        const headingLevel = headingNode.attrs.level as number;
        const section = computeSection(doc, pos, headingLevel);
        const headingText = headingNode.textContent;

        const startX = e.clientX;
        const startY = e.clientY;
        let activated = false;

        const scrollParent = getScrollParent(editorView.dom);

        const info: DragInfo = {
          headingPos: pos,
          headingLevel,
          sectionFrom: section.from,
          sectionTo: section.to,
          ghostEl: null,
          indicatorEl: null,
          scrollInterval: null,
          onDocMouseMove: null,
          onDocMouseUp: null,
          onBlur: null,
          rafId: 0,
        };

        const onMove = (ev: MouseEvent) => {
          if (!activated) {
            const dx = ev.clientX - startX;
            const dy = ev.clientY - startY;
            if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return;

            activated = true;
            document.documentElement.classList.add("heading-dragging");
            hideHandle();
            applySectionFeedback(editorView, info.sectionFrom, info.sectionTo);
            info.ghostEl = createGhostElement(headingText);
          }

          if (info.ghostEl) {
            positionGhost(info.ghostEl, ev.clientX, ev.clientY);
          }

          // Auto-scroll
          if (info.scrollInterval !== null) {
            clearInterval(info.scrollInterval);
            info.scrollInterval = null;
          }
          info.scrollInterval = startAutoScroll(scrollParent, ev.clientY);

          // Drop indicator (rAF-throttled)
          cancelAnimationFrame(info.rafId);
          const { clientY } = ev;
          info.rafId = requestAnimationFrame(() => {
            const target = findDropTarget(
              editorView,
              clientY,
              info.sectionFrom,
              info.sectionTo,
            );

            if (!target) {
              info.indicatorEl?.remove();
              info.indicatorEl = null;
              return;
            }

            if (!info.indicatorEl) {
              info.indicatorEl = document.createElement("div");
              info.indicatorEl.className = "heading-drop-indicator";
              editorView.dom.appendChild(info.indicatorEl);
            }

            const editorRect = editorView.dom.getBoundingClientRect();
            info.indicatorEl.style.top = `${target.y - editorRect.top}px`;
          });
        };

        const onUp = (ev: MouseEvent) => {
          if (!activated) {
            cleanupDrag(editorView);
            return;
          }

          const { sectionFrom, sectionTo } = info;
          const target = findDropTarget(
            editorView,
            ev.clientY,
            sectionFrom,
            sectionTo,
          );

          cleanupDrag(editorView);

          if (
            !target ||
            target.pos === sectionFrom ||
            target.pos === sectionTo
          ) {
            return;
          }

          const { tr, doc: currentDoc } = editorView.state;
          const slice = currentDoc.slice(sectionFrom, sectionTo);

          if (target.pos < sectionFrom) {
            tr.insert(target.pos, slice.content);
            tr.delete(
              tr.mapping.map(sectionFrom),
              tr.mapping.map(sectionTo),
            );
          } else {
            tr.delete(sectionFrom, sectionTo);
            tr.insert(tr.mapping.map(target.pos), slice.content);
          }

          editorView.dispatch(tr.scrollIntoView());
        };

        const onBlur = () => {
          if (activated) {
            cleanupDrag(editorView);
          }
        };

        info.onDocMouseMove = onMove;
        info.onDocMouseUp = onUp;
        info.onBlur = onBlur;
        dragStates.set(editorView, info);

        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
        editorView.dom.addEventListener("blur", onBlur);

        e.preventDefault();
        e.stopPropagation();
      };

      handle.addEventListener("mousedown", onHandleMouseDown);

      return {
        destroy() {
          cleanupDrag(editorView);
          cancelAnimationFrame(mouseMoveRafId);
          handle.removeEventListener("mousedown", onHandleMouseDown);
          parentEl?.removeEventListener("mouseleave", onMouseLeave);
          wrapperEl?.remove();
          wrapperEl = null;
          handleEl = null;
          currentHeadingEl = null;
        },
      };
    },
  });
}
```

**Step 2: Verify**

```bash
bunx tsc --noEmit
```

**Step 3: Commit**

```
feat: add heading drag ProseMirror plugin (forked from @tiptap/extension-drag-handle v3.20.1)
```

---

## Task 7: Rewrite `heading-drag-extension.ts`

The extension entry point becomes a thin wrapper around the plugin.

**Files:**

- Modify: `components/tiptap-node/heading-node/heading-drag-extension.ts`

**Step 1: Replace the entire file**

```typescript
/**
 * HeadingDrag — drag-and-drop reordering for heading sections.
 *
 * Adds a floating drag handle beside each heading (except the title H1).
 * Dragging a heading moves its entire "section": the heading plus all
 * content below it until the next same-or-higher-level heading.
 *
 * Architecture based on @tiptap/extension-drag-handle v3.20.1:
 *   - Handle rendered outside contenteditable, positioned via @floating-ui/dom
 *   - Custom mouse events (no HTML5 DnD) for section-level drag
 *   - Notion-style visual feedback: drag ghost, drop indicator, section opacity
 *   - Fingerprint-optimized node decorations for CSS hooks
 *
 * See docs/brainstorms/2-heading-drag-drop-brainstorm.md
 */

import { Extension } from "@tiptap/core";
import { createHeadingDragPlugin } from "@/components/tiptap-node/heading-node/heading-drag-plugin";

export const HeadingDrag = Extension.create({
  name: "headingDrag",

  addProseMirrorPlugins() {
    return [createHeadingDragPlugin()];
  },
});
```

**Step 2: Verify**

```bash
bunx tsc --noEmit
```

The import path (`HeadingDrag` from `heading-drag-extension`) is unchanged, so `document-editor.tsx` needs no update.

**Step 3: Commit**

```
refactor: rewrite HeadingDrag extension as thin wrapper around forked plugin
```

---

## Task 8: Rewrite `heading-drag.scss`

Replace the old `::before` pseudo-element styles with styles for the floating handle, drag ghost, drop indicator, and section feedback.

**Files:**

- Modify: `components/tiptap-node/heading-node/heading-drag.scss`

**Step 1: Replace the entire file**

```scss
// ---------------------------------------------------------------------------
// Heading Drag — floating handle, ghost, indicator, section feedback
// ---------------------------------------------------------------------------

// Global cursor override during drag
html.heading-dragging,
html.heading-dragging * {
  cursor: grabbing !important;
  user-select: none !important;
}

// ---------------------------------------------------------------------------
// Floating handle (outside contenteditable)
// ---------------------------------------------------------------------------

.heading-drag-wrapper {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  z-index: 20;
}

.heading-drag-handle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 24px;
  border-radius: var(--tt-radius-xs, 4px);
  cursor: grab;
  opacity: 0.4;
  transition:
    opacity 0.15s ease,
    background-color 0.15s ease;
  pointer-events: auto;

  // Grip dots icon (inline SVG)
  &::before {
    content: "";
    display: block;
    width: 12px;
    height: 16px;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23888'%3E%3Ccircle cx='9' cy='5' r='2'/%3E%3Ccircle cx='15' cy='5' r='2'/%3E%3Ccircle cx='9' cy='12' r='2'/%3E%3Ccircle cx='15' cy='12' r='2'/%3E%3Ccircle cx='9' cy='19' r='2'/%3E%3Ccircle cx='15' cy='19' r='2'/%3E%3C/svg%3E");
    background-size: contain;
    background-repeat: no-repeat;
  }

  &:hover {
    opacity: 0.8;
    background-color: var(--tt-gray-light-a-100);
  }
}

.dark .heading-drag-handle {
  &::before {
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23aaa'%3E%3Ccircle cx='9' cy='5' r='2'/%3E%3Ccircle cx='15' cy='5' r='2'/%3E%3Ccircle cx='9' cy='12' r='2'/%3E%3Ccircle cx='15' cy='12' r='2'/%3E%3Ccircle cx='9' cy='19' r='2'/%3E%3Ccircle cx='15' cy='19' r='2'/%3E%3C/svg%3E");
  }

  &:hover {
    background-color: var(--tt-gray-dark-a-200);
  }
}

// ---------------------------------------------------------------------------
// Section feedback during drag
// ---------------------------------------------------------------------------

.heading-section-dragging {
  opacity: 0.4;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  border-radius: var(--tt-radius-xs, 4px);
  transition:
    opacity 0.2s ease,
    box-shadow 0.2s ease;
}

// ---------------------------------------------------------------------------
// Drop indicator
// ---------------------------------------------------------------------------

.tiptap.ProseMirror {
  position: relative;

  .heading-drop-indicator {
    position: absolute;
    left: 0;
    right: 0;
    height: 2px;
    background-color: var(--tt-brand-color-400, #3b82f6);
    border-radius: 1px;
    pointer-events: none;
    z-index: 10;
  }
}

// ---------------------------------------------------------------------------
// Drag ghost (follows cursor)
// ---------------------------------------------------------------------------

.heading-drag-ghost {
  position: fixed;
  z-index: 9999;
  padding: 6px 12px;
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: Arial, sans-serif;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--tt-gray-light-a-700, #333);
  background: var(--tt-bg-color, #fff);
  border: 1px solid var(--tt-border-color, rgba(37, 39, 45, 0.1));
  border-radius: var(--tt-radius-sm, 6px);
  box-shadow: var(
    --tt-shadow-elevated-md,
    0 4px 12px rgba(0, 0, 0, 0.08)
  );
  pointer-events: none;
  opacity: 0.9;
}

.dark .heading-drag-ghost {
  color: var(--tt-gray-dark-a-800, #ddd);
  background: var(--tt-bg-color, #0e0e11);
  border-color: var(--tt-border-color, rgba(238, 238, 246, 0.11));
}
```

**Step 2: Verify**

```bash
bun next build 2>&1 | head -20
```

Or just check the dev server renders without errors.

**Step 3: Commit**

```
style: rewrite heading drag styles for floating handle, ghost, and indicator
```

---

## Task 9: Verify and build

**Step 1: Type-check**

```bash
bunx tsc --noEmit
```

Expected: no errors.

**Step 2: Lint**

```bash
bun run check
```

Expected: no new errors. Fix any Biome issues.

**Step 3: Build**

```bash
bun run build
```

Expected: successful build.

**Step 4: Manual test**

Start dev servers:

```bash
make dev
```

Open `http://localhost:3000` in a browser. Test:

1. **Handle appears:** Hover over any heading (not the title H1). A grip-dots handle should appear to the left.
2. **Handle hides:** Move mouse away from the heading. Handle disappears. Press a key — handle disappears.
3. **Drag activation:** Click and hold the handle, move mouse > 4px. The section should dim (opacity 0.4), a drag ghost with heading text should follow the cursor.
4. **Drop indicator:** While dragging, a blue horizontal line should appear at valid drop positions as you move up/down.
5. **Drop — move down:** Drag a heading section down past another section. Release. The section should move to the new position.
6. **Drop — move up:** Drag a heading section up. Release. Verify correct placement.
7. **Undo:** Press Cmd+Z after a drag. The move should be fully reversed.
8. **Title H1 protection:** The title heading at the top should NOT show a drag handle.
9. **Nested sections:** Drag an H2 with sub-headings (H3, H4). All sub-content should move together.
10. **Adjacent same-level headings:** Drag an H2 that is immediately followed by another H2. Only the heading itself should move.
11. **Auto-scroll:** In a long document, drag a section towards the top/bottom edge of the viewport. The editor should scroll.

**Step 5: Final commit**

```
feat: heading section drag-and-drop with floating handle and Notion-style feedback
```

This is the overall feature commit if all previous tasks weren't committed separately. If they were, this step is just verification — no commit needed.

---

## File Summary

| Action | File |
|--------|------|
| Create | `components/tiptap-node/heading-node/helpers/can-map-decorations.ts` |
| Create | `components/tiptap-node/heading-node/helpers/compute-section.ts` |
| Create | `components/tiptap-node/heading-node/helpers/find-heading-from-cursor.ts` |
| Create | `components/tiptap-node/heading-node/helpers/reposition-handle.ts` |
| Create | `components/tiptap-node/heading-node/heading-drag-plugin.ts` |
| Rewrite | `components/tiptap-node/heading-node/heading-drag-extension.ts` |
| Rewrite | `components/tiptap-node/heading-node/heading-drag.scss` |
| Modify | `components/tiptap-node/heading-node/heading-scale-extension.ts` (import shared `canMapDecorations`, decoration apply logic) |
| Modify | `package.json` (add `@floating-ui/dom`, remove atlaskit + tiptap drag-handle + node-range) |
| Deleted | `components/tiptap-node/heading-node/helpers/compute-fingerprint.ts` (superseded by `can-map-decorations.ts`) |
| No change | `components/document-editor/document-editor.tsx` (import path unchanged) |

---

## Implementation Log

> Added 2026-03-10 after implementation completed.

### Task completion

| Task | Status | Notes |
|------|--------|-------|
| Task 1: Dependencies | Done | `@floating-ui/dom` added, atlaskit packages removed |
| Task 2: Shared fingerprint | Superseded | Originally extracted to `helpers/compute-fingerprint.ts`, later removed. Fingerprint approach failed to detect `DecorationSet.map()` breakage on block splits. Replaced by `helpers/can-map-decorations.ts` (step-level safety check). |
| Task 3: `computeSection` helper | Done | |
| Task 4: `findHeadingFromCursor` helper | Done | Uses `view.dom.children[i]` instead of `view.nodeDOM()` (Yjs-safe) |
| Task 5: `repositionHandle` helper | Done | |
| Task 6: Core plugin | Done | ~475 lines, includes lazy mount and parent-swap detection |
| Task 7: Extension wrapper | Done | Thin wrapper, 8 lines |
| Task 8: Styles | Done | Notion-style handle, ghost, indicator with dot endpoints, section dimming |
| Task 9: Verification | Done | Type-check and lint pass; manual browser testing verified |

### Bugs found and fixed during implementation

#### 1. Floating handle not visible — `repositionHandle` target mismatch

**Symptom:** Drag handle element existed in DOM but was invisible.

**Root cause:** `repositionHandle()` was called with `handleEl` (the inner grip icon, `position: static`) instead of `wrapperEl` (the outer container, `position: absolute`). `@floating-ui/dom`'s `computePosition` set `left`/`top` on an element that doesn't honor absolute positioning.

**Fix:** Pass `wrapperEl` to `repositionHandle()`. Update `showHandle`/`hideHandle` to control `wrapperEl.style.visibility`.

#### 2. Floating handle orphaned — Tiptap React parent-swap lifecycle

**Symptom:** Handle appeared briefly then vanished, or never appeared at all.

**Root cause:** Tiptap React v3 creates `EditorView` with a temporary internal `<div>` as parent. `EditorContent.mount()` later re-parents `view.dom` to the real container. The plugin's `view()` function appended the handle wrapper to the temporary parent, which was then detached from the DOM.

**Fix:** Implemented `mount()`/`unmountParent()` pattern. On every `update()`, `mount()` checks if `editorView.dom.parentElement` has changed from the stored `mountedParent`. If so, it tears down listeners on the old parent and re-mounts to the new one. Non-parent-specific listeners (`keydown` on `view.dom`, `mousedown` on `handleEl`) are attached once outside `mount()`.

**Learning:** This is a general issue for any ProseMirror plugin that appends DOM to `view.dom.parentElement` in Tiptap React — it must handle parent changes.

#### 3. Drop indicator stuck at page bottom

**Symptom:** Blue drop indicator line always appeared at the bottom of the page regardless of cursor position during drag.

**Root cause (DOM):** Indicator was appended to `editorView.dom` (the contenteditable). ProseMirror removes foreign DOM children during reconciliation, causing the indicator to be recreated and positioned incorrectly on each update cycle.

**Root cause (positioning):** When dragging a large section, `findDropTarget` skipped all nodes in the section range, creating a large gap. The function returned the last non-skipped node's bottom edge (near page bottom) even when the cursor was near the gap's top.

**Fix (DOM):** Append indicator to `mountedParent` (same parent as the handle wrapper, outside contenteditable).

**Fix (positioning):** Added gap-aware logic to `findDropTarget` — when cursor is between two non-skipped nodes with a gap, compute the gap midpoint and snap indicator to the closer boundary.

**Fix (styling):** Moved `.heading-drop-indicator` out of `.tiptap.ProseMirror` nesting. Added `z-index: 30`, 3px height, border-radius, and `::before`/`::after` pseudo-elements for Notion-style blue dot endpoints.

#### 4. Decoration loss on block split (Enter key after drag)

**Symptom:** After dragging a heading to a new position, pressing Enter at the end of that heading caused it to permanently lose both `--hd-size` (HeadingScale) and `has-drag-handle` (HeadingDrag) decorations. The heading reverted to default font sizing and lost its drag handle CSS hook.

**Root cause:** ProseMirror's `splitBlock` creates a `ReplaceStep` with `slice.openStart > 0`. `DecorationSet.map()` shifts the node decoration's `to` position past the newly created sibling node, producing a decoration range that no longer matches the original node's `nodeSize`. ProseMirror silently drops the mismatched decoration.

The fingerprint-based optimization (comparing heading level sequences) couldn't detect this because block splits don't change heading structure — the count and levels are identical before and after.

**Fix (iteration 1 — removed):** Added `tr.steps.length <= 1` guard to force rebuild on multi-step transactions. Insufficient because `splitBlock` is a single step.

**Fix (iteration 2 — temporary):** Removed `DecorationSet.map()` entirely — always rebuilt decorations on every `docChanged`. Correct but O(N) on every keystroke, impacting typing performance on long documents.

**Fix (iteration 3 — final):** Created `canMapDecorations(tr, oldDoc)` shared helper. Performs step-level validation: single `ReplaceStep`, no structural depth changes (`openStart === 0`, `openEnd === 0`), no cross-node-boundary deletions (`$from.sameParent($to)`), no heading content in slice. Content-only edits (typing, backspace within block) use O(log H) `map()` fast path; structural changes trigger O(N) full rebuild.

**Files changed:** Created `helpers/can-map-decorations.ts`. Updated `apply` in both `heading-drag-plugin.ts` and `heading-scale-extension.ts`. Deleted `helpers/compute-fingerprint.ts`.
