import { afterEach, describe, expect, it, vi } from "bun:test";

import type { Editor, Extension } from "@tiptap/core";
import { TableOfContents } from "@tiptap/extension-table-of-contents";

import {
  getEditorVersionStore,
  TOOLBAR_MAX_WAIT_MS,
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

  it("notifies at least every TOOLBAR_MAX_WAIT_MS while changes never pause", () => {
    const { editor: instance, listener } = setup();
    for (let t = 0; t < 2 * TOOLBAR_MAX_WAIT_MS; t += 100) {
      instance.commands.insertContentAt(9, "x");
      vi.advanceTimersByTime(100);
    }
    // Max-wait fires at 1000 and 2000. The 2000 notify also clears the settle
    // timer from the insert at 1900, so no third call follows.
    expect(listener).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(TOOLBAR_SETTLE_MS);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("starts a fresh max-wait window after a notify", () => {
    const { editor: instance, listener } = setup();
    instance.commands.insertContentAt(9, "x");
    vi.advanceTimersByTime(TOOLBAR_SETTLE_MS);
    expect(listener).toHaveBeenCalledTimes(1);
    // A max-wait timer left over from the first change would fire at 1000.
    for (let t = 0; t < TOOLBAR_MAX_WAIT_MS - 100; t += 100) {
      instance.commands.insertContentAt(9, "x");
      vi.advanceTimersByTime(100);
    }
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("leaves no timer behind when the last subscriber leaves mid-burst", () => {
    const { editor: instance, listener, unsubscribe } = setup();
    instance.commands.insertContentAt(9, "x");
    unsubscribe();
    vi.advanceTimersByTime(TOOLBAR_MAX_WAIT_MS);
    expect(listener).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
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
