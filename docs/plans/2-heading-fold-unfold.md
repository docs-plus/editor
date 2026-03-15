# Heading Fold/Unfold Implementation Plan

> **Status:** SUPERSEDED — All 10 tasks were completed under this plan, then the architecture was fully re-designed on 2026-03-11. The overlay-based approach described here was replaced with a `Decoration.node()` + `Decoration.widget()` architecture. See the [refactor plan](3-refactor-fold-overlay-to-decoration-plan.md) for the current implementation.
>
> This document is retained as historical context. The Post-Implementation section at the bottom documents issues encountered under the original architecture that motivated the re-design.

**Goal:** Add fold/unfold capability to heading sections with a paper crinkle animation effect, controlled via TOC sidebar chevrons.

**Architecture (original, superseded):** ProseMirror plugin with a `view` component that manages all DOM — crinkle SVG overlays (absolutely positioned in the editor wrapper) and content hiding (CSS classes + heading margin-bottom as spacer). Fold state persisted per-user per-document in localStorage, keyed by heading `data-toc-id`. TOC sidebar renders fold toggles and hides children of folded headings.

**Tech Stack (original, superseded):** ProseMirror plugin API, SVG for crinkle rendering, CSS transitions for fold/unfold animation, localStorage for persistence. Overlay positioned via manual absolute positioning (same container as HeadingDrag wrapper).

**Brainstorm:** `docs/brainstorms/3-heading-fold-unfold-brainstorm.md`

---

## File Overview

| Action | File | Purpose |
|--------|------|---------|
| Create | `components/tiptap-node/heading-node/helpers/fold-storage.ts` | localStorage read/write for fold state |
| Create | `components/tiptap-node/heading-node/helpers/crinkle-renderer.ts` | SVG crinkle strip generator |
| Create | `components/tiptap-node/heading-node/heading-fold-plugin.ts` | ProseMirror plugin (state, view, cursor skip) |
| Create | `components/tiptap-node/heading-node/heading-fold-extension.ts` | Tiptap extension (commands, plugin registration) |
| Create | `components/tiptap-node/heading-node/heading-fold.scss` | Styles for fold visual state |
| Modify | `components/tiptap-icons.ts` | Add `ChevronRightIcon` export |
| Modify | `components/toc-sidebar/toc-sidebar.tsx` | Add fold chevrons, child filtering |
| Modify | `components/toc-sidebar/toc-sidebar.scss` | Chevron toggle styles |
| Modify | `components/tiptap-templates/simple/simple-editor.tsx` | Register HeadingFold, wire fold state to TOC |

---

## Key Architectural Concepts

### Content Hiding via Margin Compensation

When a section folds, content nodes get `display: none` (instant layout collapse). To prevent a visual jump, the heading's `margin-bottom` is set to the captured content height, then animated down to `~45px` (crinkle strip height). This creates smooth folding without inserting DOM nodes into the contenteditable.

```
BEFORE FOLD:
  [H2 heading]           margin-bottom: normal
  [paragraph 1]          visible
  [paragraph 2]          visible
  [H2 next section]

DURING FOLD ANIMATION:
  [H2 heading]           margin-bottom: contentHeight → 45px (transitioning)
  [paragraph 1]          display: none (behind overlay)
  [paragraph 2]          display: none (behind overlay)
  [crinkle overlay]      absolutely positioned, covers margin gap
  [H2 next section]

AFTER FOLD:
  [H2 heading]           margin-bottom: 45px
  [paragraph 1]          display: none
  [paragraph 2]          display: none
  [crinkle overlay]      visible, 45px, shows crinkle SVG
  [H2 next section]
```

### Overlay Positioning

The crinkle overlay is an absolutely positioned `<div>` inside `view.dom.parentElement` (same container as the HeadingDrag wrapper). It's positioned relative to the heading DOM element's bottom edge, spanning the editor content width. Because it's outside contenteditable, ProseMirror never touches it.

### Fold State Flow

```
User clicks TOC chevron
  → editor.commands.toggleFold(headingId)
    → dispatch tr with meta { type: 'toggle', id }
      → plugin.state.apply() updates foldedIds
        → plugin.view.update() applies/removes DOM changes
          → extension calls onFoldChange(newFoldedIds) → React state
            → TOCSidebar re-renders with updated foldedIds
```

### Section Hierarchy

Folding an H3 folds everything until the next heading with level ≤ 3 (i.e., the next H3, H2, or H1). This uses the existing `computeSection(doc, headingPos, headingLevel)` helper. Child headings (H4, H5, H6 within the section) are folded along with their content — they are inside the section boundary.

---

## Task 1: Fold Storage Helpers

**Files:**

- Create: `components/tiptap-node/heading-node/helpers/fold-storage.ts`

**Step 1: Create the fold storage module**

```typescript
// components/tiptap-node/heading-node/helpers/fold-storage.ts

const STORAGE_PREFIX = "tinydocy-folds-";

export function loadFoldedIds(documentId: string): Set<string> {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${documentId}`);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === "string"));
  } catch {
    return new Set();
  }
}

export function saveFoldedIds(
  documentId: string,
  foldedIds: Set<string>,
): void {
  try {
    if (foldedIds.size === 0) {
      localStorage.removeItem(`${STORAGE_PREFIX}${documentId}`);
    } else {
      localStorage.setItem(
        `${STORAGE_PREFIX}${documentId}`,
        JSON.stringify([...foldedIds]),
      );
    }
  } catch {
    // localStorage may be full or unavailable
  }
}
```

**Step 2: Verify**

Run `bun biome check components/tiptap-node/heading-node/helpers/fold-storage.ts` — should pass with no errors.

**Step 3: Commit**

```
feat(fold): add localStorage helpers for fold state persistence
```

---

## Task 2: SVG Crinkle Renderer

**Files:**

- Create: `components/tiptap-node/heading-node/helpers/crinkle-renderer.ts`

**Step 1: Create the crinkle SVG renderer**

This function creates an SVG element that renders a paper accordion fold effect. The effect uses alternating parallelogram-shaped strips with light/shadow gradients to simulate physical paper folds.

The SVG should:

- Accept `width` and `height` parameters
- Render 8-10 horizontal fold strips
- Use alternating light/shadow fills to simulate 3D paper folds
- Include subtle gradient shadows on fold edges
- Support light/dark mode via CSS custom properties
- Return an `SVGSVGElement` that can be appended to a container

```typescript
// components/tiptap-node/heading-node/helpers/crinkle-renderer.ts

const FOLD_COUNT = 8;
const NS = "http://www.w3.org/2000/svg";
let instanceCounter = 0;

