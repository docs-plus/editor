import { gzipSync } from "node:zlib";

import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

import { expectNoSeriousA11yViolations, setTheme } from "./helpers/a11y";
import { EditorPage, typeInNewParagraphAtEnd } from "./helpers/editor-page";
import { CHUNK_MARKERS, interceptChunk } from "./helpers/lazy-chunk";
import { getPlaywrightModifierKey } from "./helpers/playwright-modifier-key";

/**
 * The "/" block menu: typed "/" opens a listbox of block actions under the
 * caret, typing filters it, Enter or a click runs the pick as one undo
 * step, and focus never leaves the editor. Needs `next dev`
 * (`window.__tiptap_editor`), except the budget test, which runs against
 * a production build only (`SLASH_BUDGET=1`).
 */

const MENU = "[data-slash-menu]";
/** Slash chunk budget (gzip), plan "Budgets". */
const SLASH_BUDGET_BYTES = 6 * 1024;
const SCREENS = process.env.SLASH_SCREENS_DIR;

type EditorWindow = Window & {
  __tiptap_editor?: {
    state: {
      selection: {
        from: number;
        $head: {
          parent: {
            type: { name: string };
            attrs: Record<string, unknown>;
            textContent: string;
          };
          parentOffset: number;
        };
      };
    };
    setEditable(editable: boolean): void;
    getHTML(): string;
  };
};

const menu = (page: Page) => page.locator(MENU);

/** Waits for the menu's 100 ms fade (axe reads colours mid-fade). */
const settled = (page: Page) =>
  page.evaluate(() => {
    const popup = document.querySelector("[data-slash-menu]");
    const fades = popup?.getAnimations({ subtree: true }) ?? [];
    return Promise.all(fades.map((animation) => animation.finished));
  });

/** A design-review screenshot, once the menu's fade has finished. */
async function shot(page: Page, path: string) {
  await settled(page);
  // Two frames: a caret moved by a late render re-places the list in one.
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await page.screenshot({ path });
}

/**
 * axe on the open menu. `scrollable-region-focusable` is off for the list
 * alone: axe exempts a scrolling listbox only when a `role="combobox"`
 * controls it, and this one is controlled by the editor, a `textbox`,
 * through `aria-controls` and `aria-activedescendant` (the arrows move
 * and scroll it; a focusable list would take focus out of the editor and
 * close it). Every other rule runs, and the editor is checked in full.
 */
async function expectMenuAxeClean(page: Page) {
  await settled(page);
  const { violations } = await new AxeBuilder({ page })
    .include(MENU)
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .disableRules(["scrollable-region-focusable"])
    .analyze();
  const serious = violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
    );
  expect(serious, serious.join("\n")).toEqual([]);
  await expectNoSeriousA11yViolations(page, [".tiptap"]);
}
const editorDom = (page: Page) => page.locator(".tiptap").first();
const options = (page: Page) => page.locator(`${MENU} [role="option"]`);

/** The caret's block: type, heading level, text and caret offset. */
const caretBlock = (page: Page) =>
  page.evaluate(() => {
    const editor = (window as EditorWindow).__tiptap_editor;
    if (!editor) throw new Error("no editor");
    const { $head } = editor.state.selection;
    return {
      type: $head.parent.type.name,
      level: ($head.parent.attrs.level as number | undefined) ?? null,
      text: $head.parent.textContent,
      offset: $head.parentOffset,
    };
  });

const editorFocused = (page: Page) =>
  page.evaluate(() =>
    Boolean(document.activeElement?.classList.contains("ProseMirror")),
  );

async function openDoc(page: Page, docId?: string): Promise<EditorPage> {
  const editor = new EditorPage(page);
  await editor.goto(docId);
  await editor.waitForSync();
  // Next's dev indicator sits in the corner; keep it out of the evidence.
  await page.addStyleTag({
    content: "nextjs-portal { display: none !important; }",
  });
  return editor;
}

/** A new empty paragraph at the end, then `text` typed into it. */
const typeAtEnd = (page: Page, text: string) =>
  typeInNewParagraphAtEnd(page, text);

