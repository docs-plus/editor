import type { Page } from "@playwright/test";

import { EditorPage } from "./editor-page";

export type Rgb = [number, number, number];

/**
 * Resolves any CSS colour to sRGB by painting it on a 1×1 canvas. Chromium
 * returns `oklch()` from `getComputedStyle`, which no contrast maths can read.
 */
export async function resolveRgb(page: Page, cssColor: string): Promise<Rgb> {
  return page.evaluate((color) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("2d canvas unavailable");
    ctx.fillStyle = "#000";
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return [r, g, b] as [number, number, number];
  }, cssColor);
}

function channelLuminance(value: number): number {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance([r, g, b]: Rgb): number {
  return (
    0.2126 * channelLuminance(r) +
    0.7152 * channelLuminance(g) +
    0.0722 * channelLuminance(b)
  );
}

/** WCAG 2.x contrast ratio between two sRGB colours. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x,
  );
  return (hi + 0.05) / (lo + 0.05);
}

/** Sets the stored theme before the first navigation. */
export async function setTheme(
  page: Page,
  theme: "light" | "dark",
): Promise<void> {
  await page.addInitScript((value) => {
    localStorage.setItem("tinydocy-theme", value);
  }, theme);
}

/** Opens a fresh document, waits for the first sync and focuses the title. */
export async function openToolbarTestDoc(page: Page): Promise<EditorPage> {
  const editorPage = new EditorPage(page);
  await editorPage.goto();
  await editorPage.waitForSync();
  await editorPage.focusTitle();
  return editorPage;
}
