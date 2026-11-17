import { expect, type Page, test } from "@playwright/test";

import { EditorPage } from "./helpers/editor-page";

/**
 * The desktop renderer (#99, #101, P2.4), against the desktop static export
 * served with the protocol handler's path rules (prefetch runs only in
 * production builds):
 *   NEXT_PUBLIC_HOCUS_URL=ws://127.0.0.1:1296 bun run build:desktop
 *   PORT=3849 bun scripts/serve-desktop-export.ts
 *   HOCUS_PORT=1296 HOCUS_THROTTLE=0 HOCUS_ALLOW_ISOLATED_TABS_DOCS=1 bun run hocus
 *   DESKTOP_BASE_URL=http://127.0.0.1:3849 CI= bun playwright test --project=desktop
 */
test.skip(!process.env.DESKTOP_BASE_URL, "needs a desktop-flag build");

const POST = "https://x.com/docsplus/status/1234567890123456789";
const X_HOSTS = /^https?:\/\/([^/]*\.)?(x\.com|twitter\.com|twimg\.com)\//;

/** Every request the page makes, from before the first navigation. */
function recordRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (request) => urls.push(request.url()));
  return urls;
}

const privacyRequests = (urls: string[]) =>
  urls.filter((url) => /^\/privacy\b/.test(new URL(url).pathname));

/** Pastes `text` as the clipboard would, at the caret. */
async function paste(page: Page, text: string): Promise<void> {
  await page.locator(".tiptap").evaluate((editor, value) => {
    const data = new DataTransfer();
    data.setData("text/plain", value);
    editor.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, text);
}

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
    await new EditorPage(page).waitForSync();
    await page.waitForLoadState("networkidle");

    expect(failed).toEqual([]);
    const paths = urls.map((url) => new URL(url).pathname);
    expect(paths.some((path) => path.endsWith(".txt"))).toBe(true);
    // The page links it; headless Chromium doesn't fetch icons itself.
    const href = await page
      .locator('link[rel="icon"][type="image/png"]')
      .getAttribute("href");
    const icon = await page.request.get(href ?? "");
    expect(icon.status()).toBe(200);
    expect(icon.headers()["content-type"]).toBe("image/png");
    expect(
      paths.filter((path) =>
        /^\/(manifest\.webmanifest|opengraph-image|apple-icon|sitemap|robots|api\/|privacy|offline)/.test(
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

  test("an X post renders as a link card with no request to X", async ({
    page,
  }) => {
    const urls = recordRequests(page);
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForSync();

    await page.locator(".tiptap").click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.press("Enter");
    await paste(page, POST);

    const card = page.locator("[data-x-link-card]");
    await expect(card).toBeVisible();
    await expect(card.locator(".x-link-card__title")).toHaveText(
      "Post by @docsplus",
    );
    await expect(card.locator(".x-link-card__open")).toHaveAttribute(
      "data-href",
      POST,
    );
    await expect(page.locator(".hypermultimedia--x__content")).toHaveCount(0);

    // The identity card's Privacy link is on screen here too.
    const privacy = page.locator("a", { hasText: /^Privacy$/ });
    await expect(privacy).toHaveAttribute(
      "href",
      "https://tiny.docs.plus/privacy",
    );
    await page.waitForLoadState("networkidle");

    // Opens the post in a new window (the shell's system browser), once.
    await page.evaluate(() => {
      const w = window as Window & { __opened?: unknown[][] };
      w.__opened = [];
      window.open = ((...args: unknown[]) => {
        w.__opened?.push(args);
        return null;
      }) as typeof window.open;
    });
    await card.locator(".x-link-card__open").click();
    expect(
      await page.evaluate(
        () => (window as Window & { __opened?: unknown[][] }).__opened,
      ),
    ).toEqual([[POST, "_blank", "noopener,noreferrer"]]);

    expect(urls.filter((url) => X_HOSTS.test(url))).toEqual([]);
    expect(privacyRequests(urls)).toEqual([]);
    expect(
      await page.locator('script[src*="platform.twitter.com"]').count(),
    ).toBe(0);
  });
});