async function expectComboboxAttributes(page: Page) {
  const listbox = await editorDom(page).getAttribute("aria-controls");
  expect(listbox).toMatch(/^slash-menu-[\w-]+$/);
  await expect(page.locator(`#${listbox}[role="listbox"]`)).toBeVisible();
  await expect(editorDom(page)).toHaveAttribute("aria-autocomplete", "list");
  await expect(editorDom(page)).toHaveAttribute("aria-haspopup", "listbox");
  await expect(editorDom(page)).not.toHaveAttribute("aria-expanded", /.*/);
  const active = await editorDom(page).getAttribute("aria-activedescendant");
  expect(active).toBeTruthy();
  await expect(page.locator(`[id="${active}"]`)).toHaveAttribute(
    "aria-selected",
    "true",
  );
}

async function expectNoComboboxAttributes(page: Page) {
  for (const name of [
    "aria-controls",
    "aria-activedescendant",
    "aria-autocomplete",
    "aria-haspopup",
  ]) {
    await expect(editorDom(page)).not.toHaveAttribute(name, /.*/);
  }
}

test.describe("slash menu", () => {
  test.skip(process.env.SLASH_BUDGET === "1", "budget run only");

  test("'/' opens the menu at the caret; typing filters; Enter applies Heading 2 as one undo step", async ({
    page,
  }) => {
    await openDoc(page);
    await typeAtEnd(page, "/");
    await expect(menu(page)).toBeVisible();
    await expect(options(page).first()).toHaveText(/Normal text/);
    // Under the "/", left-aligned with it. ProseMirror's coordinates: a
    // collapsed DOM range measures 0×0 at the origin in WebKit.
    const caret = await page.evaluate(() => {
      const view = window.__tiptap_editor?.view;
      if (!view) return null;
      const rect = view.coordsAtPos(view.state.selection.from);
      return { x: rect.left, bottom: rect.bottom };
    });
    const box = await menu(page).boundingBox();
    expect(caret && box).toBeTruthy();
    if (caret && box) {
      expect(box.y).toBeGreaterThanOrEqual(caret.bottom);
      expect(Math.abs(box.x - caret.x)).toBeLessThan(24);
    }

    await page.keyboard.type("h2");
    await expect(options(page).first()).toHaveText(/Heading 2/);
    await expect(options(page).first()).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.keyboard.press("Enter");
    await expect(menu(page)).toHaveCount(0);
    expect(await caretBlock(page)).toEqual({
      type: "heading",
      level: 2,
      text: "",
      offset: 0,
    });
    expect(await editorFocused(page)).toBe(true);

    await page.keyboard.press(`${getPlaywrightModifierKey()}+z`);
    await expect
      .poll(() => caretBlock(page))
      .toMatchObject({ type: "paragraph", text: "/h2" });
  });

  test("focus never leaves the editor, and the combobox attributes follow the menu", async ({
    page,
  }) => {
    await openDoc(page);
    await typeAtEnd(page, "/");
    await expect(menu(page)).toBeVisible();
    // A bare "/" has no active row until an arrow.
    await expect(editorDom(page)).not.toHaveAttribute(
      "aria-activedescendant",
      /.*/,
    );
    await expect(menu(page).locator('[aria-selected="true"]')).toHaveCount(0);
    await page.keyboard.press("ArrowDown");
    await expect(options(page).first()).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expectComboboxAttributes(page);
    expect(await editorFocused(page)).toBe(true);

    // ↓ moves the active option; ↑ from the first wraps to the last.
    const first = await editorDom(page).getAttribute("aria-activedescendant");
    await page.keyboard.press("ArrowDown");
    await expect(editorDom(page)).not.toHaveAttribute(
      "aria-activedescendant",
      first ?? "",
    );
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    const last = options(page).last();
    await expect(last).toHaveAttribute("aria-selected", "true");
    await expect(editorDom(page)).toHaveAttribute(
      "aria-activedescendant",
      (await last.getAttribute("id")) ?? "",
    );
    await expect(last).toBeInViewport();
    expect(await editorFocused(page)).toBe(true);

    await page.keyboard.press("Escape");
    await expect(menu(page)).toHaveCount(0);
    await expectNoComboboxAttributes(page);
  });

  test("Esc leaves '/query' as typed text and the caret after it", async ({
    page,
  }) => {
    await openDoc(page);
    await typeAtEnd(page, "/quo");
    await expect(menu(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu(page)).toHaveCount(0);
    expect(await caretBlock(page)).toEqual({
      type: "paragraph",
      level: null,
      text: "/quo",
      offset: 4,
    });
    // Typing on stays text; the menu does not come back.
    await page.keyboard.type("te");
    await expect(menu(page)).toHaveCount(0);
  });

  test("a click runs the pick and keeps focus in the editor", async ({
    page,
  }) => {
    await openDoc(page);
    await typeAtEnd(page, "/list");
    await options(page).filter({ hasText: "Numbered list" }).click();
    await expect(menu(page)).toHaveCount(0);
    expect(await editorFocused(page)).toBe(true);
    expect(
      await page.evaluate(() =>
        (window as EditorWindow).__tiptap_editor?.getHTML(),
      ),
    ).toContain("<ol");
    expect(await caretBlock(page)).toMatchObject({ text: "" });
  });

  test("'and/or', a URL, a heading and the title never open it", async ({
    page,
  }) => {
    const editor = await openDoc(page);
    await typeAtEnd(page, "and/or https://example.com/path");
    await expect(menu(page)).toHaveCount(0);
    await page.keyboard.press("Enter");
    await page.keyboard.press(`${getPlaywrightModifierKey()}+Alt+2`);
    await page.keyboard.type("/heading");
    await expect(menu(page)).toHaveCount(0);
    await editor.focusTitle();
    await page.keyboard.type(" /");
    await expect(menu(page)).toHaveCount(0);
  });

  test("in a list item and a quote the menu takes Enter before them", async ({
    page,
  }) => {
    await openDoc(page);
    await typeAtEnd(page, "- item /task");
    await expect(options(page).first()).toHaveText(/Task list/);
    await page.keyboard.press("Enter");
    await expect(menu(page)).toHaveCount(0);
    const html = () =>
      page.evaluate(
        () => (window as EditorWindow).__tiptap_editor?.getHTML() ?? "",
      );
    expect(await html()).toContain('data-type="taskList"');
    expect(await caretBlock(page)).toMatchObject({ text: "item " });

    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("> quoted /h3");
    await expect(options(page).first()).toHaveText(/Heading 3/);
    await page.keyboard.press("Enter");
    await expect(menu(page)).toHaveCount(0);
    expect(await caretBlock(page)).toMatchObject({
      type: "heading",
      level: 3,
      text: "quoted ",
    });
    // A text style lifts the block out of the quote, as the row's does.
    expect(await html()).toMatch(/<h3[^>]*>quoted <\/h3>/);
  });

  test("'/' then Enter is a line break until the writer types or arrows", async ({
    page,
  }) => {
    await openDoc(page);
    await typeAtEnd(page, "and /");
    await expect(menu(page)).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(menu(page)).toHaveCount(0);
    expect(await caretBlock(page)).toMatchObject({
      type: "paragraph",
      text: "",
    });
    await expect(editorDom(page)).toContainText("and /");
    // Arrowed: Enter picks (↓ Normal text, ↓ Heading 1).
    await page.keyboard.type("/");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(menu(page)).toHaveCount(0);
    expect(await caretBlock(page)).toMatchObject({ type: "heading", level: 1 });
  });

  test("each section shows once, best match first ('/b', '/c')", async ({
    page,
  }) => {
    await openDoc(page);
    await typeAtEnd(page, "");
    for (const query of ["/b", " /c"]) {
      await page.keyboard.type(query);
      await expect(menu(page)).toBeVisible();
      const headings = await page
        .locator(`${MENU} [role="group"]`)
        .evaluateAll((groups) =>
          groups.map((group) => group.getAttribute("aria-labelledby")),
        );
      expect(new Set(headings).size).toBe(headings.length);
      await expectMenuAxeClean(page);
      await page.keyboard.press("Escape");
    }
  });

  test("a hidden match says why; a finished word with no match closes", async ({
    page,
  }) => {
    await openDoc(page);
    await typeAtEnd(page, "> quoted /quo");
    await expect(
      menu(page).getByText("Quote: Already in a quote."),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page.keyboard.type(" /zzz");
    await expect(menu(page).getByText("No matching blocks")).toBeVisible();
    await page.keyboard.type(" ");
    await expect(menu(page)).toHaveCount(0);
  });

  test("with no match it says so, and Enter is a newline again", async ({
    page,
  }) => {
    await openDoc(page);
    await typeAtEnd(page, "/zzz");
    await expect(menu(page).getByText("No matching blocks")).toBeVisible();
    await expect(options(page)).toHaveCount(0);
    await page.keyboard.press("Enter");
    await expect(menu(page)).toHaveCount(0);
    expect(await caretBlock(page)).toMatchObject({
      type: "paragraph",
      text: "",
    });
  });

  test("the live region announces the active option and 'No matching blocks'", async ({
    page,
  }) => {
    await openDoc(page);
    const status = page.locator("[data-slash-status]");
    await expect(status).toHaveAttribute("role", "status");
    await expect(status).toBeEmpty();
    await typeAtEnd(page, "/");
    // The first message says a menu opened.
    await expect(status).toHaveText(/^Block menu, \d+ options\.$/);
    await page.keyboard.press("ArrowDown");
    await expect(status).toHaveText(/^Normal text, 1 of \d+$/);
    await page.keyboard.press("ArrowDown");
    await expect(status).toHaveText(/^Heading 1, 2 of \d+$/);
    // A visible note is spoken too ("×" reads badly).
    await page.keyboard.type("tab");
    await expect(status).toHaveText(/^Table, \d+ by \d+, 1 of \d+$/);
    await page.keyboard.type("zzz");
    await expect(status).toHaveText("No matching blocks");
    await page.keyboard.press("Escape");
    await expect(status).toBeEmpty();
  });

  test("Enter before the chunk lands is a newline", async ({ page }) => {
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const restore = await interceptChunk(
      page,
      CHUNK_MARKERS.slashMenu,
      async (route, response) => {
        await held;
        await route.fulfill({ response });
      },
    );
    await openDoc(page);
    await typeAtEnd(page, "/h");
    await page.keyboard.press("Enter");
    expect(await caretBlock(page)).toMatchObject({
      type: "paragraph",
      text: "",
    });
    release();
    await restore();
    await page.keyboard.type("after");
    await expect(menu(page)).toHaveCount(0);
    await expect(editorDom(page)).toContainText("/h");
  });

  test("read-only while open closes the menu", async ({ page }) => {
    await openDoc(page);
    await typeAtEnd(page, "/");
    await expect(menu(page)).toBeVisible();
    await page.evaluate(() =>
      (window as EditorWindow).__tiptap_editor?.setEditable(false),
    );
    await expect(menu(page)).toHaveCount(0);
    await expectNoComboboxAttributes(page);
    // Nothing of the menu holds focus. (A contenteditable that turns
    // read-only drops DOM focus in Chromium, menu or not.)
    expect(
      await page.evaluate(() =>
        Boolean(document.activeElement?.closest("[data-slash-menu]")),
      ),
    ).toBe(false);
  });

  test("near the bottom edge the list flips above the caret, clear of its line", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 520 });
    await openDoc(page);
    await typeAtEnd(page, "x");
    // Push the caret's line to the bottom of the viewport.
    await page.evaluate(() => {
      const wrapper = document.querySelector(".document-editor-wrapper");
      const block = window.getSelection()?.anchorNode?.parentElement;
      if (!wrapper || !block) throw new Error("no wrapper");
      const pad = wrapper.clientHeight - block.getBoundingClientRect().bottom;
      wrapper.scrollTop -= pad - 40;
    });
    await page.keyboard.type(" /");
    await expect(menu(page)).toBeVisible();
    const caret = await page.evaluate(() => {
      const rect = window.getSelection()?.getRangeAt(0).getBoundingClientRect();
      return rect ? { top: rect.top, bottom: rect.bottom } : null;
    });
    const box = await menu(page).boundingBox();
    if (!caret || !box) throw new Error("no geometry");
    const below = box.y >= caret.bottom;
    const above = box.y + box.height <= caret.top;
    expect(below || above).toBe(true);
    expect(box.y + box.height).toBeLessThanOrEqual(520);

    // The empty state too: never over the caret line.
    await page.keyboard.type("zzz");
    await expect(menu(page).getByText("No matching blocks")).toBeVisible();
    const line = await page.evaluate(() => {
      const rect = window.getSelection()?.getRangeAt(0).getBoundingClientRect();
      return rect ? { top: rect.top, bottom: rect.bottom } : null;
    });
    const empty = await menu(page).boundingBox();
    if (!line || !empty) throw new Error("no geometry");
    expect(empty.y >= line.bottom || empty.y + empty.height <= line.top).toBe(
      true,
    );
    expect(empty.y + empty.height).toBeLessThanOrEqual(520);
  });

  test("a collaborator deleting the '/' closes the menu", async ({
    browser,
  }) => {
    const docId = `test-slash-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    try {
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();
      await openDoc(pageA, docId);
      await openDoc(pageB, docId);
      await typeAtEnd(pageA, "/hea");
      await expect(menu(pageA)).toBeVisible();
      await expect(editorDom(pageB)).toContainText("/hea");
      // B selects the "/" and deletes it.
      await pageB.evaluate(() => {
        const ed = (
          window as unknown as {
            __tiptap_editor: {
              state: {
                doc: {
                  descendants(
                    fn: (
                      node: { isText: boolean; text?: string },
                      pos: number,
                    ) => void,
                  ): void;
                };
              };
              commands: {
                deleteRange(range: { from: number; to: number }): boolean;
              };
            };
          }
        ).__tiptap_editor;
        let at = -1;
        ed.state.doc.descendants((node, pos) => {
          const index = node.isText ? (node.text?.indexOf("/hea") ?? -1) : -1;
          if (index >= 0 && at < 0) at = pos + index;
        });
        ed.commands.deleteRange({ from: at, to: at + 1 });
      });
      await expect(editorDom(pageA)).not.toContainText("/hea");
      await expect(menu(pageA)).toHaveCount(0);
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  for (const theme of ["light", "dark"] as const) {
    test(`axe with the menu open, filtered and empty (${theme})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await setTheme(page, theme);
      await openDoc(page);
      await typeAtEnd(page, "/");
      await expect(menu(page)).toBeVisible();
      await expectMenuAxeClean(page);
      if (SCREENS) await shot(page, `${SCREENS}/open-1440-${theme}.png`);
      await page.keyboard.type("h");
      await expect(options(page).first()).toHaveText(/Heading 1/);
      await expectMenuAxeClean(page);
      if (SCREENS)
        await page.screenshot({
          path: `${SCREENS}/filtered-1440-${theme}.png`,
        });
      await page.keyboard.type("zzz");
      await expect(menu(page).getByText("No matching blocks")).toBeVisible();
      await expectMenuAxeClean(page);
      if (SCREENS) await shot(page, `${SCREENS}/empty-1440-${theme}.png`);
    });
  }

  test("forced colours keep the active row visible", async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active" });
    await openDoc(page);
    await typeAtEnd(page, "/");
    await expect(menu(page)).toBeVisible();
    await page.keyboard.press("ArrowDown");
    const active = options(page).first();
    await expect(active).toHaveAttribute("aria-selected", "true");
    const fill = await active.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    const other = await options(page)
      .nth(1)
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(fill).not.toBe(other);
  });
});

