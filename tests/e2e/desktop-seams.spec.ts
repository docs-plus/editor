import { expect, type Page, test } from "@playwright/test";

/**
 * The desktop static export (#101, P2.4), served with the protocol
 * handler's path rules (prefetch runs only in production builds):
 *   bun run build:desktop
 *   PORT=3849 bun scripts/serve-desktop-export.ts
 *   DESKTOP_BASE_URL=http://127.0.0.1:3849 CI= bun playwright test --project=desktop
 * The release renderer has no storage until the shell's IPC (P2.5), so the
 * editor's desktop seams run in the `local` project instead.
 */
test.skip(!process.env.DESKTOP_BASE_URL, "needs a desktop-flag build");

/** Every request the page makes, from before the first navigation. */
function recordRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (request) => urls.push(request.url()));
  return urls;
}

const privacyRequests = (urls: string[]) =>
  urls.filter((url) => /^\/privacy\b/.test(new URL(url).pathname));

test.describe("desktop build", () => {
  test("the export answers every request the renderer makes", async ({
    page,
  }) => {
    const origin = new URL(test.info().project.use.baseURL ?? "").origin;
    const failed: string[] = [];
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (url.origin === origin && response.status() >= 400) {
        failed.push(`${response.status()} ${url.pathname}${url.search}`);
      }
    });
    const urls = recordRequests(page);

    // The header links prefetch both pages' segments; the click is a
    // client navigation that fetches the RSC payload (.txt).
    await page.goto("/about");
    await page.waitForLoadState("networkidle");
    await page
      .getByRole("navigation", { name: "Site" })
      .getByRole("link", { name: "Open the editor" })
      .click();
    await expect(page).toHaveURL(/\/$/);
    // The desktop root: no storage in a release build until P2.5's IPC.
    await expect(page.getByText("Library unavailable.")).toBeVisible();
    await page.waitForLoadState("networkidle");

    expect(failed).toEqual([]);
    const paths = urls.map((url) => new URL(url).pathname);
    expect(paths.some((path) => path.endsWith(".txt"))).toBe(true);
    // The page links it; headless Chromium doesn't fetch icons itself.
    const href = await page.locator('link[rel="icon"]').getAttribute("href");
    const icon = await page.request.get(href ?? "");
    expect(icon.status()).toBe(200);
    expect(icon.headers()["content-type"]).toBe("image/x-icon");
    expect(
      paths.filter((path) =>
        /^\/(manifest\.webmanifest|opengraph-image|apple-icon|icon$|sitemap|robots|api\/|privacy|offline)/.test(
          path,
        ),
      ),
    ).toEqual([]);
  });

  test("/about links to the website's privacy page and never fetches /privacy", async ({
    page,
  }) => {
    const urls = recordRequests(page);
    await page.goto("/about");
    const link = page.locator(".site-page-footer a", { hasText: "Privacy" });
    await link.scrollIntoViewIfNeeded();
    await expect(link).toHaveAttribute(
      "href",
      "https://tiny.docs.plus/privacy",
    );
    await expect(link).toHaveAttribute("target", "_blank");
    await page.waitForLoadState("networkidle");

    expect(privacyRequests(urls)).toEqual([]);
  });
});
