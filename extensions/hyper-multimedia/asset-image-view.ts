/**
 * Node views for `asset:` images (image store spec §6.2, the fallback for
 * U1). Part of the lazy `asset-image-lazy` chunk: the editor chunk only
 * routes `asset:` srcs here (`asset-image.ts`).
 *
 * - **Resolved:** the stock image view, built from a node whose `src` is a
 *   URL (desktop's synchronous `BlobStore.url`, or a warm object URL), and
 *   fed the same mapped node on every update, so a resize or caption edit
 *   never rebuilds it. It rebuilds when the document's src changes or when
 *   `refreshMediaSrc` asks for it.
 * - **State:** the kit's loading shell in the image's box, pending while
 *   the bytes load, then a refresh; or an error state with the spec copy.
 *
 * It imports nothing from the editor chunk (a shared module would split the
 * editor group): editor-chunk helpers arrive in `AssetImageDeps`.
 */
import type {
  MediaLoadingController,
  wrapMediaWithLoadingShell,
} from "@docs.plus/extension-hypermultimedia";
import type { Editor, NodeViewRenderer } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { PluginKey } from "@tiptap/pm/state";
import type { Decoration, DecorationSet } from "@tiptap/pm/view";

import type { NoticeOptions } from "@/lib/announce";
import type { parseAssetRef } from "@/lib/assets/asset-ref";
import { type AssetScope, assetResolver } from "@/lib/assets/asset-resolver";

export const ASSET_IMAGE_COPY = {
  loading: "Loading image",
  missing: "Image not found on this computer.",
  newer: "This image needs a newer version of TinyDocy.",
  /** The view's own chunk could not load (offline before first use). */
  unavailable: "This image can't be shown right now.",
  pasteRefused: "Library images can't be pasted here.",
} as const;

/**
 * The public sandbox dropped pasted `asset:` images (no asset scope, I7):
 * says so on the status pill and to screen readers.
 */
export function pasteRefused(deps: AssetImageDeps): void {
  deps.announce(ASSET_IMAGE_COPY.pasteRefused);
}

/** Editor-chunk values the lazy chunk must not import itself; short names, as the editor chunk spells each key out. */
export interface AssetImageDeps {
  deco: typeof Decoration;
  shell: typeof wrapMediaWithLoadingShell;
  /** The refresh plugin's key (`asset-image.ts`). */
  key: PluginKey<DecorationSet>;
  /** `parseAssetRef`: the asset kit's graph holds `asset-ref`. */
  parse: typeof parseAssetRef;
  /** `announceLater`: `lib/announce` is in the editor chunk. */
  announce: (message: string, options?: NoticeOptions) => void;
}

type RendererProps = Parameters<NodeViewRenderer>[0];
type RefreshSpec = { assetSrc: string; assetRefresh: number };

let refreshCount = 0;

/** Sources waiting for the next frame's refresh, per editor. */
const queued = new WeakMap<Editor, Set<string>>();

const nextFrame = (fn: () => void) =>
  typeof requestAnimationFrame === "function"
    ? requestAnimationFrame(fn)
    : setTimeout(fn, 16);

/**
 * Rebuilds every image view showing `src`: a spec-only node decoration per
 * image (no DOM attribute), set through a meta-only transaction outside
 * history. Views compare the decoration's count to know they must rebuild.
 * Calls within one frame share one transaction: a document opening with 200
 * images refreshes once a frame, not 200 times.
 */
export function refreshAssetViews(
  editor: Editor,
  src: string,
  deps: AssetImageDeps,
): void {
  const pending = queued.get(editor);
  if (pending) {
    pending.add(src);
    return;
  }
  const srcs = new Set([src]);
  queued.set(editor, srcs);
  nextFrame(() => {
    queued.delete(editor);
    applyRefresh(editor, srcs, deps);
  });
}

