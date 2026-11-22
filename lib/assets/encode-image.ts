/**
 * Decode and re-encode for the image store, run inside the encode worker
 * (`encode-worker.ts`) with `createImageBitmap` and `OffscreenCanvas`, so a
 * 12 MP photo never blocks typing (spec §2.3, R7).
 *
 * The DOM APIs are passed in, so the steps are unit-tested with fakes.
 * The output is WebP where the canvas can encode it, else JPEG on white.
 */
import { MAX_ASSET_PIXELS } from "@/lib/assets/limits";
import {
  type EncodedImage,
  encodeAttempts,
  type ImageEncoder,
  throwIfAborted,
} from "@/lib/image-downscale";

interface DecodedBitmap {
  width: number;
  height: number;
  close(): void;
}

interface Context2D {
  fillStyle: string | CanvasGradient | CanvasPattern;
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: ImageSmoothingQuality;
  fillRect(x: number, y: number, w: number, h: number): void;
  drawImage(image: never, x: number, y: number, w: number, h: number): void;
}

interface EncodableCanvas {
  width: number;
  height: number;
  getContext(type: "2d"): Context2D | null;
  convertToBlob(options?: ImageEncodeOptions): Promise<Blob>;
}

export interface EncodeDeps {
  createImageBitmap(
    source: Blob,
    options: ImageBitmapOptions,
  ): Promise<DecodedBitmap>;
  createCanvas(width: number, height: number): EncodableCanvas;
}

export interface EncodeRequest {
  maxBytes: number;
  maxSide: number;
}

export type EncodeError =
  /** The browser cannot decode the file. */
  | "decode"
  /** Over the decoded-pixel ceiling. */
  | "pixels"
  /** Even the smallest attempt is over `maxBytes`. */
  | "shrink";

export type EncodeResult =
  | { ok: true; blob: Blob; width: number; height: number }
  | { ok: false; error: EncodeError };

/**
 * `encodeUnderCap` for the image store: the same attempts, starting at
 * `maxSide`, but the first output whose raw bytes (not a data URL) fit
 * `maxBytes`. Kept apart so the editor chunk's copy stays unchanged.
 */
export async function encodeUnderByteCap<T extends EncodedImage>(
  encoder: ImageEncoder<T>,
  maxBytes: number,
  maxSide: number,
  signal?: AbortSignal,
): Promise<T | null> {
  for (const attempt of encodeAttempts(
    encoder.width,
    encoder.height,
    maxSide,
  )) {
    throwIfAborted(signal);
    const output = await encoder.encode(attempt);
    if (output && output.size <= maxBytes) return output;
  }
  return null;
}

/** True when this canvas really writes WebP (Safari silently writes PNG). */
async function encodesWebp(deps: EncodeDeps): Promise<boolean> {
  const probe = deps.createCanvas(1, 1);
  // `OffscreenCanvas.convertToBlob` throws until the canvas has a context.
  probe.getContext("2d");
  const blob = await probe.convertToBlob({ type: "image/webp", quality: 0.8 });
  return blob.type === "image/webp";
}

export async function encodeImageUnderCap(
  source: Blob,
  { maxBytes, maxSide }: EncodeRequest,
  deps: EncodeDeps,
): Promise<EncodeResult> {
  let bitmap: DecodedBitmap;
  try {
    // Drawn upright: the Exif rotation is baked in, then dropped (I3).
    bitmap = await deps.createImageBitmap(source, {
      imageOrientation: "from-image",
    });
  } catch {
    return { ok: false, error: "decode" };
  }
  try {
    const { width, height } = bitmap;
    if (width === 0 || height === 0) return { ok: false, error: "decode" };
    if (width * height > MAX_ASSET_PIXELS)
      return { ok: false, error: "pixels" };

    const type = (await encodesWebp(deps)) ? "image/webp" : "image/jpeg";
    const canvas = deps.createCanvas(1, 1);
    const context = canvas.getContext("2d");
    if (!context) return { ok: false, error: "decode" };
    const encoder = {
      width,
      height,
      async encode(attempt: {
        width: number;
        height: number;
        quality: number;
      }) {
        if (
          canvas.width !== attempt.width ||
          canvas.height !== attempt.height
        ) {
          canvas.width = attempt.width;
          canvas.height = attempt.height;
          context.imageSmoothingEnabled = true;
          context.imageSmoothingQuality = "high";
          if (type === "image/jpeg") {
            context.fillStyle = "#fff";
            context.fillRect(0, 0, attempt.width, attempt.height);
          }
          context.drawImage(
            bitmap as never,
            0,
            0,
            attempt.width,
            attempt.height,
          );
        }
        const blob = await canvas.convertToBlob({
          type,
          quality: attempt.quality,
        });
        return blob.type === type ? blob : null;
      },
    };
    const out = await encodeUnderByteCap(encoder, maxBytes, maxSide);
    // The output that fit came from the last attempt, at the canvas size.
    const size = { width: canvas.width, height: canvas.height };
    canvas.width = 0;
    canvas.height = 0;
    return out
      ? { ok: true, blob: out, ...size }
      : { ok: false, error: "shrink" };
  } finally {
    bitmap.close();
  }
}
