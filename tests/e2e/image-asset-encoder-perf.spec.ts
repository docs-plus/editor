/**
 * Image store perf (spec §8, R7): encoding a 12 MP photo in the worker keeps
 * the main thread free, so typing keeps getting frames. Timing, so it runs
 * in the `perf` project, on one worker. Measured locally (Apple silicon):
 * longest main-thread gap 11 ms in the worker, 84 ms on the main thread.
 */
import { expect, test } from "@playwright/test";

import { openHarness, preparePhoto } from "./helpers/asset-encoder-page";

test("encoding a 12 MP photo in the worker leaves the main thread free", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await openHarness(page);
  const worker = await preparePhoto(page, "worker");
  const main = await preparePhoto(page, "main");
  console.log(
    `[encoder perf] longest main-thread gap: worker ${Math.round(worker.longestGapMs)} ms, ` +
      `main thread ${Math.round(main.longestGapMs)} ms`,
  );
  expect(worker.usedFallback).toBe(false);
  expect(worker.longestGapMs).toBeLessThan(50);
});
