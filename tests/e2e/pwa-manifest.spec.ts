import { expect, type Page, test } from "@playwright/test";

/** Runs against `make dev` (chromium project): manifest, icons, head tags. */

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose: string;
}

function pngSize(body: Buffer): string {
  expect(body.subarray(1, 4).toString("ascii")).toBe("PNG");
  return `${body.readUInt32BE(16)}x${body.readUInt32BE(20)}`;
}

/** Alpha of the top-left pixel: 0 for rounded icons, 255 for opaque ones. */
function cornerAlpha(page: Page, src: string): Promise<number> {
  return page.evaluate(async (url) => {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, 1, 1).data[3];
  }, src);
}

test.describe("PWA manifest", () => {
  test("manifest shape", async ({ page }) => {
    const response = await page.request.get("/manifest.webmanifest");
    expect(response.ok()).toBe(true);
    const manifest = await response.json();

    expect(manifest.id).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.start_url).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.background_color).toBe("#ffffff");
    expect(manifest.theme_color).toBe("#fafafa");
    expect(manifest.description).toContain("Public sandbox");

    const icons = manifest.icons as ManifestIcon[];
    for (const expected of [
      { sizes: "192x192", purpose: "any" },
      { sizes: "512x512", purpose: "any" },
      { sizes: "512x512", purpose: "maskable" },
    ]) {
      expect(icons).toContainEqual(expect.objectContaining(expected));
    }

    // Deliberately omitted: a public sandbox must not receive shared files
    // or protocol links, and launch_handler would break the two-window demo.
    for (const key of [
      "share_target",
      "file_handlers",
      "protocol_handlers",
      "launch_handler",
      "shortcuts",
    ]) {
      expect(manifest).not.toHaveProperty(key);
    }
  });

  test("icons", async ({ page }) => {
    const manifest = await (
      await page.request.get("/manifest.webmanifest")
    ).json();
    for (const icon of manifest.icons as ManifestIcon[]) {
      const response = await page.request.get(icon.src);
      expect(response.status(), icon.src).toBe(200);
      expect(response.headers()["content-type"]).toMatch(/^image\/png/);
      expect(pngSize(await response.body()), icon.src).toBe(icon.sizes);
    }

    expect((await page.request.get("/pwa-icons/nope")).status()).toBe(404);

    await page.goto("/about");
    expect(await cornerAlpha(page, "/pwa-icons/maskable-512")).toBe(255);
    expect(await cornerAlpha(page, "/apple-icon")).toBe(255);
    expect(await cornerAlpha(page, "/pwa-icons/any-512")).toBe(0);
  });
});
