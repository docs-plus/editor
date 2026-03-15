import { describe, expect, it } from "vitest";
import { headingFilterPluginKey } from "@/components/tiptap-node/heading-node/heading-filter-plugin";
import { createTestEditor } from "@/tests/helpers/create-test-editor";

const FILTER_CONTENT = {
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

describe("HeadingFilter plugin state", () => {
  it("initial state: slugs empty, previewQuery empty, all section IDs in matchedSectionIds", () => {
    const editor = createTestEditor({ content: FILTER_CONTENT });
    const state = headingFilterPluginKey.getState(editor.state);
    expect(state).toBeDefined();
    expect(state?.slugs).toEqual([]);
    expect(state?.previewQuery).toBe("");
    expect(state?.matchedSectionIds.has("sec-a")).toBe(true);
    expect(state?.matchedSectionIds.has("sec-a1")).toBe(true);
    expect(state?.matchedSectionIds.has("sec-b")).toBe(true);
    expect(state?.totalSections).toBe(3);
    editor.destroy();
  });

  it("preview meta: previewQuery set, matchedSectionIds updated to match", () => {
    const editor = createTestEditor({ content: FILTER_CONTENT });
    const { tr } = editor.state;
    tr.setMeta(headingFilterPluginKey, { type: "preview", query: "Section A" });
    editor.view.dispatch(tr);

    const state = headingFilterPluginKey.getState(editor.state);
    expect(state?.previewQuery).toBe("Section A");
    expect(state?.matchedSectionIds.has("sec-a")).toBe(true);
    expect(state?.matchedSectionIds.size).toBeLessThanOrEqual(3);
    editor.destroy();
  });

  it("commit meta: slugs has slug (lowercased), previewQuery cleared", () => {
    const editor = createTestEditor({ content: FILTER_CONTENT });
    const { tr } = editor.state;
    tr.setMeta(headingFilterPluginKey, { type: "commit", slug: "Section" });
    editor.view.dispatch(tr);

    const state = headingFilterPluginKey.getState(editor.state);
    expect(state?.slugs).toContain("section");
    expect(state?.previewQuery).toBe("");
    editor.destroy();
  });

  it("remove slug: after commit, slugs empty", () => {
    const editor = createTestEditor({ content: FILTER_CONTENT });
    const { tr } = editor.state;
    tr.setMeta(headingFilterPluginKey, { type: "commit", slug: "section" });
    editor.view.dispatch(tr);
    expect(headingFilterPluginKey.getState(editor.state)?.slugs).toContain(
      "section",
    );

    const { tr: trRemove } = editor.state;
    trRemove.setMeta(headingFilterPluginKey, {
      type: "remove",
      slug: "section",
    });
    editor.view.dispatch(trRemove);

    const state = headingFilterPluginKey.getState(editor.state);
    expect(state?.slugs).toEqual([]);
    editor.destroy();
  });

  it("clear meta: slugs empty, mode reset to or", () => {
    const editor = createTestEditor({ content: FILTER_CONTENT });
    const { tr } = editor.state;
    tr.setMeta(headingFilterPluginKey, {
      type: "apply",
      slugs: ["section", "content"],
      mode: "and",
    });
    editor.view.dispatch(tr);
    expect(headingFilterPluginKey.getState(editor.state)?.slugs.length).toBe(2);
    expect(headingFilterPluginKey.getState(editor.state)?.mode).toBe("and");

    const { tr: trClear } = editor.state;
    trClear.setMeta(headingFilterPluginKey, { type: "clear" });
    editor.view.dispatch(trClear);

    const state = headingFilterPluginKey.getState(editor.state);
    expect(state?.slugs).toEqual([]);
    expect(state?.mode).toBe("or");
    editor.destroy();
  });

  it("set mode: mode is and", () => {
    const editor = createTestEditor({ content: FILTER_CONTENT });
    const { tr } = editor.state;
    tr.setMeta(headingFilterPluginKey, { type: "setMode", mode: "and" });
    editor.view.dispatch(tr);

    const state = headingFilterPluginKey.getState(editor.state);
    expect(state?.mode).toBe("and");
    editor.destroy();
  });

  it("apply meta: both slugs set", () => {
    const editor = createTestEditor({ content: FILTER_CONTENT });
    const { tr } = editor.state;
    tr.setMeta(headingFilterPluginKey, {
      type: "apply",
      slugs: ["section", "content"],
      mode: "or",
    });
    editor.view.dispatch(tr);

    const state = headingFilterPluginKey.getState(editor.state);
    expect(state?.slugs).toContain("section");
    expect(state?.slugs).toContain("content");
    expect(state?.mode).toBe("or");
    editor.destroy();
  });

  it("content-only edit when inactive: state unchanged (fast path)", () => {
    const editor = createTestEditor({ content: FILTER_CONTENT });
    const stateBefore = headingFilterPluginKey.getState(editor.state);

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

    const stateAfter = headingFilterPluginKey.getState(editor.state);
    expect(stateAfter?.slugs).toEqual(stateBefore?.slugs ?? []);
    expect(stateAfter?.previewQuery).toBe(stateBefore?.previewQuery ?? "");
    expect(stateAfter?.matchedSectionIds.size).toBe(
      stateBefore?.matchedSectionIds.size ?? 0,
    );
    editor.destroy();
  });

  it("content-only edit when active: decos mapped", () => {
    const editor = createTestEditor({ content: FILTER_CONTENT });
    const { tr } = editor.state;
    tr.setMeta(headingFilterPluginKey, { type: "commit", slug: "section" });
    editor.view.dispatch(tr);

    const stateBefore = headingFilterPluginKey.getState(editor.state);
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

    const stateAfter = headingFilterPluginKey.getState(editor.state);
    expect(stateAfter?.slugs).toEqual(stateBefore?.slugs ?? []);
    const decosAfter = stateAfter?.decos.find() ?? [];
    expect(decosAfter.length).toBe(decosBefore.length);
    editor.destroy();
  });
});
