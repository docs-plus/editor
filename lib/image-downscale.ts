/**
 * Client-side image preparation for inline (data URL) embeds.
 *
 * Images live inside the shared Y.Doc as base64 data URLs, and the Hocuspocus
 * server refuses to store documents over `MAX_DOC_SIZE_BYTES` (1 MiB by
 * default). An unprocessed photo would make the document unsavable and every
 * later edit would be lost, so raster images are downscaled and re-encoded
 * until their data URL fits `MAX_EMBED_IMAGE_BYTES`.
 *
 * The decision logic is pure and unit-tested; only `prepareImageForEmbed`
 * touches the DOM (canvas, Image, FileReader).
 */

export const DEFAULT_MAX_EMBED_IMAGE_BYTES = 256 * 1024;

/** Bounds applied to `NEXT_PUBLIC_MAX_EMBED_IMAGE_BYTES`. */
const MIN_EMBED_IMAGE_BYTES = 16 * 1024;
const MAX_EMBED_IMAGE_BYTES_CEILING = 1024 * 1024;

/**
 * Parses the embed cap from env. Missing or malformed values fall back to
 * the default; out-of-range values are clamped so a typo can neither make
 * every image unembeddable nor exceed the server's default document cap.
 */
export function parseMaxEmbedImageBytes(raw: string | undefined): number {
  const value = raw?.trim();
  if (!value || !/^\d+$/.test(value)) return DEFAULT_MAX_EMBED_IMAGE_BYTES;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return DEFAULT_MAX_EMBED_IMAGE_BYTES;
  return Math.min(
    Math.max(parsed, MIN_EMBED_IMAGE_BYTES),
    MAX_EMBED_IMAGE_BYTES_CEILING,
  );
}

/** Max length of one embedded image's data URL (read at build time). */
export const MAX_EMBED_IMAGE_BYTES = parseMaxEmbedImageBytes(
  process.env.NEXT_PUBLIC_MAX_EMBED_IMAGE_BYTES,
);

/** Longest side, in pixels, of a re-encoded image. */
export const EMBED_IMAGE_MAX_SIDE = 1600;
/** Smallest longest side tried before giving up. */
const EMBED_IMAGE_MIN_SIDE = 320;
const SIDE_STEP = 0.75;
const QUALITY_STEPS = [0.85, 0.7, 0.55] as const;

/** Decoded-pixel ceiling; guards against decompression bombs. */
export const MAX_DECODE_PIXELS = 40_000_000;

/** Types that are embedded unchanged when they already fit the cap. */
const PASSTHROUGH_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

export function formatKilobytes(bytes: number): string {
  return `${Math.round(bytes / 1024)} KB`;
}

/** Exact length of `data:<type>;base64,<payload>` for `byteLength` bytes. */
export function dataUrlLength(mimeType: string, byteLength: number): number {
  return `data:${mimeType};base64,`.length + Math.ceil(byteLength / 3) * 4;
}

export interface Dimensions {
  width: number;
  height: number;
}

/** Scales `width`×`height` so the longest side is ≤ `maxSide`; never upscales. */
export function fitWithin(
  width: number,
  height: number,
  maxSide: number,
): Dimensions {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export interface EncodeAttempt extends Dimensions {
  quality: number;
}

/**
 * Encode attempts from best to smallest: each size is tried at decreasing
 * quality, then the longest side steps down by 25% until it reaches
 * `EMBED_IMAGE_MIN_SIDE` (or the image's own size, if smaller).
 */
export function* encodeAttempts(
  width: number,
  height: number,
  maxSide: number = EMBED_IMAGE_MAX_SIDE,
): Generator<EncodeAttempt> {
  let side = Math.min(maxSide, Math.max(width, height));
  while (true) {
    const size = fitWithin(width, height, side);
    for (const quality of QUALITY_STEPS) yield { ...size, quality };
    if (side <= EMBED_IMAGE_MIN_SIDE) return;
    side = Math.max(EMBED_IMAGE_MIN_SIDE, Math.floor(side * SIDE_STEP));
  }
}

export type EmbedPlan =
  | { kind: "passthrough" }
  | { kind: "reencode" }
  | { kind: "reject"; reason: string };

/** Decides how a file becomes an embed, before any decoding happens. */
export function planImageEmbed(
  file: Pick<Blob, "type" | "size">,
  maxBytes: number,
): EmbedPlan {
  const type = file.type.toLowerCase();
  if (!type.startsWith("image/")) {
    return { kind: "reject", reason: "Only image files can be embedded." };
  }
  if (type === "image/svg+xml") {
    return {
      kind: "reject",
      reason: "SVG images can't be embedded. Export it as PNG or JPEG first.",
    };
  }
  const fits = dataUrlLength(type, file.size) <= maxBytes;
  if (type === "image/gif") {
    return fits
      ? { kind: "passthrough" }
      : {
          kind: "reject",
          reason: `GIFs must be under ${formatKilobytes(maxBytes)} to embed (animations aren't resized).`,
        };
  }
  return fits && PASSTHROUGH_TYPES.has(type)
    ? { kind: "passthrough" }
    : { kind: "reencode" };
}

export interface EncodedImage {
  type: string;
  size: number;
}

export interface ImageEncoder<T extends EncodedImage> extends Dimensions {
  encode: (attempt: EncodeAttempt) => Promise<T | null>;
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) throw new Error("Upload cancelled");
}

