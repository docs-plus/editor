import { HocuspocusProvider } from "@hocuspocus/provider";
import { expect, test } from "@playwright/test";
import * as Y from "yjs";

import { isValidTabEntry } from "../../lib/tab-api";
import { EditorPage } from "./helpers/editor-page";

/** Same server the app under test uses (`make dev` default). */
const HOCUS_URL = process.env.E2E_HOCUS_URL ?? "ws://127.0.0.1:1234";

/**
 * A01-1: the tab list is shared and writable by any anonymous client. A
 * malformed entry must neither crash the page nor survive on the server.
 */
test("malformed tab entries are ignored and repaired", async ({ page }) => {
  const editor = new EditorPage(page);
  await editor.goto();
  const tabsDoc = await page.evaluate(
    () => (window as Window & { __GLOBAL_TABS_DOC?: string }).__GLOBAL_TABS_DOC,
  );
  expect(tabsDoc).toBeTruthy();
  const tabCountBefore = await page.locator("[data-tab-id]").count();

  const doc = new Y.Doc();
  const attacker = new HocuspocusProvider({
    url: HOCUS_URL,
    name: tabsDoc ?? "",
    document: doc,
  });
  await new Promise<void>((resolve) => attacker.on("synced", () => resolve()));
  const tabs = doc.getArray<unknown>("tabs");
  tabs.push([
    null,
    {
      id: "11111111-1111-4111-8111-111111111111",
      title: { a: 1 },
      createdAt: 0,
    },
    { id: "../escape", title: "x", createdAt: 0 },
  ]);

  // The page keeps rendering and shows no poisoned tab.
  await page.waitForTimeout(1000);
  await expect(page.locator(".tiptap")).toBeVisible();
  await expect(page.locator("[data-tab-id]")).toHaveCount(tabCountBefore);

  // The server removed the entries from the shared state.
  await expect.poll(() => tabs.toArray().every(isValidTabEntry)).toBe(true);
  attacker.destroy();
});
