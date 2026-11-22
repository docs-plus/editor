import { expect, type Page, test } from "@playwright/test";

import { resolveRgb } from "./helpers/a11y";
import { EditorPage } from "./helpers/editor-page";

/*
 * The page engine (P2.9c-1, preferences design §5.3–§5.10). Preferences
 * have no controls until P2.9c-2, so tests seed `tinydocy-ui` before load
 * or drive the dev-only `window.__tinydocyPrefs` hook.
 *
 * `EditorPage.goto` seeds `tinydocy-tabs`, which marks a returning browser
 * (`classic`). A new visitor is seeded with the `new` look marker instead,
 * which is what the boot script writes for one.
 */

type Slots = Record<string, unknown>;

async function seed(page: Page, look: "new" | "classic", slots: Slots = {}) {
  await page.addInitScript(
    ({ look, slots }) => {
      if (sessionStorage.getItem("seeded")) return;
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("tinydocy-look", look);
      const entries = Object.fromEntries(
        Object.entries(slots).map(([name, last]) => [
          name,
          { last, recent: [] },
        ]),
      );
      localStorage.setItem(
        "tinydocy-ui",
        JSON.stringify({ v: 1, slots: entries }),
      );
    },
    { look, slots },
  );
}

async function open(page: Page, look: "new" | "classic", slots?: Slots) {
  await seed(page, look, slots);
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.waitForSync();
  return editor;
}

const cardWidth = (page: Page) =>
  page
    .locator(".document-editor-content")
    .evaluate((card) => card.getBoundingClientRect().width);

