/**
 * Smart toolbar design pass (§1–5) on desktop: the bubble's Paint format
 * brush (mouse, keyboard, Esc), Repeat with nothing remembered, the
 * status pill, and Your formats in the text style dropdown. Touch Paint
 * format and the phone pill are in `mobile-bar.spec.ts`.
 */
import { expect, type Page, test } from "@playwright/test";

import { EditorPage } from "./helpers/editor-page";

const text = (value: string, marks?: unknown[]) => ({
  type: "text",
  text: value,
  ...(marks ? { marks } : {}),
});

const DOC = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [text("Title")] },
    {
      type: "paragraph",
      content: [
        text("source", [
          { type: "bold" },
          { type: "highlight", attrs: { color: "yellow" } },
        ]),
        text(" then target words here"),
      ],
    },
    { type: "paragraph", content: [text("another plain line")] },
  ],
};

const bubbleToolbar = (page: Page) =>
  page.getByRole("toolbar", { name: "Selection formatting" });
const brush = (page: Page) =>
  bubbleToolbar(page).getByRole("button", { name: "Paint format" });
const pill = (page: Page) => page.locator('[data-status-pill="desktop"]');
const row = (page: Page) =>
  page.getByRole("toolbar", { name: "Formatting", exact: true });
const repeatKey = process.platform === "darwin" ? "Meta+Alt+KeyV" : "F4";

async function openDoc(page: Page) {
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.waitForSync();
  await editor.setContent(DOC);
}

/** The document position range of the first `needle`. */
async function rangeOf(page: Page, needle: string) {
  return page.evaluate((target) => {
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
    return { from, to: from + target.length };
  }, needle);
}

async function select(page: Page, needle: string) {
  const range = await rangeOf(page, needle);
  await page.evaluate(
    (r) => window.__tiptap_editor?.chain().focus().setTextSelection(r).run(),
    range,
  );
  // Tiptap focuses a frame later: keys before that go to the page.
  await expect(page.locator(".tiptap")).toBeFocused();
}

/** Drag-selects `needle` with the mouse (a real pointer selection). */
async function dragSelect(page: Page, needle: string) {
  const range = await rangeOf(page, needle);
  const box = await page.evaluate(({ from, to }) => {
    const view = window.__tiptap_editor?.view;
    if (!view) throw new Error("editor missing");
    const start = view.coordsAtPos(from);
    const end = view.coordsAtPos(to);
    return {
      x1: start.left + 1,
      x2: end.right - 1,
      y: (start.top + start.bottom) / 2,
    };
  }, range);
  await page.mouse.move(box.x1, box.y);
  await page.mouse.down();
  await page.mouse.move(box.x2, box.y, { steps: 5 });
  await page.mouse.up();
}

/** Mark names on the first text node of `needle`. */
const marksOf = (page: Page, needle: string) =>
  page.evaluate(async (target) => {
    const editor = window.__tiptap_editor;
    let names: string[] = [];
    editor?.state.doc.descendants((node) => {
      if (node.isText && node.text?.includes(target)) {
        names = node.marks.map((mark) => mark.type.name).sort();
        return false;
      }
      return true;
    });
    return names;
  }, needle);

