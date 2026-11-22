/**
 * The image store insert pipeline in a real engine (image store spec §2.3,
 * §8 perf, R7): `prepareImageAsset` re-encodes a 12 MP phone JPEG in the
 * encode worker with the Exif rotation baked in, drops Exif and GPS, caps
 * the longest side at 2560 px and the bytes at 2 MB, and hashes the output.
 *
 * No app path inserts assets yet (P2.6b, W11), so the spec bundles the
 * pipeline with `Bun.build` and serves it from a route: no dev server.
 * Also runs under `--project=webkit` (JPEG output, no WebP encoder).
 */
import { createHash } from "node:crypto";
import path from "node:path";

import { expect, type Page, test } from "@playwright/test";

import { buildExifApp1 } from "../helpers/image-bytes";
import type { HarnessResult } from "./helpers/asset-encoder-harness";

const ROOT = path.resolve(import.meta.dirname, "../..");
// https: Web Crypto (`crypto.subtle`) exists only in secure contexts.
const ORIGIN = "https://asset-encoder.test";

let harnessJs = "";
let workerJs = "";

async function bundle(entry: string): Promise<string> {
  const result = await Bun.build({
    entrypoints: [path.join(ROOT, entry)],
    target: "browser",
    format: "esm",
    define: { "process.env.NEXT_PUBLIC_MAX_EMBED_IMAGE_BYTES": "undefined" },
  });
  if (!result.success) throw new AggregateError(result.logs, "bundle failed");
  return result.outputs[0].text();
}

test.beforeAll(async () => {
  [harnessJs, workerJs] = await Promise.all([
    bundle("tests/e2e/helpers/asset-encoder-harness.ts"),
    bundle("lib/assets/encode-worker.ts"),
  ]);
});

async function openHarness(page: Page): Promise<void> {
  const files: Record<string, [string, string]> = {
    "/": [
      '<!doctype html><script type="module" src="/harness.js"></script>',
      "text/html",
    ],
    "/harness.js": [harnessJs, "text/javascript"],
    "/encode-worker.js": [workerJs, "text/javascript"],
  };
  await page.route(`${ORIGIN}/**`, (route) => {
    const file = files[new URL(route.request().url()).pathname];
    return file
      ? route.fulfill({ body: file[0], contentType: file[1] })
      : route.fulfill({ status: 404 });
  });
  await page.goto(`${ORIGIN}/`);
  await page.waitForFunction(() => typeof window.__prepareAsset === "function");
}

/** Orientation 6 (rotate 90° clockwise) and GPS: a phone held upright. */
const PHONE_EXIF = [
  ...buildExifApp1({ orientation: 6, gps: { lat: 52.37, lon: 4.89 } }),
];

async function prepare(
  page: Page,
  mode: "worker" | "main",
): Promise<HarnessResult & { bytes: Buffer }> {
  const size = await page.evaluate(
    (exif) => window.__makePhoto(exif),
    PHONE_EXIF,
  );
  expect(size).toBeGreaterThan(2 * 1024 * 1024);
  const result = await page.evaluate((m) => window.__prepareAsset(m), mode);
  return { ...result, bytes: Buffer.from(result.base64, "base64") };
}

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
    const result = await prepare(page, "worker");
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
    if (browserName === "chromium") {
      expect(result.usedFallback).toBe(false);
      // Encoding off the main thread: typing keeps getting frames.
      expect(result.longestGapMs).toBeLessThan(50);
    }
  });

  test("falls back to the main-thread canvas with the same result", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await openHarness(page);
    const result = await prepare(page, "main");
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
