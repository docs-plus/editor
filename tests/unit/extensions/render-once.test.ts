import { afterEach, describe, expect, it } from "bun:test";

import { Editor, getSchema, type JSONContent, Node } from "@tiptap/core";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { StarterKit } from "@tiptap/starter-kit";
import { prosemirrorJSONToYDoc } from "@tiptap/y-tiptap";
import * as Y from "yjs";

import {
  CollaborationRenderOnce,
  NodeViewsRenderOnce,
} from "@/extensions/render-once";

const paragraph = (text: string): JSONContent => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

const CONTENT: JSONContent = {
  type: "doc",
  content: [
    paragraph("One"),
    {
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: { checked: false },
          content: [paragraph("Two")],
        },
      ],
    },
    paragraph("Three"),
  ],
};

const BASE_EXTENSIONS = [
  StarterKit.configure({ undoRedo: false }),
  TaskList,
  TaskItem,
];

let editor: Editor | undefined;
afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

/** DOM nodes of the top-level blocks, to tell a rebuild from a no-op. */
const blockElements = (e: Editor) => Array.from(e.view.dom.children);

/** Mounts the way `EditorContent` does: node views, then one plugin. */
function mountLikeEditorContent(e: Editor) {
  e.createNodeViews();
  e.registerPlugin(new Plugin({ key: new PluginKey("mountProbe") }));
}

/** Atom block whose node view is told apart from its plain rendering. */
const boxed = (nodeViewClass: string) =>
  Node.create({
    name: "boxed",
    group: "block",
    atom: true,
    parseHTML: () => [{ tag: "div[data-boxed]" }],
    renderHTML: () => ["div", { "data-boxed": "" }],
    addNodeView: () => () => {
      const dom = document.createElement("div");
      dom.className = nodeViewClass;
      return { dom };
    },
  });

const BOXED_CONTENT: JSONContent = {
  type: "doc",
  content: [paragraph("One"), { type: "boxed" }, paragraph("Two")],
};

function createBoxedEditor(nodeViewClass: string) {
  return new Editor({
    element: document.createElement("div"),
    extensions: [...BASE_EXTENSIONS, boxed(nodeViewClass), NodeViewsRenderOnce],
    content: BOXED_CONTENT,
  });
}

describe("NodeViewsRenderOnce", () => {
  it("keeps the DOM built at view creation when the content mounts", () => {
    editor = createBoxedEditor("node-view");
    const before = blockElements(editor);
    expect(editor.view.dom.querySelector(".node-view")).not.toBeNull();

    mountLikeEditorContent(editor);

    const after = blockElements(editor);
    expect(after).toHaveLength(before.length);
    after.forEach((element, index) => {
      expect(element).toBe(before[index]);
    });
  });

  it("rebuilds when node views were cleared (content unmounted)", () => {
    editor = createBoxedEditor("node-view");
    editor.view.setProps({ nodeViews: {} });
    expect(editor.view.dom.querySelector(".node-view")).toBeNull();

    editor.createNodeViews();

    expect(editor.view.dom.querySelector(".node-view")).not.toBeNull();
  });

  it("rebuilds when a React node view rendered before the content existed", () => {
    editor = createBoxedEditor("react-renderer");
    const before = blockElements(editor);

    editor.createNodeViews();

    expect(blockElements(editor)[1]).not.toBe(before[1]);
  });
});

describe("CollaborationRenderOnce", () => {
  const schema = getSchema(BASE_EXTENSIONS);

  it("renders the Yjs document and does not rebuild it when plugins change", () => {
    const ydoc = prosemirrorJSONToYDoc(schema, CONTENT, "default");
    editor = new Editor({
      element: document.createElement("div"),
      extensions: [
        ...BASE_EXTENSIONS,
        CollaborationRenderOnce.configure({ document: ydoc }),
      ],
    });
    expect(editor.getText()).toContain("Three");
    const doc = editor.state.doc;

    mountLikeEditorContent(editor);

    expect(editor.state.doc).toBe(doc);
  });

  it("still applies remote Yjs changes after mounting", () => {
    const ydoc = prosemirrorJSONToYDoc(schema, CONTENT, "default");
    editor = new Editor({
      element: document.createElement("div"),
      extensions: [
        ...BASE_EXTENSIONS,
        CollaborationRenderOnce.configure({ document: ydoc }),
      ],
    });
    mountLikeEditorContent(editor);

    // A collaborator's replica drops the last paragraph; ship the update.
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(ydoc));
    const fragment = remote.getXmlFragment("default");
    fragment.delete(fragment.length - 1, 1);
    Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(remote));

    expect(editor.getText()).not.toContain("Three");
  });

  it("calls onFirstRender once", () => {
    const ydoc = prosemirrorJSONToYDoc(schema, CONTENT, "default");
    let calls = 0;
    editor = new Editor({
      element: document.createElement("div"),
      extensions: [
        ...BASE_EXTENSIONS,
        CollaborationRenderOnce.configure({
          document: ydoc,
          onFirstRender: () => {
            calls += 1;
          },
        }),
      ],
    });
    mountLikeEditorContent(editor);
    expect(calls).toBe(1);
  });

  it("writes local edits to Yjs, and only when the document changed", () => {
    const ydoc = prosemirrorJSONToYDoc(schema, CONTENT, "default");
    editor = new Editor({
      element: document.createElement("div"),
      extensions: [
        ...BASE_EXTENSIONS,
        CollaborationRenderOnce.configure({ document: ydoc }),
      ],
    });
    mountLikeEditorContent(editor);
    let yTransactions = 0;
    ydoc.on("afterTransaction", () => {
      yTransactions += 1;
    });

    editor.commands.setTextSelection(2);
    editor.view.dispatch(editor.state.tr.setMeta("cursorPing", true));
    expect(yTransactions).toBe(0);

    editor.commands.insertContentAt(1, "Zero ");
    expect(yTransactions).toBe(1);
    expect(ydoc.getXmlFragment("default").toString()).toContain("Zero One");
  });
});
