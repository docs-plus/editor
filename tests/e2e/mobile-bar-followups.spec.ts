/**
 * Phone bar follow-ups (spec §4.7, contract §10 A6): the context slot cell
 * and its width rules, the safe areas, swipe down to close the "Text
 * format" sheet, and List re-taps. Every case runs as a touch phone.
 */
import { type CDPSession, expect, type Page, test } from "@playwright/test";

import {
  expectNoSeriousA11yViolations,
  openToolbarTestDoc,
  setTheme,
} from "./helpers/a11y";

const PHONE = { width: 390, height: 844 };
const SCREENS =
  process.env.PHONE_SCREENS_DIR ?? ".superpowers/screens-followups-phone";

test.use({ hasTouch: true, isMobile: true, viewport: PHONE });

const bar = (page: Page) => page.getByRole("toolbar", { name: "Formatting" });
const sheet = (page: Page) => page.getByRole("dialog", { name: "Text format" });

type SlotContext = "heading" | "code" | "table";

const SLOT_LABEL: Record<SlotContext, string> = {
  heading: "Section tools",
  code: "Code block tools",
  table: "Table tools",
};

async function openDoc(page: Page) {
  expect(
    await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
  ).toBe(true);
  await openToolbarTestDoc(page);
  await expect(bar(page)).toBeVisible();
  // Next's dev indicator sits over the first cell and eats its taps.
  await page.addStyleTag({
    content: "nextjs-portal { display: none !important; }",
  });
}

/** Appends a block of `kind` and puts a caret (not a selection) in it. */
async function caretIn(page: Page, kind: SlotContext) {
  await page.evaluate((context) => {
    const editor = window.__tiptap_editor;
    if (!editor) throw new Error("editor missing");
    const text = (value: string) => [{ type: "text", text: value }];
    const cell = (type: string, value: string) => ({
      type,
      content: [{ type: "paragraph", content: text(value) }],
    });
    const block =
      context === "heading"
        ? { type: "heading", attrs: { level: 2 }, content: text("Section") }
        : context === "code"
          ? {
              type: "codeBlock",
              attrs: { language: "javascript" },
              content: text("const marker = 1;"),
            }
          : {
              type: "table",
              content: [
                {
                  type: "tableRow",
                  content: [
                    cell("tableHeader", "Head"),
                    cell("tableHeader", "Two"),
                  ],
                },
                {
                  type: "tableRow",
                  content: [cell("tableCell", "Cell"), cell("tableCell", "B")],
                },
              ],
            };
    const marker =
      context === "heading"
        ? "Section"
        : context === "code"
          ? "const marker = 1;"
          : "Cell";
    editor
      .chain()
      .focus()
      .insertContentAt(editor.state.doc.content.size, block)
      .run();
    let pos = -1;
    editor.state.doc.descendants((node, at) => {
      if (node.isText && node.text === marker) pos = at + 2;
    });
    editor.chain().setTextSelection(pos).run();
  }, kind);
}

/** Visible cell names, in order. */
const cellNames = (page: Page) =>
  bar(page)
    .locator("[data-toolbar-item]")
    .evaluateAll((els) =>
      els
        .filter((el) => (el as HTMLElement).checkVisibility())
        .map((el) => el.getAttribute("aria-label")),
    );

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

/** The focused element's name, or "body" when focus fell to the page. */
const focusedName = (page: Page) =>
  page.evaluate(() => {
    const active = document.activeElement;
    if (!active || active === document.body) return "body";
    if (active.classList.contains("ProseMirror")) return "editor";
    return active.getAttribute("aria-label") ?? active.textContent ?? "";
  });

async function settle(page: Page, selector: string) {
  await page
    .locator(selector)
    .evaluate((el) =>
      Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)),
    );
}

async function openSheet(page: Page) {
  await bar(page).getByRole("button", { name: "Text format" }).tap();
  await expect(sheet(page)).toBeVisible();
  await sheet(page).getByRole("button", { name: "Heading 1" }).waitFor();
  await settle(page, "[data-format-sheet]");
}

const BASE_CELLS = ["Undo", "Text format", "Bold", "Italic", "List", "Indent"];

/** The cells expected at `width` with the slot cell named `slot`. */
function expectedCells(width: number, slot: string) {
  if (width < 360) return [...BASE_CELLS, "Insert"];
  const cells = [...BASE_CELLS, slot, "Insert"];
  return width >= 404 ? ["Undo", "Redo", ...cells.slice(1)] : cells;
}

