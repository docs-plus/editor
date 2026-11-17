import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

import type { Editor, JSONContent } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";

import {
  bubbleReferenceRect,
  intoTextblock,
} from "@/components/smart-toolbar/bubble/bubble-anchor";
import {
  BUBBLE_SHOW_DELAY_MS,
  type BubbleController,
  type BubbleHost,
  createBubbleController,
} from "@/components/smart-toolbar/bubble/bubble-controller";
import type { BubblePlacement } from "@/components/smart-toolbar/bubble/bubble-rules";

import { createTestEditor } from "../../helpers/create-test-editor";

/** Long enough for the show delay and the deferred re-checks to run. */
const SETTLE_MS = BUBBLE_SHOW_DELAY_MS + 50;
/** Ceiling for `until`: a loaded shared test process can run timers late. */
const UNTIL_MS = 1_000;

/**
 * Polls `check` until it holds, failing after `UNTIL_MS`. "Now shown"
 * assertions use it instead of a fixed slack after the delay.
 */
async function until(check: () => boolean): Promise<void> {
  const deadline = performance.now() + UNTIL_MS;
  while (!check()) {
    if (performance.now() > deadline) {
      throw new Error(`not true within ${UNTIL_MS} ms: ${check}`);
    }
    await Bun.sleep(5);
  }
}

const connected = () => host.root.isConnected;

const DOC: JSONContent = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "Title" }],
    },
    { type: "paragraph", content: [{ type: "text", text: "Hello world" }] },
  ],
};

let editor: Editor;
let scrollTarget: HTMLElement;
let controller: BubbleController;
let allow: boolean;
let shouldShow: ReturnType<typeof mock<() => boolean>>;
let getReferenceRect: ReturnType<
  typeof mock<(placement: BubblePlacement) => DOMRect>
>;
let onShow: ReturnType<typeof mock<() => void>>;
let onHide: ReturnType<typeof mock<() => void>>;
let onPosition: ReturnType<typeof mock<() => void>>;
let host: BubbleHost;

beforeEach(async () => {
  editor = createTestEditor({ content: DOC });
  // `create` runs a tick later; UniqueID then fixes the doc (a doc change).
  await new Promise((resolve) => editor.on("create", resolve));
  scrollTarget = document.createElement("div");
  document.body.appendChild(scrollTarget);
  allow = true;
  shouldShow = mock(() => allow);
  getReferenceRect = mock(() => new DOMRect(10, 10, 50, 20));
  onShow = mock(() => {});
  onHide = mock(() => {});
  onPosition = mock(() => {});
  host = {
    root: document.createElement("div"),
    shouldShow,
    getReferenceRect,
    onShow,
    onHide,
    onPosition,
  };
  controller = createBubbleController(editor, scrollTarget, host);
});

afterEach(() => {
  controller.destroy();
  if (!editor.isDestroyed) editor.destroy();
  scrollTarget.remove();
});

const select = (from = 1, to = 4) =>
  editor.commands.setTextSelection({ from, to });

async function showBubble() {
  select();
  await until(() => controller.visible);
}

function setComposing(value: boolean) {
  Object.defineProperty(editor.view, "composing", {
    configurable: true,
    get: () => value,
  });
}

function blurEditor(relatedTarget: EventTarget | null) {
  editor.view.dom.dispatchEvent(new FocusEvent("blur", { relatedTarget }));
}

