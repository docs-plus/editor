import {
  HyperMultimediaKit as BaseHyperMultimediaKit,
  type HyperMultimediaKitOptions as BaseKitOptions,
  type MediaActionContext,
} from "@docs.plus/extension-hypermultimedia";
import type { Node, NodeViewRenderer } from "@tiptap/core";
import type { Plugin } from "@tiptap/pm/state";

import {
  type AssetScopeGetter,
  assetMediaActions,
  assetParseRules,
  assetRefreshPlugin,
  isHostSrc,
  withAssetSrc,
} from "./asset-image";
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

export interface HyperMultimediaKitOptions extends BaseKitOptions {
  /**
   * The current library document's image store, read on every render; null
   * (the default, and the public sandbox) means `asset:` images are not
   * served and are dropped from pasted content. Never changes identity.
   */
  assets: AssetScopeGetter | null;
}

/**
 * `HyperMultimediaKit` whose media controls survive a plugin view rebuild:
 * a gripper on the hovered image stays up, and a resize drag keeps going.
 *
 * Desktop builds (`NEXT_PUBLIC_APP_TARGET=desktop`) keep the `x` node, so
 * documents with X posts stay valid, but draw it as a static link card: no
 * X script may run in the desktop app. The literal comparison folds at build
 * time, so the web build keeps the kit's embed and drops the card.
 *
 * `asset:` images (image store, library documents) render through
 * `asset-image.ts`, the §6.2 fallback until HyperMultimedia 2.4 (U1).
 */
export const HyperMultimediaKit =
  BaseHyperMultimediaKit.extend<HyperMultimediaKitOptions>({
    // The base kit has no `addOptions` (its defaults live in its storage),
    // so there is nothing to spread; a test pins that.
    addOptions() {
      return {
        assets: null,
        mediaActions: assetMediaActions,
        // An asset has no original to open (View original stays hidden).
        isUploadedMedia: (ctx: MediaActionContext) => isHostSrc(ctx.attrs.src),
      } as HyperMultimediaKitOptions;
    },

    addExtensions() {
      const kitOptions = this.options;
      const getScope: AssetScopeGetter = () => kitOptions.assets?.() ?? null;
      return (this.parent?.() ?? []).map((extension) => {
        if (extension.name === "image") {
          return (extension as Node).extend({
            addNodeView() {
              return withAssetSrc(
                this.parent?.() as NodeViewRenderer,
                getScope,
              );
            },
            parseHTML() {
              return assetParseRules(this.parent?.() ?? [], getScope);
            },
            addProseMirrorPlugins() {
              return [...(this.parent?.() ?? []), assetRefreshPlugin()];
            },
          });
        }
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
