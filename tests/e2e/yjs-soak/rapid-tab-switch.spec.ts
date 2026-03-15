import { expect, test } from "@playwright/test";
import { EditorPage } from "../helpers/editor-page";

test("rapid tab switching does not create duplicate connections or stale state", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  const ep = new EditorPage(page);
  await ep.goto("tab-switch-test");
  await ep.waitForSync();
  await ep.typeText("Initial content");
  await page.waitForTimeout(1000);

  for (let i = 0; i < 20; i++) {
    const targetTab = `other-doc-${i % 2}`;
    await page.evaluate((tabId: string) => {
      const state = JSON.parse(localStorage.getItem("tinydocy-tabs") ?? "{}");
      const tabs: Array<{ id: string; title: string; createdAt: number }> =
        state.tabs ?? [];
      if (!tabs.find((t: { id: string }) => t.id === tabId)) {
        tabs.push({ id: tabId, title: "Other", createdAt: Date.now() });
      }
      state.tabs = tabs;
      state.activeTabId = tabId;
      localStorage.setItem("tinydocy-tabs", JSON.stringify(state));
      window.dispatchEvent(
        new StorageEvent("storage", { key: "tinydocy-tabs" }),
      );
    }, targetTab);

    await page.waitForTimeout(100);
  }

  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("tinydocy-tabs") ?? "{}");
    state.activeTabId = "tab-switch-test";
    localStorage.setItem("tinydocy-tabs", JSON.stringify(state));
    window.dispatchEvent(new StorageEvent("storage", { key: "tinydocy-tabs" }));
  });
  await page.waitForTimeout(2000);

  const json = await ep.getEditorJSON();
  const textContent = JSON.stringify(json);
  expect(textContent).toContain("Initial content");
  expect(consoleErrors.filter((e) => e.includes("duplicate"))).toHaveLength(0);
});
