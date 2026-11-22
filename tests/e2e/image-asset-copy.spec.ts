/**
 * What the asset kit's image Copy puts on the clipboard (a PNG of the bytes,
 * no `asset:` HTML) pastes as a picture into the public sandbox, through the
 * same path as any pasted image file (A0: an inline data URL, no metadata).
 */
import { expect, test } from "@playwright/test";

import { EditorPage, typeInNewParagraphAtEnd } from "./helpers/editor-page";

test("a copied asset image (PNG only) pastes into the sandbox as an image", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "clipboard permissions: Chromium");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.waitForSync();
  await typeInNewParagraphAtEnd(page, "Pasted:");

  // Exactly what `copyAsset` writes by default.
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 40;
    canvas.height = 20;
    const context2d = canvas.getContext("2d");
    if (!context2d) throw new Error("no 2d context");
    context2d.fillStyle = "#6366f1";
    context2d.fillRect(0, 0, 40, 20);
    const png = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!png) throw new Error("no PNG");
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
  });

  await page.keyboard.press("ControlOrMeta+V");
  const image = page.locator(".tiptap img").first();
  await expect(image).toHaveAttribute("src", /^data:image\/png;base64,/);
  await expect(page.locator('.tiptap img[src^="asset:"]')).toHaveCount(0);
});