test.describe("slash menu on touch", () => {
  test.skip(process.env.SLASH_BUDGET === "1", "budget run only");
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 375, height: 812 },
  });

  for (const theme of ["light", "dark"] as const) {
    test(`rows are 44 px, the list stays above the bar and keyboard, a tap applies (${theme})`, async ({
      page,
    }) => {
      await setTheme(page, theme);
      await openDoc(page);
      expect(
        await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
      ).toBe(true);
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
      await typeAtEnd(page, "/");
      await expect(menu(page)).toBeVisible();
      const heights = await options(page).evaluateAll((rows) =>
        rows.map((row) => row.getBoundingClientRect().height),
      );
      expect(Math.min(...heights)).toBeGreaterThanOrEqual(44);
      const bar = await page
        .getByRole("toolbar", { name: "Formatting" })
        .boundingBox();
      const box = await menu(page).boundingBox();
      if (!bar || !box) throw new Error("no geometry");
      expect(box.y + box.height).toBeLessThanOrEqual(bar.y);
      await expectMenuAxeClean(page);
      if (SCREENS) await shot(page, `${SCREENS}/open-375-${theme}.png`);
      await page.keyboard.type("bul");
      if (SCREENS) await shot(page, `${SCREENS}/filtered-375-${theme}.png`);
      await options(page).first().tap();
      await expect(menu(page)).toHaveCount(0);
      expect(await editorFocused(page)).toBe(true);
      expect(
        await page.evaluate(() =>
          (window as EditorWindow).__tiptap_editor?.getHTML(),
        ),
      ).toContain("<ul");
      await page.keyboard.type("/zzz");
      await expect(menu(page).getByText("No matching blocks")).toBeVisible();
      if (SCREENS) await shot(page, `${SCREENS}/empty-375-${theme}.png`);
    });
  }
});

