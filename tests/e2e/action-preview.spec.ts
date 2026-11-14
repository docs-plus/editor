/**
 * Hover preview (smart toolbar later phase): pointing at a colour swatch
 * with a mouse, or arrowing to one, shows it on the selection with
 * decorations only. Nothing is written. On a touch-first device a tap or
 * pointer shows nothing, while a hardware keyboard's arrows still preview.
 */
import { expect, type Locator, type Page, test } from "@playwright/test";

import { HIGHLIGHT_PALETTE, TEXT_COLOR_PALETTE } from "@/lib/text-style-tokens";

import { resolveRgb, setTheme } from "./helpers/a11y";
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

const link = { type: "hyperlink", attrs: { href: "https://example.com" } };
const code = { type: "inlineCode" };
const textColor = (color: string) => ({ type: "textColor", attrs: { color } });
const highlight = (color: string) => ({ type: "highlight", attrs: { color } });
const cell = (type: string, ...content: unknown[]) => ({
  type,
  content: [paragraph(...content)],
});

/**
 * The contexts a fixed colour used to misjudge for "Default text" and
 * "No highlight": a coloured, highlighted link, inline code and a table
 * header cell's tint. Each paragraph starts with a word that finds it.
 */
const CONTEXT_DOC = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [text("Title")] },
    paragraph(text("A plain line above the examples")),
    paragraph(
      text("Mix "),
      text("red link", [link, textColor("red"), highlight("yellow")]),
      text(" with "),
      text("code", [code]),
      text(" and "),
      text("blue mark", [textColor("blue"), highlight("green")]),
      text(" end"),
    ),
    {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            cell(
              "tableHeader",
              text("Head "),
              text("lit", [textColor("red"), highlight("yellow")]),
              text(" "),
              text("code", [code]),
            ),
            cell("tableHeader", text("Second")),
          ],
        },
        {
          type: "tableRow",
          content: [
            cell("tableCell", text("Cell")),
            cell("tableCell", text("More")),
          ],
        },
      ],
    },
  ],
};

/** Past the 80 ms dwell, with room for a dev-server frame. */
const DWELL = 250;

/** Design-review screenshots (`PREVIEW_SCREENS_DIR=<dir>`). */
const SCREENS = process.env.PREVIEW_SCREENS_DIR;

const row = (page: Page) =>
  page.getByRole("toolbar", { name: "Formatting", exact: true });
const bubble = (page: Page) => page.locator("[data-smart-bubble]");
const previews = (page: Page) => page.locator(".tiptap .tt-preview");

async function openDoc(
  page: Page,
  content: unknown = DOC,
): Promise<EditorPage> {
  const editorPage = new EditorPage(page);
  await editorPage.goto();
  await editorPage.waitForSync();
  // Next's dev indicator sits in the corner; keep it out of the pixels.
  await page.addStyleTag({
    content: "nextjs-portal { display: none !important; }",
  });
  await editorPage.setContent(content);
  return editorPage;
}

/** Selects the whole text of the textblock that starts with `start`. */
async function selectBlock(page: Page, start: string) {
  await page.evaluate((target) => {
    const editor = window.__tiptap_editor;
    if (!editor) throw new Error("editor missing");
    let range: { from: number; to: number } | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (range) return false;
      if (node.isTextblock && node.textContent.startsWith(target)) {
        range = { from: pos + 1, to: pos + node.nodeSize - 1 };
      }
      return !range;
    });
    if (!range) throw new Error(`no block starts with "${target}"`);
    editor.chain().focus().setTextSelection(range).run();
  }, start);
}

/** The viewport box of the paragraph that starts with `start`. */
const blockClip = (page: Page, start: string) =>
  page.evaluate((target) => {
    const block = [...document.querySelectorAll(".tiptap p")].find((p) =>
      p.textContent?.startsWith(target),
    );
    if (!block) throw new Error(`no paragraph starts with "${target}"`);
    const { x, y, width, height } = block.getBoundingClientRect();
    return { x, y, width, height };
  }, start);

