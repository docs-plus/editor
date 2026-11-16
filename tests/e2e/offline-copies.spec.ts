import {
  type BrowserContext,
  expect,
  type Page,
  test,
  type WebSocketRoute,
} from "@playwright/test";

import { EditorPage, typeInNewParagraphAtEnd } from "./helpers/editor-page";
import { storedCopies } from "./helpers/offline-store";

/** Closes the collab WebSocket on demand (Next's HMR socket is left alone). */
class CollabSocket {
  private open = true;
  private sockets: WebSocketRoute[] = [];

  constructor(
    private context: BrowserContext,
    private page: Page,
  ) {}

  async install(): Promise<void> {
    await this.page.routeWebSocket(
      (url) => !url.pathname.startsWith("/_next"),
      (ws) => {
        if (!this.open) {
          void ws.close();
          return;
        }
        ws.connectToServer();
        this.sockets.push(ws);
      },
    );
  }

  async cut({ offline = false } = {}): Promise<void> {
    this.open = false;
    if (offline) await this.context.setOffline(true);
    await Promise.all(this.sockets.map((ws) => ws.close()));
    this.sockets = [];
  }

  async restore(): Promise<void> {
    this.open = true;
    await this.context.setOffline(false);
  }
}

async function openDoc(page: Page, socket: CollabSocket): Promise<string> {
  await socket.install();
  const docId = `offline-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const editor = new EditorPage(page);
  await editor.goto(docId);
  await editor.waitForSync();
  return docId;
}

async function waitForCopy(page: Page, docId: string): Promise<void> {
  await expect
    .poll(() => storedCopies(page), { timeout: 10_000 })
    .toContain(docId);
}

test.describe("offline copies", () => {
  test.setTimeout(120_000);

  test("a repeat visit opens the document from the device when the server is unreachable", async ({
    context,
    page,
  }) => {
    const socket = new CollabSocket(context, page);
    const docId = await openDoc(page, socket);
    await typeInNewParagraphAtEnd(page, "cached-marker");
    await waitForCopy(page, docId);
    await page.waitForTimeout(1500); // let the debounced save include the edit

    await socket.cut();
    await page.reload();
    await expect(page.locator(".tiptap")).toContainText("cached-marker", {
      timeout: 15_000,
    });
  });

  // A full reload with the browser offline needs the service worker, which
  // only runs in production builds (the `pwa` project covers it); here the
  // collab server is unreachable while the page itself still loads.
  test("edits made while disconnected survive a reload and sync on reconnect", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const socket = new CollabSocket(context, page);
    const docId = await openDoc(page, socket);
    await waitForCopy(page, docId);

    await socket.cut();
    await typeInNewParagraphAtEnd(page, "reload-marker");
    await page.waitForTimeout(1500); // offline copy is saved on a short debounce
    page.on("dialog", (dialog) => void dialog.accept());
    await page.reload();
    await expect(page.locator(".tiptap")).toContainText("reload-marker", {
      timeout: 15_000,
    });

    await socket.restore();
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await new EditorPage(otherPage).goto(docId);
    await expect(otherPage.locator(".tiptap")).toContainText("reload-marker", {
      timeout: 45_000,
    });
    await other.close();
    await context.close();
  });

  // Saves here are sequential; overlapping saves are covered by the unit
  // test with a yielding read. This runs `putMerged` on real IndexedDB.
  test("two tabs editing one document offline keep each other's edits", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const pageA = await context.newPage();
    const pageB = await context.newPage();
    const socketA = new CollabSocket(context, pageA);
    const socketB = new CollabSocket(context, pageB);
    const docId = await openDoc(pageA, socketA);
    // B shares A's tab list, as real tabs do: with a list of its own, B's
    // copy sweep would delete A's tab-list copy and A could not reopen.
    const tabsDoc = await pageA.evaluate(
      () =>
        (window as Window & { __GLOBAL_TABS_DOC?: string }).__GLOBAL_TABS_DOC,
    );
    await pageB.addInitScript((name) => {
      (window as Window & { __GLOBAL_TABS_DOC?: string }).__GLOBAL_TABS_DOC =
        name;
    }, tabsDoc);
    await socketB.install();
    await pageB.goto("/");
    await pageB.locator(`[data-tab-id="${docId}"]`).click();
    await new EditorPage(pageB).waitForSync();
    await waitForCopy(pageA, docId);

    await socketA.cut();
    await socketB.cut();
    await typeInNewParagraphAtEnd(pageA, "tab-a-marker");
    await pageA.waitForTimeout(1500); // offline copy is saved on a short debounce
    await typeInNewParagraphAtEnd(pageB, "tab-b-marker");
    await pageB.waitForTimeout(1500);

    for (const page of [pageA, pageB]) {
      page.on("dialog", (dialog) => void dialog.accept());
    }
    await pageA.reload();
    const editor = pageA.locator(".tiptap");
    await expect(editor).toContainText("tab-a-marker", { timeout: 15_000 });
    await expect(editor).toContainText("tab-b-marker", { timeout: 15_000 });
    await context.close();
  });

  test("a document deleted while away disappears and its copy is removed", async ({
    context,
    page,
  }) => {
    const socket = new CollabSocket(context, page);
    const docId = await openDoc(page, socket);
    await typeInNewParagraphAtEnd(page, "doomed-marker");
    await waitForCopy(page, docId);

    await socket.cut();
    const response = await page.request.delete(`/api/documents/${docId}`);
    // 404: not stored server-side yet; still tombstoned (the client treats
    // it as success too).
    expect([200, 404]).toContain(response.status());
    await socket.restore();

    // The server drops the tombstoned tab from the shared list on reconnect.
    await expect(page.locator(`[data-tab-id="${docId}"]`)).toHaveCount(0, {
      timeout: 30_000,
    });
    await expect
      .poll(() => storedCopies(page), { timeout: 15_000 })
      .not.toContain(docId);
  });

  test("closing a tab removes its copy and 'Delete offline copies' clears the rest", async ({
    context,
    page,
  }) => {
    const socket = new CollabSocket(context, page);
    const docId = await openDoc(page, socket);
    await typeInNewParagraphAtEnd(page, "closing-marker");
    await waitForCopy(page, docId);

    await page.locator(`[data-tab-id="${docId}"]`).hover();
    await page
      .getByRole("button", { name: /^Close / })
      .first()
      .click();
    await expect.poll(() => storedCopies(page)).not.toContain(docId);

    await page.goto("/privacy");
    expect((await storedCopies(page)).length).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Delete offline copies" }).click();
    await expect(page.getByText("Offline copies deleted")).toBeVisible();
    expect(await storedCopies(page)).toEqual([]);
  });
});
