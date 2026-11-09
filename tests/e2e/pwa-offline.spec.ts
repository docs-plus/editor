import { type BrowserContext, expect, type Page, test } from "@playwright/test";

/**
 * Service worker behaviour. Workers run only on a production build:
 *   bun run build && PORT=3847 bun run start
 *   HOCUS_THROTTLE=0 bun run hocus
 *   PWA_BASE_URL=http://localhost:3847 CI= bun run test:pwa
 */
test.skip(!process.env.PWA_BASE_URL, "needs a production build");

const WORKER_PATH = "/_next/static/service-worker/sw.js";

/**
 * One isolated global-tabs doc for the whole file (the project runs one
 * worker and no test edits tabs): every new doc counts against the server's
 * DOC_CREATION_RATE_LIMIT, which defaults to 10 per hour per IP.
 */
const TABS_DOC = `global-tabs-pwa-${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function isolateTabs(context: BrowserContext): Promise<void> {
  await context.addInitScript((name: string) => {
    (window as Window & { __GLOBAL_TABS_DOC?: string }).__GLOBAL_TABS_DOC =
      name;
  }, TABS_DOC);
}

async function waitForControl(page: Page): Promise<void> {
  await page.waitForFunction(
    () => navigator.serviceWorker.controller !== null,
    null,
    { timeout: 30_000 },
  );
}

async function openControlled(page: Page): Promise<void> {
  await isolateTabs(page.context());
  await page.goto("/");
  await waitForControl(page);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

test.describe("service worker", () => {
  test("registers after load with scope /", async ({ page, context }) => {
    await isolateTabs(context);
    await context.addInitScript(() => {
      const w = window as Window & { __loadAt?: number; __registerAt?: number };
      window.addEventListener("load", () => {
        w.__loadAt = performance.now();
      });
      const register = ServiceWorkerContainer.prototype.register;
      ServiceWorkerContainer.prototype.register = function (...args) {
        w.__registerAt = performance.now();
        return register.apply(this, args);
      };
    });

    await page.goto("/");
    await waitForControl(page);

    const timing = await page.evaluate(() => {
      const w = window as Window & { __loadAt?: number; __registerAt?: number };
      return { loadAt: w.__loadAt, registerAt: w.__registerAt };
    });
    expect(timing.loadAt).toBeDefined();
    expect(timing.registerAt).toBeGreaterThanOrEqual(timing.loadAt ?? 0);

    const registration = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return { scope: reg?.scope, scriptURL: reg?.active?.scriptURL };
    });
    const origin = new URL(page.url()).origin;
    expect(registration.scope).toBe(`${origin}/`);
    expect(registration.scriptURL).toBe(`${origin}${WORKER_PATH}`);
  });

  test("caches hold only own static files and shell pages", async ({
    page,
  }) => {
    await openControlled(page);

    const contents = await page.evaluate(async () => {
      const result: Record<string, string[]> = {};
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        result[name] = (await cache.keys()).map((request) => request.url);
      }
      return result;
    });
    const origin = new URL(page.url()).origin;

    expect(Object.keys(contents).sort()).toEqual([
      "tinydocy-shell-v1",
      "tinydocy-static",
    ]);
    const paths = (urls: string[]) => urls.map((url) => new URL(url).pathname);
    expect(paths(contents["tinydocy-shell-v1"])).toEqual(
      expect.arrayContaining(["/", "/offline"]),
    );
    expect(contents["tinydocy-static"].length).toBeGreaterThan(0);
    for (const path of paths(contents["tinydocy-static"])) {
      expect(path.startsWith("/_next/static/")).toBe(true);
      expect(path.startsWith("/_next/static/service-worker/")).toBe(false);
    }
    for (const url of Object.values(contents).flat()) {
      expect(new URL(url).origin).toBe(origin);
      expect(new URL(url).pathname.startsWith("/api/")).toBe(false);
    }
  });

  test("worker headers", async ({ page }) => {
    const response = await page.request.get(WORKER_PATH);
    expect(response.status()).toBe(200);
    const headers = response.headers();
    expect(headers["service-worker-allowed"]).toBe("/");
    expect(headers["cache-control"]).toBe("public, max-age=0, must-revalidate");
    expect(headers["content-security-policy"]).toContain("worker-src 'self'");
    expect((await response.body()).length).toBeLessThan(80_000);
  });

  test("offline shell and fallback", async ({ page, context }) => {
    await openControlled(page);

    await context.setOffline(true);
    try {
      await page.reload();
      await expect(
        page.getByRole("heading", { level: 1 }).first(),
      ).toBeVisible();

      await page.goto("/privacy"); // never visited: no stored copy
      await expect(
        page.getByRole("heading", { name: /offline/i }),
      ).toBeVisible();

      await page.goto("/nope?x=1");
      await expect(
        page.getByRole("heading", { name: /offline/i }),
      ).toBeVisible();
    } finally {
      await context.setOffline(false);
    }
  });

  test("bypass routes are not served by the worker", async ({ page }) => {
    await openControlled(page);

    const [llms] = await Promise.all([
      page.waitForResponse("**/llms.txt"),
      page.evaluate(() => fetch("/llms.txt").then((r) => r.status)),
    ]);
    expect(llms.fromServiceWorker()).toBe(false);

    const [api] = await Promise.all([
      page.waitForResponse("**/api/documents/**"),
      page.evaluate(() =>
        fetch("/api/documents/pwa-bypass-probe", { method: "HEAD" }).then(
          (r) => r.status,
        ),
      ),
    ]);
    expect(api.fromServiceWorker()).toBe(false);

    const fromWorker: string[] = [];
    page.on("response", (response) => {
      if (
        response.url().includes("/_next/static/") &&
        response.fromServiceWorker()
      ) {
        fromWorker.push(response.url());
      }
    });
    await page.reload();
    await page.waitForLoadState("load");
    expect(fromWorker.length).toBeGreaterThan(0);
  });

  test("repeat visit is not slower with the worker", async ({ browser }) => {
    test.setTimeout(120_000);

    async function repeatVisits(controlled: boolean): Promise<number[]> {
      const context = await browser.newContext({
        serviceWorkers: controlled ? "allow" : "block",
      });
      await isolateTabs(context);
      const page = await context.newPage();
      await page.goto("/");
      await page.locator(".tiptap").first().waitFor({ timeout: 20_000 });
      if (controlled) await waitForControl(page);

      const times: number[] = [];
      for (let run = 0; run < 3; run++) {
        const start = Date.now();
        await page.goto("/");
        await page.locator(".tiptap").first().waitFor();
        times.push(Date.now() - start);
      }
      await context.close();
      return times;
    }

    const blocked = median(await repeatVisits(false));
    const withWorker = median(await repeatVisits(true));
    test.info().annotations.push({
      type: "repeat-visit-ms",
      description: `blocked=${blocked} worker=${withWorker}`,
    });
    expect(withWorker).toBeLessThanOrEqual(blocked * 1.15 + 100);
  });
});

test.describe("offline editing", () => {
  test.setTimeout(120_000);

  test("the editor reopens offline with the document from the device", async ({
    page,
    context,
  }) => {
    await openControlled(page);
    const editor = page.locator(".tiptap");
    await expect(editor).toBeVisible({ timeout: 30_000 });
    const marker = `device-copy-${Date.now()}`;
    await editor.click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type(marker);
    // Debounced save to IndexedDB, and the lazily loaded editor chunks are
    // in the static cache once the editor has rendered.
    await page.waitForTimeout(2500);

    await context.setOffline(true);
    await page.reload();
    await expect(page.locator(".tiptap")).toContainText(marker, {
      timeout: 30_000,
    });
    await context.setOffline(false);
  });
});
