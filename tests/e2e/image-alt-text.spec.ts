/**
 * The image toolbar's "Alt text…" action (image store spec §7): images are
 * inserted with `alt=""`, never the file name, and this dialog edits the
 * alt text. It lives in the media toolbar's overflow menu, before Replace URL.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import { expect, type Page, test } from "@playwright/test";

import { EditorPage } from "./helpers/editor-page";

const SHOTS = path.join("test-results", "image-alt-text");

/** Lets popover fade-ins finish, so a screenshot shows the settled UI. */
async function settled(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) =>
            animation.effect?.getComputedTiming().iterations !== Infinity,
        )
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
}

/** A 480×270 PNG data URL: a soft gradient with three bars. */
async function chartImage(page: Page): Promise<string> {
  return page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 480;
    canvas.height = 270;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2d context");
    const gradient = context.createLinearGradient(0, 0, 480, 270);
    gradient.addColorStop(0, "#dbeafe");
    gradient.addColorStop(1, "#ede9fe");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 480, 270);
    context.fillStyle = "#6366f1";
    [120, 180, 90].forEach((height, i) => {
      context.fillRect(80 + i * 120, 230 - height, 80, height);
    });
    return canvas.toDataURL("image/png");
  });
}

/**
 * Waits for the image toolbar's lazy chunk: it loads when the first image
 * renders, and the toolbar shows the stock actions until then.
 */
async function imageActionsLoaded(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const storage = window.__tiptap_editor?.storage as unknown as Record<
          string,
          {
            mediaActions?: (d: { id: string }[], c: object) => { id: string }[];
          }
        >;
        const resolve = storage?.HyperMultimediaKit?.mediaActions;
        return !!resolve?.([{ id: "replace" }], { nodeType: "image" }).some(
          (action) => action.id === "alt-text",
        );
      }),
    )
    .toBe(true);
}

async function openWithImage(page: Page): Promise<void> {
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.waitForSync();
  const src = await chartImage(page);
  await editor.setContent({
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Weekly report" }],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "Signups by week:" }],
      },
      { type: "image", attrs: { src, alt: "", width: 480, height: 270 } },
    ],
  });
  await imageActionsLoaded(page);
}

async function openAltText(page: Page) {
  await page.locator(".tiptap img").first().click();
  const toolbar = page.locator("[data-hm-toolbar]:not([data-hm-closing])");
  await expect(toolbar).toBeVisible();
  await toolbar.getByRole("button", { name: /more/i }).click();
  await page.getByRole("menuitem", { name: "Alt text…" }).click();
  return page.getByRole("dialog", { name: "Alt text" });
}

test.describe("Alt text… (image toolbar)", () => {
  test("edits the image's alt text in a small dialog", async ({ page }) => {
    await openWithImage(page);
    const image = page.locator(".tiptap img").first();
    await expect(image).toHaveAttribute("alt", "");

    mkdirSync(SHOTS, { recursive: true });
    await page.locator(".tiptap img").first().click();
    const toolbar = page.locator("[data-hm-toolbar]:not([data-hm-closing])");
    await toolbar.getByRole("button", { name: /more/i }).click();
    const item = page.getByRole("menuitem", { name: "Alt text…" });
    await expect(item).toBeVisible();
    await settled(page);
    await page.screenshot({ path: path.join(SHOTS, "1-overflow-menu.png") });
    await item.click();

    const dialog = page.getByRole("dialog", { name: "Alt text" });
    const input = dialog.getByRole("textbox", { name: "Alt text" });
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute("placeholder", "Describe this image");
    await settled(page);
    await page.screenshot({ path: path.join(SHOTS, "2-dialog-empty.png") });
    await input.fill("Bar chart: signups rose in week 2, then fell");
    await page.screenshot({ path: path.join(SHOTS, "3-dialog.png") });
    await page.keyboard.press("Enter");

    await expect(dialog).toHaveCount(0);
    await expect(image).toHaveAttribute(
      "alt",
      "Bar chart: signups rose in week 2, then fell",
    );
    await expect(page.locator(".tiptap")).toBeFocused();
  });

  test("looks like the kit's Replace URL dialog (screenshot for review)", async ({
    page,
  }) => {
    await openWithImage(page);
    await page.locator(".tiptap img").first().click();
    const toolbar = page.locator("[data-hm-toolbar]:not([data-hm-closing])");
    await toolbar.getByRole("button", { name: /more/i }).click();
    await page.getByRole("menuitem", { name: "Replace URL" }).click();
    await expect(
      page.getByRole("dialog", { name: "Replace URL" }),
    ).toBeVisible();
    await settled(page);
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, "0-replace-url.png") });
  });

  test("shows the current alt text, and Escape closes without saving", async ({
    page,
  }) => {
    await openWithImage(page);
    let dialog = await openAltText(page);
    await dialog.getByRole("textbox").fill("First");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toHaveCount(0);

    dialog = await openAltText(page);
    const input = dialog.getByRole("textbox", { name: "Alt text" });
    await expect(input).toHaveValue("First");
    await input.fill("Discarded");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".tiptap img").first()).toHaveAttribute(
      "alt",
      "First",
    );
  });

  test("is one undo step", async ({ page }) => {
    await openWithImage(page);
    const dialog = await openAltText(page);
    await dialog.getByRole("textbox").fill("Undone");
    await page.keyboard.press("Enter");
    const image = page.locator(".tiptap img").first();
    await expect(image).toHaveAttribute("alt", "Undone");
    await page.evaluate(() => window.__tiptap_editor?.commands.undo());
    await expect(image).toHaveAttribute("alt", "");
  });
});
