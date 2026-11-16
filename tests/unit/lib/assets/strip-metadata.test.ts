import { describe, expect, it } from "bun:test";

import {
  stripImageMetadata,
  stripJpegMetadata,
} from "@/lib/assets/strip-metadata";
import {
  ascii,
  buildExifApp1,
  buildPng,
  buildWebp,
  concat,
  pngChunk,
} from "@/tests/helpers/image-bytes";

function readBe32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset).getUint32(offset);
}

function readLe32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset).getUint32(offset, true);
}

function fourcc(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + 4));
}

function chunkTypes(png: Uint8Array): string[] {
  const types: string[] = [];
  for (let offset = 8; offset < png.length; ) {
    types.push(fourcc(png, offset + 4));
    offset += 12 + readBe32(png, offset);
  }
  return types;
}

function riffChunkList(webp: Uint8Array): Array<[string, Uint8Array]> {
  const chunks: Array<[string, Uint8Array]> = [];
  for (let offset = 12; offset < webp.length; ) {
    const size = readLe32(webp, offset + 4);
    chunks.push([
      fourcc(webp, offset),
      webp.subarray(offset + 8, offset + 8 + size),
    ]);
    offset += 8 + size + (size & 1);
  }
  return chunks;
}

const riffChunks = (webp: Uint8Array) => riffChunkList(webp).map(([id]) => id);
const riffChunk = (webp: Uint8Array, id: string) =>
  riffChunkList(webp).find(([name]) => name === id)?.[1];

const gpsExif = buildExifApp1({ gps: { lat: 52.37, lon: 4.89 } });
const app1 = concat(
  new Uint8Array([
    0xff,
    0xe1,
    (gpsExif.length + 2) >> 8,
    (gpsExif.length + 2) & 0xff,
  ]),
  gpsExif,
);
const jpegBytesWithExif = concat(
  new Uint8Array([0xff, 0xd8]),
  app1,
  new Uint8Array([0xff, 0xd9]),
);

describe("stripImageMetadata: PNG", () => {
  it("drops eXIf, tEXt and tIME and keeps the image chunks byte for byte", () => {
    const exif = pngChunk("eXIf", gpsExif.subarray(6));
    const text = pngChunk("tEXt", ascii("Comment\0secret"));
    const out = stripImageMetadata(
      buildPng([exif, text, pngChunk("tIME", new Uint8Array(7))]),
      "image/png",
    );
    expect(out).toEqual(buildPng([]));
    expect(chunkTypes(out as Uint8Array)).toEqual(["IHDR", "IDAT", "IEND"]);
  });

  it("keeps allowlisted chunks such as the colour profile and drops unknown ones", () => {
    const icc = pngChunk("iCCP", concat(ascii("p\0\0"), new Uint8Array(4)));
    const out = stripImageMetadata(
      buildPng([icc, pngChunk("prVt", ascii("x"))]),
      "image/png",
    );
    expect(chunkTypes(out as Uint8Array)).toEqual([
      "IHDR",
      "iCCP",
      "IDAT",
      "IEND",
    ]);
  });

  it("orientation 6 returns null, so the image is re-encoded upright", () => {
    const rotated = pngChunk(
      "eXIf",
      buildExifApp1({ orientation: 6 }).subarray(6),
    );
    expect(stripImageMetadata(buildPng([rotated]), "image/png")).toBeNull();
  });

  it("keeps a PNG whose eXIf orientation is 1 and strips the chunk", () => {
    const upright = pngChunk(
      "eXIf",
      buildExifApp1({ orientation: 1 }).subarray(6),
    );
    expect(stripImageMetadata(buildPng([upright]), "image/png")).toEqual(
      buildPng([]),
    );
  });

  it("returns null for an eXIf chunk it cannot parse", () => {
    const junk = pngChunk("eXIf", ascii("not a tiff"));
    expect(stripImageMetadata(buildPng([junk]), "image/png")).toBeNull();
  });

  it("drops trailing bytes after IEND", () => {
    expect(
      stripImageMetadata(concat(buildPng([]), ascii("GPS 52.37")), "image/png"),
    ).toEqual(buildPng([]));
  });

  it("returns null when a chunk overruns the buffer", () => {
    expect(
      stripImageMetadata(buildPng([]).subarray(0, 40), "image/png"),
    ).toBeNull();
  });

  it("returns null without IEND", () => {
    const png = buildPng([]);
    expect(
      stripImageMetadata(png.subarray(0, png.length - 12), "image/png"),
    ).toBeNull();
  });

  it("returns null when declared PNG bytes are JPEG", () => {
    expect(stripImageMetadata(jpegBytesWithExif, "image/png")).toBeNull();
  });
});

