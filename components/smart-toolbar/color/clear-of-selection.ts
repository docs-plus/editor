import type { Editor } from "@tiptap/core";

/** Room kept between the colour popover and the selection it avoids. */
export const SELECTION_GAP = 8;

/** What Base UI passes a positioner's offset function (the part used). */
export interface OffsetData {
  side: string;
  positioner: { width: number; height: number };
}

/** The editor surface the avoidance reads: positions to screen coordinates. */
type SelectionEditor = Pick<Editor, "state" | "isDestroyed"> & {
  view: Pick<Editor["view"], "coordsAtPos" | "dom">;
};

/**
 * The move [across, away from the button] that keeps the colour popover
 * off the selection, which the hover preview paints: opened from the row
 * over the first lines, it hid the very words it previews. Sideways along
 * the toolbar first, as far as it still spans its button (Base UI's
 * `limitShift` keeps it touching the button anyway); else straight past
 * the selection, still centred on the button. [0, 0] when it covers
 * nothing or no move fits the viewport. Popovers that already open away
 * from the text (the bubble's) never cover it, so they never move.
 *
 * In the lazy colour chunk: the eager trigger reaches it once the chunk
 * has loaded (`loadedColorPanel()`), which hovering or focusing the
 * trigger starts.
 */
export function clearOfSelection(
  editor: SelectionEditor,
  trigger: Element | null,
  { side, positioner: { width, height } }: OffsetData,
  sideOffset: number,
): [number, number] {
  const { view, state, isDestroyed } = editor;
  const { from, to, empty } = state.selection;
  if (empty || !trigger || isDestroyed) return [0, 0];
  const start = view.coordsAtPos(from);
  const end = view.coordsAtPos(to, -1);
  // Over more than one line the selection spans the text column.
  const { left, right } =
    end.top >= start.bottom
      ? view.dom.getBoundingClientRect()
      : { left: start.left, right: end.right };
  const anchor = trigger.getBoundingClientRect();
  const x = anchor.left + (anchor.width - width) / 2;
  const up = side === "top";
  const y = up ? anchor.top - sideOffset - height : anchor.bottom + sideOffset;
  if (
    x >= right ||
    x + width <= left ||
    y >= end.bottom ||
    y + height <= start.top
  ) {
    return [0, 0];
  }
  const room = document.documentElement.clientWidth;
  const shifts = [left - SELECTION_GAP - width - x, right + SELECTION_GAP - x]
    .filter((shift) => {
      const at = x + shift;
      return (
        at >= 0 &&
        at + width <= room &&
        at <= anchor.right &&
        at + width >= anchor.left
      );
    })
    .sort((a, b) => Math.abs(a) - Math.abs(b));
  if (shifts.length > 0) return [shifts[0], 0];
  const fits = up
    ? start.top - SELECTION_GAP - height >= 0
    : end.bottom + SELECTION_GAP + height <= window.innerHeight;
  const away = up
    ? y + height + SELECTION_GAP - start.top
    : end.bottom + SELECTION_GAP - y;
  return [0, fits ? away : 0];
}
