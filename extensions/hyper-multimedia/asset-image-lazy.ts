/**
 * The one lazy chunk behind the image toolbar's extras and `asset:` image
 * views, so the editor chunk holds a single `import()` for all of them
 * (`asset-image.ts`). Nothing here may import a module the editor chunk
 * holds: editor-chunk values arrive as arguments.
 */
// Short names: the editor chunk spells each one out (`lazy.view(…)`).
export {
  assetImageView as view,
  pasteRefused,
  refreshAssetViews as refresh,
} from "./asset-image-view";
export { imageActions as actions } from "./asset-media-actions";
