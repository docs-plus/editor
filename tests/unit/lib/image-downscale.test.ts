import { describe, expect, it, vi } from "vitest";

import { handleImageUpload } from "@/components/tiptap-node/image-upload-node/upload-utils";
import {
  DEFAULT_MAX_EMBED_IMAGE_BYTES,
  dataUrlLength,
  EMBED_IMAGE_MAX_SIDE,
  type EncodeAttempt,
  type EncodedImage,
  encodeAttempts,
  encodeUnderCap,
  fitWithin,
  parseMaxEmbedImageBytes,
  planImageEmbed,
  prepareImageForEmbed,
} from "@/lib/image-downscale";

const KB = 1024;

describe("parseMaxEmbedImageBytes", () => {
  it.each([
    [undefined, DEFAULT_MAX_EMBED_IMAGE_BYTES],
    ["", DEFAULT_MAX_EMBED_IMAGE_BYTES],
    ["   ", DEFAULT_MAX_EMBED_IMAGE_BYTES],
    ["abc", DEFAULT_MAX_EMBED_IMAGE_BYTES],
    ["12kb", DEFAULT_MAX_EMBED_IMAGE_BYTES],
    ["-5", DEFAULT_MAX_EMBED_IMAGE_BYTES],
    ["1.5", DEFAULT_MAX_EMBED_IMAGE_BYTES],
    ["1e6", DEFAULT_MAX_EMBED_IMAGE_BYTES],
    ["99999999999999999999", DEFAULT_MAX_EMBED_IMAGE_BYTES],
    ["131072", 131_072],
    [" 200000 ", 200_000],
    ["0", 16 * KB],
    ["100", 16 * KB],
    ["5000000", 1024 * KB],
  ])("parses %j as %d", (raw, expected) => {
    expect(parseMaxEmbedImageBytes(raw)).toBe(expected);
  });
});

describe("dataUrlLength", () => {
  it.each([0, 1, 2, 3, 4, 100, 1000])(
    "matches a real data URL for %d bytes",
    (bytes) => {
      const payload = btoa("x".repeat(bytes));
      const real = `data:image/webp;base64,${payload}`;
      expect(dataUrlLength("image/webp", bytes)).toBe(real.length);
    },
  );
});

describe("fitWithin", () => {
  it("preserves aspect ratio while capping the longest side", () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 });
  });

  it("never upscales", () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });

  it("keeps at least one pixel per side", () => {
    expect(fitWithin(10_000, 1, 1600)).toEqual({ width: 1600, height: 1 });
  });
});

describe("encodeAttempts", () => {
  it("starts at the max side, then steps quality and size down", () => {
    const attempts = [...encodeAttempts(4000, 2000)];
    expect(attempts[0]).toEqual({ width: 1600, height: 800, quality: 0.85 });
    expect(attempts[1].quality).toBeLessThan(attempts[0].quality);
    expect(attempts[3].width).toBeLessThan(attempts[0].width);
    const last = attempts.at(-1) as EncodeAttempt;
    expect(Math.max(last.width, last.height)).toBe(320);
  });

  it("is bounded and never grows", () => {
    const attempts = [...encodeAttempts(20_000, 20_000)];
    expect(attempts.length).toBeLessThanOrEqual(30);
    for (let i = 1; i < attempts.length; i++) {
      expect(attempts[i].width).toBeLessThanOrEqual(attempts[i - 1].width);
    }
    expect(
      attempts.every(
        (a) => Math.max(a.width, a.height) <= EMBED_IMAGE_MAX_SIDE,
      ),
    ).toBe(true);
  });

  it("only varies quality for images already below the minimum side", () => {
    const attempts = [...encodeAttempts(200, 100)];
    expect(attempts).toHaveLength(3);
    expect(attempts.every((a) => a.width === 200 && a.height === 100)).toBe(
      true,
    );
  });
});

