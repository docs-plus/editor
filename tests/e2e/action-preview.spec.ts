/**
 * Hover preview (smart toolbar later phase): pointing at a colour swatch
 * with a mouse, or arrowing to one, shows it on the selection with
 * decorations only. Nothing is written. On a touch-first device a tap or
 * pointer shows nothing, while a hardware keyboard's arrows still preview.
 */
import { expect, type Locator, type Page, test } from "@playwright/test";

import { HIGHLIGHT_PALETTE, TEXT_COLOR_PALETTE } from "@/lib/text-style-tokens";

import { resolveRgb } from "./helpers/a11y";
import { EditorPage } from "./helpers/editor-page";

const text = (value: string, marks?: unknown[]) => ({
  type: "text",
  text: value,
  ...(marks ? { marks } : {}),
});
const paragraph = (...content: unknown[]) => ({ type: "paragraph", content });

const DOC = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [text("Title")] },
    paragraph(text("Select some words in this paragraph")),
    paragraph(
      text("Already "),
      text("blue words", [{ type: "textColor", attrs: { color: "blue" } }]),
      text(" here"),
    ),
    paragraph(
      text("Already "),
      text("yellow words", [{ type: "highlight", attrs: { color: "yellow" } }]),
      text(" here"),
    ),
  ],
};

/** Past the 80 ms dwell, with room for a dev-server frame. */
const DWELL = 250;

const row = (page: Page) =>
  page.getByRole("toolbar", { name: "Formatting", exact: true });
const bubble = (page: Page) => page.locator("[data-smart-bubble]");
const previews = (page: Page) => page.locator(".tiptap .tt-preview");

async function openDoc(page: Page): Promise<EditorPage> {
  const editorPage = new EditorPage(page);
  await editorPage.goto();
  await editorPage.waitForSync();
  await editorPage.setContent(DOC);
  return editorPage;
}

