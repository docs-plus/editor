import type { Page } from "@playwright/test";

import { EditorPage } from "../helpers/editor-page";
import { expect, test } from "./fixtures";

/**
 * The editor's desktop seams (#99) in the desktop renderer over the dev
 * bridge: X posts as a static link card, with no request to X. (The Privacy
 * link is checked on the export, in desktop-seams.spec.ts.)
 */

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

test.describe("desktop seams in the editor", () => {
  test("an X post renders as a link card with no request to X", async ({
    page,
  }) => {
    const urls = recordRequests(page);
    await page.goto(`/?doc=${crypto.randomUUID()}`);
    await new EditorPage(page).waitForSync();

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
