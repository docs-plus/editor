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
const SELECTION_CELLS = [
  "Bold",
  "Italic",
  "Underline",
  "Strike",
  /^Apply text colour: /,
  /^Apply highlight: /,
  "Link",
  "Clear formatting",
  "Repeat formatting",
  "Formats",
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

for (const [width, height] of [
  [390, 844],
  [375, 812],
  [360, 740],
  [320, 568],
] as const) {
  // Eight cells fit 360px; Redo moves into the sheet below that.
  const cells = CELLS.filter((name) => width >= 360 || name !== "Redo");
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
test("Redo sits beside Undo and replays an undone edit", async ({ page }) => {
  await openDoc(page);
  await selectNewParagraph(page, "alpha");
  await bar(page).getByRole("button", { name: "Bold", exact: true }).tap();
  await expect.poll(() => lastMark(page, "bold")).toBe(true);
  const undo = bar(page).getByRole("button", { name: "Undo" });
  const redo = bar(page).getByRole("button", { name: "Redo" });
  await expect(redo).toHaveAttribute("aria-disabled", "true");
  await undo.tap();
  await expect.poll(() => lastMark(page, "bold")).toBeNull();
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
    // The cells scroll sideways in their own container; Back sits beside
    // it, outside, all 44×44.
    expect(await smallTargets(page, "[data-mobile-bar] button")).toEqual([]);
    const scroller = selectionBar(page).locator("[data-phone-selection-cells]");
    expect(
      await scroller.evaluate((el) => getComputedStyle(el).overflowX),
    ).toBe("auto");
    await expect(
      scroller.getByRole("button", { name: "Back to all tools" }),
    ).toHaveCount(0);

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
    const formats = selectionBar(page).getByRole("button", {
      name: "Formats",
    });
    await expect(formats).toBeFocused();
    const [formatsBox, backBox] = await Promise.all([
      formats.boundingBox(),
      back.boundingBox(),
    ]);
    expect((formatsBox?.x ?? 0) + (formatsBox?.width ?? 0)).toBeLessThanOrEqual(
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

  test("Repeat in the selection cells repeats the last formatting", async ({
    page,
  }) => {
    await openDoc(page);
    await selectNewParagraph(page, "alpha", { keepSelectionCells: true });
    await selectionBar(page)
      .getByRole("button", { name: "Italic", exact: true })
      .tap();
    expect(await lastMark(page, "italic")).toBe(true);

    await selectText(page, "beta");
    // Named for what it repeats.
    const repeat = selectionBar(page).getByRole("button", {
      name: "Repeat Italic",
    });
    await expect(repeat).not.toHaveAttribute("aria-disabled", "true");
    await expect(repeat).toHaveAttribute("aria-keyshortcuts", /\+Alt\+v/i);
    await repeat.tap();
    expect(await lastMark(page, "italic")).toBe(true);
  });

  test("a tap on the unavailable Repeat cell shows why, on screen", async ({
    page,
  }) => {
    await openDoc(page);
    await selectNewParagraph(page, "alpha", { keepSelectionCells: true });
    const repeat = selectionBar(page).getByRole("button", {
      name: "Repeat formatting",
    });
    await expect(repeat).toHaveAttribute("aria-disabled", "true");
    // Unavailable but still tappable (Playwright skips aria-disabled).
    await repeat.tap({ force: true });
    const reason = page.locator("[data-phone-reason]");
    await expect(reason).toBeVisible();
    await expect(reason).toHaveText(
      "Format some text first, or use Copy formatting.",
    );
    // Above the bar, not over it.
    const [reasonBox, barBox] = await Promise.all([
      reason.boundingBox(),
      selectionBar(page).boundingBox(),
    ]);
    expect((reasonBox?.y ?? 0) + (reasonBox?.height ?? 0)).toBeLessThanOrEqual(
      barBox?.y ?? 0,
    );
  });

  test("the Formats cell reaches Copy formatting and Your formats", async ({
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
    await selectNewParagraph(page, "alpha", { keepSelectionCells: true });
    await selectionBar(page)
      .getByRole("button", { name: "Bold", exact: true })
      .tap();
    await selectionBar(page).getByRole("button", { name: "Formats" }).tap();
    await page.getByRole("menuitem", { name: "Copy formatting" }).tap();
    // The shared polite region (role=status), whoever renders it.
    await expect(
      page.getByRole("status").filter({ hasText: "Copied formatting: Bold" }),
    ).toBeAttached();
    await selectText(page, "beta");
    await selectionBar(page).getByRole("button", { name: "Formats" }).tap();
    await page.getByRole("menuitem", { name: "Note", exact: true }).tap();
    expect(await lastMark(page, "italic")).toBe(true);
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

test.describe("selection cells at 320px (PR E, WCAG 2.4.11)", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test("no cell sits under Back, at rest or focused, and the bar shows it scrolls", async ({
    page,
  }) => {
    await openDoc(page);
    await selectNewParagraph(page, "alpha", { keepSelectionCells: true });
    const scroller = selectionBar(page).locator("[data-phone-selection-cells]");
    const back = selectionBar(page).getByRole("button", {
      name: "Back to all tools",
    });
    const backBox = await back.boundingBox();
    const scrollerBox = await scroller.boundingBox();
    // The scroller ends where Back begins: nothing can pass under it.
    expect(
      (scrollerBox?.x ?? 0) + (scrollerBox?.width ?? 0),
    ).toBeLessThanOrEqual((backBox?.x ?? 0) + 1);
    // More cells than room: the end fades.
    await expect(scroller).toHaveAttribute("data-more", "end");

    const cells = scroller.getByRole("button");
    const count = await cells.count();
    await cells.first().focus();
    for (let index = 0; index < count; index += 1) {
      const cell = cells.nth(index);
      await expect(cell).toBeFocused();
      const box = await cell.boundingBox();
      const view = await scroller.boundingBox();
      expect(box?.x ?? 0).toBeGreaterThanOrEqual((view?.x ?? 0) - 1);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
        (backBox?.x ?? 0) + 1,
      );
      if (index < count - 1) await page.keyboard.press("ArrowRight");
    }
    await expect(scroller).toHaveAttribute("data-more", /start|both/);
  });
});
