import { describe, expect, it } from "bun:test";

import { formatAssetRef } from "@/lib/assets/asset-ref";
import type { ImageEncodeFn } from "@/lib/assets/encode-client";
import { sha256Hex } from "@/lib/assets/hash";
import {
  ASSET_MAX_SIDE,
  MAX_ASSET_BYTES,
  MAX_ASSET_INPUT_BYTES,
} from "@/lib/assets/limits";
import {
  planImageAsset,
  prepareImageAsset,
  putImageAsset,
} from "@/lib/assets/prepare-image-asset";
import { MemoryBlobStore } from "@/lib/platform/memory-blob-store";
import {
  ascii,
  buildExifApp1,
  buildPng,
  buildWebp,
  concat,
  GIF_TWO_FRAMES,
  pngChunk,
} from "@/tests/helpers/image-bytes";

const MB = 1024 * 1024;

const file = (bytes: Uint8Array, type: string, name = "image") =>
  new File([bytes as Uint8Array<ArrayBuffer>], name, { type });

/** A minimal baseline JPEG: SOI, an Exif APP1 with GPS, SOF0 16×8, SOS, EOI. */
function jpegWithGps(): Uint8Array<ArrayBuffer> {
  const app1 = buildExifApp1({
    orientation: 6,
    gps: { lat: 52.37, lon: 4.89 },
  });
  const len = app1.length + 2;
  return concat(
    new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 0xff]),
    app1,
    new Uint8Array([
      0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x08, 0x00, 0x10, 0x01, 0x01, 0x11,
      0x00,
    ]),
    new Uint8Array([
      0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
    ]),
    new Uint8Array([0x12, 0x34, 0xff, 0xd9]),
  );
}

/** An encoder that records its input and returns `output`. */
function fakeEncoder(output: Uint8Array, type: string) {
  const calls: { blob: Blob; maxBytes: number; maxSide: number }[] = [];
  const encode: ImageEncodeFn = async (blob, request) => {
    calls.push({ blob, ...request });
    return {
      ok: true,
      blob: new Blob([output as Uint8Array<ArrayBuffer>], { type }),
      width: 2,
      height: 1,
    };
  };
  return { encode, calls };
}

const neverEncode: ImageEncodeFn = async () => {
  throw new Error("must not re-encode");
};

describe("planImageAsset", () => {
  it("rejects non-images, SVG and oversized input with the spec copy", () => {
    expect(planImageAsset({ type: "text/html", size: 10 })).toMatchObject({
      kind: "reject",
    });
    expect(planImageAsset({ type: "image/svg+xml", size: 10 })).toEqual({
      kind: "reject",
      reason: "SVG images aren't supported. Export it as PNG or JPEG first.",
    });
    expect(
      planImageAsset({ type: "image/png", size: MAX_ASSET_INPUT_BYTES + 1 }),
    ).toEqual({
      kind: "reject",
      reason: "This image is larger than 20 MB. Choose a smaller file.",
    });
  });

  it("passes GIFs up to 2 MB through and rejects larger ones", () => {
    expect(planImageAsset({ type: "image/gif", size: 2 * MB })).toEqual({
      kind: "passthrough",
    });
    expect(planImageAsset({ type: "image/gif", size: 2 * MB + 1 })).toEqual({
      kind: "reject",
      reason: "GIFs must be under 2 MB (animations aren't resized).",
    });
  });

  it("always re-encodes JPEG", () => {
    expect(planImageAsset({ type: "image/jpeg", size: 1000 })).toEqual({
      kind: "reencode",
    });
  });

  it("strips PNG and WebP within the byte cap and re-encodes larger ones", () => {
    expect(planImageAsset({ type: "image/png", size: 2 * MB })).toEqual({
      kind: "strip",
      type: "image/png",
    });
    expect(planImageAsset({ type: "image/webp", size: 1000 })).toEqual({
      kind: "strip",
      type: "image/webp",
    });
    expect(planImageAsset({ type: "image/png", size: 2 * MB + 1 })).toEqual({
      kind: "reencode",
    });
  });

  it("re-encodes other decodable types (HEIC, AVIF, BMP)", () => {
    for (const type of ["image/heic", "image/avif", "image/bmp"]) {
      expect(planImageAsset({ type, size: 1000 })).toEqual({
        kind: "reencode",
      });
    }
  });
});