describe("createBubbleController", () => {
  test("shows after the delay for a non-empty selection and appends the root", async () => {
    select();
    expect(host.root.isConnected).toBe(false);
    expect(controller.visible).toBe(false);
    await until(connected);
    expect(host.root.parentElement).toBe(scrollTarget);
    expect(controller.visible).toBe(true);
    expect(onShow).toHaveBeenCalledTimes(1);
  });

  test("each selection change restarts the delay", async () => {
    select(1, 3);
    await Bun.sleep(BUBBLE_SHOW_DELAY_MS - 100);
    select(1, 4);
    await Bun.sleep(BUBBLE_SHOW_DELAY_MS - 100);
    expect(host.root.isConnected).toBe(false);
    await until(connected);
    expect(onShow).toHaveBeenCalledTimes(1);
  });

  test("a transaction that changes neither selection nor doc keeps the timer", async () => {
    select();
    await Bun.sleep(BUBBLE_SHOW_DELAY_MS - 100);
    const at = performance.now();
    editor.view.dispatch(editor.state.tr.setMeta("noop", true));
    await until(connected);
    // The kept timer fires about 100 ms later; a restarted one takes the
    // whole delay again.
    expect(performance.now() - at).toBeLessThan(BUBBLE_SHOW_DELAY_MS);
  });

  test("hides synchronously on an empty selection and removes the root", async () => {
    await showBubble();
    editor.commands.setTextSelection(2);
    expect(host.root.isConnected).toBe(false);
    expect(controller.visible).toBe(false);
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  test("hides at once when shouldShow turns false on a new selection", async () => {
    await showBubble();
    allow = false;
    select(1, 3);
    expect(host.root.isConnected).toBe(false);
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  test("typing with an empty selection never asks shouldShow", async () => {
    editor.commands.setTextSelection(2);
    shouldShow.mockClear();
    editor.commands.insertContent("abc");
    expect(shouldShow).not.toHaveBeenCalled();
    await Bun.sleep(SETTLE_MS);
    expect(shouldShow).not.toHaveBeenCalled();
    expect(host.root.isConnected).toBe(false);
  });

  test("no show while composing; shows after compositionend", async () => {
    setComposing(true);
    select();
    await Bun.sleep(SETTLE_MS);
    expect(host.root.isConnected).toBe(false);
    setComposing(false);
    editor.view.dom.dispatchEvent(new Event("compositionend"));
    await until(connected);
  });

  test("dragstart and contextmenu on the editor hide it", async () => {
    await showBubble();
    editor.view.dom.dispatchEvent(new Event("dragstart"));
    expect(host.root.isConnected).toBe(false);
    expect(onHide).toHaveBeenCalledTimes(1);

    select(1, 3);
    await until(connected);
    editor.view.dom.dispatchEvent(new Event("contextmenu"));
    expect(host.root.isConnected).toBe(false);
    expect(onHide).toHaveBeenCalledTimes(2);
  });

  test("a hide during the delay cancels the pending show", async () => {
    select();
    editor.view.dom.dispatchEvent(new Event("contextmenu"));
    await Bun.sleep(SETTLE_MS);
    expect(host.root.isConnected).toBe(false);
    expect(onShow).not.toHaveBeenCalled();
  });

  test("a pointer drag shows only after pointerup", async () => {
    editor.view.dom.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true }),
    );
    select();
    await Bun.sleep(SETTLE_MS);
    expect(host.root.isConnected).toBe(false);
    // The drag may end outside the editor.
    document.body.dispatchEvent(
      new PointerEvent("pointerup", { bubbles: true }),
    );
    expect(host.root.isConnected).toBe(false);
    await until(connected);
  });

  test("a context menu ends a drag whose pointerup never comes", async () => {
    editor.view.dom.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true }),
    );
    editor.view.dom.dispatchEvent(new Event("contextmenu"));
    select();
    await until(connected);
  });

  test("a pointer drag that empties the selection hides at once", async () => {
    await showBubble();
    editor.view.dom.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true }),
    );
    editor.commands.setTextSelection(2);
    expect(host.root.isConnected).toBe(false);
  });

  test("blur to outside hides; a mousedown inside the root keeps it", async () => {
    await showBubble();
    host.root.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    blurEditor(null);
    expect(host.root.isConnected).toBe(true);

    const inside = document.createElement("button");
    host.root.appendChild(inside);
    blurEditor(inside);
    expect(host.root.isConnected).toBe(true);

    blurEditor(editor.view.dom);
    expect(host.root.isConnected).toBe(true);

    const outside = document.createElement("button");
    document.body.appendChild(outside);
    blurEditor(outside);
    outside.remove();
    expect(host.root.isConnected).toBe(false);
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  test("focus re-evaluates after the selection settles", async () => {
    allow = false;
    select();
    await Bun.sleep(SETTLE_MS);
    expect(host.root.isConnected).toBe(false);
    allow = true;
    editor.view.dom.dispatchEvent(new FocusEvent("focus"));
    await until(connected);
  });

  test("setEditable(false) hides it (update event)", async () => {
    await showBubble();
    editor.setEditable(false);
    expect(host.root.isConnected).toBe(false);
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  test("update() re-evaluates at once, without the delay", () => {
    select();
    controller.update();
    expect(host.root.isConnected).toBe(true);
    expect(onShow).toHaveBeenCalledTimes(1);
    allow = false;
    controller.update();
    expect(host.root.isConnected).toBe(false);
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  test("hide() removes the root synchronously before onHide", async () => {
    await showBubble();
    let connectedInOnHide = true;
    onHide.mockImplementation(() => {
      connectedInOnHide = host.root.isConnected;
    });
    controller.hide();
    expect(connectedInOnHide).toBe(false);
    controller.hide();
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  test("positions the root while shown and reads the current placement", async () => {
    await showBubble();
    await Bun.sleep(0);
    expect(onPosition).toHaveBeenCalled();
    // happy-dom has no layout: the hide middleware reports it hidden.
    expect(host.root.style.visibility).not.toBe("");
    expect(getReferenceRect).toHaveBeenLastCalledWith("top");

    controller.setPlacement("bottom");
    controller.updatePosition();
    await Bun.sleep(0);
    expect(getReferenceRect).toHaveBeenLastCalledWith("bottom");
  });

  test("window resize and scroll reposition after the resize delay", async () => {
    await showBubble();
    await Bun.sleep(0);
    onPosition.mockClear();
    scrollTarget.dispatchEvent(new Event("scroll"));
    window.dispatchEvent(new Event("resize"));
    await until(() => onPosition.mock.calls.length > 0);
  });

  test("a position result after hide() is ignored", async () => {
    await showBubble();
    await Bun.sleep(0);
    onPosition.mockClear();
    controller.updatePosition();
    controller.hide();
    await Bun.sleep(0);
    expect(onPosition).not.toHaveBeenCalled();
  });

  test("destroy is idempotent and detaches every listener", async () => {
    controller.destroy();
    controller.destroy();
    select();
    await Bun.sleep(SETTLE_MS);
    editor.view.dom.dispatchEvent(new Event("compositionend"));
    editor.view.dom.dispatchEvent(new FocusEvent("focus"));
    await Bun.sleep(SETTLE_MS);
    expect(host.root.isConnected).toBe(false);
    expect(onShow).not.toHaveBeenCalled();
    expect(onHide).not.toHaveBeenCalled();
  });

  test("destroy while shown removes the root and clears timers", async () => {
    await showBubble();
    select(1, 3);
    controller.destroy();
    expect(host.root.isConnected).toBe(false);
    expect(onHide).toHaveBeenCalledTimes(1);
    await Bun.sleep(SETTLE_MS);
    expect(host.root.isConnected).toBe(false);
    expect(onShow).toHaveBeenCalledTimes(1);
  });

  test("editor destroy tears the controller down", async () => {
    await showBubble();
    editor.destroy();
    expect(host.root.isConnected).toBe(false);
    expect(controller.visible).toBe(false);
    expect(onHide).toHaveBeenCalledTimes(1);
    controller.destroy();
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  test("one controller per editor: a new one replaces the old", async () => {
    const second: BubbleHost = { ...host, root: document.createElement("div") };
    const next = createBubbleController(editor, scrollTarget, second);
    select();
    await until(() => second.root.isConnected);
    expect(host.root.isConnected).toBe(false);
    // The replaced controller's late destroy leaves the new one alone.
    controller.destroy();
    expect(second.root.isConnected).toBe(true);
    next.destroy();
    expect(second.root.isConnected).toBe(false);
  });
});

describe("bubbleReferenceRect", () => {
  test("returns a DOMRect in happy-dom (no layout) for both sides", () => {
    select();
    for (const placement of ["top", "bottom"] as const) {
      const rect = bubbleReferenceRect(editor.view, scrollTarget, placement);
      expect(rect).toBeInstanceOf(DOMRect);
    }
  });

  interface Line {
    top: number;
    left: number;
    right: number;
  }

  const rect = ({ top, left, right }: Line) =>
    new DOMRect(left, top, right - left, 20);

  /**
   * A view with stubbed geometry: the band is 150..700 (sticky row bottom
   * to scroll target bottom), lines are 20 px tall.
   */
  function stubView({
    from,
    to,
    lines,
    coords,
    hit,
    domAtPos,
    doc,
    rectsFor,
  }: {
    from: number;
    to: number;
    lines: Line[];
    coords: (pos: number) => { top: number; bottom: number };
    hit?: number;
    domAtPos?: (pos: number) => { node: Node; offset: number };
    /** A real document; by default one big textblock. */
    doc?: ProseMirrorNode;
    /** The rects of one measured range; by default `lines`. */
    rectsFor?: (from: number, to: number) => Line[];
  }) {
    const ranges: Array<[number, number]> = [];
    const probes: Array<{ left: number; top: number }> = [];
    const text = document.createTextNode("x");
    let start = -1;
    const view = {
      state: {
        selection: { from, to },
        // By default every position is inside one big textblock, so
        // ranges are only capped by the selection and the 300 positions.
        doc: doc ?? {
          content: { size: 5000 },
          resolve: () => ({
            parent: { inlineContent: true },
            start: () => 0,
            end: () => 1e6,
            before: () => -1,
            after: () => 1e6 + 1,
          }),
        },
      },
      dom: {
        getBoundingClientRect: () => new DOMRect(40, 0, 600, 5000),
        ownerDocument: {
          createRange: () => ({
            setStart: () => {},
            setEnd: () => {},
            getClientRects: () => {
              const last = ranges.at(-1);
              const own = rectsFor && last ? rectsFor(...last) : lines;
              return own.map(rect);
            },
          }),
        },
      },
      coordsAtPos: (pos: number) => ({ left: 50, right: 60, ...coords(pos) }),
      posAtCoords: (probe: { left: number; top: number }) => {
        probes.push(probe);
        return hit === undefined ? null : { pos: hit, inside: -1 };
      },
      domAtPos: (pos: number) => {
        if (start < 0) start = pos;
        else {
          ranges.push([start, pos]);
          start = -1;
        }
        return domAtPos ? domAtPos(pos) : { node: text, offset: 0 };
      },
    };
    return { view: view as unknown as EditorView, ranges, probes };
  }

  function stubScrollTarget(): HTMLElement {
    const target = document.createElement("div");
    target.getBoundingClientRect = () => new DOMRect(0, 100, 800, 600);
    const toolbar = document.createElement("div");
    toolbar.dataset.slot = "toolbar";
    toolbar.getBoundingClientRect = () => new DOMRect(0, 100, 800, 50);
    target.appendChild(toolbar);
    return target;
  }

  const inBand = () => ({ top: 300, bottom: 320 });

  test("top: the first line of the selection inside the band", () => {
    const { view, ranges } = stubView({
      from: 10,
      to: 50,
      coords: inBand,
      lines: [
        { top: 120, left: 60, right: 700 }, // under the sticky row
        { top: 300, left: 100, right: 300 },
        { top: 301, left: 300, right: 500 },
        { top: 320, left: 40, right: 640 },
      ],
    });
    const result = bubbleReferenceRect(view, stubScrollTarget(), "top");
    expect(ranges).toEqual([[10, 50]]);
    expect([result.left, result.right, result.top, result.bottom]).toEqual([
      100, 500, 300, 321,
    ]);
  });

  test("top: a start above the band reads at most 300 positions from the band's first line", () => {
    const { view, ranges, probes } = stubView({
      from: 10,
      to: 4000,
      coords: (pos) => (pos === 10 ? { top: 20, bottom: 40 } : inBand()),
      hit: 900,
      lines: [{ top: 160, left: 40, right: 640 }],
    });
    bubbleReferenceRect(view, stubScrollTarget(), "top");
    expect(probes).toEqual([{ left: 41, top: 151 }]);
    expect(ranges).toEqual([[900, 1200]]);
  });

  test("top: the band hit is clamped into the selection", () => {
    const { view, ranges } = stubView({
      from: 10,
      to: 40,
      coords: (pos) => (pos === 10 ? { top: 20, bottom: 40 } : inBand()),
      hit: 3,
      lines: [{ top: 160, left: 40, right: 640 }],
    });
    bubbleReferenceRect(view, stubScrollTarget(), "top");
    expect(ranges).toEqual([[10, 40]]);
  });

  test("bottom: the last selected line, when the selection ends in the band", () => {
    const { view, ranges, probes } = stubView({
      from: 10,
      to: 2000,
      coords: (pos) => (pos === 10 ? { top: 20, bottom: 40 } : inBand()),
      lines: [
        { top: 600, left: 40, right: 640 },
        { top: 680, left: 40, right: 200 },
      ],
    });
    const result = bubbleReferenceRect(view, stubScrollTarget(), "bottom");
    expect(probes).toEqual([]);
    expect(ranges).toEqual([[1700, 2000]]);
    expect([result.left, result.right, result.top]).toEqual([40, 200, 680]);
  });

  test("bottom: no room under the last line takes the first visible line", () => {
    const { view, ranges } = stubView({
      from: 10,
      to: 2000,
      coords: inBand,
      lines: [
        { top: 300, left: 40, right: 640 },
        { top: 680, left: 40, right: 200 },
      ],
    });
    const target = stubScrollTarget();
    const roomy = bubbleReferenceRect(view, target, "bottom", 0);
    expect(roomy.top).toBe(680);
    // 680 + 20 + 46 is past the band's bottom (700).
    const tight = bubbleReferenceRect(view, target, "bottom", 46);
    expect(tight.top).toBe(300);
    expect(ranges.at(-1)).toEqual([10, 310]);
  });

  test("bottom: a selection past the band's bottom (select all) takes its first visible line", () => {
    const { view, ranges, probes } = stubView({
      from: 0,
      to: 4000,
      coords: (pos) =>
        pos === 0
          ? { top: 20, bottom: 40 }
          : pos === 4000
            ? { top: 900, bottom: 920 }
            : inBand(),
      hit: 900,
      lines: [
        { top: 160, left: 40, right: 300 },
        { top: 680, left: 40, right: 640 },
      ],
    });
    const result = bubbleReferenceRect(view, stubScrollTarget(), "bottom");
    expect(probes).toEqual([{ left: 41, top: 151 }]);
    expect(ranges).toEqual([[900, 1200]]);
    expect([result.left, result.right, result.top]).toEqual([40, 300, 160]);
  });

  describe("each range stays inside one textblock", () => {
    // Title 0..7 (text 1..6), "One" 7..12 (text 8..11), empty paragraph
    // 12..14, "Two" 14..19 (text 15..18).
    const realDoc = () => {
      const ed = createTestEditor({
        content: {
          type: "doc",
          content: [
            {
              type: "heading",
              attrs: { level: 1 },
              content: [{ type: "text", text: "Title" }],
            },
            { type: "paragraph", content: [{ type: "text", text: "One" }] },
            { type: "paragraph" },
            { type: "paragraph", content: [{ type: "text", text: "Two" }] },
          ],
        },
      });
      const doc = ed.state.doc;
      ed.destroy();
      return doc;
    };

    test("top: a start at a textblock's end reads the next one, skipping an empty one", () => {
      const doc = realDoc();
      expect(doc.content.size).toBe(19);
      const { view, ranges } = stubView({
        doc,
        from: 11,
        to: 18,
        coords: inBand,
        lines: [],
        // Only "Two" has a line; a whole-block box would be in every other.
        rectsFor: (a) => (a === 15 ? [{ top: 300, left: 40, right: 80 }] : []),
      });
      const result = bubbleReferenceRect(view, stubScrollTarget(), "top");
      // "One" from its end is empty; the empty paragraph is skipped.
      expect(ranges).toEqual([[15, 18]]);
      expect([result.top, result.left, result.right]).toEqual([300, 40, 80]);
    });

    test("top: a select-all start reads the title only, never past it", () => {
      const doc = realDoc();
      const { view, ranges } = stubView({
        doc,
        from: 0,
        to: 19,
        coords: inBand,
        lines: [{ top: 300, left: 40, right: 640 }],
      });
      bubbleReferenceRect(view, stubScrollTarget(), "top");
      expect(ranges).toEqual([[1, 6]]);
    });

    test("bottom: an end at a textblock's start reads the previous one", () => {
      const doc = realDoc();
      const { view, ranges } = stubView({
        doc,
        from: 1,
        to: 15,
        coords: inBand,
        lines: [],
        rectsFor: (a) => (a === 8 ? [{ top: 300, left: 40, right: 80 }] : []),
      });
      const result = bubbleReferenceRect(view, stubScrollTarget(), "bottom");
      expect(ranges).toEqual([[8, 11]]);
      expect(result.top).toBe(300);
    });
  });

  test("falls back to the selection's rect when no line shows", () => {
    const { view } = stubView({
      from: 10,
      to: 50,
      coords: (pos) => ({ top: pos, bottom: pos + 20 }),
      lines: [],
    });
    const result = bubbleReferenceRect(view, stubScrollTarget(), "top");
    expect([result.top, result.bottom]).toEqual([10, 70]);
  });

  test("falls back when measuring throws", () => {
    const { view } = stubView({
      from: 10,
      to: 50,
      coords: (pos) => ({ top: pos, bottom: pos + 20 }),
      lines: [{ top: 300, left: 40, right: 640 }],
      domAtPos: () => {
        throw new RangeError("no DOM");
      },
    });
    const result = bubbleReferenceRect(view, stubScrollTarget(), "bottom");
    expect([result.top, result.bottom]).toEqual([10, 70]);
  });
});

describe("intoTextblock", () => {
  const doc = () =>
    createTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: "Title" }],
          },
          { type: "horizontalRule" },
          { type: "paragraph", content: [{ type: "text", text: "Body" }] },
        ],
      },
    });

  test("keeps a position that is already in a textblock", () => {
    const ed = doc();
    expect(intoTextblock(ed.state.doc, 3, 1, 20)).toBe(3);
    expect(intoTextblock(ed.state.doc, 3, -1, 0)).toBe(3);
    ed.destroy();
  });

  test("moves a block boundary forward into the next textblock, past a rule", () => {
    const ed = doc();
    // 0: before the title; 7: after it, before the rule; 8: after the rule.
    expect(intoTextblock(ed.state.doc, 0, 1, 100)).toBe(1);
    expect(intoTextblock(ed.state.doc, 7, 1, 100)).toBe(9);
    ed.destroy();
  });

  test("moves the end backward into the previous textblock", () => {
    const ed = doc();
    const size = ed.state.doc.content.size;
    expect(intoTextblock(ed.state.doc, size, -1, 0)).toBe(size - 1);
    expect(intoTextblock(ed.state.doc, 8, -1, 0)).toBe(6);
    ed.destroy();
  });

  test("never passes the limit", () => {
    const ed = doc();
    expect(intoTextblock(ed.state.doc, 7, 1, 8)).toBe(8);
    expect(intoTextblock(ed.state.doc, 8, -1, 7)).toBe(7);
    ed.destroy();
  });
});
