/**
 * Smart toolbar follow-ups from the a11y review (contract §10): one Esc
 * from the row (M3), Alt+F10 at the narrow tiers, the short style value at
 * T5 (M8) and the connection chip at 320px (M15). The outline overlay
 * (M11) is in `outline-overlay.spec.ts`, the lazy hint in
 * `lazy-surfaces.spec.ts`.
 */
import { expect, type Page, test } from "@playwright/test";

import { openToolbarTestDoc } from "./helpers/a11y";
import { EditorPage } from "./helpers/editor-page";

const row = (page: Page) =>
  page.locator('[role="toolbar"][data-variant="fixed"]');
const styleTrigger = (page: Page) =>
  row(page).locator('[data-toolbar-group="style"] button');
const tooltip = (page: Page) =>
  page.locator('[data-slot="tooltip-content"][data-open]');

const editorFocused = (page: Page) =>
  page.locator(".tiptap").evaluate((el) => el === document.activeElement);
const focusInRow = (page: Page) =>
  row(page).evaluate((el) => el.contains(document.activeElement));
const focusedName = (page: Page) =>
  page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
const selectionRange = (page: Page) =>
  page.evaluate(() => {
    const selection = window.__tiptap_editor?.state.selection;
    return { from: selection?.from, to: selection?.to };
  });

test.describe("Esc from the row (M3)", () => {
  test("one Esc returns to the editor with its selection, tooltip and all", async ({
    page,
  }) => {
    await openToolbarTestDoc(page);
    await page.keyboard.type("Selected title");
    for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowLeft");
    await expect
      .poll(async () => {
        const { from = 0, to = 0 } = await selectionRange(page);
        return to - from;
      })
      .toBe(5);
    const before = await selectionRange(page);

    // Alt+F10 goes to the selection bubble when it has opened by now, else
    // the row: either way the same toolbar keys apply.
    await page.keyboard.press("Alt+F10");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    expect(
      await page.evaluate(() =>
        Boolean(document.activeElement?.closest('[role="toolbar"]')),
      ),
    ).toBe(true);
    // Keyboard focus shows the item's tooltip.
    await expect(tooltip(page)).toBeVisible();

    await page.keyboard.press("Escape");
    expect(await editorFocused(page)).toBe(true);
    expect(await selectionRange(page)).toEqual(before);
    await expect(tooltip(page)).toHaveCount(0);
  });

  test("a hover tooltip still closes on Esc with focus in the editor (WCAG 1.4.13)", async ({
    page,
  }) => {
    await openToolbarTestDoc(page);
    await row(page).getByRole("button", { name: "Bold", exact: true }).hover();
    await expect(tooltip(page)).toBeVisible();
    expect(await editorFocused(page)).toBe(true);

    await page.keyboard.press("Escape");
    await expect(tooltip(page)).toHaveCount(0);
    expect(await editorFocused(page)).toBe(true);
  });
});

test.describe("Alt+F10 at the narrow tiers", () => {
  /**
   * Alt+F10, three arrows and one Esc, again and again: every step stays
   * in the row, the first lands on View ▾ (T4 and below), later ones on
   * the item left last, and Esc returns to the editor.
   */
  async function roundTrips(page: Page, times: number) {
    let stop = "View";
    for (let round = 0; round < times; round += 1) {
      await page.keyboard.press("Alt+F10");
      expect(await focusedName(page)).toBe(stop);
      for (let step = 0; step < 3; step += 1) {
        await page.keyboard.press("ArrowRight");
        expect(await focusInRow(page)).toBe(true);
      }
      await page.keyboard.press("ArrowLeft");
      expect(await focusInRow(page)).toBe(true);
      stop = (await focusedName(page)) ?? "";
      await page.keyboard.press("Escape");
      expect(await editorFocused(page)).toBe(true);
    }
  }

  test("at 800px, loaded there", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    await openToolbarTestDoc(page);
    await roundTrips(page, 6);
  });

  test("at 800px, after the tab stop was hidden by a resize", async ({
    page,
  }) => {
    await openToolbarTestDoc(page);
    // At 1280px the stop is "Toggle outline", which T4 hides.
    await page.keyboard.press("Alt+F10");
    expect(await focusedName(page)).toBe("Toggle outline");
    await page.keyboard.press("Escape");
    expect(await editorFocused(page)).toBe(true);
    await page.setViewportSize({ width: 800, height: 900 });
    await expect(
      row(page).getByRole("button", { name: "Toggle outline" }),
    ).toBeHidden();
    await roundTrips(page, 6);
  });
});

test.describe("text style value at T5 (M8)", () => {
  const doc = {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Style title" }],
      },
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Second level" }],
      },
      { type: "paragraph", content: [{ type: "text", text: "Body text" }] },
    ],
  };

  async function caretIn(page: Page, selector: string) {
    await page.locator(`.tiptap ${selector}`).first().click();
  }

  test("shows H2, Text and Title in full at 800px, named with the long value", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    const editorPage = await openToolbarTestDoc(page);
    await editorPage.setContent(doc);
    const trigger = styleTrigger(page);
    const short = trigger.locator(".st-short");

    for (const [selector, visible, name] of [
      ["h2", "H2", "H2 Heading 2"],
      ["p", "Text", "Text Normal text"],
      ["h1", "Title", "Title"],
    ] as const) {
      await caretIn(page, selector);
      await expect(trigger).toHaveAccessibleName(name);
      await expect(short).toBeVisible();
      // The visible text is the short value, never truncated ("N…").
      expect(
        await short.evaluate((el) => ({
          text: el.firstChild?.textContent,
          clipped: el.scrollWidth > el.clientWidth,
        })),
      ).toEqual({ text: visible, clipped: false });
    }
  });

  test("keeps the long value above T5", async ({ page }) => {
    const editorPage = await openToolbarTestDoc(page);
    await editorPage.setContent(doc);
    await caretIn(page, "h2");
    await expect(styleTrigger(page)).toHaveAccessibleName("Heading 2");
    await expect(styleTrigger(page).locator(".st-short")).toBeHidden();
  });
});

test.describe("connection chip reflow (M15)", () => {
  for (const width of [320, 375]) {
    test(`nothing is clipped at ${width}px`, async ({ page }) => {
      await page.addInitScript(() =>
        localStorage.setItem(
          "tinydocy-user",
          JSON.stringify({
            name: "Bartholomew Featherstonehaugh",
            color: "#e11d48",
          }),
        ),
      );
      await page.setViewportSize({ width, height: 700 });
      const editorPage = new EditorPage(page);
      await editorPage.goto();
      await editorPage.waitForSync();
      const chip = page.locator("[data-collab-status]");
      await expect(chip).toContainText("online");
      const outside = await chip.evaluate((root) => {
        const width = document.documentElement.clientWidth;
        return [root, ...root.querySelectorAll<HTMLElement>("*")]
          .filter((el) => el.checkVisibility() && !el.closest(".sr-only"))
          .map((el) => ({ el, rect: el.getBoundingClientRect() }))
          .filter(
            ({ rect }) =>
              rect.width > 0 && (rect.left < 0 || rect.right > width),
          )
          .map(({ el }) => el.outerHTML.slice(0, 80));
      });
      expect(outside).toEqual([]);
    });
  }
});