/** Types `count` lines at the end, so the caret ends at the bottom. */
async function fillToBottom(page: Page, count: number) {
  await typeAtEnd(page, "Line 1");
  for (let line = 2; line <= count; line++) {
    await page.keyboard.press("Enter");
    await page.keyboard.type(`Line ${line}`);
  }
}

/**
 * The list is hidden (its caret out of view) or next to its caret line,
 * clear of it, and above the docked bar with the caret line.
 */
async function expectAttachedOrHidden(page: Page) {
  const hidden = await menu(page).evaluate(
    (el) => getComputedStyle(el).visibility === "hidden",
  );
  if (hidden) return;
  const box = await menu(page).boundingBox();
  const line = await page.evaluate(() => {
    const rect = window.getSelection()?.getRangeAt(0).getBoundingClientRect();
    return rect ? { top: rect.top, bottom: rect.bottom } : null;
  });
  if (!box || !line) throw new Error("no geometry");
  const gapBelow = box.y - line.bottom;
  const gapAbove = line.top - (box.y + box.height);
  expect(gapBelow >= 0 || gapAbove >= 0).toBe(true);
  expect(Math.min(Math.abs(gapBelow), Math.abs(gapAbove))).toBeLessThan(16);
  const dock = page.locator('[data-slot="toolbar"][data-variant="docked"]');
  if ((await dock.count()) > 0) {
    const bar = await dock.boundingBox();
    if (!bar) throw new Error("no bar");
    expect(box.y + box.height).toBeLessThanOrEqual(bar.y);
    expect(line.bottom).toBeLessThanOrEqual(bar.y);
  }
}

