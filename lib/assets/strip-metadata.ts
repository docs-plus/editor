/**
 * Removes metadata from PNG and WebP files without touching their pixels,
 * and from JPEGs the canvas encoder produced.
 *
 * Image privacy policy (I3): an inserted image must not carry camera or
 * location metadata.
 * - JPEG is always re-encoded through a canvas (`lib/image-downscale.ts`),
 *   which drops Exif and GPS and bakes in the rotation.
 * - PNG and WebP keep their image chunks byte for byte, filtered through an
 *   allowlist: text, time, Exif, XMP, unknown and private chunks are dropped.
 *   A file carrying an Exif rotation is not stripped (the browser draws that
 *   rotation, so dropping it would turn the picture); the caller re-encodes.
 * - GIF passes through unchanged so animations keep working. Its comment and
 *   XMP application extensions pass through with it.
 * - A JPEG the canvas encoder produced (Safari, which cannot encode WebP)
 *   loses the Exif and Photoshop segments that encoder adds on its own
 *   (`stripJpegMetadata`). Those hold colour space and pixel size, nothing
 *   from the source, so when they cannot be removed the encoder output is
 *   kept as it is.
 *
 * Pure: no DOM, so the policy is unit-tested. `null` means "re-encode
 * instead": malformed or truncated input, bytes that are not the declared
 * container or hold no image, a rotation, or Exif that cannot be read.
 */

/** Colour, transparency, physical size and APNG animation are kept. */
const PNG_KEEP = new Set([
  "IHDR",
  "PLTE",
  "IDAT",
  "IEND",
  "tRNS",
  "cHRM",
  "gAMA",
  "iCCP",
  "sBIT",
  "sRGB",
  "cICP",
  "mDCV",
  "cLLI",
  "bKGD",
  "hIST",
  "pHYs",
  "sPLT",
  "acTL",
  "fcTL",
  "fdAT",
]);

const WEBP_KEEP = new Set([
  "VP8 ",
  "VP8L",
  "VP8X",
  "ALPH",
  "ICCP",
  "ANIM",
  "ANMF",
]);

/** VP8X flag bits for the Exif and XMP chunks that are dropped. */
const VP8X_EXIF_AND_XMP = 0x08 | 0x04;
/** The VP8X payload is 10 bytes: flags, reserved, canvas width and height. */
const VP8X_SIZE = 10;
/** WebP chunks that hold image data; a file needs at least one. */
const WEBP_IMAGE = new Set(["VP8 ", "VP8L", "ANMF"]);

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function fourcc(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset],
    bytes[offset + 1],
    bytes[offset + 2],
    bytes[offset + 3],
  );
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/**
 * Reads Exif Orientation (tag 0x0112) from a TIFF block, with or without the
 * `Exif\0\0` prefix. A missing tag counts as 1; `null` when unreadable.
 */
function exifOrientation(block: Uint8Array): number | null {
  const tiff = fourcc(block, 0) === "Exif" ? block.subarray(6) : block;
  if (tiff.length < 8) return null;
  const order = fourcc(tiff, 0);
  const little = order === "II*\0";
  if (!little && order !== "MM\0*") return null;
  const data = view(tiff);
  const ifd = data.getUint32(4, little);
  if (ifd + 2 > tiff.length) return null;
  const count = data.getUint16(ifd, little);
  if (ifd + 2 + count * 12 > tiff.length) return null;
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (data.getUint16(entry, little) === 0x0112) {
      return data.getUint16(entry + 8, little);
    }
  }
  return 1;
}

function isUpright(exifBlock: Uint8Array): boolean {
  return exifOrientation(exifBlock) === 1;
}

