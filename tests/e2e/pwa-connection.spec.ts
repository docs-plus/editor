import {
  type BrowserContext,
  expect,
  type Page,
  test,
  type WebSocketRoute,
} from "@playwright/test";

import { EditorPage, typeInNewParagraphAtEnd } from "./helpers/editor-page";

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
    await typeInNewParagraphAtEnd(page, "offline-marker");

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

test.describe("connection status strip", () => {
  test.setTimeout(90_000);

  const strip = (page: Page) => page.locator("div.fixed[data-state]");
  const liveRegion = (page: Page) =>
    page.locator('[role="status"][aria-live="polite"]');

  test("shows offline, unsynced edits and recovery", async ({
    context,
    page,
  }) => {
    const network = new Network(context, page);
    await openUserTab(page, network);
    await expect(strip(page)).toHaveAttribute("data-state", "online");
    await expect(liveRegion(page)).toHaveText("");

    await network.goOffline();
    await expect(strip(page)).toHaveAttribute("data-state", "offline", {
      timeout: 1000,
    });
    await expect(strip(page)).toContainText("Offline");
    await expect(liveRegion(page)).toContainText("You're offline");

    await typeInNewParagraphAtEnd(page, "x");
    await expect(strip(page)).toContainText("Offline · edits not synced yet");

    await network.goOnline();
    await expect(strip(page)).toHaveAttribute("data-state", "online", {
      timeout: 5000,
    });
    await expect(strip(page)).toContainText("online");
    await expect(liveRegion(page)).toContainText("Back online");
  });

  test("says reconnecting before offline when only the server is gone", async ({
    context,
    page,
  }) => {
    const network = new Network(context, page);
    await openUserTab(page, network);

    await network.dropSocket();
    await expect(strip(page)).toHaveAttribute("data-state", "connecting");
    await expect(strip(page)).toContainText("Reconnecting…");
    // Not announced: a flapping socket must stay quiet.
    await expect(liveRegion(page)).toHaveText("");
    await expect(strip(page)).toHaveAttribute("data-state", "offline", {
      timeout: 6000,
    });
    await expect(liveRegion(page)).toContainText("You're offline");
  });
});

test.describe("offline app shell", () => {
  test.setTimeout(90_000);

  // The visible strip, not the status strip's sr-only announcement.
  const banner = (page: Page) =>
    page.locator("p", { hasText: "Keep this tab open: your edits stay here" });

  test("shows the banner and disables tab actions", async ({
    context,
    page,
  }) => {
    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.type());
      void dialog.dismiss();
    });
    const network = new Network(context, page);
    await openUserTab(page, network);
    const newTab = page.getByRole("button", { name: /New tab/ });
    await expect(newTab).toBeEnabled();
    await expect(banner(page)).toHaveCount(0);

    await network.goOffline();
    await expect(banner(page)).toBeVisible({ timeout: 1000 });

    // In flow under the tab bar: it never covers the toolbar.
    const tabBarBox = await page.locator(".tab-bar").boundingBox();
    const bannerBox = await banner(page).boundingBox();
    expect(bannerBox?.y).toBeGreaterThanOrEqual(
      (tabBarBox?.y ?? 0) + (tabBarBox?.height ?? 0),
    );
    await expect(page.getByRole("toolbar").first()).toBeInViewport();

    await expect(newTab).toBeDisabled();
    await expect(newTab).toHaveAttribute(
      "title",
      "Reconnect to create or close tabs",
    );
    await expect(page.locator(".tab-bar-close-all")).toBeDisabled();
    const closeButtons = page.locator(".tab-bar-tab-close");
    expect(await closeButtons.count()).toBeGreaterThan(0);
    for (const button of await closeButtons.all()) {
      await expect(button).toBeDisabled();
    }

    const tabCount = await page.locator(".tab-bar-tab").count();
    await page.locator(".tiptap").click();
    await page.keyboard.press("ControlOrMeta+t");
    await page.keyboard.press("ControlOrMeta+w");
    await page.waitForTimeout(300);
    await expect(page.locator(".tab-bar-tab")).toHaveCount(tabCount);

    await page.getByRole("button", { name: "Hide offline message" }).click();
    await expect(banner(page)).toHaveCount(0);

    await network.goOnline();
    await expect(newTab).toBeEnabled({ timeout: 5000 });
    await expect(banner(page)).toHaveCount(0);
    // Tab actions come back while still connecting; the dismissal lasts
    // until the connection is really back, so wait for that before testing
    // that the banner returns.
    await expect(page.locator("div.fixed[data-state]")).toHaveAttribute(
      "data-state",
      "online",
      { timeout: 10_000 },
    );

    await network.goOffline();
    await expect(banner(page)).toBeVisible({ timeout: 1000 });
    expect(dialogs).toEqual([]);
  });

  test("shows a calm notice before the editor opens offline", async ({
    context,
    page,
  }) => {
    const network = new Network(context, page);
    await network.install();
    await network.dropSocket();
    await page.addInitScript(
      (tabsDoc: string) => {
        (window as Window & { __GLOBAL_TABS_DOC?: string }).__GLOBAL_TABS_DOC =
          tabsDoc;
      },
      `global-tabs-pwa-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await page.goto("/");
    await expect(page.locator(".site-intro-status")).toBeVisible();
    // Let the app hydrate first: offline, the dev server's chunks can't load.
    await page.waitForLoadState("networkidle");

    await context.setOffline(true);
    const notice = page.locator('[role="status"].site-intro-offline-muted');
    await expect(notice).toBeVisible({ timeout: 1000 });
    await expect(notice).toContainText("You're offline");
    await expect(page.locator(".site-intro-status")).toBeHidden();
    // The 10 s "can't reach the server" alert never shows for this.
    await page.waitForTimeout(11_000);
    // (Next's dev route announcer is an empty role=alert, so match ours.)
    await expect(page.locator('[role="alert"].site-intro-offline')).toHaveCount(
      0,
    );

    await network.goOnline();
    await expect(page.locator(".tab-bar")).toBeVisible({ timeout: 10_000 });
    await expect(notice).toHaveCount(0);
  });
});
