import { describe, expect, it } from "bun:test";

import type { Extension } from "@tiptap/core";

import {
  FILTER_REFOLD_MS,
  HeadingFilter,
  headingFilterPluginKey,
} from "@/extensions/heading-filter";
import { headingFoldPluginKey } from "@/extensions/heading-fold";
import {
  createTestEditor,
  DEFAULT_EXTENSIONS,
} from "@/tests/helpers/create-test-editor";

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

function withHeadingFilter(extension: Extension): Extension[] {
  return DEFAULT_EXTENSIONS.map((ext) =>
    (ext as { name?: string }).name === "headingFilter" ? extension : ext,
  );
}

function headingPosById(
  editor: ReturnType<typeof createTestEditor>,
  id: string,
) {
  const { doc } = editor.state;
  let pos = 0;
  for (let i = 0; i < doc.childCount; i++) {
    const child = doc.child(i);
    if (child.type.name === "heading" && child.attrs["data-toc-id"] === id) {
      return pos + 1;
    }
    pos += child.nodeSize;
  }
  return null;
}

describe("HeadingFilter plugin state", () => {
  it("with fold adapter: applies temporary folds and restores previous folds on clear", () => {
    const editor = createTestEditor({ content: FILTER_CONTENT });

    const { tr: trSet } = editor.state;
    trSet.setMeta(headingFoldPluginKey, {
      type: "set",
      ids: new Set(["sec-b"]),
      persist: true,
    });
    editor.view.dispatch(trSet);
    expect(headingFoldPluginKey.getState(editor.state)?.foldedIds).toEqual(
      new Set(["sec-b"]),
    );

    const { tr } = editor.state;
    tr.setMeta(headingFilterPluginKey, { type: "commit", slug: "section b" });
    editor.view.dispatch(tr);

    expect(headingFoldPluginKey.getState(editor.state)?.foldedIds).toEqual(
      new Set(["sec-a", "sec-a1"]),
    );

    const { tr: trClear } = editor.state;
    trClear.setMeta(headingFilterPluginKey, { type: "clear" });
    editor.view.dispatch(trClear);

    expect(headingFoldPluginKey.getState(editor.state)?.foldedIds).toEqual(
      new Set(["sec-b"]),
    );

    editor.destroy();
  });

  it("without fold adapter: filter state updates but fold state remains unchanged", () => {
    const editor = createTestEditor({
      content: FILTER_CONTENT,
      extensions: withHeadingFilter(HeadingFilter),
    });

    const beforeFolded = new Set(
      headingFoldPluginKey.getState(editor.state)?.foldedIds ?? [],
    );

    const { tr } = editor.state;
    tr.setMeta(headingFilterPluginKey, { type: "commit", slug: "section b" });
    editor.view.dispatch(tr);

    const filterState = headingFilterPluginKey.getState(editor.state);
    expect(filterState?.slugs).toContain("section b");
    expect(
      headingFoldPluginKey.getState(editor.state)?.foldedIds ?? new Set(),
    ).toEqual(beforeFolded);

    editor.destroy();
  });

  it("without fold adapter: cursor position is not relocated on filter apply", () => {
    const editor = createTestEditor({
      content: FILTER_CONTENT,
      extensions: withHeadingFilter(HeadingFilter),
    });

    const secBPos = headingPosById(editor, "sec-b");
    expect(secBPos).not.toBeNull();

    editor.commands.setTextSelection(secBPos ?? 1);
    const beforeAnchor = editor.state.selection.anchor;

    const { tr } = editor.state;
    tr.setMeta(headingFilterPluginKey, { type: "commit", slug: "section a" });
    editor.view.dispatch(tr);

    const afterAnchor = editor.state.selection.anchor;
    expect(afterAnchor).toBe(beforeAnchor);

    editor.destroy();
  });

  it("adapter errors are swallowed and do not crash filter updates", () => {
    const editor = createTestEditor({
      content: FILTER_CONTENT,
      extensions: withHeadingFilter(
        HeadingFilter.configure({
          foldAdapter: {
            getFoldedIds: () => new Set<string>(),
            setTemporaryFolds: () => {
              throw new Error("boom");
            },
            restoreFolds: (tr) => tr,
          },
        }),
      ),
    });

    expect(() => editor.commands.commitFilter("section b")).not.toThrow();
    expect(headingFilterPluginKey.getState(editor.state)?.slugs).toContain(
      "section b",
    );

    editor.destroy();
  });

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

describe("HeadingFilter re-folds after document edits", () => {
  type TestEditor = ReturnType<typeof createTestEditor>;
  const wait = () => Bun.sleep(FILTER_REFOLD_MS + 50);
  const folded = (editor: TestEditor) =>
    headingFoldPluginKey.getState(editor.state)?.foldedIds;

  function filtered(slug: string) {
    const editor = createTestEditor({ content: FILTER_CONTENT });
    editor.commands.commitFilter(slug);
    return editor;
  }

  /** Replaces a heading node whole, as y-tiptap applies a remote edit. */
  function renameHeading(editor: TestEditor, id: string, text: string) {
    const pos = (headingPosById(editor, id) ?? 1) - 1;
    const node = editor.state.doc.nodeAt(pos);
    if (!node) throw new Error(`No heading ${id}`);
    const { schema } = editor.state;
    editor.view.dispatch(
      editor.state.tr.replaceWith(
        pos,
        pos + node.nodeSize,
        schema.nodes.heading.create(node.attrs, schema.text(text)),
      ),
    );
  }

  function appendSection(editor: TestEditor, id: string, text: string) {
    const { schema, doc } = editor.state;
    editor.view.dispatch(
      editor.state.tr.insert(doc.content.size, [
        schema.nodes.heading.create(
          { level: 2, "data-toc-id": id },
          schema.text(text),
        ),
        schema.nodes.paragraph.create(null, schema.text(`${text} body`)),
      ]),
    );
  }

  it("unfolds a section renamed to match, after the throttle", async () => {
    const editor = filtered("section b");
    expect(folded(editor)).toEqual(new Set(["sec-a", "sec-a1"]));

    renameHeading(editor, "sec-a", "Section B notes");
    expect(folded(editor)).toEqual(new Set(["sec-a", "sec-a1"]));

    await wait();
    expect(folded(editor)).toEqual(new Set());
    editor.destroy();
  });

  it("folds a section renamed so it no longer matches", async () => {
    const editor = filtered("section b");

    renameHeading(editor, "sec-b", "Other");
    await wait();
    expect(folded(editor)).toEqual(new Set(["sec-a", "sec-a1", "sec-b"]));
    editor.destroy();
  });

  it("folds a new section that does not match", async () => {
    const editor = filtered("section b");

    appendSection(editor, "sec-c", "Section C");
    await wait();
    expect(folded(editor)).toEqual(new Set(["sec-a", "sec-a1", "sec-c"]));
    editor.destroy();
  });

  it("keeps the reader's own folds on unrelated edits", async () => {
    const editor = filtered("section b");
    // The reader opens a filtered-out section and folds a matched one.
    editor.view.dispatch(
      editor.state.tr.setMeta(headingFoldPluginKey, {
        type: "set",
        ids: new Set(["sec-a1", "sec-b"]),
        persist: false,
      }),
    );

    appendSection(editor, "sec-c", "Section C");
    await wait();
    expect(folded(editor)).toEqual(new Set(["sec-a1", "sec-b", "sec-c"]));
    editor.destroy();
  });

  it("never folds the section holding the caret", async () => {
    const editor = filtered("section b");
    const secB = headingPosById(editor, "sec-b") ?? 1;
    editor.commands.setTextSelection(secB + 2);

    renameHeading(editor, "sec-b", "Other");
    await wait();
    expect(folded(editor)).toEqual(new Set(["sec-a", "sec-a1"]));

    // Nor later, while it still does not match.
    appendSection(editor, "sec-c", "Section C");
    await wait();
    expect(folded(editor)).toEqual(new Set(["sec-a", "sec-a1", "sec-c"]));
    editor.destroy();
  });

  it("leaves folds alone while a preview query is typed", async () => {
    const editor = filtered("section b");
    editor.commands.filterPreview("content");

    renameHeading(editor, "sec-a", "Section B notes");
    await wait();
    expect(folded(editor)).toEqual(new Set(["sec-a", "sec-a1"]));
    editor.destroy();
  });

  it("still restores the folds from before the filter on clear", async () => {
    const editor = createTestEditor({ content: FILTER_CONTENT });
    editor.view.dispatch(
      editor.state.tr.setMeta(headingFoldPluginKey, {
        type: "set",
        ids: new Set(["sec-b"]),
        persist: true,
      }),
    );
    editor.commands.commitFilter("section b");

    renameHeading(editor, "sec-a", "Section B notes");
    await wait();
    renameHeading(editor, "sec-a", "Other");
    editor.commands.clearFilter();
    expect(folded(editor)).toEqual(new Set(["sec-b"]));

    // The re-fold pending when the filter went dies with it.
    await wait();
    expect(folded(editor)).toEqual(new Set(["sec-b"]));
    editor.destroy();
  });
});
