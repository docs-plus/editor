/**
 * The image store insert pipeline in a real engine (image store spec §2.3,
 * §8 perf, R7): `prepareImageAsset` re-encodes a 12 MP phone JPEG in the
 * encode worker with the Exif rotation baked in, drops Exif and GPS, caps
 * the longest side at 2560 px and the bytes at 2 MB, and hashes the output.
 *
 * No app path inserts assets yet (P2.6b, W11), so the spec bundles the
 * pipeline with `Bun.build` and serves it from a route: no dev server.
 * Also runs under `--project=webkit` (JPEG output, no WebP encoder). The
 * main-thread timing check is `image-asset-encoder-perf.spec.ts` (`perf`).
 */
import { createHash } from "node:crypto";

import { expect, test } from "@playwright/test";

import { openHarness, preparePhoto } from "./helpers/asset-encoder-page";

function hasSegment(bytes: Buffer, marker: number): boolean {
  return bytes.some((b, i) => b === 0xff && bytes[i + 1] === marker);
}

function containsAscii(bytes: Buffer, text: string): boolean {
  return bytes.includes(Buffer.from(text, "latin1"));
}

test.describe("image store encoder (real engine)", () => {
  test("re-encodes a 12 MP phone JPEG in the worker: upright, capped, no Exif or GPS", async ({
    page,
    browserName,
  }) => {
    test.setTimeout(60_000);
    await openHarness(page);
    const result = await preparePhoto(page, "worker");
    console.log(
      `[${browserName}] ${result.mime} ${result.width}×${result.height}, ` +
        `${result.bytes.length} B, ${Math.round(result.totalMs)} ms, ` +
        `longest main-thread gap ${Math.round(result.longestGapMs)} ms, ` +
        `worker=${result.usedWorker} fallback=${result.usedFallback}`,
    );

    // The rotation is baked in: the 4000×3000 sensor image is portrait.
    expect({ width: result.width, height: result.height }).toEqual({
      width: 1920,
      height: 2560,
    });
    expect(result.bytes.length).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(result.mime).toBe(
      browserName === "webkit" ? "image/jpeg" : "image/webp",
    );
    // No APP1 (Exif, XMP) in a JPEG; no EXIF or XMP chunk in a WebP.
    if (result.mime === "image/jpeg") {
      expect(hasSegment(result.bytes, 0xe1)).toBe(false);
    }
    expect(containsAscii(result.bytes, "XMP ")).toBe(false);
    expect(containsAscii(result.bytes, "Exif")).toBe(false);
    expect(containsAscii(result.bytes, "EXIF")).toBe(false);
    expect(result.hex).toBe(
      createHash("sha256").update(result.bytes).digest("hex"),
    );
    expect(result.usedWorker).toBe(true);
    if (browserName === "chromium") expect(result.usedFallback).toBe(false);
  });

  test("falls back to the main-thread canvas with the same result", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await openHarness(page);
    const result = await preparePhoto(page, "main");
    console.log(
      `[main thread] ${result.mime} ${Math.round(result.totalMs)} ms, ` +
        `longest main-thread gap ${Math.round(result.longestGapMs)} ms`,
    );
    expect({ width: result.width, height: result.height }).toEqual({
      width: 1920,
      height: 2560,
    });
    expect(containsAscii(result.bytes, "Exif")).toBe(false);
    expect(result.usedFallback).toBe(true);
  });
});