/** A caret in the title: no selection paint, no bubble, no hover. */
async function settleAfterApply(page: Page) {
  await page.evaluate(() =>
    window.__tiptap_editor?.chain().focus().setTextSelection(2).run(),
  );
  const viewport = page.viewportSize();
  await page.mouse.move((viewport?.width ?? 800) - 2, 2);
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
}

/**
 * Pixels whose colour differs by more than 2 levels in any channel. Two
 * renders of the same colours still differ at a few anti-aliased edges
 * where a mark's element went away (a link's underline ends).
 */
const differingPixels = (page: Page, a: Buffer, b: Buffer) =>
  page.evaluate(
    async ([first, second]) => {
      const pixels = async (base64: string) => {
        // Not `fetch` on a data: URL, which the page's CSP refuses.
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const bitmap = await createImageBitmap(
          new Blob([bytes], { type: "image/png" }),
        );
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("2d canvas unavailable");
        context.drawImage(bitmap, 0, 0);
        return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      };
      const [x, y] = await Promise.all([pixels(first), pixels(second)]);
      if (x.length !== y.length) return Number.POSITIVE_INFINITY;
      let count = 0;
      for (let i = 0; i < x.length; i += 4) {
        const diff = Math.max(
          Math.abs(x[i] - y[i]),
          Math.abs(x[i + 1] - y[i + 1]),
          Math.abs(x[i + 2] - y[i + 2]),
        );
        if (diff > 2) count += 1;
      }
      return count;
    },
    [a.toString("base64"), b.toString("base64")] as const,
  );

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

/** The focus ring's outline, worn by the previewed swatch too. */
const STRONG = "solid 2px";
/** Keyboard focus while the pointer previews another swatch. */
const WEAK = "dashed 1px";

/** A swatch's outline: style and width ("none" without one), and colour. */
const ring = (swatch: Locator) =>
  swatch.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      style:
        cs.outlineStyle === "none"
          ? "none"
          : `${cs.outlineStyle} ${cs.outlineWidth}`,
      color: cs.outlineColor,
    };
  });

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

  // Over a coloured, highlighted link, inline code and a header cell's tint,
  // the preview renders what applying does, pixel for pixel: it reuses the
  // colours those contexts render, never a fixed page colour.
  for (const [swatch, kind] of [
    ["Default text", "text"],
    ["No highlight", "highlight"],
  ] as const) {
    for (const [where, start] of [
      ["a link and inline code", "Mix"],
      ["a table header cell", "Head"],
    ] as const) {
      for (const theme of ["light", "dark"] as const) {
        test(`'${swatch}' over ${where} previews exactly what applying renders (${theme})`, async ({
          page,
        }) => {
          await setTheme(page, theme);
          await openDoc(page, CONTEXT_DOC);
          await selectBlock(page, start);
          const dialog = await openPopover(page, kind);
          const button = dialog.getByRole("button", { name: swatch });
          await button.hover();
          await expect(previews(page).first()).toBeVisible();
          const clip = await blockClip(page, start);
          // The popover must not cover the pixels compared.
          const box = await dialog.boundingBox();
          expect(box && box.y + box.height <= clip.y).toBe(true);
          const previewed = await page.screenshot({ clip });

          await button.click();
          await expect(button).toHaveAttribute("aria-pressed", "true");
          await dialog.locator(".st-color-row-label").first().hover();
          await expect(previews(page)).toHaveCount(0);
          // The applied result under the same wrapper the preview used (it
          // inherits every colour and only drops the blurred selection's
          // tint), so the two renders differ in colour alone.
          await page.evaluate(() =>
            window.__tiptap_editor?.commands.setActionPreview({
              class: "tt-preview",
              style: "background-color: transparent",
            }),
          );
          await expect(previews(page).first()).toBeVisible();
          const applied = await page.screenshot({ clip });
          // 0 to 2 pixels differ on macOS; a fixed page colour differed in
          // 188 to 1,298. 40 leaves room for other platforms' anti-aliasing.
          expect(
            await differingPixels(page, previewed, applied),
          ).toBeLessThanOrEqual(40);
        });
      }
    }
  }

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

  for (const theme of ["light", "dark"] as const) {
    test(`the previewed swatch wears the focus ring; focus elsewhere drops to a dashed one (${theme})`, async ({
      page,
    }) => {
      await setTheme(page, theme);
      await openDoc(page);
      await selectText(page, "some words");
      const dialog = await openPopover(page, "text");
      const focused = dialog.locator("button:focus");
      await expect(focused).toHaveAccessibleName("Default text");
      expect(await focused.evaluate((el) => el.matches(":focus-visible"))).toBe(
        true,
      );
      const focusRing = await ring(focused);
      expect(focusRing.style).toBe(STRONG);

      // A mouse-opened popover: the pointer's swatch is the previewed one,
      // so it takes the ring and the focused swatch drops to a dashed one.
      const red = dialog.getByRole("button", { name: "Red text" });
      await red.hover();
      await expect(previews(page)).toHaveAttribute("data-text-color", "red");
      await expect.poll(async () => (await ring(red)).style).toBe(STRONG);
      expect((await ring(red)).color).toBe(focusRing.color);
      await expect.poll(async () => (await ring(focused)).style).toBe(WEAK);

      // Arrows take over: the focused swatch is previewed and strong
      // again; Red, still under the pointer, shows no ring.
      await page.keyboard.press("ArrowRight");
      await expect(focused).toHaveAccessibleName("Gray text");
      await expect(previews(page)).toHaveAttribute("data-text-color", "gray");
      await expect.poll(async () => (await ring(focused)).style).toBe(STRONG);
      expect((await ring(red)).style).toBe("none");

      // The pointer moves on: the swatch under it takes the ring back.
      const blue = dialog.getByRole("button", { name: "Blue text" });
      await blue.hover();
      await expect(previews(page)).toHaveAttribute("data-text-color", "blue");
      await expect.poll(async () => (await ring(blue)).style).toBe(STRONG);
      expect((await ring(focused)).style).toBe(WEAK);

      // Off the swatches: the focus ring is the only marker again.
      await dialog.locator(".st-color-row-label").first().hover();
      await expect.poll(async () => (await ring(focused)).style).toBe(STRONG);
      expect((await ring(blue)).style).toBe("none");
    });
  }

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
    // A tap marks no swatch: the ring is for a pointer that hovers.
    const blue = dialog.getByRole("button", { name: "Blue text" });
    await blue.tap();
    await expect(blue).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.locator("[data-pointed]")).toHaveCount(0);
    expect((await ring(blue)).style).toBe("none");

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