/** Open and close a query, shooting the menu as `name`. */
async function shotQuery(page: Page, query: string, name: string) {
  await page.keyboard.type(query);
  await expect(menu(page)).toHaveCount(1);
  await shot(page, `${SCREENS}/${name}.png`);
  await expectAttachedOrHidden(page);
  await page.keyboard.press("Escape");
}

/** "/ta", "/dia" (after a Flowchart, so it is "Last used"), the full list's end and "/b". */
async function insertAndDiagramShots(page: Page, suffix: string) {
  await typeAtEnd(page, "/flow");
  await expect(options(page).first()).toHaveText(/Flowchart/);
  await page.keyboard.press("Enter");
  await expect(menu(page)).toHaveCount(0);
  // Let the diagram render (it moves everything after it).
  await expect(page.locator(".tiptap svg").first()).toBeVisible();
  // The new diagram took the caret: back to the empty line after it.
  await page.evaluate(() =>
    (
      window as unknown as {
        __tiptap_editor: { commands: { focus(at: string): boolean } };
      }
    ).__tiptap_editor.commands.focus("end"),
  );
  await shotQuery(page, "/ta", `table-${suffix}`);
  await shotQuery(page, " /dia", `diagrams-${suffix}`);
  await page.keyboard.type(" /");
  await expect(menu(page)).toBeVisible();
  // ↑ from the first row wraps to the last: the list's end.
  await page.keyboard.press("ArrowUp");
  await shot(page, `${SCREENS}/list-end-${suffix}.png`);
  await expectAttachedOrHidden(page);
  await page.keyboard.press("Escape");
  await shotQuery(page, " /b", `b-${suffix}`);
  // A match that cannot go here says why.
  await page.keyboard.press("Enter");
  await page.keyboard.type("> quoted /quo");
  await expect(menu(page)).toContainText("Quote: Already in a quote.");
  await shot(page, `${SCREENS}/reason-${suffix}.png`);
  await expectAttachedOrHidden(page);
  await page.keyboard.press("Escape");
}

