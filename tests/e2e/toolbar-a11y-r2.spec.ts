/**
 * Accessibility review r2 fixes: ladder focus repair (I1), the mixed state
 * (I4, I5), 44px touch menu items (I8), the colour popover's visible
 * low-contrast note, click roving and swatch borders (M1, M2, M12),
 * reduced motion (M5) and the empty slot's separator (M9).
 *
 * Set `A11Y_SCREENS_DIR` to save light/dark screenshots of the mixed state
 * and the touch menu.
 */
import { expect, type Locator, type Page, test } from "@playwright/test";

import {
  contrastRatio,
  openToolbarTestDoc,
  type Rgb,
  resolveRgb,
  setTheme,
} from "./helpers/a11y";

const SCREENS = process.env.A11Y_SCREENS_DIR;

const row = (page: Page) =>
  page.locator('[role="toolbar"][data-variant="fixed"]');

const rowButton = (page: Page, name: string | RegExp) =>
  row(page).getByRole("button", {
    name,
    exact: typeof name === "string",
  });

/** The ladder is pure CSS; the stamp and repair pass runs on the next frame. */
async function settle(page: Page) {
  for (let frame = 0; frame < 2; frame += 1) {
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(resolve)),
    );
  }
}

/** Appends a paragraph (and a heading before it), then puts the caret in `type`. */
async function seed(page: Page, caret: "paragraph" | "heading") {
  await page.evaluate((target) => {
    const editor = window.__tiptap_editor;
    if (!editor) throw new Error("editor missing");
    editor
      .chain()
      .focus()
      .insertContentAt(editor.state.doc.content.size, [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Section" }],
        },
        { type: "paragraph", content: [{ type: "text", text: "body text" }] },
      ])
      .run();
    let pos = -1;
    editor.state.doc.descendants((node, at) => {
      if (pos < 0 && at > 0 && node.type.name === target) pos = at;
    });
    editor
      .chain()
      .focus()
      .setTextSelection(pos + 1)
      .run();
  }, caret);
  await expect(page.locator('[data-slot="context-slot"]')).toHaveAttribute(
    "data-kind",
    caret,
  );
}

/** Paints `top` over `bottom` on a canvas: colours may be translucent. */
async function composite(page: Page, bottom: string, top: string) {
  return page.evaluate(
    ([under, over]) => {
      const ctx = document.createElement("canvas").getContext("2d", {
        willReadFrequently: true,
      }) as CanvasRenderingContext2D;
      ctx.fillStyle = under;
      ctx.fillRect(0, 0, 1, 1);
      ctx.fillStyle = over;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      return [r, g, b] as Rgb;
    },
    [bottom, top],
  );
}

test.describe("I1: a tier hiding the focused control hands focus to its stand-in", () => {
  const CASES = [
    {
      name: "Underline",
      width: 850,
      expected: "More text formatting",
      caret: "paragraph",
    },
    {
      name: "Align left",
      width: 1100,
      expected: "Paragraph",
      caret: "paragraph",
    },
    {
      name: "Increase font size",
      width: 1200,
      expected: /^Font size: /,
      caret: "paragraph",
    },
    {
      name: "Toggle outline",
      width: 940,
      expected: "View",
      caret: "paragraph",
    },
    { name: "Indent", width: 1100, expected: "Paragraph", caret: "paragraph" },
    {
      name: "Fold section",
      width: 1100,
      expected: "Section tools",
      caret: "heading",
    },
  ] as const;

  for (const { name, width, expected, caret } of CASES) {
    test(`${name} @${width} → ${expected}`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await openToolbarTestDoc(page);
      await seed(page, caret);
      const control = rowButton(page, name);
      await page.keyboard.press("Shift");
      await control.focus();
      await expect(control).toBeFocused();

      await page.setViewportSize({ width, height: 900 });
      await settle(page);
      await expect(control).toBeHidden();
      await expect(rowButton(page, expected)).toBeFocused();
    });
  }

  test("Theme toggle (no stand-in) stays in the row, not on another group's menu", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openToolbarTestDoc(page);
    const theme = rowButton(page, /^Switch to (dark|light) mode$/);
    await page.keyboard.press("Shift");
    await theme.focus();
    await page.setViewportSize({ width: 1200, height: 900 });
    await settle(page);
    await expect(theme).toBeHidden();
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      return {
        inRow: Boolean(el?.closest('[role="toolbar"][data-variant="fixed"]')),
        name: el?.getAttribute("aria-label") ?? "",
      };
    });
    expect(focused.inRow).toBe(true);
    expect(focused.name).not.toMatch(/^Font size/);
  });

  test("a control blurred to nothing is not refocused by a later resize", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openToolbarTestDoc(page);
    const underline = rowButton(page, "Underline");
    await underline.focus();
    await underline.evaluate((el) => (el as HTMLElement).blur());
    await page.setViewportSize({ width: 850, height: 900 });
    await settle(page);
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe(
      "BODY",
    );
  });
});

