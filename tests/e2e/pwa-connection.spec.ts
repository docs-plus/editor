import {
  type BrowserContext,
  expect,
  type Page,
  test,
  type WebSocketRoute,
} from "@playwright/test";

import { EditorPage } from "./helpers/editor-page";

/**
 * Cuts the collab WebSocket on demand. `context.setOffline()` flips
 * navigator.onLine but does not close an open WebSocket, so the socket is
 * routed through Playwright and closed here. Next's HMR socket is left alone.
 */
class Network {
  private online = true;
  private sockets: WebSocketRoute[] = [];

  constructor(
    private context: BrowserContext,
    private page: Page,
  ) {}

  async install(): Promise<void> {
    await this.page.routeWebSocket(
      (url) => !url.pathname.startsWith("/_next"),
      (ws) => {
        if (!this.online) {
          void ws.close();
          return;
        }
        ws.connectToServer();
        this.sockets.push(ws);
      },
    );
  }

  /** The collab server stops answering; the browser may still be online. */
  async dropSocket(): Promise<void> {
    this.online = false;
    await Promise.all(this.sockets.map((ws) => ws.close()));
    this.sockets = [];
  }

  async goOffline(): Promise<void> {
    await this.context.setOffline(true);
    await this.dropSocket();
  }

  async goOnline(): Promise<void> {
    this.online = true;
    await this.context.setOffline(false);
  }
}

async function openUserTab(page: Page, network: Network): Promise<string> {
  await network.install();
  const docId = `pwa-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const editor = new EditorPage(page);
  await editor.goto(docId);
  await editor.waitForSync();
  return docId;
}

async function typeAtEnd(page: Page, text: string): Promise<void> {
  await page.locator(".tiptap").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type(text);
}

test.describe("offline edits", () => {
  test.setTimeout(120_000);

  test("survive a tab switch and sync after reconnecting", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const network = new Network(context, page);
    const docId = await openUserTab(page, network);

    await network.goOffline();
    await typeAtEnd(page, "offline-marker");

    await page.locator(`[data-tab-id="playground"]`).click();
    await page.waitForTimeout(3000);
    await page.locator(`[data-tab-id="${docId}"]`).click();
    await expect(page.locator(".tiptap")).toContainText("offline-marker", {
      timeout: 5000,
    });

    // Unsynced edits: closing or reloading asks first.
    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.type());
      void dialog.dismiss();
    });
    await page.reload({ timeout: 3000 }).catch(() => {});
    expect(dialogs).toEqual(["beforeunload"]);
    await expect(page.locator(".tiptap")).toContainText("offline-marker");

    await network.goOnline();

    const other = await browser.newContext();
    const otherPage = await other.newPage();
    const otherEditor = new EditorPage(otherPage);
    await otherEditor.goto(docId);
    await expect(otherPage.locator(".tiptap")).toContainText("offline-marker", {
      timeout: 45_000,
    });

    // Everything is acknowledged now: reloading does not ask.
    await page.waitForTimeout(1000);
    await page.reload();
    await expect(page.locator(".tiptap")).toContainText("offline-marker", {
      timeout: 15_000,
    });
    expect(dialogs).toEqual(["beforeunload"]);

    await other.close();
    await context.close();
  });
});