export function createCrinkleSvg(width: number, height: number): SVGSVGElement {
  const uid = `crinkle-${++instanceCounter}`;
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("preserveAspectRatio", "none");
  svg.style.display = "block";
  svg.style.width = "100%";
  svg.style.height = "100%";

  const defs = document.createElementNS(NS, "defs");
  svg.appendChild(defs);

  const mountainId = `${uid}-mountain`;
  const valleyId = `${uid}-valley`;

  const mountainGrad = createLinearGradient(mountainId, [
    { offset: "0%", color: "rgba(0,0,0,0.03)" },
    { offset: "50%", color: "rgba(0,0,0,0)" },
    { offset: "100%", color: "rgba(0,0,0,0.06)" },
  ]);
  defs.appendChild(mountainGrad);

  const valleyGrad = createLinearGradient(valleyId, [
    { offset: "0%", color: "rgba(0,0,0,0.08)" },
    { offset: "50%", color: "rgba(0,0,0,0.02)" },
    { offset: "100%", color: "rgba(0,0,0,0.1)" },
  ]);
  defs.appendChild(valleyGrad);

  const stripHeight = height / FOLD_COUNT;

  for (let i = 0; i < FOLD_COUNT; i++) {
    const y = i * stripHeight;
    const rect = document.createElementNS(NS, "rect");
    rect.setAttribute("x", "0");
    rect.setAttribute("y", String(y));
    rect.setAttribute("width", String(width));
    rect.setAttribute("height", String(stripHeight));
    rect.setAttribute(
      "fill",
      i % 2 === 0 ? `url(#${mountainId})` : `url(#${valleyId})`,
    );
    svg.appendChild(rect);

    // Fold edge line
    if (i > 0) {
      const line = document.createElementNS(NS, "line");
      line.setAttribute("x1", "0");
      line.setAttribute("y1", String(y));
      line.setAttribute("x2", String(width));
      line.setAttribute("y2", String(y));
      line.setAttribute("stroke", "rgba(0,0,0,0.08)");
      line.setAttribute("stroke-width", "0.5");
      svg.appendChild(line);
    }
  }

  return svg;
}

function createLinearGradient(
  id: string,
  stops: { offset: string; color: string }[],
): SVGLinearGradientElement {
  const grad = document.createElementNS(NS, "linearGradient");
  grad.setAttribute("id", id);
  grad.setAttribute("x1", "0");
  grad.setAttribute("y1", "0");
  grad.setAttribute("x2", "0");
  grad.setAttribute("y2", "1");
  for (const stop of stops) {
    const s = document.createElementNS(NS, "stop");
    s.setAttribute("offset", stop.offset);
    s.setAttribute("stop-color", stop.color);
    grad.appendChild(s);
  }
  return grad;
}
```

**Important:** This is the initial version. The crinkle visual will be refined iteratively after the full pipeline works. Start with clear gradient strips and fold edge lines. Polish the SVG later.

**Step 2: Verify**

Run `bun biome check components/tiptap-node/heading-node/helpers/crinkle-renderer.ts` — should pass.

**Step 3: Commit**

```
feat(fold): add SVG crinkle strip renderer
```

---

## Task 3: Heading Fold Plugin — Skeleton with Instant Fold/Unfold

The core plugin. This task builds the plugin skeleton: state management, view mount/unmount, and **instant** (no animation) fold/unfold. Animation is added in Task 8. Cursor skip is added in Task 9.

**Files:**

- Create: `components/tiptap-node/heading-node/heading-fold-plugin.ts`

**Step 1: Create plugin with types and exports**

```typescript
// components/tiptap-node/heading-node/heading-fold-plugin.ts

import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { computeSection } from "@/components/tiptap-node/heading-node/helpers/compute-section";
import { createCrinkleSvg } from "@/components/tiptap-node/heading-node/helpers/crinkle-renderer";
import { saveFoldedIds } from "@/components/tiptap-node/heading-node/helpers/fold-storage";

export const headingFoldPluginKey = new PluginKey<HeadingFoldState>(
  "headingFold",
);

const CRINKLE_HEIGHT = 45;

/**
 * Measure total content height using the offset between heading bottom and
 * last content node bottom. This correctly accounts for inter-node margins
 * and margin collapse (unlike summing individual getBoundingClientRect heights).
 */
function measureContentHeight(headingEl: HTMLElement, contentNodes: HTMLElement[]): number {
  if (contentNodes.length === 0) return 0;
  const headingBottom = headingEl.getBoundingClientRect().bottom;
  const lastBottom = contentNodes[contentNodes.length - 1].getBoundingClientRect().bottom;
  return lastBottom - headingBottom;
}

interface HeadingFoldMeta {
  type: "toggle" | "set";
  id?: string;
  ids?: Set<string>;
}

interface HeadingFoldState {
  foldedIds: Set<string>;
}

export interface HeadingFoldPluginOptions {
  documentId: string;
  initialFoldedIds: Set<string>;
  onFoldChange?: (foldedIds: Set<string>) => void;
}

