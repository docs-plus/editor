/**
 * Phone docked bar and the "Text format" sheet (spec §4.7, §6.7, §6.8,
 * #269, #308). Every case runs as a touch phone; the first assertion of
 * each proves the pointer is coarse, so a mouse run can never pass here.
 */
import { expect, type Page, test } from "@playwright/test";

import {
  expectNoSeriousA11yViolations,
  openToolbarTestDoc,
  setTheme,
} from "./helpers/a11y";

const PHONE = { width: 390, height: 844 };
const SCREENS = ".superpowers/screens-r2-phone";
const CELLS = [
  "Undo",
  "Redo",
  "Text format",
  "Bold",
  "Italic",
  "List",
  "Indent",
  "Insert",
];

test.use({ hasTouch: true, isMobile: true, viewport: PHONE });

const bar = (page: Page) => page.getByRole("toolbar", { name: "Formatting" });
/** The same bar while text is selected (PR E's selection cells). */
const selectionBar = (page: Page) =>
  page.getByRole("toolbar", { name: "Selection formatting" });
/** Design pass §6: eight cells, no scroll (U leaves below 360px). */
const SELECTION_CELLS = [
  "Bold",
  "Italic",
  "Underline",
  /^Apply text colour: /,
  /^Apply highlight: /,
  "Link",
  "Paint format",
  "Back to all tools",
];
const sheet = (page: Page) => page.getByRole("dialog", { name: "Text format" });

async function expectCoarse(page: Page) {
  expect(
    await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
  ).toBe(true);
}

async function openDoc(page: Page) {
  await expectCoarse(page);
  await openToolbarTestDoc(page);
  await expect(bar(page)).toBeVisible();
  // Next's dev indicator sits over the first cell and eats its taps.
  await page.addStyleTag({
    content: "nextjs-portal { display: none !important; }",
  });
}

/**
 * Appends a paragraph and selects `text` in it. The bar swaps to the
 * selection cells; unless `keepSelectionCells`, "Back to all tools" brings
 * the normal cells back with the selection kept.
 */
async function selectNewParagraph(
  page: Page,
  text = "alpha",
  { keepSelectionCells = false } = {},
) {
  await selectText(page, text);
  await expect(selectionBar(page)).toBeVisible();
  if (keepSelectionCells) return;
  await selectionBar(page)
    .getByRole("button", { name: "Back to all tools" })
    .tap();
  await expect(bar(page)).toBeVisible();
}

async function selectText(page: Page, text: string) {
  await page.evaluate((value) => {
    const editor = window.__tiptap_editor;
    if (!editor) throw new Error("editor missing");
    const end = editor.state.doc.content.size;
    editor
      .chain()
      .focus()
      .insertContentAt(end, {
        type: "paragraph",
        content: [{ type: "text", text: value }],
      })
      .run();
    const to = editor.state.doc.content.size - 1;
    editor
      .chain()
      .setTextSelection({ from: to - value.length, to })
      .run();
  }, text);
}

/** A mark attribute (or true for attr-less marks) on the last paragraph. */
const lastMark = (page: Page, mark: string, attr?: string) =>
  page.evaluate(
    ([name, key]) => {
      const doc = window.__tiptap_editor?.state.doc;
      let block = doc?.lastChild ?? null;
      doc?.forEach((child) => {
        if (child.textContent) block = child;
      });
      const found = block?.firstChild?.marks.find((m) => m.type.name === name);
      if (!found) return null;
      return key ? ((found.attrs[key] as string | undefined) ?? null) : true;
    },
    [mark, attr ?? ""] as const,
  );

/** The last block with text (a trailing empty paragraph may follow it). */
const lastBlock = (page: Page) =>
  page.evaluate(() => {
    const doc = window.__tiptap_editor?.state.doc;
    let node = doc?.lastChild ?? null;
    doc?.forEach((child) => {
      if (child.textContent) node = child;
    });
    return {
      type: node?.type.name ?? null,
      level: (node?.attrs.level as number | undefined) ?? null,
      align: (node?.attrs.textAlign as string | undefined) ?? null,
    };
  });

/** Visible targets under `selector` smaller than 44×44. */
const smallTargets = (page: Page, selector: string) =>
  page.locator(selector).evaluateAll((els) =>
    els
      .filter((el) => (el as HTMLElement).checkVisibility())
      .map((el) => {
        const box = el.getBoundingClientRect();
        return {
          name: el.getAttribute("aria-label") ?? el.textContent ?? "",
          width: Math.round(box.width),
          height: Math.round(box.height),
        };
      })
      .filter((box) => box.width < 44 || box.height < 44),
  );

async function openSheet(page: Page) {
  await bar(page).getByRole("button", { name: "Text format" }).tap();
  await expect(sheet(page)).toBeVisible();
  await sheet(page).getByRole("button", { name: "Heading 1" }).waitFor();
  await sheet(page).evaluate((el) =>
    Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)),
  );
}

