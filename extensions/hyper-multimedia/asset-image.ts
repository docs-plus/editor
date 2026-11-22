/**
 * `asset:` images in HyperMultimedia 2.3: the image store spec's §6.2
 * fallback for U1, the upstream 2.4 hooks (`resolveSrc`, `isHostSrc`,
 * `refreshMediaSrc`). **Delete it, with `asset-image-view.ts`, when 2.4
 * lands** (AGENTS.md: remove shims once a migration is done);
 * `asset-image.test.ts` pins the 2.3 internals they rely on.
 *
 * Used only by `asset-kit.ts` (`AssetHyperMultimediaKit`), the kit for
 * documents with an image store; the public sandbox's editor never imports
 * it. Nothing here runs at import.
 *
 * - `withAssetSrc` routes an image whose src is an `asset:` ref to the lazy
 *   view (`asset-image-view.ts`); until that chunk is loaded it shows an
 *   empty box, then refreshes. A host with library documents can call
 *   `loadAssetImages()` early (desktop at startup) to skip that box.
 * - `assetImageParseRules` keeps `asset:` images on paste, drop and HTML
 *   import in a library document (`asset-image-parse.ts`, shared with the
 *   headless schema). Without an asset scope they are dropped, as the stock
 *   kit drops them, and the writer is told.
 * - `assetRefreshPlugin` holds the refresh decorations `refreshMediaSrc`
 *   sets (meta-only, outside history).
 * - `assetMediaActions` hands the image toolbar to the lazy chunk, which adds
 *   Alt text… and makes Download and Copy use an `asset:` image's bytes.
 */
import {
  closeToolbarPopover,
  type MediaActionsResolver,
  openMediaPopover,
  wrapMediaWithLoadingShell,
} from "@docs.plus/extension-hypermultimedia";
import type { Editor, NodeViewRenderer } from "@tiptap/core";
import type { TagParseRule } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type NodeView } from "@tiptap/pm/view";

import { announceLater } from "@/lib/announce-later";
import { parseAssetRef } from "@/lib/assets/asset-ref";
import type { AssetScope } from "@/lib/assets/asset-resolver";

import { assetParseRules, isHostSrc } from "./asset-image-parse";
import type { AssetImageDeps } from "./asset-image-view";
import type { ImageActionDeps } from "./asset-media-actions";

export type { AssetScope };
export { isHostSrc };

/** Reads the current document's scope; `null` in the sandbox. Never changes identity. */
export type AssetScopeGetter = () => AssetScope | null;

let refreshKey: PluginKey<DecorationSet> | undefined;
let deps: (AssetImageDeps & ImageActionDeps) | undefined;

/**
 * Editor-chunk values the lazy chunk receives instead of importing them.
 * Made on first use, so importing this module has no side effects.
 */
function getDeps(): AssetImageDeps & ImageActionDeps {
  refreshKey ??= new PluginKey<DecorationSet>("asset");
  deps ??= {
    deco: Decoration,
    shell: wrapMediaWithLoadingShell,
    key: refreshKey,
    open: openMediaPopover,
    close: closeToolbarPopover,
    parse: parseAssetRef,
    announce: announceLater,
  };
  return deps;
}

type LazyModule = typeof import("./asset-image-lazy");
let lazy: LazyModule | undefined;
let lazyLoad: Promise<LazyModule | null> | undefined;
let prefetch = true;

/** Loads the lazy chunk once; `null` when it can't (retried next time). */
export function loadAssetImages(): Promise<LazyModule | null> {
  lazyLoad ??= import("./asset-image-lazy").then(
    (module) => (lazy = module),
    () => {
      lazyLoad = undefined;
      return null;
    },
  );
  return lazyLoad;
}

type LazyCall = "refresh" | "pasteRefused";

/** Calls `name` from the lazy chunk once it has loaded, with `deps` last. */
function callLazy(name: LazyCall, ...args: unknown[]): void {
  void loadAssetImages().then((module) =>
    (module?.[name] as ((...all: unknown[]) => void) | undefined)?.(
      ...args,
      getDeps(),
    ),
  );
}