test.describe("Paint format", () => {
  test("by mouse: click the brush, drag over text; one undo step", async ({
    page,
  }) => {
    await openDoc(page);
    await select(page, "source");
    await expect(brush(page)).toBeVisible();
    await brush(page).click();
    await expect(brush(page)).toHaveAttribute("aria-pressed", "true");
    await expect(pill(page)).toHaveText("Select text to paint · Esc to cancel");
    await expect(
      page.getByRole("status").filter({
        hasText: "Picked up Bold, Yellow highlight. Select text to apply.",
      }),
    ).toBeAttached();
    // The copy cursor while armed.
    await expect(page.locator(".document-editor-content")).toHaveClass(
      /is-painting/,
    );
    expect(
      await page
        .locator(".tiptap p")
        .first()
        .evaluate((el) => getComputedStyle(el).cursor),
    ).toBe("copy");

    await dragSelect(page, "target");
    await expect
      .poll(() => marksOf(page, "target"))
      .toEqual(["bold", "highlight"]);
    await expect(pill(page)).toHaveText("Formatting applied");
    await expect(page.locator(".document-editor-content")).not.toHaveClass(
      /is-painting/,
    );
    // One undo step.
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => marksOf(page, "target")).toEqual([]);
    expect(await marksOf(page, "source")).toEqual(["bold", "highlight"]);
  });

  test("by keyboard: Alt+F10 to the brush, Esc back to the text, Shift+arrows, ⌘⌥V", async ({
    page,
  }) => {
    await openDoc(page);
    await select(page, "source");
    await expect(brush(page)).toBeVisible();
    await page.keyboard.press("Alt+F10");
    for (let step = 0; step < 10; step += 1) {
      if (await brush(page).evaluate((el) => el === document.activeElement)) {
        break;
      }
      await page.keyboard.press("ArrowRight");
    }
    await expect(brush(page)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(brush(page)).toHaveAttribute("aria-pressed", "true");
    // Esc on the brush returns to the text and keeps Paint format armed.
    await page.keyboard.press("Escape");
    await expect(page.locator(".tiptap")).toBeFocused();
    await expect(page.locator(".document-editor-content")).toHaveClass(
      /is-painting/,
    );
    // "source" is selected: to the start of "target", then select it.
    await page.keyboard.press("ArrowRight");
    for (let i = 0; i < " then ".length; i += 1) {
      await page.keyboard.press("ArrowRight");
    }
    for (let i = 0; i < "target".length; i += 1) {
      await page.keyboard.press("Shift+ArrowRight");
    }
    await expect
      .poll(() =>
        page.evaluate(() => {
          const { from, to } = window.__tiptap_editor?.state.selection ?? {};
          return window.__tiptap_editor?.state.doc.textBetween(
            from ?? 0,
            to ?? 0,
          );
        }),
      )
      .toBe("target");
    await page.keyboard.press(repeatKey);
    await expect
      .poll(() => marksOf(page, "target"))
      .toEqual(["bold", "highlight"]);
    await expect(pill(page)).toHaveText("Formatting applied");
    await expect(page.locator(".document-editor-content")).not.toHaveClass(
      /is-painting/,
    );
  });

  test("by keyboard: activating the brush again applies to the new selection", async ({
    page,
  }) => {
    await openDoc(page);
    await select(page, "source");
    await brush(page).click();
    await select(page, "another");
    await expect(brush(page)).toHaveAttribute("aria-pressed", "true");
    await brush(page).focus();
    await page.keyboard.press("Enter");
    await expect
      .poll(() => marksOf(page, "another"))
      .toEqual(["bold", "highlight"]);
  });

  test("Esc in the text cancels without applying", async ({ page }) => {
    await openDoc(page);
    await select(page, "source");
    await brush(page).click();
    await expect(brush(page)).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(page.locator(".document-editor-content")).not.toHaveClass(
      /is-painting/,
    );
    await expect(pill(page)).toHaveCount(0);
    await dragSelect(page, "target");
    await page.waitForTimeout(200);
    expect(await marksOf(page, "target")).toEqual([]);
    await expect(brush(page)).toHaveAttribute("aria-pressed", "false");
  });

  test("a second click on the same selection cancels", async ({ page }) => {
    await openDoc(page);
    await select(page, "source");
    await brush(page).click();
    await expect(brush(page)).toHaveAttribute("aria-pressed", "true");
    await brush(page).click();
    await expect(brush(page)).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator(".document-editor-content")).not.toHaveClass(
      /is-painting/,
    );
  });

  test("⋯ → Paint format arms it too", async ({ page }) => {
    await openDoc(page);
    await select(page, "source");
    await row(page).getByRole("button", { name: "More formatting" }).click();
    await page.getByRole("menuitem", { name: "Paint format" }).click();
    await expect(pill(page)).toHaveText("Select text to paint · Esc to cancel");
    await dragSelect(page, "target");
    await expect
      .poll(() => marksOf(page, "target"))
      .toEqual(["bold", "highlight"]);
  });
});

test.describe("Repeat formatting", () => {
  test("with nothing remembered the key shows why on the pill", async ({
    page,
  }) => {
    await openDoc(page);
    await select(page, "target");
    await page.keyboard.press(repeatKey);
    const reason =
      "Nothing to repeat yet. Format some text or use Paint format.";
    await expect(pill(page)).toHaveText(reason);
    await expect(
      page.getByRole("status").filter({ hasText: reason }),
    ).toBeAttached();
    // 8px under the sticky row, centred over the page column.
    const [pillBox, rowBox, column] = await Promise.all([
      pill(page).boundingBox(),
      row(page).boundingBox(),
      page.locator(".document-editor-content").boundingBox(),
    ]);
    expect(
      Math.round((pillBox?.y ?? 0) - (rowBox?.y ?? 0) - (rowBox?.height ?? 0)),
    ).toBe(8);
    expect(
      Math.abs(
        (pillBox?.x ?? 0) +
          (pillBox?.width ?? 0) / 2 -
          ((column?.x ?? 0) + (column?.width ?? 0) / 2),
      ),
    ).toBeLessThanOrEqual(1);
    // Closes on its own after 2.5 s.
    await expect(pill(page)).toHaveCount(0, { timeout: 4000 });
  });

  test("after use the pill says what it repeated", async ({ page }) => {
    await openDoc(page);
    await select(page, "target");
    await page.keyboard.press("ControlOrMeta+b");
    await select(page, "another");
    await page.keyboard.press(repeatKey);
    await expect(pill(page)).toHaveText("Repeated Bold");
  });
});

