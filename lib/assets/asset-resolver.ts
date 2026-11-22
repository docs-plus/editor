/**
 * Resolves `asset:` image refs to URLs the `<img>` can load (spec §3.2,
 * §3.3, §6). A lazy chunk: the editor chunk only calls `BlobStore.url`
 * (desktop's synchronous path) and loads this module when that misses.
 *
 * - Desktop: `store.url(hex)` is `app://tinydocy/_asset/<hex>` for present
 *   blobs, so nothing here runs.
 * - Web library: the bytes come from `store.get` and render through the
 *   shared object-URL cache. Each view's `AbortSignal` releases its hold.
 */
import type { AssetHex } from "@/lib/assets/asset-ref";
import {
  createObjectUrlCache,
  type ObjectUrlCache,
} from "@/lib/assets/object-url-cache";
import type { BlobStore } from "@/lib/platform/blob-store";

/** What the host gives the editor for a library document (null in the sandbox). */
export interface AssetScope {
  store: BlobStore;
  docId: string;
}

/** Something that announces its own destruction (a Tiptap `Editor`). */
export interface DestroyNotifier {
  on(event: "destroy", listener: () => void): unknown;
}

export interface AssetResolver {
  /** A URL now, without loading: desktop's URL or a warm object URL. */
  peek(scope: AssetScope, hex: AssetHex, signal: AbortSignal): string | null;
  /** A URL once the bytes are read, or `null` when they are missing. */
  load(
    scope: AssetScope,
    hex: AssetHex,
    signal: AbortSignal,
  ): Promise<string | null>;
  /** Counts `editor` until it is destroyed; the last one revokes every URL. */
  track(editor: DestroyNotifier): void;
}

export function createAssetResolver(
  cache: ObjectUrlCache = createObjectUrlCache(),
): AssetResolver {
  const tracked = new WeakSet<DestroyNotifier>();
  return {
    peek: (scope, hex, signal) =>
      scope.store.url(hex) ?? cache.peek(hex, signal),
    load: async (scope, hex, signal) =>
      scope.store.url(hex) ??
      cache.acquire(hex, () => scope.store.get(hex), signal),
    track(editor) {
      if (tracked.has(editor)) return;
      tracked.add(editor);
      editor.on("destroy", cache.attach());
    },
  };
}

/** The app's resolver: one object-URL cache for every editor. */
export const assetResolver: AssetResolver = createAssetResolver();