/**
 * Runs `encodeAttempts` through `encoder` and returns the first output whose
 * data URL fits `maxBytes`, or `null` when even the smallest attempt is too big.
 */
export async function encodeUnderCap<T extends EncodedImage>(
  encoder: ImageEncoder<T>,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<T | null> {
  for (const attempt of encodeAttempts(encoder.width, encoder.height)) {
    throwIfAborted(signal);
    const output = await encoder.encode(attempt);
    if (output && dataUrlLength(output.type, output.size) <= maxBytes) {
      return output;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Browser-only helpers                                                 */
/* ------------------------------------------------------------------ */

function readAsDataUrl(blob: Blob, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Upload cancelled"));
      return;
    }
    const reader = new FileReader();
    const onAbort = () => {
      reader.abort();
      reject(new Error("Upload cancelled"));
    };
    reader.onload = () => {
      signal?.removeEventListener("abort", onAbort);
      resolve(reader.result as string);
    };
    reader.onerror = () => {
      signal?.removeEventListener("abort", onAbort);
      reject(new Error("Failed to read file"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    reader.readAsDataURL(blob);
  });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error("This image format can't be read by your browser."));
    image.src = url;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

let webpSupport: Promise<boolean> | null = null;

/** Browsers that can't encode WebP silently return PNG from `toBlob`. */
function supportsWebpEncoding(): Promise<boolean> {
  webpSupport ??= (async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const blob = await canvasToBlob(canvas, "image/webp", 0.8);
    return blob?.type === "image/webp";
  })();
  return webpSupport;
}

function createCanvasEncoder(
  image: HTMLImageElement,
  outputType: "image/webp" | "image/jpeg",
): ImageEncoder<Blob> & { dispose: () => void } {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image processing isn't available.");

  return {
    width: image.naturalWidth,
    height: image.naturalHeight,
    async encode({ width, height, quality }) {
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        // JPEG has no alpha channel; transparent pixels would turn black.
        if (outputType === "image/jpeg") {
          context.fillStyle = "#fff";
          context.fillRect(0, 0, width, height);
        }
        context.drawImage(image, 0, 0, width, height);
      }
      return canvasToBlob(canvas, outputType, quality);
    },
    dispose() {
      canvas.width = 0;
      canvas.height = 0;
    },
  };
}

export interface PrepareImageOptions {
  maxBytes?: number;
  signal?: AbortSignal;
  onProgress?: (percent: number) => void;
}

/**
 * Turns an image file into a data URL no longer than `maxBytes`, or throws an
 * `Error` whose message is safe to show to the user.
 */
export async function prepareImageForEmbed(
  file: File,
  {
    maxBytes = MAX_EMBED_IMAGE_BYTES,
    signal,
    onProgress,
  }: PrepareImageOptions = {},
): Promise<string> {
  const plan = planImageEmbed(file, maxBytes);
  if (plan.kind === "reject") throw new Error(plan.reason);
  if (plan.kind === "passthrough") return readAsDataUrl(file, signal);

  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    throwIfAborted(signal);
    if (image.naturalWidth * image.naturalHeight > MAX_DECODE_PIXELS) {
      throw new Error("This image has too many pixels to process.");
    }
    if (image.naturalWidth === 0 || image.naturalHeight === 0) {
      throw new Error("This image format can't be read by your browser.");
    }
    onProgress?.(25);

    const outputType = (await supportsWebpEncoding())
      ? "image/webp"
      : "image/jpeg";
    const encoder = createCanvasEncoder(image, outputType);
    try {
      const blob = await encodeUnderCap(encoder, maxBytes, signal);
      if (!blob) {
        throw new Error(
          `This image can't be shrunk below ${formatKilobytes(maxBytes)}. Try a smaller or simpler image.`,
        );
      }
      onProgress?.(90);
      return await readAsDataUrl(blob, signal);
    } finally {
      encoder.dispose();
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}
