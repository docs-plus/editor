import { describe, expect, it } from "bun:test";

import { MAX_GIF_FRAMES } from "@/lib/assets/limits";
import { prepareImageAsset } from "@/lib/assets/prepare-image-asset";
import { stripGifMetadata } from "@/lib/assets/strip-metadata";
import { ascii, concat, GIF_TWO_FRAMES } from "@/tests/helpers/image-bytes";

/** Header, screen and 2-colour table of `GIF_TWO_FRAMES`: 19 bytes. */
const HEAD = 19;
const COMMENT = concat(
  new Uint8Array([0x21, 0xfe, 0x06]),
  ascii("secret"),
  new Uint8Array([0x00]),
);
const XMP = concat(
  new Uint8Array([0x21, 0xff, 0x0b]),
  ascii("XMP DataXMP"),
  new Uint8Array([0x05]),
  ascii("<x:/>"),
  new Uint8Array([0x00]),
);
/** One 1×1 frame: graphic control, descriptor, LZW data. */
const FRAME = concat(
  new Uint8Array([0x21, 0xf9, 0x04, 0x04, 0x0a, 0x00, 0x00, 0x00]),
  new Uint8Array([0x2c, 0, 0, 0, 0, 0x01, 0x00, 0x01, 0x00, 0x00]),
  new Uint8Array([0x02, 0x02, 0x44, 0x01, 0x00]),
);

const withMetadata = concat(
  GIF_TWO_FRAMES.subarray(0, HEAD),
  COMMENT,
  XMP,
  GIF_TWO_FRAMES.subarray(HEAD),
  ascii("trailing junk"),
);

function gifOfSize(width: number, height: number, frames = 1): Uint8Array {
  const head = GIF_TWO_FRAMES.slice(0, HEAD);
  new DataView(head.buffer).setUint16(6, width, true);
  new DataView(head.buffer).setUint16(8, height, true);
  return concat(
    head,
    ...Array.from({ length: frames }, () => FRAME),
    new Uint8Array([0x3b]),
  );
}

const neverEncode = async () => {
  throw new Error("must not re-encode");
};

describe("stripGifMetadata", () => {
  it("drops comments, XMP and trailing bytes, keeping frames and the loop", () => {
    const stripped = stripGifMetadata(withMetadata);
    expect(stripped?.bytes).toEqual(GIF_TWO_FRAMES);
    expect(stripped?.frames).toBe(2);
    expect(stripped?.framePixels).toBe(2);
  });

  it("returns a clean GIF byte for byte", () => {
    expect(stripGifMetadata(GIF_TWO_FRAMES)?.bytes).toEqual(GIF_TWO_FRAMES);
  });

  it("refuses a GIF without a trailer, a cut-off block or any frame", () => {
    expect(stripGifMetadata(GIF_TWO_FRAMES.subarray(0, -1))).toBeNull();
    expect(stripGifMetadata(GIF_TWO_FRAMES.subarray(0, 40))).toBeNull();
    expect(
      stripGifMetadata(
        concat(GIF_TWO_FRAMES.subarray(0, HEAD), new Uint8Array([0x3b])),
      ),
    ).toBeNull();
    expect(stripGifMetadata(ascii("GIF89a"))).toBeNull();
  });
});

describe("prepareImageAsset: GIF", () => {
  const prepare = (bytes: Uint8Array) =>
    prepareImageAsset(
      new File([bytes as Uint8Array<ArrayBuffer>], "a.gif", {
        type: "image/gif",
      }),
      { encode: neverEncode },
    );

  it("stores the GIF without its comment and XMP", async () => {
    expect((await prepare(withMetadata)).bytes).toEqual(GIF_TWO_FRAMES);
  });

  it("refuses a screen wider or taller than 2560 px", async () => {
    await expect(prepare(gifOfSize(2561, 10))).rejects.toThrow(
      "GIFs must be at most 2560 pixels on each side",
    );
    expect((await prepare(gifOfSize(2560, 10))).width).toBe(2560);
  });

  it("refuses too many frames", async () => {
    await expect(prepare(gifOfSize(2, 2, MAX_GIF_FRAMES + 1))).rejects.toThrow(
      "This GIF has too many frames.",
    );
    expect((await prepare(gifOfSize(2, 2, 3))).height).toBe(2);
  });

  it("refuses frames that add up to too many pixels", async () => {
    // 40 frames that each declare 2560 × 2560: 262 MP of decoding.
    const big = concat(
      GIF_TWO_FRAMES.subarray(0, HEAD),
      ...Array.from({ length: 40 }, () =>
        concat(
          new Uint8Array([0x2c, 0, 0, 0, 0, 0x00, 0x0a, 0x00, 0x0a, 0x00]),
          new Uint8Array([0x02, 0x02, 0x44, 0x01, 0x00]),
        ),
      ),
      new Uint8Array([0x3b]),
    );
    await expect(prepare(big)).rejects.toThrow("This GIF has too many frames.");
  });

  it("refuses a GIF it can't walk", async () => {
    await expect(prepare(GIF_TWO_FRAMES.subarray(0, -1))).rejects.toThrow(
      "This image format can't be read here.",
    );
  });
});
