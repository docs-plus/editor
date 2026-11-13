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
  "Text format",
  "Bold",
  "Italic",
  "List",
  "Indent",
  "Insert",
];

test.use({ hasTouch: true, isMobile: true, viewport: PHONE });

const bar = (page: Page) => page.getByRole("toolbar", { name: "Formatting" });
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
}

/** Appends a paragraph and selects `text` in it. */
async function selectNewParagraph(page: Page, text = "alpha") {
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
  test(`${width}px: one 44px bar of seven 44×44 cells, docked at the bottom`, async ({
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
    expect(names).toEqual(CELLS);
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
  const bold = bar(page).getByRole("button", { name: "Bold" });
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
