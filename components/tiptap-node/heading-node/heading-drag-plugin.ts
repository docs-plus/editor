import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

import { canMapDecorations } from "@/components/tiptap-node/heading-node/helpers/can-map-decorations";
import { computeSection } from "@/components/tiptap-node/heading-node/helpers/compute-section";
import { findHeadingFromCursor } from "@/components/tiptap-node/heading-node/helpers/find-heading-from-cursor";
import { repositionHandle } from "@/components/tiptap-node/heading-node/helpers/reposition-handle";

const DRAG_THRESHOLD = 4;
const AUTO_SCROLL_ZONE = 50;
const AUTO_SCROLL_SPEED = 15;

interface DragInfo {
  headingPos: number;
  headingLevel: number;
  sectionFrom: number;
  sectionTo: number;
  ghostEl: HTMLElement | null;
  indicatorEl: HTMLElement | null;
  scrollInterval: ReturnType<typeof setInterval> | null;
  onDocMouseMove: ((e: MouseEvent) => void) | null;
  onDocMouseUp: ((e: MouseEvent) => void) | null;
  onBlur: (() => void) | null;
  rafId: number;
}

const dragStates = new WeakMap<EditorView, DragInfo>();

const headingDragPluginKey = new PluginKey<DecorationSet>("headingDrag");

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

function getScrollParent(el: HTMLElement): HTMLElement {
  let current = el.parentElement;
  while (current) {
    const { overflowY } = getComputedStyle(current);
    if (overflowY === "auto" || overflowY === "scroll") {
      return current;
    }
    current = current.parentElement;
  }
  return document.documentElement;
}

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

    if (i === 0) continue;
    if (nodePos >= sectionFrom && nodePos < sectionTo) continue;

    const dom = domChildren[i];
    if (!(dom instanceof HTMLElement)) continue;

    const rect = dom.getBoundingClientRect();

    if (result && clientY < rect.top) {
      const gapMid = (result.y + rect.top) / 2;
      return clientY < gapMid ? result : { pos: nodePos, y: rect.top };
    }

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

