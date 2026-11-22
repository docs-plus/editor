/**
 * Synthetic images (test strategy §3.1): drawn here from a seed, never taken
 * from a real photo, and encoded with what is already in the tree (PNG
 * through `node:zlib`, the byte builders in `tests/helpers/image-bytes.ts`).
 * GPS blocks carry made-up coordinates.
 */
import { deflateSync } from "node:zlib";

import {
  ascii,
  buildExifApp1,
  buildWebp,
  concat,
  GIF_TWO_FRAMES,
  pngChunk,
} from "@/tests/helpers/image-bytes";

import type { Rng } from "./rng";

const PNG_SIGNATURE = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/** 12 MP, the size of a phone photo (image store §8: 12 MP photos). */
export const PHOTO_WIDTH = 4000;
export const PHOTO_HEIGHT = 3000;

function be32(value: number): Uint8Array {
  return new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

/** Made-up coordinates: a point in open sea, picked from the seed. */
export function syntheticGps(rng: Rng): { lat: number; lon: number } {
  return {
    lat: Math.round((rng.next() * 120 - 60) * 1e4) / 1e4,
    lon: Math.round((rng.next() * 340 - 170) * 1e4) / 1e4,
  };
}

/**
 * A decodable 8-bit RGB PNG of `width` × `height`: a seeded two-colour
 * gradient with a little noise, so two seeds never give the same image and
 * the encoder still compresses it. `exif` adds an `eXIf` chunk.
 */
export function syntheticPng(
  rng: Rng,
  width: number,
  height: number,
  options: { exif?: Uint8Array } = {},
): Uint8Array<ArrayBuffer> {
  const [r0, g0, b0, r1, g1, b1] = Array.from({ length: 6 }, () =>
    rng.int(0, 255),
  );
  const stride = width * 3 + 1;
  const raw = new Uint8Array(stride * height);
  const noise = Uint8Array.from({ length: 251 }, () => rng.int(0, 7));
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    raw[row] = 0; // filter: none
    const t = height === 1 ? 0 : y / (height - 1);
    for (let x = 0; x < width; x++) {
      const s = width === 1 ? 0 : x / (width - 1);
      const mix = (t + s) / 2;
      const n = noise[(x * 7 + y * 13) % noise.length];
      const at = row + 1 + x * 3;
      raw[at] = (r0 + (r1 - r0) * mix + n) & 0xff;
      raw[at + 1] = (g0 + (g1 - g0) * mix + n) & 0xff;
      raw[at + 2] = (b0 + (b1 - b0) * mix + n) & 0xff;
    }
  }
  const ihdr = concat(
    be32(width),
    be32(height),
    new Uint8Array([8, 2, 0, 0, 0]),
  );
  return concat(
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    ...(options.exif ? [pngChunk("eXIf", options.exif)] : []),
    pngChunk("IDAT", new Uint8Array(deflateSync(raw, { level: 6 }))),
    pngChunk("IEND", new Uint8Array()),
  );
}

/** A 12 MP photo stand-in: a PNG with an `eXIf` block holding fake GPS. */
export function syntheticPhoto(
  rng: Rng,
  width = PHOTO_WIDTH,
  height = PHOTO_HEIGHT,
): Uint8Array<ArrayBuffer> {
  const exif = buildExifApp1({ orientation: 1, gps: syntheticGps(rng) });
  return syntheticPng(rng, width, height, { exif: exif.subarray(6) });
}

function jpegSegment(marker: number, payload: Uint8Array): Uint8Array {
  const length = payload.length + 2;
  return concat(
    new Uint8Array([0xff, marker, length >> 8, length & 0xff]),
    payload,
  );
}

/**
 * A JPEG with an Exif APP1 (orientation and fake GPS). Structural only:
 * the segments a metadata stripper walks, not a decodable picture (no JPEG
 * encoder is in the tree, and §3.1 adds none for tests).
 */
export function syntheticJpegWithExif(
  rng: Rng,
  orientation = 6,
): Uint8Array<ArrayBuffer> {
  const exif = buildExifApp1({ orientation, gps: syntheticGps(rng) });
  return concat(
    new Uint8Array([0xff, 0xd8]),
    jpegSegment(0xe0, ascii("JFIF\x00\x01\x01\x00\x00H\x00H\x00\x00")),
    jpegSegment(0xe1, exif),
    jpegSegment(0xc0, new Uint8Array([8, 0, 1, 0, 1, 1, 1, 0x11, 0])),
    jpegSegment(0xda, new Uint8Array([1, 1, 0, 0, 0x3f, 0])),
    new Uint8Array([0x12, 0x34, 0xff, 0xd9]),
  );
}

/** The EXIF sample set: one file per container, each with fake GPS. */
export function exifSamples(rng: Rng): Record<string, Uint8Array> {
  return {
    "exif-gps.jpg": syntheticJpegWithExif(rng.fork("jpg")),
    "exif-gps.png": syntheticPng(rng.fork("png"), 8, 8, {
      exif: buildExifApp1({
        orientation: 3,
        gps: syntheticGps(rng.fork("png-gps")),
      }).subarray(6),
    }),
    "exif-gps-xmp.webp": buildWebp({ exif: true, orientation: 8, xmp: true }),
    "animated.gif": GIF_TWO_FRAMES,
  };
}

/** `bytes` as a `data:` URL, the form pre-P2.6c documents stored inline. */
export function dataUrl(mime: string, bytes: Uint8Array): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}
