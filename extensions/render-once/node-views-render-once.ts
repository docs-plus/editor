import { Extension } from "@tiptap/core";

/**
 * Keeps Tiptap from rendering the whole document a second time when
 * `EditorContent` mounts.
 *
 * The view is created with every node view already in place, yet
 * `EditorContent` then calls `editor.createNodeViews()`, which hands
 * ProseMirror freshly built node-view functions. ProseMirror sees new
 * functions, so it throws away and rebuilds the DOM of every block, then
 * lays the page out synchronously. The only node views that need that
 * second pass are React ones created before `EditorContent` existed: their
 * portal had nowhere to render. So the rebuild runs only when the view has
 * no node views yet (`EditorContent` clears them when it unmounts) or holds
 * a React-rendered node view (`.react-renderer`, added by Tiptap's
 * `ReactRenderer`).
 */
export const NodeViewsRenderOnce = Extension.create({
  name: "nodeViewsRenderOnce",

  onBeforeCreate() {
    const { editor } = this;
    const rebuildNodeViews = editor.createNodeViews.bind(editor);
    editor.createNodeViews = () => {
      const { view } = editor;
      const hasNodeViews = Object.keys(view.props.nodeViews ?? {}).length > 0;
      if (hasNodeViews && !view.dom.querySelector(".react-renderer")) return;
      rebuildNodeViews();
    };
  },
});
