/**
 * The media kit for documents with an image store (image store spec §6,
 * D4): `HyperMultimediaKit` plus `asset:` images, through the §6.2 fallback
 * until HyperMultimedia 2.4 (U1), and Alt text… in the image toolbar.
 *
 * Hosts with library documents use it in place of `HyperMultimediaKit`:
 * desktop (P2.6b) and the web library (W11), each from code the public
 * sandbox never imports. The sandbox keeps `HyperMultimediaKit` unchanged,
 * so the shared editor chunk carries none of this (A1 has no D23 ledger
 * line; `import-boundaries.test.ts` checks the sandbox editor's graph).
 *
 *   AssetHyperMultimediaKit.configure({ assets: () => scopeRef.current })
 *
 * `assets` is read on every render and must keep its identity (the typing
 * rule in AGENTS.md); it returns `{ store, docId }` for a library document,
 * or null, where `asset:` images are not served and are dropped from
 * pasted content with a notice.
 */
import type {
  HyperMultimediaKitOptions as BaseKitOptions,
  MediaActionContext,
} from "@docs.plus/extension-hypermultimedia";
import type { Node, NodeViewRenderer } from "@tiptap/core";

import {
  type AssetScopeGetter,
  assetImageParseRules,
  assetMediaActions,
  assetRefreshPlugin,
  isHostSrc,
  withAssetSrc,
} from "./asset-image";
import { HyperMultimediaKit } from "./hyper-multimedia-kit";

export type { AssetScope, AssetScopeGetter } from "./asset-image";
export { loadAssetImages, refreshMediaSrc } from "./asset-image";

export interface AssetKitOptions extends BaseKitOptions {
  assets: AssetScopeGetter | null;
}

/** The `image` node, drawing and parsing `asset:` srcs (§6.2 fallback). */
function withAssetImages(image: Node, getScope: AssetScopeGetter): Node {
  return image.extend({
    addNodeView() {
      return withAssetSrc(this.parent?.() as NodeViewRenderer, getScope);
    },
    parseHTML() {
      return assetImageParseRules(this.parent?.() ?? [], getScope);
    },
    addProseMirrorPlugins() {
      return [...(this.parent?.() ?? []), assetRefreshPlugin()];
    },
  });
}

export const AssetHyperMultimediaKit =
  HyperMultimediaKit.extend<AssetKitOptions>({
    addOptions() {
      return {
        ...(this.parent?.() as BaseKitOptions),
        assets: null,
        mediaActions: assetMediaActions,
        // An asset has no original to open (View original stays hidden).
        isUploadedMedia: (ctx: MediaActionContext) => isHostSrc(ctx.attrs.src),
      };
    },
    addExtensions() {
      // Read on each render: the getter follows the open document.
      const getScope: AssetScopeGetter = () => this.options.assets?.() ?? null;
      return (this.parent?.() ?? []).map((extension) =>
        extension.name === "image"
          ? withAssetImages(extension as Node, getScope)
          : extension,
      );
    },
  });