function join(parts: Uint8Array[], length: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function stripPng(bytes: Uint8Array): Uint8Array<ArrayBuffer> | null {
  if (bytes.length < PNG_SIGNATURE.length) return null;
  if (PNG_SIGNATURE.some((byte, i) => bytes[i] !== byte)) return null;

  const data = view(bytes);
  const kept: Uint8Array[] = [bytes.subarray(0, PNG_SIGNATURE.length)];
  let length = PNG_SIGNATURE.length;
  let offset = PNG_SIGNATURE.length;
  let hasImageData = false;

  while (offset + 12 <= bytes.length) {
    const size = data.getUint32(offset);
    const end = offset + 12 + size;
    if (end > bytes.length) return null;
    const type = fourcc(bytes, offset + 4);
    if (offset === PNG_SIGNATURE.length && type !== "IHDR") return null;
    if (type === "IDAT") hasImageData = true;
    if (
      type === "eXIf" &&
      !isUpright(bytes.subarray(offset + 8, offset + 8 + size))
    ) {
      return null;
    }
    if (PNG_KEEP.has(type)) {
      kept.push(bytes.subarray(offset, end));
      length += end - offset;
    }
    // Anything after IEND (appended text, a second file) is dropped.
    if (type === "IEND") return hasImageData ? join(kept, length) : null;
    offset = end;
  }
  return null;
}

function stripWebp(bytes: Uint8Array): Uint8Array<ArrayBuffer> | null {
  if (bytes.length < 12) return null;
  if (fourcc(bytes, 0) !== "RIFF" || fourcc(bytes, 8) !== "WEBP") return null;

  const data = view(bytes);
  // Bytes past the declared RIFF size are dropped.
  const end = data.getUint32(4, true) + 8;
  if (end > bytes.length) return null;

  const kept: Uint8Array[] = [];
  let length = 12;
  let offset = 12;
  let hasImageData = false;
  while (offset < end) {
    if (offset + 8 > end) return null;
    const id = fourcc(bytes, offset);
    const size = data.getUint32(offset + 4, true);
    const chunkEnd = offset + 8 + size + (size & 1);
    if (chunkEnd > end) return null;
    if (id === "VP8X" && size < VP8X_SIZE) return null;
    if (WEBP_IMAGE.has(id)) hasImageData = true;
    if (
      id === "EXIF" &&
      !isUpright(bytes.subarray(offset + 8, offset + 8 + size))
    ) {
      return null;
    }
    if (WEBP_KEEP.has(id)) {
      kept.push(bytes.subarray(offset, chunkEnd));
      length += chunkEnd - offset;
    }
    offset = chunkEnd;
  }
  if (!hasImageData) return null;

  const out = join([bytes.subarray(0, 12), ...kept], length);
  view(out).setUint32(4, length - 8, true);
  // VP8X comes first when present; byte 20 is its flags byte.
  if (fourcc(out, 12) === "VP8X") out[20] &= ~VP8X_EXIF_AND_XMP;
  return out;
}

/**
 * Returns `bytes` without metadata chunks, or `null` when the caller should
 * re-encode instead (see the module comment).
 */
export function stripImageMetadata(
  bytes: Uint8Array,
  type: "image/png" | "image/webp",
): Uint8Array<ArrayBuffer> | null {
  return type === "image/png" ? stripPng(bytes) : stripWebp(bytes);
}

/**
 * JPEG segments kept before the first scan: JFIF (APP0), ICC profile (APP2),
 * Adobe colour transform (APP14), tables, frame headers and restart interval.
 * Exif and XMP (APP1), Photoshop (APP13), every other APPn and comments drop.
 */
function keepJpegSegment(marker: number): boolean {
  if (marker === 0xe0 || marker === 0xe2 || marker === 0xee) return true;
  if (marker === 0xdb || marker === 0xdd) return true; // DQT, DRI
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc8; // SOFn, DHT, DAC
}

/**
 * Removes metadata segments from a JPEG produced by the canvas encoder, or
 * returns `null` when the bytes are not a complete JPEG. Only for encoder
 * output: a source JPEG must be re-encoded instead, because dropping its
 * APP1 would also drop its rotation. Bytes after EOI are dropped.
 */
export function stripJpegMetadata(
  bytes: Uint8Array,
): Uint8Array<ArrayBuffer> | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const data = view(bytes);
  const kept: Uint8Array[] = [bytes.subarray(0, 2)];
  let length = 2;
  let offset = 2;

  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      offset += 1; // fill byte
      continue;
    }
    const end = offset + 2 + data.getUint16(offset + 2);
    if (end > bytes.length) return null;
    if (marker === 0xda) {
      // Entropy-coded data escapes 0xFF as FF 00 or a restart marker, so the
      // first FF D9 after the scan header is EOI.
      for (let i = end; i + 1 < bytes.length; i++) {
        if (bytes[i] === 0xff && bytes[i + 1] === 0xd9) {
          kept.push(bytes.subarray(offset, i + 2));
          return join(kept, length + i + 2 - offset);
        }
      }
      return null;
    }
    if (keepJpegSegment(marker)) {
      kept.push(bytes.subarray(offset, end));
      length += end - offset;
    }
    offset = end;
  }
  return null;
}