test("320px: the empty title grows with its wrapped placeholder, focused or not", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await openDoc(page);
  const measure = () =>
    page.evaluate(() => {
      const title = document.querySelector(".tiptap > h1");
      const next = title?.nextElementSibling;
      if (!title || !next) throw new Error("title missing");
      const box = title.getBoundingClientRect();
      const lineHeight = Number.parseFloat(getComputedStyle(title).lineHeight);
      const caret = window.__tiptap_editor?.view.coordsAtPos(1);
      return {
        lines: Math.round(box.height / lineHeight),
        overlap: box.bottom - next.getBoundingClientRect().top,
        caretTop: caret ? caret.top - box.top : null,
        caretLeft: caret ? caret.left - box.left : null,
      };
    });
  // Focused (the Placeholder extension's text): two lines, in flow.
  const focused = await measure();
  expect(focused.lines).toBe(2);
  expect(focused.overlap).toBeLessThanOrEqual(0);
  // The caret starts the first line.
  expect(focused.caretTop).toBeCloseTo(0, 0);
  expect(focused.caretLeft).toBeCloseTo(0, 0);
  // Not focused (the title's own placeholder): the same.
  await page.evaluate(() => window.__tiptap_editor?.commands.blur());
  const blurred = await measure();
  expect(blurred.lines).toBe(2);
  expect(blurred.overlap).toBeLessThanOrEqual(0);
});

for (const [width, height] of [
  [390, 844],
  [375, 812],
  [360, 740],
  [320, 568],
] as const) {
  // Below 404px Redo lives in the sheet at all times (design pass §6).
  const cells = CELLS.filter((name) => width >= 404 || name !== "Redo");
  test(`${width}px: one 44px bar of ${cells.length} 44×44 cells, docked at the bottom`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await openDoc(page);
    await expect(page.getByRole("toolbar")).toHaveCount(1);
    const names = await bar(page)
      .locator("[data-toolbar-item]")
      .evaluateAll((els) =>
        els
          .filter((el) => (el as HTMLElement).checkVisibility())
          .map((el) => el.getAttribute("aria-label")),
      );
    expect(names).toEqual(cells);
    expect(await smallTargets(page, '[role="toolbar"] button')).toEqual([]);
    const box = await bar(page).boundingBox();
    expect(box?.height).toBe(44);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBe(height);
    expect(
      await bar(page).evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBeLessThanOrEqual(0);
  });
}

test("Bold shows its state with aria-pressed", async ({ page }) => {
  await openDoc(page);
  await selectNewParagraph(page);
  const bold = bar(page).getByRole("button", { name: "Bold", exact: true });
  await expect(bold).toHaveAttribute("aria-pressed", "false");
  await bold.tap();
  await expect.poll(() => lastMark(page, "bold")).toBe(true);
  await expect(bold).toHaveAttribute("aria-pressed", "true");
  // Aa opens a dialog: a popup button, never a toggle.
  const aa = bar(page).getByRole("button", { name: "Text format" });
  await expect(aa).toHaveAttribute("aria-haspopup", "dialog");
  await expect(aa).not.toHaveAttribute("aria-pressed", /.*/);
});

test("the sheet applies style, size, colours, align and more, then returns focus to Aa", async ({
  page,
}) => {
  await openDoc(page);
  await selectNewParagraph(page);
  await openSheet(page);
  const dialog = sheet(page);
  for (const name of ["Style", "Size", "Colours", "Align", "More"]) {
    await expect(dialog.getByRole("heading", { name })).toBeVisible();
  }
  await expect(dialog).toHaveAttribute("data-toolbar-popup", "");
  // Colours first: a pick keeps the sheet open (try colours in place).
  await dialog.getByRole("button", { name: "Red text" }).tap();
  await expect.poll(() => lastMark(page, "textColor", "color")).toBe("red");
  await expect(dialog).toBeVisible();
  // The action's own editor focus must not leave the sheet (a real phone
  // would raise the keyboard over it).
  const focusInSheet = () =>
    page.evaluate(
      () =>
        new Promise<boolean>((resolve) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() =>
              resolve(
                document
                  .querySelector("[data-format-sheet]")
                  ?.contains(document.activeElement) ?? false,
              ),
            ),
          ),
        ),
    );
  expect(await focusInSheet()).toBe(true);
  await dialog.getByRole("button", { name: "Yellow highlight" }).tap();
  await expect.poll(() => lastMark(page, "highlight", "color")).toBe("yellow");
  await expect(
    dialog
      .getByRole("group", { name: "Text colour" })
      .getByRole("button", { name: "Red text" }),
  ).toHaveAttribute("aria-pressed", "true");
  // Size: the stepper over size.*.
  await dialog.getByRole("button", { name: "Increase font size" }).tap();
  await expect.poll(() => lastMark(page, "fontSize", "size")).toBe("lg");
  await expect(
    dialog.getByRole("spinbutton", { name: "Font size" }),
  ).toHaveAttribute("aria-valuetext", /^Large/);
  // More: a toggle with its state.
  const sup = dialog.getByRole("button", { name: "Superscript" });
  await sup.tap();
  await expect.poll(() => lastMark(page, "superscript")).toBe(true);
  await expect(sup).toHaveAttribute("aria-pressed", "true");
  // Align and style change the block; the sheet stays open throughout.
  await dialog.getByRole("button", { name: "Align center" }).tap();
  await expect.poll(async () => (await lastBlock(page)).align).toBe("center");
  await dialog.getByRole("button", { name: "Heading 2" }).tap();
  await expect.poll(async () => (await lastBlock(page)).level).toBe(2);
  expect(await focusInSheet()).toBe(true);
  await expect(
    dialog.getByRole("button", { name: "Heading 2" }),
  ).toHaveAttribute("aria-pressed", "true");
  // Size is disabled in headings, with the reason.
  await expect(
    dialog.getByRole("spinbutton", { name: "Font size" }),
  ).toHaveAttribute("aria-disabled", "true");
  await expect(dialog).toBeVisible();
  expect(
    await smallTargets(
      page,
      '[data-format-sheet] button, [data-format-sheet] [role="spinbutton"]',
    ),
  ).toEqual([]);

  await dialog.getByRole("button", { name: "Done" }).tap();
  await expect(dialog).toBeHidden();
  await expect(
    bar(page).getByRole("button", { name: "Text format" }),
  ).toBeFocused();
});

