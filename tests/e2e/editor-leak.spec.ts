import { type CDPSession, expect, type Page, test } from "@playwright/test";

import { EditorPage } from "./helpers/editor-page";

/** Longer than collab-session's deferred release (1 s). */
const SETTLE_MS = 1_100;
/** Settled readings: equal editor counts and heaps within this fraction. */
const HEAP_STABLE = 0.01;
const MAX_READINGS = 8;
const SWITCHES = 20;
/** Rounds through every tab before the baseline (3 switches per round). */
const WARMUP_ROUNDS = 4;

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

/**
 * Event listeners on `document` and `window`, counted per target and type
 * (`"document:keydown"`), so a failure names the listener that leaked.
 */
async function listenerCounts(
  cdp: CDPSession,
): Promise<Record<string, number>> {
  const objectGroup = "listener-count";
  const counts: Record<string, number> = {};
  try {
    for (const target of ["document", "window"]) {
      const { result } = await cdp.send("Runtime.evaluate", {
        expression: target,
        objectGroup,
      });
      if (!result.objectId) throw new Error(`no ${target}`);
      const { listeners } = await cdp.send("DOMDebugger.getEventListeners", {
        objectId: result.objectId,
      });
      for (const { type } of listeners) {
        const key = `${target}:${type}`;
        counts[key] = (counts[key] ?? 0) + 1;
      }
    }
    return counts;
  } finally {
    await cdp.send("Runtime.releaseObjectGroup", { objectGroup });
  }
}

async function reading(page: Page, cdp: CDPSession) {
  await page.waitForTimeout(SETTLE_MS);
  await collectGarbage(cdp);
  const editors = await liveEditors(cdp);
  await collectGarbage(cdp);
  const { usedSize } = await cdp.send("Runtime.getHeapUsage");
  return { editors, heap: usedSize };
}

/**
 * Reads the editor count and heap until two readings in a row agree (same
 * count, heap within {@link HEAP_STABLE}), so released sessions, pending
 * timers and lazy work have settled instead of being caught mid-flight.
 */
async function measure(page: Page, cdp: CDPSession) {
  let last = await reading(page, cdp);
  for (let i = 1; i < MAX_READINGS; i++) {
    const next = await reading(page, cdp);
    const settled =
      next.editors === last.editors &&
      Math.abs(next.heap - last.heap) <= last.heap * HEAP_STABLE;
    last = next;
    if (settled) break;
  }
  return last;
}

test.describe("editor lifetime", () => {
  // Heap and listener counts come from Chromium's DevTools protocol.
  test.skip(({ browserName }) => browserName !== "chromium", "CDP only");

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

    // Warm up: every chunk, session and cache exists, and heap growth has
    // flattened, before the baseline. Measured from a 6-switch baseline the
    // heap still grew for about 30 more switches without a leak.
    for (let round = 0; round < WARMUP_ROUNDS; round++)
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
    // The editor count is the precise check. Heap is a backstop against a
    // warmed baseline: the marked leak added about 17% after 20 switches
    // and kept growing.
    expect(after.editors).toBeLessThanOrEqual(before.editors + 1);
    expect(after.heap).toBeLessThanOrEqual(before.heap * 1.1);
  });

  test("opening and closing the bubble and colour popover leaves no listeners", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const CYCLES = 100;
    const editorPage = new EditorPage(page);
    await editorPage.goto();
    await editorPage.waitForSync();
    await editorPage.setContent({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Title" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Select some words here" }],
        },
      ],
    });
    const bubble = page.locator("[data-smart-bubble]");
    const toolbar = page.getByRole("toolbar", { name: "Selection formatting" });
    const dialog = page.getByRole("dialog", { name: "Text colours" });
    /** Select "some words" (bubble opens), or collapse to a caret (closes). */
    const select = (words: boolean) =>
      page.evaluate((range) => {
        const editor = window.__tiptap_editor;
        if (!editor) throw new Error("editor missing");
        let from = -1;
        editor.state.doc.descendants((node, pos) => {
          const at = node.isText
            ? (node.text?.indexOf("some words") ?? -1)
            : -1;
          if (at >= 0) from = pos + at;
          return from < 0;
        });
        editor
          .chain()
          .focus()
          .setTextSelection({ from, to: range ? from + 10 : from })
          .run();
      }, words);

    const cycle = async () => {
      await select(true);
      await expect(bubble).toHaveAttribute("data-state", "open");
      await toolbar.getByRole("button", { name: "More text colours" }).click();
      // The panel is a lazy chunk: wait until it has focused a swatch.
      await expect(dialog.locator("button:focus")).toHaveCount(1);
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await select(false);
      await expect(bubble).toHaveCount(0);
    };

    // Warm up: chunks loaded, tooltips and popover singletons created.
    for (let i = 0; i < 3; i++) await cycle();
    const cdp = await page.context().newCDPSession(page);
    await page.waitForTimeout(500);
    const before = await listenerCounts(cdp);

    for (let i = 0; i < CYCLES; i++) await cycle();
    await page.waitForTimeout(500);
    const after = await listenerCounts(cdp);

    test.info().annotations.push({
      type: "document + window listeners",
      description: `${JSON.stringify(before)} → ${JSON.stringify(after)}`,
    });
    expect(after).toEqual(before);
  });
});