test.describe("context slot cell", () => {
  for (const kind of ["heading", "code", "table"] as const) {
    for (const [width, height] of [
      [412, 915],
      [390, 844],
      [375, 812],
      [360, 740],
      [320, 568],
    ] as const) {
      test(`${kind} at ${width}px: the cells fit, 44×44 and named`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height });
        await openDoc(page);
        await caretIn(page, kind);
        const slot = SLOT_LABEL[kind];
        await expect
          .poll(() => cellNames(page))
          .toEqual(expectedCells(width, slot));
        expect(await smallTargets(page, '[role="toolbar"] button')).toEqual([]);
        expect(
          await bar(page).evaluate((el) => el.scrollWidth - el.clientWidth),
        ).toBeLessThanOrEqual(1);
        expect((await bar(page).boundingBox())?.height).toBe(44);

        // The sheet carries what the bar has no room for.
        await openSheet(page);
        const slotSection = sheet(page).getByRole("region", { name: slot });
        const redo = sheet(page).getByRole("button", { name: "Redo" });
        if (width < 360) {
          await expect(slotSection).toBeVisible();
          await expect(redo).toBeVisible();
        } else {
          await expect(slotSection).toBeHidden();
          if (width < 404) await expect(redo).toBeVisible();
          else await expect(redo).toBeHidden();
        }
      });
    }
  }

  test("paragraphs show no slot cell, and below 404px Redo stays in the sheet", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openDoc(page);
    await page.evaluate(() => {
      const editor = window.__tiptap_editor;
      if (!editor) return;
      editor
        .chain()
        .focus()
        .insertContentAt(editor.state.doc.content.size, {
          type: "paragraph",
          content: [{ type: "text", text: "plain" }],
        })
        .run();
      editor.commands.setTextSelection(editor.state.doc.content.size - 2);
    });
    await expect.poll(() => cellNames(page)).toEqual([...BASE_CELLS, "Insert"]);
  });

  test("heading: the cell's menu moves the section; a pick returns to the document, Esc to the cell", async ({
    page,
  }) => {
    await openDoc(page);
    // A section before this one, so it can move up.
    await page.evaluate(() => {
      const editor = window.__tiptap_editor;
      editor?.commands.insertContentAt(editor.state.doc.content.size, {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Before" }],
      });
    });
    await caretIn(page, "heading");
    const cell = bar(page).getByRole("button", { name: "Section tools" });
    await expect(cell).toHaveAttribute("aria-haspopup", "menu");
    await cell.tap();
    const menu = page.getByRole("menu", { name: "Section tools" });
    await expect(menu.getByRole("menuitem")).toHaveText([
      /Fold section/,
      /Move section up/,
      /Move section down/,
    ]);
    // Esc goes back to the cell, never the page.
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect.poll(() => focusedName(page)).toBe("Section tools");

    await cell.tap();
    await menu.getByRole("menuitem", { name: /Move section up/ }).tap();
    await expect(menu).toBeHidden();
    await expect.poll(() => focusedName(page)).toBe("editor");
    // The section now comes before "Before".
    expect(
      await page.evaluate(() => {
        const headings: string[] = [];
        window.__tiptap_editor?.state.doc.forEach((node) => {
          if (node.type.name === "heading") headings.push(node.textContent);
        });
        return headings.slice(1);
      }),
    ).toEqual(["Section", "Before"]);
  });

  test("code: the cell picks the language", async ({ page }) => {
    await openDoc(page);
    await caretIn(page, "code");
    // An alias checks its language: `js` is JavaScript.
    await page.evaluate(() =>
      window.__tiptap_editor?.commands.updateAttributes("codeBlock", {
        language: "js",
      }),
    );
    const cell = bar(page).getByRole("button", { name: "Code block tools" });
    // The cell shows its kind (CodeXml, drawn as a mask), not the sliders.
    expect(
      await cell.evaluate((el) => ({
        sliders: getComputedStyle(el.querySelector("svg") as Element).display,
        mask: getComputedStyle(el, "::before").maskImage,
      })),
    ).toEqual({
      sliders: "none",
      mask: expect.stringContaining("data:image/svg"),
    });
    await cell.tap();
    const menu = page.getByRole("menu", { name: "Code block tools" });
    // Copy code, a separator, then the "Language" group.
    await expect(menu.getByRole("separator")).toHaveCount(1);
    await expect(menu.getByRole("group", { name: "Language" })).toBeVisible();
    await expect(
      menu.getByRole("menuitemradio", { name: "JavaScript" }),
    ).toHaveAttribute("aria-checked", "true");
    await menu.getByRole("menuitemradio", { name: "Python" }).tap();
    await expect
      .poll(() =>
        page.evaluate(() => {
          let language: string | null = null;
          window.__tiptap_editor?.state.doc.descendants((node) => {
            if (node.type.name === "codeBlock") language = node.attrs.language;
          });
          return language;
        }),
      )
      .toBe("python");
  });

  test("table: an edit that removes the table while its menu is open never drops focus to the page", async ({
    page,
  }) => {
    await openDoc(page);
    await caretIn(page, "table");
    const cell = bar(page).getByRole("button", { name: "Table tools" });
    await cell.tap();
    const menu = page.getByRole("menu", { name: "Table tools" });
    await expect(menu.getByRole("menuitem").first()).toBeVisible();
    // Another writer deletes the table (no focus change here).
    await page.evaluate(() => window.__tiptap_editor?.commands.deleteTable());
    await expect
      .poll(() =>
        page.evaluate(() => {
          let tables = 0;
          window.__tiptap_editor?.state.doc.descendants((node) => {
            if (node.type.name === "table") tables++;
          });
          return tables;
        }),
      )
      .toBe(0);
    // The slot is held while focus is in the bar or its menu.
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect.poll(() => focusedName(page)).toBe("Table tools");
    // Focus moves on: the hold lets go and the cell leaves.
    await page.evaluate(() => window.__tiptap_editor?.commands.focus());
    await expect(cell).toHaveCount(0);
    expect(await focusedName(page)).toBe("editor");
  });

  test("below 360px the sheet carries the slot's tools, the language as a select", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await openDoc(page);
    await caretIn(page, "code");
    await openSheet(page);
    const section = sheet(page).getByRole("region", {
      name: "Code block tools",
    });
    await expect(section).toBeVisible();
    const select = section.getByRole("combobox", { name: "Code language" });
    await expect(select).toHaveValue("javascript");
    await select.selectOption("rust");
    await expect
      .poll(() =>
        page.evaluate(() => {
          let language: string | null = null;
          window.__tiptap_editor?.state.doc.descendants((node) => {
            if (node.type.name === "codeBlock") language = node.attrs.language;
          });
          return language;
        }),
      )
      .toBe("rust");
    await expect(
      section.getByRole("button", { name: "Copy code" }),
    ).toBeVisible();
    expect(
      await smallTargets(
        page,
        "[data-format-sheet] .st-sheet-slot button, [data-format-sheet] select",
      ),
    ).toEqual([]);
    await expect(sheet(page)).toBeVisible();
  });

  for (const width of [390, 320] as const) {
    test(`media at ${width}px: Media options opens the kit toolbar with focus in it`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 740 });
      await openDoc(page);
      await page.evaluate(() => {
        const editor = window.__tiptap_editor;
        if (!editor) throw new Error("editor missing");
        const svg = encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><rect width="200" height="120" fill="teal"/></svg>',
        );
        editor.commands.insertContentAt(editor.state.doc.content.size, [
          {
            type: "image",
            attrs: { src: `data:image/svg+xml,${svg}`, alt: "Sample" },
          },
          { type: "paragraph", content: [{ type: "text", text: "After" }] },
        ]);
        let pos = -1;
        editor.state.doc.descendants((node, at) => {
          if (pos < 0 && node.type.name === "image") pos = at;
          return pos < 0;
        });
        editor.chain().setNodeSelection(pos).focus().run();
      });
      await page.locator('.tiptap img[alt="Sample"]').scrollIntoViewIfNeeded();
      if (width >= 360) {
        // One tool: a direct button, as in the row's slot.
        await bar(page).getByRole("button", { name: "Media options…" }).tap();
      } else {
        await openSheet(page);
        await sheet(page)
          .getByRole("region", { name: "Media tools" })
          .getByRole("button", { name: "Media options…" })
          .tap();
        await expect(sheet(page)).toBeHidden();
      }
      const inKitToolbar = () =>
        page.evaluate(
          () => !!document.activeElement?.closest("[data-hm-toolbar]"),
        );
      await expect.poll(inKitToolbar).toBe(true);
      // Focus stays there once the menu or sheet has finished closing.
      await page.waitForTimeout(400);
      expect(await inKitToolbar()).toBe(true);
      await page.keyboard.press("Escape");
      await expect.poll(() => focusedName(page)).not.toBe("body");
    });
  }

  for (const theme of ["light", "dark"] as const) {
    test(`axe and 360px screenshots of the slot cell and its menu (${theme})`, async ({
      page,
    }) => {
      await setTheme(page, theme);
      await page.setViewportSize({ width: 360, height: 740 });
      await openDoc(page);
      await caretIn(page, "table");
      await expect(
        bar(page).getByRole("button", { name: "Table tools" }),
      ).toBeVisible();
      await expectNoSeriousA11yViolations(page, ['[role="toolbar"]']);
      await page.screenshot({ path: `${SCREENS}/slot-cell-360-${theme}.png` });
      await bar(page).getByRole("button", { name: "Table tools" }).tap();
      await expect(
        page.getByRole("menu", { name: "Table tools" }),
      ).toBeVisible();
      await settle(page, '[role="menu"]');
      await page.screenshot({
        path: `${SCREENS}/slot-menu-360-${theme}.png`,
      });
    });
  }
});

