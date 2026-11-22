/**
 * `asset:` images in HyperMultimedia 2.3: the image store spec's §6.2
 * fallback for U1, the upstream 2.4 hooks (`resolveSrc`, `isHostSrc`,
 * `refreshMediaSrc`). **Delete it, with `asset-image-view.ts`, when 2.4
 * lands** (AGENTS.md: remove shims once a migration is done);
 * `asset-image.test.ts` pins the 2.3 internals they rely on.
 *
 * The editor-chunk part, kept small (A1's 600 B gz allowance):
 * - `withAssetSrc` routes an image whose src is an `asset:` ref to the lazy
 *   view (`asset-image-view.ts`); until that chunk is loaded it shows an
 *   empty box, then refreshes. A host with library documents can call
 *   `loadAssetImages()` early (desktop at startup) to skip that box.
 * - `assetParseRules` keeps `asset:` images on paste, drop and HTML import
 *   in a library document. Without an asset scope (the public sandbox, I7)
 *   they are dropped, as the stock kit drops them, and the writer is told.
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

import type { AssetScope } from "@/lib/assets/asset-resolver";

import type { AltTextDeps } from "./alt-text-popover";
import type { AssetImageDeps } from "./asset-image-view";

export type { AssetScope };

/** Reads the current document's scope; `null` in the sandbox. Never changes identity. */
export type AssetScopeGetter = () => AssetScope | null;

/**
 * U1's `isHostSrc`: an `asset:<alg>-<digest>` src, kept on paste and drawn
 * by the lazy view. Looser than `parseAssetRef` (a malformed sha256 ref
 * passes here and shows "needs a newer version"), so the editor chunk need
 * not hold the full parser.
 */
export const isHostSrc = (src: unknown): src is string =>
  typeof src === "string" && /^asset:[a-z0-9]+-[\w-]+$/.test(src);

const refreshKey = new PluginKey<DecorationSet>("asset");

/** Editor-chunk values the lazy chunk receives instead of importing them. */
const deps: AssetImageDeps & AltTextDeps = {
  deco: Decoration,
  shell: wrapMediaWithLoadingShell,
  key: refreshKey,
  open: openMediaPopover,
  close: closeToolbarPopover,
};

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
      deps,
    ),
  );
}

/** Re-resolves every image view showing `src` (U1's `refreshMediaSrc`). */
export function refreshMediaSrc(editor: Editor, src: string): void {
  callLazy("refresh", editor, src);
}

export function assetRefreshPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: refreshKey,
    state: {
      init: () => DecorationSet.empty,
      apply: (tr, set) =>
        (tr.getMeta(refreshKey) as DecorationSet | undefined) ??
        set.map(tr.mapping, tr.doc),
    },
    props: { decorations: (state) => refreshKey.getState(state) },
  });
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
    if (lazy) return lazy.view(parent, props, getScope(), deps);
    refreshMediaSrc(props.editor, src);
    return { dom: document.createElement("div"), update: () => false };
  };
}

/** The stock image parse rules, plus `asset:` srcs (U1 change 2). */
export function assetParseRules(
  rules: readonly TagParseRule[],
  getScope: AssetScopeGetter,
): TagParseRule[] {
  return rules.map((rule) => ({
    ...rule,
    getAttrs: (element: HTMLElement) => {
      // The figure rule's `<img>`, or the `<img>` rule's own element.
      const img = element.querySelector("img") ?? element;
      if (!isHostSrc(img.getAttribute("src"))) {
        return rule.getAttrs?.(element) ?? {};
      }
      if (getScope()) return {};
      callLazy("pasteRefused");
      return false;
    },
  }));
}

/**
 * Image toolbar extras, from the lazy chunk (`imageActions` in `asset-media-actions.ts`): Alt text…,
 * and Download and Copy that use an `asset:` image's bytes. The chunk loads
 * when the first image view renders, so it is there before any toolbar
 * opens; until then the stock actions show.
 */
export const assetMediaActions: MediaActionsResolver = (defaults, context) =>
  lazy?.actions(defaults, context, deps) ?? defaults;
