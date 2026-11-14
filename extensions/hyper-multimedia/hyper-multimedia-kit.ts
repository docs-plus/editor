import { HyperMultimediaKit as BaseHyperMultimediaKit } from "@docs.plus/extension-hypermultimedia";
import type { Plugin } from "@tiptap/pm/state";

/**
 * Kit extensions whose plugin view's `destroy` tears the media controls
 * down: `MediaResizeControls` hides the active gripper and toolbar,
 * `MediaResizeGripper` aborts a running resize drag. Both keep their state
 * per editor, outside the view object.
 */
const MEDIA_CONTROL_EXTENSIONS = new Set([
  "MediaResizeControls",
  "MediaResizeGripper",
]);

/**
 * Skips a plugin view's `destroy` when ProseMirror only rebuilds plugin
 * views. Any change to the plugin list (`registerPlugin` from a lazy
 * chunk's `BubbleMenu`, `unregisterPlugin`) destroys every plugin view and
 * creates new ones, and by then the view holds the new state, so a plugin
 * list other than the one the view was made with means a rebuild. The view
 * is destroyed for real when the view itself is (same list) or when this
 * plugin left the list. Only for views that keep nothing on the view
 * object: a skipped one is dropped without cleanup.
 */
export function keepViewOnReconfigure(plugin: Plugin): void {
  const createView = plugin.spec.view;
  if (!createView) return;
  plugin.spec.view = (editorView) => {
    const pluginView = createView(editorView);
    const { plugins } = editorView.state;
    return {
      update: (view, prevState) => pluginView.update?.(view, prevState),
      destroy: () => {
        const next = editorView.state.plugins;
        if (next === plugins || !next.includes(plugin)) pluginView.destroy?.();
      },
    };
  };
}

/**
 * `HyperMultimediaKit` whose media controls survive a plugin view rebuild:
 * a gripper on the hovered image stays up, and a resize drag keeps going.
 */
export const HyperMultimediaKit = BaseHyperMultimediaKit.extend({
  addExtensions() {
    return (this.parent?.() ?? []).map((extension) =>
      MEDIA_CONTROL_EXTENSIONS.has(extension.name)
        ? extension.extend({
            addProseMirrorPlugins() {
              const plugins = this.parent?.() ?? [];
              plugins.forEach(keepViewOnReconfigure);
              return plugins;
            },
          })
        : extension,
    );
  },
});
