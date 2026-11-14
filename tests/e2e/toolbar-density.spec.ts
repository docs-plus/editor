/**
 * Simplified toolbar (contract A-next, later-phase plan "progressive
 * disclosure"): ⋯ or the palette turns on the T4 collapse set at every
 * width. It is remembered in `tinydocy-ui` (survives reload and Forget),
 * never flashes the full row on load, keeps one Tab stop and hands a
 * hidden stop to its group's stand-in. The kill-switch case needs a Next
 * built with `NEXT_PUBLIC_REMEMBER_CHOICES=0` (`E2E_REMEMBER_OFF=1`).
 */
import { expect, type Page, test } from "@playwright/test";

import { openToolbarTestDoc } from "./helpers/a11y";

const row = (page: Page) =>
  page.locator('[role="toolbar"][data-variant="fixed"]');
const more = (page: Page) =>
  row(page).getByRole("button", { name: "More formatting" });
const densityItem = (page: Page) =>
  page.getByRole("menuitemcheckbox", { name: "Simplified toolbar" });

/** Seeds the remembered density before the app loads. */
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

/** Adds an H2 after the title and puts the caret in it (slot: Section). */
async function caretInSection(page: Page) {
  await page.evaluate(() => {
    const editor = window.__tiptap_editor;
    if (!editor) throw new Error("editor missing");
    const end = editor.state.doc.content.size;
    editor
      .chain()
      .focus()
      .insertContentAt(end, {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Section" }],
      })
      .setTextSelection(end + 2)
      .run();
  });
  await expect(page.locator('[data-slot="context-slot"]')).toHaveAttribute(
    "data-kind",
    "heading",
  );
}

const nextFrames = (page: Page) =>
  page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );

/** What the row shows: visible items per tier and stand-in, and stops. */
function rowState(page: Page) {
  return row(page).evaluate((toolbar) => {
    const visibleIn = (scope: Element) =>
      Array.from(
        scope.querySelectorAll<HTMLElement>("[data-toolbar-item]"),
      ).filter((item) => item.checkVisibility());
    const countIn = (selector: string) =>
      Array.from(toolbar.querySelectorAll(selector)).flatMap(visibleIn).length;
    const items = visibleIn(toolbar);
    return {
      density: toolbar.getAttribute("data-toolbar-density"),
      names: items.map(
        (item) =>
          item.getAttribute("aria-label") ?? item.textContent?.trim() ?? "",
      ),
      hiddenTiers: ["t2", "t3", "t4"].map((tier) =>
        countIn(`[data-collapse-tier="${tier}"]`),
      ),
      standIns: ["t2", "t3", "t4"].map((tier) =>
        countIn(`[data-collapse-standin="${tier}"]`),
      ),
      stops: items.filter((item) => item.getAttribute("tabindex") === "0")
        .length,
      overflow: toolbar.scrollWidth - toolbar.clientWidth,
    };
  });
}