describe("stripImageMetadata: WebP", () => {
  it("drops EXIF and XMP, clears their VP8X flags and rewrites the RIFF size", () => {
    const w = stripImageMetadata(
      buildWebp({ exif: true, xmp: true }),
      "image/webp",
    );
    if (!w) throw new Error("expected a stripped WebP");
    expect(riffChunks(w)).toEqual(["VP8X", "VP8L"]);
    expect(w[20] & 0x0c).toBe(0);
    expect(readLe32(w, 4)).toBe(w.length - 8);
    expect(riffChunk(w, "VP8L")).toEqual(riffChunk(buildWebp({}), "VP8L"));
    expect(w).toEqual(buildWebp({}));
  });

  it("returns null when the EXIF orientation is not 1", () => {
    expect(
      stripImageMetadata(
        buildWebp({ exif: true, orientation: 6 }),
        "image/webp",
      ),
    ).toBeNull();
  });

  it("accepts an EXIF chunk that keeps the Exif\\0\\0 prefix", () => {
    const webp = buildWebp({});
    const exif = buildExifApp1({ orientation: 1 });
    const chunk = concat(
      ascii("EXIF"),
      new Uint8Array([exif.length, 0, 0, 0]),
      exif,
    );
    const body = concat(webp.subarray(8), chunk);
    const input = concat(
      ascii("RIFF"),
      new Uint8Array([body.length, 0, 0, 0]),
      body,
    );
    expect(stripImageMetadata(input, "image/webp")).toEqual(webp);
  });

  it("drops bytes past the declared RIFF size", () => {
    expect(
      stripImageMetadata(
        concat(buildWebp({}), ascii("GPS 52.37")),
        "image/webp",
      ),
    ).toEqual(buildWebp({}));
  });

  it("returns null for a bad header or a chunk that overruns", () => {
    expect(
      stripImageMetadata(ascii("RIFF\x10\0\0\0WEBPVP8X"), "image/webp"),
    ).toBeNull();
    const webp = buildWebp({});
    expect(
      stripImageMetadata(webp.subarray(0, webp.length - 4), "image/webp"),
    ).toBeNull();
    expect(stripImageMetadata(buildPng([]), "image/webp")).toBeNull();
  });
});

/** One JPEG marker segment: FF, marker, big-endian length, payload. */
function segment(marker: number, payload: Uint8Array): Uint8Array {
  const length = payload.length + 2;
  return concat(
    new Uint8Array([0xff, marker, length >> 8, length & 0xff]),
    payload,
  );
}

const SOI = new Uint8Array([0xff, 0xd8]);
const EOI = new Uint8Array([0xff, 0xd9]);
const APP0 = segment(0xe0, ascii("JFIF\x00\x01\x01\x00\x00H\x00H\x00\x00"));
const DQT = segment(0xdb, new Uint8Array(65));
const SOF0 = segment(0xc0, new Uint8Array([8, 0, 1, 0, 1, 1, 1, 0x11, 0]));
const DHT = segment(0xc4, new Uint8Array(29));
const APP14 = segment(0xee, ascii("Adobe\x00\x64\x00\x00\x00\x00\x01"));
// SOS header, then entropy-coded data with a stuffed FF 00 and a restart marker.
const SCAN = concat(
  segment(0xda, new Uint8Array([1, 1, 0, 0, 0x3f, 0])),
  new Uint8Array([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56]),
);
const CLEAN_JPEG = concat(SOI, APP0, APP14, DQT, SOF0, DHT, SCAN, EOI);

describe("stripJpegMetadata (encoder output)", () => {
  it("drops Exif, Photoshop, XMP and comment segments and keeps the image", () => {
    const encoderExif = segment(0xe1, buildExifApp1({}));
    const photoshop = segment(0xed, ascii("Photoshop 3.0\x008BIM"));
    const xmp = segment(0xe1, ascii("http://ns.adobe.com/xap/1.0/\x00<x/>"));
    const comment = segment(0xfe, ascii("made by an encoder"));
    const input = concat(
      SOI,
      APP0,
      encoderExif,
      photoshop,
      APP14,
      xmp,
      comment,
      DQT,
      SOF0,
      DHT,
      SCAN,
      EOI,
    );
    expect(stripJpegMetadata(input)).toEqual(CLEAN_JPEG);
  });

  it("keeps an ICC profile segment (APP2)", () => {
    const icc = segment(0xe2, ascii("ICC_PROFILE\x00\x01\x01"));
    const input = concat(SOI, APP0, icc, DQT, SOF0, DHT, SCAN, EOI);
    expect(stripJpegMetadata(input)).toEqual(input);
  });

  it("drops bytes after EOI", () => {
    expect(stripJpegMetadata(concat(CLEAN_JPEG, ascii("GPS 52.37")))).toEqual(
      CLEAN_JPEG,
    );
  });

  it("returns null for bytes that are not a complete JPEG", () => {
    expect(stripJpegMetadata(buildPng([]))).toBeNull();
    expect(stripJpegMetadata(CLEAN_JPEG.subarray(0, 20))).toBeNull();
    expect(
      stripJpegMetadata(CLEAN_JPEG.subarray(0, CLEAN_JPEG.length - 2)),
    ).toBeNull();
  });
});
