/**
 * Magic-byte sniffing and header-only size parsing (image store spec §2.3,
 * §4.2 steps 8–9, OWASP file upload checks). Every stored image passes
 * `checkImageBytes` before it is hashed: on insert here, in each `BlobStore`
 * `put`, and later on the server.
 *
 * Pure: no DOM, no decoding. Only the first few hundred bytes are read, so a
 * decompression bomb is refused before any decoder sees it.
 */
import {
  type AssetMime,
  MAX_ASSET_DIMENSION,
  MAX_ASSET_PIXELS,
} from "@/lib/assets/limits";

export interface ImageSize {
  width: number;
  height: number;
}

export type ImageCheckFailure =
  /** Not one of the four stored types (SVG, HTML, PDF, anything else). */
  | "unsupported"
  /** The magic bytes name another type than the declared one. */
  | "type_mismatch"
  /** The header is incomplete, or declares a zero size. */
  | "truncated"
  /** Over 40 MP, or a side over 16,384 px. */
  | "too_many_pixels";

export type ImageCheck =
  | ({ ok: true; mime: AssetMime } & ImageSize)
  | { ok: false; reason: ImageCheckFailure };

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  if (offset + length > bytes.length) return "";
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  return bytes.length >= magic.length && magic.every((b, i) => bytes[i] === b);
}

/** The stored type the magic bytes name, or `null`. */
export function sniffImageType(bytes: Uint8Array): AssetMime | null {
  if (startsWith(bytes, PNG)) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (/^GIF8[79]a$/.test(ascii(bytes, 0, 6))) return "image/gif";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    return "image/webp";
  }
  return null;
}

function pngSize(bytes: Uint8Array, data: DataView): ImageSize | null {
  if (bytes.length < 24 || ascii(bytes, 12, 4) !== "IHDR") return null;
  return { width: data.getUint32(16), height: data.getUint32(20) };
}

function gifSize(bytes: Uint8Array, data: DataView): ImageSize | null {
  if (bytes.length < 10) return null;
  return { width: data.getUint16(6, true), height: data.getUint16(8, true) };
}

function webpSize(bytes: Uint8Array, data: DataView): ImageSize | null {
  const chunk = ascii(bytes, 12, 4);
  if (chunk === "VP8X" && bytes.length >= 30) {
    const u24 = (at: number) =>
      bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16);
    return { width: u24(24) + 1, height: u24(27) + 1 };
  }
  if (chunk === "VP8 " && bytes.length >= 30) {
    // Frame tag (3 bytes), then the start code 9d 01 2a.
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) {
      return null;
    }
    return {
      width: data.getUint16(26, true) & 0x3fff,
      height: data.getUint16(28, true) & 0x3fff,
    };
  }
  if (chunk === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
    const [b0, b1, b2, b3] = bytes.subarray(21, 25);
    return {
      width: 1 + (((b1 & 0x3f) << 8) | b0),
      height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
    };
  }
  return null;
}

/** SOFn markers that carry a frame size (not DHT C4, JPG C8 or DAC CC). */
function isFrameMarker(marker: number): boolean {
  return (
    marker >= 0xc0 &&
    marker <= 0xcf &&
    marker !== 0xc4 &&
    marker !== 0xc8 &&
    marker !== 0xcc
  );
}

function jpegSize(bytes: Uint8Array, data: DataView): ImageSize | null {
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      offset += 1; // fill byte
      continue;
    }
    // Standalone markers carry no length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) return null; // scan before frame
    const length = data.getUint16(offset + 2);
    if (isFrameMarker(marker)) {
      if (offset + 9 > bytes.length) return null;
      return {
        height: data.getUint16(offset + 5),
        width: data.getUint16(offset + 7),
      };
    }
    offset += 2 + length;
  }
  return null;
}

/**
 * The size the header declares, or `null` when it is not a stored type or
 * the header is incomplete. Never decodes.
 */
export function readImageSize(bytes: Uint8Array): ImageSize | null {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  switch (sniffImageType(bytes)) {
    case "image/png":
      return pngSize(bytes, data);
    case "image/gif":
      return gifSize(bytes, data);
    case "image/webp":
      return webpSize(bytes, data);
    case "image/jpeg":
      return jpegSize(bytes, data);
    default:
      return null;
  }
}

/**
 * Checks bytes before they are stored: a stored type by magic bytes, equal
 * to `declared` when given, with a readable header within the pixel limits.
 */
export function checkImageBytes(
  bytes: Uint8Array,
  declared?: string,
): ImageCheck {
  const mime = sniffImageType(bytes);
  if (!mime) return { ok: false, reason: "unsupported" };
  if (declared !== undefined && declared.toLowerCase() !== mime) {
    return { ok: false, reason: "type_mismatch" };
  }
  const size = readImageSize(bytes);
  if (!size || size.width === 0 || size.height === 0) {
    return { ok: false, reason: "truncated" };
  }
  if (
    size.width > MAX_ASSET_DIMENSION ||
    size.height > MAX_ASSET_DIMENSION ||
    size.width * size.height > MAX_ASSET_PIXELS
  ) {
    return { ok: false, reason: "too_many_pixels" };
  }
  return { ok: true, mime, ...size };
}