/** "mixed state" with only "mixed" bold, all of it selected. */
async function makeBoldMixed(page: Page) {
  await page.evaluate(() => {
    const editor = window.__tiptap_editor;
    if (!editor) throw new Error("editor missing");
    editor
      .chain()
      .focus()
      .insertContentAt(editor.state.doc.content.size, {
        type: "paragraph",
        content: [
          { type: "text", text: "mixed", marks: [{ type: "bold" }] },
          { type: "text", text: " state" },
        ],
      })
      .run();
    const to = editor.state.doc.content.size - 1;
    editor
      .chain()
      .focus()
      .setTextSelection({ from: to - "mixed state".length, to })
      .run();
  });
  const bold = rowButton(page, "Bold");
  await expect(bold).toHaveAttribute("aria-pressed", "mixed");
  await bold.evaluate((el) =>
    Promise.all(el.getAnimations().map((animation) => animation.finished)),
  );
  return bold;
}

for (const theme of ["light", "dark"] as const) {
  test(`I4: mixed shows a half-width bar at >=3:1 (${theme})`, async ({
    page,
  }) => {
    await setTheme(page, theme);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openToolbarTestDoc(page);
    const bold = await makeBoldMixed(page);
    const style = await bold.evaluate((el) => {
      const after = getComputedStyle(el, "::after");
      return {
        content: after.content,
        width: Number.parseFloat(after.width),
        height: Number.parseFloat(after.height),
        bar: after.backgroundColor,
        fill: getComputedStyle(el).backgroundColor,
        barBg: getComputedStyle(el.closest("[role=toolbar]") as Element)
          .backgroundColor,
      };
    });
    expect(style.content).not.toBe("none");
    expect(style.width).toBe(6);
    expect(style.height).toBe(2);
    const bg = await composite(page, style.barBg, style.fill);
    expect(
      contrastRatio(await resolveRgb(page, style.bar), bg),
    ).toBeGreaterThanOrEqual(3);

    if (SCREENS) {
      await page.mouse.move(0, 0);
      const box = await bold.boundingBox();
      if (box) {
        await page.screenshot({
          path: `${SCREENS}/mixed-${theme}.png`,
          clip: {
            x: Math.max(box.x - 120, 0),
            y: Math.max(box.y - 12, 0),
            width: 320,
            height: box.height + 24,
          },
        });
      }
    }
  });
}

test("I5: forced colours draw mixed with a dashed border and keep the focus ring", async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: "active" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await openToolbarTestDoc(page);
  const bold = await makeBoldMixed(page);
  const unfocused = await bold.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { border: cs.borderTopStyle, outline: cs.outlineStyle };
  });
  expect(unfocused).toEqual({ border: "dashed", outline: "none" });

  await page.keyboard.press("Shift");
  await bold.focus();
  const focused = await bold.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      visible: el.matches(":focus-visible"),
      border: cs.borderTopStyle,
      outline: cs.outlineStyle,
      width: Number.parseFloat(cs.outlineWidth),
    };
  });
  expect(focused.visible).toBe(true);
  expect(focused.border).toBe("dashed");
  expect(focused.outline).toBe("solid");
  expect(focused.width).toBeGreaterThanOrEqual(2);
});

