/**
 * Serves the image store pipeline (`asset-encoder-harness.ts`, bundled with
 * `Bun.build`) from a route, so specs run it in a real engine without the
 * app: no app path inserts assets until P2.6b and W11.
 */
import path from "node:path";

import { expect, type Page } from "@playwright/test";

import { buildExifApp1 } from "../../helpers/image-bytes";
import type { HarnessResult } from "./asset-encoder-harness";

const ROOT = path.resolve(import.meta.dirname, "../../..");
// https: Web Crypto (`crypto.subtle`) exists only in secure contexts.
const ORIGIN = "https://asset-encoder.test";

let bundles: Promise<[string, string]> | undefined;

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

export async function openHarness(page: Page): Promise<void> {
  bundles ??= Promise.all([
    bundle("tests/e2e/helpers/asset-encoder-harness.ts"),
    bundle("lib/assets/encode-worker.ts"),
  ]);
  const [harnessJs, workerJs] = await bundles;
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

/** Prepares a 12 MP phone photo made in the page, in the worker or not. */
export async function preparePhoto(
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
