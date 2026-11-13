import { type CDPSession, expect, type Page, test } from "@playwright/test";

import { EditorPage } from "./helpers/editor-page";

/**
 * HoE gate for PR E: window/document listeners and the heap return to
 * their baseline after 20 tab switches and 100 palette cycles, and the
 * palette owns exactly one capture `keydown` listener on `window`.
 * (The bubble half of the cycle joins when PR D2's bubble mounts
 * `RepeatSplitButton`.)
 */

const PALETTE = "[data-command-palette]";

interface ListenerCounts {
  window: number;
  document: number;
  paletteKeydown: number;
}

async function listenerCounts(cdp: CDPSession): Promise<ListenerCounts> {
  const count = async (expression: string) => {
    const { result } = await cdp.send("Runtime.evaluate", {
      expression,
      objectGroup: "palette-leaks",
    });
    const { listeners } = await cdp.send("DOMDebugger.getEventListeners", {
      objectId: result.objectId as string,
    });
    await cdp.send("Runtime.releaseObjectGroup", {
      objectGroup: "palette-leaks",
    });
    return listeners;
  };
  const onWindow = await count("window");
  const onDocument = await count("document");
  const paletteKeydown = onWindow.filter(
    (listener) =>
      listener.type === "keydown" &&
      listener.useCapture &&
      listener.handler?.description?.includes("onPaletteKey"),
  ).length;
  return {
    window: onWindow.length,
    document: onDocument.length,
    paletteKeydown,
  };
}

async function liveEditors(cdp: CDPSession): Promise<number> {
  await cdp.send("HeapProfiler.collectGarbage");
  const { result: proto } = await cdp.send("Runtime.evaluate", {
    expression: "Object.getPrototypeOf(window.__tiptap_editor)",
    objectGroup: "editors",
  });
  const { objects } = await cdp.send("Runtime.queryObjects", {
    prototypeObjectId: proto.objectId as string,
    objectGroup: "editors",
  });
  const { result } = await cdp.send("Runtime.callFunctionOn", {
    objectId: objects.objectId as string,
    functionDeclaration: "function () { return this.length; }",
    returnByValue: true,
  });
  await cdp.send("Runtime.releaseObjectGroup", { objectGroup: "editors" });
  return result.value as number;
}

async function heapUsed(cdp: CDPSession): Promise<number> {
  await cdp.send("HeapProfiler.collectGarbage");
  await cdp.send("HeapProfiler.collectGarbage");
  const { usedSize } = await cdp.send("Runtime.getHeapUsage");
  return usedSize;
}

async function paletteCycle(page: Page): Promise<void> {
  await page.keyboard.press("Alt+Slash");
  await expect(page.locator(PALETTE)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(PALETTE)).toHaveCount(0);
}

async function switchTab(page: Page, id: string): Promise<void> {
  await page.locator(`[data-tab-id="${id}"]`).click();
  await page.waitForSelector(".tiptap[contenteditable='true']", {
    state: "visible",
  });
  await page.locator(".tiptap").first().click();
}

test("listeners and heap return to baseline after 20 tab switches and 100 palette cycles", async ({
  page,
}) => {
  test.setTimeout(180_000);
  test.info().annotations.push({
    type: "known",
    description:
      "Tab switches retain destroyed editors (about one per two switches) on the base commit too, without any PR E code; heap is therefore gated over the palette cycles, and listeners over both.",
  });
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.waitForSync();
  const ids = await page
    .locator("[data-tab-id]")
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-tab-id")),
    );
  const back = ids.find((id) => id && id !== "playground");
  if (!back) throw new Error("expected a second tab");
  await page.locator(".tiptap").first().click();
  const cdp = await page.context().newCDPSession(page);

  // Warm up: palette chunk, both tabs.
  await paletteCycle(page);
  await switchTab(page, "playground");
  await switchTab(page, back);
  await paletteCycle(page);
  const baseline = await listenerCounts(cdp);
  expect(baseline.paletteKeydown).toBe(1);

  for (let i = 0; i < 20; i++) {
    await switchTab(page, i % 2 === 0 ? "playground" : back);
  }
  const afterTabs = await listenerCounts(cdp);
  expect(afterTabs.paletteKeydown).toBe(1);
  expect(afterTabs.window).toBeLessThanOrEqual(baseline.window);
  expect(afterTabs.document).toBeLessThanOrEqual(baseline.document);

  await paletteCycle(page);
  const heapBefore = await heapUsed(cdp);
  const editorsBefore = await liveEditors(cdp);
  const listenersBefore = await listenerCounts(cdp);
  for (let i = 0; i < 100; i++) await paletteCycle(page);
  const heapAfter = await heapUsed(cdp);
  const editorsAfter = await liveEditors(cdp);
  const listenersAfter = await listenerCounts(cdp);
  console.log(
    "palette cycles: heap",
    heapBefore,
    heapAfter,
    "editors",
    editorsBefore,
    editorsAfter,
  );

  // No growth (a transient listener from the last close may already be gone).
  expect(listenersAfter.paletteKeydown).toBe(1);
  expect(listenersAfter.window).toBeLessThanOrEqual(listenersBefore.window);
  expect(listenersAfter.document).toBeLessThanOrEqual(listenersBefore.document);
  expect(editorsAfter).toBe(editorsBefore);
  expect(heapAfter).toBeLessThanOrEqual(heapBefore * 1.05);
});
