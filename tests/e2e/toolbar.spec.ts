import { expect, type Page, test } from "@playwright/test";

import { generateLargeDocument } from "@/tests/helpers/document-generators";

import { openToolbarTestDoc } from "./helpers/a11y";

const toolbarButton = (page: Page, name: string) =>
  page.getByRole("toolbar").getByRole("button", { name, exact: true });

test.describe("toolbar focus and disabled controls", () => {
  test("focus stays in the toolbar when the document turns read-only", async ({
    page,
  }) => {
    await openToolbarTestDoc(page);
    const indent = toolbarButton(page, "Indent");
    await page.keyboard.press("Shift");
    await indent.focus();
    await expect(indent).toBeFocused();

    await page.evaluate(() => window.__tiptap_editor?.setEditable(false));

    await expect
      .poll(() =>
        page.evaluate(
          () => !!document.activeElement?.closest('[role="toolbar"]'),
        ),
      )
      .toBe(true);
  });

  test("a disabled Undo explains itself via aria-describedby", async ({
    page,
  }) => {
    await openToolbarTestDoc(page);
    const undo = toolbarButton(page, "Undo");
    await expect(undo).toHaveAttribute("aria-disabled", "true");
    await expect
      .poll(() =>
        undo.evaluate((el) =>
          (el.getAttribute("aria-describedby") ?? "")
            .split(" ")
            .map((id) => document.getElementById(id)?.textContent)
            .filter(Boolean),
        ),
      )
      .toContain("Nothing to undo");
  });

  test("an aria-disabled menu trigger stays closed", async ({ page }) => {
    await openToolbarTestDoc(page);
    // Lists cannot apply to a selected horizontal rule, so the trigger is disabled.
    await page.evaluate(() => {
      const editor = window.__tiptap_editor;
      if (!editor) throw new Error("editor missing");
      editor
        .chain()
        .focus()
        .insertContentAt(editor.state.doc.content.size, {
          type: "horizontalRule",
        })
        .run();
      let rulePos = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "horizontalRule") rulePos = pos;
      });
      editor.commands.setNodeSelection(rulePos);
    });
    const list = toolbarButton(page, "List");
    await expect(list).toHaveAttribute("aria-disabled", "true");
    const menu = page.getByRole("menu");

    await list.click({ force: true });
    await expect(menu).toHaveCount(0);

    await page.keyboard.press("Shift");
    await list.focus();
    await page.keyboard.press("Enter");
    await expect(menu).toHaveCount(0);
    await page.keyboard.press("ArrowDown");
    await expect(menu).toHaveCount(0);
  });

  test("text style menu is a menu button named by its value with radio items", async ({
    page,
  }) => {
    const editorPage = await openToolbarTestDoc(page);
    await editorPage.buildDocument([
      { level: 1, text: "Title" },
      { level: 2, text: "Section" },
    ]);
    await page.keyboard.press("ArrowUp");
    const trigger = toolbarButton(page, "Heading 2");
    await expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    await expect(trigger).not.toHaveAttribute("aria-pressed", /.*/);
    await trigger.click();
    const checked = page.getByRole("menuitemradio", { name: "Heading 2" });
    await expect(checked).toHaveAttribute("aria-checked", "true");
    await checked.click();
    // Still a heading: picking the checked item is a no-op.
    await expect(toolbarButton(page, "Heading 2")).toBeVisible();
  });

  test("picking a text style returns focus to the editor", async ({ page }) => {
    const editorPage = await openToolbarTestDoc(page);
    await editorPage.buildDocument([{ level: 1, text: "Title" }]);
    await page.keyboard.type("Body");
    await toolbarButton(page, "Normal text").click();
    await page.getByRole("menuitemradio", { name: "Heading 2" }).click();
    await page.keyboard.type("X");
    await expect(page.locator(".tiptap h2")).toContainText("BodyX");
  });
});

test.describe("indent in lists", () => {
  test("indent button nests a list item and outdent lifts it back", async ({
    page,
  }) => {
    await openToolbarTestDoc(page);
    await page.keyboard.press("Enter");
    await page.keyboard.type("- one");
    await page.keyboard.press("Enter");
    await page.keyboard.type("two");

    await toolbarButton(page, "Indent").click();
    await expect(page.locator(".tiptap ul ul li")).toHaveText("two");

    await toolbarButton(page, "Outdent").click();
    await expect(page.locator(".tiptap ul ul")).toHaveCount(0);
  });
});

test.describe("focus not obscured by the sticky toolbar", () => {
  const toolbarBottom = async (page: Page) => {
    const box = await page.getByRole("toolbar").boundingBox();
    return box!.y + box!.height;
  };

  test("scrollIntoView keeps a heading below the toolbar", async ({ page }) => {
    const editorPage = await openToolbarTestDoc(page);
    await editorPage.setContent(generateLargeDocument(30));
    await page.evaluate(() => {
      const wrapper = document.querySelector(".document-editor-wrapper");
      if (wrapper) wrapper.scrollTop = wrapper.scrollHeight;
    });

    const heading = page.locator(".tiptap").getByRole("heading").nth(10);
    await heading.evaluate((el) => el.scrollIntoView({ block: "start" }));

    const bottom = await toolbarBottom(page);
    expect((await heading.boundingBox())!.y).toBeGreaterThanOrEqual(bottom - 1);
  });

  test("the caret is never hidden behind the toolbar", async ({ page }) => {
    const editorPage = await openToolbarTestDoc(page);
    await editorPage.setContent(generateLargeDocument(30));

    // Park paragraph 20 right under the toolbar, then let ProseMirror scroll
    // the selection into view (native ArrowUp scrolling is not deterministic).
    const pos = await page.evaluate(() => {
      const ed = window.__tiptap_editor!;
      let seen = 0;
      let found = 0;
      ed.state.doc.descendants((node, p) => {
        if (found || node.type.name !== "paragraph") return;
        if (++seen === 20) found = p + 1;
      });
      const dom = ed.view.nodeDOM(found - 1) as HTMLElement;
      const wrapper = document.querySelector(".document-editor-wrapper")!;
      wrapper.scrollTop +=
        dom.getBoundingClientRect().top - wrapper.getBoundingClientRect().top;
      return found;
    });
    await page.evaluate(
      (p) =>
        window.__tiptap_editor
          ?.chain()
          .setTextSelection(p)
          .scrollIntoView()
          .run(),
      pos,
    );

    const caretTop = await page.evaluate(() => {
      const ed = window.__tiptap_editor!;
      return ed.view.coordsAtPos(ed.state.selection.from).top;
    });
    expect(caretTop).toBeGreaterThanOrEqual(await toolbarBottom(page));
  });
});