/**
 * The phone "Text format" sheet on a narrow window. Its scrim dims the
 * page; while a swatch previews, it clears so the previewed colour shows
 * true, and comes back when the preview ends. Touch never previews, so
 * its scrim never changes.
 */
const PHONE = { width: 375, height: 812 };
const scrim = (page: Page) => page.locator('[data-slot="sheet-overlay"]');
const scrimColor = (page: Page) =>
  scrim(page).evaluate((el) => getComputedStyle(el).backgroundColor);
const TRANSPARENT = "rgba(0, 0, 0, 0)";

/** Selects `needle`, then opens the sheet from the bar's Aa cell. */
async function openSheetOn(page: Page, needle: string, touch: boolean) {
  await openDoc(page);
  await selectText(page, needle);
  const press = (target: Locator) => (touch ? target.tap() : target.click());
  await press(
    page
      .getByRole("toolbar", { name: "Selection formatting" })
      .getByRole("button", { name: "Back to all tools" }),
  );
  await press(row(page).getByRole("button", { name: "Text format" }));
  const sheet = page.locator("[data-format-sheet]");
  await expect(sheet.getByRole("button", { name: "Red text" })).toBeVisible();
  await sheet.evaluate((el) =>
    Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)),
  );
  return sheet;
}

test.describe("hover preview under the phone sheet", () => {
  test.use({ viewport: PHONE });

  test("the scrim clears while a swatch previews and returns after", async ({
    page,
  }) => {
    const sheet = await openSheetOn(page, "some words", false);
    expect(
      await page.evaluate(() => matchMedia("(pointer: fine)").matches),
    ).toBe(true);
    // The sheet slid up past the still mouse that clicked "Text format".
    // A swatch passing under it gets an enter and no move (and often no
    // leave): nothing previews until the mouse moves.
    await sheet
      .getByRole("button", { name: "Teal text" })
      .dispatchEvent("pointerover", { pointerType: "mouse" });
    await page.waitForTimeout(DWELL);
    await expect(previews(page)).toHaveCount(0);
    await expect(sheet.locator("[data-pointed]")).toHaveCount(0);
    const dimmed = await scrimColor(page);
    expect(dimmed).not.toBe(TRANSPARENT);

    await sheet.getByRole("button", { name: "Red text" }).hover();
    await expect(previews(page)).toHaveText("some words");
    await expect.poll(() => scrimColor(page)).toBe(TRANSPARENT);
    // Still a modal sheet: the scrim keeps catching taps on the page.
    await expect(scrim(page)).toBeVisible();

    // Swatch to swatch keeps it clear; leaving the grid brings it back.
    await sheet.getByRole("button", { name: "Yellow highlight" }).hover();
    await expect(previews(page)).toHaveAttribute("data-highlight", "yellow");
    expect(await scrimColor(page)).toBe(TRANSPARENT);
    await sheet.getByRole("heading", { name: "Style" }).hover();
    await expect(previews(page)).toHaveCount(0);
    await expect.poll(() => scrimColor(page)).toBe(dimmed);
  });
});