describe("prepareImageAsset", () => {
  it("strips a PNG's eXIf and text chunks, keeps its pixels, and hashes after stripping", async () => {
    const exif = pngChunk(
      "eXIf",
      buildExifApp1({ gps: { lat: 52.37, lon: 4.89 } }).subarray(6),
    );
    const text = pngChunk("tEXt", ascii("Comment\0secret"));
    const prepared = await prepareImageAsset(
      file(buildPng([exif, text]), "image/png"),
      { encode: neverEncode },
    );
    expect(prepared.bytes).toEqual(buildPng([]));
    expect(prepared.mime).toBe("image/png");
    expect(prepared.hex).toBe(await sha256Hex(buildPng([])));
    expect({ width: prepared.width, height: prepared.height }).toEqual({
      width: 2,
      height: 1,
    });
  });

  it("strips a WebP's EXIF and XMP chunks", async () => {
    const prepared = await prepareImageAsset(
      file(buildWebp({ exif: true, xmp: true }), "image/webp"),
      { encode: neverEncode },
    );
    expect(prepared.bytes).toEqual(
      (
        await prepareImageAsset(file(buildWebp({}), "image/webp"), {
          encode: neverEncode,
        })
      ).bytes,
    );
    const text = new TextDecoder().decode(prepared.bytes);
    expect(text).not.toContain("EXIF");
    expect(text).not.toContain("XMP ");
  });

  it("re-encodes a JPEG with GPS, and strips the encoder's own APP1", async () => {
    // The fake encoder answers with an APP1-carrying JPEG, like Safari's.
    const { encode, calls } = fakeEncoder(jpegWithGps(), "image/jpeg");
    const prepared = await prepareImageAsset(
      file(jpegWithGps(), "image/jpeg"),
      { encode },
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      maxBytes: MAX_ASSET_BYTES,
      maxSide: ASSET_MAX_SIDE,
    });
    expect(prepared.mime).toBe("image/jpeg");
    // No APP1 (FF E1) segment survives, so no GPS.
    const hasApp1 = prepared.bytes.some(
      (byte, i) => byte === 0xff && prepared.bytes[i + 1] === 0xe1,
    );
    expect(hasApp1).toBe(false);
    expect(prepared.hex).toBe(await sha256Hex(prepared.bytes));
  });

  it("re-encodes a PNG wider than 2560 px instead of stripping it", async () => {
    const wide = buildPng([]);
    // IHDR width at offset 16: 3000 px.
    new DataView(wide.buffer).setUint32(16, 3000);
    const { encode, calls } = fakeEncoder(buildPng([]), "image/png");
    await prepareImageAsset(file(wide, "image/png"), { encode });
    expect(calls).toHaveLength(1);
  });

  it("re-encodes a PNG the stripper can't read (truncated)", async () => {
    const { encode, calls } = fakeEncoder(buildPng([]), "image/png");
    const truncated = buildPng([]).subarray(0, 40);
    await prepareImageAsset(file(truncated, "image/png"), { encode });
    expect(calls).toHaveLength(1);
  });

  it("passes a GIF through byte for byte", async () => {
    const prepared = await prepareImageAsset(
      file(GIF_TWO_FRAMES, "image/gif"),
      {
        encode: neverEncode,
      },
    );
    expect(prepared.bytes).toEqual(GIF_TWO_FRAMES);
    expect(prepared.mime).toBe("image/gif");
  });

  it("refuses a GIF bomb before decoding", async () => {
    const bomb = concat(
      ascii("GIF89a"),
      new Uint8Array([0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0x3b]),
    );
    await expect(
      prepareImageAsset(file(bomb, "image/gif"), { encode: neverEncode }),
    ).rejects.toThrow("This image has too many pixels to process.");
  });

  it("re-encodes a file labelled GIF that isn't one", async () => {
    const { encode, calls } = fakeEncoder(buildPng([]), "image/png");
    await prepareImageAsset(file(buildPng([]), "image/gif"), { encode });
    expect(calls).toHaveLength(1);
  });

  it("refuses an SVG renamed .png by its bytes", async () => {
    const { encode } = fakeEncoder(ascii("<svg/>"), "image/png");
    await expect(
      prepareImageAsset(file(ascii("<svg onload=x()/>"), "image/png"), {
        encode,
      }),
    ).rejects.toThrow();
  });

  it("maps encoder failures to the spec copy", async () => {
    const failing =
      (error: "decode" | "pixels" | "shrink"): ImageEncodeFn =>
      async () => ({ ok: false, error });
    const jpeg = file(jpegWithGps(), "image/jpeg");
    await expect(
      prepareImageAsset(jpeg, { encode: failing("shrink") }),
    ).rejects.toThrow(
      "This image can't be made smaller than 2 MB. Try a smaller or simpler image.",
    );
    await expect(
      prepareImageAsset(jpeg, { encode: failing("decode") }),
    ).rejects.toThrow(
      "This image format can't be read here. Try PNG, JPEG, WebP or GIF.",
    );
    await expect(
      prepareImageAsset(jpeg, { encode: failing("pixels") }),
    ).rejects.toThrow("This image has too many pixels to process.");
  });

  it("refuses a stored type whose header size can't be read, before decoding", async () => {
    // A JPEG cut off before its frame header: the size is unknown.
    const truncated = jpegWithGps().subarray(0, 60);
    await expect(
      prepareImageAsset(file(truncated, "image/jpeg"), { encode: neverEncode }),
    ).rejects.toThrow(
      "This image format can't be read here. Try PNG, JPEG, WebP or GIF.",
    );
  });

  it("sends a type it can't size (AVIF, HEIC, BMP) to the worker only", async () => {
    const options: unknown[] = [];
    const encode: ImageEncodeFn = async (_blob, _request, _signal, opts) => {
      options.push(opts);
      return {
        ok: true,
        blob: new Blob([buildPng([])], { type: "image/png" }),
        width: 2,
        height: 1,
      };
    };
    const avif = concat(
      new Uint8Array([0, 0, 0, 0x1c]),
      ascii("ftypavif"),
      new Uint8Array(20),
    );
    await prepareImageAsset(file(avif, "image/avif"), { encode });
    await prepareImageAsset(file(jpegWithGps(), "image/jpeg"), { encode });
    expect(options).toEqual([{ mainThread: false }, { mainThread: true }]);
  });

  it("reports a worker crash on an image as unreadable", async () => {
    const crashed: ImageEncodeFn = async () => ({ ok: false, error: "decode" });
    await expect(
      prepareImageAsset(file(jpegWithGps(), "image/jpeg"), { encode: crashed }),
    ).rejects.toThrow(
      "This image format can't be read here. Try PNG, JPEG, WebP or GIF.",
    );
  });

  it("refuses encoder output that is not a stored type", async () => {
    const { encode } = fakeEncoder(ascii("<html>"), "image/webp");
    await expect(
      prepareImageAsset(file(jpegWithGps(), "image/jpeg"), { encode }),
    ).rejects.toThrow();
  });

  it("stops when cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      prepareImageAsset(file(buildPng([]), "image/png"), {
        encode: neverEncode,
        signal: controller.signal,
      }),
    ).rejects.toThrow("Upload cancelled");
  });
});

describe("putImageAsset", () => {
  it("stores the bytes and returns the ref with the image size", async () => {
    const store = new MemoryBlobStore();
    const prepared = await prepareImageAsset(file(buildPng([]), "image/png"), {
      encode: neverEncode,
    });
    const asset = await putImageAsset(store, "doc-1", prepared);
    expect(asset).toEqual({
      src: formatAssetRef(prepared.hex),
      hex: prepared.hex,
      width: 2,
      height: 1,
    });
    expect(store.rows("doc-1")).toEqual([
      {
        doc_id: "doc-1",
        hash: prepared.hex,
        kind: "provisional",
        dropped_at: null,
      },
    ]);
  });

  it("propagates a store failure, so nothing is inserted", async () => {
    const store = new MemoryBlobStore();
    store.failNext();
    const prepared = await prepareImageAsset(file(buildPng([]), "image/png"), {
      encode: neverEncode,
    });
    await expect(putImageAsset(store, "doc-1", prepared)).rejects.toMatchObject(
      {
        code: "io_error",
      },
    );
  });
});