export function createHeadingFoldPlugin(
  options: HeadingFoldPluginOptions,
): Plugin<HeadingFoldState> {
  // ... steps 2-5 below
}
```

**Step 2: Implement plugin state (init and apply)**

The `init` populates from `initialFoldedIds` (loaded from localStorage by the extension). The `apply` reads transaction meta for fold changes.

```typescript
state: {
  init(): HeadingFoldState {
    return { foldedIds: new Set(options.initialFoldedIds) };
  },

  apply(tr, prev): HeadingFoldState {
    const meta = tr.getMeta(headingFoldPluginKey) as
      | HeadingFoldMeta
      | undefined;
    if (!meta) return prev;

    const next = new Set(prev.foldedIds);
    if (meta.type === "toggle" && meta.id) {
      if (next.has(meta.id)) {
        next.delete(meta.id);
      } else {
        next.add(meta.id);
      }
    } else if (meta.type === "set" && meta.ids) {
      return { foldedIds: meta.ids };
    }
    return { foldedIds: next };
  },
},
```

**Step 3: Implement plugin view — instant fold/unfold (no animation)**

The view manages overlay DOM elements and content visibility. It follows the HeadingDrag `mount()` / `unmountParent()` pattern for Tiptap React re-parenting.

Key data structures in the view closure:

```typescript
let mountedParent: HTMLElement | null = null;
const overlayMap = new Map<string, HTMLElement>(); // headingId → overlay element
const contentHeightMap = new Map<string, number>(); // headingId → measured content height (for unfold)
let prevFoldedIds = new Set(options.initialFoldedIds);
```

The `update()` method diffs `prevFoldedIds` against current `foldedIds` to determine what changed:

```typescript
update(view) {
  mount(view); // handle re-parenting

  const currentState = headingFoldPluginKey.getState(view.state);
  if (!currentState) return;
  const { foldedIds } = currentState;

  // Determine what changed
  const justFolded = [...foldedIds].filter((id) => !prevFoldedIds.has(id));
  const justUnfolded = [...prevFoldedIds].filter((id) => !foldedIds.has(id));
  const stillFolded = [...foldedIds].filter((id) => prevFoldedIds.has(id));

  // Apply folds (instant — no animation in this task)
  for (const id of justFolded) {
    applyFold(view, id);
  }

  // Remove folds
  for (const id of justUnfolded) {
    removeFold(view, id);
  }

  // Reposition existing overlays (heading may have moved)
  for (const id of stillFolded) {
    repositionOverlay(view, id);
  }

  // Prune stale IDs (heading deleted from doc)
  pruneStaleIds(view, foldedIds);

  // Notify React and persist
  if (justFolded.length > 0 || justUnfolded.length > 0) {
    options.onFoldChange?.(foldedIds);
    saveFoldedIds(options.documentId, foldedIds);
  }

  prevFoldedIds = new Set(foldedIds);
},
```

**Step 4: Implement `applyFold()` — instant version**

```typescript
function applyFold(view: EditorView, headingId: string): void {
  const { headingEl, contentNodes } = findSectionDom(view, headingId);
  if (!headingEl) return;

  // 1. Measure content height before hiding (store for unfold)
  const contentHeight = measureContentHeight(contentNodes);
  contentHeightMap.set(headingId, contentHeight);

  // 2. Hide content nodes
  for (const node of contentNodes) {
    node.classList.add("heading-fold-hidden");
  }

  // 3. Set heading margin-bottom as spacer
  headingEl.classList.add("heading-section-folded");
  headingEl.style.marginBottom = `${CRINKLE_HEIGHT}px`;

  // 4. Create and position crinkle overlay
  const overlay = createOverlayElement(view, headingEl);
  overlayMap.set(headingId, overlay);
}
```

**Step 5: Implement `findSectionDom()` helper**

Maps a heading `data-id` to its DOM element and section content DOM nodes:

```typescript
function findSectionDom(
  view: EditorView,
  headingId: string,
): { headingEl: HTMLElement | null; contentNodes: HTMLElement[]; headingPos: number } {
  const { doc } = view.state;
  const domChildren = view.dom.children;
  let offset = 0;

  for (let i = 0; i < doc.content.childCount; i++) {
    const child = doc.content.child(i);
    const pos = offset;
    offset += child.nodeSize;

    if (
      child.type.name === "heading" &&
      child.attrs["data-id"] === headingId
    ) {
      const headingEl = domChildren[i] as HTMLElement;
      const headingLevel = child.attrs.level as number;
      const section = computeSection(doc, pos, headingLevel);

      // Collect content DOM nodes (skip the heading itself)
      const contentNodes: HTMLElement[] = [];
      let contentOffset = pos + child.nodeSize;
      let j = i + 1;
      while (contentOffset < section.to && j < doc.content.childCount) {
        const dom = domChildren[j];
        if (dom instanceof HTMLElement) contentNodes.push(dom);
        contentOffset += doc.content.child(j).nodeSize;
        j++;
      }

      return { headingEl, contentNodes, headingPos: pos };
    }
  }
  return { headingEl: null, contentNodes: [], headingPos: -1 };
}
```

Note: heading `data-id` comes from the UniqueID extension. Access it via `child.attrs["data-id"]` on the ProseMirror node, which maps to `element.dataset.id` on the DOM.

**Step 6: Implement `createOverlayElement()` and `repositionOverlay()`**

```typescript
function createOverlayElement(view: EditorView, headingEl: HTMLElement): HTMLElement {
  const parentEl = mountedParent ?? view.dom.parentElement;
  if (!parentEl) throw new Error("No parent for overlay");

  const overlay = document.createElement("div");
  overlay.className = "heading-fold-overlay heading-fold-overlay--settled";

  // Position below heading
  const parentRect = parentEl.getBoundingClientRect();
  const headingRect = headingEl.getBoundingClientRect();
  const editorRect = view.dom.getBoundingClientRect();

  overlay.style.top = `${headingRect.bottom - parentRect.top}px`;
  overlay.style.left = `${editorRect.left - parentRect.left}px`;
  overlay.style.width = `${editorRect.width}px`;
  overlay.style.height = `${CRINKLE_HEIGHT}px`;

  // Add crinkle SVG
  const svg = createCrinkleSvg(editorRect.width, CRINKLE_HEIGHT);
  overlay.appendChild(svg);

  parentEl.appendChild(overlay);
  return overlay;
}

function repositionOverlay(view: EditorView, headingId: string): void {
  const overlay = overlayMap.get(headingId);
  if (!overlay) return;

  const { headingEl } = findSectionDom(view, headingId);
  if (!headingEl) { removeFold(view, headingId); return; }

  const parentEl = mountedParent ?? view.dom.parentElement;
  if (!parentEl) return;

  const parentRect = parentEl.getBoundingClientRect();
  const headingRect = headingEl.getBoundingClientRect();
  const editorRect = view.dom.getBoundingClientRect();

  overlay.style.top = `${headingRect.bottom - parentRect.top}px`;
  overlay.style.left = `${editorRect.left - parentRect.left}px`;
  overlay.style.width = `${editorRect.width}px`;
}
```

**Step 7: Implement `removeFold()` and `pruneStaleIds()`**

```typescript
function removeFold(view: EditorView, headingId: string): void {
  const overlay = overlayMap.get(headingId);
  overlay?.remove();
  overlayMap.delete(headingId);
  contentHeightMap.delete(headingId);

  const { headingEl, contentNodes } = findSectionDom(view, headingId);
  if (headingEl) {
    headingEl.classList.remove("heading-section-folded");
    headingEl.style.marginBottom = "";
  }
  for (const node of contentNodes) {
    node.classList.remove("heading-fold-hidden");
  }
}

