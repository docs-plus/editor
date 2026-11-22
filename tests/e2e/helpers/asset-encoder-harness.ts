/**
 * Browser entry for `image-asset-encoder.spec.ts`: the image store insert
 * pipeline (`prepareImageAsset`) with the encode worker, bundled by the spec
 * with `Bun.build` and served from a route, so it runs in a real engine
 * without the app (no app path inserts assets until P2.6b and W11).
 */
import {
  createWorkerEncoder,
  encodeOnMainThread,
  type ImageEncodeFn,
} from "@/lib/assets/encode-client";
import { prepareImageAsset } from "@/lib/assets/prepare-image-asset";

export interface HarnessResult {
  mime: string;
  width: number;
  height: number;
  hex: string;
  /** The prepared bytes, base64. */
  base64: string;
  usedWorker: boolean;
  usedFallback: boolean;
  /** Longest gap between 10 ms main-thread ticks while preparing. */
  longestGapMs: number;
  totalMs: number;
}

declare global {
  interface Window {
    /** Makes the test photo in the page; returns its size in bytes. */
    __makePhoto(exif: number[]): Promise<number>;
    __prepareAsset(mode: "worker" | "main"): Promise<HarnessResult>;
  }
}

let photo: Blob | null = null;

/**
 * A 4000×3000 (12 MP) landscape JPEG from the page's own encoder, with an
 * Exif APP1 (`exif`) spliced in after SOI, like a phone photo.
 */
window.__makePhoto = async (exif) => {
  const canvas = document.createElement("canvas");
  canvas.width = 4000;
  canvas.height = 3000;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no 2d context");
  // Noise, so the photo does not compress to almost nothing.
  const tile = context.createImageData(400, 300);
  for (let i = 0; i < tile.data.length; i++) {
    tile.data[i] = Math.imul(i, 2654435761) >>> 24;
  }
  for (let x = 0; x < 4000; x += 400) {
    for (let y = 0; y < 3000; y += 300) context.putImageData(tile, x, y);
  }
  const jpeg = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.92),
  );
  if (!jpeg) throw new Error("no JPEG");
  const length = exif.length + 2;
  photo = new Blob(
    [
      new Uint8Array([0xff, 0xd8, 0xff, 0xe1, length >> 8, length & 0xff]),
      new Uint8Array(exif),
      jpeg.slice(2),
    ],
    { type: "image/jpeg" },
  );
  return photo.size;
};

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

window.__prepareAsset = async (mode) => {
  if (!photo) throw new Error("call __makePhoto first");
  let usedWorker = false;
  let usedFallback = false;
  const fallback: ImageEncodeFn = (...args) => {
    usedFallback = true;
    return encodeOnMainThread(...args);
  };
  const encode =
    mode === "worker"
      ? createWorkerEncoder({
          createWorker: () => {
            usedWorker = true;
            return new Worker("/encode-worker.js", { type: "module" });
          },
          fallback,
        })
      : fallback;

  const file = new File([photo], "photo", { type: photo.type });
  let last = performance.now();
  let longestGapMs = 0;
  const ticker = setInterval(() => {
    const now = performance.now();
    longestGapMs = Math.max(longestGapMs, now - last);
    last = now;
  }, 10);
  const start = performance.now();
  try {
    const prepared = await prepareImageAsset(file, { encode });
    const totalMs = performance.now() - start;
    clearInterval(ticker);
    return {
      mime: prepared.mime,
      width: prepared.width,
      height: prepared.height,
      hex: prepared.hex,
      base64: toBase64(prepared.bytes),
      usedWorker,
      usedFallback,
      longestGapMs,
      totalMs,
    };
  } finally {
    clearInterval(ticker);
  }
};
