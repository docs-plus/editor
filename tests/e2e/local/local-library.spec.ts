import type { Page } from "@playwright/test";

import { EditorPage } from "../helpers/editor-page";
import { expect, test } from "./fixtures";

/**
 * The desktop renderer over the dev bridge (P2.4b, architecture §11):
 * `local-session` over `createRpcDocStore` over a loopback socket to the dev
 * storage host on `MemoryDocLibrary`. No Hocus. Needs a desktop-target dev
 * server; the commands are in tests/TESTING.md.
 */

const docUrl = () => `/?doc=${crypto.randomUUID()}`;

/** Saves every open document now, as blur, hide and quit will. */
const flush = (page: Page) => page.evaluate(() => window.__TINYDOCY_FLUSH?.());

test.describe("local library (dev bridge)", () => {
  test("opens a document from storage and keeps edits across a reload", async ({
    page,
  }) => {
    const editor = new EditorPage(page);
    const url = docUrl();
    await page.goto(url);
    await editor.waitForSync();

    await page.locator(".tiptap").click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Saved through the dev bridge");
    await flush(page);

    await page.reload();
    await editor.waitForSync();
    await expect(page.locator(".tiptap")).toContainText(
      "Saved through the dev bridge",
    );
  });

  test("talks only to the storage host: no Hocus socket, no web-only route", async ({
    page,
    storageHost,
  }) => {
    const sockets: string[] = [];
    const requests: string[] = [];
    page.on("websocket", (socket) => sockets.push(socket.url()));
    page.on("request", (request) => requests.push(request.url()));

    await page.goto(docUrl());
    await new EditorPage(page).waitForSync();
    await page.waitForLoadState("networkidle");

    // next dev's own HMR socket is same-origin; storage is the only other
    // (dev StrictMode mounts the root twice, so it may connect twice).
    const origin = new URL(page.url()).origin.replace(/^http/, "ws");
    const others = new Set(sockets.filter((url) => !url.startsWith(origin)));
    expect([...others]).toEqual([`${storageHost.url}/`]);
    const paths = requests
      .map((url) => new URL(url))
      .filter((url) => url.origin === new URL(page.url()).origin)
      .map((url) => url.pathname);
    expect(
      paths.filter((path) =>
        /^\/(api\/|privacy|offline|manifest\.webmanifest|sitemap|robots|opengraph-image|apple-icon)/.test(
          path,
        ),
      ),
    ).toEqual([]);
  });
});