test("the title locks the style rows with a reason", async ({ page }) => {
  await openDoc(page);
  await page.evaluate(() =>
    window.__tiptap_editor?.chain().focus().setTextSelection(1).run(),
  );
  await openSheet(page);
  const h2 = sheet(page).getByRole("button", { name: "Heading 2" });
  await expect(h2).toHaveAttribute("aria-disabled", "true");
  const reasonId = await h2.getAttribute("aria-describedby");
  await expect(page.locator(`[id="${reasonId}"]`)).toHaveText(
    "Title is always H1.",
  );
});

test("read-only with the sheet open: sheet closes, bar hides, focus stays in the page", async ({
  page,
}) => {
  await openDoc(page);
  await selectNewParagraph(page);
  await openSheet(page);
  await page.evaluate(() => window.__tiptap_editor?.setEditable(false));
  await expect(sheet(page)).toBeHidden();
  await expect(bar(page)).toBeHidden();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.activeElement !== null &&
          document.activeElement !== document.body,
      ),
    )
    .toBe(true);
  await page.evaluate(() => window.__tiptap_editor?.setEditable(true));
  await expect(bar(page)).toBeVisible();
});

test("the caret stays above the bar while typing at the end of a long doc", async ({
  page,
}) => {
  await openDoc(page);
  await page.evaluate(() => {
    const editor = window.__tiptap_editor;
    if (!editor) return;
    const paragraphs = Array.from({ length: 60 }, (_, i) => ({
      type: "paragraph",
      content: [{ type: "text", text: `Line ${i + 1}` }],
    }));
    editor
      .chain()
      .focus()
      .insertContentAt(editor.state.doc.content.size, paragraphs)
      .run();
    editor.commands.focus("end");
  });
  await page.keyboard.press("Enter");
  await page.keyboard.type("typed at the end");
  const caretBottom = await page.evaluate(() => {
    const range = window.getSelection()?.getRangeAt(0);
    return range?.getBoundingClientRect().bottom ?? 0;
  });
  const barTop = (await bar(page).boundingBox())?.y ?? 0;
  expect(caretBottom).toBeGreaterThan(0);
  expect(caretBottom).toBeLessThanOrEqual(barTop);
  // CSS clears the bar too (outline jumps, scrollIntoView).
  expect(
    await page
      .locator(".document-editor-wrapper")
      .evaluate((el) => getComputedStyle(el).scrollPaddingBottom),
  ).toBe("44px");
});

test("the bar rides above the keyboard and resets when focus leaves", async ({
  page,
}) => {
  await openDoc(page);
  // Chromium has no on-screen keyboard: stand in a shrunken visualViewport.
  await page.evaluate(() => {
    const vv = window.visualViewport;
    if (!vv) throw new Error("no visualViewport");
    Object.defineProperty(vv, "height", {
      configurable: true,
      get: () => window.innerHeight - 300,
    });
    vv.dispatchEvent(new Event("resize"));
  });
  await expect
    .poll(async () => (await bar(page).boundingBox())?.y)
    .toBe(PHONE.height - 300 - 44);
  expect(
    await page
      .locator(".document-editor-wrapper")
      .evaluate((el) => getComputedStyle(el).scrollPaddingBottom),
  ).toBe("344px");
  // Focus leaving editable content (iOS keeps a stale offset): back down.
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
  await expect
    .poll(async () => (await bar(page).boundingBox())?.y)
    .toBe(PHONE.height - 44);
});

for (const theme of ["light", "dark"] as const) {
  test(`axe and screenshots of the bar and the open sheet (${theme})`, async ({
    page,
  }) => {
    await setTheme(page, theme);
    await openDoc(page);
    // Next's dev indicator sits over the first cell; keep it out of the evidence.
    await page.addStyleTag({
      content: "nextjs-portal { display: none !important; }",
    });
    await selectNewParagraph(page);
    await expectNoSeriousA11yViolations(page, ['[role="toolbar"]']);
    await page.screenshot({ path: `${SCREENS}/bar-${theme}.png` });
    await openSheet(page);
    await expectNoSeriousA11yViolations(page, ["[data-format-sheet]"]);
    await page.screenshot({ path: `${SCREENS}/sheet-${theme}.png` });
  });
}

/** Redo, Outdent and Link: the actions the phone reached nowhere before. */
test("below 404px Redo stays in the sheet and replays an undone edit", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openDoc(page);
  await selectNewParagraph(page, "alpha");
  await bar(page).getByRole("button", { name: "Bold", exact: true }).tap();
  await expect.poll(() => lastMark(page, "bold")).toBe(true);
  // Never on the bar, so the slot cell never shifts the other cells.
  await expect(bar(page).getByRole("button", { name: "Redo" })).toBeHidden();
  await bar(page).getByRole("button", { name: "Undo" }).tap();
  await expect.poll(() => lastMark(page, "bold")).toBeNull();
  await openSheet(page);
  const redo = sheet(page).getByRole("button", { name: "Redo" });
  await expect(redo).toBeVisible();
  await expect(redo).not.toHaveAttribute("aria-disabled", "true");
  await redo.tap();
  await expect.poll(() => lastMark(page, "bold")).toBe(true);
});