test.describe("simplified toolbar", () => {
  test("at 1440px it shows the T4 set: every stand-in, the never-collapse set, U and S", async ({
    page,
  }) => {
    await rememberSimplified(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openToolbarTestDoc(page);
    await caretInSection(page);
    const state = await rowState(page);
    expect(state.density).toBe("simple");
    expect(state.hiddenTiers, "no t2–t4 item is visible").toEqual([0, 0, 0]);
    expect(
      state.standIns.every((count) => count > 0),
      "the size, ¶, slot, colour and View stand-ins show",
    ).toBe(true);
    for (const id of [
      "history.undo",
      "history.redo",
      "mark.bold",
      "mark.italic",
      "mark.underline",
      "mark.strike",
      "mark.link",
    ]) {
      await expect(row(page).locator(`[data-action-id="${id}"]`)).toBeVisible();
    }
    for (const name of ["List", "Insert", "More formatting"]) {
      await expect(
        row(page).getByRole("button", { name, exact: true }),
      ).toBeVisible();
    }
    await expect(
      row(page).getByRole("button", { name: "More text formatting" }),
    ).toBeHidden();
    await expect(
      row(page).getByRole("button", { name: /Switch to (dark|light) mode/ }),
    ).toBeHidden();
    expect(state.stops).toBe(1);
    expect(state.overflow).toBeLessThanOrEqual(1);

    // Theme moved into ⋯, after the setting.
    await more(page).click();
    await expect(densityItem(page)).toHaveAttribute("aria-checked", "true");
    await expect(
      page.getByRole("menuitem", { name: /Switch to (dark|light) mode/ }),
    ).toBeVisible();
  });

  test("below the T4 width it shows exactly what the ladder shows", async ({
    browser,
  }) => {
    const names: string[][] = [];
    for (const simplified of [false, true]) {
      const page = await browser.newPage({
        viewport: { width: 900, height: 900 },
      });
      if (simplified) await rememberSimplified(page);
      await openToolbarTestDoc(page);
      await caretInSection(page);
      names.push((await rowState(page)).names);
      await page.close();
    }
    expect(names[1]).toEqual(names[0]);
  });

  test("⋯ > Simplified toolbar collapses the row and returns focus to ⋯", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openToolbarTestDoc(page);
    await caretInSection(page);
    const full = await rowState(page);
    expect(full.density).toBe("full");
    expect(full.standIns).toEqual([0, 0, 0]);

    await more(page).click();
    await expect(densityItem(page)).toHaveAttribute("aria-checked", "false");
    await densityItem(page).click();
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(more(page)).toBeFocused();
    await nextFrames(page);
    const simple = await rowState(page);
    expect(simple.density).toBe("simple");
    expect(simple.hiddenTiers).toEqual([0, 0, 0]);
    expect(simple.stops).toBe(1);

    // The pill confirms it (the menu closed) and offers Undo.
    const pill = page.locator('[data-status-pill="desktop"]');
    await expect(pill).toContainText("Simplified toolbar on");
    await pill.getByRole("button", { name: "Undo" }).click();
    await expect(row(page)).toHaveAttribute("data-toolbar-density", "full");
    await expect(pill).toContainText("Full toolbar on");
    await more(page).click();
    await densityItem(page).click();
    await expect(row(page)).toHaveAttribute("data-toolbar-density", "simple");
    await expect(more(page)).toBeFocused();

    // Keyboard: Enter on the checked item turns it back off.
    await page.keyboard.press("Enter");
    await expect(densityItem(page)).toHaveAttribute("aria-checked", "true");
    await densityItem(page).focus();
    await page.keyboard.press("Enter");
    await expect(more(page)).toBeFocused();
    await expect(row(page)).toHaveAttribute("data-toolbar-density", "full");
  });

  test("the setting survives reload and Forget my choices", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const editorPage = await openToolbarTestDoc(page);
    await more(page).click();
    await densityItem(page).click();
    await expect(row(page)).toHaveAttribute("data-toolbar-density", "simple");

    await page.reload();
    await editorPage.waitForSync();
    await expect(row(page)).toHaveAttribute("data-toolbar-density", "simple");

    await more(page).click();
    await page.getByRole("menuitem", { name: "Forget my choices" }).click();
    await expect(row(page)).toHaveAttribute("data-toolbar-density", "simple");
    await page.reload();
    await editorPage.waitForSync();
    await expect(row(page)).toHaveAttribute("data-toolbar-density", "simple");
  });

  test("no flash on load: the first row in the DOM is already simplified", async ({
    page,
  }) => {
    await rememberSimplified(page);
    // Records the row as React first commits it, before any paint.
    await page.addInitScript(() => {
      const seen: { density: string | null; outlineShown: boolean }[] = [];
      (window as unknown as { __firstRows: typeof seen }).__firstRows = seen;
      new MutationObserver(() => {
        if (seen.length > 0) return;
        const toolbar = document.querySelector(
          '[role="toolbar"][data-variant="fixed"]',
        );
        const outline = toolbar?.querySelector<HTMLElement>(
          '[data-collapse-tier="t4"] button',
        );
        if (!toolbar || !outline) return;
        seen.push({
          density: toolbar.getAttribute("data-toolbar-density"),
          outlineShown: outline.checkVisibility(),
        });
      }).observe(document, { childList: true, subtree: true });
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await openToolbarTestDoc(page);
    const first = await page.evaluate(
      () =>
        (
          window as unknown as {
            __firstRows: { density: string | null; outlineShown: boolean }[];
          }
        ).__firstRows,
    );
    expect(first).toEqual([{ density: "simple", outlineShown: false }]);
  });

  test("the palette lists Simplified toolbar and toggles it", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openToolbarTestDoc(page);
    await page.keyboard.press("Alt+Slash");
    await expect(page.getByPlaceholder("Search actions…")).toBeFocused();
    await page.keyboard.type("fewer tools");
    await expect(
      page.locator('[cmdk-item][data-action-id="view.simpleToolbar"]').first(),
    ).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(row(page)).toHaveAttribute("data-toolbar-density", "simple");
    await expect(page.locator(".tiptap")).toBeFocused();
  });

  test("a stop on Align left moves to the ¶ stand-in when the palette simplifies", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openToolbarTestDoc(page);
    await caretInSection(page);
    await row(page).getByRole("button", { name: "Align left" }).focus();
    await page.keyboard.press("Escape");
    await expect(page.locator(".tiptap")).toBeFocused();

    await page.keyboard.press("Alt+Slash");
    await expect(page.getByPlaceholder("Search actions…")).toBeFocused();
    await page.keyboard.type("Simplified toolbar");
    await page.keyboard.press("Enter");
    await expect(row(page)).toHaveAttribute("data-toolbar-density", "simple");
    await nextFrames(page);

    // The row's one stop moved to the stand-in; Alt+F10 lands on it.
    await expect(
      row(page).getByRole("button", { name: "Paragraph", exact: true }),
    ).toHaveAttribute("tabindex", "0");
    await page.keyboard.press("Alt+F10");
    await expect(
      row(page).getByRole("button", { name: "Paragraph", exact: true }),
    ).toBeFocused();
    expect((await rowState(page)).stops).toBe(1);
  });

  test.describe("touch", () => {
    test.use({ hasTouch: true, isMobile: true });

    test("one Tab stop before and after toggling", async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await openToolbarTestDoc(page);
      expect(
        await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
      ).toBe(true);
      await caretInSection(page);
      expect((await rowState(page)).stops).toBe(1);
      await more(page).click();
      await densityItem(page).click();
      await nextFrames(page);
      const simple = await rowState(page);
      expect(simple.density).toBe("simple");
      expect(simple.stops).toBe(1);
      expect(simple.overflow).toBeLessThanOrEqual(1);
    });
  });

  test.describe("kill switch", () => {
    test.skip(
      process.env.E2E_REMEMBER_OFF !== "1",
      "needs Next built with NEXT_PUBLIC_REMEMBER_CHOICES=0",
    );

    test("the ⋯ item is disabled with its reason; the row stays full", async ({
      page,
    }) => {
      await rememberSimplified(page);
      await page.setViewportSize({ width: 1440, height: 900 });
      await openToolbarTestDoc(page);
      await expect(row(page)).toHaveAttribute("data-toolbar-density", "full");
      await more(page).click();
      await expect(densityItem(page)).toHaveAttribute("aria-disabled", "true");
      await expect(page.getByRole("menu")).toContainText(
        "Remembering choices is turned off.",
      );
    });
  });
});