function pruneStaleIds(view: EditorView, foldedIds: Set<string>): void {
  for (const id of foldedIds) {
    const { headingEl } = findSectionDom(view, id);
    if (!headingEl) {
      // Heading was deleted — dispatch removal
      const { tr } = view.state;
      const next = new Set(foldedIds);
      next.delete(id);
      tr.setMeta(headingFoldPluginKey, { type: "set", ids: next });
      view.dispatch(tr);
      return; // re-enter update() via dispatch
    }
  }
}
```

**Step 8: Implement `mount()` / `unmountParent()` / `destroy()`**

Follow the exact pattern from `heading-drag-plugin.ts` lines 397-451:

- `mount()`: check `view.dom.parentElement`, unmount old if changed, append overlays, set `position: relative`
- `unmountParent()`: remove all overlays from old parent
- `destroy()`: clean up all overlays, remove classes from all content nodes

**Step 9: Verify**

Run `bun biome check components/tiptap-node/heading-node/heading-fold-plugin.ts` — fix any lint issues.

**Step 10: Commit**

```
feat(fold): add heading fold ProseMirror plugin with instant fold/unfold
```

---

## Task 4: Heading Fold Extension

**Files:**

- Create: `components/tiptap-node/heading-node/heading-fold-extension.ts`

**Step 1: Create the Tiptap extension**

The extension:

- Accepts options: `documentId`, `onFoldChange`
- Loads initial fold state from localStorage
- Registers the ProseMirror plugin
- Adds commands: `toggleFold(id)`, `foldHeading(id)`, `unfoldHeading(id)`

```typescript
// components/tiptap-node/heading-node/heading-fold-extension.ts

import { Extension } from "@tiptap/core";
import {
  createHeadingFoldPlugin,
  headingFoldPluginKey,
} from "@/components/tiptap-node/heading-node/heading-fold-plugin";
import { loadFoldedIds } from "@/components/tiptap-node/heading-node/helpers/fold-storage";

export interface HeadingFoldOptions {
  documentId: string;
  onFoldChange?: (foldedIds: Set<string>) => void;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    headingFold: {
      toggleFold: (headingId: string) => ReturnType;
      foldHeading: (headingId: string) => ReturnType;
      unfoldHeading: (headingId: string) => ReturnType;
    };
  }
}

export const HeadingFold = Extension.create<HeadingFoldOptions>({
  name: "headingFold",

  addOptions() {
    return {
      documentId: "default",
      onFoldChange: undefined,
    };
  },

  addCommands() {
    return {
      toggleFold:
        (headingId: string) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(headingFoldPluginKey, {
              type: "toggle",
              id: headingId,
            });
            dispatch(tr);
          }
          return true;
        },
      foldHeading:
        (headingId: string) =>
        ({ tr, dispatch, state }) => {
          const pluginState = headingFoldPluginKey.getState(state);
          if (pluginState?.foldedIds.has(headingId)) return false;
          if (dispatch) {
            tr.setMeta(headingFoldPluginKey, {
              type: "toggle",
              id: headingId,
            });
            dispatch(tr);
          }
          return true;
        },
      unfoldHeading:
        (headingId: string) =>
        ({ tr, dispatch, state }) => {
          const pluginState = headingFoldPluginKey.getState(state);
          if (!pluginState?.foldedIds.has(headingId)) return false;
          if (dispatch) {
            tr.setMeta(headingFoldPluginKey, {
              type: "toggle",
              id: headingId,
            });
            dispatch(tr);
          }
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const initialFoldedIds = loadFoldedIds(this.options.documentId);
    return [
      createHeadingFoldPlugin({
        documentId: this.options.documentId,
        initialFoldedIds,
        onFoldChange: this.options.onFoldChange,
      }),
    ];
  },
});
```

**Step 2: Verify**

Run `bun biome check components/tiptap-node/heading-node/heading-fold-extension.ts` — should pass.

**Step 3: Commit**

```
feat(fold): add HeadingFold Tiptap extension with toggle commands
```

---

## Task 5: Heading Fold SCSS

**Files:**

- Create: `components/tiptap-node/heading-node/heading-fold.scss`

**Step 1: Create fold styles**

```scss
// Folded heading — extra margin-bottom compensates for hidden content
.heading-section-folded {
  transition: margin-bottom var(--tt-fold-duration, 350ms)
    var(--tt-transition-easing-cubic);
}

// Hidden content nodes inside a folded section
.heading-fold-hidden {
  display: none !important;
}

