import { computePosition, offset, shift } from "@floating-ui/dom";

/**
 * Position the drag handle wrapper relative to a heading DOM element
 * using floating-ui. Places the wrapper to the left of the heading,
 * vertically centered. The wrapper must have `position: absolute`.
 *
 * Forked from @tiptap/extension-drag-handle v3.20.1 drag-handle-plugin.ts repositionDragHandle
 * Modified: simplified options, heading-specific placement
 */
export async function repositionHandle(
  floatingEl: HTMLElement,
  referenceEl: HTMLElement,
): Promise<void> {
  const { x, y } = await computePosition(referenceEl, floatingEl, {
    placement: "left",
    middleware: [offset(4), shift({ padding: 8 })],
  });

  Object.assign(floatingEl.style, {
    left: `${x}px`,
    top: `${y}px`,
  });
}
