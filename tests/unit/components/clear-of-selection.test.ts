import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import {
  clearOfSelection,
  SELECTION_GAP,
} from "@/components/smart-toolbar/color/clear-of-selection";

/**
 * Geometry of the row at 1440 × 900 (from the e2e): the text chevron at
 * x 626–650, y 46–74; a 324 × 118 popover; the first body line at y
 * 187–204. Coordinates are client pixels.
 */
const VIEWPORT = { width: 1440, height: 900 };
const POPOVER = { width: 324, height: 118 };
const SIDE_OFFSET = 4;
const BOTTOM = { side: "bottom", positioner: POPOVER };
const TOP = { side: "top", positioner: POPOVER };

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const rect = ({ left, top, right, bottom }: Box) =>
  ({
    left,
    top,
    right,
    bottom,
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  }) as DOMRect;

const element = (box: Box) =>
  ({ getBoundingClientRect: () => rect(box) }) as Element;

const CHEVRON = element({ left: 626, top: 46, right: 650, bottom: 74 });

/**
 * A stand-in editor whose selection runs `from` → `to` on screen: each
 * end is a zero-width caret box, as `coordsAtPos` returns.
 */
function editorWith(
  start: { x: number; top: number; bottom: number } | null,
  end?: { x: number; top: number; bottom: number },
  column: Box = { left: 532, top: 94, right: 1178, bottom: 900 },
) {
  const caret = (at: { x: number; top: number; bottom: number }) => ({
    left: at.x,
    right: at.x,
    top: at.top,
    bottom: at.bottom,
  });
  return {
    isDestroyed: false,
    state: {
      selection: { from: 10, to: 20, empty: start === null },
    },
    view: {
      coordsAtPos: (pos: number) => {
        if (!start) throw new Error("no selection");
        return caret(pos === 10 ? start : (end ?? start));
      },
      dom: element(column),
    },
  } as unknown as Parameters<typeof clearOfSelection>[0];
}

const line = (y: number) => ({ top: y, bottom: y + 17 });
/** "some words" on the first body line, right under the chevron. */
const UNDER_BUTTON = editorWith(
  { x: 626, ...line(187) },
  { x: 707, ...line(187) },
);

describe("clearOfSelection", () => {
  const saved = {
    clientWidth: Object.getOwnPropertyDescriptor(
      document.documentElement,
      "clientWidth",
    ),
    innerHeight: window.innerHeight,
  };
  beforeEach(() => {
    Object.defineProperty(document.documentElement, "clientWidth", {
      configurable: true,
      value: VIEWPORT.width,
    });
    window.innerHeight = VIEWPORT.height;
  });
  afterEach(() => {
    if (saved.clientWidth) {
      Object.defineProperty(
        document.documentElement,
        "clientWidth",
        saved.clientWidth,
      );
    } else {
      delete (document.documentElement as { clientWidth?: number }).clientWidth;
    }
    window.innerHeight = saved.innerHeight;
  });

  it("does not move for a caret, a missing trigger or a destroyed editor", () => {
    expect(clearOfSelection(editorWith(null), CHEVRON, BOTTOM, 4)).toEqual([
      0, 0,
    ]);
    expect(clearOfSelection(UNDER_BUTTON, null, BOTTOM, 4)).toEqual([0, 0]);
    const destroyed = { ...UNDER_BUTTON, isDestroyed: true };
    expect(clearOfSelection(destroyed, CHEVRON, BOTTOM, 4)).toEqual([0, 0]);
  });

  it("does not move when the popover covers nothing selected", () => {
    // Far down the page, below the popover.
    const below = editorWith(
      { x: 600, ...line(400) },
      { x: 700, ...line(400) },
    );
    expect(clearOfSelection(below, CHEVRON, BOTTOM, SIDE_OFFSET)).toEqual([
      0, 0,
    ]);
    // On the first line but right of the popover (x 476–800).
    const right = editorWith(
      { x: 830, ...line(187) },
      { x: 930, ...line(187) },
    );
    expect(clearOfSelection(right, CHEVRON, BOTTOM, SIDE_OFFSET)).toEqual([
      0, 0,
    ]);
  });

  it("slides along the row while the popover still spans its button", () => {
    // "in this paragraph" at x 711–823: slide left until clear of it.
    const editor = editorWith(
      { x: 711, ...line(187) },
      { x: 823, ...line(187) },
    );
    const [across, away] = clearOfSelection(
      editor,
      CHEVRON,
      BOTTOM,
      SIDE_OFFSET,
    );
    expect(away).toBe(0);
    const left = 638 - POPOVER.width / 2 + across;
    expect(left + POPOVER.width).toBe(711 - SELECTION_GAP);
    expect(left).toBeLessThanOrEqual(650);
    expect(left + POPOVER.width).toBeGreaterThanOrEqual(626);
  });

  it("drops below the selection when no slide keeps it under its button", () => {
    const [across, away] = clearOfSelection(
      UNDER_BUTTON,
      CHEVRON,
      BOTTOM,
      SIDE_OFFSET,
    );
    expect(across).toBe(0);
    // Its top lands the gap below the line: 74 + 4 + away = 204 + gap.
    expect(74 + SIDE_OFFSET + away).toBe(204 + SELECTION_GAP);
  });

  it("treats a selection over several lines as the whole text column", () => {
    // Ends left of the popover on line 2, but line 1 runs under it.
    const editor = editorWith(
      { x: 700, ...line(187) },
      { x: 560, ...line(216) },
    );
    const [across, away] = clearOfSelection(
      editor,
      CHEVRON,
      BOTTOM,
      SIDE_OFFSET,
    );
    expect(across).toBe(0);
    expect(74 + SIDE_OFFSET + away).toBe(233 + SELECTION_GAP);
  });

  it("stays put when dropping below would leave the viewport", () => {
    window.innerHeight = 300;
    expect(
      clearOfSelection(UNDER_BUTTON, CHEVRON, BOTTOM, SIDE_OFFSET),
    ).toEqual([0, 0]);
  });

  it("opening upward rises above the selection it would cover", () => {
    // A button low on the page (y 600–628), the selection just above it.
    const button = element({ left: 626, top: 600, right: 650, bottom: 628 });
    const editor = editorWith(
      { x: 626, ...line(540) },
      { x: 707, ...line(540) },
    );
    const [across, away] = clearOfSelection(editor, button, TOP, SIDE_OFFSET);
    expect(across).toBe(0);
    // Its bottom lands the gap above the line: 600 - 4 - away = 540 - gap.
    expect(600 - SIDE_OFFSET - away).toBe(540 - SELECTION_GAP);
    // Opening upward away from text below the button: nothing to clear.
    const below = editorWith(
      { x: 626, ...line(640) },
      { x: 707, ...line(640) },
    );
    expect(clearOfSelection(below, button, TOP, SIDE_OFFSET)).toEqual([0, 0]);
  });
});
