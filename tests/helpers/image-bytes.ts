/**
 * Image byte fixtures built in code (no binary files are committed).
 *
 * Runtime-neutral on purpose: the unit tests (Bun) and the Playwright spec
 * (Node, then passed into the page) both import it, so it uses no `node:`,
 * `bun:` or DOM APIs.
 */

export function ascii(text: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

export function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function be32(value: number): Uint8Array {
  return new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

function le32(value: number): Uint8Array {
  return new Uint8Array([
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** One PNG chunk: length, type, data and a real CRC32 over type + data. */
export function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeAndData = concat(ascii(type), data);
  return concat(be32(data.length), typeAndData, be32(crc32(typeAndData)));
}

const PNG_SIGNATURE = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/** zlib stream holding `raw` in one stored (uncompressed) deflate block. */
function zlibStored(raw: Uint8Array): Uint8Array {
  const len = raw.length;
  return concat(
    new Uint8Array([0x78, 0x01, 0x01, len & 0xff, len >> 8]),
    new Uint8Array([~len & 0xff, (~len >> 8) & 0xff]),
    raw,
    be32(adler32(raw)),
  );
}

/**
 * A valid 2×1 RGBA PNG (left pixel red, right pixel blue): IHDR, one
 * zlib-stored IDAT and IEND, with `extra` chunks inserted before IDAT.
 */
export function buildPng(extra: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const ihdr = concat(
    be32(2),
    be32(1),
    new Uint8Array([8, 6, 0, 0, 0]), // 8-bit RGBA, no interlace
  );
  // One scanline: filter byte 0, then red and blue, fully opaque.
  const scanline = new Uint8Array([0, 255, 0, 0, 255, 0, 0, 255, 255]);
  return concat(
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    ...extra,
    pngChunk("IDAT", zlibStored(scanline)),
    pngChunk("IEND", new Uint8Array()),
  );
}

interface IfdEntry {
  tag: number;
  type: number;
  count: number;
  /** Four inline value bytes, or the data to place after the IFDs. */
  value: Uint8Array;
}

function rational(value: number, denominator: number): Uint8Array {
  return concat(le32(Math.round(value * denominator)), le32(denominator));
}

/** Degrees, minutes and seconds as three little-endian RATIONALs. */
function dms(decimal: number): Uint8Array {
  const abs = Math.abs(decimal);
  const degrees = Math.floor(abs);
  const minutesFloat = (abs - degrees) * 60;
  const minutes = Math.floor(minutesFloat);
  const seconds = (minutesFloat - minutes) * 60;
  return concat(
    rational(degrees, 1),
    rational(minutes, 1),
    rational(seconds, 100),
  );
}

function short(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, value >> 8, 0, 0]);
}

/**
 * Writes IFDs (little-endian) starting at `start` in the TIFF, placing values
 * longer than four bytes after the entries. Returns the IFD bytes.
 */
function writeIfd(entries: IfdEntry[], start: number): Uint8Array {
  const tableSize = 2 + entries.length * 12 + 4;
  let dataOffset = start + tableSize;
  const table: Uint8Array[] = [
    new Uint8Array([entries.length & 0xff, entries.length >> 8]),
  ];
  const data: Uint8Array[] = [];
  for (const entry of entries) {
    let value = entry.value;
    if (value.length > 4) {
      data.push(value);
      value = le32(dataOffset);
      dataOffset += entry.value.length;
    }
    table.push(
      new Uint8Array([entry.tag & 0xff, entry.tag >> 8]),
      new Uint8Array([entry.type & 0xff, entry.type >> 8]),
      le32(entry.count),
      concat(value, new Uint8Array(4 - value.length)),
    );
  }
  table.push(le32(0)); // no next IFD
  return concat(...table, ...data);
}

const TIFF_SHORT = 3;
const TIFF_LONG = 4;
const TIFF_ASCII = 2;
const TIFF_RATIONAL = 5;

/**
 * An Exif APP1 payload: `Exif\0\0` + a little-endian TIFF whose IFD0 holds
 * Orientation (0x0112) and a GPSInfo pointer (0x8825), and a GPS IFD with
 * tags 0x0001–0x0004. `.subarray(6)` is the bare TIFF used by PNG `eXIf` and
 * WebP `EXIF` chunks.
 */
export function buildExifApp1(opts: {
  orientation?: number;
  gps?: { lat: number; lon: number };
}): Uint8Array<ArrayBuffer> {
  const ifd0: IfdEntry[] = [];
  if (opts.orientation !== undefined) {
    ifd0.push({
      tag: 0x0112,
      type: TIFF_SHORT,
      count: 1,
      value: short(opts.orientation),
    });
  }
  const ifd0Size = 2 + (ifd0.length + (opts.gps ? 1 : 0)) * 12 + 4;
  const gpsStart = 8 + ifd0Size;
  if (opts.gps) {
    ifd0.push({
      tag: 0x8825,
      type: TIFF_LONG,
      count: 1,
      value: le32(gpsStart),
    });
  }
  const parts: Uint8Array[] = [
    ascii("Exif\0\0"),
    ascii("II*\0"),
    le32(8),
    writeIfd(ifd0, 8),
  ];
  if (opts.gps) {
    const { lat, lon } = opts.gps;
    parts.push(
      writeIfd(
        [
          {
            tag: 1,
            type: TIFF_ASCII,
            count: 2,
            value: ascii(lat < 0 ? "S\0" : "N\0"),
          },
          { tag: 2, type: TIFF_RATIONAL, count: 3, value: dms(lat) },
          {
            tag: 3,
            type: TIFF_ASCII,
            count: 2,
            value: ascii(lon < 0 ? "W\0" : "E\0"),
          },
          { tag: 4, type: TIFF_RATIONAL, count: 3, value: dms(lon) },
        ],
        gpsStart,
      ),
    );
  }
  return concat(...parts);
}

function riffChunk(fourcc: string, data: Uint8Array): Uint8Array {
  const pad = data.length & 1 ? new Uint8Array(1) : new Uint8Array();
  return concat(ascii(fourcc), le32(data.length), data, pad);
}

/** Payload of a 1×1 lossless (VP8L) WebP. */
const VP8L_1X1 = new Uint8Array([
  0x2f, 0x00, 0x00, 0x00, 0x10, 0x07, 0x10, 0x11, 0x11, 0x88, 0x88, 0xfe, 0x07,
]);

/**
 * An extended WebP: VP8X + a 1×1 lossless `VP8L`, then optional `EXIF` (a
 * TIFF with a GPS IFD, and Orientation when given) and `XMP ` chunks, with
 * the matching VP8X flags set.
 */
export function buildWebp(opts: {
  exif?: boolean;
  orientation?: number;
  xmp?: boolean;
}): Uint8Array<ArrayBuffer> {
  const flags = (opts.exif ? 0x08 : 0) | (opts.xmp ? 0x04 : 0);
  // Flags, 3 reserved bytes, then canvas width - 1 and height - 1 (24-bit LE).
  const vp8x = new Uint8Array([flags, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const chunks = [riffChunk("VP8X", vp8x), riffChunk("VP8L", VP8L_1X1)];
  if (opts.exif) {
    const tiff = buildExifApp1({
      orientation: opts.orientation,
      gps: { lat: 52.37, lon: 4.89 },
    }).subarray(6);
    chunks.push(riffChunk("EXIF", tiff));
  }
  if (opts.xmp) {
    chunks.push(
      riffChunk("XMP ", ascii('<x:xmpmeta xmlns:x="adobe:ns:meta/"/>')),
    );
  }
  const body = concat(ascii("WEBP"), ...chunks);
  return concat(ascii("RIFF"), le32(body.length), body);
}

/**
 * A 2×2 GIF89a with a NETSCAPE2.0 loop extension and two 1×1 frames (red at
 * (0,0), then blue at (1,1)).
 *
 *   47 49 46 38 39 61            "GIF89a"
 *   02 00 02 00 80 00 00         2×2 screen, 2-colour global table
 *   ff 00 00  00 00 ff           red, blue
 *   21 ff 0b "NETSCAPE2.0" 03 01 00 00 00   loop forever
 *   21 f9 04 04 0a 00 00 00      graphic control: 100 ms, do not dispose
 *   2c 00 00 00 00 01 00 01 00 00   frame 1 at (0,0), 1×1
 *   02 02 44 01 00               LZW: clear, index 0, end
 *   21 f9 04 04 0a 00 00 00
 *   2c 01 00 01 00 01 00 01 00 00   frame 2 at (1,1), 1×1
 *   02 02 4c 01 00               LZW: clear, index 1, end
 *   3b                           trailer
 */
export const GIF_TWO_FRAMES: Uint8Array<ArrayBuffer> = concat(
  ascii("GIF89a"),
  new Uint8Array([0x02, 0x00, 0x02, 0x00, 0x80, 0x00, 0x00]),
  new Uint8Array([0xff, 0x00, 0x00, 0x00, 0x00, 0xff]),
  new Uint8Array([0x21, 0xff, 0x0b]),
  ascii("NETSCAPE2.0"),
  new Uint8Array([0x03, 0x01, 0x00, 0x00, 0x00]),
  new Uint8Array([0x21, 0xf9, 0x04, 0x04, 0x0a, 0x00, 0x00, 0x00]),
  new Uint8Array([0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]),
  new Uint8Array([0x02, 0x02, 0x44, 0x01, 0x00]),
  new Uint8Array([0x21, 0xf9, 0x04, 0x04, 0x0a, 0x00, 0x00, 0x00]),
  new Uint8Array([0x2c, 0x01, 0x00, 0x01, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]),
  new Uint8Array([0x02, 0x02, 0x4c, 0x01, 0x00]),
  new Uint8Array([0x3b]),
);
