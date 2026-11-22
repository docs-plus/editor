import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import type { Editor as ReactEditor } from "@tiptap/react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { EmptyLinePlus } from "@/components/smart-toolbar/slash/empty-line-plus";
import { createTestEditor } from "@/tests/helpers/create-test-editor";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Typing performance (spec §12.3): with nothing to show, typing in a line
 * of text costs the `+` no animation frame and no DOM write, through the
 * keystroke, its transaction, Tiptap's `update` and the 300 ms settle.
 */

let editor: Editor | undefined;
let root: Root | undefined;
let container: HTMLElement | undefined;
const realMatchMedia = window.matchMedia;
const realRaf = window.requestAnimationFrame;
let frames = 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  window.matchMedia = ((query: string) => ({
    matches: true,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
  frames = 0;
  window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    frames++;
    return realRaf(callback);
  }) as typeof window.requestAnimationFrame;
});

afterEach(() => {
  act(() => root?.unmount());
  editor?.destroy();
  container?.remove();
  editor = root = container = undefined;
  window.matchMedia = realMatchMedia;
  window.requestAnimationFrame = realRaf;
});

function mount(): { scroller: HTMLElement; button: HTMLElement } {
  editor = createTestEditor({
    content: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Title" }],
        },
        { type: "paragraph", content: [{ type: "text", text: "text" }] },
        { type: "paragraph" },
      ],
    },
  });
  const scroller = editor.view.dom.parentElement as HTMLElement;
  document.body.appendChild(scroller);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      createElement(EmptyLinePlus, {
        editor: editor as unknown as ReactEditor,
        scrollTarget: scroller,
      }),
    ),
  );
  const button = scroller.querySelector<HTMLElement>("[data-empty-line-plus]");
  if (!button) throw new Error("the + did not mount");
  return { scroller, button };
}

/** One keystroke and its transaction, as typing makes them. */
function type(ed: Editor, char: string) {
  ed.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: char }));
  const { from } = ed.state.selection;
  ed.view.dispatch(ed.state.tr.insertText(char, from));
}

describe("the + while typing", () => {
  it("typing in a line of text schedules no frame and writes nothing", async () => {
    const { button } = mount();
    const ed = editor as Editor;
    // The caret at the end of "text".
    ed.view.dispatch(
      ed.state.tr.setSelection(TextSelection.create(ed.state.doc, 12)),
    );
    await sleep(50);
    const writes: MutationRecord[] = [];
    const observer = new MutationObserver((records) => writes.push(...records));
    observer.observe(button, { attributes: true });
    frames = 0;
    for (const char of "typing") type(ed, char);
    // Past the 300 ms settle.
    await sleep(400);
    observer.disconnect();
    expect(frames).toBe(0);
    expect(writes).toEqual([]);

    // Control: moving into the empty line does schedule its frame.
    const empty = ed.state.doc.content.size - 1;
    ed.view.dispatch(
      ed.state.tr.setSelection(TextSelection.create(ed.state.doc, empty)),
    );
    expect(frames).toBeGreaterThan(0);
  });
});
