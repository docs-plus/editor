import { describe, expect, it, vi } from "bun:test";

import { Plugin, PluginKey } from "@tiptap/pm/state";
import { EditorView } from "@tiptap/pm/view";

import { headingFoldPluginKey } from "@/extensions/heading-fold";
import { createTestEditor } from "@/tests/helpers/create-test-editor";

const FOLD_CONTENT = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 1, "data-toc-id": "title" },
      content: [{ type: "text", text: "Title" }],
    },
    {
      type: "heading",
      attrs: { level: 2, "data-toc-id": "sec-a" },
      content: [{ type: "text", text: "Section A" }],
    },
    { type: "paragraph", content: [{ type: "text", text: "Content A" }] },
    {
      type: "heading",
      attrs: { level: 3, "data-toc-id": "sec-a1" },
      content: [{ type: "text", text: "Subsection A1" }],
    },
    { type: "paragraph", content: [{ type: "text", text: "Content A1" }] },
    {
      type: "heading",
      attrs: { level: 2, "data-toc-id": "sec-b" },
      content: [{ type: "text", text: "Section B" }],
    },
    { type: "paragraph", content: [{ type: "text", text: "Content B" }] },
  ],
};

describe("HeadingFold plugin state", () => {
  it("initial state: foldedIds is empty, decos is empty", () => {
    const editor = createTestEditor({ content: FOLD_CONTENT });
    const state = headingFoldPluginKey.getState(editor.state);
    expect(state).toBeDefined();
    expect(state?.foldedIds.size).toBe(0);
    expect(state?.decos.find().length).toBe(0);
    editor.destroy();
  });

  it("toggle fold: foldedIds has sec-a, animating has sec-a → folding, decos non-empty", () => {
    const editor = createTestEditor({ content: FOLD_CONTENT });
    const { tr } = editor.state;
    tr.setMeta(headingFoldPluginKey, {
      type: "toggle",
      id: "sec-a",
      contentHeight: 100,
    });
    editor.view.dispatch(tr);

    const state = headingFoldPluginKey.getState(editor.state);
    expect(state?.foldedIds.has("sec-a")).toBe(true);
    expect(state?.animating.get("sec-a")).toBe("folding");
    expect(state?.decos.find().length).toBeGreaterThan(0);
    editor.destroy();
  });

  it("toggle again while animating: no-op (animating guard)", () => {
    const editor = createTestEditor({ content: FOLD_CONTENT });
    const { tr } = editor.state;
    tr.setMeta(headingFoldPluginKey, {
      type: "toggle",
      id: "sec-a",
      contentHeight: 100,
    });
    editor.view.dispatch(tr);

    const stateAfterFirst = headingFoldPluginKey.getState(editor.state);

    const { tr: tr2 } = editor.state;
    tr2.setMeta(headingFoldPluginKey, {
      type: "toggle",
      id: "sec-a",
      contentHeight: 100,
    });
    editor.view.dispatch(tr2);

    const stateAfterSecond = headingFoldPluginKey.getState(editor.state);
    expect(stateAfterSecond).toBe(stateAfterFirst);
    editor.destroy();
  });

  it("end animation then toggle off: starts unfolding animation", () => {
    const editor = createTestEditor({ content: FOLD_CONTENT });
    const { tr } = editor.state;
    tr.setMeta(headingFoldPluginKey, {
      type: "toggle",
      id: "sec-a",
      contentHeight: 100,
    });
    editor.view.dispatch(tr);

    const { tr: trEnd } = editor.state;
    trEnd.setMeta(headingFoldPluginKey, { type: "endAnimation", id: "sec-a" });
    editor.view.dispatch(trEnd);

    const stateAfterEnd = headingFoldPluginKey.getState(editor.state);
    expect(stateAfterEnd?.animating.has("sec-a")).toBe(false);
    expect(stateAfterEnd?.foldedIds.has("sec-a")).toBe(true);

    const { tr: trToggle } = editor.state;
    trToggle.setMeta(headingFoldPluginKey, {
      type: "toggle",
      id: "sec-a",
      contentHeight: 100,
    });
    editor.view.dispatch(trToggle);

    const stateFolded = headingFoldPluginKey.getState(editor.state);
    expect(stateFolded?.foldedIds.has("sec-a")).toBe(true);

    const { tr: trToggleOff } = editor.state;
    trToggleOff.setMeta(headingFoldPluginKey, {
      type: "toggle",
      id: "sec-a",
      contentHeight: 100,
    });
    editor.view.dispatch(trToggleOff);

    const stateUnfolding = headingFoldPluginKey.getState(editor.state);
    expect(stateUnfolding?.animating.get("sec-a")).toBe("unfolding");
    editor.destroy();
  });

  it("set folds with persist: false → foldedIds has both, skipPersist is true", () => {
    const editor = createTestEditor({ content: FOLD_CONTENT });
    const { tr } = editor.state;
    tr.setMeta(headingFoldPluginKey, {
      type: "set",
      ids: new Set(["sec-a", "sec-b"]),
      persist: false,
    });
    editor.view.dispatch(tr);

    const state = headingFoldPluginKey.getState(editor.state);
    expect(state?.foldedIds.has("sec-a")).toBe(true);
    expect(state?.foldedIds.has("sec-b")).toBe(true);
    expect(state?.skipPersist).toBe(true);
    editor.destroy();
  });

  it("end animation: animating map loses sec-a, foldedIds retains (folding complete)", () => {
    const editor = createTestEditor({ content: FOLD_CONTENT });
    const { tr } = editor.state;
    tr.setMeta(headingFoldPluginKey, {
      type: "toggle",
      id: "sec-a",
      contentHeight: 100,
    });
    editor.view.dispatch(tr);

    expect(
      headingFoldPluginKey.getState(editor.state)?.animating.has("sec-a"),
    ).toBe(true);

    const { tr: trEnd } = editor.state;
    trEnd.setMeta(headingFoldPluginKey, { type: "endAnimation", id: "sec-a" });
    editor.view.dispatch(trEnd);

    const state = headingFoldPluginKey.getState(editor.state);
    expect(state?.animating.has("sec-a")).toBe(false);
    expect(state?.foldedIds.has("sec-a")).toBe(true);
    editor.destroy();
  });

  it("ends the fold animation in a view mounted after another view was destroyed", () => {
    // React StrictMode / EditorContent remounts destroy and recreate views
    // for the same plugin instance; the new view must still finish animations.
    vi.useFakeTimers();
    try {
      const editor = createTestEditor({ content: FOLD_CONTENT });
      const first = new EditorView(document.createElement("div"), {
        state: editor.state,
      });
      first.destroy();

      const second = new EditorView(document.createElement("div"), {
        state: editor.state,
      });
      second.dispatch(
        second.state.tr.setMeta(headingFoldPluginKey, {
          type: "toggle",
          id: "sec-a",
          contentHeight: 100,
        }),
      );
      expect(
        headingFoldPluginKey.getState(second.state)?.animating.get("sec-a"),
      ).toBe("folding");

      vi.advanceTimersByTime(1000);

      const state = headingFoldPluginKey.getState(second.state);
      expect(state?.animating.has("sec-a")).toBe(false);
      expect(state?.foldedIds.has("sec-a")).toBe(true);
      second.destroy();
      editor.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ends a running fold animation when the plugin set changes mid-animation", () => {
    // Registering a plugin (the lazily mounted selection bubble) makes
    // ProseMirror rebuild every plugin view; the old view's timer dies.
    vi.useFakeTimers();
    try {
      const editor = createTestEditor({ content: FOLD_CONTENT });
      const view = new EditorView(document.createElement("div"), {
        state: editor.state,
      });
      view.dispatch(
        view.state.tr.setMeta(headingFoldPluginKey, {
          type: "toggle",
          id: "sec-a",
          contentHeight: 100,
        }),
      );
      view.updateState(
        view.state.reconfigure({
          plugins: [
            ...view.state.plugins,
            new Plugin({ key: new PluginKey("midFold") }),
          ],
        }),
      );

      vi.advanceTimersByTime(1000);

      const state = headingFoldPluginKey.getState(view.state);
      expect(state?.animating.has("sec-a")).toBe(false);
      expect(state?.foldedIds.has("sec-a")).toBe(true);
      view.destroy();
      editor.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("content-only edit with folds active: decos mapped, foldedIds unchanged", () => {
    const editor = createTestEditor({ content: FOLD_CONTENT });
    const { tr } = editor.state;
    tr.setMeta(headingFoldPluginKey, {
      type: "toggle",
      id: "sec-a",
      contentHeight: 100,
    });
    editor.view.dispatch(tr);

    const { tr: trEnd } = editor.state;
    trEnd.setMeta(headingFoldPluginKey, { type: "endAnimation", id: "sec-a" });
    editor.view.dispatch(trEnd);

    const stateBefore = headingFoldPluginKey.getState(editor.state);
    const decosBefore = stateBefore?.decos.find() ?? [];

    const doc = editor.state.doc;
    let paraPos = 0;
    for (let i = 0; i < doc.childCount; i++) {
      if (doc.child(i).type.name === "paragraph") {
        paraPos += 1;
        break;
      }
      paraPos += doc.child(i).nodeSize;
    }

    editor.commands.setTextSelection(paraPos);
    editor.commands.insertContent("x");

    const stateAfter = headingFoldPluginKey.getState(editor.state);
    expect(stateAfter?.foldedIds.has("sec-a")).toBe(true);
    expect(stateAfter?.foldedIds.size).toBe(stateBefore?.foldedIds.size ?? 0);
    const decosAfter = stateAfter?.decos.find() ?? [];
    expect(decosAfter.length).toBe(decosBefore.length);
    editor.destroy();
  });

  it("fold all sections: all body heading IDs folded", () => {
    const editor = createTestEditor({ content: FOLD_CONTENT });
    const { tr } = editor.state;
    tr.setMeta(headingFoldPluginKey, {
      type: "set",
      ids: new Set(["sec-a", "sec-a1", "sec-b"]),
      persist: false,
    });
    editor.view.dispatch(tr);

    const state = headingFoldPluginKey.getState(editor.state);
    expect(state?.foldedIds.has("sec-a")).toBe(true);
    expect(state?.foldedIds.has("sec-a1")).toBe(true);
    expect(state?.foldedIds.has("sec-b")).toBe(true);
    expect(state?.foldedIds.size).toBe(3);
    expect(state?.decos.find().length).toBeGreaterThan(0);
    editor.destroy();
  });
});
