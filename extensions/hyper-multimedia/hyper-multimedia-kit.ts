import { HyperMultimediaKit as BaseHyperMultimediaKit } from "@docs.plus/extension-hypermultimedia";
import type { Plugin } from "@tiptap/pm/state";

import { createXLinkCardView } from "./x-link-card";

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
 *
 * Desktop builds (`NEXT_PUBLIC_APP_TARGET=desktop`) keep the `x` node, so
 * documents with X posts stay valid, but draw it as a static link card: no
 * X script may run in the desktop app. The literal comparison folds at build
 * time, so the web build keeps the kit's embed and drops the card.
 */
export const HyperMultimediaKit = BaseHyperMultimediaKit.extend({
  addExtensions() {
    return (this.parent?.() ?? []).map((extension) => {
      if (MEDIA_CONTROL_EXTENSIONS.has(extension.name)) {
        return extension.extend({
          addProseMirrorPlugins() {
            const plugins = this.parent?.() ?? [];
            plugins.forEach(keepViewOnReconfigure);
            return plugins;
          },
        });
      }
      if (process.env.NEXT_PUBLIC_APP_TARGET === "desktop") {
        if (extension.name === "x") {
          // Loaded here, not by the card module: a static stylesheet import
          // survives tree shaking and would ship the card's CSS to the web.
          void import("./x-link-card.scss");
          return extension.extend({ addNodeView: () => createXLinkCardView });
        }
      }
      return extension;
    });
  },
});
