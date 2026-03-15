import { expect, test } from "@playwright/test";
import { EditorPage } from "./helpers/editor-page";

test.describe("collaboration", () => {
  test.setTimeout(60_000);

  test("two users see each other's edits", async ({ browser }) => {
    const docId = `collab-test-${Date.now()}`;

    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    const editorA = new EditorPage(pageA);
    const editorB = new EditorPage(pageB);

    await editorA.goto(docId);
    await editorA.waitForSync();

    await editorB.goto(docId);
    await editorB.waitForSync();

    await pageA.click(".tiptap");
    await pageA.keyboard.type("Hello from A");

    // Wait for Yjs sync: poll until page B sees the text (Hocuspocus required)
    await pageB.waitForFunction(
      () => {
        const editor = (
          window as Window & {
            __tiptap_editor?: { getJSON: () => { content?: unknown[] } };
          }
        ).__tiptap_editor;
        const json = editor?.getJSON();
        const text =
          (
            json?.content?.[0] as
              | { content?: Array<{ text?: string }> }
              | undefined
          )?.content?.[0]?.text ?? "";
        return text.includes("Hello from A");
      },
      { timeout: 10000 },
    );

    const jsonB = (await editorB.getEditorJSON()) as {
      content?: Array<{
        content?: Array<{ text?: string }>;
      }>;
    };
    const titleText = jsonB?.content?.[0]?.content?.[0]?.text ?? "";
    expect(titleText).toContain("Hello from A");

    await contextA.close();
    await contextB.close();
  });
});
