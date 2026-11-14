import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import type { Editor, Extension } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import type { Swatch } from "@/components/smart-toolbar/color/swatch";
import {
  canPreview,
  PREVIEW_DWELL_MS,
  PREVIEW_MAX_BLOCKS,
  type SwatchPreview,
  swatchPreviewAttrs,
  useSwatchPreview,
} from "@/components/smart-toolbar/color/swatch-preview";
import { ActionPreview, actionPreviewKey } from "@/extensions/action-preview";
import {
  createTestEditor,
  DEFAULT_EXTENSIONS,
} from "@/tests/helpers/create-test-editor";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const RED: Swatch = { kind: "text", token: "red" };
const BLUE: Swatch = { kind: "text", token: "blue" };
const YELLOW: Swatch = { kind: "highlight", token: "yellow" };

const paragraph = (text: string) => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});
const doc = (paragraphs: number) => ({
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "Title" }],
    },
    ...Array.from({ length: paragraphs }, (_, i) => paragraph(`line ${i}`)),
  ],
});
/** "line" in the first paragraph (the title "Title" fills 1..6). */
const LINE = { from: 8, to: 12 };

let editor: Editor | undefined;
let root: Root | undefined;
let host: HTMLElement | undefined;

function setup(paragraphs = 2): Editor {
  editor = createTestEditor({
    content: doc(paragraphs),
    extensions: [...DEFAULT_EXTENSIONS, ActionPreview] as Extension[],
  });
  return editor;
}

const shownAttrs = (e: Editor) =>
  actionPreviewKey.getState(e.state)?.find()[0]?.spec;
const shownCount = (e: Editor) =>
  actionPreviewKey.getState(e.state)?.find().length ?? 0;

/** Media queries the stub answers true for. */
let mediaMatches = new Set<string>();
const originalMatchMedia = window.matchMedia;
const originalEnv = process.env.NEXT_PUBLIC_ACTION_PREVIEW;