function cleanupDrag(view: EditorView): void {
  const info = dragStates.get(view);
  if (!info) return;

  info.ghostEl?.remove();
  info.indicatorEl?.remove();
  cancelAnimationFrame(info.rafId);

  if (info.scrollInterval != null) {
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

export function createHeadingDragPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: headingDragPluginKey,

    state: {
      init(_, state) {
        return buildHandleDecos(state.doc);
      },

      apply(tr, prev, oldState, newState) {
        if (!tr.docChanged) return prev;
        if (canMapDecorations(tr, oldState.doc)) {
          return prev.map(tr.mapping, newState.doc);
        }
        return buildHandleDecos(newState.doc);
      },
    },

    props: {
      decorations(state) {
        return headingDragPluginKey.getState(state) ?? DecorationSet.empty;
      },
    },

    view(editorView) {
      const wrapperEl = document.createElement("div");
      wrapperEl.className = "heading-drag-wrapper";
      Object.assign(wrapperEl.style, {
        position: "absolute",
        top: "0",
        left: "0",
        pointerEvents: "none",
      });

      const handleEl = document.createElement("div");
      handleEl.className = "heading-drag-handle";
      wrapperEl.appendChild(handleEl);

      let mountedParent: HTMLElement | null = null;
      let currentHeadingEl: HTMLElement | null = null;
      let pendingMouseCoords: { x: number; y: number } | null = null;
      let positionRafId = 0;

      function showHandle(): void {
        wrapperEl.style.visibility = "";
        handleEl.style.pointerEvents = "auto";
      }

      function hideHandle(): void {
        wrapperEl.style.visibility = "hidden";
        handleEl.style.pointerEvents = "none";
        currentHeadingEl = null;
      }

      function schedulePositionUpdate(): void {
        if (positionRafId) return;
        positionRafId = requestAnimationFrame(async () => {
          positionRafId = 0;
          if (!pendingMouseCoords || dragStates.has(editorView)) return;

          const result = findHeadingFromCursor(editorView, pendingMouseCoords);
          if (result) {
            currentHeadingEl = result.element;
            await repositionHandle(wrapperEl, result.element);
            showHandle();
          } else {
            hideHandle();
          }
        });
      }

      function onParentMouseMove(e: MouseEvent): void {
        pendingMouseCoords = { x: e.clientX, y: e.clientY };
        schedulePositionUpdate();
      }

      function onKeyDown(): void {
        hideHandle();
      }

      function onParentMouseLeave(): void {
        hideHandle();
      }

      function onHandleMouseDown(e: MouseEvent): void {
        if (e.button !== 0 || !currentHeadingEl) return;

        cleanupDrag(editorView);

        const headingEl = currentHeadingEl;
        const pos = editorView.posAtDOM(headingEl, 0) - 1;
        if (pos <= 0) return;

        const { doc } = editorView.state;
        const headingNode = doc.nodeAt(pos);
        if (!headingNode || headingNode.type.name !== "heading") return;

        const headingLevel = headingNode.attrs.level as number;
        const headingText = headingNode.textContent || "Heading";
        const section = computeSection(doc, pos, headingLevel);

        const startX = e.clientX;
        const startY = e.clientY;
        let activated = false;
        let latestClientY = e.clientY;

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

        const scrollParent = getScrollParent(editorView.dom as HTMLElement);

        const onDragMove = (ev: MouseEvent): void => {
          latestClientY = ev.clientY;

          if (!activated) {
            const dx = ev.clientX - startX;
            const dy = ev.clientY - startY;
            if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return;

            activated = true;
            document.documentElement.classList.add("heading-dragging");
            applySectionFeedback(editorView, info.sectionFrom, info.sectionTo);
            hideHandle();

            const ghost = document.createElement("div");
            ghost.className = "heading-drag-ghost";
            ghost.textContent = headingText;
            document.body.appendChild(ghost);
            info.ghostEl = ghost;

            info.scrollInterval = setInterval(() => {
              const viewportHeight = window.innerHeight;
              if (latestClientY < AUTO_SCROLL_ZONE) {
                scrollParent.scrollBy(0, -AUTO_SCROLL_SPEED);
              } else if (latestClientY > viewportHeight - AUTO_SCROLL_ZONE) {
                scrollParent.scrollBy(0, AUTO_SCROLL_SPEED);
              }
            }, 16);
          }

          if (info.ghostEl) {
            info.ghostEl.style.left = `${ev.clientX + 12}px`;
            info.ghostEl.style.top = `${ev.clientY - 16}px`;
          }

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

            const parentEl = mountedParent ?? editorView.dom.parentElement;
            if (!parentEl) return;

            if (!info.indicatorEl) {
              info.indicatorEl = document.createElement("div");
              info.indicatorEl.className = "heading-drop-indicator";
              parentEl.appendChild(info.indicatorEl);
            }

            const parentRect = parentEl.getBoundingClientRect();
            const editorRect = editorView.dom.getBoundingClientRect();
            info.indicatorEl.style.top = `${target.y - parentRect.top}px`;
            info.indicatorEl.style.left = `${editorRect.left - parentRect.left}px`;
            info.indicatorEl.style.width = `${editorRect.width}px`;
          });
        };

        const onDragUp = (ev: MouseEvent): void => {
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
            tr.delete(tr.mapping.map(sectionFrom), tr.mapping.map(sectionTo));
          } else {
            tr.delete(sectionFrom, sectionTo);
            tr.insert(tr.mapping.map(target.pos), slice.content);
          }

          editorView.dispatch(tr.scrollIntoView());
        };

        const onBlur = (): void => {
          cleanupDrag(editorView);
        };

        info.onDocMouseMove = onDragMove;
        info.onDocMouseUp = onDragUp;
        info.onBlur = onBlur;
        dragStates.set(editorView, info);

        document.addEventListener("mousemove", onDragMove);
        document.addEventListener("mouseup", onDragUp);
        editorView.dom.addEventListener("blur", onBlur);

        e.preventDefault();
      }

      /**
       * Detach event listeners and wrapper from the current parent.
       */
      function unmountParent(): void {
        if (!mountedParent) return;
        mountedParent.removeEventListener("mousemove", onParentMouseMove);
        mountedParent.removeEventListener("mouseleave", onParentMouseLeave);
        wrapperEl.remove();
        mountedParent = null;
      }

      /**
       * Mount the handle DOM and attach event listeners to the parent.
       *
       * Handles two Tiptap React lifecycle quirks:
       * 1. `immediatelyRender: false` — parentElement is null at construction
       * 2. EditorContent.mount() — moves view.dom to a new parent after
       *    initial construction, orphaning any elements appended to the
       *    temporary internal parent
       *
       * Returns true when successfully mounted to the current parent.
       */
      function mount(): boolean {
        const parentEl = editorView.dom.parentElement;
        if (!parentEl) return false;

        if (mountedParent === parentEl) return true;

        unmountParent();

        mountedParent = parentEl;
        parentEl.style.position = "relative";
        parentEl.appendChild(wrapperEl);
        hideHandle();

        parentEl.addEventListener("mousemove", onParentMouseMove);
        parentEl.addEventListener("mouseleave", onParentMouseLeave);

        return true;
      }

      editorView.dom.addEventListener("keydown", onKeyDown);
      handleEl.addEventListener("mousedown", onHandleMouseDown);
      mount();

      return {
        update() {
          mount();
        },

        destroy() {
          cleanupDrag(editorView);
          cancelAnimationFrame(positionRafId);
          unmountParent();
          editorView.dom.removeEventListener("keydown", onKeyDown);
          handleEl.removeEventListener("mousedown", onHandleMouseDown);
          wrapperEl.remove();
        },
      };
    },
  });
}