test.describe("page engine", () => {
  test("a new visitor gets the Default page: 16 px text, a 624 px card", async ({
    page,
  }) => {
    await open(page, "new");
    await expect(page.locator("html")).toHaveAttribute(
      "data-page-style",
      "default",
    );
    expect(await cardWidth(page)).toBe(624);
    const paragraph = await page
      .locator(".tiptap p")
      .first()
      .evaluate((p) => {
        const style = getComputedStyle(p);
        return { size: style.fontSize, leading: style.lineHeight };
      });
    expect(paragraph).toEqual({ size: "16px", leading: "25.6px" });
  });

  test("the skeleton card and the editor card are the same width (no jump)", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    for (const [size, width] of [
      [16, "standard"],
      [20, "narrow"],
      [14, "wide"],
    ] as const) {
      const fresh = await page.context().newPage();
      await fresh.addInitScript(() => {
        const widths: number[] = [];
        (window as Window & { __skeletonWidths?: number[] }).__skeletonWidths =
          widths;
        new MutationObserver(() => {
          const card = document.querySelector(".skeleton-page");
          if (card) widths.push(card.getBoundingClientRect().width);
        }).observe(document, { childList: true, subtree: true });
      });
      await open(fresh, "new", { page: { style: "default", size, width } });
      const skeleton = await fresh.evaluate(
        () =>
          (window as Window & { __skeletonWidths?: number[] })
            .__skeletonWidths ?? [],
      );
      const editor = await cardWidth(fresh);
      expect(skeleton.length).toBeGreaterThan(0);
      expect(new Set(skeleton)).toEqual(new Set([editor]));
      await fresh.close();
    }
  });

  test("the skeleton's outline column matches the live outline's docking", async ({
    page,
  }) => {
    // Between the 768 px phone cut and Default's 926 px threshold.
    await page.setViewportSize({ width: 900, height: 800 });
    await page.addInitScript(() => {
      const seen: string[] = [];
      (window as Window & { __tocDisplays?: string[] }).__tocDisplays = seen;
      new MutationObserver(() => {
        const toc = document.querySelector(".skeleton-toc");
        if (toc) seen.push(getComputedStyle(toc).display);
      }).observe(document, { childList: true, subtree: true });
    });
    await open(page, "new");
    const displays = await page.evaluate(
      () =>
        (window as Window & { __tocDisplays?: string[] }).__tocDisplays ?? [],
    );
    expect(displays.length).toBeGreaterThan(0);
    expect(new Set(displays)).toEqual(new Set(["none"]));
    await expect(page.locator(".outline-panel")).toHaveCount(0);
  });

  test("text size, width and spacing come from storage before first paint", async ({
    page,
  }) => {
    await open(page, "new", {
      page: { style: "default", size: 20, width: "narrow", spacing: "relaxed" },
    });
    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-text-size", "20");
    await expect(html).toHaveAttribute("data-page-width", "narrow");
    // 30 em × 20 px + 6 rem padding.
    expect(await cardWidth(page)).toBe(696);
    const paragraph = await page
      .locator(".tiptap p")
      .first()
      .evaluate((p) => getComputedStyle(p).lineHeight);
    expect(paragraph).toBe("36px");
  });

  test("headings follow the text size; the smallest stays at body size", async ({
    page,
  }) => {
    const editor = await open(page, "new", {
      page: { style: "default", size: 24 },
    });
    await editor.setContent({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "T" }],
        },
        {
          type: "heading",
          attrs: { level: 3 },
          content: [{ type: "text", text: "S" }],
        },
        { type: "paragraph", content: [{ type: "text", text: "Body" }] },
      ],
    });
    const sizes = await page.evaluate(() =>
      [".tiptap h1", ".tiptap h3", ".tiptap p"].map(
        (selector) =>
          getComputedStyle(document.querySelector(selector) as Element)
            .fontSize,
      ),
    );
    // 20 pt and 12 pt on a 16 px base, scaled to 24 px.
    expect(sizes).toEqual(["40px", "24px", "24px"]);
  });

  test("Full width uses the whole main area and keeps text to 46 em", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1600, height: 900 });
    await open(page, "new", { page: { style: "default", width: "full" } });
    const { card, wrapper, text } = await page.evaluate(() => {
      const box = (selector: string) =>
        (document.querySelector(selector) as Element).getBoundingClientRect()
          .width;
      return {
        card: box(".document-editor-content"),
        wrapper: box(".editor-with-toc"),
        text: getComputedStyle(document.querySelector(".tiptap > p") as Element)
          .maxInlineSize,
      };
    });
    expect(card).toBeGreaterThan(wrapper - 40);
    expect(text).toBe("736px");
    // Full never docks the outline (the overlay starts closed).
    await expect(page.locator(".outline-panel")).toHaveCount(0);
  });

  test("the outline docks by the formula: 926 px for Default, 950 px in classic", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    for (const [look, threshold] of [
      ["new", 926],
      ["classic", 950],
    ] as const) {
      const fresh = await page.context().newPage();
      await fresh.setViewportSize({ width: threshold, height: 800 });
      await open(fresh, look);
      await expect(fresh.locator(".outline-panel")).toHaveAttribute(
        "data-mode",
        "docked",
      );
      await fresh.setViewportSize({ width: threshold - 1, height: 800 });
      // The overlay starts closed.
      await expect(fresh.locator(".outline-panel")).toHaveCount(0);
      await fresh.setViewportSize({ width: threshold, height: 800 });
      await expect(fresh.locator(".outline-panel")).toHaveAttribute(
        "data-mode",
        "docked",
      );
      await fresh.close();
    }
  });

  test("a text size change re-docks without reload", async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 800 });
    await open(page, "new");
    await expect(page.locator(".outline-panel")).toHaveAttribute(
      "data-mode",
      "docked",
    );
    // 18 px docks from 992 px; 20 px needs 1,058 px.
    await page.evaluate(() => window.__tinydocyPrefs?.setPageKnob("size", 20));
    await expect(page.locator("html")).toHaveAttribute("data-text-size", "20");
    await expect(page.locator(".outline-panel")).toHaveCount(0);
  });

  test("spellcheck off reaches the editor through <html>", async ({ page }) => {
    await open(page, "new", { spellcheck: false });
    await expect(page.locator("html")).toHaveAttribute("spellcheck", "false");
    expect(
      await page
        .locator(".tiptap.ProseMirror")
        .evaluate((el) => (el as HTMLElement).spellcheck),
    ).toBe(false);
  });

  test("smart quotes off types straight quotes, live", async ({ page }) => {
    const editor = await open(page, "new");
    await editor.focusTitle();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type('"a" --');
    await page.evaluate(() =>
      window.__tinydocyPrefs?.setBooleanPref("smartQuotes", false),
    );
    await expect(page.locator("html")).toHaveAttribute(
      "data-smart-quotes",
      "off",
    );
    await page.keyboard.type(' "b" --');
    await expect(page.locator(".tiptap p").first()).toHaveText('“a” — "b" --');
  });

  test("reading mode is read-only, hides the toolbar and emits no Yjs update", async ({
    page,
  }) => {
    const editor = await open(page, "new");
    await editor.focusTitle();
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      const ed = window.__tiptap_editor as unknown as {
        extensionManager: {
          extensions: { name: string; options: Record<string, unknown> }[];
        };
      };
      const ydoc = ed.extensionManager.extensions.find(
        (extension) => extension.name === "collaboration",
      )?.options.document as { on(event: string, fn: () => void): void };
      const win = window as Window & { __updates?: number };
      win.__updates = 0;
      ydoc.on("update", () => {
        win.__updates = (win.__updates ?? 0) + 1;
      });
      window.__tinydocyPrefs?.setReadingMode(true);
    });
    await expect(page.locator(".page-frame")).toHaveAttribute(
      "data-reading",
      "true",
    );
    await expect(page.locator('[data-slot="toolbar"]')).toBeHidden();
    await expect(page.locator(".tiptap.ProseMirror")).toHaveAttribute(
      "contenteditable",
      "false",
    );
    await page.mouse.wheel(0, 600);
    await page.keyboard.type("x");
    await page.evaluate(() => window.__tinydocyPrefs?.setReadingMode(false));
    await expect(page.locator('[data-slot="toolbar"]').first()).toBeVisible();
    await page.waitForTimeout(500);
    expect(
      await page.evaluate(
        () => (window as Window & { __updates?: number }).__updates,
      ),
    ).toBe(0);
  });

  test("contrast and motion: the web override and the OS setting", async ({
    browser,
  }) => {
    // Text colour as sRGB: pure black only under the high-contrast set
    // (the normal foreground is oklch(0.145 0 0)).
    const foreground = async (page: Page) =>
      resolveRgb(
        page,
        await page.evaluate(() => getComputedStyle(document.body).color),
      );
    const overridden = await browser.newPage();
    await open(overridden, "new", {
      a11y: { contrast: "more", motion: "reduce" },
    });
    const html = overridden.locator("html");
    await expect(html).toHaveAttribute("data-contrast", "more");
    await expect(html).toHaveAttribute("data-motion", "reduce");
    expect(await foreground(overridden)).toEqual([0, 0, 0]);
    await overridden.close();

    const context = await browser.newContext({ contrast: "more" });
    const system = await context.newPage();
    await open(system, "new");
    expect(await foreground(system)).toEqual([0, 0, 0]);
    await context.close();
  });

  test("a change in one tab applies in another without reload", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await open(page, "new");
    const other = await page.context().newPage();
    const second = new EditorPage(other);
    await second.goto();
    await second.waitForSync();
    await page.evaluate(() =>
      window.__tinydocyPrefs?.setPageKnob("spacing", "compact"),
    );
    await expect(other.locator("html")).toHaveAttribute(
      "data-spacing",
      "compact",
    );
  });

  test("a returning browser stays classic until it changes a setting", async ({
    page,
  }) => {
    await open(page, "classic");
    await expect(page.locator("html")).toHaveAttribute(
      "data-page-style",
      "classic",
    );
    expect(await cardWidth(page)).toBe(648);
    await page.evaluate(() => window.__tinydocyPrefs?.setPageKnob("size", 18));
    await expect(page.locator("html")).toHaveAttribute(
      "data-page-style",
      "default",
    );
    // 33 em × 18 px + 6 rem.
    expect(await cardWidth(page)).toBe(690);
  });
});