async function openStyleMenu(page: Page): Promise<Locator> {
  await row(page).getByRole("button", { name: "Normal text" }).click();
  const menu = page.getByRole("menu", { name: "Text style" });
  await expect(menu).toBeVisible();
  await menu.evaluate((el) =>
    Promise.all(el.getAnimations().map((animation) => animation.finished)),
  );
  return menu;
}

async function itemHeights(menu: Locator) {
  return menu
    .locator('[role^="menuitem"]')
    .evaluateAll((items) =>
      items.map((item) => (item as HTMLElement).offsetHeight),
    );
}

test("I8: fine pointer keeps menu items at 28px", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openToolbarTestDoc(page);
  await seed(page, "paragraph");
  expect(await page.evaluate(() => matchMedia("(pointer: fine)").matches)).toBe(
    true,
  );
  const heights = await itemHeights(await openStyleMenu(page));
  expect(heights.length).toBeGreaterThan(0);
  for (const height of heights) expect(height).toBe(28);
});

test.describe("I8: touch", () => {
  test.use({ hasTouch: true });

  for (const theme of ["light", "dark"] as const) {
    test(`menu items are at least 44px tall (${theme})`, async ({ page }) => {
      await setTheme(page, theme);
      await page.setViewportSize({ width: 1600, height: 900 });
      await openToolbarTestDoc(page);
      await seed(page, "paragraph");
      expect(
        await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
      ).toBe(true);
      const menu = await openStyleMenu(page);
      const heights = await itemHeights(menu);
      expect(heights.length).toBeGreaterThan(0);
      for (const height of heights) expect(height).toBeGreaterThanOrEqual(44);
      if (SCREENS) {
        await menu.screenshot({ path: `${SCREENS}/touch-menu-${theme}.png` });
      }
    });
  }
});

test("M5: reduced motion drops the menu and popover animations", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await openToolbarTestDoc(page);
  await seed(page, "paragraph");
  const menu = await openStyleMenu(page);
  expect(await menu.evaluate((el) => getComputedStyle(el).animationName)).toBe(
    "none",
  );
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();

  await row(page)
    .getByRole("button", { name: "More highlight colours" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Highlight colours" });
  await expect(dialog).toBeVisible();
  expect(
    await dialog.evaluate((el) => getComputedStyle(el).animationName),
  ).toBe("none");
});

/** Types "highlight me" in a fresh paragraph and selects it. */
async function selectWord(page: Page) {
  await page.evaluate(() => {
    const editor = window.__tiptap_editor;
    if (!editor) throw new Error("editor missing");
    editor
      .chain()
      .focus()
      .insertContentAt(editor.state.doc.content.size, {
        type: "paragraph",
        content: [{ type: "text", text: "highlight me" }],
      })
      .run();
    const to = editor.state.doc.content.size - 1;
    editor
      .chain()
      .focus()
      .setTextSelection({ from: to - "highlight me".length, to })
      .run();
  });
}

async function openHighlightDialog(page: Page) {
  await row(page)
    .getByRole("button", { name: "More highlight colours" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Highlight colours" });
  const highlights = dialog.getByRole("group", {
    name: "Highlight",
    exact: true,
  });
  await expect(highlights).toBeVisible();
  return { dialog, highlights };
}

const LOW_NOTE =
  "Some highlights are low contrast with the current text colour";

test("M1: a visible note under Highlight while swatches are dimmed", async ({
  page,
}) => {
  await setTheme(page, "light");
  await page.setViewportSize({ width: 1440, height: 900 });
  await openToolbarTestDoc(page);
  await selectWord(page);

  let { dialog } = await openHighlightDialog(page);
  await expect(dialog.getByText(LOW_NOTE)).toHaveCount(0);
  const width = await settledWidth(dialog);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await page.evaluate(() =>
    window.__tiptap_editor?.commands.setTextColor("teal"),
  );
  ({ dialog } = await openHighlightDialog(page));
  await expect(dialog.getByText(LOW_NOTE)).toBeVisible();
  // The note wraps inside the swatch grid's width.
  expect(await settledWidth(dialog)).toBeCloseTo(width, 0);
});

/** Width after the popover's open (zoom-in) animation has finished. */
async function settledWidth(dialog: Locator) {
  await dialog.evaluate((el) =>
    Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)),
  );
  return (await dialog.boundingBox())?.width ?? 0;
}

test("M2: a mouse pick moves the roving stop and focus to the swatch", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openToolbarTestDoc(page);
  await selectWord(page);
  const { highlights } = await openHighlightDialog(page);
  const none = highlights.getByRole("button", { name: "No highlight" });
  await expect(none).toBeFocused();
  const blue = highlights.getByRole("button", { name: "Blue highlight" });
  await blue.click();
  await expect(blue).toHaveAttribute("aria-pressed", "true");
  await expect(blue).toBeFocused();
  await expect(blue).toHaveAttribute("tabindex", "0");
  await expect(none).toHaveAttribute("tabindex", "-1");
});

