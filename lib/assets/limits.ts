/**
 * Image store limits (spec §2.2). Shared by the client pipeline, every
 * `BlobStore` and, later, the Hocus asset endpoints, so it imports nothing.
 */

/** The four stored types. No SVG, ever: it is script-capable markup. */
export const ASSET_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export type AssetMime = (typeof ASSET_MIME_TYPES)[number];

export function isAssetMime(type: string): type is AssetMime {
  return (ASSET_MIME_TYPES as readonly string[]).includes(type);
}

/** One stored asset (`MAX_ASSET_BYTES`). */
export const MAX_ASSET_BYTES = 2 * 1024 * 1024;
/** Longest side of a stored asset (`ASSET_MAX_SIDE`). */
export const ASSET_MAX_SIDE = 2560;
/** Largest file accepted before it is prepared. */
export const MAX_ASSET_INPUT_BYTES = 20 * 1024 * 1024;
/** Images accepted per paste, drop or pick. */
export const ASSET_UPLOAD_LIMIT = 10;
/** Decoded-pixel ceiling: guards every client that decodes the image. */
export const MAX_ASSET_PIXELS = 40_000_000;
/** Longest side any header may declare. */
export const MAX_ASSET_DIMENSION = 16_384;
/**
 * Animated GIFs pass through undecoded, so their decoders' work is bounded
 * here instead: at most this many frames, and this many pixels summed over
 * every frame: 4 × the still-image ceiling, about 1,500 frames at
 * 320 × 320 or 24 at 2560 × 2560.
 */
export const MAX_GIF_FRAMES = 1000;
export const MAX_GIF_FRAME_PIXELS = 4 * MAX_ASSET_PIXELS;
