import { describe, expect, it } from "bun:test";

import { sha256Hex } from "@/lib/assets/hash";
import {
  checkImageBytes,
  readImageSize,
  sniffImageType,
} from "@/lib/assets/sniff";
import {
  ascii,
  buildPng,
  buildWebp,
  concat,
  GIF_TWO_FRAMES,
} from "@/tests/helpers/image-bytes";

const be16 = (n: number) => new Uint8Array([n >> 8, n & 0xff]);
const le16 = (n: number) => new Uint8Array([n & 0xff, n >> 8]);
const le32 = (n: number) =>
  new Uint8Array([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, n >>> 24]);

/** A JPEG header: SOI, JFIF APP0, an SOFn frame of `width`×`height`, SOS, EOI. */
function jpegHeader(width: number, height: number, sof = 0xc0): Uint8Array {
  const app0 = concat(
    new Uint8Array([0xff, 0xe0]),
    be16(16),
    ascii("JFIF\0"),
    new Uint8Array([1, 1, 0, 0, 1, 0, 1, 0, 0]),
  );
  const frame = concat(
    new Uint8Array([0xff, sof]),
    be16(17),
    new Uint8Array([8]),
    be16(height),
    be16(width),
    new Uint8Array([3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]),
  );
  const scan = concat(
    new Uint8Array([0xff, 0xda]),
    be16(12),
    new Uint8Array([3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0]),
    new Uint8Array([0x12, 0x34, 0xff, 0xd9]),
  );
  return concat(
    new Uint8Array([0xff, 0xd8]),
    app0,
    new Uint8Array([0xff]),
    frame,
    scan,
  );
}

function riff(fourcc: string, payload: Uint8Array): Uint8Array {
  const chunk = concat(ascii(fourcc), le32(payload.length), payload);
  const body = concat(ascii("WEBP"), chunk);
  return concat(ascii("RIFF"), le32(body.length), body);
}

/** A lossy (VP8) WebP header of `width`×`height`. */
function webpLossy(width: number, height: number): Uint8Array {
  return riff(
    "VP8 ",
    concat(
      new Uint8Array([0x30, 0x01, 0x00, 0x9d, 0x01, 0x2a]),
      le16(width),
      le16(height),
      new Uint8Array(8),
    ),
  );
}

/** A lossless (VP8L) WebP header of `width`×`height`. */
function webpLossless(width: number, height: number): Uint8Array {
  const w = width - 1;
  const h = height - 1;
  return riff(
    "VP8L",
    new Uint8Array([
      0x2f,
      w & 0xff,
      ((w >> 8) & 0x3f) | ((h & 0x3) << 6),
      (h >> 2) & 0xff,
      (h >> 10) & 0xf,
      0,
      0,
    ]),
  );
}

function gif(width: number, height: number): Uint8Array {
  return concat(
    ascii("GIF89a"),
    le16(width),
    le16(height),
    new Uint8Array([0, 0, 0, 0x3b]),
  );
}

