import {
  type BrowserContext,
  expect,
  type Page,
  test,
  type WebSocketRoute,
} from "@playwright/test";

import { EditorPage, typeInNewParagraphAtEnd } from "./helpers/editor-page";

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

/** Document names with an offline copy in this browser (never creates the DB). */
function storedCopies(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const dbs = await indexedDB.databases();
    if (!dbs.some((db) => db.name === "tinydocy-offline")) return [];
    return new Promise<string[]>((resolve, reject) => {
      const req = indexedDB.open("tinydocy-offline");
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("docs")) return resolve([]);
        const all = db.transaction("docs").objectStore("docs").getAll();
        all.onsuccess = () =>
          resolve((all.result as Array<{ name: string }>).map((d) => d.name));
        all.onerror = () => reject(all.error);
      };
    });
  });
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