test.describe("safe areas", () => {
  /** Stands in a notch and a home indicator (Chromium reports 0). */
  async function notch(page: Page) {
    await page.evaluate(() => {
      const root = document.documentElement.style;
      root.setProperty("--safe-area-top", "47px");
      root.setProperty("--safe-area-bottom", "34px");
    });
  }

  test("viewport-fit=cover is set", async ({ page }) => {
    await openDoc(page);
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
      "content",
      /viewport-fit=cover/,
    );
  });

  test("the bar, the sheet and the tab strip clear the notch and the home indicator", async ({
    page,
  }) => {
    await openDoc(page);
    await notch(page);
    // The bar grows under the home indicator; its cells stay above it.
    await expect
      .poll(async () => (await bar(page).boundingBox())?.height)
      .toBe(44 + 34);
    const barBox = await bar(page).boundingBox();
    expect((barBox?.y ?? 0) + (barBox?.height ?? 0)).toBe(PHONE.height);
    const cellBottoms = await bar(page)
      .locator("[data-toolbar-item]")
      .evaluateAll((els) =>
        els
          .filter((el) => (el as HTMLElement).checkVisibility())
          .map((el) => el.getBoundingClientRect().bottom),
      );
    // 44px cells in a 44px bar overflow its 1px top border by half a pixel.
    for (const bottom of cellBottoms) {
      expect(bottom).toBeLessThanOrEqual(PHONE.height - 34 + 0.5);
    }
    // The document keeps clear of the taller bar.
    await expect
      .poll(() =>
        page
          .locator(".document-editor-wrapper")
          .evaluate((el) => getComputedStyle(el).scrollPaddingBottom),
      )
      .toBe("78px");
    // The tab strip's tabs start below the status bar.
    const tabs = await page.locator(".tab-bar-tabs").boundingBox();
    expect(tabs?.y ?? 0).toBeGreaterThanOrEqual(47);

    // The sheet's last control ends above the home indicator.
    await openSheet(page);
    const lastBottom = await page
      .locator("[data-format-sheet] .st-sheet-body")
      .evaluate((body) => {
        body.scrollTop = body.scrollHeight;
        const items = Array.from(body.querySelectorAll("button")).filter((el) =>
          el.checkVisibility(),
        );
        return items[items.length - 1]?.getBoundingClientRect().bottom ?? 0;
      });
    expect(lastBottom).toBeGreaterThan(0);
    expect(lastBottom).toBeLessThanOrEqual(PHONE.height - 34);
  });

  test("with the keyboard open the bar sits on it, without the inset", async ({
    page,
  }) => {
    await openDoc(page);
    await notch(page);
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
    expect((await bar(page).boundingBox())?.height).toBe(44);
  });

  test("desktop: no inset, no change", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openToolbarTestDoc(page);
    const tabBar = await page.locator(".tab-bar").boundingBox();
    expect(tabBar?.y).toBe(0);
    expect(tabBar?.height).toBe(38);
    expect(
      await page
        .locator(".app-shell")
        .evaluate((el) => getComputedStyle(el).paddingLeft),
    ).toBe("0px");
  });
});