test.describe("hover preview under the phone sheet on touch", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: PHONE });

  test("touch: the scrim never changes; a tap applies as before", async ({
    page,
  }) => {
    const sheet = await openSheetOn(page, "some words", true);
    expect(
      await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
    ).toBe(true);
    const dimmed = await scrimColor(page);
    const swatch = sheet.getByRole("button", { name: "Red text" });
    await swatch.hover();
    await page.waitForTimeout(DWELL);
    await expect(previews(page)).toHaveCount(0);
    expect(await scrimColor(page)).toBe(dimmed);
    await swatch.tap();
    await expect(swatch).toHaveAttribute("aria-pressed", "true");
    expect(await scrimColor(page)).toBe(dimmed);
  });
});

/**
 * The colour swatches: the row's popover at desktop widths, the Aa sheet
 * (its colour panel) on a phone-width bar used with a mouse.
 */
async function openSwatches(page: Page, kind: "text" | "highlight") {
  const name = kind === "text" ? "More text colours" : "More highlight colours";
  const inRow = row(page).getByRole("button", { name });
  if (await inRow.isVisible()) return openPopover(page, kind);
  await page.getByRole("button", { name: "Back to all tools" }).click();
  await page.getByRole("button", { name: "Text format" }).click();
  const sheet = page.locator("[data-format-sheet]");
  await expect(sheet.locator(".st-swatch").first()).toBeVisible();
  return sheet;
}

test.describe("hover preview design-review screenshots", () => {
  test.skip(!SCREENS, "PREVIEW_SCREENS_DIR only");
  test.use({ deviceScaleFactor: 2 });

  for (const width of [1440, 375] as const) {
    for (const theme of ["light", "dark"] as const) {
      test(`'Default text' and 'No highlight' in context at ${width} (${theme})`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 900 });
        await setTheme(page, theme);
        for (const [swatch, kind, slug] of [
          ["Default text", "text", "default-text"],
          ["No highlight", "highlight", "no-highlight"],
        ] as const) {
          for (const [start, where] of [
            ["Mix", "link-code"],
            ["Head", "header-cell"],
          ] as const) {
            const name = `${SCREENS}/${slug}-${where}-${width}-${theme}`;
            await openDoc(page, CONTEXT_DOC);
            await selectBlock(page, start);
            const dialog = await openSwatches(page, kind);
            const button = dialog.getByRole("button", { name: swatch });
            await button.hover();
            await expect(previews(page).first()).toBeVisible();
            await page.screenshot({ path: `${name}.png` });
            await page.screenshot({
              path: `${name}-closeup.png`,
              clip: await blockClip(page, start),
            });
            await button.click();
            await page.keyboard.press("Escape");
            await settleAfterApply(page);
            await page.screenshot({
              path: `${name}-applied-closeup.png`,
              clip: await blockClip(page, start),
            });
          }
        }
      });
    }
  }
});
