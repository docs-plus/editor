import { afterEach, describe, expect, it, vi } from "bun:test";

import type { Editor, Extension } from "@tiptap/core";
import { TableOfContents } from "@tiptap/extension-table-of-contents";

import {
  getEditorVersionStore,
  TOOLBAR_SETTLE_MS,
} from "@/hooks/use-tiptap-editor";

import {
  createTestEditor,
  DEFAULT_EXTENSIONS,
} from "../../helpers/create-test-editor";

let editor: Editor | undefined;
afterEach(() => {
  editor?.destroy();
  vi.useRealTimers();
});

function setup() {
  vi.useFakeTimers();
  editor = createTestEditor({
    // The stock TOC dispatches a transaction after every change; the app
    // uses FastTableOfContents, which does not.
    extensions: DEFAULT_EXTENSIONS.filter(
      (extension) => extension !== TableOfContents,
    ) as Extension[],
    content: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Title" }],
        },
        { type: "paragraph", content: [{ type: "text", text: "Body" }] },
      ],
    },
  });
  const store = getEditorVersionStore(editor);
  const listener = vi.fn();
  const unsubscribe = store.subscribe(listener);
  // Let `onCreate` work (UniqueID's id pass) settle first. Tiptap emits
  // `create` from a timer, so its settle timer outlasts one TOOLBAR_SETTLE_MS.
  vi.runAllTimers();
  listener.mockClear();
  return { editor, store, listener, unsubscribe };
}

describe("editor version store", () => {
  it("is shared per editor", () => {
    const { editor: instance, store } = setup();
    expect(getEditorVersionStore(instance)).toBe(store);
  });

  it("moves at once when the selection or editability changes", () => {
    const { editor: instance, store, listener } = setup();
    const before = store.getVersion();
    instance.commands.setTextSelection(3);
    expect(listener).toHaveBeenCalledTimes(1);
    instance.setEditable(false);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.getVersion()).toBe(before + 2);
  });

  it("ignores transactions that only carry plugin metadata", () => {
    const { editor: instance, listener } = setup();
    instance.view.dispatch(instance.state.tr.setMeta("cursorPing", true));
    vi.advanceTimersByTime(TOOLBAR_SETTLE_MS);
    expect(listener).not.toHaveBeenCalled();
  });

  it("waits for document changes to pause", () => {
    const { editor: instance, listener } = setup();
    for (let i = 0; i < 3; i++) {
      instance.commands.insertContentAt(9, "x");
      vi.advanceTimersByTime(TOOLBAR_SETTLE_MS - 1);
    }
    expect(listener).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("stops listening once the last subscriber leaves", () => {
    const { editor: instance, listener, unsubscribe } = setup();
    instance.commands.insertContentAt(9, "x");
    unsubscribe();
    vi.advanceTimersByTime(TOOLBAR_SETTLE_MS);
    instance.commands.setTextSelection(3);
    expect(listener).not.toHaveBeenCalled();
  });
});
