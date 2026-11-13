import { expect, type Page, test } from "@playwright/test";

import { EditorPage, typeInNewParagraphAtEnd } from "./helpers/editor-page";

/**
 * Palette follow-ups from the a11y review of PR E: reduced motion, the
 * save view's Esc, name length hint, repeated errors and reasons read
 * again, and the order and ranking of the formatting rows.
 */

const PALETTE = "[data-command-palette]";
const search = (page: Page) => page.getByPlaceholder("Search actions…");
const options = (page: Page) => page.locator(`${PALETTE} [cmdk-item]`);

async function openDoc(page: Page): Promise<void> {
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.waitForSync();
  await typeInNewParagraphAtEnd(page, "alpha beta gamma delta");
}

async function select(page: Page, needle: string): Promise<void> {
  await page.evaluate((target) => {
    const editor = window.__tiptap_editor;
    if (!editor) throw new Error("editor missing");
    let from = -1;
    editor.state.doc.descendants((node, pos) => {
      if (from >= 0 || !node.isText) return from < 0;
      const at = node.text?.indexOf(target) ?? -1;
      if (at >= 0) from = pos + at;
      return from < 0;
    });
    if (from < 0) throw new Error(`"${target}" not found`);
    editor
      .chain()
      .focus()
      .setTextSelection({ from, to: from + target.length })
      .run();
  }, needle);
}

const selectionRange = (page: Page) =>
  page.evaluate(() => {
    const selection = window.__tiptap_editor?.state.selection;
    return { from: selection?.from, to: selection?.to };
  });

async function openPalette(page: Page) {
  await page.keyboard.press("Alt+Slash");
  await expect(search(page)).toBeFocused();
}

async function openSaveView(page: Page) {
  await openPalette(page);
  await page.keyboard.type("save as format");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Name")).toBeFocused();
}

/** Bold "alpha" (a Repeat bundle), then select bold "alpha" again. */
async function boldAlpha(page: Page) {
  await select(page, "alpha");
  await page.keyboard.press("ControlOrMeta+b");
}

