/**
 * The image store insert pipeline (spec §2.3): a file becomes stripped,
 * capped bytes plus their SHA-256, ready for `BlobStore.put`.
 *
 *   plan(file):
 *     SVG or not an image          → reject
 *     GIF                          → passthrough if ≤ 2 MB, ≤ 2560 px and within the frame
 *                                    limits, minus comments and XMP; else reject
 *     JPEG                         → always re-encode (drops Exif and GPS, bakes the rotation in)
 *     PNG, WebP ≤ 2 MB and ≤ 2560 px → strip metadata chunks, keep the pixels
 *     anything else                → re-encode (WebP, else JPEG), in the encode worker
 *   then: sniff the magic bytes (a stored type) → SHA-256 → BlobStore.put
 *
 * It shares `planImageEmbed`'s shape and `encodeUnderCap` with the inline
 * path (`lib/image-downscale.ts`), in byte-cap mode. The public sandbox
 * never calls it: sandbox documents keep inline data URLs (I7).
 *
 * Lazy: only library documents insert assets, so nothing here is in the
 * editor chunk.
 */
import { type AssetHex, formatAssetRef } from "@/lib/assets/asset-ref";
import {
  encodeAssetImage,
  type ImageEncodeFn,
} from "@/lib/assets/encode-client";
import { sha256Hex } from "@/lib/assets/hash";
import {
  ASSET_MAX_SIDE,
  type AssetMime,
  MAX_ASSET_BYTES,
  MAX_ASSET_INPUT_BYTES,
  MAX_GIF_FRAME_PIXELS,
  MAX_GIF_FRAMES,
} from "@/lib/assets/limits";
import { checkImageBytes, sniffImageType } from "@/lib/assets/sniff";
import {
  stripGifMetadata,
  stripImageMetadata,
  stripJpegMetadata,
} from "@/lib/assets/strip-metadata";
import { throwIfAborted } from "@/lib/image-downscale";
import type { BlobOrigin, BlobStore } from "@/lib/platform/blob-store";

export const ASSET_COPY = {
  notImage: "Only image files can be added.",
  svg: "SVG images aren't supported. Export it as PNG or JPEG first.",
  tooLarge: "This image is larger than 20 MB. Choose a smaller file.",
  gifTooLarge: "GIFs must be under 2 MB (animations aren't resized).",
  gifTooWide:
    "GIFs must be at most 2560 pixels on each side (animations aren't resized).",
  gifTooLong: "This GIF has too many frames. Try a shorter animation.",
  cantShrink:
    "This image can't be made smaller than 2 MB. Try a smaller or simpler image.",
  unreadable:
    "This image format can't be read here. Try PNG, JPEG, WebP or GIF.",
  tooManyPixels: "This image has too many pixels to process.",
} as const;

export type AssetPlan =
  | { kind: "passthrough" }
  | { kind: "strip"; type: "image/png" | "image/webp" }
  | { kind: "reencode" }
  | { kind: "reject"; reason: string };

/** Decides how a file becomes an asset, before reading its bytes. */
export function planImageAsset(file: Pick<Blob, "type" | "size">): AssetPlan {
  const type = file.type.toLowerCase();
  if (!type.startsWith("image/")) {
    return { kind: "reject", reason: ASSET_COPY.notImage };
  }
  if (type === "image/svg+xml")
    return { kind: "reject", reason: ASSET_COPY.svg };
  if (file.size > MAX_ASSET_INPUT_BYTES) {
    return { kind: "reject", reason: ASSET_COPY.tooLarge };
  }
  const fits = file.size <= MAX_ASSET_BYTES;
  if (type === "image/gif") {
    return fits
      ? { kind: "passthrough" }
      : { kind: "reject", reason: ASSET_COPY.gifTooLarge };
  }
  if (fits && (type === "image/png" || type === "image/webp")) {
    return { kind: "strip", type };
  }
  return { kind: "reencode" };
}

export interface PreparedAsset {
  bytes: Uint8Array<ArrayBuffer>;
  mime: AssetMime;
  hex: AssetHex;
  width: number;
  height: number;
}

export interface PrepareAssetOptions {
  signal?: AbortSignal;
  /** Default: the encode worker, else the main-thread canvas. */
  encode?: ImageEncodeFn;
}

/** Markup (SVG, HTML) under an image label: refused, never decoded. */
function looksLikeMarkup(bytes: Uint8Array): boolean {
  const head = new TextDecoder().decode(bytes.subarray(0, 64)).trimStart();
  return head.replace(/^﻿/, "").startsWith("<");
}

/**
 * Checks what the header says before anything decodes. A stored type must
 * have a readable size within the limits; a type the store converts (AVIF,
 * HEIC, BMP) has no size we read, so only the worker may decode it.
 */