/** The list clears the docked bar, and the caret line is above it too. */
async function expectClearOfBar(page: Page) {
  const bar = await page
    .getByRole("toolbar", { name: "Formatting" })
    .boundingBox();
  const box = await menu(page).boundingBox();
  const caret = await page.evaluate(() => {
    const rect = window.getSelection()?.getRangeAt(0).getBoundingClientRect();
    return rect ? rect.bottom : null;
  });
  if (!bar || !box || caret === null) throw new Error("no geometry");
  expect(box.y + box.height).toBeLessThanOrEqual(bar.y);
  expect(caret).toBeLessThanOrEqual(bar.y);
}

/** Chromium has no on-screen keyboard: stand in a shrunken visualViewport. */
const standInKeyboard = (page: Page) =>
  page.evaluate(() => {
    const vv = window.visualViewport;
    if (!vv) throw new Error("no visualViewport");
    Object.defineProperty(vv, "height", {
      configurable: true,
      get: () => window.innerHeight - 300,
    });
    vv.dispatchEvent(new Event("resize"));
  });

test.describe("slash menu design-review screenshots", () => {
  test.skip(!SCREENS, "SLASH_SCREENS_DIR only");

  for (const theme of ["light", "dark"] as const) {
    test(`near the bottom edge at 1440 (${theme})`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await setTheme(page, theme);
      await openDoc(page);
      await fillToBottom(page, 40);
      await page.keyboard.type(" /");
      await expect(menu(page)).toBeVisible();
      await shot(page, `${SCREENS}/edge-1440-${theme}.png`);
      await page.keyboard.type("zzz");
      await expect(menu(page).getByText("No matching blocks")).toBeVisible();
      await shot(page, `${SCREENS}/edge-empty-1440-${theme}.png`);
    });

    test(`Insert and Diagrams at 1440 (${theme})`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await setTheme(page, theme);
      await openDoc(page);
      await insertAndDiagramShots(page, `1440-${theme}`);
    });
  }
});

