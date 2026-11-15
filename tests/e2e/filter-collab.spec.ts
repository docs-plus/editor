import { expect, type Page, test } from "@playwright/test";

import { EditorPage } from "./helpers/editor-page";

const section = (title: string) => [
  {
    type: "heading",
    attrs: { level: 2 },
    content: [{ type: "text", text: `${title} Section` }],
  },
  {
    type: "paragraph",
    content: [{ type: "text", text: `${title} notes` }],
  },
];

async function openAs(page: Page, user: string, docId: string) {
  await page.addInitScript(
    `window.__HOCUS_TOKEN = ${JSON.stringify(`${user}-${docId}`)}`,
  );
  const editor = new EditorPage(page);
  await editor.goto(docId);
  await editor.waitForSync();
  return editor;
}

test.describe("heading filter with a collaborator", () => {
  test.setTimeout(90_000);

  test("folds follow a collaborator's heading edits", async ({ browser }) => {
    const docId = `filter-collab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    const editorA = await openAs(pageA, "user-a", docId);
    await editorA.setContent({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Shared Plan" }],
        },
        ...section("Alpha"),
        ...section("Beta"),
        ...section("Gamma"),
      ],
    });

    await openAs(pageB, "user-b", docId);
    await expect(pageB.locator(".tiptap")).toContainText("Gamma notes", {
      timeout: 30_000,
    });

    const headingA = (text: string) =>
      pageA.locator(".tiptap h2").filter({ hasText: text });
    const notesA = (text: string) =>
      pageA.locator(".tiptap p").filter({ hasText: text });
    const betaId = await headingA("Beta Section").getAttribute("data-toc-id");
    expect(betaId).toBeTruthy();
    const betaA = pageA.locator(`.tiptap h2[data-toc-id="${betaId}"]`);

    await editorA.openFilter();
    await editorA.typeFilter("alpha");
    await editorA.commitFilter();
    await expect(betaA).toHaveClass(/heading-section-folded/);
    await expect(notesA("Beta notes")).toHaveClass(/heading-fold-hidden/);
    await expect(headingA("Gamma Section")).toHaveClass(
      /heading-section-folded/,
    );

    // B renames Beta so it now matches A's filter.
    await pageB.evaluate(() => {
      const editor = window.__tiptap_editor;
      let at = -1;
      editor?.state.doc.forEach((node, pos) => {
        if (node.textContent === "Beta Section") at = pos + 1;
      });
      if (at < 0) throw new Error("No Beta heading");
      editor?.commands.insertContentAt(at, "Alpha ");
    });

    await expect(betaA).toHaveText("Alpha Beta Section", { timeout: 15_000 });
    await expect(betaA).not.toHaveClass(/heading-section-folded/);
    await expect(notesA("Beta notes")).not.toHaveClass(/heading-fold-hidden/);
    await expect(headingA("Gamma Section")).toHaveClass(
      /heading-section-folded/,
    );

    // B adds a section that does not match: it arrives folded.
    await pageB.evaluate((content) => {
      const editor = window.__tiptap_editor;
      editor?.commands.insertContentAt(editor.state.doc.content.size, content);
    }, section("Delta"));

    await expect(headingA("Delta Section")).toHaveClass(
      /heading-section-folded/,
      { timeout: 15_000 },
    );
    await expect(notesA("Delta notes")).toHaveClass(/heading-fold-hidden/);

    await contextA.close();
    await contextB.close();
  });
});
