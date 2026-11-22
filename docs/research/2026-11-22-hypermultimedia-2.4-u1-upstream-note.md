# Upstream note U1: host-resolved media sources in HyperMultimedia 2.4

- **Status:** Ready to file in the docs.plus repo, `extensions/extension-hypermultimedia`. **Not filed.**
- **Package:** `@docs.plus/extension-hypermultimedia` 2.3.0 → 2.4.0 (minor: everything is opt-in).
- **For:** TinyDocy's image store ([spec §6.1](../superpowers/specs/2026-11-16-image-store-design.md#61-upstream-docsplusextension-hypermultimedia-240-docsplus-repo)). TinyDocy runs a local fallback until this ships (spec §6.2, PR A1). That fallback is `extensions/hyper-multimedia/asset-image.ts` and `asset-image-view.ts`, pinned by `tests/unit/extensions/asset-image.test.ts`, and it gets deleted once 2.4 lands.

---

## Issue text

**Title:** Let the host resolve media `src` values (`resolveSrc`, `isHostSrc`, `refreshMediaSrc`)

### Problem

Some hosts keep media bytes outside the document: in IndexedDB, in an app-protocol file store, or behind an authenticated endpoint. The document stores a host-owned reference, such as `asset:sha256-<hex>`, and the host turns it into a loadable URL at render time. The kit can't do that today:

1. **The image node view sets `img.src = attrs.src` directly** (`yi`). A reference never loads, and the loading shell marks an `<img>` with no `src` as an error at once (`Nl`).
2. **`parseHTML` drops host srcs.** The image rules accept only data, blob, http(s) or image-extension URLs (`hi`). ProseMirror's cut, copy and paste go through `parseDOM`, so an `asset:` image disappears on cut-and-paste and on HTML import. Markdown parsing already keeps it, because it passes `isSafeMediaSrc`.
3. **Toolbar actions use `attrs.src`:**
   - Download fetches the reference.
   - Copy writes the reference as text.
   - View original shows for it, unless the host sets `isUploadedMedia`.
4. **The image view ignores `alt` and `title` changes in `update`.** It keeps itself, which is right, but it re-applies only layout attributes. An alt edit, its undo or a collaborator's change leaves `<img alt>` stale for screen readers until the view is rebuilt. This is independent of host srcs, but it showed up while adding an alt-text editor.

### Proposed API

```ts
type MediaSrcResolver = (
  src: string,
  ctx: { nodeType: "image" | "video" | "audio"; signal: AbortSignal },
) => string | Promise<string> | null; // null = not mine: default behaviour

class MediaSrcError extends Error {
  constructor(message: string, options?: { retryable?: boolean });
}

interface HyperMultimediaKitOptions {
  /** Turns a host-owned src into a URL the element can load. */
  resolveSrc?: MediaSrcResolver;
  /**
   * Host-owned srcs (e.g. `asset:`): accepted by parseHTML, Markdown
   * parsing and paste; treated as uploaded media (View original hidden).
   */
  isHostSrc?: (src: string) => boolean;
}

/** Re-runs `resolveSrc` for every view showing `src` (bytes arrived, or an error cleared). */
export function refreshMediaSrc(editor: Editor, src: string): void;
```

### Required behaviour

1. **Node view (image, video, audio).**
   - With `resolveSrc` set, and `isHostSrc(src)` true or the resolver returning non-null, the view creates the element **without** `src` and shows the loading shell as *pending*, not as an error.
   - A synchronous string result is set before the first paint, so a cached URL never flashes.
   - A promise sets the URL when it resolves.
   - A rejection with `MediaSrcError` calls `controller.markError(error.message)`.
   - `ctx.signal` aborts when the view is destroyed, or when the src changes and the view rebuilds. **Hosts release object URLs on this signal**, so the view keeps no resolver state of its own.
   - `update(node)` still returns `false` when `src` changes. When it doesn't, the view keeps its resolved URL: a resize or caption edit must not resolve again.
2. **`parseHTML`** accepts `isHostSrc(src)` next to the existing check, in both the `figure[data-hm-figure]` rule and the `img[src]` rule. Data URLs stay governed by `allowBase64`, as today.
3. **Markdown** parsing keeps a host src (it does today) and rendering writes it unchanged. Exporters rewrite refs afterwards.
4. **Toolbar:**
   - `downloadMedia`, `copyMediaNode` and `viewOriginalMedia` use the element's **resolved** URL (`img.currentSrc`), never `attrs.src`.
   - Copy writes the image bytes as `image/png` where the clipboard allows it, plus the node's HTML (which keeps the ref).
   - A host src counts as `isUploadedMedia`.
5. **`refreshMediaSrc(editor, src)`** re-resolves only the views whose `attrs.src === src`. It is a meta-only transaction outside history (`addToHistory: false`), or an equivalent that writes nothing to the document.
6. **`update` applies `alt` and `title`** to the element when they change, and still keeps the view.

### Tests to add in the package

- A resolver that rejects with `MediaSrcError("Gone")` shows the error shell with "Gone".
- `signal.abort` is called when the view is destroyed, and when the src changes and the view rebuilds.
- A synchronous resolver result is the element's `src` on first render.
- An `asset:` image survives a copy-and-paste round trip (`parseHTML` with `isHostSrc`).
- A width or caption change keeps the view and does not call the resolver again.
- `refreshMediaSrc` rebuilds only the views showing that src, and adds no undo step.
- An `alt` change updates `<img alt>`, and so does its undo.
- Download and Copy use `currentSrc` for a resolved host src.

### Compatibility

Without `resolveSrc` and `isHostSrc`, nothing changes. The existing 2.3 tests pass unchanged.

---

## What TinyDocy changes when 2.4 lands

- `extensions/hyper-multimedia/hyper-multimedia-kit.ts`: configure the kit with:
  - `isHostSrc: (s) => parseAssetRef(s) !== null`
  - `resolveSrc`, created once per editor and reading the document scope from the `assets` getter, so the extensions array never changes identity
- Delete `asset-image.ts` (`withAssetSrc`, `assetParseRules`, `assetRefreshPlugin`) and `asset-image-view.ts`, and re-export the upstream `refreshMediaSrc`.
- The sandbox paste policy (dropping `asset:` images without an asset scope, plus the notice) moves to a small `transformPasted` plugin, because upstream `parseHTML` accepts host srcs everywhere.
- Keep `imageActions` (Alt text…). Drop its Download and Copy overrides once upstream uses `currentSrc`.
- Delete the alt-sync wrapper in `withAssetSrc` once upstream applies `alt` on update (behaviour 6).
- Delete the pins in `tests/unit/extensions/asset-image.test.ts` that describe 2.3 internals. Keep the behaviour tests, pointed at the upstream hooks.