test.describe("swipe down to close the sheet", () => {
  async function touch(page: Page): Promise<CDPSession> {
    // Raw touch drags go through Chromium's DevTools protocol.
    const browser = page.context().browser()?.browserType().name();
    test.skip(browser !== "chromium", "CDP only");
    return page.context().newCDPSession(page);
  }

  /** A touch drag from the sheet's title, `distance` px down, in steps. */
  async function swipe(page: Page, client: CDPSession, distance: number) {
    const title = await sheet(page)
      .getByRole("heading", { name: "Text format", exact: true })
      .boundingBox();
    if (!title) throw new Error("no sheet title");
    const x = title.x + 10;
    const y = title.y + title.height / 2;
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      await client.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y: y + (distance * i) / steps }],
      });
      // Slow enough that a short drag is not a flick.
      await page.waitForTimeout(40);
    }
    await client.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  }

  const sheetOffset = (page: Page) =>
    page
      .locator("[data-format-sheet]")
      .evaluate((el) => getComputedStyle(el).transform);

  test("a short drag snaps back; a long one closes and returns focus to Aa", async ({
    page,
  }) => {
    await openDoc(page);
    await openSheet(page);
    const client = await touch(page);
    await swipe(page, client, 40);
    await expect(sheet(page)).toBeVisible();
    await expect
      .poll(() => sheetOffset(page))
      .toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
    await swipe(page, client, 160);
    await expect(sheet(page)).toBeHidden();
    await expect.poll(() => focusedName(page)).toBe("Text format");
    expect(
      await page.evaluate(
        () => document.querySelector<HTMLElement>(".app-shell")?.inert,
      ),
    ).toBe(false);
  });

  test("Done, Esc and the backdrop still close it", async ({ page }) => {
    await openDoc(page);
    await openSheet(page);
    await sheet(page).getByRole("button", { name: "Done" }).tap();
    await expect(sheet(page)).toBeHidden();
    await expect.poll(() => focusedName(page)).toBe("Text format");

    await openSheet(page);
    await page.keyboard.press("Escape");
    await expect(sheet(page)).toBeHidden();
    await expect.poll(() => focusedName(page)).toBe("Text format");

    await openSheet(page);
    await page.mouse.click(PHONE.width / 2, 20);
    await expect(sheet(page)).toBeHidden();
    await expect.poll(() => focusedName(page)).not.toBe("body");
  });

  test("with reduced motion the close is instant", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openDoc(page);
    await openSheet(page);
    const client = await touch(page);
    await swipe(page, client, 30);
    await expect(sheet(page)).toBeVisible();
    // Snap back with no transition.
    expect(
      await page
        .locator("[data-format-sheet]")
        .evaluate((el) => (el as HTMLElement).style.transition),
    ).toBe("none");
    await swipe(page, client, 160);
    await expect(sheet(page)).toBeHidden();
    await expect.poll(() => focusedName(page)).toBe("Text format");
  });

  for (const theme of ["light", "dark"] as const) {
    test(`360px screenshots of the sheet mid-swipe (${theme})`, async ({
      page,
    }) => {
      await setTheme(page, theme);
      await page.setViewportSize({ width: 360, height: 740 });
      await openDoc(page);
      await openSheet(page);
      await page.screenshot({ path: `${SCREENS}/sheet-360-${theme}.png` });
      const client = await touch(page);
      const title = await sheet(page)
        .getByRole("heading", { name: "Text format", exact: true })
        .boundingBox();
      if (!title) throw new Error("no sheet title");
      const x = title.x + 10;
      const y = title.y + title.height / 2;
      await client.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y }],
      });
      for (let i = 1; i <= 6; i++) {
        await client.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x, y: y + i * 10 }],
        });
      }
      await page.screenshot({
        path: `${SCREENS}/sheet-swipe-360-${theme}.png`,
      });
      await client.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await expect(sheet(page)).toBeVisible();
    });
  }
});

