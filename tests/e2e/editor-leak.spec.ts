import { type CDPSession, expect, type Page, test } from "@playwright/test";

/** Longer than collab-session's deferred release (1 s). */
const SETTLE_MS = 2_000;
const SWITCHES = 20;

/** A 1×1 PNG, so Playground images settle instead of waiting on the network. */
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function collectGarbage(cdp: CDPSession): Promise<void> {
  for (let i = 0; i < 3; i++) await cdp.send("HeapProfiler.collectGarbage");
}

/** Live `Editor` instances, found through the mounted editor's prototype. */
async function liveEditors(cdp: CDPSession): Promise<number> {
  const objectGroup = "editor-leak";
  try {
    const { result: proto } = await cdp.send("Runtime.evaluate", {
      expression:
        "Object.getPrototypeOf(document.querySelector('.ProseMirror').editor)",
      objectGroup,
    });
    if (!proto.objectId) throw new Error("no mounted editor");
    const { objects } = await cdp.send("Runtime.queryObjects", {
      prototypeObjectId: proto.objectId,
      objectGroup,
    });
    const { result } = await cdp.send("Runtime.callFunctionOn", {
      objectId: objects.objectId,
      functionDeclaration: "function () { return this.length; }",
      returnByValue: true,
      objectGroup,
    });
    return result.value as number;
  } finally {
    // Handles held by the protocol would keep the editors alive themselves.
    await cdp.send("Runtime.releaseObjectGroup", { objectGroup });
  }
}

async function measure(page: Page, cdp: CDPSession) {
  await page.waitForTimeout(SETTLE_MS);
  await collectGarbage(cdp);
  const editors = await liveEditors(cdp);
  await collectGarbage(cdp);
  const { usedSize } = await cdp.send("Runtime.getHeapUsage");
  return { editors, heap: usedSize };
}

test.describe("editor lifetime", () => {
  test("switching tabs does not keep destroyed editors alive", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.route(/picsum\.photos/, (route) =>
      route.fulfill({ contentType: "image/png", body: PIXEL }),
    );

    const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const ids = [`leak-a-${nonce}`, `leak-b-${nonce}`];
    // Playground carries images, tables and diagrams: the heaviest editor.
    const order = ["playground", ...ids];
    await page.addInitScript((doc: string) => {
      (window as Window & { __GLOBAL_TABS_DOC?: string }).__GLOBAL_TABS_DOC =
        doc;
    }, `global-tabs-leak-${nonce}`);
    await page.addInitScript(
      (state: unknown) => {
        localStorage.setItem("tinydocy-tabs", JSON.stringify(state));
      },
      {
        tabs: order.map((id, i) => ({ id, title: `Tab ${i}`, createdAt: i })),
        activeTabId: ids[0],
      },
    );
    await page.goto("/");
    await page.waitForSelector(`[data-tab-id="${ids[1]}"]`);

    // Each switch mounts a new editor; wait for it to sync with the server.
    const open = async (id: string) => {
      // An expando, not an attribute: ProseMirror observes its attributes.
      await page.evaluate(() => {
        const el = document.querySelector(".ProseMirror");
        if (el) Object.assign(el, { leakProbeOld: true });
      });
      await page.locator(`[data-tab-id="${id}"] [aria-selected]`).click();
      await page.waitForFunction(() => {
        const region = document.querySelector(".document-editor-content");
        const view = region?.querySelector(".ProseMirror");
        return (
          region?.getAttribute("data-server-synced") === "true" &&
          view != null &&
          !("leakProbeOld" in view)
        );
      });
    };

    // Warm up: every chunk, session and cache exists before the baseline.
    for (let round = 0; round < 2; round++)
      for (const id of order) await open(id);
    const home = order[order.length - 1];

    const cdp = await page.context().newCDPSession(page);
    const before = await measure(page, cdp);

    for (let i = 0; i < SWITCHES; i++) await open(order[i % order.length]);
    // Measure on the same tab as the baseline, so the same document is live.
    await open(home);
    const after = await measure(page, cdp);

    test.info().annotations.push({
      type: "editors / heap",
      description: `${before.editors} → ${after.editors}, ${before.heap} → ${after.heap} bytes`,
    });
    expect(after.editors).toBeLessThanOrEqual(before.editors + 1);
    expect(after.heap).toBeLessThanOrEqual(before.heap * 1.05);
  });
});