describe("planImageEmbed", () => {
  const cap = 256 * KB;

  it("rejects non-images and SVG", () => {
    expect(planImageEmbed({ type: "text/html", size: 10 }, cap).kind).toBe(
      "reject",
    );
    expect(planImageEmbed({ type: "image/svg+xml", size: 10 }, cap).kind).toBe(
      "reject",
    );
    expect(planImageEmbed({ type: "IMAGE/SVG+XML", size: 10 }, cap).kind).toBe(
      "reject",
    );
  });

  it("passes small GIFs through and rejects large ones", () => {
    expect(planImageEmbed({ type: "image/gif", size: 10 * KB }, cap)).toEqual({
      kind: "passthrough",
    });
    const large = planImageEmbed({ type: "image/gif", size: 300 * KB }, cap);
    expect(large.kind).toBe("reject");
    expect(large.kind === "reject" && large.reason).toMatch(/256 KB/);
  });

  it("passes common formats through only when the data URL fits", () => {
    expect(
      planImageEmbed({ type: "image/png", size: 100 * KB }, cap).kind,
    ).toBe("passthrough");
    // 192 KB raw → ~256 KB base64 + prefix: just over the cap.
    expect(
      planImageEmbed({ type: "image/jpeg", size: 192 * KB }, cap).kind,
    ).toBe("reencode");
    expect(
      planImageEmbed({ type: "image/jpeg", size: 4 * KB * KB }, cap).kind,
    ).toBe("reencode");
  });

  it("always re-encodes formats outside the passthrough list", () => {
    expect(planImageEmbed({ type: "image/bmp", size: 1 * KB }, cap).kind).toBe(
      "reencode",
    );
  });
});

function mockEncoder(sizes: number[]) {
  let call = 0;
  return {
    width: 4000,
    height: 3000,
    encode: vi.fn(
      async (_attempt: EncodeAttempt): Promise<EncodedImage | null> => ({
        type: "image/webp",
        size: sizes[Math.min(call++, sizes.length - 1)],
      }),
    ),
  };
}

describe("encodeUnderCap", () => {
  it("returns the first attempt whose data URL fits", async () => {
    const encoder = mockEncoder([900 * KB, 400 * KB, 150 * KB, 10 * KB]);
    const result = await encodeUnderCap(encoder, 256 * KB);
    expect(result?.size).toBe(150 * KB);
    expect(encoder.encode).toHaveBeenCalledTimes(3);
    expect(encoder.encode.mock.calls[0][0]).toEqual({
      width: 1600,
      height: 1200,
      quality: 0.85,
    });
  });

  it("measures the base64 data URL, not the raw byte size", async () => {
    // 200 KB raw is ~267 KB as base64: over a 256 KB cap.
    const encoder = mockEncoder([200 * KB, 100 * KB]);
    const result = await encodeUnderCap(encoder, 256 * KB);
    expect(result?.size).toBe(100 * KB);
  });

  it("returns null when no attempt fits", async () => {
    const encoder = mockEncoder([2 * KB * KB]);
    expect(await encodeUnderCap(encoder, 256 * KB)).toBeNull();
    expect(encoder.encode.mock.calls.length).toBe(
      [...encodeAttempts(4000, 3000)].length,
    );
  });

  it("skips attempts the encoder could not produce", async () => {
    let call = 0;
    const encoder = {
      width: 100,
      height: 100,
      encode: async () =>
        call++ === 0 ? null : { type: "image/jpeg", size: 1 * KB },
    };
    expect((await encodeUnderCap(encoder, 256 * KB))?.size).toBe(1 * KB);
  });

  it("stops when the upload is cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const encoder = mockEncoder([10 * KB]);
    await expect(
      encodeUnderCap(encoder, 256 * KB, controller.signal),
    ).rejects.toThrow("Upload cancelled");
    expect(encoder.encode).not.toHaveBeenCalled();
  });
});

describe("prepareImageForEmbed / handleImageUpload", () => {
  const png = (bytes: number) =>
    new File([new Uint8Array(bytes)], "a.png", { type: "image/png" });

  it("embeds a small image unchanged", async () => {
    const src = await prepareImageForEmbed(png(32));
    expect(src).toMatch(/^data:image\/png;base64,/);
    expect(src.length).toBe(dataUrlLength("image/png", 32));
  });

  it("rejects SVG with a user-facing message", async () => {
    const svg = new File(["<svg/>"], "a.svg", { type: "image/svg+xml" });
    await expect(handleImageUpload(svg)).rejects.toThrow(/SVG/);
  });

  it("rejects GIFs over the cap instead of flattening them", async () => {
    const gif = new File([new Uint8Array(300 * KB)], "a.gif", {
      type: "image/gif",
    });
    await expect(prepareImageForEmbed(gif)).rejects.toThrow(/GIF/);
  });

  it("still rejects files over the input size limit", async () => {
    await expect(handleImageUpload(png(6 * KB * KB))).rejects.toThrow(
      /exceeds maximum/,
    );
  });

  it("reports completion progress", async () => {
    const onProgress = vi.fn();
    await handleImageUpload(png(32), onProgress);
    expect(onProgress).toHaveBeenLastCalledWith({ progress: 100 });
  });
});