/** Application extensions a GIF keeps: the loop count. XMP and the rest drop. */
const GIF_KEEP_APPLICATIONS = new Set(["NETSCAPE2.0", "ANIMEXTS1.0"]);

export interface StrippedGif {
  bytes: Uint8Array<ArrayBuffer>;
  /** Image descriptors: one per frame. */
  frames: number;
  /** The sum of every frame's width × height: the decoder's work. */
  framePixels: number;
}

/** Skips data sub-blocks from `offset`; the offset after the terminator, or -1. */
function skipSubBlocks(bytes: Uint8Array, offset: number): number {
  let at = offset;
  while (at < bytes.length) {
    const size = bytes[at];
    if (size === 0) return at + 1;
    at += 1 + size;
  }
  return -1;
}

/**
 * Walks a GIF's blocks without decoding: drops comment extensions and every
 * application extension but the loop count (XMP lives in one), counts the
 * frames and their area, and drops anything after the trailer. `null` for a
 * file that is not a complete GIF. The pixels are untouched.
 */
export function stripGifMetadata(bytes: Uint8Array): StrippedGif | null {
  const signature = String.fromCharCode(...bytes.subarray(0, 6));
  if (bytes.length < 13 || !/^GIF8[79]a$/.test(signature)) return null;
  const data = view(bytes);
  const globalTable = bytes[10] & 0x80 ? 3 * 2 ** ((bytes[10] & 7) + 1) : 0;
  let offset = 13 + globalTable;
  const kept: Uint8Array[] = [bytes.subarray(0, offset)];
  let length = offset;
  let frames = 0;
  let framePixels = 0;

  while (offset < bytes.length) {
    const start = offset;
    const block = bytes[offset];
    if (block === 0x3b) {
      kept.push(bytes.subarray(offset, offset + 1));
      length += 1;
      return frames > 0
        ? { bytes: join(kept, length), frames, framePixels }
        : null;
    }
    let keep = true;
    if (block === 0x21) {
      const label = bytes[offset + 1];
      if (label === 0xfe) keep = false; // comment
      if (label === 0xff) {
        const id = String.fromCharCode(
          ...bytes.subarray(offset + 3, offset + 14),
        );
        keep = bytes[offset + 2] === 11 && GIF_KEEP_APPLICATIONS.has(id);
      }
      offset = skipSubBlocks(bytes, offset + 2);
    } else if (block === 0x2c) {
      if (offset + 10 > bytes.length) return null;
      frames += 1;
      framePixels +=
        data.getUint16(offset + 5, true) * data.getUint16(offset + 7, true);
      const packed = bytes[offset + 9];
      const localTable = packed & 0x80 ? 3 * 2 ** ((packed & 7) + 1) : 0;
      // Then the LZW minimum code size, then the image data sub-blocks.
      offset = skipSubBlocks(bytes, offset + 10 + localTable + 1);
    } else {
      return null;
    }
    if (offset < 0 || offset > bytes.length) return null;
    if (keep) {
      kept.push(bytes.subarray(start, offset));
      length += offset - start;
    }
  }
  return null; // no trailer
}