/** Re-resolves every image view showing `src` (U1's `refreshMediaSrc`). */
export function refreshMediaSrc(editor: Editor, src: string): void {
  callLazy("refresh", editor, src);
}

export function assetRefreshPlugin(): Plugin<DecorationSet> {
  const { key } = getDeps();
  return new Plugin<DecorationSet>({
    key,
    state: {
      init: () => DecorationSet.empty,
      apply: (tr, set) =>
        (tr.getMeta(key) as DecorationSet | undefined) ??
        set.map(tr.mapping, tr.doc),
    },
    props: { decorations: (state) => key.getState(state) },
  });
}

/** Shown in the editor chunk when the view's chunk fails to load. */
const UNAVAILABLE = "This image can't be shown right now.";

/**
 * The first `asset:` image of a session, before the lazy chunk has loaded:
 * the kit's loading shell, then a refresh into the real view, or, if the
 * chunk can't load (offline before first use), an error state.
 */
export function coldView(
  props: Parameters<NodeViewRenderer>[0],
  load: () => Promise<LazyModule | null> = loadAssetImages,
) {
  const { node, editor } = props;
  const dom = document.createElement("div");
  dom.className = "asset-image-state";
  dom.setAttribute("role", "img");
  dom.setAttribute("aria-label", "Loading image");
  const shell = wrapMediaWithLoadingShell(
    editor,
    {
      kind: "image",
      width: Number(node.attrs.width) || 320,
      height: Number(node.attrs.height) || 240,
    },
    document.createElement("img"),
  );
  dom.append(shell.dom);
  void load().then((module) => {
    if (module) return module.refresh(editor, node.attrs.src, getDeps());
    shell.controller.markError(UNAVAILABLE);
    const alt = node.attrs.alt as string | null;
    dom.setAttribute(
      "aria-label",
      alt ? `${alt}: ${UNAVAILABLE}` : UNAVAILABLE,
    );
  });
  return {
    dom,
    update: () => false,
    destroy: () => shell.controller.destroy(),
  };
}

/** The image node view, with `asset:` srcs drawn by the lazy view. */
export function withAssetSrc(
  stock: NodeViewRenderer,
  getScope: AssetScopeGetter,
): NodeViewRenderer {
  // HyperMultimedia 2.3's image view keeps itself on update but applies only
  // layout attrs, so an alt edit, its undo or a collaborator's change would
  // leave `<img alt>` stale for screen readers (upstream note U1).
  const parent: NodeViewRenderer = (props) => {
    // The toolbar extras (assetMediaActions). Once per session: offline,
    // a failed chunk is not retried for every image.
    if (prefetch) {
      prefetch = false;
      void loadAssetImages();
    }
    const view = stock(props) as NodeView;
    const { update } = view;
    const img = (view.dom as HTMLElement).querySelector("img");
    view.update = (node, ...rest) => {
      if (!update?.call(view, node, ...rest)) return false;
      img?.setAttribute("alt", node.attrs.alt ?? "");
      return true;
    };
    return view;
  };
  return (props) => {
    const { src } = props.node.attrs;
    if (!isHostSrc(src)) return parent(props);
    if (lazy) return lazy.view(parent, props, getScope(), getDeps());
    return coldView(props);
  };
}

/** The image parse rules: `asset:` kept with a scope, else dropped with a notice. */
export function assetImageParseRules(
  rules: readonly TagParseRule[],
  getScope: AssetScopeGetter,
): TagParseRule[] {
  return assetParseRules(
    rules,
    () => getScope() !== null,
    () => callLazy("pasteRefused"),
  );
}

/**
 * Image toolbar extras, from the lazy chunk (`imageActions` in
 * `asset-media-actions.ts`): Alt text…, and Download and Copy that use an
 * `asset:` image's bytes. The chunk loads
 * when the first image view renders, so it is there before any toolbar
 * opens; until then the stock actions show.
 */
export const assetMediaActions: MediaActionsResolver = (defaults, context) =>
  lazy?.actions(defaults, context, getDeps()) ?? defaults;