describe("sniffImageType", () => {
  it("names each stored type from its magic bytes", () => {
    expect(sniffImageType(buildPng([]))).toBe("image/png");
    expect(sniffImageType(jpegHeader(4, 3))).toBe("image/jpeg");
    expect(sniffImageType(buildWebp({}))).toBe("image/webp");
    expect(sniffImageType(GIF_TWO_FRAMES)).toBe("image/gif");
  });

  it("names nothing else", () => {
    expect(
      sniffImageType(ascii('<svg xmlns="http://www.w3.org/2000/svg"/>')),
    ).toBeNull();
    expect(sniffImageType(ascii("<!doctype html><p>hi</p>"))).toBeNull();
    expect(sniffImageType(ascii("RIFF\0\0\0\0WAVEfmt "))).toBeNull();
    expect(sniffImageType(new Uint8Array([0x89, 0x50]))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });
});

describe("readImageSize (header only)", () => {
  it("reads PNG IHDR, GIF screen, JPEG SOF and every WebP header", () => {
    expect(readImageSize(buildPng([]))).toEqual({ width: 2, height: 1 });
    expect(readImageSize(GIF_TWO_FRAMES)).toEqual({ width: 2, height: 2 });
    expect(readImageSize(jpegHeader(640, 480))).toEqual({
      width: 640,
      height: 480,
    });
    expect(readImageSize(jpegHeader(300, 200, 0xc2))).toEqual({
      width: 300,
      height: 200,
    });
    expect(readImageSize(webpLossy(800, 600))).toEqual({
      width: 800,
      height: 600,
    });
    expect(readImageSize(webpLossless(1234, 5678))).toEqual({
      width: 1234,
      height: 5678,
    });
    expect(readImageSize(buildWebp({ exif: true }))).toEqual({
      width: 1,
      height: 1,
    });
  });

  it("returns null for a truncated header", () => {
    expect(readImageSize(buildPng([]).subarray(0, 20))).toBeNull();
    expect(readImageSize(jpegHeader(4, 3).subarray(0, 24))).toBeNull();
    expect(readImageSize(webpLossy(8, 8).subarray(0, 26))).toBeNull();
    expect(readImageSize(GIF_TWO_FRAMES.subarray(0, 8))).toBeNull();
  });
});

describe("checkImageBytes", () => {
  it("accepts each type with its declared type", () => {
    expect(checkImageBytes(buildPng([]), "image/png")).toEqual({
      ok: true,
      mime: "image/png",
      width: 2,
      height: 1,
    });
    expect(checkImageBytes(jpegHeader(10, 20), "image/jpeg").ok).toBe(true);
    expect(checkImageBytes(webpLossy(10, 20), "image/webp").ok).toBe(true);
    expect(checkImageBytes(GIF_TWO_FRAMES, "image/gif").ok).toBe(true);
  });

  it("refuses an SVG named .png", () => {
    const svg = ascii(
      '<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>',
    );
    expect(checkImageBytes(svg, "image/png")).toEqual({
      ok: false,
      reason: "unsupported",
    });
  });

  it("refuses an HTML/PNG polyglot whose declared type does not match", () => {
    const polyglot = concat(buildPng([]), ascii("<html><script>x()</script>"));
    expect(checkImageBytes(polyglot, "text/html")).toEqual({
      ok: false,
      reason: "type_mismatch",
    });
    expect(checkImageBytes(polyglot, "image/jpeg")).toEqual({
      ok: false,
      reason: "type_mismatch",
    });
    const htmlFirst = concat(ascii("<html>"), buildPng([]));
    expect(checkImageBytes(htmlFirst, "image/png")).toEqual({
      ok: false,
      reason: "unsupported",
    });
  });

  it("refuses a truncated header", () => {
    expect(checkImageBytes(buildPng([]).subarray(0, 16), "image/png")).toEqual({
      ok: false,
      reason: "truncated",
    });
  });

  it("refuses a GIF bomb (huge logical screen) and oversized sides", () => {
    expect(checkImageBytes(gif(65_535, 65_535), "image/gif")).toEqual({
      ok: false,
      reason: "too_many_pixels",
    });
    // 7000 × 7000 = 49 MP, over the 40 MP ceiling.
    expect(checkImageBytes(webpLossy(7000, 7000), "image/webp").ok).toBe(false);
    // Under 40 MP, but one side over 16,384.
    expect(checkImageBytes(gif(20_000, 10), "image/gif")).toEqual({
      ok: false,
      reason: "too_many_pixels",
    });
    expect(checkImageBytes(gif(0, 10), "image/gif")).toEqual({
      ok: false,
      reason: "truncated",
    });
  });

  it("trusts only the magic bytes when no type is declared", () => {
    expect(checkImageBytes(GIF_TWO_FRAMES).ok).toBe(true);
  });
});

describe("sha256Hex", () => {
  it("hashes to 64 lowercase hex", async () => {
    expect(await sha256Hex(ascii("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(await sha256Hex(new Uint8Array())).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("hashes only the view, not the whole buffer", async () => {
    const buffer = ascii("xxabcxx");
    expect(await sha256Hex(buffer.subarray(2, 5))).toBe(
      await sha256Hex(ascii("abc")),
    );
  });
});