test("Outdent in the sheet lifts a nested list item", async ({ page }) => {
  await openDoc(page);
  await page.evaluate(() => {
    const editor = window.__tiptap_editor;
    if (!editor) throw new Error("editor missing");
    editor
      .chain()
      .focus()
      .insertContentAt(editor.state.doc.content.size, {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "one" }] },
              {
                type: "bulletList",
                content: [
                  {
                    type: "listItem",
                    content: [
                      {
                        type: "paragraph",
                        content: [{ type: "text", text: "nested" }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      })
      .run();
    let pos = 0;
    editor.state.doc.descendants((node, at) => {
      if (node.isText && node.text === "nested") pos = at + 1;
    });
    editor.chain().setTextSelection(pos).run();
  });
  const depth = () =>
    page.evaluate(
      () => window.__tiptap_editor?.state.selection.$from.depth ?? 0,
    );
  const before = await depth();
  await openSheet(page);
  const outdent = sheet(page).getByRole("button", { name: "Outdent" });
  await expect(outdent).not.toHaveAttribute("aria-disabled", "true");
  await outdent.tap();
  await expect.poll(depth).toBeLessThan(before);
});

test("Link in the sheet closes it and opens the Hyperlink create popover", async ({
  page,
}) => {
  await openDoc(page);
  await selectNewParagraph(page, "alpha");
  await openSheet(page);
  const link = sheet(page).getByRole("button", { name: "Link" });
  await expect(link).toHaveAttribute("aria-pressed", "false");
  expect(await smallTargets(page, "[data-format-sheet] button")).toEqual([]);
  await link.tap();
  await expect(sheet(page)).toBeHidden();
  const popover = page.locator(".hyperlink-create-popover");
  await expect(popover).toBeVisible();
  // The sheet's close must not pull focus back to Aa after its exit.
  const input = popover.locator("input").first();
  await expect(input).toBeFocused();
  await page.waitForTimeout(400);
  await expect(input).toBeFocused();
  await input.fill("https://example.com");
  await page.keyboard.press("Enter");
  await expect
    .poll(() => lastMark(page, "hyperlink", "href"))
    .toBe("https://example.com");
});

test("the sheet is modal: Tab never leaves it, and the page behind is inert", async ({
  page,
}) => {
  await openDoc(page);
  await selectNewParagraph(page);
  await openSheet(page);
  await expect(sheet(page)).toHaveAttribute("aria-modal", "true");
  expect(
    await page.evaluate(
      () => document.querySelector<HTMLElement>(".app-shell")?.inert,
    ),
  ).toBe(true);
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(
        () =>
          document
            .querySelector("[data-format-sheet]")
            ?.contains(document.activeElement) ?? false,
      ),
      `Tab ${i + 1} stays in the sheet`,
    ).toBe(true);
  }
  await sheet(page).getByRole("button", { name: "Done" }).tap();
  await expect(sheet(page)).toBeHidden();
  expect(
    await page.evaluate(
      () => document.querySelector<HTMLElement>(".app-shell")?.inert,
    ),
  ).toBe(false);
  await expect(
    bar(page).getByRole("button", { name: "Text format" }),
  ).toBeFocused();
});

test("List is a radio menu like the row's", async ({ page }) => {
  await openDoc(page);
  await selectNewParagraph(page);
  await bar(page).getByRole("button", { name: "List" }).tap();
  const menu = page.getByRole("menu", { name: "List" });
  await expect(menu.getByRole("menuitemradio")).toHaveCount(4);
  await expect(
    menu.getByRole("menuitemradio", { name: "No list" }),
  ).toHaveAttribute("aria-checked", "true");
  await menu.getByRole("menuitemradio", { name: /bullet/i }).tap();
  await expect(menu).toBeHidden();
  await expect
    .poll(async () => (await lastBlock(page)).type)
    .toBe("bulletList");
  await bar(page).getByRole("button", { name: "List" }).tap();
  await expect(
    page
      .getByRole("menu", { name: "List" })
      .getByRole("menuitemradio", { name: /bullet/i }),
  ).toHaveAttribute("aria-checked", "true");
});

test.describe("selection cells (PR E, spec §4.7)", () => {
  test("a text selection swaps the bar to 44×44 selection cells; Back brings all tools back", async ({
    page,
  }) => {
    await openDoc(page);
    await selectNewParagraph(page, "alpha", { keepSelectionCells: true });
    await expect(page.getByRole("toolbar")).toHaveCount(1);
    const cells = selectionBar(page).getByRole("button");
    await expect(cells).toHaveCount(SELECTION_CELLS.length);
    for (const [index, name] of SELECTION_CELLS.entries()) {
      await expect(cells.nth(index)).toHaveAccessibleName(name);
    }
    // All 44×44 and nothing scrolls (design pass §6).
    expect(await smallTargets(page, "[data-mobile-bar] button")).toEqual([]);
    expect(
      await selectionBar(page).evaluate(
        (el) => el.scrollWidth - el.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);

    await selectionBar(page)
      .getByRole("button", { name: "Bold", exact: true })
      .tap();
    expect(await lastMark(page, "bold")).toBe(true);
    await expect(
      selectionBar(page).getByRole("button", { name: "Bold", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");

    // Back keeps all tools while the text stays selected.
    await selectionBar(page)
      .getByRole("button", { name: "Back to all tools" })
      .tap();
    await expect(bar(page)).toBeVisible();
    await expect(
      bar(page).getByRole("button", { name: "Text format" }),
    ).toBeVisible();

    // A caret brings nothing back; the next selection swaps again.
    await page.evaluate(() =>
      window.__tiptap_editor?.commands.setTextSelection(3),
    );
    await expect(bar(page)).toBeVisible();
    await selectText(page, "beta");
    await expect(selectionBar(page)).toBeVisible();
  });

  test("the bar never swaps under keyboard focus, and Back moves focus to a cell, not the page", async ({
    page,
  }) => {
    await openDoc(page);
    await selectNewParagraph(page, "alpha", { keepSelectionCells: true });
    const italic = selectionBar(page).getByRole("button", {
      name: "Italic",
      exact: true,
    });
    await italic.focus();
    await expect(italic).toBeFocused();

    // The selection collapses while focus is in the bar: no swap.
    await page.evaluate(() => {
      const editor = window.__tiptap_editor;
      editor?.commands.setTextSelection(editor.state.selection.to);
    });
    await expect(selectionBar(page)).toBeVisible();
    await expect(italic).toBeFocused();

    // Back from the keyboard: focus lands on the first enabled cell.
    await page.keyboard.press("End");
    const back = selectionBar(page).getByRole("button", {
      name: "Back to all tools",
    });
    await expect(back).toBeFocused();
    // Focused by keyboard, the last cell before Back is not hidden by it.
    await page.keyboard.press("ArrowLeft");
    const brush = selectionBar(page).getByRole("button", {
      name: "Paint format",
    });
    await expect(brush).toBeFocused();
    const [brushBox, backBox] = await Promise.all([
      brush.boundingBox(),
      back.boundingBox(),
    ]);
    expect((brushBox?.x ?? 0) + (brushBox?.width ?? 0)).toBeLessThanOrEqual(
      (backBox?.x ?? 0) + 1,
    );
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await expect(bar(page)).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const active = document.activeElement;
          return active?.closest("[data-mobile-bar]") !== null &&
            active !== document.body
            ? (active?.getAttribute("aria-label") ?? "")
            : "body";
        }),
      )
      .toBe("Undo");
  });

  test("Paint format: tap the brush, select, tap again; never on its own", async ({
    page,
  }) => {
    await openDoc(page);
    await selectNewParagraph(page, "alpha", { keepSelectionCells: true });
    await selectionBar(page)
      .getByRole("button", { name: "Italic", exact: true })
      .tap();
    expect(await lastMark(page, "italic")).toBe(true);
    const brush = selectionBar(page).getByRole("button", {
      name: "Paint format",
    });
    await brush.tap();
    await expect(brush).toHaveAttribute("aria-pressed", "true");
    const pill = page.locator("[data-status-pill]");
    await expect(pill).toHaveText("Select text, then tap the brush again");

    // The handles settle many times: selecting alone never paints.
    await selectText(page, "beta");
    await page.waitForTimeout(300);
    expect(await lastMark(page, "italic")).toBeNull();
    const armed = selectionBar(page).getByRole("button", {
      name: "Paint format",
    });
    await expect(armed).toHaveAttribute("aria-pressed", "true");
    await armed.tap();
    await expect.poll(() => lastMark(page, "italic")).toBe(true);
    await expect(armed).toHaveAttribute("aria-pressed", "false");
    await expect(pill).toHaveText("Formatting applied");
  });

  test("a tap on an unavailable cell says why on the pill", async ({
    page,
  }) => {
    await openDoc(page);
    await selectNewParagraph(page, "alpha", { keepSelectionCells: true });
    await page.evaluate(() =>
      window.__tiptap_editor?.commands.setMark("inlineCode"),
    );
    const brush = selectionBar(page).getByRole("button", {
      name: "Paint format",
    });
    await expect(brush).toHaveAttribute("aria-disabled", "true");
    // Unavailable but still tappable (Playwright skips aria-disabled).
    await brush.tap({ force: true });
    await expect(page.locator("[data-status-pill]")).toHaveText(
      "Code has no formatting.",
    );
  });

  test("the status pill sits above the bar, uncovered by the chips", async ({
    page,
  }) => {
    await openDoc(page);
    await selectNewParagraph(page, "alpha", { keepSelectionCells: true });
    await selectionBar(page)
      .getByRole("button", { name: "Paint format" })
      .tap();
    const pill = page.locator("[data-status-pill]");
    await expect(pill).toBeVisible();
    await pill.evaluate((el) =>
      Promise.all(el.getAnimations().map((animation) => animation.finished)),
    );
    const [pillBox, barBox] = await Promise.all([
      pill.boundingBox(),
      selectionBar(page).boundingBox(),
    ]);
    // 8px above the bar's cells (its 1px top border is inside), inside
    // the viewport's width.
    expect(
      Math.round((barBox?.y ?? 0) - (pillBox?.y ?? 0) - (pillBox?.height ?? 0)),
    ).toBe(7);
    expect(pillBox?.x ?? -1).toBeGreaterThanOrEqual(0);
    // Nothing paints over it: not the presence and Privacy chips.
    const covered = await pill.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const points = [
        [box.left + 4, box.top + box.height / 2],
        [box.left + box.width / 2, box.top + box.height / 2],
        [box.right - 4, box.top + box.height / 2],
      ];
      return points.filter(([x, y]) => {
        const hit = document.elementFromPoint(x, y);
        return !hit || !el.contains(hit);
      }).length;
    });
    expect(covered).toBe(0);
    // A sibling of the cells, inside no masked or scrolling element.
    expect(
      await pill.evaluate((el) => {
        // Up to the bar: it is fixed, so nothing past it clips the pill.
        const bar = el.closest("[data-mobile-bar]");
        for (
          let node = el.parentElement;
          node && node !== bar?.parentElement;
          node = node.parentElement
        ) {
          const style = getComputedStyle(node);
          if (
            (style.maskImage || "none") !== "none" ||
            style.overflowX === "auto"
          ) {
            return false;
          }
        }
        return el.parentElement?.matches("[data-mobile-bar]") ?? false;
      }),
    ).toBe(true);
  });

  test("↑/↓ in the Aa sheet's colours keep the column the swatches show", async ({
    page,
  }) => {
    await openDoc(page);
    await selectNewParagraph(page, "alpha");
    await openSheet(page);
    const text = sheet(page).getByRole("group", { name: "Text colour" });
    const swatches = text.getByRole("button");
    // The sheet's grid fills its width, so its lines hold more swatches
    // than the popover's six.
    const perLine = await swatches.evaluateAll((els) => {
      const top = els[0].getBoundingClientRect().top;
      return els.filter((el) => el.getBoundingClientRect().top === top).length;
    });
    expect(perLine).toBeGreaterThan(6);
    expect(await swatches.count()).toBeGreaterThan(perLine);
    await swatches.nth(2).focus();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    const from = await page.evaluate(() =>
      document.activeElement?.getBoundingClientRect().toJSON(),
    );
    await page.keyboard.press("ArrowDown");
    const to = await page.evaluate(() =>
      document.activeElement?.getBoundingClientRect().toJSON(),
    );
    // Straight down: the same column, the next line.
    expect(Math.round(to.left)).toBe(Math.round(from.left));
    expect(to.top).toBeGreaterThan(from.top);
    await page.keyboard.press("ArrowUp");
    const back = await page.evaluate(() =>
      document.activeElement?.getBoundingClientRect().toJSON(),
    );
    expect(back).toEqual(from);
  });

  test("the Aa sheet's Your formats apply with a preview, and Save opens the save view", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        "tinydocy-formats",
        JSON.stringify({
          v: 1,
          formats: [{ id: "fnote", name: "Note", bundle: { italic: true } }],
        }),
      );
    });
    await openDoc(page);
    await selectNewParagraph(page, "alpha");
    await openSheet(page);
    const section = sheet(page).getByRole("region", { name: "Your formats" });
    const note = section.getByRole("button", { name: "Note", exact: true });
    await expect(note).toHaveAccessibleDescription("Italic");
    expect(
      await note
        .locator(".st-format-preview")
        .evaluate((el) => getComputedStyle(el).fontStyle),
    ).toBe("italic");
    await note.tap();
    await expect.poll(() => lastMark(page, "italic")).toBe(true);
    // A pick keeps the sheet open.
    await expect(sheet(page)).toBeVisible();
    await section
      .getByRole("button", { name: "Save selection as format…" })
      .tap();
    await expect(sheet(page)).toBeHidden();
    await expect(page.locator("[data-command-palette] input")).toBeFocused();
  });

  for (const [width, height] of [
    [375, 812],
    [320, 568],
  ] as const) {
    test(`${width}px: Save's reason line sits right under it, one item`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await openDoc(page);
      // Plain text: nothing to save, so Save says why under itself.
      await selectNewParagraph(page, "alpha");
      await openSheet(page);
      const section = sheet(page).getByRole("region", {
        name: "Your formats",
      });
      const save = section.getByRole("button", {
        name: "Save selection as format…",
      });
      await expect(save).toBeDisabled();
      await expect(save).toHaveAccessibleDescription(
        "Select formatted text to save it.",
      );
      await save.scrollIntoViewIfNeeded();
      const gap = await save.evaluate((button) => {
        const label = button.querySelector("span")?.getBoundingClientRect();
        const reason = button.nextElementSibling;
        if (!label || !reason?.firstChild) return null;
        // The text's own boxes, not the elements' padding.
        const range = document.createRange();
        range.selectNodeContents(reason);
        const text = range.getClientRects()[0];
        return {
          gap: text.top - label.bottom,
          height: button.getBoundingClientRect().height,
        };
      });
      expect(gap).not.toBeNull();
      // One item: about 2px between the label and its reason.
      expect(gap?.gap ?? 99).toBeGreaterThanOrEqual(0);
      expect(gap?.gap ?? 99).toBeLessThanOrEqual(4);
      // The disabled target keeps its 44px.
      expect(gap?.height ?? 0).toBeGreaterThanOrEqual(44);
      await page.screenshot({
        path: `${SCREENS}/sheet-save-reason-${width}.png`,
      });
    });
  }

  test("the Aa sheet's Remove a format removes at once, with Undo on the pill", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        "tinydocy-formats",
        JSON.stringify({
          v: 1,
          formats: [
            { id: "fnote", name: "Note", bundle: { italic: true } },
            { id: "fwarn", name: "Warning", bundle: { bold: true } },
          ],
        }),
      );
    });
    await openDoc(page);
    await selectNewParagraph(page, "alpha");
    await openSheet(page);
    const section = sheet(page).getByRole("region", { name: "Your formats" });
    const toggle = section.getByRole("button", { name: "Remove a format" });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.tap();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const list = section.getByRole("list", { name: "Remove a format" });
    const remove = list.getByRole("button", { name: "Remove Note" });
    const box = await remove.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    await remove.tap();
    await expect(
      section.getByRole("button", { name: "Note", exact: true }),
    ).toHaveCount(0);
    const pill = page.locator('[data-status-pill="phone"]');
    await expect(pill).toContainText("Removed ‘Note’");
    // Over the open sheet, not under it.
    const [pillBox, sheetBox] = await Promise.all([
      pill.boundingBox(),
      sheet(page).boundingBox(),
    ]);
    expect((pillBox?.y ?? 0) + (pillBox?.height ?? 0)).toBeLessThanOrEqual(
      sheetBox?.y ?? 0,
    );
    await pill.getByRole("button", { name: /^Undo/ }).tap();
    await expect(
      section.getByRole("button", { name: "Note", exact: true }),
    ).toBeVisible();
  });

  test("the Save dialog's cap link opens the Aa sheet at Remove a format", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const formats = Array.from({ length: 20 }, (_, i) => ({
        id: `f${i}`,
        name: `Format ${i}`,
        bundle: { bold: true },
      }));
      localStorage.setItem(
        "tinydocy-formats",
        JSON.stringify({ v: 1, formats }),
      );
    });
    await openDoc(page);
    await selectNewParagraph(page, "alpha");
    await bar(page).getByRole("button", { name: "Bold", exact: true }).tap();
    await expect.poll(() => lastMark(page, "bold")).toBe(true);
    await openSheet(page);
    await sheet(page)
      .getByRole("region", { name: "Your formats" })
      .getByRole("button", { name: "Save selection as format…" })
      .tap();
    const palette = page.locator("[data-command-palette]");
    await expect(palette.locator("input")).toBeFocused();
    await palette.locator("input").fill("Another");
    await palette.getByRole("button", { name: "Remove a format" }).tap();
    await expect(palette).toHaveCount(0);
    await expect(sheet(page)).toBeVisible();
    await expect(
      sheet(page)
        .getByRole("list", { name: "Remove a format" })
        .getByRole("button", { name: "Remove Format 0" }),
    ).toBeFocused();
  });

  test("Back dismisses for that selection only: a direct reselect swaps again", async ({
    page,
  }) => {
    await openDoc(page);
    await selectNewParagraph(page, "alpha");
    await expect(bar(page)).toBeVisible();
    // No caret in between: straight to another selection, in one step.
    await page.evaluate(() => {
      const editor = window.__tiptap_editor;
      const to = editor?.state.selection.to ?? 0;
      editor?.commands.setTextSelection({ from: to - 5, to: to - 2 });
    });
    await expect(selectionBar(page)).toBeVisible();
  });

  for (const theme of ["light", "dark"] as const) {
    test(`axe: the selection cells (${theme})`, async ({ page }) => {
      await setTheme(page, theme);
      await openDoc(page);
      await selectNewParagraph(page, "alpha", { keepSelectionCells: true });
      await expectNoSeriousA11yViolations(page, ["[data-mobile-bar]"]);
    });
  }
});