function decodeGuard(bytes: Uint8Array): { mainThread: boolean } {
  const type = sniffImageType(bytes);
  if (!type) return { mainThread: false };
  const check = checkImageBytes(bytes, type);
  if (!check.ok) {
    throw new Error(
      check.reason === "too_many_pixels"
        ? ASSET_COPY.tooManyPixels
        : ASSET_COPY.unreadable,
    );
  }
  return { mainThread: true };
}

/** Bytes that need no decode: a real GIF, or a PNG/WebP that strips. */
function withoutReencode(
  bytes: Uint8Array,
  plan: AssetPlan,
): Uint8Array<ArrayBuffer> | null {
  if (plan.kind === "passthrough") {
    const check = checkImageBytes(bytes, "image/gif");
    if (!check.ok) {
      if (check.reason === "too_many_pixels") {
        throw new Error(ASSET_COPY.tooManyPixels);
      }
      return null; // not a GIF after all: re-encode it
    }
    if (Math.max(check.width, check.height) > ASSET_MAX_SIDE) {
      throw new Error(ASSET_COPY.gifTooWide);
    }
    // Comments and XMP drop; the frames and loop count stay byte for byte.
    const gif = stripGifMetadata(bytes);
    if (!gif) throw new Error(ASSET_COPY.unreadable);
    if (gif.frames > MAX_GIF_FRAMES || gif.framePixels > MAX_GIF_FRAME_PIXELS) {
      throw new Error(ASSET_COPY.gifTooLong);
    }
    return gif.bytes;
  }
  if (plan.kind === "strip") {
    const check = checkImageBytes(bytes, plan.type);
    if (!check.ok || Math.max(check.width, check.height) > ASSET_MAX_SIDE) {
      return null;
    }
    return stripImageMetadata(bytes, plan.type);
  }
  return null;
}

async function reencode(
  file: Blob,
  bytes: Uint8Array,
  encode: ImageEncodeFn,
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  const result = await encode(
    file,
    { maxBytes: MAX_ASSET_BYTES, maxSide: ASSET_MAX_SIDE },
    signal,
    decodeGuard(bytes),
  );
  if (!result.ok) {
    throw new Error(
      result.error === "shrink"
        ? ASSET_COPY.cantShrink
        : result.error === "pixels"
          ? ASSET_COPY.tooManyPixels
          : ASSET_COPY.unreadable,
    );
  }
  const out = new Uint8Array(await result.blob.arrayBuffer());
  // Safari's JPEG encoder adds its own Exif and Photoshop segments; the
  // server refuses any JPEG with an APP1 (spec §4.2 rule 10).
  return result.blob.type === "image/jpeg"
    ? (stripJpegMetadata(out) ?? out)
    : out;
}

/**
 * Prepares `file` for the image store, or throws an `Error` whose message
 * is safe to show (spec §7 copy).
 */
export async function prepareImageAsset(
  file: Blob,
  { signal, encode = encodeAssetImage }: PrepareAssetOptions = {},
): Promise<PreparedAsset> {
  throwIfAborted(signal);
  const plan = planImageAsset(file);
  if (plan.kind === "reject") throw new Error(plan.reason);
  const input = new Uint8Array(await file.arrayBuffer());
  throwIfAborted(signal);
  if (looksLikeMarkup(input)) throw new Error(ASSET_COPY.svg);

  const bytes =
    withoutReencode(input, plan) ??
    (await reencode(file, input, encode, signal));
  throwIfAborted(signal);
  if (bytes.byteLength > MAX_ASSET_BYTES)
    throw new Error(ASSET_COPY.cantShrink);
  const check = checkImageBytes(bytes);
  if (!check.ok) {
    throw new Error(
      check.reason === "too_many_pixels"
        ? ASSET_COPY.tooManyPixels
        : ASSET_COPY.unreadable,
    );
  }
  return {
    bytes,
    mime: check.mime,
    hex: await sha256Hex(bytes),
    width: check.width,
    height: check.height,
  };
}

export interface StoredImageAsset {
  /** The `asset:sha256-<hex>` ref for the image node's `src`. */
  src: string;
  hex: AssetHex;
  width: number;
  height: number;
}

/**
 * Stores prepared bytes and returns the image node's ref. Resolves only once
 * the bytes are durable: insert the node after this, never before (§3.2).
 */
export async function putImageAsset(
  store: BlobStore,
  docId: string,
  prepared: PreparedAsset,
  origin: BlobOrigin = "insert",
): Promise<StoredImageAsset> {
  const { hex } = await store.put(docId, prepared.bytes, prepared.mime, origin);
  return {
    src: formatAssetRef(hex),
    hex,
    width: prepared.width,
    height: prepared.height,
  };
}