const SAVED = {
  v: 1,
  formats: [
    {
      id: "fwarn",
      name: "Warning",
      bundle: { bold: true, textColor: "red" },
    },
    { id: "fnote", name: "Note", bundle: { italic: true } },
  ],
};

test.describe("Your formats in the text style dropdown", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((formats) => {
      if (!sessionStorage.getItem("seeded")) {
        localStorage.setItem("tinydocy-formats", JSON.stringify(formats));
        sessionStorage.setItem("seeded", "1");
      }
    }, SAVED);
  });

  const styleMenu = (page: Page) =>
    row(page).getByRole("button", { name: "Normal text" });

  test("each format is named in its own formatting and applies in one step", async ({
    page,
  }) => {
    await openDoc(page);
    await select(page, "target");
    await styleMenu(page).click();
    const menu = page.getByRole("menu", { name: "Text style" });
    await expect(
      menu.getByRole("group", { name: "Your formats" }),
    ).toBeVisible();
    const warning = menu.getByRole("menuitem", {
      name: "Warning",
      exact: true,
    });
    await expect(warning).toHaveAccessibleDescription("Bold, Red text");
    const preview = warning.locator(".st-format-preview");
    expect(
      await preview.evaluate((el) => {
        const style = getComputedStyle(el);
        return [style.fontWeight, style.color];
      }),
    ).toEqual(["700", "rgb(220, 38, 38)"]);
    // No "In this doc", no "Repeat formatting: …", no "Copy formatting".
    await expect(menu.getByText("In this doc")).toHaveCount(0);
    await expect(
      menu.getByText(/Repeat formatting|Copy formatting/),
    ).toHaveCount(0);
    await warning.click();
    await expect(menu).toBeHidden();
    await expect(page.locator(".tiptap")).toBeFocused();
    await expect
      .poll(() => marksOf(page, "target"))
      .toEqual(["bold", "textColor"]);
    await expect(pill(page)).toHaveText("Applied ‘Warning’");
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => marksOf(page, "target")).toEqual([]);
  });

  test("Save selection as format… opens the save view; the new format is listed", async ({
    page,
  }) => {
    await openDoc(page);
    // Nothing to save on plain text: disabled with the reason.
    await select(page, "target");
    await styleMenu(page).click();
    const save = page.getByRole("menuitem", {
      name: "Save selection as format…",
    });
    await expect(save).toHaveAttribute("aria-disabled", "true");
    await expect(save).toHaveAccessibleDescription(
      "Select formatted text to save it.",
    );
    await page.keyboard.press("Escape");

    await select(page, "source");
    await styleMenu(page).click();
    await save.click();
    const name = page.locator("[data-command-palette] input");
    await expect(name).toBeFocused();
    await name.fill("Callout");
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-command-palette]")).toHaveCount(0);
    await expect(pill(page)).toContainText("Callout");
    await select(page, "target");
    await styleMenu(page).click();
    await expect(
      page.getByRole("menuitem", { name: "Callout", exact: true }),
    ).toBeVisible();
  });

  test("Remove a format ▸ removes at once, with Undo on the pill", async ({
    page,
  }) => {
    await openDoc(page);
    await select(page, "target");
    await styleMenu(page).click();
    await page.getByRole("menuitem", { name: "Remove a format" }).click();
    const submenu = page.getByRole("menu", { name: "Remove a format" });
    await submenu.getByRole("menuitem", { name: "Warning" }).click();
    await expect(pill(page)).toContainText("Removed ‘Warning’");
    const stored = () =>
      page.evaluate(() =>
        JSON.parse(
          localStorage.getItem("tinydocy-formats") ?? "{}",
        ).formats.map((format: { name: string }) => format.name),
      );
    expect(await stored()).toEqual(["Note"]);
    await pill(page).getByRole("button", { name: /^Undo/ }).click();
    await expect.poll(stored).toEqual(["Warning", "Note"]);
    await styleMenu(page).click();
    await expect(
      page.getByRole("menuitem", { name: "Warning", exact: true }),
    ).toBeVisible();
  });
});