/** Selects `needle` with a focused editor. */
async function selectText(page: Page, needle: string) {
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

const docJson = (page: Page) =>
  page.evaluate(() => JSON.stringify(window.__tiptap_editor?.getJSON()));

/** Opens the row's colour popover with the mouse; resolves its dialog. */
async function openPopover(
  page: Page,
  kind: "text" | "highlight",
): Promise<Locator> {
  await row(page)
    .getByRole("button", {
      name: kind === "text" ? "More text colours" : "More highlight colours",
    })
    .click();
  const dialog = page.getByRole("dialog", {
    name: kind === "text" ? "Text colours" : "Highlight colours",
  });
  await expect(dialog.locator(".st-swatch").first()).toBeVisible();
  return dialog;
}

/** The computed colour (or background) of the innermost preview element. */
const previewStyle = (page: Page, property: "color" | "backgroundColor") =>
  page.evaluate((prop) => {
    const all = document.querySelectorAll<HTMLElement>(".tiptap .tt-preview");
    const inner = all[all.length - 1];
    return inner ? getComputedStyle(inner)[prop] : null;
  }, property);

test.describe("hover preview", () => {
  test("hovering Red previews it on the selection; leaving restores; the doc is unchanged", async ({
    page,
  }) => {
    await openDoc(page);
    await selectText(page, "some words");
    const before = await docJson(page);
    const dialog = await openPopover(page, "text");
    // Opening the popover previews nothing.
    await expect(previews(page)).toHaveCount(0);

    await dialog.getByRole("button", { name: "Red text" }).hover();
    await expect(previews(page)).toHaveText("some words");
    const red = await resolveRgb(page, TEXT_COLOR_PALETTE.red.light);
    const shown = await previewStyle(page, "color");
    expect(await resolveRgb(page, shown ?? "")).toEqual(red);
    expect(await docJson(page)).toBe(before);

    // Off the swatch (still inside the popover): the preview goes.
    await dialog.locator(".st-color-row-label").first().hover();
    await expect(previews(page)).toHaveCount(0);
    expect(await docJson(page)).toBe(before);
  });

  test("opening with the keyboard previews nothing; arrows preview; Esc clears and returns focus", async ({
    page,
  }) => {
    await openDoc(page);
    await selectText(page, "some words");
    // The bubble's keyboard path (Alt+F10, then B I U → A▾).
    await expect(bubble(page)).toHaveAttribute("data-state", "open");
    await page.keyboard.press("Alt+F10");
    const chevron = bubble(page).getByRole("button", {
      name: "More text colours",
    });
    for (let i = 0; i < 4; i += 1) await page.keyboard.press("ArrowRight");
    await expect(chevron).toBeFocused();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Text colours" });
    await expect(dialog.locator("button:focus")).toHaveCount(1);
    await page.waitForTimeout(DWELL);
    await expect(previews(page)).toHaveCount(0);

    // "Default text" has focus; → is the first colour.
    await page.keyboard.press("ArrowRight");
    await expect(dialog.locator("button:focus")).toHaveAccessibleName(
      "Gray text",
    );
    await expect(previews(page)).toHaveAttribute("data-text-color", "gray");
    await page.keyboard.press("ArrowRight");
    await expect(previews(page)).toHaveAttribute("data-text-color", "brown");

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(chevron).toBeFocused();
    await expect(previews(page)).toHaveCount(0);
  });

  test("applying replaces the preview with the real mark: one undo step, as before", async ({
    page,
  }) => {
    await openDoc(page);
    await selectText(page, "some words");
    const before = await docJson(page);
    const dialog = await openPopover(page, "text");
    const swatch = dialog.getByRole("button", { name: "Red text" });
    await swatch.hover();
    await expect(previews(page)).toHaveCount(1);
    await swatch.click();
    await expect(swatch).toHaveAttribute("aria-pressed", "true");
    await expect(previews(page)).toHaveCount(0);
    await expect(
      page.locator('.tiptap span[data-text-color="red"]:not(.tt-preview)'),
    ).toHaveText("some words");

    // One undo step restores the text, as before previews existed.
    await page.evaluate(() => window.__tiptap_editor?.commands.undo());
    expect(await docJson(page)).toBe(before);
  });

  test("red over blue and 'No highlight' over yellow show the previewed result", async ({
    page,
  }) => {
    await openDoc(page);
    await selectText(page, "blue words");
    let dialog = await openPopover(page, "text");
    await dialog.getByRole("button", { name: "Red text" }).hover();
    await expect(previews(page)).toHaveCount(1);
    expect(
      await resolveRgb(page, (await previewStyle(page, "color")) ?? ""),
    ).toEqual(await resolveRgb(page, TEXT_COLOR_PALETTE.red.light));
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    await selectText(page, "yellow words");
    dialog = await openPopover(page, "highlight");
    await dialog.getByRole("button", { name: "Red highlight" }).hover();
    await expect(previews(page)).toHaveCount(1);
    expect(
      await resolveRgb(
        page,
        (await previewStyle(page, "backgroundColor")) ?? "",
      ),
    ).toEqual(await resolveRgb(page, HIGHLIGHT_PALETTE.red.light));

    await dialog.getByRole("button", { name: "No highlight" }).hover();
    await expect(previews(page)).not.toHaveAttribute("data-highlight");
    const pageBackground = await page.evaluate(() =>
      getComputedStyle(document.body).getPropertyValue("--background").trim(),
    );
    expect(
      await resolveRgb(
        page,
        (await previewStyle(page, "backgroundColor")) ?? "",
      ),
    ).toEqual(await resolveRgb(page, pageBackground));
  });

  test("the bubble stays open while previewing from its popover", async ({
    page,
  }) => {
    await openDoc(page);
    await selectText(page, "some words");
    await expect(bubble(page)).toHaveAttribute("data-state", "open");
    await bubble(page)
      .getByRole("button", { name: "More text colours" })
      .click();
    const dialog = page.getByRole("dialog", { name: "Text colours" });
    await dialog.getByRole("button", { name: "Green text" }).hover();
    await expect(previews(page)).toHaveAttribute("data-text-color", "green");
    // Past the bubble plugin's 250 ms update debounce.
    await page.waitForTimeout(400);
    await expect(bubble(page)).toHaveAttribute("data-state", "open");
    await expect(previews(page)).toHaveCount(1);
  });

  test("the toolbar does not re-render while previewing", async ({ page }) => {
    await openDoc(page);
    await selectText(page, "some words");
    const dialog = await openPopover(page, "text");
    // Park the pointer in the popover and let the open settle: leaving the
    // chevron closes its tooltip, which is a toolbar commit of its own.
    await dialog.locator(".st-color-row-label").first().hover();
    await page.waitForTimeout(1000);
    await page.evaluate(() => {
      window.__toolbarCommits = 0;
    });
    for (const name of ["Red text", "Blue text", "Green text", "Pink text"]) {
      await dialog.getByRole("button", { name }).hover();
      await expect(previews(page)).toHaveCount(1);
    }
    await dialog.locator(".st-color-row-label").first().hover();
    await expect(previews(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.__toolbarCommits ?? 0)).toBe(0);
  });

  test("a swatch that cannot apply previews nothing", async ({ page }) => {
    await openDoc(page);
    await selectText(page, "some words");
    await page.evaluate(() => window.__tiptap_editor?.setEditable(false));
    await page.evaluate(() => window.__tiptap_editor?.setEditable(true));
    // Read-only: no preview even when the popover is reachable.
    const dialog = await openPopover(page, "text");
    await page.evaluate(() => window.__tiptap_editor?.setEditable(false));
    await dialog.getByRole("button", { name: "Red text" }).hover();
    await page.waitForTimeout(DWELL);
    await expect(previews(page)).toHaveCount(0);
  });
});

test.describe("hover preview on touch", () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 1280, height: 800 },
  });

  test("touch: no preview; a tap applies as before", async ({ page }) => {
    await openDoc(page);
    expect(
      await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
    ).toBe(true);
    await selectText(page, "some words");
    await row(page).getByRole("button", { name: "More text colours" }).tap();
    const dialog = page.getByRole("dialog", { name: "Text colours" });
    const swatch = dialog.getByRole("button", { name: "Red text" });
    await expect(swatch).toBeVisible();
    await swatch.hover();
    await page.waitForTimeout(DWELL);
    await expect(previews(page)).toHaveCount(0);
    await swatch.tap();
    await expect(swatch).toHaveAttribute("aria-pressed", "true");
    await expect(previews(page)).toHaveCount(0);
  });

  test("touch with a hardware keyboard: arrows preview, a pointer does not; Esc clears", async ({
    page,
  }) => {
    await openDoc(page);
    expect(
      await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
    ).toBe(true);
    await selectText(page, "some words");
    const before = await docJson(page);
    // A keyboard open (Enter on the chevron) moves focus into the grid.
    const chevron = row(page).getByRole("button", {
      name: "More text colours",
    });
    await chevron.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Text colours" });
    await expect(dialog.locator("button:focus")).toHaveCount(1);
    await page.waitForTimeout(DWELL);
    await expect(previews(page)).toHaveCount(0);

    await page.keyboard.press("ArrowRight");
    await expect(dialog.locator("button:focus")).toHaveAccessibleName(
      "Gray text",
    );
    await expect(previews(page)).toHaveAttribute("data-text-color", "gray");
    await expect(previews(page)).toHaveText("some words");
    await page.keyboard.press("ArrowRight");
    await expect(previews(page)).toHaveAttribute("data-text-color", "brown");

    // A pointer (an iPad trackpad reports "mouse") neither previews nor
    // clears the keyboard's preview.
    await dialog.getByRole("button", { name: "Red text" }).hover();
    await dialog.locator(".st-color-row-label").first().hover();
    await page.waitForTimeout(DWELL);
    await expect(previews(page)).toHaveAttribute("data-text-color", "brown");
    expect(await docJson(page)).toBe(before);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(previews(page)).toHaveCount(0);
    expect(await docJson(page)).toBe(before);
  });
});
