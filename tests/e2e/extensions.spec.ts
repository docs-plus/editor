import { expect, type Page, test } from "@playwright/test";

import { EditorPage } from "./helpers/editor-page";
import { getPlaywrightModifierKey } from "./helpers/playwright-modifier-key";

const BASE_DOC = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "Extensions" }],
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Read " },
        {
          type: "text",
          text: "the docs",
          marks: [{ type: "hyperlink", attrs: { href: "https://docs.plus" } }],
        },
        { type: "text", text: " today." },
      ],
    },
    { type: "paragraph" },
  ],
};

/** Puts the caret inside the last paragraph of the document. */
async function focusLastParagraph(page: Page): Promise<void> {
  await page.evaluate(() => {
    const editor = window.__tiptap_editor;
    if (!editor) return;
    let pos = 0;
    editor.state.doc.forEach((node, offset) => {
      if (node.type.name === "paragraph") pos = offset + 1;
    });
    editor.chain().focus().setTextSelection(pos).run();
  });
  // Tiptap moves DOM focus on the next frame; typing earlier drops keys.
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.activeElement?.classList.contains("ProseMirror") ?? false,
      ),
    )
    .toBe(true);
}

async function topLevelTypes(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const types: string[] = [];
    window.__tiptap_editor?.state.doc.forEach((node) => {
      types.push(node.type.name);
    });
    return types;
  });
}

test.describe("docs.plus extensions", () => {
  let editorPage: EditorPage;

  test.beforeEach(async ({ page }) => {
    editorPage = new EditorPage(page);
    await editorPage.goto();
    await editorPage.waitForSync();
    await editorPage.setContent(BASE_DOC);
  });

  test("clicking a link opens the hyperlink preview popover", async ({
    page,
  }) => {
    await page.locator(".tiptap a", { hasText: "the docs" }).click();
    const preview = page.locator(".hyperlink-preview-popover");
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("https://docs.plus");
  });

  test("Mod-K on a selection creates a link", async ({ page }) => {
    await focusLastParagraph(page);
    await editorPage.typeText("link me");
    await page.keyboard.down("Shift");
    for (let i = 0; i < 2; i++) await page.keyboard.press("ArrowLeft");
    await page.keyboard.up("Shift");
    await page.keyboard.press(`${getPlaywrightModifierKey()}+k`);

    const urlInput = page
      .getByRole("dialog", { name: "Add link" })
      .locator("input")
      .first();
    await urlInput.fill("example.org");
    await urlInput.press("Enter");

    await expect(page.locator(".tiptap a", { hasText: "me" })).toHaveAttribute(
      "href",
      "https://example.org",
    );
  });

  test("backticks create inline code and Tab indents a paragraph", async ({
    page,
  }) => {
    await focusLastParagraph(page);
    await editorPage.typeText("Call `render()` now");
    await expect(page.locator(".tiptap p code")).toHaveText("render()");

    await page.evaluate(() => {
      const editor = window.__tiptap_editor;
      if (!editor) return;
      editor.commands.setTextSelection(editor.state.selection.$from.start());
    });
    await page.keyboard.press("Tab");
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__tiptap_editor?.state.selection.$from.parent.textContent,
        ),
      )
      .toBe("  Call render() now");
  });

  test("toolbar inserts a Mermaid diagram that renders", async ({ page }) => {
    await focusLastParagraph(page);
    await page.getByRole("button", { name: "Insert diagram" }).click();

    const preview = page.locator(".mermaid-diagram__preview").first();
    await expect(preview).toHaveAttribute("data-state", "ready", {
      timeout: 15000,
    });
    await expect(preview.locator("svg").first()).toBeVisible();
  });

  test("embed media popover stacks consecutive embeds", async ({ page }) => {
    await focusLastParagraph(page);
    const embed = async (url: string) => {
      await page.getByRole("button", { name: "Embed media" }).click();
      await page.getByLabel("Media URL").fill(url);
      await page.getByRole("button", { name: "Embed", exact: true }).click();
    };

    await embed("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    await embed("https://example.com/media/clip.mp4");

    await expect
      .poll(() => topLevelTypes(page))
      .toEqual(["heading", "paragraph", "youtube", "video", "paragraph"]);
    await expect(
      page.locator('.tiptap iframe[src^="https://www.youtube.com/embed/"]'),
    ).toHaveCount(1);
  });

  test("embed media popover rejects unsafe URLs", async ({ page }) => {
    await focusLastParagraph(page);
    await page.getByRole("button", { name: "Embed media" }).click();
    await page.getByLabel("Media URL").fill("javascript:alert(1)");
    await page.getByRole("button", { name: "Embed", exact: true }).click();

    await expect(page.getByText(/Unsupported link/)).toBeVisible();
    expect(await topLevelTypes(page)).toEqual([
      "heading",
      "paragraph",
      "paragraph",
    ]);
  });
});