test.describe("palette follow-ups", () => {
  test("does not zoom in under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openDoc(page);
    await openPalette(page);
    const animation = await page
      .locator(PALETTE)
      .evaluate((el) => getComputedStyle(el).animationName);
    expect(animation).toBe("none");
  });

  test("Esc in the save view goes back to the list; a second Esc closes", async ({
    page,
  }) => {
    await openDoc(page);
    await boldAlpha(page);
    const before = await selectionRange(page);
    await openSaveView(page);
    await page.keyboard.press("Escape");
    await expect(page.locator(PALETTE)).toBeVisible();
    await expect(search(page)).toBeFocused();
    await expect(page.getByRole("listbox", { name: "Actions" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(PALETTE)).toHaveCount(0);
    await expect(page.locator(".tiptap")).toBeFocused();
    expect(await selectionRange(page)).toEqual(before);
  });

  test("the name is capped at 40 with a visible hint, and a repeated error is read again", async ({
    page,
  }) => {
    await openDoc(page);
    await boldAlpha(page);
    await openSaveView(page);
    const name = page.getByLabel("Name");
    await expect(name).toHaveAccessibleDescription("Up to 40 characters");
    await expect(page.getByText("Up to 40 characters")).toBeVisible();
    await page.keyboard.type("y".repeat(50));
    await expect(name).toHaveValue("y".repeat(40));

    // A blank name cannot be submitted: Save stays disabled (§7).
    const save = page.getByRole("button", { name: "Save", exact: true });
    await name.fill("   ");
    await expect(save).toBeDisabled();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("alert")).toHaveCount(0);

    // A storage failure is the error left to show.
    await page.evaluate(() => {
      Storage.prototype.setItem = () => {
        throw new Error("QuotaExceededError");
      };
    });
    await name.fill("Callout");
    await page.keyboard.press("Enter");
    const alert = page.getByRole("alert");
    await expect(alert).toHaveText("This format could not be saved.");
    await expect(name).toHaveAccessibleDescription(
      "Up to 40 characters This format could not be saved.",
    );
    await alert.evaluate((el) => {
      (el as HTMLElement & { __seen?: true }).__seen = true;
    });
    await page.keyboard.press("Enter");
    await expect(alert).toHaveText("This format could not be saved.");
    // A new alert node, so assistive tech reads the same text again.
    expect(
      await alert.evaluate(
        (el) => (el as HTMLElement & { __seen?: true }).__seen === true,
      ),
    ).toBe(false);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
  });

  test("Enter on an unavailable row reads its reason", async ({ page }) => {
    await openDoc(page);
    await page.locator(".tiptap").click();
    await openPalette(page);
    await page.keyboard.type("repeat formatting");
    const status = page.locator(`${PALETTE} [role="status"]`);
    await expect(
      page.locator(`${PALETTE} [cmdk-item][data-selected="true"]`),
    ).toHaveAttribute("data-action-id", "repeat.apply");
    // Straight away: a pending result count must not talk over it.
    await page.keyboard.press("Enter");
    await expect(page.locator(PALETTE)).toBeVisible();
    await expect(status).toHaveText(
      /^Repeat formatting: Nothing to repeat yet\. Format some text or use Paint format\.$/,
    );
    await page.waitForTimeout(400);
    await expect(status).toContainText("Nothing to repeat yet");
    const first = await status.textContent();
    await page.keyboard.press("Enter");
    // Changed (a no-break space toggles), so it is read again.
    await expect
      .poll(() => status.evaluate((el) => el.textContent))
      .not.toBe(first);
    await expect(status).toContainText("Nothing to repeat yet");
    await page.keyboard.press("Escape");
  });

  test("Repeat is suggested, not repeated in Format, which opens with Paint format; Undo and Redo have their own group", async ({
    page,
  }) => {
    await openDoc(page);
    await boldAlpha(page);
    await select(page, "beta");
    await openPalette(page);
    const suggested = page.getByRole("group", { name: "Suggested here" });
    await expect(suggested.getByRole("option").first()).toHaveAttribute(
      "data-action-id",
      "repeat.apply",
    );
    const format = page.getByRole("group", { name: "Format" });
    const formatRows = format.getByRole("option");
    await expect(formatRows.nth(0)).toHaveAttribute(
      "data-action-id",
      "repeat.copy",
    );
    await expect(format.locator('[data-action-id="repeat.apply"]')).toHaveCount(
      0,
    );
    await expect(
      page
        .getByRole("group", { name: "History" })
        .getByRole("option", { name: /^Undo/ }),
    ).toBeVisible();
    await expect(format.getByRole("option", { name: /^Undo/ })).toHaveCount(0);
    await page.keyboard.press("Escape");
  });

  for (const bundle of [true, false]) {
    test(`"repeat" ranks Repeat formatting first (${bundle ? "with" : "without"} a bundle)`, async ({
      page,
    }) => {
      await openDoc(page);
      if (bundle) await boldAlpha(page);
      await select(page, "beta");
      await openPalette(page);
      await page.keyboard.type("repeat");
      await expect(options(page).first()).toHaveAttribute(
        "data-action-id",
        "repeat.apply",
      );
      // Paint format (`repeat.copy`) still matches, below it.
      await expect(
        page.getByRole("option", { name: /^Paint format/ }).first(),
      ).toBeVisible();
      await page.keyboard.press("Escape");
    });
  }

  for (const query of ["paint format", "format painter", "brush"]) {
    test(`"${query}" ranks Paint format first, above Repeat formatting`, async ({
      page,
    }) => {
      await openDoc(page);
      await boldAlpha(page);
      await select(page, "beta");
      await openPalette(page);
      await page.keyboard.type(query);
      const first = options(page).first();
      await expect(first).toHaveAttribute("data-action-id", "repeat.copy");
      await expect(first).toHaveAttribute("aria-selected", "true");
      await page.keyboard.press("Escape");
    });
  }

  test("typing keeps the highlighted row in view as groups reorder", async ({
    page,
  }) => {
    await openDoc(page);
    await select(page, "beta");
    await openPalette(page);
    // "for" highlights a row further down ("Forget my choices"); "format"
    // then moves Format's Paint format to the top as its group sorts first.
    for (const key of "format") {
      await page.keyboard.type(key);
      const selected = page.locator(
        `${PALETTE} [cmdk-item][data-selected="true"]`,
      );
      await expect(selected).toBeInViewport({ ratio: 1 });
    }
    await expect(
      page.locator(`${PALETTE} [cmdk-item][data-selected="true"]`),
    ).toHaveAttribute("data-action-id", "repeat.copy");
    await page.keyboard.press("Escape");
  });

  test("Repeat formatting is named alone, with what it applies as its second line", async ({
    page,
  }) => {
    await openDoc(page);
    await boldAlpha(page);
    await select(page, "beta");
    await openPalette(page);
    const repeat = page
      .getByRole("group", { name: "Suggested here" })
      .locator('[data-action-id="repeat.apply"]');
    await expect(repeat).toContainText("Repeat formatting");
    await expect(repeat.locator("span.truncate").first()).toHaveText(
      "Repeat formatting",
    );
    await expect(repeat.locator("span.truncate").nth(1)).toHaveText("Bold");
    await page.keyboard.press("Escape");
  });
});