// Crinkle overlay container
.heading-fold-overlay {
  position: absolute;
  pointer-events: none;
  z-index: 10;
  overflow: hidden;
  border-radius: var(--tt-radius-xs);
  background: var(--tt-bg-color, #fff);
  box-shadow:
    inset 0 1px 2px rgba(0, 0, 0, 0.06),
    inset 0 -1px 2px rgba(0, 0, 0, 0.06);
  transition:
    height var(--tt-fold-duration, 350ms) var(--tt-transition-easing-cubic),
    opacity var(--tt-fold-duration, 350ms) ease;

  .dark & {
    background: var(--tt-bg-color, #0e0e11);
    box-shadow:
      inset 0 1px 2px rgba(255, 255, 255, 0.04),
      inset 0 -1px 2px rgba(255, 255, 255, 0.04);
  }
}

// Animation state: folding in progress
.heading-fold-overlay--animating {
  pointer-events: none;
}

// Settled fold state (animation complete)
.heading-fold-overlay--settled {
  cursor: pointer;
  pointer-events: auto;

  &:hover {
    box-shadow:
      inset 0 1px 3px rgba(0, 0, 0, 0.08),
      inset 0 -1px 3px rgba(0, 0, 0, 0.08),
      0 0 0 1px var(--tt-border-color-tint);
  }
}
```

**Step 2: Verify**

No Biome check for SCSS (Biome handles TS/JSON/CSS). Visual verification comes in integration.

**Step 3: Commit**

```
feat(fold): add heading fold SCSS styles
```

---

## Task 6: TOC Sidebar — Fold Chevrons and Child Filtering

**Files:**

- Modify: `components/tiptap-icons.ts` (line 9 area — add `ChevronRightIcon`)
- Modify: `components/toc-sidebar/toc-sidebar.tsx`
- Modify: `components/toc-sidebar/toc-sidebar.scss`

**Step 1: Add `ChevronRightIcon` to the icon barrel**

In `components/tiptap-icons.ts`, add after the existing `LuChevronDown` export:

```typescript
LuChevronRight as ChevronRightIcon,
```

**Step 2: Update TOCSidebar props and fold filtering**

The TOCSidebar needs:

- `foldedIds: Set<string>` prop — which headings are folded
- `onToggleFold: (id: string) => void` prop — callback to toggle fold
- Filter logic: hide items whose ancestor is folded

The filtering algorithm:

1. Walk items in order
2. Maintain a stack of "fold boundaries" — when we encounter a folded heading, push `{ level, id }` onto the stack
3. For each subsequent item, if its level is greater than the top of stack's level, hide it (it's a child of a folded heading)
4. When we encounter an item at the same or higher level as the top of stack, pop the stack

```typescript
interface TOCSidebarProps {
  items: TableOfContentData;
  editor: Editor | null;
  foldedIds: Set<string>;
  onToggleFold: (id: string) => void;
}

function filterItemsByFoldState(
  items: TableOfContentData,
  foldedIds: Set<string>,
): { visible: TableOfContentData; foldableIds: Set<string> } {
  const visible: TableOfContentData = [];
  const foldableIds = new Set<string>();

  // Pass 1: determine which items are foldable
  // A heading is foldable if the next item has a strictly greater level
  // (i.e., it has at least one child heading). Title H1 (index 0) excluded.
  for (let i = 0; i < items.length; i++) {
    if (i === 0) continue; // title H1 — never foldable
    const next = items[i + 1];
    if (next && next.level > items[i].level) {
      foldableIds.add(items[i].id);
    }
  }

  // Pass 2: filter visibility based on fold state
  // Use a stack to track active fold boundaries.
  // When a folded heading is encountered, push its level.
  // All subsequent items with level > stack top are hidden.
  // When an item with level <= stack top is found, pop the stack.
  const foldStack: number[] = [];

  for (const item of items) {
    // Pop fold boundaries that this item escapes
    while (
      foldStack.length > 0 &&
      item.level <= foldStack[foldStack.length - 1]
    ) {
      foldStack.pop();
    }

    // If inside a fold boundary, skip (hidden)
    if (foldStack.length > 0) continue;

    // This item is visible
    visible.push(item);

    // If this item is folded, push its level to hide children
    if (foldedIds.has(item.id)) {
      foldStack.push(item.level);
    }
  }

  return { visible, foldableIds };
}
```

**Step 3: Render fold chevrons**

For each TOC item that is foldable (has children), render a chevron button before the text:

```tsx
<div className="toc-sidebar-item-row">
  {isFoldable && (
    <button
      type="button"
      className={cn(
        "toc-sidebar-fold-toggle",
        foldedIds.has(item.id) && "toc-sidebar-fold-toggle--folded",
      )}
      onClick={(e) => {
        e.stopPropagation();
        onToggleFold(item.id);
      }}
      aria-label={foldedIds.has(item.id) ? "Expand section" : "Collapse section"}
    >
      <ChevronRightIcon className="toc-sidebar-fold-icon" />
    </button>
  )}
  <button
    type="button"
    className={cn("toc-sidebar-item", ...)}
    onClick={() => handleClick(item)}
  >
    {item.textContent}
  </button>
</div>
```

The title H1 (first item, level 1, position 0) should never show a fold chevron.

**Step 4: Add chevron styles to toc-sidebar.scss**

```scss
.toc-sidebar-item-row {
  display: flex;
  align-items: center;
  gap: 0;
}

.toc-sidebar-fold-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  border-radius: var(--tt-radius-xxs);
  background: transparent;
  cursor: pointer;
  color: var(--tt-gray-light-a-400);
  transition: transform var(--tt-transition-duration-default)
    var(--tt-transition-easing-default);

  .dark & {
    color: var(--tt-gray-dark-a-400);
  }

  &:hover {
    color: var(--tt-gray-light-a-600);
    background: var(--tt-gray-light-a-50);

    .dark & {
      color: var(--tt-gray-dark-a-600);
      background: var(--tt-gray-dark-a-50);
    }
  }

  &--folded .toc-sidebar-fold-icon {
    transform: rotate(0deg);
  }
}

.toc-sidebar-fold-icon {
  width: 12px;
  height: 12px;
  transform: rotate(90deg);
  transition: transform var(--tt-transition-duration-default)
    var(--tt-transition-easing-default);
}
```

Chevron points right when folded (default), rotates 90° down when expanded.

**Step 5: Update `.toc-sidebar-item` to work within the row layout**

The `.toc-sidebar-item` button should grow to fill remaining space in the row. Its `paddingLeft` now accounts for the chevron width (or lack thereof for non-foldable items).

**Step 6: Verify**

Run `bun biome check components/toc-sidebar/toc-sidebar.tsx components/tiptap-icons.ts` — fix any issues.

**Step 7: Commit**

```
feat(fold): add fold chevrons and child filtering to TOC sidebar
```

---

## Task 7: Register Extension and Wire Fold State

**Files:**

- Modify: `components/tiptap-templates/simple/simple-editor.tsx`

**Step 1: Add fold state to SimpleEditorContent**

Add React state for `foldedIds` alongside the existing `tocItems` state:

```typescript
const [foldedIds, setFoldedIds] = useState<Set<string>>(new Set());
```

**Step 2: Register HeadingFold extension**

Add the import and register after `HeadingDrag` in the extensions array:

```typescript
import { HeadingFold } from "@/components/tiptap-node/heading-node/heading-fold-extension";

// In extensions array (after HeadingDrag):
HeadingFold.configure({
  documentId: docId,  // need to pass docId as prop to SimpleEditorContent
  onFoldChange: setFoldedIds,
}),
```

Note: `SimpleEditorContent` currently doesn't receive `documentId`. It's available in the parent `SimpleEditor` as `docId`. Pass it through:

```typescript
// SimpleEditor component:
<SimpleEditorContent
  ydoc={ydoc}
  documentId={docId}     // ADD THIS
  onTitleChange={onTitleChange}
  ...
/>

// SimpleEditorContent props:
interface SimpleEditorContentProps {
  ydoc: Y.Doc;
  documentId: string;     // ADD THIS
  onTitleChange?: ...;
  ...
}
```

**Step 3: Import fold SCSS**

```typescript
import "@/components/tiptap-node/heading-node/heading-fold.scss";
```

**Step 4: Pass fold state to TOCSidebar**

```tsx
<TOCSidebar
  items={tocItems}
  editor={editor}
  foldedIds={foldedIds}
  onToggleFold={(id) => editor?.commands.toggleFold(id)}
/>
```

**Step 5: Wire the onToggleFold handler**

The `onToggleFold` callback calls `editor.commands.toggleFold(id)`, which dispatches the ProseMirror transaction. The plugin updates its state, which triggers `onFoldChange` → React state update → TOCSidebar re-render.

**Step 6: Verify**

Run `bun biome check components/tiptap-templates/simple/simple-editor.tsx` — fix any issues.

Run `make dev` and verify:

1. Editor loads without errors
2. TOC sidebar shows chevrons next to headings that have children
3. Clicking a chevron toggles fold state (content hides/shows)
4. Crinkle overlay appears in folded state
5. Fold state persists across page reload

**Step 7: Commit**

```
feat(fold): register HeadingFold extension and wire fold state to TOC
```

---

## Task 8: Animated Fold/Unfold Transitions

Task 3 implemented instant fold/unfold (display:none + static overlay). This task upgrades `applyFold()` and `removeFold()` to use animated transitions via the margin compensation technique.

**Files:**

- Modify: `components/tiptap-node/heading-node/heading-fold-plugin.ts`
- Modify: `components/tiptap-node/heading-node/heading-fold.scss`

**Step 1: Add animation constant and state**

```typescript
const FOLD_ANIMATION_MS = 350;
// Track which headings are currently animating (prevent re-entry)
const animatingIds = new Set<string>();
```

**Step 2: Replace `applyFold()` with animated version**

The animated fold sequence:

```typescript
function applyFoldAnimated(view: EditorView, headingId: string): void {
  if (animatingIds.has(headingId)) return;
  animatingIds.add(headingId);

  const { headingEl, contentNodes } = findSectionDom(view, headingId);
  if (!headingEl) { animatingIds.delete(headingId); return; }

  // 1. Measure content height BEFORE hiding
  const contentHeight = measureContentHeight(contentNodes);
  contentHeightMap.set(headingId, contentHeight);

  // 2. Set heading margin-bottom to content height (prevents layout jump)
  headingEl.classList.add("heading-section-folded");
  headingEl.style.marginBottom = `${contentHeight}px`;

  // 3. Hide content nodes (instant — behind the overlay, invisible)
  for (const node of contentNodes) {
    node.classList.add("heading-fold-hidden");
  }

  // 4. Create overlay at FULL content height (starts tall)
  const overlay = createOverlayElement(view, headingEl);
  overlay.classList.add("heading-fold-overlay--animating");
  overlay.classList.remove("heading-fold-overlay--settled");
  overlay.style.height = `${contentHeight}px`;
  overlayMap.set(headingId, overlay);

  // 5. Force reflow, then start transitions
  void headingEl.offsetHeight;

  // 6. Animate: both margin-bottom and overlay height shrink to CRINKLE_HEIGHT
  headingEl.style.marginBottom = `${CRINKLE_HEIGHT}px`;
  overlay.style.height = `${CRINKLE_HEIGHT}px`;

  // 7. On transition end: mark settled
  overlay.addEventListener("transitionend", function onEnd(e) {
    if (e.propertyName !== "height") return;
    overlay.removeEventListener("transitionend", onEnd);
    overlay.classList.remove("heading-fold-overlay--animating");
    overlay.classList.add("heading-fold-overlay--settled");
    animatingIds.delete(headingId);
  }, { once: false });
}
```

**Step 3: Replace `removeFold()` with animated version**

Uses `contentHeightMap` (stored at fold time) to know the target height:

```typescript
function removeFoldAnimated(view: EditorView, headingId: string): void {
  if (animatingIds.has(headingId)) return;
  animatingIds.add(headingId);

  const overlay = overlayMap.get(headingId);
  const storedHeight = contentHeightMap.get(headingId) ?? 200; // fallback
  const { headingEl, contentNodes } = findSectionDom(view, headingId);

  if (!headingEl || !overlay) {
    // Instant fallback if DOM not found
    removeFold(view, headingId);
    animatingIds.delete(headingId);
    return;
  }

  // 1. Animate: margin-bottom and overlay expand to stored content height
  overlay.classList.add("heading-fold-overlay--animating");
  overlay.classList.remove("heading-fold-overlay--settled");
  headingEl.style.marginBottom = `${storedHeight}px`;
  overlay.style.height = `${storedHeight}px`;

  // 2. On transition end: clean up
  overlay.addEventListener("transitionend", function onEnd(e) {
    if (e.propertyName !== "height") return;
    overlay.removeEventListener("transitionend", onEnd);
    overlay.remove();
    overlayMap.delete(headingId);
    contentHeightMap.delete(headingId);

    headingEl.classList.remove("heading-section-folded");
    headingEl.style.marginBottom = "";
    for (const node of contentNodes) {
      node.classList.remove("heading-fold-hidden");
    }
    animatingIds.delete(headingId);
  }, { once: false });
}
```

**Step 4: Add `--tt-fold-duration` CSS variable**

The `heading-fold.scss` already references `var(--tt-fold-duration, 350ms)`. Ensure the transition property is on both `.heading-section-folded` (for margin-bottom) and `.heading-fold-overlay` (for height). Both transitions use `var(--tt-transition-easing-cubic)` for a smooth fold feel.

**Step 5: Handle initial load — skip animation for restored folds**

When `initialFoldedIds` is non-empty at plugin mount, apply folds instantly (use the non-animated `applyFold()` from Task 3). Only subsequent user-triggered folds use animation.

```typescript
// In the view constructor (after mount):
if (options.initialFoldedIds.size > 0) {
  for (const id of options.initialFoldedIds) {
    applyFold(view, id); // instant, no animation
  }
}
```

**Step 6: Verify**

Run `make dev` and test:

1. Click fold chevron — content smoothly compresses into crinkle strip (~350ms)
2. Click unfold chevron — crinkle smoothly expands, then content appears
3. No layout jumps during animation
4. Multiple sections can be folded independently
5. Page reload — folds restored instantly (no animation flash)
6. Rapid click toggle — animation doesn't break (re-entry guard)

**Step 7: Commit**

```
feat(fold): add animated fold/unfold transitions with margin compensation
```

---

## Task 9: Cursor Skip Over Folded Regions

Add `handleKeyDown` to the plugin's `props` so the cursor jumps over folded (hidden) sections instead of entering invisible content.

**Files:**

- Modify: `components/tiptap-node/heading-node/heading-fold-plugin.ts`

**Step 1: Add a helper to check if a document position is inside a folded section**

```typescript
function isPositionFolded(
  view: EditorView,
  pos: number,
  foldedIds: Set<string>,
): { folded: boolean; sectionFrom: number; sectionTo: number } {
  const { doc } = view.state;
  let offset = 0;

  for (let i = 0; i < doc.content.childCount; i++) {
    const child = doc.content.child(i);
    const nodePos = offset;
    offset += child.nodeSize;

    if (
      child.type.name === "heading" &&
      foldedIds.has(child.attrs["data-id"] as string)
    ) {
      const section = computeSection(doc, nodePos, child.attrs.level as number);
      const contentStart = nodePos + child.nodeSize;
      if (pos >= contentStart && pos < section.to) {
        return { folded: true, sectionFrom: nodePos, sectionTo: section.to };
      }
    }
  }
  return { folded: false, sectionFrom: -1, sectionTo: -1 };
}
```

**Step 2: Add `handleKeyDown` to plugin props**

```typescript
props: {
  handleKeyDown(view, event) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return false;
    const pluginState = headingFoldPluginKey.getState(view.state);
    if (!pluginState || pluginState.foldedIds.size === 0) return false;

    const { doc, selection } = view.state;
    const { $head } = selection;
    const isDown = event.key === "ArrowDown";

    // Find which top-level node index the cursor is in
    let offset = 0;
    let currentIndex = -1;
    for (let i = 0; i < doc.content.childCount; i++) {
      const child = doc.content.child(i);
      if ($head.pos >= offset && $head.pos < offset + child.nodeSize) {
        currentIndex = i;
        break;
      }
      offset += child.nodeSize;
    }
    if (currentIndex < 0) return false;

    // Look at the next node in the direction of movement
    const nextIndex = isDown ? currentIndex + 1 : currentIndex - 1;
    if (nextIndex < 0 || nextIndex >= doc.content.childCount) return false;

    // Calculate position of the next node
    let nextPos = 0;
    for (let i = 0; i < nextIndex; i++) {
      nextPos += doc.content.child(i).nodeSize;
    }

    // Check if the next position would land inside a folded section
    const check = isPositionFolded(view, nextPos + 1, pluginState.foldedIds);
    if (!check.folded) return false;

    // Skip: move selection past the folded section
    if (isDown) {
      // Jump to the first position in the node after the folded section
      const targetPos = check.sectionTo;
      if (targetPos < doc.content.size) {
        const tr = view.state.tr.setSelection(
          view.state.selection.constructor.near(doc.resolve(targetPos + 1)),
        );
        view.dispatch(tr.scrollIntoView());
      }
    } else {
      // Jump to the end of the folded heading (the heading itself is visible)
      const headingNode = doc.nodeAt(check.sectionFrom);
      if (headingNode) {
        const headingEnd = check.sectionFrom + headingNode.nodeSize - 1;
        const tr = view.state.tr.setSelection(
          view.state.selection.constructor.near(doc.resolve(headingEnd)),
        );
        view.dispatch(tr.scrollIntoView());
      }
    }

    return true;
  },
},
```

**Step 3: Verify**

Run `make dev` and test:

1. Fold an H2 section (with paragraphs below)
2. Place cursor at the end of the heading text
3. Press ArrowDown — cursor jumps to the next visible content (after the fold), not into hidden content
4. From below the fold, press ArrowUp — cursor jumps to the folded heading text
5. With multiple folds in sequence — cursor skips all of them correctly
6. ArrowDown at end of document with a fold — no crash

**Step 4: Commit**

```
feat(fold): add cursor skip over folded heading sections
```

---

## Task 10: Final Integration and Edge Cases

**Files:**

- Modify: `components/tiptap-node/heading-node/heading-fold-plugin.ts` (edge cases)

**Step 1: Handle structural document changes while sections are folded**

In the plugin view's `update()`:

1. When the document changes, re-validate all folded heading IDs
2. If a heading with a folded ID no longer exists, remove it from foldedIds
3. Reposition all crinkle overlays based on current heading positions
4. Re-measure content heights if the document structure changed

**Step 2: Handle initial fold state application**

When the plugin first mounts and `initialFoldedIds` is non-empty:

1. Wait for the editor DOM to be ready
2. Apply fold state without animation (instant fold — skip transition for initial render)
3. This prevents a jarring animation on page load when restoring saved fold state

**Step 3: Handle collaboration — remote changes affecting folded regions**

When a collaborator edits content inside a folded section:

1. The content nodes update via Yjs
2. The fold state remains (content is still hidden)
3. Overlay position may need adjustment if the heading moved
4. The `update()` callback handles this via reconciliation

**Step 4: Document known limitations (deferred)**

The following edge cases are **out of scope** for this implementation and will be addressed in a follow-up if they cause real user friction:

| Edge Case | Current Behavior | Why Deferred |
|-----------|-----------------|--------------|
| **Cmd+A (Select All)** | ProseMirror selects all content including hidden nodes. Selection may span folded regions. | Rarely causes problems — user can't see hidden content but copy/paste still works. Intercepting Select All adds significant complexity. |
| **Copy/paste across folds** | Copying a selection that spans a fold includes the hidden content in the clipboard. | This is arguably correct behavior — the content exists, it's just visually collapsed. |
| **Browser Find (Cmd+F)** | Browser highlights matches inside folded sections, but the highlighted text is invisible (`display: none`). | Would require intercepting browser-native find, which is impractical. Could auto-unfold on find in a future iteration. |
| **Drag-and-drop into folded region** | HeadingDrag targets are based on `view.dom.children` visibility. Hidden nodes are not valid drop targets. | Works correctly by accident — hidden nodes have no rect, so `findDropTarget()` skips them. |

**Step 5: Verify the complete feature**

Run `make dev` and test the full matrix:

| Scenario | Expected |
|----------|----------|
| Fold H2 with paragraphs | Content hides, crinkle appears |
| Unfold folded H2 | Crinkle expands, content appears |
| Fold H2 with nested H3, H4 | All nested content and subheadings hide |
| TOC hides child headings of folded section | Only folded heading visible in TOC |
| Reload page | Fold state restored from localStorage |
| ArrowDown past fold | Cursor skips to next visible content |
| ArrowUp from below fold | Cursor skips to folded heading |
| Type in heading text while section is folded | Heading text editable, fold remains |
| Delete the folded heading | Fold removed, content revealed |
| Fold title H1 | Not possible (no chevron shown) |
| Multiple sections folded | Each works independently |
| Dark mode | Crinkle overlay matches dark theme |

**Step 5: Commit**

```
feat(fold): handle edge cases and initial fold state restoration
```

---

## Summary

| Task | Description | Scope | Key Files | Status |
|------|-------------|-------|-----------|--------|
| 1 | Fold storage (localStorage) | Create | `helpers/fold-storage.ts` | Done |
| 2 | SVG crinkle renderer | Create | `helpers/crinkle-renderer.ts` | Done |
| 3 | Plugin skeleton + instant fold | Create | `heading-fold-plugin.ts` | Done |
| 4 | Tiptap extension + commands | Create | `heading-fold-extension.ts` | Done |
| 5 | Fold SCSS styles | Create | `heading-fold.scss` | Done |
| 6 | TOC chevrons + child filtering | Modify | `toc-sidebar.tsx`, `toc-sidebar.scss` | Done |
| 7 | Register extension, wire state | Modify | `simple-editor.tsx` | Done |
| 8 | Animated transitions | Modify | `heading-fold-plugin.ts` | Done |
| 9 | Cursor skip over folds | Modify | `heading-fold-plugin.ts` | Done |
| 10 | Edge cases + known limitations | Modify | `heading-fold-plugin.ts` | Done |

### Task Dependencies

```
1 (storage) ─┐
              ├→ 3 (plugin skeleton) → 4 (extension) → 7 (wire up) → 8 (animation) → 9 (cursor) → 10 (edge cases)