test("List: re-tapping the checked type keeps the list, like the row", async ({
  page,
}) => {
  await openDoc(page);
  await page.evaluate(() => {
    const editor = window.__tiptap_editor;
    if (!editor) return;
    editor
      .chain()
      .focus()
      .insertContentAt(editor.state.doc.content.size, {
        type: "paragraph",
        content: [{ type: "text", text: "item" }],
      })
      .run();
    editor.commands.setTextSelection(editor.state.doc.content.size - 2);
  });
  const listType = () =>
    page.evaluate(() => {
      const $from = window.__tiptap_editor?.state.selection.$from;
      for (let depth = $from?.depth ?? 0; depth > 0; depth--) {
        const name = $from?.node(depth).type.name;
        if (name?.endsWith("List")) return name;
      }
      return null;
    });
  const list = bar(page).getByRole("button", { name: "List" });
  await list.tap();
  const menu = page.getByRole("menu", { name: "List" });
  await menu.getByRole("menuitemradio", { name: /bullet/i }).tap();
  await expect.poll(listType).toBe("bulletList");

  await list.tap();
  const checked = menu.getByRole("menuitemradio", { name: /bullet/i });
  await expect(checked).toHaveAttribute("aria-checked", "true");
  await checked.tap();
  await expect(menu).toBeHidden();
  await expect.poll(listType).toBe("bulletList");
  // Nothing ran, so focus stays where the tap left it, never on the page.
  await expect.poll(() => focusedName(page)).not.toBe("body");

  // Another type still switches.
  await list.tap();
  await menu.getByRole("menuitemradio", { name: /numbered|ordered/i }).tap();
  await expect.poll(listType).toBe("orderedList");
});
