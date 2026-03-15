import { expect, test } from "@playwright/test";
import { EditorPage } from "./helpers/editor-page";

test.describe("collaboration", () => {
  test.setTimeout(120_000);
  test.describe.configure({ retries: 1 });

  test("user B sees content created by user A", async ({ browser }) => {
    const docId = `collab-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await pageA.addInitScript(
      `window.__HOCUS_TOKEN = ${JSON.stringify(`user-a-${docId}`)}`,
    );
    await pageB.addInitScript(
      `window.__HOCUS_TOKEN = ${JSON.stringify(`user-b-${docId}`)}`,
    );

    const editorA = new EditorPage(pageA);
    const editorB = new EditorPage(pageB);

    await editorA.goto(docId);
    await editorA.waitForSync();

    await pageA.click(".tiptap h1");
    await pageA.keyboard.type("Hello from A");
    await expect(pageA.locator(".tiptap h1").first()).toContainText(
      "Hello from A",
      { timeout: 5000 },
    );

    await pageA.waitForTimeout(2000);

    await editorB.goto(docId);
    await editorB.waitForSync();

    await expect(pageB.locator(".tiptap")).toContainText("Hello from A", {
      timeout: 30000,
    });

    await contextA.close();
    await contextB.close();
  });

  test.describe("real-time", () => {
    test.describe.configure({ retries: 1 });

    test("sync between two connected users", async ({ browser }) => {
      const docId = `collab-rt-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const contextA = await browser.newContext();
      const contextB = await browser.newContext();
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();

      await pageA.addInitScript(
        `window.__HOCUS_TOKEN = ${JSON.stringify(`user-a-${docId}`)}`,
      );
      await pageB.addInitScript(
        `window.__HOCUS_TOKEN = ${JSON.stringify(`user-b-${docId}`)}`,
      );

      const editorA = new EditorPage(pageA);
      const editorB = new EditorPage(pageB);

      await editorA.goto(docId);
      await editorA.waitForSync();
      await editorB.goto(docId);
      await editorB.waitForSync();

      await pageB.waitForTimeout(1000);

      await pageA.click(".tiptap h1");
      await pageA.keyboard.type("Live edit from A");

      await expect(pageB.locator(".tiptap")).toContainText("Live edit from A", {
        timeout: 30000,
      });

      await contextA.close();
      await contextB.close();
    });
  });
});
