import { expect, type Page, test } from "@playwright/test";

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
    const list = toolbarButton(page, "List options");
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
});