test.describe("selection cells at 320px (design pass §6, WCAG 2.4.11)", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test("seven cells without U, no horizontal scroll, nothing under Back", async ({
    page,
  }) => {
    await openDoc(page);
    await selectNewParagraph(page, "alpha", { keepSelectionCells: true });
    const names = await selectionBar(page)
      .locator("[data-toolbar-item]")
      .evaluateAll((els) =>
        els
          .filter((el) => (el as HTMLElement).checkVisibility())
          .map((el) => el.getAttribute("aria-label")?.replace(/:.*/, "")),
      );
    expect(names).toEqual([
      "Bold",
      "Italic",
      "Apply text colour",
      "Apply highlight",
      "Link",
      "Paint format",
      "Back to all tools",
    ]);
    expect(await smallTargets(page, "[data-mobile-bar] button")).toEqual([]);
    expect(
      await selectionBar(page).evaluate(
        (el) => el.scrollWidth - el.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBeLessThanOrEqual(0);
    const back = selectionBar(page).getByRole("button", {
      name: "Back to all tools",
    });
    const backBox = await back.boundingBox();
    const brushBox = await selectionBar(page)
      .getByRole("button", { name: "Paint format" })
      .boundingBox();
    expect((brushBox?.x ?? 0) + (brushBox?.width ?? 0)).toBeLessThanOrEqual(
      (backBox?.x ?? 0) + 1,
    );
    // Back's left divider.
    expect(await back.evaluate((el) => getComputedStyle(el).boxShadow)).toMatch(
      /-1px 0px 0px/,
    );
  });
});

for (const width of [320, 375]) {
  test.describe(`the Aa sheet's Your formats at ${width}px (design pass §6, §10)`, () => {
    test.use({ viewport: { width, height: 700 } });

    test("no sideways scroll with the Remove list open; Save's reason shows", async ({
      page,
    }) => {
      await page.addInitScript(() => {
        localStorage.setItem(
          "tinydocy-formats",
          JSON.stringify({
            v: 1,
            formats: [
              { id: "fnote", name: "Note", bundle: { italic: true } },
              {
                id: "fwarn",
                name: "A very long warning format name",
                bundle: { bold: true, textColor: "red" },
              },
            ],
          }),
        );
      });
      await openDoc(page);
      await selectNewParagraph(page, "alpha");
      await openSheet(page);
      const section = sheet(page).getByRole("region", {
        name: "Your formats",
      });
      const toggle = section.getByRole("button", { name: "Remove a format" });
      await toggle.tap();
      const list = section.getByRole("list", { name: "Remove a format" });
      await expect(list).toBeVisible();
      const body = sheet(page).locator(".st-sheet-body");
      await section.scrollIntoViewIfNeeded();
      // Nothing wider than the sheet, even without its overflow-x net.
      await body.evaluate((el) => {
        (el as HTMLElement).style.overflowX = "auto";
      });
      expect(await body.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(
        0,
      );
      // Save and Remove span the width; the list sits under the toggle,
      // inset, never among the formats.
      const [saveBox, toggleBox, listBox, noteBox] = await Promise.all([
        section
          .getByRole("button", { name: "Save selection as format…" })
          .boundingBox(),
        toggle.boundingBox(),
        list.boundingBox(),
        section
          .getByRole("button", { name: "Note", exact: true })
          .boundingBox(),
      ]);
      if (!saveBox || !toggleBox || !listBox || !noteBox) {
        throw new Error("Your formats controls missing");
      }
      expect(Math.round(saveBox.width)).toBe(Math.round(toggleBox.width));
      expect(saveBox.width).toBeGreaterThan(noteBox.width * 1.5);
      expect(listBox.y).toBeGreaterThanOrEqual(toggleBox.y + toggleBox.height);
      const removeBox = await list.getByRole("button").first().boundingBox();
      expect(removeBox?.x ?? 0).toBeGreaterThan(toggleBox.x + 8);
      // Plain "alpha": nothing to save, and the reason is a visible line
      // (phones have no tooltips), read once as the description.
      const save = section.getByRole("button", {
        name: "Save selection as format…",
      });
      await expect(save).toHaveAttribute("aria-disabled", "true");
      await expect(save).toHaveAccessibleDescription(
        "Select formatted text to save it.",
      );
      await expect(
        section.getByText("Select formatted text to save it."),
      ).toBeVisible();
    });

    test("with a caret, why no format applies is one full-width line", async ({
      page,
    }) => {
      await page.addInitScript(() => {
        localStorage.setItem(
          "tinydocy-formats",
          JSON.stringify({
            v: 1,
            formats: [
              { id: "fnote", name: "Note", bundle: { italic: true } },
              { id: "fwarn", name: "Warning", bundle: { bold: true } },
              { id: "fcall", name: "Callout", bundle: { strike: true } },
            ],
          }),
        );
      });
      await openDoc(page);
      await openSheet(page);
      const section = sheet(page).getByRole("region", {
        name: "Your formats",
      });
      const note = section.getByRole("button", { name: "Note", exact: true });
      await expect(note).toHaveAttribute("aria-disabled", "true");
      await expect(note).toHaveAccessibleDescription(
        "Select text to apply a format.",
      );
      const reason = section.getByText("Select text to apply a format.");
      await expect(reason).toBeVisible();
      await section.scrollIntoViewIfNeeded();
      const [reasonBox, toggleBox] = await Promise.all([
        reason.boundingBox(),
        section.getByRole("button", { name: "Remove a format" }).boundingBox(),
      ]);
      expect(Math.round(reasonBox?.width ?? 0)).toBe(
        Math.round(toggleBox?.width ?? -1),
      );
      const body = sheet(page).locator(".st-sheet-body");
      await body.evaluate((el) => {
        (el as HTMLElement).style.overflowX = "auto";
      });
      expect(await body.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(
        0,
      );
    });
  });
}

test("the presence and Privacy chips hide while the selection bar shows", async ({
  page,
}) => {
  await openDoc(page);
  const chips = page.locator("[data-collab-status]");
  await expect(chips).toBeVisible();
  await selectNewParagraph(page, "alpha", { keepSelectionCells: true });
  await expect(chips).toBeHidden();
  await selectionBar(page)
    .getByRole("button", { name: "Back to all tools" })
    .tap();
  await expect(chips).toBeVisible();
});

test.describe("selection cells at 375px (design pass §6)", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("eight 44px cells with colour bars, no horizontal scroll", async ({
    page,
  }) => {
    await openDoc(page);
    await selectNewParagraph(page, "alpha", { keepSelectionCells: true });
    const cells = selectionBar(page).locator("[data-toolbar-item]");
    const names = await cells.evaluateAll((els) =>
      els
        .filter((el) => (el as HTMLElement).checkVisibility())
        .map((el) => el.getAttribute("aria-label")?.replace(/:.*/, "")),
    );
    expect(names).toEqual([
      "Bold",
      "Italic",
      "Underline",
      "Apply text colour",
      "Apply highlight",
      "Link",
      "Paint format",
      "Back to all tools",
    ]);
    expect(await smallTargets(page, "[data-mobile-bar] button")).toEqual([]);
    expect(
      await selectionBar(page).evaluate(
        (el) => el.scrollWidth - el.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    // The remembered colours show as bars under the colour icons.
    await expect(selectionBar(page).locator(".st-face-bar")).toHaveCount(2);
  });
});
