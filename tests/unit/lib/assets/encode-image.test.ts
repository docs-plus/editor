import { describe, expect, it } from "bun:test";

import {
  type EncodeDeps,
  encodeImageUnderCap,
  encodeUnderByteCap,
} from "@/lib/assets/encode-image";

const KB = 1024;

type Call = { op: string; args: unknown[] };

/**
 * A fake `createImageBitmap` + canvas whose output size is
 * `width * height * quality * bytesPerPixel`, of the requested type unless
 * the type is WebP and `webp` is false (then PNG, like Safari).
 */
function fakeDeps(opts: {
  width: number;
  height: number;
  bytesPerPixel?: number;
  webp?: boolean;
  decodeFails?: boolean;
}): EncodeDeps & { calls: Call[]; closed: () => boolean } {
  const calls: Call[] = [];
  let closed = false;
  const bpp = opts.bytesPerPixel ?? 1;
  return {
    calls,
    closed: () => closed,
    async createImageBitmap(source, options) {
      calls.push({ op: "bitmap", args: [source, options] });
      if (opts.decodeFails) throw new Error("decode");
      return {
        width: opts.width,
        height: opts.height,
        close: () => {
          closed = true;
        },
      };
    },
    createCanvas(width, height) {
      let hasContext = false;
      const canvas = {
        width,
        height,
        getContext() {
          hasContext = true;
          return {
            fillStyle: "",
            imageSmoothingEnabled: false,
            imageSmoothingQuality: "low" as ImageSmoothingQuality,
            fillRect: (...args: unknown[]) =>
              calls.push({ op: "fillRect", args }),
            drawImage: (...args: unknown[]) =>
              calls.push({ op: "drawImage", args }),
          };
        },
        async convertToBlob(options?: { type?: string; quality?: number }) {
          // Like OffscreenCanvas: no context, no blob.
          if (!hasContext) throw new Error("InvalidStateError: no context");
          const requested = options?.type ?? "image/png";
          const type =
            requested === "image/webp" && opts.webp === false
              ? "image/png"
              : requested;
          const size = Math.round(
            canvas.width * canvas.height * (options?.quality ?? 1) * bpp,
          );
          calls.push({
            op: "encode",
            args: [type, canvas.width, canvas.height],
          });
          return new Blob([new Uint8Array(size)], { type });
        },
      };
      return canvas;
    },
  };
}

const source = new Blob([new Uint8Array(4)], { type: "image/jpeg" });

describe("encodeImageUnderCap", () => {
  it("decodes with the Exif rotation applied, then encodes WebP under the cap", async () => {
    const deps = fakeDeps({ width: 4000, height: 3000, bytesPerPixel: 0.4 });
    const result = await encodeImageUnderCap(
      source,
      { maxBytes: 2048 * KB, maxSide: 2560 },
      deps,
    );
    expect(deps.calls[0]).toEqual({
      op: "bitmap",
      args: [source, { imageOrientation: "from-image" }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.blob.type).toBe("image/webp");
    expect(result.blob.size).toBeLessThanOrEqual(2048 * KB);
    expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(2560);
    expect(deps.closed()).toBe(true);
  });

  it("falls back to JPEG on a white background where WebP can't be encoded", async () => {
    const deps = fakeDeps({ width: 100, height: 50, webp: false });
    const result = await encodeImageUnderCap(
      source,
      { maxBytes: 2048 * KB, maxSide: 2560 },
      deps,
    );
    expect(result.ok && result.blob.type).toBe("image/jpeg");
    const fill = deps.calls.find((call) => call.op === "fillRect");
    expect(fill?.args).toEqual([0, 0, 100, 50]);
  });

  it("steps size and quality down until the bytes fit", async () => {
    const deps = fakeDeps({ width: 2560, height: 2560, bytesPerPixel: 1 });
    const result = await encodeImageUnderCap(
      source,
      { maxBytes: 1024 * KB, maxSide: 2560 },
      deps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.blob.size).toBeLessThanOrEqual(1024 * KB);
    expect(result.width).toBeLessThan(2560);
  });

  it("refuses more than 40 MP before drawing anything", async () => {
    const deps = fakeDeps({ width: 8000, height: 6000 });
    const result = await encodeImageUnderCap(
      source,
      { maxBytes: 2048 * KB, maxSide: 2560 },
      deps,
    );
    expect(result).toEqual({ ok: false, error: "pixels" });
    expect(deps.calls.some((call) => call.op === "drawImage")).toBe(false);
    expect(deps.closed()).toBe(true);
  });

  it("probes WebP support once per worker, not per image", async () => {
    const deps = fakeDeps({ width: 10, height: 10 });
    const request = { maxBytes: 2048 * KB, maxSide: 2560 };
    await encodeImageUnderCap(source, request, deps);
    await encodeImageUnderCap(source, request, deps);
    const probes = deps.calls.filter(
      (call) =>
        call.op === "encode" && call.args[1] === 1 && call.args[2] === 1,
    );
    expect(probes).toHaveLength(1);
  });

  it("reports an undecodable file", async () => {
    const deps = fakeDeps({ width: 1, height: 1, decodeFails: true });
    expect(
      await encodeImageUnderCap(source, { maxBytes: KB, maxSide: 2560 }, deps),
    ).toEqual({ ok: false, error: "decode" });
  });

  it("reports when nothing fits", async () => {
    const deps = fakeDeps({ width: 2000, height: 2000 });
    expect(
      await encodeImageUnderCap(source, { maxBytes: KB, maxSide: 2560 }, deps),
    ).toEqual({ ok: false, error: "shrink" });
    expect(deps.closed()).toBe(true);
  });
});

describe("encodeUnderByteCap", () => {
  it("starts at maxSide and compares raw bytes, not the data URL", async () => {
    const sizes: number[] = [];
    const encoder = {
      width: 4000,
      height: 2000,
      encode: async (attempt: { width: number; height: number }) => {
        sizes.push(attempt.width);
        // 3 bytes would be a 4-character base64 data URL: over a 3-byte cap.
        return { type: "image/webp", size: 3 };
      },
    };
    expect((await encodeUnderByteCap(encoder, 3, 2560))?.size).toBe(3);
    expect(sizes).toEqual([2560]);
  });

  it("returns null when nothing fits, and stops when cancelled", async () => {
    const encoder = {
      width: 100,
      height: 100,
      encode: async () => ({ type: "image/webp", size: 10 }),
    };
    expect(await encodeUnderByteCap(encoder, 1, 2560)).toBeNull();
    const controller = new AbortController();
    controller.abort();
    await expect(
      encodeUnderByteCap(encoder, 100, 2560, controller.signal),
    ).rejects.toThrow("Upload cancelled");
  });
});
