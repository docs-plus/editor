/**
 * Responsive ladder (spec §4.6, §8 D go criterion): the fixed row fits its
 * width (`scrollWidth <= clientWidth` ±1px) at every tier, in each slot
 * context, for mouse and touch; collapsed groups leave the roving order;
 * phones get the docked bar instead (44×44 cells, Aa on screen).
 */
import { expect, type Page, test } from "@playwright/test";

import { openToolbarTestDoc } from "./helpers/a11y";

const MOUSE_WIDTHS = [1440, 1280, 1128, 1024, 1008, 900, 860, 840, 768];
const TOUCH_WIDTHS = [1440, 1224, 1096, 920, 824, 768];
const CONTEXTS = ["paragraph", "heading", "codeBlock", "table"] as const;

const row = (page: Page) =>
  page.locator('[role="toolbar"][data-variant="fixed"]');

/** Adds one block of each context after the title, then a table. */
async function seedContexts(page: Page) {
  await page.evaluate(() => {
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
        {
          type: "codeBlock",
          attrs: { language: "typescript" },
          content: [{ type: "text", text: "const a = 1" }],
        },
        { type: "paragraph", content: [{ type: "text", text: "hello" }] },
      ])
      .insertTable({ rows: 2, cols: 2 })
      .run();
  });
}

/** Puts the caret in the first node of `type` after the title. */
async function caretIn(page: Page, type: (typeof CONTEXTS)[number]) {
  await page.evaluate((name) => {
    const editor = window.__tiptap_editor;
    if (!editor) throw new Error("editor missing");
    let pos = -1;
    editor.state.doc.descendants((node, at) => {
      if (pos < 0 && at > 0 && node.type.name === name) pos = at;
    });
    if (pos < 0) throw new Error(`no ${name}`);
    // Into the node's first textblock (a table's first cell paragraph).
    const inner = name === "table" ? pos + 3 : pos + 1;
    editor.chain().focus().setTextSelection(inner).run();
  }, type);
  const kind = type === "codeBlock" ? "code" : type;
  await expect(page.locator('[data-slot="context-slot"]')).toHaveAttribute(
    "data-kind",
    kind,
  );
}

async function expectRowFits(page: Page, label: string) {
  const fit = await row(page).evaluate((el) => {
    const items = Array.from(
      el.querySelectorAll<HTMLElement>("[data-toolbar-item]"),
    ).filter((item) => item.checkVisibility());
    return {
      scroll: el.scrollWidth,
      client: el.clientWidth,
      stops: items.filter((item) => item.getAttribute("tabindex") === "0")
        .length,
    };
  });
  expect(
    fit.scroll,
    `${label}: scrollWidth ≤ clientWidth + 1`,
  ).toBeLessThanOrEqual(fit.client + 1);
  expect(fit.stops, `${label}: one Tab stop`).toBe(1);
}

/**
 * M10: remembers the widest Insert face ("Code block") before load, so the
 * T1 row is measured with the face the threshold must hold (A5).
 */
async function rememberWidestInsertFace(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "tinydocy-choices",
      JSON.stringify({
        v: 1,
        slots: { insertKind: { last: "codeBlock", recent: [] } },
      }),
    );
  });
}

/** Simplified toolbar (A-next): remembers the compact row before load. */
async function rememberSimplified(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "tinydocy-ui",
      JSON.stringify({
        v: 1,
        slots: { toolbarDensity: { last: "simple", recent: [] } },
      }),
    );
  });
}

async function sweep(page: Page, widths: number[], tag: string) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openToolbarTestDoc(page);
  await seedContexts(page);
  for (const context of CONTEXTS) {
    await caretIn(page, context);
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      // The ladder is pure CSS; the stamp pass runs on the next frame.
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(resolve)),
      );
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(resolve)),
      );
      await expectRowFits(page, `${tag} ${context} @${width}`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  }
}

test("mouse: the row fits at every tier and context", async ({ page }) => {
  await sweep(page, MOUSE_WIDTHS, "mouse");
});

test("mouse: the row fits with the widest Insert face remembered", async ({
  page,
}) => {
  await rememberWidestInsertFace(page);
  await sweep(page, [1440, 1300, 1290, 1281, ...MOUSE_WIDTHS], "mouse+face");
});

test("simplified: the row fits at every tier and context", async ({ page }) => {
  await rememberSimplified(page);
  await sweep(page, MOUSE_WIDTHS, "mouse simplified");
});

test.describe("touch", () => {
  test.use({ hasTouch: true });

  test("simplified: the row fits at every touch tier and context", async ({
    page,
  }) => {
    await rememberSimplified(page);
    await sweep(page, TOUCH_WIDTHS, "touch simplified");
  });

  test("the row fits at every touch tier and context", async ({ page }) => {
    await sweep(page, TOUCH_WIDTHS, "touch");
  });

  test("the row fits with the widest Insert face remembered", async ({
    page,
  }) => {
    await rememberWidestInsertFace(page);
    await sweep(page, [1600, 1560, ...TOUCH_WIDTHS], "touch+face");
  });

  test("phone: the docked bar replaces the row, 44px cells, Aa on screen", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openToolbarTestDoc(page);
    await expect(page.getByRole("toolbar")).toHaveCount(1);
    const bar = page.getByRole("toolbar", { name: "Formatting" });
    await expect(bar).toHaveAttribute("data-variant", "docked");
    const entry = bar.getByRole("button", { name: "Text format" });
    await expect(entry).toBeVisible();
    const box = await entry.boundingBox();
    expect(box?.x ?? 0).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);

    const small = await bar.evaluate((el) =>
      Array.from(el.querySelectorAll<HTMLElement>("[data-toolbar-item]"))
        .filter((item) => item.checkVisibility())
        .map((item) => ({
          name: item.getAttribute("aria-label") ?? item.textContent ?? "",
          ...item.getBoundingClientRect().toJSON(),
        }))
        .filter((rect) => rect.width < 44 || rect.height < 44)
        .map((rect) => `${rect.name} ${rect.width}×${rect.height}`),
    );
    expect(small, "every phone bar cell is 44×44").toEqual([]);
    expect(
      await bar.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);

    await entry.tap();
    await expect(
      page
        .getByRole("dialog", { name: "Text format" })
        .getByRole("button", { name: "Red text" }),
    ).toBeVisible();
  });
});

test("collapsed groups come back through their stand-ins", async ({ page }) => {
  await page.setViewportSize({ width: 860, height: 900 });
  await openToolbarTestDoc(page);
  await seedContexts(page);
  await caretIn(page, "heading");
  const toolbar = row(page);
  for (const name of ["Toggle outline", "Align left", "Underline"]) {
    await expect(
      toolbar.getByRole("button", { name, exact: true }),
    ).toBeHidden();
  }
  await toolbar.getByRole("button", { name: "Paragraph" }).click();
  await expect(
    page.getByRole("menuitemradio", { name: "Align center" }),
  ).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /^Indent/ })).toBeVisible();
  await page.keyboard.press("Escape");

  await toolbar.getByRole("button", { name: "Section tools" }).click();
  await expect(page.getByRole("menuitem", { name: /fold|Fold/ })).toBeVisible();
  await page.keyboard.press("Escape");

  await toolbar.getByRole("button", { name: "More formatting" }).click();
  await expect(
    page.getByRole("menuitem", { name: /Switch to (dark|light) mode/ }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  await toolbar
    .getByRole("button", { name: "Text and highlight colours" })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Text colours" }),
  ).toBeVisible();
});
