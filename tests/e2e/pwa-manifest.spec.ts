import { expect, type Page, test } from "@playwright/test";

import { EditorPage } from "./helpers/editor-page";

/** Runs against `make dev` (chromium project): manifest, icons, head tags. */

const LIGHT = "#fafafa";
const DARK = "#171717";

/** Per-test global-tabs doc, as EditorPage does, for pages opened by hand. */
async function isolateTabs(page: Page): Promise<void> {
  const tabsDoc = `global-tabs-pwa-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await page.addInitScript((name: string) => {
    (window as Window & { __GLOBAL_TABS_DOC?: string }).__GLOBAL_TABS_DOC =
      name;
  }, tabsDoc);
}

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

test.describe("theme-color and iOS metadata", () => {
  /** Browsers use the first theme-color meta in tree order. */
  const themeColor = (page: Page) =>
    page.locator('meta[name="theme-color"]').first();
  const storeDarkTheme = (page: Page) =>
    page
      .context()
      .addInitScript(() => localStorage.setItem("tinydocy-theme", "dark"));

  test("head carries the web-app tags", async ({ page }) => {
    const html = await (await page.request.get("/")).text();
    expect(html).toContain(
      '<meta name="apple-mobile-web-app-title" content="TinyDocy"',
    );
    expect(html).toContain(
      '<meta name="apple-mobile-web-app-status-bar-style" content="default"',
    );
    expect(html).toContain('name="mobile-web-app-capable"');
    expect(html).toContain('rel="apple-touch-icon"');
    expect(html).toContain('rel="manifest"');
    expect(html).toContain(`<meta name="theme-color" content="${LIGHT}"`);
  });

  test("stored dark theme sets the title bar before hydration", async ({
    page,
  }) => {
    await storeDarkTheme(page);
    await page.goto("/about");
    await expect(themeColor(page)).toHaveAttribute("content", DARK);
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  });

  test("the toggle updates the title bar and survives reload", async ({
    page,
  }) => {
    const editor = new EditorPage(page);
    await editor.goto();

    await page.getByRole("button", { name: "Switch to dark mode" }).click();
    await expect(themeColor(page)).toHaveAttribute("content", DARK);

    await page.reload();
    await expect(themeColor(page)).toHaveAttribute("content", DARK);

    await page.getByRole("button", { name: "Switch to light mode" }).click();
    await expect(themeColor(page)).toHaveAttribute("content", LIGHT);
  });

  test("soft navigation keeps the dark title bar", async ({ page }) => {
    await storeDarkTheme(page);
    await isolateTabs(page);
    await page.goto("/about");
    await expect(themeColor(page)).toHaveAttribute("content", DARK);

    await page
      .getByRole("navigation", { name: "Site" })
      .getByRole("link", { name: "Open the editor" })
      .click();
    await page.waitForURL((url) => url.pathname === "/");
    await page.locator(".tiptap").first().waitFor();
    await expect(themeColor(page)).toHaveAttribute("content", DARK);
  });

  test("the OS colour scheme does not change the title bar", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/about");
    await expect(themeColor(page)).toHaveAttribute("content", LIGHT);
  });
});