function applyRefresh(
  editor: Editor,
  srcs: ReadonlySet<string>,
  deps: AssetImageDeps,
): void {
  if (editor.isDestroyed) return;
  const { state } = editor;
  const current = deps.key.getState(state);
  if (!current) return;
  refreshCount += 1;
  const fresh: Decoration[] = [];
  state.doc.descendants((node, pos) => {
    const { src } = node.attrs;
    if (node.type.name === "image" && srcs.has(src)) {
      fresh.push(
        deps.deco.node(pos, pos + node.nodeSize, {}, {
          assetSrc: src,
          assetRefresh: refreshCount,
        } satisfies RefreshSpec),
      );
    }
  });
  const stale = current.find(undefined, undefined, (spec) =>
    srcs.has((spec as Partial<RefreshSpec>).assetSrc ?? ""),
  );
  editor.view.dispatch(
    state.tr
      .setMeta(deps.key, current.remove(stale).add(state.doc, fresh))
      .setMeta("addToHistory", false),
  );
}

function refreshOf(decorations: readonly Decoration[]): number {
  for (const decoration of decorations) {
    const count = (decoration.spec as Partial<RefreshSpec>).assetRefresh;
    if (count) return count;
  }
  return 0;
}

function resolvedView(
  parent: NodeViewRenderer,
  props: RendererProps,
  url: string,
  controller: AbortController,
) {
  const { node } = props;
  const refresh = refreshOf(props.decorations);
  const withUrl = (next: PMNode) =>
    next.type.create({ ...next.attrs, src: url }, next.content, next.marks);
  let view: ReturnType<NodeViewRenderer>;
  try {
    view = parent({
      ...props,
      node: withUrl(node),
      HTMLAttributes: { ...props.HTMLAttributes, src: url },
    });
  } catch (error) {
    controller.abort(); // release the URL this view held
    throw error;
  }
  return {
    ...view,
    update: (
      next: PMNode,
      decorations: readonly Decoration[],
      inner: Parameters<NonNullable<typeof view.update>>[2],
    ) =>
      next.type === node.type &&
      next.attrs.src === node.attrs.src &&
      refreshOf(decorations) === refresh &&
      (view.update?.(withUrl(next), decorations, inner) ?? false),
    destroy: () => {
      controller.abort();
      view.destroy?.();
    },
  };
}

function stateView(
  props: RendererProps,
  controller: AbortController,
  deps: AssetImageDeps,
) {
  const { node, editor } = props;
  const dom = document.createElement("div");
  dom.className = "asset-image-state";
  dom.setAttribute("role", "img");
  const shell: { dom: HTMLElement; controller: MediaLoadingController } =
    deps.shell(
      editor,
      {
        kind: "image",
        width: Number(node.attrs.width) || 320,
        height: Number(node.attrs.height) || 240,
      },
      document.createElement("img"),
    );
  dom.append(shell.dom);
  /** Shows `copy` (and the alt text) to sighted and screen-reader users. */
  const show = (copy: string, error: boolean) => {
    const alt = node.attrs.alt as string | null;
    dom.setAttribute("aria-label", alt ? `${alt}: ${copy}` : copy);
    if (error) shell.controller.markError(copy);
  };
  show(ASSET_IMAGE_COPY.loading, false);
  return {
    show,
    view: {
      dom,
      update: () => false,
      ignoreMutation: (mutation: MutationRecord | { type: "selection" }) =>
        mutation.type !== "selection",
      destroy: () => {
        controller.abort();
        shell.controller.destroy();
      },
    },
  };
}

/** The view for an image whose src is an `asset:` ref (see the module comment). */
export function assetImageView(
  parent: NodeViewRenderer,
  props: RendererProps,
  scope: AssetScope | null,
  deps: AssetImageDeps,
) {
  const src = props.node.attrs.src as string;
  const ref = deps.parse(src);
  const controller = new AbortController();
  if (ref?.alg === "sha256" && scope) {
    assetResolver.track(props.editor);
    const url = assetResolver.peek(scope, ref.hex, controller.signal);
    if (url) return resolvedView(parent, props, url, controller);
  }
  const { show, view } = stateView(props, controller, deps);
  if (ref?.alg !== "sha256") show(ASSET_IMAGE_COPY.newer, true);
  else if (!scope) show(ASSET_IMAGE_COPY.missing, true);
  else {
    void assetResolver.load(scope, ref.hex, controller.signal).then((url) => {
      if (controller.signal.aborted) return;
      if (url) refreshAssetViews(props.editor, src, deps);
      else show(ASSET_IMAGE_COPY.missing, true);
    });
  }
  return view;
}