for (const theme of ["light", "dark"] as const) {
  test(`M12: swatch borders are >=3:1 on the popover (${theme})`, async ({
    page,
  }) => {
    await setTheme(page, theme);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openToolbarTestDoc(page);
    await selectWord(page);
    const { dialog, highlights } = await openHighlightDialog(page);
    const swatch = highlights.getByRole("button", { name: "Blue highlight" });
    await page.mouse.move(0, 0);
    const colours = await swatch.evaluate((el) => ({
      border: getComputedStyle(el).borderTopColor,
    }));
    const popover = await dialog.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    const border = await composite(page, popover, colours.border);
    expect(
      contrastRatio(border, await resolveRgb(page, popover)),
    ).toBeGreaterThanOrEqual(3);
  });
}

/** Visible separators and content in DOM order (a filled slot counts, as
 * the title's lock is not an item): no two separators in a row. */
async function adjacentSeparators(page: Page) {
  return row(page).evaluate((toolbar) => {
    const marks = Array.from(
      toolbar.querySelectorAll<HTMLElement>(
        '[data-slot="toolbar-separator"], [data-toolbar-item], [data-slot="context-slot"]:not([aria-hidden])',
      ),
    )
      .filter((el) => el.checkVisibility())
      .map((el) => el.dataset.slot === "toolbar-separator");
    return marks.some((sep, index) => sep && marks[index + 1]);
  });
}

test("M9: an empty slot leaves one separator, at every tier", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openToolbarTestDoc(page);
  // The title: its slot shows a lock but the T3 stand-in renders nothing.
  for (const width of [1440, 1100, 900]) {
    await page.setViewportSize({ width, height: 900 });
    await settle(page);
    expect(await adjacentSeparators(page), `title @${width}`).toBe(false);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await seed(page, "paragraph");
  const separatorAfterSlot = page.locator(
    '[data-toolbar-group="slot"] + [data-slot="toolbar-separator"]',
  );
  for (const width of [1440, 1100, 900]) {
    await page.setViewportSize({ width, height: 900 });
    await settle(page);
    expect(await adjacentSeparators(page), `paragraph @${width}`).toBe(false);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await settle(page);
  await expect(separatorAfterSlot).toBeHidden();

  // A filled slot keeps both separators.
  await seed(page, "heading");
  await expect(separatorAfterSlot).toBeVisible();
});