test.describe("slash menu design-review screenshots on touch", () => {
  test.skip(!SCREENS, "SLASH_SCREENS_DIR only");
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 375, height: 812 },
  });

  for (const theme of ["light", "dark"] as const) {
    test(`near the bottom edge at 375, keyboard up (${theme})`, async ({
      page,
    }) => {
      await setTheme(page, theme);
      await openDoc(page);
      await standInKeyboard(page);
      await fillToBottom(page, 30);
      await page.keyboard.type(" /");
      await expect(menu(page)).toBeVisible();
      await expectClearOfBar(page);
      await shot(page, `${SCREENS}/edge-375-${theme}.png`);
      await page.keyboard.type("zzz");
      await expect(menu(page).getByText("No matching blocks")).toBeVisible();
      await expectClearOfBar(page);
      await shot(page, `${SCREENS}/edge-empty-375-${theme}.png`);
    });

    test(`Insert and Diagrams at 375 (${theme})`, async ({ page }) => {
      await setTheme(page, theme);
      await openDoc(page);
      await standInKeyboard(page);
      await insertAndDiagramShots(page, `375-${theme}`);
    });
  }
});

test.describe("slash budget", () => {
  test.skip(process.env.SLASH_BUDGET !== "1", "production build only");

  test("the slash chunk is at most 6 KB gz", async ({ page }) => {
    const bodies = new Map<string, Buffer>();
    const pending: Promise<void>[] = [];
    page.on("response", (response) => {
      if (!response.url().endsWith(".js")) return;
      pending.push(
        response.body().then((body) => {
          bodies.set(new URL(response.url()).pathname, body);
        }),
      );
    });
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForSync();
    await page.locator(".tiptap").first().click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("/");
    await expect(menu(page)).toBeVisible();
    await page.waitForLoadState("networkidle");
    await Promise.all(pending);
    // The chunk that renders the menu ("No matching blocks" survives
    // minification), and the group its loader fetches with it.
    const chunk = [...bodies].find(([, body]) =>
      body.includes("No matching blocks"),
    )?.[0];
    expect(chunk).toBeTruthy();
    const file = chunk?.split("/").pop() ?? "";
    let group = [chunk as string];
    for (const [, body] of bodies) {
      for (const [, list] of body
        .toString()
        .matchAll(/Promise\.all\(\[([^\]]*)\]/g)) {
        if (!list.includes(file)) continue;
        group = [...list.matchAll(/"(static\/chunks\/[^"]+)"/g)].map(
          (match) => `/_next/${match[1]}`,
        );
      }
    }
    const sizes = group.map((path) => ({
      path,
      gz: gzipSync(bodies.get(path) ?? Buffer.alloc(0)).length,
    }));
    const total = sizes.reduce((sum, entry) => sum + entry.gz, 0);
    console.log(
      "slash chunks (gzip bytes):",
      JSON.stringify(sizes),
      "total",
      total,
    );
    expect(sizes.every((entry) => entry.gz > 0)).toBe(true);
    expect(total).toBeLessThanOrEqual(SLASH_BUDGET_BYTES);
  });
});