2 (crinkle) ─┤
5 (SCSS) ────┤
6 (TOC) ─────┘
```

Tasks 1, 2, 5, and 6 can be developed in parallel. Task 3 depends on 1 and 2. Task 7 depends on 3, 4, 5, and 6. Tasks 8-10 are sequential refinements.

---

## Post-Implementation: Deviations, Issues & Review

> Added after implementation was complete. Documents what changed from the original plan, issues encountered, and the solutions applied.

### Deviation 1: `data-toc-id` instead of `data-id`

The plan originally specified heading identification via UniqueID extension's `data-id`. During implementation, it was discovered that the TOC sidebar uses `data-toc-id` (from the TableOfContents extension) for item IDs. The fold plugin was updated to use `data-toc-id` for consistency. Using `data-id` caused fold toggles to silently fail because `findSectionDom` couldn't match heading IDs from the TOC.

### Deviation 2: `foldHeading`/`unfoldHeading` commands removed

The plan specified three commands (`toggleFold`, `foldHeading`, `unfoldHeading`). Post-implementation review found that only `toggleFold` has any call site. The directional commands were YAGNI — removed during cleanup. If programmatic fold/unfold is needed later, add them then.

### Deviation 3: `--animating` CSS class removed

The plan specified separate `--animating` and `--settled` CSS modifier classes. Review found that `--animating` was redundant — the base `.heading-fold-overlay` class already sets `pointer-events: none`, so removing `--settled` alone is sufficient to disable interactivity during animation. The `--animating` class and all JS references were removed.

### Issue 1: Content Not Hiding After Fold

**Symptom**: Clicking the fold chevron created the crinkle overlay but content remained visible.

**Root Cause**: The `repositionOverlay` function (called for already-folded headings on every editor `update()`) only moved the overlay. It did not re-apply the `heading-fold-hidden` CSS class to content nodes. ProseMirror rebuilds DOM on transactions (Yjs sync, typing), stripping any manually added classes.

**Fix**: Replaced `repositionOverlay` with `reconcileFold`, which re-applies `heading-fold-hidden` to content nodes and `heading-section-folded` + margin to the heading on every update. DOM mutations are guarded by `domObserver.stop()/start()` to prevent infinite loops.

### Issue 2: Browser Freeze on Fold/Unfold

**Symptom**: Clicking fold or unfold froze the entire browser tab permanently.

**Root Cause**: `reconcileFold` modified ProseMirror-managed DOM nodes inside `view.dom` on every `update()` call. ProseMirror's `DOMObserver` detected these mutations, triggered another `update()`, which called `reconcileFold` again — infinite loop.

**Fix**: All functions that modify contenteditable DOM (`reconcileFold`, `applyFold`, `applyFoldAnimated`, `removeFold`, `removeFoldAnimated`) now wrap their DOM mutations in `domObserver.stop()/start()`. This is a standard ProseMirror pattern for plugins that need imperative DOM control. The `domObserver` is accessed via `(view as unknown as ViewWithObserver).domObserver?.stop()` with optional chaining for graceful degradation.

### Issue 3: Fold Animation Desync

**Symptom**: During fold animation, the overlay height and the heading's margin-bottom animated out of sync — the overlay collapsed smoothly but the content area jumped.

**Root Cause**: The `heading-section-folded` CSS class (which carries `transition: margin-bottom 350ms`) was added BEFORE the initial `margin-bottom` value was set. This caused the browser to animate `margin-bottom: 0 → contentHeight` (unwanted), which was then immediately interrupted by `contentHeight → CRINKLE_HEIGHT`. The overlay, meanwhile, transitioned cleanly from contentHeight → CRINKLE_HEIGHT.

**Fix**: Restructured `applyFoldAnimated` into a 5-phase choreography:

1. Measure content height while content is visible
2. Create overlay at full content height (masks content before changes)
3. Swap content → margin instantly (no transition class yet)
4. Force reflow to commit initial state
5. Add transition class + set target values in the same frame

Both margin-bottom and overlay height now animate from the same committed start value to the same end value with identical CSS transition properties.

### Issue 4: Content Height Measurement Inaccuracy

**Symptom**: After folding, slight visual jumps at the section boundary.

**Root Cause**: `measureContentHeight` used `lastContentNode.getBoundingClientRect().bottom`, which doesn't include the node's margin-bottom. The measured height was shorter than the actual visual space.

**Fix**: When a next sibling element exists (the heading that starts the next section), measure from `headingEl.bottom` to `nextSiblingEl.top`. This captures the exact visual space including inter-element margins. For the last section in the document, fall back to `lastNode.bottom + computedMarginBottom`.

### Review Cleanup: Pruning Moved to `state.apply()`

**Before**: `pruneStaleIds()` dispatched transactions inside the plugin view's `update()` to remove fold IDs for deleted headings. This violated ProseMirror's data flow contract and caused cascading transaction storms when multiple headings were deleted (N stale IDs = N+1 cascading update cycles).

**After**: Pruning logic moved into `state.apply()`. On `tr.docChanged`, the plugin scans the new document for live `data-toc-id` values and removes any folded IDs not present. Single pass, zero dispatches, proper ProseMirror data flow.

### Review Cleanup: DRY and KISS

- Extracted `awaitTransition()` helper — deduplicates the "transitionend listener + setTimeout fallback" pattern used in both `applyFoldAnimated` and `removeFoldAnimated`
- Named magic numbers: `FALLBACK_CONTENT_HEIGHT = 200`, `ANIMATION_SAFETY_MS = 50`
- Removed unused `headingPos` from `findSectionDom` return type
- Added click handler to crinkle overlay — fixes false affordance (cursor:pointer + hover state with no interaction)
- Fixed `destroy()` calling `unmountParent()` after clearing overlayMap (no-op loop)

### Final File Inventory (as of original overlay architecture)

> **Note:** This inventory reflects the state after the original 10-task plan. The architecture was subsequently re-designed — see [refactor plan](3-refactor-fold-overlay-to-decoration-plan.md) for the current file inventory.

| File | Lines | Role |
|------|-------|------|
| `heading-fold-plugin.ts` | ~585 | Core ProseMirror plugin: state, view, DOM, animation |
| `heading-fold-extension.ts` | ~58 | Tiptap extension: `toggleFold` command |
| `heading-fold.scss` | ~42 | Styles: transitions, overlay, hidden class |
| `helpers/fold-storage.ts` | ~31 | localStorage read/write |
| `helpers/crinkle-renderer.ts` | ~83 | SVG crinkle strip generator (deleted in refactor) |
| `toc-sidebar.tsx` (modified) | ~133 | Fold chevrons, child filtering |
| `toc-sidebar.scss` (modified) | ~157 | Chevron and item-row styles |
| `simple-editor.tsx` (modified) | — | Extension registration, state wiring |
| `tiptap-icons.ts` (modified) | — | `ChevronRightIcon` export |