beforeEach(() => {
  mediaMatches = new Set(["(hover: hover) and (pointer: fine)"]);
  window.matchMedia = ((query: string) => ({
    matches: mediaMatches.has(query),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
  delete process.env.NEXT_PUBLIC_ACTION_PREVIEW;
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  editor?.destroy();
  root = undefined;
  host = undefined;
  editor = undefined;
  window.matchMedia = originalMatchMedia;
  if (originalEnv === undefined) delete process.env.NEXT_PUBLIC_ACTION_PREVIEW;
  else process.env.NEXT_PUBLIC_ACTION_PREVIEW = originalEnv;
});

/** The hook's latest value. */
const latest = {} as { current: SwatchPreview };

function Probe({ target }: { target: Editor }) {
  latest.current = useSwatchPreview(target);
  return null;
}

/** Mounts the hook and returns its latest value. */
function mount(e: Editor): { current: SwatchPreview } {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(createElement(Probe, { target: e })));
  return latest;
}

const mouse = { pointerType: "mouse" };
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

describe("swatchPreviewAttrs", () => {
  it("maps each swatch to the real mark's data attribute", () => {
    expect(swatchPreviewAttrs(RED)).toEqual({
      "data-text-color": "red",
      class: "tt-preview",
      style: "background-color: transparent",
    });
    expect(swatchPreviewAttrs(YELLOW)).toEqual({
      nodeName: "mark",
      "data-highlight": "yellow",
      class: "tt-preview",
      style: "background-color: var(--tt-color-highlight-yellow)",
    });
  });

  it("previews Default text and No highlight with the page's colours", () => {
    expect(swatchPreviewAttrs({ kind: "text", token: null })).toEqual({
      class: "tt-preview",
      style: "color: var(--foreground); background-color: transparent",
    });
    expect(swatchPreviewAttrs({ kind: "highlight", token: null })).toEqual({
      class: "tt-preview",
      style: "background-color: var(--background)",
    });
  });

  it("returns null for invalid tokens", () => {
    expect(
      swatchPreviewAttrs({ kind: "text", token: "#f00" } as unknown as Swatch),
    ).toBeNull();
    expect(
      swatchPreviewAttrs({
        kind: "highlight",
        token: 'red"><img',
      } as unknown as Swatch),
    ).toBeNull();
  });
});

describe("canPreview", () => {
  it("accepts a text range", () => {
    const e = setup();
    e.commands.setTextSelection(LINE);
    expect(canPreview(e)).toBe(true);
  });

  it("refuses a caret, a node selection and a read-only editor", () => {
    const e = setup();
    e.commands.setTextSelection(9);
    expect(canPreview(e)).toBe(false);
    e.view.dispatch(
      e.state.tr.setSelection(NodeSelection.create(e.state.doc, 7)),
    );
    expect(canPreview(e)).toBe(false);
    e.commands.setTextSelection(LINE);
    e.setEditable(false);
    expect(canPreview(e)).toBe(false);
  });

  it("refuses a selection over more than the block cap", () => {
    const e = setup(PREVIEW_MAX_BLOCKS + 5);
    e.commands.selectAll();
    expect(canPreview(e)).toBe(false);
  });

  it("refuses a selection longer than the position cap", () => {
    const e = createTestEditor({
      content: {
        type: "doc",
        content: [doc(0).content[0], paragraph("x".repeat(20_001))],
      },
      extensions: [...DEFAULT_EXTENSIONS, ActionPreview] as Extension[],
    });
    editor = e;
    e.commands.setTextSelection({ from: 8, to: 8 + 20_001 });
    expect(canPreview(e)).toBe(false);
  });
});

describe("useSwatchPreview", () => {
  it("shows at once on show, and clears on clear", () => {
    const e = setup();
    e.commands.setTextSelection(LINE);
    const preview = mount(e);
    act(() => preview.current.show(RED));
    expect(shownAttrs(e)).toBeDefined();
    expect(e.view.dom.querySelector('[data-text-color="red"]')).not.toBeNull();
    act(() => preview.current.clear());
    expect(shownCount(e)).toBe(0);
  });

  it("a mouse shows after the dwell", async () => {
    const e = setup();
    e.commands.setTextSelection(LINE);
    const preview = mount(e);
    act(() => preview.current.hover(mouse, RED));
    expect(shownCount(e)).toBe(0);
    await act(() => wait(PREVIEW_DWELL_MS + 30));
    expect(e.view.dom.querySelector('[data-text-color="red"]')).not.toBeNull();
  });

  it("sweeping across swatches shows only the one the pointer rests on", async () => {
    const e = setup();
    e.commands.setTextSelection(LINE);
    const preview = mount(e);
    let transactions = 0;
    e.on("transaction", ({ transaction }) => {
      if (transaction.getMeta(actionPreviewKey) !== undefined)
        transactions += 1;
    });
    act(() => {
      preview.current.hover(mouse, RED);
      preview.current.leave();
      preview.current.hover(mouse, YELLOW);
      preview.current.leave();
      preview.current.hover(mouse, BLUE);
    });
    await act(() => wait(PREVIEW_DWELL_MS + 30));
    expect(transactions).toBe(1);
    expect(e.view.dom.querySelector('[data-text-color="blue"]')).not.toBeNull();
  });

  it("leaving clears after the dwell unless another swatch takes over", async () => {
    const e = setup();
    e.commands.setTextSelection(LINE);
    const preview = mount(e);
    act(() => preview.current.show(RED));
    act(() => preview.current.leave());
    expect(shownCount(e)).toBe(1);
    await act(() => wait(PREVIEW_DWELL_MS + 30));
    expect(shownCount(e)).toBe(0);
  });

  it("a repeated arrow key waits the dwell, so holding a key does not flash", async () => {
    const e = setup();
    e.commands.setTextSelection(LINE);
    const preview = mount(e);
    act(() => {
      preview.current.show(RED, true);
      preview.current.show(BLUE, true);
    });
    expect(shownCount(e)).toBe(0);
    await act(() => wait(PREVIEW_DWELL_MS + 30));
    expect(e.view.dom.querySelector('[data-text-color="blue"]')).not.toBeNull();
  });

  it("a touch pointer never shows", async () => {
    const e = setup();
    e.commands.setTextSelection(LINE);
    const preview = mount(e);
    act(() => preview.current.hover({ pointerType: "touch" }, RED));
    await act(() => wait(PREVIEW_DWELL_MS + 30));
    expect(shownCount(e)).toBe(0);
  });

  it("a swatch that cannot apply (null) clears instead", () => {
    const e = setup();
    e.commands.setTextSelection(LINE);
    const preview = mount(e);
    act(() => preview.current.show(RED));
    act(() => preview.current.show(null));
    expect(shownCount(e)).toBe(0);
  });

  it("shows nothing for a caret", () => {
    const e = setup();
    e.commands.setTextSelection(9);
    const preview = mount(e);
    act(() => preview.current.show(RED));
    expect(shownCount(e)).toBe(0);
  });

  it("is off without a fine hovering pointer", () => {
    mediaMatches = new Set(["(pointer: coarse)"]);
    const e = setup();
    e.commands.setTextSelection(LINE);
    const preview = mount(e);
    act(() => preview.current.show(RED));
    expect(shownCount(e)).toBe(0);
  });

  it("is off in forced colours", () => {
    mediaMatches.add("(forced-colors: active)");
    const e = setup();
    e.commands.setTextSelection(LINE);
    const preview = mount(e);
    act(() => preview.current.show(RED));
    expect(shownCount(e)).toBe(0);
  });

  it("NEXT_PUBLIC_ACTION_PREVIEW=0 disables it", () => {
    process.env.NEXT_PUBLIC_ACTION_PREVIEW = "0";
    const e = setup();
    e.commands.setTextSelection(LINE);
    const preview = mount(e);
    act(() => preview.current.show(RED));
    expect(shownCount(e)).toBe(0);
  });

  it("unmount clears the preview and cancels the timer", async () => {
    const e = setup();
    e.commands.setTextSelection(LINE);
    const preview = mount(e);
    act(() => preview.current.show(RED));
    act(() => preview.current.hover(mouse, BLUE));
    act(() => root?.unmount());
    root = undefined;
    expect(shownCount(e)).toBe(0);
    await wait(PREVIEW_DWELL_MS + 30);
    expect(shownCount(e)).toBe(0);
  });

  it("unmount after the editor is destroyed does not throw", () => {
    const e = setup();
    mount(e);
    e.destroy();
    expect(() => act(() => root?.unmount())).not.toThrow();
    root = undefined;
  });
});
